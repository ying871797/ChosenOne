"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const API_JS = fs.readFileSync(path.join(ROOT, "src", "api.js"), "utf8");

function loadApi(tauri) {
  const window = { __TAURI__: tauri };
  vm.runInNewContext(API_JS, { window, console });
  return { window, api: window.ChosenAPI };
}

test("api 使用 Tauri v2 命名空间并转发事件", async () => {
  const calls = [];
  let listener;
  const { window, api } = loadApi({
    core: {
      async invoke(...args) {
        calls.push(args);
        return "v2-result";
      },
    },
    event: {
      async listen(eventName, handler) {
        calls.push(["listen", eventName]);
        listener = handler;
        return () => {};
      },
    },
  });

  assert.equal(window.__IS_BROWSER_PREVIEW__, false);
  assert.equal(await api.getRoster(), "v2-result");
  let payload;
  const unlisten = await api.onRosterChanged((value) => {
    payload = value;
  });
  assert.equal(typeof unlisten, "function");
  listener({ payload: { names: ["甲"], excluded: [] } });
  assert.deepEqual(payload, { names: ["甲"], excluded: [] });
  assert.deepEqual(calls[1], ["listen", "roster-changed"]);
});

test("api 兼容 Tauri v1 扁平命名空间", async () => {
  const { window, api } = loadApi({
    async invoke(command) {
      return command;
    },
    async listen(eventName) {
      assert.equal(eventName, "roster-changed");
      return () => {};
    },
  });

  assert.equal(window.__IS_BROWSER_PREVIEW__, false);
  assert.equal(await api.getRoster(), "get_roster");
  assert.equal(typeof (await api.onRosterChanged(() => {})), "function");
});

test("半初始化 Tauri 缺少事件 API 时明确拒绝监听", async () => {
  const { api } = loadApi({ core: { invoke: async () => "ok" } });

  await assert.rejects(api.onRosterChanged(() => {}), /事件监听/);
});

test("非函数 invoke 回退浏览器 mock", () => {
  const { window, api } = loadApi({ core: { invoke: "not-a-function" } });

  assert.equal(window.__IS_BROWSER_PREVIEW__, true);
  assert.equal(typeof api.getRoster, "function");
});

test("浏览器 mock 可广播名单并支持取消订阅", async () => {
  const { window, api } = loadApi(undefined);
  let received;
  const unlisten = await api.onRosterChanged((value) => {
    received = value;
  });

  await api._setRosterForTest(["甲"], ["乙"]);
  assert.deepEqual(Array.from(received.names), ["甲"]);
  assert.deepEqual(Array.from(received.excluded), ["乙"]);
  unlisten();
  await api._setRosterForTest(["丙"], []);
  assert.deepEqual(Array.from(received.names), ["甲"]);
  assert.deepEqual(Array.from(received.excluded), ["乙"]);
  assert.equal(window.__IS_BROWSER_PREVIEW__, true);
});
