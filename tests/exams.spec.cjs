const { test, expect } = require('./fixtures.cjs');
const { enterPortal, enterStudentApp } = require('./portal-session.cjs');
const fs = require('node:fs/promises');
const KEY = 'activePlus.exams.v1';
const t0 = new Date('2026-10-01T09:00:00Z'), start = new Date('2026-10-01T10:00:00Z'), end = new Date('2026-10-01T11:00:00Z');
const template = 'প্রশ্ন: বাংলাদেশের রাজধানী কোনটি?\nA: ঢাকা\nB: চট্টগ্রাম\nC: খুলনা\nD: রাজশাহী\nউত্তর: A\n---\nপ্রশ্ন: ৫ + ৩ = কত?\nA: ৬\nB: ৭\nC: ৮\nD: ৯\nউত্তর: C';
test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'UTC' });
async function teacher(page) {
  await page.addInitScript(() => localStorage.setItem('activePlus.manager.teacherAssignments.v1', JSON.stringify([{ id: 'TAS-TENTH', teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className: 'দশম শ্রেণি', group: '', subject: 'গণিত' }])));
  await page.clock.setFixedTime(t0);
  // One login card for everyone: the session the fixture writes is the door.
  await enterPortal(page, 'teacher');
  /* The exam workspace is one screen; the hub card is the documented door
     (ফলাফল seat keeps the marks records of the class tests). */
  await page.locator('.admin-bottom [data-teacher-view=academic]').click();
  await page.locator('#teacherAcademic [data-academic-section=exams]').click();
}
async function manager(context) {
  const page = await context.newPage(); await page.clock.setFixedTime(t0);
  // একাডেমিক is the one hub whose card opens the single examination workspace.
  await enterPortal(page, 'manager');
  await page.locator('.admin-bottom [data-manager-view=academic]').click();
  await page.locator('#managerAcademicMenu [data-academic-section=exams]').click();
  return page;
}
async function student(context) {
  const page = await context.newPage(); await page.clock.setFixedTime(start);
  await enterStudentApp(page);
  await page.locator('.bottom-nav [data-view=exams]').click();
  return page;
}
async function createUI(page, type = 'mcq', title = 'সমন্বিত অনলাইন পরীক্ষা') {
  const root = page.locator('#teacherExamWorkspace'); await root.locator(`[data-exam-action=new-${type}]`).click();
  await root.locator('[name=title]').fill(title); await root.locator('[name=subject]').selectOption('গণিত');
  await root.locator('[name=className]').selectOption('দশম শ্রেণি'); // the demo student's class
  await root.locator('[name=startAt]').fill('2026-10-01T10:00'); await root.locator('[name=endAt]').fill('2026-10-01T11:00');
  await root.locator('[name=template]').fill(type === 'mcq' ? template : 'প্রশ্ন: পরিবেশ রক্ষায় গাছের গুরুত্ব লেখো।\nনম্বর: ৫\n---\nপ্রশ্ন: পানি দূষণ রোধের তিনটি উপায় লেখো।\nনম্বর: ৩');
  await expect(root.locator('[data-parsed-preview]')).toContainText('২টি প্রশ্ন');
  await root.locator('[data-exam-form] [type=submit]').click(); await expect(root.locator('[data-managed-exam]')).toHaveCount(1);
  await root.locator('[data-exam-action=request]').click(); await expect(root.locator('[data-managed-exam]')).toContainText('অনুমোদনের অপেক্ষায়');
}
async function publishUI(page) {
  const root = page.locator('#managerExamWorkspace'); await root.locator('[data-exam-action=detail]').click();
  await root.locator('[name=negative]').fill('0.5'); await root.locator('[value=publish]').click(); await expect(root.locator('[data-managed-exam]')).toContainText('প্রকাশিত');
}
async function releaseResults(office, pupil) {
  await office.clock.setFixedTime(new Date(end.getTime() + 60_000));
  await office.locator('.manager-bottom [data-manager-view=academic]').click();
  await office.locator('#managerAcademicMenu [data-academic-section=results]').click();
  await office.locator('[data-manager-action=publish-results]').click();
  await expect(office.locator('#managerResultList')).toContainText('ফলাফল প্রকাশিত');
  await pupil.clock.setFixedTime(new Date(end.getTime() + 60_000));
  await pupil.locator('[data-student-exam-action=refresh]').click();
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
  const office = await manager(page.context());
  await office.evaluate(async paper => {
    const { examRepository: repo, MANAGER_ACTOR } = await import('/js/exam-data.js');
    await repo.review(paper, 'publish', {}, MANAGER_ACTOR);
  }, id);
  await office.close();
  return id;
}
async function finish(page) {
  await page.locator('[data-student-exam-action=confirm]').click(); await page.locator('[data-student-exam-action=finish]').click();
}

test('teacher paste → Manager approval → Manager result publishing controls the public score', async ({ page, context }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); await teacher(page); await createUI(page);
  const pupil = await student(context); await expect(pupil.locator('#studentExamWorkspace [data-student-exam]')).toHaveCount(0);
  const office = await manager(context); await publishUI(office);
  await expect(pupil.locator('[data-student-exam]')).toContainText('সমন্বিত অনলাইন পরীক্ষা');
  await pupil.clock.setFixedTime(start);
  await pupil.locator('[data-student-exam-action=start]').click(); await expect(pupil.locator('.exam-question')).toHaveCount(2); await expect(pupil.locator('[data-answer-question]')).toHaveCount(8);
  await pupil.locator('[data-answer-question=q1][value=B]').check(); await pupil.locator('[data-answer-question=q2][value=C]').check(); await finish(pupil);
  await expect(pupil.locator('#studentExamWorkspace')).toContainText('ফলাফল Manager-এর প্রকাশের অপেক্ষায়');
  await expect(pupil.locator('#studentExamWorkspace')).not.toContainText('০.৫ / ২');
  await releaseResults(office, pupil); await pupil.locator('[data-student-exam-action=results]').click();
  await expect(pupil.locator('#studentExamWorkspace')).toContainText('০.৫ / ২'); await expect(pupil.locator('.exam-results')).toContainText('রাইসা ইসলাম');
  await expect(pupil.locator('.exam-results')).not.toContainText('01700000000'); await expect(pupil.locator('[data-student-exam-action=solutions]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('running average unlocks one retake, all questions persist and only best score ranks', async ({ page, context }) => {
  await teacher(page); const id = await seed(page); const pupil = await student(context);
  await pupil.locator('[data-student-exam-action=start]').click(); await pupil.locator('[data-answer-question=q1][value=A]').check(); await finish(pupil);
  await expect(pupil.locator('[data-student-exam-action=start]')).toHaveCount(0);
  await pupil.evaluate(async id => { const { examRepository:r }=await import('/js/exam-data.js'); let db=await r.startAttempt(id,{id:'260810021'}); const a=db.attempts.find(a=>a.studentId==='260810021'); await r.saveAnswer(a.id,a.studentId,'q1','A'); await r.saveAnswer(a.id,a.studentId,'q2','C'); await r.finishAttempt(a.id,a.studentId); }, id);
  await expect(pupil.locator('[data-student-exam-action=start]')).toBeVisible(); await pupil.locator('[data-student-exam-action=start]').click();
  await pupil.locator('[data-answer-question=q1][value=B]').check(); await finish(pupil);
  await expect(pupil.locator('#studentExamWorkspace')).toContainText('ফলাফল Manager-এর প্রকাশের অপেক্ষায়');
  const office = await manager(context); await releaseResults(office, pupil); await pupil.locator('[data-student-exam-action=results]').click();
  await expect(pupil.locator('#studentExamWorkspace')).toContainText('তোমার প্রচেষ্টা ২'); await expect(pupil.locator('[data-student-exam-action=start]')).toHaveCount(0);
  const mine = pupil.locator('.exam-results .exam-card').filter({has:pupil.getByRole('heading',{name:'রাইসা ইসলাম'})}); await expect(mine).toContainText('১ / ২');
});

test('offline reload resumes same shuffled answers, deadline locks and online reconnect syncs once', async ({ page, context }) => {
  await teacher(page); await seed(page); const pupil = await student(context); await pupil.evaluate(()=>navigator.serviceWorker.ready); await expect.poll(()=>pupil.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await pupil.locator('[data-student-exam-action=start]').click(); await pupil.locator('[data-answer-question=q1][value=A]').check();
  const order = await pupil.locator('[data-answer-question]').evaluateAll(items=>items.map(i=>`${i.dataset.answerQuestion}:${i.value}`));
  await context.setOffline(true); await pupil.reload(); await pupil.locator('#homeView [data-view=exams]').click(); await pupil.locator('[data-student-exam-action=resume]').click();
  expect(await pupil.locator('[data-answer-question]').evaluateAll(items=>items.map(i=>`${i.dataset.answerQuestion}:${i.value}`))).toEqual(order);
  await expect(pupil.locator('[data-answer-question=q1][value=A]')).toBeChecked(); await pupil.locator('[data-answer-question=q2][value=C]').check();
  await pupil.clock.setFixedTime(new Date(end.getTime()+1000));
  await expect.poll(()=>pupil.evaluate(key=>JSON.parse(localStorage.getItem(key)).attempts[0].status,KEY)).toBe('queued');
  await expect(pupil.locator('[data-answer-question]')).toHaveCount(0);
  await context.setOffline(false); await expect.poll(()=>pupil.evaluate(key=>JSON.parse(localStorage.getItem(key)).attempts[0].status,KEY)).toBe('submitted');
  const attempts = await pupil.evaluate(key=>JSON.parse(localStorage.getItem(key)).attempts,KEY); expect(attempts).toHaveLength(1); expect(attempts[0].score).toBe(2);
});

test('global deadline auto-submits but the answer PDF downloads only on one explicit request', async ({ page, context }) => {
  await teacher(page); await seed(page); const pupil = await student(context); await pupil.locator('[data-student-exam-action=start]').click(); await pupil.locator('[data-answer-question=q1][value=A]').check();
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
    await teacher(page); await createUI(page,type); const office=await manager(context); const root=office.locator('#managerExamWorkspace'); await root.locator('[data-exam-action=detail]').click(); await root.locator('[value=publish]').click();
    const pupil=await student(context); await expect(pupil.locator('[data-student-exam-action=start]')).toHaveCount(0);
    const promise=pupil.waitForEvent('download'); await pupil.locator('[data-student-exam-action=paper]').click(); expect((await promise).suggestedFilename()).toContain('questions');
    await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z')); const teacherRoot=page.locator('#teacherExamWorkspace'); await teacherRoot.locator('[data-exam-action=grade]').click();
    await teacherRoot.locator('[name=studentId]').selectOption('AP-1024'); await teacherRoot.locator('[name=q1]').fill('4'); await teacherRoot.locator('[name=q2]').fill('2'); await teacherRoot.locator('[value=marks]').click();
    await teacherRoot.locator('[name=studentId]').selectOption('260810021'); await teacherRoot.locator('[value=absent]').click();
    const resultOffice = await manager(context); await releaseResults(resultOffice, pupil);
    await pupil.locator('[data-student-exam-action=results]').click(); await expect(pupil.locator('.exam-results')).toContainText('৬ / ৮');
    await teacherRoot.locator('[data-exam-action=list]').click(); await teacherRoot.locator('[data-exam-action=report]').click(); await expect(teacherRoot).toContainText('অনুপস্থিত');
    const csvPromise=page.waitForEvent('download'); await teacherRoot.locator('[data-exam-action=csv]').click(); const csv=await fs.readFile(await (await csvPromise).path(),'utf8'); expect(csv).toContain('অনুপস্থিত'); expect(csv).toContain('রাইসা ইসলাম'); expect(csv).not.toContain('01700000000');
  });
}

test('Manager returns corrections, malformed paste and write failure preserve teacher form', async ({ page, context }) => {
  await teacher(page); await createUI(page); const office=await manager(context); const root=office.locator('#managerExamWorkspace'); await root.locator('[data-exam-action=detail]').click(); await root.locator('[name=note]').fill('নম্বর সংশোধন করুন'); await root.locator('[value=reject]').click();
  const teacherRoot=page.locator('#teacherExamWorkspace'); await expect(teacherRoot.locator('[data-managed-exam]')).toContainText('নম্বর সংশোধন করুন'); await teacherRoot.locator('[data-exam-action=edit]').click();
  await teacherRoot.locator('[name=template]').fill('ভুল টেমপ্লেট'); await expect(teacherRoot.locator('[data-parsed-preview]')).toContainText('টেমপ্লেট'); await teacherRoot.locator('[data-exam-form] [type=submit]').click(); await expect(teacherRoot.locator('[data-exam-error]')).toBeVisible();
  await teacherRoot.locator('[name=template]').fill(template); await page.evaluate(key=>{const set=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('Quota','QuotaExceededError');return set.call(this,k,v);};},KEY);
  await teacherRoot.locator('[data-exam-form] [type=submit]').click(); await expect(teacherRoot.locator('[name=template]')).toHaveValue(template); await expect(teacherRoot.locator('[data-exam-form] [type=submit]')).toBeEnabled();
});

for (const width of [320,390,844,1280]) {
  test(`exam questions and authoring are mobile, five fixed footer items (${width}px)`, async ({ page, context }) => {
    await page.setViewportSize({width,height:width===844?390:844}); await teacher(page); await page.locator('[data-exam-action=new-mcq]').click();
    await expect(page.locator('#teacherExamWorkspace [name=title]')).toHaveCSS('font-size','16px'); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('[data-exam-action=list]').click(); await seed(page); const pupil=await student(context); await pupil.setViewportSize({width,height:width===844?390:844}); await pupil.locator('[data-student-exam-action=start]').click();
    await expect(pupil.locator('.bottom-nav .bottom-link')).toHaveCount(5); await expect(pupil.locator('.bottom-nav')).toHaveCSS('position','fixed'); await expect(pupil.locator('#studentHeader')).toHaveCSS('position','fixed');
    const save=pupil.locator('[data-student-exam-action=confirm]'); await save.scrollIntoViewIfNeeded(); expect(await pupil.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true); expect((await save.boundingBox()).y+(await save.boundingBox()).height).toBeLessThanOrEqual((await pupil.locator('.bottom-nav').boundingBox()).y);
  });
}

test('copyable templates and long Bengali exam PDFs paginate without print dialogs', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read','clipboard-write']); await teacher(page); const root=page.locator('#teacherExamWorkspace'); await root.locator('[data-exam-action=new-mcq]').click(); await root.locator('[data-exam-action=copy-template]').click(); expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('উত্তর: A');
  await root.locator('[data-exam-action=list]').click();
  const longTemplate=Array.from({length:14},(_,i)=>template.split('\n---\n')[0].replace('বাংলাদেশের রাজধানী কোনটি?',`প্রশ্ন ${i+1}: বাংলাদেশের রাজধানী ও প্রশাসনিক বিভাগ সম্পর্কে তোমার জানা তথ্য অনুযায়ী সঠিক উত্তরটি নির্বাচন করো।`)).join('\n---\n');
  await seed(page,{template:longTemplate}); await root.locator('[data-exam-action=detail]').click();
  const promise=page.waitForEvent('download'); await root.locator('[data-exam-action=paper]').click(); const bytes=await fs.readFile(await (await promise).path()); const pdf=bytes.toString('latin1'); expect(Number(pdf.match(/\/Count (\d+)/)[1])).toBeGreaterThan(1); expect(bytes.length).toBeGreaterThan(100000);
});

test('failed answer writes are visible and never increment saved count; retry works', async ({ page, context }) => {
  await teacher(page); await seed(page); const pupil=await student(context); await pupil.locator('[data-student-exam-action=start]').click();
  await expect(pupil.locator('[data-answer-question=q1][value=A]')).toBeVisible();
  await pupil.evaluate(key=>{window.realExamSet=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('quota','QuotaExceededError');return window.realExamSet.call(this,k,v);};},KEY);
  await pupil.locator('[data-answer-question=q1][value=A]').click(); await expect(pupil.locator('#studentExamWorkspace [data-exam-error]')).toContainText('সংরক্ষণ/ডাউনলোড হয়নি');
  expect(await pupil.evaluate(key=>Object.keys(JSON.parse(localStorage.getItem(key)).attempts[0].answers).length,KEY)).toBe(0);
  await expect(pupil.locator('[data-answer-question=q1][value=A]')).not.toBeChecked();
  await pupil.evaluate(()=>{Storage.prototype.setItem=window.realExamSet;}); await pupil.locator('[data-answer-question=q1][value=A]').check(); await expect(pupil.locator('[data-answer-status]')).toContainText('1 / 2');
});
