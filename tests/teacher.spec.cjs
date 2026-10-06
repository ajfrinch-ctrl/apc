const { test, expect } = require('./fixtures.cjs');
const { enterPortal, enterStudentApp } = require('./portal-session.cjs');
const KEY = 'activePlus.teaching.v1';
test.use({ viewport: { width: 390, height: 844 } });
async function enter(page) {
  await page.addInitScript(() => {
    const names = ['অষ্টম শ্রেণি', 'নবম শ্রেণি', 'দশম শ্রেণি', 'একাদশ শ্রেণি', 'দ্বাদশ শ্রেণি', 'ডিগ্রি ১ম বর্ষ', 'ডিগ্রি ২য় বর্ষ', 'ডিগ্রি ৩য় বর্ষ', 'অনার্স ১ম বর্ষ', 'অনার্স ২য় বর্ষ', 'অনার্স ৩য় বর্ষ', 'অনার্স ৪র্থ বর্ষ'];
    localStorage.setItem('activePlus.manager.teacherAssignments.v1', JSON.stringify(names.map((className, index) => ({ id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'Test' }))));
  });
  await enterPortal(page, 'teacher'); await expect(page.locator('#teacherShell')).toBeVisible();
}
async function create(page, type, title, overrides = {}) {
  const nav = type;
  await page.locator('.admin-bottom [data-teacher-view=academic]').click();
  await page.locator(`#teacherAcademic [data-teacher-view=${nav}]`).click();
  await page.locator('#teacherNewActivity').click();
  await page.locator('#activity-title').fill(title);
  await page.locator('#activity-subject').fill('গণিত');
  await page.locator('#activity-details').fill('প্রথম অধ্যায় পড়বে।\nঅনুশীলনী ১ সমাধান করবে।');
  await page.locator('#activity-status').selectOption(overrides.status || 'published');
  if (type !== 'suggestion') { await page.locator('#activity-date').fill('2026-10-01'); await page.locator('#activity-time').fill('17:00'); }
  for (const [key, value] of Object.entries(overrides)) {
    if (['status', 'className'].includes(key)) await page.locator(`#activity-${key}`).selectOption(value);
    else await page.locator(`#activity-${key}`).fill(value);
  }
  await page.locator('#teacherActivityForm [type=submit]').click();
  await expect(page.locator('#teacherModalBackdrop')).toBeHidden();
  return page.locator('#teacherRecordList .teaching-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}
async function studentPage(context) {
  // Students sign in on the same shared card as everyone else; the one-tap demo
  // shortcut no longer exists.
  const page = await context.newPage();
  await enterStudentApp(page);
  await page.locator('.bottom-nav [data-view=courses]').click(); return page;
}
async function seed(page, activities) {
  await page.evaluate(async activities => {
    const { teachingRepository: repo } = await import('/js/teaching-data.js');
    for (const a of activities) await repo.saveActivity({ type: 'suggestion', title: 'শিক্ষকের নোট', subject: 'গণিত', className: 'দশম শ্রেণি', status: 'published', ...a });
  }, activities);
}

test('exam drafts must use Manager approval workflow; legacy marks are read-only', async ({ page, context }) => {
  await enter(page);
  await page.locator('.admin-bottom [data-teacher-view=exam]').click();
  await page.locator('#teacherExamWorkspace [data-exam-action=new-mcq]').click();
  await page.locator('[name=title]').fill('গণিত মূল্যায়ন'); await page.locator('[name=subject]').fill('গণিত');
  await page.locator('[name=template]').fill('প্রশ্ন: ২ + ২ কত?\nA: ৪\nB: ৫\nC: ৬\nD: ৭\nউত্তর: A');
  await page.locator('[data-exam-form] [type=submit]').click();
  await expect(page.locator('#teacherExamWorkspace [data-managed-exam]')).toContainText('খসড়া');
  await page.locator('#teacherExamWorkspace [data-exam-action=request]').click();
  await expect(page.locator('#teacherExamWorkspace [data-managed-exam]')).toContainText('অনুমোদনের অপেক্ষায়');
  await page.locator('.admin-bottom [data-teacher-view=exam]').click();
  await expect(page.locator('#teacherNewActivity')).toBeHidden();
  const blocked = await page.evaluate(async () => {
    try {
      const { teachingRepository } = await import('/js/teaching-data.js');
      await teachingRepository.saveActivity({ type: 'exam', title: 'বাইপাস পরীক্ষা', subject: 'গণিত', className: 'দশম শ্রেণি', date: '2026-10-01', time: '17:00', duration: 60, totalMarks: 100, status: 'published' });
      return false;
    } catch (error) { return /Examination workflow/.test(error.message); }
  });
  expect(blocked).toBe(true);
  const student = await studentPage(context);
  await expect(student.locator('#studentExamWorkspace')).not.toContainText('গণিত মূল্যায়ন');
});

test('homework student self-report is visible to teacher, review is visible to student', async ({ page, context }) => {
  await enter(page); const card = await create(page, 'homework', 'আজকের বাড়ির কাজ');
  const student = await studentPage(context);
  await student.locator('[data-learning-filter=homework]').click();
  await expect(student.locator('#learningList')).toContainText('খাতা/ফাইল জমা নয়');
  await student.locator('#learningList .learning-card-toggle').click();
  await expect(student.locator('#learningList .learning-card-details')).toBeVisible();
  await student.locator('[data-complete-homework]').click();
  await expect(student.locator('#learningList .learning-outcome')).toHaveText('সম্পন্ন জানিয়েছে');
  await card.locator('[data-record-action=progress]').click(); await expect(page.locator('[data-progress-id="AP-1024"]')).toHaveValue('done');
  await page.locator('[data-progress-id="AP-1024"]').selectOption('reviewed'); await page.locator('#teacherProgressForm [type=submit]').click();
  await expect(student.locator('#learningList .learning-outcome')).toHaveText('দেখা হয়েছে');
  await expect(student.locator('[data-complete-homework]')).toHaveCount(0);
});

test('routine creation, attendance, schedule conflicts and student routine', async ({ page, context }) => {
  await enter(page); const card = await create(page, 'routine', 'অতিরিক্ত গণিত ক্লাস', { room: 'কক্ষ ২' });
  await card.locator('[data-record-action=progress]').click(); await page.locator('[data-progress-id="AP-1024"]').selectOption('present'); await page.locator('#teacherProgressForm [type=submit]').click();
  const student = await studentPage(context); await student.locator('.bottom-nav [data-view=routine]').click();
  await expect(student.locator('#teacherRoutineList')).toContainText('অতিরিক্ত গণিত ক্লাস'); await expect(student.locator('#teacherRoutineList')).toContainText('উপস্থিত');
  await expect(student.locator('#teacherRoutineList')).toContainText('কক্ষ ২');
  await page.locator('#teacherNewActivity').click(); await page.locator('#activity-title').fill('সংঘর্ষ'); await page.locator('#activity-subject').fill('বাংলা');
  await page.locator('#activity-date').fill('2026-10-01'); await page.locator('#activity-time').fill('17:30'); await page.locator('#activity-status').selectOption('published');
  await page.locator('#teacherActivityForm [type=submit]').click(); await expect(page.locator('#teacherSaveError')).toContainText('আরেকটি ক্লাস/পরীক্ষা');
});

test('suggestions, subject links, class/group scope, draft filter and escaped content', async ({ page, context }) => {
  await enter(page);
  await create(page, 'suggestion', '<img src=x onerror=alert(1)> সাজেশন', { resourceURL: 'https://example.com/notes', group: 'বিজ্ঞান বিভাগ' });
  await create(page, 'suggestion', 'অন্য শ্রেণির সাজেশন', { className: 'নবম শ্রেণি' });
  await create(page, 'suggestion', 'অন্য বিভাগের সাজেশন', { group: 'মানবিক' });
  await create(page, 'suggestion', 'খসড়া সাজেশন', { status: 'draft' });
  await page.locator('[data-status=draft]').click(); await expect(page.locator('#teacherRecordList .teaching-card')).toHaveCount(1);
  const student = await studentPage(context); await student.locator('[data-learning-filter=suggestion]').click();
  await expect(student.locator('#learningList .teaching-card')).toHaveCount(1); await expect(student.locator('#learningList img')).toHaveCount(0);
  await expect(student.locator('.teaching-resource')).toHaveAttribute('href', 'https://example.com/notes');
  await expect(student.locator('#learningList')).not.toContainText('অন্য'); await expect(student.locator('#learningList')).not.toContainText('খসড়া');
  await expect(student.locator('[data-record-action]')).toHaveCount(0);
});

test('write failure keeps entered work and does not falsely save; corrupt storage fails closed', async ({ page }) => {
  await enter(page); await page.locator('.admin-bottom [data-teacher-view=academic]').click(); await page.locator('#teacherAcademic [data-teacher-view=homework]').click(); await page.locator('#teacherNewActivity').click();
  await page.locator('#activity-title').fill('হারাবে না'); await page.locator('#activity-subject').fill('গণিত');
  await page.evaluate(key => { const real = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k === key) throw new DOMException('quota', 'QuotaExceededError'); return real.call(this, k, v); }; }, KEY);
  await page.locator('#teacherActivityForm [type=submit]').click(); await expect(page.locator('#teacherSaveError')).toContainText('সংরক্ষণ হয়নি');
  await expect(page.locator('#activity-title')).toHaveValue('হারাবে না'); await expect(page.locator('#teacherActivityForm [type=submit]')).toBeEnabled();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull(); await expect(page.locator('.admin-toast')).toHaveCount(0);
  await page.evaluate(key => localStorage.setItem(key, '{broken'), KEY); await page.reload();
  // The session is still valid, so the shell opens — and the data surface
  // refuses instead of inventing rows or silently wiping the bad value.
  await expect(page.locator('#teacherShell')).toBeVisible();
  await expect(page.locator('#teacherDataError')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe('{broken');
});

test('student roster needs query, matches Bengali mobile/ID, excludes pending and empty results', async ({ page }) => {
  await enter(page); await page.locator('.admin-bottom [data-teacher-view=more]').click(); await page.locator('#teacherMore [data-teacher-view=students]').click();
  await expect(page.locator('#teacherStudentList .teaching-card')).toHaveCount(0);
  await page.locator('#teacherStudentSearch').fill('০১৭০০০০০০০০'); await expect(page.locator('#teacherStudentList')).toContainText('রাইসা ইসলাম');
  await page.locator('[data-student-detail]').click(); await expect(page.locator('#teacherModalBody')).toContainText('এখনও কোনো নম্বর'); await page.keyboard.press('Escape');
  await page.locator('#teacherStudentSearch').fill('260909032'); await expect(page.locator('#teacherStudentList')).toHaveText('কোনো শিক্ষার্থী পাওয়া যায়নি');
  await page.locator('#teacherStudentSearch').fill(''); await expect(page.locator('#teacherStudentList .teaching-card')).toHaveCount(0);
});

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
  test(`mobile-only teacher panel: fixed bars, five tabs and reachable modal (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport); await enter(page);
    await expect(page.locator('.admin-bottom-item')).toHaveCount(5);
    await seed(page, Array.from({ length: 6 }, (_, i) => ({ title: `সাজেশন ${i}` })));
    await expect(page.locator('#teacherRecent .teaching-card')).toHaveCount(5);
    await page.locator('#teacherMain').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => page.evaluate(() => {
      const top = document.querySelector('.app-topbar').getBoundingClientRect(), foot = document.querySelector('.admin-bottom').getBoundingClientRect(), main = document.querySelector('#teacherMain').getBoundingClientRect();
      return Math.abs(top.top) < 1 && Math.abs(foot.bottom - innerHeight) < 1 && Math.abs(main.top - top.bottom) <= 1 && Math.abs(main.bottom - foot.top) <= 1 && document.documentElement.scrollWidth <= innerWidth && document.querySelector('#teacherShell').offsetWidth <= 480 && window.scrollY === 0;
    })).toBe(true);
    await page.locator('.admin-bottom [data-teacher-view=academic]').click(); await page.locator('#teacherAcademic [data-teacher-view=homework]').click(); await expect.poll(() => page.locator('#teacherMain').evaluate(el => el.scrollTop)).toBe(0);
    await page.locator('#teacherNewActivity').click(); await expect(page.locator('#teacherMain')).toHaveCSS('overflow-y', 'hidden');
    await page.locator('#activity-title').fill('মোবাইল পরীক্ষা'); await page.locator('#activity-subject').fill('গণিত');
    const submit = page.locator('#teacherActivityForm [type=submit]'); await submit.scrollIntoViewIfNeeded();
    const rect = await submit.boundingBox(); expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.locator('#activity-title')).toHaveCSS('font-size', '16px');
    await submit.click(); await expect(page.locator('#teacherModalBackdrop')).toBeHidden();
    await expect(page.locator('#teacherRecordList')).toContainText('মোবাইল পরীক্ষা');
  });
}

test('teacher page, modules and student feed work offline after precache', async ({ page, context }) => {
  await enter(page); await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true); await page.reload();
  await create(page, 'suggestion', 'অফলাইন সাজেশন');
  const student = await studentPage(context); await expect(student.locator('#learningList')).toContainText('অফলাইন সাজেশন');
  await context.setOffline(false);
});

test('one login page: teacher credentials typed there land on the teacher panel', async ({ page }) => {
  const password = 'Apc-Teacher-Login-2026';
  await page.goto('/index.html'); await expect(page.locator('#authScreen')).toBeVisible();
  // No shortcut links — the single form is the way in.
  await expect(page.locator('#authScreen a[href="admin.html"], #authScreen a[href="teacher.html"], #authScreen a[href="payment.html"]')).toHaveCount(0);
  // A real first sign-in sets its own password on this device; there is no
  // built-in default password to type.
  await page.evaluate(async ({ role, password }) => {
    const auth = await import('/js/staff-auth.js');
    const done = await auth.provisionStaffAccount(role, password, password);
    if (!done.ok) throw new Error(done.error);
  }, { role: 'teacher', password });
  await page.locator('#loginMobile').fill('teacher.apc');
  await page.locator('#loginPin').fill(password);
  await page.locator('#loginForm button[type=submit]').click();
  await page.waitForURL('**/teacher.html');
  await expect(page.locator('#teacherShell')).toBeVisible();
  // No second credential form anywhere on the panel: the panel opened on the session.
  await expect(page.locator('#teacherEntry, #teacherEntryError, #teacherEnter, #demoLoginButton')).toHaveCount(0);
});

test('one device, one panel: no cross-panel link and the other panel locks itself', async ({ page, context }) => {
  await enter(page); // teacher session on this device
  await expect(page.locator('a[href="admin.html"], a[href="manager.html"], a[href="payment.html"]')).toHaveCount(0);
  const admin = await context.newPage(); await admin.goto('/admin.html');
  await expect(admin.locator('#apcPanelLock')).toBeVisible();
  await expect(admin.locator('#adminShell')).toBeHidden();
  await expect(admin.locator('#apcPanelLockLogin')).toBeVisible();
  await admin.close();
});

test('profile class changes immediately re-scope the student feed and teacher roster', async ({ page, context }) => {
  await enter(page); await seed(page, [{ title: 'দশমের কাজ' }, { title: 'নবমের কাজ', className: 'নবম শ্রেণি' }]);
  const student = await studentPage(context); await expect(student.locator('#learningList')).toContainText('দশমের কাজ');
  await student.locator('.bottom-nav [data-view=profile]').click(); await student.locator('#profileView [data-action=edit-profile]').first().click();
  await student.locator('#classInput').selectOption('নবম শ্রেণি'); await student.locator('#profileForm [type=submit]').click();
  await student.locator('.bottom-nav [data-view=courses]').click();
  await expect(student.locator('#learningList')).toContainText('নবমের কাজ'); await expect(student.locator('#learningList')).not.toContainText('দশমের কাজ');
  await page.locator('.admin-bottom [data-teacher-view=more]').click(); await page.locator('#teacherMore [data-teacher-view=students]').click();
  await page.locator('#teacherStudentSearch').fill('AP-1024'); await expect(page.locator('#teacherStudentList')).toContainText('নবম শ্রেণি');
});

test('concurrent teacher tabs preserve both saves and immediately refresh each other', async ({ page, context }) => {
  await enter(page); const other = await context.newPage(); await enter(other);
  await Promise.all([seed(page, [{ title: 'প্রথম ট্যাবের কাজ' }]), seed(other, [{ title: 'দ্বিতীয় ট্যাবের কাজ' }])]);
  await expect(page.locator('#teacherRecent .teaching-card')).toHaveCount(2); await expect(other.locator('#teacherRecent .teaching-card')).toHaveCount(2);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).activities.length, KEY)).toBe(2);
});
