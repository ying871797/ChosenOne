# AGENTS.md — ChosenOne 天选之子

Windows 桌面点名器。Tauri v2（Rust 后端 + 纯 HTML/CSS/JS 前端，**无前端构建链**）。

## 工作区布局（先看这个）

- 仓库根目录在 `master` 分支，**只有文档**（CONTEXT.md、docs/、.proposals/），没有源码。
- 应用源码在 `feat/chosenone` 分支，已 checkout 到 git worktree：**`.worktrees/chosenone/`**（被 .gitignore 排除）。
- 写代码/运行构建去 `.worktrees/chosenone/`；改根级文档在根目录。改动涉及术语时同步更新 `CONTEXT.md`。

## 文档（动手前读）

- `CONTEXT.md` — 领域词汇表（抽取/滚动/已点名/应用目录…）。
- `docs/superpowers/specs/2026-09-24-chosenone-name-picker-design.md` — 完整实现规格。
- `docs/adr/` — 3 条 ADR：Tauri v2+静态前端 / 名单文件放 exe 同目录 + NSIS 每用户安装 / 已点名仅存会话内存。
- 流程惯例：先 spec/ADR（superpowers 风格）后实现。

## 命令（在 `.worktrees/chosenone/` 下执行）

```bash
npm install           # 只装 @tauri-apps/cli
npm run tauri dev     # 开发模式（beforeDevCommand 为空，直接加载 src/ 静态文件）
npm run tauri build   # 打包 NSIS 每用户安装器
npx tauri build --no-bundle  # 便携版自包含 exe → src-tauri/target/release/chosenone.exe

cargo test            # 在 src-tauri/ 下；覆盖 names/exclude/settings/util 的解析逻辑
```

## 架构要点

- 前端 `src/{index.html, style.css, main.js, api.js}`：抽取 + 老虎机动画全在 main.js（requestAnimationFrame，1.5s ease-out）；`style.css` 用 CSS 变量驱动双主题。
- Tauri 命令（lib.rs 注册）：`get_roster` / `load_settings` / `save_settings` / `get_app_dir` / `open_app_dir` / `read_background` / `watch_roster_files`；事件 `roster-changed`，载荷 `{ names, excluded }`（camelCase）。
- **应用目录 = exe 所在目录**，用 `std::env::current_exe()` 定位。切勿改用 `app.path().executable_dir()`——Tauri v2 在 Windows 上不支持（回退到 cwd，数据文件落错目录）。names.txt / excluded.txt / settings.json / 背景图都在此目录。
- `names.txt` 缺失自动生成示例；`excluded.txt` 缺失视为无排除。解析：每行一个名字、去空白、忽略空行与 `#` 注释、去重保序；编码 UTF-8（剥 BOM），失败回退 GBK。
- 文件监视：notify 监视整个应用目录（非递归），过滤 create/modify/remove 后重解析并 emit `roster-changed`；watcher 经 `app.manage(WatcherState)` 保持存活。

## 陷阱（历史修过的坑）

- `api.js` 双模式：存在 `window.__TAURI__.core.invoke`（v2 命名空间，兼容 v1 扁平 `__TAURI__.invoke`）则用真实后端，否则挂 mock 并设 `window.__IS_BROWSER_PREVIEW__`。浏览器直接打开 `src/index.html` 即可走 mock 预览 UI、调试抽取逻辑——别破坏这个降级分支。
- CSS：`.overlay` 是 `display:flex`，必须配套 `.overlay[hidden]{display:none}`，否则隐藏属性失效（设置面板关不掉且开屏即弹）。新增面板/overlay 沿用此规则。
- 业务数据文件（names.txt 等）运行时生成，**不入 git**，打包产物也不含。
- NSIS 用 `installMode: currentUser`（每用户安装），避免 Program Files 权限问题。
- `src-tauri/src/main.rs` 的 `windows_subsystem` 属性标注 "DO NOT REMOVE"——去掉后 release 版会弹控制台窗口。