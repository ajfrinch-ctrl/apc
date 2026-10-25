/* পড়াশোনা — the one screen with five sections (docs/APP-ARCHITECTURE.md §3):
     আমার কোর্স · বাড়ির কাজ · সাজেশন · প্রশ্নব্যাংক · উপকরণ

   Sections are a view over stores that already exist:
     • আমার কোর্স   → js/course-hub.js (Class → Subject → Chapter → Content)
     • বাড়ির কাজ   → js/student-teaching.js (teacher-published activities)
     • সাজেশন        → teaching activities + published suggestion/important content
     • প্রশ্নব্যাংক  → js/question-bank.js student reader
     • উপকরণ         → js/course-content.js published notes/PDF/previous questions
   Nothing is copied into a new store and no second exam/question workflow exists.
   The teaching board is a single DOM instance that is moved into the open
   section's slot, never duplicated. */
import { toBanglaNumber as bn } from './ui.js';
import { setView } from './shell.js';
import { classByName, subjectsForClass, listChapters } from './academics.js';
import { listCourseContent, typeOf as courseTypeOf } from './course-content.js';
import { sanitizeRichHtml, sanitizeLectureHtml } from './rich-sanitize.js';
import { teachingRepository, publishedForStudent, watchTeachingData } from './teaching-data.js';
import { courseRepository, courseProgress, watchCourses, COURSES_KEY } from './course-data.js';
import { listQuestionsForStudent, questionRowsFromPastExams, QUESTION_TYPES } from './question-bank.js';
import { examRepository as examRepo, examMatchesStudent, isStudentVisibleExam, watchExams, examResults, totalMarks, gradeFor } from './exam-data.js';
import { downloadExamPDF } from './exam-pdf.js';

const SELECTORS = {
  bar: '#studySections',
  bank: { subject: '#studyBankSubject', chapter: '#studyBankChapter', list: '#studyBankList', count: '#studyBankCount', error: '#studyBankError' },
  suggestion: { subject: '#studySuggestionSubject', chapter: '#studySuggestionChapter', list: '#studySuggestionList', count: '#studySuggestionCount', error: '#studySuggestionError' },
  materials: { subject: '#studyMaterialSubject', chapter: '#studyMaterialChapter', list: '#studyMaterialsList', count: '#studyMaterialsCount', error: '#studyMaterialsError' }
};
const SECTIONS = Object.freeze(['courses', 'homework', 'suggestion', 'bank', 'materials', 'model-test', 'practice', 'results', 'other']);
const SECTION_VIEWS = Object.freeze({
  courses: 'my-courses', homework: 'homework', suggestion: 'suggestion', bank: 'question-bank',
  materials: 'materials', 'model-test': 'model-test', practice: 'study-practice', results: 'study-results', other: 'study-other'
});
const VIEW_SECTIONS = Object.freeze(Object.fromEntries(Object.entries(SECTION_VIEWS).map(([section, view]) => [view, section])));
const OTHER_TYPES = Object.freeze(['previous_question', 'video', 'lesson']);
const BANK_TYPES = Object.freeze({ mcq: ['mcq'], short: ['short_answer', 'true_false'], written: ['written'] });
const SUGGESTION_TYPES = Object.freeze({
  important: record => courseTypeOf(record) === 'important_question',
  written: record => courseTypeOf(record) === 'suggestion',
  mcq: record => courseTypeOf(record) === 'mcq',
  pdf: record => courseTypeOf(record) === 'pdf' || record.isLectureSheet === true || /^https?:\/\//i.test(record.attachmentUrl || '')
});
const SUGGESTION_SECTIONS = Object.freeze(['suggestion', 'important']);
const MATERIAL_TYPES = Object.freeze({
  all: () => true,
  note: record => courseTypeOf(record) === 'note',
  pdf: record => courseTypeOf(record) === 'pdf' || record.isLectureSheet === true || (courseTypeOf(record) === 'lesson' && /^https?:\/\//i.test(record.attachmentUrl || '')),
  previous_question: record => courseTypeOf(record) === 'previous_question',
  model_test: record => courseTypeOf(record) === 'model_test'
});
const MATERIAL_SECTIONS = Object.freeze(['read', 'notes', 'previous', 'model-test']);

const $ = selector => document.querySelector(selector);
const text = value => String(value ?? '').trim();
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const norm = value => text(value).normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
const num = value => bn(value);
const chapterLabel = record => text(record.chapterName) || '';

// Summaries use percentages so papers with different total marks are comparable.
export function summarizeStudyResults(rows) {
  const ordered = [...rows].sort((a, b) => Number(b.exam.endAt || b.exam.startAt || 0) - Number(a.exam.endAt || a.exam.startAt || 0) || String(a.exam.id).localeCompare(String(b.exam.id)));
  return {
    count: ordered.length,
    average: ordered.length ? ordered.reduce((sum, item) => sum + item.percent, 0) / ordered.length : null,
    highest: ordered.length ? Math.max(...ordered.map(item => item.percent)) : null,
    recent: ordered.map((item, index) => {
      const time = Number(item.exam.endAt || item.exam.startAt || 0);
      const previous = ordered.slice(index + 1).find(other => other.exam.subject && other.exam.subject === item.exam.subject && Number(other.exam.endAt || other.exam.startAt || 0) < time);
      return { ...item, trend: previous ? Math.sign(item.percent - previous.percent) : null };
    })
  };
}

export function initStudentStudySections({ getStudent, teaching = null } = {}) {
  const bar = $(SELECTORS.bar);
  if (!bar) return () => {};
  let section = 'hub';
  let examDb = { exams: [], attempts: [] };
  let bankTypes = new Set();
  let bankSubject = '', bankChapter = '', bankRows = [], bankPapers = [], bankReady = false, bankError = '';
  let bankPdfBusy = false;
  let suggestionTypes = new Set();
  let suggestionSubject = '', suggestionChapter = '', suggestionRecords = [], suggestionReady = false, suggestionError = '';
  let materialType = 'all';
  let materialSubject = '', materialChapter = '', materialRecords = [], materialReady = false, materialError = '';
  let chapterTitles = new Map();
  let request = 0;

  const student = () => getStudent?.() || {};
  const academic = () => classByName(student().className);

  function subjects() {
    return subjectsForClass(student().className).map(item => ({ id: item.id, name: item.name }));
  }

  function subjectRecord(name) {
    return subjects().find(item => text(item.name) === text(name)) || null;
  }

  function recordsFor(subjectName = '') {
    const current = student();
    const cls = academic();
    if (!cls) return [];
    const subject = subjectName ? subjectRecord(subjectName) : null;
    const rows = listCourseContent({
      classId: cls.id, subjectId: subject?.id || '', group: current.group || '', groupScoped: true,
      publishedOnly: true, includeInactive: false
    });
    if (rows.some(record => courseTypeOf(record) === 'chapter')) {
      chapterTitles = new Map(rows.filter(record => courseTypeOf(record) === 'chapter').map(record => [record.id, record.title]));
    }
    return rows;
  }

  function chaptersFor(subjectName) {
    if (!subjectName) return [];
    return listChapters(student().className, subjectName, { includeInactive: false }) || [];
  }

  function fillSelect(select, options, current, allLabel) {
    if (!select) return;
    const keep = options.some(option => option.value === current) ? current : '';
    select.innerHTML = `<option value="">${esc(allLabel)}</option>`
      + options.map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('');
    select.value = keep;
    return keep;
  }

  function fillFilters() {
    const subjectOptions = subjects().map(item => ({ value: item.name, label: item.name }));
    bankSubject = fillSelect($(SELECTORS.bank.subject), subjectOptions, bankSubject, 'সব বিষয়') || '';
    suggestionSubject = fillSelect($(SELECTORS.suggestion.subject), subjectOptions, suggestionSubject, 'সব বিষয়') || '';
    materialSubject = fillSelect($(SELECTORS.materials.subject), subjectOptions, materialSubject, 'সব বিষয়') || '';
    const chapterOptions = subject => chaptersFor(subject).map(item => ({ value: item.name, label: item.name }));
    bankChapter = fillSelect($(SELECTORS.bank.chapter), chapterOptions(bankSubject), bankChapter, 'সব অধ্যায়') || '';
    suggestionChapter = fillSelect($(SELECTORS.suggestion.chapter), chapterOptions(suggestionSubject), suggestionChapter, 'সব অধ্যায়') || '';
    materialChapter = fillSelect($(SELECTORS.materials.chapter), chapterOptions(materialSubject), materialChapter, 'সব অধ্যায়') || '';
  }

  /* ---- cards --------------------------------------------------------------- */

  function chapterOf(record) {
    return text(record.chapterName) || chapterTitles.get(record.chapterId) || '';
  }

  function contentCard(record) {
    const isSheet = record.isLectureSheet === true;
    const link = /^https?:\/\//i.test(record.attachmentUrl || '') ? record.attachmentUrl : '';
    const body = record.richContent
      ? (isSheet ? sanitizeLectureHtml(record.richContent) : sanitizeRichHtml(record.richContent))
      : esc(text(record.content || record.description || '').slice(0, 600)).replace(/\n/g, '<br>');
    const sheetActions = isSheet
      ? `<div class="ls-student-sheet-actions">
          <button type="button" class="ls-card-btn" data-student-lecture-reader="${esc(record.id)}">📖 A4 প্রিভিউ ও প্রিন্ট</button>
          <button type="button" class="ls-card-btn ls-card-btn-primary" data-student-lecture-pdf="${esc(record.id)}">⬇ A4 PDF ডাউনলোড</button>
        </div>`
      : '';
    return `<article class="course-item${isSheet ? ' ls-student-sheet-card' : ''}" data-study-item="${esc(record.id)}">
      <header class="course-item-head"><span class="course-item-type">${esc(isSheet ? 'A4 লেকচার শিট' : record.type === 'pdf' ? 'PDF' : record.type === 'important_question' ? 'গুরুত্বপূর্ণ প্রশ্ন' : record.type === 'model_test' ? 'মডেল টেস্ট' : record.type === 'previous_question' ? 'পূর্বের প্রশ্ন' : record.type === 'mcq' ? 'MCQ' : 'নোট')}</span>
        <div><h3>${esc(record.title)}</h3><small>${esc([text(record.subject) || '', chapterOf(record), text(record.topic)].filter(Boolean).join(' • '))}</small></div></header>
      ${body ? `<div class="course-item-body course-rich-reading${isSheet ? ' ls-student-sheet-body' : ''}">${body}</div>` : ''}
      ${sheetActions}
      ${link ? `<a class="course-item-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">ফাইল খুলুন <svg class="resource-arrow" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg></a>` : ''}
    </article>`;
  }

  function questionCard(row, index) {
    const marks = Number.isFinite(Number(row.marks)) ? row.marks : 1;
    const typeLabel = QUESTION_TYPES[row.type] || 'প্রশ্ন';
    const options = Array.isArray(row.options) && row.options.length
      ? `<ul class="course-bank-options">${row.options.map((option, i) => `<li>${'ABCD'[i]}. ${esc(option.text || option)}</li>`).join('')}</ul>`
      : '';
    /* A bank question the student is allowed to see may carry its model answer;
       the exam section never reveals a paper that is still to be sat. */
    const answerSource = text(row.answerText) || (row.type === 'mcq' && Array.isArray(row.options)
      ? text(row.options.find(option => option.id === row.answer)?.text) : '');
    const answer = answerSource
      ? `<details class="course-model-answer"><summary>সঠিক উত্তর / নমুনা উত্তর দেখুন</summary><p>${esc(answerSource).replace(/\n/g, '<br>')}</p></details>`
      : '<p class="course-bank-answer-note">এই প্রশ্নের নমুনা উত্তর এখনও যোগ করা হয়নি।</p>';
    return `<article class="course-bank-question" data-study-question="${esc(row.id)}">
      <div class="course-bank-question-heading"><small>প্রশ্ন ${num(index + 1)} • ${esc(typeLabel)} • ${num(marks)} নম্বর</small></div>
      <p class="course-bank-question-text">${esc(row.text)}</p>
      <small class="course-item-when">${esc([text(row.subject), chapterOf(row)].filter(Boolean).join(' • '))}</small>
      ${options}${answer}
    </article>`;
  }

  /* ---- shelves ------------------------------------------------------------- */

  function paperCard(exam) {
    const when = exam.endAt ? new Date(exam.endAt).toLocaleDateString('bn-BD') : '';
    const solutions = exam.type === 'mcq'
      ? `<button type="button" class="primary" data-bank-pdf="solutions" data-id="${esc(exam.id)}">সঠিক উত্তরসহ PDF</button>`
      : '';
    return `<article class="exam-card course-item" data-bank-paper="${esc(exam.id)}">
      <header class="course-item-head"><span class="course-item-type">বিগত পরীক্ষা PDF</span>
        <div><h3>${esc(exam.title)}</h3><small>${esc([text(exam.subject), when].filter(Boolean).join(' • '))}</small></div></header>
      <div class="exam-actions">
        <button type="button" class="primary" data-bank-pdf="paper" data-id="${esc(exam.id)}">প্রশ্নপত্র PDF</button>
        ${solutions}
      </div>
    </article>`;
  }

  function renderBank() {
    const list = $(SELECTORS.bank.list);
    if (!list) return;
    const wanted = new Set([...bankTypes].flatMap(key => BANK_TYPES[key] || []));
    const chapterName = bankChapter;
    const rows = bankRows.filter(row => {
      if (wanted.size && !wanted.has(text(row.type))) return false;
      if (bankSubject && text(row.subject) !== bankSubject) return false;
      if (chapterName && !(norm(row.chapterName) === norm(chapterName) || row.chapterId === chapterName)) return false;
      return true;
    });
    const papers = bankPapers.filter(exam => {
      if (bankSubject && text(exam.subject) !== bankSubject) return false;
      if (wanted.size) {
        if (wanted.has('mcq') && exam.type === 'mcq') return true;
        if ((wanted.has('short') || wanted.has('written')) && exam.type !== 'mcq') return true;
        return false;
      }
      return true;
    });
    const body = papers.map(paperCard).join('') + rows.map(questionCard).join('');
    const markup = !bankReady
      ? '<p class="teacher-empty">প্রশ্নব্যাংক লোড হচ্ছে…</p>'
      : body
        ? body
        : `<p class="teacher-empty">${bankError || 'এই ফিল্টারে কোনো প্রশ্ন পাওয়া যায়নি।'}</p>`;
    list.innerHTML = markup;
    const examBank = document.getElementById('examBankList');
    if (examBank) examBank.innerHTML = markup;
    const count = $(SELECTORS.bank.count);
    if (count) count.textContent = `${num(rows.length)}টি প্রশ্ন • ${num(papers.length)}টি PDF • ${text(student().className) || 'শ্রেণি'}`;
  }

  function renderSuggestion() {
    const list = $(SELECTORS.suggestion.list);
    if (!list) return;
    const chapterName = suggestionChapter;
    const rows = suggestionRecords.filter(record => {
      if (suggestionTypes.size && ![...suggestionTypes].some(key => SUGGESTION_TYPES[key]?.(record))) return false;
      if (suggestionSubject && text(record.subject) !== suggestionSubject) return false;
      if (chapterName && !(norm(chapterOf(record)) === norm(chapterName) || record.chapterId === chapterName)) return false;
      return true;
    });
    list.innerHTML = !suggestionReady
      ? '<p class="teacher-empty">সাজেশন লোড হচ্ছে…</p>'
      : rows.length ? rows.map(contentCard).join('') : `<p class="teacher-empty">${suggestionError || 'এই ফিল্টারে কোনো সাজেশন পাওয়া যায়নি। শিক্ষক যোগ করলে এখানে দেখা যাবে।'}</p>`;
    const count = $(SELECTORS.suggestion.count);
    if (count) count.textContent = `${num(rows.length)}টি সাজেশন • ${text(student().className) || 'শ্রেণি'}`;
  }

  function renderMaterials() {
    const list = $(SELECTORS.materials.list);
    if (!list) return;
    const chapterName = materialChapter;
    const rows = materialRecords.filter(record => {
      if (!(MATERIAL_TYPES[materialType] || MATERIAL_TYPES.all)(record)) return false;
      if (materialSubject && text(record.subject) !== materialSubject) return false;
      if (chapterName && !(norm(chapterOf(record)) === norm(chapterName) || record.chapterId === chapterName)) return false;
      return true;
    });
    list.innerHTML = !materialReady
      ? '<p class="teacher-empty">উপকরণ লোড হচ্ছে…</p>'
      : rows.length ? rows.map(contentCard).join('') : `<p class="teacher-empty">${materialError || 'এই ফিল্টারে কোনো উপকরণ পাওয়া যায়নি।'}</p>`;
    const count = $(SELECTORS.materials.count);
    if (count) count.textContent = `${num(rows.length)}টি উপকরণ • ${text(student().className) || 'শ্রেণি'}`;
  }


  function renderStudentCourses() {
    const host = $('#studentCourseChaptersList');
    if (!host) return;
    const courses = courseRepository.readStudentCoursesSync(student());
    if (!courses.length) {
      host.innerHTML = '<p class="teacher-empty">আপনার শ্রেণি ও বিভাগের জন্য এখনো কোনো কোর্স প্রকাশিত হয়নি।</p>';
      return;
    }
    host.innerHTML = courses.map(course => {
      const prog = course.progress || courseProgress(course);
      return `<article class="teaching-card" data-student-course="${esc(course.id)}">
        <div class="teaching-card-head"><span class="teaching-kind">${esc(course.subject)}</span><span class="teaching-status published">সম্পন্ন ${num(prog.percent)}%</span></div>
        <h3>${esc(course.title || course.subject)}</h3>
        <small>${esc(course.className)} • ${esc(course.group || 'সব বিভাগ')}${course.teacherName ? ` • শিক্ষক: ${esc(course.teacherName)}` : ''}</small>
        <p class="teaching-progress-line ${prog.completed === prog.total && prog.total > 0 ? 'clear' : 'idle'}">অধ্যায় অগ্রগতি: ${num(prog.completed)}/${num(prog.total)} শেষ • ${num(prog.running)} চলছে • ${num(prog.notStarted)} শুরু হয়নি</p>
        <div class="course-chapter-list">${course.chapters.length ? course.chapters.map(ch => `<div class="teacher-progress-row" data-student-chapter="${esc(ch.id)}" style="display:flex;justify-content:space-between;align-items:center;padding:0.25rem 0">
          <span>${num(ch.order)}. ${esc(ch.title)}</span>
          <span class="badge ${ch.status === 'শেষ' ? 'badge-approved' : ch.status === 'চলছে' ? 'badge-pending' : ''}">${esc(ch.status)}${ch.status === 'শেষ' && ch.completedDate ? ` (${esc(num(ch.completedDate))})` : ''}</span>
        </div>`).join('') : '<p class="teacher-empty">এই কোর্সে এখনো কোনো অধ্যায় যোগ করা হয়নি।</p>'}</div>
      </article>`;
    }).join('');
  }

  // Published, student-scoped courses only. These bars show real course
  // completion, not an invented per-chapter or daily completion percentage.
  function renderTodayStudy(courses) {
    const host = $('#studyTodayList');
    if (!host) return;
    const running = courses.flatMap(course => (course.chapters || [])
      .filter(chapter => chapter.status === 'চলছে')
      .map(chapter => ({ course, chapter })));
    host.innerHTML = running.length ? running.map(({ course, chapter }) => {
      const percent = courseProgress(course).percent;
      return `<article class="study-today-row">
        <span class="study-today-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h4l3-13h11M14 14l6 6m0-6-6 6"/></svg></span>
        <div class="study-today-copy"><h3>${esc(course.subject)} · ${esc(chapter.title)}</h3>
          <progress max="100" value="${percent}" aria-label="${esc(course.subject)} কোর্সের অগ্রগতি">${num(percent)}%</progress>
        </div>
      </article>`;
    }).join('') : '<p class="study-today-empty">এখনো কোনো চলমান অধ্যায় নেই। আমার কোর্স থেকে পড়াশোনা শুরু করো।</p>';
  }

  function paintCounts() {
    renderStudentCourses();
    const counts = teaching?.activityCounts?.() || { homework: 0, suggestion: 0 };
    const set = (key, value) => {
      const badge = bar.querySelector(`[data-study-count="${key}"]`);
      if (badge) {
        badge.textContent = num(value);
        badge.classList.toggle('is-zero', !value);
      }
    };
    const publishedCourses = courseRepository.readStudentCoursesSync(student());
    renderTodayStudy(publishedCourses);
    set('courses', publishedCourses.length);
    set('homework', counts.homework || 0);
    set('suggestion', (counts.suggestion || 0) + suggestionRecords.length);
    set('bank', bankRows.length);
    set('materials', materialRecords.length);
  }

  function paintPanels() {
    const board = $('#learningBoard');
    const slot = document.querySelector(`[data-study-panel="${section}"] [data-study-slot="board"]`);
    if (board && slot && board.parentElement !== slot) slot.appendChild(board);
    if (section === 'homework' || section === 'suggestion') {
      teaching?.setScope?.(section);
      teaching?.setSubject?.(section === 'suggestion' ? suggestionSubject : '');
    }
    const workspace = $('#studentPracticeWorkspace');
    const practiceSlot = $('#studyPracticeSlot');
    if (section === 'practice' && workspace && practiceSlot && workspace.parentElement !== practiceSlot) {
      practiceSlot.appendChild(workspace);
      workspace.hidden = false;
      window.apcStudentPractice?.setMode?.('all');
      window.apcStudentPractice?.refresh?.();
    }
  }

  function renderModelTest() {
    const list = $('#studyModelList');
    if (!list) return;
    const rows = materialRecords.filter(record => courseTypeOf(record) === 'model_test');
    list.innerHTML = rows.length ? rows.map(contentCard).join('') : '<p class="teacher-empty">এখনও কোনো মডেল টেস্ট নেই।</p>';
    const count = $('#studyModelCount');
    if (count) count.textContent = `${num(rows.length)}টি মডেল টেস্ট`;
  }

  function renderOther() {
    const list = $('#studyOtherList');
    if (!list) return;
    const rows = materialRecords.filter(record => OTHER_TYPES.includes(courseTypeOf(record)));
    list.innerHTML = rows.length ? rows.map(contentCard).join('') : '<p class="teacher-empty">এখনও অন্যান্য উপকরণ নেই।</p>';
    const count = $('#studyOtherCount');
    if (count) count.textContent = `${num(rows.length)}টি আইটেম`;
  }

  function renderStudyResults() {
    const list = $('#studyResultsList');
    if (!list) return;
    const studentId = student().id;
    const rows = (examDb.exams || []).filter(exam => isStudentVisibleExam(exam) && examMatchesStudent(exam, student()) && exam.resultsPublished)
      .map(exam => {
        const row = examResults(examDb, exam).find(item => item.studentId === studentId);
        if (!row) return null;
        const total = totalMarks(exam);
        if (!(total > 0) || !Number.isFinite(Number(row.score))) return null;
        const percent = row.score / total * 100;
        return { exam, row, total, percent, grade: row.grade || gradeFor(row.score, total, exam.passPercent) };
      }).filter(Boolean);
    const summary = summarizeStudyResults(rows);
    const paint = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };
    const rounded = value => value === null ? '—' : num(Number(value.toFixed(1)));
    paint('#studyResultAverage', rounded(summary.average));
    paint('#studyResultExamTotal', num(summary.count));
    paint('#studyResultHighest', rounded(summary.highest));
    const resultRow = item => {
      const subject = item.exam.subject || '';
      const icon = /গণিত|math/i.test(subject) ? '<path d="M2 14h4l3 7 4-18h9m-7 9 6 7m0-7-6 7"/>' : /ইংরেজি|english/i.test(subject) ? '<path d="M3 5h11M8 2v3m-3 0c0 6 4 10 9 12M13 5c0 6-4 10-10 12m12 4 4-11 4 11m-7-4h6"/>' : '<path d="M9 2h6m-5 0v7L4 22h16L14 9V2M7 16h10"/>';
      const trendLabel = item.trend === null ? 'আগের তুলনাযোগ্য ফলাফল নেই' : item.trend > 0 ? 'আগের পরীক্ষার চেয়ে বেড়েছে' : item.trend < 0 ? 'আগের পরীক্ষার চেয়ে কমেছে' : 'আগের পরীক্ষার সমান';
      const trend = item.trend === null || item.trend === 0 ? '—' : item.trend > 0 ? '↗' : '↘';
      return `<article class="study-result-row"><span class="study-result-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span><div class="study-result-copy"><h3>${esc(item.exam.title)}</h3><small>${esc(subject)} · ${num(item.row.score)}/${num(item.total)} · ${num(Number(item.percent.toFixed(1)))}% · ${esc(item.grade)}</small></div><strong class="study-result-score" aria-label="${num(item.row.score)} নম্বর, মোট ${num(item.total)}">${num(item.row.score)}</strong><span class="study-result-trend ${item.trend > 0 ? 'is-up' : item.trend < 0 ? 'is-down' : ''}" role="img" aria-label="${trendLabel}" title="${trendLabel}">${trend}</span></article>`;
    };
    list.innerHTML = rows.length
      ? summary.recent.slice(0, 5).map(resultRow).join('') + (rows.length > 5 ? `<details class="study-result-history"><summary>আরও ফলাফল দেখুন (${num(rows.length - 5)})</summary>${summary.recent.slice(5).map(resultRow).join('')}</details>` : '')
      : '<p class="study-result-empty">এখনও কোনো ফলাফল প্রকাশ করা হয়নি।</p>';
    paint('#studyResultsCount', `${num(rows.length)}টি প্রকাশিত ফলাফল`);
    const weakest = [...rows].sort((a, b) => a.percent - b.percent)[0];
    paint('#studyResultTip', weakest?.exam.subject ? `${weakest.exam.subject} আরও অনুশীলন করো। ভুলগুলো বুঝে আবার চেষ্টা করো।` : 'নিয়মিত অনুশীলন করো, ভুলগুলো বুঝে আবার চেষ্টা করো।');
  }

  function open(next, { history = 'push', skipView = false } = {}) {
    if (next === 'hub') {
      section = 'hub';
      if (!skipView) setView('courses', { history });
      return;
    }
    if (!SECTIONS.includes(next)) return;
    section = next;
    bar.querySelectorAll('[data-study-section]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.studySection === section)));
    paintPanels();
    if (next === 'bank') { if (bankError) void loadBank(); else renderBank(); }
    if (next === 'suggestion') renderSuggestion();
    if (next === 'materials') renderMaterials();
    if (next === 'model-test') renderModelTest();
    if (next === 'other') renderOther();
    if (next === 'results') { void loadBank().then(renderStudyResults); renderStudyResults(); }
    if (!skipView && SECTION_VIEWS[next]) setView(SECTION_VIEWS[next], { history });
  }

  /* ---- data ---------------------------------------------------------------- */

  async function loadBank() {
    const current = ++request;
    try {
      const [rows, db] = await Promise.all([
        listQuestionsForStudent(student().id),
        examRepo.listForStudent(student().id).catch(() => ({ exams: [] }))
      ]);
      if (current !== request) return;
      const now = Date.now();
      const exams = Array.isArray(db?.exams) ? db.exams : [];
      examDb = db && Array.isArray(db.exams) ? db : { exams, attempts: db?.attempts || [] };
      const visible = exams.filter(exam => isStudentVisibleExam(exam) && examMatchesStudent(exam, student()));
      const past = questionRowsFromPastExams(visible, now);
      const known = new Set((rows || []).map(row => `${text(row.type)}|${text(row.text)}`));
      bankRows = [...(Array.isArray(rows) ? rows : []), ...past.filter(row => !known.has(`${text(row.type)}|${text(row.text)}`))];
      bankPapers = visible.filter(exam => Number(exam.endAt) > 0 && Number(exam.endAt) < now
        && ['published', 'completed', 'archived'].includes(exam.status)
        && (exam.questions || []).length);
      bankReady = true; bankError = '';
    } catch (error) {
      if (current !== request) return;
      bankRows = []; bankPapers = []; bankReady = true;
      bankError = 'প্রশ্নব্যাংক লোড হয়নি। আবার চেষ্টা করো।';
      const node = $(SELECTORS.bank.error);
      if (node) { node.hidden = false; node.textContent = bankError; }
      void error;
    }
    renderBank(); paintCounts();
  }

  async function loadShelves() {
    try {
      const rows = recordsFor();
      /* Published course records and published teacher suggestions share this
         student shelf; the original records remain in their own source store. */
      const courseSuggestions = rows.filter(record => SUGGESTION_SECTIONS.includes(courseTypeOf(record))
        || ['mcq', 'pdf'].includes(courseTypeOf(record)));
      let activitySuggestions = [];
      try {
        const db = await teachingRepository.listForStudent(student().id);
        activitySuggestions = publishedForStudent(db?.activities || [], student())
          .filter(activity => activity.type === 'suggestion')
          .map(activity => ({
            id: activity.id,
            type: 'suggestion',
            title: activity.title,
            subject: activity.subject,
            chapterName: '',
            content: activity.details || '',
            description: '',
            attachmentUrl: activity.resourceURL || '',
            createdAt: activity.updatedAt || activity.createdAt || activity.date || '',
            className: activity.className,
            group: activity.group,
            published: true
          }));
      } catch {
        /* Keep course-content suggestions visible if activity storage is unavailable. */
      }
      const seen = new Set(courseSuggestions.map(record => String(record.id)));
      suggestionRecords = [...courseSuggestions, ...activitySuggestions.filter(record => !seen.has(String(record.id)))];

      materialRecords = rows.filter(record => ['note', 'pdf', 'lesson', 'video', 'previous_question', 'model_test'].includes(courseTypeOf(record)));
      suggestionReady = true; suggestionError = '';
      materialReady = true; materialError = '';
    } catch {
      suggestionRecords = []; materialRecords = [];
      suggestionReady = true; materialReady = true;
      suggestionError = 'সাজেশন লোড হয়নি। আবার চেষ্টা করো।';
      materialError = 'উপকরণ লোড হয়নি। আবার চেষ্টা করো।';
    }
    fillFilters();
    renderSuggestion(); renderMaterials(); paintCounts();
  }

  async function refresh() {
    fillFilters();
    await loadShelves();
    await loadBank();
  }

  /* ---- events -------------------------------------------------------------- */

  bar.addEventListener('click', event => {
    const button = event.target.closest('[data-study-section]');
    if (button) open(button.dataset.studySection);
  });
  window.addEventListener('apc-view-change', event => {
    const view = event.detail?.view;
    if (view === 'courses') { section = 'hub'; return; }
    const next = VIEW_SECTIONS[view];
    if (next) open(next, { skipView: true });
  });

  /* The student app announces a finished sign-in; the sections load their own
     shelves then, so a pre-login attempt can never leave a section empty. */
  window.addEventListener('apc-session-ready', () => { void refresh(); });

  window.addEventListener('apc-open-study-section', event => {
    const next = event.detail?.section;
    if (SECTIONS.includes(next)) open(next);
  });

  const bankBar = $('#studyBankFilters');
  bankBar?.addEventListener('click', event => {
    const button = event.target.closest('[data-bank-filter]');
    if (!button) return;
    const key = button.dataset.bankFilter;
    if (bankTypes.has(key)) bankTypes.delete(key); else bankTypes.add(key);
    button.setAttribute('aria-pressed', String(bankTypes.has(key)));
    renderBank();
  });
  $(SELECTORS.bank.list)?.addEventListener('click', async event => {
    const button = event.target.closest('[data-bank-pdf]');
    if (!button || bankPdfBusy) return;
    const exam = bankPapers.find(item => item.id === button.dataset.id);
    if (!exam) return;
    bankPdfBusy = true;
    button.disabled = true;
    const errorNode = $(SELECTORS.bank.error);
    try {
      if (errorNode) { errorNode.hidden = true; errorNode.textContent = ''; }
      await downloadExamPDF(exam, { solutions: button.dataset.bankPdf === 'solutions' });
    } catch (error) {
      if (errorNode) {
        errorNode.hidden = false;
        errorNode.textContent = error.message || 'PDF তৈরি হয়নি। আবার চেষ্টা করো।';
      }
    } finally {
      bankPdfBusy = false;
      button.disabled = false;
    }
  });
  watchExams(() => {
    if (section === 'bank' || section === 'results') void loadBank().then(() => { if (section === 'results') renderStudyResults(); });
  });
  watchTeachingData(() => {
    if (section === 'suggestion' || section === 'hub') void loadShelves();
  });
  $('#studySuggestionFilters')?.addEventListener('click', event => {
    const button = event.target.closest('[data-suggestion-filter]');
    if (!button) return;
    const key = button.dataset.suggestionFilter;
    if (suggestionTypes.has(key)) suggestionTypes.delete(key); else suggestionTypes.add(key);
    button.setAttribute('aria-pressed', String(suggestionTypes.has(key)));
    renderSuggestion();
  });
  $('#studyMaterialFilters')?.addEventListener('click', event => {
    const button = event.target.closest('[data-material-filter]');
    if (!button) return;
    materialType = button.dataset.materialFilter;
    $('#studyMaterialFilters').querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    renderMaterials();
  });

  const handleLectureSheetClick = async event => {
    const pdfBtn = event.target.closest('[data-student-lecture-pdf]');
    const readerBtn = event.target.closest('[data-student-lecture-reader]');
    if (!pdfBtn && !readerBtn) return;
    const targetId = pdfBtn ? pdfBtn.dataset.studentLecturePdf : readerBtn.dataset.studentLectureReader;
    const allowed = [...materialRecords, ...suggestionRecords].find(item => item.id === targetId);
    if (!allowed || allowed.published !== true || allowed.active === false) return;
    const cur = student();
    const enriched = {
      ...allowed,
      className: cur.className || '',
      subjectName: text(allowed.subject) || ''
    };
    const mod = await import('./lecture-sheet-pdf.js');
    if (readerBtn) {
      await mod.openStudentLectureReaderModal(enriched);
      return;
    }
    const orig = pdfBtn.textContent;
    pdfBtn.disabled = true;
    pdfBtn.textContent = '⏳ PDF তৈরি হচ্ছে…';
    try {
      await mod.downloadLectureSheetPDF(enriched);
    } catch {
      pdfBtn.textContent = '⚠ আবার চেষ্টা করুন';
      setTimeout(() => { pdfBtn.textContent = orig; }, 2200);
      pdfBtn.disabled = false;
      return;
    }
    pdfBtn.disabled = false;
    pdfBtn.textContent = orig;
  };
  $(SELECTORS.materials.list)?.addEventListener('click', handleLectureSheetClick);
  $(SELECTORS.suggestion.list)?.addEventListener('click', handleLectureSheetClick);

  const onSelect = (select, apply) => select?.addEventListener('change', () => { apply(select.value); });
  onSelect($(SELECTORS.bank.subject), value => { bankSubject = value; bankChapter = ''; fillFilters(); renderBank(); });
  onSelect($(SELECTORS.bank.chapter), value => { bankChapter = value; renderBank(); });
  onSelect($(SELECTORS.suggestion.subject), value => { suggestionSubject = value; suggestionChapter = ''; fillFilters(); teaching?.setSubject?.(value); renderSuggestion(); });
  onSelect($(SELECTORS.suggestion.chapter), value => { suggestionChapter = value; renderSuggestion(); });
  onSelect($(SELECTORS.materials.subject), value => { materialSubject = value; materialChapter = ''; fillFilters(); renderMaterials(); });
  onSelect($(SELECTORS.materials.chapter), value => { materialChapter = value; renderMaterials(); });

  watchCourses(() => void refresh());
  window.addEventListener('apc-course-updated', () => void refresh());
  window.addEventListener('apc-academics-updated', () => void refresh());
  window.addEventListener('teaching-data-updated', () => { loadShelves(); });
  window.addEventListener('storage', event => {
    if (event.key === null || /activePlus\.(courseContent|academics|teaching)/.test(event.key || '')) void refresh();
  });

  section = 'hub';
  /* Paint the synchronous, student-scoped course snapshot immediately. The
     question bank and shelves can finish loading afterward without making a
     published course briefly appear missing on a slow phone. */
  paintCounts();
  void refresh();
  const api = () => refresh();
  api.open = open;
  api.refresh = refresh;
  api.currentSection = () => section;
  return api;
}
