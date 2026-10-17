const { test, expect } = require('./fixtures.cjs');
const { seed } = require('./portal-session.cjs');

test('Manager keeps branding visible while checking the saved session, then opens the panel', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/demo/offline-roles.html');
  await seed(page, 'manager');

  let releaseManagerModule;
  const managerModuleGate = new Promise(resolve => { releaseManagerModule = resolve; });
  await page.route('**/js/manager.js*', async route => {
    await managerModuleGate;
    await route.continue();
  });

  await page.goto('/manager.html', { waitUntil: 'commit' });
  const boot = page.locator('#managerBootScreen');
  await expect(boot).toBeVisible();
  await expect(boot.locator('img')).toHaveAttribute('src', 'assets/icons/logo-128.png');
  await expect(boot).toContainText('Active Plus Coaching');
  await expect(boot).toContainText('শিখতে থাকো, এগিয়ে যাও');
  await expect(boot).toContainText('ম্যানেজার প্যানেল খুলছে…');
  await expect(page.locator('#managerBootLink')).toBeHidden();
  await expect(page.locator('#managerShell')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  releaseManagerModule();
  await expect(page.locator('#managerShell')).toBeVisible({ timeout: 15000 });
  await expect(boot).toHaveCount(0);
  expect(page.url()).toContain('/manager.html');
});
