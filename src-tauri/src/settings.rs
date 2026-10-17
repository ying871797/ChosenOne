use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::Path;

/// 字体大小系数（名单区字号缩放）合法区间与默认值。
/// 上限由几何决定：行高与视口随系数增长（见前端 rowHeightFor），
/// 3.2× 时中央行字号 147px、字形约 129px、行高 171px、视口 513px、
/// 设计窗高 648px；横向可用宽度 = 视口宽（随窗口宽变化，800 宽窗口下 778px）。
pub const FONT_SCALE_MIN: f64 = 0.8;
pub const FONT_SCALE_MAX: f64 = 3.2;
const FONT_SCALE_DEFAULT: f64 = 1.0;

/// 归一化字号系数：非有限数回落默认值，越界 clamp 到合法区间。
fn normalize_font_scale(value: f64) -> f64 {
    if !value.is_finite() {
        return FONT_SCALE_DEFAULT;
    }
    value.clamp(FONT_SCALE_MIN, FONT_SCALE_MAX)
}

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
    /// 字体大小系数（名单区字号 × 系数，0.8~3.2）；缺省 1.0
    #[serde(default = "default_font_scale")]
    pub font_scale: f64,
    /// 背景图片文件名；空串表示使用默认纯色背景
    pub background: String,
}

fn default_font_scale() -> f64 {
    FONT_SCALE_DEFAULT
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    theme: Option<String>,
    scheme: Option<String>,
    font_scale: Option<f64>,
    background: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "dark".to_string(),
            scheme: "mist".to_string(),
            font_scale: FONT_SCALE_DEFAULT,
            background: String::new(),
        }
    }
}

/// 读取设置；文件缺失或 JSON 损坏时返回默认设置，真实 I/O 错误上抛。
/// scheme 做白名单归一化：未知/缺省一律回落到 `mist`，避免旧配置文件破坏前端主题。
pub fn load_settings(path: &Path) -> io::Result<Settings> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Settings::default());
        }
        Err(error) => return Err(error),
    };
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content);
    let mut settings = serde_json::from_str::<PersistedSettings>(content)
        .map(|saved| Settings {
            theme: saved.theme.unwrap_or_else(|| "dark".to_string()),
            scheme: saved.scheme.unwrap_or_else(|| "mist".to_string()),
            font_scale: normalize_font_scale(saved.font_scale.unwrap_or(FONT_SCALE_DEFAULT)),
            background: saved.background.unwrap_or_default(),
        })
        .unwrap_or_default();

    if !matches!(settings.scheme.as_str(), "mist" | "chalk") {
        settings.scheme = "mist".to_string();
    }
    // theme 做同样白名单归一化：未知/缺省回落 `dark`，
    // 避免非法值导致前端 body[data-theme="xxx"] 匹配不到 CSS 变量。
    if !matches!(settings.theme.as_str(), "dark" | "light") {
        settings.theme = "dark".to_string();
    }
    Ok(settings)
}

/// 保存设置；序列化或文件写入失败均返回给调用方。
pub fn save_settings(path: &Path, settings: &Settings) -> io::Result<()> {
    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    fs::write(path, content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{temp_path, temp_write};

    #[test]
    fn read_errors_are_propagated() {
        let p = temp_path("settings-read-error");
        std::fs::create_dir(&p).unwrap();

        assert!(load_settings(&p).is_err());
        std::fs::remove_dir_all(p).unwrap();
    }

    #[test]
    fn missing_file_returns_default() {
        let p = temp_path("settings");
        let _ = std::fs::remove_file(&p);
        let s = load_settings(&p).unwrap();
        assert_eq!(s.theme, "dark");
        assert_eq!(s.scheme, "mist");
        assert_eq!(s.font_scale, 1.0);
        assert_eq!(s.background, "");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn corrupted_file_returns_default() {
        let p = temp_write("settings", b"not json{{{");
        let s = load_settings(&p).unwrap();
        assert_eq!(s.theme, "dark");
        assert_eq!(s.scheme, "mist");
        assert_eq!(s.font_scale, 1.0);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn roundtrip_saves_and_loads() {
        let p = temp_path("settings");
        let s = Settings {
            theme: "light".into(),
            scheme: "chalk".into(),
            font_scale: 1.15,
            background: "bg.png".into(),
        };
        save_settings(&p, &s).unwrap();
        let loaded = load_settings(&p).unwrap();
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.scheme, "chalk");
        assert_eq!(loaded.font_scale, 1.15);
        assert_eq!(loaded.background, "bg.png");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn save_reports_write_error() {
        let p = temp_path("settings-directory");
        std::fs::create_dir(&p).unwrap();
        let s = Settings::default();

        let result = save_settings(&p, &s);

        assert!(result.is_err());
        let _ = std::fs::remove_dir(&p);
    }

    #[test]
    fn reads_utf8_bom_without_losing_fields() {
        let p = temp_write(
            "settings-bom",
            b"\xEF\xBB\xBF{\"theme\":\"light\",\"scheme\":\"chalk\",\"background\":\"bg.png\"}",
        );
        let loaded = load_settings(&p).unwrap();
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.scheme, "chalk");
        assert_eq!(loaded.background, "bg.png");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn null_background_uses_default_empty_string() {
        let p = temp_write(
            "settings-null-background",
            br#"{"theme":"light","scheme":"chalk","background":null}"#,
        );
        let loaded = load_settings(&p).unwrap();
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.scheme, "chalk");
        assert_eq!(loaded.background, "");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn missing_fields_use_defaults_without_discarding_present_fields() {
        let p = temp_write("settings-missing-fields", br#"{"scheme":"chalk"}"#);
        let loaded = load_settings(&p).unwrap();
        assert_eq!(loaded.theme, "dark");
        assert_eq!(loaded.scheme, "chalk");
        assert_eq!(loaded.background, "");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn legacy_camel_case_is_readable() {
        let p = temp_write("settings", br#"{"theme":"light","background":""}"#);
        let loaded = load_settings(&p).unwrap();
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.scheme, "mist");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn unknown_scheme_normalizes_to_mist() {
        let p = temp_write(
            "settings",
            br#"{"theme":"dark","scheme":"neon","background":""}"#,
        );
        let loaded = load_settings(&p).unwrap();
        assert_eq!(loaded.scheme, "mist");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn unknown_theme_normalizes_to_dark() {
        let p = temp_write(
            "settings",
            br#"{"theme":"neon","scheme":"chalk","background":""}"#,
        );
        let loaded = load_settings(&p).unwrap();
        assert_eq!(loaded.theme, "dark");
        // theme 归一化不波及合法的 scheme
        assert_eq!(loaded.scheme, "chalk");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn legacy_file_without_font_scale_defaults_to_one() {
        let p = temp_write(
            "settings-legacy-font-scale",
            br#"{"theme":"light","scheme":"chalk","background":""}"#,
        );
        let loaded = load_settings(&p).unwrap();
        assert_eq!(loaded.font_scale, 1.0);
        // font_scale 缺省不波及其他字段
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.scheme, "chalk");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn out_of_range_font_scale_is_clamped() {
        let p = temp_write(
            "settings-clamp-high",
            br#"{"theme":"dark","scheme":"mist","fontScale":9.9,"background":""}"#,
        );
        assert_eq!(load_settings(&p).unwrap().font_scale, FONT_SCALE_MAX);
        let _ = std::fs::remove_file(&p);

        let p = temp_write(
            "settings-clamp-low",
            br#"{"theme":"dark","scheme":"mist","fontScale":0.1,"background":""}"#,
        );
        assert_eq!(load_settings(&p).unwrap().font_scale, FONT_SCALE_MIN);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn max_font_scale_is_preserved() {
        // 3.2 是合法上限，必须原样保留（不被误 clamp）
        let p = temp_write(
            "settings-max-font-scale",
            br#"{"theme":"dark","scheme":"mist","fontScale":3.2,"background":""}"#,
        );
        assert_eq!(load_settings(&p).unwrap().font_scale, 3.2);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn null_font_scale_uses_default_one() {
        let p = temp_write(
            "settings-null-font-scale",
            br#"{"theme":"dark","scheme":"mist","fontScale":null,"background":""}"#,
        );
        assert_eq!(load_settings(&p).unwrap().font_scale, 1.0);
        let _ = std::fs::remove_file(&p);
    }
}
