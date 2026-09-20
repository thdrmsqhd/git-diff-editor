use crate::errors::AppError;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};

pub fn spawn_watch(
    app: AppHandle,
    session_id: String,
    root: PathBuf,
    git_dir: PathBuf,
) -> Result<RecommendedWatcher, AppError> {
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default())
        .map_err(|error| AppError::Other(format!("파일 감시를 시작하지 못했습니다: {error}")))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| AppError::Other(format!("저장소를 감시하지 못했습니다: {error}")))?;
    if !git_dir.starts_with(&root) {
        watcher
            .watch(&git_dir, RecursiveMode::Recursive)
            .map_err(|error| AppError::Other(format!("Git 상태를 감시하지 못했습니다: {error}")))?;
    }

    std::thread::spawn(move || {
        let mut last = Instant::now() - Duration::from_secs(1);
        while let Ok(result) = rx.recv() {
            let Ok(event) = result else { continue };
            let now = Instant::now();
            if now.duration_since(last) < Duration::from_millis(120) {
                continue;
            }
            last = now;
            let paths: Vec<String> = event
                .paths
                .iter()
                .map(|path| {
                    path.strip_prefix(&root)
                        .unwrap_or(path)
                        .to_string_lossy()
                        .replace('\\', "/")
                })
                .collect();
            let generation = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0);
            let payload = serde_json::json!({
                "sessionId": session_id,
                "generation": generation,
                "paths": paths,
                "reason": "external"
            });
            let _ = app.emit("repository-changed", payload);
        }
    });

    Ok(watcher)
}
