const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');

/* The staff panels retain their own navigation handlers, but all three use the
   shared five-group Settings presentation. Re-entering that surface must always
   restore its group menu rather than exposing the last group from a prior visit. */

test('Manager Settings returns to its group menu after switching pages at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterPortal(page, 'manager');

  const settings = page.locator('.manager-view[data-view-panel="settings"]');
  const hub = page.locator('[data-settings-hub="manager"]');
  const nav = hub.locator('[data-settings-groups]');
  await page.locator('.manager-bottom [data-manager-view="more"]').click();
  await page.locator('#managerMoreHub [data-manager-view="settings"]').click();
  await expect(settings).toBeVisible();
  await hub.locator('[data-settings-open="security"]').click();
  await expect(hub.locator('[data-settings-group="security"]')).toBeVisible();

  await page.locator('.manager-bottom [data-manager-view="dashboard"]').click();
  await page.locator('.manager-bottom [data-manager-view="more"]').click();
  await page.locator('#managerMoreHub [data-manager-view="settings"]').click();
  await expect(settings).toBeVisible();
  await expect(nav).toBeVisible();
  await expect(hub.locator('[data-settings-group]:not([hidden])')).toHaveCount(0);
  await expect(page.locator('.manager-view.active')).toHaveCount(1);
  await expect(page.locator('.manager-bottom [aria-current="page"]')).toHaveAttribute('data-manager-view', 'more');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Teacher Settings returns to its group menu after switching pages at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterPortal(page, 'teacher');

  const profile = page.locator('#teacherProfile');
  const hub = page.locator('[data-settings-hub="teacher"]');
  const nav = hub.locator('[data-settings-groups]');
  await page.locator('.admin-bottom [data-teacher-view="more"]').click();
  await page.locator('#teacherMore [data-teacher-view="profile"]').click();
  await expect(profile).toBeVisible();
  await hub.locator('[data-settings-open="security"]').click();
  await expect(hub.locator('[data-settings-group="security"]')).toBeVisible();

  await page.locator('.admin-bottom [data-teacher-view="home"]').click();
  await page.locator('.admin-bottom [data-teacher-view="more"]').click();
  await page.locator('#teacherMore [data-teacher-view="profile"]').click();
  await expect(profile).toBeVisible();
  await expect(nav).toBeVisible();
  await expect(hub.locator('[data-settings-group]:not([hidden])')).toHaveCount(0);
  await expect(page.locator('.teacher-view:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.admin-bottom [aria-current="page"]')).toHaveAttribute('data-teacher-view', 'more');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Cash Counter More resets its Settings group on a repeated tap at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterPortal(page, 'payment');

  const more = page.locator('#payMorePanel');
  const nav = more.locator('[data-settings-groups]');
  await page.locator('.admin-bottom [data-pay-section="more"]').click();
  await more.locator('[data-settings-open="security"]').click();
  await expect(more.locator('[data-settings-group="security"]')).toBeVisible();

  // Unlike the staff URL routers, the counter uses five in-page sections; tapping
  // its current More seat again must still return from Security to the menu.
  await page.locator('.admin-bottom [data-pay-section="more"]').click();
  await expect(nav).toBeVisible();
  await expect(more.locator('[data-settings-group]:not([hidden])')).toHaveCount(0);
  await more.locator('[data-settings-open="account"]').click();
  await expect(more.locator('[data-settings-group="account"]')).toBeVisible();
  await page.locator('.admin-bottom [data-pay-section="home"]').click();
  await page.locator('.admin-bottom [data-pay-section="more"]').click();
  await expect(nav).toBeVisible();
  await expect(more.locator('[data-settings-group]:not([hidden])')).toHaveCount(0);
  await expect(page.locator('[data-pay-panel]:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.admin-bottom [aria-current="page"]')).toHaveAttribute('data-pay-section', 'more');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
