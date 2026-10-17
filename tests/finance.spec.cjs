/* Money has two hands: the Cash Counter collects (never approves), the Manager
   approves, sees dues and the payment history. The Admin panel keeps no cash
   entry at all — its way to look at money is the Report Center. */
const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');
const fs = require('node:fs/promises');

const VIEWS = [{ width: 320 }, { width: 390 }, { width: 1280 }];

async function suppressAutoAlertOnNextLoad(page) {
  await page.addInitScript(() => {
    const dismiss = () => document.querySelector('#apcAlertBackdrop [data-apc-alert-close]')?.click();
    const observe = () => {
      const root = document.body || document.documentElement;
      if (!root) return;
      new MutationObserver(dismiss).observe(root, { childList: true, subtree: true });
      dismiss();
    };
    if (document.body) observe(); else document.addEventListener('DOMContentLoaded', observe, { once: true });
  });
}

/** Seed a database snapshot (not a Counter write): two approved, one pending. */
async function seedLedger(page) {
  await page.evaluate(async () => {
    const { stampTransaction, monthLabel, TRANSACTIONS_KEY } = await import('/js/finance-data.js');
    const { adminStudents } = await import('/js/admin-data.js');
    const people = adminStudents.filter(student => student.status === 'approved').slice(0, 3);
    const now = new Date();
    const rows = people.map((person, index) => stampTransaction({
      id: `FIN-SPEC-${index}`, studentId: person.id, studentName: person.name,
      uniqueRoll: '261001001', className: person.className || '',
      feeType: 'মাসিক বেতন', month: monthLabel(now), amount: 1500,
      method: index === 1 ? 'বিকাশ (bKash)' : 'নগদ (Cash)', trxRef: '',
      collectedBy: 'পেমেন্ট কাউন্টার', counterUsername: 'payment.apc',
      status: index === 2 ? 'pending' : 'approved', reviewHistory: [], note: ''
    }, now));
    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(rows));
  });
}

for (const { width } of VIEWS) {
  test(`Manager runs the whole hisab and the Admin panel has no cash entry at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setViewportSize({ width, height: 844 });
    await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));

    await enterPortal(page, 'manager');
    await expect(page.locator('#managerShell')).toBeVisible();
    await seedLedger(page);
    await suppressAutoAlertOnNextLoad(page);
    await page.reload();
    await page.locator('.admin-bottom [data-manager-view=finance]').click();

    // Four KPIs over the one ledger: approved total, this month, dues, pending.
    await expect(page.locator('#mgrFinanceTotal')).toHaveText('৳৩,০০০');
    await expect(page.locator('#mgrFinanceMonth')).toHaveText('৳৩,০০০');
    await expect(page.locator('#mgrFinancePending')).toHaveText('১');
    await expect(page.locator('#mgrFinanceDue')).not.toBeEmpty();
    await expect(page.locator('#managerFinancePendingBadge')).toBeVisible();
    await expect(page.locator('.manager-finance-tabs .manager-finance-tab')).toHaveCount(4);
    await expect(page.locator('.manager-finance-tab.active')).toHaveAttribute('data-finance-segment', 'collection');
    await expect(page.locator('.manager-finance-tab.active')).toHaveCSS('background-color', 'rgb(14, 122, 85)');
    const preview = page.locator('#managerCollectionPendingList .manager-collection-row');
    await expect(preview).toHaveCount(1);
    await expect(preview.first()).toHaveAttribute('data-pending-payment', 'FIN-SPEC-2');
    await expect(preview.first()).toContainText('৳১,৫০০');
    // The preview's own link opens the existing Manager approval queue.
    await page.locator('#managerFinanceApprovalLink').click();
    await expect(page.locator('[data-finance-panel=approval]')).toBeVisible();

    // Adequate segments: collection, approval, due, history.
    for (const segment of ['collection', 'approval', 'due', 'history']) {
      await page.locator(`[data-finance-segment=${segment}]`).click();
      await expect(page.locator(`[data-finance-panel=${segment}]`)).toBeVisible();
    }
    // Return to the approval queue before taking a decision on its action row.
    await page.locator('[data-finance-segment=approval]').click();
    await expect(page.locator('[data-finance-panel=approval]')).toBeVisible();
    // The pending counter entry is what the Manager approves — never the other way.
    await expect(page.locator('#managerCashList')).toContainText('অনুমোদন বাকি');
    await page.locator('#managerCashList [data-manager-action=approve-payment]').first().click();
    await expect(page.locator('#mgrFinancePending')).toHaveText('০');
    // History reads the same records; the search never leaves this panel's data.
    await page.locator('[data-finance-segment=history]').click();
    await expect(page.locator('#managerPaymentList .manager-record')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // No collection form here — collecting is the counter's seat, approving is his.
    await expect(page.locator('#feeCollectionForm, #feeSaveButton, #paySaveButton, #payFeeAmount')).toHaveCount(0);

    // Admin isolation is checked in its own fresh-device test below.
    expect(errors).toEqual([]);
  });
}

test('Manager can approve a pending payment directly from the compact collection preview', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
  await enterPortal(page, 'manager');
  await seedLedger(page);
  await suppressAutoAlertOnNextLoad(page);
  await page.reload();
  await page.locator('.admin-bottom [data-manager-view=finance]').click();
  await expect(page.locator('#mgrFinancePending')).toHaveText('১');
  const row = page.locator('#managerCollectionPendingList .manager-collection-row');
  await expect(row).toHaveCount(1);
  await row.locator('[data-manager-action=approve-payment]').click();
  await expect(page.locator('#mgrFinancePending')).toHaveText('০');
  await expect(row).toHaveCount(0);
  await expect(page.locator('#mgrFinanceCollectionNote')).toContainText('কোনো পেমেন্ট অনুমোদনের অপেক্ষায় নেই');
});

test('Admin reads money through the Report Center: Generate → preview → PDF', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
  await enterPortal(page, 'admin');
  await expect(page.locator('#adminShell')).toBeVisible();
  await expect(page.locator('#feeStudentSearch, #feeCollectionForm, #feeProfileCollect, #btnFinanceGoCollect, #dashCollectFee, #mgrFinanceTotal, #recentTrxList, #studentLedgerList')).toHaveCount(0);
  await seedLedger(page);
  await suppressAutoAlertOnNextLoad(page);
  await page.reload();
  await page.locator('.admin-bottom [data-admin-view=reports]').click();
  const select = page.locator('#adminReports select[name=report]');
  await expect(page.locator('#adminReports .rc-preview')).toHaveCount(0);
  await select.selectOption('fee.transactions');
  await page.locator('#adminReports .rc-generate').click();
  await expect(page.locator('#adminReports .rc-preview')).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.locator('#adminReports .rc-download').click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = await fs.readFile(await file.path());
  expect(bytes.toString('latin1').startsWith('%PDF-1.')).toBe(true);
  expect(bytes.toString('latin1')).toContain('%%EOF');
});
