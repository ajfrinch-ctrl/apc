const { test, expect } = require('./fixtures.cjs');

test('the installed service worker serves both backup modules while offline', async ({ page, context }) => {
  await page.route(/https:\/\/[^/]*(?:supabase\.co|firebasedatabase\.app|firebaseio\.com|googleapis\.com)\//, route => route.abort());
  await page.routeWebSocket(/wss:\/\/[^/]*(?:supabase\.co|firebasedatabase\.app|firebaseio\.com)\//, socket => socket.close());
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.waitForFunction(async () => {
    const { SW_VERSION } = await import('/js/service-worker.js');
    const cache = await caches.open(`active-plus-student-v${SW_VERSION}-minimal-education`);
    return Boolean(await cache.match('./js/backup-crypto.js')) && Boolean(await cache.match('./js/backup-restore.js'));
  }, null, { timeout: 45000 });
  await context.setOffline(true);
  const results = await page.evaluate(async () => Promise.all([
    fetch('./js/backup-crypto.js').then(response => response.ok),
    fetch('./js/backup-restore.js').then(response => response.ok)
  ]));
  expect(results).toEqual([true, true]);
});
