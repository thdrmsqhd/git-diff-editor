use crate::contracts::*;
use crate::errors::AppError;
use crate::files::codec::decode;
use crate::files::resolve_inside;
use crate::files::save::save_if_unchanged;
use crate::files::versions::disk_version;
use crate::git::repository::{open_repo, RepoInfo};
use crate::git::snapshot::{blob_oid_for, read_blob, snapshot_files};
use crate::settings::store::{load as load_settings, push_recent};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

pub struct AppState {
    pub sessions: Mutex<HashMap<String, RepoInfo>>,
    pub generation: Mutex<HashMap<String, u64>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            generation: Mutex::new(HashMap::new()),
        }
    }
}

fn bump(state: &AppState, id: &str) -> u64 {
    let mut g = state.generation.lock();
    let e = g.entry(id.to_string()).or_insert(0);
    *e += 1;
    *e
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
    state: tauri::State<Arc<AppState>>,
) -> Result<RepositorySnapshot, AppError> {
    let info = open_repo(&PathBuf::from(&path))?;
    let id = Uuid::new_v4().to_string();
    push_recent(&info.root.to_string_lossy());
    bump(&state, &id);
    let snap = snapshot_of(&state, &id, &info)?;
    state.sessions.lock().insert(id, info);
    Ok(snap)
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
                Ok((t, _, _)) => t,
                Err(_) => String::new(),
            }
        }
        None => String::new(),
    };
    let (current_text, metadata, load_state, editable, reason) = if abs.exists() {
        let bytes = fs::read(&abs).map_err(|e| AppError::Other(e.to_string()))?;
        match decode(&bytes) {
            Ok((t, meta, ro)) => {
                let ls = if ro { "unsupported" } else { "ready" };
                let ed = !ro && meta.eol != "mixed";
                let reason = if ro {
                    Some("혼합 줄바꿈 파일은 읽기 전용입니다.".into())
                } else {
                    None
                };
                (t, Some(meta), ls.to_string(), ed, reason)
            }
            Err(AppError::BinaryFile) => (
                String::new(),
                None,
                "unsupported".into(),
                false,
                Some("바이너리 파일은 미리보기를 지원하지 않습니다.".into()),
            ),
            Err(e) => (
                String::new(),
                None,
                "error".into(),
                false,
                Some(e.to_string()),
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
        Ok(_ver) => {
            bump(&state, &req.session_id);
            let snap = snapshot_of(&state, &req.session_id, &info)?;
            Ok(SaveDocumentResult::Saved {
                disk_version: disk_version(&abs),
                snapshot: snap,
            })
        }
        Err(_) => {
            let payload = load_payload(&info, &req.session_id, &req.path, 0)?;
            bump(&state, &req.session_id);
            let snap = snapshot_of(&state, &req.session_id, &info)?;
            Ok(SaveDocumentResult::RefreshedExternal { payload, snapshot: snap })
        }
    }
}

#[tauri::command]
pub fn stop_watch(_session_id: String) -> Result<(), AppError> {
    Ok(())
}
