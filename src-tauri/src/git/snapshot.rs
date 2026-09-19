use crate::contracts::FileEntry;
use crate::errors::AppError;
use crate::git::repository::RepoInfo;
use crate::git::runner::{git_bytes, split_nul};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub struct DiffRecord {
    pub status: String,
    pub path: String,
    pub previous_path: Option<String>,
}

pub fn parse_name_status(bytes: &[u8]) -> Vec<DiffRecord> {
    let parts = split_nul(bytes);
    let mut out = Vec::new();
    let mut i = 0;
    while i < parts.len() {
        let status = parts[i].clone();
        i += 1;
        if status.starts_with('R') || status.starts_with('C') {
            if i + 1 >= parts.len() {
                break;
            }
            let old = parts[i].clone();
            let new = parts[i + 1].clone();
            i += 2;
            if status.starts_with('R') {
                out.push(DiffRecord { status: "R".into(), path: new, previous_path: Some(old) });
            } else {
                out.push(DiffRecord { status: "A".into(), path: new, previous_path: None });
            }
        } else if i < parts.len() {
            let path = parts[i].clone();
            i += 1;
            let st = status.chars().next().unwrap_or('M').to_string();
            out.push(DiffRecord { status: st, path, previous_path: None });
        }
    }
    out
}

pub fn parse_ls_tree_paths(bytes: &[u8]) -> BTreeSet<String> {
    let mut paths = BTreeSet::new();
    for rec in split_nul(bytes) {
        if let Some((_, path)) = rec.split_once('\t') {
            paths.insert(path.to_string());
        }
    }
    paths
}

pub fn blob_oid_for(info: &RepoInfo, rel: &str) -> Result<Option<String>, AppError> {
    let Some(oid) = &info.head_oid else { return Ok(None) };
    let bytes = git_bytes(Some(&info.root), &["ls-tree", "-z", "--full-tree", oid, "--", rel])?;
    let rec = split_nul(&bytes);
    if rec.is_empty() {
        return Ok(None);
    }
    let line = &rec[0];
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() >= 3 {
        let oid = cols[2].split('\t').next().unwrap_or(cols[2]);
        return Ok(Some(oid.to_string()));
    }
    Ok(None)
}

pub fn read_blob(info: &RepoInfo, blob_oid: &str) -> Result<Vec<u8>, AppError> {
    git_bytes(Some(&info.root), &["cat-file", "blob", blob_oid])
}

pub fn snapshot_files(info: &RepoInfo) -> Result<Vec<FileEntry>, AppError> {
    let Some(head) = &info.head_oid else { return Ok(vec![]) };
    let tree = git_bytes(Some(&info.root), &["ls-tree", "-r", "-z", "--full-tree", head])?;
    let listed = git_bytes(
        Some(&info.root),
        &["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    )?;
    let diff = git_bytes(
        Some(&info.root),
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--name-status",
            "-z",
            "--find-renames",
            head,
            "--",
        ],
    )?;
    let head_paths = parse_ls_tree_paths(&tree);
    let mut cached = BTreeSet::new();
    let mut untracked = BTreeSet::new();
    let listed_paths = split_nul(&listed);
    let cached_bytes = git_bytes(Some(&info.root), &["ls-files", "-z", "--cached"])?;
    for p in split_nul(&cached_bytes) {
        cached.insert(p);
    }
    let untracked_set: BTreeSet<String> = listed_paths.into_iter().filter(|p| !cached.contains(p)).collect();
    for p in untracked_set {
        untracked.insert(p);
    }
    let records = parse_name_status(&diff);
    let mut by_path: BTreeMap<String, FileEntry> = BTreeMap::new();

    let mut all: BTreeSet<String> = BTreeSet::new();
    all.extend(head_paths.iter().cloned());
    all.extend(cached.iter().cloned());
    all.extend(untracked.iter().cloned());
    for r in &records {
        all.insert(r.path.clone());
        if let Some(old) = &r.previous_path {
            all.insert(old.clone());
        }
    }

    for path in all {
        let on_disk = info.root.join(&path).exists();
        by_path.insert(
            path.clone(),
            FileEntry {
                path: path.clone(),
                previous_path: None,
                status: "clean".into(),
                tracked: cached.contains(&path) || head_paths.contains(&path),
                exists_on_disk: on_disk,
                editable: on_disk,
                kind: "file".into(),
            },
        );
    }

    for r in records {
        if r.status == "R" {
            if let Some(old) = &r.previous_path {
                by_path.remove(old);
            }
            if let Some(entry) = by_path.get_mut(&r.path) {
                entry.status = "R".into();
                entry.previous_path = r.previous_path.clone();
                entry.tracked = true;
                entry.editable = entry.exists_on_disk;
            }
            continue;
        }
        if let Some(entry) = by_path.get_mut(&r.path) {
            let st = match r.status.as_str() {
                "A" => "A",
                "D" => "D",
                "U" => "conflict",
                other => other,
            };
            entry.status = st.to_string();
            entry.tracked = true;
            if st == "D" {
                entry.exists_on_disk = false;
                entry.editable = false;
            }
            if st == "conflict" {
                entry.editable = false;
            }
        }
    }

    for p in untracked {
        if let Some(entry) = by_path.get_mut(&p) {
            if entry.status == "clean" {
                entry.status = "U".into();
                entry.tracked = false;
                entry.editable = entry.exists_on_disk;
            }
        }
    }

    for (path, entry) in by_path.iter_mut() {
        if !entry.exists_on_disk && head_paths.contains(path) && entry.status == "clean" {
            entry.status = "D".into();
            entry.editable = false;
        }
        if entry.status == "D" {
            entry.editable = false;
        }
    }

    let mut files: Vec<FileEntry> = by_path.into_values().filter(|e| e.kind == "file").collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn git(dir: &std::path::Path, args: &[&str]) {
        let st = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_TERMINAL_PROMPT", "0")
            .status()
            .unwrap();
        assert!(st.success(), "{args:?}");
    }

    #[test]
    fn parse_rename_record() {
        let mut raw = Vec::new();
        raw.extend(b"R100\0old.txt\0new.txt\0");
        let rec = parse_name_status(&raw);
        assert_eq!(rec[0].status, "R");
        assert_eq!(rec[0].path, "new.txt");
        assert_eq!(rec[0].previous_path.as_deref(), Some("old.txt"));
    }

    #[test]
    fn snapshot_modified_file() {
        let dir = tempfile::tempdir().unwrap();
        git(dir.path(), &["init"]);
        git(dir.path(), &["config", "user.email", "t@t.test"]);
        git(dir.path(), &["config", "user.name", "t"]);
        fs::write(dir.path().join("a.txt"), "one\n").unwrap();
        git(dir.path(), &["add", "a.txt"]);
        git(dir.path(), &["commit", "-m", "init"]);
        fs::write(dir.path().join("a.txt"), "two\n").unwrap();
        let info = crate::git::repository::open_repo(dir.path()).unwrap();
        let files = snapshot_files(&info).unwrap();
        let a = files.iter().find(|f| f.path.replace('\\', "/") == "a.txt").unwrap();
        assert_eq!(a.status, "M");
    }
}
