const { test, expect } = require('./fixtures.cjs');
const { enterStudentApp, enterPortal } = require('./portal-session.cjs');

async function barsStayInPlace(page, { header, footer, main }) {
  await expect.poll(() => page.evaluate(({ header, footer, main }) => {
    const top = document.querySelector(header).getBoundingClientRect();
    const bottom = document.querySelector(footer).getBoundingClientRect();
    const content = document.querySelector(main).getBoundingClientRect();
    return Math.abs(top.top) < 1 && Math.abs(bottom.bottom - innerHeight) < 1 &&
      Math.abs(content.top - top.bottom) <= 1 && Math.abs(content.bottom - bottom.top) <= 1;
  }, { header, footer, main })).toBe(true);
  await expect(page.locator(header)).toHaveCSS('position', 'fixed');
  await expect(page.locator(footer)).toHaveCSS('position', 'fixed');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`student header/footer stay fixed while middle scrolls (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/index.html');
    await enterStudentApp(page);
    const selectors = { header: '#studentHeader', footer: '.bottom-nav', main: '#appMain' };
    await barsStayInPlace(page, selectors);
    await page.locator('#appMain').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => page.locator('#appMain').evaluate(el => el.scrollTop)).toBeGreaterThan(76);
    await expect(page.locator('#studentHeader [data-fixed-tagline]')).toBeVisible();
    await barsStayInPlace(page, selectors);
    const lastBottom = await page.locator('#homeView > :last-child').evaluate(el => el.getBoundingClientRect().bottom);
    const footerTop = (await page.locator('.bottom-nav').boundingBox()).y;
    expect(lastBottom).toBeLessThanOrEqual(footerTop);
    // The login-style identity stays unchanged when a bottom tab changes the view.
    await page.locator('.bottom-nav [data-view=routine]').click();
    await expect.poll(() => page.locator('#appMain').evaluate(el => el.scrollTop)).toBe(0);
    await expect(page.locator('#studentHeader')).not.toHaveClass(/is-scrolled/);
    await barsStayInPlace(page, selectors);
    await page.setViewportSize({ width: 390, height: 520 });
    await barsStayInPlace(page, selectors);
    // Actual header size, not a hard-coded offset, reserves the content space.
    await page.locator('#studentHeader').evaluate(el => { el.style.height = '90px'; });
    await barsStayInPlace(page, selectors);
  });

  test(`admin header/footer stay fixed on a long report (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    // A real roster, so the report is long enough to scroll in the middle pane.
    await page.addInitScript(() => {
      const key = 'activePlus.admin.students.v1';
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
        id: `FIX-${index}`, name: `শিক্ষার্থী ${index}`, mobile: `017${String(10000000 + index)}`,
        className: 'দশম শ্রেণি', status: 'approved', monthlyFee: 1000, enrolledAt: '2026-09-01'
      }))));
    });
    await enterPortal(page, 'admin');
    await page.locator('.admin-bottom [data-admin-view=reports]').click();
    await expect(page.locator('.admin-view[data-view-panel=reports]')).toBeVisible();
    const selectors = { header: '.app-topbar', footer: '.admin-bottom', main: '#adminMain' };
    await barsStayInPlace(page, selectors);
    await page.locator('#adminReports select[name=report]').selectOption('student.class-wise');
    await page.locator('#adminReports .rc-generate').click();
    await expect(page.locator('#adminReports .rc-preview')).toBeVisible();
    await page.locator('#adminMain').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => page.locator('#adminMain').evaluate(el => el.scrollTop)).toBeGreaterThan(50);
    await barsStayInPlace(page, selectors);
    // The preview's own last page never hides under the fixed footer.
    const last = page.locator('#adminReports .rc-pdf-preview .rp-page').last();
    const box = await last.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual((await page.locator('.admin-bottom').boundingBox()).y + 1);
    // Going back to the report form and changing seat resets the middle pane.
    await page.locator('#adminReports .rc-back').click();
    await page.locator('.admin-bottom [data-admin-view=dashboard]').click();
    await expect.poll(() => page.locator('#adminMain').evaluate(el => el.scrollTop)).toBe(0);
    await barsStayInPlace(page, selectors);
    await page.setViewportSize({ width: 390, height: 520 });
    await barsStayInPlace(page, selectors);
    await page.locator('.app-topbar').evaluate(el => { el.style.height = '90px'; });
    await barsStayInPlace(page, selectors);
  });
}

for (const entry of ['index.html', 'admin.html']) {
  test(`login header stays fixed while the auth form scrolls (${entry})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 400 });
    await page.goto('/' + entry);
    await page.locator('.auth-screen').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => page.locator('.auth-screen').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect((await page.locator('.auth-screen .app-topbar').boundingBox()).y).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    if (entry === 'index.html') {
      await page.locator('.auth-tab[data-auth-tab=register]').click();
      await expect.poll(() => page.locator('#authScreen').evaluate(el => el.scrollTop)).toBe(0);
    }
  });
}

test('pending account confirmation still scrolls to its logout button', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 400 });
  await page.addInitScript(() => localStorage.setItem('active-plus-account-v1', JSON.stringify({ status: 'pending', studentId: 'PENDING-1', student: { name: 'শিক্ষার্থী' } })));
  await page.goto('/index.html');
  await expect(page.locator('#pendingScreen')).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await page.locator('#pendingScreen').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => page.locator('#pendingScreen').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.locator('#pendingLogout').click();
  await expect(page.locator('#authScreen')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

for (const width of [320, 390, 480]) {
  test(`student reuses login branding, with one bell and no legacy header (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/index.html');
    // One bar for the whole app: the login screen and the student app paint the
    // same logo, the same slogan and the same height.
    await expect(page.locator('#authScreen .app-brand [data-fixed-tagline]')).toBeVisible();
    const loginHeight = (await page.locator('#authScreen .app-topbar').boundingBox()).height;
    await enterStudentApp(page);
    await expect(page.locator('#studentHeader')).toBeVisible();
    expect((await page.locator('#studentHeader').boundingBox()).height).toBe(loginHeight);
    await expect(page.locator('#studentHeader .app-brand [data-fixed-tagline]')).toBeVisible();
    await expect(page.locator('#appShell .topbar, #topbarStudentName, #weatherStatus, #currentTime, .topbar-strip')).toHaveCount(0);
    await expect(page.locator('#studentHeader .app-topbar-actions button')).toHaveCount(2);
    await expect(page.locator('#notificationButton')).toHaveCount(1);
    await expect(page.locator('#notificationButton')).toBeVisible();
    await expect(page.locator('#studentLogout')).toBeVisible();
    expect(await page.locator('#studentHeader .app-brand [data-fixed-tagline]').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#notificationButton').click();
    await expect(page.locator('#noticeModal')).toBeVisible();
    await expect(page.locator('.notification-dot')).toBeHidden();
    await page.locator('#noticeModal .modal-action').click();
    await page.reload();
    await expect(page.locator('#studentHeader')).toBeVisible();
    await expect(page.locator('.notification-dot')).toBeHidden();
  });
}
