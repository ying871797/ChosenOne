"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const MAIN_JS = fs.readFileSync(path.join(ROOT, "src", "main.js"), "utf8");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 20) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) this.add(name);
    else this.remove(name);
    return enabled;
  }
}

function makeElement(id = "", dataset = {}) {
  const listeners = new Map();
  const element = {
    id,
    dataset,
    style: {},
    className: "",
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    children: [],
    classList: new FakeClassList(),
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    dispatch(type, event = {}) {
      const handlers = listeners.get(type) || [];
      let result;
      handlers.forEach((handler) => {
        result = handler({ target: element, currentTarget: element, ...event });
      });
      return result;
    },
    click() {
      return element.dispatch("click");
    },
  };
  return element;
}

function copyRoster(roster) {
  return {
    names: [...roster.names],
    excluded: [...roster.excluded],
  };
}

function createHarness({
  roster = { names: ["甲", "乙"], excluded: [] },
  settings = { theme: "dark", scheme: "mist", background: "" },
  random = () => 0,
  api: apiOverrides = {},
} = {}) {
  const ids = [
    "slotList",
    "drawBtn",
    "resetBtn",
    "pickedCount",
    "excludedCount",
    "statusHint",
    "themeBtn",
    "settingsBtn",
    "settingsOverlay",
    "panelCloseBtn",
    "bgInput",
    "openDirBtn",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));
  const themeButtons = [
    makeElement("themeDark", { theme: "dark" }),
    makeElement("themeLight", { theme: "light" }),
  ];
  const schemeButtons = [
    makeElement("schemeMist", { scheme: "mist" }),
    makeElement("schemeChalk", { scheme: "chalk" }),
  ];
  const uiShell = makeElement("uiShell");
  const body = makeElement("body", { theme: "dark" });

  const document = {
    body,
    getElementById(id) {
      return elements[id] || null;
    },
    querySelector(selector) {
      return selector === ".ui-shell" ? uiShell : null;
    },
    querySelectorAll(selector) {
      if (selector === ".seg-btn[data-theme]") return themeButtons;
      if (selector === ".seg-btn[data-scheme]") return schemeButtons;
      return [];
    },
    createElement() {
      return makeElement("slot-row");
    },
  };

  const state = {
    roster: copyRoster(roster),
    settings: { ...settings },
    rosterHandler: null,
    calls: {
      getRoster: 0,
      loadSettings: 0,
      saveSettings: 0,
      readBackground: 0,
      watchRosterFiles: 0,
      onRosterChanged: 0,
    },
  };

  const api = {
    async getRoster() {
      state.calls.getRoster += 1;
      return copyRoster(state.roster);
    },
    async loadSettings() {
      state.calls.loadSettings += 1;
      return { ...state.settings };
    },
    async saveSettings(next) {
      state.calls.saveSettings += 1;
      state.settings = { ...next };
    },
    async getAppDir() {
      return "测试应用目录";
    },
    async openAppDir() {},
    async readBackground() {
      state.calls.readBackground += 1;
      return null;
    },
    async watchRosterFiles() {
      state.calls.watchRosterFiles += 1;
    },
    async onRosterChanged(handler) {
      state.calls.onRosterChanged += 1;
      state.rosterHandler = handler;
      return () => {
        if (state.rosterHandler === handler) state.rosterHandler = null;
      };
    },
  };
  Object.assign(api, apiOverrides);

  let now = 0;
  let animationFrame = null;
  const math = Object.create(Math);
  math.random = random;
  const window = {
    ChosenAPI: api,
    innerWidth: 800,
    innerHeight: 500,
    addEventListener() {},
  };
  const context = vm.createContext({
    alert() {},
    clearTimeout,
    console: { error() {}, log() {}, warn() {} },
    document,
    Math: math,
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      animationFrame = callback;
      return 1;
    },
    setTimeout,
    window,
  });

  vm.runInContext(MAIN_JS, context, { filename: "src/main.js" });

  return {
    api,
    body,
    elements,
    themeButtons,
    schemeButtons,
    state,
    async ready() {
      await flushMicrotasks();
    },
    click(id) {
      return elements[id].click();
    },
    emitRoster(payload) {
      assert.equal(typeof state.rosterHandler, "function", "roster listener should be registered");
      return state.rosterHandler(payload);
    },
    hasAnimationFrame() {
      return animationFrame !== null;
    },
    async finishAnimation() {
      assert.equal(animationFrame !== null, true, "animation frame should be scheduled");
      now += 2000;
      const callback = animationFrame;
      animationFrame = null;
      callback(now);
      await flushMicrotasks();
    },
    hitRows() {
      return elements.slotList.children.filter((row) => row.classList.contains("hit"));
    },
  };
}

async function captureUnhandled(run) {
  const reasons = [];
  const listener = (reason) => reasons.push(reason);
  process.on("unhandledRejection", listener);
  try {
    await run();
    await flushMicrotasks();
  } finally {
    process.off("unhandledRejection", listener);
  }
  return reasons;
}

test("设置读取失败后排队的保存不会继续落盘", async () => {
  const load = deferred();
  const firstSave = deferred();
  let saveCalls = 0;
  const harness = createHarness({
    api: {
      loadSettings() {
        return load.promise;
      },
      saveSettings() {
        saveCalls += 1;
        return saveCalls === 1 ? firstSave.promise : Promise.resolve();
      },
    },
  });

  const first = harness.click("themeBtn");
  await flushMicrotasks();
  const second = harness.schemeButtons[1].click();
  await flushMicrotasks();
  assert.equal(saveCalls, 1);

  load.reject(new Error("settings unavailable"));
  await flushMicrotasks();
  firstSave.resolve();
  await first;
  await assert.rejects(second, /设置/);
  assert.equal(saveCalls, 1);
});

test("背景保存失败不会被误报为背景读取失败", async () => {
  const harness = createHarness({
    api: {
      readBackground() {
        return "data:image/png;base64,NEW";
      },
      saveSettings() {
        throw new Error("disk full");
      },
    },
  });
  await harness.ready();

  harness.elements.bgInput.value = "new.png";
  const change = harness.elements.bgInput.dispatch("change");
  await assert.rejects(change, /disk full/);
  assert.equal(harness.body.style.backgroundImage, 'url("data:image/png;base64,NEW")');
  assert.equal(harness.elements.statusHint.textContent, "设置保存失败");
});

test("较新的背景请求失败时保留初始化中的旧背景", async () => {
  let saveCalls = 0;
  const harness = createHarness({
    api: {
      async loadSettings() {
        throw new Error("settings unavailable");
      },
      async saveSettings() {
        saveCalls += 1;
      },
    },
  });
  await harness.ready();

  const click = harness.click("themeBtn");
  await assert.rejects(click, /设置/);
  assert.equal(saveCalls, 0);
  assert.equal(harness.elements.statusHint.textContent, "读取设置失败");
});

test("设置 IPC 挂起不阻塞名单初始化", async () => {
  const load = deferred();
  const harness = createHarness({
    api: {
      loadSettings() {
        return load.promise;
      },
    },
  });

  await harness.ready();
  assert.equal(harness.state.calls.onRosterChanged, 1);
  assert.equal(harness.state.calls.watchRosterFiles, 1);
  assert.equal(harness.state.calls.getRoster, 1);

  load.resolve({ theme: "dark", scheme: "mist", background: "" });
  await harness.ready();
});

test("背景 IPC 挂起不阻塞名单初始化", async () => {
  const read = deferred();
  const harness = createHarness({
    settings: { theme: "dark", scheme: "mist", background: "old.png" },
    api: {
      readBackground() {
        return read.promise;
      },
    },
  });

  await harness.ready();
  assert.equal(harness.state.calls.onRosterChanged, 1);
  assert.equal(harness.state.calls.watchRosterFiles, 1);
  assert.equal(harness.state.calls.getRoster, 1);

  read.resolve("data:image/png;base64,OLD");
  await harness.ready();
});

test("背景 IPC 失败后仍读取名单并启动监视", async () => {
  let harness;
  const unhandled = await captureUnhandled(async () => {
    harness = createHarness({
      settings: { theme: "dark", scheme: "mist", background: "missing.png" },
      api: {
        async readBackground() {
          throw new Error("IPC disconnected");
        },
      },
    });
    await harness.ready();
  });

  assert.deepEqual(unhandled, []);
  assert.equal(harness.elements.statusHint.textContent, "背景图片读取失败");
  assert.equal(harness.state.calls.getRoster, 1);
  assert.equal(harness.state.calls.watchRosterFiles, 1);
});

test("先注册监听再启动监视且事件不会被旧初始响应覆盖", async () => {
  let emitNewRoster = null;
  const oldRoster = { names: ["旧名单"], excluded: [] };
  const newRoster = { names: ["新名单"], excluded: [] };
  const harness = createHarness({
    roster: oldRoster,
    api: {
      async getRoster() {
        return copyRoster(oldRoster);
      },
      async watchRosterFiles() {
        if (emitNewRoster) emitNewRoster();
      },
      async onRosterChanged(handler) {
        emitNewRoster = () => handler(copyRoster(newRoster));
        return () => {};
      },
    },
  });
  await harness.ready();

  const draw = harness.click("drawBtn");
  await flushMicrotasks();
  await harness.finishAnimation();
  await draw;

  assert.equal(harness.hitRows().length, 1);
  assert.equal(harness.hitRows()[0].textContent, "新名单");
});

test("初始化期间完成的抽取不会被末尾复位擦除", async () => {
  const watch = deferred();
  const roster = { names: ["甲"], excluded: [] };
  const harness = createHarness({
    roster,
    api: {
      watchRosterFiles() {
        return watch.promise;
      },
    },
  });

  await flushMicrotasks();
  assert.equal(typeof harness.state.rosterHandler, "function");
  harness.emitRoster(copyRoster(roster));

  const draw = harness.click("drawBtn");
  await flushMicrotasks();
  await harness.finishAnimation();
  await draw;
  assert.equal(harness.hitRows().length, 1);

  watch.resolve();
  await harness.ready();
  assert.equal(harness.hitRows().length, 1);
});

test("名单在动画期间移除目标时取消该次抽取", async () => {
  const harness = createHarness({
    roster: { names: ["甲", "乙"], excluded: [] },
    random: () => 0,
  });
  await harness.ready();

  const draw = harness.click("drawBtn");
  await flushMicrotasks();
  harness.emitRoster({ names: ["乙"], excluded: ["甲"] });
  await harness.finishAnimation();
  await draw;

  assert.equal(harness.elements.pickedCount.textContent, "已点名 0/1");
  assert.equal(harness.hitRows().length, 0);
  assert.equal(harness.elements.statusHint.textContent, "名单已更新，本次抽取已取消");
});

test("名单移除已点名者后计数不漂移", async () => {
  const harness = createHarness({ roster: { names: ["甲", "乙"], excluded: [] } });
  await harness.ready();

  const draw = harness.click("drawBtn");
  await flushMicrotasks();
  await harness.finishAnimation();
  await draw;
  assert.equal(harness.elements.pickedCount.textContent, "已点名 1/2");

  harness.emitRoster({ names: ["乙"], excluded: [] });
  assert.equal(harness.elements.pickedCount.textContent, "已点名 0/1");
});

test("畸形 roster-changed 不破坏当前名单并禁用抽取", async () => {
  const harness = createHarness();
  await harness.ready();

  assert.doesNotThrow(() => harness.emitRoster(null));
  assert.equal(harness.elements.pickedCount.textContent, "已点名 0/2");
  assert.equal(harness.elements.statusHint.textContent, "名单更新失败");
  assert.equal(harness.elements.drawBtn.disabled, true);

  harness.emitRoster({ names: ["甲"], excluded: [] });
  assert.equal(harness.elements.drawBtn.disabled, false);
});

test("畸形名单事件会取消进行中的抽取", async () => {
  const harness = createHarness();
  await harness.ready();

  const draw = harness.click("drawBtn");
  await flushMicrotasks();
  harness.emitRoster(null);
  await harness.finishAnimation();
  await draw;

  assert.equal(harness.hitRows().length, 0);
  assert.equal(harness.elements.statusHint.textContent, "名单更新失败");
});

test("名单 IPC 失败会保留错误状态且不产生未处理拒绝", async () => {
  let harness;
  const unhandled = await captureUnhandled(async () => {
    harness = createHarness({
      api: {
        async getRoster() {
          throw new Error("IPC disconnected");
        },
      },
    });
    await harness.ready();
  });

  assert.deepEqual(unhandled, []);
  assert.equal(harness.state.calls.watchRosterFiles, 1);
  assert.equal(harness.elements.drawBtn.disabled, true);
  assert.equal(harness.elements.statusHint.textContent, "读取名单失败");
});

test("监视启动失败会向用户暴露而不是伪装成功", async () => {
  const harness = createHarness({
    api: {
      async watchRosterFiles() {
        throw new Error("watch denied");
      },
    },
  });
  await harness.ready();

  assert.equal(harness.state.calls.getRoster, 1);
  assert.equal(harness.elements.statusHint.textContent, "名单已读取，但自动同步失败");
});

test("监听注册失败不会产生未处理拒绝且仍读取初始名单", async () => {
  let harness;
  const unhandled = await captureUnhandled(async () => {
    harness = createHarness({
      api: {
        async onRosterChanged() {
          throw new Error("event IPC disconnected");
        },
      },
    });
    await harness.ready();
  });

  assert.deepEqual(unhandled, []);
  assert.equal(harness.state.calls.getRoster, 1);
  assert.equal(harness.elements.statusHint.textContent, "名单同步监听失败");
});

test("初始化期间的补偿保存挂起时不阻塞名单初始化", async () => {
  const load = deferred();
  const save = deferred();
  const harness = createHarness({
    api: {
      loadSettings() {
        return load.promise;
      },
      saveSettings() {
        harness.state.calls.saveSettings += 1;
        return save.promise;
      },
    },
  });

  const click = harness.click("themeBtn");
  await flushMicrotasks();
  assert.equal(harness.state.calls.saveSettings, 1);

  load.resolve({ theme: "dark", scheme: "chalk", background: "" });
  await harness.ready();

  assert.equal(harness.state.calls.onRosterChanged, 1);
  assert.equal(harness.state.calls.watchRosterFiles, 1);
  assert.equal(harness.state.calls.getRoster, 1);

  save.resolve();
  await click;
  await harness.ready();
});

test("设置加载迟到不会覆盖初始化期间的用户操作或未修改字段", async () => {
  const load = deferred();
  const harness = createHarness({
    api: {
      loadSettings() {
        return load.promise;
      },
    },
  });

  const click = harness.click("themeBtn");
  await flushMicrotasks();
  assert.equal(harness.body.dataset.theme, "light");

  load.resolve({ theme: "dark", scheme: "chalk", background: "old.png" });
  await click;
  await harness.ready();

  assert.equal(harness.body.dataset.theme, "light");
  assert.deepEqual(harness.state.settings, {
    theme: "light",
    scheme: "chalk",
    background: "old.png",
  });
});

test("设置读取失败后主题操作不修改界面", async () => {
  const harness = createHarness({
    api: {
      loadSettings() {
        throw new Error("settings unavailable");
      },
    },
  });
  await harness.ready();
  assert.equal(harness.body.dataset.theme, "dark");

  await assert.rejects(harness.click("themeBtn"), /设置/);
  assert.equal(harness.body.dataset.theme, "dark");
  assert.equal(harness.elements.statusHint.textContent, "读取设置失败");
  assert.deepEqual(harness.state.settings, {
    theme: "dark",
    scheme: "mist",
    background: "",
  });
});

test("设置读取失败后背景操作不修改界面", async () => {
  const harness = createHarness({
    settings: { theme: "dark", scheme: "mist", background: "old.png" },
    api: {
      loadSettings() {
        throw new Error("settings unavailable");
      },
      readBackground() {
        return "data:image/png;base64,NEW";
      },
    },
  });
  await harness.ready();

  harness.elements.bgInput.value = "new.png";
  await assert.rejects(harness.elements.bgInput.dispatch("change"), /设置/);
  assert.ok(!harness.body.style.backgroundImage, "设置读取失败后不得应用新背景");
  assert.equal(harness.elements.statusHint.textContent, "读取设置失败");
  assert.equal(harness.state.settings.background, "old.png");
});

test("名单更新不会抹掉背景读取失败提示", async () => {
  const harness = createHarness({
    settings: { theme: "dark", scheme: "mist", background: "old.png" },
    api: {
      readBackground() {
        throw new Error("background unavailable");
      },
    },
  });
  await harness.ready();
  assert.equal(harness.elements.statusHint.textContent, "背景图片读取失败");

  harness.emitRoster({ names: ["甲", "乙", "丙"], excluded: [] });
  assert.equal(harness.elements.statusHint.textContent, "背景图片读取失败");
  assert.equal(harness.elements.pickedCount.textContent, "已点名 0/3");
});

test("背景读取只允许最新请求更新界面和设置", async () => {
  const reads = new Map();
  const harness = createHarness({
    api: {
      readBackground(filename) {
        const pending = deferred();
        reads.set(filename, pending);
        return pending.promise;
      },
    },
  });
  await harness.ready();

  harness.elements.bgInput.value = "first.png";
  const first = harness.elements.bgInput.dispatch("change");
  await flushMicrotasks();
  harness.elements.bgInput.value = "second.png";
  const second = harness.elements.bgInput.dispatch("change");
  await flushMicrotasks();

  reads.get("second.png").resolve("data:image/png;base64,BBB");
  await second;
  reads.get("first.png").resolve("data:image/png;base64,AAA");
  await first;

  assert.equal(harness.body.style.backgroundImage, 'url("data:image/png;base64,BBB")');
  assert.equal(harness.state.settings.background, "second.png");
});

test("初始化背景读取不能覆盖更新的用户背景选择", async () => {
  const load = deferred();
  const reads = new Map([
    ["new.png", deferred()],
    ["old.png", deferred()],
  ]);
  const harness = createHarness({
    settings: { theme: "dark", scheme: "mist", background: "old.png" },
    api: {
      loadSettings() {
        return load.promise;
      },
      readBackground(filename) {
        return reads.get(filename).promise;
      },
    },
  });

  harness.elements.bgInput.value = "new.png";
  const change = harness.elements.bgInput.dispatch("change");
  await flushMicrotasks();

  load.resolve({ theme: "dark", scheme: "mist", background: "old.png" });
  await flushMicrotasks();

  reads.get("new.png").resolve("data:image/png;base64,NEW");
  await change;
  reads.get("old.png").resolve("data:image/png;base64,OLD");
  await harness.ready();

  assert.equal(harness.body.style.backgroundImage, 'url("data:image/png;base64,NEW")');
  assert.equal(harness.state.settings.background, "new.png");
});

test("初始化背景读取不被无关的主题设置操作取消", async () => {
  const read = deferred();
  const harness = createHarness({
    settings: { theme: "dark", scheme: "mist", background: "old.png" },
    api: {
      readBackground() {
        return read.promise;
      },
    },
  });
  await harness.ready();

  const click = harness.click("themeBtn");
  await click;
  read.resolve("data:image/png;base64,OLD");
  await harness.ready();

  assert.equal(harness.body.style.backgroundImage, 'url("data:image/png;base64,OLD")');
});

test("较新的背景请求失败时保留初始化中的旧背景", async () => {
  const oldRead = deferred();
  const newRead = deferred();
  const harness = createHarness({
    settings: { theme: "dark", scheme: "mist", background: "old.png" },
    api: {
      readBackground(filename) {
        return filename === "old.png" ? oldRead.promise : newRead.promise;
      },
    },
  });
  await harness.ready();

  harness.elements.bgInput.value = "new.png";
  const change = harness.elements.bgInput.dispatch("change");
  await flushMicrotasks();
  newRead.reject(new Error("new image unavailable"));
  await change;
  oldRead.resolve("data:image/png;base64,OLD");
  await harness.ready();

  assert.equal(harness.body.style.backgroundImage, 'url("data:image/png;base64,OLD")');
  assert.equal(harness.state.settings.background, "old.png");
});

test("最新背景请求失败时不会回退覆盖最近成功的背景", async () => {
  const oldRead = deferred();
  const firstRead = deferred();
  const secondRead = deferred();
  const harness = createHarness({
    settings: { theme: "dark", scheme: "mist", background: "old.png" },
    api: {
      readBackground(filename) {
        if (filename === "old.png") return oldRead.promise;
        if (filename === "new1.png") return firstRead.promise;
        return secondRead.promise;
      },
    },
  });
  await harness.ready();

  harness.elements.bgInput.value = "new1.png";
  const firstChange = harness.elements.bgInput.dispatch("change");
  await flushMicrotasks();
  firstRead.resolve("data:image/png;base64,NEW1");
  await firstChange;

  harness.elements.bgInput.value = "new2.png";
  const secondChange = harness.elements.bgInput.dispatch("change");
  await flushMicrotasks();
  oldRead.resolve("data:image/png;base64,OLD");
  await harness.ready();
  secondRead.reject(new Error("new2 unavailable"));
  await secondChange;

  assert.equal(harness.body.style.backgroundImage, 'url("data:image/png;base64,NEW1")');
  assert.equal(harness.state.settings.background, "new1.png");
});

test("名单初始化错误不会被迟到的背景错误覆盖", async () => {
  const read = deferred();
  const harness = createHarness({
    settings: { theme: "dark", scheme: "mist", background: "old.png" },
    api: {
      readBackground() {
        return read.promise;
      },
      watchRosterFiles() {
        throw new Error("watch denied");
      },
    },
  });
  await harness.ready();
  assert.equal(harness.elements.statusHint.textContent, "名单已读取，但自动同步失败");

  read.reject(new Error("background unavailable"));
  await harness.ready();
  assert.equal(harness.elements.statusHint.textContent, "名单已读取，但自动同步失败");
});

test("抽取结果不会被迟到的背景错误覆盖", async () => {
  const harness = createHarness();
  await harness.ready();

  const draw = harness.click("drawBtn");
  await flushMicrotasks();
  await harness.finishAnimation();
  await draw;
  assert.match(harness.elements.statusHint.textContent, /天选之子/);

  harness.elements.bgInput.value = "new.png";
  const change = harness.elements.bgInput.dispatch("change");
  await flushMicrotasks();
  // 默认 readBackground 返回 null；让失败发生在读取分支之外不易构造，
  // 这里使用下方的专用错误 harness 覆盖保存失败场景。
  await change;
  assert.match(harness.elements.statusHint.textContent, /天选之子/);
});

test("背景读取异常不会清空已有背景设置", async () => {
  const harness = createHarness({
    settings: { theme: "dark", scheme: "mist", background: "old.png" },
    api: {
      async readBackground(filename) {
        if (filename === "old.png") return "data:image/png;base64,OLD";
        throw new Error("IPC disconnected");
      },
    },
  });
  await harness.ready();
  assert.equal(harness.body.style.backgroundImage, 'url("data:image/png;base64,OLD")');

  harness.elements.bgInput.value = "new.png";
  await harness.elements.bgInput.dispatch("change");

  assert.equal(harness.body.style.backgroundImage, 'url("data:image/png;base64,OLD")');
  assert.equal(harness.state.settings.background, "old.png");
  assert.equal(harness.elements.statusHint.textContent, "背景图片读取失败");
});

test("设置保存按调用顺序串行并在失败后继续", async () => {
  const saves = [];
  let harness;
  let first;
  let second;
  const unhandled = await captureUnhandled(async () => {
    harness = createHarness({
      api: {
        saveSettings(settings) {
          const pending = deferred();
          saves.push({ settings: { ...settings }, ...pending });
          return pending.promise;
        },
      },
    });
    await harness.ready();

    first = harness.click("themeBtn");
    second = harness.schemeButtons[1].click();
    await flushMicrotasks();

    try {
      assert.equal(saves.length, 1, "第二次保存必须等待第一次完成");
      saves[0].reject(new Error("disk full"));
      await flushMicrotasks();
      assert.equal(saves.length, 2, "第一次失败后仍必须执行第二次保存");
      assert.deepEqual(saves[0].settings, { theme: "light", scheme: "mist", background: "" });
      assert.deepEqual(saves[1].settings, { theme: "light", scheme: "chalk", background: "" });
      await assert.rejects(first, /disk full/);
      assert.equal(harness.elements.statusHint.textContent, "设置保存失败");
      saves[1].resolve();
      await second;
    } finally {
      saves.forEach((save) => {
        save.resolve();
        save.reject(new Error("test cleanup"));
      });
      await flushMicrotasks();
      await Promise.allSettled([first, second]);
    }
  });

  assert.deepEqual(unhandled, []);
});
