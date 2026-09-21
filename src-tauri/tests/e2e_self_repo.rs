use git_diff_editor_lib::git::repository::open_repo;
use git_diff_editor_lib::git::snapshot::snapshot_files;
use std::path::PathBuf;

#[test]
fn e2e_open_self_project_folder() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must have a repository parent")
        .to_path_buf();

    let info = open_repo(&root).expect("self folder must be a git repo");
    assert!(info.head_oid.is_some());

    let files = snapshot_files(&info).unwrap();
    assert!(
        files.iter().any(|f| f.path.replace('\\', "/").ends_with("REQUIREMENTS.md")),
        "expected REQUIREMENTS.md in snapshot, got {:?}",
        files.iter().map(|f| &f.path).collect::<Vec<_>>()
    );
}
