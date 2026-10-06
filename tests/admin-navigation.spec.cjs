const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');
// System Control + Staff Management + Permissions + Security + Data + Reports
// + Settings. Daily operations (cash entry, routine, notices, exam publish)
// belong to the Cash Counter, Manager and Teacher panels and are not here.
const mobileViews = ['dashboard', 'staff', 'reports', 'system', 'data', 'profile'];
const systemViews = ['roles', 'security', 'settings', 'academics'];
async function enter(page) {
  await enterPortal(page, 'admin');
  await expect(page.locator('#adminShell')).toBeVisible();
}
async function bottom(page, view) {
  await page.locator(`.admin-bottom [data-admin-view="${view}"]`).click();
}
for (const width of [320, 390]) {
  test(`compact dashboard and six-item mobile footer (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await enter(page);
    const footer = page.locator('.admin-bottom');
    await expect(footer.locator('button')).toHaveCount(6);
    expect(await footer.locator('button').evaluateAll(buttons => buttons.map(b => b.dataset.adminView))).toEqual(mobileViews);
    await expect(page.locator('#dashTitle')).toBeVisible();
    await expect(page.locator('#adminTodayDate')).toHaveText('২২ সেপ্টেম্বর ২০২৬');
    await expect(page.locator('#adminTodayDate')).toHaveAttribute('datetime', '2026-09-22');
    await expect(page.locator('.admin-hero-stats .admin-stat-tile')).toHaveCount(4);
    // Student approval is a Manager decision: the queue shortcut never renders.
    await expect(page.locator('.admin-hero-foot, #dashPendingCount')).toHaveCount(0);
    await expect(page.locator('#dashAppStatusRow, #dashTodayList, #dashPendingList, #dashNoticeCount')).toHaveCount(0);
    // Permission grid: one generated icon + one label per allowed section.
    const tiles = page.locator('#adminFeatureGrid .admin-feature-tile');
    await expect(tiles).toHaveCount(9);
    // One inline SVG per tile, inside a fixed container: never a missing image.
    expect(await tiles.locator('.admin-feature-icon svg').evaluateAll(icons => icons.length)).toBe(9);
    expect(await tiles.locator('.admin-feature-icon > svg').evaluateAll(icons => icons.every(icon => icon.querySelector('path, circle, rect')))).toBe(true);
    expect(await tiles.locator('.admin-feature-label').evaluateAll(labels => labels.every(label => label.textContent.trim().length > 1))).toBe(true);
    // System Owner monitoring is not mixed with the Cash Counter collection action.
    await expect(page.locator('#dashCollectFee, #btnFinanceGoCollect')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const view of mobileViews) {
      await bottom(page, view);
      await expect(page.locator(`.admin-view[data-view-panel="${view}"]`)).toBeVisible();
      await expect(footer.locator('[aria-current=page]')).toHaveCount(1);
      await expect(footer.locator('[aria-current=page]')).toHaveAttribute('data-admin-view', view);
    }
    // Every footer tab shows exactly one icon, inside its chip (no emoji, no
    // empty chip, no second painted icon).
    const icons = page.locator('.admin-bottom .nav-chip > svg.nav-icon');
    await expect(icons).toHaveCount(5);
    expect(await icons.evaluateAll(list => list.every(icon => Boolean(icon.querySelector('path, circle, rect'))))).toBe(true);
    // The selected tab changes colour and background — it never grows past its
    // container, so an icon can never ride over the label below it.
    const activeChip = await page.locator('.admin-bottom [aria-current=page] .nav-chip').boundingBox();
    const activeIcon = await page.locator('.admin-bottom [aria-current=page] svg.nav-icon').boundingBox();
    const idleIcon = await page.locator('.admin-bottom button:not([aria-current=page]) svg.nav-icon').first().boundingBox();
    expect(activeIcon.width).toBeLessThanOrEqual(activeChip.width);
    expect(activeIcon.height).toBeLessThanOrEqual(activeChip.height);
    expect(activeIcon.width).toBe(idleIcon.width);
    const activeBg = await page.locator('.admin-bottom [aria-current=page] .nav-chip').evaluate(el => getComputedStyle(el).backgroundImage);
    const idleBg = await page.locator('.admin-bottom button:not([aria-current=page]) .nav-chip').first().evaluate(el => getComputedStyle(el).backgroundImage);
    expect(activeBg).not.toBe(idleBg);
    // Labels stay readable and are never clipped away.
    expect(await page.locator('.admin-bottom .nav-label').evaluateAll(labels => labels.every(label => label.textContent.trim().length > 1))).toBe(true);
    expect(await page.locator('.admin-bottom .nav-label').evaluateAll(labels => labels.every(label => parseFloat(getComputedStyle(label).fontSize) >= 11))).toBe(true);

    // সিস্টেম hub: four cards, each opening the screen that owns the work.
    await expect(page.locator('#adminSystemMenu .admin-more-item')).toHaveCount(4);
    await expect(page.locator('.teacher-panel-link')).toHaveCount(0);
    for (const view of systemViews) {
      await bottom(page, 'system');
      const button = page.locator(`#adminSystemMenu[data-admin-view="${view}"], #adminSystemMenu .admin-more-item[data-admin-view="${view}"]`);
      await button.focus();
      await page.keyboard.press('Enter');
      const panel = page.locator(`.admin-view[data-view-panel="${view}"]`);
      await expect(panel).toBeVisible();
      await expect(panel.locator('h1')).toBeFocused();
      await expect(footer.locator('[aria-current=page]')).toHaveAttribute('data-admin-view', 'system');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    // ডেটা hub: management plus the one backup screen.
    await bottom(page, 'data');
    await expect(page.locator('#adminDataMenu .admin-more-item')).toHaveCount(1);
    await page.locator('#adminDataMenu .admin-more-item[data-admin-view=backup]').click();
    await expect(page.locator('.admin-view[data-view-panel=backup]')).toBeVisible();
    await expect(footer.locator('[aria-current=page]')).toHaveAttribute('data-admin-view', 'data');
    await bottom(page, 'reports');
    await expect(page.locator('[data-finance-view=collection]')).toBeVisible();
    await expect(page.locator('#feeStudentSearch, #feeCollectionForm')).toHaveCount(0);
    await expect(footer.locator('[aria-current=page]')).toHaveAttribute('data-admin-view', 'reports');
    await bottom(page, 'staff');
    await expect(page.locator('#staffList .staff-card').first()).toBeVisible();
    await bottom(page, 'dashboard');
    await expect(page.locator('#dashCollectFee')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('the roster keeps its read-only status filter without any approval control', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  await bottom(page, 'students');
  await page.locator('#studentSearch').fill('রাইসা');
  await page.locator('[data-student-filter=approved]').click();
  await bottom(page, 'dashboard');
  // The Manager-only approval queue is not part of this panel at all.
  await expect(page.locator('.admin-hero-foot, #dashPendingCount')).toHaveCount(0);
  await bottom(page, 'students');
  await page.locator('[data-student-filter=pending]').click();
  await expect(page.locator('[data-student-filter=pending]')).toHaveClass(/active/);
  await expect(page.locator('#studentList .student-row')).toHaveCount(3);
  // Records stay readable; the decision itself is taken in manager.html.
  await expect(page.locator('#studentList [data-action=view]')).toHaveCount(3);
  await expect(page.locator('#studentList [data-action=approve], #studentList [data-action=reject]')).toHaveCount(0);
  await expect(page.locator('.manager-approval-note')).toHaveCount(0);
});

test('a hash route opens only what this role may open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  await expect(page.locator('.admin-view[data-view-panel=dashboard]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#staff'; });
  await expect(page.locator('.admin-view[data-view-panel=staff]')).toBeVisible();
  await expect(page.locator('.admin-bottom [aria-current=page]')).toHaveAttribute('data-admin-view', 'staff');
  // Unknown or foreign routes never move the panel.
  await page.evaluate(() => { window.location.hash = '#finance'; });
  await expect(page.locator('.admin-view[data-view-panel=staff]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#teaching'; });
  await expect(page.locator('.admin-view[data-view-panel=staff]')).toBeVisible();
  // Nothing role-foreign is in the DOM in the first place.
  await expect(page.locator('.teacher-panel-link, .pay-panel-link')).toHaveCount(0);
});

test('secondary controls remain functional and dashboard updates without removed nodes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await enter(page);
  const original = await page.locator('#dashClassCount').innerText();
  await bottom(page, 'system');
  await page.locator('#adminSystemMenu .admin-more-item[data-admin-view=settings]').click();
  const enabled = page.locator('#classList input:checked');
  const count = await enabled.count();
  const className = await enabled.first().getAttribute('data-class-name');
  await page.locator(`#classList input[data-class-name="${className}"]`).uncheck({ force: true });
  await bottom(page, 'dashboard');
  const newCount = String(count - 1).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[digit]);
  await expect(page.locator('#dashClassCount')).toHaveText(newCount);
  expect(newCount).not.toBe(original);
  // Notice publishing belongs to the Manager portal: creating a staff account
  // is the Admin-side equivalent and must stay fully functional.
  await bottom(page, 'staff');
  await page.locator('#staffCreateButton').click();
  await page.locator('#staffField-fullName').fill('মোবাইল স্টাফ');
  await page.locator('#staffField-username').fill('mobile.staff.apc');
  await page.locator('#staffField-password').fill('Mobile-2026');
  await page.locator('#staffField-confirmPassword').fill('Mobile-2026');
  await page.locator('#staffField-role').selectOption('manager');
  await page.locator('#staffForm button[type=submit]').click();
  await expect(page.locator('#staffList')).toContainText('মোবাইল স্টাফ');
  await expect(page.locator('#staffList .staff-id-badge').first()).toContainText('STF-');
  await bottom(page, 'system');
  await page.locator('#adminSystemMenu .admin-more-item[data-admin-view=settings]').click();
  await expect(page.locator('#cfgMaintenanceMode')).toBeAttached();
  await page.locator('#btnSaveTopAppSettings').click();
  await expect(page.locator('.admin-toast')).toContainText('সংরক্ষিত');
  expect(errors).toEqual([]);
});

test('wide viewport keeps the same six-item mobile interface without a sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await enter(page);
  await expect(page.locator('.admin-side, .admin-nav-item')).toHaveCount(0);
  await expect(page.locator('.admin-bottom')).toBeVisible();
  await expect(page.locator('.admin-bottom button')).toHaveCount(6);
  expect((await page.locator('#adminShell').boundingBox()).width).toBe(480);
  for (const view of mobileViews) {
    await bottom(page, view);
    await expect(page.locator(`.admin-view[data-view-panel="${view}"]`)).toBeVisible();
    await expect(page.locator('.admin-bottom [aria-current=page]')).toHaveAttribute('data-admin-view', view);
  }
  for (const view of systemViews) {
    await bottom(page, 'system');
    await page.locator(`#adminSystemMenu .admin-more-item[data-admin-view="${view}"]`).click();
    await expect(page.locator(`.admin-view[data-view-panel="${view}"]`)).toBeVisible();
    await expect(page.locator('.admin-bottom [aria-current=page]')).toHaveAttribute('data-admin-view', 'system');
  }
  await bottom(page, 'data');
  await page.locator('#adminDataMenu .admin-more-item[data-admin-view=backup]').click();
  await expect(page.locator('.admin-view[data-view-panel=backup]')).toBeVisible();
  await expect(page.locator('.admin-bottom [aria-current=page]')).toHaveAttribute('data-admin-view', 'data');
});
