/* Examination workspace (Manager + Teacher).
   Date-wise on purpose: the landing screen is a grouped, filterable history
   where questions stay collapsed behind View Questions — no exam ever lies
   open on the screen, and no two dates ever mix in one list.
   Permissions are decided by js/exam-archive.js and enforced again in
   js/exam-data.js; this module only paints the buttons that are allowed. */
import { examRepository as repo, EXAM_TYPES, EXAM_STATUSES, TEACHER_ACTOR, ADMIN_ACTOR, MANAGER_ACTOR, examTemplate, EXAM_SAMPLE_TEMPLATES, MCQ_30_SAMPLE, parseQuestions, totalMarks, watchExams, isLiveExam, examDateOf, examDurationMinutes, examDateFor, examCodeOf, examStageLabel, ensureChapter } from './exam-data.js';
import { examRecord, questionPreview, resultMarkup, downloadResults, statusTag, typeTag, stageTag, codeTag, esc, num, when, shortExamId } from './exam-ui.js';
import { downloadExamPDF } from './exam-pdf.js';
import { enabledClasses } from './config.js';
import { listClasses, listChapters, subjectsForClass, isSubjectEnabled } from './academics.js';
import { questionBank, searchQuestions, listQuestions, questionById, ensureExamsInBank, QUESTION_TYPES, QUESTION_DIFFICULTIES, QUESTION_TYPE_ORDER, QUESTION_DIFFICULTY_ORDER, watchQuestionBank, questionForExam } from './question-bank.js';
import { subjectsForTeacherClass } from './teacher-assignments.js';
import { listTeacherAssignments } from './teacher-assignments.js';
import {
  EXAM_FILTERS, normalizeFilters, activeFilterCount, examPermissions, filterExams,
  groupExamsByDate, upcomingExams, examCounters, classOptions, subjectOptions,
  examDateShort, durationLabel, statusLabel, workflowSteps
} from './exam-archive.js';

export function initExamManager(container, role) {
  const root = document.querySelector(container); if (!root) return;
  const actor = role === 'admin' ? ADMIN_ACTOR : role === 'manager' ? MANAGER_ACTOR : TEACHER_ACTOR;
  const academicClasses = () => listClasses().map(item => item.name);
  const roleClasses = () => {
    if (role !== 'teacher') { const names = academicClasses(); return names.length ? names : [...enabledClasses]; }
    const assigned = [...new Set(listTeacherAssignments('teacher.apc').map(item => item.className))];
    return assigned.length ? assigned : academicClasses();
  };
  let db = { exams: [], attempts: [] }, view = 'home', selected = null, openQuestion = null;
  let filters = { ...EXAM_FILTERS }, busy = false, ready = false;
  /* Question Bank screen state: filters, one page of rows and the row being
     edited. Only one page is ever rendered, so a shelf of thousands of
     questions never reaches the DOM. */
  const BANK_PAGE = 20;
  let bankFilters = { query: '', className: 'all', subject: 'all', chapter: 'all', type: 'all', difficulty: 'all' };
  let bankPage = 0, bankEditing = '';
  root.classList.add('exam-workspace');
  root.innerHTML = '<p class="exam-note">লোকাল ডেমো • প্রশ্ন শিক্ষক তৈরি করবেন, Manager পর্যালোচনা/অনুমোদন/প্রকাশ করবেন। পরীক্ষা ও প্রশ্ন তারিখ অনুযায়ী আলাদা রেকর্ডে থাকে; ডেমোতে সব শ্রেণির অনুমোদিত শিক্ষার্থী অংশ নিতে পারে।</p><p class="exam-error" role="alert" data-exam-error hidden></p><p class="exam-message" role="status" data-exam-message hidden></p><div data-exam-content></div>';
  const $ = selector => root.querySelector(selector), content = $('[data-exam-content]');
  const button = (action, label, id = '', cls = '') => `<button type="button" class="${cls}" data-exam-action="${action}" data-id="${esc(id)}">${label}</button>`;
  const back = (label = '← পরীক্ষার তালিকা') => `<div class="exam-actions">${button('list', label)}</div>`;
  function error(text) { const node = $('[data-exam-error]'); node.textContent = text; node.hidden = !text; }
  function message(text) { const node = $('[data-exam-message]'); node.textContent = text; node.hidden = !text; }
  function scrollTop() { root.closest('main')?.scrollTo({ top: 0, behavior: 'instant' }); }
  const attemptCount = exam => db.attempts.filter(attempt => attempt.examId === exam.id).length;
  const openAttemptCount = exam => db.attempts.filter(attempt => attempt.examId === exam.id && ['active', 'queued'].includes(attempt.status)).length;
  const permissionFor = exam => examPermissions(actor, exam, { attempts: attemptCount(exam), openAttempts: openAttemptCount(exam) });
  const creatorName = exam => exam.createdBy || exam.teacherName || '—';
  const count = value => num(Number(value) || 0);

  /* ---------- shared pieces ------------------------------------------------ */

  /** The manager/teacher quick counters under the module tiles. */
  function countersMarkup(exams) {
    const stats = examCounters(exams);
    const tiles = [
      ['মোট পরীক্ষা', stats.total], ['খসড়া', stats.draft + 0], ['পর্যালোচনায়', stats.pending],
      ['অনুমোদিত', stats.approved], ['প্রকাশিত', stats.published], ['সম্পন্ন', stats.completed],
      ['আর্কাইভ', stats.archived], ['মোট প্রশ্ন', stats.questions]
    ];
    return `<dl class="exam-counters">${tiles.map(([label, value]) => `<div><dt>${label}</dt><dd>${count(value)}</dd></div>`).join('')}</dl>`;
  }
  function hubMarkup(exams) {
    const upcoming = upcomingExams(exams).length;
    return `<section class="exam-hub" aria-label="পরীক্ষা পরিচালনা করুন">
      <div class="exam-actions">
        ${button('view-history', '🧾 পরীক্ষার ইতিহাস')}
        ${button('view-upcoming', `⏳ আসন্ন পরীক্ষা${upcoming ? ` (${num(upcoming)})` : ''}`)}
        ${button('view-archive', '🗂️ পরীক্ষার প্রশ্ন দেখুন')}
        ${button('bank', '📚 প্রশ্ন সংরক্ষণ করুন')}
      </div>
      <div class="exam-actions" aria-label="পরীক্ষা তৈরি করুন">
        ${Object.entries(EXAM_TYPES).map(([type, label]) => button('new-' + type, `পরীক্ষা তৈরি করুন — ${label}`, '', 'primary')).join('')}
      </div>
      ${countersMarkup(exams)}
    </section>`;
  }
  /** Date + class + subject + name + status, in one filter bar. */
  function filterMarkup(exams) {
    const classes = [...new Set([...roleClasses(), ...classOptions(exams)])];
    const subjects = subjectOptions(exams);
    const active = activeFilterCount(filters);
    return `<form class="exam-filters" data-exam-filters>
      <label class="exam-filter-wide">পরীক্ষার নাম / আইডি / প্রশ্ন খুঁজুন<input type="search" name="query" value="${esc(filters.query)}" placeholder="যেমন: Weekly Exam, E261001…, ঢাকা"></label>
      <label>পরীক্ষার তারিখ<input type="date" name="date" value="${esc(filters.date)}"></label>
      <label>শুরুর তারিখ (থেকে)<input type="date" name="from" value="${esc(filters.from)}"></label>
      <label>শেষ তারিখ (পর্যন্ত)<input type="date" name="to" value="${esc(filters.to)}"></label>
      <label>শ্রেণি<select name="className" data-exam-class-filter><option value="all">সব শ্রেণি</option>${classes.map(name => `<option value="${esc(name)}" ${filters.className === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
      <label>বিষয়<select name="subject"><option value="all">সব বিষয়</option>${subjects.map(name => `<option value="${esc(name)}" ${filters.subject === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
      <label>অবস্থা<select name="status">
        <option value="all" ${filters.status === 'all' ? 'selected' : ''}>সব অবস্থা</option>
        <option value="work" ${filters.status === 'work' ? 'selected' : ''}>কাজ চলছে (খসড়া → অনুমোদিত)</option>
        <option value="live" ${filters.status === 'live' ? 'selected' : ''}>প্রকাশিত / সম্পন্ন</option>
        <option value="draft" ${filters.status === 'draft' ? 'selected' : ''}>খসড়া / ফেরত</option>
        <option value="pending" ${filters.status === 'pending' ? 'selected' : ''}>${esc(EXAM_STATUSES.pending)}</option>
        <option value="approved" ${filters.status === 'approved' ? 'selected' : ''}>${esc(EXAM_STATUSES.approved)}</option>
        <option value="published" ${filters.status === 'published' ? 'selected' : ''}>${esc(EXAM_STATUSES.published)}</option>
        <option value="completed" ${filters.status === 'completed' ? 'selected' : ''}>${esc(EXAM_STATUSES.completed)}</option>
        <option value="archived" ${filters.status === 'archived' ? 'selected' : ''}>${esc(EXAM_STATUSES.archived)}</option>
      </select></label>
      <div class="exam-actions">
        <button type="submit" class="primary">ফিল্টার প্রয়োগ করুন</button>
        <button type="button" data-exam-action="filter-type">ধরন: ${filters.type === 'all' ? 'সব' : EXAM_TYPES[filters.type]}</button>
        <button type="button" data-exam-action="filters-reset">ফিল্টার মুছুন${active ? ` (${num(active)})` : ''}</button>
      </div>
    </form>`;
  }
  /** One row per exam — the dashboard columns the school asked for. */
  function rowsMarkup(exams) {
    return exams.map(exam => {
      const perm = permissionFor(exam);
      const actions = [
        perm.questions ? button('questions', 'প্রশ্ন দেখুন', exam.id) : '',
        perm.edit ? button('edit', 'সম্পাদনা', exam.id) : '',
        perm.duplicate ? button('duplicate', 'ডুপ্লিকেট', exam.id) : '',
        perm.review ? button('detail', 'পর্যালোচনা করুন', exam.id, 'primary') : '',
        perm.approve ? button('approve', 'অনুমোদন', exam.id) : '',
        perm.publish ? button('publish', 'প্রকাশ করুন', exam.id, 'primary') : '',
        perm.unpublish ? button('unpublish', 'Unpublish', exam.id) : '',
        perm.complete ? button('complete', 'সম্পন্ন চিহ্নিত', exam.id) : '',
        perm.archive ? button('archive', 'আর্কাইভ', exam.id) : '',
        perm.restore ? button('restore', 'ফিরিয়ে আনুন', exam.id) : '',
        perm.request ? button('request', 'অনুমতির জন্য পাঠান', exam.id, 'primary') : '',
        !perm.review && isLiveExam(exam) ? button('detail', 'বিস্তারিত', exam.id) : '',
        perm.results ? button('report', 'ফলাফল ও রিপোর্ট', exam.id) : '',
        perm.grade ? button('grade', 'নম্বর / উপস্থিতি', exam.id) : '',
        perm.remove ? button('delete', 'মুছুন', exam.id, 'danger') : ''
      ].filter(Boolean).join('');
      return `<tr data-managed-exam="${esc(exam.id)}">
        <td data-label="তারিখ">${esc(examDateShort(examDateOf(exam)))}</td>
        <td data-label="পরীক্ষা"><strong>${esc(exam.title)}</strong><small class="exam-row-meta">${codeTag(exam)}${typeTag(exam)} • ${esc(shortExamId(exam.id))}</small>${exam.chapterName ? `<small class="exam-row-meta">অধ্যায়: ${esc(exam.chapterName)}</small>` : ''}${exam.reviewNote ? `<small class="exam-review-note">${esc(exam.reviewNote)}</small>` : ''}</td>
        <td data-label="শ্রেণি">${esc(exam.className || 'সব শ্রেণি')}${exam.group ? ` • ${esc(exam.group)}` : ''}</td>
        <td data-label="বিষয়">${esc(exam.subject)}</td>
        <td data-label="প্রশ্ন">${count((exam.questions || []).length)}</td>
        <td data-label="পূর্ণমান">${count(totalMarks(exam))}</td>
        <td data-label="সময়">${esc(examDateShort(examDateOf(exam)))}<small class="exam-row-meta">${esc(durationLabel(examDurationMinutes(exam)))}</small><small class="exam-row-meta">তৈরি: ${esc(creatorName(exam))}</small></td>
        <td data-label="অবস্থা">${statusTag(exam)}${stageTag(exam)}</td>
        <td data-label="অ্যাকশন"><div class="exam-row-actions">${actions}</div></td>
      </tr>`;
    }).join('');
  }
  function groupsMarkup(exams) {
    if (!exams.length) {
      const text = filters.className !== 'all'
        ? `${esc(filters.className)} — এই শ্রেণির কোনো পরীক্ষা নেই।`
        : activeFilterCount(filters) ? 'এই ফিল্টারে কোনো পরীক্ষা নেই।' : 'এখনও কোনো পরীক্ষা নেই — উপরের বাটন দিয়ে নতুন পরীক্ষা তৈরি করুন।';
      return `<p class="exam-card">${text}</p>`;
    }
    return groupExamsByDate(exams).map(group => `<section class="exam-date-group" data-exam-date="${esc(group.date)}">
      <h3 class="exam-date-head">${esc(group.label)}<span>${num(group.exams.length)}টি পরীক্ষা</span></h3>
      <div class="exam-table-wrap"><table class="exam-table">
        <thead><tr><th>তারিখ</th><th>পরীক্ষা</th><th>শ্রেণি</th><th>বিষয়</th><th>প্রশ্ন</th><th>পূর্ণমান</th><th>সময়</th><th>অবস্থা</th><th>অ্যাকশন</th></tr></thead>
        <tbody>${rowsMarkup(group.exams)}</tbody>
      </table></div>
    </section>`).join('');
  }

  /* ---------- প্রশ্ন সংরক্ষণ করুন (Question Bank) --------------------------- */

  /** One page of the shelf, with every filter the brief lists. */
  function bankMatches() {
    const value = key => (bankFilters[key] === 'all' ? '' : bankFilters[key]);
    return searchQuestions({
      query: bankFilters.query,
      className: value('className'),
      subject: value('subject'),
      chapterName: value('chapter'),
      type: value('type'),
      difficulty: value('difficulty'),
      includeInactive: true
    });
  }
  function bankFilterMarkup(result) {
    const classes = [...new Set([...roleClasses(), ...listQuestions().map(row => row.className).filter(Boolean)])];
    const subjects = [...new Set(listQuestions().map(row => row.subject).filter(Boolean))];
    const chapters = [...new Set(listQuestions().map(row => row.chapterName).filter(Boolean))];
    const option = (name, label, values, all) => `<label>${label}<select name="${name}"><option value="all">${all}</option>${values.map(item => `<option value="${esc(item)}" ${bankFilters[name] === item ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select></label>`;
    return `<form class="exam-filters exam-bank-filters" data-bank-filters>
      <label class="exam-filter-wide">প্রশ্ন খুঁজুন (কোড / লেখা / টপিক)<input type="search" name="query" value="${esc(bankFilters.query)}" placeholder="যেমন: QUESTION-0007, ঢাকা, বহুপদী"></label>
      ${option('className', 'শ্রেণি', classes, 'সব শ্রেণি')}
      ${option('subject', 'বিষয়', subjects, 'সব বিষয়')}
      ${option('chapter', 'অধ্যায়', chapters, 'সব অধ্যায়')}
      <label>ধরন<select name="type"><option value="all">সব ধরন</option>${QUESTION_TYPE_ORDER.map(type => `<option value="${type}" ${bankFilters.type === type ? 'selected' : ''}>${esc(QUESTION_TYPES[type])}</option>`).join('')}</select></label>
      <label>কঠিন্য<select name="difficulty"><option value="all">সব</option>${QUESTION_DIFFICULTY_ORDER.map(level => `<option value="${level}" ${bankFilters.difficulty === level ? 'selected' : ''}>${esc(QUESTION_DIFFICULTIES[level])}</option>`).join('')}</select></label>
      <div class="exam-actions">
        <button type="submit" class="primary">খুঁজুন</button>
        <button type="button" data-exam-action="bank-new">+ নতুন প্রশ্ন সংরক্ষণ করুন</button>
        <button type="button" data-exam-action="bank-reset">ফিল্টার মুছুন</button>
      </div>
      <p class="exam-note" data-bank-count>${num(result.total)}টি প্রশ্ন পাওয়া গেছে — এক পাতায় ${num(Math.min(BANK_PAGE, result.total) || 0)}টি দেখানো হয়।</p>
    </form>`;
  }
  function bankRow(row) {
    const editing = bankEditing === row.id;
    return `<article class="exam-question exam-bank-row" data-bank-question="${esc(row.id)}">
      <small>${esc(row.code)} • ${esc(QUESTION_TYPES[row.type])} • ${num(row.marks)} নম্বর • ${esc(QUESTION_DIFFICULTIES[row.difficulty])}${row.active ? '' : ' • নিষ্ক্রিয়'}</small>
      <p>${esc(row.text)}</p>
      <small class="exam-row-meta">${esc(row.className || 'শ্রেণি নেই')} • ${esc(row.subject || 'বিষয় নেই')}${row.chapterName ? ` • ${esc(row.chapterName)}` : ''}${row.topic ? ` • ${esc(row.topic)}` : ''}${row.source ? ` • ${esc(row.source.examTitle || '')}` : ''}</small>
      <div class="exam-actions">
        ${button('bank-edit', editing ? 'সম্পাদনা বন্ধ' : 'সম্পাদনা', row.id)}
        ${button('bank-toggle', row.active ? 'নিষ্ক্রিয় করুন' : 'সক্রিয় করুন', row.id)}
        ${button('bank-delete', 'মুছুন', row.id, 'danger')}
      </div>
      ${editing ? bankFormMarkup(row) : ''}
    </article>`;
  }
  function bankFormMarkup(row = null, { exam = null } = {}) {
    const data = row || {
      type: 'mcq', text: '', className: exam?.className || roleClasses()[0] || '', subject: exam?.subject || '',
      chapterName: exam?.chapterName || '', topic: exam?.topic || '', difficulty: 'medium', marks: 1,
      options: [{ id: 'A', text: '' }, { id: 'B', text: '' }, { id: 'C', text: '' }, { id: 'D', text: '' }], answer: 'A', answerText: ''
    };
    const classNames = [...new Set([...roleClasses(), data.className].filter(Boolean))];
    const subjectNames = [...new Set([...((data.className ? subjectsForClass(data.className).map(item => item.name) : subjectsForClass(classNames[0] || '').map(item => item.name))), data.subject].filter(Boolean))];
    const chapters = data.className && data.subject ? listChapters(data.className, data.subject).map(item => item.name) : [];
    return `<form class="exam-form exam-bank-form" data-bank-form="${esc(row?.id || '')}">
      <label>প্রশ্নের ধরন<select name="type">${QUESTION_TYPE_ORDER.map(type => `<option value="${type}" ${data.type === type ? 'selected' : ''}>${esc(QUESTION_TYPES[type])}</option>`).join('')}</select></label>
      <label>প্রশ্নের লেখা<textarea name="text" rows="4" maxlength="1200" required>${esc(data.text)}</textarea></label>
      <label>শ্রেণি<select name="className">${classNames.map(name => `<option value="${esc(name)}" ${data.className === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
      <label>বিষয়<select name="subject">${subjectNames.map(name => `<option value="${esc(name)}" ${data.subject === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
      <label>অধ্যায়<input name="chapterName" list="bankChapters" value="${esc(data.chapterName)}" maxlength="120"><datalist id="bankChapters">${chapters.map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist></label>
      <label>টপিক<input name="topic" maxlength="120" value="${esc(data.topic)}"></label>
      <label>কঠিন্য<select name="difficulty">${QUESTION_DIFFICULTY_ORDER.map(level => `<option value="${level}" ${data.difficulty === level ? 'selected' : ''}>${esc(QUESTION_DIFFICULTIES[level])}</option>`).join('')}</select></label>
      ${['A', 'B', 'C', 'D'].map(id => { const option = (data.options || []).find(item => item.id === id) || { text: '' }; return `<label class="exam-bank-option" data-option-field="${id}">অপশন ${id}<input name="option-${id}" maxlength="500" value="${esc(option.text)}"></label>`; }).join('')}
      <label data-answer-field>MCQ-এর সঠিক উত্তর (A–D)<select name="answer">${['A', 'B', 'C', 'D'].map(id => `<option value="${id}" ${data.answer === id ? 'selected' : ''}>${id}</option>`).join('')}</select></label>
      <label>নম্বর (MCQ ছাড়া)<input name="marks" type="number" min="1" max="1000" step="1" value="${esc(data.marks)}"></label>
      <label>মডেল উত্তর (সত্য/মিথ্যা, সংক্ষিপ্ত, লিখিত)<textarea name="answerText" rows="2" maxlength="1200">${esc(data.answerText)}</textarea></label>
      <div class="exam-actions"><button type="submit" class="primary">${row ? 'পরিবর্তন সংরক্ষণ করুন' : 'প্রশ্ন সংরক্ষণ করুন'}</button>${button('bank-cancel', 'বাতিল')}</div>
    </form>`;
  }
  function bankView() {
    view = 'bank'; selected = null;
    const result = bankMatches(), start = bankPage * BANK_PAGE;
    const rows = result.rows.slice(start, start + BANK_PAGE);
    const pages = Math.max(1, Math.ceil(result.total / BANK_PAGE));
    content.innerHTML = `${back('← পরীক্ষা পরিচালনা করুন (তৈরি ও ইতিহাস)')}
      <h2>📚 প্রশ্ন সংরক্ষণ করুন</h2>
      <p class="exam-note">এখানে সংরক্ষিত প্রশ্ন যেকোনো নতুন পরীক্ষায় আবার ব্যবহার করা যায়। কোনো পরীক্ষা মুছলে বা বদলালেও এই প্রশ্ন অটুট থাকে, আর এখান থেকে মুছলেও কোনো পরীক্ষার প্রশ্ন মুছে যায় না।</p>
      ${bankFilterMarkup(result)}
      ${rows.map(bankRow).join('') || '<p class="exam-card">এই ফিল্টারে কোনো প্রশ্ন নেই — “+ নতুন প্রশ্ন সংরক্ষণ করুন” চেপে যোগ করুন।</p>'}
      ${pages > 1 ? `<div class="exam-actions"><button type="button" data-exam-action="bank-page" data-page="${bankPage - 1}" ${bankPage === 0 ? 'disabled' : ''}>← আগের পাতা</button><span class="exam-note">পাতা ${num(bankPage + 1)} / ${num(pages)}</span><button type="button" data-exam-action="bank-page" data-page="${bankPage + 1}" ${bankPage + 1 >= pages ? 'disabled' : ''}>পরের পাতা →</button></div>` : ''}
      ${bankEditing && bankEditing !== 'new' ? '' : ''}
      ${bankEditing === 'new' ? `<section class="exam-card exam-bank-new"><h3>নতুন প্রশ্ন সংরক্ষণ করুন</h3>${bankFormMarkup()}</section>` : ''}`;
    scrollTop();
  }

  /** The picker that puts shelved questions into the paper being edited. */
  function bankPickerMarkup(exam) {
    const { rows, total } = searchQuestions({
      className: exam.className || '', subject: exam.subject || '',
      type: exam.type === 'mcq' ? 'mcq' : '', active: true, limit: 10
    });
    if (!rows.length) return '<p class="exam-note">এই শ্রেণি ও বিষয়ের জন্য সংরক্ষিত প্রশ্ন নেই — “প্রশ্ন সংরক্ষণ করুন” থেকে যোগ করুন।</p>';
    return `<p class="exam-note">সংরক্ষিত ${num(total)}টি প্রশ্নের মধ্যে প্রথম ${num(rows.length)}টি দেখানো হচ্ছে${exam.type === 'mcq' ? ' (শুধু MCQ)' : ''}।</p>
      <div class="exam-question-list">${rows.map(row => `<article class="exam-question exam-bank-pick" data-bank-pick="${esc(row.id)}"><small>${esc(row.code)} • ${num(row.marks)} নম্বর</small><p>${esc(row.text)}</p><div class="exam-actions">${button('bank-add', 'এই পরীক্ষায় যোগ করুন', row.id, 'primary')}</div></article>`).join('')}</div>`;
  }

  /* ---------- views -------------------------------------------------------- */

  function home() {
    view = 'home'; selected = null; openQuestion = null;
    const visible = db.exams;
    const list = filterExams(visible, filters);
    content.innerHTML = `${role === 'admin' ? '<p class="exam-note">Admin দেখতে পারেন; অনুমোদন ও প্রকাশ Manager-এর কাজ।</p>' : ''}
      ${hubMarkup(visible)}${filterMarkup(visible)}
      <h2 class="exam-section-title">পরীক্ষার ইতিহাস — তারিখ অনুযায়ী</h2>
      ${groupsMarkup(list)}`;
  }
  function upcoming() {
    view = 'upcoming'; selected = null; openQuestion = null;
    const list = upcomingExams(filterExams(db.exams, { ...filters, status: 'all' }));
    content.innerHTML = `${back()}<h2>আসন্ন পরীক্ষা</h2><p class="exam-note">আগামী তারিখের পরীক্ষা, তারিখ ও সময় অনুযায়ী সাজানো। প্রশ্ন দেখতে “প্রশ্ন দেখুন” চাপুন।</p>${groupsMarkup(list)}`;
  }
  function archive() {
    view = 'archive'; selected = null; openQuestion = null;
    const list = filterExams(db.exams, filters).filter(exam => (exam.questions || []).length);
    content.innerHTML = `${back()}<h2>প্রশ্নের আর্কাইভ</h2><p class="exam-note">সব পরীক্ষার প্রশ্ন আলাদা রেকর্ড হিসেবে তারিখ অনুযায়ী সাজানো। প্রশ্ন সবসময় বন্ধ থাকে — খুলতে “প্রশ্ন দেখুন”, পুরোনো প্রশ্ন দিয়ে নতুন পরীক্ষা বানাতে “ডুপ্লিকেট”।</p>${filterMarkup(db.exams)}${groupsMarkup(list)}`;
  }
  function questions(exam) {
    view = 'questions'; selected = exam.id;
    const perm = permissionFor(exam);
    content.innerHTML = `${back()}<article class="exam-card exam-questions-head"><div class="exam-tags">${typeTag(exam)}${statusTag(exam)}</div>${examRecord(exam)}
      <div class="exam-actions">${button('paper', 'প্রশ্নপত্র PDF ডাউনলোড', exam.id)}${button('detail', 'বিস্তারিত ও অনুমোদন', exam.id)}${perm.edit ? button('questions', 'প্রশ্ন সম্পাদনা সহ দেখুন', exam.id) : ''}</div>
      <p class="exam-note">প্রশ্নের জন্য unique ID: <strong>${esc(exam.id)}-q1 … ${esc(exam.id)}-q${(exam.questions || []).length}</strong> — একই প্রশ্ন অন্য পরীক্ষায় গেলেও তার নিজের ID থাকবে।</p></article>
      ${problemHint(exam)}
      <div class="exam-actions exam-bank-tools">
        <button type="button" data-exam-action="save-to-bank" data-id="${esc(exam.id)}">📚 এই প্রশ্নগুলো প্রশ্ন ব্যাংকে সংরক্ষণ করুন</button>
        <button type="button" data-exam-action="solutions" data-id="${esc(exam.id)}">সঠিক উত্তরপত্র PDF</button>
      </div>
      ${problemHint(exam).includes('বদলানো যাবে না') ? '' : `<details class="exam-card exam-bank-picker"><summary>প্রশ্ন ব্যাংক থেকে প্রশ্ন যোগ করুন</summary>${bankPickerMarkup(exam)}</details>`}
      <h3 class="exam-section-title">প্রশ্ন তালিকা (${num((exam.questions || []).length)}টি)</h3>
      <div class="exam-question-list">${exam.questions.map((question, index) => questionMarkup(exam, question, index, perm)).join('')}</div>
      ${perm.edit ? addQuestionMarkup(exam) : '<p class="exam-note">প্রকাশিত/সম্পন্ন পরীক্ষার প্রশ্ন আর বদলানো যায় না।</p>'}`;
  }
  function problemHint(exam) {
    const perm = permissionFor(exam);
    if (perm.edit) return '';
    if (isLiveExam(exam)) return '<p class="exam-note">পরীক্ষাটি প্রকাশিত — শিক্ষার্থীরা নির্ধারিত সময়ে প্রশ্ন দেখতে পাবে, এখন আর প্রশ্ন বদলানো যাবে না।</p>';
    return `<p class="exam-note">এই অবস্থায় (${esc(statusLabel(exam.status))}) প্রশ্ন সরাসরি বদলানো যায় না। Manager চাইলে আগে Unpublish/ফেরত দিতে পারেন।</p>`;
  }
  /** One question, collapsed; the editor opens inside it on demand. */
  function questionMarkup(exam, question, index, perm) {
    const uid = question.uid || `${exam.id}-q${index + 1}`;
    const editing = openQuestion === uid;
    const options = question.options
      ? `<div class="exam-question-options">${question.options.map(option => `<p class="${question.answer === option.id ? 'exam-option-correct' : ''}">${esc(option.id)}. ${esc(option.text)}${question.answer === option.id ? ' <strong>✓ সঠিক উত্তর</strong>' : ''}</p>`).join('')}</div>`
      : '';
    return `<article class="exam-question" data-exam-question="${esc(uid)}">
      <small>প্রশ্ন ${num(index + 1)} • ${num(question.marks)} নম্বর • ID ${esc(uid)}</small>
      <p>${esc(question.text)}</p>${options}
      ${perm.edit && !editing ? `<div class="exam-actions">${button('q-edit', 'প্রশ্ন সম্পাদনা', uid)}${button('q-delete', 'প্রশ্ন মুছুন', uid, 'danger')}</div>` : ''}
      ${editing ? questionFormMarkup(exam, question, uid, index) : ''}
    </article>`;
  }
  function questionFormMarkup(exam, question, uid, index) {
    return `<form class="exam-form exam-question-edit" data-question-form="${esc(uid)}">
      <label>প্রশ্নের লেখা<textarea name="text" rows="4" maxlength="1200" required>${esc(question.text)}</textarea></label>
      ${exam.type === 'mcq'
        ? `${['A', 'B', 'C', 'D'].map(id => { const option = question.options.find(item => item.id === id) || { text: '' }; return `<label>অপশন ${id}<input name="option-${id}" maxlength="500" required value="${esc(option.text)}"></label>`; }).join('')}
           <label>সঠিক উত্তর<select name="answer">${['A', 'B', 'C', 'D'].map(id => `<option value="${id}" ${question.answer === id ? 'selected' : ''}>${id}</option>`).join('')}</select></label>
           <p class="exam-note">MCQ-তে প্রতি প্রশ্নের নম্বর ১ নির্ধারিত (পূর্ণমান = প্রশ্ন সংখ্যা)।</p>`
        : `<label>নম্বর (১–১০০০)<input name="marks" type="number" min="1" max="1000" step="1" required value="${esc(question.marks)}"></label>`}
      <div class="exam-actions"><button type="submit" class="primary">প্রশ্ন ${num(index + 1)} সংরক্ষণ করুন</button>${button('q-cancel', 'বাতিল')}</div>
    </form>`;
  }
  function addQuestionMarkup(exam) {
    return `<details class="exam-card exam-question-add"><summary>+ নতুন প্রশ্ন যোগ করুন</summary>
      <form class="exam-form" data-question-add>
        <label>প্রশ্নের লেখা<textarea name="text" rows="4" maxlength="1200" required></textarea></label>
        ${exam.type === 'mcq'
          ? `${['A', 'B', 'C', 'D'].map(id => `<label>অপশন ${id}<input name="option-${id}" maxlength="500" required></label>`).join('')}
             <label>সঠিক উত্তর<select name="answer">${['A', 'B', 'C', 'D'].map(id => `<option value="${id}">${id}</option>`).join('')}</select></label>`
          : '<label>নম্বর (১–১০০০)<input name="marks" type="number" min="1" max="1000" step="1" required></label>'}
        <div class="exam-actions"><button type="submit" class="primary">প্রশ্ন যোগ করুন</button></div>
      </form></details>`;
  }
  function detail(exam) {
    view = 'detail'; selected = exam.id;
    const perm = permissionFor(exam);
    const steps = workflowSteps(exam.status);
    const reviewable = perm.review || perm.approve || perm.publish;
    content.innerHTML = `${back()}<article class="exam-card">${examRecord(exam)}
      <ol class="exam-timeline">${steps.map(step => `<li class="is-${step.state}">${esc(step.label)}</li>`).join('')}</ol>
      ${exam.reviewNote ? `<p class="exam-error">সংশোধনের মন্তব্য: ${esc(exam.reviewNote)}</p>` : ''}
      <p>${esc(exam.instructions || 'কোনো অতিরিক্ত নির্দেশনা নেই।')}</p>
      <p class="exam-note">প্রতি ভুলে কাটা: ${num(exam.negative)} • পাস ${num(exam.passPercent)}% • দেরিতে প্রবেশের সীমা ${num(exam.lateMinutes)} মিনিট • অংশগ্রহণকারী ${num((exam.participants || []).length)} জন</p>
      <div class="exam-actions">${button('questions', 'প্রশ্ন দেখুন', exam.id)}${button('paper', 'প্রশ্নপত্র PDF ডাউনলোড', exam.id)}${perm.edit ? button('edit', 'সম্পাদনা', exam.id) : ''}</div>
      ${perm.unpublish ? `<div class="exam-actions">${button('unpublish', 'Unpublish (শিক্ষার্থী আর দেখবে না)', exam.id)}</div>` : ''}
      ${perm.complete ? `<div class="exam-actions">${button('complete', 'সম্পন্ন হিসেবে চিহ্নিত করুন', exam.id)}</div>` : ''}
      ${reviewable ? reviewFormMarkup(exam, perm) : ''}
      </article>
      <h3 class="exam-section-title">প্রশ্ন ও নম্বর যাচাই</h3>
      ${questionPreview(exam, true)}`;
  }
  function reviewFormMarkup(exam, perm) {
    return `<form class="exam-form" data-review-form>
      <h3>প্রশ্ন যাচাই ও সিদ্ধান্ত</h3>
      <p class="exam-note">Status workflow: খসড়া → অনুমোদনের অপেক্ষায় → অনুমোদিত → প্রকাশিত → সম্পন্ন → আর্কাইভ।</p>
      <label>প্রতি ভুল উত্তরে কাটা নম্বর<input name="negative" type="number" min="0" max="1000" step="0.01" value="${num(exam.negative)}" ${exam.type !== 'mcq' ? 'readonly' : ''}></label>
      <label>সংশোধনের কারণ (ফেরত দিলে আবশ্যক)<textarea name="note" maxlength="500"></textarea></label>
      <div class="exam-actions">
        ${perm.approve ? '<button type="submit" name="decision" value="approve">অনুমোদন করুন</button>' : ''}
        ${perm.publish ? '<button type="submit" name="decision" value="publish" class="primary">অনুমোদন দিয়ে প্রকাশ করুন</button>' : ''}
        <button type="submit" name="decision" value="reject">সংশোধনের জন্য ফেরত দিন</button>
      </div>
    </form>`;
  }
  /* The authoring form is unchanged field-for-field (teachers know it), with
     the date-wise identity of the record shown underneath. */
  /** Subjects a teacher may offer: the Admin structure first, the teacher's own
      assignment next; a Manager/Admin sees the whole class list. A legacy value
      already stored on the record stays selectable so nothing is lost. */
  function subjectNamesFor(className, legacy = '') {
    const enabled = subjectsForClass(className).map(item => item.name);
    const assigned = role === 'teacher' ? subjectsForTeacherClass('teacher.apc', className) : [];
    const list = role === 'teacher' && assigned.length ? enabled.filter(name => assigned.includes(name)) : enabled;
    return [...new Set([...list, ...(legacy ? [legacy] : [])])];
  }
  function subjectSelectMarkup(className, value) {
    const options = subjectNamesFor(className, value);
    if (!options.length) return '<p class="exam-note">এই ক্লাসের জন্য Admin কোনো বিষয় চালু করেননি — Admin → ক্লাসের বিষয় ঠিক করুন থেকে চালু করুন।</p>';
    return `<select name="subject" required>${options.map(name => `<option value="${esc(name)}" ${name === value ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>`;
  }
  function editor(type, e = null) {
    view = 'edit'; selected = e?.id || null; openQuestion = null;
    const nextDay = new Date(Date.now() + 86400000); nextDay.setHours(18, 0, 0, 0);
    const localTime = ms => { const d = new Date(ms); return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
    const classNames = roleClasses();
    const data = e || { type, title: '', subject: '', className: classNames[0] || '', group: '', chapterName: '', topic: '', questionOrder: 'shuffle', optionOrder: 'shuffle', startAt: nextDay.getTime(), endAt: nextDay.getTime() + 3600000, lateMinutes: 10, negative: 0, passPercent: 33, template: '', instructions: '' };
    const classOptions2 = value => `<option value="">শ্রেণি নির্বাচন করুন</option>${classNames.map(c => `<option value="${esc(c)}" ${c === value ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
    const field = (name, label, kind = 'text', extra = '') => `<label>${label}<input name="${name}" type="${kind}" value="${esc(['startAt', 'endAt'].includes(name) ? localTime(data[name]) : data[name])}" ${extra}></label>`;
    content.innerHTML = `${back()}<h2>${e ? 'সম্পাদনা' : 'নতুন পরীক্ষা'} — ${EXAM_TYPES[type]}${e ? ` <small>(${esc(shortExamId(e.id))})</small>` : ''}</h2>
    <article class="exam-card exam-identity">
      <p class="exam-note">${e ? `প্রশ্নের unique ID: ${esc(e.id)}-q1 … ${esc(e.id)}-q${(e.questions || []).length} • সর্বশেষ হালনাগাদ ${esc(when(e.updatedAt || e.createdAt))}` : 'সংরক্ষণ করলেই প্রতিটি প্রশ্ন unique ID ও তারিখসহ আলাদা রেকর্ড হিসেবে সংরক্ষিত হবে।'}</p>
      ${e ? `<dl class="exam-record"><div><dt>প্রশ্ন সংখ্যা</dt><dd>${num((e.questions || []).length)}</dd></div><div><dt>পূর্ণমান</dt><dd>${num(totalMarks(e))}</dd></div><div><dt>পরীক্ষার তারিখ</dt><dd>${esc(examDateShort(examDateOf(e)))} • ${esc(durationLabel(examDurationMinutes(e)))}</dd></div><div><dt>তৈরি করেছেন</dt><dd>${esc(creatorName(e))}</dd></div><div><dt>অবস্থা</dt><dd>${statusTag(e)}</dd></div></dl>` : ''}
      <p class="exam-note" data-identity-preview>তারিখ ও সময় বদলালে রেকর্ডটি সেই তারিখের তালিকায় নতুন করে সাজবে।</p>
    </article>
    <form class="exam-form" data-exam-form>
      ${field('title', 'পরীক্ষার নাম *', 'text', 'required maxlength="150"')}
      <label>কোন শ্রেণির জন্য *<select name="className" required>${classOptions2(data.className)}</select></label>
      <label>কোন বিষয়ের পরীক্ষা *<span data-exam-subject-slot>${subjectSelectMarkup(data.className, data.subject)}</span></label>
      <label>অধ্যায়<input name="chapterName" maxlength="120" list="examChapters" value="${esc(data.chapterName || '')}" placeholder="যেমন: অধ্যায় ১ — বীজগণিত"><datalist id="examChapters" data-exam-chapters>${(data.className && data.subject ? listChapters(data.className, data.subject) : []).map(item => `<option value="${esc(item.name)}"></option>`).join('')}</datalist><small class="exam-note">এখানে লিখলে অধ্যায়টি Academic Setup-এও যুক্ত হবে, তাই পরের পরীক্ষায় তালিকায় পাবেন।</small></label>
      <label>টপিক / অংশ<input name="topic" maxlength="120" value="${esc(data.topic || '')}" placeholder="যেমন: বহুপদী সমীকরণ"></label>
      <label>প্রশ্নের ক্রম<select name="questionOrder"><option value="shuffle" ${data.questionOrder !== 'fixed' ? 'selected' : ''}>প্রতিটি শিক্ষার্থীর জন্য আলাদা ক্রম</option><option value="fixed" ${data.questionOrder === 'fixed' ? 'selected' : ''}>সবাই একই ক্রমে পাবে</option></select></label>
      <label>অপশনের ক্রম<select name="optionOrder"><option value="shuffle" ${data.optionOrder !== 'fixed' ? 'selected' : ''}>প্রতিটি শিক্ষার্থীর জন্য আলাদা ক্রম</option><option value="fixed" ${data.optionOrder === 'fixed' ? 'selected' : ''}>সবাই একই ক্রমে পাবে</option></select></label>
      <label>Batch / Group<input name="group" maxlength="80" list="examAssignedGroups" value="${esc(data.group || '')}" placeholder="Full-class assignment হলে ফাঁকা রাখুন"><datalist id="examAssignedGroups">${[...new Set(listTeacherAssignments('teacher.apc').filter(item => item.group).map(item => item.group))].map(group => `<option value="${esc(group)}"></option>`).join('')}</datalist></label>
      ${field('startAt', type === 'mcq' ? 'শুরুর সময় *' : 'প্রশ্ন ডাউনলোড শুরুর সময় *', 'datetime-local', 'required')}${field('endAt', type === 'mcq' ? 'সবার জন্য শেষ সময় *' : 'আজকের প্রস্তুতির শেষ সময় *', 'datetime-local', 'required')}
      <p class="exam-note">সময় এই মোবাইলের স্থানীয় সময় অনুযায়ী। পরীক্ষার তারিখ ও সময়কাল নিচে আলাদা করে দেখানো হয়। ${type === 'mcq' ? 'মোট দুইবার; চলমান প্রথম-প্রচেষ্টার গড়ের নিচে থাকলে দ্বিতীয় সুযোগ। সময় বাড়বে না। সেরা নম্বর ফলাফলে থাকবে।' : 'শুরুর তারিখের পরের দিন (বাংলাদেশ সময়) ক্লাসে পরীক্ষা হবে। শিক্ষার্থী PDF নেবে, খাতায় উত্তর দেবে।'}</p>
      <p class="exam-note" data-duration-readout></p>
      ${type === 'mcq' ? field('lateMinutes', 'দেরিতে প্রথম প্রবেশ: শুরুর পর কত মিনিট', 'number', 'required min="1" step="1"') : ''}
      ${type === 'mcq' ? field('negative', 'প্রতি ভুল উত্তরে কাটা নম্বর (০ হলে কাটবে না)', 'number', 'min="0" max="1000" step="0.01" required') : ''}
      ${field('passPercent', 'পাস নম্বরের হার (%)', 'number', 'min="1" max="100" required')}
      <label>নির্দেশনা<textarea name="instructions" maxlength="2000">${esc(data.instructions)}</textarea></label>

      <section class="exam-template-panel" data-exam-type="${type}" aria-labelledby="examTemplateTitle">
        <h3 id="examTemplateTitle">${EXAM_TYPES[type]} প্রশ্নের টেমপ্লেট — কপি করে পেস্ট করুন</h3>
        <p class="exam-note">নমুনা বেছে নিন, <strong>টেমপ্লেট কপি করুন</strong>, তারপর নিচের ঘরে পেস্ট করে বিষয় অনুযায়ী প্রশ্ন লিখুন। প্রশ্ন আলাদা করতে <strong>---</strong> দিন।${type === 'mcq' ? '' : ' প্রতি প্রশ্নের নম্বর আলাদা লাইনে লিখুন।'}</p>
        <label class="exam-template-picker">নমুনা টেমপ্লেট নির্বাচন করুন<select data-template-index>${EXAM_SAMPLE_TEMPLATES[type].map(([name], index) => `<option value="${index}">${index + 1}. ${esc(name)}</option>`).join('')}</select></label>
        <div class="exam-actions">${button('copy-template', 'টেমপ্লেট কপি করুন', '', 'primary')}${button('use-template', 'টেমপ্লেট বসান')}${type === 'mcq' ? button('sample-30', '৩০টি নমুনা বসান') + button('copy-sample-30', '৩০টি নমুনা কপি করুন') : ''}</div>
        <textarea data-copy-template readonly aria-label="কপি করার টেমপ্লেট">${esc(EXAM_SAMPLE_TEMPLATES[type][0][1])}</textarea>
      </section>

      <label>টেমপ্লেট অনুযায়ী প্রশ্ন পেস্ট করুন *<textarea name="template" data-question-source rows="12" required maxlength="150000" placeholder="${type === 'mcq' ? 'প্রশ্ন: …\nA: …\nB: …\nC: …\nD: …\nউত্তর: A' : 'প্রশ্ন: …\nনম্বর: …'}">${esc(data.template)}</textarea><small class="exam-note">${type === 'mcq' ? 'MCQ-তে প্রতি প্রশ্নের নম্বর ১ নির্ধারিত — “নম্বর:” লাইন লিখতে হবে না। মোট নম্বর = প্রশ্ন সংখ্যা।' : 'প্রতি প্রশ্নের নম্বর আলাদা করে লিখুন।'}</small></label>
      <div class="exam-preview" data-parsed-preview aria-live="polite"></div>
      <button type="submit" class="primary">খসড়া সংরক্ষণ করুন</button>
    </form>`;
    function refreshIdentity() {
      const startAt = new Date($('[name=startAt]').value).getTime(), endAt = new Date($('[name=endAt]').value).getTime();
      const readout = $('[data-duration-readout]');
      if (readout) readout.textContent = Number.isFinite(startAt) && Number.isFinite(endAt) && endAt > startAt
        ? `পরীক্ষার তারিখ: ${examDateShort(examDateFor(type, startAt))} • সময়কাল: ${durationLabel((endAt - startAt) / 60000)}`
        : 'সঠিক শুরু ও শেষ সময় দিন।';
    }
    function repaintSubjects() {
      const slot = $('[data-exam-subject-slot]');
      if (!slot) return;
      const current = String($('[name=subject]')?.value || data.subject || '');
      slot.innerHTML = subjectSelectMarkup($('[name=className]').value, current);
      repaintChapters();
    }
    /** The chapter list follows the class+subject pair (cascading pickers). */
    function repaintChapters() {
      const list = $('[data-exam-chapters]');
      if (!list) return;
      const className = $('[name=className]').value, subject = $('[name=subject]')?.value || '';
      list.innerHTML = (className && subject ? listChapters(className, subject) : [])
        .map(item => `<option value="${esc(item.name)}"></option>`).join('');
    }
    function preview() {
      try {
        const questions = parseQuestions($('[name=template]').value, type);
        const total = totalMarks({ questions });
        $('[data-parsed-preview]').innerHTML = `<strong>${num(questions.length)}টি প্রশ্ন • মোট ${num(total)} নম্বর${type === 'mcq' ? ` • ${num(questions.length)} মিনিট পরীক্ষা` : ''}</strong>${questionPreview({ questions }, true)}`;
      } catch (e) {
        $('[data-parsed-preview]').textContent = e.message;
      }
    }
    $('[data-template-index]')?.addEventListener('change', () => {
      const sample = selectedTemplate();
      if (sample) $('[data-copy-template]').value = sample;
    });
    $('[name=className]').addEventListener('input', repaintSubjects);
    $('[name=className]').addEventListener('change', repaintSubjects);
    $('[name=subject]')?.addEventListener('change', repaintChapters);
    $('[name=template]').addEventListener('input', preview);
    $('[name=startAt]')?.addEventListener('change', refreshIdentity);
    $('[name=endAt]')?.addEventListener('change', refreshIdentity);
    refreshIdentity(); preview();
    $('[data-exam-form]').addEventListener('submit', event => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      run(async () => {
        /* A chapter typed into the paper is registered in Academic Setup first,
           so every later examination can pick it from the list. */
        if (String(values.chapterName || '').trim()) await ensureChapter(values.className, values.subject, values.chapterName, actor.role === 'teacher' ? 'TEACHER' : 'MANAGER');
        return repo.saveDraft({ ...values, type, id: e?.id, startAt: new Date(values.startAt).getTime(), endAt: new Date(values.endAt).getTime() }, actor);
      }, 'খসড়া সংরক্ষিত। এখন অনুমতির জন্য পাঠাতে পারেন।', () => home());
    });
    scrollTop();
  }
  function report(e, reset = true) {
    view = 'report'; selected = e.id;
    content.innerHTML = `${back()}${examRecord(e)}<div class="exam-actions">${button('csv', 'রিপোর্ট ডাউনলোড (CSV)', e.id)}${button('solutions', 'সঠিক উত্তরপত্র PDF', e.id)}${button('paper', 'প্রশ্নপত্র PDF', e.id)}</div>${resultMarkup(db, e, true, { pdf: true })}`;
    if (reset) scrollTop();
  }
  async function grade(e) {
    view = 'grade'; selected = e.id;
    const students = await repo.listStudents();
    content.innerHTML = `${back()}${examRecord(e)}<p class="exam-note">ক্লাসে খাতা দেখে প্রশ্নভিত্তিক নম্বর দিন। উপস্থিত না থাকলে অনুপস্থিত হিসেবে রাখুন।</p><form class="exam-form" data-grade-form><label>শিক্ষার্থী<select name="studentId" required><option value="">শিক্ষার্থী নির্বাচন করুন</option>${students.map(s => `<option value="${esc(s.id)}">${esc(s.name)} • ${esc(s.className)} • ${esc(s.id)}</option>`).join('')}</select></label>${e.questions.map(q => `<label>${esc(q.text)} (পূর্ণমান ${num(q.marks)})<input name="${q.id}" type="number" min="0" max="${q.marks}" step="0.01" placeholder="নম্বর দিন"></label>`).join('')}<div class="exam-actions"><button type="submit" name="decision" value="marks" class="primary">নম্বর প্রকাশ করুন</button><button type="submit" name="decision" value="absent">অনুপস্থিত রাখুন</button></div></form>`;
    $('[name=studentId]').addEventListener('change', event => { const saved = db.attempts.find(a => a.examId === e.id && a.studentId === event.target.value); e.questions.forEach(q => { $(`[name=${q.id}]`).value = saved?.questionScores?.[q.id] ?? ''; }); });
    $('[data-grade-form]').addEventListener('submit', event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const student = students.find(s => s.id === values.studentId); run(() => event.submitter.value === 'absent' ? repo.markWrittenAbsent(e.id, student, actor) : repo.saveWrittenScore(e.id, student, values, actor), 'নম্বর/উপস্থিতি সংরক্ষিত হয়েছে।', () => grade(db.exams.find(item => item.id === e.id))); });
    scrollTop();
  }

  /* ---------- loading + running ------------------------------------------- */

  /** Paint the view the user is looking at from the in-memory snapshot. */
  function paint() {
    if (view === 'home') home();
    else if (view === 'upcoming') upcoming();
    else if (view === 'archive') archive();
    else if (view === 'bank') bankView();
    else if (view === 'edit') { /* the open editor keeps the typed values */ }
    else if (selected) { const exam = db.exams.find(item => item.id === selected); if (exam) repaintSelected(exam); else home(); }
    else home();
  }
  async function reload() {
    try {
      db = await repo.list(actor); ready = true;
      paint();
      /* The shelf keeps every paper the students have actually sat. This is
         the backfill for exams published before auto-shelving existed; the
         check is a no-op on a device whose bank is already current, and a
         failure here must never block the examination screens. */
      ensureExamsInBank(db.exams, actor.role === 'teacher' ? 'Teacher' : 'Manager')
        .then(result => {
          if (result.added > 0 && !busy && view === 'bank') bankView();
        })
        .catch(() => { /* shelf backfill is best-effort */ });
    } catch (e) { ready = false; error(e.message || 'পরীক্ষার ডেটা পড়া যায়নি।'); }
  }
  function repaintSelected(exam) {
    if (view === 'questions') questions(exam);
    else if (view === 'detail') detail(exam);
    else if (view === 'report') report(exam, false);
    else if (view === 'grade') grade(exam);
  }
  async function run(operation, success, next) {
    /* A second tap while the first save is still finishing must never look
       like a silent failure — say what is happening instead. */
    if (busy) { message('আগের কাজটি শেষ হচ্ছে — এক মুহূর্ত পর আবার চেষ্টা করুন।'); return; }
    if (!ready) return;
    busy = true; error(''); message(''); root.setAttribute('aria-busy', 'true');
    const controls = [...root.querySelectorAll('button, input, select, textarea')]; controls.forEach(el => { el.disabled = true; });
    try {
      const snapshot = await operation(); if (snapshot?.exams) db = snapshot;
      await next?.();
      /* A workflow decision has no follow-up view: repaint the one that is
         open so the status tag and the allowed buttons change at once. */
      if (!next && view !== 'edit') paint();
      message(success);
    }
    catch (e) { error(e instanceof DOMException ? 'সংরক্ষণ/ডাউনলোড হয়নি। ব্রাউজারের স্টোরেজ পরীক্ষা করে আবার চেষ্টা করুন।' : e.message || 'সংরক্ষণ হয়নি। আবার চেষ্টা করুন।'); }
    finally { busy = false; root.removeAttribute('aria-busy'); controls.forEach(el => { el.disabled = false; }); }
  }
  /* What the teacher sees after asking to copy or to insert a template. */
  const COPY_DONE = 'টেমপ্লেট কপি হয়েছে। এখন নিচের ঘরে পেস্ট করে নিজের প্রশ্ন লিখুন।';
  const COPY_MANUAL = 'টেমপ্লেট নির্বাচন করা হয়েছে। মোবাইলের কপি অপশন চাপুন।';
  const COPY_DONE_INSERT = 'নির্বাচিত টেমপ্লেট বসানো হয়েছে। নিচে নিজের প্রশ্ন লিখুন।';
  function currentExamType() { return $('.exam-template-panel')?.dataset.examType || ''; }
  function selectedTemplate() {
    const type = currentExamType();
    const list = EXAM_SAMPLE_TEMPLATES[type] || [];
    const index = Number($('[data-template-index]')?.value || 0);
    return (list[index] || list[0] || [null, examTemplate(type)])[1];
  }
  const applyFilters = () => { filters = normalizeFilters(filters); view === 'archive' ? archive() : home(); message(''); };
  function readFilterForm() {
    const form = $('[data-exam-filters]'); if (!form) return;
    const values = Object.fromEntries(new FormData(form));
    filters = normalizeFilters({ ...filters, ...values });
  }

  root.addEventListener('change', event => {
    if (busy) return;
    if (event.target.closest('[data-exam-filters]')) { readFilterForm(); applyFilters(); return; }
    if (event.target.closest('[data-bank-filters]')) {
      bankFilters = { ...bankFilters, ...Object.fromEntries(new FormData(event.target.closest('[data-bank-filters]'))) };
      bankPage = 0;
      bankView();
    }
  });
  root.addEventListener('input', event => {
    const field = event.target.closest('[data-exam-filters] [name=query]'); if (!field || busy) return;
    const caret = field.selectionStart;
    filters = normalizeFilters({ ...filters, query: field.value });
    applyFilters();
    const restored = root.querySelector('[data-exam-filters] [name=query]');
    if (restored) { restored.focus(); if (caret !== null) restored.setSelectionRange(caret, caret); }
  });
  root.addEventListener('submit', async event => {
    const filterForm = event.target.closest('[data-exam-filters]');
    if (filterForm) { event.preventDefault(); readFilterForm(); applyFilters(); return; }
    const bankFilterForm = event.target.closest('[data-bank-filters]');
    if (bankFilterForm) {
      event.preventDefault();
      bankFilters = { ...bankFilters, ...Object.fromEntries(new FormData(bankFilterForm)) };
      bankPage = 0; bankView(); return;
    }
    const bankForm = event.target.closest('[data-bank-form]');
    if (bankForm) {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(bankForm));
      const id = bankForm.dataset.bankForm;
      const payload = {
        id: id || undefined, type: values.type, text: values.text, className: values.className, subject: values.subject,
        chapterName: values.chapterName, topic: values.topic, difficulty: values.difficulty,
        marks: values.marks, answer: values.answer, answerText: values.answerText,
        options: ['A', 'B', 'C', 'D'].map(letter => ({ id: letter, text: values[`option-${letter}`] }))
      };
      run(async () => {
        bankEditing = '';
        if (String(values.chapterName || '').trim()) await ensureChapter(values.className, values.subject, values.chapterName, actor.role === 'teacher' ? 'TEACHER' : 'MANAGER');
        return questionBank.save(payload, actor.role === 'teacher' ? 'Teacher' : 'Manager');
      }, 'প্রশ্ন সংরক্ষণ করা হয়েছে।', () => bankView());
      return;
    }
    const questionForm = event.target.closest('[data-question-form]');
    if (questionForm) {
      event.preventDefault(); const payload = Object.fromEntries(new FormData(questionForm));
      const patch = {
        text: payload.text,
        marks: payload.marks,
        answer: payload.answer,
        options: payload['option-A'] === undefined ? undefined : ['A', 'B', 'C', 'D'].map(id => ({ id, text: payload[`option-${id}`] }))
      };
      const exam = db.exams.find(item => item.id === selected);
      run(() => repo.updateQuestion(exam.id, questionForm.dataset.questionForm, patch, actor), 'প্রশ্ন সংরক্ষিত হয়েছে।', () => { openQuestion = null; questions(db.exams.find(item => item.id === exam.id)); });
      return;
    }
    const addForm = event.target.closest('[data-question-add]');
    if (addForm) {
      event.preventDefault(); const payload = Object.fromEntries(new FormData(addForm));
      const exam = db.exams.find(item => item.id === selected);
      run(() => repo.addQuestion(exam.id, {
        text: payload.text, marks: payload.marks, answer: payload.answer,
        options: ['A', 'B', 'C', 'D'].map(id => ({ id, text: payload[`option-${id}`] }))
      }, actor), 'নতুন প্রশ্ন যোগ হয়েছে।', () => questions(db.exams.find(item => item.id === exam.id)));
    }
  });
  /* Screen-only actions (opening the shelf, turning a page, opening an editor)
     never touch storage, so they stay usable even while a save is finishing. */
  const VIEW_ONLY_ACTIONS = new Set(['list', 'view-history', 'view-upcoming', 'view-archive', 'bank', 'bank-reset', 'bank-page', 'bank-new', 'bank-edit', 'bank-cancel']);
  root.addEventListener('click', async event => {
    const target = event.target.closest('[data-exam-action]'); if (!target) return;
    const action = target.dataset.examAction;
    if (!VIEW_ONLY_ACTIONS.has(action) && busy) return;
    const e = db.exams.find(item => item.id === target.dataset.id) || db.exams.find(item => item.id === selected);
    error(''); message('');
    if (action === 'list') { home(); scrollTop(); }
    else if (!ready) error('ডেটা লোড হয়নি। পেজ রিফ্রেশ করুন।');
    else if (action === 'view-history') home();
    else if (action === 'view-upcoming') upcoming();
    else if (action === 'view-archive') archive();
    else if (action === 'bank') { bankPage = 0; bankEditing = ''; bankView(); }
    else if (action === 'bank-reset') { bankFilters = { query: '', className: 'all', subject: 'all', chapter: 'all', type: 'all', difficulty: 'all' }; bankPage = 0; bankView(); }
    else if (action === 'bank-page') { bankPage = Math.max(0, Number(target.dataset.page) || 0); bankView(); }
    else if (action === 'bank-new') { bankEditing = 'new'; bankView(); }
    else if (action === 'bank-edit') { bankEditing = bankEditing === target.dataset.id ? '' : target.dataset.id; bankView(); }
    else if (action === 'bank-cancel') { bankEditing = ''; bankView(); }
    else if (action === 'bank-toggle') run(() => questionBank.setActive(target.dataset.id, !questionById(target.dataset.id)?.active, actor.role === 'teacher' ? 'Teacher' : 'Manager'), 'প্রশ্নটি হালনাগাদ হয়েছে।', () => bankView());
    else if (action === 'bank-delete' && window.confirm('এই প্রশ্নটি প্রশ্ন ব্যাংক থেকে মুছবেন? কোনো পরীক্ষার প্রশ্ন বা ফলাফল মুছে যাবে না।')) run(() => questionBank.remove(target.dataset.id, actor.role === 'teacher' ? 'Teacher' : 'Manager'), 'প্রশ্নটি ব্যাংক থেকে মুছে ফেলা হয়েছে; পরীক্ষাগুলো অক্ষত আছে।', () => bankView());
    else if (action === 'bank-add') {
      const exam = db.exams.find(item => item.id === selected);
      const row = questionById(target.dataset.id);
      if (!exam || !row) error('প্রশ্ন বা পরীক্ষা খুঁজে পাওয়া যায়নি।');
      else run(() => repo.addQuestion(exam.id, questionForExam(row, exam.type), actor), 'নির্বাচিত প্রশ্নটি পরীক্ষায় যোগ হয়েছে।', () => questions(db.exams.find(item => item.id === exam.id)));
    }
    else if (action === 'save-to-bank') {
      const exam = db.exams.find(item => item.id === target.dataset.id) || e;
      run(async () => { const result = await questionBank.saveFromExam(exam, actor.role === 'teacher' ? 'Teacher' : 'Manager'); return result; }, 'প্রশ্নগুলো প্রশ্ন ব্যাংকে সংরক্ষিত হয়েছে।', () => questions(db.exams.find(item => item.id === exam.id)));
    }
    else if (action === 'student-pdf') {
      const attempt = db.attempts.find(item => item.id === target.dataset.attempt);
      run(() => downloadExamPDF(e, { attempt, authorPreview: true }), 'শিক্ষার্থীর উত্তরপত্র PDF ডাউনলোড শুরু হয়েছে।', () => {});
    }
    else if (action === 'filters-reset') { filters = { ...EXAM_FILTERS }; applyFilters(); }
    else if (action === 'filter-type') { const order = ['all', ...Object.keys(EXAM_TYPES)]; filters = normalizeFilters({ ...filters, type: order[(order.indexOf(filters.type) + 1) % order.length] }); applyFilters(); }
    else if (action.startsWith('new-')) editor(action.slice(4));
    else if (action === 'edit') editor(e.type, e);
    else if (action === 'questions') questions(e);
    else if (action === 'detail') detail(e);
    else if (action === 'q-edit') { openQuestion = target.dataset.id; questions(db.exams.find(item => item.id === selected)); scrollTop(); }
    else if (action === 'q-cancel') { openQuestion = null; questions(db.exams.find(item => item.id === selected)); }
    else if (action === 'q-delete' && window.confirm('এই প্রশ্নটি মুছে ফেলবেন? বাকি প্রশ্ন ও পরীক্ষার অন্য কোনো তথ্য মুছে যাবে না।')) {
      const exam = db.exams.find(item => item.id === selected);
      run(() => repo.deleteQuestion(exam.id, target.dataset.id, actor), 'প্রশ্ন মুছে ফেলা হয়েছে। বাকি প্রশ্ন অক্ষত আছে।', () => questions(db.exams.find(item => item.id === exam.id)));
    }
    else if (action === 'request') run(() => repo.requestApproval(e.id, actor), 'Manager-এর অনুমতির জন্য পাঠানো হয়েছে।');
    else if (action === 'approve' && window.confirm('পরীক্ষাটি অনুমোদন করবেন? এরপর প্রকাশ করা যাবে।')) run(() => repo.approve(e.id, actor), 'পরীক্ষা অনুমোদিত হয়েছে — এখন প্রকাশ করা যাবে।');
    else if (action === 'publish' && window.confirm('পরীক্ষাটি প্রকাশ করবেন? তারপর শিক্ষার্থীরা নির্ধারিত সময়ে প্রশ্ন দেখতে পাবে।')) run(() => repo.publish(e.id, actor), 'পরীক্ষা প্রকাশিত হয়েছে।');
    else if (action === 'unpublish' && window.confirm('Unpublish করলে শিক্ষার্থীরা পরীক্ষাটি আর দেখতে পাবে না। সংরক্ষিত উত্তর ও ফলাফল মুছে যাবে না — আবার প্রকাশ করলে ফিরে আসবে।')) run(() => repo.unpublish(e.id, actor), 'পরীক্ষাটি Unpublish করা হয়েছে — প্রশ্ন ও ফলাফল অক্ষত আছে।');
    else if (action === 'complete' && window.confirm('পরীক্ষাটি সম্পন্ন হিসেবে চিহ্নিত করবেন? ফলাফল ও উত্তর অক্ষত থাকবে।')) run(() => repo.complete(e.id, actor), 'পরীক্ষাটি সম্পন্ন হিসেবে চিহ্নিত হয়েছে।');
    else if (action === 'archive' && window.confirm('পরীক্ষাটি আর্কাইভে সরাবেন? কোনো ডেটা মুছে যাবে না; পরে “ফিরিয়ে আনুন” দিয়ে ফেরানো যাবে।')) run(() => repo.archive(e.id, actor), 'পরীক্ষাটি আর্কাইভ করা হয়েছে।');
    else if (action === 'restore' && window.confirm('আর্কাইভ থেকে ফিরিয়ে আনবেন?')) run(() => repo.restore(e.id, actor), 'পরীক্ষাটি আর্কাইভ থেকে ফিরে এসেছে।');
    else if (action === 'duplicate' && window.confirm('এই প্রশ্নগুলো দিয়ে নতুন খসড়া পরীক্ষা বানাবেন? মূল পরীক্ষা অপরিবর্তিত থাকবে।')) {
      run(() => repo.duplicate(e.id, actor), 'নতুন খসড়া তৈরি হয়েছে — তারিখ ও শ্রেণি দেখে নিন।', () => {
        const copy = [...db.exams].filter(item => item.copiedFrom === e.id).sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
        if (copy) editor(copy.type, copy); else home();
      });
    }
    else if (action === 'delete' && window.confirm(`“${e.title}” পরীক্ষাটি মুছে ফেলবেন? প্রশ্ন, নম্বর ও সময়সূচি সব মুছে যাবে — এটি ফেরানো যাবে না।`)) run(() => repo.deleteExam(e.id, actor), 'পরীক্ষাটি মুছে ফেলা হয়েছে।');
    else if (action === 'report') report(e);
    else if (action === 'grade') { try { await grade(e); } catch (err) { error(err.message); } }
    else if (action === 'csv') downloadResults(db, e);
    else if (action === 'paper' || action === 'solutions') run(() => downloadExamPDF(e, { authorPreview: true, solutions: action === 'solutions' }), 'PDF ডাউনলোড শুরু হয়েছে।', () => {});
    else if (action === 'use-template') { const sample = selectedTemplate(); if (sample) { $('[name=template]').value = sample; $('[name=template]').dispatchEvent(new Event('input')); message(COPY_DONE_INSERT); } }
    else if (action === 'copy-template') { try { await navigator.clipboard.writeText($('[data-copy-template]').value); message(COPY_DONE); } catch { $('[data-copy-template]').select(); message(COPY_MANUAL); } }
    else if (action === 'copy-sample-30') { try { await navigator.clipboard.writeText(MCQ_30_SAMPLE); message('৩০টি MCQ নমুনা কপি হয়েছে।'); } catch { $('[name=template]').value = MCQ_30_SAMPLE; $('[name=template]').select(); message('৩০টি নমুনা নির্বাচন করা হয়েছে। মোবাইলের কপি অপশন চাপুন।'); } }
    else if (action === 'sample-30') { $('[name=template]').value = MCQ_30_SAMPLE; $('[name=template]').dispatchEvent(new Event('input')); }
  });
  watchExams(() => { if (!busy && view !== 'edit') reload(); });
  watchQuestionBank(() => { if (!busy && view === 'bank' && !root.querySelector('[data-bank-form]')) bankView(); });
  /* Reading the shelf once on open keeps the counters honest without ever
     rendering the whole question list. */
  try { repo.ensureCodes(); } catch { /* codes are stamped on the next write */ }
  reload();
}
