use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub struct WatchState {
    pub root: PathBuf,
    pub git_dir: PathBuf,
    pub last_self_hash: Mutex<Option<(String, String)>>, // path, hash
}

pub fn spawn_watch(app: AppHandle, session_id: String, root: PathBuf, git_dir: PathBuf) -> RecommendedWatcher {
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default()).expect("watch");
    let _ = watcher.watch(&root, RecursiveMode::Recursive);
    let _ = watcher.watch(&git_dir, RecursiveMode::Recursive);
    std::thread::spawn(move || {
        let mut last = Instant::now() - Duration::from_secs(1);
        while let Ok(_ev) = rx.recv() {
            let now = Instant::now();
            if now.duration_since(last) < Duration::from_millis(120) {
                continue;
            }
            last = now;
            let payload = serde_json::json!({
                "sessionId": session_id,
                "generation": now.elapsed().as_millis() as u64,
                "paths": [],
                "reason": "external"
            });
            let _ = app.emit("repository-changed", payload);
        }
    });
    watcher
}

pub fn remember_self_save(state: &Arc<Mutex<Option<(String, String)>>>, path: String, hash: String) {
    *state.lock() = Some((path, hash));
}
