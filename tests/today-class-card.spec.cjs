/* Match Today study's real compact card geometry, not just class names.
   The add-class acceptance uses the existing guarded Manager routine form. */
const { test, expect } = require('./fixtures.cjs');
const { enterStudentApp, enterPortal } = require('./portal-session.cjs');
test.use({ serviceWorkers:'block', reducedMotion:'reduce', locale:'bn-BD', timezoneId:'Asia/Dhaka' });

async function student(page, viewport, theme) {
  await page.setViewportSize(viewport);
  await page.addInitScript(theme => localStorage.setItem('active-plus-appearance-v2',theme), theme);
  await page.clock.setFixedTime(new Date('2026-10-01T10:00:00Z'));
  await enterStudentApp(page);
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.locator('#dashboardRoutineList')).toHaveAttribute('data-state','empty');
  await page.evaluate(() => document.fonts.ready);
}

for (const viewport of [{width:320,height:740},{width:390,height:844},{width:1280,height:900}]) {
  for (const theme of ['light','dark']) test(`Today empty class is a Today-study-style compact row (${viewport.width}px ${theme})`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await student(page,viewport,theme);
    const row = page.locator('.dashboard-empty-card');
    await expect(row).toContainText('আজ কোনো ক্লাস নেই');
    await expect(row).not.toContainText('যোগ করা নেই');
    await expect(row.locator('[data-view="routine"]')).toHaveCount(1);
    // The current home design integrates the empty state into its illustrated
    // routine section rather than duplicating the separate study card's skin.
    const measure = await page.evaluate(() => {
      const card = document.querySelector('.dashboard-empty-card');
      const text = card.querySelector('.dashboard-empty-copy');
      const action = card.querySelector('button');
      const box = card.getBoundingClientRect();
      const copy = text.getBoundingClientRect();
      const button = action.getBoundingClientRect();
      return {
        fits: box.left >= 0 && box.right <= innerWidth && copy.left >= box.left && copy.right <= box.right + 1,
        tap: button.width >= 44 && button.height >= 44,
        copyFits: text.scrollWidth <= text.clientWidth + 1,
        inOrder: copy.right <= button.left + 1,
        height: box.height
      };
    });
    expect(measure.fits && measure.tap && measure.copyFits && measure.inOrder).toBe(true);
    expect(measure.height).toBeLessThanOrEqual(120);
    await row.getByRole('button', { name: 'সব রুটিন দেখুন', exact: true }).click();
    await expect(page.locator('#routineView')).toBeVisible();
    await page.locator('.bottom-nav [data-view="home"]').click();
    await expect(row).toBeVisible();
    await expect(page.locator('#studentServices .pay-tile')).toHaveCount(7);
    await page.locator('#dashboardChallengeCard').scrollIntoViewIfNeeded();
    await expect(page.locator('#dashboardChallengeCard')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('a real Manager-published class replaces the no-classes card for the matching student', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T10:00:00Z'));
  await enterPortal(page,'manager');
  await expect(page.locator('#managerShell')).toBeVisible();
  await page.locator('[data-view-panel="dashboard"] [data-panel-view="routine"]').click();
  await page.locator('[data-view-panel="routine"] [data-panel-view="routine-class"]').click();
  await page.locator('[data-view-panel="routine-class"] [data-routine-action="create"]').click();
  await page.locator('#managerRoutineDays [data-routine-day="thu"]').click();
  const form = page.locator('#managerRoutineForm');
  await form.locator('[name="className"]').selectOption('দশম শ্রেণি');
  await form.locator('[name="subject"]').fill('নমুনা গণিত ক্লাস');
  const teacher = await form.locator('[name="teacher"] option').nth(1).getAttribute('value');
  expect(teacher).toBeTruthy();
  await form.locator('[name="teacher"]').selectOption(teacher);
  await form.locator('[name="time"]').fill('16:00');
  await form.locator('[name="room"]').fill('নমুনা রুম ২');
  await form.locator('[type="submit"]').click();
  await page.locator('[data-view-panel="routine-class"] [data-routine-action="list"]').click();
  await expect(page.locator('#managerRoutineList')).toContainText('নমুনা গণিত ক্লাস');
  const before = await page.evaluate(async () => { const { ROUTINE_KEY } = await import('/js/office-data.js'); return localStorage.getItem(ROUTINE_KEY); });
  expect(before).toBeTruthy();
  // End the real staff session before signing in a student on the same device.
  await page.evaluate(async () => { const { clearStaffSession } = await import('/js/staff-auth.js'); clearStaffSession('manager'); });
  await enterStudentApp(page);
  await expect(page.locator('#dashboardRoutineList')).toHaveAttribute('data-state','ready');
  await expect(page.locator('.dashboard-routine-card')).toContainText('নমুনা গণিত ক্লাস');
  await expect(page.locator('.dashboard-routine-card')).toContainText(teacher);
  await expect(page.locator('.dashboard-empty-card')).toHaveCount(0);
  expect(await page.evaluate(async () => { const { ROUTINE_KEY } = await import('/js/office-data.js'); return localStorage.getItem(ROUTINE_KEY); })).toBe(before);
});

test.describe('offline class entry', () => {
  test.use({ serviceWorkers:'allow' });
  test('compact class card and its routine action work after a cold offline reload', async ({ page, context }) => {
    await student(page,{width:390,height:844},'dark');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.clearBrowserCache'); await cdp.detach();
    await context.setOffline(true); await page.reload();
    await expect(page.locator('#appShell')).toBeVisible();
    await expect(page.locator('.dashboard-empty-card.challenge-card')).toBeVisible();
    await expect(page.locator('.dashboard-empty-copy')).toContainText('আজ কোনো ক্লাস নেই');
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await page.locator('.dashboard-empty-card').getByRole('button',{name:'সব রুটিন দেখুন',exact:true}).click();
    await expect(page.locator('#routineView')).toBeVisible();
    await page.locator('.bottom-nav [data-view="home"]').click();
    await expect(page.locator('.dashboard-empty-card')).toBeVisible();
  });
});
