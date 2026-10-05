import { hasStaffSession, clearStaffSession, readStaffAccount, goToLoginPage } from './staff-auth.js';
import { rememberRoute, onRouteChange, routeName } from './panel-route.js';
import { decideRegistration, DECISION_MESSAGES, DECIDED_EVENT } from './registration-review.js';
import { installPanelGuard, lockPanel, rememberPanelPage, watchOwnPanelSession } from './panel-lockdown.js';
import { openStaffPasswordDialog } from './staff-password-dialog.js';
import { loadRoster, saveRoster, updateStudentOperationalInfo, syncAccountStatus, loadNotices, saveNotices, loadRoutine, saveRoutine, WEEK_DAYS } from './office-data.js';
import { financeRepository, monthLabel, dateLabel, studentFeeSummary, newestTransactions, isFinalizedTransaction, DEFAULT_MONTHLY_FEE } from './finance-data.js';
import { examRepository, examResults, isLiveExam, MANAGER_ACTOR } from './exam-data.js';
import { examMeta, resultMarkup, downloadResults } from './exam-ui.js';
import { teachingRepository, todayISO, TEACHING_KEY } from './teaching-data.js';
import { enabledClasses } from './config.js';
import { classCodes, dayNames } from './admin-data.js';
import { newId } from './database.js';
import { escapeHtml } from './sanitize.js';
import { matchesStudentQuery } from './student-search.js';
import { registerServiceWorker } from './service-worker.js';
import { initFixedShell } from './fixed-shell.js';
import { initExamManager } from './exam-manager.js';
import { listTeacherAssignments, saveTeacherAssignment, deleteTeacherAssignment, deleteAssignmentSubject, selectableSubjects, TEACHER_ASSIGNMENTS_KEY } from './teacher-assignments.js';
import { listClasses } from './academics.js';
import { initNotificationSettings } from './notification-settings.js';
import { noticeCategory, noticeCategoryInfo } from './notification-rules.js';
import { mountReports, refreshReports } from './reports.js';
import { iconElement } from './icons.js';

registerServiceWorker();
initFixedShell();
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const bn = value => String(value ?? 0).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[digit]);
const money = value => `৳${bn(Number(value || 0).toLocaleString('en-US'))}`;
const MANAGER_VIEWS = Object.freeze(['dashboard', 'students', 'approvals', 'classes', 'teachers', 'finance', 'cash-counter', 'notices', 'routine', 'exams', 'courses', 'results', 'reports', 'profile', 'more']);
/* The "আরও" page. One row per Manager module, in the same icon + title + hint
   language as the Admin panel's More menu, so a module looks the same wherever
   it is reached from. Labels stay Bangla like the bottom bar; the hint names
   what actually happens inside. */
const MORE_MODULES = Object.freeze([
  { view: 'classes', icon: 'book', label: 'ক্লাস পরিচালনা করুন', hint: 'শ্রেণি, ব্যাচ ও বিষয় তালিকা' },
  { view: 'teachers', icon: 'users', label: 'শিক্ষককে ক্লাস ও বিষয় দিন', hint: 'কোন শিক্ষক কোন ক্লাসে কোন বিষয় পড়াবেন' },
  { view: 'finance', icon: 'wallet', label: 'ফি ও পেমেন্ট', hint: 'পেমেন্ট যাচাই, বকেয়া ও কালেকশন' },
  { view: 'cash-counter', icon: 'receipt', label: 'ক্যাশ কাউন্টার', hint: 'কাউন্টার এন্ট্রি ও আদায়ের অবস্থা' },
  { view: 'notices', icon: 'notice', label: 'নোটিশ দিন', hint: 'নোটিশ তৈরি, সম্পাদনা ও মুছে ফেলা' },
  { view: 'routine', icon: 'calendar', label: 'ক্লাস রুটিন তৈরি করুন', hint: 'দিনভিত্তিক ক্লাস ও শিক্ষক সাজানো' },
  { view: 'exams', icon: 'exam', label: 'পরীক্ষা পরিচালনা করুন', hint: 'পরীক্ষা তৈরি, প্রশ্ন, অনুমোদন ও প্রকাশ' },
  { view: 'courses', icon: 'book', label: 'পড়াশোনা পরিচালনা করুন', hint: 'কোর্স উপকরণ, নোট ও সাজেশন' },
  { view: 'results', icon: 'result', label: 'ফলাফল দেখুন', hint: 'নম্বর যাচাই ও ফলাফল প্রকাশ' },
  { view: 'reports', icon: 'reports', label: 'রিপোর্ট', hint: 'রিপোর্ট তৈরি, প্রিভিউ ও ডাউনলোড' },
  { view: 'profile', icon: 'user', label: 'ম্যানেজার প্রোফাইল', hint: 'নিজের পরিচয় ও পাসওয়ার্ড' }
]);
const dayLabel = Object.freeze({ sat: 'শনিবার', sun: 'রবিবার', mon: 'সোমবার', tue: 'মঙ্গলবার', wed: 'বুধবার', thu: 'বৃহস্পতিবার' });
const statusLabel = Object.freeze({ approved: 'সক্রিয়', pending: 'অপেক্ষমাণ', rejected: 'বাতিল' });
let students = loadRoster(), notices = loadNotices(), routine = loadRoutine(), transactions = [], exams = { exams: [], attempts: [] }, teaching = { activities: [] }, managerAccount = null;
let activeView = 'dashboard', studentScope = 'all', cashScope = 'pending', routineDay = 'sat', examStarted = false, managerBusy = false;

function toast(message, error = false) {
  const node = $('#managerToast'); if (!node) return;
  node.textContent = message; node.dataset.tone = error ? 'error' : 'success'; node.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 3000);
}
function safeSetText(selector, value) { const node = $(selector); if (node) node.textContent = String(value ?? '—'); }
function renderView(view) {
  if (!MANAGER_VIEWS.includes(view)) return false;
  activeView = view;
  $$('.manager-view').forEach(panel => { const active = panel.dataset.viewPanel === view; panel.classList.toggle('active', active); panel.hidden = !active; });
  $$('.manager-bottom [data-manager-view]').forEach(button => {
    const active = button.dataset.managerView === view || (view === 'more' && button.dataset.managerView === 'more');
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  // Refresh reopens this page: the open view lives in the URL. It is remembered
  // before the panels render, so a renderer that ever fails can still not send
  // the next refresh back to the dashboard.
  rememberRoute(view);
  if (view === 'dashboard') renderDashboard();
  if (view === 'students') renderStudents();
  if (view === 'approvals') renderApprovals();
  if (view === 'classes') renderClasses();
  if (view === 'teachers') renderTeachers();
  if (view === 'finance') renderFinance();
  if (view === 'cash-counter') renderCashCounter();
  if (view === 'notices') renderNotices();
  if (view === 'courses') mountCourseEditor();
  if (view === 'routine') renderRoutine();
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
function renderStudents() {
  const query = searchValue();
  const list = students.filter(student => (studentScope === 'all' || student.status === studentScope) && studentMatches(student, query));
  $('#managerStudentList').innerHTML = list.length ? list.map(student => {
    const fee = studentFeeSummary(student, transactions);
    return `<article class="manager-record" data-manager-student="${escapeHtml(student.id)}"><div class="manager-record-head"><div><h2>${escapeHtml(student.name || 'নাম নেই')}</h2><p class="manager-meta">${escapeHtml(student.id)} • ${escapeHtml(student.className || 'ক্লাস নেই')} ${student.group ? `• ${escapeHtml(student.group)}` : ''}</p></div><span class="badge ${student.status === 'approved' ? 'badge-approved' : student.status === 'pending' ? 'badge-pending' : 'badge-rejected'}">${escapeHtml(statusLabel[student.status] || student.status || 'অজানা')}</span></div><p>মোবাইল ${escapeHtml(student.mobile || '—')} • বকেয়া ${money(fee.due)} • উপস্থিতি ${student.attendance == null ? '—' : `${escapeHtml(student.attendance)}%`} • গড় ফল ${student.average == null ? '—' : escapeHtml(student.average)}</p><div class="manager-actions"><button class="mini-btn" type="button" data-manager-action="view-student" data-id="${escapeHtml(student.id)}">প্রোফাইল</button><button class="mini-btn" type="button" data-manager-action="edit-student" data-id="${escapeHtml(student.id)}">তথ্য সম্পাদনা</button></div><div class="manager-student-extra" hidden></div></article>`;
  }).join('') : '<p class="admin-empty">কোনো শিক্ষার্থী মেলেনি।</p>';
}
function renderApprovals() {
  const pending = students.filter(student => student.status === 'pending');
  safeSetText('#managerPendingBadge', `${bn(pending.length)} অপেক্ষমাণ`);
  $('#managerPendingCount') && ( $('#managerPendingCount').textContent = bn(pending.length) );
  $('#managerStudentQueue').innerHTML = pending.length ? pending.map(student => `<article class="manager-record"><div class="manager-record-head"><div><p class="eyebrow">${escapeHtml(student.id || 'Application')}</p><h2>${escapeHtml(student.name || 'নাম নেই')}</h2></div><span class="badge badge-pending">অপেক্ষমাণ</span></div><p>শ্রেণি ${escapeHtml(student.className || '—')} • ${escapeHtml(student.group || 'Batch নেই')}</p><p>মোবাইল ${escapeHtml(student.mobile || '—')} • অভিভাবক ${escapeHtml(student.guardianMobile || '—')}</p><p class="manager-meta">আবেদন: ${escapeHtml(student.enrolledAt || 'তারিখ নেই')}</p><div class="manager-actions"><button class="mini-btn approve" type="button" data-manager-action="approve-student" data-id="${escapeHtml(student.id)}">Approve</button><button class="mini-btn reject" type="button" data-manager-action="reject-student" data-id="${escapeHtml(student.id)}">Reject</button></div></article>`).join('') : '<p class="admin-empty">এখন কোনো নিবন্ধন অনুমোদনের অপেক্ষায় নেই।</p>';
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
function renderFinance() {
  const approved = transactions.filter(isFinalizedTransaction);
  const month = monthLabel();
  const monthTotal = approved.filter(tx => tx.month === month).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const total = approved.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const due = students.filter(s => s.status === 'approved').reduce((sum, s) => sum + studentFeeSummary(s, transactions).due, 0);
  const pending = transactions.filter(tx => tx.status === 'pending').length;
  safeSetText('#mgrFinanceTotal', money(total)); safeSetText('#mgrFinanceMonth', money(monthTotal)); safeSetText('#mgrFinanceDue', money(due)); safeSetText('#mgrFinancePending', bn(pending));
  const search = ($('#managerPaymentSearch')?.value || '').trim().toLocaleLowerCase();
  const status = $('#managerPaymentStatus')?.value || 'all';
  const list = newestTransactions(transactions).filter(tx => (status === 'all' || (tx.status || 'approved') === status) && (!search || `${tx.studentName} ${tx.studentId} ${tx.id} ${tx.receiptNo}`.toLocaleLowerCase().includes(search)));
  $('#managerPaymentList').innerHTML = list.length ? list.map(tx => transactionCard(tx, false)).join('') : '<p class="admin-empty">কোনো payment record নেই।</p>';
}
function transactionCard(tx, allowReview) {
  const status = tx.status || 'approved';
  const text = status === 'pending' ? 'অনুমোদন বাকি' : status === 'rejected' ? 'বাতিল' : 'অনুমোদিত';
  return `<article class="manager-record"><div class="manager-record-head"><div><h2>${escapeHtml(tx.studentName || 'শিক্ষার্থী তথ্য নেই')}</h2><p class="manager-meta">${escapeHtml(tx.studentId || '')} • ${escapeHtml(tx.className || '')} • ${escapeHtml(tx.receiptNo || tx.id)}</p></div><span class="badge ${status === 'approved' ? 'badge-approved' : status === 'pending' ? 'badge-pending' : 'badge-rejected'}">${text}</span></div><p><strong>${money(tx.amount)}</strong> • ${escapeHtml(tx.date || 'তারিখ নেই')} • ${escapeHtml(tx.method || 'মাধ্যম নেই')}</p><p>${escapeHtml(tx.feeType || '')} • ${escapeHtml(tx.month || '')} • Counter: ${escapeHtml(tx.collectedBy || 'পুরোনো রেকর্ড')}</p>${tx.trxRef ? `<p>Reference: ${escapeHtml(tx.trxRef)}</p>` : ''}${tx.note ? `<p>Note: ${escapeHtml(tx.note)}</p>` : ''}${tx.reviewNote ? `<p class="manager-status-warning">Review: ${escapeHtml(tx.reviewNote)}</p>` : ''}<p class="manager-meta">Review history: ${bn((tx.reviewHistory || []).length)} • ${escapeHtml(tx.reviewedBy || '—')}</p>${allowReview && status === 'pending' ? `<div class="manager-actions"><button class="mini-btn approve" type="button" data-manager-action="approve-payment" data-id="${escapeHtml(tx.id)}">Approve</button><button class="mini-btn reject" type="button" data-manager-action="reject-payment" data-id="${escapeHtml(tx.id)}">Reject</button></div>` : ''}</article>`;
}
function renderCashCounter() {
  const selected = transactions.filter(tx => cashScope === 'all' || (cashScope === 'approved' ? (tx.status || 'approved') === 'approved' : tx.status === cashScope));
  const list = newestTransactions(selected);
  $('#managerCashList').innerHTML = list.length ? list.map(tx => transactionCard(tx, true)).join('') : '<p class="admin-empty">এই filter-এ কোনো Cash Counter entry নেই।</p>';
  $$('[data-cash-scope]').forEach(button => button.classList.toggle('active', button.dataset.cashScope === cashScope));
}
function renderNotices() {
  $('#managerNoticeList').innerHTML = notices.length ? notices.map(item => {
    const category = noticeCategoryInfo(noticeCategory(item));
    return `<article class="manager-record"><div class="manager-record-head"><div><h2>${escapeHtml(item.title)}</h2><p class="manager-meta"><span class="notice-category-admin" data-notice-category="${category.id}">${category.label}</span> • ${escapeHtml(item.id)} • ${escapeHtml(item.audience || 'সকল শিক্ষার্থী')} • ${escapeHtml(item.date || '')}</p></div><div class="manager-actions"><button class="mini-btn" data-manager-action="edit-notice" data-id="${escapeHtml(item.id)}" type="button">Edit</button><button class="mini-btn reject" data-manager-action="delete-notice" data-id="${escapeHtml(item.id)}" type="button">Delete</button></div></div><p>${escapeHtml(item.body)}</p></article>`;
  }).join('') : '<p class="admin-empty">কোনো operational notice নেই।</p>';
}
function renderRoutine() {
  // This route is reachable directly from Home/More: required class choices
  // must not depend on visiting the unrelated Classes screen first.
  renderRoutineClassOptions();
  $('#managerRoutineDays').innerHTML = WEEK_DAYS.map(day => `<button type="button" class="chip ${day === routineDay ? 'active' : ''}" data-routine-day="${day}">${dayLabel[day] || day}</button>`).join('');
  $('#managerRoutineDayTitle').textContent = `${dayLabel[routineDay] || routineDay} — রুটিনে ক্লাস যোগ করুন`;
  const rows = routine[routineDay]?.classes || [];
  $('#managerRoutineList').innerHTML = rows.length ? rows.map((item, index) => `<article class="manager-record"><div class="manager-record-head"><h2>${escapeHtml(item.subject || 'বিষয় নেই')}</h2><span class="badge badge-approved">${escapeHtml(item.time || 'সময় নেই')}</span></div><p>${escapeHtml(item.className || '')} • ${escapeHtml(item.teacher || '')} • ${escapeHtml(item.room || '')}</p><div class="manager-actions"><button type="button" class="mini-btn" data-manager-action="edit-routine" data-index="${index}">Edit</button><button type="button" class="mini-btn reject" data-manager-action="delete-routine" data-index="${index}">Delete</button></div></article>`).join('') : '<p class="admin-empty">এই দিনের routine record নেই।</p>';
  $('#managerRoutineForm [name=className]').value ||= '';
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
  if (activeView === 'approvals') renderApprovals();
  if (activeView === 'classes') renderClasses();
  if (activeView === 'teachers') renderTeachers();
  if (activeView === 'finance') renderFinance();
  if (activeView === 'cash-counter') renderCashCounter();
  if (activeView === 'notices') renderNotices();
  if (activeView === 'routine') renderRoutine();
  if (activeView === 'results') renderResults();
}
async function managerGuard() { return !managerBusy && await hasStaffSession('manager'); }
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
$$('[data-manager-view]').forEach(button => button.addEventListener('click', () => {
  const view = button.dataset.managerView;
  if (!MANAGER_VIEWS.includes(view)) return;
  renderView(view);
}));
$('#managerStudentSearch').addEventListener('input', renderStudents);
$('#managerStudentSearch').addEventListener('search', renderStudents);
$$('[data-student-scope]').forEach(button => button.addEventListener('click', () => {
  studentScope = button.dataset.studentScope;
  $$('[data-student-scope]').forEach(item => item.classList.toggle('active', item === button)); renderStudents();
}));
$('#managerStudentList').addEventListener('click', event => {
  const button = event.target.closest('[data-manager-action]'); if (!button) return;
  const student = students.find(row => row.id === button.dataset.id); if (!student) return;
  const card = button.closest('.manager-record');
  const extra = card.querySelector('.manager-student-extra');
  if (button.dataset.managerAction === 'view-student') { extra.hidden = !extra.hidden; extra.innerHTML = extra.hidden ? '' : studentProfile(student); }
  if (button.dataset.managerAction === 'edit-student') showStudentEditor(card, student);
});
$('#managerStudentQueue').addEventListener('click', event => {
  const button = event.target.closest('[data-manager-action]'); if (!button) return;
  if (button.dataset.managerAction === 'approve-student') void approveStudent(button.dataset.id, 'approved');
  if (button.dataset.managerAction === 'reject-student') void approveStudent(button.dataset.id, 'rejected');
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
  notices.unshift({ id: newId('NOT'), title: title.slice(0, 120), body: body.slice(0, 1000), category: noticeCategory(String(data.get('category') || 'academic')), audience: String(data.get('audience')), date: dateLabel(new Date()), createdAt: new Date().toISOString(), status: 'published', author: managerAccount?.username || 'manager' });
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
  const shortName = $('#managerNameShort');
  if (shortName) shortName.textContent = managerAccount.fullName || 'Manager Profile';
  if (!examStarted) { initExamManager('#managerExamWorkspace', 'manager'); examStarted = true; }
  // A refresh (or a shared link) reopens the page that was open, when it is a
  // page this panel knows.
  const wanted = routeName();
  renderView(MANAGER_VIEWS.includes(wanted) ? wanted : 'dashboard');
  onRouteChange(name => { if (MANAGER_VIEWS.includes(name) && name !== activeView) renderView(name); });
  await loadOperationalData();
  // Settings → Notification Settings, inside the Manager's own profile page.
  initNotificationSettings({ mount: '#notificationSettings' });
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
