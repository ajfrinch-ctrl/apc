const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');

test('the staff service worker serves both backup modules while offline', async ({ page, context }) => {
  await page.route(/https:\/\/[^/]*(?:supabase\.co|firebasedatabase\.app|firebaseio\.com|googleapis\.com)\//, route => route.abort());
  await page.routeWebSocket(/wss:\/\/[^/]*(?:supabase\.co|firebasedatabase\.app|firebaseio\.com)\//, socket => socket.close());
  await enterPortal(page, 'admin');
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.includes('shell=staff'));
  await expect.poll(() => page.evaluate(async () => {
    const { SW_VERSION } = await import('/js/service-worker.js');
    const cache = await caches.open(`active-plus-student-v${SW_VERSION}-minimal-education`);
    const files = await Promise.all(['./js/backup-crypto.js', './js/backup-restore.js'].map(url => cache.match(url)));
    return files.every(response => response?.ok);
  }), { timeout: 45000 }).toBe(true);
  await context.setOffline(true);
  const statuses = await page.evaluate(async () => Promise.all([
    fetch('./js/backup-crypto.js').then(response => response.status),
    fetch('./js/backup-restore.js').then(response => response.status)
  ]));
  expect(statuses).toEqual([200, 200]);
});
