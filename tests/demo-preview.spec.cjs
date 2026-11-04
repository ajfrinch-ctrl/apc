// The first-run experience of the shipped app: it starts EMPTY.
//
// The one-click demo student, the prefilled login and the demo autofill switch
// were removed on purpose (the app is meant to open with no records, not with
// someone else's data). These tests hold that promise in place, and check that
// the form and the mobile layout still work for a real, empty install.
const { test, expect } = require('@playwright/test');
const { enterPortal } = require('./portal-session.cjs');

const EXAMS = 'activePlus.exams.v1';
const TEACHING = 'activePlus.teaching.v1';
const FINANCE = 'activePlus.admin.transactions.v1';
test.use({ viewport: { width: 390, height: 844 } });

const storeCounts = page => page.evaluate(({ exams, teaching, finance }) => {
  // Anonymous users cannot call the guarded repositories. Inspect the local
  // stores without signing in or causing repository initialization instead.
  const raw = [exams, teaching, finance].map(key => localStorage.getItem(key));
  const examData = JSON.parse(raw[0] || '{}');
  const teachingData = JSON.parse(raw[1] || '{}');
  const transactions = JSON.parse(raw[2] || '[]');
  return {
    exams: (examData.exams || []).length,
    attempts: (examData.attempts || []).length,
    activities: (teachingData.activities || []).length,
    transactions: transactions.length,
    raw
  };
}, { exams: EXAMS, teaching: TEACHING, finance: FINANCE });

test('a fresh install starts empty: no demo data is written behind the user', async ({ page }) => {
  await page.goto('/index.html');

  // Nothing is prefilled — the login card asks for real credentials.
  await expect(page.locator('#loginMobile')).toHaveValue('');
  await expect(page.locator('#loginPin')).toHaveValue('');
  await expect(page.locator('#demoLoginButton')).toHaveCount(0);

  const counts = await storeCounts(page);
  expect(counts.exams).toBe(0);
  expect(counts.attempts).toBe(0);
  expect(counts.activities).toBe(0);
  expect(counts.transactions).toBe(0);

  // Reloading never seeds anything either, and it never repairs a broken store
  // behind the user's back.
  const before = counts.raw;
  await page.reload();
  await expect(page.locator('#loginForm')).toBeVisible();
  expect((await storeCounts(page)).raw).toEqual(before);

  await page.evaluate(key => localStorage.setItem(key, '{broken'), EXAMS);
  await page.reload();
  await expect(page.locator('#loginForm')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), EXAMS)).toBe('{broken');
});

test('the registration form guides with placeholders, not filled examples', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('.auth-tab[data-auth-tab=register]').click();
  const step = page.locator('[data-registration-step="1"]');
  await expect(step).toBeVisible();
  const fields = await step.locator('input, textarea, select').evaluateAll(nodes => nodes
    .filter(node => node.getClientRects().length && !node.disabled
      && !['checkbox', 'radio', 'hidden', 'file', 'submit', 'button'].includes(node.type))
    .map(node => ({ id: node.id || node.name, value: node.value, placeholder: node.placeholder || '' })));
  // Every field is blank, and each one says what belongs in it.
  expect(fields.length).toBeGreaterThan(0);
  for (const field of fields) {
    expect(field.value, `${field.id} must start empty`).toBe('');
    expect(field.placeholder.length, `${field.id} must show a hint`).toBeGreaterThan(0);
  }
});

for (const viewport of [{ width: 320, height: 740 }, { width: 844, height: 390 }]) {
  test(`the teacher activity form fits the mobile layout at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await enterPortal(page, 'teacher');
    // ২০২৬-১১-০১: the home door opens the full records page; the page's own
    // create card opens the shared activity form on top of it.
    await page.locator('#teacherHome [data-panel-view=homework]').click();
    await page.locator('#teacherRecords [data-records-action=create]').click();
    await expect(page.locator('#teacherActivityForm')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#activity-title')).toHaveCSS('font-size', '16px');
    await page.locator('#teacherActivityForm [type=submit]').scrollIntoViewIfNeeded();
    const box = await page.locator('#teacherActivityForm [type=submit]').boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  });
}
