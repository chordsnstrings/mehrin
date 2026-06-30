// Injects a populated, large-number UI state into the running app and reports
// any element overflowing the viewport — the realistic overflow stress test.
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const [, , port = '9222', vw = '320'] = process.argv;

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const send = (method, params) =>
  new Promise((resolve) => {
    const myId = ++id;
    const onMsg = (raw) => {
      const m = JSON.parse(raw);
      if (m.id === myId) { ws.off('message', onMsg); resolve(m.result); }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

const inject = `(() => {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('livePrice', '$1,099,234.56'); set('priceChange', '+1234.56% (24h)');
  document.getElementById('priceChange').className = 'chg up';
  set('walletUsdt', '$1,234,567.89'); set('walletAed', 'AED 4,533,943.07');
  set('plValue', '+$234,567.89'); set('plPct', '+1900.00%');
  document.getElementById('plBox').dataset.state = 'up';
  set('btcHeld', '12.34567890'); set('investedUsdt', '$1,000,000.00');
  set('avgPrice', '$109,999.00'); set('investedAed', 'AED 3,672,500.00');
  const list = document.getElementById('txList');
  document.getElementById('txEmpty').hidden = true;
  list.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const li = document.createElement('li');
    li.className = 'tx-item';
    li.innerHTML = '<div class="tx-main"><span class="tx-btc">12.34567890 BTC</span>' +
      '<span class="tx-sub">@ $1,099,999.00 · AED 4,500,000.00</span></div>' +
      '<div class="tx-value"><div class="v">$1,234,567.89</div>' +
      '<div class="pl up">+$234,567.89 (+1900.0%)</div></div>' +
      '<button class="tx-del">×</button>';
    list.appendChild(li);
  }
  return 'ok';
})()`;

const measure = `(() => {
  const vw = document.documentElement.clientWidth;
  const docSW = document.documentElement.scrollWidth;
  const bad = [];
  document.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    if (r.right > vw + 1 || r.left < -1) {
      bad.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().replace(/\\s+/g,'.') : '')
        + ' [' + Math.round(r.left) + '→' + Math.round(r.right) + ']');
    }
  });
  return JSON.stringify({ vw, docSW, overflow: docSW - vw, bad: bad.slice(0, 25) }, null, 2);
})()`;

await new Promise((r) => ws.once('open', r));
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(vw), height: 1400, deviceScaleFactor: 1, mobile: true });
await send('Runtime.evaluate', { expression: inject });
await new Promise((r) => setTimeout(r, 400));
const res = await send('Runtime.evaluate', { expression: measure, returnByValue: true });
console.log(res.result.value);

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
if (shot?.data) { writeFileSync(`/tmp/stress-${vw}.png`, Buffer.from(shot.data, 'base64')); console.log('screenshot -> /tmp/stress-' + vw + '.png'); }
ws.close();
process.exit(0);
