# 0002 — 名单文件与应用同目录，NSIS 每用户安装

`names.txt` 与可执行文件同目录，而非系统规范的用户数据目录（AppData/Documents）。用户核心诉求是"打包后人名单可任意修改且同步"，放应用目录最直观，配合记事本即可编辑。

为支持可写，安装器配置为**每用户安装**（默认 `%LOCALAPPDATA%\Programs\ChosenOne`，可自定义），避免 Program Files 的权限问题；同时产出便携版 exe。代价：多用户共享机器时名单不按用户隔离，对本场景（单机点名）可接受。

## 更新（2026-09-25）：目录定位方式

**原来**用 `app.path().executable_dir()` 定位应用目录（见 ADR-0002 与设计文档）。实测发现该 API 在 Windows 上**不可用**：

- `tauri::path::PathResolver::executable_dir()` 内部走 `dirs::executable_dir()`，而 `dirs` crate 在 **Windows 明确返回 `None`（"Not supported"）**，因此 Tauri 返回 `Err(UnknownPath)`。
- 代码里对 `Err` 做了兜底 `current_dir()` ——**这埋了雷**：安装版从任意工作目录启动时，名单文件会落到"启动时的工作目录"（如资源管理器/快捷方式的工作目录），而不是 exe 所在目录。便携版测试"偶然通过"是因为当时故意把工作目录设成了 exe 目录。

**现行方案**：改用 `std::env::current_exe()` 取可执行文件绝对路径，取 `.parent()` 即 exe 所在目录。与 cwd 无关、Windows 下稳定返回，恰好满足"数据文件与 exe 同目录"。

```rust
fn app_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.to_path_buf();
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}
```

文件位置依赖可执行文件路径（非工作目录），已在便携版/NSIS 安装版二者上实测验证属同一目录。