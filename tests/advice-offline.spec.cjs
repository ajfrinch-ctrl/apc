const { test, expect } = require('./fixtures.cjs');

test('failed advice-bank initialization keeps the cached list usable without a page error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/demo/offline-roles.html');
  await page.evaluate(async () => {
    const { createAdviceStore, writeAdviceCache } = await import('/js/daily-advice.js');
    const { initAdviceAdmin } = await import('/js/advice-admin.js');
    writeAdviceCache({ items: [{ id: 'ADV-CACHED', text: 'নিয়মিত অনুশীলন করো।', source: 'Active Plus Coaching', active: true, order: 1, createdBy: 'manager', createdAt: 1 }], remoteLoaded: true });
    const mount = document.createElement('section');
    mount.id = 'offline-advice-test';
    document.body.appendChild(mount);
    const adapter = {
      subscribe() { return () => {}; },
      async canWrite() { return true; },
      async seedDefaults() { throw new Error('Cloud request failed'); }
    };
    window.offlineAdviceEditor = initAdviceAdmin(mount, {
      role: 'manager',
      storeFactory: ({ onChange }) => createAdviceStore({ onChange, adapterFactory: async () => adapter, autoDateRefresh: false })
    });
  });
  const mount = page.locator('#offline-advice-test');
  await expect(mount.locator('[data-advice-status]')).toHaveAttribute('data-tone', 'offline');
  await expect(mount.locator('[data-advice-status]')).toContainText('অনলাইন পরামর্শ-তালিকা প্রস্তুত করা যায়নি');
  await expect(mount.locator('[data-advice-list]')).toContainText('নিয়মিত অনুশীলন করো।');
  await expect(mount.locator('[data-advice-new]')).toBeEnabled();
  expect(errors).toEqual([]);
  await page.evaluate(() => window.offlineAdviceEditor.stop());
});
