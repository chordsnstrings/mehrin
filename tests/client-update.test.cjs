const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHash } = require('node:crypto');

const output = path.resolve(__dirname, '../dist/public');
const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
const clientUrl = html.match(/<script type="module" src="([^"]+)"/)[1];
const stylesUrl = html.match(/<link rel="stylesheet" href="([^"]+)"/)[1];

function worker(fetchImpl, cached = new Response('old client')) {
  const handlers = {};
  const precached = [];
  vm.runInNewContext(fs.readFileSync(path.join(output, 'sw.js'), 'utf8'), {
    URL,
    Request: class extends Request { constructor(url, options) { super(new URL(url, 'https://mehrin.test'), options); } },
    self: { location: { origin: 'https://mehrin.test' }, addEventListener: (name, handler) => { handlers[name] = handler; }, skipWaiting() {} },
    caches: {
      match: async () => cached,
      open: async () => ({ put: async () => {}, addAll: async (requests) => { precached.push(...requests); } }),
    },
    fetch: fetchImpl,
  });
  return {
    precached,
    async install() {
      let done;
      handlers.install({ waitUntil: (promise) => { done = promise; } });
      await done;
    },
    async asset(url) {
      let response;
      handlers.fetch({ request: new Request(new URL(url, 'https://mehrin.test')), respondWith: (promise) => { response = promise; } });
      return response;
    },
  };
}

test('a deployed page uses content-addressed client and CSS URLs that bypass old worker caches', () => {
  for (const url of [clientUrl, stylesUrl]) {
    assert.match(url, /\.[a-f0-9]{16}\.(js|css)$/);
    const content = fs.readFileSync(path.join(output, url.slice(1)));
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    assert.ok(url.includes(hash));
    assert.notEqual(url, '/main.js');
    assert.notEqual(url, '/styles.css');
  }
});

test('a cached legacy client is replaced by the network response on the first reload', async () => {
  const sw = worker(async (_request, options) => {
    assert.equal(options.cache, 'no-cache');
    return new Response('current client with Add USDT');
  });
  assert.equal(await (await sw.asset('/main.js')).text(), 'current client with Add USDT');
});

test('offline fallback remains available and installation bypasses stale HTTP caches', async () => {
  const sw = worker(async () => { throw new Error('offline'); });
  assert.equal(await (await sw.asset('/main.js')).text(), 'old client');
  await sw.install();
  assert.ok(sw.precached.every((request) => request.cache === 'reload'));
  assert.ok(sw.precached.some((request) => new URL(request.url).pathname === clientUrl));
  assert.ok(sw.precached.some((request) => new URL(request.url).pathname === stylesUrl));
  assert.ok(!sw.precached.some((request) => request.url.includes('__')));
});

/** Browser-free client regression: exercise the actual built bundle's event listeners. */
function clientHarness(fetchImpl) {
  const elements = new Map();
  const storage = new Map();
  let document;
  class Element extends EventTarget {
    constructor(id = '') {
      super();
      this.id = id;
      this.value = '';
      this.textContent = '';
      this.hidden = false;
      this.disabled = false;
      this.dataset = {};
      this.style = { setProperty() {} };
      this.classList = { add() {}, remove() {} };
      this.parentElement = { dataset: {} };
      this.children = [];
    }
    querySelectorAll() { return []; }
    replaceChildren(...items) { this.children = items; }
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.children.push(item); }
    setAttribute() {}
    focus() { document.activeElement = this; }
    reset() { if (this.id === 'fundingForm') elements.get('fundingAmount').value = ''; }
    setCustomValidity() {}
    reportValidity() {}
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  }
  for (const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(tag[1]);
    element.hidden = /\shidden(?:\s|>)/.test(tag[0]);
    elements.set(tag[1], element);
  }
  document = Object.assign(new EventTarget(), {
    getElementById: (id) => {
      assert.ok(elements.has(id), `client references missing #${id}`);
      return elements.get(id);
    },
    createElement: () => new Element(),
    body: new Element(),
    visibilityState: 'visible',
  });
  const EventSource = class {};
  const window = Object.assign(new EventTarget(), { EventSource, setTimeout: () => 1 });
  vm.runInNewContext(fs.readFileSync(path.join(output, clientUrl.slice(1)), 'utf8'), {
    document, window, navigator: {}, EventSource,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: fetchImpl, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: (fn) => fn(),
    console, alert: (message) => { throw new Error(message); },
  });
  return { elements, storage };
}

const tick = () => new Promise(setImmediate);

test('Add USDT opens while the wallet is loading, then saves an entry and refreshes its balance', async () => {
  let load;
  const calls = [];
  const entry = { id: 'cash-1', amount: 10000, createdAt: '2026-09-10T12:00:00.000Z' };
  const harness = clientHarness(async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/wallet') return new Promise((resolve) => { load = resolve; });
    assert.equal(url, '/api/funding');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { amount: 10000 });
    return { ok: true, status: 201, json: async () => entry };
  });
  const get = (id) => harness.elements.get(id);
  get('addFunding').click();
  assert.equal(get('fundingModal').hidden, false);
  assert.equal(get('fundingSubmit').disabled, true);
  load({ ok: true, status: 200, json: async () => ({ version: 2, purchases: [], funding: [] }) });
  await tick();
  assert.equal(get('fundingSubmit').disabled, false);
  get('fundingAmount').value = '10000';
  get('fundingAmount').dispatchEvent(new Event('input'));
  assert.equal(get('fundingPreview').textContent, '10,000.00 USDT');
  get('fundingForm').dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  assert.equal(get('fundingModal').hidden, true);
  assert.equal(get('usdtAvailable').textContent, '10,000.00');
  assert.equal(get('usdtAdded').textContent, '10,000.00 USDT');
  assert.equal(calls.filter((call) => call.url === '/api/funding').length, 1);
  assert.deepEqual(JSON.parse(harness.storage.get('mehrin.backup.v2')).funding, [entry]);
});
