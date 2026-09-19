use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiskVersion {
    pub exists: bool,
    pub raw_bytes_hash: String,
    pub byte_length: u64,
    pub modified_time_hint: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextMetadata {
    pub encoding: String,
    pub bom: bool,
    pub eol: String,
    pub trailing_newline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: String,
    pub tracked: bool,
    pub exists_on_disk: bool,
    pub editable: bool,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySnapshot {
    pub session_id: String,
    pub root: String,
    pub git_dir: String,
    pub common_dir: String,
    pub head_oid: Option<String>,
    pub branch: Option<String>,
    pub detached_head: bool,
    pub generation: u64,
    pub files: Vec<FileEntry>,
    pub git_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    pub document_id: String,
    pub session_id: String,
    pub path: String,
    pub request_sequence: u64,
    pub head_oid: Option<String>,
    pub original_text: String,
    pub current_text: String,
    pub disk_version: DiskVersion,
    pub metadata: Option<TextMetadata>,
    pub load_state: String,
    pub editable: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentRequest {
    pub session_id: String,
    pub path: String,
    pub document_id: String,
    pub buffer_revision: u64,
    pub text: String,
    pub expected_disk_version: DiskVersion,
    pub metadata: TextMetadata,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveDocumentResult {
    #[serde(rename_all = "camelCase")]
    Saved { disk_version: DiskVersion, snapshot: RepositorySnapshot },
    #[serde(rename_all = "camelCase")]
    RefreshedExternal { payload: DocumentPayload, snapshot: RepositorySnapshot },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentRepository {
    pub path: String,
    pub opened_at: String,
}
