/* §38 end-to-end workflows on the real app pages (docs/APP-ARCHITECTURE.md §6).

   Each test plays the roles the way the school does:
     1. the staff member writes through the REAL repository of their panel
        (a provisioned, device-bound session, so the permission gate is real);
     2. the student phone opens with only that data and must show the result —
        through the real page modules of the new architecture.

   Covered here: 1 Teacher→Homework→Student · 2 Teacher→Suggestion→Student
   · 3 Question Bank→Student · 4 Exam→Student · 5 Student→Exam→Result
   · 7 Cash Counter→Payment→Student Fee · 8 Teacher→Notice→Student Notification
   · 9 Manager→Routine→Student Routine. Workflow 6 (Manager approves a
   self-registered student, who then signs in) is covered end to end by
   registration-approval-login.test.mjs: the real registration form on one
   device, the real approval on another, then the student's first login. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import { loadPage } from './jsdom-harness.mjs';
import { hashPassword } from '../js/password-hash.js';
import { STORAGE_KEYS } from '../js/config.js';
import { ROSTER_KEY, saveRoutine, blankRoutine } from '../js/office-data.js';
import { TEACHING_KEY } from '../js/teaching-data.js';
import { EXAM_KEY } from '../js/exam-data.js';
import { QUESTION_BANK_KEY } from '../js/question-bank.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { TRANSACTIONS_KEY } from '../js/finance-data.js';
import { openStaffPanel, provisionStaff, seedStaffSession, STAFF_TEST_PASSWORD } from './staff-harness.mjs';

const CLASS = 'দশম শ্রেণি';
const STUDENT = Object.freeze({
  id: 'AP-WF-1001', name: 'ওয়ার্কফ্লো শিক্ষার্থী', className: CLASS, group: 'বিজ্ঞান বিভাগ',
  studentMobile: '01711000111', guardianMobile: '01722000222', monthlyFee: 800
});
const USERNAME = 'workflow.student';
const PASSWORD = 'Wf-2026-pass';
const ASSIGNMENT = {
  id: 'TAS-WF', teacherUsername: 'teacher.apc', teacherName: 'Test Teacher',
  className: CLASS, group: '', subject: 'গণিত'
};

/* The harness publishes one page's globals at a time (a new loadPage swaps
   `document`), so two live windows would make the older page's watchdogs read
   the newer page's DOM. Every helper therefore closes the previous page — with
   a short drain so in-flight work finishes before the window goes away. */
const OPEN_PAGES = [];
async function closePages() {
  const pages = OPEN_PAGES.splice(0);
  if (!pages.length) return;
  /* Let the page's queued work (storage reads, crypto, watcher ticks) finish
     while its own globals are still published, then close it. Without the
     drain a promise continuation would run after the next page swapped
     `document` and hit a node that page does not have. */
  await new Promise(resolve => setTimeout(resolve, 400));
  await Promise.resolve();
  for (const ctx of pages) { try { ctx.window.close(); } catch { /* already gone */ } }
}
const keepOpen = ctx => { OPEN_PAGES.push(ctx); return ctx; };
after(closePages);

const dump = ctx => Object.fromEntries(Array.from({ length: ctx.window.localStorage.length },
  (_, index) => { const key = ctx.window.localStorage.key(index); return [key, ctx.window.localStorage.getItem(key)]; }));

/* Staff sessions must never travel to the student phone: a staff session on the
   device makes the student app hand over to that panel. Only the role-specific
   account/session keys are removed — every data key (notices, routine, exams,
   question bank, payments) is exactly what the student must receive. */
const withoutStaffSessions = storage => Object.fromEntries(Object.entries(storage)
  .filter(([key]) => !/^activePlus\.(admin|manager|teacher|payment)(Account|Session)\.v1$/.test(key)));

async function openStaff(page, role, base = {}) {
  await closePages();
  const ctx = keepOpen(await loadPage(page, {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      ...base,
      [ROSTER_KEY]: JSON.stringify([{ ...STUDENT, status: 'approved' }]),
      [TEACHER_ASSIGNMENTS_KEY]: JSON.stringify([ASSIGNMENT])
    }
  }));
  await provisionStaff(role, STAFF_TEST_PASSWORD);
  seedStaffSession(ctx.window, role);
  return ctx;
}

/* The Admin academic structure is device data too: one class, two subjects and
   a chapter. It is written once on the Admin panel and then copied device to
   device exactly like a real staff hand-over. */
async function seedAcademics() {
  await closePages();
  const ctx = await loadPage('admin.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  await provisionStaff('admin', STAFF_TEST_PASSWORD);
  seedStaffSession(ctx.window, 'admin');
  const academics = await import('../js/academics.js');
  /* The shipped setup already carries the usual classes and subjects, so the
     seeding is idempotent: create what is missing, then enable the mapping. */
  if (!academics.classByName(CLASS)) await academics.saveClass({ name: CLASS });
  for (const subject of ['গণিত', 'রসায়ন']) {
    if (!academics.subjectByName(subject)) await academics.saveSubject({ name: subject });
    await academics.setClassSubjectByName(CLASS, subject);
  }
  if (!academics.chapterByName(CLASS, 'গণিত', 'অধ্যায় ১')) {
    await academics.saveChapter({ className: CLASS, subjectName: 'গণিত', name: 'অধ্যায় ১' });
  }
  return withoutStaffSessions(dump(keepOpen(ctx)));
}

async function openStudent(storage, { student = STUDENT, username = USERNAME } = {}) {
  const seed = withoutStaffSessions(storage);
  seed['activePlus.demo.autofill.v1'] = 'off';
  seed[STORAGE_KEYS.account] = JSON.stringify({
    username, mobile: student.studentMobile, registrationMobile: student.studentMobile,
    pinHash: await hashPassword(PASSWORD), status: 'active', student
  });
  /* The page boots its own entry module (js/app-entry.js → js/main.js). No
     second module graph is created here: a duplicate import would give the
     session/encryption modules two instances and the student gate would fail
     exactly like a corrupted install. */
  await closePages();
  const ctx = keepOpen(await loadPage('index.html', { seed }));
  /* jsdom does not run the page's own <script src>, so the app's entry module
     is imported here — with a per-test cache-buster so no test reuses another
     test's module state. */
  /* jsdom never runs the page's own <script src>, so the entry module is imported
     here — one graph per test (a fixed query would reuse the previous test's
     module state, a second graph would break the encrypted session). */
  await import(`../js/main.js?workflow=${Math.random()}`);
  /* The student signs in on the shared card, exactly like a real phone: the
     device-bound session is written by the app, never by the test. */
  ctx.type(ctx.$('#loginMobile'), username);
  ctx.type(ctx.$('#loginPin'), PASSWORD);
  ctx.submit(ctx.$('#loginForm'));
  await ctx.waitFor(() => ctx.$('#appShell').hidden === false, 20000);
  await ctx.flush(8);
  return ctx;
}

const select = async (ctx, element, value) => {
  element.value = value;
  element.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.flush(6);
};

/* A paper the way the school really gets one: Teacher drafts and submits,
   Manager approves, publishes and (when needed) reschedules the window. */
async function createPaper({ base, type = 'mcq', title, window: { startAt, endAt }, questions = [] }) {
  const teacher = await openStaff('teacher.html', 'teacher', base);
  const exams = await import('../js/exam-data.js');
  /* A paper is authored as the school authors it: one template text, parsed by
     the exam module itself (a caller-supplied question array is not the input
     shape the repository accepts). */
  const template = (questions.length ? questions : ['নমুনা প্রশ্ন'])
    .map((line, index) => (type === 'mcq'
      ? `প্রশ্ন: ${line}\nA: অপশন ক\nB: অপশন খ\nC: অপশন গ\nD: অপশন ঘ\nউত্তর: A`
      : `প্রশ্ন: ${line}\nনম্বর: ${type === 'short' ? 1 : 5}`))
    .join('\n---\n');
  const paper = exams.validateExam({
    type, title, subject: 'গণিত', className: CLASS, startAt, endAt, chapterName: 'অধ্যায় ১',
    lateMinutes: 1, negative: type === 'mcq' ? 0.25 : 0, passPercent: 33, template
  });
  assert.equal(paper.questions.length, questions.length || 1, 'the paper really carries the questions');
  const draft = await exams.examRepository.saveDraft({ ...paper });
  const created = draft.exams.find(exam => exam.title === title);
  assert.ok(created, 'the draft really landed in the exam store');
  await exams.examRepository.requestApproval(created.id);
  const submitted = dump(teacher);

  const manager = await openStaff('manager.html', 'manager', { ...base, ...submitted });
  const managerExams = await import('../js/exam-data.js');
  await managerExams.examRepository.approve(created.id);
  await managerExams.examRepository.publish(created.id);
  return { manager, exams: managerExams, id: created.id, startAt, endAt };
}

/* ---------------------------------------------- 1. Teacher → Homework → Student */
test('workflow 1 — the teacher publishes homework and the student receives it in পড়াশোনা → বাড়ির কাজ', async () => {
  const base = await seedAcademics();
  const teacher = await openStaff('teacher.html', 'teacher', base);
  const { teachingRepository } = await import('../js/teaching-data.js');
  await teachingRepository.saveActivity({
    type: 'homework', title: 'অনুশীলনী ৭ (ওয়ার্কফ্লো)', subject: 'গণিত', className: CLASS,
    group: '', status: 'published', details: 'অনুশীলনী ৭ সমাধান করো।'
  });
  const storage = dump(teacher);

  const student = await openStudent(storage);
  student.click(student.$('#studySections [data-study-section="homework"]'));
  await student.flush(6);
  assert.equal(student.$('[data-study-panel="homework"]').hidden, false, 'the homework section opens');
  const hasHomework = () => student.$$('#learningList .teaching-card')
    .some(node => node.textContent.includes('অনুশীলনী ৭ (ওয়ার্কফ্লো)'));
  await student.waitFor(hasHomework, 15000);
  const card = student.$$('#learningList .teaching-card')
    .find(node => node.textContent.includes('অনুশীলনী ৭ (ওয়ার্কফ্লো)'));
  assert.ok(card, 'the published homework reaches the student list');
  const complete = card.querySelector('[data-complete-homework]');
  assert.ok(complete, 'the “কাজ সম্পন্ন হয়েছে জানাও” signal is on the card');
  student.click(complete);
  await student.waitFor(async () => JSON.stringify(JSON.parse(student.window.localStorage.getItem(TEACHING_KEY) || '{}')).includes('"done"'), 8000);
  assert.match(card.textContent, /সম্পন্ন/, 'the card reports completion');
  const saved = JSON.parse(student.window.localStorage.getItem(TEACHING_KEY));
  const activity = saved.activities.find(item => item.title.includes('অনুশীলনী ৭'));
  assert.equal(Object.values(activity.progress)[0].value, 'done', 'the completion is stored for the teacher to review');
});

/* --------------------------------------------------- 2. Teacher → Suggestion */
test('workflow 2 — a published suggestion reaches সাজেশন and the subject filter narrows it', async () => {
  const base = await seedAcademics();
  const teacher = await openStaff('teacher.html', 'teacher', base);
  const { teachingRepository } = await import('../js/teaching-data.js');
  await teachingRepository.saveActivity({
    type: 'suggestion', title: 'সাজেশন: ত্রিকোণমিতি (ওয়ার্কফ্লো)', subject: 'গণিত', className: CLASS,
    status: 'published', details: 'গুরুত্বপূর্ণ সূত্রগুলো মুখস্থ করো।'
  });
  await teachingRepository.saveActivity({
    type: 'suggestion', title: 'সাজেশন: রসায়ন (ওয়ার্কফ্লো)', subject: 'রসায়ন', className: CLASS,
    status: 'published', details: 'দ্বিতীয় অধ্যায়ের প্রশ্ন।'
  });
  const storage = dump(teacher);

  const student = await openStudent(storage);
  student.click(student.$('#studySections [data-study-section="suggestion"]'));
  await student.flush(6);
  assert.equal(student.$('[data-study-panel="suggestion"]').hidden, false);
  await student.waitFor(() => student.$$('#learningList .teaching-card').length >= 2, 8000);
  assert.ok(student.$$('#learningList .teaching-card').some(node => node.textContent.includes('ত্রিকোণমিতি (ওয়ার্কফ্লো)')));
  assert.ok(student.$$('#learningList .teaching-card').some(node => node.textContent.includes('রসায়ন (ওয়ার্কফ্লো)')));

  const subject = student.$('#studySuggestionSubject');
  assert.ok([...subject.options].some(option => option.value === 'গণিত'), 'the subject filter lists the class subjects');
  await select(student, subject, 'গণিত');
  const titles = student.$$('#learningList .teaching-card').map(node => node.textContent).join(' ');
  assert.match(titles, /ত্রিকোণমিতি \(ওয়ার্কফ্লো\)/);
  assert.doesNotMatch(titles, /রসায়ন \(ওয়ার্কফ্লো\)/, 'the subject filter narrows the section');
});

/* ------------------------------------------- 3. Question Bank → Student */
test('workflow 3 — a completed exam fills প্রশ্নব্যাংক and the student filter switches by question type', async () => {
  const base = await seedAcademics();
  /* The shortest honest window an MCQ paper can carry: approval needs a future
     start and the late-entry rule needs lateMinutes ≤ the window. The paper
     ends by itself, and only then may its questions reach the student bank. */
  const soon = { startAt: Date.now() + 3000, endAt: Date.now() + 63000 };
  const { manager, endAt } = await createPaper({
    base, title: 'ব্যাংক ফিডার (ওয়ার্কফ্লো)',
    window: soon, questions: ['দুই যোগ দুই কত? (ওয়ার্কফ্লো)']
  });
  while (Date.now() < endAt + 500) await new Promise(resolve => setTimeout(resolve, 500));
  const bank = await import('../js/question-bank.js');
  await bank.ensureExamsInBank(JSON.parse(manager.window.localStorage.getItem(EXAM_KEY)).exams, 'Manager');
  const bankSnapshot = JSON.parse(manager.window.localStorage.getItem(QUESTION_BANK_KEY));
  assert.ok(bankSnapshot.questions.some(row => row.text.includes('(ওয়ার্কফ্লো)')),
    'the published paper feeds the shared question bank');
  const storage = dump(manager);
  assert.ok(JSON.parse(storage[QUESTION_BANK_KEY]).questions.length >= 1);

  const student = await openStudent(storage);
  student.click(student.$('#studySections [data-study-section="bank"]'));
  await student.waitFor(() => student.$$('#studyBankList .course-bank-question').length > 0, 10000);
  assert.ok(student.$$('#studyBankList .course-bank-question').some(node => node.textContent.includes('(ওয়ার্কফ্লো)')));
  student.click(student.$('#studyBankFilters [data-bank-filter="written"]'));
  await student.flush(6);
  assert.equal(student.$$('#studyBankList .course-bank-question').length, 0, 'the সৃজনশীল filter excludes MCQ rows');
  student.click(student.$('#studyBankFilters [data-bank-filter="mcq"]'));
  await student.flush(6);
  assert.ok(student.$$('#studyBankList .course-bank-question').length > 0, 'the MCQ filter brings them back');
  assert.equal(student.window.localStorage.getItem(QUESTION_BANK_KEY), storage[QUESTION_BANK_KEY], 'the student reader never writes the bank');
});

/* ------------------------------------------- 4 + 5. Exam → Student → Result */
test('workflow 4 + 5 — the student sits the published exam from পরীক্ষা and the published result appears in its outcome tab', async () => {
  const base = await seedAcademics();
  const { manager, exams, id } = await createPaper({
    base, title: 'ওয়ার্কফ্লো MCQ পরীক্ষা',
    window: { startAt: Date.now() + 30 * 60000, endAt: Date.now() + 90 * 60000 },
    questions: ['দুই যোগ দুই কত? (ওয়ার্কফ্লো)', 'তিন যোগ তিন কত? (ওয়ার্কফ্লো)']
  });
  /* A one-minute window: the late-entry rule needs lateMinutes ≤ the window,
     so the shortest valid live paper is ~1 minute. The student sits it right
     away; the Manager publishes once the window really closes. */
  const startAt = Date.now() - 1000;
  const endAt = Date.now() + 70000;
  await exams.examRepository.reschedule(id, { startAt, endAt });
  const liveStorage = dump(manager);

  const student = await openStudent(liveStorage);
  student.click(student.$('.bottom-link[data-view="exams"]'));
  await student.flush(6);
  const startSelector = `[data-student-exam="${id}"] [data-student-exam-action="start"]`;
  await student.waitFor(() => Boolean(student.$(startSelector)), 15000);
  const start = student.$(startSelector);
  assert.ok(start, 'the running paper sits in the চলমান tab of পরীক্ষা');
  student.click(start);
  await student.waitFor(() => Boolean(student.$('[data-answer-question]')), 10000);
  for (const input of student.$$('[data-answer-question]')) {
    if (input.checked) continue;
    input.checked = true;
    input.dispatchEvent(new student.window.Event('change', { bubbles: true }));
    await student.flush(4);
  }
  await student.waitFor(() => student.$('[data-student-exam-action="confirm"]') && !student.$('[data-student-exam-action="confirm"]').disabled, 10000);
  student.click(student.$('[data-student-exam-action="confirm"]'));
  student.click(student.$('[data-student-exam-action="finish"]'));
  await student.waitFor(() => JSON.parse(student.window.localStorage.getItem(EXAM_KEY)).attempts
    .some(attempt => attempt.examId === id && attempt.status === 'submitted'), 15000);
  const sitting = dump(student);
  await closePages();

  /* The paper is over; the Manager reads the same attempts and publishes. */
  const after = await openStaff('manager.html', 'manager', { ...base, ...sitting });
  const managerExams = await import('../js/exam-data.js');
  while (Date.now() < endAt + 500) await new Promise(resolve => setTimeout(resolve, 500));
  await managerExams.examRepository.publishResults(id);
  const published = dump(after);

  const back = await openStudent(published);
  back.click(back.$('.bottom-link[data-view="exams"]'));
  await back.flush(6);
  back.click(back.$('#examTabs [data-exam-tab="results"]'));
  await back.flush(8);
  const panel = back.$('[data-exam-panel="results"]');
  assert.equal(panel.hidden, false, 'the result panel is the one open');
  assert.equal(back.$('#examTabs [data-exam-tab="results"]').getAttribute('aria-pressed'), 'true');
  const overview = back.$('#studentResultOverview').textContent;
  assert.match(overview, /সারসংক্ষেপ/, 'the published result opens with the summary');
  assert.match(overview, /ওয়ার্কফ্লো MCQ পরীক্ষা/, 'the exam is listed by name');
  assert.match(overview, /Exam ID/, 'the Exam ID travels with the result');
  assert.match(overview, /গ্রেড/, 'the result carries a grade');
  assert.match(overview, /%/, 'the result carries a percentage');
  assert.match(overview, /\/\s*২/, 'the result carries score / total');
});

/* --------------------------------- 7. Cash Counter → Payment → Student Fee */
test('workflow 7 — a counter payment shows on the student ফি screen, which can never write', async () => {
  const base = await seedAcademics();
  const counter = await openStaff('payment.html', 'payment', base);
  const { financeRepository } = await import('../js/finance-data.js');
  await financeRepository.saveTransaction({
    id: 'TX-WF-1', studentId: STUDENT.id, studentName: STUDENT.name, className: CLASS,
    amount: 800, feeType: 'মাসিক বেতন', month: 'অক্টোবর ২০২৬', method: 'নগদ'
  }, { actor: { role: 'payment', id: 'DEMO-PAYMENT' } });
  const collected = JSON.parse(counter.window.localStorage.getItem(TRANSACTIONS_KEY));
  assert.ok(Array.isArray(collected) && collected.some(row => row.id === 'TX-WF-1'), 'the counter collection is stored');
  assert.equal(collected.find(row => row.id === 'TX-WF-1').status, 'pending', 'a counter entry waits for approval');

  /* The Manager approves the day's collection — the student sees it as paid. */
  const manager = await openStaff('manager.html', 'manager', { ...base, [TRANSACTIONS_KEY]: JSON.stringify(collected) });
  const { financeRepository: managerFinance } = await import('../js/finance-data.js');
  await managerFinance.reviewTransaction('TX-WF-1', 'approved', '');
  const approved = JSON.parse(manager.window.localStorage.getItem(TRANSACTIONS_KEY));
  assert.equal(approved.find(row => row.id === 'TX-WF-1').status, 'approved');
  const storage = dump(manager);

  const student = await openStudent(storage);
  student.click(student.$('#profileView [data-view="student-fee"]'));
  await student.flush(8);
  await student.waitFor(() => /পরিশোধের ইতিহাস|তথ্য এখনো|তথ্য নেই/.test(student.$('#studentFeeMount').textContent), 10000);
  const fee = student.$('#studentFeeMount').textContent;
  assert.match(fee, /৮০০|800/, 'the payment amount reaches the student');
  assert.equal(student.$$('#studentFeeMount input, #studentFeeMount textarea, #studentFeeMount select, #studentFeeMount form').length, 0);
  const before = student.window.localStorage.getItem(TRANSACTIONS_KEY);
  student.click(student.$('#studySections [data-study-section="courses"]'));
  await student.flush(4);
  assert.equal(student.window.localStorage.getItem(TRANSACTIONS_KEY), before, 'the reader never writes the ledger');
});

/* ------------------------------- 8. Teacher → Notice → Student Notification */
test('workflow 8 — a teacher notice reaches its own class only: board, Home preview and notification feed', async () => {
  const base = await seedAcademics();
  const teacher = await openStaff('teacher.html', 'teacher', base);
  /* The teacher writes it in the panel itself: একাডেমিক → নোটিশ → নতুন নোটিশ,
     with the class picked from the panel's own assignment list. */
  await openStaffPanel(teacher, 'teacher', {
    provision: false,
    importPanel: () => import('../js/teacher.js'),
    shellId: 'teacherShell',
    ready: () => teacher.$$('#teacherHomeClass option').length > 1
  });
  teacher.click(teacher.$('.admin-bottom [data-teacher-view="academic"]'));
  await teacher.flush(6);
  assert.equal(teacher.$('#teacherAcademic').hidden, false, 'একাডেমিক is the hub seat');
  teacher.click(teacher.$('#teacherAcademic [data-teacher-view="notice"]'));
  await teacher.flush(8);
  assert.equal(teacher.$('#teacherNotice').hidden, false, 'the hub opens the notice screen');
  teacher.click(teacher.$('#teacherNewNotice'));
  await teacher.flush(6);
  teacher.type(teacher.$('#notice-title'), 'আগামীকাল ক্লাস বন্ধ (ওয়ার্কফ্লো)');
  teacher.type(teacher.$('#notice-body'), 'শুক্রবার প্রতিষ্ঠান বন্ধ থাকবে।');
  teacher.$('#notice-className').value = CLASS;
  teacher.submit(teacher.$('#teacherNoticeForm'));
  await teacher.waitFor(() => String(teacher.window.localStorage.getItem('activePlus.admin.notices.v1') || '').includes('আগামীকাল ক্লাস বন্ধ'), 10000);
  const storage = dump(teacher);
  const saved = JSON.parse(storage['activePlus.admin.notices.v1']).find(notice => notice.title.includes('আগামীকাল ক্লাস বন্ধ'));
  assert.equal(saved.className, CLASS, 'the teacher notice carries the class it was written for');
  assert.equal(saved.createdByRole, 'teacher');
  assert.equal(saved.status, 'published');
  /* নাম-না-লেখা আরও নোটিশ আগের মতোই সবার কাছে পৌঁছায় — পুরোনো ডেটা হারায় না। */
  assert.equal(saved.audience, 'সকল শিক্ষার্থী');

  const student = await openStudent(storage);
  assert.match(student.$('#homeNoticeList').textContent, /আগামীকাল ক্লাস বন্ধ \(ওয়ার্কফ্লো\)/, 'Home previews the newest notice');
  student.click(student.$('#homeNoticeList [data-notice-home-open]'));
  await student.flush(8);
  assert.equal(student.$('#notice-boardView').classList.contains('active'), true, 'the notice opens its own board');
  assert.match(student.$('#noticeBoardDetail').textContent, /আগামীকাল ক্লাস বন্ধ/);
  const feed = await import('../js/notification-rules.js');
  const plan = feed.planInAppAlerts({ feed: [feed.noticeItem(saved)], known: [] });
  assert.ok(plan.show.some(item => item.kind === 'notice'), 'the notice is a notification too, pointing at the board');

  /* Student isolation: the same device data on a নবম শ্রেণি phone must not
     show a notice written for দশম শ্রেণি. */
  const roster = JSON.parse(storage[ROSTER_KEY]);
  roster.push({ ...STUDENT, id: 'AP-WF-2001', name: 'নবম শ্রেণির শিক্ষার্থী', className: 'নবম শ্রেণি' });
  const ninth = await openStudent({ ...storage, [ROSTER_KEY]: JSON.stringify(roster) },
    { student: { ...STUDENT, id: 'AP-WF-2001', name: 'নবম শ্রেণির শিক্ষার্থী', className: 'নবম শ্রেণি' }, username: 'workflow.ninth' });
  assert.doesNotMatch(ninth.$('#homeNoticeList').textContent, /আগামীকাল ক্লাস বন্ধ/,
    'another class never receives this notice');
});

/* ------------------------------------------------- 9. Manager → Routine → Student */
test('workflow 9 — the Manager-authored routine appears in the student রুটিন view with subject, teacher and room', async () => {
  const base = await seedAcademics();
  const manager = await openStaff('manager.html', 'manager', base);
  const routine = blankRoutine();
  routine.sat = {
    date: '', classes: [{
      id: 'RC-WF-1', subject: 'গণিত', teacher: 'Test Teacher', time: '০৯:০০ - ১০:০০', period: 'প্রথম পিরিয়ড',
      room: 'রুম ১০১', className: CLASS, group: ''
    }]
  };
  assert.equal(saveRoutine(routine), true, 'the Manager routine is stored');
  const storage = dump(manager);

  const student = await openStudent(storage);
  student.click(student.$('.bottom-link[data-view="routine"]'));
  await student.flush(8);
  student.click(student.$('.day-tab[data-day="sat"]'));
  await student.flush(6);
  const list = student.$('#routineList').textContent;
  assert.match(list, /গণিত/, 'the subject reaches the student routine');
  assert.match(list, /Test Teacher/, 'the teacher name reaches the student routine');
  assert.match(list, /রুম ১০১/, 'the room reaches the student routine');
  assert.equal(student.$('#routineList').hidden, false);
});

/* ------------------- 8b. Manager → Notice (class scope) → Student ------------ */
test('workflow 8b — a Manager-written notice carries its class scope and stays off other classes', async () => {
  const base = await seedAcademics();
  const manager = await openStaff('manager.html', 'manager', base);
  /* The Manager writes it where the architecture puts it: একাডেমিক → নোটিশ. */
  await openStaffPanel(manager, 'manager', {
    provision: false,
    importPanel: () => import('../js/manager.js'),
    shellId: 'managerShell'
  });
  manager.click(manager.$('.manager-bottom [data-manager-view="academic"]'));
  await manager.flush(6);
  assert.equal(manager.$('[data-view-panel="academic"]').hidden, false, 'একাডেমিক is the hub');
  manager.click(manager.$('#managerAcademicMenu [data-academic-section="notice"]'));
  await manager.waitFor(() => manager.$('[data-view-panel="notices"]')?.hidden === false, 8000);
  await manager.waitFor(() => manager.$$('#managerNoticeClass option').length > 1, 8000);
  manager.type(manager.$('#managerNoticeForm [name=title]'), 'মাসিক পরীক্ষার রুটিন (ওয়ার্কফ্লো)');
  manager.type(manager.$('#managerNoticeForm [name=body]'), 'দশম শ্রেণির পরীক্ষা শনিবার শুরু।');
  manager.$('#managerNoticeForm [name=className]').value = CLASS;
  manager.$('#managerNoticeForm [name=group]').value = '';
  manager.submit(manager.$('#managerNoticeForm'));
  await manager.waitFor(() => String(manager.window.localStorage.getItem('activePlus.admin.notices.v1') || '').includes('মাসিক পরীক্ষার রুটিন'), 10000);
  const storage = dump(manager);
  const saved = JSON.parse(storage['activePlus.admin.notices.v1']).find(notice => notice.title.includes('মাসিক পরীক্ষার রুটিন'));
  assert.equal(saved.className, CLASS, 'the Manager notice carries the class it was written for');
  assert.equal(saved.createdByRole, 'manager');
  assert.equal(saved.status, 'published');
  /* Both writers produce the SAME record shape; the student board has one reader. */
  assert.equal(saved.audience, 'সকল শিক্ষার্থী');
  assert.ok(saved.createdBy && saved.author, 'the notice keeps its author fields');

  const student = await openStudent(storage);
  assert.match(student.$('#homeNoticeList').textContent, /মাসিক পরীক্ষার রুটিন/);

  const roster = JSON.parse(storage[ROSTER_KEY]);
  roster.push({ ...STUDENT, id: 'AP-WF-3001', name: 'অন্য শ্রেণির শিক্ষার্থী', className: 'নবম শ্রেণি' });
  const other = await openStudent({ ...storage, [ROSTER_KEY]: JSON.stringify(roster) },
    { student: { ...STUDENT, id: 'AP-WF-3001', name: 'অন্য শ্রেণির শিক্ষার্থী', className: 'নবম শ্রেণি' }, username: 'workflow.other' });
  assert.doesNotMatch(other.$('#homeNoticeList').textContent, /মাসিক পরীক্ষার রুটিন/,
    'the scoped Manager notice stays off another class');
});
