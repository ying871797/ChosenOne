mod exclude;
mod names;
mod settings;
mod util;
mod watcher;

use std::path::PathBuf;

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
pub fn read_roster_from_dir(dir: &PathBuf) -> RosterPayload {
    let names_path = dir.join("names.txt");
    let excluded_path = dir.join("excluded.txt");

    // 名单缺失时自动生成示例文件
    let _ = names::ensure_names_file(&names_path);

    RosterPayload {
        names: names::parse_names_file(&names_path),
        excluded: exclude::parse_exclude_file(&excluded_path),
    }
}

/// 读取名单与排除名单（应用目录）。
#[tauri::command]
fn get_roster(app: tauri::AppHandle) -> Roster {
    let dir = app_dir(&app);
    let roster = read_roster_from_dir(&dir);
    Roster { names: roster.names, excluded: roster.excluded }
}

/// 读取设置（应用目录的 settings.json）。
#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> settings::Settings {
    let dir = app_dir(&app);
    settings::load_settings(&dir.join("settings.json"))
}

/// 保存设置到应用目录的 settings.json。
#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: settings::Settings) {
    let dir = app_dir(&app);
    settings::save_settings(&dir.join("settings.json"), &settings);
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
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台暂不支持自动打开目录".to_string())
    }
}

/// 启动名单文件监视。
#[tauri::command]
fn watch_roster_files(app: tauri::AppHandle) {
    let dir = app_dir(&app);
    let _ = watcher::start_watcher(app, dir);
}

/// 读取应用目录下背景图片，返回 data URL 供前端设置背景。
#[tauri::command]
fn read_background(app: tauri::AppHandle, filename: String) -> Option<String> {
    let dir = app_dir(&app);
    // 防止路径穿越：只允许文件名，不含路径分隔符
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return None;
    }
    util::image_data_url(&dir.join(&filename))
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
            let dir = app_dir(&app.handle());
            let _ = names::ensure_names_file(&dir.join("names.txt"));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Ready = event {
                // 窗口就绪后启动名单文件监视
                let dir = app_dir(app_handle);
                let _ = watcher::start_watcher(app_handle.clone(), dir);
            }
        });
}