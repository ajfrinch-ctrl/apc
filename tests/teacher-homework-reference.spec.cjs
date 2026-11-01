const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
for (const width of [320, 390, 1024]) {
  test(`homework composer preserves publish workflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => localStorage.setItem('activePlus.manager.teacherAssignments.v1', JSON.stringify([
      { id: 'HW-ASSIGN', teacherUsername: 'teacher.apc', teacherName: 'Teacher', className: 'দশম শ্রেণি', group: '', subject: 'গণিত', subjects: ['গণিত'] }
    ])));
    await enterPortal(page, 'teacher');
    /* ২০২৬-১১-০১: দরজা আগে সম্পূর্ণ রেকর্ডস পেজ খোলে (তালিকা খোলা), তারপর
       ওই পেজের তৈরি-কার্ড পুনঃব্যবহৃত হোমওয়ার্ক কম্পোজার খোলে।
       Homework uses the same standard modal/sheet as every other teacher
       dialog: scrim-backed card, app chrome stays visible behind it, and no
       fullscreen takeover or cloned bottom navigation. */
    await page.locator('#teacherHome [data-teacher-view="homework"]').click();
    await expect(page.locator('#teacherRecords')).toBeVisible();
    await page.locator('#teacherRecords [data-records-action="create"]').click();
    await expect(page.locator('#teacherModalBackdrop')).toBeVisible();
    await expect(page.locator('#teacherModalBackdrop')).not.toHaveClass(/is-homework-editor/);
    await expect(page.locator('.teacher-composer-nav')).toHaveCount(0);
    await expect(page.locator('.app-topbar')).toBeAttached();
    await expect(page.locator('.admin-bottom')).toBeAttached();
    await expect(page.locator('#activity-className')).toBeVisible();
    await expect(page.locator('#activity-subject')).toHaveValue('গণিত');
    await page.locator('#activity-title').fill('অনুশীলনী ১');
    await page.locator('#activity-details').fill('প্রথম পাঁচটি অঙ্ক করো।');
    await page.locator('#activity-date').fill('2026-12-01');
    await page.locator('.homework-options summary').click();
    await page.locator('#activity-time').fill('17:00');
    await page.locator('.homework-attachment summary').click();
    await page.locator('#activity-resourceURL').fill('https://github.com/ajfrinch-ctrl/apc');
    await expect(page.locator('#teacherActivityForm [type="submit"]')).toHaveText('প্রকাশ করুন');
    await page.locator('#teacherActivityForm [type="submit"]').click();
    await expect(page.locator('#teacherModalBackdrop')).toBeHidden();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('activePlus.teaching.v1')).activities.find(item => item.title === 'অনুশীলনী ১'));
    expect(saved.status).toBe('published');
    expect(saved.subject).toBe('গণিত');
    expect(saved.resourceURL).toBe('https://github.com/ajfrinch-ctrl/apc');
    await page.locator('.admin-bottom [data-teacher-view="home"]').click();
    await page.locator('#teacherHome [data-teacher-view="homework"]').click();
    await page.locator('#teacherRecords [data-records-action="create"]').click();
    await expect(page.locator('#teacherModalBackdrop')).toBeVisible();
    await page.locator('#teacherModalClose').click();
    await expect(page.locator('#teacherModalBackdrop')).toBeHidden();
    await page.locator('.admin-bottom [data-teacher-view="classes"]').click();
    await expect(page.locator('#teacherClasses')).toBeVisible();
  });
}
