/* Owner-console verification: the Admin panel keeps staff CRUD, the Report
   Center, system settings and data — and nothing daily. Every academic/finance
   record belongs to the panel that owns the work, so those flows are proven on
   manager.html and in the counter specs. */
const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');
const fs = require('node:fs/promises');

test.use({ viewport: { width: 390, height: 844 } });

const SHELL = { admin: '#adminShell', manager: '#managerShell' };
async function enter(page, role = 'admin') {
  await enterPortal(page, role);
  await expect(page.locator(SHELL[role])).toBeVisible();
}
const bottom = (page, role, view) => page.locator(`.admin-bottom [data-${role}-view=${view}]`).click();

test('manager dashboard summarises the coaching, money included', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
  await enter(page, 'manager');
  for (const id of ['#mgrTotalStudents', '#mgrActiveStudents', '#mgrTodayCollection', '#mgrTodayClasses']) {
    await expect(page.locator(id)).not.toHaveText('—');
  }
  // One tap from the dashboard into hisab; the Admin panel keeps no such tile.
  await bottom(page, 'manager', 'finance');
  await expect(page.locator('[data-view-panel=finance]')).toBeVisible();
  await expect(page.locator('#mgrFinanceTotal')).not.toBeEmpty();
  await expect(page.locator('#mgrFinancePending')).not.toBeEmpty();
  await page.goto('/admin.html');
  await expect(page.locator('#adminShell')).toBeVisible();
  await expect(page.locator('#mgrFinanceTotal, #mgrTodayCollection, #dashTransactionCount')).toHaveCount(0);
});

test('staff management: create, edit, deactivate, reset password and delete', async ({ page }) => {
  await enter(page);
  await bottom(page, 'admin', 'staff');
  // The four system roles are already here with permanent Staff IDs.
  await expect(page.locator('#staffList .staff-card')).toHaveCount(4);
  await expect(page.locator('#staffList .staff-id-badge').first()).toContainText('STF-0001');
  // Create a Teacher through the three steps: the Login User ID is generated,
  // never typed, and assignment comes after identity and role/contact details.
  await page.locator('#staffCreateButton').click();
  await page.locator('#staffField-fullName').fill('আপগ্রেড শিক্ষক');
  await page.locator('#staffForm [data-staff-create-step="1"] [data-staff-step-next]').click();
  await page.locator('#staffField-password').fill('Upgrade-2026');
  await page.locator('#staffField-confirmPassword').fill('Upgrade-2026');
  await page.locator('#staffField-role').selectOption('teacher');
  await expect(page.locator('#staffField-username')).toHaveText(/\.teacher\.apc$/);
  await page.locator('#staffForm [data-staff-create-step="2"] [data-staff-step-next]').click();
  await expect(page.locator('#staffForm [data-staff-create-step="3"]')).toBeVisible();
  await page.locator('#staffField-subjects').fill('পদার্থবিজ্ঞান');
  await page.locator('#staffForm button[type=submit]').click();
  const card = page.locator('#staffList .staff-card', { hasText: 'আপগ্রেড শিক্ষক' });
  await expect(card).toBeVisible();
  await expect(card.locator('.staff-id-badge')).toContainText('STF-0005');
  // A password is never shown anywhere in the list.
  await expect(page.locator('#staffList')).not.toContainText('Upgrade-2026');
  // Edit: the Staff ID is locked, everything else is editable.
  await card.locator('.staff-details-toggle').click();
  await card.locator('[data-staff-action=edit]').click();
  await expect(page.locator('#staffField-staffId')).toHaveCount(0);
  await page.locator('#staffField-mobile').fill('01799887766');
  await page.locator('#staffForm button[type=submit]').click();
  await expect(card).toContainText('01799887766');
  // More → Deactivate, then back to active.
  await card.locator('.staff-details-toggle').click();
  await card.locator('[data-staff-action=more]').click();
  await page.locator('#staffModalBody [data-staff-action=status][data-next-status=inactive]').click();
  await expect(card).toContainText('নিষ্ক্রিয়');
  await card.locator('.staff-details-toggle').click();
  await card.locator('[data-staff-action=more]').click();
  await page.locator('#staffModalBody [data-staff-action=status][data-next-status=active]').click();
  await expect(card).toContainText('সক্রিয়');
  // More → Reset password: never displayed, change forced on next login.
  await card.locator('.staff-details-toggle').click();
  await card.locator('[data-staff-action=more]').click();
  await page.locator('#staffModalBody [data-staff-action=reset]').click();
  await page.locator('#staffField-newPassword').fill('Reset-2026');
  await page.locator('#staffField-confirmPassword').fill('Reset-2026');
  await page.locator('#staffPasswordForm button[type=submit]').click();
  await expect(page.locator('.admin-toast')).toContainText('পাসওয়ার্ড রিসেট');
  // More → Delete needs a confirmation modal; cancel keeps the account.
  await card.locator('.staff-details-toggle').click();
  await card.locator('[data-staff-action=more]').click();
  await page.locator('#staffModalBody [data-staff-action=delete]').click();
  await expect(page.locator('#staffModalBody')).toContainText('স্থায়ীভাবে মুছে ফেলতে চান');
  await page.locator('#staffModalBody [data-staff-modal=close]').click();
  await expect(card).toBeVisible();
  // The current Admin is protected: no delete, no deactivate, no role change.
  const owner = page.locator('#staffList .staff-card').filter({ hasText: 'STF-0001' });
  await expect(owner).toContainText('Protected');
  await owner.locator('.staff-details-toggle').click();
  await owner.locator('[data-staff-action=more]').click();
  await expect(page.locator('#staffModalBody [data-staff-action=delete]')).toHaveCount(0);
  await expect(page.locator('#staffModalBody [data-staff-action=status]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // সিস্টেম → সেটিংস still saves the branding form from here.
  await bottom(page, 'admin', 'system');
  await page.locator('#adminSystemMenu .admin-more-item[data-admin-view=settings]').click();
  await expect(page.locator('#cfgMaintenanceMode')).toBeAttached();
  await page.locator('.admin-view[data-view-panel="settings"] [data-admin-view="settings-branding"]').click();
  await page.locator('#btnSaveAppSettings').click();
  await expect(page.locator('.admin-toast')).toContainText('সংরক্ষিত');
});

test('student lifecycle belongs to the Manager; the Admin panel has no directory', async ({ page }) => {
  // The Admin console owns no student records: no list, no editor, no reset.
  await enter(page);
  await expect(page.locator('#studentList, #studentSearch, [data-admin-view=students], [data-action=reset-pin]')).toHaveCount(0);
  await expect(page.locator('#adminSystemMenu [data-admin-view=students]')).toHaveCount(0);

  // The Manager runs the whole life cycle from one screen.
  await page.goto('/manager.html');
  await enter(page, 'manager');
  await bottom(page, 'manager', 'students');
  await expect(page.locator('#managerStudentList .manager-record').first()).toBeVisible();
  const first = page.locator('#managerStudentList .manager-record').first();
  await first.locator('[data-manager-action=view-student]').click();
  await expect(first.locator('.manager-student-extra')).toBeVisible();
  await first.locator('[data-manager-action=edit-student]').click();
  await expect(first.locator('.manager-edit-form')).toBeVisible();
  await expect(first.locator('.manager-edit-form input[name=name]')).not.toHaveValue('');
  // Pending registrations are the same screen, behind their own scope chip.
  await page.locator('[data-student-scope=pending]').click();
  await expect(page.locator('#managerStudentQueue, #managerStudentList')).toBeVisible();
});

test('report center: Generate first, then a real preview and PDF — never before', async ({ page }) => {
  await enter(page);
  await bottom(page, 'admin', 'reports');
  await expect(page.locator('#reportsTitle')).toBeVisible();
  const select = page.locator('#adminReports select[name=report]');
  await expect(select).toBeVisible();
  // Nothing is rendered before Generate.
  await expect(page.locator('#adminReports .rc-preview')).toHaveCount(0);
  await select.selectOption('student.class-wise');
  await page.locator('#adminReports .rc-generate').click();
  await expect(page.locator('#adminReports .rc-preview')).toBeVisible();
  const pdfDownload = page.waitForEvent('download');
  await page.locator('#adminReports .rc-download').click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = await fs.readFile(await pdf.path());
  expect(bytes.toString('latin1').startsWith('%PDF-1.')).toBe(true);
  expect(bytes.toString('latin1')).toContain('%%EOF');
  await page.locator('#adminReports .rc-back').click();
  await expect(page.locator('#adminReports .rc-preview')).toHaveCount(0);

  // An empty device still previews, with the one shared empty message.
  await select.selectOption('student.status');
  await page.locator('#adminReports .rc-generate').click();
  await expect(page.locator('#adminReports .rc-preview-notice')).toHaveText('কোনো তথ্য পাওয়া যায়নি।');
});

test('manager report families cover class, attendance, results and fees', async ({ page }) => {
  await enter(page, 'manager');
  await bottom(page, 'manager', 'reports');
  const select = page.locator('#managerReports select[name=report]');
  await expect(select).toBeVisible();
  for (const report of ['student.class-wise', 'academic.attendance', 'result.marks', 'fee.transactions']) {
    await select.selectOption(report);
    await page.locator('#managerReports .rc-generate').click();
    await expect(page.locator('#managerReports .rc-preview')).toBeVisible();
    // No data on a fresh device: the preview says so, and it still renders.
    await expect(page.locator('#managerReports .rc-preview-notice')).toHaveText('কোনো তথ্য পাওয়া যায়নি।');
    await page.locator('#managerReports .rc-back').click();
  }
});

test('no teacher self-registration anywhere: teacher.html needs a real session', async ({ page }) => {
  // Nothing in the panel opens registration, and the teacher page shows no
  // self-registration door of its own.
  await enter(page);
  await expect(page.locator('#cfgTeacherRegistration, #teacherRegList, #teacherRegBadge')).toHaveCount(0);
  await page.goto('/teacher.html');
  await expect(page.locator('#apcPanelLock')).toBeVisible();
  await expect(page.locator('#teacherShell')).toBeHidden();
  await expect(page.locator('#teacherRegister, #teacherEntry, #teacherEnter')).toHaveCount(0);
  // The only exit is the shared login card, which is where a teacher account
  // (created by the Admin panel above) signs in.
  await page.locator('#apcPanelLockLogin').click();
  await page.waitForURL('**/index.html');
  await expect(page.locator('#authScreen')).toBeVisible();
});
