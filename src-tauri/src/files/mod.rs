pub mod codec;
pub mod save;
pub mod versions;

use crate::errors::AppError;
use std::fs;
use std::path::{Path, PathBuf};

pub fn resolve_inside(root: &Path, rel: &str) -> Result<PathBuf, AppError> {
    if rel.is_empty() || rel.contains('\0') || Path::new(rel).is_absolute() {
        return Err(AppError::PathEscape);
    }
    let joined = root.join(rel);
    let root_c = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    if let Ok(canon) = fs::canonicalize(&joined) {
        if !canon.starts_with(&root_c) {
            return Err(AppError::PathEscape);
        }
        let meta = fs::symlink_metadata(&joined).ok();
        if let Some(m) = meta {
            if m.file_type().is_symlink() && !canon.starts_with(&root_c) {
                return Err(AppError::SymlinkExternal);
            }
        }
        return Ok(canon);
    }
    let parent = joined.parent().unwrap_or(root);
    let parent_c = fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    if !parent_c.starts_with(&root_c) {
        return Err(AppError::PathEscape);
    }
    Ok(joined)
}
