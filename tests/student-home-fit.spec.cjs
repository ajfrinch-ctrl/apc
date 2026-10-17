/* The owner's empty student home keeps the "no classes" card reachable above
   the raised footer action while the carousel and overview scroll in the app.
   Fixtures stay disposable; actual auth, storage and calendar rendering run. */
const { test, expect } = require('./fixtures.cjs');
const { enterStudentApp } = require('./portal-session.cjs');
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce', locale: 'bn-BD', timezoneId: 'Asia/Dhaka' });

async function prepare(page, theme, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript(theme => localStorage.setItem('active-plus-appearance-v2', theme), theme);
  await page.clock.setFixedTime(new Date('2026-10-01T10:00:00Z'));
  await enterStudentApp(page);
  await expect(page.locator('#dashboardRoutineList')).toHaveAttribute('data-state', 'empty');
  await expect(page.locator('#homeView')).toHaveClass(/is-empty-routine/);
  await page.evaluate(() => document.fonts.ready);
}
async function fits(page) {
  await page.locator('.dashboard-empty-card').scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => {
    const mainElement = document.querySelector('#appMain');
    const main = mainElement.getBoundingClientRect();
    const card = document.querySelector('.dashboard-empty-card').getBoundingClientRect();
    const fab = document.querySelector('.bottom-nav > :nth-child(3) .nav-chip').getBoundingClientRect();
    const footer = document.querySelector('.bottom-nav').getBoundingClientRect();
    return card.top >= main.top && card.bottom <= fab.top - 4 && card.left >= 0 && card.right <= innerWidth &&
      Math.abs(main.bottom - footer.top) <= 1 && Math.abs(footer.bottom - innerHeight) <= 1 &&
      document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1 &&
      mainElement.scrollHeight >= mainElement.clientHeight;
  })).toBe(true);
  await page.locator('#appMain').evaluate(element => { element.scrollTop = 0; });
}

for (const viewport of [{ width:320, height:740 }, { width:360, height:800 }, { width:390, height:844 }, { width:412, height:915 }]) {
  for (const theme of ['light','dark']) test(`empty student home keeps its card clear of the footer at ${viewport.width}×${viewport.height} (${theme})`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await prepare(page, theme, viewport);
    await fits(page);
    await expect(page.locator('#studentServices .pay-tile')).toHaveCount(6);
    expect(await page.locator('#studentServices .pay-tile').evaluateAll(items => items.every(item => {
      const box = item.getBoundingClientRect();
      return box.width >= 44 && box.height >= 44;
    }))).toBe(true);
    expect(await page.locator('.dashboard-empty-copy').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.locator('#appMain').evaluate(el => el.scrollTop)).toBe(0);
    await page.locator('.dashboard-today-section .dashboard-text-link').click();
    await expect(page.locator('#routineView')).toBeVisible();
    await page.locator('.bottom-nav [data-view="home"]').click();
    await fits(page);
    // Daily study and subsequent real exam/fee cards are not hidden just to
    // pass a one-screen assertion. They stay reachable below the overview.
    await page.locator('#dashboardChallengeCard').scrollIntoViewIfNeeded();
    await expect(page.locator('#dashboardChallengeCard')).toBeVisible();
    expect(await page.locator('#appMain').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

for (const viewport of [{ width:320, height:568 }, { width:844, height:390 }]) test(`very short student screen scrolls without clipping (${viewport.width}×${viewport.height})`, async ({ page }) => {
  await prepare(page, 'dark', viewport);
  await expect(async () => {
    await page.locator('.dashboard-empty-card').scrollIntoViewIfNeeded();
    await expect(page.locator('.dashboard-empty-card')).toBeVisible();
  }).toPass({ timeout: 5000 });
  const box = await page.locator('.dashboard-empty-card').boundingBox();
  const main = await page.locator('#appMain').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y).toBeGreaterThanOrEqual(main.y - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(main.y + main.height + 1);
  await page.locator('.dashboard-today-section .dashboard-text-link').click();
  await expect(page.locator('#routineView')).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeVisible();
});

test('an actual routine update removes the empty layout and can restore it', async ({ page }) => {
  await prepare(page, 'light', { width:390, height:844 });
  await page.evaluate(async () => {
    const office = await import('/js/office-data.js');
    const routine = office.blankRoutine();
    routine.thu.classes.push({ id:'HOME-FIT-CLASS', className:'দশম শ্রেণি', subject:'গণিত', teacher:'নমুনা শিক্ষক', time:'৪:০০–৫:০০', period:'১ম ক্লাস' });
    localStorage.setItem(office.ROUTINE_KEY, JSON.stringify(routine));
    window.dispatchEvent(new StorageEvent('storage', { key:office.ROUTINE_KEY }));
  });
  await expect(page.locator('#dashboardRoutineList')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#homeView')).not.toHaveClass(/is-empty-routine/);
  await expect(page.locator('.dashboard-routine-card')).toHaveCount(1);
  await expect(page.locator('.dashboard-routine-card')).toContainText('গণিত');
  await page.evaluate(async () => {
    const office = await import('/js/office-data.js');
    localStorage.setItem(office.ROUTINE_KEY, JSON.stringify(office.blankRoutine()));
    window.dispatchEvent(new StorageEvent('storage', { key:office.ROUTINE_KEY }));
  });
  await expect(page.locator('#dashboardRoutineList')).toHaveAttribute('data-state', 'empty');
  await fits(page);
});

test('available height remeasures when the student header and viewport change', async ({ page }) => {
  await prepare(page, 'light', { width:390, height:844 });
  await fits(page);
  await page.locator('#studentHeader .app-topbar-inner').evaluate(el => el.style.minHeight = '88px');
  await expect.poll(() => page.locator('#appShell').evaluate(shell => {
    const measured = parseFloat(shell.style.getPropertyValue('--student-home-height'));
    return Math.abs(measured - document.querySelector('#appMain').getBoundingClientRect().height) < 1;
  })).toBe(true);
  await fits(page);
  await page.setViewportSize({ width:412, height:915 });
  await fits(page);
});
