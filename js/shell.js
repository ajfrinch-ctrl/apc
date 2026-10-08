/* App shell lifecycle and student identity rendering. */
import { loadAccount } from './storage.js';
import { $, $$, scrollToTop, toBanglaNumber } from './ui.js';
import { isStudentBirthday } from './notification-rules.js';

export function renderStudent(student) {
  const fullName = String(student.name || student.nameBn || 'শিক্ষার্থী').trim() || 'শিক্ষার্থী';
  const firstName = fullName.split(/\s+/)[0] || 'শিক্ষার্থী';
  const initial = firstName.charAt(0) || 'শি';
  const meta = [student.className, student.group].filter(Boolean).join(' · ') || 'শ্রেণি এখনও যোগ হয়নি';

  $('#studentName') && ($('#studentName').textContent = fullName);
  $('#studentHeaderMeta') && ($('#studentHeaderMeta').textContent = meta);
  $('#avatarInitial') && ($('#avatarInitial').textContent = initial);
  $('#profileAvatar') && ($('#profileAvatar').textContent = initial);
  $('#profileName') && ($('#profileName').textContent = student.name);
  $('#profileMeta') && ($('#profileMeta').textContent = meta);
  $('#routineClass') && ($('#routineClass').textContent = meta);
  $('#studentId') && ($('#studentId').textContent = student.id);
  const usernameChip = $('#profileUsername');
  const usernameWrap = $('#profileUsernameWrap');
  if (usernameChip && usernameWrap) {
    const username = student.username || loadAccount()?.username || '';
    usernameChip.textContent = username;
    usernameWrap.hidden = !username;
  }
  $('#studentMobileValue') && ($('#studentMobileValue').textContent = toBanglaNumber(student.studentMobile || 'নম্বর নেই'));
  $('#guardianMobileValue') && ($('#guardianMobileValue').textContent = toBanglaNumber(student.guardianMobile || 'নম্বর নেই'));
  const additional = $('#studentAdditionalMobiles');
  if (additional) {
    const numbers = loadAccount()?.additionalMobiles || [];
    additional.textContent = numbers.length ? `অতিরিক্ত: ${numbers.map(toBanglaNumber).join(' • ')}` : '';
    additional.hidden = !numbers.length;
  }
  if ($('#editStudentId')) $('#editStudentId').value = student.id || '';
  paintBirthdayLook(student);
}

function paintBirthdayLook(student) {
  const on = isStudentBirthday(student?.birthDate);
  document.documentElement.toggleAttribute('data-birthday', on);
  $('#appShell')?.classList.toggle('is-birthday', on);
  const greeting = $('#dayGreeting');
  if (greeting && on) greeting.textContent = 'শুভ জন্মদিন';
  const banner = $('#birthdayBanner');
  if (banner) {
    banner.hidden = !on;
    const first = String(student?.name || student?.nameBn || 'শিক্ষার্থী').trim().split(/\s+/)[0] || 'শিক্ষার্থী';
    const copy = banner.querySelector('[data-birthday-name]');
    if (copy) copy.textContent = first;
  }
}

export function openStudentApp(state) {
  $('#authScreen') && ($('#authScreen').hidden = true);
  const app = $('#appShell');
  if (app) {
    app.hidden = false;
    app.classList.toggle('is-pending', state.account?.status === 'pending');
  }
  if (state.account?.status === 'pending' && $('#pendingStudentId')) {
    $('#pendingStudentId').textContent = state.account.studentId || state.student.id;
  }
  renderStudent(state.student);
  scrollToTop();
}

export function showAuthScreen() {
  $('#authScreen') && ($('#authScreen').hidden = false);
  const app = $('#appShell');
  if (app) {
    app.hidden = true;
    app.classList.remove('is-pending', 'is-birthday');
  }
  document.documentElement.removeAttribute('data-birthday');
  const banner = $('#birthdayBanner');
  if (banner) banner.hidden = true;
  scrollToTop();
}

/* Deep-linkable student views. The URL hash always names the open view:
   #routine, #courses, #exams, #profile, #settings, #student-fee, #my-profile,
   #reports, #notification-settings, #notice-board (home has no hash).
   Result sheets are not a route of their own any more: ফলাফল is a tab inside
   the পরীক্ষা section, so #results is kept only as an inbound alias
   (docs/APP-ARCHITECTURE.md §2–§3). Browser and system Back walk the visited
   views; refresh and shared links reopen the exact view (hash router + back). */
const VIEW_ROUTES = Object.freeze([
  'home', 'routine', 'routine-day', 'routine-today', 'routine-tomorrow', 'routine-weekly', 'routine-class',
  'routine-exam', 'routine-changed', 'routine-holiday', 'routine-important', 'routine-other',
  'classes', 'class-today', 'class-upcoming', 'class-record', 'class-subjects', 'class-teachers',
  'class-notes', 'class-materials', 'class-attendance', 'class-other',
  'courses', 'my-courses', 'homework', 'suggestion', 'question-bank',
  'materials', 'model-test', 'study-practice', 'study-results', 'study-other',
  'exams', 'exam-upcoming', 'exam-live', 'exam-done', 'exam-results', 'exam-practice',
  'exam-instant', 'exam-papers', 'exam-recent', 'exam-bank', 'exam-other', 'results',
  'profile', 'my-profile', 'settings', 'student-fee', 'reports', 'notification-settings', 'notice-board'
]);
/* Views whose id does not follow the `<route>View` rule. */
const VIEW_ID_OVERRIDES = Object.freeze({
  'notification-settings': 'notificationSettingsView',
  'my-profile': 'myProfileView',
  'student-fee': 'studentFeeView',
  'my-courses': 'myCoursesView',
  'question-bank': 'questionBankView',
  'model-test': 'modelTestView',
  'study-practice': 'studyPracticeView',
  'study-results': 'studyResultsView',
  'study-other': 'studyOtherView',
  'exam-upcoming': 'examUpcomingView',
  'exam-live': 'examLiveView',
  'exam-done': 'examDoneView',
  'exam-results': 'examResultsView',
  'exam-practice': 'examPracticeView',
  'exam-instant': 'examInstantView',
  'exam-papers': 'examPapersView',
  'exam-recent': 'examRecentView',
  'exam-bank': 'examBankView',
  'exam-other': 'examOtherView',
  'routine-day': 'routineDayView',
  'routine-today': 'routineTodayView',
  'routine-tomorrow': 'routineTomorrowView',
  'routine-weekly': 'routineWeeklyView',
  'routine-class': 'routineClassView',
  'routine-exam': 'routineExamView',
  'routine-changed': 'routineChangedView',
  'routine-holiday': 'routineHolidayView',
  'routine-important': 'routineImportantView',
  'routine-other': 'routineOtherView',
  classes: 'classesView',
  'class-today': 'classTodayView',
  'class-upcoming': 'classUpcomingView',
  'class-record': 'classRecordView',
  'class-subjects': 'classSubjectsView',
  'class-teachers': 'classTeachersView',
  'class-notes': 'classNotesView',
  'class-materials': 'classMaterialsView',
  'class-attendance': 'classAttendanceView',
  'class-other': 'classOtherView'
});
/* Old/bookmarked names that now live inside another section. */
const VIEW_ALIASES = Object.freeze({ results: 'exam-results' });
/* Which bottom-bar item owns a view that is not itself a bottom-bar item. */
const NAV_PARENTS = Object.freeze({
  exams: 'exams',
  results: 'exams',
  'exam-upcoming': 'exams',
  'exam-live': 'exams',
  'exam-done': 'exams',
  'exam-results': 'exams',
  'exam-practice': 'exams',
  'exam-instant': 'exams',
  'exam-papers': 'exams',
  'exam-recent': 'exams',
  'exam-bank': 'exams',
  'exam-other': 'exams',
  'routine-today': 'routine',
  'routine-tomorrow': 'routine',
  'routine-weekly': 'routine',
  'routine-class': 'routine',
  'routine-exam': 'routine',
  'routine-changed': 'routine',
  'routine-holiday': 'routine',
  'routine-important': 'routine',
  'routine-other': 'routine',
  classes: 'home',
  'class-today': 'home',
  'class-upcoming': 'home',
  'class-record': 'home',
  'class-subjects': 'home',
  'class-teachers': 'home',
  'class-notes': 'home',
  'class-materials': 'home',
  'class-attendance': 'home',
  'class-other': 'home',
  'my-courses': 'courses',
  homework: 'courses',
  suggestion: 'courses',
  'question-bank': 'courses',
  materials: 'courses',
  'model-test': 'courses',
  'study-practice': 'courses',
  'study-results': 'courses',
  'study-other': 'courses',
  'routine-day': 'routine',
  reports: 'profile',
  'notification-settings': 'profile',
  'my-profile': 'profile',
  settings: 'profile',
  'student-fee': 'profile',
  'notice-board': 'home'
});

export function viewRouteFromHash(hash = window.location.hash) {
  const name = String(hash || '').replace('#', '');
  return VIEW_ROUTES.includes(name) ? name : 'home';
}

function syncViewHash(viewName, mode) {
  if (mode === 'keep') return;
  if (typeof window === 'undefined' || !window.history?.pushState) return;
  const name = VIEW_ROUTES.includes(viewName) ? viewName : 'home';
  const target = name === 'home' ? '' : `#${name}`;
  const rawHash = window.location.hash || '';
  const current = rawHash === '#home' ? '' : rawHash;
  const url = window.location.pathname + window.location.search + target;
  if (current === target) {
    // Still normalise a literal #home away so Home is the clean bare URL.
    if (rawHash !== target) window.history.replaceState(window.history.state, '', url);
    return;
  }
  if (mode === 'push') window.history.pushState(window.history.state, '', url);
  else window.history.replaceState(window.history.state, '', url);
}

export function setView(viewName, { history: historyMode = 'push' } = {}) {
  const name = VIEW_ALIASES[viewName] || viewName;
  const panel = document.getElementById(`${name}View`) || document.getElementById(VIEW_ID_OVERRIDES[name] || '');
  if (!panel) return;
  $$('[data-view-panel]').forEach(item => item.classList.toggle('active', item === panel));
  const parent = NAV_PARENTS[name] || name;
  $$('.bottom-link').forEach(item => {
    const active = item.dataset.view === parent;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
  scrollToTop();
  syncViewHash(name, historyMode);
  window.dispatchEvent(new CustomEvent('apc-view-change', { detail: { view: name } }));
}
