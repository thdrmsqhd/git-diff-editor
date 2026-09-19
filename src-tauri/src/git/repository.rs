use crate::errors::AppError;
use crate::git::runner::git_text;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct RepoInfo {
    pub root: PathBuf,
    pub git_dir: PathBuf,
    pub common_dir: PathBuf,
    pub head_oid: Option<String>,
    pub branch: Option<String>,
    pub detached_head: bool,
    pub git_version: String,
}

pub fn git_version() -> Result<String, AppError> {
    git_text(None, &["--version"])
}

pub fn open_repo(path: &Path) -> Result<RepoInfo, AppError> {
    let version = git_version()?;
    let toplevel = match git_text(Some(path), &["rev-parse", "--show-toplevel"]) {
        Ok(v) => PathBuf::from(v),
        Err(AppError::GitFailed(msg)) if msg.to_lowercase().contains("not a git") => {
            return Err(AppError::NotARepository);
        }
        Err(e) => return Err(e),
    };
    let git_dir = PathBuf::from(git_text(Some(&toplevel), &["rev-parse", "--absolute-git-dir"])?);
    let common = git_text(Some(&toplevel), &["rev-parse", "--git-common-dir"])?;
    let common_dir = if Path::new(&common).is_absolute() {
        PathBuf::from(common)
    } else {
        toplevel.join(common)
    };
    let bare = git_text(Some(&toplevel), &["rev-parse", "--is-bare-repository"])?;
    if bare.trim() == "true" {
        return Err(AppError::BareRepository);
    }
    let head_oid = match git_text(Some(&toplevel), &["rev-parse", "--verify", "HEAD"]) {
        Ok(oid) => Some(oid),
        Err(_) => None,
    };
    if head_oid.is_none() {
        return Err(AppError::NoHead);
    }
    let branch = git_text(Some(&toplevel), &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok();
    let detached_head = branch.is_none();
    Ok(RepoInfo {
        root: toplevel,
        git_dir,
        common_dir,
        head_oid,
        branch,
        detached_head,
        git_version: version,
    })
}
