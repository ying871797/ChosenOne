use std::io;
use std::path::Path;

use crate::names::parse_names_file;

/// 读取并解析排除名单。与应用中 `names.txt` 相同的解析规则。
///
/// `excluded.txt` 缺失时视为"无排除"（返回空集合），其他读取错误上抛。
pub fn parse_exclude_file(path: &Path) -> io::Result<Vec<String>> {
    match parse_names_file(path) {
        Ok(names) => Ok(names),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{temp_dir, tempfile_with};

    #[test]
    fn parses_exclude_list() {
        let p = tempfile_with("excl", "张三\n李四\n");
        assert_eq!(parse_exclude_file(&p).unwrap(), vec!["张三", "李四"]);
    }

    #[test]
    fn missing_file_means_no_exclusion() {
        let p = std::path::PathBuf::from("C:/definitely/not/exist/excluded.txt");
        assert!(parse_exclude_file(&p).unwrap().is_empty());
    }

    #[test]
    fn read_errors_are_propagated() {
        let dir = temp_dir("exclude-read-error");
        let path = dir.join("excluded.txt");
        std::fs::create_dir(&path).unwrap();

        assert!(parse_exclude_file(&path).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn dedupes_and_ignores_comments() {
        let p = tempfile_with("excl", "# 请假\n张三\n李四\n张三\n");
        assert_eq!(parse_exclude_file(&p).unwrap(), vec!["张三", "李四"]);
    }
}
