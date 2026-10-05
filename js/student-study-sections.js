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
import { classByName, subjectsForClass, listChapters } from './academics.js';
import { listCourseContent, typeOf as courseTypeOf } from './course-content.js';
import { listQuestionsForStudent, QUESTION_TYPES } from './question-bank.js';

const SELECTORS = {
  bar: '#studySections',
  bank: { subject: '#studyBankSubject', chapter: '#studyBankChapter', list: '#studyBankList', count: '#studyBankCount', error: '#studyBankError' },
  suggestion: { subject: '#studySuggestionSubject', chapter: '#studySuggestionChapter', list: '#studySuggestionList', count: '#studySuggestionCount', error: '#studySuggestionError' },
  materials: { subject: '#studyMaterialSubject', chapter: '#studyMaterialChapter', list: '#studyMaterialsList', count: '#studyMaterialsCount', error: '#studyMaterialsError' }
};
const SECTIONS = Object.freeze(['courses', 'homework', 'suggestion', 'bank', 'materials']);
const BANK_TYPES = Object.freeze({ mcq: ['mcq'], short: ['short_answer', 'true_false'], written: ['written'] });
const SUGGESTION_TYPES = Object.freeze({
  important: record => courseTypeOf(record) === 'important_question',
  written: record => courseTypeOf(record) === 'suggestion',
  mcq: record => courseTypeOf(record) === 'mcq',
  pdf: record => courseTypeOf(record) === 'pdf' || /^https?:\/\//i.test(record.attachmentUrl || '')
});
const SUGGESTION_SECTIONS = Object.freeze(['suggestion', 'important']);
const MATERIAL_TYPES = Object.freeze({
  all: () => true,
  note: record => courseTypeOf(record) === 'note',
  pdf: record => courseTypeOf(record) === 'pdf' || (courseTypeOf(record) === 'lesson' && /^https?:\/\//i.test(record.attachmentUrl || '')),
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

export function initStudentStudySections({ getStudent, teaching = null } = {}) {
  const bar = $(SELECTORS.bar);
  if (!bar) return () => {};
  let section = 'courses';
  let bankTypes = new Set();
  let bankSubject = '', bankChapter = '', bankRows = [], bankReady = false, bankError = '';
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
    const link = /^https?:\/\//i.test(record.attachmentUrl || '') ? record.attachmentUrl : '';
    const body = text(record.content || record.description || '').slice(0, 600);
    return `<article class="course-item" data-study-item="${esc(record.id)}">
      <header class="course-item-head"><span class="course-item-type">${esc(record.type === 'pdf' ? 'PDF' : record.type === 'important_question' ? 'গুরুত্বপূর্ণ প্রশ্ন' : record.type === 'model_test' ? 'মডেল টেস্ট' : record.type === 'previous_question' ? 'পূর্বের প্রশ্ন' : record.type === 'mcq' ? 'MCQ' : 'নোট')}</span>
        <div><h3>${esc(record.title)}</h3><small>${esc([text(record.subject) || '', chapterOf(record)].filter(Boolean).join(' • '))}</small></div></header>
      ${body ? `<div class="course-item-body">${esc(body).replace(/\n/g, '<br>')}</div>` : ''}
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
    list.innerHTML = !bankReady
      ? '<p class="teacher-empty">প্রশ্নব্যাংক লোড হচ্ছে…</p>'
      : rows.length
        ? rows.map(questionCard).join('')
        : `<p class="teacher-empty">${bankError || 'এই ফিল্টারে কোনো প্রশ্ন পাওয়া যায়নি।'}</p>`;
    const count = $(SELECTORS.bank.count);
    if (count) count.textContent = `${num(rows.length)}টি প্রশ্ন • ${text(student().className) || 'শ্রেণি'}`;
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

  function paintCounts() {
    const counts = teaching?.activityCounts?.() || { homework: 0, suggestion: 0 };
    const set = (key, value) => {
      const badge = bar.querySelector(`[data-study-count="${key}"]`);
      if (badge) badge.textContent = num(value);
    };
    set('courses', subjects().length);
    set('homework', counts.homework || 0);
    set('suggestion', (counts.suggestion || 0) + suggestionRecords.length);
    set('bank', bankRows.length);
    set('materials', materialRecords.length);
  }

  function paintPanels() {
    document.querySelectorAll('[data-study-panel]').forEach(panel => { panel.hidden = panel.dataset.studyPanel !== section; });
    const board = $('#learningBoard');
    const slot = document.querySelector(`[data-study-panel="${section}"] [data-study-slot="board"]`);
    if (board && slot && board.parentElement !== slot) slot.appendChild(board);
    if (section === 'homework' || section === 'suggestion') {
      teaching?.setScope?.(section);
      teaching?.setSubject?.(section === 'suggestion' ? suggestionSubject : '');
    }
  }

  function open(next, { history = 'push' } = {}) {
    if (!SECTIONS.includes(next)) return;
    section = next;
    bar.querySelectorAll('[data-study-section]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.studySection === next)));
    paintPanels();
    /* A load that ran before sign-in (or while offline) must not freeze an
       empty shelf: opening the section retries it. */
    if (next === 'bank') { if (bankError) void loadBank(); else renderBank(); }
    if (next === 'suggestion') renderSuggestion();
    if (next === 'materials') renderMaterials();
    void history;
  }

  /* ---- data ---------------------------------------------------------------- */

  async function loadBank() {
    const current = ++request;
    try {
      const rows = await listQuestionsForStudent(student().id);
      if (current !== request) return;
      bankRows = Array.isArray(rows) ? rows : [];
      bankReady = true; bankError = '';
    } catch (error) {
      if (current !== request) return;
      bankRows = []; bankReady = true;
      bankError = 'প্রশ্নব্যাংক লোড হয়নি। আবার চেষ্টা করো।';
      const node = $(SELECTORS.bank.error);
      if (node) { node.hidden = false; node.textContent = bankError; }
      void error;
    }
    renderBank(); paintCounts();
  }

  function loadShelves() {
    try {
      const rows = recordsFor();
      /* Both shelves read the same published course-content store; the section
         picks which record types it shows (nothing is copied anywhere). */
      suggestionRecords = rows.filter(record => SUGGESTION_SECTIONS.includes(courseTypeOf(record))
        || ['mcq', 'pdf'].includes(courseTypeOf(record)));
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
    loadShelves();
    await loadBank();
  }

  /* ---- events -------------------------------------------------------------- */

  bar.addEventListener('click', event => {
    const button = event.target.closest('[data-study-section]');
    if (button) open(button.dataset.studySection);
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

  const onSelect = (select, apply) => select?.addEventListener('change', () => { apply(select.value); });
  onSelect($(SELECTORS.bank.subject), value => { bankSubject = value; bankChapter = ''; fillFilters(); renderBank(); });
  onSelect($(SELECTORS.bank.chapter), value => { bankChapter = value; renderBank(); });
  onSelect($(SELECTORS.suggestion.subject), value => { suggestionSubject = value; suggestionChapter = ''; fillFilters(); teaching?.setSubject?.(value); renderSuggestion(); });
  onSelect($(SELECTORS.suggestion.chapter), value => { suggestionChapter = value; renderSuggestion(); });
  onSelect($(SELECTORS.materials.subject), value => { materialSubject = value; materialChapter = ''; fillFilters(); renderMaterials(); });
  onSelect($(SELECTORS.materials.chapter), value => { materialChapter = value; renderMaterials(); });

  window.addEventListener('apc-course-updated', () => void refresh());
  window.addEventListener('apc-academics-updated', () => void refresh());
  window.addEventListener('teaching-data-updated', () => { loadShelves(); });
  window.addEventListener('storage', event => {
    if (event.key === null || /activePlus\.(courseContent|academics|teaching)/.test(event.key || '')) void refresh();
  });

  open('courses');
  void refresh();
  const api = () => refresh();
  api.open = open;
  api.refresh = refresh;
  api.currentSection = () => section;
  return api;
}
