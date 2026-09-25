/// 极简 base64 编码（标准字母表），避免引入额外依赖。
/// 仅用于将小体积背景图片编码为 data URL 传给前端。
pub fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[(n >> 18 & 0x3F) as usize] as char);
        out.push(TABLE[(n >> 12 & 0x3F) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(n >> 6 & 0x3F) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 0x3F) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// 由文件路径返回 data URL（data:image/...;base64,...）。
/// 仅支持常见图片扩展名；文件为空或格式不支持返回 `Ok(None)`，读取失败上抛。
pub fn image_data_url(path: &std::path::Path) -> std::io::Result<Option<String>> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return Ok(None),
    };

    let bytes = std::fs::read(path)?;
    if bytes.is_empty() {
        return Ok(None);
    }
    Ok(Some(format!(
        "data:{};base64,{}",
        mime,
        base64_encode(&bytes)
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    #[test]
    fn base64_basic_vectors() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(&[0xFF, 0xEE, 0xDD]), "/+7d");
    }

    #[test]
    fn image_read_errors_are_propagated() {
        let dir = temp_dir("image-read-error");
        let path = dir.join("broken.png");
        std::fs::create_dir(&path).unwrap();

        assert!(image_data_url(&path).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
