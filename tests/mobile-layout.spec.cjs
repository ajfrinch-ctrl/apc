const { test, expect } = require('./fixtures.cjs');
const { enterPortal, enterStudentApp } = require('./portal-session.cjs');
const viewports = [{width:320,height:740}, {width:390,height:844}, {width:844,height:390}, {width:1280,height:900}];
async function noOverflow(page, selector) {
  expect(await page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
for (const viewport of viewports) {
  const phoneWidth = Math.min(viewport.width, 430);
  test(`student app keeps phone layout at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto('/index.html');
    await expect(page.locator('#authScreen')).toBeVisible();
    expect((await page.locator('#authScreen').boundingBox()).width).toBe(phoneWidth);
    expect((await page.locator('#authScreen').boundingBox()).x).toBe((viewport.width - phoneWidth) / 2);
    expect(await page.locator('body').evaluate(el => getComputedStyle(el).paddingTop)).toBe('0px');
    await page.locator('.auth-tab[data-auth-tab=register]').click();
    await expect(page.locator('#registrationForm')).toBeVisible();
    for (const columns of await page.locator('#registrationForm .field-grid:visible').evaluateAll(els => els.map(el => getComputedStyle(el).gridTemplateColumns))) {
      expect(columns.trim().split(' ')).toHaveLength(1);
    }
    await page.locator('.auth-tab[data-auth-tab=login]').click();
    expect(await page.locator('#loginForm input').first().evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
    await enterStudentApp(page);
    await expect(page.locator('#appShell')).toBeVisible();
    await expect(page.locator('.bottom-nav .bottom-link')).toHaveCount(5);
    const studentShell = await page.locator('#appShell').boundingBox();
    expect(studentShell.width).toBe(phoneWidth);
    expect(studentShell.x).toBe((viewport.width - phoneWidth) / 2);
    /* The student bar is হোম · পড়াশোনা · রুটিন · পরীক্ষা · আরও; ফলাফল is a tab
       inside পরীক্ষা (Phase 1b), so the mobile sweep walks the real seats. */
    for (const view of ['home','routine','courses','exams','profile']) {
      await page.locator(`.bottom-nav [data-view="${view}"]`).click();
      await expect(page.locator(`#${view}View`)).toBeVisible();
      await noOverflow(page, '#appShell');
      await expect(page.locator('.bottom-nav')).toBeVisible();
    }
    await page.locator('#profileView [data-action=edit-profile]').first().click();
    await expect(page.locator('#editModal')).toBeVisible();
    await noOverflow(page, '#editModal .modal');
    expect(await page.locator('#profileForm select').first().evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
    expect(await page.locator('#profileForm textarea').first().evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
    expect(await page.locator('#profileForm input:visible').first().evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
    await page.locator('#editModal [data-close-modal]').click();
    expect(errors).toEqual([]);
  });

  test(`manager finance, report center and admin reports stay mobile at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    // হিসাব is the Manager's work; the Admin panel keeps reports only.
    await enterPortal(page, 'manager');
    const shell = await page.locator('#managerShell').boundingBox();
    expect(shell.width).toBe(phoneWidth);
    expect(shell.x).toBe((viewport.width - phoneWidth) / 2);
    const managerNav = await page.locator('.admin-bottom').boundingBox();
    expect(managerNav.width).toBe(shell.width);
    expect(managerNav.x).toBe(shell.x);
    await page.locator('.admin-bottom [data-panel-view=finance]').click();
    await expect(page.locator('[data-view-panel=finance]')).toBeVisible();
    await expect(page.locator('#mgrFinanceTotal')).toBeVisible();
    for (const segment of ['collection','approval','due','history']) {
      await page.locator(`[data-finance-segment=${segment}]`).click();
      await expect(page.locator(`[data-finance-panel=${segment}]`)).toBeVisible();
      await noOverflow(page, '#managerShell');
    }
    // No academic or student-directory surface leaks into হিসাব.
    await expect(page.locator('[data-panel-view], [data-panel-view]')).toHaveCount(0);
    await expect(page.locator('#managerStudentList')).toBeHidden();

    // Report Center: More → Reports → Generate → preview, then PDF. No preview first.
    await page.locator('.admin-bottom [data-panel-view=more]').click();
    await page.locator('#managerMoreHub [data-panel-view=reports]').click();
    await expect(page.locator('#managerReports select[name=report]')).toBeVisible();
    await expect(page.locator('#managerReports .rc-pdf-preview')).toHaveCount(0);
    await page.locator('#managerReports select[name=report]').selectOption('fee.transactions');
    await page.locator('#managerReports .rc-generate').click();
    await expect(page.locator('#managerReports .rc-pdf-preview')).toBeVisible();
    const reportFitsPhone = await page.locator('#managerReports .rc-pdf-preview').evaluate(frame => {
      const bounds = frame.getBoundingClientRect();
      return [...frame.querySelectorAll('.rp-page')].every(sheet => {
        const pageBounds = sheet.getBoundingClientRect();
        return pageBounds.left >= bounds.left - 1 && pageBounds.right <= bounds.right + 1;
      });
    });
    expect(reportFitsPhone).toBe(true, 'the scaled A4 page stays within the mobile preview frame');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const downloading = page.waitForEvent('download');
    await page.locator('#managerReports .rc-download').click();
    expect((await downloading).suggestedFilename()).toMatch(/\.pdf$/);
    await page.locator('#managerReports .rc-back').click();
    await noOverflow(page, '#managerShell');

    // The Admin panel's own Report Center mounts, generates and previews too.
    await enterPortal(page, 'admin');
    await expect(page.locator('.admin-side')).toHaveCount(0);
    const adminShell = await page.locator('#adminShell').boundingBox();
    expect(adminShell.width).toBe(phoneWidth);
    expect(adminShell.x).toBe((viewport.width - phoneWidth) / 2);
    await page.locator('.admin-bottom [data-panel-view=reports]').click();
    await expect(page.locator('#adminReports select[name=report]')).toBeVisible();
    await page.locator('#adminReports select[name=report]').selectOption('student.class-wise');
    await page.locator('#adminReports .rc-generate').click();
    await expect(page.locator('#adminReports .rc-pdf-preview')).toBeVisible();
    // An empty device still previews, with the one shared empty message.
    await expect(page.locator('#adminReports .rc-preview-notice')).toHaveText('কোনো তথ্য পাওয়া যায়নি।');
    await noOverflow(page, '#adminShell');
    expect(errors).toEqual([]);
  });
}
