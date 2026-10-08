import { hasStaffSession, clearStaffSession, readStaffAccount, goToLoginPage, STAFF_SESSION_RULES } from './staff-auth.js';
import { STAFF_DIRECTORY_RULES } from './staff-directory.js';
import { mountSettingsHub } from './settings-hub.js';
import { rememberRoute, onRouteChange, routeName } from './panel-route.js';
import { decideRegistration, DECISION_MESSAGES, DECIDED_EVENT } from './registration-review.js';
import { installPanelGuard, lockPanel, rememberPanelPage, watchOwnPanelSession } from './panel-lockdown.js';
import { openStaffPasswordDialog } from './staff-password-dialog.js';
import { loadRoster, updateStudentOperationalInfo, setStudentStatus, loadNotices, saveNotices, loadRoutine, saveRoutine, WEEK_DAYS } from './office-data.js';
import { loadAccount, saveAccount } from './storage.js';
import { DEFAULT_PIN } from './config.js';
import { financeRepository, monthLabel, dateLabel, studentFeeSummary, newestTransactions, isFinalizedTransaction, DEFAULT_MONTHLY_FEE } from './finance-data.js';
import { examRepository, isLiveExam, MANAGER_ACTOR } from './exam-data.js';
import { examMeta, resultMarkup, downloadResults } from './exam-ui.js';
import { teachingRepository, todayISO, TEACHING_KEY } from './teaching-data.js';
import { enabledClasses } from './config.js';
import { classCodes } from './admin-data.js';
import { newId } from './database.js';
import { escapeHtml } from './sanitize.js';
import { matchesStudentQuery } from './student-search.js';
import { registerServiceWorker } from './service-worker.js';
import { initFixedShell } from './fixed-shell.js';
import { initExamManager } from './exam-manager.js';
import { listTeacherAssignments, saveTeacherAssignment, deleteTeacherAssignment, deleteAssignmentSubject, selectableSubjects, TEACHER_ASSIGNMENTS_KEY } from './teacher-assignments.js';
import { listClasses } from './academics.js';
import { noticeCategory, noticeCategoryInfo } from './notification-rules.js';
import { mountReports, refreshReports } from './reports.js';
import { iconElement } from './icons.js';

registerServiceWorker();
initFixedShell();
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const bn = value => String(value ?? 0).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[digit]);
const money = value => `৳${bn(Number(value || 0).toLocaleString('en-US'))}`;
/* The Manager architecture (docs/APP-ARCHITECTURE.md §2): the bottom bar is
   হোম · শিক্ষার্থী · একাডেমিক · হিসাব · রিপোর্ট · আরও. Every screen that used to
   have its own seat keeps exactly one home; the two old names still resolve so
   a bookmark or a saved refresh never lands nowhere. */
const ROUTINE_CHILD_VIEWS = Object.freeze(['routine-today', 'routine-tomorrow', 'routine-weekly', 'routine-class', 'routine-exam', 'routine-changed', 'routine-holiday', 'routine-important', 'routine-other']);
const MANAGER_VIEWS = Object.freeze(['dashboard', 'students', 'academic', 'academic-records', 'classes', 'teachers', 'finance', 'notices', 'routine', ...ROUTINE_CHILD_VIEWS, 'exams', 'courses', 'results', 'reports', 'profile', 'more']);
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
  { view: 'classes', icon: 'book', label: 'ক্লাস পরিচালনা করুন', hint: 'শ্রেণি, ব্যাচ ও বিষয় তালিকা' },
  { view: 'profile', icon: 'user', label: 'ম্যানেজার প্রোফাইল', hint: 'নিজের পরিচয়, থিম, নোটিফিকেশন ও পাসওয়ার্ড' }
]);
const dayLabel = Object.freeze({ sat: 'শনিবার', sun: 'রবিবার', mon: 'সোমবার', tue: 'মঙ্গলবার', wed: 'বুধবার', thu: 'বৃহস্পতিবার' });
const statusLabel = Object.freeze({ approved: 'সক্রিয়', pending: 'অপেক্ষমাণ', inactive: 'নিষ্ক্রিয়', rejected: 'বাতিল' });
let students = loadRoster(), notices = loadNotices(), routine = loadRoutine(), transactions = [], exams = { exams: [], attempts: [] }, teaching = { activities: [] }, managerAccount = null;
let activeView = 'dashboard', studentScope = 'all', cashScope = 'pending', routineDay = 'sat', examStarted = false, managerBusy = false;
let financeSegment = 'collection', academicScope = 'all', academicClass = 'all';
/* One examination workspace for the panel; একাডেমিক → প্রশ্নব্যাংক / পরীক্ষা
   deep-link into its own screens instead of rendering a second copy. */
let examWorkspaceOpen = null;
let managerExamScreen = '';
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
  hub.hidden = open;
  workspace.hidden = !open;
  if (open) {
    ensureExamWorkspace();
    examWorkspaceOpen?.(managerExamScreen);
  }
}
const scopeLabel = Object.freeze({ all: 'সব', pending: 'নিবন্ধন অপেক্ষমাণ', approved: 'সক্রিয়', inactive: 'নিষ্ক্রিয়', rejected: 'বাতিল' });

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
  const seat = view === 'dashboard' ? 'dashboard'
    : view === 'students' ? 'students'
      : ['academic', 'academic-records', 'notices', 'routine', 'exams', 'results', 'courses', 'teachers', ...ROUTINE_CHILD_VIEWS].includes(view) ? 'academic'
        : view === 'finance' ? 'finance'
          : view === 'reports' ? 'reports' : 'more';
  $$('.manager-bottom [data-manager-view]').forEach(button => {
    const active = button.dataset.managerView === seat;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  // Refresh reopens this page: the open view lives in the URL. It is remembered
  // before the panels render, so a renderer that ever fails can still not send
  // the next refresh back to the dashboard.
  rememberRoute(view);
  if (view === 'dashboard') renderDashboard();
  if (view === 'students') renderStudents();
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
  const pendingStudents = students.filter(student => student.status === 'pending');
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const newToday = students.filter(student => Date.parse(student.createdAt || '') >= startOfToday.getTime()).length;
  const todayPayments = transactions.filter(tx => isFinalizedTransaction(tx) && tx.date === today);
  const totalToday = todayPayments.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const pendingTx = transactions.filter(tx => tx.status === 'pending');
  const todayKey = routineDayForToday();
  const todaysClasses = Object.hasOwn(routine, todayKey) ? (routine[todayKey]?.classes?.length || 0) : null;
  safeSetText('#managerToday', today);
  safeSetText('#mgrTotalStudents', bn(students.length)); safeSetText('#mgrActiveStudents', bn(approved.length));
  safeSetText('#mgrPendingStudents', `${bn(newToday)} / ${bn(pendingStudents.length)}`);
  safeSetText('#mgrTodayCollection', money(totalToday)); safeSetText('#mgrPendingPayments', bn(pendingTx.length)); safeSetText('#mgrTodayClasses', todaysClasses == null ? '—' : bn(todaysClasses));
  safeSetText('#mgrCounterStatus', pendingTx.length ? `${bn(pendingTx.length)}টি এন্ট্রি পর্যালোচনার অপেক্ষায়` : 'অপেক্ষমাণ এন্ট্রি নেই');
  safeSetText('#mgrAttendanceSummary', attendanceSummary());
  const upcoming = exams.exams.filter(exam => isLiveExam(exam) && Number(exam.startAt) >= Date.now()).sort((a, b) => a.startAt - b.startAt).slice(0, 3);
  $('#mgrUpcomingExams').innerHTML = upcoming.length ? upcoming.map(exam => compactRow(exam.title, `${exam.className || '—'} • ${new Date(exam.startAt).toLocaleDateString('bn-BD')}`)).join('') : '<p class="finance-hint">কোনো প্রকাশিত আসন্ন পরীক্ষা নেই।</p>';
  const pendingResults = exams.exams.filter(exam => isLiveExam(exam) && exam.type !== 'mcq' && exam.endAt < Date.now()).map(exam => ({ exam, remaining: (exam.participants || []).filter(person => !exams.attempts.some(a => a.examId === exam.id && a.studentId === person.id && (a.questionScores || a.status === 'absent'))).length })).filter(item => item.remaining > 0);
  $('#mgrPendingResults').innerHTML = pendingResults.length ? pendingResults.slice(0, 3).map(({ exam, remaining }) => compactRow(exam.title, `${bn(remaining)} শিক্ষার্থীর written marks/absence বাকি`)).join('') : '<p class="finance-hint">কোনো অপেক্ষমাণ ফলাফল record নেই।</p>';
  $('#mgrRecentNotices').innerHTML = notices.length ? notices.slice(0, 2).map(item => compactRow(item.title, item.date || '')).join('') : '<p class="finance-hint">এখনো কোনো নোটিশ নেই।</p>';
  const activity = [
    ...students.filter(s => s.reviewedAt).map(s => ({ at: s.reviewedAt, text: `নিবন্ধন ${statusLabel[s.status] || s.status}: ${s.name}` })),
    ...transactions.filter(tx => tx.reviewedAt).map(tx => ({ at: tx.reviewedAt, text: `পেমেন্ট ${statusLabel[tx.status] || tx.status}: ${tx.studentName} • ${money(tx.amount)}` })),
    ...notices.filter(n => n.createdAt).map(n => ({ at: n.createdAt, text: `নোটিশ: ${n.title}` }))
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
  $('#mgrRecentActivity').innerHTML = activity.length ? activity.map(item => compactRow(item.text, new Date(item.at).toLocaleString('bn-BD'))).join('') : '<p class="finance-hint">কোনো operational activity log সংরক্ষিত নেই।</p>';
}
function routineDayForToday(date = new Date()) { return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()]; }
function searchValue() { return String($('#managerStudentSearch')?.value || '').trim().toLocaleLowerCase(); }
/* The shared rule: the Student ID (full, short, Bangla digits or with dashes
   removed) always finds the student; name, guardian and mobiles match too. */
function studentMatches(student, query) { return !query || matchesStudentQuery(student, query); }
/** শিক্ষার্থী: one screen for the whole student lifecycle. Every row is the same
    roster record the student app reads; the pending queue is the same list,
    filtered — never a second copy of a student. */
function renderStudents() {
  const query = searchValue();
  const pending = students.filter(student => student.status === 'pending');
  safeSetText('#managerPendingBadge', `${bn(pending.length)} অপেক্ষমাণ`);
  /* The chips always show the filter actually in force — including one set by a
     shortcut or by an old link (dashboard → অনুমোদন, #approvals). */
  $$('[data-student-scope]').forEach(chip => {
    const active = chip.dataset.studentScope === studentScope;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
  const queue = $('#managerStudentQueue');
  if (queue) {
    queue.innerHTML = pending.length ? pending.map(student => `<article class="manager-record is-pending-registration"><div class="manager-record-head"><div><p class="eyebrow">${escapeHtml(student.id || 'Application')}</p><h2>${escapeHtml(student.name || 'নাম নেই')}</h2></div><span class="badge badge-pending">অপেক্ষমাণ</span></div><p>শ্রেণি ${escapeHtml(student.className || '—')} • ${escapeHtml(student.group || 'Batch নেই')}</p><p>মোবাইল ${escapeHtml(student.mobile || '—')} • অভিভাবক ${escapeHtml(student.guardianMobile || '—')}</p><p class="manager-meta">আবেদন: ${escapeHtml(student.enrolledAt || 'তারিখ নেই')}</p><div class="manager-actions"><button class="mini-btn approve" type="button" data-manager-action="approve-student" data-id="${escapeHtml(student.id)}">Approve</button><button class="mini-btn reject" type="button" data-manager-action="reject-student" data-id="${escapeHtml(student.id)}">Reject</button><button class="mini-btn" type="button" data-manager-action="view-student" data-id="${escapeHtml(student.id)}">প্রোফাইল</button></div><div class="manager-student-extra" hidden></div></article>`).join('') : '';
  }
  const list = students.filter(student => (studentScope === 'all' || student.status === studentScope) && studentMatches(student, query));
  $('#managerStudentList').innerHTML = list.length ? list.map(student => {
    const fee = studentFeeSummary(student, transactions);
    const tone = student.status === 'approved' ? 'badge-approved' : student.status === 'pending' ? 'badge-pending' : student.status === 'inactive' ? 'badge-inactive' : 'badge-rejected';
    /* Register, approve, edit, activate/deactivate, reset — the same roster row
       through one set of actions. A rejection is a decision, deactivation is a
       pause: they stay different statuses. */
    const lifecycle = student.status === 'approved'
      ? `<button class="mini-btn reject" type="button" data-manager-action="deactivate-student" data-id="${escapeHtml(student.id)}">Deactivate</button>`
      : student.status === 'inactive'
        ? `<button class="mini-btn approve" type="button" data-manager-action="activate-student" data-id="${escapeHtml(student.id)}">Activate</button>`
        : '';
    return `<article class="manager-record" data-manager-student="${escapeHtml(student.id)}"><div class="manager-record-head"><div><h2>${escapeHtml(student.name || 'নাম নেই')}</h2><p class="manager-meta">${escapeHtml(student.id)} • ${escapeHtml(student.className || 'ক্লাস নেই')} ${student.group ? `• ${escapeHtml(student.group)}` : ''}</p></div><span class="badge ${tone}">${escapeHtml(statusLabel[student.status] || student.status || 'অজানা')}</span></div><p>মোবাইল ${escapeHtml(student.mobile || '—')} • বকেয়া ${money(fee.due)} • উপস্থিতি ${student.attendance == null ? '—' : `${escapeHtml(student.attendance)}%`} • গড় ফল ${student.average == null ? '—' : escapeHtml(student.average)}</p><div class="manager-actions"><button class="mini-btn" type="button" data-manager-action="view-student" data-id="${escapeHtml(student.id)}">প্রোফাইল</button><button class="mini-btn" type="button" data-manager-action="edit-student" data-id="${escapeHtml(student.id)}">তথ্য সম্পাদনা</button>${lifecycle}<button class="mini-btn" type="button" data-manager-action="reset-password" data-id="${escapeHtml(student.id)}">পাসওয়ার্ড রিসেট</button></div><div class="manager-student-extra" hidden></div></article>`;
  }).join('') : '<p class="admin-empty">কোনো শিক্ষার্থী মেলেনি।</p>';
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
    return `<article class="manager-record"><div class="manager-record-head"><div><h2>${escapeHtml(className)}</h2><p class="manager-meta">${escapeHtml(classCodes[className] || '')}</p></div><span class="badge badge-approved">${bn(classStudents.length)} শিক্ষার্থী</span></div><p>Batch/Group: ${escapeHtml(groups.join(', ') || 'তথ্য নেই')}</p><p>Assigned teacher: ${escapeHtml(teacherNames.join(', ') || 'রুটিনে নেই')}</p></article>`;
  }).join('');
}
/** Step 3 of the assignment form: only the subjects Admin enabled for the
    chosen class (plus any legacy value already on the record, so nothing is
    stranded). One class → several ticked subjects → several assignments. */
function renderTeacherSubjectPicker(className, selected = []) {
  const box = $('#managerTeacherSubjectList');
  const note = $('[data-teacher-subject-note]');
  if (!box) return;
  const chosen = [...new Set([...selected, ...[...box.querySelectorAll('input[name=subject]:checked')].map(input => input.value)])];
  if (!className) {
    box.innerHTML = '<p class="admin-empty">আগে ক্লাস নির্বাচন করুন — তারপর সেই ক্লাসের বিষয়গুলো দেখবেন।</p>';
    if (note) note.textContent = 'Admin-এর ক্লাস ও বিষয় সেটআপ থেকেই এই তালিকা আসে।';
    return;
  }
  const options = selectableSubjects(className, { includeLegacy: chosen });
  box.innerHTML = options.length
    ? options.map(name => `<label class="manager-subject-option"><input type="checkbox" name="subject" value="${escapeHtml(name)}" ${chosen.includes(name) ? 'checked' : ''}> ${escapeHtml(name)}</label>`).join('')
    : '<p class="admin-empty">এই ক্লাসের জন্য Admin কোনো বিষয় চালু করেননি — Admin → ক্লাস ও বিষয় সেটআপ থেকে চালু করুন।</p>';
  if (note) note.textContent = options.length ? `${bn(options.length)}টি বিষয় চালু আছে — একাধিক টিক দিতে পারবেন।` : '';
}
async function renderTeachers() {
  const teacher = await readStaffAccount('teacher');
  const form = $('#managerTeacherAssignmentForm');
  if (form) {
    form.elements.teacherName.value = teacher?.fullName || 'Teacher profile unavailable';
    form.elements.teacherUsername.value = teacher?.username || '';
    const classes = listClasses().map(item => item.name);
    const choices = classes.length ? classes : [...enabledClasses];
    form.elements.className.innerHTML = `<option value="">শ্রেণি নির্বাচন</option>${choices.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
    form.elements.className.value = choices[0] || '';
    renderTeacherSubjectPicker(form.elements.className.value);
  }
  const assignments = teacher ? listTeacherAssignments(teacher.username) : [];
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
    return `<article class="manager-record"><div class="manager-record-head"><div><h2>${escapeHtml(item.className)}${item.group ? ` • ${escapeHtml(item.group)}` : ''}</h2><p class="manager-meta">${escapeHtml(item.teacherName)} • ${bn(subjects.length)}টি বিষয়</p><div class="manager-subject-chips">${chips}</div></div><button class="mini-btn reject" type="button" data-manager-action="delete-teacher-assignment" data-id="${escapeHtml(item.id)}">Assignment সরান</button></div></article>`;
  });
  const routineRows = [...schedule.entries()].flatMap(([name, items]) => items.map(item => `<li>${escapeHtml(name)} — ${escapeHtml(item)}</li>`));
  $('#managerTeacherList').innerHTML = `${cards.join('') || '<p class="admin-empty">এখনো কোনো Teacher class/batch assignment নেই। Teacher panel-এ assignment না থাকলে academic data access বন্ধ থাকবে।</p>'}<article class="manager-record"><h2>Routine schedule</h2><p>নিচের routine entries আলাদা schedule data; এগুলো নিজেরা Teacher access grant করে না।</p><ul>${routineRows.join('') || '<li>কোনো routine assignment নেই।</li>'}</ul><p class="manager-meta">সংরক্ষিত teaching activities: ${bn(activityCount)}</p></article>`;
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
    <p class="manager-meta">${escapeHtml(label[activity.type] || activity.type || '')} • ${escapeHtml(activity.className || '')}${activity.group ? ` • ${escapeHtml(activity.group)}` : ''} • ${escapeHtml(activity.subject || '')}</p></div>
    <span class="badge ${activity.status === 'published' ? 'badge-approved' : 'badge-pending'}">${activity.status === 'published' ? 'প্রকাশিত' : 'খসড়া'}</span></div>
    <p>${escapeHtml(activity.details || 'অতিরিক্ত বিবরণ নেই।')}</p>
    <p class="manager-meta">${escapeHtml(activity.teacherName || 'শিক্ষক')} • ${escapeHtml(activity.date || '')} ${escapeHtml(activity.time || '')}${activity.progress ? ` • ${bn(Object.keys(activity.progress).length)} শিক্ষার্থীর অবস্থা` : ''}</p></article>`).join('')
    : '<p class="admin-empty">এই ফিল্টারে কোনো কাজ পাওয়া যায়নি। কোনো শিক্ষক কিছু প্রকাশ করলে এখানে দেখা যাবে।</p>';
}

function renderFinance() {
  const approved = transactions.filter(isFinalizedTransaction);
  const month = monthLabel();
  const today = dateLabel(new Date());
  const monthTotal = approved.filter(tx => tx.month === month).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const total = approved.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const due = students.filter(s => s.status === 'approved').reduce((sum, s) => sum + studentFeeSummary(s, transactions).due, 0);
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
    button.setAttribute('aria-selected', String(active));
  });
  $$('[data-finance-panel]').forEach(panel => { panel.hidden = panel.dataset.financePanel !== financeSegment; });

  if (financeSegment === 'collection') {
    const todayRows = approved.filter(tx => tx.date === today);
    const monthRows = approved.filter(tx => tx.month === month);
    safeSetText('#mgrFinanceToday', money(todayRows.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)));
    safeSetText('#mgrFinanceTodayCount', bn(todayRows.length));
    safeSetText('#mgrFinanceCounterMonth', money(monthRows.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)));
    safeSetText('#mgrFinanceMonthCount', bn(monthRows.length));
    safeSetText('#mgrFinanceCollectionNote', pending.length
      ? `${bn(pending.length)}টি কাউন্টার এন্ট্রি অনুমোদনের অপেক্ষায় — “পেমেন্ট অনুমোদন” বিভাগে যান।`
      : 'সব কাউন্টার এন্ট্রি নিষ্পত্তি হয়েছে।');
  }

  if (financeSegment === 'approval') {
    const selected = transactions.filter(tx => cashScope === 'all' || (cashScope === 'approved' ? (tx.status || 'approved') === 'approved' : tx.status === cashScope));
    $('#managerCashList').innerHTML = newestTransactions(selected).length
      ? newestTransactions(selected).map(tx => transactionCard(tx, true)).join('')
      : '<p class="admin-empty">এই filter-এ কোনো Cash Counter entry নেই।</p>';
    $$('[data-cash-scope]').forEach(button => button.classList.toggle('active', button.dataset.cashScope === cashScope));
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
    $('#managerPaymentList').innerHTML = list.length ? list.map(tx => transactionCard(tx, false)).join('') : '<p class="admin-empty">কোনো payment record নেই।</p>';
  }
}
function transactionCard(tx, allowReview) {
  const status = tx.status || 'approved';
  const text = status === 'pending' ? 'অনুমোদন বাকি' : status === 'rejected' ? 'বাতিল' : 'অনুমোদিত';
  return `<article class="manager-record"><div class="manager-record-head"><div><h2>${escapeHtml(tx.studentName || 'শিক্ষার্থী তথ্য নেই')}</h2><p class="manager-meta">${escapeHtml(tx.studentId || '')} • ${escapeHtml(tx.className || '')} • ${escapeHtml(tx.receiptNo || tx.id)}</p></div><span class="badge ${status === 'approved' ? 'badge-approved' : status === 'pending' ? 'badge-pending' : 'badge-rejected'}">${text}</span></div><p><strong>${money(tx.amount)}</strong> • ${escapeHtml(tx.date || 'তারিখ নেই')} • ${escapeHtml(tx.method || 'মাধ্যম নেই')}</p><p>${escapeHtml(tx.feeType || '')} • ${escapeHtml(tx.month || '')} • Counter: ${escapeHtml(tx.collectedBy || 'পুরোনো রেকর্ড')}</p>${tx.trxRef ? `<p>Reference: ${escapeHtml(tx.trxRef)}</p>` : ''}${tx.note ? `<p>Note: ${escapeHtml(tx.note)}</p>` : ''}${tx.reviewNote ? `<p class="manager-status-warning">Review: ${escapeHtml(tx.reviewNote)}</p>` : ''}<p class="manager-meta">Review history: ${bn((tx.reviewHistory || []).length)} • ${escapeHtml(tx.reviewedBy || '—')}</p>${allowReview && status === 'pending' ? `<div class="manager-actions"><button class="mini-btn approve" type="button" data-manager-action="approve-payment" data-id="${escapeHtml(tx.id)}">Approve</button><button class="mini-btn reject" type="button" data-manager-action="reject-payment" data-id="${escapeHtml(tx.id)}">Reject</button></div>` : ''}</article>`;
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
    return `<article class="manager-record"><div class="manager-record-head"><div><h2>${escapeHtml(item.title)}</h2><p class="manager-meta"><span class="notice-category-admin" data-notice-category="${category.id}">${category.label}</span> • ${escapeHtml(noticeScopeText(item))} • ${escapeHtml(item.audience || 'সকল শিক্ষার্থী')} • ${escapeHtml(item.date || '')}</p></div><div class="manager-actions"><button class="mini-btn" data-manager-action="edit-notice" data-id="${escapeHtml(item.id)}" type="button">Edit</button><button class="mini-btn reject" data-manager-action="delete-notice" data-id="${escapeHtml(item.id)}" type="button">Delete</button></div></div><p>${escapeHtml(item.body)}</p></article>`;
  }).join('') : '<p class="admin-empty">কোনো operational notice নেই।</p>';
}
function routineTodayKey(offset = 0) {
  return WEEK_DAYS[(new Date().getDay() + 1 + offset) % 7];
}
function routineRowsFor(day) {
  return routine[day]?.classes || [];
}
function routineCardHtml(rows, empty) {
  if (!rows.length) return `<p class="admin-empty">${empty}</p>`;
  return rows.map(item => `<article class="manager-record"><div class="manager-record-head"><h2>${escapeHtml(item.subject || 'বিষয় নেই')}</h2><span class="badge badge-approved">${escapeHtml(item.time || 'সময় নেই')}</span></div><p>${escapeHtml([item.className, item.teacher, item.room].filter(Boolean).join(' • '))}</p></article>`).join('');
}
function routineBlob(item) {
  return `${item.tag || ''} ${item.status || ''} ${item.subject || ''}`.toLowerCase();
}
function renderRoutine() {
  // This route is reachable directly from Home/More: required class choices
  // must not depend on visiting the unrelated Classes screen first.
  renderRoutineClassOptions();
  if ($('#managerRoutineDays')) {
    $('#managerRoutineDays').innerHTML = WEEK_DAYS.map(day => `<button type="button" class="chip ${day === routineDay ? 'active' : ''}" data-routine-day="${day}">${dayLabel[day] || day}</button>`).join('');
  }
  if ($('#managerRoutineDayTitle')) $('#managerRoutineDayTitle').textContent = `${dayLabel[routineDay] || routineDay} — রুটিনে ক্লাস যোগ করুন`;
  const rows = routine[routineDay]?.classes || [];
  if ($('#managerRoutineList')) {
    $('#managerRoutineList').innerHTML = rows.length ? rows.map((item, index) => `<article class="manager-record"><div class="manager-record-head"><h2>${escapeHtml(item.subject || 'বিষয় নেই')}</h2><span class="badge badge-approved">${escapeHtml(item.time || 'সময় নেই')}</span></div><p>${escapeHtml(item.className || '')} • ${escapeHtml(item.teacher || '')} • ${escapeHtml(item.room || '')}</p><div class="manager-actions"><button type="button" class="mini-btn" data-manager-action="edit-routine" data-index="${index}">Edit</button><button type="button" class="mini-btn reject" data-manager-action="delete-routine" data-index="${index}">Delete</button></div></article>`).join('') : '<p class="admin-empty">এই দিনের routine record নেই।</p>';
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
  $('#managerResultList').innerHTML = completed.length ? completed.map(exam => `<article class="manager-result-exam">${examMeta(exam)}<p class="finance-hint">${exam.resultsPublished ? 'ফলাফল প্রকাশিত' : 'ফলাফল এখনো শিক্ষার্থীদের জন্য প্রকাশিত নয়'}</p><div class="manager-actions"><button type="button" class="mini-btn" data-manager-action="download-result" data-id="${escapeHtml(exam.id)}">Marks / Result CSV</button>${exam.resultsPublished ? '' : `<button type="button" class="mini-btn approve" data-manager-action="publish-results" data-id="${escapeHtml(exam.id)}">ফলাফল চূড়ান্তভাবে প্রকাশ</button>`}</div>${resultMarkup(exams, exam, true)}</article>`).join('') : '<p class="admin-empty">এখনো কোনো প্রকাশিত পরীক্ষা নেই।</p>';
}
function renderProfile() {
  const account = managerAccount || {};
  $('#managerProfileCard').innerHTML = `<div class="manager-profile-list"><div><small>নাম</small><strong>${escapeHtml(account.fullName || 'Manager')}</strong></div><div><small>Username</small><strong>${escapeHtml(account.username || '—')}</strong></div><div><small>Contact</small><strong>${escapeHtml(account.mobile || '—')}</strong></div><div><small>Email</small><strong>${escapeHtml(account.email || '—')}</strong></div><div><small>Role</small><strong>Manager — Operational Controller</strong></div><div><small>Account status</small><strong>${escapeHtml(account.status || account.accountStatus || 'active')}</strong></div></div>`;
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
  if (activeView === 'students') renderStudents();
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
  const note = decision === 'rejected' ? window.prompt('Reject করার কারণ লিখুন (আবশ্যক):', '')?.trim() : '';
  if (decision === 'rejected' && !note) return;
  managerBusy = true;
  try {
    // Shared with the Admin panel and the notification review dialog.
    const result = await decideRegistration(studentId, decision, { role: 'manager', note });
    if (!result.ok) throw new Error(DECISION_MESSAGES[result.reason] || 'Student decision সংরক্ষণ হয়নি।');
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
    panel's reset: the student's mobile number and Student ID never change. */
function openStudentPasswordReset(student) {
  const account = loadAccount();
  const isLocal = account?.student?.id === student.id || account?.studentId === student.id;
  $('#managerModalKicker').textContent = 'অ্যাকাউন্ট নিরাপত্তা';
  $('#managerModalTitle').textContent = `${student.name} — পাসওয়ার্ড রিসেট`;
  $('#managerModalBody').innerHTML = `<p class="modal-copy">${isLocal
    ? 'নিশ্চিত করলে এই ডিভাইসের অ্যাকাউন্টের পাসওয়ার্ড নিচের ডিফল্ট পাসওয়ার্ড হবে। Student ID ও মোবাইল নম্বর অপরিবর্তিত থাকবে।'
    : 'ডিফল্ট পাসওয়ার্ড নিচে দেওয়া আছে। এই শিক্ষার্থীর অ্যাকাউন্ট এই ব্রাউজারে নেই — সেটি নিজের ডিভাইস থেকে পাসওয়ার্ড বদলাবে।'}</p>
    <div class="pin-box" aria-label="ডিফল্ট পাসওয়ার্ড">${bn(DEFAULT_PIN)}</div>
    <p id="managerPinError" class="finance-error" role="alert" hidden></p>
    <div class="modal-actions"><button class="admin-btn primary" type="button" data-modal-action="confirm-reset">${isLocal ? 'রিসেট নিশ্চিত করুন' : 'বুঝেছি'}</button>
    <button class="admin-btn ghost" type="button" data-close-manager>বাতিল</button></div>`;
  $('#managerModalBackdrop').hidden = false;
  $('#managerModalBody [data-modal-action="confirm-reset"]').addEventListener('click', async () => {
    if (isLocal) {
      const latest = loadAccount();
      if ((latest?.student?.id !== student.id && latest?.studentId !== student.id) || !(await saveAccount({ ...latest, pin: DEFAULT_PIN }))) {
        $('#managerPinError').textContent = 'পাসওয়ার্ড সংরক্ষণ হয়নি। আবার চেষ্টা করুন।';
        $('#managerPinError').hidden = false;
        return;
      }
    }
    closeManagerModal();
    toast(isLocal ? `${student.name} এর পাসওয়ার্ড রিসেট হয়েছে` : 'ডিফল্ট পাসওয়ার্ড দেখানো হয়েছে');
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
  return `<dl class="manager-profile-list"><div><small>Student ID</small><strong>${escapeHtml(student.id)}</strong></div><div><small>Status</small><strong>${escapeHtml(statusLabel[student.status] || student.status)}</strong></div><div><small>Class / Batch</small><strong>${escapeHtml(student.className || '—')} • ${escapeHtml(student.group || '—')}</strong></div><div><small>Student mobile</small><strong>${escapeHtml(student.mobile || '—')}</strong></div><div><small>Guardian mobile</small><strong>${escapeHtml(student.guardianMobile || '—')}</strong></div><div><small>Monthly due</small><strong>${money(fee.due)}</strong></div><div><small>Attendance summary</small><strong>${student.attendance == null ? '—' : `${escapeHtml(student.attendance)}%`}</strong></div><div><small>Average/result summary</small><strong>${student.average == null ? '—' : escapeHtml(student.average)}</strong></div></dl>`;
}
function showStudentEditor(card, student) {
  const root = card.querySelector('.manager-student-extra');
  root.hidden = false;
  const classNames = listClasses().filter(item => item.active !== false).map(item => item.name);
  root.innerHTML = `<form class="manager-form manager-edit-form"><label>নাম<input name="name" maxlength="100" required value="${escapeHtml(student.name || '')}"></label><label>Student mobile<input name="mobile" maxlength="32" value="${escapeHtml(student.mobile || '')}"></label><label>Guardian mobile<input name="guardianMobile" maxlength="32" value="${escapeHtml(student.guardianMobile || '')}"></label><label>ক্লাস<select name="className" required>${classNames.map(name => `<option value="${escapeHtml(name)}" ${name === student.className ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label><label>Batch / Group<input name="group" maxlength="80" value="${escapeHtml(student.group || '')}"></label><label>মাসিক ফি<input name="monthlyFee" type="number" min="0" max="1000000" step="1" value="${Number(student.monthlyFee ?? DEFAULT_MONTHLY_FEE)}"></label><button class="admin-btn primary" type="submit">পরিবর্তন সংরক্ষণ</button></form>`;
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
      await loadOperationalData(); toast('Student operational information আপডেট হয়েছে।');
    } catch (error) {
      toast(error.message || 'পরিবর্তন সংরক্ষণ হয়নি।', true);
    } finally { managerBusy = false; }
  });
}
async function editNotice(notice) {
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  const title = window.prompt('নোটিশের শিরোনাম', notice.title); if (title == null || !title.trim()) return;
  const body = window.prompt('নোটিশের বিবরণ', notice.body); if (body == null || !body.trim()) return;
  const categoryInput = window.prompt('Notice Board বিভাগ লিখুন: urgent / academic / class / fee / exam', noticeCategory(notice));
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
  const teacher = window.prompt('Teacher assignment', item.teacher); if (teacher == null || !teacher.trim()) return;
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  item.subject = subject.trim().slice(0, 80); item.teacher = teacher.trim().slice(0, 100);
  if (!saveRoutine(routine)) return toast('Routine সংরক্ষণ হয়নি।', true);
  void loadOperationalData(); toast('Routine assignment আপডেট হয়েছে।');
}

/* Manager's menu is an explicit allow-list. No Admin-only route/view exists here. */
function moreMenuItem({ icon, label, hint }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-more-item';
  const iconHost = document.createElement('span');
  iconHost.className = 'admin-more-icon';
  iconHost.setAttribute('aria-hidden', 'true');
  iconHost.append(iconElement(icon, 'admin-more-icon-svg apc-icon-svg'));
  const copy = document.createElement('span');
  copy.className = 'admin-more-copy';
  const title = document.createElement('strong');
  title.textContent = label;
  const note = document.createElement('small');
  note.textContent = hint;
  copy.append(title, note);
  button.append(iconHost, copy, iconElement('arrow-right', 'admin-menu-arrow apc-icon-svg'));
  return button;
}
const moreMenu = $('#managerMoreMenu');
MORE_MODULES.forEach(module => {
  const button = moreMenuItem(module);
  button.dataset.managerView = module.view;
  button.addEventListener('click', () => renderView(module.view));
  moreMenu.append(button);
});
/* Logging out is one deliberate row here too, the way the Admin panel ends its
   own More menu — phones reach it without hunting for the top-bar icon. */
const moreLogout = moreMenuItem({ icon: 'logout', label: 'লগআউট', hint: 'সেশন শেষ করে লগইন পেইজে যান' });
moreLogout.classList.add('is-logout');
moreLogout.addEventListener('click', () => { clearStaffSession('manager'); goToLoginPage(); });
moreMenu.append(moreLogout);
document.addEventListener('click', event => {
  const examTile = event.target.closest('[data-manager-exam]');
  if (!examTile) return;
  managerExamScreen = EXAM_SCREENS[examTile.dataset.managerExam] || 'home';
  renderView('exams');
});
$$('[data-manager-view]').forEach(button => button.addEventListener('click', () => {
  const view = button.dataset.managerView;
  if (view === 'exams') managerExamScreen = '';
  if (!normalizeView(view)) return;
  /* A shortcut may carry its own filter (dashboard → অনুমোদন opens শিক্ষার্থী
     already filtered to the pending queue). */
  if (button.dataset.studentScope) studentScope = button.dataset.studentScope;
  if (button.dataset.financeSegment) financeSegment = button.dataset.financeSegment;
  renderView(view);
  $$('[data-student-scope]').forEach(item => item.classList.toggle('active', item.dataset.studentScope === studentScope));
  $$('[data-finance-segment]').forEach(item => item.classList.toggle('active', item.dataset.financeSegment === financeSegment));
}));
$('#managerStudentSearch').addEventListener('input', renderStudents);
$('#managerStudentSearch').addEventListener('search', renderStudents);
$$('[data-student-scope]').forEach(button => button.addEventListener('click', () => {
  studentScope = button.dataset.studentScope;
  $$('[data-student-scope]').forEach(item => item.classList.toggle('active', item === button)); renderStudents();
}));
function handleStudentAction(button) {
  const student = students.find(row => row.id === button.dataset.id); if (!student) return;
  const card = button.closest('.manager-record');
  const extra = card?.querySelector('.manager-student-extra');
  const action = button.dataset.managerAction;
  if (action === 'view-student' && extra) { extra.hidden = !extra.hidden; extra.innerHTML = extra.hidden ? '' : studentProfile(student); }
  if (action === 'edit-student' && card) showStudentEditor(card, student);
  if (action === 'deactivate-student') void toggleStudentStatus(student.id, 'inactive');
  if (action === 'activate-student') void toggleStudentStatus(student.id, 'approved');
  if (action === 'reset-password') openStudentPasswordReset(student);
}
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
$$('[data-cash-scope]').forEach(button => button.addEventListener('click', () => { cashScope = button.dataset.cashScope; renderCashCounter(); }));
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
      if (target.scope) academicScope = target.scope;
      managerExamScreen = target.screen || (target.view === 'exams' ? '' : managerExamScreen);
      renderView(target.view);
      $$('[data-academic-scope]').forEach(item => item.classList.toggle('active', item.dataset.academicScope === academicScope));
    }
    return;
  }
  if (event.target.closest('[data-close-manager]')) closeManagerModal();
});
$('#managerAcademicFilters').addEventListener('click', event => {
  const chip = event.target.closest('[data-academic-scope]'); if (!chip) return;
  academicScope = chip.dataset.academicScope;
  $$('[data-academic-scope]').forEach(item => item.classList.toggle('active', item === chip));
  renderAcademicRecords();
});
['managerAcademicSearch', 'managerAcademicClass'].forEach(id => $('#' + id).addEventListener(id.includes('Search') ? 'input' : 'change', renderAcademicRecords));
$$('[data-finance-segment]').forEach(button => button.addEventListener('click', () => { financeSegment = button.dataset.financeSegment; renderFinance(); }));
$('#managerDueSearch')?.addEventListener('input', renderFinance);
$('#managerDueClass')?.addEventListener('change', renderFinance);
$('#managerRoutineDays').addEventListener('click', event => { const button = event.target.closest('[data-routine-day]'); if (!button) return; routineDay = button.dataset.routineDay; renderRoutine(); });
$('#managerRoutineList').addEventListener('click', async event => {
  const button = event.target.closest('[data-manager-action]'); if (!button) return;
  const index = Number(button.dataset.index); const rows = routine[routineDay]?.classes || [];
  if (button.dataset.managerAction === 'edit-routine') await changeRoutine(index);
  if (button.dataset.managerAction === 'delete-routine' && window.confirm('এই routine entry মুছবেন?')) {
    if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
    rows.splice(index, 1); if (!saveRoutine(routine)) return toast('Routine সংরক্ষণ হয়নি।', true); renderRoutine(); toast('Routine entry মুছে ফেলা হয়েছে।');
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
    await saveTeacherAssignment({ className: data.get('className'), group: data.get('group'), subjects });
    form.reset(); await renderTeachers(); await loadOperationalData(); toast('Teacher assignment সংরক্ষণ হয়েছে।');
  } catch (error) { toast(error.message || 'Assignment সংরক্ষণ হয়নি।', true); }
});
$('#managerTeacherList').addEventListener('click', async event => {
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
  if (!button || !window.confirm('এই Teacher assignment সরাবেন?')) return;
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  try { await deleteTeacherAssignment(button.dataset.id); await renderTeachers(); toast('Teacher assignment সরানো হয়েছে।'); }
  catch (error) { toast(error.message || 'Assignment সরানো হয়নি।', true); }
});
$('#managerRoutineForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;   // null again after the await below
  if (!(await managerGuard())) return toast('Manager session যাচাই হয়নি।', true);
  const data = new FormData(form), time = String(data.get('time'));
  const [hour, minute] = time.split(':').map(Number), period = hour < 4 ? 'ভোর' : hour < 12 ? 'সকাল' : hour < 16 ? 'বিকেল' : 'সন্ধ্যা';
  const label = `${bn(hour % 12 || 12)}:${bn(String(minute).padStart(2, '0'))}`;
  routine[routineDay].classes.push({ id: newId('RTN'), className: String(data.get('className')), subject: String(data.get('subject')).trim(), teacher: String(data.get('teacher')).trim(), room: String(data.get('room')).trim(), time: label, period, tag: 'প্রকাশিত', tone: 'green', createdAt: new Date().toISOString(), status: 'published' });
  if (!saveRoutine(routine)) return toast('Routine সংরক্ষণ হয়নি।', true);
  form.reset(); routineDay = routineDay; renderRoutine(); toast('Routine প্রকাশিত হয়েছে।');
});
$('#managerChangePassword').addEventListener('click', () => openStaffPasswordDialog({ role: 'manager', mode: 'change' }));
/* One door per panel: no route of ours leaves manager.html for another panel. */
installPanelGuard();
void rememberPanelPage();

async function enterManager() {
  /* A missing session locks the page in place — it never jumps to another
     page on its own (js/panel-lockdown.js). */
  if (!(await hasStaffSession('manager'))) {
    await lockPanel({ role: 'manager.html', reason: 'ম্যানেজার প্যানেল শুধু ম্যানেজার ইউজারনেম ও পাসওয়ার্ড দিয়ে খোলে।' });
    return;
  }
  managerAccount = await readStaffAccount('manager');
  if (!managerAccount) {
    await lockPanel({ role: 'manager.html', clear: 'manager', reason: 'এই ডিভাইসে ম্যানেজার অ্যাকাউন্টের রেকর্ড নেই — লগইন পেজ থেকে আবার প্রবেশ করুন।' });
    return;
  }
  $('#managerShell').hidden = false;
  ensureExamWorkspace();
  // A refresh (or a shared link) reopens the page that was open, when it is a
  // page this panel knows.
  const wanted = routeName();
  renderView(normalizeView(wanted) ? wanted : 'dashboard');
  onRouteChange(name => { const next = normalizeView(name); if (next && next.view !== activeView) renderView(name); });
  await loadOperationalData();
  /* One Settings structure for every role (§29). The hub fills নিরাপত্তা ও ডেটা
     and mounts the notification rows — the Manager's profile card, password row
     and theme switch stay exactly where they were. */
  mountSettingsHub({
    mount: '[data-settings-hub="manager"]',
    role: 'manager',
    actions: {
      password: () => openStaffPasswordDialog({ role: 'manager', mode: 'change' }),
      logout: () => { clearStaffSession('manager'); goToLoginPage(); }
    },
    session: { value: `${bn(STAFF_SESSION_RULES.rememberDays)} দিন`, hint: 'ডিভাইস-বাউন্ড সেশন', password: `${bn(STAFF_DIRECTORY_RULES.passwordMin)}–${bn(STAFF_DIRECTORY_RULES.passwordMax)} অক্ষর · PBKDF2 হ্যাশ` }
  });
  // পড়াশোনা পরিচালনা করুন: the same content library the Teacher writes into.
  await mountCourseEditor();
  await mountReports($('#managerReports'), { panel: 'manager' });
  watchOwnPanelSession('manager');
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
$('#managerLogout').addEventListener('click', () => { clearStaffSession('manager'); goToLoginPage(); });
window.addEventListener('storage', event => {
  if (!event.key || [ 'activePlus.admin.students.v1', 'activePlus.admin.transactions.v1', 'activePlus.admin.notices.v1', 'activePlus.admin.routine.v1', TEACHING_KEY, TEACHER_ASSIGNMENTS_KEY, 'activePlus.exams.v1' ].includes(event.key)) { void loadOperationalData(); refreshReports($('#managerReports')); }
});
export const managerReady = enterManager();
