const { test, expect } = require('@playwright/test');
async function login(page, role) {
  await page.locator('#login [name=username]').fill(`${role}.demo`);
  await page.locator('#login [name=password]').fill('Demo12345');
  await page.locator('#login button').click();
  await expect(page.locator('#workspace')).toBeVisible();
}
async function section(page, name) { await page.locator(`#menu [data-section="${name}"]`).click(); }

test('nested offline workspace loads its shared assets from the app root', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/demo/offline-roles.html');
  await page.locator('#seed').click();
  await login(page, 'manager');
  const urls = await page.locator('#menu svg image').evaluateAll(images => images.map(image => image.getAttribute('href')));
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    expect(new URL(url).pathname).toMatch(/^\/assets\/icons\/ai-3d\//);
    expect((await page.request.get(url)).ok()).toBe(true);
  }
  // The isolated demo must not replace a staff panel's production worker.
  expect(await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration('/')))).toBe(false);
  expect(errors).toEqual([]);
});
for (const width of [320, 390]) {
  test(`offline shared roles: cash approval, data scope and reload at ${width}px`, async ({ page }) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/demo/offline-roles.html');
    await page.evaluate(async () => { const { createRoleStore } = await import('/demo/js/offline-role-store.js'); await createRoleStore(localStorage).seedDemo(); });
    await page.reload();
    await expect(page.locator('#seed')).toBeDisabled();
    await login(page, 'payment');
    await expect(page.locator('#menu button')).toHaveCount(2);
    await section(page, 'payments');
    await page.locator('#actions [name=amount]').fill('750');
    await page.locator('#actions form button').click();
    await expect(page.locator('#records article')).toHaveCount(2);
    await expect(page.locator('#records').getByRole('button', { name: 'যাচাই করে অনুমোদন' })).toHaveCount(0);
    await page.locator('#logout').click();
    await login(page, 'manager'); await section(page, 'payments');
    await page.locator('#records article').last().getByRole('button', { name: 'যাচাই করে অনুমোদন' }).click();
    await expect(page.locator('#records article').last()).toContainText('approved');
    await expect(page.locator('#menu [data-section=settings]')).toHaveCount(0);
    await page.locator('#logout').click();
    await login(page, 'admin');
    await expect(page.locator('#menu button')).toHaveCount(4);
    await section(page, 'reports'); await expect(page.locator('#records')).toContainText('750');
    await expect(page.locator('#menu [data-section=payments]')).toHaveCount(0);
    await page.locator('#logout').click();
    await login(page, 'student'); await section(page, 'students');
    await expect(page.locator('#records article')).toHaveCount(1);
    await expect(page.locator('#records')).not.toContainText('মেহরিন');
    await section(page, 'payments'); await expect(page.locator('#records')).toContainText('approved');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload(); await expect(page.locator('#workspace')).toBeHidden();
    await login(page, 'manager'); await section(page, 'reports'); await expect(page.locator('#records')).toContainText('750');
    expect(errors).toEqual([]);
  });
}

test('full demo: seed from UI, filter sections and inspect teacher/student records', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/demo/offline-roles.html'); await page.locator('#seed').click();
  await expect(page.locator('#seed')).toBeDisabled();
  await login(page, 'manager');
  await expect(page.locator('#records article')).toHaveCount(114);
  await page.locator('#classFilter').selectOption('demo-class-12-B');
  await expect(page.locator('#records article:visible')).toHaveCount(8);
  await page.locator('#recordSearch').fill('pending');
  await expect(page.locator('#records article:visible')).toHaveCount(1);
  await page.locator('#logout').click();
  await login(page, 'teacher');
  for (const tab of ['attendance', 'assignments', 'submissions', 'exams', 'results', 'feedback', 'notices']) {
    await section(page, tab); expect(await page.locator('#records article').count()).toBeGreaterThan(0);
  }
  await page.locator('#logout').click();
  await login(page, 'student');
  for (const tab of ['routines', 'assignments', 'submissions', 'exams', 'results', 'payments', 'attendance', 'feedback']) {
    await section(page, tab); expect(await page.locator('#records article').count()).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
