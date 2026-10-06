const { test, expect } = require('./fixtures.cjs');
const viewports = [{width:320,height:740}, {width:390,height:844}, {width:844,height:390}, {width:1280,height:900}];
async function noOverflow(page, selector) {
  expect(await page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
for (const viewport of viewports) {
  test(`student app keeps phone layout at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto('/index.html');
    await expect(page.locator('#authScreen')).toBeVisible();
    expect((await page.locator('#authScreen').boundingBox()).width).toBe(Math.min(viewport.width,480));
    expect(await page.locator('body').evaluate(el => getComputedStyle(el).paddingTop)).toBe('0px');
    await page.locator('.auth-tab[data-auth-tab=register]').click();
    await expect(page.locator('#registrationForm')).toBeVisible();
    for (const columns of await page.locator('#registrationForm .field-grid:visible').evaluateAll(els => els.map(el => getComputedStyle(el).gridTemplateColumns))) {
      expect(columns.trim().split(' ')).toHaveLength(1);
    }
    await page.locator('.auth-tab[data-auth-tab=login]').click();
    expect(await page.locator('#loginForm input').first().evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
    await page.locator('#demoLoginButton').click();
    await expect(page.locator('#appShell')).toBeVisible();
    await expect(page.locator('.bottom-nav .bottom-link')).toHaveCount(5);
    expect((await page.locator('#appShell').boundingBox()).width).toBe(Math.min(viewport.width,480));
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

  test(`admin forms and report are mobile at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
    await page.goto('/admin.html');
    await page.locator('#adminLoginForm button[type=submit]').click();
    await expect(page.locator('.admin-side')).toHaveCount(0);
    const shell = await page.locator('#adminShell').boundingBox();
    expect(shell.width).toBe(Math.min(viewport.width,480));
    expect((await page.locator('.admin-bottom').boundingBox()).width).toBe(shell.width);
    await page.locator('.admin-bottom [data-admin-view=reports]').click();
    await expect(page.locator('[data-finance-view=collection]').first()).toBeVisible();
    expect(await page.locator('[data-finance-view=collection] .admin-duo').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
    await expect(page.locator('#feeStudentSearch, #feeCollectionForm, #feeProfileCollect, #btnFinanceGoCollect')).toHaveCount(0);
    await noOverflow(page, '#recentTrxList');
    await expect(page.locator('.admin-view[data-view-panel=reports]')).toBeVisible();
    await expect(page.locator('#btnPrintReport, .pad-statement, table')).toHaveCount(0);
    await page.locator('#reportMonth').selectOption('all');
    await expect(page.locator('#reportTrxCount')).toHaveText('৭ টি');
    await expect(page.locator('#reportGrandTotal')).toHaveText('৳১২,৩০০');
    await expect(page.locator('#reportCollectionList .report-payment')).toHaveCount(7);
    await noOverflow(page, '#reportCollectionList');
    await page.locator('#reportMonth').selectOption('সেপ্টেম্বর ২০২৬');
    await page.locator('#reportFeeType').selectOption('মাসিক বেতন');
    await expect(page.locator('#reportTrxCount')).toHaveText('৩ টি');
    await expect(page.locator('#reportGrandTotal')).toHaveText('৳৫,০০০');
    await page.locator('#reportMethod').selectOption('বিকাশ (bKash)');
    await expect(page.locator('#reportTrxCount')).toHaveText('১ টি');
    await expect(page.locator('#reportGrandTotal')).toHaveText('৳১,৫০০');
    await page.locator('#reportCollectionList [data-action=view-receipt]').click();
    await expect(page.locator('#receiptPreviewBox')).toContainText('AP-1024');
    await page.locator('[data-modal-action=close]').click();
    const downloading = page.waitForEvent('download');
    await page.locator('#reportCollectionList [data-action=download-receipt]').click();
    expect((await downloading).suggestedFilename()).toMatch(/\.pdf$/);
    await page.locator('#reportClass').selectOption('নবম শ্রেণি');
    await expect(page.locator('#reportGrandTotal')).toHaveText('৳০');
    await expect(page.locator('#reportCollectionList')).toContainText('কোনো কালেকশন রেকর্ড পাওয়া যায়নি');
    await noOverflow(page, '#adminShell');
    expect(errors).toEqual([]);
  });
}
