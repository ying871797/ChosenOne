use encoding_rs::{GBK, UTF_8};
use std::fs;
use std::io::{self, Write};
use std::path::Path;

/// 从文件读取并解析名字集合。
///
/// 解析规则：
/// - 每行一个名字，去除首尾空白
/// - 空行与以 `#` 开头的行忽略
/// - 重复名字自动去重（保持首次出现顺序）
/// - 编码容错：优先 UTF-8，失败时回退 GBK（Windows 中文环境常用）
pub fn parse_names_file(path: &Path) -> Vec<String> {
    let raw = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return Vec::new(),
    };
    let text = decode_bytes(&raw).replace('\r', "");
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .fold(Vec::new(), |mut acc, name| {
            if !acc.contains(&name.to_string()) {
                acc.push(name.to_string());
            }
            acc
        })
}

fn decode_bytes(bytes: &[u8]) -> String {
    // 剥离 UTF-8 BOM（记事本"UTF-8 保存"默认带 BOM，否则首名字会带 \ufeff）
    let bytes = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    };
    let (text, _, had_errors) = UTF_8.decode(bytes);
    if !had_errors {
        return text.into_owned();
    }
    let (text, _, _) = GBK.decode(bytes);
    text.into_owned()
}

/// 名单文件缺失时，在指定路径生成包含示例名字的文件。
pub fn ensure_names_file(path: &Path) -> io::Result<()> {
    if path.exists() {
        return Ok(());
    }
    let sample = [
        "张三", "李四", "王五", "赵六", "钱七", "孙八", "周九", "吴十", "郑十一", "冯十二",
        "陈十三", "褚十四", "卫十五", "蒋十六", "沈十七", "韩十八", "杨十九", "朱二十",
    ]
    .join("\n");
    let mut f = fs::File::create(path)?;
    f.write_all((sample + "\n").as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// 在系统临时目录创建内容为 content 的临时文件，返回路径。
    fn tempfile_with(content: &str) -> std::path::PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let p = std::env::temp_dir().join(format!("chosenone-test-{}-{}.txt", std::process::id(), n));
        std::fs::write(&p, content).unwrap();
        p
    }

    #[test]
    fn parses_basic_names() {
        let p = tempfile_with("张三\n李四\n王五\n");
        assert_eq!(parse_names_file(&p), vec!["张三", "李四", "王五"]);
    }

    #[test]
    fn ignores_blank_lines_and_comments() {
        let p = tempfile_with("张三\n\n# 注释\n李四\n   \n# 第二个注释\n");
        assert_eq!(parse_names_file(&p), vec!["张三", "李四"]);
    }

    #[test]
    fn trims_whitespace() {
        let p = tempfile_with("  张三  \n\t李四\n");
        assert_eq!(parse_names_file(&p), vec!["张三", "李四"]);
    }

    #[test]
    fn dedupes_preserving_first_order() {
        let p = tempfile_with("张三\n李四\n张三\n王五\n李四\n");
        assert_eq!(parse_names_file(&p), vec!["张三", "李四", "王五"]);
    }

    #[test]
    fn returns_empty_on_missing_file() {
        let p = std::path::PathBuf::from("C:/definitely/not/exist/names.txt");
        assert!(parse_names_file(&p).is_empty());
    }

    #[test]
    fn decodes_gbk_content() {
        // "张三" 的 GBK 编码字节
        let gbk_bytes = [0xD5, 0xC5, 0xC8, 0xFD, b'\n'];
        let p = std::path::PathBuf::from("gbk.tmp");
        std::fs::write(&p, gbk_bytes).unwrap();
        assert_eq!(parse_names_file(&p), vec!["张三"]);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn strips_utf8_bom() {
        // 记事本保存的 UTF-8 带 BOM：EF BB BF 张三
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("张三\n李四\n".as_bytes());
        let p = std::path::PathBuf::from("bom.tmp");
        std::fs::write(&p, bytes).unwrap();
        assert_eq!(parse_names_file(&p), vec!["张三", "李四"]);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn ensure_creates_when_missing_and_skips_when_exists() {
        let p = tempfile_with("已有");
        ensure_names_file(&p).unwrap();
        // 已存在时不覆盖
        assert_eq!(parse_names_file(&p), vec!["已有"]);

        let missing = std::path::PathBuf::from("ensure-missing.tmp");
        std::fs::remove_file(&missing).ok();
        ensure_names_file(&missing).unwrap();
        assert!(!parse_names_file(&missing).is_empty());
        std::fs::remove_file(&missing).ok();
    }
}