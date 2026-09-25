/* ===== 天选之子 · 主逻辑 =====
 * 抽取逻辑 + 老虎机竖排滚动动画 + 文件变化同步 + 主题/设置
 */

(function () {
  "use strict";

  const API = window.ChosenAPI;

  // ---------- 状态 ----------
  let allNames = [];      // 全部名单
  let excluded = [];      // 排除名单
  let picked = new Set(); // 已点名（会话内存，重启即重置）
  let isDrawing = false;  // 正在滚动动画
  let rosterRevision = 0; // 每次合法名单变更递增，防止旧异步结果覆盖新状态
  let rosterLoadError = false; // 名单 IPC/事件无效时暂停抽取，等待下一份合法名单
  let initCoreError = false; // 监听/watcher 初始化失败后，名单状态提示保持最高优先级
  let statusPriority = 0; // 0 普通、10 设置/背景提示、20 抽取结果、40 名单核心错误
  let statusOwner = "roster"; // 当前状态提示的归属子系统，用于精确清除

  // ---------- DOM ----------
  const slotList = document.getElementById("slotList");
  let rows = []; // 条带行（init 时按滚动序列长度构建）
  const drawBtn = document.getElementById("drawBtn");
  const resetBtn = document.getElementById("resetBtn");
  const pickedCount = document.getElementById("pickedCount");
  const excludedCount = document.getElementById("excludedCount");
  const statusHint = document.getElementById("statusHint");
  const themeBtn = document.getElementById("themeBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsOverlay = document.getElementById("settingsOverlay");
  const panelCloseBtn = document.getElementById("panelCloseBtn");
  const bgInput = document.getElementById("bgInput");
  const openDirBtn = document.getElementById("openDirBtn");
  const segBtns = Array.from(document.querySelectorAll(".seg-btn[data-theme]"));
  const schemeSegBtns = Array.from(document.querySelectorAll(".seg-btn[data-scheme]"));

  const STATUS_NOTICE = 10;
  const STATUS_DRAW = 20;
  const STATUS_CORE = 40;
  const OWNER_ROSTER = "roster";
  const OWNER_DRAW = "draw";
  const OWNER_CORE = "core";
  const OWNER_NOTICE_SETTINGS = "notice:settings";
  const OWNER_NOTICE_BACKGROUND = "notice:background";

  /** 写入状态提示：低优先级不得覆盖高优先级，避免迟到的异步提示盖掉名单/抽取结果。 */
  function setStatus(message, priority = 0, owner = OWNER_ROSTER) {
    if (priority < statusPriority) return false;
    statusPriority = priority;
    statusOwner = owner;
    statusHint.textContent = message;
    return true;
  }

  /** 只有同一子系统的成功操作才能清掉它自己的提示；其他子系统的提示保持可见。 */
  function clearNoticeStatus(owner) {
    if (statusOwner !== owner) return false;
    statusPriority = 0;
    statusOwner = OWNER_ROSTER;
    return true;
  }

  /** 名单更新只取代普通/抽取状态，不得抹掉设置与背景的错误提示。 */
  function clearRosterStatus() {
    if (initCoreError) return;
    if (statusOwner === OWNER_NOTICE_SETTINGS || statusOwner === OWNER_NOTICE_BACKGROUND) return;
    statusPriority = 0;
    statusOwner = OWNER_ROSTER;
  }

  // ---------- 名单校验与可抽池 ----------
  function normalizeNameList(value, label) {
    if (!Array.isArray(value)) {
      throw new TypeError(`${label} 必须是字符串数组`);
    }

    const seen = new Set();
    return value.map((name, index) => {
      if (typeof name !== "string" || name.length === 0 || name.trim() !== name) {
        throw new TypeError(`${label}[${index}] 不是合法名字`);
      }
      if (seen.has(name)) return null;
      seen.add(name);
      return name;
    }).filter((name) => name !== null);
  }

  function applyRoster(payload) {
    if (!payload || typeof payload !== "object") {
      throw new TypeError("名单负载必须是对象");
    }
    const nextNames = normalizeNameList(payload.names, "names");
    const nextExcluded = normalizeNameList(payload.excluded, "excluded");
    allNames = nextNames;
    excluded = nextExcluded;
    rosterRevision += 1;
    rosterLoadError = false;
    clearRosterStatus();
    refreshStatus();
  }

  function showRosterError(message) {
    rosterLoadError = true;
    rosterRevision += 1;
    drawBtn.disabled = true;
    setStatus(message, STATUS_CORE, OWNER_CORE);
  }

  function getRosterStats() {
    const excludedSet = new Set(excluded);
    const eligible = allNames.filter((name) => !excludedSet.has(name));
    const pool = eligible.filter((name) => !picked.has(name));
    return {
      eligible,
      pool,
      excludedInRoster: allNames.length - eligible.length,
      pickedInRoster: eligible.filter((name) => picked.has(name)).length,
    };
  }

  /** 可抽池 = 名单 − 排除 − 已点名 */
  function getPool() {
    return getRosterStats().pool;
  }

  /** 随机取一个，空池返回 null */
  function randomPick() {
    const pool = getPool();
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** 随机取一个：从可抽池中排除 exclude 集合内的人后随机，空则返回 ""。
   * 排除名单与已点名者天然不在可抽池内；滚动用 {target} 排除目标实现"不剧透"。 */
  function randomExcluding(exclude) {
    const pool = getPool().filter((n) => !exclude.has(n));
    if (pool.length === 0) return "";
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---------- 更新界面状态 ----------
  function refreshStatus() {
    if (rosterLoadError || initCoreError) {
      drawBtn.disabled = true;
      return;
    }
    const { pool, excludedInRoster, pickedInRoster } = getRosterStats();
    const total = allNames.length - excludedInRoster;
    pickedCount.textContent = `已点名 ${pickedInRoster}/${total}`;
    excludedCount.textContent = `已排除 ${excludedInRoster}`;

    if (allNames.length === 0) {
      setStatus("名单为空，请在应用目录创建 names.txt");
      drawBtn.disabled = true;
    } else if (pool.length === 0) {
      // 区分"全被排除/点名"与"无名单"
      if (excludedInRoster >= allNames.length) {
        setStatus("所有人均在排除名单中，无可抽对象");
      } else {
        setStatus("全部已点名，请点击重置");
      }
      drawBtn.disabled = true;
    } else {
      setStatus(isDrawing ? "抽选中…" : `可抽 ${pool.length} 人`);
      drawBtn.disabled = isDrawing;
    }
  }

  // ---------- 老虎机动画 ----------
  const ROW_H = 80;          // 行高（与 CSS 一致）
  const ROLL_DURATION = 1500; // 总滚动时长 ms
  const CENTER = 1;          // 中央可见行索引（视口内中间那行的行位）

  // 条带几何：视口高 240px = 3 行，行条带必须有足够高度保证整个
  // 滚动过程视口始终被覆盖 —— 条带行数 = 滚动序列长度（42），
  // 总高 3360px = 视口 240px + 最大位移 3120px（maxMid × 80）。
  const ROLL_RANDOM_COUNT = 39;              // 随机段行数；收尾段 3 行 = [非目标, 目标, 非目标]
  const ROLL_ROWS = ROLL_RANDOM_COUNT + 3;   // 条带行数 = 序列长度（42 行）

  // 超长名字自适应字号（可抽名宽度上限：视口最大宽 560px，中文一字 ≈ 字号 + 2px 字距）
  const FONT_SIZE_TIERS = [
    { maxLen: 8, size: "" },     // 默认字号（CSS：常行 42px / 中央行 46px）
    { maxLen: 11, size: "30px" },
    { maxLen: 14, size: "24px" },
    { maxLen: Infinity, size: "20px" },
  ];
  function applyRowFont(row, name) {
    const len = String(name).length;
    let size = "";
    for (const t of FONT_SIZE_TIERS) {
      if (len <= t.maxLen) { size = t.size; break; }
    }
    row.style.fontSize = size;
  }

  /**
   * 构造老虎机滚动序列：
   * - 随机段（ROLL_RANDOM_COUNT 行）：从可抽池排除目标后取 —— 滚动途中不剧透赢家；
   * - 收尾段 3 行 [非目标A, target, 非目标B]：终点停驻后视口三行互异，
   *   目标独占中央行，上下各为一个与其不同的邻行（Q1/Q3）。
   * 注：可抽池仅 1 人时无悬念，整条卷带退化为全目标名（保持条带连续不镂空）。
   */
  function buildRollSeq(target, count) {
    const seq = [];
    const suspense = getPool().length > 1;
    const exclude = (names) => (suspense ? new Set(names) : new Set());
    for (let i = 0; i < count; i++) seq.push(randomExcluding(exclude([target])));
    const above = randomExcluding(exclude([target]));
    const below = randomExcluding(exclude([target, above])) || above;
    seq.push(above, target, below);
    return seq;
  }

  /**
   * 条带行静态填充：row[i] 永久对应 seq[i]，之后的滚动只滑动条带本身。
   * 视口（3 行）在 translateY(-mid*80) 下依次展示 seq[mid..mid+2]，
   * 终点 mid=maxMid 时中央行 = rows[maxMid+CENTER] = seq[maxMid+1] = target。
   */
  function fillReel(seq) {
    rows.forEach((row, i) => {
      const name = i < seq.length ? seq[i] : "";
      row.textContent = name;
      applyRowFont(row, name);
    });
  }

  /** 每帧只更新条带位移；行文本已由 fillReel 一次填好 */
  function renderFrame(seq, mid) {
    slotList.style.transform = `translateY(${-mid * ROW_H}px)`;
  }

  /**
   * 执行老虎机滚动动画（连续纵向滚动，1.5s ease-out 减速停止到目标）。
   * @param {string} target 目标名字（必为可抽池中的人）
   * @returns {Promise<void>} 动画结束 resolve
   */
  function rollTo(target) {
    return new Promise((resolve) => {
      isDrawing = true;
      refreshStatus();

      // 中部索引从 0 推进，最终停在 maxMid（= 序列长 − 3），
      // 中央行（行 midIdx + CENTER）最终显示 seq[maxMid+1] = target
      const seq = buildRollSeq(target, ROLL_RANDOM_COUNT);
      const maxMid = seq.length - 3; // finish 后中央行 = seq[maxMid+1] = target
      fillReel(seq); // 一次填好 42 行静态条带，动画只滑动 translateY
      const start = performance.now();

      // 滚动总距离（px），让相同序列滚动得更快或更慢
      function frame(now) {
        const progress = Math.min((now - start) / ROLL_DURATION, 1);
        // ease-out 减速
        const ease = 1 - Math.pow(1 - progress, 3);
        const mid = ease * maxMid;
        renderFrame(seq, mid);

        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          finish(seq, maxMid);
          resolve();
        }
      }

      requestAnimationFrame(frame);
    });
  }

  /** 动画收尾：中央行命中高亮。
   * 条带行数 = 序列长度，终点（midIdx）时视口显示 DOM 行
   * [midIdx, midIdx+2]，屏幕正中的中央行即 midIdx + CENTER。
   */
  function finish(seq, midIdx) {
    rows.forEach((row) => row.classList.remove("center", "hit"));
    renderFrame(seq, midIdx);
    const hitRow = rows[midIdx + CENTER];
    hitRow.classList.add("center", "hit");
  }

  // ---------- 抽取入口 ----------
  async function onDraw() {
    if (isDrawing) return;

    const target = randomPick();
    if (target === null) {
      refreshStatus();
      return;
    }
    if (!initCoreError && !rosterLoadError) {
      // 用户主动抽取：显式取代此前所有非核心提示。
      statusPriority = 0;
      statusOwner = OWNER_ROSTER;
    }
    const drawRevision = rosterRevision;

    await rollTo(target);

    // 名单在动画期间变化时，旧目标已不再属于本次抽取；不能提交为赢家。
    if (drawRevision !== rosterRevision) {
      isDrawing = false;
      resetReel();
      refreshStatus();
      if (rosterLoadError) {
        setStatus("名单更新失败", STATUS_CORE, OWNER_CORE);
      } else {
        setStatus("名单已更新，本次抽取已取消", STATUS_DRAW, OWNER_DRAW);
      }
      return;
    }

    // 抽中加入已点名
    picked.add(target);
    isDrawing = false;
    refreshStatus();
    setStatus(`🏆 天选之子：${target}`, STATUS_DRAW, OWNER_DRAW);
  }

  // ---------- 重置 ----------
  function resetReel() {
    rows.forEach((row, i) => {
      row.classList.remove("center", "hit");
      row.style.fontSize = "";
      row.textContent = i === CENTER ? "🎲" : "";
    });
    slotList.style.transform = "translateY(0px)";
  }

  function onReset() {
    // 动画播放中忽略重置：避免动画结束后被 onDraw 收尾覆盖（picked 误加一人、状态被改写）
    if (isDrawing) return;
    picked.clear();
    resetReel();
    if (!initCoreError && !rosterLoadError) {
      statusPriority = 0;
      statusOwner = OWNER_ROSTER;
    }
    refreshStatus();
  }

  // ---------- 条带构建 ----------
  /**
   * 按滚动序列长度构建条带 DOM 行（行数 = 序列长度），
   * 视口 240px 在滚动全程始终被条带覆盖，终点目标行恰好停在视口正中。
   */
  function buildSlotRows() {
    rows = [];
    for (let i = 0; i < ROLL_ROWS; i++) {
      const row = document.createElement("div");
      row.className = "slot-row";
      slotList.appendChild(row);
      rows.push(row);
    }
  }

  // ---------- 主题与设置 ----------
  /** 设置读取失败后，任何视觉状态或写回都必须先中止（回退输入框到仍有效的磁盘设置）。 */
  function throwIfSettingsLoadFailed() {
    if (!settingsLoadFailed) return;
    bgInput.value = currentSettings.background;
    setStatus("读取设置失败", STATUS_NOTICE, OWNER_NOTICE_SETTINGS);
    throw new Error("设置读取失败");
  }

  async function applyTheme(theme) {
    throwIfSettingsLoadFailed();
    settingsRevision += 1;
    document.body.dataset.theme = theme;
    segBtns.forEach((b) => b.classList.toggle("active", b.dataset.theme === theme));
    await saveCurrentSettings({ theme });
    clearNoticeStatus(OWNER_NOTICE_SETTINGS);
    refreshStatus();
  }

  // 界面方案：mist / chalk（晨雾林窗 / 绿板粉笔）
  async function applyScheme(scheme) {
    throwIfSettingsLoadFailed();
    settingsRevision += 1;
    document.body.dataset.scheme = scheme;
    schemeSegBtns.forEach((b) => b.classList.toggle("active", b.dataset.scheme === scheme));
    await saveCurrentSettings({ scheme });
    clearNoticeStatus(OWNER_NOTICE_SETTINGS);
    refreshStatus();
  }

  async function applyBackground(filename) {
    throwIfSettingsLoadFailed();
    settingsRevision += 1;
    const requestRevision = ++backgroundRequestRevision;
    const requestState = { revision: requestRevision, settled: false, applied: false };
    latestBackgroundRequest = requestState;
    if (filename) {
      let dataUrl;
      try {
        dataUrl = await API.readBackground(filename);
      } catch (e) {
        if (requestRevision !== backgroundRequestRevision) return;
        requestState.settled = true;
        // 设置读取失败优先：禁止用新背景覆盖仍有效的旧视觉状态。
        throwIfSettingsLoadFailed();
        // IPC/权限等瞬时错误不应删除仍然有效的背景设置。
        console.warn("读取背景图片失败", e);
        bgInput.value = currentSettings.background;
        setStatus("背景图片读取失败", STATUS_NOTICE, OWNER_NOTICE_BACKGROUND);
        return;
      }
      if (requestRevision !== backgroundRequestRevision) return;
      requestState.settled = true;
      // 读取期间设置加载可能失败；此时不得推进版本或修改视觉状态。
      throwIfSettingsLoadFailed();
      if (dataUrl) {
        requestState.applied = true;
        lastAppliedBackgroundRevision = requestRevision;
        document.body.style.backgroundImage = `url("${dataUrl}")`;
        await saveCurrentSettings({ background: filename });
        clearNoticeStatus(OWNER_NOTICE_BACKGROUND);
        refreshStatus();
        return;
      }
      requestState.applied = true;
      lastAppliedBackgroundRevision = requestRevision;
      setStatus(`未找到背景图片：${filename}`, STATUS_NOTICE, OWNER_NOTICE_BACKGROUND);
      // 明确返回 null 表示文件不存在，回退默认背景并清除设置。
      document.body.style.backgroundImage = "";
      await saveCurrentSettings({ background: "" });
    } else {
      requestState.settled = true;
      requestState.applied = true;
      lastAppliedBackgroundRevision = requestRevision;
      document.body.style.backgroundImage = "";
      await saveCurrentSettings({ background: "" });
      clearNoticeStatus(OWNER_NOTICE_BACKGROUND);
      refreshStatus();
    }
  }

  let currentSettings = { theme: "dark", scheme: "mist", background: "" };
  let settingsSaveTail = Promise.resolve();
  let settingsRevision = 0;
  let settingsLoadPatches = null;
  let settingsLoadFailed = false;
  let backgroundRequestRevision = 0;
  let latestBackgroundRequest = null;
  let lastAppliedBackgroundRevision = 0;

  async function saveCurrentSettings(patch) {
    throwIfSettingsLoadFailed();
    if (settingsLoadPatches) Object.assign(settingsLoadPatches, patch);
    const snapshot = { ...currentSettings, ...patch };
    currentSettings = snapshot;

    // 只让相邻保存相互等待；队列本身吞掉失败，调用者仍收到本次保存的真实结果。
    const savePromise = settingsSaveTail
      .catch(() => undefined)
      .then(() => {
        // 任务入队时设置可能尚未加载完成；真正执行前必须再次阻断写回。
        throwIfSettingsLoadFailed();
        return API.saveSettings(snapshot);
      });
    settingsSaveTail = savePromise.catch(() => undefined);

    try {
      await savePromise;
      clearNoticeStatus(OWNER_NOTICE_SETTINGS);
    } catch (e) {
      console.warn("保存设置失败", e);
      if (settingsLoadFailed) {
        setStatus("读取设置失败", STATUS_NOTICE, OWNER_NOTICE_SETTINGS);
      } else {
        setStatus("设置保存失败", STATUS_NOTICE, OWNER_NOTICE_SETTINGS);
      }
      throw e;
    }
  }

  async function loadAndApplySettings() {
    const loadRevision = settingsRevision;
    const backgroundLoadRevision = backgroundRequestRevision;
    settingsLoadPatches = {};
    settingsLoadFailed = false;
    let loadedSettings = null;
    let settingsWarning = "";

    try {
      const loaded = await API.loadSettings();
      loadedSettings = {
        theme: loaded?.theme === "light" ? "light" : "dark",
        scheme: loaded?.scheme === "chalk" ? "chalk" : "mist",
        background: typeof loaded?.background === "string" ? loaded.background : "",
      };
    } catch (e) {
      settingsLoadFailed = true;
      settingsWarning = "读取设置失败";
      console.warn("加载设置失败", e);
      setStatus(settingsWarning, STATUS_NOTICE, OWNER_NOTICE_SETTINGS);
    }

    const changedDuringLoad = loadRevision !== settingsRevision;
    const userPatches = { ...settingsLoadPatches };
    settingsLoadPatches = null;

    if (loadedSettings && changedDuringLoad) {
      // 初始化期间的用户操作优先于尚未到达的默认值，但未修改字段必须保留加载结果。
      currentSettings = { ...loadedSettings, ...userPatches };
      if (Object.keys(userPatches).length > 0) {
        // 补偿保存仍进入队列，但设置 IPC 卡住也不能阻断名单、监听器和 watcher 初始化。
        void saveCurrentSettings(userPatches).catch(() => undefined);
      }
    } else if (loadedSettings) {
      currentSettings = loadedSettings;
    }

    if (changedDuringLoad && !loadedSettings) return settingsWarning;
    document.body.dataset.theme = currentSettings.theme;
    segBtns.forEach((b) => b.classList.toggle("active", b.dataset.theme === currentSettings.theme));
    document.body.dataset.scheme = currentSettings.scheme;
    schemeSegBtns.forEach((b) => b.classList.toggle("active", b.dataset.scheme === currentSettings.scheme));
    const newerBackgroundRequest =
      latestBackgroundRequest && latestBackgroundRequest.revision > backgroundLoadRevision
        ? latestBackgroundRequest
        : null;
    if (!newerBackgroundRequest || newerBackgroundRequest.settled) {
      bgInput.value = currentSettings.background;
    }

    let backgroundWarning = "";
    if (currentSettings.background && !newerBackgroundRequest?.applied) {
      const requestRevision = backgroundLoadRevision;
      try {
        const dataUrl = await API.readBackground(currentSettings.background);
        const latestRequest = latestBackgroundRequest;
        if (
          requestRevision < lastAppliedBackgroundRevision ||
          (requestRevision !== backgroundRequestRevision &&
            latestRequest &&
            latestRequest.revision > requestRevision &&
            latestRequest.applied)
        ) {
          return "";
        }
        if (dataUrl) {
          document.body.style.backgroundImage = `url("${dataUrl}")`;
        } else {
          document.body.style.backgroundImage = "";
          backgroundWarning = `未找到背景图片：${currentSettings.background}`;
          setStatus(backgroundWarning, STATUS_NOTICE, OWNER_NOTICE_BACKGROUND);
        }
      } catch (e) {
        const latestRequest = latestBackgroundRequest;
        if (
          requestRevision < lastAppliedBackgroundRevision ||
          (requestRevision !== backgroundRequestRevision &&
            latestRequest &&
            latestRequest.revision > requestRevision &&
            latestRequest.applied)
        ) {
          return "";
        }
        console.warn("读取背景图片失败", e);
        document.body.style.backgroundImage = "";
        backgroundWarning = "背景图片读取失败";
        setStatus(backgroundWarning, STATUS_NOTICE, OWNER_NOTICE_BACKGROUND);
      }
    }
    return backgroundWarning || settingsWarning;
  }

  // ---------- 文件变化同步 ----------
  function handleRosterChanged(payload) {
    try {
      applyRoster(payload);
    } catch (e) {
      // 畸形事件不能替换上一份合法名单，也不能让事件回调抛出未处理异常。
      console.warn("名单更新失败", e);
      showRosterError("名单更新失败");
    }
  }

  async function refreshRoster(syncBaseline = rosterRevision) {
    const requestRevision = rosterRevision;
    try {
      const roster = await API.getRoster();

      // 监听建立后已经收到过事件时，初始读取可能来自旧快照，不能回退状态。
      if (requestRevision !== rosterRevision || syncBaseline !== rosterRevision) {
        return true;
      }
      applyRoster(roster);
      return true;
    } catch (e) {
      // 新事件已经提供了更新时，不让旧请求的错误覆盖它。
      if (requestRevision !== rosterRevision || syncBaseline !== rosterRevision) {
        return true;
      }
      console.error("读取名单失败", e);
      showRosterError("读取名单失败");
      return false;
    }
  }

  // ---------- 响应式等比缩放 ----------
  // 整个 UI（老虎机/字号/按钮/间距）随窗口尺寸按 min(宽比, 高比) 等比 zoom 缩放。
  // - 基准 = 窗口默认尺寸 800×500（与 tauri.conf.json 保持一致）；
  // - 范围 0.7~1.15：上限封顶（全屏不会无脑放大），下限保险（min 窗口实际 ≥0.8）；
  // - 仅渲染缩放：DOM 逻辑尺寸不变，动画几何（行高 80 / 视口 240 / 条带 42）零影响。
  const SHELL = document.querySelector(".ui-shell");
  const DESIGN_WIDTH = 800;
  const DESIGN_HEIGHT = 500;
  const SCALE_MIN = 0.7;
  const SCALE_MAX = 1.15;

  function applyLayoutScale() {
    const scale = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
    const clamped = Math.min(Math.max(scale, SCALE_MIN), SCALE_MAX);
    SHELL.style.zoom = String(clamped);
  }

  window.addEventListener("resize", applyLayoutScale);

  // ---------- 初始化 ----------
  async function init() {
    // 应用布局缩放（resize 由上方监听实时更新）
    applyLayoutScale();

    // 在首次 await 前完成初始复位，之后初始化期间完成的抽取不会被擦除。
    buildSlotRows();
    resetReel();

    // 设置/背景属于非核心链路；即使 IPC 长时间未返回，也要先启动名单同步。
    let backgroundWarning = "";
    let coreReadyForBackgroundWarning = false;
    void loadAndApplySettings()
      .then((warning) => {
        if (warning) backgroundWarning = warning;
        if (warning && coreReadyForBackgroundWarning) {
          setStatus(warning, STATUS_NOTICE, warning === "读取设置失败" ? OWNER_NOTICE_SETTINGS : OWNER_NOTICE_BACKGROUND);
        }
      })
      .catch((e) => console.warn("加载设置失败", e));
    const syncBaseline = rosterRevision;

    // 必须先等待监听注册，再启动 watcher，最后读取一次权威名单。
    let listenerReady = false;
    try {
      await API.onRosterChanged(handleRosterChanged);
      listenerReady = true;
    } catch (e) {
      console.error("名单同步监听失败", e);
    }

    let watcherReady = false;
    try {
      await API.watchRosterFiles();
      watcherReady = true;
    } catch (e) {
      console.error("启动文件监视失败", e);
    }

    const rosterLoaded = await refreshRoster(syncBaseline);
    coreReadyForBackgroundWarning = rosterLoaded && listenerReady && watcherReady;

    if (!rosterLoaded) return;
    if (!listenerReady) {
      initCoreError = true;
      setStatus("名单同步监听失败", STATUS_CORE, OWNER_CORE);
      return;
    }
    if (!watcherReady) {
      initCoreError = true;
      setStatus("名单已读取，但自动同步失败", STATUS_CORE, OWNER_CORE);
      return;
    }
    if (backgroundWarning) {
      setStatus(
        backgroundWarning,
        STATUS_NOTICE,
        backgroundWarning === "读取设置失败" ? OWNER_NOTICE_SETTINGS : OWNER_NOTICE_BACKGROUND
      );
      return;
    }
    refreshStatus();
  }

  function handleSettingAction(action) {
    const actionPromise = Promise.resolve().then(action);
    // 事件系统会忽略返回的 Promise；先挂一个观察分支，避免真实页面出现未处理 rejection，
    // 同时把原始 rejection 返回给测试和其他调用者。
    actionPromise.catch((e) => console.warn("设置操作失败", e));
    return actionPromise;
  }

  // ---------- 事件绑定 ----------
  drawBtn.addEventListener("click", onDraw);
  resetBtn.addEventListener("click", onReset);
  themeBtn.addEventListener("click", () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    return handleSettingAction(() => applyTheme(next));
  });
  settingsBtn.addEventListener("click", () => (settingsOverlay.hidden = false));
  panelCloseBtn.addEventListener("click", () => (settingsOverlay.hidden = true));
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) settingsOverlay.hidden = true;
  });
  segBtns.forEach((btn) =>
    btn.addEventListener("click", () => handleSettingAction(() => applyTheme(btn.dataset.theme)))
  );
  schemeSegBtns.forEach((btn) =>
    btn.addEventListener("click", () => handleSettingAction(() => applyScheme(btn.dataset.scheme)))
  );
  bgInput.addEventListener("change", () =>
    handleSettingAction(() => applyBackground(bgInput.value.trim()))
  );
  openDirBtn.addEventListener("click", async () => {
    try {
      await API.openAppDir();
    } catch (e) {
      console.warn("打开目录失败", e);
      alert("打开目录失败，请检查应用目录是否存在");
    }
  });

  // 启动
  init().catch((e) => {
    console.error("初始化失败", e);
    showRosterError("初始化失败");
  });
})();