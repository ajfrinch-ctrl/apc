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
    const measure = await page.evaluate(() => {
      const card = document.querySelector('.dashboard-empty-card'), study = document.querySelector('#dashboardChallengeCard');
      const icon = card.querySelector('.dashboard-empty-icon').getBoundingClientRect();
      const text = card.querySelector('.dashboard-empty-copy').getBoundingClientRect();
      const action = card.querySelector('button').getBoundingClientRect();
      const box = card.getBoundingClientRect(), a = getComputedStyle(card), b = getComputedStyle(study);
      const props = ['display','alignItems','gap','padding','borderRadius','backgroundColor','borderTopColor','boxShadow','color'];
      return { same:props.every(prop => a[prop] === b[prop]), height:box.height, studyHeight:study.getBoundingClientRect().height,
        rowOrder:icon.right <= text.left + 1 && text.right <= action.left + 1,
        tap:action.width >= 44 && action.height >= 44, widthFits:box.left >= 0 && box.right <= innerWidth,
        copyFits:card.querySelector('.dashboard-empty-copy').scrollWidth <= card.querySelector('.dashboard-empty-copy').clientWidth + 1,
        icons:[icon.width, document.querySelector('#dashboardChallengeCard .challenge-icon').getBoundingClientRect().width]
      };
    });
    expect(measure.same).toBe(true);
    expect(measure.height).toBeLessThanOrEqual(measure.studyHeight + 8);
    expect(measure.rowOrder && measure.tap && measure.widthFits && measure.copyFits).toBe(true);
    expect(measure.icons[0]).toBe(measure.icons[1]);
    await page.getByRole('button',{name:'রুটিন খুলুন',exact:true}).click();
    await expect(page.locator('#routineView')).toBeVisible();
    await page.locator('.bottom-nav [data-view="home"]').click();
    await expect(row).toBeVisible();
    await expect(page.locator('#studentServices .pay-tile')).toHaveCount(8);
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
  await page.locator('#managerRoutineDays [data-routine-day="thu"]').click();
  const form = page.locator('#managerRoutineForm');
  await form.locator('[name="className"]').selectOption('দশম শ্রেণি');
  await form.locator('[name="subject"]').fill('নমুনা গণিত ক্লাস');
  await form.locator('[name="teacher"]').fill('নমুনা শিক্ষক');
  await form.locator('[name="time"]').fill('16:00');
  await form.locator('[name="room"]').fill('নমুনা রুম ২');
  await form.locator('[type="submit"]').click();
  await expect(page.locator('#managerRoutineList')).toContainText('নমুনা গণিত ক্লাস');
  const before = await page.evaluate(async () => { const { ROUTINE_KEY } = await import('/js/office-data.js'); return localStorage.getItem(ROUTINE_KEY); });
  expect(before).toBeTruthy();
  // End the real staff session before signing in a student on the same device.
  await page.evaluate(async () => { const { clearStaffSession } = await import('/js/staff-auth.js'); clearStaffSession('manager'); });
  await enterStudentApp(page);
  await expect(page.locator('#dashboardRoutineList')).toHaveAttribute('data-state','ready');
  await expect(page.locator('.dashboard-routine-card')).toContainText('নমুনা গণিত ক্লাস');
  await expect(page.locator('.dashboard-routine-card')).toContainText('নমুনা শিক্ষক');
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
    await page.getByRole('button',{name:'রুটিন খুলুন',exact:true}).click();
    await expect(page.locator('#routineView')).toBeVisible();
    await page.locator('.bottom-nav [data-view="home"]').click();
    await expect(page.locator('.dashboard-empty-card')).toBeVisible();
  });
});
