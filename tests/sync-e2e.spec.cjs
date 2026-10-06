/* End-to-end sync check with the topbar border as the status light.

   The app, its sync engine (js/realtime-sync.js), the durable outbox,
   localStorage and the UI are all real; only the Firebase SDK is a stub
   (tests/sync-cloud-stub.cjs), so the whole cycle runs with no network and the
   link can be cut and restored on demand. What this protects:

     1. a signed-in device reaches a confirmed sync            → green line
     2. a local change really travels to the cloud             → outbox → commit
     3. a cloud change really travels back to the device       → listener → storage
     4. a cut link shows red WITHOUT any text, toast or banner  → colour only
     5. recovery needs no user action — the removed retry banner must not have
        stranded a queued edit; coming back online pushes it by itself
     6. local data survives all of it (offline-first untouched)

   Point 5 is the one to keep: the old sync banner doubled as the manual retry
   button, so this spec is what stops the colour-only indicator from quietly
   losing that safety net. */
const { test, expect } = require('./fixtures.cjs');
const { enterStudentApp } = require('./portal-session.cjs');
const { STUB_SOURCE } = require('./sync-cloud-stub.cjs');

test.use({ serviceWorkers: 'block', viewport: { width: 420, height: 800 } });

const GREEN = 'rgb(14, 159, 110)';
const RED = 'rgb(184, 50, 57)';
const SETTLE = 450;   // longer than the 300ms border-top-color transition

test('a real sync cycle drives the colour-only topbar indicator', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error.message)));
  // Only the cloud boundary is faked.
  await page.route('https://www.gstatic.com/firebasejs/**', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_SOURCE }));

  const readout = () => page.evaluate(() => {
    const root = document.documentElement;
    const bar = document.querySelector('.app-topbar');
    return { sync: root.dataset.realtimeSync, visual: root.dataset.syncVisual,
      connected: root.dataset.firebaseConnection, lastSync: Boolean(root.dataset.firebaseLastSync),
      border: bar ? getComputedStyle(bar).borderTopColor : '(no bar)' };
  });
  const waitFor = async (predicate, timeout = 25000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (predicate(await readout())) { await page.waitForTimeout(SETTLE); return readout(); }
      await page.waitForTimeout(250);
    }
    throw new Error(`sync state did not arrive: ${JSON.stringify(await readout())}`);
  };
  const cloudHas = name => page.evaluate(
    marker => JSON.stringify(window.__cloud?.data?.activePlusSync?.v1?.notices || {}).includes(marker), name);
  const pushLocalNotice = (id, body) => page.evaluate(async ({ id, body }) => {
    const { KEYS } = await import('/js/database.js');
    const notices = JSON.parse(localStorage.getItem(KEYS.notices) || '[]');
    notices.push({ id, title: id, body, audience: 'সকল শিক্ষার্থী', status: 'published', createdAt: new Date().toISOString() });
    localStorage.setItem(KEYS.notices, JSON.stringify(notices));   // the app's own local-write bridge mirrors this
  }, { id, body });

  // 1 ── a signed-in device completes a sync.
  await enterStudentApp(page);
  const synced = await waitFor(s => s.sync === 'online' && s.visual === 'synced' && s.lastSync);
  expect(synced.connected).toBe('connected');
  expect(synced.border).toBe(GREEN);
  const traffic = await page.evaluate(() => ({ reads: window.__cloud.reads.length, commits: window.__cloud.transactions.length }));
  expect(traffic.reads).toBeGreaterThan(5);
  expect(traffic.commits).toBeGreaterThan(0);

  // 2 ── a local edit reaches the cloud, and the line settles back to green.
  const outgoing = `E2E-OUT-${Date.now()}`;
  await pushLocalNotice(outgoing, 'written on this device');
  await expect.poll(() => cloudHas(outgoing), { timeout: 25000 }).toBe(true);
  expect((await waitFor(s => s.visual === 'synced')).border).toBe(GREEN);

  // 3 ── a cloud edit reaches this device (the other direction).
  const incoming = `E2E-IN-${Date.now()}`;
  await page.evaluate(async id => {
    const cloud = window.__cloud;
    const { encodeRealtimeRecords } = await import('/js/realtime-value-codec.js');
    const records = JSON.parse(JSON.stringify(cloud.data.activePlusSync?.v1?.notices || {}));
    records[id] = { id, title: id, body: 'from another device', audience: 'সকল শিক্ষার্থী', status: 'published', createdAt: new Date().toISOString() };
    cloud.data.activePlusSync.v1.notices = encodeRealtimeRecords(records);
    for (const entry of (cloud.listeners.get('activePlusSync/v1/notices') || [])) {
      entry.callback({ val: () => cloud.data.activePlusSync.v1.notices, exists: () => true });
    }
  }, incoming);
  await expect.poll(async () => page.evaluate(async marker => {
    const { KEYS } = await import('/js/database.js');
    return JSON.stringify(localStorage.getItem(KEYS.notices) || '').includes(marker);
  }, incoming), { timeout: 25000 }).toBe(true);

  // 4 ── the link drops: red, and still not one word about sync on screen.
  await page.evaluate(() => window.__cloudOffline());
  const offline = await waitFor(s => s.visual === 'error', 15000);
  expect(offline.border).toBe(RED);
  const labels = await page.evaluate(() => ({
    bar: /সিঙ্ক|Sync|Syncing|Offline/i.test(document.querySelector('.app-topbar').innerText),
    chip: Boolean(document.querySelector('.topbar-sync-chip, #cloudSyncStatus'))
  }));
  expect(labels.bar).toBe(false);
  expect(labels.chip).toBe(false);

  // 5 ── an edit made while offline is queued, not lost, and not sent yet.
  const queued = `E2E-OFFLINE-${Date.now()}`;
  await pushLocalNotice(queued, 'written while offline');
  await page.waitForTimeout(1500);
  expect(await cloudHas(queued)).toBe(false);

  // 6 ── the link returns and the queue drains with no click and no reload.
  await page.evaluate(() => window.__cloudOnline());
  await expect.poll(() => cloudHas(queued), { timeout: 40000 }).toBe(true);
  expect((await waitFor(s => s.visual === 'synced')).border).toBe(GREEN);

  // 7 ── local-first promise: the device still holds everything it wrote.
  const kept = await page.evaluate(async () => {
    const { KEYS } = await import('/js/database.js');
    return JSON.parse(localStorage.getItem(KEYS.notices) || '[]').length;
  });
  expect(kept).toBeGreaterThanOrEqual(3);
  expect(pageErrors).toEqual([]);
});
