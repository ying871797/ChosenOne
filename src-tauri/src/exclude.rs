use std::path::Path;

use crate::names::parse_names_file;

/// 读取并解析排除名单。与应用中 `names.txt` 相同的解析规则。
///
/// `excluded.txt` 缺失或不可读时视为"无排除"（返回空集合），不自动生成文件。
pub fn parse_exclude_file(path: &Path) -> Vec<String> {
    parse_names_file(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn tempfile_with(content: &str) -> std::path::PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let p = std::env::temp_dir().join(format!("chosenone-excl-{}-{}.txt", std::process::id(), n));
        std::fs::write(&p, content).unwrap();
        p
    }

    #[test]
    fn parses_exclude_list() {
        let p = tempfile_with("张三\n李四\n");
        assert_eq!(parse_exclude_file(&p), vec!["张三", "李四"]);
    }

    #[test]
    fn missing_file_means_no_exclusion() {
        let p = std::path::PathBuf::from("C:/definitely/not/exist/excluded.txt");
        assert!(parse_exclude_file(&p).is_empty());
    }

    #[test]
    fn dedupes_and_ignores_comments() {
        let p = tempfile_with("# 请假\n张三\n李四\n张三\n");
        assert_eq!(parse_exclude_file(&p), vec!["张三", "李四"]);
    }
}