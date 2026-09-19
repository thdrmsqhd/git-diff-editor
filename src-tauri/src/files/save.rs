use crate::contracts::{DiskVersion, TextMetadata};
use crate::errors::AppError;
use crate::files::codec::encode;
use crate::files::versions::{disk_version, hash_bytes, versions_equal};
use std::fs;
use std::path::Path;
use uuid::Uuid;

pub fn save_if_unchanged(
    path: &Path,
    expected: &DiskVersion,
    text: &str,
    meta: &TextMetadata,
) -> Result<Result<DiskVersion, DiskVersion>, AppError> {
    let current = disk_version(path);
    if !versions_equal(&current, expected) {
        return Ok(Err(current));
    }
    let bytes = encode(text, meta)?;
    let parent = path.parent().ok_or_else(|| AppError::SaveFailed("parent".into()))?;
    let tmp = parent.join(format!(".gde-tmp-{}", Uuid::new_v4()));
    fs::write(&tmp, &bytes).map_err(|e| AppError::SaveFailed(e.to_string()))?;
    let again = disk_version(path);
    if !versions_equal(&again, expected) {
        let _ = fs::remove_file(&tmp);
        return Ok(Err(again));
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        AppError::SaveFailed(e.to_string())
    })?;
    let written = fs::read(path).map_err(|e| AppError::SaveFailed(e.to_string()))?;
    if hash_bytes(&written) != hash_bytes(&bytes) {
        return Err(AppError::SaveFailed("readback mismatch".into()));
    }
    Ok(Ok(disk_version(path)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::codec::decode;
    use std::fs;

    #[test]
    fn save_preserves_crlf() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        fs::write(&p, b"hello\r\n").unwrap();
        let raw = fs::read(&p).unwrap();
        let (text, meta, _) = decode(&raw).unwrap();
        let expected = disk_version(&p);
        let res = save_if_unchanged(&p, &expected, &(text.clone() + "x\n"), &meta).unwrap();
        assert!(res.is_ok());
        let out = fs::read(&p).unwrap();
        assert!(out.ends_with(b"\r\n") || out.windows(2).any(|w| w == b"\r\n"));
    }
}
