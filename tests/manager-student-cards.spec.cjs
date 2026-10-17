const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');

const viewportCases = [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 900 }
];
const roster = [
  { id: 'S-PENDING', name: 'পেন্ডিং শিক্ষার্থী', className: 'নবম শ্রেণি', group: 'A', mobile: '01700000000', guardianMobile: '01800000000', status: 'pending', enrolledAt: '2026-10-17' },
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `S-APPROVED-${index + 1}`,
    name: `অনুমোদিত শিক্ষার্থী ${index + 1}`,
    className: 'অষ্টম শ্রেণি',
    group: 'B',
    mobile: `0170000000${index + 1}`,
    guardianMobile: `0180000000${index + 1}`,
    status: 'approved',
    monthlyFee: 1500,
    attendance: 88,
    average: 4.2
  })),
  { id: 'S-INACTIVE', name: 'নিষ্ক্রিয় শিক্ষার্থী', className: 'সপ্তম শ্রেণি', group: 'A', mobile: '01711111111', status: 'inactive', monthlyFee: 1200 },
  { id: 'S-REJECTED', name: 'বাতিল নিবন্ধন', className: 'ষষ্ঠ শ্রেণি', group: 'C', mobile: '01722222222', status: 'rejected', monthlyFee: 1000 }
];

async function enterStudents(page) {
  await enterPortal(page, 'manager');
  await page.evaluate(async students => {
    const { saveRoster } = await import('/js/office-data.js');
    if (!saveRoster(students)) throw new Error('E2E Manager roster fixture could not be stored');
  }, roster);
  await page.reload();
  await expect(page.locator('#managerShell')).toBeVisible();
  const alertClose = page.locator('#apcAlertBackdrop [data-apc-alert-close]').first();
  await alertClose.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
  if (await alertClose.isVisible().catch(() => false)) await alertClose.click();
  await page.locator('.manager-bottom [data-manager-view="students"]').click();
  await expect(page.locator('.manager-view[data-view-panel="students"]')).toBeVisible();
  await expect(page.locator('#managerPendingBadge')).toHaveText('১ অপেক্ষমাণ');
}

for (const viewport of viewportCases) {
  test(`Manager student cards are compact, unique and usable at ${viewport.width}px`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await enterStudents(page);

    const queue = page.locator('#managerStudentQueue');
    const list = page.locator('#managerStudentList');
    const pending = page.locator('#managerStudentQueue [data-manager-student="S-PENDING"]');
    const approved = page.locator('#managerStudentList [data-manager-student="S-APPROVED-1"]');
    const pendingDetails = pending.locator('.manager-student-details');
    const approvedDetails = approved.locator('.manager-student-details');
    const detailToggles = page.locator('#managerStudentQueue .manager-student-details-toggle, #managerStudentList .manager-student-details-toggle');

    await expect(queue).toBeVisible();
    await expect(pending).toHaveCount(1);
    await expect(list.locator('[data-manager-student]')).toHaveCount(6);
    await expect(list.locator('[data-manager-student="S-PENDING"]')).toHaveCount(0);
    await expect(detailToggles).toHaveCount(7);
    await expect(page.locator('.manager-student-details[hidden]')).toHaveCount(7);
    const statusGroups = list.locator('.manager-student-status-group');
    await expect(statusGroups).toHaveCount(3);
    await expect(statusGroups.nth(0)).toHaveAttribute('data-student-status-group', 'approved');
    await expect(statusGroups.nth(1)).toHaveAttribute('data-student-status-group', 'inactive');
    await expect(statusGroups.nth(2)).toHaveAttribute('data-student-status-group', 'rejected');
    await expect(statusGroups.nth(0).locator('.manager-student-status-count')).toHaveText('৪ জন');
    await expect(statusGroups.nth(1).locator('[data-manager-student="S-INACTIVE"]')).toHaveCount(1);
    await expect(statusGroups.nth(2).locator('[data-manager-student="S-REJECTED"]')).toHaveCount(1);
    await expect(pending.locator('.manager-student-visible-meta')).toContainText('নবম শ্রেণি');
    await expect(pending.locator('.manager-student-visible-meta')).toContainText('A');
    await expect(page.locator('.manager-student-pending-banner')).toContainText('অপেক্ষমাণ আবেদন');
    expect(await page.locator('.manager-student-scopes').evaluate(element => getComputedStyle(element).display)).toBe('flex');
    expect(await page.locator('#managerStudentSearch').evaluate(element => getComputedStyle(element).minHeight)).toBe('42px');
    const inactive = list.locator('[data-manager-student="S-INACTIVE"]');
    await inactive.locator('.manager-student-details-toggle').click();
    await expect(inactive.locator('.manager-student-details')).toBeVisible();
    const activateTone = await inactive.locator('[data-manager-action="activate-student"]').evaluate(element => getComputedStyle(element).backgroundColor);
    const inactiveEditTone = await inactive.locator('[data-manager-action="edit-student"]').evaluate(element => getComputedStyle(element).backgroundColor);
    expect(activateTone).not.toBe(inactiveEditTone);
    await inactive.locator('.manager-student-details-toggle').click();
    await expect(inactive.locator('.manager-student-details')).toBeHidden();
    await expect(pending.locator('.manager-student-head')).toContainText('পেন্ডিং শিক্ষার্থী');
    await expect(pending.locator('.manager-student-head')).toContainText('S-PENDING');
    await expect(pending.locator('.manager-student-head')).toContainText('অপেক্ষমাণ');
    await expect(pending.locator('.manager-student-head')).not.toContainText('নবম শ্রেণি');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await pending.locator('.manager-student-details-toggle').click();
    await expect(pendingDetails).toBeVisible();
    await expect(pendingDetails.locator('.manager-student-detail-group')).toHaveCount(2);
    await expect(pending.locator('[data-manager-action="approve-student"]')).toBeVisible();
    const approveTone = await pending.locator('[data-manager-action="approve-student"]').evaluate(element => getComputedStyle(element).backgroundColor);
    const rejectTone = await pending.locator('[data-manager-action="reject-student"]').evaluate(element => getComputedStyle(element).backgroundColor);
    expect(approveTone).not.toBe(rejectTone);
    await expect(page.locator('#managerStudentQueue .manager-student-details-toggle[aria-expanded="true"]')).toHaveCount(1);

    await approved.locator('.manager-student-details-toggle').click();
    await expect(pendingDetails).toBeHidden();
    await expect(approvedDetails).toBeVisible();
    await expect(approvedDetails.locator('.manager-student-detail-group')).toHaveCount(3);
    const editTone = await approved.locator('[data-manager-action="edit-student"]').evaluate(element => getComputedStyle(element).backgroundColor);
    const profileTone = await approved.locator('[data-manager-action="view-student"]').evaluate(element => getComputedStyle(element).backgroundColor);
    expect(editTone).not.toBe(profileTone);
    await expect(page.locator('.manager-student-details-toggle[aria-expanded="true"]')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await approved.locator('.manager-student-details-toggle').click();
    await expect(approvedDetails).toBeHidden();

    await page.locator('.manager-view[data-view-panel="students"] [data-student-scope="pending"]').click();
    await expect(queue).toBeVisible();
    await expect(list.locator('[data-manager-student]')).toHaveCount(0);
    await page.locator('#managerStudentSearch').fill('NO-MATCH');
    await expect(queue.locator('.manager-student-empty')).toContainText('এই খোঁজে কোনো অপেক্ষমাণ আবেদন নেই');
    await page.locator('#managerStudentSearch').fill('');
    await page.locator('.manager-view[data-view-panel="students"] [data-student-scope="approved"]').click();
    await expect(queue).toBeVisible();
    await expect(queue.locator('[data-manager-student]')).toHaveCount(1);
    await expect(list.locator('[data-manager-student]')).toHaveCount(4);
    await page.locator('.manager-view[data-view-panel="students"] [data-student-scope="all"]').click();
    await expect(queue).toBeVisible();

    const search = page.locator('#managerStudentSearch');
    await pending.locator('.manager-student-details-toggle').click();
    await expect(pendingDetails).toBeVisible();
    await search.fill('S-PENDING');
    await expect(pendingDetails).toBeHidden();
    await expect(queue.locator('[data-manager-student]')).toHaveCount(1);
    await expect(list.locator('[data-manager-student]')).toHaveCount(0);
    await search.fill('');
    await expect(list.locator('[data-manager-student]')).toHaveCount(6);

    // A fresh visit and a refresh both return the accordion to its compact state.
    await pending.locator('.manager-student-details-toggle').click();
    await expect(pendingDetails).toBeVisible();
    await page.locator('.manager-bottom [data-manager-view="dashboard"]').click();
    await page.locator('.manager-bottom [data-manager-view="students"]').click();
    await expect(page.locator('.manager-view.active')).toHaveAttribute('data-view-panel', 'students');
    await expect(page.locator('.manager-student-details[hidden]')).toHaveCount(7);
    await pending.locator('.manager-student-details-toggle').click();
    await expect(pendingDetails).toBeVisible();
    await page.reload();
    await expect(page.locator('#managerShell')).toBeVisible();
    await expect(page.locator('.manager-view[data-view-panel="students"]')).toBeVisible();
    await expect(page.locator('.manager-bottom [aria-current="page"]')).toHaveAttribute('data-manager-view', 'students');
    await expect(page.locator('.manager-student-details[hidden]')).toHaveCount(7);

    const topbar = page.locator('.manager-shell > .app-topbar');
    const topbarY = (await topbar.boundingBox()).y;
    const bottom = page.locator('.manager-bottom');
    expect(await bottom.evaluate(element => getComputedStyle(element).position)).toBe('fixed');
    const bottomBox = await bottom.boundingBox();
    expect(bottomBox.y + bottomBox.height).toBeGreaterThanOrEqual(viewport.height - 1);
    await page.locator('#managerMain').evaluate(element => element.scrollTo(0, element.scrollHeight));
    const lastStudentBox = await page.locator('#managerStudentList [data-manager-student="S-REJECTED"]').boundingBox();
    const bottomAfterScroll = await bottom.boundingBox();
    expect((await topbar.boundingBox()).y).toBe(topbarY);
    expect(lastStudentBox.y + lastStudentBox.height).toBeLessThan(bottomAfterScroll.y);
    expect(await page.locator('#managerShell').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
