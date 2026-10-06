/* Admin upgrades: staff management, student privacy + editing, dashboard money
   summary, the dedicated Report Center downloads and teacher registration control.
   Routine/notices entry is Manager territory, so it is tested in manager.html. */
const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');
const fs = require('node:fs/promises');

test.use({ viewport: { width: 390, height: 844 } });

async function enter(page) {
  await enterPortal(page, 'admin');
  await expect(page.locator('#adminShell')).toBeVisible();
}
async function bottom(page, view) {
  await page.locator(`.admin-bottom [data-admin-view=${view}]`).click();
}

test('dashboard shows today and this-month money summary with a details shortcut', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
  await enter(page);
  await expect(page.locator('#dashTransactionCount')).toHaveText('৭ টি');
  await expect(page.locator('#dashMonthAmount')).toHaveText('৳৫,৮০০');
  await expect(page.locator('#dashMonthSub')).toHaveText('সেপ্টেম্বর ২০২৬');
  await expect(page.locator('#dashMonthDue')).toHaveText('৳১,৫০০');
  await expect(page.locator('#dashTotalAmount')).toHaveText('৳১২,৩০০');
  await page.locator('.dash-finance-card [data-admin-view=reports]').click();
  await expect(page.locator('[data-view-panel=reports]')).toBeVisible();
});

test('staff management: create, edit, deactivate, reset password and delete', async ({ page }) => {
  await enter(page);
  await bottom(page, 'staff');
  // The four system roles are already here with permanent Staff IDs.
  await expect(page.locator('#staffList .staff-card')).toHaveCount(4);
  await expect(page.locator('#staffList .staff-id-badge').first()).toHaveText('STF-0001');
  // Create a Teacher: the ID is assigned, never typed.
  await page.locator('#staffCreateButton').click();
  await page.locator('#staffField-fullName').fill('আপগ্রেড শিক্ষক');
  await page.locator('#staffField-username').fill('upgrade.teacher.apc');
  await page.locator('#staffField-password').fill('Upgrade-2026');
  await page.locator('#staffField-confirmPassword').fill('Upgrade-2026');
  await page.locator('#staffField-role').selectOption('teacher');
  await page.locator('#staffField-subjects').fill('পদার্থবিজ্ঞান');
  await page.locator('#staffForm button[type=submit]').click();
  const card = page.locator('#staffList .staff-card', { hasText: 'আপগ্রেড শিক্ষক' });
  await expect(card).toBeVisible();
  await expect(card.locator('.staff-id-badge')).toHaveText('STF-0005');
  // A password is never shown anywhere in the list.
  await expect(page.locator('#staffList')).not.toContainText('Upgrade-2026');
  // Edit: the Staff ID is locked, everything else is editable.
  await card.locator('[data-staff-action=edit]').click();
  await expect(page.locator('#staffField-staffId')).toHaveCount(0);
  await page.locator('#staffField-mobile').fill('01799887766');
  await page.locator('#staffForm button[type=submit]').click();
  await expect(card).toContainText('01799887766');
  // More → Deactivate, then back to active.
  await card.locator('[data-staff-action=more]').click();
  await card.locator('[data-staff-action=status]').click();
  await expect(card).toContainText('নিষ্ক্রিয়');
  await card.locator('[data-staff-action=more]').click();
  await card.locator('[data-staff-action=status]').click();
  await expect(card).toContainText('সক্রিয়');
  // More → Reset password: never displayed, change forced on next login.
  await card.locator('[data-staff-action=more]').click();
  await card.locator('[data-staff-action=reset]').click();
  await page.locator('#staffField-newPassword').fill('Reset-2026');
  await page.locator('#staffField-confirmNewPassword').fill('Reset-2026');
  await page.locator('#staffForm button[type=submit]').click();
  await expect(card).toContainText('পাসওয়ার্ড বদল');
  // More → Delete needs a confirmation modal; cancel keeps the account.
  await card.locator('[data-staff-action=more]').click();
  await card.locator('[data-staff-action=delete]').click();
  await expect(page.locator('#staffModalBody')).toContainText('স্থায়ীভাবে মুছে ফেলতে চান');
  await page.locator('#staffModalBody [data-staff-modal=close]').click();
  await expect(card).toBeVisible();
  // The current Admin is protected: no delete, no deactivate, no role change.
  const owner = page.locator('#staffList .staff-card', { hasText: 'STF-0001' });
  await expect(owner).toContainText('Protected');
  await owner.locator('[data-staff-action=more]').click();
  await expect(owner.locator('[data-staff-action=delete]')).toHaveCount(0);
  await expect(owner.locator('[data-staff-action=status]')).toHaveCount(0);
});

/* Routine entry is a Manager job (manager.html), so this panel has no form. */

test('student management hides personal info until selected and supports editing', async ({ page }) => {
  await enter(page);
  await page.locator('#adminFeatureGrid [data-admin-view=students]').click();
  await expect(page.locator('#studentList .student-row')).toHaveCount(8);
  // Nothing personal leaks in the hidden list: no names or mobile numbers.
  await expect(page.locator('#studentList')).not.toContainText('রাইসা');
  await expect(page.locator('#studentList')).not.toContainText('01700000000');
  await expect(page.locator('#studentList')).not.toContainText('০১৭০০০০০০০০');
  await expect(page.locator('#studentList')).toContainText('AP-1024');
  // Selecting reveals the record.
  await page.locator('#studentList [data-action=view][data-id="AP-1024"]').click();
  await expect(page.locator('#adminModalBackdrop')).toBeVisible();
  await expect(page.locator('#adminModalTitle')).toHaveText('রাইসা ইসলাম');
  await expect(page.locator('#adminModalBody')).toContainText('০১৭০০০০০০০০');
  await page.keyboard.press('Escape');
  // Editing: validation errors first, then a successful save.
  await page.locator('#studentList [data-action=edit][data-id="AP-1024"]').click();
  await page.locator('#editStudentName').fill('');
  await page.locator('#studentEditForm button[type=submit]').click();
  await expect(page.locator('#studentEditError')).toContainText('নাম');
  await page.locator('#editStudentName').fill('রাইসা ইসলাম (সম্পাদিত)');
  await page.locator('#editStudentMobile').fill('123');
  await page.locator('#studentEditForm button[type=submit]').click();
  await expect(page.locator('#studentEditError')).toContainText('১১ সংখ্যার');
  await page.locator('#editStudentMobile').fill('01711111111');
  await page.locator('#editStudentFee').fill('2000');
  await page.locator('#studentEditForm button[type=submit]').click();
  await expect(page.locator('.admin-toast')).toContainText('সম্পাদনা করা হয়েছে');
  await expect(page.locator('#studentList')).not.toContainText('রাইসা');
  // The saved record and the finance ledger both reflect the edit.
  await page.locator('#studentList [data-action=view][data-id="AP-1024"]').click();
  await expect(page.locator('#adminModalTitle')).toHaveText('রাইসা ইসলাম (সম্পাদিত)');
  await expect(page.locator('#adminModalBody')).toContainText('০১৭১১১১১১১১');
  await page.keyboard.press('Escape');
  await bottom(page, 'finance');
  await page.locator('[data-finance-tab=students]').click();
  await page.locator('#ledgerSearch').fill('রাইসা');
  await expect(page.locator('#studentLedgerList')).toContainText('রাইসা ইসলাম (সম্পাদিত)');
  await expect(page.locator('#studentLedgerList [data-action=quick-collect]')).toHaveCount(0);
  await page.locator('#adminFeatureGrid [data-admin-view=students]').click();
  await expect(page.locator('#studentList')).not.toContainText('01711111111');
});

test('report center: filters, live totals and PDF/CSV downloads', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
  await enter(page);
  await bottom(page, 'reports');
  await expect(page.locator('#reportsTitle')).toBeVisible();
  // Filter dropdowns are populated from the shared dataset.
  await expect(page.locator('#reportClass option')).toHaveCount(13);
  await expect(page.locator('#reportFeeType option')).toHaveCount(7);
  await expect(page.locator('#reportMethod option')).toHaveCount(6);
  // Defaults to the running month.
  await expect(page.locator('#reportTrxCount')).toHaveText('৪ টি');
  await expect(page.locator('#reportGrandTotal')).toHaveText('৳৫,৮০০');
  await page.locator('#reportMonth').selectOption('all');
  await expect(page.locator('#reportTrxCount')).toHaveText('৭ টি');
  await expect(page.locator('#reportGrandTotal')).toHaveText('৳১২,৩০০');
  // Quick report cards summarize without any configuration.
  await expect(page.locator('#reportMeta-today')).toHaveText('২ টি লেনদেন • ৳৩,০০০');
  await expect(page.locator('#reportMeta-dues')).toHaveText('১ জনের বকেয়া • ৳১,৫০০');
  await expect(page.locator('#reportMeta-students')).toContainText('মোট ৮ জন');
  await expect(page.locator('#reportMeta-routine')).toContainText('ক্লাস');
  // PDF download is a real PDF file.
  const pdfDownload = page.waitForEvent('download');
  await page.locator('[data-report-pdf=collection]').click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toMatch(/^APC-collection-report-.*\.pdf$/);
  const pdfBytes = await fs.readFile(await pdf.path());
  expect(pdfBytes.toString('latin1').startsWith('%PDF-1.4')).toBe(true);
  // CSV download opens in Excel with the Bangla header row intact.
  const csvDownload = page.waitForEvent('download');
  await page.locator('[data-report-csv=collection]').click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toMatch(/^APC-collection-report-.*\.csv$/);
  const csvText = (await fs.readFile(await csv.path())).toString('utf8');
  expect(csvText.startsWith('\uFEFF')).toBe(true);
  expect(csvText).toContain('"তারিখ"');
  expect(csvText).toContain('রাইসা ইসলাম');
  // Dues report download works as well.
  const duesDownload = page.waitForEvent('download');
  await page.locator('[data-report-pdf=dues]').click();
  expect((await duesDownload).suggestedFilename()).toMatch(/^APC-dues-report-.*\.pdf$/);
});

test('teacher registration is controlled from the admin panel and enforced in teacher.html', async ({ page }) => {
  await enter(page);
  await bottom(page, 'more');
  await page.locator('.admin-more-item[data-admin-view=settings]').click();
  await expect(page.locator('#cfgTeacherRegistration')).toBeChecked();
  await expect(page.locator('#teacherRegBadge')).toHaveText('খোলা আছে');
  await expect(page.locator('#teacherRegList')).toContainText('মো. সাইফুল ইসলাম');
  // Turn registration off; the badge reacts instantly and saving enforces it.
  await page.locator('#cfgTeacherRegistration').evaluate(el => el.click());
  await expect(page.locator('#teacherRegBadge')).toHaveText('বন্ধ আছে');
  await page.locator('#btnSaveTopAppSettings').click();
  await expect(page.locator('.admin-toast')).toContainText('বন্ধ');
  await page.goto('/teacher.html');
  await expect(page.locator('#teacherRegNotice')).toBeVisible();
  await expect(page.locator('#teacherEnter')).toBeDisabled();
  // Re-open registration from the admin panel.
  await page.goto('/admin.html');
  await page.locator('#adminLoginForm button[type=submit]').click();
  await expect(page.locator('#adminShell')).toBeVisible();
  await bottom(page, 'more');
  await page.locator('.admin-more-item[data-admin-view=settings]').click();
  await page.locator('#cfgTeacherRegistration').evaluate(el => el.click());
  await page.locator('#btnSaveTopAppSettings').click();
  await expect(page.locator('.admin-toast')).toContainText('খোলা আছে');
  await page.goto('/teacher.html');
  await expect(page.locator('#teacherRegNotice')).toBeHidden();
  await page.locator('#teacherEnter').click();
  await expect(page.locator('#teacherShell')).toBeVisible();
});

test('class-wise, results and attendance reports download; class filter simplifies students', async ({ page }) => {
  await enter(page);
  // Seed a published exam with attempts and a routine session with attendance,
  // exactly what the teacher panel would save.
  await page.evaluate(async () => {
    const { buildDemoExams } = await import('/js/demo-data.js');
    const db = { version: 1, exams: [], attempts: [] };
    const fixtures = buildDemoExams(Date.now(), 'spec');
    db.exams.push(...fixtures.exams);
    db.attempts.push(...fixtures.attempts);
    localStorage.setItem('activePlus.exams.v1', JSON.stringify(db));
    const { teachingRepository } = await import('/js/teaching-data.js');
    const saved = await teachingRepository.saveActivity({
      type: 'routine', title: 'গণিত ক্লাস', subject: 'গণিত', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ',
      status: 'published', date: '2026-09-21', time: '16:00', duration: 60, details: '', room: 'রুম ২০৩'
    });
    const id = saved.activities.find(item => item.type === 'routine').id;
    await teachingRepository.saveProgress(id, { 'AP-1024': 'present', '260810021': 'absent' });
  });
  await page.reload();
  await enter(page);
  await bottom(page, 'reports');

  // Class-wise report: pick a class, see its students and open them in management.
  await page.locator('#classReportClass').selectOption('দশম শ্রেণি');
  await expect(page.locator('#reportMeta-class')).toContainText('৩ জন');
  await page.locator('#classReportGroup').selectOption('বিজ্ঞান বিভাগ');
  await expect(page.locator('#reportMeta-class')).toContainText('২ জন');
  const classPdf = page.waitForEvent('download');
  await page.locator('[data-report-pdf=class]').click();
  expect((await classPdf).suggestedFilename()).toMatch(/^APC-class-report-.*\.pdf$/);
  await page.locator('[data-action=open-class-students]').click();
  await expect(page.locator('[data-view-panel=students]')).toBeVisible();
  await expect(page.locator('#studentClassFilter')).toHaveValue('দশম শ্রেণি');
  await expect(page.locator('#studentSearch')).toHaveValue('বিজ্ঞান বিভাগ');
  await expect(page.locator('#studentList .student-row')).toHaveCount(2);
  // The same class filter works manually in student management.
  await page.locator('#studentClassFilter').selectOption('নবম শ্রেণি');
  await page.locator('#studentSearch').fill('');
  await expect(page.locator('#studentList .student-row')).toHaveCount(1);

  // Results report: online exam attempts, ranks, grades and absentees.
  await bottom(page, 'reports');
  const examValue = await page.locator('#resultExamSelect option', { hasText: 'সম্পন্ন MCQ' }).getAttribute('value');
  await page.locator('#resultExamSelect').selectOption(examValue);
  await expect(page.locator('#reportMeta-results')).toHaveText('জমা ৩ জন • অনুপস্থিত ১ জন');
  await page.locator('#resultClassFilter').selectOption('দশম শ্রেণি');
  await expect(page.locator('#reportMeta-results')).toHaveText('জমা ২ জন • অনুপস্থিত ০ জন');
  const resultsPdf = page.waitForEvent('download');
  await page.locator('[data-report-pdf=results]').click();
  expect((await resultsPdf).suggestedFilename()).toMatch(/^APC-results-report-.*\.pdf$/);

  // Attendance report: session picker with present/absent counts and rate.
  await page.locator('#attendanceSessionSelect').selectOption({ index: 1 });
  await expect(page.locator('#reportMeta-attendance')).toHaveText('উপস্থিত ১ জন • অনুপস্থিত ১ জন • হার ৫০%');
  const attendanceCsv = page.waitForEvent('download');
  await page.locator('[data-report-csv=attendance]').click();
  const csv = await attendanceCsv;
  expect(csv.suggestedFilename()).toMatch(/^APC-attendance-report-.*\.csv$/);
  const csvText = (await fs.readFile(await csv.path())).toString('utf8');
  expect(csvText).toContain('"উপস্থিতি"');
  expect(csvText).toContain('অনুপস্থিত');
});
