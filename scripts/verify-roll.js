/* 验证脚本：用最小 DOM 桩运行真实 src/main.js 的老虎机滚动，
 * 断言视口几何不变量（滚动中不空白 / 终点停驻目标行 / 居中高亮 / 重置）。
 * 用法：node scripts/verify-roll.js [--long]
 */
"use strict";
const assert = require("assert");

const LONG = process.argv.includes("--long");

// ---------- 最小 DOM 桩 ----------
function makeEl(id) {
  const el = {
    id,
    className: "",
    textContent: "",
    style: {},
    classSet: new Set(),
    children: [],
    listeners: {},
    classList: {
      add(...cs) { cs.forEach((c) => el.classSet.add(c)); },
      remove(...cs) { cs.forEach((c) => el.classSet.delete(c)); },
    },
    appendChild(child) { el.children.push(child); },
    addEventListener(type, fn) { (el.listeners[type] || (el.listeners[type] = [])).push(fn); },
    dispatch(type) { (el.listeners[type] || []).forEach((fn) => fn({ target: el })); },
    querySelectorAll() { return []; },
    dataset: {},
    hidden: false,
    disabled: false,
  };
  return el;
}

const els = {
  slotList: makeEl("slotList"),
  drawBtn: makeEl("drawBtn"),
  resetBtn: makeEl("resetBtn"),
  pickedCount: makeEl("pickedCount"),
  excludedCount: makeEl("excludedCount"),
  statusHint: makeEl("statusHint"),
  themeBtn: makeEl("themeBtn"),
  settingsBtn: makeEl("settingsBtn"),
  settingsOverlay: makeEl("settingsOverlay"),
  panelCloseBtn: makeEl("panelCloseBtn"),
  bgInput: makeEl("bgInput"),
  openDirBtn: makeEl("openDirBtn"),
};

const uiShell = makeEl("ui-shell");
globalThis.document = {
  getElementById: (id) => els[id],
  querySelectorAll: () => [],
  querySelector: (sel) => (sel === ".ui-shell" ? uiShell : null),
  createElement: () => makeEl("row"),
  body: { dataset: { theme: "dark" }, style: {} },
};

globalThis.window = {
  innerWidth: 800,
  innerHeight: 500,
  addEventListener: () => {},
  ChosenAPI: {
    getRoster: () =>
      Promise.resolve({
        names: LONG
          ? ["一二三四五六七八九十十一十二"]
          : ["张三", "李四", "王五", "赵六", "钱七", "孙八", "周九", "吴十"],
        excluded: [],
      }),
    loadSettings: () => Promise.resolve({ theme: "dark", background: "" }),
    saveSettings: () => Promise.resolve(),
    getAppDir: () => Promise.resolve(""),
    openAppDir: () => Promise.resolve(),
    readBackground: () => Promise.resolve(null),
    watchRosterFiles: () => Promise.resolve(),
    onRosterChanged: () => () => {},
  },
  alert: () => {},
};
globalThis.alert = () => {};
globalThis.requestAnimationFrame = (fn) =>
  setTimeout(() => fn(performance.now() + 16), 16);

// ---------- 载入真实实现 ----------
require("../src/main.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 从 transform 字符串解析 translateY
function parseY(transform) {
  const m = /translateY\((-?[\d.]+)px\)/.exec(transform || "");
  return m ? parseFloat(m[1]) : 0;
}

// 视口 = [0, 240)。返回可见行（含局部可见）
function visibleRows() {
  const y = parseY(els.slotList.style.transform);
  return els.slotList.children
    .map((row, i) => ({ i, top: i * 80 + y, text: row.textContent, font: row.style.fontSize || "(css)" }))
    .filter((r) => r.top < 240 && r.top + 80 > 0);
}

// 屏幕正中（y=80）所在行
function centerRow(vis) {
  return vis.find((r) => r.top <= 80 && r.top + 80 > 80);
}

async function main() {
  await sleep(80); // 等 init 完成

  // 0) 布局缩放：800×500（=设计基准）时 zoom 应为 1
  assert.strictEqual(uiShell.style.zoom, "1", `基准窗口下缩放应为 1，实际 ${uiShell.style.zoom}`);

  // 1) 条带构建：42 行；初始 3 行可见、🎲 居中
  assert.strictEqual(els.slotList.children.length, 42, "条带应为 42 行");
  const initVis = visibleRows();
  assert(initVis.length >= 3, `初始视口应至少 3 行可见，实际 ${initVis.length}`);
  const dice = centerRow(initVis);
  assert(dice && dice.text === "🎲", `初始正中行应为 🎲，实际 ${dice && dice.text}`);
  assert.strictEqual(parseY(els.slotList.style.transform), 0, "初始位移应为 0");

  // 2) 抽取：滚动中视口不空白，终点停驻目标
  els.drawBtn.dispatch("click");
  await sleep(400); // ~26% 进度（ease 0.60 → mid≈23.6），旧 bug 此时早已全空
  const midVis = visibleRows();
  const midFilled = midVis.filter((r) => r.text && r.text.length > 0);
  assert(midFilled.length >= 2, `滚动中视口不应空白：${JSON.stringify(midVis)}`);
  assert(midVis.some((r) => r.top <= 80 && r.top + 80 > 80), "滚动中屏幕正中应有内容");
  // 采样点 mid≈23.6（ease 0.60×39），处于随机段；用于 Q2 不剧透断言
  const midSeen = midFilled.map((r) => r.text);

  await sleep(1400); // 动画结束（1.5s）
  const endY = parseY(els.slotList.style.transform);
  assert.strictEqual(endY, -3120, `终点位移应为 -3120px，实际 ${endY}`);
  const endVis = visibleRows();
  assert.strictEqual(endVis.length, 3, `终点视口应恰好 3 行，实际 ${JSON.stringify(endVis)}`);
  const status = els.statusHint.textContent;
  const target = /天选之子：(.+)$/.exec(status);
  assert(target, `状态栏应显示天选之子，实际 "${status}"`);
  const t = target[1];
  const centered = centerRow(endVis);
  assert(centered, `终点应有屏幕正中行 ${JSON.stringify(endVis)}`);
  assert.strictEqual(centered.text, t, `正中行应显示目标 ${t}，实际 ${centered.text}`);
  const hitRow = els.slotList.children.find((r) => r.classSet.has("hit"));
  assert(hitRow && hitRow.classSet.has("center"), "正中行应有 center+hit 高亮");
  assert.strictEqual(hitRow.textContent, t, "高亮行文本应为目标");
  // Q2：滚动途中不剧透赢家（随机段排除目标）
  if (!LONG) {
    assert(!midSeen.includes(t), `滚动中途不应闪现目标 ${t}，实际可见 ${midSeen.join("/")}`);
  }
  // Q1/Q3：终点视口三行 —— 多人互异；单人性全部为目标名（退化）
  if (LONG) {
    const names = new Set(endVis.map((r) => r.text));
    assert.strictEqual(names.size, 1, `单人名次终点三行应为同一名字，实际 ${[...names].join("/")}`);
  } else {
    const names = new Set(endVis.map((r) => r.text));
    assert.strictEqual(names.size, 3, `终点三行应互异（含不与目标重复），实际 ${[...names].join("/")}`);
  }
  if (LONG) {
    assert.strictEqual(centered.font, "24px", `12 字名应缩至 24px，实际 ${centered.font}`);
  }

  // 3) 重置：位移归 0、🎲 回正中
  els.resetBtn.dispatch("click");
  const resetY = parseY(els.slotList.style.transform);
  assert.strictEqual(resetY, 0, `重置位移应为 0，实际 ${resetY}`);
  const resetVis = visibleRows();
  const dice2 = centerRow(resetVis);
  assert(dice2 && dice2.text === "🎲", "重置后正中行应为 🎲");

  console.log(
    "PASS" +
      (LONG ? "(long)" : "") +
      " 目标=" +
      t +
      " 行数=" +
      els.slotList.children.length +
      " 滚动中可见=" +
      midFilled.map((r) => r.text).join("/") +
      " 终点=" +
      endVis.map((r) => `${r.text}@${r.top}`).join(" ") +
      " 字体=" +
      centered.font
  );
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});