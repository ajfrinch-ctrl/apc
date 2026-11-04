const { test, expect } = require('./fixtures.cjs');
const { enterStudentApp, enterPortal, newDevice, syncStorage } = require('./portal-session.cjs');
const TEACHING_KEY = 'activePlus.teaching.v1';

// Teacher and Student are separate devices. Publish with a real staff session,
// then copy only the synced teaching collection to the student's device.
async function seedTeacherWork(page, activities) {
  const device = await newDevice(page.context());
  try {
    const teacher = await device.newPage();
    await teacher.addInitScript(() => localStorage.setItem('activePlus.manager.teacherAssignments.v1', JSON.stringify([
      { id: 'TAS-1', teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className: 'দশম শ্রেণি', group: '', subject: 'গণিত', subjects: ['গণিত', 'জ্যামিতি'] }
    ])));
    await enterPortal(teacher, 'teacher');
    await teacher.evaluate(async items => {
      const { teachingRepository } = await import('/js/teaching-data.js');
      for (const item of items) await teachingRepository.saveActivity(item);
    }, activities);
    await page.goto('/demo/offline-roles.html');
    await syncStorage(teacher, page, [TEACHING_KEY]);
  } finally {
    await device.close();
  }
}
const activity = (type, title, overrides = {}) => ({
  type, title, subject: 'গণিত', className: 'দশম শ্রেণি', status: 'published',
  date: '2026-10-01', time: '17:00', details: 'প্রথম অধ্যায়ের অনুশীলনী সমাধান করো।',
  ...overrides
});
async function openStudySection(page, section) {
  await page.locator('.bottom-nav [data-view=courses]').click();
  await page.locator(`#studySections [data-study-section="${section}"]`).click();
}
const NOTICE_KEY = 'activePlus.admin.notices.v1';
const CONFIG_KEY = 'active-plus-app-config-v1';
const BOARD_READ_KEY = 'activePlus.noticeBoard.read.v1:AP-1024';
const NOTICE_FIXTURE = [
  { id: 'NB-U', category: 'urgent', title: 'জরুরি ছুটি ঘোষণা', body: 'আজকের ক্লাস স্থগিত।', audience: 'সকল শিক্ষার্থী', status: 'published', createdAt: '2026-10-04T09:00:00.000Z' },
  { id: 'NB-A', category: 'academic', title: 'নতুন পাঠসূচি', body: 'নতুন অধ্যায়ের তালিকা দেখো।', audience: 'সকল শিক্ষার্থী', status: 'published', createdAt: '2026-10-03T09:00:00.000Z' },
  { id: 'NB-E', category: 'exam', title: 'গণিত পরীক্ষার সূচি', body: 'পরীক্ষা আগামী সপ্তাহে।', audience: 'সকল শিক্ষার্থী', status: 'published', createdAt: '2026-10-02T09:00:00.000Z' }
];
test.use({ viewport: { width: 390, height: 844 } });
async function enter(page) {
  await enterStudentApp(page);
}
async function seedNoticeBoard(page) {
  await page.addInitScript(({ key, notices }) => localStorage.setItem(key, JSON.stringify(notices)), { key: NOTICE_KEY, notices: NOTICE_FIXTURE });
}
async function openBoard(page) {
  if (!(await page.locator('#notice-boardView').isVisible())) {
    await page.locator('#studentServices [data-view="notice-board"]').click();
  }
  await expect(page.locator('#notice-boardView')).toBeVisible();
}

test('student Notice Board syncs with the bell badge and Read ✓ survives reload/offline', async ({ page, context }) => {
  await seedNoticeBoard(page);
  await enter(page);
  await expect(page.locator('#noticeBoardUnreadBadge')).toHaveText('৩');
  await expect(page.locator('#notificationButton .notification-dot')).toHaveText('৩');
  await page.locator('#studentServices [data-view="notice-board"]').click();
  await expect(page.locator('#notice-boardView')).toBeVisible();
  await expect(page.locator('#noticeBoardList .notice-board-card')).toHaveCount(3);
  await expect(page.locator('#noticeBoardCategories [data-notice-board-category="urgent"]')).toContainText('জরুরি');
  await page.locator('#noticeBoardCategories [data-notice-board-category="exam"]').click();
  await expect(page.locator('#noticeBoardList .notice-board-card')).toHaveCount(1);
  await expect(page.locator('#noticeBoardList')).toContainText('গণিত পরীক্ষার সূচি');
  await page.locator('#noticeBoardCategories [data-notice-board-category="all"]').click();

  const urgent = page.locator('#noticeBoardList .notice-board-card').first();
  await urgent.locator('[data-notice-board-open]').click();
  await expect(page.locator('#noticeBoardDetailTitle')).toHaveText('জরুরি ছুটি ঘোষণা');
  await expect(page.locator('#noticeBoardReadButton')).toHaveText('পড়া হয়েছে ✓');
  await page.locator('#noticeBoardReadButton').click();
  await expect(page.locator('#noticeBoardReadButton')).toHaveText('পড়া হয়েছে ✓');
  await expect(page.locator('#noticeBoardUnreadBadge')).toHaveText('২');
  await expect(page.locator('#notificationButton .notification-dot')).toHaveText('২');
  await page.locator('#noticeBoardDetail [data-notice-board-close]').click();

  // Notification Center displays the remaining unread notices and opens directly on click.
  await page.locator('#notificationButton').click();
  await expect(page.locator('#noticeModal')).toBeVisible();
  await expect(page.locator('#noticeListStudent')).toContainText('নতুন নোটিশ এসেছে - গণিত পরীক্ষার সূচি');
  await page.locator('#noticeModal .modal-close').click();

  await page.reload();
  await expect(page.locator('#appShell')).toBeVisible();
  await openBoard(page);
  await expect(page.locator('#noticeBoardUnreadBadge')).toHaveText('২');
  await expect(page.locator('#noticeBoardList .notice-board-card.is-read')).toHaveCount(1);

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#appShell')).toBeVisible();
  await openBoard(page);
  await expect(page.locator('#noticeBoardUnreadBadge')).toHaveText('২');
  await expect(page.locator('#noticeBoardList .notice-board-card.is-read')).toHaveCount(1);
  await context.setOffline(false);
});

test('per-student Read ✓ receipts sync across tabs; urgent broadcast stays on the Board', async ({ page, context }) => {
  await seedNoticeBoard(page);
  await enter(page);
  await page.locator('#studentServices [data-view="notice-board"]').click();
  await expect(page.locator('#noticeBoardList .notice-board-card')).toHaveCount(3);

  const other = await context.newPage();
  await other.goto('/index.html');
  await expect(other.locator('#appShell')).toBeVisible();
  await openBoard(other);
  await page.locator('#noticeBoardList .notice-board-card').first().locator('[data-notice-board-open]').click();
  await page.locator('#noticeBoardReadButton').click();
  await expect(other.locator('#noticeBoardList .notice-board-card.is-read')).toHaveCount(1);
  await page.locator('#noticeBoardDetail [data-notice-board-close]').click();

  const message = '<img src=x onerror=alert(1)> জরুরি সার্ভার ঘোষণা';
  await other.evaluate(({ key, message }) => localStorage.setItem(key, JSON.stringify({ broadcastAlert: true, broadcastMessage: message })), { key: CONFIG_KEY, message });
  await expect(page.locator('#noticeBoardList')).toContainText(message);
  await expect(page.locator('#noticeBoardList img')).toHaveCount(0);
  await expect(page.locator('#notificationButton .notification-dot')).toBeVisible();
  await page.locator('#notificationButton').click();
  await expect(page.locator('#noticeListStudent')).toContainText('জরুরি সার্ভার ঘোষণা');
});

for (const width of [320, 390, 480]) {
  test(`work board: summary, filters, completion persistence and no overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await seedTeacherWork(page, [
      activity('homework', 'বীজগণিত অনুশীলনী'),
      activity('suggestion', 'সহায়ক পাঠ'),
      activity('routine', 'ক্লাস রুটিন', { duration: 60, room: 'কক্ষ ২' })
    ]);
    await enter(page);
    await openStudySection(page, 'homework');
    await expect(page.locator('#learningSummary strong')).toHaveText(['৩', '১', '০']);
    await expect(page.locator('#learningList .learning-card')).toHaveCount(1);
    await page.locator('#learningList .learning-card-toggle').click();
    await expect(page.locator('#learningList .learning-meta')).toContainText('জমার শেষ সময়');
    await expect(page.locator('#learningList .learning-teacher')).toContainText('শিক্ষক');
    await page.locator('[data-complete-homework]').click();
    await expect(page.locator('#learningSummary strong')).toHaveText(['৩', '০', '১']);
    await expect(page.locator('#learningList .learning-state')).toHaveText('সম্পন্ন');
    await expect(page.locator('[data-complete-homework]')).toHaveCount(0);
    await page.reload(); await openStudySection(page, 'homework');
    await expect(page.locator('#learningSummary strong')).toHaveText(['৩', '০', '১']);
    await expect(page.locator('#learningList .learning-state')).toHaveText('সম্পন্ন');
    await openStudySection(page, 'suggestion');
    await expect(page.locator('#learningList .learning-card')).toHaveCount(1);
    await expect(page.locator('#learningList')).toContainText('সহায়ক পাঠ');
    // Allow the view-slide transition to settle before measuring overflow.
    await expect.poll(() => page.evaluate(() => {
      const main = document.querySelector('#appMain');
      return main.scrollWidth - main.clientWidth;
    })).toBeLessThanOrEqual(0);
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('#appMain');
      const mr = main.getBoundingClientRect();
      return { viewport: innerWidth, document: document.documentElement.scrollWidth, main: [main.clientWidth, main.scrollWidth], offenders: [...main.querySelectorAll('*')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.right > mr.right + 1 || r.left < mr.left - 1); }).slice(0, 12).map(el => ({ tag: el.tagName, cls: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })) };
    });
    expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.main[1], JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.main[0]);
  });
}

test('study hub routes to work details and courses', async ({ page }) => {
  await seedTeacherWork(page, [activity('homework', 'রেখা ও কোণ', {
    subject: 'জ্যামিতি', date: '2026-10-02', details: 'অনুশীলনী ৬.১ সমাধান করো।', room: 'কক্ষ ২'
  })]);
  await enter(page);
  await page.locator('.bottom-nav [data-view=courses]').click();
  await expect(page.locator('#studySections .pay-tile')).toHaveCount(9);
  expect(await page.locator('#studySections').evaluate(el => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length)).toBe(3);
  await page.locator('#studySections [data-study-section=homework]').click();
  await expect(page.locator('#homeworkView')).toBeVisible();
  const card = page.locator('#learningList .learning-card').filter({ hasText: 'রেখা ও কোণ' });
  await expect(card.locator('.learning-brief')).toContainText('জমার শেষ সময়');
  await expect(card.locator('.learning-card-details')).toBeHidden();
  await card.locator('.learning-card-toggle').click();
  await expect(card.locator('.learning-card-details')).toBeVisible();
  await expect(card.locator('.teaching-body')).toContainText('অনুশীলনী ৬.১');
  await card.locator('.learning-card-toggle').click();
  await expect(card.locator('.learning-card-details')).toBeHidden();

  await openStudySection(page, 'courses');
  await expect(page.locator('#myCoursesView')).toBeVisible();
  await expect(page.locator('#studentCourseChaptersList')).toContainText('কোনো কোর্স প্রকাশিত হয়নি');
});

test('material button generates a PDF offline; external links still download', async ({ page, context }) => {
  await page.goto('/demo/offline-roles.html');
  const resourceURL = await page.evaluate(() => new URL('/assets/icons/app-logo.png', location.href).href);
  await seedTeacherWork(page, [
    activity('suggestion', 'অফলাইন পাঠ', { details: 'প্রথম অধ্যায়ের উদাহরণ পড়ে অনুশীলন করো।' }),
    activity('suggestion', 'Reference link card', { resourceURL })
  ]);
  await enter(page);
  await openStudySection(page, 'suggestion');
  const card = page.locator('#learningList .learning-card').filter({ hasText: 'অফলাইন পাঠ' });
  await card.locator('.learning-card-toggle').click();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await card.locator('.learning-card-details a.teaching-resource[data-material]').click();
  await expect(page.locator('#resourceModal')).toBeVisible();
  await expect(page.locator('#resourceModalMeta')).toContainText('ActivePlus-material-');
  const workText = (await card.locator('.teaching-body').textContent()).trim();
  await expect(page.locator('#resourceModalBody .teaching-body')).toHaveText(workText);
  await expect(page.locator('#resourceOpenTab')).toBeHidden();
  const download = page.waitForEvent('download');
  await page.locator('#resourceDownload').click();
  const material = await download;
  expect(material.suggestedFilename()).toMatch(/^(download|ActivePlus-material-[a-z]+-\d{4}-\d{2}-\d{2}\.pdf)$/);
  const materialPath = await material.path();
  const { statSync, readFileSync } = require('node:fs');
  expect(statSync(materialPath).size).toBeGreaterThan(10000);
  expect(readFileSync(materialPath).slice(0, 5).toString()).toBe('%PDF-');
  await expect(page.locator('#resourceModalStatus')).toContainText('ডাউনলোড শুরু হয়েছে');
  await expect(page.locator('#resourceModal')).toBeVisible();
  await page.locator('#resourceModal .modal-action').click();
  await expect(page.locator('#resourceModal')).toBeHidden();
  await context.setOffline(false);

  // A genuine external-resource record follows the same popup but fetches the file.
  const external = page.locator('#learningList .learning-card').filter({ hasText: 'Reference link card' });
  await external.locator('.learning-card-toggle').click();
  await external.locator('.learning-card-details a.teaching-resource').click();
  await expect(page.locator('#resourceModalMeta')).toContainText('app-logo.png');
  await expect(page.locator('#resourceOpenTab')).toBeVisible();
  const externalDownload = page.waitForEvent('download');
  await page.locator('#resourceDownload').click();
  const image = await externalDownload;
  expect(image.suggestedFilename()).toMatch(/^(download|app-logo\.png)$/);
  expect(readFileSync(await image.path()).subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))).toBe(true);
});

test('results tab: the published-result summary sits on top of the teacher board', async ({ page }) => {
  await enter(page);
  // পরীক্ষা → ফলাফল tab: the summary is the first thing read, the board follows.
  await page.locator('#studentServices [data-view=exams]').last().click();
  await page.locator('#examTabs [data-exam-tab=results]').click();
  await expect(page.locator('[data-exam-panel=results]')).toBeVisible();
  await expect(page.locator('#studentResultOverview .exam-summary, #studentResultOverview .exam-note')).toBeVisible();
  const summaryFirst = await page.evaluate(() => document.querySelector('#studentResultOverview').compareDocumentPosition(document.querySelector('#teacherResultsBoard')) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(summaryFirst).toBeTruthy();
});
