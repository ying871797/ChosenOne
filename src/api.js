/* ===== Tauri 后端命令封装（挂载到 window 全局） =====
 * 在 Tauri 环境下调用真实后端；在纯浏览器中提供 mock 降级，
 * 便于直接打开 index.html 预览界面与调试抽取逻辑。
 */

(function () {
  "use strict";

  const Tauri = window.__TAURI__;

  // ---------- 浏览器 mock 数据层 ----------
  function createMock() {
    const mockNames = [
      "1 韩梓睿", "2 段宗翰", "3 韩佳婷", "4 徐乙苏", "5 高元煜", "6 陈雨蛟",
      "7 韦骁洋", "8 应响", "9 柯雯耀", "10 李柳佳", "11 范雅怡", "12 李保辰",
      "13 杨凯博", "14 高嘉雯", "15 孙熙航", "16 牛雨畅", "17 申婧琪", "18 王宇鹏",
      "19 李伊璇", "20 韩荞旭", "21 袁浩彤", "22 刘容", "23 吴宇涵", "24 宋嘉琪",
      "25 张艺琳", "26 孙永安", "27 刘博羽", "28 遆思辰", "29 裴玟", "30 张宇翔",
      "31 柴子豪", "32 赵久伟", "33 纪宇轩", "34 何雨凡", "35 赵子豪", "36 肖梦琪",
      "37 吴捷", "38 闫奥城", "39 吴李金", "40 王文博", "41 韩志颖", "42 何向铮",
      "43 黄旭初", "44 李睿", "45 张妍", "46 李胤祺", "47 丁家豪", "48 姬雨馨",
      "49 赵一博", "50 杨雨桐", "51 邓佳辰", "52 尉凌菲",
    ];
    const mockExcluded = ["37 吴捷", "48 姬雨馨", "15 孙熙航", "4 徐乙苏", "1 韩梓睿"];
    let roster = { names: mockNames, excluded: mockExcluded };
    const listeners = [];

    return {
      getRoster: async () => roster,
      loadSettings: async () => ({ theme: "dark", scheme: "mist", background: "" }),
      saveSettings: async () => {},
      getAppDir: async () => "（浏览器预览模式，无应用目录）",
      openAppDir: async () => { alert("浏览器预览模式下无法打开应用目录"); },
      readBackground: async () => null,
      watchRosterFiles: async () => {},
      onRosterChanged: (handler) => {
        listeners.push(handler);
        return () => {
          const i = listeners.indexOf(handler);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
      // 暴露给 main.js 内部调试用（非必须）
      _setRosterForTest: async (names, excluded) => {
        roster = { names, excluded };
        listeners.forEach((h) => h(roster));
      },
    };
  }

  const real = {
    // 读取名单与排除名单
    getRoster: () => invoke("get_roster"),

    // 读取设置
    loadSettings: () => invoke("load_settings"),

    // 保存设置
    saveSettings: (settings) => invoke("save_settings", { settings }),

    // 返回应用目录绝对路径
    getAppDir: () => invoke("get_app_dir"),

    // 在系统资源管理器中打开应用目录
    openAppDir: () => invoke("open_app_dir"),

    // 读取应用目录下背景图片，返回 data URL（null 表示不存在）
    readBackground: (filename) => invoke("read_background", { filename }),

    // 启动名单文件监视
    watchRosterFiles: () => invoke("watch_roster_files"),

    // 订阅名单变化事件，返回取消订阅函数。
    // ⚠️ 与 invoke 同理，事件监听也要兼容 v1 扁平 `__TAURI__.listen` 与
    //    v2 分模块 `__TAURI__.event.listen`；用 call 绑定原持有者避免 this 丢失。
    onRosterChanged: (handler) => {
      const namespace = Tauri?.event || Tauri;
      const listenFn = namespace?.listen || Tauri?.listen;
      if (typeof listenFn !== "function") {
        return Promise.reject(new Error("Tauri 事件监听 API 不可用"));
      }
      return listenFn.call(namespace, "roster-changed", (event) => {
        handler(event.payload);
      });
    },
  };

  // 有 Tauri 全局 API 且能取到 invoke 时用真实实现，否则用 mock
  // ⚠️ Tauri v2 的全局命名空间是分模块的：invoke 在 `__TAURI__.core.invoke`，
  //    v1 是扁平的 `__TAURI__.invoke`。两版都兼容，避免永远走 mock。
  const coreInvoke = Tauri?.core?.invoke;
  const legacyInvoke = Tauri?.invoke;
  const invoke = typeof coreInvoke === "function"
    ? coreInvoke
    : typeof legacyInvoke === "function"
      ? legacyInvoke
      : null;
  window.ChosenAPI = invoke ? real : createMock();
  window.__IS_BROWSER_PREVIEW__ = !invoke;
})();