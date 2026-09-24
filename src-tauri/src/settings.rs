use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// 持久化的应用设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// 主题：`dark` / `light`
    pub theme: String,
    /// 背景图片文件名；空串表示使用默认纯色背景
    pub background: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "dark".to_string(),
            background: String::new(),
        }
    }
}

/// 读取设置；文件缺失或损坏时返回默认设置。
pub fn load_settings(path: &Path) -> Settings {
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| Settings::default()),
        Err(_) => Settings::default(),
    }
}

/// 保存设置；失败时静默返回（下一轮修改会重试）。
pub fn save_settings(path: &Path, settings: &Settings) {
    let _ = fs::write(path, serde_json::to_string_pretty(settings).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_path() -> std::path::PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("chosenone-settings-{}-{}.json", std::process::id(), n))
    }

    #[test]
    fn missing_file_returns_default() {
        let p = temp_path();
        let s = load_settings(&p);
        assert_eq!(s.theme, "dark");
        assert_eq!(s.background, "");
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn corrupted_file_returns_default() {
        let p = temp_path();
        fs::write(&p, "not json{{{").unwrap();
        let s = load_settings(&p);
        assert_eq!(s.theme, "dark");
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn roundtrip_saves_and_loads() {
        let p = temp_path();
        let s = Settings { theme: "light".into(), background: "bg.png".into() };
        save_settings(&p, &s);
        let loaded = load_settings(&p);
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.background, "bg.png");
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn legacy_camel_case_is_readable() {
        let p = temp_path();
        // 兼容历史格式
        fs::write(&p, r#"{"theme":"light","background":""}"#).unwrap();
        let loaded = load_settings(&p);
        assert_eq!(loaded.theme, "light");
        let _ = fs::remove_file(&p);
    }
}