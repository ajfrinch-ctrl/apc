/* The student Learning Hub (#coursesView): Class → Subject → Chapter → content,
   the section chips, and the two hard rules —
     • a student only ever sees their own class and only published content;
     • the exam and result sections read the existing Examination store, so a
       course never grows a second exam or result system. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { initCourseHub, COURSE_CHAPTER_ACTIONS } from '../js/course-hub.js';
import { COURSE_SECTIONS } from '../js/course-content.js';
import { classByName, subjectByName } from '../js/academics.js';
import { COURSE_CONTENT_KEY } from '../js/course-content.js';
import { KEYS } from '../js/database.js';
import { STORAGE_KEYS } from '../js/config.js';

const STUDENT = { id: 'S-HUB', name: 'Hub Student', className: 'দশম শ্রেণি', group: '' };
let ctx, hub;
const courseActions = [];

before(async () => {
  ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  ctx.window.localStorage.setItem(STORAGE_KEYS.account, JSON.stringify({ status: 'active', student: STUDENT }));
  ctx.window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
  /* Class and subject ids come from Academic Setup — never hard-coded here. */
  const classId = classByName('দশম শ্রেণি').id;
  const mathsId = subjectByName('গণিত').id;
  const banglaId = subjectByName('বাংলা').id;
  const records = [
    { id: 'CONTENT-0001', classId, subjectId: mathsId, chapterId: '', type: 'chapter', title: 'অধ্যায় ১ — বাস্তব সংখ্যা', description: 'বাস্তব সংখ্যার পরিচিতি', published: true, active: true, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'CONTENT-0002', classId, subjectId: mathsId, chapterId: '', type: 'lesson', title: 'পাঠ ১.১', content: 'পাঠের লেখা', published: true, active: true, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'CONTENT-0003', classId, subjectId: mathsId, chapterId: '', type: 'note', title: 'গোপন খসড়া নোট', content: 'এখনো প্রকাশ হয়নি', published: false, active: true, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'CONTENT-0004', classId, subjectId: banglaId, chapterId: '', type: 'lesson', title: 'বাংলা পাঠ', content: 'অন্য বিষয়', published: true, active: true, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'CONTENT-0005', classId: classByName('অষ্টম শ্রেণি').id, subjectId: mathsId, chapterId: '', type: 'lesson', title: 'অন্য ক্লাসের পাঠ', content: '', published: true, active: true, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'CONTENT-0006', classId, subjectId: mathsId, chapterId: 'CONTENT-0001', type: 'note', title: 'Class Note', content: 'শ্রেণির নোট', published: true, active: true, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'CONTENT-0007', classId, subjectId: mathsId, chapterId: 'CONTENT-0001', type: 'pdf', title: 'Teacher Material PDF', attachmentUrl: 'https://example.test/real-numbers.pdf', published: true, active: true, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'CONTENT-0008', classId, subjectId: mathsId, chapterId: 'CONTENT-0001', type: 'important_question', title: 'গুরুত্বপূর্ণ প্রশ্ন সেট', content: 'প্রশ্ন সেট', published: true, active: true, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'CONTENT-0009', classId, subjectId: mathsId, chapterId: 'CONTENT-0001', type: 'model_test', title: 'বাস্তব সংখ্যা মডেল টেস্ট PDF', attachmentUrl: 'https://example.test/model-test.pdf', published: true, active: true, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'CONTENT-0010', classId, subjectId: mathsId, chapterId: 'CONTENT-0001', group: 'অন্য ব্যাচ', type: 'note', title: 'অন্য ব্যাচের নোট', content: 'ভুল শিক্ষার্থীকে দেখানো যাবে না', published: true, active: true, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'CONTENT-0011', classId, subjectId: mathsId, chapterId: '', type: 'chapter', title: 'আর্কাইভ অধ্যায়', published: true, active: false, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'CONTENT-0012', classId, subjectId: mathsId, chapterId: 'CONTENT-0011', type: 'note', title: 'আর্কাইভ অধ্যায়ের পুরোনো নোট', published: true, active: true, createdAt: Date.now(), updatedAt: Date.now() }
  ];
  ctx.window.localStorage.setItem(COURSE_CONTENT_KEY, JSON.stringify({ version: 1, records }));
  const content = JSON.parse(ctx.window.localStorage.getItem(COURSE_CONTENT_KEY));
  /* The chapter row is pointed at its own id, exactly like the editor does. */
  content.records[1].chapterId = 'CONTENT-0001';
  content.records[2].chapterId = 'CONTENT-0001';
  ctx.window.localStorage.setItem(COURSE_CONTENT_KEY, JSON.stringify(content));
  const now = Date.now();
  ctx.window.localStorage.setItem(KEYS.questionBank, JSON.stringify({ version: 1, questions: [
    { id: 'Q-HUB-MCQ-PAST', className: STUDENT.className, subject: 'গণিত', chapterId: '', chapterName: 'বাস্তব সংখ্যা', type: 'mcq', text: '√৪ = কত?', options: [{ id: 'A', text: '২' }, { id: 'B', text: '৪' }, { id: 'C', text: '৬' }, { id: 'D', text: '৮' }], answer: 'A', marks: 1, active: true, source: { examId: 'EX-HUB-PAST' }, startAt: now - 7200000, endAt: now - 3600000 },
    { id: 'Q-HUB-MCQ-FUTURE', className: STUDENT.className, subject: 'গণিত', chapterId: '', chapterName: 'বাস্তব সংখ্যা', type: 'mcq', text: 'আসন্ন পরীক্ষার গোপন প্রশ্ন', options: [{ id: 'A', text: '১' }, { id: 'B', text: '২' }, { id: 'C', text: '৩' }, { id: 'D', text: '৪' }], answer: 'A', marks: 1, active: true, source: { examId: 'EX-HUB-FUTURE' }, startAt: now + 7200000, endAt: now + 10800000 },
    { id: 'Q-HUB-SHORT', className: STUDENT.className, subject: 'গণিত', chapterId: '', chapterName: 'বাস্তব সংখ্যা', type: 'short_answer', text: 'মূলদ সংখ্যা কী?', answerText: 'যে সংখ্যাকে p/q আকারে লেখা যায়।', marks: 2, active: true },
    { id: 'Q-HUB-WRITTEN', className: STUDENT.className, subject: 'গণিত', chapterId: '', chapterName: 'বাস্তব সংখ্যা', type: 'written', text: 'বাস্তব সংখ্যার শ্রেণিবিভাগ ব্যাখ্যা করো।', answerText: 'বাস্তব সংখ্যাকে মূলদ ও অমূলদ সংখ্যায় ভাগ করা যায়।', marks: 5, active: true },
    { id: 'Q-HUB-IMPORTANT', className: STUDENT.className, subject: 'গণিত', chapterId: '', chapterName: 'বাস্তব সংখ্যা', type: 'short_answer', text: 'অমূলদ সংখ্যার একটি উদাহরণ দাও।', answerText: '√২ একটি অমূলদ সংখ্যা।', marks: 2, tags: ['গুরুত্বপূর্ণ'], active: true },
    { id: 'Q-HUB-OTHER', className: STUDENT.className, subject: 'গণিত', chapterId: '', chapterName: 'বীজগণিত', type: 'short_answer', text: 'অন্য অধ্যায়ের প্রশ্ন', answerText: '', marks: 2, active: true }
  ] }));
  hub = initCourseHub({ getStudent: () => STUDENT, onAction: action => courseActions.push(action) });
  await ctx.waitFor(() => ctx.$$('#courseHub [data-course-subject]').length > 0);
  await hub.paint();
  await ctx.waitFor(() => ctx.$$('#courseHub [data-course-subject]').length > 0);
  /* The first subject of the class opens by default; the test works in গণিত. */
  const maths = ctx.$$('#courseHub [data-course-subject]').find(button => button.textContent.trim() === 'গণিত');
  assert.ok(maths, 'গণিত is offered as a subject chip');
  ctx.click(maths);
});

after(() => ctx?.window.close());

test('the hub opens on the student’s own class, subject and chapter', () => {
  const root = ctx.$('#courseHub');
  assert.ok(root, 'the hub has its mount inside the courses view');
  assert.match(root.textContent, /দশম শ্রেণি/, 'the class is shown');
  const subjects = ctx.$$('#courseHub [data-course-subject]').map(button => button.textContent.trim());
  for (const name of ['বাংলা', 'ইংরেজি', 'গণিত', 'আইসিটি', 'পদার্থবিজ্ঞান', 'রসায়ন']) assert.ok(subjects.includes(name), `${name} comes from Academic Setup`);
  assert.equal(new Set(subjects).size, subjects.length, 'a subject is never offered twice');
  assert.equal(ctx.$('#courseHub [data-course-subject="' + subjectByName('গণিত').id + '"]')?.getAttribute('aria-selected'), 'true', 'the chosen subject stays selected');
  assert.deepEqual(COURSE_SECTIONS.map(entry => entry.key), ['read', 'notes', 'important', 'suggestion', 'questions', 'mcq', 'previous', 'model-test', 'exam', 'results']);
  const sections = ctx.$$('#courseHub [data-course-section]').map(button => button.dataset.courseSection);
  assert.deepEqual(sections, COURSE_SECTIONS.map(entry => entry.key), 'every section has a chip');
});

test('only the student’s class and published content ever reach the DOM', () => {
  const root = ctx.$('#courseHub');
  assert.match(root.textContent, /Chapter 01 — বাস্তব সংখ্যা/, 'the chapter is presented as a numbered learning hub');
  assert.doesNotMatch(root.textContent, /গোপন খসড়া নোট/, 'an unpublished note stays hidden');
  assert.doesNotMatch(root.textContent, /অন্য ক্লাসের পাঠ/, 'another class never appears');
  assert.doesNotMatch(root.textContent, /অন্য ব্যাচের নোট/, 'content for another batch never appears');
  assert.doesNotMatch(root.textContent, /আর্কাইভ অধ্যায়ের পুরোনো নোট/, 'content of an archived chapter never appears loose in the course');
  ctx.click(ctx.$('#courseHub [data-course-chapter-toggle]'));
  assert.match(ctx.$('#courseHub').textContent, /পাঠ ১\.১/, 'opening a chapter lists its published content');
  assert.equal(ctx.$$('#courseHub .course-item-body').length >= 1, true);
});

test('a student can search inside the subject and switch sections', () => {
  ctx.type(ctx.$('#courseHub #courseSearch'), 'নেই এমন কিছু');
  return new Promise(resolve => setTimeout(() => {
    assert.match(ctx.$('#courseHub').textContent, /কিছু পাওয়া যায়নি/);
    ctx.type(ctx.$('#courseHub #courseSearch'), '');
    setTimeout(() => {
      ctx.click(ctx.$('#courseHub [data-course-section="notes"]'));
      assert.equal(ctx.$('#courseHub [data-course-section="notes"]').getAttribute('aria-selected'), 'true');
      assert.doesNotMatch(ctx.$('#courseHub').textContent, /পাঠ ১\.১/, 'the notes section is not the reading list');
      const bangla = ctx.$$('#courseHub [data-course-subject]').find(button => button.textContent.trim() === 'বাংলা');
      ctx.click(bangla);
      assert.match(ctx.$('#courseHub').textContent, /বাংলা পাঠ|এই বিষয়ে এখনো কিছু যোগ করা হয়নি/);
      ctx.click(ctx.$$('#courseHub [data-course-subject]').find(button => button.textContent.trim() === 'গণিত'));
      ctx.click(ctx.$('#courseHub [data-course-section="read"]'));
      resolve();
    }, 260);
  }, 260));
});

test('the exam and result sections reuse the existing examination data', async () => {
  const now = Date.now();
  ctx.window.localStorage.setItem(KEYS.exams, JSON.stringify({
    version: 1,
    exams: [{
      id: 'E-HUB', code: 'M2610MT01', title: 'হাব পরীক্ষা', subject: 'গণিত', className: 'দশম শ্রেণি', group: '', chapterName: 'বাস্তব সংখ্যা',
      type: 'mcq', status: 'completed', startAt: now - 7200000, endAt: now - 3600000, lateMinutes: 10,
      negative: 0, passPercent: 33, template: 'প্রশ্ন: ২+২?\nA: ৩\nB: ৪\nC: ৫\nD: ৬\nউত্তর: B',
      questions: [{ id: 'q1', uid: 'E-HUB-q1', examId: 'E-HUB', text: '২+২?', marks: 1, options: [{ id: 'A', text: '৩' }, { id: 'B', text: '৪' }, { id: 'C', text: '৫' }, { id: 'D', text: '৬' }], answer: 'B' }],
      teacherId: 'teacher.apc', teacherName: 'T', createdBy: 'T', createdByRole: 'teacher',
      participants: [{ id: STUDENT.id, name: STUDENT.name, className: STUDENT.className, group: '' }],
      resultsPublished: true, createdAt: now, updatedAt: now
    }],
    attempts: [{ id: 'A-HUB', examId: 'E-HUB', studentId: STUDENT.id, name: STUDENT.name, className: STUDENT.className, number: 1, status: 'submitted', startedAt: now - 7200000, finishedAt: now - 6300000, score: 1, correct: 1, wrong: 0, unanswered: 0, order: [{ id: 'q1', options: ['A', 'B', 'C', 'D'] }], answers: { q1: 'B' } }]
  }));
  await hub.paint();
  ctx.click(ctx.$('#courseHub [data-course-section="exam"]'));
  assert.match(ctx.$('#courseHub').textContent, /হাব পরীক্ষা/, 'a published exam of this class is listed');
  ctx.click(ctx.$('#courseHub [data-course-section="results"]'));
  const results = ctx.$('#courseHub').textContent;
  assert.match(results, /হাব পরীক্ষা/);
  assert.match(results, /১/, 'the student’s own score is shown');
  /* Nothing hidden: a draft exam of the same class never shows up. */
  const stored = JSON.parse(ctx.window.localStorage.getItem(KEYS.exams));
  stored.exams.push({ ...stored.exams[0], id: 'E-DRAFT', title: 'খসড়া পরীক্ষা', status: 'draft' });
  ctx.window.localStorage.setItem(KEYS.exams, JSON.stringify(stored));
  await hub.paint();
  ctx.click(ctx.$('#courseHub [data-course-section="exam"]'));
  assert.doesNotMatch(ctx.$('#courseHub').textContent, /খসড়া পরীক্ষা/);
});

test('each chapter exposes the nine focused actions and published chapter content', async () => {
  ctx.click(ctx.$('#courseHub [data-course-section="read"]'));
  ctx.click(ctx.$('#courseHub [data-course-chapter-toggle]'));
  assert.match(ctx.$('#courseHub').textContent, /Chapter 01 — বাস্তব সংখ্যা/);
  const buttons = ctx.$$('#courseHub [data-course-chapter-action]');
  assert.deepEqual(buttons.map(button => button.dataset.courseChapterAction), COURSE_CHAPTER_ACTIONS.map(item => item.key));
  assert.deepEqual(buttons.map(button => button.textContent.trim()), COURSE_CHAPTER_ACTIONS.map(item => item.label));

  ctx.click(ctx.$('#courseHub [data-course-chapter-action="read"]'));
  assert.match(ctx.$('#courseHub').textContent, /পাঠের লেখা/);
  ctx.click(ctx.$('#courseHub [data-course-action-close]'));
  ctx.click(ctx.$('#courseHub [data-course-chapter-action="notes"]'));
  assert.match(ctx.$('#courseHub').textContent, /Class Note/);
  assert.doesNotMatch(ctx.$('#courseHub').textContent, /গোপন খসড়া নোট/);
  ctx.click(ctx.$('#courseHub [data-course-action-close]'));
  ctx.click(ctx.$('#courseHub [data-course-chapter-action="materials"]'));
  assert.match(ctx.$('#courseHub').textContent, /Teacher Material PDF/);
  assert.equal(ctx.$('#courseHub a[href="https://example.test/real-numbers.pdf"]')?.getAttribute('target'), '_blank');
  ctx.click(ctx.$('#courseHub [data-course-action-close]'));
  ctx.click(ctx.$('#courseHub [data-course-chapter-action="important"]'));
  await ctx.waitFor(() => /অমূলদ সংখ্যার একটি উদাহরণ/.test(ctx.$('#courseHub').textContent));
  assert.match(ctx.$('#courseHub').textContent, /গুরুত্বপূর্ণ প্রশ্ন সেট/);
  assert.match(ctx.$('#courseHub').textContent, /অমূলদ সংখ্যার একটি উদাহরণ/);

  ctx.click(ctx.$('#courseHub [data-course-action-close]'));
  ctx.click(ctx.$('#courseHub [data-course-chapter-action="mcq"]'));
  assert.match(ctx.$('#courseHub').textContent, /২টি অনুশীলনযোগ্য MCQ/, 'the past exam and teacher-bank MCQs are both available after the exam ends');
  assert.doesNotMatch(ctx.$('#courseHub').textContent, /আসন্ন পরীক্ষার গোপন প্রশ্ন/);
  ctx.click(ctx.$('#courseHub [data-course-practice-mcq]'));
  assert.equal(courseActions.at(-1).kind, 'chapter-mcq-practice');
  assert.equal(courseActions.at(-1).chapterName, 'অধ্যায় ১ — বাস্তব সংখ্যা');

  ctx.click(ctx.$('#courseHub [data-course-action-close]'));
  ctx.click(ctx.$('#courseHub [data-course-chapter-action="short"]'));
  assert.match(ctx.$('#courseHub').textContent, /মূলদ সংখ্যা কী/);
  assert.ok(ctx.$('#courseHub details.course-model-answer'), 'short-answer practice can reveal the model answer');
  ctx.click(ctx.$('#courseHub [data-course-action-close]'));
  ctx.click(ctx.$('#courseHub [data-course-chapter-action="written"]'));
  assert.match(ctx.$('#courseHub').textContent, /বাস্তব সংখ্যার শ্রেণিবিভাগ/);
  const answer = ctx.$('#courseHub [data-course-answer="Q-HUB-WRITTEN"]');
  answer.value = 'আমার লিখিত অনুশীলনের খসড়া';
  ctx.click(ctx.$('#courseHub [data-course-save-drafts]'));
  assert.match(ctx.$('#courseHub [data-course-draft-status]').textContent, /সংরক্ষিত হয়েছে/);
  ctx.click(ctx.$('#courseHub [data-course-action-close]'));
  ctx.click(ctx.$('#courseHub [data-course-chapter-action="written"]'));
  assert.equal(ctx.$('#courseHub [data-course-answer="Q-HUB-WRITTEN"]').value, 'আমার লিখিত অনুশীলনের খসড়া');

  ctx.click(ctx.$('#courseHub [data-course-action-close]'));
  ctx.click(ctx.$('#courseHub [data-course-chapter-action="model-test"]'));
  assert.match(ctx.$('#courseHub').textContent, /বাস্তব সংখ্যা মডেল টেস্ট PDF/);
});

test('chapter Model Test opens its exact exam and My Results combines chapter results', () => {
  ctx.window.localStorage.setItem('activePlus.mcqPractice.v1', JSON.stringify({
    [STUDENT.id]: { active: null, sessions: [{
      id: 'P-HUB-CHAPTER', at: Date.now() - 1000, kind: 'chapter', title: 'বাস্তব সংখ্যা — MCQ Practice',
      className: STUDENT.className, subject: 'গণিত', chapterId: 'CONTENT-0001', chapterName: 'বাস্তব সংখ্যা',
      score: 1, total: 1
    }] }
  }));
  ctx.click(ctx.$('#courseHub [data-course-section="read"]'));
  ctx.click(ctx.$('#courseHub [data-course-chapter-toggle]'));
  ctx.click(ctx.$('#courseHub [data-course-chapter-action="model-test"]'));
  assert.ok(ctx.$('#courseHub [data-course-launch-exam="E-HUB"]'), 'the published exam belonging to the chapter is offered');
  ctx.click(ctx.$('#courseHub [data-course-launch-exam="E-HUB"]'));
  assert.equal(courseActions.at(-1).kind, 'chapter-model-test');
  assert.equal(courseActions.at(-1).examId, 'E-HUB', 'the route carries the exact exam id');

  ctx.click(ctx.$('#courseHub [data-course-action-close]'));
  ctx.click(ctx.$('#courseHub [data-course-chapter-action="results"]'));
  const results = ctx.$('#courseHub').textContent;
  assert.match(results, /হাব পরীক্ষা/);
  assert.match(results, /আনুষ্ঠানিক ফলাফল/);
  assert.match(results, /বাস্তব সংখ্যা — MCQ Practice/);
});
