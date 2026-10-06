/* Payment Receive panel: guarded search (name/mobile/ID/guardian), short profile,
   payment save through the shared financeRepository, receipt PDF and the
   one-click WhatsApp hand-off straight to the student's own number.

   The counter carries no login form of its own any more: it opens on the shared
   card in index.html and the device-bound session that card writes, and it gets
   the same five-group Settings hub as every other role — including the one
   password row, served by the shared staff dialog. */
const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');

test.use({ viewport: { width: 390, height: 844 } });

const STUDENTS = 'activePlus.admin.students.v1';

/* A real device starts with an empty roster; the counter is evaluated on the
   roster a manager's import would have left behind. */
async function seedRoster(page) {
  const { adminStudents } = await import('../js/admin-data.js');
  const roster = adminStudents.filter(student => student.status === 'approved');
  await page.addInitScript(({ key, rows }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(rows));
  }, { key: STUDENTS, rows: roster });
  return roster;
}

async function enter(page) {
  await enterPortal(page, 'payment');
  await expect(page.locator('#payShell')).toBeVisible();
}

test('the counter opens on a session only, and locks itself out without one', async ({ page }) => {
  // No credential form lives on the panel: one shared login card is the only door.
  await page.goto('/payment.html');
  await expect(page.locator('#payShell')).toBeHidden();
  await expect(page.locator('#payEntry, #payLoginForm, #payLoginUser, #payLoginPin')).toHaveCount(0);
  await expect(page.locator('#apcPanelLock')).toBeVisible();

  // The lock card's one exit is the shared login page.
  await page.locator('#apcPanelLockLogin').click();
  await page.waitForURL('**/index.html');
  await expect(page.locator('#authScreen')).toBeVisible();

  // A real session opens the desk, and a reload keeps it open.
  await enter(page);
  await page.reload();
  await expect(page.locator('#payShell')).toBeVisible();

  // Logout clears the session and hands the device back to the login page.
  await page.locator('#payExitButton').click();
  await page.waitForURL('**/index.html');
  await expect(page.locator('#authScreen')).toBeVisible();
  await page.goto('/payment.html');
  await expect(page.locator('#payShell')).toBeHidden();
  await expect(page.locator('#apcPanelLock')).toBeVisible();
});

test('the counter changes its own password from Settings; only that password signs in', async ({ page }) => {
  await enter(page);

  // Settings → অ্যাকাউন্ট carries the same one password row every staff panel has.
  await page.locator('[data-pay-section="more"]').click();
  const row = page.locator('#payMorePanel [data-settings-row="password"]');
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page.locator('.staff-pw-backdrop')).toBeVisible();
  await expect(page.locator('.staff-pw-backdrop')).toHaveAttribute('data-staff-pw', 'payment');

  // A short or mismatched pair is refused before anything is stored.
  await page.locator('#staffPwNew').fill('123');
  await page.locator('#staffPwConfirm').fill('123');
  await page.locator('.staff-pw-form button[type=submit]').click();
  await expect(page.locator('.staff-pw-error')).toBeVisible();
  await page.locator('#staffPwNew').fill('Apc-Counter-2026');
  await page.locator('#staffPwConfirm').fill('Apc-Counter-2027');
  await page.locator('.staff-pw-form button[type=submit]').click();
  await expect(page.locator('.staff-pw-error')).toBeVisible();

  await page.locator('#staffPwNew').fill('Apc-Counter-2026');
  await page.locator('#staffPwConfirm').fill('Apc-Counter-2026');
  await page.locator('.staff-pw-form button[type=submit]').click();
  await expect(page.locator('.staff-pw-backdrop')).toBeHidden();

  // The record holds a PBKDF2 hash; the typed password is nowhere in storage.
  const stored = await page.evaluate(() => localStorage.getItem('activePlus.paymentAccount.v1'));
  expect(stored).toBeTruthy();
  expect(stored).not.toContain('Apc-Counter-2026');
  const record = JSON.parse(stored);
  expect(record.password.algo).toBe('PBKDF2');
  expect(record.password.digest).toMatch(/^[0-9a-f]{64}$/);

  // The old password no longer signs in on the shared card; the new one does.
  await page.locator('#payExitButton').click();
  await page.waitForURL('**/index.html');
  await page.fill('#loginMobile', 'payment.apc');
  await page.fill('#loginPin', 'Apc-E2E-2026');
  await page.click('#loginForm button[type=submit]');
  await expect(page.locator('#authMessage')).toBeVisible();
  await expect(page.locator('#authMessage')).toContainText('সঠিক নয়');

  await page.fill('#loginPin', 'Apc-Counter-2026');
  await page.click('#loginForm button[type=submit]');
  await page.waitForURL('**/payment.html');
  await expect(page.locator('#payShell')).toBeVisible();
});

test('the counter desk opens on হোম with the five counter tabs and nothing else', async ({ page }) => {
  await seedRoster(page);
  await enter(page);
  // The counter's own five seats, one per step of its job.
  const seats = page.locator('nav.admin-bottom [data-pay-section]');
  await expect(seats).toHaveText(['হোম', 'শিক্ষার্থী', 'পেমেন্ট', 'রিপোর্ট', 'আরও']);
  await expect(page.locator('nav.admin-bottom [aria-current="page"]')).toHaveAttribute('data-pay-section', 'home');
  await expect(page.locator('[data-pay-panel="home"]')).toBeVisible();

  // No other role's views live anywhere on this page.
  await expect(page.locator('[data-admin-view], [data-manager-view], [data-teacher-view], [data-student-view]')).toHaveCount(0);

  // An empty day says so instead of inventing rows.
  await expect(page.locator('#payTodayList')).toContainText('আজ এখনও কোনো লেনদেন নেই।');
});

test('search resolves identity only: name, Student ID and roll — never phone, class or guardian', async ({ page }) => {
  const [student] = await seedRoster(page);
  await enter(page);
  await page.locator('nav.admin-bottom [data-pay-section="students"]').click();

  for (const query of [student.name, student.id, student.uniqueRoll]) {
    await page.locator('#payStudentSearch').fill(String(query));
    await expect(page.locator('#paySearchResults .fee-search-result')).toHaveCount(1);
    await expect(page.locator('#paySearchResults .fee-search-result')).toContainText(student.name);
    await expect(page.locator('#paySearchResults .fee-search-result')).toContainText(student.id);
  }

  // Nothing but identity is rendered — no dues, class, phone or guardian.
  const card = await page.locator('#paySearchResults').textContent();
  expect(card).not.toContain('বকেয়া');
  expect(card).not.toContain(String(student.mobile || '01700000000'));

  // A phone number, the class and the guardian name are not search keys.
  for (const query of [String(student.mobile || '01700000000'), String(student.className), String(student.guardianMobile || '01800000000')]) {
    await page.locator('#payStudentSearch').fill(query);
    await expect(page.locator('#paySearchResults .fee-search-result')).toHaveCount(0);
  }
});

test('verify → entry → receipt: a pending slip, a stored entry and a receipt PDF', async ({ page }) => {
  const [student] = await seedRoster(page);
  await enter(page);
  await page.locator('nav.admin-bottom [data-pay-section="students"]').click();
  await page.locator('#payStudentSearch').fill(student.id);
  await page.locator('#paySearchResults .fee-search-result').first().click();

  const verify = page.locator('#payProfileCard');
  await expect(verify).toContainText(student.name);
  await expect(verify).toContainText(student.id);
  await expect(verify).toContainText('পেমেন্ট নিন');

  await page.locator('#payProfileCollect').click();
  await expect(page.locator('#payCollectionForm')).toBeVisible();
  await expect(page.locator('#payEntryStudent')).toContainText(student.id);
  await page.locator('#payFeeAmount').fill('800');
  await page.locator('#payFeeMethod').selectOption('নগদ (Cash)');
  await page.locator('#payFeeTrxId').fill('COUNTER-800');
  await page.locator('#paySaveButton').click();

  // Durable save first, then the slip — and it is provisional, not final.
  await expect(page.locator('#payReceiptBackdrop')).toBeVisible();
  await expect(page.locator('#payReceiptSub')).toContainText('রসিদ নং: R');
  await expect(page.locator('#payReceiptBody')).toContainText('৳৮০০');
  await expect(page.locator('#payReceiptTitle')).toContainText('অস্থায়ী পেমেন্ট স্লিপ');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('activePlus.admin.transactions.v1') || '[]'));
  const added = stored.find(tx => tx.amount === 800 && tx.trxRef === 'COUNTER-800');
  expect(added).toBeTruthy();
  expect(added.status).toBe('pending');
  expect(added.collectedBy).toBe('পেমেন্ট কাউন্টার');

  const pdf = page.waitForEvent('download');
  await page.locator('#payReceiptDownload').click();
  expect((await pdf).suggestedFilename()).toMatch(/^R\d{9}\.pdf$/);

  // The entry is on the counter's own day list; closing lands on হোম.
  await page.locator('#payReceiptClose').click();
  await expect(page.locator('[data-pay-panel="home"]')).toBeVisible();
  await expect(page.locator('#payTodayList [data-pay-tx]').first()).toContainText(student.name);
});

test('হোম → আজকের ক্লোজিং opens the Report Center with the closing report preselected', async ({ page }) => {
  await seedRoster(page);
  await enter(page);
  await page.locator('#payClosingShortcut').click();

  // The Report Center contract: generate first, then preview — never before.
  await expect(page.locator('[data-pay-panel="reports"]')).toBeVisible();
  const choices = page.locator('#paymentReports select[name="report"]');
  await expect(choices).toHaveValue('cash.closing');
  await expect(page.locator('[data-counter-download]')).toHaveCount(0);

  await page.locator('#paymentReports form.counter-report-form button[type=submit]').click();

  // No matching data still previews — with the one shared empty message.
  await expect(page.locator('.rc-preview-notice')).toHaveText('কোনো তথ্য পাওয়া যায়নি।');
  await expect(page.locator('[data-counter-download="pdf"], [data-counter-download="csv"]')).toHaveCount(2);
});
