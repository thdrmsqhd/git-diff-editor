use crate::contracts::RecentRepository;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Default, Serialize, Deserialize)]
pub struct Settings {
    pub recent: Vec<RecentRepository>,
}

fn settings_path() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("git-diff-editor").join("settings.json")
}

pub fn load() -> Settings {
    let p = settings_path();
    fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(settings: &Settings) {
    let p = settings_path();
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(s) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(p, s);
    }
}

pub fn push_recent(path: &str) {
    let mut s = load();
    s.recent.retain(|r| r.path != path);
    s.recent.insert(
        0,
        RecentRepository { path: path.to_string(), opened_at: chrono_now() },
    );
    s.recent.truncate(15);
    save(&s);
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    secs.to_string()
}
