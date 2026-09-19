use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Git을 찾을 수 없습니다. Git을 설치한 뒤 다시 실행하세요.")]
    GitNotFound,
    #[error("선택한 폴더는 Git 저장소가 아닙니다. Git 저장소를 선택하세요.")]
    NotARepository,
    #[error("작업 트리가 없는 bare 저장소는 열 수 없습니다.")]
    BareRepository,
    #[error("커밋이 없어 비교할 수 없습니다.")]
    NoHead,
    #[error("Git 명령 실패: {0}")]
    GitFailed(String),
    #[error("Git 명령 시간이 초과되었습니다.")]
    GitTimeout,
    #[error("저장소 밖 경로는 열 수 없습니다.")]
    PathEscape,
    #[error("외부 링크는 읽기·쓰기가 차단됩니다.")]
    SymlinkExternal,
    #[error("파일 인코딩을 해석할 수 없습니다.")]
    UnsupportedEncoding,
    #[error("바이너리 파일은 미리보기를 지원하지 않습니다.")]
    BinaryFile,
    #[error("혼합 줄바꿈 파일은 읽기 전용입니다.")]
    MixedEol,
    #[error("파일을 저장하지 못했습니다. 권한과 잠금 상태를 확인하세요.")]
    SaveFailed(String),
    #[error("외부 변경을 읽지 못했습니다.")]
    RefreshFailed,
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::GitNotFound => "GIT_NOT_FOUND",
            AppError::NotARepository => "NOT_A_REPOSITORY",
            AppError::BareRepository => "BARE_REPOSITORY",
            AppError::NoHead => "NO_HEAD",
            AppError::GitFailed(_) => "GIT_FAILED",
            AppError::GitTimeout => "GIT_TIMEOUT",
            AppError::PathEscape => "PATH_ESCAPE",
            AppError::SymlinkExternal => "SYMLINK_EXTERNAL",
            AppError::UnsupportedEncoding => "UNSUPPORTED_ENCODING",
            AppError::BinaryFile => "BINARY_FILE",
            AppError::MixedEol => "MIXED_EOL",
            AppError::SaveFailed(_) => "SAVE_FAILED",
            AppError::RefreshFailed => "REFRESH_FAILED",
            AppError::Other(_) => "ERROR",
        }
    }
}

#[derive(Serialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}

impl From<AppError> for ErrorPayload {
    fn from(value: AppError) -> Self {
        ErrorPayload { code: value.code().to_string(), message: value.to_string() }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}
