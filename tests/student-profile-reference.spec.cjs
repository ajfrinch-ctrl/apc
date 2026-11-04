const { test, expect } = require('./fixtures.cjs');
const { readFile } = require('node:fs/promises');
const { enterStudentApp } = require('./portal-session.cjs');
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
for (const width of [320, 390, 1024]) {
  test(`profile reference preserves identity, card download and editing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await enterStudentApp(page);
    await page.locator('.bottom-nav [data-view="profile"]').click();
    await page.locator('#profileView [data-view="my-profile"]').click();
    await expect(page.locator('#profileName')).toHaveText('রাইসা');
    await expect(page.locator('#studentId')).toHaveText('AP-1024');
    await expect(page.locator('#profileUsername')).toHaveText('raisa.islam');
    await expect(page.locator('#profileAttendanceRate')).toHaveText('—');
    await expect(page.locator('#profileInstitution')).toHaveText('—');
    await expect(page.locator('.bottom-nav')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#profilePhotoInput').setInputFiles({
      name: 'avatar.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    });
    await expect(page.locator('#profilePhoto')).toBeVisible();
    await expect(page.locator('#profilePhoto')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await page.locator('#profileIdCardButton').click();
    await expect(page.locator('#studentIdCardView')).toBeVisible();
    await expect(page.locator('#studentIdCardPreview')).toContainText('AP-1024');
    await page.locator('#studentIdCardFlip').click();
    await expect(page.locator('[data-id-card-side="back"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#studentIdCardPreview')).toContainText('ব্যবহারের শর্ত');
    await expect(page.locator('#studentIdCardPreview')).toContainText('AP-1024');
    const download = page.waitForEvent('download');
    await page.locator('#studentIdCardDownload').click();
    const cardDownload = await download;
    expect(cardDownload.suggestedFilename()).toBe('student-id-AP-1024-back.png');
    expect((await readFile(await cardDownload.path())).subarray(0, 8)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
    await page.locator('#studentIdCardFlip').click();
    await expect(page.locator('#studentIdCardPreview')).toContainText('রাইসা');
    await page.locator('#studentIdCardView .pay-back').click();
    await page.locator('.profile-update-button').click();
    await expect(page.locator('#editModal')).toBeVisible();
    await page.locator('[data-close-modal="editModal"]').first().click();
    await page.locator('#myProfileView .pay-back').click();
    await expect(page.locator('#profileView')).toBeVisible();
    await expect(page.locator('.bottom-nav')).toBeVisible();
  });
}
