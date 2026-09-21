use git_diff_editor_lib::git::repository::open_repo;
use git_diff_editor_lib::git::snapshot::snapshot_files;
use std::path::PathBuf;

fn repository_root() -> PathBuf {
    if let Ok(workspace) = std::env::var("GITHUB_WORKSPACE") {
        let path = PathBuf::from(workspace);
        if path.is_dir() {
            return path;
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must have a repository parent")
        .to_path_buf()
}

#[test]
fn e2e_open_self_project_folder() {
    let root = repository_root();

    let info = open_repo(&root).expect("self folder must be a git repo");
    assert!(info.head_oid.is_some());

    let files = snapshot_files(&info).unwrap();
    assert!(
        files.iter().any(|f| f.path.replace('\\', "/").ends_with("REQUIREMENTS.md")),
        "expected REQUIREMENTS.md in snapshot, got {:?}",
        files.iter().map(|f| &f.path).collect::<Vec<_>>()
    );
}
