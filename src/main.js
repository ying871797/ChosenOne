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
  let currentHit = null;  // 当前抽中者（用于命中高亮）

  // ---------- DOM ----------
  const slotList = document.getElementById("slotList");
  const rows = Array.from(slotList.querySelectorAll(".slot-row"));
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
  const segBtns = Array.from(document.querySelectorAll(".seg-btn"));

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

  /** 随机取一个（仅从可抽池取，被排除者与已点名者不闪现） */
  function randomAny() {
    const pool = getPool();
    if (pool.length === 0) return "";
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---------- 更新界面状态 ----------
  function refreshStatus() {
    const pool = getPool();
    const total = allNames.length - excluded.length;
    pickedCount.textContent = `已点名 ${picked.size}/${total}`;
    excludedCount.textContent = `已排除 ${excluded.length}`;

    if (allNames.length === 0) {
      statusHint.textContent = "名单为空，请在应用目录创建 names.txt";
      drawBtn.disabled = true;
    } else if (pool.length === 0) {
      // 区分"全被排除/点名"与"无名单"
      if (excluded.length >= allNames.length) {
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
  const CENTER = 1;          // 中央可见行索引（5 行中，视口显示中间 3 行）

  /**
   * 构造老虎机滚动序列：前段随机填充 + 末尾连续 target，
   * 保证动画终点停在 target 上。
   */
  function buildRollSeq(target, count) {
    const seq = [];
    for (let i = 0; i < count; i++) seq.push(randomAny());
    // 末尾 2 个位置放 target，过渡到目标行
    seq.push(target, target);
    return seq;
  }

  /**
   * 按当前中部索引渲染 5 行并整体平移容器，形成连续上移效果。
   * seq[floor(mid)] 及后续行依次出现在行 0..4，offset 随 mid 连续变化。
   */
  function renderFrame(seq, mid) {
    const base = Math.floor(mid);
    rows.forEach((row, i) => {
      const k = Math.max(0, Math.min(seq.length - 1, base + i));
      row.textContent = seq[k];
    });
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
      currentHit = null;
      refreshStatus();

      // 中部索引从 0 推进，最终停在 seq 末尾 target 起始前 1 位，
      // 使中央行（行 1）最终显示 target
      const seq = buildRollSeq(target, 40);
      const maxMid = seq.length - 3; // finish 后中央行 = seq[maxMid+1] = target
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

  /** 动画收尾：中央行命中高亮 */
  function finish(seq, midIdx) {
    rows.forEach((row) => row.classList.remove("center", "hit"));
    renderFrame(seq, midIdx);
    rows[CENTER].classList.add("center", "hit");
    currentHit = seq[Math.floor(midIdx) + CENTER];
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
    picked.clear();
    currentHit = null;
    // 复位老虎机（中央行显示骰子）
    rows.forEach((row, i) => {
      row.classList.remove("center", "hit");
      row.textContent = i === CENTER ? "🎲" : "";
    });
    slotList.style.transform = "translateY(0px)";
    refreshStatus();
  }

  // ---------- 主题与设置 ----------
  async function applyTheme(theme) {
    document.body.dataset.theme = theme;
    segBtns.forEach((b) => b.classList.toggle("active", b.dataset.theme === theme));
    await saveCurrentSettings({ theme });
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

  let currentSettings = { theme: "dark", background: "" };

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

  // ---------- 初始化 ----------
  async function init() {
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