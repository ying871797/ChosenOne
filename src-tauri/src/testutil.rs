//! 测试公用工具（仅在 `cargo test` 下编译）。
//!
//! 汇总各模块散落的临时文件 helper：统一在系统临时目录创建
//! 带唯一后缀的文件/路径，避免固定文件名导致测试并发污染与 cwd 写入。

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// 生成带唯一后缀的临时路径（不创建文件）。
fn unique_path(prefix: &str, ext: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    std::env::temp_dir().join(format!(
        "chosenone-{}-{}-{}.{}",
        prefix,
        std::process::id(),
        n,
        ext
    ))
}

/// 创建内容为 `content` 的唯一临时文本文件，返回路径。
pub fn tempfile_with(prefix: &str, content: &str) -> PathBuf {
    temp_write(prefix, content.as_bytes())
}

/// 创建内容为 `bytes` 的唯一临时文件，返回路径。
pub fn temp_write(prefix: &str, bytes: &[u8]) -> PathBuf {
    let p = unique_path(prefix, "bin");
    std::fs::write(&p, bytes).unwrap();
    p
}

/// 返回一个尚未创建的唯一临时路径（用于存在性、缺失文件等场景）。
pub fn temp_path(prefix: &str) -> PathBuf {
    unique_path(prefix, "tmp")
}

/// 创建并返回一个唯一的临时目录。
pub fn temp_dir(prefix: &str) -> PathBuf {
    let p = unique_path(prefix, "dir");
    std::fs::create_dir(&p).unwrap();
    p
}
