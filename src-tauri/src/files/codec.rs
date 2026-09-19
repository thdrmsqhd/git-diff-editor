use crate::contracts::TextMetadata;
use crate::errors::AppError;

pub fn decode(bytes: &[u8]) -> Result<(String, TextMetadata, bool), AppError> {
    if bytes.contains(&0) {
        return Err(AppError::BinaryFile);
    }
    let (bom, rest) = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        (true, &bytes[3..])
    } else {
        (false, bytes)
    };
    let text = std::str::from_utf8(rest).map_err(|_| AppError::UnsupportedEncoding)?;
    let has_crlf = text.contains("\r\n");
    let has_lf_only = text.replace("\r\n", "").contains('\n');
    let has_cr_naked = {
        let stripped = text.replace("\r\n", "");
        stripped.contains('\r')
    };
    let eol = if text.is_empty() {
        "none"
    } else if has_crlf && !has_lf_only && !has_cr_naked {
        "crlf"
    } else if !has_crlf && text.contains('\n') && !has_cr_naked {
        "lf"
    } else if !has_crlf && !text.contains('\n') && !has_cr_naked {
        "none"
    } else {
        "mixed"
    };
    let trailing = text.ends_with('\n') || text.ends_with("\r\n");
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let meta = TextMetadata {
        encoding: "utf-8".into(),
        bom,
        eol: eol.into(),
        trailing_newline: trailing,
    };
    let readonly = eol == "mixed";
    Ok((normalized, meta, readonly))
}

pub fn encode(text: &str, meta: &TextMetadata) -> Result<Vec<u8>, AppError> {
    if meta.eol == "mixed" {
        return Err(AppError::MixedEol);
    }
    let body = if meta.eol == "crlf" {
        text.replace('\n', "\r\n")
    } else {
        text.to_string()
    };
    if meta.eol != "none" {
        // preserve user's trailing newline as present in `text`
        let _ = body.len();
    }
    let mut out = Vec::new();
    if meta.bom {
        out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    out.extend_from_slice(body.as_bytes());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_roundtrip_crlf_bom() {
        let src = b"\xEF\xBB\xBFhello\r\n";
        let (text, meta, ro) = decode(src).unwrap();
        assert_eq!(text, "hello\n");
        assert!(meta.bom);
        assert_eq!(meta.eol, "crlf");
        assert!(!ro);
        let out = encode(&text, &meta).unwrap();
        assert_eq!(out, src);
    }

    #[test]
    fn mixed_is_readonly() {
        let src = b"a\r\nb\nc";
        let (_, meta, ro) = decode(src).unwrap();
        assert_eq!(meta.eol, "mixed");
        assert!(ro);
    }

    #[test]
    fn nul_is_binary() {
        assert!(matches!(decode(b"a\0b"), Err(AppError::BinaryFile)));
    }
}
