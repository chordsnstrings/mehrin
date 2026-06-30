// Captures accurate full-page screenshots at several viewport widths using the
// Chrome DevTools Protocol (real device-metrics emulation, not a clipped window).
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const port = process.argv[2] || '9222';

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

// Realistic populated wallet state injected straight into the DOM.
const populate = `(() => {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('livePrice', '$109,234.56'); set('priceChange', '+2.34% (24h)');
  document.getElementById('priceChange').className = 'chg up';
  document.getElementById('priceUpdated').textContent = 'Updated ' + new Date(0).toLocaleTimeString();
  document.getElementById('livePill').dataset.state = 'live';
  document.getElementById('liveLabel').textContent = 'Live';
  set('walletUsdt', '$4,940.61'); set('walletAed', '≈ AED 18,144.39');
  set('plValue', '+$856.20'); set('plPct', '+20.96%');
  document.getElementById('plBox').dataset.state = 'up';
  set('btcHeld', '0.04522900'); set('usdtReceivedTotal', '$4,084.41');
  set('avgPrice', '$90,216.00'); set('aedSubmittedTotal', 'AED 15,000.00');
  const rows = [
    ['0.03091100 BTC', '@ $88,000.00 · AED 10,000.00 → 2,722.94 USDT', '$3,376.61', '+$653.67 (+24.0%)'],
    ['0.01431800 BTC', '@ $95,000.00 · AED 5,000.00 → 1,361.47 USDT', '$1,564.00', '+$202.53 (+14.9%)'],
  ];
  const list = document.getElementById('txList');
  document.getElementById('txEmpty').hidden = true;
  list.innerHTML = '';
  for (const [btc, sub, v, pl] of rows) {
    const li = document.createElement('li');
    li.className = 'tx-item';
    li.innerHTML = '<div class="tx-main"><span class="tx-btc">' + btc + '</span>' +
      '<span class="tx-sub">' + sub + '</span></div>' +
      '<div class="tx-value"><div class="v">' + v + '</div>' +
      '<div class="pl up">' + pl + '</div></div>' +
      '<button class="tx-del">×</button>';
    list.appendChild(li);
  }
  return 'ok';
})()`;

const shots = [
  { name: 'mobile-390', w: 390, mobile: true, populate: true },
  { name: 'mobile-empty-390', w: 390, mobile: true, populate: false },
  { name: 'small-320', w: 320, mobile: true, populate: true },
  { name: 'tablet-768', w: 768, mobile: false, populate: true },
  { name: 'desktop-1100', w: 1100, mobile: false, populate: true },
];

await new Promise((r) => ws.once('open', r));
await send('Runtime.enable');
await send('Page.enable');

for (const s of shots) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: s.w, height: 900, deviceScaleFactor: 2, mobile: s.mobile,
  });
  await send('Page.navigate', { url: 'http://localhost:8139/' });
  await new Promise((r) => setTimeout(r, 700));
  if (s.populate) await send('Runtime.evaluate', { expression: populate });
  await new Promise((r) => setTimeout(r, 250));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(`/tmp/shot-${s.name}.png`, Buffer.from(shot.data, 'base64'));
  console.log('saved /tmp/shot-' + s.name + '.png');
}
ws.close();
process.exit(0);
