const { test, expect } = require('./fixtures.cjs');
const { seed } = require('./portal-session.cjs');

test.use({ serviceWorkers: 'block' });
const student = {
  id: 's260929001-7555167e8e66bc55', name: 'রায়হান আহমেদ', nameEn: 'Raihan Ahmed',
  fatherName: 'আবদুল করিম', className: 'অষ্টম শ্রেণি', group: 'প্রযোজ্য নয়',
  mobile: '01700000000', guardianMobile: '01800000000', address: 'ঢাকা, বাংলাদেশ',
  enrolledAt: '২৯/৯/২০২৬', lastActive: 'এই ডিভাইস', status: 'approved', attendance: 92, average: 85
};

for (const [width, height, dark] of [[320, 740], [360, 800], [390, 844], [412, 915], [768, 900, true], [1024, 900], [740, 360]]) {
  test(`student record fits ${width}×${height}${dark ? ' dark' : ''}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto('/demo/offline-roles.html');
    await seed(page, 'admin');
    await page.evaluate(student => localStorage.setItem('activePlus.admin.students.v1', JSON.stringify([student])), student);
    await page.goto('/admin.html#students');
    await expect(page.locator('#adminShell')).toBeVisible();
    await expect(page.locator('.launch-screen')).toHaveCount(0);
    const stored = await page.evaluate(() => localStorage.getItem('activePlus.admin.students.v1'));
    if (dark) await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await page.locator('#studentList [data-action="view"]').click();
    await expect(page.locator('.student-record-modal')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('.student-record-identifiers code').first()).toHaveText(student.id);
    const measure = () => page.evaluate(() => {
      const modal = document.querySelector('.student-record-modal');
      const bounds = modal.getBoundingClientRect();
      const content = document.querySelector('.student-record-content');
      const header = modal.querySelector('.admin-modal-header').getBoundingClientRect();
      const actions = modal.querySelector('.student-record-actions').getBoundingClientRect();
      const overflow = [...modal.querySelectorAll('*')].filter(el => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && (box.left < bounds.left || box.right > bounds.right + 1);
      }).map(el => el.className);
      const phoneLines = [...modal.querySelectorAll('.student-record-phone dd')].map(el => {
        const range = document.createRange(); range.selectNodeContents(el);
        return range.getClientRects().length;
      });
      return {
        fits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
        overflow, phoneLines,
        closeTop: modal.querySelector('#adminModalClose').getBoundingClientRect().top,
        actionsTop: actions.top,
        headerSeparated: content.getBoundingClientRect().top >= header.bottom - 1,
        footerSeparated: content.getBoundingClientRect().bottom <= actions.top + 1,
        canScroll: content.scrollHeight > content.clientHeight
      };
    });
    const before = await measure();
    expect(before.fits).toBe(true);
    expect(before.overflow).toEqual([]);
    expect(before.phoneLines).toEqual([1, 1]);
    expect(before.headerSeparated && before.footerSeparated).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('student-record.png') });
    await page.locator('.student-record-content').evaluate(el => el.scrollTop = el.scrollHeight);
    const after = await measure();
    expect(after.closeTop).toBe(before.closeTop);
    expect(after.actionsTop).toBe(before.actionsTop);
    await expect(page.locator('[data-modal-action="edit"]')).toBeInViewport();
    await page.locator('[data-modal-action="edit"]').click();
    await expect(page.locator('#studentEditForm')).toBeVisible();
    await expect(page.locator('.student-record-modal')).toHaveCount(0);
    await page.locator('#adminModalClose').click();
    await page.locator('#studentList [data-action="view"]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#adminModalBackdrop')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('activePlus.admin.students.v1'))).toEqual(stored);
  });
}
