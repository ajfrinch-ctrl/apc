/* The counter's whole job on one page, in a real browser: search → verify →
   entry → receipt → today's collection. The counter signs in on the shared card
   in index.html, so these steps start from the device-bound session that card
   writes (tests/portal-session.cjs) — the panel has no credential form.

   The desk is privacy-first by design: only name / Student ID / unique roll are
   search keys, and the verify card shows identity only. */
const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');

test.use({ viewport: { width: 390, height: 844 } });

const STUDENTS = 'activePlus.admin.students.v1';
const LEDGER = 'activePlus.admin.transactions.v1';

/* A real device starts with an empty roster; the desk is seeded the way a
   manager's import would leave it. */
async function seedRoster(page) {
  const { adminStudents } = await import('../js/admin-data.js');
  const roster = adminStudents.filter(student => student.status === 'approved');
  await page.addInitScript(({ key, rows }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(rows));
  }, { key: STUDENTS, rows: roster });
  return roster;
}

async function openDesk(page) {
  await enterPortal(page, 'payment');
  await expect(page.locator('#payShell')).toBeVisible();
  await expect(page.locator('#paymentMain')).toHaveAttribute('data-counter-ready', 'true');
}

test('a payment goes in from the student search and lands in today\'s collection', async ({ page }) => {
  const [student] = await seedRoster(page);
  await openDesk(page);

  // শিক্ষার্থী → guarded search by name.
  await page.locator('nav.admin-bottom [data-pay-section="students"]').click();
  await expect(page.locator('[data-pay-panel="students"]')).toBeVisible();
  await page.locator('#payStudentSearch').fill(student.name);
  const result = page.locator('#paySearchResults .fee-search-result').first();
  await expect(result).toBeVisible();
  await expect(result).toContainText(student.id);

  // যাচাই → identity only: no dues, no class, no phone number.
  await result.click();
  const verify = page.locator('#payProfileCard');
  await expect(verify).toBeVisible();
  await expect(verify).toContainText(student.name);
  await expect(verify).toContainText(student.id);
  await expect(page.locator('#payQuickProfile')).not.toContainText('বকেয়া');
  await expect(page.locator('#payQuickProfile')).not.toContainText(student.mobile || '01700000000');

  // পেমেন্ট নিন → the entry panel takes over with an empty amount.
  await page.locator('#payProfileCollect').click();
  await expect(page.locator('[data-pay-panel="payment"]')).toBeVisible();
  await expect(page.locator('#payCollectionForm')).toBeVisible();
  await expect(page.locator('#payFeeAmount')).toHaveValue('');
  await expect(page.locator('#payEntryStudent')).toContainText(student.id);

  await page.locator('#payFeeAmount').fill('700');
  await page.locator('#payFeeType').selectOption({ index: 0 });
  await page.locator('#payFeeMonth').selectOption({ index: 0 });
  await page.locator('#payFeeMethod').selectOption('বিকাশ (bKash)');
  await page.locator('#payFeeTrxId').fill('BK-700-TEST');
  await page.locator('#paySaveButton').click();

  // রসিদ → today's provisional slip; only Manager approval clears dues.
  await expect(page.locator('#payReceiptBackdrop')).toBeVisible();
  await expect(page.locator('#payReceiptTitle')).toContainText('অস্থায়ী পেমেন্ট স্লিপ');
  await expect(page.locator('#payReceiptSub')).toContainText('রসিদ নং:');
  await expect(page.locator('#payReceiptBody')).toContainText('৳৭০০');
  await expect(page.locator('#payReceiptBody')).not.toContainText('017000');

  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), LEDGER);
  const added = stored.find(transaction => transaction.amount === 700 && transaction.trxRef === 'BK-700-TEST');
  expect(added).toBeTruthy();
  expect(added.studentId).toBe(student.id);
  expect(added.status).toBe('pending');
  expect(added.collectedBy).toBe('পেমেন্ট কাউন্টার');
  expect(added.mobile).toBeUndefined();

  // আজকের আদায় → closing the slip lands on হোম with the entry already listed.
  await page.locator('#payReceiptClose').click();
  await expect(page.locator('[data-pay-panel="home"]')).toBeVisible();
  await expect(page.locator('#payTodayList [data-pay-tx]').first()).toContainText(student.name);
  await expect(page.locator('#payTodayList [data-pay-tx]').first()).toContainText('৭০০');
});

test('the desk invents nothing: an empty amount, a one-letter query and a hidden student are refused', async ({ page }) => {
  const [student] = await seedRoster(page);
  await openDesk(page);

  // One letter is not a query.
  await page.locator('nav.admin-bottom [data-pay-section="students"]').click();
  await page.locator('#payStudentSearch').fill('র');
  await expect(page.locator('#paySearchStatus')).toHaveText('নাম, ID, রোল বা মোবাইল লিখুন।');
  await expect(page.locator('#paySearchResults .fee-search-result')).toHaveCount(0);

  // A query with no match never enumerates the roster.
  await page.locator('#payStudentSearch').fill('কেউ নয়');
  await expect(page.locator('#paySearchStatus')).toHaveText('কোনো মিল পাওয়া যায়নি।');
  await expect(page.locator('#paySearchResults .fee-search-result')).toHaveCount(0);

  const ledger = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), LEDGER);
  const before = await ledger();

  // Even with a student selected, an empty amount cannot be saved.
  await page.locator('#payStudentSearch').fill(student.id);
  await page.locator('#paySearchResults .fee-search-result').first().click();
  await page.locator('#payProfileCollect').click();
  await expect(page.locator('#payCollectionForm')).toBeVisible();
  await expect(page.locator('#payFeeAmount')).toHaveValue('');
  await page.locator('#paySaveButton').click();
  await expect(page.locator('#payReceiptBackdrop')).toBeHidden();
  await expect(page.locator('#payCollectionForm')).toBeVisible();
  expect(await ledger()).toEqual(before);

  // A forged selection id cannot bind a payment to any record.
  await page.evaluate(() => {
    const forged = document.createElement('button');
    forged.id = 'forgedPick';
    forged.dataset.payStudent = 'NO-STUDENT';
    document.body.append(forged);
  });
  await page.locator('#forgedPick').click();
  await expect(page.locator('#payProfileCard')).toBeHidden();
});
