use git_diff_editor_lib::files::codec::{decode, encode};
use git_diff_editor_lib::files::save::save_if_unchanged;
use git_diff_editor_lib::files::versions::disk_version;
use git_diff_editor_lib::files::resolve_inside;
use git_diff_editor_lib::git::repository::open_repo;
use git_diff_editor_lib::git::snapshot::{blob_oid_for, read_blob, snapshot_files};
use git_diff_editor_lib::errors::AppError;
use std::fs;
use std::process::Command;

fn git(dir: &std::path::Path, args: &[&str]) {
    let st = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_AUTHOR_NAME", "e2e")
        .env("GIT_AUTHOR_EMAIL", "e2e@test")
        .env("GIT_COMMITTER_NAME", "e2e")
        .env("GIT_COMMITTER_EMAIL", "e2e@test")
        .status()
        .unwrap();
    assert!(st.success(), "git {args:?}");
}

fn init_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init"]);
    git(dir.path(), &["config", "user.email", "e2e@test"]);
    git(dir.path(), &["config", "user.name", "e2e"]);
    git(dir.path(), &["config", "core.autocrlf", "false"]);
    dir
}

#[test]
fn e2e_open_modified_read_save_and_external_refresh() {
    let dir = init_repo();
    fs::write(dir.path().join("app.rs"), "fn main() {}\n").unwrap();
    git(dir.path(), &["add", "app.rs"]);
    git(dir.path(), &["commit", "-m", "init"]);
    fs::write(dir.path().join("app.rs"), "fn main() { let x = 1; }\n").unwrap();

    let info = open_repo(dir.path()).unwrap();
    assert!(info.head_oid.is_some());
    let files = snapshot_files(&info).unwrap();
    let app = files.iter().find(|f| f.path.replace('\\', "/") == "app.rs").unwrap();
    assert_eq!(app.status, "M");

    let oid = blob_oid_for(&info, "app.rs").unwrap().unwrap();
    let original = String::from_utf8(read_blob(&info, &oid).unwrap()).unwrap();
    assert_eq!(original, "fn main() {}\n");
    let current = fs::read_to_string(dir.path().join("app.rs")).unwrap();
    assert_eq!(current, "fn main() { let x = 1; }\n");

    let abs = resolve_inside(&info.root, "app.rs").unwrap();
    let raw = fs::read(&abs).unwrap();
    let (text, meta, ro) = decode(&raw).unwrap();
    assert!(!ro);
    let expected = disk_version(&abs);
    let edited = text.replace("1", "2");
    let saved = save_if_unchanged(&abs, &expected, &edited, &meta).unwrap();
    assert!(saved.is_ok());
    let after = fs::read_to_string(&abs).unwrap();
    assert!(after.contains("2"));

    let expected2 = disk_version(&abs);
    fs::write(&abs, "externally changed\n").unwrap();
    let conflict = save_if_unchanged(&abs, &expected2, "stale buffer\n", &meta).unwrap();
    assert!(conflict.is_err(), "external change must win over stale save");
    let disk = fs::read_to_string(&abs).unwrap();
    assert_eq!(disk, "externally changed\n");
}

#[test]
fn e2e_untracked_and_deleted() {
    let dir = init_repo();
    fs::write(dir.path().join("keep.txt"), "keep\n").unwrap();
    fs::write(dir.path().join("gone.txt"), "gone\n").unwrap();
    git(dir.path(), &["add", "."]);
    git(dir.path(), &["commit", "-m", "base"]);
    fs::remove_file(dir.path().join("gone.txt")).unwrap();
    fs::write(dir.path().join("new.txt"), "new\n").unwrap();

    let info = open_repo(dir.path()).unwrap();
    let files = snapshot_files(&info).unwrap();
    let gone = files.iter().find(|f| f.path.replace('\\', "/") == "gone.txt").unwrap();
    assert_eq!(gone.status, "D");
    assert!(!gone.editable);
    let newf = files.iter().find(|f| f.path.replace('\\', "/") == "new.txt").unwrap();
    assert_eq!(newf.status, "U");
}

#[test]
fn e2e_path_escape_rejected() {
    let dir = init_repo();
    fs::write(dir.path().join("ok.txt"), "ok\n").unwrap();
    git(dir.path(), &["add", "."]);
    git(dir.path(), &["commit", "-m", "ok"]);
    let info = open_repo(dir.path()).unwrap();
    let err = resolve_inside(&info.root, "../secret").unwrap_err();
    assert!(matches!(err, AppError::PathEscape));
}

#[test]
fn e2e_mixed_eol_not_saved() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("mix.txt");
    fs::write(&p, b"a\r\nb\nc").unwrap();
    let raw = fs::read(&p).unwrap();
    let (text, meta, ro) = decode(&raw).unwrap();
    assert!(ro);
    assert_eq!(meta.eol, "mixed");
    assert!(encode(&text, &meta).is_err());
}
