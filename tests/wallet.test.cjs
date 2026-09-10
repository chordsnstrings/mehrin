const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const { fundingTotals, isValidFunding, aggregate } = require('../dist/shared/calc');
const { parseWalletData } = require('../dist/shared/backup');

const purchase = (cost = 3000) => ({
  aedSubmitted: cost * 3.67, usdtReceived: cost, btcAmount: cost / 60000, buyPrice: 60000,
});
const historical = { ...purchase(), id: 'historical-purchase', createdAt: '2026-09-01T12:00:00.000Z' };

test('funding entries add up and actual deployed USDT reduces cash, independently of BTC value', () => {
  const holdings = [purchase(3000), { ...purchase(500), buyPrice: 65000 }];
  assert.deepEqual(fundingTotals([{ amount: 10000 }, { amount: 2500 }], holdings), {
    added: 12500, deployed: 3500, available: 9000,
  });
  assert.equal(aggregate(holdings).usdtReceived, 3500);
});

test('empty, fully deployed, fractional, and underfunded balances are represented accurately', () => {
  assert.deepEqual(fundingTotals([], []), { added: 0, deployed: 0, available: 0 });
  assert.equal(fundingTotals([{ amount: 100 }], [purchase(100)]).available, 0);
  assert.equal(fundingTotals([{ amount: 0.1 }, { amount: 0.2 }], [purchase(0.3)]).available, 0);
  assert.equal(fundingTotals([], [historical]).available, -3000);
});

test('funding requires a finite positive numeric amount', () => {
  for (const amount of [0, -1, NaN, Infinity, '100', true, null]) {
    assert.equal(isValidFunding({ amount }), false);
  }
  assert.equal(isValidFunding(null), false);
  assert.equal(isValidFunding({ amount: 0.01 }), true);
});

test('legacy backups retain purchase IDs and dates without inventing funding', () => {
  const migrated = parseWalletData([historical]);
  assert.deepEqual(migrated, { version: 2, purchases: [historical], funding: [] });
  assert.throws(() => parseWalletData([null]));
  assert.throws(() => parseWalletData([historical, historical]), /duplicate/);
  assert.throws(() => parseWalletData({ version: 2, purchases: [historical], funding: [{ amount: -2 }] }));
});

test('API, persistence, deletion, concurrent updates, and backup restore keep the cash ledger consistent', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mehrin-wallet-test-'));
  const dataFile = path.join(directory, 'purchases.json');
  await fs.writeFile(dataFile, JSON.stringify([historical]));
  process.env.DATA_FILE = dataFile;
  const { store, initStore } = require('../dist/server/store');
  const { fundingRouter } = require('../dist/server/routes/funding');
  const { transactionsRouter } = require('../dist/server/routes/transactions');
  const { walletRouter } = require('../dist/server/routes/wallet');
  await initStore();
  const app = require('express')();
  app.use(require('express').json({ limit: '5mb' }));
  app.use('/api/funding', fundingRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/wallet', walletRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(route, method = 'GET', body) {
    const response = await fetch(origin + route, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 ? undefined : await response.json();
    return { status: response.status, data };
  }
  async function balance() {
    const { data } = await request('/api/wallet');
    return fundingTotals(data.funding, data.purchases);
  }

  await t.test('existing records survive and adding 10,000 leaves 7,000 after existing deployment', async () => {
    assert.deepEqual((await request('/api/wallet')).data.purchases, [historical]);
    const added = await request('/api/funding', 'POST', { amount: 10000 });
    assert.equal(added.status, 201);
    assert.deepEqual(await balance(), { added: 10000, deployed: 3000, available: 7000 });
    const persisted = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    assert.equal(persisted.version, 2);
    assert.deepEqual(persisted.purchases, [historical]);
    assert.equal(persisted.funding[0].id, added.data.id);
    for (const amount of [0, -1, null, '20', true]) {
      assert.equal((await request('/api/funding', 'POST', { amount })).status, 400);
    }
    assert.equal((await request('/api/funding')).data.length, 1);
  });

  await t.test('purchase deployment deducts USDT and deleting the purchase returns it', async () => {
    const added = await request('/api/transactions', 'POST', purchase(2000));
    assert.equal(added.status, 201);
    assert.equal((await balance()).available, 5000);
    assert.equal((await request(`/api/transactions/${added.data.id}`, 'DELETE')).status, 204);
    assert.equal((await balance()).available, 7000);
  });

  await t.test('simultaneous funding and deployments do not lose updates', async () => {
    const results = await Promise.all([
      request('/api/funding', 'POST', { amount: 1000 }),
      request('/api/funding', 'POST', { amount: 2000 }),
      request('/api/transactions', 'POST', purchase(500)),
      request('/api/transactions', 'POST', purchase(500)),
    ]);
    assert.ok(results.every((r) => r.status === 201));
    assert.deepEqual(await balance(), { added: 13000, deployed: 4000, available: 9000 });
    await request(`/api/funding/${results[0].data.id}`, 'DELETE');
    assert.equal((await balance()).available, 8000);
  });

  await t.test('repeated imports preserve IDs and dates without duplicating money', async () => {
    const snapshot = (await request('/api/wallet')).data;
    for (let i = 0; i < 2; i++) {
      assert.equal((await request('/api/wallet/restore', 'POST', snapshot)).status, 200);
      assert.deepEqual((await request('/api/wallet')).data, snapshot);
    }
    assert.equal((await request('/api/wallet/restore', 'POST', [historical])).status, 200);
    assert.deepEqual((await request('/api/wallet')).data, snapshot);
    const broken = structuredClone(snapshot);
    broken.funding.push({ amount: 50 });
    assert.equal((await request('/api/wallet/restore', 'POST', broken)).status, 400);
    const conflicting = structuredClone(snapshot);
    conflicting.funding[0].amount = 999;
    assert.equal((await request('/api/wallet/restore', 'POST', conflicting)).status, 409);
    assert.deepEqual((await request('/api/wallet')).data, snapshot);
    const freshProcess = JSON.parse(execFileSync(process.execPath, ['-e',
      "require('./dist/server/store').store.snapshot().then(x => process.stdout.write(JSON.stringify(x)))",
    ], { cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8' }));
    assert.deepEqual(freshProcess, snapshot);
  });

  await t.test('clearing purchases retains funding and restores all available USDT', async () => {
    const snapshot = (await request('/api/wallet')).data;
    await request('/api/transactions', 'DELETE');
    assert.deepEqual(await balance(), { added: 12000, deployed: 0, available: 12000 });
    for (const entry of snapshot.funding) await store.removeFunding(entry.id);
    assert.deepEqual(await balance(), { added: 0, deployed: 0, available: 0 });
    // The same route used by browser self-healing restores both ledgers together.
    await request('/api/wallet/restore', 'POST', snapshot);
    assert.deepEqual((await request('/api/wallet')).data, snapshot);
  });
});
