const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
for (const width of [320, 390, 1024]) {
  test(`teacher dashboard reference keeps routes and homework creation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await enterPortal(page, 'teacher');
    await expect(page.locator('#teacherHome')).toBeVisible();
    // ২০২৬-১০-২১ রিডিজাইন: চারটি ফুল-ওয়াইড হিরো কার্ড এক কলামে, পুরোনো ৩×২ গ্রিড নেই।
    await expect(page.locator('#teacherHome .teacher-action-card')).toHaveCount(4);
    expect(await page.locator('.teacher-home-actions').evaluate(el => getComputedStyle(el).flexDirection)).toBe('column');
    await expect(page.locator('#teacherHome .teacher-home-tile')).toHaveCount(0);
    // রুটিন দরজা হোমে ফিরেছে — তবে শুধু-পঠন (routine-view); উপস্থিতি-মার্কিং দরজা নয়।
    await expect(page.locator('#teacherHome [data-panel-view="routine-view"]')).toHaveCount(1);
    await expect(page.locator('#teacherHome [data-open-routine-session]')).toHaveCount(0);
    await page.locator('.admin-bottom [data-panel-view="classes"]').click();
    await expect(page.locator('#teacherClasses .teacher-submenu [data-panel-view="routine-view"]')).toBeVisible();
    // ২০২৬-১০-২১: "আজকের সারাংশ" KPI সারফেস হোম থেকে বাদ — কোনো summary কার্ড থাকবে না।
    await expect(page.locator('#teacherHome .teacher-summary-section, #teacherHomeStudentTotal')).toHaveCount(0);
    await expect(page.locator('#teacherHome .hero-slider, #teacherHome .admin-hero')).toHaveCount(0);
    await expect(page.locator('#notificationButton')).toBeVisible();
    await expect(page.locator('.teacher-shell .admin-bottom .admin-bottom-item')).toHaveCount(4);
    // ২০২৬-১০-২১: শিক্ষার্থীর তালিকা সম্পূর্ণ বাদ — স্ক্রিন ও নিচের ন্যাভ-সিট দুটোই নেই।
    await expect(page.locator('.admin-bottom [data-panel-view="students"]')).toHaveCount(0);
    await expect(page.locator('#teacherStudents')).toHaveCount(0);
    expect(await page.locator('#teacherShell').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(Math.min(width, 430));
    expect(await page.locator('.teacher-shell .admin-bottom').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(Math.min(width, 430));
    await expect(page.locator('.admin-bottom [data-panel-view="home"]')).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.admin-bottom [data-panel-view="classes"]').click();
    await expect(page.locator('#teacherClasses')).toBeVisible();
    await expect(page.locator('.admin-bottom [data-panel-view="classes"]')).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.admin-bottom [data-panel-view="home"]').click();
    // ২০২৬-১১-০১: নম্বর ও ফলাফল is a lane of the পরীক্ষা seat; its own route is
    // #marks, and the homework type tab switches to the বাড়ির কাজ lane (which
    // lights the ক্লাস seat).
    await page.locator('.admin-bottom [data-panel-view="online-exams"]').click();
    await page.locator('#teacherOnlineExams [data-panel-view="exam"]').click();
    await page.locator('.teacher-type-tabs [data-type-tab="homework"]').click();
    await expect(page.locator('#teacherRecords')).toBeVisible();
    await expect(page.locator('.admin-bottom [data-panel-view="classes"]')).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
