import { guardianDraft } from './guardian-message.js';
import { taka, addTaka } from './money.js';
import { hasStaffSession, clearStaffSession, readStaffAccount, goToLoginPage, STAFF_SESSION_RULES } from './staff-auth.js';
import { STAFF_DIRECTORY_RULES } from './staff-directory.js';
import { mountSettingsHub, resetSettingsHub } from './settings-hub.js';
import { mountStaffAccountGroup } from './staff-account-forms.js';
import { mountProfileSelfEdit } from './staff-self-edit.js';
import { rememberRoute, onRouteChange, routeName } from './panel-route.js';
import { decideRegistration, DECISION_MESSAGES, DECIDED_EVENT, formatPendingDate, openRegistrationReview } from './registration-review.js';
import { installPanelGuard, lockPanel, rememberPanelPage, watchOwnPanelSession } from './panel-lockdown.js';
import { openStaffPasswordDialog } from './staff-password-dialog.js';
import { loadRoster, updateStudentOperationalInfo, setStudentStatus, loadNotices, saveNotices, loadRoutine, saveRoutine, WEEK_DAYS } from './office-data.js';
import { loadAccount, saveAccount } from './storage.js';
import { financeRepository, monthLabel, dateLabel, studentFeeSummary, newestTransactions, isFinalizedTransaction, DEFAULT_MONTHLY_FEE } from './finance-data.js';
import { examRepository, isLiveExam, MANAGER_ACTOR } from './exam-data.js';
import { examMeta, resultMarkup, downloadResults } from './exam-ui.js';
import { teachingRepository, todayISO, TEACHING_KEY } from './teaching-data.js';
import { enabledClasses } from './config.js';
import { resolveResetPassword } from './password-policy.js';
import { classCodes } from './admin-data.js';
import { newId } from './database.js';
import { escapeHtml } from './sanitize.js';
import { matchesStudentQuery } from './student-search.js';
import { registerServiceWorker } from './service-worker.js';
import { initFixedShell } from './fixed-shell.js';
import { initExamManager } from './exam-manager.js';
import { listTeacherAssignments, saveTeacherAssignment, deleteTeacherAssignment, deleteAssignmentSubject, selectableSubjects, TEACHER_ASSIGNMENTS_KEY } from './teacher-assignments.js';
import { listStaff } from './staff-directory.js';
import { normalizeClassId, normalizeSectionId } from './class-key.js';
import { listClasses } from './academics.js';
import { noticeCategory, noticeCategoryInfo } from './notification-rules.js';
import { mountReports, refreshReports } from './reports.js';
import { pickTeacherSectionAdvice } from './teacher-daily-advice.js';
import { iconMarkup } from './icons.js';
import { initOrgInfo } from './org-info.js';

registerServiceWorker();
initFixedShell();
/* Institute details (name/slogan/address/contact) come from one record and are
   repainted after every settings save and every synced update. */
initOrgInfo();
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const bn = value => String(value ?? 0).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[digit]);
const money = value => `৳${bn(Number(value || 0).toLocaleString('en-US'))}`;
/* The Manager keeps five bottom seats. Reports and the advice editor live in
   More; their route names and data hooks remain unchanged. */
const ROUTINE_CHILD_VIEWS = Object.freeze(['routine-today', 'routine-tomorrow', 'routine-weekly', 'routine-class', 'routine-exam', 'routine-changed', 'routine-holiday', 'routine-important', 'routine-other']);
const MANAGER_VIEWS = Object.freeze(['dashboard', 'students', 'academic', 'academic-records', 'classes', 'phonebook', 'teachers', 'finance', 'notices', 'routine', ...ROUTINE_CHILD_VIEWS, 'exams', 'courses', 'lecture-sheets', 'results', 'reports', 'advice', 'profile', 'settings', 'more', 'class-chat']);
let managerPhonebookFlight = null;
let managerClassChatFlight = null;
function mountManagerClassChat() {
  const mount = document.getElementById('managerClassChatMount');
  if (!mount) return;
  managerClassChatFlight ??= import('./class-chat.js').catch(err => { managerClassChatFlight = null; throw err; });
  void managerClassChatFlight.then(mod => mod.mountClassChat(mount, { portal: 'manager', getStaff: () => managerAccount }))
    .catch(err => console.warn('[Active Plus] manager class-chat failed:', err?.message));
}
function mountManagerPhonebook() {
  const mount = $('#managerPhonebookMount');
  if (!mount) return;
  managerPhonebookFlight ??= import('./phonebook.js').catch(err => { managerPhonebookFlight = null; throw err; });
  void managerPhonebookFlight.then(mod => mod.mountPhonebook(mount, {
    portal: 'manager',
    getStudents: () => students,
    getTransactions: () => transactions,
    getStaff: () => listStaff(),
    onToast: (msg, err) => toast(msg, err)
  }))
    .catch(err => console.warn('[Active Plus] manager phonebook failed:', err?.message));
}
const LEGACY_VIEWS = Object.freeze({
  approvals: { view: 'students', scope: 'pending' },
  'cash-counter': { view: 'finance', segment: 'approval' }
});
/* একাডেমিক hub cards. Each one opens the screen that already owns that work —
   প্রশ্নব্যাংক / পরীক্ষা land in the single examination workspace. */
const ACADEMIC_SECTIONS = Object.freeze({
  homework: { view: 'academic-records', scope: 'homework' },
  suggestion: { view: 'academic-records', scope: 'suggestion' },
  bank: { view: 'exams', screen: 'bank' },
  exams: { view: 'exams' },
  results: { view: 'results' },
  routine: { view: 'routine' },
  notice: { view: 'notices' },
  materials: { view: 'courses' }
});
/* হিসাব owns four segments; the Cash Counter panel keeps its own daily flow. */
const FINANCE_SEGMENTS = Object.freeze(['collection', 'approval', 'due', 'history']);
/* The "আরও" page. One row per Manager module, in the same icon + title + hint
   language as the Admin panel's More menu, so a module looks the same wherever
   it is reached from. Labels stay Bangla like the bottom bar; the hint names
   what actually happens inside. Academic work lives in একাডেমিক, money in হিসাব. */
const MORE_MODULES = Object.freeze([
  { view: 'profile', icon: 'user', label: 'আমার প্রোফাইল' },
  { view: 'settings', icon: 'settings', label: 'সেটিংস' },
  { view: 'reports', icon: 'reports', label: 'রিপোর্ট' },
  { view: 'advice', icon: 'book', label: 'দৈনিক পরামর্শ' }
]);
const dayLabel = Object.freeze({ sat: 'শনিবার', sun: 'রবিবার', mon: 'সোমবার', tue: 'মঙ্গলবার', wed: 'বুধবার', thu: 'বৃহস্পতিবার' });
const statusLabel = Object.freeze({ approved: 'সক্রিয়', pending: 'অপেক্ষমাণ', inactive: 'নিষ্ক্রিয়', rejected: 'বাতিল' });
let students = loadRoster(), notices = loadNotices(), routine = loadRoutine(), transactions = [], exams = { exams: [], attempts: [] }, teaching = { activities: [] }, managerAccount = null;
let activeView = 'dashboard', studentScope = 'all', expandedStudentId = null, cashScope = 'pending', routineDay = 'sat', examStarted = false, managerBusy = false;
let financeSegment = 'collection', academicScope = 'all', academicClass = 'all';
/* One examination workspace for the panel; একাডেমিক → প্রশ্নব্যাংক / পরীক্ষা
   deep-link into its own screens instead of rendering a second copy. */
let examWorkspaceOpen = null;
let managerExamScreen = '';
let managerExamTileKey = '';
const EXAM_SCREENS = Object.freeze({
  bank: 'bank', upcoming: 'upcoming', done: 'archive', papers: 'archive',
  live: 'home', instant: 'home', recent: 'home', results: 'home', other: 'home'
});
function ensureExamWorkspace() {
  if (examStarted) return;
  const workspace = initExamManager('#managerExamWorkspace', 'manager');
  examWorkspaceOpen = screen => workspace?.open?.(screen);
  examStarted = true;
}
function paintManagerExam() {
  const hub = $('#managerExamHub');
  const workspace = $('#managerExamWorkspace');
  if (!hub || !workspace) return;
  const open = Boolean(managerExamScreen);
  hub.hidden = false;
  workspace.hidden = !open;
  $$('#managerExamHub [data-manager-exam]').forEach(btn => {
    const active = open && (btn.dataset.managerExam === managerExamTileKey || (!managerExamTileKey && EXAM_SCREENS[btn.dataset.managerExam] === managerExamScreen));
    btn.classList.toggle('is-open', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if (open) {
    ensureExamWorkspace();
    examWorkspaceOpen?.(managerExamScreen);
  }
}
/* The hero card itself is gone (owner request 2026-10-28): this painter now only
   keeps the compact page head's date pill, section advice and welcome title in
   sync, so no image or glint URL is written any more. */
/* লেকচার শিট স্টুডিও (owner decision 2026-10-28): the Manager gets the same
   authoring surface the Admin has, started with the manager role so writes are
   attributed to the signed-in manager account. */
let managerLectureFlight = null;
function mountManagerLectureSheets() {
  const mount = $('#managerLectureSheetsMount');
  if (!mount) return;
  managerLectureFlight ??= import('./lecture-sheet-studio.js')
    .catch(err => { managerLectureFlight = null; throw err; });
  void managerLectureFlight
    .then(mod => mod.mountLectureSheetManager({ mount, role: 'manager', toast: message => toast(message) }))
    .catch(err => console.warn('[Active Plus] manager lecture studio failed:', err?.message));
}

function syncManagerPanelHead() {
  const now = new Date();
  let hour = 12;
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', hourCycle: 'h23' }).format(now));
  } catch {
    hour = now.getHours();
  }
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const isDay = !isDark && hour >= 6 && hour < 18;
  const mode = isDay ? 'day' : 'night';
  let weekday = '';
  try {
    weekday = new Intl.DateTimeFormat('bn-BD', { timeZone: 'Asia/Dhaka', weekday: 'long' }).format(now);
  } catch {
    weekday = new Intl.DateTimeFormat('bn-BD', { weekday: 'long' }).format(now);
  }
  const today = dateLabel(now);
  const datePillText = `${weekday ? `${weekday} · ` : ''}${today}`;
  $$('[data-manager-hero-date]').forEach(node => { node.textContent = datePillText; });
  $$('[data-home-intro]').forEach(intro => { intro.dataset.heroMode = mode; });
  $$('[data-manager-hero-advice]').forEach(node => {
    const key = node.dataset.managerHeroAdvice || 'dashboard';
    node.textContent = pickTeacherSectionAdvice(key);
  });
  const homeTitle = $('#managerHomeTitle');
  if (homeTitle) {
    const name = String(managerAccount?.fullName || '').trim();
    homeTitle.textContent = name ? `স্বাগতম, ${name}` : 'স্বাগতম, ম্যানেজার';
  }
}
const scopeLabel = Object.freeze({ all: 'সব', pending: 'নিবন্ধন অপেক্ষমাণ', approved: 'সক্রিয়', inactive: 'নিষ্ক্রিয়', rejected: 'বাতিল' });

function pressTiles(selector, isOn) {
  $$(selector).forEach(item => {
    const on = isOn(item);
    item.classList.toggle('active', on);
    if (item.matches('.pay-tile')) item.setAttribute('aria-pressed', String(on));
  });
}
function toast(message, error = false) {
  const node = $('#managerToast'); if (!node) return;
  node.textContent = message; node.dataset.tone = error ? 'error' : 'success'; node.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 3000);
}
function safeSetText(selector, value) { const node = $(selector); if (node) node.textContent = String(value ?? '—'); }
function normalizeView(view) {
  const legacy = LEGACY_VIEWS[view];
  if (!legacy) return MANAGER_VIEWS.includes(view) ? { view } : null;
  if (legacy.scope) studentScope = legacy.scope;
  if (legacy.segment) financeSegment = legacy.segment;
  return { view: legacy.view };
}
function renderView(view) {
  const target = normalizeView(view);
  if (!target) return false;
  view = target.view;
  activeView = view;
  $$('.manager-view').forEach(panel => { const active = panel.dataset.viewPanel === view; panel.classList.toggle('active', active); panel.hidden = !active; });
  const isChatFullscreen = view === 'class-chat';
  document.getElementById('managerShell')?.classList.toggle('is-chat-fullscreen', isChatFullscreen);
  document.getElementById('managerMain')?.classList.toggle('is-chat-view', isChatFullscreen);
  if (isChatFullscreen) mountManagerClassChat();
  const seat = view === 'dashboard' ? 'dashboard'
    : view === 'students' ? 'students'
      : view === 'class-chat' ? 'more'
      : ['academic', 'academic-records', 'notices', 'routine', 'exams', 'results', 'courses', 'lecture-sheets', 'teachers', ...ROUTINE_CHILD_VIEWS].includes(view) ? 'academic'
        : view === 'finance' ? 'finance' : 'more';
  $$('.manager-bottom [data-panel-view]').forEach(button => {
    const active = button.dataset.panelView === seat;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  // Each return to Settings starts at its group menu, never a stale subsection.
  if (view === 'settings') resetSettingsHub('[data-settings-hub="manager"]');
  // Refresh reopens this page: the open view lives in the URL. It is remembered
  // before the panels render, so a renderer that ever fails can still not send
  // the next refresh back to the dashboard.
  rememberRoute(view);
  syncManagerPanelHead();
  if (view === 'dashboard') renderDashboard();
  if (view === 'students') { expandedStudentId = null; renderStudents(); }
  if (view === 'academic') renderAcademic();
  if (view === 'academic-records') renderAcademicRecords();
  if (view === 'classes') renderClasses();
  if (view === 'teachers') renderTeachers();
  if (view === 'finance') renderFinance();
  if (view === 'notices') renderNotices();
  if (view === 'courses') mountCourseEditor();
  if (view === 'routine' || ROUTINE_CHILD_VIEWS.includes(view)) renderRoutine();
  if (view === 'exams') paintManagerExam();
  if (view === 'results') renderResults();
  if (view === 'reports') void refreshReports($('#managerReports'));
  if (view === 'profile') renderProfile();
  if (view === 'phonebook') mountManagerPhonebook();
  if (view === 'lecture-sheets') mountManagerLectureSheets();
  $('#managerMain')?.scrollTo({ top: 0, behavior: 'smooth' });
  return true;
}
function compactRow(text, meta = '') { return `<div class="manager-compact-row"><strong>${escapeHtml(text)}</strong>${meta ? `<br><small>${escapeHtml(meta)}</small>` : ''}</div>`; }
function attendanceSummary() {
  const today = todayISO();
  const rows = teaching.activities.filter(a => a.date === today && a.status === 'published' && a.type === 'routine');
  const counts = { present: 0, absent: 0, late: 0 };
  rows.forEach(activity => Object.values(activity.progress || {}).forEach(item => { if (counts[item.value] !== undefined) counts[item.value]++; }));
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (!total) return 'আজকের জন্য কোনো সংরক্ষিত উপস্থিতি রেকর্ড নেই।';
  return `উপস্থিত ${bn(counts.present)} • অনুপস্থিত ${bn(counts.absent)} • দেরি ${bn(counts.late)} • মোট ${bn(total)}টি রেকর্ড`;
}
function renderDashboard() {
  const today = dateLabel(new Date());
  const approved = students.filter(student => student.status === 'approved');
  const todayPayments = transactions.filter(tx => isFinalizedTransaction(tx) && tx.date === today);
  const totalToday = todayPayments.reduce((sum, tx) => addTaka(sum, tx.amount), 0);
  const todayKey = routineDayForToday();
  const todaysClasses = routine[todayKey]?.classes?.length || 0;
  safeSetText('#mgrTotalStudents', bn(students.length)); safeSetText('#mgrActiveStudents', bn(approved.length));
  safeSetText('#mgrTodayCollection', money(totalToday)); safeSetText('#mgrTodayClasses', bn(todaysClasses));
  syncManagerPanelHead();
}
function routineDayForToday(date = new Date()) {
  const key = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', weekday: 'short' }).format(date).toLowerCase();
  return ({ sat: 'sat', sun: 'sun', mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri' })[key] || 'sat';
}
function searchValue() { return String($('#managerStudentSearch')?.value || '').trim().toLocaleLowerCase(); }
/* The shared rule: the শিক্ষার্থী আইডি (full, short, Bangla digits or with dashes
   removed) always finds the student; name, guardian and mobiles match too. */
function studentMatches(student, query) { return !query || matchesStudentQuery(student, query); }
function managerStudentDetailsId(studentId) {
  return `manager-student-details-${String(studentId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}
function managerStudentDetailsToggle(student, detailsId) {
  const expanded = expandedStudentId === student.id;
  return `<button class="manager-student-details-toggle" type="button" data-manager-action="toggle-student-details" data-id="${escapeHtml(student.id)}" aria-expanded="${expanded}" aria-controls="${escapeHtml(detailsId)}"><span>${expanded ? 'কম দেখান' : 'বিস্তারিত'}</span><span class="manager-student-chevron" aria-hidden="true"></span></button>`;
}
function managerStudentEmpty(title, description, kind = 'search') {
  const icon = kind === 'done'
    ? '<path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/>'
    : '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/>';
  return `<div class="admin-empty manager-student-empty" role="status"><span class="manager-student-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></div>`;
}
function managerStudentVisibleMeta(student) {
  return `<div class="manager-student-visible-meta"><span><small>শ্রেণি</small>${escapeHtml(student.className || 'নির্ধারিত নয়')}</span><span><small>ব্যাচ</small>${escapeHtml(student.group || 'নির্ধারিত নয়')}</span></div>`;
}
function managerStudentDetailGroup(title, content) {
  return `<section class="manager-student-detail-group"><h3>${escapeHtml(title)}</h3>${content}</section>`;
}
function managerStudentDetailsMarkup(student, fee) {
  const className = escapeHtml(student.className || 'ক্লাস নির্ধারিত নয়');
  const group = escapeHtml(student.group || 'ব্যাচ নির্ধারিত নয়');
  const contact = managerStudentDetailGroup('যোগাযোগ', `<p>শিক্ষার্থী ${escapeHtml(student.mobile || '—')}</p><p>অভিভাবক ${escapeHtml(student.guardianMobile || '—')}</p>`);
  if (student.status === 'pending') {
    const appliedDate = escapeHtml(formatPendingDate(student));
    return `<div class="manager-student-detail-grid">${managerStudentDetailGroup('অনুমোদনের অপেক্ষায়', `<p>নাম: ${escapeHtml(student.name || 'নাম নেই')} • আইডি: ${escapeHtml(student.id || '—')}</p><p>${['শ্রেণি', className, group].filter(Boolean).join(' • ')}</p><p>তারিখ: ${appliedDate}</p>`)}${contact}</div>`;
  }
  const progress = managerStudentDetailGroup('অগ্রগতি', `<p>মাসিক বকেয়া ${money(fee.due)}</p><p>উপস্থিতি ${student.attendance == null ? '—' : `${escapeHtml(student.attendance)}%`} • গড় ফল ${student.average == null ? '—' : escapeHtml(student.average)}</p>`);
  return `<div class="manager-student-detail-grid">${managerStudentDetailGroup('শ্রেণি ও ব্যাচ', `<p>${[className, group].filter(Boolean).join(' • ') || '—'}</p>`)}${contact}${progress}</div>`;
}
/** শিক্ষার্থী: one screen for the whole student lifecycle. The pending queue is
    the canonical home for pending registrations; the all-roster list contains
    every other status so an application can never appear twice. */
function renderStudents() {
  const query = searchValue();
  const clearBtn = $('#managerStudentSearchClear');
  if (clearBtn) clearBtn.hidden = !query.trim();
  const pendingCount = students.filter(student => student.status === 'pending').length;
  const pending = students.filter(student => student.status === 'pending' && studentMatches(student, query));
  safeSetText('#managerPendingBadge', `${bn(pendingCount)} অপেক্ষমাণ`);
  /* The chips always show the filter actually in force — including one set by a
     shortcut or by an old link (dashboard → অনুমোদন, #approvals). */
  $$('[data-student-scope]').forEach(chip => {
    const active = chip.dataset.studentScope === studentScope;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });

  const queue = $('#managerStudentQueue');
  if (queue) {
    queue.hidden = false;
    queue.innerHTML = pending.length
      ? pending.map(student => {
        const detailsId = managerStudentDetailsId(student.id);
        const detailsOpen = expandedStudentId === student.id;
        return `<article class="manager-record manager-student-card is-pending-registration" data-manager-student="${escapeHtml(student.id)}">
          <div class="manager-record-head manager-student-head">
            <div class="manager-student-identity">
              <h2>${escapeHtml(student.name || 'নাম নেই')}</h2>
              <p class="manager-meta">শিক্ষার্থী ID: ${escapeHtml(student.id || 'ভর্তি আবেদন')}</p>
            </div>
            <div class="manager-student-summary-side">
              <span class="badge badge-pending">অপেক্ষমাণ</span>
              ${managerStudentDetailsToggle(student, detailsId)}
            </div>
          </div>
          ${managerStudentVisibleMeta(student)}
          <div class="manager-student-details" id="${escapeHtml(detailsId)}"${detailsOpen ? '' : ' hidden'}>
            ${managerStudentDetailsMarkup(student)}
            <div class="manager-actions manager-student-actions">
              <button class="mini-btn approve manager-student-action-primary" type="button" data-manager-action="approve-student" data-id="${escapeHtml(student.id)}">অনুমোদন দিন</button>
              <button class="mini-btn reject manager-student-action-secondary" type="button" data-manager-action="reject-student" data-id="${escapeHtml(student.id)}">বাতিল করুন</button>
              <button class="mini-btn manager-student-action-secondary" type="button" data-manager-action="view-student" data-id="${escapeHtml(student.id)}">প্রোফাইল</button>
            </div>
            <div class="manager-student-extra" hidden></div>
          </div>
        </article>`;
      }).join('')
      : (studentScope === 'pending' || (!query && pendingCount === 0))
        ? managerStudentEmpty(
          query ? 'এই খোঁজে কোনো অপেক্ষমাণ আবেদন নেই' : 'এখন কোনো অপেক্ষমাণ আবেদন নেই',
          query ? 'নাম, শিক্ষার্থী ID বা মোবাইল নম্বর বদলে আবার খুঁজুন।' : 'নতুন ভর্তি আবেদন এলে এখানে দেখা যাবে।',
          'done'
        )
        : '';
  }

  const list = students.filter(student => student.status !== 'pending'
    && (studentScope === 'all' || student.status === studentScope)
    && studentMatches(student, query));
  const listHost = $('#managerStudentList');
  if (!listHost) return;
  if (list.length) {
    const knownStatuses = ['approved', 'inactive', 'rejected'];
    const statusOrder = [...knownStatuses, ...new Set(list
      .map(student => student.status || 'unknown')
      .filter(status => status !== 'pending' && !knownStatuses.includes(status)))];
    listHost.innerHTML = statusOrder.map(status => {
      const rows = list.filter(student => (student.status || 'unknown') === status);
      if (!rows.length) return '';
      const groupKey = String(status || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-') || 'unknown';
      const groupLabel = statusLabel[status] || (status === 'unknown' ? 'অন্যান্য' : status);
      const cards = rows.map(student => {
        const fee = studentFeeSummary(student, transactions);
        const tone = status === 'approved' ? 'badge-approved' : status === 'inactive' ? 'badge-inactive' : status === 'rejected' ? 'badge-rejected' : 'badge-inactive';
        /* Edit, activate/deactivate, reset and profile actions stay on the same
           roster record; only their placement moves inside its disclosure. */
        const lifecycle = status === 'approved'
          ? `<button class="mini-btn reject manager-student-action-secondary" type="button" data-manager-action="deactivate-student" data-id="${escapeHtml(student.id)}">Deactivate</button>`
          : status === 'inactive'
            ? `<button class="mini-btn approve manager-student-action-primary" type="button" data-manager-action="activate-student" data-id="${escapeHtml(student.id)}">Activate</button>`
            : '';
        const detailsId = managerStudentDetailsId(student.id);
        const detailsOpen = expandedStudentId === student.id;
        return `<article class="manager-record manager-student-card" data-manager-student="${escapeHtml(student.id)}">
          <div class="manager-record-head manager-student-head">
            <div class="manager-student-identity">
              <h2>${escapeHtml(student.name || 'নাম নেই')}</h2>
              <p class="manager-meta">শিক্ষার্থী ID: ${escapeHtml(student.id)}</p>
            </div>
            <div class="manager-student-summary-side">
              <span class="badge ${tone}">${escapeHtml(statusLabel[status] || status || 'অজানা')}</span>
              ${managerStudentDetailsToggle(student, detailsId)}
            </div>
          </div>
          ${managerStudentVisibleMeta(student)}
          <div class="manager-student-details" id="${escapeHtml(detailsId)}"${detailsOpen ? '' : ' hidden'}>
            ${managerStudentDetailsMarkup(student, fee)}
            <div class="manager-actions manager-student-actions">
              <button class="mini-btn manager-student-action-secondary" type="button" data-manager-action="view-student" data-id="${escapeHtml(student.id)}">প্রোফাইল</button>
              <button class="mini-btn manager-student-action-secondary" type="button" data-manager-action="guardian-draft" data-id="${escapeHtml(student.id)}">অভিভাবককে জানান</button>
              <button class="mini-btn ${status === 'inactive' ? 'manager-student-action-secondary' : 'manager-student-action-primary'}" type="button" data-manager-action="edit-student" data-id="${escapeHtml(student.id)}">তথ্য সম্পাদনা</button>
              ${lifecycle}
              <button class="mini-btn manager-student-action-secondary" type="button" data-manager-action="reset-password" data-id="${escapeHtml(student.id)}">পাসওয়ার্ড রিসেট</button>
            </div>
            <div class="manager-student-extra" hidden></div>
          </div>
        </article>`;
      }).join('');
      return `<section class="manager-student-status-group" data-student-status-group="${escapeHtml(groupKey)}" aria-labelledby="managerStudentGroup-${escapeHtml(groupKey)}"><div class="manager-student-status-heading"><h3 id="managerStudentGroup-${escapeHtml(groupKey)}">${escapeHtml(groupLabel)}</h3><span class="manager-student-status-count">${bn(rows.length)} জন</span></div>${cards}</section>`;
    }).join('');
  } else if (studentScope === 'pending' || (studentScope === 'all' && pending.length)) {
    listHost.innerHTML = '';
  } else {
    const stateLabel = studentScope === 'inactive' ? 'নিষ্ক্রিয়' : studentScope === 'rejected' ? 'বাতিল' : 'সক্রিয়';
    listHost.innerHTML = managerStudentEmpty(
      query ? 'এই খোঁজে কোনো শিক্ষার্থী নেই' : `${stateLabel} শিক্ষার্থী নেই`,
      query ? 'নাম, শিক্ষার্থী ID বা মোবাইল নম্বর দিয়ে আবার খুঁজুন।' : 'অন্য একটি অবস্থা বেছে নিন বা শিক্ষার্থী খুঁজুন।'
    );
  }
}
function renderRoutineClassOptions() {
  const select = $('#managerRoutineClass'), selected = select.value;
  const classes = listClasses().filter(item => item.active !== false).map(item => item.name);
  select.innerHTML = `<option value="">শ্রেণি নির্বাচন</option>${classes.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
  select.value = classes.includes(selected) ? selected : '';
}
function renderClasses() {
  renderRoutineClassOptions();
  const classNames = listClasses().filter(item => item.active !== false).map(item => item.name);
  $('#managerClassList').innerHTML = classNames.map(className => {
    const classStudents = students.filter(student => student.className === className && student.status !== 'rejected');
    const groups = [...new Set(classStudents.map(student => student.group).filter(Boolean))];
    const teacherNames = [...new Set(Object.values(routine).flatMap(info => info.classes).filter(item => item.className === className).map(item => item.teacher).filter(Boolean))];
    return `<article class="manager-record"><div class="manager-record-head"><div><h2>${escapeHtml(className)}</h2><p class="manager-meta">${escapeHtml(classCodes[className] || '')}</p></div><span class="badge badge-approved">${bn(classStudents.length)} শিক্ষার্থী</span></div><p>ব্যাচ/বিভাগ: ${escapeHtml(groups.join(', ') || 'তথ্য নেই')}</p><p>নির্ধারিত শিক্ষক: ${escapeHtml(teacherNames.join(', ') || 'রুটিনে নেই')}</p></article>`;
  }).join('');
}
/** Step 3 of the assignment form: only the subjects Admin enabled for the
    chosen class (plus any legacy value already on the record, so nothing is
    stranded). One class → several ticked subjects → several assignments. */
/* The class the picker was last painted for. Ticks are read back from the DOM
   only while this stays the same: a background storage re-render must not wipe
   what the Manager has ticked, but switching class must not drag the previous
   class's ticks along (audit F8). */
let pickerClass = null;
/** The row the Manager is editing, when the form is in edit mode. */
let editingAssignmentId = '';
let assignmentRowsById = new Map();
function renderTeacherSubjectPicker(className, selected = [], { preferSelected = false } = {}) {
  const box = $('#managerTeacherSubjectList');
  const note = $('[data-teacher-subject-note]');
  if (!box) return;
  const carried = preferSelected || pickerClass !== className ? [] : [...box.querySelectorAll('input[name=subject]:checked')].map(input => input.value);
  const chosen = [...new Set([...selected, ...carried])];
  pickerClass = className;
  if (!className) {
    box.innerHTML = '<p class="admin-empty">আগে ক্লাস নির্বাচন করুন — তারপর সেই ক্লাসের বিষয়গুলো দেখবেন।</p>';
    if (note) note.textContent = 'এডমিনের ক্লাস ও বিষয় সেটআপ থেকেই এই তালিকা আসে।';
    return;
  }
  const options = selectableSubjects(className, { includeLegacy: chosen });
  box.innerHTML = options.length
    ? options.map(name => `<label class="manager-subject-option"><input type="checkbox" name="subject" value="${escapeHtml(name)}" ${chosen.includes(name) ? 'checked' : ''}> ${escapeHtml(name)}</label>`).join('')
    : '<p class="admin-empty">এই ক্লাসের জন্য এডমিন কোনো বিষয় চালু করেননি — এডমিনের ক্লাস ও বিষয় সেটআপ থেকে চালু করুন।</p>';
  if (note) note.textContent = options.length ? `${bn(options.length)}টি বিষয় চালু আছে — একাধিক টিক দিতে পারবেন।` : '';
}
/** Put the assignment form in create or edit mode, honestly. */
function setAssignmentFormMode() {
  const form = $('#managerTeacherAssignmentForm');
  if (!form) return;
  const submit = form.querySelector('button[type="submit"]');
  const row = assignmentRowsById.get(editingAssignmentId);
  let note = form.querySelector('[data-assignment-edit-note]');
  if (!editingAssignmentId) {
    note?.remove();
    if (submit) submit.textContent = 'শিক্ষককে ক্লাস ও বিষয় দিন';
    return;
  }
  if (!note) {
    note = document.createElement('p');
    note.className = 'form-note';
    note.setAttribute('data-assignment-edit-note', '');
    note.innerHTML = '<span data-assignment-edit-label></span><button class="mini-btn" type="button" data-manager-action="cancel-assignment-edit">সম্পাদনা বাতিল</button>';
    form.insertBefore(note, submit || null);
  }
  const label = note.querySelector('[data-assignment-edit-label]');
  if (label) label.textContent = `সম্পাদনা হচ্ছে: ${row?.teacherName || row?.teacherUsername || ''} • ${row?.className || ''}${row?.group ? ` • ${row.group}` : ''} — সংরক্ষণ করলে এই ঠিকায় বিষয়গুলো বদলাবে, নতুন সারি তৈরি হবে না।`;
  if (submit) submit.textContent = 'অ্যাসাইনমেন্ট হালনাগাদ করুন';
}
async function renderTeachers() {
  const form = $('#managerTeacherAssignmentForm');
  /* Every active teacher-role staff member can receive work — including the
     ones the Admin created in Staff Management (they live in the directory,
     keyed by their Login User ID). The built-in teacher.apc stays as one
     option among the others, never the only one. */
  const directory = await listStaff();
  const teachers = directory.filter(item => item.role === 'teacher' && !['disabled', 'inactive', 'rejected'].includes(item.status));
  const fallback = await readStaffAccount('teacher');
  if (fallback && !teachers.some(item => item.username === fallback.username)) teachers.unshift(fallback);
  const assignments = teachers.flatMap(item => listTeacherAssignments(item.username));
  assignmentRowsById = new Map(assignments.map(item => [item.id, item]));
  if (editingAssignmentId && !assignmentRowsById.has(editingAssignmentId)) { editingAssignmentId = ''; setAssignmentFormMode(); }
  const editing = editingAssignmentId ? assignmentRowsById.get(editingAssignmentId) : null;
  if (form) {
    const select = form.elements.teacherUsername;
    const current = select.value;
    select.innerHTML = teachers.map(item => `<option value="${escapeHtml(item.username)}">${escapeHtml(item.fullName || item.username)} — ${escapeHtml(item.username)}</option>`).join('');
    if (editing?.teacherUsername && teachers.some(item => item.username === editing.teacherUsername)) select.value = editing.teacherUsername;
    else if (current && teachers.some(item => item.username === current)) select.value = current;
    const classes = listClasses().map(item => item.name);
    const choices = classes.length ? classes : [...enabledClasses];
    /* A row can outlive its class (Admin retires or renames one). Keep it
       selectable while it is being edited, or the edit would save to a
       different class than the one on screen. */
    if (editing && !choices.includes(editing.className)) choices.push(editing.className);
    form.elements.className.innerHTML = `<option value="">শ্রেণি নির্বাচন</option>${choices.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
    if (editing) {
      form.elements.className.value = editing.className;
      form.elements.group.value = editing.group || '';
      renderTeacherSubjectPicker(editing.className, editing.subjects, { preferSelected: true });
    } else {
      form.elements.className.value = choices[0] || '';
      renderTeacherSubjectPicker(form.elements.className.value);
    }
    setAssignmentFormMode();
  }
  const schedule = new Map();
  Object.entries(routine).forEach(([day, info]) => (info.classes || []).forEach(item => {
    if (!item.teacher) return;
    const key = item.teacher;
    if (!schedule.has(key)) schedule.set(key, []);
    schedule.get(key).push(`${item.className || 'ক্লাস নেই'} • ${item.subject || 'বিষয় নেই'} • ${dayLabel[day] || day} ${item.time || ''}`);
  }));
  const activityCount = (teaching.activities || []).filter(item => item.teacherId === 'TCH-001').length;
  const cards = assignments.map(item => {
    const subjects = (item.subjects && item.subjects.length ? item.subjects : [item.subject]).filter(Boolean);
    const chips = subjects.map(name => `<span class="manager-subject-chip">${escapeHtml(name)}<button class="mini-btn reject" type="button" data-manager-action="delete-teacher-subject" data-id="${escapeHtml(item.id)}" data-subject="${escapeHtml(name)}" aria-label="${escapeHtml(name)} সরান">×</button></span>`).join('');
    return `<article class="manager-record"><div class="manager-record-head"><div><h2>${escapeHtml(item.className)}${item.group ? ` • ${escapeHtml(item.group)}` : ''}</h2><p class="manager-meta">${escapeHtml(item.teacherName)} • ${bn(subjects.length)}টি বিষয়</p><div class="manager-subject-chips">${chips}</div></div><div class="manager-record-actions"><button class="mini-btn" type="button" data-manager-action="edit-teacher-assignment" data-id="${escapeHtml(item.id)}">সম্পাদনা</button><button class="mini-btn reject" type="button" data-manager-action="delete-teacher-assignment" data-id="${escapeHtml(item.id)}">দায়িত্ব সরান</button></div></div></article>`;
  });
  const routineRows = [...schedule.entries()].flatMap(([name, items]) => items.map(item => `<li>${escapeHtml(name)} — ${escapeHtml(item)}</li>`));
  $('#managerTeacherList').innerHTML = `${cards.join('') || '<p class="admin-empty">এখনো কোনো শিক্ষক-শ্রেণি/ব্যাচের দায়িত্ব নেই। দায়িত্ব না থাকলে শিক্ষক একাডেমিক তথ্য দেখতে পারবেন না।</p>'}<article class="manager-record"><h2>রুটিনের সময়সূচি</h2><p>নিচের রুটিনগুলো আলাদা সময়সূচির তথ্য; এগুলো নিজেরা শিক্ষকের প্রবেশাধিকার দেয় না।</p><ul>${routineRows.join('') || '<li>কোনো রুটিনের দায়িত্ব নেই।</li>'}</ul><p class="manager-meta">সংরক্ষিত শিক্ষাদান কার্যক্রম: ${bn(activityCount)}</p></article>`;
}
/* ---- একাডেমিক hub ---------------------------------------------------------- */

/** The hub's counts come from the same stores the sections show; nothing here
    writes, and a failed read can never break the panel. */
function renderAcademic() {
  const records = teaching.activities || [];
  const counts = {
    homework: records.filter(a => a.type === 'homework').length,
    suggestion: records.filter(a => a.type === 'suggestion').length,
    exams: exams.exams.filter(exam => isLiveExam(exam)).length,
    results: exams.exams.filter(exam => isLiveExam(exam) && exam.resultsPublished).length,
    routine: Object.values(routine).reduce((sum, day) => sum + (day?.classes?.length || 0), 0),
    notice: notices.length
  };
  Object.entries(counts).forEach(([key, value]) => {
    const node = $(`[data-academic-count="${key}"]`);
    if (node) node.textContent = value ? bn(value) : '';
  });
  const bank = $('[data-academic-count="bank"]');
  if (bank) bank.textContent = '';
  const materials = $('[data-academic-count="materials"]');
  if (materials) materials.textContent = '';
  const teacherBadge = $('[data-academic-teacher-count]');
  if (teacherBadge) {
    const assignments = listTeacherAssignments(managerAccount?.username || 'teacher.apc');
    teacherBadge.textContent = assignments.length ? `${bn(assignments.length)} বরাদ্দ` : 'বরাদ্দ নেই';
  }
}

/** বাড়ির কাজ / সাজেশন / উপস্থিতি ক্লাস: the Teacher's own records, read here. */
function renderAcademicRecords() {
  const host = $('#managerAcademicList');
  if (!host) return;
  const classSelect = $('#managerAcademicClass');
  if (classSelect) {
    const classes = [...new Set([...listClasses().map(item => item.name), ...(teaching.activities || []).map(a => a.className).filter(Boolean)])];
    const chosen = classSelect.value || 'all';
    classSelect.innerHTML = `<option value="all">সব শ্রেণি</option>${classes.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
    classSelect.value = classes.includes(chosen) || chosen === 'all' ? chosen : 'all';
    academicClass = classSelect.value;
  }
  const query = String($('#managerAcademicSearch')?.value || '').trim().toLocaleLowerCase();
  const rows = (teaching.activities || [])
    .filter(activity => academicScope === 'all' || activity.type === academicScope)
    .filter(activity => academicClass === 'all' || activity.className === academicClass)
    .filter(activity => !query || `${activity.title} ${activity.subject} ${activity.teacherName || ''}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => String(b.updatedAt || b.date || '').localeCompare(String(a.updatedAt || a.date || '')));
  const label = { homework: 'বাড়ির কাজ', suggestion: 'সাজেশন', routine: 'উপস্থিতি ক্লাস', exam: 'নম্বর ও ফলাফল' };
  host.innerHTML = rows.length ? rows.map(activity => `<article class="manager-record" data-academic-record="${escapeHtml(activity.id || '')}">
    <div class="manager-record-head"><div><h2>${escapeHtml(activity.title || 'শিরোনাম নেই')}</h2>
    <p class="manager-meta">${escapeHtml([label[activity.type] || activity.type || '', activity.className || '', activity.group || '', activity.subject || ''].filter(Boolean).join(' • '))}</p></div>
    <span class="badge ${activity.status === 'published' ? 'badge-approved' : 'badge-pending'}">${activity.status === 'published' ? 'প্রকাশিত' : 'খসড়া'}</span></div>
    <p>${escapeHtml(activity.details || 'অতিরিক্ত বিবরণ নেই।')}</p>
    ${activity.type === 'routine' ? `<div class="manager-actions">${Object.entries(activity.progress || {}).map(([studentId, item]) => `<button type="button" class="mini-btn" data-manager-attendance="${escapeHtml(activity.id)}" data-student="${escapeHtml(studentId)}">${escapeHtml(studentId)} • ${escapeHtml(item.value)} — সংশোধন</button>`).join('')}</div>` : ''}
    ${['homework', 'suggestion'].includes(activity.type) ? `<div class="manager-actions"><button type="button" class="mini-btn reject" data-manager-action="delete-content" data-id="${escapeHtml(activity.id || '')}">মুছুন</button></div>` : ''}
    <p class="manager-meta">${escapeHtml(activity.teacherName || 'শিক্ষক')} • ${escapeHtml(activity.date || '')} ${escapeHtml(activity.time || '')}${activity.progress ? ` • ${bn(Object.keys(activity.progress).length)} শিক্ষার্থীর অবস্থা` : ''}</p></article>`).join('')
    : '<p class="admin-empty">এই ফিল্টারে কোনো কাজ পাওয়া যায়নি। কোনো শিক্ষক কিছু প্রকাশ করলে এখানে দেখা যাবে।</p>';
}

function renderFinance() {
  const approved = transactions.filter(isFinalizedTransaction);
  const month = monthLabel();
  const today = dateLabel(new Date());
  const monthTotal = approved.filter(tx => tx.month === month).reduce((sum, tx) => addTaka(sum, tx.amount), 0);
  const total = approved.reduce((sum, tx) => addTaka(sum, tx.amount), 0);
  const due = students.filter(s => s.status === 'approved').reduce((sum, s) => addTaka(sum, studentFeeSummary(s, transactions).due), 0);
  const pending = transactions.filter(tx => tx.status === 'pending');
  safeSetText('#mgrFinanceTotal', money(total)); safeSetText('#mgrFinanceMonth', money(monthTotal));
  safeSetText('#mgrFinanceDue', money(due)); safeSetText('#mgrFinancePending', bn(pending.length));
  const badge = $('#managerFinancePendingBadge');
  if (badge) { badge.hidden = !pending.length; badge.textContent = `${bn(pending.length)} অনুমোদন বাকি`; }

  /* Four segments, one ledger. Nothing is copied: each panel reads the same
     transaction records the Cash Counter wrote and the student ফি screen shows. */
  $$('[data-finance-segment]').forEach(button => {
    const active = button.dataset.financeSegment === financeSegment;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $$('[data-finance-panel]').forEach(panel => { panel.hidden = panel.dataset.financePanel !== financeSegment; });

  if (financeSegment === 'collection') {
    const todayRows = approved.filter(tx => tx.date === today);
    const monthRows = approved.filter(tx => tx.month === month);
    safeSetText('#mgrFinanceToday', money(todayRows.reduce((sum, tx) => addTaka(sum, tx.amount), 0)));
    safeSetText('#mgrFinanceTodayCount', bn(todayRows.length));
    safeSetText('#mgrFinanceCounterMonth', money(monthRows.reduce((sum, tx) => addTaka(sum, tx.amount), 0)));
    safeSetText('#mgrFinanceMonthCount', bn(monthRows.length));
    safeSetText('#mgrFinanceCollectionNote', pending.length
      ? `${bn(pending.length)}টি পেমেন্ট অনুমোদনের অপেক্ষায়।`
      : 'এখন কোনো পেমেন্ট অনুমোদনের অপেক্ষায় নেই।');
    const collectionList = $('#managerCollectionPendingList');
    if (collectionList) collectionList.innerHTML = pending.length
      ? newestTransactions(pending).slice(0, 3).map(collectionPaymentCard).join('')
      : '<p class="manager-finance-empty">নতুন পেমেন্ট এলে এখানে দেখা যাবে।</p>';
  }

  if (financeSegment === 'approval') {
    const selected = transactions.filter(tx => cashScope === 'all' || (cashScope === 'approved' ? (tx.status || 'approved') === 'approved' : tx.status === cashScope));
    $('#managerCashList').innerHTML = newestTransactions(selected).length
      ? newestTransactions(selected).map(tx => transactionCard(tx, true)).join('')
      : '<p class="admin-empty">এই বাছাইয়ে ক্যাশ কাউন্টারের কোনো তথ্য নেই।</p>';
    pressTiles('[data-cash-scope]', button => button.dataset.cashScope === cashScope);
  }

  if (financeSegment === 'due') {
    const classSelect = $('#managerDueClass');
    if (classSelect) {
      const classes = [...new Set(students.map(s => s.className).filter(Boolean))].sort();
      const chosen = classSelect.value || 'all';
      classSelect.innerHTML = `<option value="all">সব শ্রেণি</option>${classes.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
      classSelect.value = classes.includes(chosen) || chosen === 'all' ? chosen : 'all';
    }
    const query = String($('#managerDueSearch')?.value || '').trim().toLocaleLowerCase();
    const className = classSelect?.value || 'all';
    const rows = students
      .filter(student => student.status === 'approved')
      .filter(student => className === 'all' || student.className === className)
      .filter(student => !query || `${student.name} ${student.id}`.toLocaleLowerCase().includes(query))
      .map(student => ({ student, fee: studentFeeSummary(student, transactions) }))
      .sort((a, b) => b.fee.due - a.fee.due);
    $('#managerFinanceDueList').innerHTML = rows.length ? rows.map(({ student, fee }) => `<article class="manager-record" data-due-student="${escapeHtml(student.id)}">
      <div class="manager-record-head"><div><h2>${escapeHtml(student.name || 'নাম নেই')}</h2>
      <p class="manager-meta">${escapeHtml(student.id)} • ${escapeHtml(student.className || '')}${student.group ? ` • ${escapeHtml(student.group)}` : ''}</p></div>
      <span class="badge ${fee.due > 0 ? 'badge-pending' : 'badge-approved'}">${fee.due > 0 ? `বাকি ${money(fee.due)}` : 'পরিশোধিত'}</span></div>
      <p>${escapeHtml(fee.month || '')} মাসিক ফি ${money(fee.monthlyFee)} • পরিশোধ ${money(fee.paid || 0)} • বাকি ${money(fee.due)}</p></article>`).join('')
      : '<p class="admin-empty">এই ফিল্টারে কোনো বকেয়া নেই।</p>';
  }

  if (financeSegment === 'history') {
    const search = ($('#managerPaymentSearch')?.value || '').trim().toLocaleLowerCase();
    const status = $('#managerPaymentStatus')?.value || 'all';
    const list = newestTransactions(transactions).filter(tx => (status === 'all' || (tx.status || 'approved') === status) && (!search || `${tx.studentName} ${tx.studentId} ${tx.id} ${tx.receiptNo}`.toLocaleLowerCase().includes(search)));
    $('#managerPaymentList').innerHTML = list.length ? list.map(tx => transactionCard(tx, false)).join('') : '<p class="admin-empty">কোনো পেমেন্টের তথ্য নেই।</p>';
  }
}
function transactionCard(tx, allowReview) {
  const status = tx.status || 'approved';
  const text = status === 'pending' ? 'অনুমোদন বাকি' : status === 'rejected' ? 'বাতিল' : 'অনুমোদিত';
  return `<article class="manager-record"><div class="manager-record-head"><div><h2>${escapeHtml(tx.studentName || 'শিক্ষার্থী তথ্য নেই')}</h2><p class="manager-meta">${escapeHtml(tx.studentId || '')} • ${escapeHtml(tx.className || '')} • ${escapeHtml(tx.receiptNo || tx.id)}</p></div><span class="badge ${status === 'approved' ? 'badge-approved' : status === 'pending' ? 'badge-pending' : 'badge-rejected'}">${text}</span></div><p><strong>${money(tx.amount)}</strong> • ${escapeHtml(tx.date || 'তারিখ নেই')} • ${escapeHtml(tx.method || 'মাধ্যম নেই')}</p><p>${escapeHtml(tx.feeType || '')} • ${escapeHtml(tx.month || '')} • আদায়কারী: ${escapeHtml(tx.collectedBy || 'পুরোনো রেকর্ড')}</p>${tx.trxRef ? `<p>লেনদেন রেফারেন্স: ${escapeHtml(tx.trxRef)}</p>` : ''}${tx.note ? `<p>মন্তব্য: ${escapeHtml(tx.note)}</p>` : ''}${tx.reviewNote ? `<p class="manager-status-warning">পর্যালোচনা: ${escapeHtml(tx.reviewNote)}</p>` : ''}<p class="manager-meta">পর্যালোচনার ইতিহাস: ${bn((tx.reviewHistory || []).length)} • ${escapeHtml(tx.reviewedBy || '—')}</p>${allowReview && status === 'pending' ? `<div class="manager-actions"><button class="mini-btn approve" type="button" data-manager-action="approve-payment" data-id="${escapeHtml(tx.id)}">অনুমোদন</button><button class="mini-btn reject" type="button" data-manager-action="reject-payment" data-id="${escapeHtml(tx.id)}">বাতিল</button></div>` : ''}</article>`;
}
function collectionPaymentCard(tx) {
  const name = String(tx.studentName || 'শিক্ষার্থী তথ্য নেই');
  const initial = [...name.trim()][0] || 'শ';
  return `<article class="manager-collection-row" data-pending-payment="${escapeHtml(tx.id)}">
    <div class="manager-collection-avatar" aria-hidden="true">${escapeHtml(initial)}</div>
    <div class="manager-collection-person"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(tx.className || 'শ্রেণি নেই')} • ${escapeHtml(tx.month || 'মাস উল্লেখ নেই')}</small></div>
    <div class="manager-collection-payment"><strong>${money(tx.amount)}</strong><small>${escapeHtml(tx.method || 'মাধ্যম নেই')}</small></div>
    <div class="manager-collection-actions"><button class="manager-icon-action approve" type="button" data-manager-action="approve-payment" data-id="${escapeHtml(tx.id)}" aria-label="${escapeHtml(name)}-এর পেমেন্ট অনুমোদন" title="অনুমোদন">✓</button><button class="manager-icon-action reject" type="button" data-manager-action="reject-payment" data-id="${escapeHtml(tx.id)}" aria-label="${escapeHtml(name)}-এর পেমেন্ট বাতিল" title="বাতিল">×</button></div>
  </article>`;
}
/** The Cash Counter review queue is a segment of হিসাব, not a second screen. */
function renderCashCounter() { financeSegment = 'approval'; renderFinance(); }
/** Class/batch choices for the notice composer, written the way the student
    board reads them (js/notification-rules.js). */
function renderNoticeScopes() {
  const select = $('#managerNoticeClass');
  if (!select) return;
  const classes = listClasses().filter(item => item.active !== false).map(item => item.name);
  const chosen = select.value;
  select.innerHTML = `<option value="">সব শ্রেণি</option>${classes.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
  select.value = classes.includes(chosen) ? chosen : '';
  const list = $('#managerNoticeGroups');
  if (list) {
    const groups = [...new Set(students.map(student => student.group).filter(Boolean))];
    list.innerHTML = groups.map(group => `<option value="${escapeHtml(group)}"></option>`).join('');
  }
}
function noticeScopeText(notice) {
  const className = String(notice.className || notice.targetClass || '');
  const group = String(notice.group || notice.batch || '');
  if (!className && !group) return 'সব শ্রেণি';
  return [className || 'সব শ্রেণি', group].filter(Boolean).join(' • ');
}
function renderNotices() {
  renderNoticeScopes();
  $('#managerNoticeList').innerHTML = notices.length ? notices.map(item => {
    const category = noticeCategoryInfo(noticeCategory(item));
    return `<article class="manager-record"><div class="manager-record-head"><div><h2>${escapeHtml(item.title)}</h2><p class="manager-meta"><span class="notice-category-admin" data-notice-category="${category.id}">${category.label}</span> • ${escapeHtml(noticeScopeText(item))} • ${escapeHtml(item.audience || 'সকল শিক্ষার্থী')} • ${escapeHtml(item.date || '')}</p></div><div class="manager-actions"><button class="mini-btn" data-manager-action="edit-notice" data-id="${escapeHtml(item.id)}" type="button">সম্পাদনা</button><button class="mini-btn reject" data-manager-action="delete-notice" data-id="${escapeHtml(item.id)}" type="button">মুছুন</button></div></div><p>${escapeHtml(item.body)}</p></article>`;
  }).join('') : '<p class="admin-empty">কার্যকর কোনো নোটিশ নেই।</p>';
}
function routineTodayKey(offset = 0) {
  return WEEK_DAYS[(new Date().getDay() + 1 + offset) % 7];
}
function routineRowsFor(day) {
  return routine[day]?.classes || [];
}
function routineCardHtml(rows, empty) {
  if (!rows.length) return `<p class="admin-empty">${empty}</p>`;
  return rows.map(item => `<article class="manager-record"><div class="manager-record-head"><h2>${escapeHtml(item.subject || 'বিষয় নেই')}</h2><span class="badge badge-approved">${escapeHtml(item.time || 'সময় নেই')}</span></div><p>${escapeHtml([item.className, item.teacher, item.room].filter(Boolean).join(' • ') || '—')}</p></article>`).join('');
}
function routineBlob(item) {
  return `${item.tag || ''} ${item.status || ''} ${item.subject || ''}`.toLowerCase();
}

let cachedDirectoryTeachers = [];
function installRoutineTeacherSelect(select) {
  if (!select || select.dataset.enhancedSelect === '1') return;
  select.dataset.enhancedSelect = '1';
  const proto = Object.getPrototypeOf(select);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (desc?.get && desc?.set) {
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(val) {
        const str = String(val ?? '');
        if (str) {
          const byId = [...this.options].find(opt => opt.dataset?.teacherId === str);
          if (byId) {
            desc.set.call(this, byId.value);
            return;
          }
          if (![...this.options].some(opt => opt.value === str)) {
            const opt = this.ownerDocument.createElement('option');
            opt.value = str;
            opt.textContent = str;
            opt.dataset.teacherId = 'TCH-001';
            opt.dataset.teacherName = str;
            this.appendChild(opt);
          }
        }
        desc.set.call(this, str);
      }
    });
  }
  select.addEventListener('change', () => {
    const opt = select.selectedOptions?.[0];
    const hidden = document.getElementById('managerRoutineTeacherId');
    if (hidden) hidden.value = opt?.dataset?.teacherId || '';
  });
}

function populateRoutineTeacherSelect() {
  const select = $('#managerRoutineTeacher') || $('#managerRoutineForm [name=teacher]');
  if (!select || select.tagName !== 'SELECT') return;
  installRoutineTeacherSelect(select);
  const current = select.value;
  const teachers = cachedDirectoryTeachers.length
    ? cachedDirectoryTeachers
    : [{ staffId: 'TCH-001', fullName: managerAccount?.fullName || 'প্রাথমিক শিক্ষক', username: 'teacher.apc' }];
  const options = ['<option value="">শিক্ষক নির্বাচন করুন</option>'];
  for (const t of teachers) {
    const name = String(t.fullName || t.username || '').trim();
    const staffId = String(t.staffId || 'TCH-001').trim();
    if (!name) continue;
    options.push(`<option value="${escapeHtml(name)}" data-teacher-id="${escapeHtml(staffId)}" data-teacher-name="${escapeHtml(name)}">${escapeHtml(name)} (${escapeHtml(staffId)})</option>`);
  }
  select.innerHTML = options.join('');
  if (current) select.value = current;
}

function renderRoutine() {
  populateRoutineTeacherSelect();
  // This route is reachable directly from Home/More: required class choices
  // must not depend on visiting the unrelated Classes screen first.
  renderRoutineClassOptions();
  if ($('#managerRoutineDays')) {
    $('#managerRoutineDays').innerHTML = WEEK_DAYS.map(day => `<button type="button" class="pay-tile" data-routine-day="${day}" aria-pressed="${day === routineDay ? 'true' : 'false'}"><span class="pay-tile-icon" aria-hidden="true">${iconMarkup('calendar', 'apc-color-icon', { variant: 'color' })}</span><span class="pay-tile-label">${dayLabel[day] || day}</span></button>`).join('');
  }
  if ($('#managerRoutineDayTitle')) $('#managerRoutineDayTitle').textContent = `${dayLabel[routineDay] || routineDay} — রুটিনে ক্লাস যোগ করুন`;
  const rows = routine[routineDay]?.classes || [];
  if ($('#managerRoutineList')) {
    $('#managerRoutineList').innerHTML = rows.length ? rows.map((item, index) => `<article class="manager-record"><div class="manager-record-head"><h2>${escapeHtml(item.subject || 'বিষয় নেই')}</h2><span class="badge badge-approved">${escapeHtml(item.time || 'সময় নেই')}</span></div><p>${escapeHtml(item.className || '')} • ${escapeHtml(item.teacher || '')} • ${escapeHtml(item.room || '')}</p><div class="manager-actions"><button type="button" class="mini-btn" data-manager-action="edit-routine" data-index="${index}">সম্পাদনা</button><button type="button" class="mini-btn reject" data-manager-action="delete-routine" data-index="${index}">মুছুন</button></div></article>`).join('') : '<p class="admin-empty">এই দিনের রুটিনের তথ্য নেই।</p>';
  }
  const classField = $('#managerRoutineForm [name=className]');
  if (classField) classField.value ||= '';
  const all = WEEK_DAYS.flatMap(day => routineRowsFor(day).map(item => ({ ...item, day })));
  const fill = (id, html) => { const node = document.getElementById(id); if (node) node.innerHTML = html; };
  fill('managerRoutineTodayList', routineCardHtml(routineRowsFor(routineTodayKey()), 'আজ কোনো ক্লাস নেই।'));
  fill('managerRoutineTomorrowList', routineCardHtml(routineRowsFor(routineTodayKey(1)), 'আগামীকাল কোনো ক্লাস নেই।'));
  fill('managerRoutineWeeklyList', WEEK_DAYS.map(day => `<section class="exam-card"><h3>${escapeHtml(dayLabel[day] || day)}</h3>${routineCardHtml(routineRowsFor(day), 'ক্লাস নেই।')}</section>`).join(''));
  fill('managerRoutineExamList', routineCardHtml(all.filter(item => /পরীক্ষা|exam/.test(routineBlob(item))), 'পরীক্ষা রুটিন এখনও নেই।'));
  fill('managerRoutineChangedList', routineCardHtml(all.filter(item => /পরিবর্ত|changed/.test(routineBlob(item))), 'পরিবর্তিত রুটিন নেই।'));
  fill('managerRoutineHolidayList', routineCardHtml(all.filter(item => /ছুটি|holiday/.test(routineBlob(item))), 'ছুটির তালিকা খালি।'));
  fill('managerRoutineImportantList', routineCardHtml(all.filter(item => /গুরুত্বপূর্ণ|important/.test(routineBlob(item))), 'গুরুত্বপূর্ণ সময়সূচি নেই।'));
  fill('managerRoutineOtherList', routineCardHtml(all.filter(item => !/পরীক্ষা|exam|পরিবর্ত|changed|ছুটি|holiday|গুরুত্বপূর্ণ|important/.test(routineBlob(item))), 'অন্যান্য রুটিন নেই।'));
}
function renderResults() {
  const completed = exams.exams.filter(exam => isLiveExam(exam)).sort((a, b) => Number(b.endAt || 0) - Number(a.endAt || 0));
  $('#managerResultList').innerHTML = completed.length ? completed.map(exam => `<article class="manager-result-exam">${examMeta(exam)}<p class="finance-hint">${exam.resultsPublished ? 'ফলাফল প্রকাশিত' : exam.type === 'mcq' ? 'MCQ: সময় শেষে সবার উত্তরপত্র জমা হলে ফলাফল নিজেই প্রকাশিত হবে' : 'ফলাফল এখনো শিক্ষার্থীদের জন্য প্রকাশিত নয়'}</p><div class="manager-actions"><button type="button" class="mini-btn" data-manager-action="download-result" data-id="${escapeHtml(exam.id)}">Marks / Result CSV</button>${exam.resultsPublished ? '' : `<button type="button" class="mini-btn approve" data-manager-action="publish-results" data-id="${escapeHtml(exam.id)}">ফলাফল চূড়ান্তভাবে প্রকাশ</button>`}</div>${resultMarkup(exams, exam, true)}</article>`).join('') : '<p class="admin-empty">এখনো কোনো প্রকাশিত পরীক্ষা নেই।</p>';
}
function renderProfile() {
  const account = managerAccount || {};
  const markup = `<div class="manager-profile-list"><div><small>নাম</small><strong>${escapeHtml(account.fullName || 'Manager')}</strong></div><div><small>ইউজারনেম</small><strong>${escapeHtml(account.username || '—')}</strong></div><div><small>যোগাযোগ</small><strong>${escapeHtml(account.mobile || '—')}</strong></div><div><small>ইমেইল</small><strong>${escapeHtml(account.email || '—')}</strong></div><div><small>ভূমিকা</small><strong>ম্যানেজার — পরিচালনা নিয়ন্ত্রক</strong></div><div><small>অ্যাকাউন্টের অবস্থা</small><strong>${escapeHtml(({ active: 'সক্রিয়', suspended: 'স্থগিত', inactive: 'নিষ্ক্রিয়' }[account.status || account.accountStatus] || account.status || account.accountStatus || 'সক্রিয়'))}</strong></div></div><div class="row-actions"><button class="admin-btn ghost" type="button" data-profile-edit>নিজের তথ্য সম্পাদনা</button></div>`;
  if ($('#managerProfileCard')) $('#managerProfileCard').innerHTML = markup;
  if ($('#managerOwnProfileCard')) $('#managerOwnProfileCard').innerHTML = markup;
  syncManagerPanelHead();
}
async function loadOperationalData() {
  students = loadRoster(); notices = loadNotices(); routine = loadRoutine();
  const [tx, examData, teachingData] = await Promise.allSettled([financeRepository.listTransactions({ role: 'manager' }), examRepository.list(MANAGER_ACTOR), teachingRepository.listForManager()]);
  const failures = [tx, examData, teachingData].filter(result => result.status === 'rejected').length;
  $('#managerDataError').hidden = failures === 0;
  transactions = tx.status === 'fulfilled' ? tx.value : [];
  exams = examData.status === 'fulfilled' ? examData.value : { exams: [], attempts: [] };
  teaching = teachingData.status === 'fulfilled' ? teachingData.value : { activities: [] };
  if (activeView === 'dashboard') renderDashboard();
  if (activeView === 'students') { expandedStudentId = null; renderStudents(); }
  if (activeView === 'academic') renderAcademic();
  if (activeView === 'academic-records') renderAcademicRecords();
  if (activeView === 'classes') renderClasses();
  if (activeView === 'teachers') renderTeachers();
  if (activeView === 'finance') renderFinance();
  if (activeView === 'notices') renderNotices();
  if (activeView === 'routine') renderRoutine();
  if (activeView === 'results') renderResults();
}
/* Session check only. The old guard also refused while any *other* action was
   still saving (managerBusy), which made an unrelated routine entry look like a
   session failure and silently drop the Manager's work; a per-action lock is
   not needed for these single-write handlers, whose values are idempotent. */
async function managerGuard() { return hasStaffSession('manager'); }
async function approveStudent(studentId, decision) {
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি। আবার প্রবেশ করুন।', true);
  const student = students.find(row => row.id === studentId);
  if (!student || student.status !== 'pending') return toast('এই নিবন্ধনে আর সিদ্ধান্ত নেওয়া যাবে না।', true);
  let note = '';
  if (decision === 'rejected') {
    let prompted;
    try { prompted = typeof window.prompt === 'function' ? window.prompt('বাতিলের কারণ লিখুন (আবশ্যক):', '') : undefined; } catch { prompted = undefined; }
    if (prompted === undefined) {
      await openRegistrationReview(studentId, { role: 'manager', onDone: () => { void loadOperationalData(); } });
      return;
    }
    if (prompted === null) return;
    note = String(prompted).trim();
    if (!note) return toast(DECISION_MESSAGES['note-required'], true);
  }
  managerBusy = true;
  try {
    // Shared with the Admin panel and the notification review dialog.
    const result = await decideRegistration(studentId, decision, { role: 'manager', note });
    if (!result.ok) throw new Error(DECISION_MESSAGES[result.reason] || 'শিক্ষার্থী-সংক্রান্ত সিদ্ধান্ত সংরক্ষণ হয়নি।');
    await loadOperationalData(); toast(decision === 'approved' ? 'Registration অনুমোদিত হয়েছে।' : 'Registration কারণসহ বাতিল হয়েছে।');
  } catch (error) { toast(error.message || 'সিদ্ধান্ত সংরক্ষণ হয়নি।', true); }
  finally { managerBusy = false; }
}
// A decision from the notification dialog (or another tab) refreshes the queue.
window.addEventListener(DECIDED_EVENT, () => { if (!managerBusy) void loadOperationalData(); });
/** Deactivate (pause) or activate a student through the shared roster record.
    Nothing is deleted: fees, results, attendance and the account history stay. */
async function toggleStudentStatus(studentId, status) {
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  const student = students.find(row => row.id === studentId);
  if (!student) return toast('শিক্ষার্থী পাওয়া যায়নি।', true);
  if (status === 'inactive' && !window.confirm(`${student.name} কে নিষ্ক্রিয় করবেন? অ্যাকাউন্ট, ফি ও ফলাফলের ইতিহাস মুছে যাবে না।`)) return;
  managerBusy = true;
  try {
    await setStudentStatus(studentId, status);
    students = loadRoster();
    await loadOperationalData();
    toast(status === 'inactive' ? 'শিক্ষার্থী নিষ্ক্রিয় করা হয়েছে।' : 'শিক্ষার্থী আবার সক্রিয় করা হয়েছে।');
  } catch (error) {
    toast(error.message || 'অবস্থা বদলানো যায়নি।', true);
  } finally { managerBusy = false; }
}

/** Password reset uses the device's own account record, exactly like the Admin
    panel's reset: the student's mobile number and শিক্ষার্থী আইডি never change. */
function openStudentPasswordReset(student) {
  const account = loadAccount();
  const isLocal = account?.student?.id === student.id || account?.studentId === student.id;
  $('#managerModalKicker').textContent = 'অ্যাকাউন্ট নিরাপত্তা';
  $('#managerModalTitle').textContent = `${student.name} — পাসওয়ার্ড রিসেট`;
  $('#managerModalBody').innerHTML = `<p class=\"modal-copy\">${isLocal
    ? 'নতুন পাসওয়ার্ড দিন, অথবা ফাঁকা রেখে নিশ্চিত করুন — তখন একটি র‍্যান্ডম ৬ সংখ্যার পাসওয়ার্ড তৈরি হবে এবং একবারই দেখানো হবে। শিক্ষার্থী আইডি ও মোবাইল নম্বর অপরিবর্তিত থাকবে।'
    : 'এই শিক্ষার্থীর অ্যাকাউন্ট এই ব্রাউজারে নেই — সেটি নিজের ডিভাইস থেকে পাসওয়ার্ড বদলাবে। রিসেট শুধু ডেমো।'}</p>
    <label class=\"finance-field\"><span>নতুন পাসওয়ার্ড (৪–৬ সংখ্যা, ফাঁকা রাখলে র‍্যান্ডম হবে)</span><input id=\"managerPinInput\" type=\"password\" inputmode=\"numeric\" autocomplete=\"new-password\" maxlength=\"6\"></label>
    <div class=\"pin-box\" id=\"managerPinBox\" hidden></div>
    <p id=\"managerPinNote\" class=\"modal-copy\" hidden>এই পাসওয়ার্ড একবারই দেখানো হচ্ছে — এখনই লিখে রাখুন। পরে আর দেখা যাবে না।</p>
    <p id=\"managerPinError\" class=\"finance-error\" role=\"alert\" hidden></p>
    <div class=\"modal-actions\"><button class=\"admin-btn primary\" type=\"button\" data-modal-action=\"confirm-reset\">${isLocal ? 'রিসেট নিশ্চিত করুন' : 'বুঝেছি'}</button>
    <button class=\"admin-btn ghost\" type=\"button\" data-close-manager>বাতিল</button></div>`;
  $('#managerModalBackdrop').hidden = false;
  $('#managerModalBody [data-modal-action=\"confirm-reset\"]').addEventListener('click', async event => {
    // event.currentTarget is null after the await below (see manager-forms.test.mjs).
    const action = event.currentTarget;
    const fail = message => {
      $('#managerPinError').textContent = message;
      $('#managerPinError').hidden = false;
    };
    if (!isLocal) {
      closeManagerModal();
      toast('ডেমো রিসেট দেখানো হয়েছে');
      return;
    }
    if (action.dataset.revealed === '1') {
      closeManagerModal();
      toast(`${student.name} এর পাসওয়ার্ড রিসেট হয়েছে`);
      return;
    }
    const resolved = resolveResetPassword($('#managerPinInput').value);
    if (resolved.error) return fail(resolved.error);
    const latest = loadAccount();
    if ((latest?.student?.id !== student.id && latest?.studentId !== student.id) || !(await saveAccount({ ...latest, pin: resolved.password }))) {
      return fail('পাসওয়ার্ড সংরক্ষণ হয়নি। আবার চেষ্টা করুন।');
    }
    if (resolved.generated) {
      // One-time display: the plaintext exists only in this dialog.
      $('#managerPinInput').closest('.finance-field').hidden = true;
      $('#managerPinBox').hidden = false;
      $('#managerPinBox').textContent = resolved.password;
      $('#managerPinNote').hidden = false;
      action.textContent = 'বুঝেছি';
      action.dataset.revealed = '1';
      $('#managerPinError').hidden = true;
      return;
    }
    closeManagerModal();
    toast(`${student.name} এর পাসওয়ার্ড রিসেট হয়েছে`);
  });
}
function closeManagerModal() { const node = $('#managerModalBackdrop'); if (node) node.hidden = true; }

async function reviewPayment(id, decision) {
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  const note = decision === 'rejected' ? window.prompt('Payment reject করার কারণ লিখুন (আবশ্যক):', '')?.trim() : '';
  if (decision === 'rejected' && !note) return;
  managerBusy = true;
  try { transactions = await financeRepository.reviewTransaction(id, decision, note); await loadOperationalData(); toast(decision === 'approved' ? 'Payment অনুমোদিত ও final হয়েছে।' : 'Payment কারণসহ বাতিল হয়েছে।'); }
  catch (error) { toast(error.message || 'Payment review সংরক্ষণ হয়নি।', true); }
  finally { managerBusy = false; }
}
function studentProfile(student) {
  const fee = studentFeeSummary(student, transactions);
  return `<dl class="manager-profile-list"><div><small>শিক্ষার্থী আইডি</small><strong>${escapeHtml(student.id)}</strong></div><div><small>অবস্থা</small><strong>${escapeHtml(statusLabel[student.status] || student.status)}</strong></div><div><small>শ্রেণি / ব্যাচ</small><strong>${escapeHtml(student.className || '—')} • ${escapeHtml(student.group || '—')}</strong></div><div><small>শিক্ষার্থীর মোবাইল</small><strong>${escapeHtml(student.mobile || '—')}</strong></div><div><small>অভিভাবকের মোবাইল</small><strong>${escapeHtml(student.guardianMobile || '—')}</strong></div><div><small>মাসিক বকেয়া</small><strong>${money(fee.due)}</strong></div><div><small>উপস্থিতির সারাংশ</small><strong>${student.attendance == null ? '—' : `${escapeHtml(student.attendance)}%`}</strong></div><div><small>গড় ফলাফলের সারাংশ</small><strong>${student.average == null ? '—' : escapeHtml(student.average)}</strong></div></dl>`;
}
function showStudentEditor(card, student) {
  const root = card.querySelector('.manager-student-extra');
  root.hidden = false;
  const classNames = listClasses().filter(item => item.active !== false).map(item => item.name);
  root.innerHTML = `<form class="manager-form manager-edit-form"><label>নাম<input name="name" maxlength="100" required value="${escapeHtml(student.name || '')}"></label><label>শিক্ষার্থীর মোবাইল<input name="mobile" maxlength="32" value="${escapeHtml(student.mobile || '')}"></label><label>অভিভাবকের মোবাইল<input name="guardianMobile" maxlength="32" value="${escapeHtml(student.guardianMobile || '')}"></label><label>ক্লাস<select name="className" required>${classNames.map(name => `<option value="${escapeHtml(name)}" ${name === student.className ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label><label>ব্যাচ / বিভাগ<input name="group" maxlength="80" value="${escapeHtml(student.group || '')}"></label><label>মাসিক ফি<input name="monthlyFee" type="number" min="0" max="1000000" step="1" value="${Number(student.monthlyFee ?? DEFAULT_MONTHLY_FEE)}"></label><button class="admin-btn primary" type="submit">পরিবর্তন সংরক্ষণ</button></form>`;
  root.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    /* Captured now: an async handler resumes after the dispatch is over, when
       event.currentTarget is already null (see tests/manager-forms.test.mjs). */
    const form = event.currentTarget;
    if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
    const fields = Object.fromEntries(new FormData(form));
    managerBusy = true;
    try {
      await updateStudentOperationalInfo(student.id, { ...fields, monthlyFee: Number(fields.monthlyFee) });
      students = loadRoster();
      await loadOperationalData(); toast('শিক্ষার্থীর পরিচালনাগত তথ্য হালনাগাদ হয়েছে।');
    } catch (error) {
      toast(error.message || 'পরিবর্তন সংরক্ষণ হয়নি।', true);
    } finally { managerBusy = false; }
  });
}
async function editNotice(notice) {
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  const title = window.prompt('নোটিশের শিরোনাম', notice.title); if (title == null || !title.trim()) return;
  const body = window.prompt('নোটিশের বিবরণ', notice.body); if (body == null || !body.trim()) return;
  const categoryInput = window.prompt('নোটিশ বোর্ডের বিভাগ লিখুন: urgent / academic / class / fee / exam', noticeCategory(notice));
  if (categoryInput == null) return;
  if (!(await managerGuard())) return;
  notices = notices.map(item => item.id === notice.id ? { ...item, title: title.trim().slice(0, 120), body: body.trim().slice(0, 1000), category: noticeCategory(categoryInput), updatedAt: new Date().toISOString() } : item);
  /* title/body/category only: the class/batch scope and the author stay. */
  if (!saveNotices(notices)) return toast('নোটিশ সংরক্ষণ হয়নি।', true);
  void loadOperationalData(); toast('নোটিশ আপডেট হয়েছে।');
}
async function changeRoutine(index) {
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  const item = routine[routineDay]?.classes?.[index]; if (!item) return;
  const subject = window.prompt('বিষয়', item.subject); if (subject == null || !subject.trim()) return;
  const teacher = window.prompt('শিক্ষক দায়িত্ব', item.teacher); if (teacher == null || !teacher.trim()) return;
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  item.subject = subject.trim().slice(0, 80); item.teacher = teacher.trim().slice(0, 100);
  if (!saveRoutine(routine)) return toast('রুটিন সংরক্ষণ হয়নি।', true);
  void loadOperationalData(); toast('রুটিনের দায়িত্ব হালনাগাদ হয়েছে।');
}

/* আরও markup is static in manager.html (#managerMoreHub). Do not inject rows. */
document.addEventListener('click', event => {
  const examTile = event.target.closest('[data-manager-exam]');
  if (examTile) {
    const key = examTile.dataset.managerExam || '';
    const nextScreen = EXAM_SCREENS[key] || 'home';
    const alreadyOpen = Boolean(managerExamScreen && managerExamTileKey === key);
    if (alreadyOpen) {
      managerExamScreen = '';
      managerExamTileKey = '';
    } else {
      managerExamScreen = nextScreen;
      managerExamTileKey = key;
    }
    renderView('exams');
    return;
  }
  const moreAction = event.target.closest('[data-more-action]');
  if (moreAction) {
    const kind = moreAction.dataset.moreAction;
    if (kind === 'password') openStaffPasswordDialog({ role: 'manager', mode: 'change' });
    if (kind === 'logout') { clearStaffSession('manager'); goToLoginPage(); }
    return;
  }
  const profileAction = event.target.closest('[data-profile-action]');
  if (profileAction) {
    const kind = profileAction.dataset.profileAction;
    if (kind === 'password') {
      openStaffPasswordDialog({ role: 'manager', mode: 'change' });
      return;
    }
    const panel = $('.manager-view[data-view-panel="profile"]');
    if (panel) {
      const next = panel.dataset.profileOpen === kind ? '' : kind;
      if (next) panel.dataset.profileOpen = next;
      else delete panel.dataset.profileOpen;
      $$('[data-profile-action]').forEach(btn => {
        const active = Boolean(next && btn.dataset.profileAction === next);
        btn.classList.toggle('is-open', active);
        btn.setAttribute('aria-expanded', active ? 'true' : 'false');
      });
    }
    return;
  }
  const toggleConfig = [
    ['[data-classes-action]', 'classes', 'classesOpen', 'classesAction'],
    ['[data-teachers-action]', 'teachers', 'teachersOpen', 'teachersAction'],
    ['[data-notices-action]', 'notices', 'noticesOpen', 'noticesAction'],
    ['[data-routine-action]', 'routine-class', 'routineOpen', 'routineAction'],
    ['[data-routine-child-action]', null, 'routineChildOpen', 'routineChildAction'],
    ['[data-courses-action]', 'courses', 'coursesOpen', 'coursesAction'],
    ['[data-results-action]', 'results', 'resultsOpen', 'resultsAction'],
    ['[data-reports-action]', 'reports', 'reportsOpen', 'reportsAction'],
    ['[data-advice-action]', 'advice', 'adviceOpen', 'adviceAction']
  ];
  for (const [selector, viewKey, dataProp, btnProp] of toggleConfig) {
    const btn = event.target.closest(selector);
    if (!btn) continue;
    const panel = viewKey ? $(`.manager-view[data-view-panel="${viewKey}"]`) : btn.closest('.manager-view');
    if (!panel) return;
    const val = btn.dataset[btnProp] || '1';
    const next = panel.dataset[dataProp] === val ? '' : val;
    if (next) panel.dataset[dataProp] = next;
    else delete panel.dataset[dataProp];
    panel.querySelectorAll(selector).forEach(item => {
      const active = Boolean(next && item.dataset[btnProp] === next);
      item.classList.toggle('is-open', active);
      item.setAttribute('aria-expanded', active ? 'true' : 'false');
    });
    return;
  }
});
$$('[data-panel-view]').forEach(button => button.addEventListener('click', () => {
  const view = button.dataset.panelView;
  if (view === 'exams') { managerExamScreen = ''; managerExamTileKey = ''; }
  if (!normalizeView(view)) return;
  /* A shortcut may carry its own filter (dashboard → অনুমোদন opens শিক্ষার্থী
     already filtered to the pending queue). */
  const studentsPanel = $('.manager-view[data-view-panel="students"]');
  const financePanel = $('.manager-view[data-view-panel="finance"]');
  if (button.dataset.studentScope) {
    studentScope = button.dataset.studentScope;
    if (studentsPanel) studentsPanel.dataset.studentsOpen = '1';
  } else if (view === 'students' && studentsPanel) {
    delete studentsPanel.dataset.studentsOpen;
  }
  if (button.dataset.financeSegment) {
    financeSegment = button.dataset.financeSegment;
    if (financePanel) financePanel.dataset.financeOpen = '1';
  } else if (view === 'finance' && financePanel) {
    delete financePanel.dataset.financeOpen;
  }
  renderView(view);
  pressTiles('[data-student-scope]', item => item.dataset.studentScope === studentScope);
  pressTiles('[data-finance-segment]', item => item.dataset.financeSegment === financeSegment);
}));
$('#managerStudentSearch').addEventListener('input', () => {
  const studentsPanel = $('.manager-view[data-view-panel="students"]');
  if (studentsPanel) studentsPanel.dataset.studentsOpen = '1';
  expandedStudentId = null;
  renderStudents();
});
$('#managerStudentSearch').addEventListener('search', () => { expandedStudentId = null; renderStudents(); });
$('#managerStudentSearchClear')?.addEventListener('click', () => {
  const input = $('#managerStudentSearch');
  if (input) {
    input.value = '';
    expandedStudentId = null;
    renderStudents();
    input.focus();
  }
});
$$('.manager-view[data-view-panel="students"] [data-student-scope]').forEach(button => button.addEventListener('click', () => {
  const studentsPanel = $('.manager-view[data-view-panel="students"]');
  const nextScope = button.dataset.studentScope;
  const alreadyOpen = Boolean(studentsPanel?.dataset.studentsOpen === '1' && studentScope === nextScope);
  studentScope = nextScope;
  expandedStudentId = null;
  if (studentsPanel) {
    if (alreadyOpen) delete studentsPanel.dataset.studentsOpen;
    else studentsPanel.dataset.studentsOpen = '1';
  }
  pressTiles('[data-student-scope]', item => Boolean(studentsPanel?.dataset.studentsOpen === '1' && item === button));
  renderStudents();
}));
function handleStudentAction(button) {
  const student = students.find(row => row.id === button.dataset.id); if (!student) return;
  const card = button.closest('.manager-record');
  const extra = card?.querySelector('.manager-student-extra');
  const action = button.dataset.managerAction;
  if (action === 'toggle-student-details') {
    expandedStudentId = expandedStudentId === student.id ? null : student.id;
    renderStudents();
    $$('#managerStudentQueue [data-manager-action="toggle-student-details"], #managerStudentList [data-manager-action="toggle-student-details"]')
      .find(toggle => toggle.dataset.id === student.id)?.focus({ preventScroll: true });
    return;
  }
  if (action === 'guardian-draft') {
    const kind = window.prompt('বার্তার ধরন: absence / result / due', 'due');
    if (kind) { try { const fee = studentFeeSummary(student, transactions); window.open(guardianDraft(student, kind, fee.due), '_blank', 'noopener,noreferrer'); } catch (error) { window.alert(error.message); } }
  }
  if (action === 'view-student' && extra) { extra.hidden = !extra.hidden; extra.innerHTML = extra.hidden ? '' : studentProfile(student); }
  if (action === 'edit-student' && card) showStudentEditor(card, student);
  if (action === 'deactivate-student') void toggleStudentStatus(student.id, 'inactive');
  if (action === 'activate-student') void toggleStudentStatus(student.id, 'approved');
  if (action === 'reset-password') openStudentPasswordReset(student);
}
$('#managerAcademicList')?.addEventListener('click', async event => {
  const deleteBtn = event.target.closest('[data-manager-action="delete-content"]');
  if (deleteBtn) {
    if (!window.confirm('এই কাজটি মুছবেন? শিক্ষার্থীদের তালিকা থেকেও সাথে সাথে সরে যাবে।')) return;
    if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
    try {
      teaching = await teachingRepository.deleteActivity(deleteBtn.dataset.id, { role: 'manager', id: 'manager' });
      renderAcademicRecords(); renderAcademic();
      toast('কাজটি মুছে ফেলা হয়েছে — শিক্ষার্থীদের তালিকা থেকে সরে গেছে।');
    } catch (error) { toast(error.message || 'কাজটি মুছা যায়নি।', true); }
    return;
  }
  const button = event.target.closest('[data-manager-attendance]'); if (!button) return;
  const value = window.prompt('উপস্থিতি: present / absent / late (বাতিল করতে Cancel)', 'present');
  if (value === null) return;
  const reason = window.prompt('পরিবর্তনের কারণ লিখুন (৭ দিন পরে বাধ্যতামূলক)', '');
  if (reason === null) return;
  try {
    const db = await teachingRepository.saveProgress(button.dataset.managerAttendance, { [button.dataset.student]: value }, { role: 'manager', id: 'manager' }, reason);
    teaching = db; renderAcademicRecords();
  } catch (error) { window.alert(error.message); }
});
$('#managerStudentList').addEventListener('click', event => {
  const button = event.target.closest('[data-manager-action]'); if (!button) return;
  handleStudentAction(button);
});
$('#managerStudentQueue').addEventListener('click', event => {
  const button = event.target.closest('[data-manager-action]'); if (!button) return;
  if (button.dataset.managerAction === 'approve-student') void approveStudent(button.dataset.id, 'approved');
  else if (button.dataset.managerAction === 'reject-student') void approveStudent(button.dataset.id, 'rejected');
  /* The queue is the same student record: its profile and edit live here too. */
  else handleStudentAction(button);
});
$('#managerPaymentList').addEventListener('click', event => {
  const button = event.target.closest('[data-manager-action]'); if (button) void reviewPayment(button.dataset.id, button.dataset.managerAction === 'approve-payment' ? 'approved' : 'rejected');
});
$('#managerCashList').addEventListener('click', event => {
  const button = event.target.closest('[data-manager-action]'); if (button) void reviewPayment(button.dataset.id, button.dataset.managerAction === 'approve-payment' ? 'approved' : 'rejected');
});
$('#managerCollectionPendingList')?.addEventListener('click', event => {
  const button = event.target.closest('[data-manager-action]'); if (button) void reviewPayment(button.dataset.id, button.dataset.managerAction === 'approve-payment' ? 'approved' : 'rejected');
});
$$('[data-cash-scope]').forEach(button => button.addEventListener('click', () => { cashScope = button.dataset.cashScope; renderCashCounter(); }));
/* A payment-review notification deep-links straight into the approval queue. */
window.addEventListener('apc-notification-action', event => {
  if (event.detail?.kind === 'payment-review') renderCashCounter();
});
$('#managerPaymentSearch').addEventListener('input', renderFinance);
$('#managerPaymentStatus').addEventListener('change', renderFinance);
$('#managerResultList').addEventListener('click', async event => {
  const button = event.target.closest('[data-manager-action]'); if (!button) return;
  const exam = exams.exams.find(item => item.id === button.dataset.id && isLiveExam(item));
  if (!exam) return;
  if (button.dataset.managerAction === 'download-result') { downloadResults(exams, exam); return; }
  if (button.dataset.managerAction === 'publish-results') {
    if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
    try { exams = await examRepository.publishResults(exam.id, MANAGER_ACTOR); renderResults(); toast('ফলাফল শিক্ষার্থীদের জন্য প্রকাশিত হয়েছে।'); }
    catch (error) { toast(error.message || 'ফলাফল প্রকাশ হয়নি।', true); }
  }
});
$('#managerNoticeForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;   // null again after the await below
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  const data = new FormData(form); const title = String(data.get('title') || '').trim(), body = String(data.get('body') || '').trim();
  if (!title || !body) return;
  notices.unshift({
    id: newId('NOT'), title: title.slice(0, 120), body: body.slice(0, 1000),
    category: noticeCategory(String(data.get('category') || 'academic')),
    audience: String(data.get('audience') || 'সকল শিক্ষার্থী'),
    /* Class/batch scope: empty means every class, exactly like the Teacher's
       composer — one record shape, one reader (js/notification-rules.js). */
    className: String(data.get('className') || '').trim().slice(0, 80),
    group: String(data.get('group') || '').trim().slice(0, 80),
    date: dateLabel(new Date()), createdAt: new Date().toISOString(), status: 'published',
    createdBy: managerAccount?.username || 'manager', createdByRole: 'manager',
    /* `author` is the field older reports and records already carry; keeping it
       means a Manager notice reads the same wherever it is opened. */
    author: managerAccount?.username || 'manager'
  });
  if (!saveNotices(notices)) return toast('নোটিশ সংরক্ষণ হয়নি।', true);
  form.reset(); await loadOperationalData(); renderNotices(); toast('নোটিশ প্রকাশিত হয়েছে।');
});
$('#managerNoticeList').addEventListener('click', async event => {
  const button = event.target.closest('[data-manager-action]'); if (!button) return;
  const notice = notices.find(item => item.id === button.dataset.id); if (!notice) return;
  if (button.dataset.managerAction === 'edit-notice') await editNotice(notice);
  if (button.dataset.managerAction === 'delete-notice') {
    if (!window.confirm('এই নোটিশ মুছবেন?')) return;
    if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
    notices = notices.filter(item => item.id !== notice.id);
    if (saveNotices(notices)) { renderNotices(); toast('নোটিশ মুছে ফেলা হয়েছে।'); }
  }
});
/* একাডেমিক hub: a card opens the one screen that owns that work. */
document.addEventListener('click', event => {
  const card = event.target.closest('[data-academic-section]');
  if (card) {
    const target = ACADEMIC_SECTIONS[card.dataset.academicSection];
    if (target) {
      if (target.scope) {
        academicScope = target.scope;
        const recPanel = $('.manager-view[data-view-panel="academic-records"]');
        if (recPanel) recPanel.dataset.academicOpen = '1';
      }
      managerExamScreen = target.screen || (target.view === 'exams' ? '' : managerExamScreen);
      managerExamTileKey = target.screen || '';
      renderView(target.view);
      pressTiles('[data-academic-scope]', item => item.dataset.academicScope === academicScope);
    }
    return;
  }
  if (event.target.closest('[data-close-manager]')) closeManagerModal();
});
$('#managerAcademicFilters').addEventListener('click', event => {
  const chip = event.target.closest('[data-academic-scope]'); if (!chip) return;
  const recPanel = $('.manager-view[data-view-panel="academic-records"]');
  const nextScope = chip.dataset.academicScope;
  const alreadyOpen = Boolean(recPanel?.dataset.academicOpen === '1' && academicScope === nextScope);
  academicScope = nextScope;
  if (recPanel) {
    if (alreadyOpen) delete recPanel.dataset.academicOpen;
    else recPanel.dataset.academicOpen = '1';
  }
  pressTiles('[data-academic-scope]', item => Boolean(recPanel?.dataset.academicOpen === '1' && item === chip));
  renderAcademicRecords();
});
['managerAcademicSearch', 'managerAcademicClass'].forEach(id => $('#' + id).addEventListener(id.includes('Search') ? 'input' : 'change', () => {
  const recPanel = $('.manager-view[data-view-panel="academic-records"]');
  if (recPanel) recPanel.dataset.academicOpen = '1';
  renderAcademicRecords();
}));
$$('[data-finance-segment]').forEach(button => button.addEventListener('click', () => {
  const finPanel = $('.manager-view[data-view-panel="finance"]');
  const nextSeg = button.dataset.financeSegment;
  const alreadyOpen = Boolean(finPanel?.dataset.financeOpen === '1' && financeSegment === nextSeg);
  financeSegment = nextSeg;
  if (finPanel) {
    if (alreadyOpen) delete finPanel.dataset.financeOpen;
    else finPanel.dataset.financeOpen = '1';
  }
  renderFinance();
}));
$('#managerFinanceApprovalLink')?.addEventListener('click', () => {
  const finPanel = $('.manager-view[data-view-panel="finance"]');
  if (finPanel) finPanel.dataset.financeOpen = '1';
  financeSegment = 'approval';
  renderFinance();
});
$('#managerDueSearch')?.addEventListener('input', renderFinance);
$('#managerDueClass')?.addEventListener('change', renderFinance);
$('#managerRoutineDays').addEventListener('click', event => { const button = event.target.closest('[data-routine-day]'); if (!button) return; routineDay = button.dataset.routineDay; renderRoutine(); });
$('#managerRoutineList').addEventListener('click', async event => {
  const button = event.target.closest('[data-manager-action]'); if (!button) return;
  const index = Number(button.dataset.index); const rows = routine[routineDay]?.classes || [];
  if (button.dataset.managerAction === 'edit-routine') await changeRoutine(index);
  if (button.dataset.managerAction === 'delete-routine' && window.confirm('এই routine entry মুছবেন?')) {
    if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
    rows.splice(index, 1); if (!saveRoutine(routine)) return toast('রুটিন সংরক্ষণ হয়নি।', true); renderRoutine(); toast('রুটিনের তথ্য মুছে ফেলা হয়েছে।');
  }
});
$('#managerTeacherAssignmentForm').addEventListener('change', event => {
  if (event.target.name !== 'className') return;
  renderTeacherSubjectPicker(event.target.value);
});
$('#managerTeacherAssignmentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  const data = new FormData(form);
  try {
    const subjects = data.getAll('subject').map(String).filter(Boolean);
    await saveTeacherAssignment({ id: editingAssignmentId, className: data.get('className'), group: data.get('group'), subjects, teacherUsername: data.get('teacherUsername') });
    const wasEditing = Boolean(editingAssignmentId);
    editingAssignmentId = '';
    form.reset(); await renderTeachers(); await loadOperationalData(); toast(wasEditing ? 'শিক্ষকের দায়িত্ব হালনাগাদ হয়েছে' : 'শিক্ষকের দায়িত্ব সংরক্ষণ হয়েছে।');
  } catch (error) { toast(error.message || 'Assignment সংরক্ষণ হয়নি।', true); }
});
$('#managerTeacherAssignmentForm').addEventListener('click', event => {
  if (!event.target.closest('[data-manager-action="cancel-assignment-edit"]')) return;
  editingAssignmentId = '';
  renderTeachers();
});
$('#managerTeacherList').addEventListener('click', async event => {
  const editButton = event.target.closest('[data-manager-action="edit-teacher-assignment"]');
  if (editButton) {
    const editForm = $('#managerTeacherAssignmentForm');
    const record = assignmentRowsById.get(editButton.dataset.id);
    if (!editForm || !record) return toast('Assignment টি সম্পাদনার জন্য খুলা যায়নি', true);
    editingAssignmentId = record.id;
    await renderTeachers();
    editForm.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    editForm.elements.teacherUsername.focus?.();
    return;
  }
  const subjectButton = event.target.closest('[data-manager-action="delete-teacher-subject"]');
  if (subjectButton) {
    if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
    try {
      await deleteAssignmentSubject(subjectButton.dataset.id, subjectButton.dataset.subject);
      await renderTeachers();
      toast('বিষয়টি assignment থেকে সরানো হয়েছে — বাকি বিষয় অক্ষত আছে।');
    } catch (error) { toast(error.message || 'বিষয় সরানো হয়নি।', true); }
    return;
  }
  const button = event.target.closest('[data-manager-action="delete-teacher-assignment"]');
  if (!button || !window.confirm('এই শিক্ষকের দায়িত্ব সরাবেন?')) return;
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  try { if (!window.confirm('এই শিক্ষকের এই ক্লাস/ব্যাচের দায়িত্ব সরাবেন? বিষয়গুলোও মুছে যাবে।')) return; await deleteTeacherAssignment(button.dataset.id); await renderTeachers(); toast('শিক্ষকের দায়িত্ব সরানো হয়েছে।'); }
  catch (error) { toast(error.message || 'দায়িত্ব সরানো হয়নি।', true); }
});
$('#managerRoutineForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;   // null again after the await below
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  const data = new FormData(form), time = String(data.get('time'));
  const [hour, minute] = time.split(':').map(Number), period = hour < 4 ? 'ভোর' : hour < 12 ? 'সকাল' : hour < 16 ? 'বিকেল' : 'সন্ধ্যা';
  const label = `${bn(hour % 12 || 12)}:${bn(String(minute).padStart(2, '0'))}`;
  const teacherSelect = form.querySelector('#managerRoutineTeacher') || form.querySelector('[name="teacher"]');
  const selectedOpt = teacherSelect?.selectedOptions?.[0];
  const rawTeacher = String(data.get('teacher') || '').trim();
  const matchedTeacher = cachedDirectoryTeachers.find(t => t.staffId === rawTeacher || t.fullName === rawTeacher);
  const teacherId = String(selectedOpt?.dataset?.teacherId || data.get('teacherId') || matchedTeacher?.staffId || 'TCH-001').trim();
  const teacherName = String(selectedOpt?.dataset?.teacherName || matchedTeacher?.fullName || rawTeacher).trim();
  const className = String(data.get('className') || '').trim();
  const group = String(data.get('group') || '').trim();
  routine[routineDay].classes.push({ id: newId('RTN'), className, classId: normalizeClassId(className), group, sectionId: normalizeSectionId(group), subject: String(data.get('subject')).trim(), teacher: teacherName, teacherName, teacherId, room: String(data.get('room')).trim(), time: label, rawTime: time, duration: 60, period, tag: 'প্রকাশিত', tone: 'green', createdAt: new Date().toISOString(), status: 'published' });
  if (!saveRoutine(routine)) return toast('রুটিন সংরক্ষণ হয়নি।', true);
  form.reset(); routineDay = routineDay; renderRoutine(); toast('রুটিন প্রকাশিত হয়েছে।');
});
/* One door per panel: no route of ours leaves manager.html for another panel. */
installPanelGuard();
void rememberPanelPage();

function dismissManagerBoot() {
  document.getElementById('managerBootScreen')?.remove();
  document.getElementById('managerBootLink')?.remove();
}

async function enterManager() {
  /* A missing session locks the page in place — it never jumps to another
     page on its own (js/panel-lockdown.js). */
  if (!(await hasStaffSession('manager'))) {
    await lockPanel({ role: 'manager.html', reason: 'ম্যানেজার প্যানেল শুধু ম্যানেজার ইউজারনেম ও পাসওয়ার্ড দিয়ে খোলে।' });
    dismissManagerBoot();
    return;
  }
  managerAccount = await readStaffAccount('manager');
  /* Super Admin entry: the Admin enters with the Admin session alone, so a
     device that never provisioned a Manager account must not lock here —
     the Admin's own record stands in for display names and authorship. */
  if (!managerAccount && await hasStaffSession('admin')) {
    managerAccount = await readStaffAccount('admin');
  }
  try { const allStaff = await listStaff(); cachedDirectoryTeachers = allStaff.filter(s => s.role === 'teacher' && s.status === 'active'); } catch { cachedDirectoryTeachers = []; }
  if (!managerAccount) {
    await lockPanel({ role: 'manager.html', clear: 'manager', reason: 'এই ডিভাইসে ম্যানেজার অ্যাকাউন্টের রেকর্ড নেই — লগইন পেজ থেকে আবার প্রবেশ করুন।' });
    dismissManagerBoot();
    return;
  }
  document.getElementById('appEntryError')?.remove();
  $('#managerShell').hidden = false;
  ensureExamWorkspace();
  // A refresh (or a shared link) reopens the page that was open, when it is a
  // page this panel knows.
  const wanted = routeName();
  renderView(normalizeView(wanted) ? wanted : 'dashboard');
  onRouteChange(name => { const next = normalizeView(name); if (next && (next.view !== activeView || name !== next.view)) renderView(name); });
  // Auth is now validated and the real panel is painted; only now uncover it.
  dismissManagerBoot();
  await loadOperationalData();
  /* One Settings structure for every role (§29). The hub fills নিরাপত্তা ও ডেটা
     and mounts the notification rows — the Manager's profile card, password row
     and theme switch stay exactly where they were. */
  /* অ্যাকাউন্ট গ্রুপ: Admin-এর হুবহু একই ইনলাইন ফর্ম (মালিক-নির্দেশ ২০২৬-১১-০২)। */
  mountStaffAccountGroup({
    hub: '[data-settings-hub="manager"]',
    role: 'manager',
    logoutId: 'managerAccountLogout',
    onLogout: () => { clearStaffSession('manager'); window.dispatchEvent(new Event('apc-session-ended')); goToLoginPage(); },
    current: () => managerAccount,
    toast: message => toast(message)
  });
  mountSettingsHub({
    mount: '[data-settings-hub="manager"]',
    role: 'manager',
    actions: {
      password: () => openStaffPasswordDialog({ role: 'manager', mode: 'change' }),
      logout: () => { clearStaffSession('manager'); window.dispatchEvent(new Event('apc-session-ended')); goToLoginPage(); }
    },
    session: { value: `${bn(STAFF_SESSION_RULES.rememberDays.manager)} দিন`, hint: 'ডিভাইস-বাউন্ড সেশন', password: `${bn(STAFF_DIRECTORY_RULES.passwordMin)}–${bn(STAFF_DIRECTORY_RULES.passwordMax)} অক্ষর · PBKDF2 হ্যাশ` }
  });
  // পড়াশোনা পরিচালনা করুন: the same content library the Teacher writes into.
  await mountCourseEditor();
  await mountReports($('#managerReports'), { panel: 'manager' });
  for (const cardSelector of ['#managerProfileCard', '#managerOwnProfileCard']) {
    mountProfileSelfEdit({
      role: 'manager',
      card: cardSelector,
      current: () => managerAccount,
      render: async () => {
        try {
          const fresh = await readStaffAccount('manager');
          if (fresh) managerAccount = fresh;
        } catch { /* keep the current card */ }
        renderProfile();
      },
      toast: message => toast(message)
    });
  }
  if (typeof MutationObserver === 'function' && document.documentElement) {
    const obs = new MutationObserver(() => syncManagerPanelHead());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  syncManagerPanelHead();
  watchOwnPanelSession('manager');
  window.dispatchEvent(new Event('apc-session-ready'));
}
/** The content editor is mounted once and only painted when its page opens. */
let courseEditor = null;
let courseEditorMountFlight = null;
async function mountCourseEditor() {
  if (courseEditorMountFlight) return courseEditorMountFlight;
  if (courseEditor) { await courseEditor.paint?.(); return courseEditor; }
  courseEditorMountFlight = (async () => {
    try {
      const { initCourseEditor } = await import('./course-editor.js');
      courseEditor = initCourseEditor({ mount: '#managerCourseEditor', role: 'manager', actor: 'MANAGER', toast: message => toast(message) });
      await courseEditor.ready;
      return courseEditor;
    } catch (error) { console.warn('[Active Plus] course editor unavailable:', error?.name || 'unknown'); return null; }
  })().finally(() => { courseEditorMountFlight = null; });
  return courseEditorMountFlight;
}
$('#managerLogout').addEventListener('click', () => { clearStaffSession('manager'); window.dispatchEvent(new Event('apc-session-ended')); goToLoginPage(); });
const MANAGER_WATCHED_KEYS = new Set([
  'activePlus.admin.students.v1',
  'activePlus.registrationNotifications.v1',
  'activePlus.admin.transactions.v1',
  'activePlus.admin.notices.v1',
  'activePlus.admin.routine.v1',
  'activePlus.academics.v1',
  'activePlus.courses.v1',
  'activePlus.courseContent.v1',
  'active-plus-app-config-v1',
  'activePlus.staffDirectory.v1',
  TEACHING_KEY,
  TEACHER_ASSIGNMENTS_KEY,
  'activePlus.exams.v1'
]);
const MANAGER_WATCHED_COLLECTIONS = new Set([
  'students',
  'registrationNotifications',
  'transactions',
  'notices',
  'routine',
  'academics',
  'courses',
  'courseContent',
  'settings',
  'staffDirectory',
  'staffAccounts',
  'teaching',
  'teacherAssignments',
  'exams'
]);
function refreshManagerLiveData() {
  void loadOperationalData();
  refreshReports($('#managerReports'));
}
window.addEventListener('storage', event => {
  if (!event.key || MANAGER_WATCHED_KEYS.has(event.key)) refreshManagerLiveData();
});
window.addEventListener('apc-sync-updated', event => {
  const collection = event?.detail?.collection;
  const key = event?.detail?.key;
  if (!collection || MANAGER_WATCHED_COLLECTIONS.has(collection) || (key && MANAGER_WATCHED_KEYS.has(key))) {
    refreshManagerLiveData();
  }
});
export const managerReady = enterManager();
