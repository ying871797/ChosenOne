// verify-render.js — 真实渲染回归：用系统 Chrome/Edge(headless) 实际渲染 index.html
// 验证名单窗口（.slot-viewport）宽度不为 0、中央命中 .slot-row。
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
      // 字体大小系数：真 CSS 变量链（滑条 input → --name-size → computed font-size）
      // 变量断言精确像素（zoom 无关）；computed 只做方向性断言（窗口缩放下 zoom 会参与计算）。
      const font = JSON.parse(await evaluate(`(() => {
        const row = document.querySelector('.slot-row');
        const input = document.getElementById('fontScaleInput');
        const varOf = () => getComputedStyle(document.body).getPropertyValue('--name-size').trim();
        const before = varOf();
        const computedBefore = parseFloat(getComputedStyle(row).fontSize);
        input.value = '1.5';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const after = varOf();
        const computedAfter = parseFloat(getComputedStyle(row).fontSize);
        const display = document.getElementById('fontScaleValue').textContent;
        input.value = '1';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return JSON.stringify({ before, after, restored: varOf(), computedBefore, computedAfter, display });
      })()`));
      // 变量链像素精确；computed 用比值断言抵消窗口 zoom（63/42 = 1.5）
      const ratio = font.computedAfter / font.computedBefore;
      const fontOk =
        font.before === '42px' &&
        font.after === '63px' &&
        font.restored === '42px' &&
        Math.abs(ratio - 63 / 42) < 0.01 &&
        font.display === '1.5×';

      if (fontOk) {
        console.log(`PASS 视口宽=${data.vpW} 高=${data.vpH} 行数=${data.rows} 中心命中=${data.centerClass} 中央文本=${JSON.stringify(data.centerRowText)} 字号链=${font.before}→${font.after}(${font.display}) computed=${font.computedAfter}`);
        process.exitCode = 0;
      } else {
        console.log(`FAIL 字号链 ${JSON.stringify(font)}（期望 42→63px 恢复 42px 读数 1.5×）`);
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