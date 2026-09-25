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
            process_events(rx, dir, |payload| {
                let _ = app.emit("roster-changed", payload);
            });
        })
        .expect("failed to spawn roster watcher thread");

    Ok(())
}

fn process_events<F>(
    rx: std::sync::mpsc::Receiver<notify::Result<notify::Event>>,
    dir: PathBuf,
    mut emit: F,
) where
    F: FnMut(RosterPayload),
{
    loop {
        match rx.recv() {
            Ok(Ok(event)) => {
                if is_relevant(&event) {
                    match crate::read_roster_from_dir(&dir) {
                        Ok(payload) => emit(payload),
                        Err(error) => eprintln!("名单文件读取失败，保留前端上一份名单: {error}"),
                    }
                }
            }
            Ok(Err(error)) => {
                // notify 的瞬时错误不应永久终止监听；继续等待后续事件。
                eprintln!("名单文件监视收到瞬时错误: {error}");
            }
            Err(_) => break,
        }
    }
}

/// 判断事件是否与名单/排除名单文件相关：
/// 只关心 `names.txt` / `excluded.txt` 的 create/modify/remove/rename，
/// 忽略 settings.json、背景图等无关文件的变化（避免每次保存都重解析并推送）。
fn is_relevant(event: &notify::Event) -> bool {
    use notify::EventKind;

    let hits_roster_file = event.paths.iter().any(|p| {
        p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
            // Windows 文件系统大小写不敏感，notify 事件保留实际大小写。
            n.eq_ignore_ascii_case("names.txt") || n.eq_ignore_ascii_case("excluded.txt")
        })
    });
    if !hits_roster_file {
        return false;
    }
    matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use notify::event::CreateKind;
    use std::sync::mpsc::channel;

    #[test]
    fn transient_error_does_not_stop_following_events() {
        let dir = temp_dir("watcher-events");
        std::fs::write(dir.join("names.txt"), "甲\n").unwrap();
        let (tx, rx) = channel();
        tx.send(Err(notify::Error::generic("transient"))).unwrap();
        tx.send(Ok(notify::Event::new(notify::EventKind::Create(
            CreateKind::File,
        ))
        .add_path(dir.join("names.txt"))))
            .unwrap();
        drop(tx);

        let mut payloads = Vec::new();
        process_events(rx, dir.clone(), |payload| payloads.push(payload));

        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0].names, vec!["甲"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn roster_read_errors_do_not_emit_empty_roster() {
        let dir = temp_dir("watcher-read-error");
        std::fs::create_dir(dir.join("names.txt")).unwrap();
        let (tx, rx) = channel();
        tx.send(Ok(notify::Event::new(notify::EventKind::Create(
            CreateKind::File,
        ))
        .add_path(dir.join("names.txt"))))
            .unwrap();
        drop(tx);

        let mut payloads = Vec::new();
        process_events(rx, dir.clone(), |payload| payloads.push(payload));

        assert!(payloads.is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn roster_filename_match_is_case_insensitive() {
        use notify::event::ModifyKind;

        for name in ["NAMES.TXT", "Names.txt", "ExClUdEd.TxT", "excluded.TXT"] {
            let event = notify::Event::new(notify::EventKind::Modify(ModifyKind::Any))
                .add_path(std::path::Path::new("C:/app").join(name));
            assert!(is_relevant(&event), "{name} 应被视为名单文件");
        }

        let unrelated = notify::Event::new(notify::EventKind::Modify(ModifyKind::Any))
            .add_path(std::path::PathBuf::from("C:/app/names.txt.bak"));
        assert!(!is_relevant(&unrelated));
    }

    #[test]
    fn unrelated_events_are_ignored() {
        let dir = temp_dir("watcher-unrelated");
        let (tx, rx) = channel();
        tx.send(Ok(notify::Event::new(notify::EventKind::Create(
            CreateKind::File,
        ))
        .add_path(dir.join("settings.json"))))
            .unwrap();
        drop(tx);

        let mut payloads = Vec::new();
        process_events(rx, dir.clone(), |payload| payloads.push(payload));

        assert!(payloads.is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn disconnected_channel_ends_event_loop() {
        let dir = temp_dir("watcher-disconnect");
        let (tx, rx) = channel();
        drop(tx);

        process_events(rx, dir.clone(), |_| panic!("disconnect should not emit"));

        std::fs::remove_dir_all(dir).unwrap();
    }
}
