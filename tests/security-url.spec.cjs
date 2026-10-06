const { test, expect } = require('./fixtures.cjs');

test('credential query strings are scrubbed before login pages load app assets', async ({ page }) => {
  for (const path of ['index.html', 'admin.html', 'teacher.html', 'payment.html', 'manager.html', 'offline-roles.html']) {
    await page.goto(`/${path}?username=admin.apc&password=123123&tracking=private#finance`);
    await expect.poll(() => page.evaluate(() => location.href)).toBe(`http://127.0.0.1:8000/${path}#finance`);
  }

  // A panel carries no credential field at all any more: credentials typed into
  // a URL neither prefill nor reach anything, and the panel stays locked until
  // the shared login card writes a session.
  await page.goto('/admin.html?username=admin.apc&password=123123');
  await expect(page.locator('#apcPanelLock')).toBeVisible();
  await expect(page.locator('#adminLoginUser, #adminLoginPin, #adminLoginForm, #adminPassword')).toHaveCount(0);
});
