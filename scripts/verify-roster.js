/* 集成验证：真实 api.js mock + 真实 main.js，
 * 断言：52 人名单（学号 名称）、5 人排除精确匹配（可抽 47）、
 * 滚动中与终点都显示「学号 名称」、被排除者永不闪现。
 * 用法：node scripts/verify-roster.js
 */
"use strict";
const assert = require("assert");

function makeEl(id) {
  const el = {
    id, className: "", textContent: "", style: {}, classSet: new Set(), children: [], listeners: {},
    classList: { add(...cs){ cs.forEach(c => el.classSet.add(c)); }, remove(...cs){ cs.forEach(c => el.classSet.delete(c)); } },
    appendChild(c){ el.children.push(c); },
    addEventListener(t,f){ (el.listeners[t] || (el.listeners[t] = [])).push(f); },
    dispatch(t){ (el.listeners[t] || []).forEach(f => f({ target: el })); },
    querySelectorAll(){ return []; }, dataset: {}, hidden: false, disabled: false,
  };
  return el;
}
const els = {
  slotList: makeEl("slotList"), drawBtn: makeEl("drawBtn"), resetBtn: makeEl("resetBtn"),
  pickedCount: makeEl("pickedCount"), excludedCount: makeEl("excludedCount"),
  statusHint: makeEl("statusHint"), themeBtn: makeEl("themeBtn"), settingsBtn: makeEl("settingsBtn"),
  settingsOverlay: makeEl("settingsOverlay"), panelCloseBtn: makeEl("panelCloseBtn"),
  bgInput: makeEl("bgInput"), openDirBtn: makeEl("openDirBtn"),
};
const uiShell = makeEl("ui-shell");
globalThis.document = {
  getElementById: id => els[id], querySelectorAll: () => [],
  querySelector: sel => (sel === ".ui-shell" ? uiShell : null),
  createElement: () => makeEl("row"),
  body: { dataset: { theme: "dark" }, style: {} },
};
globalThis.window = {
  innerWidth: 800,
  innerHeight: 500,
  addEventListener: () => {},
}; // api.js 会挂 mock
globalThis.alert = () => {};
globalThis.requestAnimationFrame = fn => setTimeout(() => fn(performance.now() + 16), 16);

require("../src/api.js");   // 真实 mock 数据层
require("../src/main.js");  // 真实主逻辑

const sleep = ms => new Promise(r => setTimeout(r, ms));
const parseY = t => { const m = /translateY\((-?[\d.]+)px\)/.exec(t || ""); return m ? parseFloat(m[1]) : 0; };
function visibleRows() {
  const y = parseY(els.slotList.style.transform);
  return els.slotList.children
    .map((row, i) => ({ i, top: i * 80 + y, text: row.textContent }))
    .filter(r => r.top < 240 && r.top + 80 > 0 && r.text.length > 0);
}

async function main() {
  await sleep(120); // 等 init
  // 1) 名单/排除状态
  assert.strictEqual(els.excludedCount.textContent, "已排除 5", "应排除 5 人");
  assert(els.statusHint.textContent.includes("可抽 47 人"), `应可抽 47 人，实际 ${els.statusHint.textContent}`);
  assert(els.pickedCount.textContent.includes("/47"), `总数应为 47，实际 ${els.pickedCount.textContent}`);

  // 2) 抽取 1.9s：全程视口内容均为「学号 名称」且绝不含被排除者
  const excluded = new Set(["37 吴捷", "48 姬雨馨", "15 孙熙航", "4 徐乙苏", "1 韩梓睿"]);
  els.drawBtn.dispatch("click");
  let sawMidContent = false;
  const preLandingSeen = new Set(); // 收集落定前（t≤800ms）可见文本，用于 Q2 不剧透断言
  for (let t = 200; t <= 1700; t += 300) {
    const vis = visibleRows();
    if (vis.length >= 2 && !sawMidContent) sawMidContent = true;
    for (const r of vis) {
      assert(/^\d+ \S+$/.test(r.text), `滚动内容应为「学号 名称」，实际 "${r.text}"`);
      assert(!excluded.has(r.text), `被排除者不应闪现：${r.text}`);
      if (t <= 800) preLandingSeen.add(r.text);
    }
    await sleep(300);
  }
  assert(sawMidContent, "滚动中途视口应有内容");

  // 3) 终点：居中行 = 状态栏目标，带高亮
  const status = els.statusHint.textContent;
  const target = /天选之子：(.+)$/.exec(status);
  assert(target, `状态栏应有天选之子，实际 "${status}"`);
  const centered = visibleRows().find(r => r.top <= 80 && r.top + 80 > 80);
  assert(centered, "终点应有屏幕正中行");
  assert.strictEqual(centered.text, target[1], `正中行应=目标 ${target[1]}，实际 ${centered.text}`);
  const hitRow = els.slotList.children.find(r => r.classSet.has("hit"));
  assert(hitRow && hitRow.classSet.has("center"), "中央行应有高亮");
  assert(!excluded.has(centered.text), "终点绝不可能是被排除者");
  // Q2：滚动途中不剧透赢家
  assert(!preLandingSeen.has(centered.text), `滚动中途不应闪现目标 ${centered.text}（实际 ${[...preLandingSeen].join("/")}）`);
  // Q1/Q3：终点视口三行互异
  const triplet = visibleRows().map((r) => r.text);
  assert.strictEqual(new Set(triplet).size, 3, `终点三行应互异：${triplet.join("/")}`);

  console.log("PASS 可抽=47 目标=" + target[1] + " 正中行=" + centered.text + " 三行=" + triplet.join("/") + " 位移=" + parseY(els.slotList.style.transform));
}
main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });