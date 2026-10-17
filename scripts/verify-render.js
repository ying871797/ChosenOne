// verify-render.js — 真实渲染回归：用系统 Chrome/Edge(headless) 实际渲染 index.html
// 验证名单窗口（.slot-viewport）宽度不为 0、中央命中 .slot-row，
// 以及长名字按实测宽度降档（在 zoom=1 与 zoom≠1 两种窗口下都不裁字）。
// 背景：历史回归——.slot-frame 包裹层导致 .slot-viewport 的 width:100%
// 在 shrink-to-fit 下解析为 0%，名单区整体不可见；纯 Node stub 测不出 CSS。
// 找不到浏览器时输出 SKIP（退出码 0），不阻塞其他验证。
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PAGE_URL = 'file:///' + path.join(ROOT, 'src', 'index.html').replace(/\\/g, '/');

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function findBrowser() {
  for (const p of BROWSERS) if (fs.existsSync(p)) return p;
  return null;
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.log('SKIP 未找到 Chrome/Edge，跳过真实渲染检查');
    process.exit(0);
  }

  const port = 9200 + Math.floor(Math.random() * 600);
  const profDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-render-'));
  const chrome = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, '--remote-allow-origins=*',
    `--user-data-dir=${profDir}`, '--window-size=800,500', PAGE_URL,
  ], { stdio: 'ignore' });

  let ws, killed = false;
  const kill = () => {
    if (killed) return;
    killed = true;
    try { chrome.kill(); } catch (e) { /* noop */ }
    setTimeout(() => { try { fs.rmSync(profDir, { recursive: true, force: true }); } catch (e) { /* noop */ } }, 500).unref();
  };

  try {
    // 等调试端就绪
    let json = null;
    for (let i = 0; i < 50; i++) {
      try { json = await getJSON(`http://localhost:${port}/json`); if (json && json.length) break; } catch (e) { /* retry */ }
      await new Promise(r => setTimeout(r, 300));
    }
    if (!json || !json.length) throw new Error('CDP 未就绪');
    const page = json.find(t => t.type === 'page');
    if (!page) throw new Error('无 page target');

    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

    let msgId = 0;
    const pending = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params) => new Promise(resolve => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error('evaluate 异常: ' + (r.result.exceptionDetails.exception || {}).description);
      return r.result.result.value;
    };

    // 等 JS 填充名单行
    let ready = false;
    for (let i = 0; i < 50; i++) {
      ready = await evaluate(`document.readyState==='complete' && document.querySelectorAll('.slot-row').length >= 42`);
      if (ready) break;
      await new Promise(r => setTimeout(r, 300));
    }
    if (!ready) throw new Error('名单行未在超时内填充');

    const data = JSON.parse(await evaluate(`(() => {
      const q = s => document.querySelector(s);
      const vp = q('.slot-viewport');
      const list = q('.slot-list');
      const rows = [...list.children];
      const vpR = vp.getBoundingClientRect();
      const stack = document.elementsFromPoint(vpR.x + vpR.width/2, vpR.y + vpR.height/2).map(el => el.className || el.tagName);
      return JSON.stringify({
        rows: rows.length,
        vpW: Math.round(vpR.width),
        vpH: Math.round(vpR.height),
        centerClass: stack[0] || '',
        centerRowText: rows[1] && rows[1].textContent,
      });
    })()`));

    const vpWOk = data.vpW > 200;
    const vpHOk = data.vpH >= 180 && data.vpH <= 260;
    const centerOk = /slot-row/.test(data.centerClass);
    const rowsOk = data.rows === 42;

    if (vpWOk && vpHOk && centerOk && rowsOk) {
      // 字体大小系数：真 CSS 变量链（滑条 input → --name-size / --row-h / --viewport-h → computed/布局）
      // 变量断言精确像素（zoom 无关）；computed 与矩形高度只用比值断言（窗口缩放下 zoom 会参与计算）。
      const font = JSON.parse(await evaluate(`(() => {
        const row = document.querySelector('.slot-row');
        const vp = document.querySelector('.slot-viewport');
        const input = document.getElementById('fontScaleInput');
        const varOf = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();
        const before = varOf('--name-size');
        const computedBefore = parseFloat(getComputedStyle(row).fontSize);
        const vpHBefore = vp.getBoundingClientRect().height;
        input.value = '2.5';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const after = varOf('--name-size');
        const rowH = varOf('--row-h');
        const viewportH = varOf('--viewport-h');
        const computedAfter = parseFloat(getComputedStyle(row).fontSize);
        const vpHAfter = vp.getBoundingClientRect().height;
        const display = document.getElementById('fontScaleValue').textContent;
        input.value = '1';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return JSON.stringify({ before, after, restored: varOf('--name-size'), rowH, viewportH, rowHRestored: varOf('--row-h'), computedBefore, computedAfter, vpHBefore, vpHAfter, display });
      })()`));
      // 变量链像素精确；computed 与矩形高度用比值断言抵消窗口 zoom（105/42 = 2.5、402/240 = 1.675）
      const ratio = font.computedAfter / font.computedBefore;
      const vpRatio = font.vpHAfter / font.vpHBefore;
      const fontOk =
        font.before === '42px' &&
        font.after === '105px' &&
        font.restored === '42px' &&
        font.rowH === '134px' &&
        font.viewportH === '402px' &&
        font.rowHRestored === '80px' &&
        Math.abs(ratio - 2.5) < 0.01 &&
        Math.abs(vpRatio - 402 / 240) < 0.02 &&
        font.display === '2.5×';

      if (fontOk) {
        // ② 长名字按「实测宽度」降档：注入 6 字名，在 zoom=1 与 zoom≠1 的窗口下分别断言
        //    「文字 rect 宽 ≤ 行 rect 宽」。防两类回归：退回按字数判档；拿文字 rect 与
        //    row.clientWidth 混比（zoom≠1 时两者不同坐标空间，会漏判成放得下而继续裁字）。
        const longCases = [];
        for (const [w, h] of [[800, 500], [700, 500], [1200, 700]]) {
          await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
          await new Promise(r => setTimeout(r, 300));
          longCases.push(JSON.parse(await evaluate(`(() => {
            const rows = [...document.querySelectorAll('.slot-row')];
            rows.forEach((r) => { r.textContent = '一二三四五六'; r.classList.remove('center', 'hit'); r.style.fontSize = ''; });
            const input = document.getElementById('fontScaleInput');
            input.value = input.max;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const row = rows[1];
            const range = document.createRange();
            range.selectNodeContents(row);
            const rowW = row.getBoundingClientRect().width;
            const textW = range.getBoundingClientRect().width;
            return JSON.stringify({
              ww: ${w}, zh: ${h},
              zoom: Number(getComputedStyle(document.querySelector('.ui-shell')).zoom).toFixed(3),
              rowW: Math.round(rowW), textW: Math.round(textW),
              over: Math.round(textW - rowW),
              inline: row.style.fontSize || '(CSS变量)',
            });
          })()`)));
        }
        const longOk = longCases.every((c) => c.over <= 0);
        console.log(`PASS 视口宽=${data.vpW} 高=${data.vpH} 行数=${data.rows} 中心命中=${data.centerClass} 中央文本=${JSON.stringify(data.centerRowText)} 字号链=${font.before}→${font.after}(${font.display}) 行高=${font.rowH} 视口=${font.viewportH} 矩形比=${vpRatio.toFixed(3)}`);
        console.log(`${longOk ? 'PASS' : 'FAIL'} 长名降档(6字/3.2×) ` + longCases.map(c => `${c.ww}×${c.zh}/zoom${c.zoom}: ${c.inline} 文字${c.textW}≤行${c.rowW}${c.over <= 0 ? '' : ` 裁${c.over}px!`}`).join(' | '));

        // ③ 几何不变量（显式注入设计视口 800 × 设计窗高 375，zoom 应为 1）：
        //    (a) 非名单区高度 = main.js 的 DESIGN_CHROME_H（135）—— 手写常数与紧凑节奏 CSS 的耦合点；
        //    (b) 主界面无纵向溢出（不出现页面滚动条）；
        //    (c) 设置面板两端可达：放得下则居中；放不下则遮罩可滚动且能滚到「关闭」按钮。
        //    历史回归：窗高压到 375 后设置面板 511px 被上下裁掉，标题与关闭按钮均不可见。
        //    先复位字号系数到 1.0×（上一组长名门把它拖到了上限，而本组不变量定义在 1.0×）。
        await evaluate(`(() => { const i = document.getElementById('fontScaleInput'); i.value = '1'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 375, deviceScaleFactor: 1, mobile: false });
        await new Promise(r => setTimeout(r, 300));
        const geo = JSON.parse(await evaluate(`(() => {
          const q = s => document.querySelector(s);
          const innerH = window.innerHeight;
          const vpH = Math.round(q('.slot-viewport').getBoundingClientRect().height);
          const zoom = Number(getComputedStyle(q('.ui-shell')).zoom);
          const pageOverflow = document.documentElement.scrollHeight > innerH + 1;
          const ov = q('.overlay');
          const ovs = getComputedStyle(ov);
          const scrollable = ovs.overflowY === 'auto' || ovs.overflowY === 'scroll';
          ov.hidden = false;
          ov.scrollTop = 0;
          const panel = q('.panel');
          const panelTop = Math.round(panel.getBoundingClientRect().top);
          const panelH = Math.round(panel.getBoundingClientRect().height);
          ov.scrollTop = ov.scrollHeight;
          const cr = q('#panelCloseBtn').getBoundingClientRect();
          const closeReachable = cr.top >= 0 && cr.bottom <= innerH + 1;
          ov.scrollTop = 0;
          ov.hidden = true;
          return JSON.stringify({ innerH, chromeH: innerH - vpH, zoom, pageOverflow, scrollable, panelTop, panelH, closeReachable, closeBottom: Math.round(cr.bottom) });
        })()`));
        const geoOk =
          geo.innerH === 375 &&
          geo.chromeH === 135 &&
          geo.zoom === 1 &&
          !geo.pageOverflow &&
          (geo.panelTop >= 0 || geo.scrollable) &&
          geo.closeReachable;
        console.log(`${geoOk ? 'PASS' : 'FAIL'} 几何不变量(非名单区=${geo.chromeH} 期望135 | zoom=${geo.zoom} 期望1 | 面板高=${geo.panelH} 顶端=${geo.panelTop} 可滚动=${geo.scrollable} 关闭按钮可达=${geo.closeReachable} 下边=${geo.closeBottom} | 页面溢出=${geo.pageOverflow})`);
        process.exitCode = longOk && geoOk ? 0 : 1;
      } else {
        console.log(`FAIL 字号链 ${JSON.stringify(font)} vpRatio=${vpRatio}（期望 42→105px 行高 134px 视口 402px 矩形比 1.675 恢复 42/80px 读数 2.5×）`);
        process.exitCode = 1;
      }
    } else {
      console.log(`FAIL 视口宽=${data.vpW}(${vpWOk ? 'OK' : '塌缩!'}) 高=${data.vpH} 行数=${data.rows} 中心命中=${data.centerClass}(${centerOk ? 'OK' : '未命中!'})`);
      process.exitCode = 1;
    }
  } catch (e) {
    console.log('FAIL ' + e.message);
    process.exitCode = 1;
  } finally {
    try { if (ws) ws.close(); } catch (e) { /* noop */ }
    kill();
  }
}

main();