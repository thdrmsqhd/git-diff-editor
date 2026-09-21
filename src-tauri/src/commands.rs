use crate::contracts::*;
use crate::errors::AppError;
use crate::files::codec::decode;
use crate::files::resolve_inside;
use crate::files::save::save_if_unchanged;
use crate::files::versions::disk_version;
use crate::git::repository::{open_repo, RepoInfo};
use crate::git::snapshot::{blob_oid_for, read_blob, snapshot_files};
use crate::settings::store::{load as load_settings, push_recent};
use crate::watch::coordinator::spawn_watch;
use notify::RecommendedWatcher;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

pub struct AppState {
    pub sessions: Mutex<HashMap<String, RepoInfo>>,
    pub generation: Mutex<HashMap<String, u64>>,
    pub watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            generation: Mutex::new(HashMap::new()),
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

fn bump(state: &AppState, id: &str) -> u64 {
    let mut generation = state.generation.lock();
    let value = generation.entry(id.to_string()).or_insert(0);
    *value += 1;
    *value
}

fn snapshot_of(state: &AppState, id: &str, info: &RepoInfo) -> Result<RepositorySnapshot, AppError> {
    let files = snapshot_files(info)?;
    Ok(RepositorySnapshot {
        session_id: id.to_string(),
        root: info.root.to_string_lossy().into_owned(),
        git_dir: info.git_dir.to_string_lossy().into_owned(),
        common_dir: info.common_dir.to_string_lossy().into_owned(),
        head_oid: info.head_oid.clone(),
        branch: info.branch.clone(),
        detached_head: info.detached_head,
        generation: *state.generation.lock().get(id).unwrap_or(&1),
        files,
        git_version: info.git_version.clone(),
    })
}

#[tauri::command]
pub fn open_repository(
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<Arc<AppState>>,
) -> Result<RepositorySnapshot, AppError> {
    let info = open_repo(&PathBuf::from(&path))?;
    let id = Uuid::new_v4().to_string();
    push_recent(&info.root.to_string_lossy());
    bump(&state, &id);
    let snapshot = snapshot_of(&state, &id, &info)?;
    let watcher = spawn_watch(app, id.clone(), info.root.clone(), info.git_dir.clone())?;
    state.sessions.lock().insert(id.clone(), info);
    state.watchers.lock().insert(id, watcher);
    Ok(snapshot)
}

#[tauri::command]
pub fn refresh_repository(
    session_id: String,
    state: tauri::State<Arc<AppState>>,
) -> Result<RepositorySnapshot, AppError> {
    let previous = session(&state, &session_id)?;
    let refreshed = open_repo(&previous.root)?;
    bump(&state, &session_id);
    let snapshot = snapshot_of(&state, &session_id, &refreshed)?;
    state.sessions.lock().insert(session_id, refreshed);
    Ok(snapshot)
}

#[tauri::command]
pub fn list_recent_repositories() -> Vec<RecentRepository> {
    load_settings().recent
}

fn session(state: &AppState, id: &str) -> Result<RepoInfo, AppError> {
    state
        .sessions
        .lock()
        .get(id)
        .cloned()
        .ok_or_else(|| AppError::Other("session expired".into()))
}

fn load_payload(
    info: &RepoInfo,
    session_id: &str,
    path: &str,
    request_sequence: u64,
) -> Result<DocumentPayload, AppError> {
    let abs = resolve_inside(&info.root, path)?;
    let original = match blob_oid_for(info, path)? {
        Some(oid) => {
            let bytes = read_blob(info, &oid)?;
            match decode(&bytes) {
                Ok((text, _, _)) => text,
                Err(_) => String::new(),
            }
        }
        None => String::new(),
    };
    let (current_text, metadata, load_state, editable, reason) = if abs.exists() {
        let bytes = fs::read(&abs).map_err(|error| AppError::Other(error.to_string()))?;
        match decode(&bytes) {
            Ok((text, metadata, read_only)) => {
                let load_state = if read_only { "unsupported" } else { "ready" };
                let editable = !read_only && metadata.eol != "mixed";
                let reason = if read_only {
                    Some("혼합 줄바꿈 파일은 읽기 전용입니다.".into())
                } else {
                    None
                };
                (text, Some(metadata), load_state.to_string(), editable, reason)
            }
            Err(AppError::BinaryFile) => (
                String::new(),
                None,
                "unsupported".into(),
                false,
                Some("바이너리 파일은 미리보기를 지원하지 않습니다.".into()),
            ),
            Err(error) => (
                String::new(),
                None,
                "error".into(),
                false,
                Some(error.to_string()),
            ),
        }
    } else {
        (String::new(), None, "deleted".into(), false, None)
    };
    Ok(DocumentPayload {
        document_id: Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        path: path.to_string(),
        request_sequence,
        head_oid: info.head_oid.clone(),
        original_text: original,
        current_text,
        disk_version: disk_version(&abs),
        metadata,
        load_state,
        editable,
        reason,
    })
}

#[tauri::command]
pub fn read_document(
    session_id: String,
    path: String,
    request_sequence: u64,
    state: tauri::State<Arc<AppState>>,
) -> Result<DocumentPayload, AppError> {
    let info = session(&state, &session_id)?;
    load_payload(&info, &session_id, &path, request_sequence)
}

#[tauri::command]
pub fn save_document(
    req: SaveDocumentRequest,
    state: tauri::State<Arc<AppState>>,
) -> Result<SaveDocumentResult, AppError> {
    let info = session(&state, &req.session_id)?;
    let abs = resolve_inside(&info.root, &req.path)?;
    match save_if_unchanged(&abs, &req.expected_disk_version, &req.text, &req.metadata)? {
        Ok(_version) => {
            bump(&state, &req.session_id);
            let snapshot = snapshot_of(&state, &req.session_id, &info)?;
            Ok(SaveDocumentResult::Saved {
                disk_version: disk_version(&abs),
                snapshot,
            })
        }
        Err(_) => {
            let payload = load_payload(&info, &req.session_id, &req.path, 0)?;
            bump(&state, &req.session_id);
            let snapshot = snapshot_of(&state, &req.session_id, &info)?;
            Ok(SaveDocumentResult::RefreshedExternal { payload, snapshot })
        }
    }
}

#[tauri::command]
pub fn stop_watch(
    session_id: String,
    state: tauri::State<Arc<AppState>>,
) -> Result<(), AppError> {
    state.watchers.lock().remove(&session_id);
    state.sessions.lock().remove(&session_id);
    state.generation.lock().remove(&session_id);
    Ok(())
}


#[tauri::command]
pub fn quit_application(
    app: tauri::AppHandle,
    state: tauri::State<Arc<AppState>>,
) {
    state.watchers.lock().clear();
    state.sessions.lock().clear();
    state.generation.lock().clear();
    app.exit(0);
}
