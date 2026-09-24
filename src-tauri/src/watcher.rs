use std::path::PathBuf;

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// 推送给前端的名单结构。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RosterPayload {
    /// 全部名单
    pub names: Vec<String>,
    /// 排除名单
    pub excluded: Vec<String>,
}

/// 持有 watcher 的托管状态（放在 Tauri 管理状态中保证其存活）。
/// 字段故意不读取：`app.manage()` 持有它仅为防止 watcher 被 drop。
#[allow(dead_code)]
pub struct WatcherState(pub notify::RecommendedWatcher);

/// 启动对名单文件的监视。任一相关文件变化时重新解析并推送到前端。
///
/// - 监视目标：应用目录下 `names.txt` / `excluded.txt` 所在的整个目录
/// - 目录级监视可捕获记事本常用的"临时文件重命名覆盖"保存方式，同时覆盖删除/重建场景
/// - 事件 `roster-changed` 负载为 `RosterPayload`
///
/// 返回 watcher 的错误。
pub fn start_watcher(app: AppHandle, dir: PathBuf) -> notify::Result<()> {
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();

    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;

    // 将 watcher 存入托管状态，保证其存活于应用生命周期
    app.manage(WatcherState(watcher));

    // 事件循环：收到事件 → 重新解析并推送前端
    std::thread::Builder::new()
        .name("roster-watcher".into())
        .spawn(move || {
            while let Ok(Ok(event)) = rx.recv() {
                if is_relevant(&event) {
                    let payload = crate::read_roster_from_dir(&dir);
                    let _ = app.emit("roster-changed", payload);
                }
            }
        })
        .expect("failed to spawn roster watcher thread");

    Ok(())
}

/// 判断事件是否与名单/排除名单文件相关：只关心 create/modify/remove/rename。
fn is_relevant(event: &notify::Event) -> bool {
    use notify::EventKind;
    matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}