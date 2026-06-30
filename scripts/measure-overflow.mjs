// Connects to a headless Chrome (remote debugging) and reports elements that
// extend past the viewport width — i.e. horizontal-overflow culprits.
import WebSocket from 'ws';

const [, , port = '9222', vw = '390'] = process.argv;

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) { console.error('no page target'); process.exit(1); }

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

const expression = `(() => {
  const vw = document.documentElement.clientWidth;
  const docSW = document.documentElement.scrollWidth;
  const bad = [];
  document.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    if (r.right > vw + 1 || r.left < -1) {
      bad.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().replace(/\\s+/g,'.') : '')
        + ' [' + Math.round(r.left) + '→' + Math.round(r.right) + ' w=' + Math.round(r.width) + ']');
    }
  });
  return JSON.stringify({ vw, docSW, overflow: docSW - vw, bad: bad.slice(0, 25) }, null, 2);
})()`;

await new Promise((r) => ws.once('open', r));
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(vw), height: 800, deviceScaleFactor: 1, mobile: true,
});
await new Promise((r) => setTimeout(r, 400)); // let layout settle
const res = await send('Runtime.evaluate', { expression, returnByValue: true });
console.log(res.result.value);
ws.close();
process.exit(0);
