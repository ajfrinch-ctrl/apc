import { iconMarkup } from './icons.js';
/* Data-driven student home dashboard. The UI only shows records already stored
   for this student; absent classes, results or fees are never filled with demo values. */
import { loadRoutine, WEEK_DAYS, ROUTINE_KEY } from './office-data.js';
import { teachingRepository, publishedForStudent } from './teaching-data.js';
import { examRepository, examMatchesStudent, watchExams, isStudentVisibleExam } from './exam-data.js';
import { financeRepository, studentFeeSummary } from './finance-data.js';
import { toBanglaNumber as bn } from './ui.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const DAY_FOR_DATE = ['sun', 'mon', 'tue', 'wed', 'thu', null, 'sat'];

function iconFor(subject = '') {
  const text = String(subject).toLowerCase();
  if (/গণিত|math/.test(text)) return 'icon-trending';
  if (/পদার্থ|physics/.test(text)) return 'icon-award';
  if (/পরীক্ষা|test|exam/.test(text)) return 'icon-clipboard';
  return 'icon-book';
}

function routineCard(item, index, kind = 'class') {
  const title = kind === 'teacher' ? item.title : item.subject;
  const subtitle = kind === 'teacher' ? `${item.subject} · ${item.teacherName}` : `${item.teacher || 'শিক্ষক নির্ধারিত'}${item.room ? ` · ${item.room}` : ''}`;
  const time = kind === 'teacher' ? item.time : `${item.period || ''} ${item.time || ''}`.trim();
  return `<article class="dashboard-routine-card" data-dashboard-class="${esc(item.id || index)}">
    <span class="dashboard-routine-icon tone-${index % 3}" aria-hidden="true">${iconMarkup(iconFor(title))}</span>
    <span class="dashboard-routine-main"><strong>${esc(title)}</strong><small>${esc(subtitle)}</small><span class="dashboard-time-pill">${esc(time || 'সময় দেওয়া হয়নি')}</span></span>
    <span class="dashboard-routine-status"><i></i>${kind === 'teacher' ? 'শিক্ষকের কাজ' : 'রুটিনে আছে'}</span>
  </article>`;
}

function renderRoutine(student, teachingActivities) {
  const key = DAY_FOR_DATE[new Date().getDay()];
  const dayClasses = key ? loadRoutine()[key]?.classes || [] : [];
  const matchesClass = item => !item.className || !student.className || item.className === student.className;
  const officeClasses = dayClasses.filter(matchesClass);
  const today = new Date().toLocaleDateString('en-CA');
  const teacherClasses = teachingActivities.filter(item => item.type === 'routine' && item.date === today);
  const cards = [
    ...officeClasses.map((item, index) => routineCard(item, index)),
    ...teacherClasses.map((item, index) => routineCard(item, officeClasses.length + index, 'teacher'))
  ];
  const root = $('#dashboardRoutineList');
  if (!root) return;
  // Presentation state only: the empty home can fill the first screen without
  // inventing classes or changing which real office/teacher records qualify.
  $('#homeView')?.classList.toggle('is-empty-routine', cards.length === 0);
  root.dataset.state = cards.length ? 'ready' : 'empty';
  root.innerHTML = cards.length
    ? cards.slice(0, 4).join('')
    : `<article class="challenge-card dashboard-empty-card"><span class="challenge-icon dashboard-empty-icon" aria-hidden="true">${iconMarkup("calendar")}</span><span class="challenge-copy dashboard-empty-copy"><strong>আজ কোনো ক্লাস নেই</strong><small>সময়সূচি দেখতে রুটিন খুলুন।</small></span><button class="challenge-open" type="button" data-view="routine" aria-label="রুটিন খুলুন">${iconMarkup("chevron-right", "apc-icon-svg", { variant: "glyph" })}</button></article>`;
}

function renderProgress(activities, exams, studentId) {
  const homework = activities.filter(item => item.type === 'homework');
  const completed = homework.filter(item => ['done', 'reviewed'].includes(item.progress?.[studentId]?.value)).length;
  const done = Number.isFinite(completed) ? completed : 0;
  const pending = Math.max(0, homework.length - done);
  const percent = homework.length ? Math.round((done / homework.length) * 100) : 0;
  const ring = $('#studyProgressRing');
  if (ring) {
    ring.style.setProperty('--progress', `${percent * 3.6}deg`);
    ring.setAttribute('aria-label', `আজকের অগ্রগতি ${bn(percent)} শতাংশ`);
  }
  if ($('#studyProgressValue')) $('#studyProgressValue').textContent = `${bn(percent)}%`;
  if ($('#dashboardDoneCount')) $('#dashboardDoneCount').textContent = `${bn(done)}টি কাজ`;
  if ($('#dashboardPendingCount')) $('#dashboardPendingCount').textContent = `${bn(pending)}টি কাজ`;
  if ($('#dashboardExamCount')) $('#dashboardExamCount').textContent = `${bn(exams.length)}টি পরীক্ষা`;
  if ($('#studyProgressNote')) $('#studyProgressNote').textContent = homework.length
    ? `${bn(homework.length)}টি প্রকাশিত বাড়ির কাজের অগ্রগতির ভিত্তিতে।`
    : 'এখনও কোনো বাড়ির কাজের অগ্রগতি পাওয়া যায়নি।';
  return { homework, done, pending, percent };
}

function renderChallenge(homework, progress, studentId) {
  const pending = homework.find(item => !['done', 'reviewed'].includes(item.progress?.[studentId]?.value));
  const title = $('#dashboardChallengeTitle');
  const meta = $('#dashboardChallengeMeta');
  const bar = $('#dashboardChallengeProgress');
  const card = $('#dashboardChallengeCard');
  if (pending) {
    if (title) title.textContent = pending.title;
    if (meta) meta.textContent = `${pending.subject} · জমা: ${pending.date || 'তারিখ দেওয়া হয়নি'}`;
    if (bar) bar.style.width = `${Math.max(8, progress.percent)}%`;
    card?.classList.remove('is-complete');
  } else if (homework.length) {
    if (title) title.textContent = 'সব বাড়ির কাজ সম্পন্ন!';
    if (meta) meta.textContent = 'দারুণ কাজ—এবার ফলাফল ও নতুন কাজ দেখে নাও।';
    if (bar) bar.style.width = '100%';
    card?.classList.add('is-complete');
  } else {
    if (title) title.textContent = 'এখনও কোনো কাজ প্রকাশ হয়নি';
    if (meta) meta.textContent = 'শিক্ষকের দেওয়া কাজ ও উপকরণ এখানে দেখা যাবে।';
    if (bar) bar.style.width = '0%';
    card?.classList.remove('is-complete');
  }
}

function renderExam(exams) {
  const card = $('#dashboardExamCard');
  if (!card) return;
  card.hidden = exams.length === 0;
  if (!exams.length) return;
  const first = [...exams].sort((a, b) => a.startAt - b.startAt)[0];
  $('#dashboardExamTitle').textContent = first.title;
  $('#dashboardExamMeta').textContent = `${bn(exams.length)}টি প্রকাশিত পরীক্ষা · ${first.subject || 'পরীক্ষা'}`;
}

function renderFees(student, account, transactions) {
  const fee = student.monthlyFee ?? account?.student?.monthlyFee;
  const card = $('#dashboardFeeCard');
  // Never display a guessed/default fee as a real balance.
  if (!card || fee === null || fee === undefined || fee === '') { if (card) card.hidden = true; return; }
  const summary = studentFeeSummary({ ...student, monthlyFee: fee }, transactions);
  card.hidden = false;
  $('#dashboardFeeTitle').textContent = summary.due > 0 ? 'বকেয়া ফি আছে' : 'এই মাসের ফি পরিশোধ হয়েছে';
  $('#dashboardFeeMeta').textContent = summary.due > 0 ? `${summary.month} · পরিশোধের জন্য অফিসে যোগাযোগ করুন` : `${summary.month} · ধন্যবাদ`;
  $('#dashboardFeeAmount').textContent = `৳ ${bn(summary.due.toLocaleString('en-IN'))}`;
  card.classList.toggle('is-paid', summary.due === 0);
}

export function initStudentDashboard({ getStudent, getAccount }) {
  let request = 0;
  async function refresh() {
    const current = ++request;
    const student = getStudent() || {};
    const account = getAccount() || {};
    $('#homeView')?.setAttribute('data-student-id', student.id || '');
    try {
      const [teachingDb, examDb, transactions] = await Promise.all([
        teachingRepository.listForStudent(student.id), examRepository.listForStudent(student.id), financeRepository.listTransactions({ role: 'student', studentId: student.id })
      ]);
      if (current !== request) return;
      const activities = publishedForStudent(teachingDb.activities || [], student);
      const exams = (examDb.exams || []).filter(exam => isStudentVisibleExam(exam) && examMatchesStudent(exam, student));
      renderRoutine(student, activities);
      const progress = renderProgress(activities, exams, student.id);
      renderChallenge(progress.homework, progress, student.id);
      renderExam(exams);
      renderFees(student, account, transactions);
    } catch {
      if (current !== request) return;
      $('#homeView')?.classList.remove('is-empty-routine');
      const list = $('#dashboardRoutineList');
      list.dataset.state = 'error';
      /* Full-width row, readable when it wraps, and the retry lives inside the
         same component — a half-width chip would break the dashboard grid. */
      list.innerHTML = '<div class="dashboard-routine-error" role="alert" data-routine-error>'
        + '<span class="dashboard-routine-error-icon" aria-hidden="true">!</span>'
        + '<div class="dashboard-routine-error-copy"><strong>আজকের ক্লাস আনা যায়নি</strong>'
        + '<p>সংরক্ষিত রুটিন পড়া যায়নি বা সংযোগ বিচ্ছিন্ন। তথ্য মুছে যায়নি — আবার চেষ্টা করুন।</p></div>'
        + '<button type="button" class="mini-btn primary" data-routine-retry>আবার চেষ্টা করুন</button></div>';
    }
  }
  /* The retry button sits inside the error row itself. */
  $('#dashboardRoutineList')?.addEventListener('click', event => {
    if (event.target.closest('[data-routine-retry]')) void refresh();
  });
  watchExams(() => { void refresh(); });
  window.addEventListener('teaching-data-updated', refresh);
  window.addEventListener('storage', event => {
    if (!event.key || [ROUTINE_KEY, 'activePlus.teaching.v1', 'activePlus.exams.v1', 'activePlus.admin.transactions.v1'].includes(event.key)) void refresh();
  });
  void refresh();
  return refresh;
}
