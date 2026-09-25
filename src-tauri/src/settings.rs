use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// 持久化的应用设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// 配色主题：`dark` / `light`
    pub theme: String,
    /// 界面方案：`mist`（晨雾林窗） / `chalk`（绿板粉笔）；
    /// 缺省/未知值时归一化为 `mist`（兼容旧版 settings.json）
    #[serde(default)]
    pub scheme: String,
    /// 背景图片文件名；空串表示使用默认纯色背景
    pub background: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "dark".to_string(),
            scheme: "mist".to_string(),
            background: String::new(),
        }
    }
}

/// 读取设置；文件缺失或损坏时返回默认设置。
/// scheme 做白名单归一化：未知/缺省一律回落到 `mist`，避免旧配置文件破坏前端主题。
pub fn load_settings(path: &Path) -> Settings {
    let mut settings = match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| Settings::default()),
        Err(_) => Settings::default(),
    };
    if !matches!(settings.scheme.as_str(), "mist" | "chalk") {
        settings.scheme = "mist".to_string();
    }
    // theme 做同样白名单归一化：未知/缺省回落 `dark`，
    // 避免非法值导致前端 body[data-theme="xxx"] 匹配不到 CSS 变量。
    if !matches!(settings.theme.as_str(), "dark" | "light") {
        settings.theme = "dark".to_string();
    }
    settings
}

/// 保存设置；失败时静默返回（下一轮修改会重试）。
pub fn save_settings(path: &Path, settings: &Settings) {
    let _ = fs::write(path, serde_json::to_string_pretty(settings).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{temp_path, temp_write};

    #[test]
    fn missing_file_returns_default() {
        let p = temp_path("settings");
        let _ = std::fs::remove_file(&p);
        let s = load_settings(&p);
        assert_eq!(s.theme, "dark");
        assert_eq!(s.scheme, "mist");
        assert_eq!(s.background, "");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn corrupted_file_returns_default() {
        let p = temp_write("settings", b"not json{{{");
        let s = load_settings(&p);
        assert_eq!(s.theme, "dark");
        assert_eq!(s.scheme, "mist");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn roundtrip_saves_and_loads() {
        let p = temp_path("settings");
        let s = Settings {
            theme: "light".into(),
            scheme: "chalk".into(),
            background: "bg.png".into(),
        };
        save_settings(&p, &s);
        let loaded = load_settings(&p);
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.scheme, "chalk");
        assert_eq!(loaded.background, "bg.png");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn legacy_camel_case_is_readable() {
        let p = temp_write("settings", br#"{"theme":"light","background":""}"#);
        let loaded = load_settings(&p);
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.scheme, "mist");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn unknown_scheme_normalizes_to_mist() {
        let p = temp_write("settings", br#"{"theme":"dark","scheme":"neon","background":""}"#);
        let loaded = load_settings(&p);
        assert_eq!(loaded.scheme, "mist");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn unknown_theme_normalizes_to_dark() {
        let p = temp_write("settings", br#"{"theme":"neon","scheme":"chalk","background":""}"#);
        let loaded = load_settings(&p);
        assert_eq!(loaded.theme, "dark");
        // theme 归一化不波及合法的 scheme
        assert_eq!(loaded.scheme, "chalk");
        let _ = std::fs::remove_file(&p);
    }
}