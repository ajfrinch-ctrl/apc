/* Synthetic screenshots of the actual arranged menus and report pages.
 * Local HTTP server required; production accounts/data are never used. */
const { chromium } = require('@playwright/test');
const { enterStudentApp, enterPortal } = require('../tests/portal-session.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox','--disable-dev-shm-usage','--no-zygote']
  });
  const output = path.join(__dirname, '..', 'preview', 'more-144');
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const theme of ['light','dark']) for (const role of ['student','payment']) {
      const context = await browser.newContext({
        baseURL: process.env.APC_BASE_URL || 'http://127.0.0.1:8000', serviceWorkers: 'block',
        viewport: { width: 390, height: 844 }, reducedMotion: 'reduce'
      });
      await context.addInitScript(theme => {
        localStorage.setItem('activePlus.demo.autofill.v1','off');
        localStorage.setItem('active-plus-appearance-v2', theme);
      }, theme);
      const page = await context.newPage();
      if (role === 'student') await enterStudentApp(page);
      else await enterPortal(page, role);
      await page.evaluate(() => document.fonts.ready);
      const more = role === 'student' ? '.bottom-nav [data-view="profile"]' : '.admin-bottom [data-panel-view="settings"]';
      await page.locator(more).click();
      const prefix = role === 'payment' ? 'counter' : role;
      await page.screenshot({ path: path.join(output, `${prefix}-more-${theme}.png`) });
      if (theme === 'light') {
        const link = role === 'student' ? '#profileView [data-view="reports"]' : '#payDeskTools [data-pay-link="reports"]';
        await page.locator(link).click();
        const mount = role === 'student' ? '#studentReports' : '#paymentReports';
        await page.locator(`${mount} select[name="report"]`).waitFor({ state:'visible' });
        await page.screenshot({ path: path.join(output, `${prefix}-reports-${theme}.png`) });
      }
      await context.close();
    }
    console.log('Six synthetic menu/report screenshots saved:', output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
