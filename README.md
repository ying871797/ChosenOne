# 天选之子 · ChosenOne

Windows 桌面点名器 —— 抽取时伴随老虎机式滚动动画，随机选中"天选之子"。

基于 **Tauri v2**（Rust 后端 + 纯 HTML/CSS/JS 前端，**无前端构建链**）。

## 功能特性

- 🎰 **抽取动画**：名单纵向滚动 1.5s 减速停驻，滚动途中不剧透赢家，命中中央行高亮
- 📋 **排除名单**：`excluded.txt` 中的人不参与抽取（如请假、已毕业）
- ✅ **已点名**：本会话抽过的人自动跳过（重启即重置，可点"重置"清空）
- 🎨 **双界面方案 × 双主题**：晨雾林窗（默认）/ 绿板粉笔 界面方案 × 夜林/晨光明暗主题，设置持久化
- 🖼️ **自定义背景**：把图片放入应用目录，在设置面板填入文件名即可
- 🔄 **热更新**：名单/排除名单文件一变，界面立即同步（无需重启）
- 🌗 窗口任意尺寸下 UI 等比缩放；`prefers-reduced-motion` 下背景动效自动静止

## 分支结构

| 分支 | 内容 |
|---|---|
| `master` | 文档：`CONTEXT.md`（领域词汇）、`docs/adr/`（架构决策）、`docs/superpowers/specs/`（实现规格） |
| `feat/chosenone` | **应用源码**：`src/` 前端 + `src-tauri/` Rust 后端，已配置独立 worktree 开发 |

## 快速开始

```bash
# 检出应用分支
git checkout feat/chosenone

# 安装依赖（仅 @tauri-apps/cli）
npm install

# 开发模式（直接加载 src/ 静态文件）
npm run tauri dev

# 运行后端单元测试（在 src-tauri/ 下）
cargo test

# 打包发布（NSIS 每用户安装器）
npm run tauri build

# 便携版自包含 exe（免安装）
npx tauri build --no-bundle   # → src-tauri/target/release/chosenone.exe
```

> 浏览器直接打开 `src/index.html` 可走 mock 降级预览 UI、调试抽取逻辑（无需 Tauri 环境）。

## 数据文件（应用目录 = exe 所在目录）

| 文件 | 说明 |
|---|---|
| `names.txt` | 名单，每行一个名字；缺失时自动生成示例 |
| `excluded.txt` | 排除名单；缺失视为无排除 |
| `settings.json` | 界面方案/主题/背景设置 |
| 背景图片 | 可选，放入应用目录后到设置面板填写文件名 |

解析规则：每行一个名字、去除首尾空白、忽略空行与 `#` 注释、去重保序；
编码优先 UTF-8（剥 BOM），失败自动回退 GBK。文件变化由后端监视并实时推送到界面。

## 技术要点

- 应用目录用 `std::env::current_exe()` 定位（Tauri v2 的 `executable_dir()` 在 Windows 上不支持，会把数据文件落错目录）
- 文件监视用 `notify` 监视整个应用目录（非递归），变化后重解析并 emit `roster-changed`
- 已点名仅存会话内存（见 `docs/adr/0003-picked-state-in-memory.md`）

## 文档

- 领域词汇：`CONTEXT.md`
- 架构决策记录：`docs/adr/`
- 实现规格：`docs/superpowers/specs/2026-09-24-chosenone-name-picker-design.md`