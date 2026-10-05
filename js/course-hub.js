/* The student's learning hub (Courses).

   Class → Subject → Chapter → Content, with a chapter-level ecosystem:
   read, class notes, teacher materials, important questions, MCQ practice,
   short questions, written practice, model tests and personal results.

   The learning library, question bank, instant-practice history and Exam
   module remain the source of truth. This screen only composes their existing
   published records; it never creates a parallel course, question, exam or
   official-result store.
*/

import { classByName, listChapters as listAcademicChapters, subjectsForClass } from './academics.js';
import { KEYS, readRaw } from './database.js';
import { iconMarkup } from './icons.js';
import {
  COURSE_SECTIONS, COURSE_TYPES, listCourseContent, typeLabel, typeOf
} from './course-content.js';
import { examMatchesClass, examMatchesStudent, examRepository, isStudentVisibleExam, watchExams } from './exam-data.js';
import { listQuestionsForStudent, questionRowsFromPastExams } from './question-bank.js';

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bn = value => String(value).replace(/\d/g, digit => BN_DIGITS[Number(digit)]);
const normalized = value => String(value ?? '').normalize('NFC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const normalizedChapter = value => normalized(value)
  .replace(/^(?:(?:chapter|অধ্যায়|অধ্যায়)\s*)?(?:no\.?\s*)?[0-9০-৯]+(?:\.[0-9০-৯]+)*\s*[-–—:.)]\s*/i, '')
  .replace(/[‐‑–—:]/g, ' ').replace(/\s+/g, ' ').trim();
const PRACTICE_KEY = 'activePlus.mcqPractice.v1';
const DRAFT_KEY = 'activePlus.chapterPracticeDraft.v1';

export const COURSE_CHAPTER_ACTIONS = Object.freeze([
  { key: 'read', label: '📖 অধ্যায় পড়ুন' },
  { key: 'notes', label: '📝 Class Note' },
  { key: 'materials', label: '📎 Teacher Material' },
  { key: 'important', label: '⭐ Important Question' },
  { key: 'mcq', label: '❓ MCQ Practice' },
  { key: 'short', label: '✍️ Short Question' },
  { key: 'written', label: '📝 Written Practice' },
  { key: 'model-test', label: '🧪 Model Test' },
  { key: 'results', label: '📊 আমার ফলাফল' }
]);

function whenText(value) {
  const at = typeof value === 'number' ? value : Date.parse(value || '');
  if (!Number.isFinite(at) || at <= 0) return '';
  try { return new Date(at).toLocaleDateString('bn-BD', { dateStyle: 'medium' }); }
  catch { return new Date(at).toLocaleDateString(); }
}

/* ---- the existing Examination store ---------------------------------------- */
function matchesChapter(record, context) {
  if (!record || !context) return false;
  const ids = [context.chapterId, context.academicChapterId].filter(Boolean);
  if (record.chapterId && ids.includes(String(record.chapterId))) return true;
  const names = [context.chapterName, context.academicChapterName]
    .map(normalizedChapter).filter(Boolean);
  const name = normalizedChapter(record.chapterName || record.chapter || '');
  return Boolean(name && names.includes(name));
}

function examsFor(db, student, subjectName, context = null) {
  return db.exams
    .filter(exam => isStudentVisibleExam(exam) && examMatchesClass(exam, student.className))
    .filter(exam => !subjectName || !exam.subject || normalized(exam.subject) === normalized(subjectName))
    .filter(exam => !context || matchesChapter(exam, context))
    .sort((left, right) => (right.startAt || 0) - (left.startAt || 0));
}

function resultsFor(db, student, subjectName, context = null) {
  const own = new Map();
  for (const attempt of db.attempts || []) {
    if (attempt.studentId !== student.id || attempt.status !== 'submitted') continue;
    own.set(attempt.examId, attempt);
  }
  return db.exams
    .filter(exam => own.has(exam.id))
    .filter(exam => !subjectName || !exam.subject || normalized(exam.subject) === normalized(subjectName))
    .filter(exam => !context || matchesChapter(exam, context))
    .map(exam => ({ exam, attempt: own.get(exam.id) }))
    .sort((left, right) => (right.attempt.finishedAt || 0) - (left.attempt.finishedAt || 0));
}

function chapterPracticeResults(student, context) {
  try {
    const raw = readRaw(PRACTICE_KEY);
    const store = typeof raw === 'string' && raw ? JSON.parse(raw) : {};
    return (store?.[student.id]?.sessions || [])
      .filter(session => matchesChapter(session, context))
      .sort((left, right) => (right.at || 0) - (left.at || 0));
  } catch { return []; }
}

function practiceQuestionIsAvailable(row, now = Date.now()) {
  /* Standalone teacher-bank questions are practice material. A row copied
     from an official paper is not exposed until that paper's end time. */
  return !row.source?.examId || (row.endAt > 0 && row.endAt < now);
}

function chapterQuestions(student, context, { type = '', types = null } = {}, pastRows = [], bankRows = []) {
  return [...bankRows.filter(row => row.active), ...pastRows.filter(row => row.active)]
    .filter(row => row.active && (!type || row.type === type) && (!types || types.includes(row.type)))
    .filter(row => normalized(row.className) === normalized(student.className))
    .filter(row => normalized(row.subject) === normalized(context.subject))
    .filter(row => examMatchesStudent(row, student))
    .filter(row => matchesChapter(row, context))
    .filter(row => practiceQuestionIsAvailable(row));
}

function draftStorageKey(student, chapter, action) {
  return `${DRAFT_KEY}:${encodeURIComponent(student.id || 'student')}:${encodeURIComponent(chapter.id)}:${action}`;
}
function readDrafts(student, chapter, action) {
  try { return JSON.parse(window.localStorage.getItem(draftStorageKey(student, chapter, action)) || '{}') || {}; }
  catch { return {}; }
}

/* ---- mount ------------------------------------------------------------------- */

/**
 * @param {object} options { getStudent, onAction }
 * @returns {{ paint: Function }}
 */
export function initCourseHub({ getStudent, onAction = () => {} } = {}) {
  const root = document.querySelector('#courseHub');
  if (!root) return { paint: () => {} };
  let subjectId = '';
  let section = 'read';
  let search = '';
  let openChapter = '';
  let activeChapterAction = null;
  let examSnapshot = { exams: [], attempts: [] };
  let studentQuestionRows = [];
  let pastExamQuestionRows = [];
  let examSnapshotStudentId = '';
  let examSnapshotDirty = true;
  let examSnapshotRequest = 0;
  let examSnapshotError = '';

  const student = () => getStudent?.() || { id: '', name: '', className: '' };

  function subjects() {
    const current = student();
    return subjectsForClass(current.className).map(item => ({ id: item.id, name: item.name }));
  }

  function selectedSubject() {
    const list = subjects();
    if (!list.length) return null;
    return list.find(item => item.id === subjectId) || list[0];
  }

  function recordsFor(subject) {
    const current = student();
    const academic = classByName(current.className);
    if (!subject || !academic) return [];
    return listCourseContent({
      classId: academic.id, subjectId: subject.id, group: current.group || '', groupScoped: true,
      publishedOnly: true, search, includeInactive: false
    });
  }
  function currentChapters() {
    return recordsFor(selectedSubject()).filter(record => typeOf(record) === 'chapter');
  }

  function chapterContextFor(current, subject, chapter) {
    const academicChapter = subject
      ? listAcademicChapters(current.className, subject.name, { includeInactive: true })
        .find(item => normalizedChapter(item.name) === normalizedChapter(chapter.title))
      : null;
    return {
      className: current.className || '',
      subject: subject?.name || '',
      chapterId: chapter.id || '',
      academicChapterId: academicChapter?.id || '',
      chapterName: chapter.title || '',
      academicChapterName: academicChapter?.name || ''
    };
  }

  /* ---- cards ---------------------------------------------------------------- */

  function contentCard(record) {
    const type = typeOf(record);
    const link = /^https?:\/\//i.test(record.attachmentUrl || '') ? record.attachmentUrl : '';
    const body = esc(record.content || '').replace(/\n/g, '<br>');
    return '<article class="course-item" data-course-item="' + esc(record.id) + '">' +
        '<header class="course-item-head">' +
          '<span class="course-item-icon" aria-hidden="true">' + iconMarkup(COURSE_TYPES[type].icon) + '</span>' +
          '<div><small class="course-item-type">' + esc(typeLabel(record)) + '</small>' +
          '<h4>' + esc(record.title) + '</h4></div>' +
        '</header>' +
        (record.description ? '<p class="course-item-desc">' + esc(record.description) + '</p>' : '') +
        (body ? '<div class="course-item-body">' + body + '</div>' : '') +
        (link
          ? '<a class="course-item-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">' +
              (type === 'video' ? 'ভিডিও দেখুন' : type === 'pdf' ? 'PDF খুলুন' : 'সংযুক্তি খুলুন') +
              ' <svg class="resource-arrow" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg></a>'
          : '') +
        '<small class="course-item-when">' + esc(whenText(record.updatedAt || record.createdAt)) + '</small>' +
      '</article>';
  }

  function bankQuestionCard(row, index, { action = '', drafts = null } = {}) {
    const marks = Number.isFinite(Number(row.marks)) ? row.marks : 1;
    const question = '<p class="course-bank-question-text">' + esc(row.text) + '</p>';
    const answer = row.answerText
      ? '<details class="course-model-answer"><summary>নমুনা উত্তর দেখুন</summary><p>' + esc(row.answerText).replace(/\n/g, '<br>') + '</p></details>'
      : '<p class="course-bank-answer-note">এই প্রশ্নের নমুনা উত্তর এখনো যোগ করা হয়নি।</p>';
    if (action === 'short' || action === 'written') {
      const value = drafts?.[row.id] || '';
      const rows = action === 'written' ? 6 : 3;
      return '<article class="course-bank-question" data-course-bank-question="' + esc(row.id) + '">' +
          '<div class="course-bank-question-heading"><small>প্রশ্ন ' + bn(index + 1) + ' • ' + bn(marks) + ' নম্বর</small></div>' + question +
          '<label class="course-practice-answer-label">তোমার উত্তর' +
            '<textarea rows="' + rows + '" maxlength="8000" data-course-answer="' + esc(row.id) + '" placeholder="এখানে উত্তর লিখো">' + esc(value) + '</textarea></label>' +
          answer +
        '</article>';
    }
    return '<article class="course-bank-question" data-course-bank-question="' + esc(row.id) + '">' +
        '<div class="course-bank-question-heading"><small>' + (action === 'important' ? 'গুরুত্বপূর্ণ প্রশ্ন' : 'প্রশ্ন ' + bn(index + 1)) + ' • ' + bn(marks) + ' নম্বর</small></div>' +
        question + answer +
      '</article>';
  }

  function chapterExamCard(exam) {
    const when = exam.startAt ? new Date(exam.startAt) : null;
    const label = when && Number.isFinite(when.getTime())
      ? when.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' })
      : '';
    return '<article class="course-item course-item-exam">' +
        '<header class="course-item-head"><span class="course-item-icon" aria-hidden="true">' + iconMarkup('icon-exam') + '</span>' +
        '<div><small class="course-item-type">' + esc(exam.type === 'mcq' ? 'MCQ Model Test' : 'Model Test') + '</small>' +
        '<h4>' + esc(exam.title || exam.subject || 'মডেল টেস্ট') + '</h4></div></header>' +
        (label ? '<p class="course-item-desc">' + esc(label) + '</p>' : '') +
        '<button class="mini-btn primary" type="button" data-course-launch-exam="' + esc(exam.id) + '">পরীক্ষাটি খুলুন</button>' +
      '</article>';
  }

  function resultCard(exam, attempt) {
    return '<article class="course-item">' +
        '<header class="course-item-head"><span class="course-item-icon" aria-hidden="true">' + iconMarkup('icon-result') + '</span>' +
        '<div><small class="course-item-type">আনুষ্ঠানিক ফলাফল</small><h4>' + esc(exam.title || exam.subject || 'পরীক্ষা') + '</h4></div></header>' +
        '<p class="course-result-marks">প্রাপ্ত নম্বর: <strong>' + bn(attempt.score ?? 0) + '</strong> / ' + bn(attempt.total ?? '') + '</p>' +
      '</article>';
  }

  function actionPanel(action, chapter, items, current, subject, context) {
    const definition = COURSE_CHAPTER_ACTIONS.find(item => item.key === action);
    if (!definition) return '';
    const headingId = `courseChapterAction-${esc(chapter.id)}-${action}`;
    const shell = body => '<section class="course-chapter-action-panel" data-course-action-panel="' + action + '" aria-labelledby="' + headingId + '">' +
      '<div class="course-chapter-action-heading"><div><p class="eyebrow">' + esc(context.className) + ' • ' + esc(context.subject) + '</p>' +
        '<h3 id="' + headingId + '">' + esc(definition.label) + '</h3></div>' +
        '<button class="course-action-back" type="button" data-course-action-close>← চ্যাপ্টারে ফিরুন</button></div>' + body +
      '</section>';
    const empty = text => '<p class="admin-empty course-action-empty">' + esc(text) + '</p>';

    if (action === 'read') {
      const intro = [chapter.description, chapter.content].filter(Boolean)
        .map(value => '<p>' + esc(value).replace(/\n/g, '<br>') + '</p>').join('');
      const resources = items.filter(item => typeOf(item) !== 'chapter');
      const attachment = /^https?:\/\//i.test(chapter.attachmentUrl || '')
        ? '<a class="course-item-link" href="' + esc(chapter.attachmentUrl) + '" target="_blank" rel="noopener noreferrer">অধ্যায়ের সংযুক্তি খুলুন</a>' : '';
      return shell('<div class="course-reading-intro">' + (intro || '<p>এই অধ্যায়ের জন্য প্রকাশিত পাঠ ও উপকরণ নিচে দেওয়া আছে।</p>') + attachment + '</div>' +
        (resources.length ? '<div class="course-action-items">' + resources.map(contentCard).join('') + '</div>' : empty('এই অধ্যায়ে এখনো কোনো পাঠ প্রকাশিত হয়নি।')));
    }

    if (action === 'notes' || action === 'materials') {
      const records = action === 'notes'
        ? items.filter(item => typeOf(item) === 'note')
        : items.filter(item => ['video', 'pdf'].includes(typeOf(item)) || /^https?:\/\//i.test(item.attachmentUrl || ''));
      return shell(records.length
        ? '<div class="course-action-items">' + records.map(contentCard).join('') + '</div>'
        : empty(action === 'notes' ? 'এই অধ্যায়ের কোনো Class Note এখনো প্রকাশিত হয়নি।' : 'এই অধ্যায়ের কোনো Teacher Material এখনো প্রকাশিত হয়নি।'));
    }

    if (action === 'important') {
      const records = items.filter(item => typeOf(item) === 'important_question');
      const questions = chapterQuestions(current, context, {}, pastExamQuestionRows, studentQuestionRows).filter(row => row.tags.some(tag => /important|গুরুত্বপূর্ণ/i.test(tag)));
      return shell((records.length ? '<div class="course-action-items">' + records.map(contentCard).join('') + '</div>' : '') +
        (questions.length ? '<div class="course-question-list">' + questions.map((row, index) => bankQuestionCard(row, index, { action })).join('') + '</div>' : '') +
        (!records.length && !questions.length ? empty('এই অধ্যায়ের গুরুত্বপূর্ণ প্রশ্ন এখনো প্রকাশিত হয়নি।') : ''));
    }

    if (action === 'mcq') {
      const records = items.filter(item => typeOf(item) === 'mcq');
      const questions = chapterQuestions(current, context, { type: 'mcq' }, pastExamQuestionRows, studentQuestionRows);
      return shell((records.length ? '<div class="course-action-items">' + records.map(contentCard).join('') + '</div>' : '') +
        '<div class="course-mcq-start"><div><strong>অধ্যায়ভিত্তিক MCQ অনুশীলন</strong><p>' +
          (questions.length
            ? 'এই অধ্যায়ের ' + bn(questions.length) + 'টি অনুশীলনযোগ্য MCQ পাওয়া গেছে। প্রতিটি প্রশ্নে সময় থাকবে, শেষে সঠিক উত্তরসহ ফলাফল দেখাবে।'
            : 'এই অধ্যায়ের কোনো অনুশীলনযোগ্য MCQ এখনো নেই। শিক্ষক প্রশ্ন যোগ করলে এখানে দেখা যাবে।') +
        '</p></div><button class="mini-btn primary" type="button" data-course-practice-mcq' + (questions.length ? '' : ' disabled') + '>অনুশীলন শুরু করুন</button></div>' +
        (!records.length && !questions.length ? '' : ''));
    }

    if (action === 'short' || action === 'written') {
      const type = action === 'short' ? 'short_answer' : 'written';
      const questions = chapterQuestions(current, context, { type }, pastExamQuestionRows, studentQuestionRows);
      if (!questions.length) return shell(empty(action === 'short'
        ? 'এই অধ্যায়ের কোনো Short Question এখনো প্রকাশিত হয়নি।'
        : 'এই অধ্যায়ের কোনো Written Practice এখনো প্রকাশিত হয়নি।'));
      const drafts = readDrafts(current, chapter, action);
      return shell('<p class="course-practice-note">এখানে লেখা উত্তর এই ডিভাইসে সংরক্ষণ করা যায়। নমুনা উত্তর খুলে নিজে মিলিয়ে নাও; এটি আনুষ্ঠানিক জমা বা ফলাফল নয়।</p>' +
        '<div class="course-question-list">' + questions.map((row, index) => bankQuestionCard(row, index, { action, drafts })).join('') + '</div>' +
        '<div class="course-draft-actions"><button class="mini-btn primary" type="button" data-course-save-drafts>উত্তর সংরক্ষণ করুন</button><span data-course-draft-status role="status" aria-live="polite"></span></div>');
    }

    if (action === 'model-test') {
      const records = items.filter(item => typeOf(item) === 'model_test');
      const exams = examsFor(examSnapshot, current, subject?.name, context);
      return shell((records.length ? '<div class="course-action-items">' + records.map(contentCard).join('') + '</div>' : '') +
        (exams.length ? '<div class="course-action-items">' + exams.map(chapterExamCard).join('') + '</div>' : '') +
        (!records.length && !exams.length ? empty('এই অধ্যায়ের কোনো Model Test বা প্রকাশিত পরীক্ষা এখনো যোগ হয়নি।') : ''));
    }

    if (action === 'results') {
      const official = resultsFor(examSnapshot, current, subject?.name, context);
      const practice = chapterPracticeResults(current, context);
      const officialMarkup = official.length
        ? '<h4 class="course-result-group-title">আনুষ্ঠানিক পরীক্ষা</h4><div class="course-action-items">' + official.map(row => resultCard(row.exam, row.attempt)).join('') + '</div>'
        : '';
      const practiceMarkup = practice.length
        ? '<h4 class="course-result-group-title">MCQ অনুশীলনের ফলাফল</h4><div class="course-action-items">' + practice.map(session =>
            '<article class="course-item"><small class="course-item-type">' + esc(whenText(session.at) || 'অনুশীলন') + '</small>' +
            '<h4>' + esc(session.title || 'MCQ Practice') + '</h4><p class="course-result-marks">প্রাপ্ত নম্বর: <strong>' + bn(session.score ?? 0) + '</strong> / ' + bn(session.total ?? '') + '</p></article>'
          ).join('') + '</div>'
        : '';
      return shell(officialMarkup + practiceMarkup + (!official.length && !practice.length
        ? empty('এই অধ্যায়ের কোনো আনুষ্ঠানিক বা অনুশীলনের ফলাফল এখনো নেই।') : ''));
    }

    return shell(empty('এই অধ্যায়ের জন্য এখনো কোনো কনটেন্ট পাওয়া যায়নি।'));
  }

  function chapterBlock(chapter, items, visibleItems, index, current, subject) {
    const open = openChapter === chapter.id;
    const context = chapterContextFor(current, subject, chapter);
    const chapterNumber = String(index + 1).padStart(2, '0');
    const shortTitle = String(chapter.title || '').replace(/^(?:chapter|অধ্যায়|অধ্যায়)\s*[0-9০-৯]+\s*[-–—:.)]\s*/i, '').trim() || chapter.title;
    const selectedAction = activeChapterAction?.chapterId === chapter.id ? activeChapterAction.key : '';
    const actionButtons = '<div class="course-chapter-actions" role="group" aria-label="' + esc(chapter.title) + ' অধ্যায়ের শেখার কাজ">' +
      COURSE_CHAPTER_ACTIONS.map(item => '<button type="button" class="course-chapter-action' + (selectedAction === item.key ? ' is-active' : '') + '" data-course-chapter-action="' + item.key + '" data-chapter-id="' + esc(chapter.id) + '" aria-pressed="' + (selectedAction === item.key ? 'true' : 'false') + '">' + esc(item.label) + '</button>').join('') +
      '</div>';
    const intro = chapter.description && !selectedAction
      ? '<p class="course-chapter-note">' + esc(chapter.description) + '</p>' : '';
    const body = selectedAction
      ? actionPanel(selectedAction, chapter, items, current, subject, context)
      : (visibleItems.length
        ? '<div class="course-chapter-content">' + visibleItems.map(contentCard).join('') + '</div>'
        : '<p class="admin-empty course-chapter-content-empty">' + (section === 'read' ? 'এই চ্যাপ্টারে এখনো কিছু যোগ করা হয়নি।' : 'এই বিভাগে এই চ্যাপ্টারের কনটেন্ট নেই।') + '</p>');
    return '<section class="course-chapter' + (open ? ' is-open' : '') + '" data-course-chapter="' + esc(chapter.id) + '">' +
        '<button class="course-chapter-toggle" type="button" data-course-chapter-toggle="' + esc(chapter.id) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
          '<span class="course-chapter-copy"><strong>Chapter ' + chapterNumber + ' — ' + esc(shortTitle) + '</strong>' +
          '<small>' + bn(items.length) + 'টি কনটেন্ট • ৯টি শেখার কাজ</small></span>' +
          '<span class="course-chapter-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span>' +
        '</button>' +
        (open ? '<div class="course-chapter-body">' + actionButtons + intro + body + '</div>' : '') +
      '</section>';
  }

  function examSection(subject) {
    if (examSnapshotError) return '<p class="admin-empty">' + esc(examSnapshotError) + '</p>';
    const current = student();
    const exams = examsFor(examSnapshot, current, subject?.name);
    if (!exams.length) return '<p class="admin-empty">এই বিষয়ে এখন কোনো পরীক্ষা প্রকাশ হয়নি।</p>';
    return exams.map(exam => {
      const when = exam.startAt ? new Date(exam.startAt) : null;
      const label = when && Number.isFinite(when.getTime())
        ? when.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' })
        : '';
      return '<article class="course-item course-item-exam">' +
          '<header class="course-item-head"><span class="course-item-icon" aria-hidden="true">' + iconMarkup('icon-exam') + '</span>' +
          '<div><small class="course-item-type">পরীক্ষা</small><h4>' + esc(exam.title || exam.subject || 'পরীক্ষা') + '</h4></div></header>' +
          (label ? '<p class="course-item-desc">' + esc(label) + '</p>' : '') +
          '<button class="mini-btn primary" type="button" data-view="exams">পরীক্ষা দাও</button>' +
        '</article>';
    }).join('');
  }

  function resultSection(subject) {
    if (examSnapshotError) return '<p class="admin-empty">' + esc(examSnapshotError) + '</p>';
    const current = student();
    const rows = resultsFor(examSnapshot, current, subject?.name);
    if (!rows.length) return '<p class="admin-empty">এখনো কোনো ফলাফল প্রকাশ হয়নি।</p>';
    return rows.map(({ exam, attempt }) => resultCard(exam, attempt)).join('');
  }

  /* ---- paint ---------------------------------------------------------------- */

  function renderHub() {
    pastExamQuestionRows = questionRowsFromPastExams(examSnapshot.exams);
    const current = student();
    const list = subjects();
    const subject = selectedSubject();
    subjectId = subject?.id || '';
    const records = recordsFor(subject);
    const academic = classByName(current.className);
    const allChapters = records.filter(record => typeOf(record) === 'chapter')
      .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')) || String(left.id).localeCompare(String(right.id)));
    /* Search hits may live on a lesson/note rather than the chapter record;
       keep the parent chapter visible whenever one of its published children
       matches the student's query. */
    const chapters = search
      ? allChapters.filter(chapter => records.some(record => record.id === chapter.id || record.chapterId === chapter.id))
      : allChapters;
    const items = records.filter(record => typeOf(record) !== 'chapter');
    const byChapter = new Map(chapters.map(chapter => [chapter.id, []]));
    const loose = [];
    for (const item of items) {
      if (byChapter.has(item.chapterId)) byChapter.get(item.chapterId).push(item);
      else loose.push(item);
    }
    const inSection = records => (section === 'read'
      ? records
      : records.filter(record => COURSE_TYPES[typeOf(record)].section === section));
    const counts = new Map(COURSE_SECTIONS.map(entry => [entry.key, 0]));
    for (const record of [...chapters, ...items]) {
      const key = typeOf(record) === 'chapter' ? 'read' : COURSE_TYPES[typeOf(record)].section;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const body = () => {
      if (section === 'exam') return examSection(subject);
      if (section === 'results') return resultSection(subject);
      const visibleChapters = chapters;
      const blocks = visibleChapters.map((chapter, index) => chapterBlock(
        chapter, byChapter.get(chapter.id) || [], inSection(byChapter.get(chapter.id) || []), index, current, subject
      ));
      const looseItems = inSection(loose);
      const empty = !blocks.length && !looseItems.length;
      if (empty) {
        return '<div class="notice-empty course-empty"><span class="notice-empty-art" aria-hidden="true">' + iconMarkup('icon-book') + '</span>' +
            '<strong>' + (search ? 'কিছু পাওয়া যায়নি' : 'এই বিষয়ে এখনো কিছু যোগ করা হয়নি') + '</strong>' +
            '<p>' + (search ? 'অন্য শব্দ দিয়ে খুঁজে দেখুন।' : 'শিক্ষক কনটেন্ট যোগ করলে এখানে দেখা যাবে।') + '</p></div>';
      }
      return blocks.join('') + (looseItems.length ? '<div class="course-loose">' + looseItems.map(contentCard).join('') + '</div>' : '');
    };

    root.innerHTML =
      '<div class="course-head">' +
        '<div class="course-class"><small>শ্রেণি</small><strong>' + esc(current.className || 'শ্রেণি যোগ হয়নি') + '</strong></div>' +
        '<label class="course-search"><span class="course-search-icon" aria-hidden="true">' + iconMarkup('icon-search') + '</span>' +
          '<input type="search" id="courseSearch" placeholder="এই বিষয়ের ভেতরে খুঁজুন" value="' + esc(search) + '"></label>' +
      '</div>' +
      (list.length
        ? '<div class="course-subjects chip-row" role="tablist" aria-label="বিষয়">' + list.map(item =>
            '<button class="chip' + (item.id === subjectId ? ' active' : '') + '" type="button" role="tab" aria-selected="' + (item.id === subjectId ? 'true' : 'false') + '" data-course-subject="' + esc(item.id) + '">' + esc(item.name) + '</button>').join('') + '</div>'
        : '<p class="admin-empty">Admin এখনো এই শ্রেণির কোনো বিষয় চালু করেননি।</p>') +
      '<div class="course-section-filter"><p class="eyebrow">অধ্যায়ভিত্তিক শেখা</p>' +
        '<details class="course-section-details"><summary>সব কনটেন্ট বিভাগ</summary>' +
          '<div class="course-sections chip-row" role="tablist" aria-label="বিভাগ">' + COURSE_SECTIONS.map(entry =>
            '<button class="chip' + (entry.key === section ? ' active' : '') + '" type="button" role="tab" aria-selected="' + (entry.key === section ? 'true' : 'false') + '" data-course-section="' + entry.key + '">' +
              esc(entry.label) + (counts.get(entry.key) ? ' <span class="chip-count">' + bn(counts.get(entry.key)) + '</span>' : '') +
            '</button>').join('') + '</div></details></div>' +
      '<div class="course-list" id="courseList">' + body() + '</div>';
  }

  async function paint({ refreshExams = false } = {}) {
    const current = student();
    if (refreshExams || examSnapshotDirty || examSnapshotStudentId !== current.id) {
      const request = ++examSnapshotRequest;
      examSnapshotDirty = false;
      try {
        const [exams, questions] = await Promise.all([
          examRepository.listForStudent(current.id), listQuestionsForStudent(current.id)
        ]);
        if (request !== examSnapshotRequest) return;
        examSnapshot = exams;
        studentQuestionRows = questions;
        examSnapshotError = '';
      } catch (error) {
        if (request !== examSnapshotRequest) return;
        examSnapshot = { exams: [], attempts: [] };
        studentQuestionRows = [];
        examSnapshotError = error?.message || 'শিক্ষার্থী ডেটা পড়া যায়নি। আবার লগইন করুন।';
      }
      examSnapshotStudentId = current.id;
    }
    if (student().id !== current.id) { examSnapshotDirty = true; return paint({ refreshExams: true }); }
    renderHub();
  }

  root.addEventListener('click', event => {
    const subjectButton = event.target.closest('[data-course-subject]');
    if (subjectButton) {
      subjectId = subjectButton.dataset.courseSubject;
      openChapter = '';
      activeChapterAction = null;
      paint();
      return;
    }
    const tab = event.target.closest('[data-course-section]');
    if (tab) {
      section = tab.dataset.courseSection;
      openChapter = '';
      activeChapterAction = null;
      paint();
      return;
    }
    const actionButton = event.target.closest('[data-course-chapter-action]');
    if (actionButton) {
      const id = actionButton.dataset.chapterId;
      const key = actionButton.dataset.courseChapterAction;
      openChapter = id;
      activeChapterAction = activeChapterAction?.chapterId === id && activeChapterAction.key === key
        ? null : { chapterId: id, key };
      paint();
      return;
    }
    const closeAction = event.target.closest('[data-course-action-close]');
    if (closeAction) {
      activeChapterAction = null;
      paint();
      return;
    }
    const saveDrafts = event.target.closest('[data-course-save-drafts]');
    if (saveDrafts) {
      const panel = saveDrafts.closest('[data-course-action-panel]');
      const chapterNode = saveDrafts.closest('[data-course-chapter]');
      const chapter = chapterNode && currentChapters().find(item => item.id === chapterNode.dataset.courseChapter);
      if (!panel || !chapter) return;
      const action = panel.dataset.courseActionPanel;
      const values = Object.fromEntries([...panel.querySelectorAll('[data-course-answer]')]
        .map(input => [input.dataset.courseAnswer, input.value]));
      const status = panel.querySelector('[data-course-draft-status]');
      try {
        window.localStorage.setItem(draftStorageKey(student(), chapter, action), JSON.stringify(values));
        if (status) status.textContent = 'উত্তর এই ডিভাইসে সংরক্ষিত হয়েছে।';
      } catch {
        if (status) status.textContent = 'সংরক্ষণ হয়নি। ফোনের স্টোরেজ পরীক্ষা করে আবার চেষ্টা করো।';
      }
      return;
    }
    const practice = event.target.closest('[data-course-practice-mcq]');
    if (practice) {
      const chapterNode = practice.closest('[data-course-chapter]');
      const chapter = chapterNode && currentChapters().find(item => item.id === chapterNode.dataset.courseChapter);
      const subject = selectedSubject();
      if (chapter && subject) onAction({ kind: 'chapter-mcq-practice', ...chapterContextFor(student(), subject, chapter) });
      return;
    }
    const launch = event.target.closest('[data-course-launch-exam]');
    if (launch) {
      const chapterNode = launch.closest('[data-course-chapter]');
      const chapter = chapterNode && currentChapters().find(item => item.id === chapterNode.dataset.courseChapter);
      const subject = selectedSubject();
      if (chapter && subject) onAction({ kind: 'chapter-model-test', examId: launch.dataset.courseLaunchExam, ...chapterContextFor(student(), subject, chapter) });
      return;
    }
    const chapterToggle = event.target.closest('[data-course-chapter-toggle]');
    if (chapterToggle) {
      const id = chapterToggle.dataset.courseChapterToggle;
      openChapter = openChapter === id ? '' : id;
      activeChapterAction = null;
      paint();
    }
  });

  root.addEventListener('input', event => {
    if (event.target.id !== 'courseSearch') return;
    search = event.target.value.trim();
    clearTimeout(root.dataset.searchTimer);
    const timer = setTimeout(() => {
      paint();
      const box = root.querySelector('#courseSearch');
      if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    }, 220);
    root.dataset.searchTimer = timer;
  });
  window.addEventListener('apc-course-updated', () => void paint());
  window.addEventListener('apc-academics-updated', () => void paint());
  const refreshStudentRecords = () => { examSnapshotDirty = true; void paint({ refreshExams: true }); };
  window.addEventListener('question-bank-updated', refreshStudentRecords);
  watchExams(refreshStudentRecords);
  window.addEventListener('storage', event => {
    if (!event.key || event.key === KEYS.questionBank) refreshStudentRecords();
    else if (event.key === KEYS.courseContent) void paint();
  });

  void paint({ refreshExams: true });
  return { paint: () => paint({ refreshExams: true }) };
}
