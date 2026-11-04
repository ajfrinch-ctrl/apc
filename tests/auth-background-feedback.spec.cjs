const { test, expect } = require('./fixtures.cjs');

test.use({ serviceWorkers: 'block' });

test('background admin verification does not overwrite newer auth feedback', async ({ page }) => {
  await page.addInitScript(() => {
    window.__adminCheckBlocked = new Promise(resolve => { window.__releaseAdminCheck = resolve; });
  });
  await page.route('**/js/admin-initialization.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    export const ADMIN_VERIFY_REQUIRED_MESSAGE = 'admin verification unavailable';
    export const ADMIN_EXISTS_MESSAGE = 'admin exists';
    export const ADMIN_CLAIM_FAILED_MESSAGE = 'admin claim failed';
    export async function claimFirstAdmin() { return { ok: false }; }
    export async function adminInitializationStatus() {
      window.__adminCheckStarted = true;
      await window.__adminCheckBlocked;
      window.__adminCheckFinished = true;
      return { ok: false, reason: 'offline' };
    }
  ` }));
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.__adminCheckStarted)).toBe(true);
  await page.evaluate(async () => {
    const { setAuthMessage } = await import('/js/ui.js');
    setAuthMessage('Login password is incorrect');
  });
  await page.evaluate(() => window.__releaseAdminCheck());
  await expect.poll(() => page.evaluate(() => window.__adminCheckFinished)).toBe(true);
  await expect(page.locator('#authMessage .auth-message-text')).toHaveText('Login password is incorrect');
  await expect(page.locator('#firstAdminFootnote')).toBeHidden();
});
