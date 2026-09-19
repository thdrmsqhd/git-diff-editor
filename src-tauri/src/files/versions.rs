use crate::contracts::DiskVersion;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::time::SystemTime;

pub fn hash_bytes(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

pub fn disk_version(path: &Path) -> DiskVersion {
    match fs::read(path) {
        Ok(bytes) => {
            let mtime = fs::metadata(path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());
            DiskVersion {
                exists: true,
                raw_bytes_hash: hash_bytes(&bytes),
                byte_length: bytes.len() as u64,
                modified_time_hint: mtime,
            }
        }
        Err(_) => DiskVersion {
            exists: false,
            raw_bytes_hash: String::new(),
            byte_length: 0,
            modified_time_hint: None,
        },
    }
}

pub fn versions_equal(a: &DiskVersion, b: &DiskVersion) -> bool {
    a.exists == b.exists && a.raw_bytes_hash == b.raw_bytes_hash && a.byte_length == b.byte_length
}
