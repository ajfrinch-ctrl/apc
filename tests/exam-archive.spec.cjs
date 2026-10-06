/* Date-wise examination workspace, in a real browser (the suite's current
   sign-in helpers): a teacher authors into a date record, the Manager reviews/
   approves/publishes/unpublishes, the student only ever sees the published
   paper — and on a phone the dashboard table becomes cards. */
const { test, expect } = require('./fixtures.cjs');
const { enterPortal, enterStudentApp } = require('./portal-session.cjs');

const EXAM_KEY = 'activePlus.exams.v1';
const ROSTER_KEY = 'activePlus.admin.students.v1';
const ASSIGNMENTS_KEY = 'activePlus.manager.teacherAssignments.v1';
const CLASS = 'দশম শ্রেণি';
const T0 = new Date('2026-10-01T09:00:00Z');
const WINDOW_START = new Date('2026-10-01T10:00:00Z');
const WINDOW_END = new Date('2026-10-01T11:00:00Z');
const TEMPLATE = 'প্রশ্ন: বাংলাদেশের রাজধানী কোনটি?\nA: ঢাকা\nB: চট্টগ্রাম\nC: খুলনা\nD: রাজশাহী\nউত্তর: A\n---\nপ্রশ্ন: ৫ + ৩ = কত?\nA: ৬\nB: ৭\nC: ৮\nD: ৯\nউত্তর: C';

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'UTC' });

const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{"exams":[]}'), EXAM_KEY);

/** Panels may greet with their own alert; clear it before touching anything. */
async function dismissAlert(page) {
  const ok = page.locator('#apcAlertBackdrop [data-apc-alert-ok]');
  if (await ok.count()) await ok.click();
}
/** A late notice can pop an in-page alert over whatever is being clicked. */
async function autoDismissAlerts(page) {
  await page.addInitScript(() => {
    const dismiss = () => {
      const close = document.querySelector('#apcAlertBackdrop [data-apc-alert-ok], #apcAlertBackdrop [data-apc-alert-close]');
      if (close) close.click();
    };
    new MutationObserver(dismiss).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', dismiss);
  });
}

async function teacherWorkspace(page) {
  await page.addInitScript(({ key, className }) => localStorage.setItem(key, JSON.stringify([
    { id: 'TAS-TENTH', teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'গণিত' }
  ])), { key: ASSIGNMENTS_KEY, className: CLASS });
  await page.clock.setFixedTime(T0);
  await enterPortal(page, 'teacher');
  /* One door per screen: the exam workspace opens from the academic hub, the
     same place the teacher's "+ পরীক্ষা" quick action points to. */
  await page.locator('.admin-bottom [data-teacher-view=academic]').click();
  await page.locator('#teacherAcademic [data-academic-section=exams]').click();
  return page.locator('#teacherExamWorkspace');
}

async function managerWorkspace(page) {
  page.on('dialog', dialog => dialog.accept());
  await page.clock.setFixedTime(T0);
  await enterPortal(page, 'manager');
  await dismissAlert(page);
  await page.evaluate(({ key, className }) => localStorage.setItem(key, JSON.stringify([
    { id: 'AP-1024', name: 'রাইসা', className, group: '', mobile: '01700000000', guardianMobile: '01800000000', status: 'approved', monthlyFee: 1500 }
  ])), { key: ROSTER_KEY, className: CLASS });
  await page.locator('.manager-bottom [data-manager-view=academic]').click();
  await page.locator('#managerAcademicMenu [data-academic-section=exams]').click();
  return page.locator('#managerExamWorkspace');
}

async function author(root, title) {
  await root.locator('[data-exam-action=new-mcq]').click();
  await root.locator('[name=title]').fill(title);
  await root.locator('[name=subject]').selectOption('গণিত');   // বিষয় is a select of the class's enabled subjects
  await root.locator('[name=className]').selectOption(CLASS);
  await root.locator('[name=startAt]').fill('2026-10-01T10:00');
  await root.locator('[name=endAt]').fill('2026-10-01T11:00');
  await root.locator('[name=template]').fill(TEMPLATE);
  await expect(root.locator('[data-parsed-preview]')).toContainText('২টি প্রশ্ন');
  await root.locator('[data-exam-form] [type=submit]').click();
  await expect(root.locator('[data-managed-exam]')).toHaveCount(1);
}

test('a paper is authored into its own date record and its questions stay closed until asked for', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  const root = await teacherWorkspace(page);
  await author(root, 'সাপ্তাহিক পরীক্ষা');

  await expect(root.locator('[data-exam-date]')).toHaveCount(1);
  await expect(root.locator('[data-exam-date]')).toContainText('১টি পরীক্ষা');
  await expect(root.locator('[data-managed-exam] .exam-status')).toHaveClass(/exam-status-muted/);
  await expect(root.locator('.exam-question')).toHaveCount(0, { timeout: 3000 }); // nothing lies open

  await root.locator('[data-exam-action=questions]').click();
  await expect(root.locator('.exam-question')).toHaveCount(2);
  await expect(root).toContainText('বাংলাদেশের রাজধানী কোনটি?');
  await root.locator('[data-exam-action=q-edit]').first().click();
  await root.locator('[data-question-form] [name=text]').fill('রাজধানীর নাম কী?');
  await root.locator('[data-question-form] [type=submit]').click();
  await expect(root.locator('.exam-question').first()).toContainText('রাজধানীর নাম কী?');

  const records = await stored(page);
  expect(records.exams).toHaveLength(1);
  expect(records.exams[0].examDate).toBe('2026-10-01');
  expect(records.exams[0].questions).toHaveLength(2);
  expect(records.exams[0].questions[0].uid).toBe(`${records.exams[0].id}-q1`);
  expect(records.exams[0].template).toContain('রাজধানীর নাম কী?');
  expect(records.exams[0].template).not.toContain('বাংলাদেশের রাজধানী কোনটি');
});

test('teacher submits, Manager approves and publishes, the student sees it — unpublish hides it again', async ({ page, context, browser }) => {
  const root = await teacherWorkspace(page);
  await author(root, 'সাপ্তাহিক পরীক্ষা');
  await root.locator('[data-exam-action=request]').click();
  await expect(root.locator('[data-managed-exam] .exam-status')).toHaveClass(/exam-status-warning/);

  const office = await context.newPage();
  const manager = await managerWorkspace(office);
  await expect(manager.locator('[data-managed-exam]')).toHaveCount(1);
  await expect(manager.locator('[data-exam-action=approve]')).toHaveCount(1);
  await manager.locator('[data-exam-action=approve]').click();
  await expect(manager.locator('[data-managed-exam] .exam-status')).toHaveClass(/exam-status-info/);
  await manager.locator('[data-exam-action=publish]').click();
  await expect(manager.locator('[data-managed-exam] .exam-status')).toHaveClass(/exam-status-success/);

  /* The student sits on a device of their own: the published record is the
     only thing that reaches it. */
  const pupilContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'UTC' });
  const pupil = await pupilContext.newPage();
  await autoDismissAlerts(pupil);
  await pupil.clock.setFixedTime(WINDOW_START);
  await enterStudentApp(pupil);
  const store = () => office.evaluate(key => localStorage.getItem(key), EXAM_KEY);
  const sync = async () => {
    await pupil.evaluate(([key, value]) => localStorage.setItem(key, value), [EXAM_KEY, await store()]);
    await pupil.reload();
    await dismissAlert(pupil);
    if (!(await pupil.locator('#examsView').isVisible())) {
      await pupil.locator('[data-view=exams]:visible').first().click();
    }
  };
  await sync();
  await expect(pupil.locator('#studentExamWorkspace')).toContainText('সাপ্তাহিক পরীক্ষা');
  await expect(pupil.locator('[data-student-exam-action=start]')).toHaveCount(1);

  /* Nothing was started, so the Manager can still pull the paper back — and
     the student list empties without a single record being deleted. */
  await manager.locator('[data-exam-action=unpublish]').click();
  await expect(manager.locator('[data-managed-exam] .exam-status')).toHaveClass(/exam-status-info/);
  await sync();
  await expect(pupil.locator('#studentExamWorkspace')).not.toContainText('সাপ্তাহিক পরীক্ষা');
  const records = await stored(pupil);
  expect(records.exams[0].status).toBe('approved');
  expect(records.exams[0].questions).toHaveLength(2);
  await pupilContext.close();
});

test('the Manager adds and deletes questions, duplicates the paper and archives it with everything intact', async ({ page }) => {
  const manager = await managerWorkspace(page);
  await author(manager, 'ম্যানেজার পরীক্ষা');
  await manager.locator('[data-exam-action=questions]').click();
  await manager.locator('.exam-question-add summary').click();
  await manager.locator('[data-question-add] [name=text]').fill('তৃতীয় প্রশ্ন কোনটি?');
  for (const id of ['A', 'B', 'C', 'D']) await manager.locator(`[data-question-add] [name=option-${id}]`).fill(`বিকল্প ${id}`);
  await manager.locator('[data-question-add] [name=answer]').selectOption('B');
  await manager.locator('[data-question-add] [type=submit]').click();
  await expect(manager.locator('.exam-question')).toHaveCount(3);
  await manager.locator('[data-exam-action=q-delete]').first().click();
  await expect(manager.locator('.exam-question')).toHaveCount(2);

  await manager.locator('[data-exam-action=list]').click();
  await manager.locator('[data-exam-action=duplicate]').click();
  await expect(manager.locator('[name=title]')).not.toHaveValue('ম্যানেজার পরীক্ষা');
  await manager.locator('[data-exam-form] [type=submit]').click();
  await expect(manager.locator('[data-managed-exam]')).toHaveCount(2);

  const original = manager.locator('[data-managed-exam]').filter({ hasText: 'ম্যানেজার পরীক্ষা' }).first();
  await original.locator('[data-exam-action=archive]').click();
  await expect(original.locator('[data-exam-action=restore]')).toHaveCount(1);
  await original.locator('[data-exam-action=restore]').click();
  await expect(original.locator('[data-exam-action=archive]')).toHaveCount(1);

  const records = await stored(page);
  expect(records.exams).toHaveLength(2);
  const copy = records.exams.find(exam => exam.copiedFrom);
  expect(copy.title).toContain('(');
  expect(copy.questions).toHaveLength(2);
  expect(copy.questions[0].uid).not.toBe(records.exams.find(exam => !exam.copiedFrom).questions[0].uid);
  expect(records.exams.every(exam => exam.status !== 'archived')).toBe(true);
});

test('on a 320px phone the dashboard table is a card list with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const root = await teacherWorkspace(page);
  await author(root, 'ছোট ফোনের পরীক্ষা');
  await expect(root.locator('.exam-table thead')).toBeHidden();
  await expect(root.locator('[data-managed-exam] td[data-label="অ্যাকশন"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
