# ChosenOne 对抗性加固实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 对名单解析、文件监视、背景读取、设置持久化与前端异步状态进行对抗性测试，修复已复现故障并留下可永久重跑的回归测试。

**架构：** Rust 边界层显式返回真实 I/O 错误并拒绝非纯文件名；notify 事件循环在瞬时错误后继续。前端继续使用原生脚本，不引入打包链，通过 Node 内置测试和可控 DOM/IPC 假件直接运行真实 `src/main.js`，以版本号拒绝跨名单变更的抽取结果，并串行保存设置。

**技术栈：** Rust 1.77+、Tauri v2、notify 8、serde_json、原生 JavaScript、Node 24 `node:test`。

---

## 文件结构

- 创建 `tests/main.test.js`：无依赖前端集成测试；加载真实 HTML 脚本所需的最小 DOM、Tauri IPC 与 RAF 假件。
- 修改 `package.json`：增加 `npm test` 永久入口。
- 修改 `src/main.js`：修复初始化/事件竞态、畸形负载、抽取失效、计数漂移、IPC 失败与设置写入乱序。
- 修改 `src-tauri/src/settings.rs`：保存错误上抛；兼容 UTF-8 BOM、缺省字段与 `background: null`。
- 修改 `src-tauri/src/names.rs`：覆盖 CR-only 换行并把去重从重复线性扫描改为 `HashSet`。
- 修改 `src-tauri/src/lib.rs`：保存/启动监视错误通过 Tauri Promise 拒绝；验证并解析背景文件真实路径。
- 修改 `src-tauri/src/watcher.rs`：瞬时 watcher 错误不再终止事件线程，并加入事件过滤/恢复回归测试。
- 修改 `src-tauri/src/testutil.rs`：提供隔离临时目录，供 watcher 与路径测试使用。
- 修改本文档：执行时同步勾选真实完成项。

> 当前工作区已有 `src-tauri/Cargo.toml` 与两个生成 schema 的“内容哈希未变但 Git 标记修改”的状态；本轮不覆盖、不提交这些既有工作。

### 任务 1：建立前端真实代码的失败回归测试

**文件：**
- 创建：`tests/main.test.js`
- 修改：`package.json`

- [x] **步骤 1：编写可控测试运行时**

实现 `createHarness()`，提供带 `dataset/style/classList/click` 的假 DOM、延迟 Promise、可手动推进的 `requestAnimationFrame`，以及可拒绝的 `ChosenAPI`。测试通过 `node:vm` 加载真实 `src/api.js` 与 `src/main.js`，不复制生产抽取逻辑。

- [x] **步骤 2：加入首批对抗测试**

覆盖以下可观察行为：

```js
test("背景 IPC 失败后仍读取名单并启动监视", async () => { /* readBackground rejects; getRoster/watch 仍被调用 */ });
test("先注册监听再启动监视，且旧初始响应不覆盖新事件", async () => { /* watch 中触发事件；最终抽出新名单成员 */ });
test("名单在动画期间移除目标时取消该次抽取", async () => { /* RAF 完成前触发 roster-changed */ });
test("已点名计数只统计当前可抽总人数中的成员", async () => { /* 抽中后名单移除该人 */ });
test("畸形 roster-changed 不破坏当前名单", async () => { /* handler(null) */ });
test("设置保存串行且前一次失败不阻塞后一次", async () => { /* 两个延迟 saveSettings 反序完成 */ });
```

- [x] **步骤 3：运行测试验证红灯**

运行：`npm test`

预期：至少“背景失败阻断初始化”“监听窗口丢事件”“动画提交失效目标”“计数大于总数”“畸形事件抛错”“设置并发反序”因现有行为失败；失败必须对应当前实现，不得是测试语法或路径错误。

### 任务 2：修复前端异步状态与失败恢复

**文件：**
- 修改：`src/main.js`
- 测试：`tests/main.test.js`

- [x] **步骤 1：集中校验名单负载并增加版本号**

使用严格校验：负载必须是对象，`names/excluded` 必须是字符串数组；去重保序。合法更新才执行：

```js
function applyRoster(payload) {
  const next = validateRoster(payload);
  allNames = next.names;
  excluded = next.excluded;
  rosterRevision += 1;
  refreshStatus();
}
```

`refreshRoster()` 记录请求开始时的 `rosterRevision`；若等待期间收到事件，则丢弃较旧初始响应。异常时保留上一份合法名单、禁用抽取并显示“名单更新失败”。

- [x] **步骤 2：关闭监听注册窗口**

初始化时先 `await API.onRosterChanged(...)` 建立监听，再启动 watcher，最后读取一次权威名单。监听注册或 watcher 启动失败被捕获，但名单读取仍继续；最终状态不得被 `onReset()` 覆盖。

- [x] **步骤 3：拒绝跨版本抽取结果**

抽取开始时捕获 `{ target, revision }`。动画完成前若 `rosterRevision` 改变，则不加入 `picked`、不高亮旧目标、复位卷带，并提示“名单已更新，本次抽取已取消”。只有版本未变时才能提交赢家。

- [x] **步骤 4：修正边界计数**

一次构造 `excludedSet`，从 `allNames - excluded` 得到 eligible；总数为 eligible 长度，已点名为 eligible 中存在于 `picked` 的数量。名单外排除项、已删除的已点名者、后来被排除者均不得造成 `picked > total`。

- [x] **步骤 5：隔离背景读取失败**

`API.readBackground()` 的拒绝只记录并提示背景失败，不得跳出 `loadAndApplySettings()`，不得阻止名单读取与 watcher 启动。

- [x] **步骤 6：串行持久化设置**

维护 Promise 队列；每次保存快照排在前一次之后，前一次失败后恢复队列继续后续保存：

```js
settingsSaveTail = settingsSaveTail
  .catch(() => undefined)
  .then(() => API.saveSettings(snapshot));
```

调用者仍接收本次保存结果并显示“设置保存失败”，不得把失败伪装成成功。

- [x] **步骤 7：运行前端测试验证绿灯**

运行：`npm test`

预期：全部对抗测试通过，无未处理 Promise rejection。

### 任务 3：让设置错误可见并兼容异常 JSON

**文件：**
- 修改：`src-tauri/src/settings.rs`
- 修改：`src-tauri/src/lib.rs`
- 测试：`src-tauri/src/settings.rs`

- [x] **步骤 1：编写失败测试**

新增测试覆盖：

```rust
save_settings(&directory_instead_of_file, &settings).is_err()
load_settings(utf8_bom_json).scheme == "chalk"
load_settings(r#"{"theme":"light","scheme":"chalk","background":null}"#).scheme == "chalk"
load_settings(r#"{"scheme":"chalk"}"#).theme == "dark"
```

运行：`cargo test settings::tests -- --nocapture`

预期：保存 API 尚无错误返回；BOM、null 与缺字段测试按预期失败。

- [x] **步骤 2：最小实现**

`save_settings` 改为 `io::Result<()>`，序列化与文件写入错误均返回；Tauri 命令映射为 `Result<(), String>`。读取前剥离 UTF-8 BOM；为 theme/scheme/background 提供字段级默认值，并用 `Option<String>` 兼容 `background: null`。

- [x] **步骤 3：验证设置测试**

运行：`cargo test settings::tests -- --nocapture`

预期：全部通过。

### 任务 4：修复名单异常换行与超长名单复杂度

**文件：**
- 修改：`src-tauri/src/names.rs`
- 测试：`src-tauri/src/names.rs`

- [x] **步骤 1：编写 CR-only 失败测试**

```rust
let p = tempfile_with("names", "甲\r乙\r\n丙\n丁");
assert_eq!(parse_names_file(&p), vec!["甲", "乙", "丙", "丁"]);
```

运行：`cargo test names::tests::parses_all_supported_line_endings -- --exact`

预期：当前实现把 CR 直接删除，得到 `甲乙`，测试失败。

- [x] **步骤 2：最小实现并去除 O(n²) 去重**

改用 `text.split(['\r', '\n'])` 同时覆盖 LF、CRLF、CR-only；以 `HashSet<&str>` 记录已见名字，输出仍保持首次出现顺序。

- [x] **步骤 3：回归验证**

运行：`cargo test names::tests -- --nocapture`

预期：全部通过。

### 任务 5：封锁背景文件路径与设备名边界

**文件：**
- 修改：`src-tauri/src/lib.rs`
- 测试：`src-tauri/src/lib.rs`

- [x] **步骤 1：编写纯文件名失败测试**

覆盖并拒绝：空串、`.`、`..`、正反斜杠、盘符前缀 `C:x.png`、ADS `x:y.png`、`NUL.png`、`CON.txt`、`LPT1.jpg`、尾随点/空格；允许 `photo.png`、`名字.JPEG` 与普通多点文件名。

- [x] **步骤 2：最小实现安全解析**

先按 `Component::Normal`、分隔符、冒号、控制字符、尾随点/空格和 Windows 保留设备名校验；再 canonicalize 应用目录与目标，要求目标父目录等于 canonical 应用目录，以阻止文件 symlink 跳出应用目录。通过后调用 `image_data_url`。

- [x] **步骤 3：运行路径测试**

运行：`cargo test background_filename -- --nocapture`

预期：全部通过。

### 任务 6：让 watcher 错误可见且瞬时失败可恢复

**文件：**
- 修改：`src-tauri/src/watcher.rs`
- 修改：`src-tauri/src/lib.rs`
- 修改：`src-tauri/src/testutil.rs`
- 测试：`src-tauri/src/watcher.rs`

- [x] **步骤 1：编写事件循环失败测试**

向 channel 先发送 `Err(notify::Error::generic("transient"))`，再发送 names.txt 的 create 事件；调用事件循环后必须仍处理第二个事件并发出一次 roster payload。

- [x] **步骤 2：最小实现**

把 `while let Ok(Ok(event))` 改为显式 `match recv()`：`Ok(Err(_))` 继续，`Disconnected` 结束；创建/修改/删除事件才重读。`watch_roster_files` 命令把 `start_watcher` 错误映射为 `Result<(), String>`，使前端 Promise 拒绝而不是假成功。

- [x] **步骤 3：验证 watcher 测试**

运行：`cargo test watcher::tests -- --nocapture`

预期：瞬时错误后的有效事件仍被处理；无关文件事件被忽略；channel 断开可退出。

### 任务 7：完整验证

**文件：**
- 检查：全部改动文件

- [x] **步骤 1：前端永久测试**

运行：`npm test`

预期：全部通过，无 rejection、unhandled exception 或开放句柄。

- [x] **步骤 2：Rust 永久测试**

运行：`cargo test`

预期：全部通过；原有与新增测试均执行。

- [x] **步骤 3：格式与静态检查**

运行：`cargo fmt --all -- --check`

运行：`cargo clippy --all-targets --all-features -- -D warnings`

若仅出现已触及代码中的格式/Clippy 问题则最小修复后重跑；不得借机重构无关模块。

- [x] **步骤 4：构建验证**

运行：`npm run tauri build -- --no-bundle`

预期：生成 `src-tauri/target/release/chosenone.exe`。

- [x] **步骤 5：变更审计**

运行：`git diff --check`、`git status --short`、`git diff --stat`

确认只包含计划内文件；不覆盖开始时已存在的 `Cargo.toml` 与生成 schema 状态，不创建 commit。

---

## 第二轮对抗（2026-09-25 复审后追加）

初审通过后，按"先红灯复现 → 最小修复 → 全量回归"继续加固以下边界，任务状态与首轮一致（全部完成）。

### 任务 8：设置读取失败的错误契约与写回阻断

**契约：** `load_settings` 仅在文件缺失（`NotFound`）或 JSON 损坏时返回默认值；其他 I/O 错误必须上抛为 `Result::Err`。前端收到读取失败后 `settingsLoadFailed = true`，任何入队/已排队的保存都不得抵达 `API.saveSettings`；主题、方案、背景在改动视觉状态前先检查并中止，背景输入框回退到 `currentSettings.background`。

### 任务 9：背景读取的错误契约与请求版本

**契约：** `read_background` 返回 `Result<Option<String>, String>`：仅明确 `NotFound`、不支持格式或空文件返回 `Ok(None)`，其他读取错误 reject。前端记录 `lastAppliedBackgroundRevision`，只允许比最后一次成功应用的版本更新的结果修改界面；较新请求失败时不得回退覆盖旧背景，设置读取失败后不得推进该版本。背景读取与保存分属两个 `try`，保存失败保留"设置保存失败"语义。

### 任务 10：名单读取错误不再伪装为空集合

**契约：** 仅 `excluded.txt` 缺失表示无排除；`names.txt`/`excluded.txt` 的其他读取错误必须传播。`read_roster_from_dir()` 返回 `io::Result`，watcher 遇读取错误只记录日志、不 emit 伪造空名单。`load_settings` 的等价处理见任务 8。

### 任务 11：非阻塞初始化与状态提示优先级

设置/背景属非核心链路：`loadAndApplySettings()` 以 `void` 启动，设置或背景 IPC 挂起仍会启动名单监听、watcher 与初始名单读取。状态提示按优先级仲裁（0 普通 / 10 设置背景提示 / 20 抽取结果 / 40 名单核心错误），并按归属子系统精确清除：名单更新只取代普通与抽取状态，不得抹掉设置/背景错误提示；抽取结果是用户可见结论，不被迟到异步提示覆盖。

### 任务 12：Windows 文件名大小写

**契约：** Windows 文件系统大小写不敏感，notify 事件保留实际文件名大小写。watcher 相关性判断改用 `eq_ignore_ascii_case`，`NAMES.TXT`、`ExClUdEd.TxT` 等同样触发重解析。

### 任务 13：Tauri setup 容错

首次创建示例 `names.txt` 失败时只记录错误，不再阻止窗口启动。

---

## 执行报告（2026-09-25）

**基线：** `31abb69d026858452717534b31022fea2d8d33e1`

**永久测试入口：**

- 前端：`npm test` → `node --test tests/main.test.js tests/api.test.js`
- Rust：`cd src-tauri && cargo test`

**最终验证结果：**

| 验证 | 结果 |
| --- | --- |
| `npm test` | 34 / 34 通过（前端 VM/DOM/RAF 真实代码回归 + API 契约） |
| `cargo test` | 36 / 36 通过 |
| `cargo clippy --all-targets --all-features -- -D warnings` | 0 warning / 0 error |
| `rustfmt --edition 2021 --check`（本轮触及的 6 个 Rust 文件） | 通过 |
| `node scripts/verify-roll.js` | PASS |
| `node scripts/verify-roster.js` | PASS |
| `node scripts/verify-render.js` | PASS（视口宽 447、中心命中 `slot-row`） |
| `git diff --check` | 通过（仅 Windows LF→CRLF 提示） |
| `npx tauri build --no-bundle` | 生成 `src-tauri/target/release/chosenone.exe` |

**关键错误契约（永久约定）：**

- `load_settings`：仅 `NotFound` / 损坏 JSON 用默认值，其他 I/O 错误上抛；读取失败后前端禁止写回。
- `save_settings`：序列化与写入错误均返回 `Result::Err`，由前端显式显示"设置保存失败"。
- `read_background`：`Result<Option<String>, String>`；仅 `NotFound` / 不支持格式 / 空文件为 `Ok(None)`，其他 I/O 错误 reject。文件名必须是应用目录内的纯文件名（拒绝分隔符、盘符、ADS、控制字符、Windows 保留设备名、尾随点/空格），canonicalize 后父目录必须等于应用目录。
- `read_roster_from_dir`：`io::Result`；仅 `excluded.txt` 缺失表示无排除，其他名单/排除读取错误传播。
- watcher：瞬时错误继续，读取失败不 emit 空名单；文件名大小写不敏感。

**保持不变的提示文案：** `背景图片读取失败`、`名单更新失败`、`读取名单失败`、`名单同步监听失败`、`名单已读取，但自动同步失败`、`设置保存失败`、`读取设置失败`、`名单已更新，本次抽取已取消`。

**残余风险（本轮有意不处理，记录备查）：**

- API 事件 envelope 异常、Promise 永不 settle、稀疏数组等极端输入未做防御。
- watcher 未处理去抖与生命周期回收；硬链接/大小写替换之外的文件系统边界未覆盖。
- 写入非原子，存在部分 TOCTOU 窗口；未引入资源上限。
- `cargo fmt --all -- --check` 可能仍报告未触及的基线文件；本轮只格式化触及文件，不借机重构无关模块。

**交付：** 改动提交到 `fix/adversarial-hardening` 并推送；release 单文件便携版另存为当前用户桌面 `ChosenOne-便携版.exe`。未创建 PR、未合并、未删除 worktree。
