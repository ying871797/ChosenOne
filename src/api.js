/* ===== Tauri 后端命令封装（挂载到 window 全局） =====
 * 在 Tauri 环境下调用真实后端；在纯浏览器中提供 mock 降级，
 * 便于直接打开 index.html 预览界面与调试抽取逻辑。
 */

(function () {
  "use strict";

  const Tauri = window.__TAURI__;

  // ---------- 浏览器 mock 数据层 ----------
  function createMock() {
    const mockNames = ["张三", "李四", "王五", "赵六", "钱七", "孙八", "周九", "吴十"];
    let roster = { names: mockNames, excluded: [] };
    const listeners = [];

    return {
      getRoster: async () => roster,
      loadSettings: async () => ({ theme: "dark", background: "" }),
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

    // 订阅名单变化事件，返回取消订阅函数
    onRosterChanged: (handler) =>
      Tauri.event.listen("roster-changed", (event) => {
        handler(event.payload);
      }),
  };

  // 有 Tauri 全局 API 且能取到 invoke 时用真实实现，否则用 mock
  // ⚠️ Tauri v2 的全局命名空间是分模块的：invoke 在 `__TAURI__.core.invoke`，
  //    v1 是扁平的 `__TAURI__.invoke`。两版都兼容，避免永远走 mock。
  const invoke = Tauri?.core?.invoke ?? Tauri?.invoke;
  const tauriListen = Tauri?.event?.listen ?? Tauri?.listen;
  window.ChosenAPI = invoke ? real : createMock();
  window.__IS_BROWSER_PREVIEW__ = !invoke;
})();