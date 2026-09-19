use crate::errors::AppError;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_cmd: &mut Command) {}

pub fn git_bytes(root: Option<&Path>, args: &[&str]) -> Result<Vec<u8>, AppError> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(root) = root {
        cmd.current_dir(root);
    }
    hide_window(&mut cmd);
    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::GitNotFound
        } else {
            AppError::GitFailed(e.to_string())
        }
    })?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::GitFailed(if err.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            err
        }));
    }
    let _ = Duration::from_secs(30);
    Ok(output.stdout)
}

pub fn git_text(root: Option<&Path>, args: &[&str]) -> Result<String, AppError> {
    let bytes = git_bytes(root, args)?;
    Ok(String::from_utf8_lossy(&bytes).trim_end_matches(['\r', '\n']).to_string())
}

pub fn split_nul(bytes: &[u8]) -> Vec<String> {
    bytes
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect()
}
