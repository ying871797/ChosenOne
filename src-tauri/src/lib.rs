mod exclude;
mod names;
mod settings;
#[cfg(test)]
mod testutil;
mod util;
mod watcher;

use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::watcher::RosterPayload;

/// 推送给前端的名单结构（与 WatcherPayload 相同结构）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Roster {
    pub names: Vec<String>,
    pub excluded: Vec<String>,
}

/// 应用目录的辅助定位：可执行文件所在目录。
///
/// ⚠️ 注意：不能用 `app.path().executable_dir()` —— Tauri v2 在 Windows 上
/// **明确不支持**该方法（`dirs::executable_dir()` 返回 None → Err），会回退到
/// 工作目录导致数据文件落到启动目录而非 exe 目录。改用 `std::env::current_exe()`：
/// 返回可执行文件绝对路径，与 cwd 无关，打包后恰好是 exe 同级目录。
fn app_dir(_app: &tauri::AppHandle) -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            return parent.to_path_buf();
        }
    }
    // 兜底：当前工作目录
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// 从应用目录读取并解析名单与排除名单。
pub fn read_roster_from_dir(dir: &Path) -> io::Result<RosterPayload> {
    let names_path = dir.join("names.txt");
    let excluded_path = dir.join("excluded.txt");

    // 名单缺失时自动生成示例文件；其他创建/读取错误必须显式传播。
    names::ensure_names_file(&names_path)?;
    Ok(RosterPayload {
        names: names::parse_names_file(&names_path)?,
        excluded: exclude::parse_exclude_file(&excluded_path)?,
    })
}

/// 读取名单与排除名单（应用目录）。
#[tauri::command]
fn get_roster(app: tauri::AppHandle) -> Result<Roster, String> {
    let dir = app_dir(&app);
    let roster = read_roster_from_dir(&dir).map_err(|error| format!("读取名单失败: {error}"))?;
    Ok(Roster {
        names: roster.names,
        excluded: roster.excluded,
    })
}

/// 读取设置（应用目录的 settings.json）。
#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<settings::Settings, String> {
    let dir = app_dir(&app);
    settings::load_settings(&dir.join("settings.json"))
        .map_err(|error| format!("读取设置失败: {error}"))
}

/// 保存设置到应用目录的 settings.json。
#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: settings::Settings) -> Result<(), String> {
    let dir = app_dir(&app);
    settings::save_settings(&dir.join("settings.json"), &settings)
        .map_err(|error| format!("保存设置失败: {error}"))
}

/// 返回应用目录绝对路径（用于"打开应用目录"按钮）。
#[tauri::command]
fn get_app_dir(app: tauri::AppHandle) -> String {
    let dir = app_dir(&app);
    dir.to_string_lossy().into_owned()
}

/// 在系统资源管理器中打开应用目录（Windows 用 explorer，其他平台用默认打开器）。
#[tauri::command]
fn open_app_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app_dir(&app);
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("无法打开资源管理器: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台暂不支持自动打开目录".to_string())
    }
}

/// 启动名单文件监视。
#[tauri::command]
fn watch_roster_files(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app_dir(&app);
    watcher::start_watcher(app, dir).map_err(|error| format!("启动文件监视失败: {error}"))
}

/// 读取应用目录下背景图片，返回 data URL 供前端设置背景。
#[tauri::command]
fn read_background(app: tauri::AppHandle, filename: String) -> Result<Option<String>, String> {
    let dir = app_dir(&app);
    read_background_from_dir(&dir, &filename)
}

fn read_background_from_dir(dir: &Path, filename: &str) -> Result<Option<String>, String> {
    validate_background_filename(filename)?;
    let canonical_dir = dir
        .canonicalize()
        .map_err(|error| format!("无法解析应用目录: {error}"))?;
    let path = match resolve_background_path(&canonical_dir, filename) {
        Ok(path) => path,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取背景图片失败: {error}")),
    };
    util::image_data_url(&path).map_err(|error| format!("读取背景图片失败: {error}"))
}

/// 将用户提供的背景设置解析为应用目录内的真实文件路径。
#[cfg(test)]
fn background_path(dir: &Path, filename: &str) -> Result<PathBuf, String> {
    validate_background_filename(filename)?;
    let canonical_dir = dir
        .canonicalize()
        .map_err(|error| format!("无法解析应用目录: {error}"))?;
    resolve_background_path(&canonical_dir, filename)
        .map_err(|error| format!("无法解析背景文件: {error}"))
}

fn validate_background_filename(filename: &str) -> Result<(), String> {
    let mut components = Path::new(filename).components();
    let is_single_normal = matches!(components.next(), Some(std::path::Component::Normal(_)))
        && components.next().is_none();
    if filename.is_empty()
        || !is_single_normal
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains(':')
        || filename.chars().any(|character| character.is_control())
        || filename.ends_with('.')
        || filename.ends_with(' ')
        || is_windows_reserved_name(filename)
    {
        return Err("背景文件名不合法".to_string());
    }
    Ok(())
}

fn resolve_background_path(canonical_dir: &Path, filename: &str) -> io::Result<PathBuf> {
    let canonical_path = canonical_dir.join(filename).canonicalize()?;
    if canonical_path.parent() != Some(canonical_dir) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "背景文件必须位于应用目录内",
        ));
    }
    Ok(canonical_path)
}

fn is_windows_reserved_name(filename: &str) -> bool {
    let stem = filename
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "CLOCK$"
            | "CONIN$"
            | "CONOUT$"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_roster,
            load_settings,
            save_settings,
            get_app_dir,
            open_app_dir,
            read_background,
            watch_roster_files
        ])
        .setup(|app| {
            // 启动即读取一次名单，确保初次启动就生成示例文件
            let dir = app_dir(app.handle());
            if let Err(error) = names::ensure_names_file(&dir.join("names.txt")) {
                // 不用初始化错误阻止窗口启动；get_roster 会重试并把真实错误交给前端。
                eprintln!("初始化名单文件失败: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            // 名单文件监视由前端 `watch_roster_files` 命令启动（main.js init 时调用），
            // 此处不再重复启动：setup/Ready 与命令多处启动会经 app.manage 反复替换重建 watcher。
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    #[test]
    fn background_read_errors_are_not_treated_as_missing() {
        let dir = temp_dir("background-read-error");
        std::fs::create_dir(dir.join("broken.png")).unwrap();

        assert!(read_background_from_dir(&dir, "broken.png").is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn background_missing_or_unsupported_files_return_none() {
        let dir = temp_dir("background-missing");
        assert_eq!(read_background_from_dir(&dir, "missing.png").unwrap(), None);

        std::fs::write(dir.join("image.bin"), b"not an image").unwrap();
        assert_eq!(read_background_from_dir(&dir, "image.bin").unwrap(), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn background_filename_rejects_unsafe_names() {
        let dir = temp_dir("background-invalid");
        let invalid = [
            "",
            ".",
            "..",
            "sub/photo.png",
            "sub\\photo.png",
            "C:x.png",
            "x:y.png",
            "NUL.png",
            "CON.txt",
            "LPT1.jpg",
            "photo.png ",
            "photo.png.",
            "photo\n.png",
        ];

        for filename in invalid {
            assert!(
                background_path(&dir, filename).is_err(),
                "应拒绝背景文件名: {filename:?}"
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn background_filename_accepts_plain_names_inside_app_dir() {
        let dir = temp_dir("background-valid");
        for filename in ["photo.png", "名字.JPEG", "photo.backup.png"] {
            let path = dir.join(filename);
            std::fs::write(&path, b"image bytes").unwrap();
            assert_eq!(
                background_path(&dir, filename).unwrap(),
                path.canonicalize().unwrap()
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
