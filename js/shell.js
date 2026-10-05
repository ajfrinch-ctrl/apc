/* App shell lifecycle and student identity rendering. */
import { loadAccount } from './storage.js';
import { $, $$, scrollToTop, toBanglaNumber } from './ui.js';

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
    app.classList.remove('is-pending');
  }
  scrollToTop();
}

/* Deep-linkable student views. The URL hash always names the open view:
   #routine, #courses, #exams, #results, #profile, #reports (home has no hash).
   Reports is a More/profile sub-page. Browser
   and system Back walk the visited views; refresh and shared links reopen the
   exact view (pattern: hash router + back button). */
const VIEW_ROUTES = Object.freeze(['home', 'routine', 'courses', 'exams', 'results', 'profile', 'reports', 'notification-settings', 'notice-board']);

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

/* Routes whose view id does not follow the `<route>View` rule (a hyphenated
   route keeps its camelCase element id). */
const VIEW_ID_OVERRIDES = Object.freeze({ 'notification-settings': 'notificationSettingsView' });

export function setView(viewName, { history: historyMode = 'push' } = {}) {
  const panel = document.getElementById(`${viewName}View`) || document.getElementById(VIEW_ID_OVERRIDES[viewName] || '');
  if (!panel) return;
  $$('[data-view-panel]').forEach(item => item.classList.toggle('active', item === panel));
  $$('.bottom-link').forEach(item => {
    const parent = viewName === 'exams' ? 'courses' : viewName === 'reports' ? 'profile' : viewName === 'notice-board' ? 'home' : viewName;
    const active = item.dataset.view === parent;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
  scrollToTop();
  syncViewHash(viewName, historyMode);
}
