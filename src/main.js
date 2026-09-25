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

  // ---------- 可抽池 ----------
  /** 可抽池 = 名单 − 排除 − 已点名 */
  function getPool() {
    const excludedSet = new Set(excluded);
    return allNames.filter((n) => !excludedSet.has(n) && !picked.has(n));
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
    const pool = getPool();
    // 应点名总人数 = 名单数 − 命中名单中的排除数。
    // excluded.txt 可能含名单外名字，直接用 excluded.length 会算小甚至为负。
    const excludedInRoster = excluded.filter((n) => allNames.includes(n)).length;
    const total = allNames.length - excludedInRoster;
    pickedCount.textContent = `已点名 ${picked.size}/${total}`;
    excludedCount.textContent = `已排除 ${excludedInRoster}`;

    if (allNames.length === 0) {
      statusHint.textContent = "名单为空，请在应用目录创建 names.txt";
      drawBtn.disabled = true;
    } else if (pool.length === 0) {
      // 区分"全被排除/点名"与"无名单"
      if (excludedInRoster >= allNames.length) {
        statusHint.textContent = "所有人均在排除名单中，无可抽对象";
      } else {
        statusHint.textContent = "全部已点名，请点击重置";
      }
      drawBtn.disabled = true;
    } else {
      statusHint.textContent = isDrawing ? "抽选中…" : `可抽 ${pool.length} 人`;
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

    await rollTo(target);

    // 抽中加入已点名
    picked.add(target);
    isDrawing = false;
    refreshStatus();
    statusHint.textContent = `🏆 天选之子：${target}`;
  }

  // ---------- 重置 ----------
  function onReset() {
    // 动画播放中忽略重置：避免动画结束后被 onDraw 收尾覆盖（picked 误加一人、状态被改写）
    if (isDrawing) return;
    picked.clear();
    // 复位老虎机（中央行显示骰子）
    rows.forEach((row, i) => {
      row.classList.remove("center", "hit");
      row.style.fontSize = "";
      row.textContent = i === CENTER ? "🎲" : "";
    });
    slotList.style.transform = "translateY(0px)";
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
  async function applyTheme(theme) {
    document.body.dataset.theme = theme;
    segBtns.forEach((b) => b.classList.toggle("active", b.dataset.theme === theme));
    await saveCurrentSettings({ theme });
  }

  // 界面方案：mist / chalk（晨雾林窗 / 绿板粉笔）
  async function applyScheme(scheme) {
    document.body.dataset.scheme = scheme;
    schemeSegBtns.forEach((b) => b.classList.toggle("active", b.dataset.scheme === scheme));
    await saveCurrentSettings({ scheme });
  }

  async function applyBackground(filename) {
    if (filename) {
      try {
        const dataUrl = await API.readBackground(filename);
        if (dataUrl) {
          document.body.style.backgroundImage = `url("${dataUrl}")`;
          await saveCurrentSettings({ background: filename });
          return;
        }
        statusHint.textContent = `未找到背景图片：${filename}`;
      } catch (e) {
        console.warn("读取背景图片失败", e);
        statusHint.textContent = "背景图片读取失败";
      }
      // 处理失败则回退默认背景
      document.body.style.backgroundImage = "";
      await saveCurrentSettings({ background: "" });
    } else {
      document.body.style.backgroundImage = "";
      await saveCurrentSettings({ background: "" });
    }
  }

  let currentSettings = { theme: "dark", scheme: "mist", background: "" };

  async function saveCurrentSettings(patch) {
    currentSettings = { ...currentSettings, ...patch };
    try {
      await API.saveSettings(currentSettings);
    } catch (e) {
      console.warn("保存设置失败", e);
    }
  }

  async function loadAndApplySettings() {
    try {
      currentSettings = await API.loadSettings();
    } catch (e) {
      console.warn("加载设置失败", e);
    }
    document.body.dataset.theme = currentSettings.theme || "dark";
    segBtns.forEach((b) =>
      b.classList.toggle("active", b.dataset.theme === (currentSettings.theme || "dark"))
    );
    document.body.dataset.scheme = currentSettings.scheme || "mist";
    schemeSegBtns.forEach((b) =>
      b.classList.toggle("active", b.dataset.scheme === (currentSettings.scheme || "mist"))
    );
    if (currentSettings.background) {
      const dataUrl = await API.readBackground(currentSettings.background);
      if (dataUrl) {
        document.body.style.backgroundImage = `url("${dataUrl}")`;
      }
    }
  }

  // ---------- 文件变化同步 ----------
  async function refreshRoster() {
    try {
      const roster = await API.getRoster();
      allNames = roster.names || [];
      excluded = roster.excluded || [];
      refreshStatus();
    } catch (e) {
      console.error("读取名单失败", e);
      statusHint.textContent = "读取名单失败";
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

    // 构建条带行（行数 = 滚动序列长度）
    buildSlotRows();

    // 加载设置
    await loadAndApplySettings();

    // 首次读取名单
    await refreshRoster();

    // 启动文件监视
    try {
      await API.watchRosterFiles();
      API.onRosterChanged((payload) => {
        allNames = payload.names || [];
        excluded = payload.excluded || [];
        // 名单变化不影响已点名（picked 保留，符合会话语义）
        refreshStatus();
      });
    } catch (e) {
      console.error("启动文件监视失败", e);
    }

    // 初始复位老虎机
    onReset();
  }

  // ---------- 事件绑定 ----------
  drawBtn.addEventListener("click", onDraw);
  resetBtn.addEventListener("click", onReset);
  themeBtn.addEventListener("click", async () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    await applyTheme(next);
  });
  settingsBtn.addEventListener("click", () => (settingsOverlay.hidden = false));
  panelCloseBtn.addEventListener("click", () => (settingsOverlay.hidden = true));
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) settingsOverlay.hidden = true;
  });
  segBtns.forEach((btn) =>
    btn.addEventListener("click", () => applyTheme(btn.dataset.theme))
  );
  schemeSegBtns.forEach((btn) =>
    btn.addEventListener("click", () => applyScheme(btn.dataset.scheme))
  );
  bgInput.addEventListener("change", () => applyBackground(bgInput.value.trim()));
  openDirBtn.addEventListener("click", async () => {
    try {
      await API.openAppDir();
    } catch (e) {
      console.warn("打开目录失败", e);
      alert("打开目录失败，请检查应用目录是否存在");
    }
  });

  // 启动
  init();
})();