const { test, expect } = require('./fixtures.cjs');
const { enterStudentApp } = require('./portal-session.cjs');
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
for (const width of [320, 390, 1024]) {
  test(`reference dashboard preserves shortcuts and navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await enterStudentApp(page);
    await expect(page.locator('#homeView')).toBeVisible();
    await expect(page.locator('#studentServices .pay-tile')).toHaveCount(6);
    await expect(page.locator('#dashboardPendingSummary')).not.toContainText('লোড');
    const grid = page.locator('#studentServices');
    const routine = page.locator('.dashboard-today-section');
    await expect(page.locator('.hero-slider')).toBeVisible();
    expect((await routine.boundingBox()).y).toBeLessThan((await grid.boundingBox()).y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#notificationButton')).toBeVisible();
    await page.locator('#studentServices [data-view="exams"]').click();
    await expect(page.locator('#examsView')).toBeVisible();
    await page.locator('.bottom-nav [data-view="home"]').click();
    await expect(page.locator('.home-progress-details')).toHaveCount(0);
  });
}
