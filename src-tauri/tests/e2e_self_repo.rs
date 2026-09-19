use git_diff_editor_lib::git::repository::open_repo;
use git_diff_editor_lib::git::snapshot::snapshot_files;
use std::path::Path;

#[test]
fn e2e_open_self_project_folder() {
    let root = Path::new(r"C:\Users\gbsong\git-diff-editor");
    let info = open_repo(root).expect("self folder must be a git repo");
    assert!(info.head_oid.is_some());
    let files = snapshot_files(&info).unwrap();
    assert!(
        files.iter().any(|f| f.path.replace('\\', "/").ends_with("REQUIREMENTS.md")),
        "expected REQUIREMENTS.md in snapshot, got {:?}",
        files.iter().map(|f| &f.path).collect::<Vec<_>>()
    );
}
