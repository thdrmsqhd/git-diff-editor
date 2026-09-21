pub mod commands;
pub mod contracts;
pub mod errors;
pub mod files;
pub mod git;
pub mod settings;
pub mod watch;
pub mod events;

use commands::AppState;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            commands::open_repository,
            commands::refresh_repository,
            commands::list_recent_repositories,
            commands::read_document,
            commands::save_document,
            commands::stop_watch,
            commands::quit_application
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod git_parse_tests {
    use crate::git::snapshot::parse_name_status;

    #[test]
    fn parse_rename_and_modify() {
        let mut raw = Vec::new();
        raw.extend(b"M");
        raw.push(0);
        raw.extend(b"src/a.rs");
        raw.push(0);
        raw.extend(b"R100");
        raw.push(0);
        raw.extend(b"old.txt");
        raw.push(0);
        raw.extend(b"new.txt");
        raw.push(0);
        let rec = parse_name_status(&raw);
        assert_eq!(rec[0].status, "M");
        assert_eq!(rec[0].path, "src/a.rs");
        assert_eq!(rec[1].status, "R");
        assert_eq!(rec[1].previous_path.as_deref(), Some("old.txt"));
        assert_eq!(rec[1].path, "new.txt");
    }
}
