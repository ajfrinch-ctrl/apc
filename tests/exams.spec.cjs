const { test, expect } = require('./fixtures.cjs');
const { openTeacherExams, enterPortal, enterStudentApp, newDevice, syncStorage } = require('./portal-session.cjs');
const fs = require('node:fs/promises');
const KEY = 'activePlus.exams.v1';
const t0 = new Date('2026-10-01T09:00:00Z'), start = new Date('2026-10-01T10:00:00Z'), end = new Date('2026-10-01T11:00:00Z');
const template = 'প্রশ্ন: বাংলাদেশের রাজধানী কোনটি?\nA: ঢাকা\nB: চট্টগ্রাম\nC: খুলনা\nD: রাজশাহী\nউত্তর: A\n---\nপ্রশ্ন: ৫ + ৩ = কত?\nA: ৬\nB: ৭\nC: ৮\nD: ৯\nউত্তর: C';
test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'UTC' });
test.setTimeout(60000); // Multi-device login and cross-device data delivery.
test.beforeEach(({ context }) => context.setDefaultTimeout(10000));

const extraDevices = new Set();
test.afterEach(async () => {
  for (const device of extraDevices) await device.close();
  extraDevices.clear();
});
async function deviceFor(context) {
  const device = await newDevice(context);
  extraDevices.add(device);
  device.setDefaultTimeout(10000);
  await device.addInitScript(() => {
    try { localStorage.setItem('activePlus.demo.autofill.v1', 'off'); } catch { /* opaque frame */ }
    const dismiss = () => document.querySelector('#apcAlertBackdrop [data-apc-alert-ok], #apcAlertBackdrop [data-apc-alert-close]')?.click();
    new MutationObserver(dismiss).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', dismiss);
  });
  return device;
}
async function teacher(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('activePlus.manager.teacherAssignments.v1', JSON.stringify([{ id: 'TAS-TENTH', teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className: 'দশম শ্রেণি', group: '', subject: 'গণিত' }])); } catch { /* opaque frame */ }
    const dismiss = () => document.querySelector('#apcAlertBackdrop [data-apc-alert-ok], #apcAlertBackdrop [data-apc-alert-close]')?.click();
    new MutationObserver(dismiss).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', dismiss);
  });
  await page.clock.setFixedTime(t0);
  // One login card for everyone: the session the fixture writes is the door.
  await enterPortal(page, 'teacher');
  await page.clock.setFixedTime(t0);
  await page.evaluate(() => sessionStorage.removeItem('activePlus.lastSeenClock.v1'));
  /* The exam workspace is one screen; the hub card is the documented door
     (ফলাফল seat keeps the marks records of the class tests). */
  /* The teacher bottom-nav পরীক্ষা item opens the existing online-exam hub directly. */
  await openTeacherExams(page);
}
async function manager(context, screen = 'upcoming') {
  const page = await context.newPage(); await page.clock.setFixedTime(t0);
  page.on('dialog', dialog => dialog.accept());
  // একাডেমিক is the one hub whose card opens the single examination workspace.
  await enterPortal(page, 'manager');
  await page.clock.setFixedTime(t0);
  await page.evaluate(() => sessionStorage.removeItem('activePlus.lastSeenClock.v1'));
  await page.locator('.admin-bottom [data-panel-view=academic]').click();
  await page.locator('#managerAcademicMenu [data-academic-section=exams]').click();
  await page.locator(`#managerExamHub [data-manager-exam=${screen}]`).click();
  await page.locator('#managerExamWorkspace').waitFor({ state: 'visible' });
  return page;
}
async function managerFrom(context, source) {
  const device = await deviceFor(context);
  const staging = await device.newPage();
  await staging.goto('/demo/offline-roles.html');
  await syncStorage(source, staging, [KEY]);
  await staging.evaluate(() => localStorage.setItem('activePlus.admin.students.v1', JSON.stringify([
    { id: 'AP-1024', name: 'রাইসা', className: 'দশম শ্রেণি', group: '', status: 'approved' },
    { id: '260810021', name: 'দ্বিতীয় শিক্ষার্থী', className: 'দশম শ্রেণি', group: '', status: 'approved' }
  ])));
  await staging.close();
  return manager(device, 'other');
}
async function student(context, source = null) {
  const device = source ? await deviceFor(context) : context;
  const page = await device.newPage(); await page.clock.setFixedTime(start);
  await enterStudentApp(page);
  await expect(page).toHaveURL(/student\.html/);
  if (source) {
    await syncStorage(source, page, [KEY]);
    await page.reload();
  }
  await page.clock.setFixedTime(start);
  await page.evaluate(() => sessionStorage.removeItem('activePlus.lastSeenClock.v1'));
  await page.locator('.bottom-nav [data-view=exams]').click();
  if (source) await page.locator('#examTabs [data-exam-tab=live]').click();
  return page;
}
async function createUI(page, type = 'mcq', title = 'সমন্বিত অনলাইন পরীক্ষা') {
  await page.locator('#teacherOnlineExams [data-teacher-exam=home]').click();
  const root = page.locator('#teacherExamWorkspace'); await root.locator(`[data-exam-action=new-${type}]`).click();
  await root.locator('[name=title]').fill(title); await root.locator('[name=subject]').selectOption('গণিত');
  await root.locator('[name=className]').selectOption('দশম শ্রেণি'); // the demo student's class
  await root.locator('[name=startAt]').fill('2026-10-01T16:00'); await root.locator('[name=endAt]').fill('2026-10-01T17:00');
  if (type === 'mcq') await root.locator('[name=negative]').fill('0.5');
  await root.locator('[name=template]').fill(type === 'mcq' ? template : 'প্রশ্ন: পরিবেশ রক্ষায় গাছের গুরুত্ব লেখো।\nনম্বর: ৫\n---\nপ্রশ্ন: পানি দূষণ রোধের তিনটি উপায় লেখো।\nনম্বর: ৩');
  await expect(root.locator('[data-parsed-preview]')).toContainText('২টি প্রশ্ন');
  await root.locator('[data-exam-form] [type=submit]').click(); await expect(root.locator('[data-managed-exam]')).toHaveCount(1);
  await root.locator('[data-exam-action=request]').click(); await expect(root.locator('[data-managed-exam]')).toContainText('অনুমোদনের অপেক্ষায়');
}
async function seed(page, extra = {}) {
  /* One session per role, exactly like the app: the Teacher writes and submits
     the paper on their own page, then the Manager publishes it from a manager
     page (every repository write checks the actor's live session). */
  const id = await page.evaluate(async extra => {
    const { examRepository: repo, examTemplate } = await import('/js/exam-data.js');
    const db = await repo.saveDraft({ title: 'ডেমো পরীক্ষা', type: 'mcq', subject: 'গণিত', className: 'দশম শ্রেণি', template: examTemplate('mcq'), startAt: new Date('2026-10-01T10:00:00Z').getTime(), endAt: new Date('2026-10-01T11:00:00Z').getTime(), lateMinutes: 10, negative: .5, passPercent: 33, ...extra });
    const paper = db.exams[0].id;
    await repo.requestApproval(paper);
    return paper;
  }, extra);
  const officeContext = await deviceFor(page.context());
  const office = await officeContext.newPage();
  await office.clock.setFixedTime(t0);
  await office.goto('/demo/offline-roles.html');
  await syncStorage(page, office, [KEY]);
  await office.evaluate(() => localStorage.setItem('activePlus.admin.students.v1', JSON.stringify([
    { id: 'AP-1024', name: 'রাইসা', className: 'দশম শ্রেণি', group: '', status: 'approved' }
  ])));
  await enterPortal(office, 'manager');
  await office.evaluate(async paper => {
    const { examRepository: repo, MANAGER_ACTOR } = await import('/js/exam-data.js');
    await repo.review(paper, 'publish', {}, MANAGER_ACTOR);
  }, id);
  await syncStorage(office, page, [KEY]);
  return id;
}
async function finish(page) {
  await page.locator('[data-student-exam-action=confirm]').click(); await page.locator('[data-student-exam-action=finish]').click();
}

test('teacher paper → Manager publication → student MCQ score after the deadline', async ({ page, context }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await teacher(page);
  await createUI(page);

  // Each role owns its own device-bound session. Copy only the shared exam
  // collection at the points where the cloud would deliver a new snapshot.
  const officeContext = await newDevice(context);
  const pupilContext = await newDevice(context);
  officeContext.setDefaultTimeout(10000);
  pupilContext.setDefaultTimeout(10000);
  try {
    await officeContext.addInitScript(() => {
      try { localStorage.setItem('activePlus.demo.autofill.v1', 'off'); } catch { /* opaque frames */ }
      const dismiss = () => document.querySelector('#apcAlertBackdrop [data-apc-alert-ok], #apcAlertBackdrop [data-apc-alert-close]')?.click();
      new MutationObserver(dismiss).observe(document, { childList: true, subtree: true });
      document.addEventListener('DOMContentLoaded', dismiss);
    });
    await pupilContext.addInitScript(() => {
      try { localStorage.setItem('activePlus.demo.autofill.v1', 'off'); } catch { /* opaque frames */ }
      const dismiss = () => document.querySelector('#apcAlertBackdrop [data-apc-alert-ok], #apcAlertBackdrop [data-apc-alert-close]')?.click();
      new MutationObserver(dismiss).observe(document, { childList: true, subtree: true });
      document.addEventListener('DOMContentLoaded', dismiss);
    });
    const staging = await officeContext.newPage();
    await staging.goto('/demo/offline-roles.html');
    await syncStorage(page, staging, [KEY]);
    await staging.evaluate(() => localStorage.setItem('activePlus.admin.students.v1', JSON.stringify([
      { id: 'AP-1024', name: 'রাইসা', className: 'দশম শ্রেণি', group: '', mobile: '01700000000', status: 'approved' }
    ])));
    await staging.close();
    const pupil = await student(pupilContext);
    await syncStorage(page, pupil, [KEY]);
    await pupil.reload();
    await pupil.locator('.bottom-nav [data-view=exams]').click();
    await expect.poll(() => pupil.evaluate(key => JSON.parse(localStorage.getItem(key)).exams[0].status, KEY)).toBe('pending');
    await expect(pupil.locator('#studentExamWorkspace [data-student-exam]')).toHaveCount(0);
    const office = await manager(officeContext, 'other');
    const officeRoot = office.locator('#managerExamWorkspace');
    await officeRoot.locator('[data-exam-action=approve]').click();
    await expect(officeRoot.locator('[data-managed-exam] .exam-status')).toHaveClass(/exam-status-info/);
    await officeRoot.locator('[data-exam-action=publish]').click();
    await expect(officeRoot.locator('[data-managed-exam] .exam-status')).toHaveClass(/exam-status-success/);
    await syncStorage(office, pupil, [KEY]);
    await pupil.reload();
    await pupil.locator('.bottom-nav [data-view=exams]').click();
    await pupil.locator('#examTabs [data-exam-tab=live]').click();
    await expect(pupil.locator('[data-student-exam]')).toContainText('সমন্বিত অনলাইন পরীক্ষা');
    await pupil.locator('[data-student-exam-action=start]').click();
    await expect(pupil.locator('.exam-question')).toHaveCount(2);
    await expect(pupil.locator('[data-answer-question]')).toHaveCount(8);
    await pupil.locator('[data-answer-question=q1][value=B]').check();
    await pupil.locator('[data-answer-question=q2][value=C]').check();
    await finish(pupil);
    await expect(pupil.locator('[data-student-exam-action=results]')).toHaveCount(0);
    await expect(pupil.locator('#studentExamWorkspace')).not.toContainText('০.৫ / ২');

    // MCQ results now publish automatically after the deadline once all
    // attempts are submitted, rather than requiring a Manager button.
    await pupil.clock.setFixedTime(new Date(end.getTime() + 60_000));
    await pupil.locator('[data-student-exam-action=refresh]').click();
    await expect.poll(() => pupil.evaluate(key => JSON.parse(localStorage.getItem(key)).exams[0].resultsPublished, KEY)).toBe(true);
    await pupil.locator('.bottom-nav [data-view=exams]').click();
    await pupil.locator('#examTabs [data-exam-tab=results]').click();
    await expect(pupil.locator('#studentResultOverview')).toContainText('০.৫ / ২');
    await expect(pupil.locator('#studentResultOverview')).toContainText('সমন্বিত অনলাইন পরীক্ষা');
    await expect(pupil.locator('#studentResultOverview')).not.toContainText('01700000000');
    expect(errors).toEqual([]);
  } finally {
    await pupilContext.close();
    await officeContext.close();
  }
});

test('MCQ allows one attempt and rejects a repeat without losing answers', async ({ page, context }) => {
  await teacher(page); const id = await seed(page); const pupil = await student(context, page);
  await pupil.locator('[data-student-exam-action=start]').click();
  await pupil.locator('[data-answer-question=q1][value=A]').check();
  await finish(pupil);
  await expect(pupil.locator('[data-student-exam-action=start]')).toHaveCount(0);
  await expect(pupil.locator('#studentExamWorkspace')).toContainText('এই পরীক্ষায় একবারই অংশ নেওয়া যায়');
  const retry = await pupil.evaluate(async id => {
    try {
      const { examRepository } = await import('/js/exam-data.js');
      await examRepository.startAttempt(id, { id: 'AP-1024' });
      return '';
    } catch (error) { return error.message; }
  }, id);
  expect(retry).toContain('একবারের চেষ্টা');
  const attempts = await pupil.evaluate(key => JSON.parse(localStorage.getItem(key)).attempts, KEY);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ status: 'submitted', answers: { q1: 'A' }, score: 1 });
});

test('offline reload resumes same shuffled answers, deadline locks and online reconnect syncs once', async ({ page, context }) => {
  await teacher(page); await seed(page); const pupil = await student(context, page); await pupil.evaluate(()=>navigator.serviceWorker.ready); await expect.poll(()=>pupil.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await pupil.locator('[data-student-exam-action=start]').click(); await pupil.locator('[data-answer-question=q1][value=A]').check();
  // A checked radio precedes the async durable write; wait for that write before going offline.
  await expect.poll(() => pupil.evaluate(key => JSON.parse(localStorage.getItem(key)).attempts[0]?.answers?.q1, KEY)).toBe('A');
  const order = await pupil.locator('[data-answer-question]').evaluateAll(items=>items.map(i=>`${i.dataset.answerQuestion}:${i.value}`));
  await pupil.context().setOffline(true); await pupil.reload(); await pupil.locator('.bottom-nav [data-view=exams]').click(); await pupil.locator('#examTabs [data-exam-tab=live]').click(); await pupil.locator('[data-student-exam-action=resume]').click();
  expect(await pupil.locator('[data-answer-question]').evaluateAll(items=>items.map(i=>`${i.dataset.answerQuestion}:${i.value}`))).toEqual(order);
  await expect(pupil.locator('[data-answer-question=q1][value=A]')).toBeChecked(); await pupil.locator('[data-answer-question=q2][value=C]').check();
  await pupil.clock.setFixedTime(new Date(end.getTime()+1000));
  await expect.poll(()=>pupil.evaluate(key=>JSON.parse(localStorage.getItem(key)).attempts[0].status,KEY)).toBe('queued');
  await expect(pupil.locator('[data-answer-question]')).toHaveCount(0);
  await pupil.context().setOffline(false); await expect.poll(()=>pupil.evaluate(key=>JSON.parse(localStorage.getItem(key)).attempts[0].status,KEY)).toBe('submitted');
  const attempts = await pupil.evaluate(key=>JSON.parse(localStorage.getItem(key)).attempts,KEY); expect(attempts).toHaveLength(1); expect(attempts[0].score).toBe(2);
});

test('global deadline auto-submits but the answer PDF downloads only on one explicit request', async ({ page, context }) => {
  await teacher(page); await seed(page); const pupil = await student(context, page); await pupil.locator('[data-student-exam-action=start]').click(); await pupil.locator('[data-answer-question=q1][value=A]').check();
  let downloadCount = 0; pupil.on('download', () => { downloadCount += 1; });
  await pupil.clock.setFixedTime(end);
  await expect(pupil.locator('[data-student-exam-action=solutions]')).toBeVisible();
  await expect(pupil.locator('[data-answer-question]')).toHaveCount(0);
  await pupil.waitForTimeout(1500);
  expect(downloadCount).toBe(0, 'reaching the exam deadline must not start a surprise download');
  const manual = pupil.waitForEvent('download'); await pupil.locator('[data-student-exam-action=solutions]').click();
  const download = await manual;
  expect(download.suggestedFilename()).toContain('solutions'); const bytes=await fs.readFile(await download.path()); expect(bytes.subarray(0,8).toString()).toBe('%PDF-1.4'); expect(bytes.length).toBeGreaterThan(30000);
  expect(downloadCount).toBe(1, 'one button press creates exactly one PDF download');
});

for (const type of ['written','short']) {
  test(`${type}: question PDF, next-day classroom marks, absence and downloadable report`, async ({ page, context }) => {
    await teacher(page); await createUI(page,type);
    const office = await managerFrom(context, page);
    const root = office.locator('#managerExamWorkspace');
    await root.locator('[data-exam-action=publish]').click();
    await expect(root.locator('[data-managed-exam] .exam-status')).toHaveClass(/exam-status-success/);
    const pupil = await student(context, office);
    await expect(pupil.locator('[data-student-exam-action=start]')).toHaveCount(0);
    const promise = pupil.waitForEvent('download'); await pupil.locator('[data-student-exam-action=paper]').click();
    const paper = await promise; const paperBytes = await fs.readFile(await paper.path());
    expect(paperBytes.subarray(0, 8).toString()).toBe('%PDF-1.4');
    expect(paper.suggestedFilename() === 'download' || paper.suggestedFilename().includes('questions')).toBe(true);

    await syncStorage(office, page, [KEY, 'activePlus.admin.students.v1']);
    await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
    await page.reload(); await openTeacherExams(page);
    await page.locator('#teacherOnlineExams [data-teacher-exam=home]').click();
    const teacherRoot=page.locator('#teacherExamWorkspace'); await teacherRoot.locator('[data-exam-action=grade]').click();
    await teacherRoot.locator('[name=studentId]').selectOption('AP-1024'); await teacherRoot.locator('[name=q1]').fill('4'); await teacherRoot.locator('[name=q2]').fill('2'); await teacherRoot.locator('[value=marks]').click();
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).attempts.length, KEY)).toBe(1);
    await teacherRoot.locator('[name=studentId]').selectOption('260810021'); await teacherRoot.locator('[value=absent]').click();
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).exams[0].absentIds, KEY)).toContain('260810021');
    await teacherRoot.locator('[data-exam-action=list]').click(); await teacherRoot.locator('[data-exam-action=report]').click(); await expect(teacherRoot).toContainText('অনুপস্থিত');
    const csvPromise=page.waitForEvent('download'); await teacherRoot.locator('[data-exam-action=csv]').click(); const csv=await fs.readFile(await (await csvPromise).path(),'utf8');
    expect(csv).toContain('অনুপস্থিত'); expect(csv).toContain('রাইসা'); expect(csv).not.toContain('01700000000');

    await syncStorage(page, office, [KEY]);
    await office.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
    await office.reload(); await office.locator('.admin-bottom [data-panel-view=academic]').click();
    await office.locator('#managerAcademicMenu [data-academic-section=results]').click();
    await office.locator('[data-results-action=list]').click();
    await office.locator('[data-manager-action=publish-results]').click();
    await expect(office.locator('#managerResultList')).toContainText('ফলাফল প্রকাশিত');
    await syncStorage(office, pupil, [KEY]);
    await pupil.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
    await pupil.reload(); await pupil.locator('.bottom-nav [data-view=exams]').click();
    await pupil.locator('#examTabs [data-exam-tab=results]').click();
    await expect(pupil.locator('#studentResultOverview')).toContainText('৬ / ৮');
  });
}

test('Manager returns corrections, malformed paste and write failure preserve teacher form', async ({ page, context }) => {
  await teacher(page); await createUI(page);
  const office=await managerFrom(context, page); const root=office.locator('#managerExamWorkspace');
  await root.locator('[data-exam-action=detail]').click(); await root.locator('[name=note]').fill('নম্বর সংশোধন করুন'); await root.locator('[value=reject]').click();
  await expect(root.locator('[data-rejection-reason]')).toContainText('নম্বর সংশোধন করুন');
  await syncStorage(office, page, [KEY]);
  await page.reload(); await openTeacherExams(page); await page.locator('#teacherOnlineExams [data-teacher-exam=home]').click();
  const teacherRoot=page.locator('#teacherExamWorkspace'); await expect(teacherRoot.locator('[data-managed-exam]')).toContainText('নম্বর সংশোধন করুন'); await teacherRoot.locator('[data-managed-exam] [data-exam-action=edit]').click();
  await teacherRoot.locator('[name=template]').fill('ভুল টেমপ্লেট'); await expect(teacherRoot.locator('[data-parsed-preview]')).toContainText('টেমপ্লেট'); await teacherRoot.locator('[data-exam-form] [type=submit]').click(); await expect(teacherRoot.locator('[data-exam-error]')).toBeVisible();
  await teacherRoot.locator('[name=template]').fill(template); await page.evaluate(key=>{const set=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('Quota','QuotaExceededError');return set.call(this,k,v);};},KEY);
  await teacherRoot.locator('[data-exam-form] [type=submit]').click(); await expect(teacherRoot.locator('[name=template]')).toHaveValue(template); await expect(teacherRoot.locator('[data-exam-form] [type=submit]')).toBeEnabled();
});

for (const width of [320,390,844,1280]) {
  test(`exam questions and authoring are mobile, five fixed footer items (${width}px)`, async ({ page, context }) => {
    await page.setViewportSize({width,height:width===844?390:844}); await teacher(page); await page.locator('#teacherOnlineExams [data-teacher-exam=home]').click(); await page.locator('[data-exam-action=new-mcq]').click();
    await expect(page.locator('#teacherExamWorkspace [name=title]')).toHaveCSS('font-size','16px'); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('[data-exam-action=list]').click(); await seed(page); const pupil=await student(context, page); await pupil.setViewportSize({width,height:width===844?390:844}); await pupil.locator('[data-student-exam-action=start]').click();
    await expect(pupil.locator('.bottom-nav .bottom-link')).toHaveCount(5); await expect(pupil.locator('.bottom-nav')).toHaveCSS('position','fixed');
    const header = pupil.locator('#studentHeader');
    await expect(header).toBeVisible();
    const headerTop = (await header.boundingBox()).y;
    const save=pupil.locator('[data-student-exam-action=confirm]'); await save.scrollIntoViewIfNeeded();
    expect(Math.abs((await header.boundingBox()).y - headerTop)).toBeLessThan(2);
    expect(await pupil.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true); expect((await save.boundingBox()).y+(await save.boundingBox()).height).toBeLessThanOrEqual((await pupil.locator('.bottom-nav').boundingBox()).y);
  });
}

for (const [width,height] of [[320,844],[390,844],[844,390],[1280,844]]) {
  test(`student MCQ timer stays at the top while scrolling (${width}×${height})`, async ({ page }) => {
    await page.setViewportSize({width,height}); await page.clock.setFixedTime(start); await page.goto('/index.html');
    await page.evaluate(async()=>{
      const {EXAM_KEY,examTemplate,validateExam}=await import('/js/exam-data.js');
      const now=Date.now(),participant={id:'AP-1024',name:'রাইসা',className:'দশম শ্রেণি',group:''};
      const fields=validateExam({type:'mcq',title:'Sticky timer check',subject:'গণিত',className:participant.className,startAt:now-60000,endAt:now+60*60000,lateMinutes:10,negative:0,passPercent:33,template:Array(4).fill(examTemplate('mcq')).join('\n---\n')});
      const exam={...fields,id:'EX-TIMER-STICKY',teacherId:'DEMO-TEACHER',teacherName:'Demo Teacher',status:'published',resultsPublished:true,participants:[participant],createdAt:now,updatedAt:now};
      localStorage.setItem('active-plus-account-v1',JSON.stringify({status:'active',registrationMobile:'01700000000',mobile:'01700000000',student:participant}));
      sessionStorage.setItem('active-plus-session-v1','1');
      localStorage.setItem(EXAM_KEY,JSON.stringify({version:1,exams:[exam],attempts:[]}));
    });
    await page.reload(); await page.waitForLoadState('networkidle');
    await page.locator('.bottom-nav [data-view=exams]').click(); await page.locator('#examTabs [data-exam-tab=live]').click();
    await expect(page.locator('[data-student-exam-action=start]')).toBeVisible(); await page.locator('[data-student-exam-action=start]').click();
    const timer=page.locator('#studentExamWorkspace .exam-timer--pinned'), main=page.locator('#appMain');
    await expect(timer).toBeVisible(); await expect(timer).toHaveCSS('position','sticky');
    const scroll=await main.evaluate(el=>{
      const timer=document.querySelector('#studentExamWorkspace .exam-timer--pinned');
      el.scrollTop=0;
      const offset=timer.getBoundingClientRect().top-el.getBoundingClientRect().top;
      const max=el.scrollHeight-el.clientHeight;
      el.scrollTop=Math.min(max,Math.ceil(offset+1));
      return {offset,max};
    });
    expect(scroll.max).toBeGreaterThanOrEqual(scroll.offset);
    // Sticky top:0 pins at the scroll container's padding edge, not its border.
    await expect.poll(async()=>{
      const [timerBox, mainBox, inset] = await Promise.all([
        timer.boundingBox(), main.boundingBox(),
        main.evaluate(el => el.clientTop + parseFloat(getComputedStyle(el).paddingTop))
      ]);
      return Math.abs(timerBox.y - mainBox.y - inset);
    }).toBeLessThan(2);
  });
}

test('copyable templates and long Bengali exam PDFs paginate without print dialogs', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read','clipboard-write']); await teacher(page); await page.locator('#teacherOnlineExams [data-teacher-exam=home]').click(); const root=page.locator('#teacherExamWorkspace'); await root.locator('[data-exam-action=new-mcq]').click(); await root.locator('[data-exam-action=copy-template]').click(); expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('উত্তর: A');
  await root.locator('[data-exam-action=list]').click();
  const longTemplate=Array.from({length:30},(_,i)=>template.split('\n---\n')[0].replace('বাংলাদেশের রাজধানী কোনটি?',`প্রশ্ন ${i+1}: বাংলাদেশের রাজধানী ও প্রশাসনিক বিভাগ সম্পর্কে তোমার জানা তথ্য অনুযায়ী সঠিক উত্তরটি নির্বাচন করো।`)).join('\n---\n');
  await seed(page,{template:longTemplate});
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).exams[0].questions.length, KEY)).toBe(30);
  await page.reload(); await openTeacherExams(page); await page.locator('#teacherOnlineExams [data-teacher-exam=home]').click(); await root.locator('[data-exam-action=detail]').click();
  const promise=page.waitForEvent('download'); await root.locator('[data-exam-action=paper]').click(); const bytes=await fs.readFile(await (await promise).path()); const pdf=bytes.toString('latin1'); expect(Number(pdf.match(/\/Count (\d+)/)[1])).toBeGreaterThan(1); expect(bytes.length).toBeGreaterThan(100000);
});

test('failed answer writes are visible and never increment saved count; retry works', async ({ page, context }) => {
  await teacher(page); await seed(page); const pupil=await student(context, page); await pupil.locator('[data-student-exam-action=start]').click();
  await expect(pupil.locator('[data-answer-question=q1][value=A]')).toBeVisible();
  await pupil.evaluate(key=>{window.realExamSet=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('quota','QuotaExceededError');return window.realExamSet.call(this,k,v);};},KEY);
  await pupil.locator('[data-answer-question=q1][value=A]').click(); await expect(pupil.locator('#studentExamWorkspace [data-exam-error]')).toContainText('সংরক্ষণ/ডাউনলোড হয়নি');
  expect(await pupil.evaluate(key=>Object.keys(JSON.parse(localStorage.getItem(key)).attempts[0].answers).length,KEY)).toBe(0);
  await expect(pupil.locator('[data-answer-question=q1][value=A]')).not.toBeChecked();
  await pupil.evaluate(()=>{Storage.prototype.setItem=window.realExamSet;}); await pupil.locator('[data-answer-question=q1][value=A]').check(); await expect(pupil.locator('[data-answer-status]')).toContainText('১ / ২');
});
