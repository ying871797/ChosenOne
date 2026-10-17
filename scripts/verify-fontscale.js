/* 验证脚本：字体大小（fontScale）设置全链路（最小 DOM 桩 + 真实 src/main.js）。
 * 断言：
 *   1) 加载归一化：fontScale=9.9（越界）→ 3.2，CSS 变量/行高/视口/滑条/读数同步；
 *   2) tier 档位 × 系数：抽取 12 字名 → 行内字号 = round(24 × s)；
 *   3) 实时预览：input 事件改 CSS 变量但不落盘，且已填行重刷；
 *   4) clamp 边界：0.1 → 0.8；系数 1.0 时 CSS 变量与基准像素恒等（42/46px、行高 80/视口 240）；
 *   5) 持久化：change 事件才调用 saveSettings，快照携带 fontScale。
 * 用法：node scripts/verify-fontscale.js
 */
"use strict";
const assert = require("assert");

// ---------- 最小 DOM 桩（与 verify-roll 同构） ----------
function makeEl(id) {
  const el = {
    id, className: "", textContent: "", value: "", style: {}, classSet: new Set(),
    children: [], listeners: {},
    classList: {
      add(...cs) { cs.forEach((c) => el.classSet.add(c)); },
      remove(...cs) { cs.forEach((c) => el.classSet.delete(c)); },
    },
    appendChild(c) { el.children.push(c); },
    addEventListener(t, f) { (el.listeners[t] || (el.listeners[t] = [])).push(f); },
    dispatch(t) { (el.listeners[t] || []).forEach((f) => f({ target: el })); },
    querySelectorAll() { return []; },
    dataset: {}, hidden: false, disabled: false,
  };
  return el;
}

const els = {
  slotList: makeEl("slotList"), drawBtn: makeEl("drawBtn"), resetBtn: makeEl("resetBtn"),
  pickedCount: makeEl("pickedCount"), excludedCount: makeEl("excludedCount"),
  statusHint: makeEl("statusHint"), themeBtn: makeEl("themeBtn"), settingsBtn: makeEl("settingsBtn"),
  settingsOverlay: makeEl("settingsOverlay"), panelCloseBtn: makeEl("panelCloseBtn"),
  bgInput: makeEl("bgInput"), openDirBtn: makeEl("openDirBtn"),
  fontScaleInput: makeEl("fontScaleInput"), fontScaleValue: makeEl("fontScaleValue"),
};
const uiShell = makeEl("ui-shell");

globalThis.document = {
  getElementById: (id) => els[id],
  querySelectorAll: () => [],
  querySelector: (sel) => (sel === ".ui-shell" ? uiShell : null),
  createElement: () => makeEl("row"),
  // CSS 变量驱动字号系数：桩用普通对象模拟 setProperty/getPropertyValue
  body: {
    dataset: { theme: "dark" },
    style: {
      vars: {},
      setProperty(k, v) { this.vars[k] = v; },
      getPropertyValue(k) { return this.vars[k] || ""; },
    },
  },
};

const savedSettings = []; // 捕获 saveSettings 快照
globalThis.window = {
  innerWidth: 800,
  innerHeight: 375,
  addEventListener: () => {},
  ChosenAPI: {
    getRoster: () =>
      Promise.resolve({
        // 单人名单（退化路径）：目标确定，12 字名走 tier 档位
        names: ["一二三四五六七八九十十一十二"],
        excluded: [],
      }),
    // 故意给越界值：验证前端 clamp（后端 load 已 clamp，前端兜底同类逻辑）
    loadSettings: () => Promise.resolve({ theme: "dark", fontScale: 9.9, background: "" }),
    saveSettings: (s) => { savedSettings.push(s); return Promise.resolve(); },
    getAppDir: () => Promise.resolve(""),
    openAppDir: () => Promise.resolve(),
    readBackground: () => Promise.resolve(null),
    watchRosterFiles: () => Promise.resolve(),
    onRosterChanged: () => () => {},
  },
  alert: () => {},
};
globalThis.alert = () => {};
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now() + 16), 16);

require("../src/main.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bodyStyle = document.body.style;

async function main() {
  await sleep(80); // 等 init（含 loadAndApplySettings）

  // 1) 加载归一化：9.9 → 3.2；CSS 变量 / 行高 / 视口 / 滑条 / 读数同步
  assert.strictEqual(bodyStyle.getPropertyValue("--name-size"), "134px", `9.9 应 clamp 到 3.2 → 134px，实际 ${bodyStyle.getPropertyValue("--name-size")}`);
  assert.strictEqual(bodyStyle.getPropertyValue("--name-size-center"), "147px", `中央行应 147px，实际 ${bodyStyle.getPropertyValue("--name-size-center")}`);
  assert.strictEqual(bodyStyle.getPropertyValue("--row-h"), "171px", `3.2 行高应 171px，实际 ${bodyStyle.getPropertyValue("--row-h")}`);
  assert.strictEqual(bodyStyle.getPropertyValue("--viewport-h"), "513px", `3.2 视口应 513px，实际 ${bodyStyle.getPropertyValue("--viewport-h")}`);
  assert.strictEqual(els.fontScaleInput.value, "3.2", `滑条应同步 3.2，实际 ${els.fontScaleInput.value}`);
  assert.strictEqual(els.fontScaleValue.textContent, "3.2×", `读数应 3.2×，实际 ${els.fontScaleValue.textContent}`);
  assert.strictEqual(savedSettings.length, 0, "仅加载不落盘");

  // 2) 抽取：12 字名 → tier base 24 × 3.2 → round(76.8) = 77px
  els.drawBtn.dispatch("click");
  await sleep(1700);
  const hit = els.slotList.children.find((r) => r.classSet.has("hit"));
  assert(hit, "应有高亮行");
  assert.strictEqual(hit.style.fontSize, "77px", `tier 应 24×3.2=77px，实际 ${hit.style.fontSize}`);

  // 3) 实时预览（input 不落盘）：0.1 → clamp 0.8，已填行同步重刷
  els.fontScaleInput.value = "0.1";
  els.fontScaleInput.dispatch("input");
  assert.strictEqual(bodyStyle.getPropertyValue("--name-size"), "34px", `0.8 应 → 34px，实际 ${bodyStyle.getPropertyValue("--name-size")}`);
  assert.strictEqual(bodyStyle.getPropertyValue("--name-size-center"), "37px", `中央行应 37px，实际 ${bodyStyle.getPropertyValue("--name-size-center")}`);
  assert.strictEqual(els.fontScaleInput.value, "0.8", "滑条回写归一化值");
  assert.strictEqual(els.fontScaleValue.textContent, "0.8×", `读数应 0.8×，实际 ${els.fontScaleValue.textContent}`);
  assert.strictEqual(hit.style.fontSize, "19px", `已填行应重刷为 24×0.8=19px，实际 ${hit.style.fontSize}`);
  assert.strictEqual(savedSettings.length, 0, "input 预览不落盘");

  // 4) change 才落盘：快照携带 fontScale（连同其余字段）
  els.fontScaleInput.dispatch("change");
  await sleep(30);
  assert.strictEqual(savedSettings.length, 1, `change 应落盘 1 次，实际 ${savedSettings.length}`);
  assert.strictEqual(savedSettings[0].fontScale, 0.8, `快照 fontScale 应 0.8，实际 ${savedSettings[0].fontScale}`);
  assert.strictEqual(savedSettings[0].scheme, "mist", "快照应携带 scheme");
  assert.strictEqual(savedSettings[0].background, "", "快照应携带 background");

  // 5) 系数 1.0 与基准像素恒等（回归不变量：行高/视口也回到 80/240）
  els.fontScaleInput.value = "1";
  els.fontScaleInput.dispatch("input");
  assert.strictEqual(bodyStyle.getPropertyValue("--name-size"), "42px", "1.0 应恒等 42px");
  assert.strictEqual(bodyStyle.getPropertyValue("--name-size-center"), "46px", "1.0 中央行应恒等 46px");
  assert.strictEqual(bodyStyle.getPropertyValue("--row-h"), "80px", "1.0 行高应恒等 80px");
  assert.strictEqual(bodyStyle.getPropertyValue("--viewport-h"), "240px", "1.0 视口应恒等 240px");
  assert.strictEqual(els.fontScaleValue.textContent, "1.0×", "读数应 1.0×");
  assert.strictEqual(hit.style.fontSize, "24px", `1.0 tier 应回 24px，实际 ${hit.style.fontSize}`);
  assert.strictEqual(savedSettings.length, 1, "1.0 预览仍不落盘");

  // 6) 行高增长临界点：1.5× 仍为 80px（旧几何逐位不变），2.0× 起随系数增大
  els.fontScaleInput.value = "1.5";
  els.fontScaleInput.dispatch("input");
  assert.strictEqual(bodyStyle.getPropertyValue("--row-h"), "80px", "1.5 行高应仍为 80px（旧几何不变）");
  assert.strictEqual(bodyStyle.getPropertyValue("--viewport-h"), "240px", "1.5 视口应仍为 240px");
  els.fontScaleInput.value = "2";
  els.fontScaleInput.dispatch("input");
  assert.strictEqual(bodyStyle.getPropertyValue("--row-h"), "107px", `2.0 行高应 107px，实际 ${bodyStyle.getPropertyValue("--row-h")}`);
  assert.strictEqual(bodyStyle.getPropertyValue("--viewport-h"), "321px", `2.0 视口应 321px，实际 ${bodyStyle.getPropertyValue("--viewport-h")}`);

  // 7) 重置不因系数逻辑崩溃
  els.resetBtn.dispatch("click");
  assert.strictEqual(els.slotList.style.transform, "translateY(0px)", "重置位移归 0");

  console.log("PASS 加载clamp=3.2 变量=134/147px 行高=171 视口=513 tier=77px 预览=34px(19px) 恒等=42/46+80/240 临界=1.5/80 2.0/107");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
