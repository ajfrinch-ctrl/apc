import { iconMarkup } from './icons.js';
/* Application composition root. Feature modules can be replaced independently. */
import { runMigrations } from './storage/migration.js';
import { KEYS, listDocuments } from './database.js';
import { syncAccountStatus, syncStudentProfileFromRoster, ROSTER_KEY } from './office-data.js';
import { APP_TAGLINE, STORAGE_KEYS, defaultStudent, maintenanceState } from './config.js';
import { loadStudent, loadAccount, hasSession, saveStudent, clearSession, loadAppConfig } from './storage.js';
import { escapeHtml } from './sanitize.js';
import { $, setAuthMessage, showFeedback } from './ui.js';
import { renderStudent, openStudentApp, showAuthScreen, setView, viewRouteFromHash } from './shell.js';
import { initAppearance } from './appearance.js';
import { initCopyChips } from './copy.js';
import { activeStaffRoles } from './staff-auth.js';
import { staffPanelPath } from './login.js';
import { switchAuthTab, initLogin } from './login.js';
import { initRegister } from './register.js';
import { initRecovery } from './recovery.js';
import { requestLogout, initLogout } from './logout.js';
import { initNavigation } from './navigation.js';
import { initProfile, openProfileEditor, shareStudentOnWhatsApp } from './profile.js';
import { initRoutine } from './routine.js';
import { initInstallPrompt, installApp } from './install.js';
import { initConnectivity } from './connectivity.js';
import { registerServiceWorker } from './service-worker.js';
import { initDynamicTheme } from './theme.js';
import { initFixedShell } from './fixed-shell.js';
import { initStudentExams } from './student-exams.js';
import { initStudentPractice } from './student-practice.js';
import { initStudentTeaching } from './student-teaching.js';
import { initStudentNoticeBoard } from './student-notice-board.js';
import { initStudentDashboard } from './student-dashboard.js';
import { mountReports, refreshReports } from './reports.js';
import { initNotificationSettings } from './notification-settings.js';
import { initCourseHub } from './course-hub.js';
import { initStudentStudySections } from './student-study-sections.js';
import { initStudentFee } from './student-more.js';
import { initDailyQuote } from './daily-quote.js';

/* Always reveal the login shell before optional startup work. A failure in any
   secondary feature must never leave the entry page completely blank. */
showAuthScreen();
switchAuthTab('login');

initFixedShell();
runMigrations();

const appConfig = loadAppConfig();

/* Maintenance notice: one sink, two hosts (the login card and the signed-in
   screen). The admin's message is untrusted text, so it is escaped here — the
   only place it is ever interpolated. */
const MAINTENANCE_HOSTS = Object.freeze([
  { id: 'authMaintenanceBanner', host: '.auth-card' },
  { id: 'appMainMaintenanceBanner', host: '#appMain' }
]);

function maintenanceBannerMarkup(cfg) {
  const { message } = maintenanceState(cfg);
  return `
      <div class="maint-icon">
        ${iconMarkup('shield')}
      </div>
      <div class="maint-body">
        <strong>⚠️ সিস্টেম রক্ষণাবেক্ষণ চলছে</strong>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
}

/* Paints or clears the notice from the live config. Safe to call at any time:
   the admin can switch maintenance off from another tab or another device, and
   this device must drop the banner without waiting for a reload. */
function applyMaintenanceMode(cfg = loadAppConfig()) {
  const { on } = maintenanceState(cfg);
  if (!on) {
    MAINTENANCE_HOSTS.forEach(({ id }) => $(`#${id}`)?.remove());
    $('#appMaintenanceBanner')?.remove();   // legacy id from an older build
    return;
  }
  const markup = maintenanceBannerMarkup(cfg);
  for (const { id, host } of MAINTENANCE_HOSTS) {
    let banner = $(`#${id}`);
    if (!banner) {
      // Inserted inside the card / main column, never over the fixed topbar.
      const parent = $(host);
      if (!parent) continue;
      banner = document.createElement('div');
      banner.id = id;
      banner.className = 'maintenance-alert-card';
      parent.prepend(banner);
    }
    banner.innerHTML = markup;
    banner.hidden = false;
  }
}

function applyAppConfig(cfg) {
  if (!cfg) return;

  // 1. Tagline — shown on its own line under the institute name.
  const taglineText = cfg.tagline || APP_TAGLINE;
  document.querySelectorAll('[data-fixed-tagline]').forEach(tagline => {
    tagline.textContent = taglineText;
  });

  // 3. Maintenance Mode
  applyMaintenanceMode(cfg);

  // 4. Registration Permission
  if (cfg.allowRegistration === false) {
    const regTab = $('[data-auth-tab="register"]');
    if (regTab) {
      regTab.disabled = true;
      regTab.style.opacity = '0.5';
      regTab.title = 'বর্তমানে নতুন রেজিস্ট্রেশন বন্ধ রয়েছে';
    }
  }

  // 5. Module Toggles
  if (cfg.modules) {
    if (cfg.modules.routine === false) {
      $('.bottom-link[data-view="routine"]')?.classList.add('disabled-nav');
    }
    if (cfg.modules.courses === false) {
      $('.bottom-link[data-view="courses"]')?.classList.add('disabled-nav');
    }
    if (cfg.modules.results === false) {
      $('.bottom-link[data-view="exams"]')?.classList.add('disabled-nav');
    }
  }

  // Home shortcuts mirror the same optional modules as the navigation. A
  // disabled module must not become reachable just because it has a tile.
  const TILE_MODULES = [
    ['#studentServices [data-action="homework"]', 'courses'],
    ['#studentServices [data-action="suggestion"]', 'courses'],
    ['#studentServices [data-action="question-bank"]', 'courses'],
    ['#studentServices [data-view="exams"]:not([data-exam-tab])', 'courses'],
    ['#studentServices [data-exam-tab="results"]', 'results'],
    ['#studentServices [data-view="notice-board"]', null]
  ];
  for (const [selector, module] of TILE_MODULES) {
    if (!module) continue;
    const disabled = cfg.modules?.[module] === false;
    document.querySelectorAll(selector).forEach(button => { button.disabled = disabled; });
  }

  // 6. Theme Mode Override
  if (cfg.themeMode && cfg.themeMode !== 'auto') {
    document.documentElement.dataset.timeTheme = cfg.themeMode;
  }
}

applyAppConfig(appConfig);

/* The flag is a setting, not a build-time constant: another tab on this device
   and the cloud sync both write it after this module has booted. Repaint on
   every settings write so an "off" from the admin clears the notice at once
   instead of surviving until the next reload. */
window.addEventListener('storage', event => {
  if (!event || event.key === null || event.key === STORAGE_KEYS.appConfig) applyMaintenanceMode();
});
window.addEventListener('apc-app-config', () => applyMaintenanceMode());

const state = {
  student: loadStudent(),
  account: loadAccount()
};
const noticeBoard = initStudentNoticeBoard({ getStudent: () => state.student });
const refreshExams = initStudentExams({ getStudent: () => state.student, getAccount: () => state.account });
/* ইনস্ট্যান্ট MCQ অনুশীলন — official papers are untouched; the practice lane
   reads the same papers through the question bank they join on publish. */
const refreshPractice = initStudentPractice({ getStudent: () => state.student, getAccount: () => state.account });
const refreshTeaching = initStudentTeaching({ getStudent: () => state.student });
/* পড়াশোনা = one screen with five sections; the sections own the teaching board's
   scope, so the board is initialised first and handed in. */
const refreshStudySections = initStudentStudySections({ getStudent: () => state.student, teaching: refreshTeaching });
/* ফি is read-only: the same finance repository the Home card reads. */
const refreshFee = initStudentFee({ getStudent: () => state.student });
const refreshStudentSections = () => { void refreshStudySections(); void refreshFee(); };
const refreshDashboard = initStudentDashboard({ getStudent: () => state.student, getAccount: () => state.account });
/* The Learning Hub (Class → Subject → Chapter → Content) reads the same exams,
   questions, practice history and results the existing learning modules own —
   it never keeps a second copy. Chapter MCQ practice and model tests route to
   those modules rather than starting parallel workflows. */
const refreshCourses = initCourseHub({
  getStudent: () => state.student,
  onAction: action => {
    if (action.kind === 'chapter-mcq-practice') {
      setView('exams');
      if (window.apcStudentPractice?.openChapter) window.apcStudentPractice.openChapter(action);
      else refreshPractice();
    } else if (action.kind === 'chapter-model-test') {
      setView('exams');
      window.dispatchEvent(new CustomEvent('apc-notification-action', {
        detail: { kind: 'exam', id: action.examId, action: 'start' }
      }));
    }
  }
});
/* আজকের অনুপ্রেরণা — the day's quote is on screen before this line returns and
   never waits for a network or a decision from the reader. */
const dailyQuote = initDailyQuote({ mount: '#dailyQuoteCard' });

/* A control that names a tab of the পরীক্ষা section (Home's ফলাফল card) opens
   that tab. Tabs inside the section are handled by the exam module itself. */
document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-exam-tab]');
  if (!trigger || trigger.closest('#examTabs')) return;
  setView('exams');
  refreshExams.setTab?.(trigger.dataset.examTab);
});

function handleAction(action) {
  switch (action) {
    case 'continue':
    case 'see-routine':
      setView('routine');
      break;
    case 'edit-profile':
      openProfileEditor(state.student);
      break;
    case 'install':
      installApp();
      break;
    case 'show-offline':
      showFeedback('তোমার তথ্য এই ডিভাইসেই নিরাপদে সংরক্ষিত আছে');
      break;
    case 'whatsapp-share':
      shareStudentOnWhatsApp(state.student);
      break;
    case 'class-details':
      setView('routine');
      showFeedback('আজকের ক্লাস রুটিন দেখানো হচ্ছে');
      break;
    case 'all-results':
      showFeedback('সব ফলাফল খুব শিগগির যুক্ত হবে');
      break;
    case 'help':
      showFeedback('অফিসে যোগাযোগের জন্য অ্যাপের নোটিশ দেখুন');
      break;
    /* Home icon-grid shortcuts. Each one only opens something that already
       exists: a filtered list, the bell's inbox, or the fee card on Home. */
    case 'homework':
    case 'suggestion':
    case 'question-bank': {
      const section = action === 'homework' ? 'homework' : action === 'suggestion' ? 'suggestion' : 'bank';
      setView('courses');
      window.dispatchEvent(new CustomEvent('apc-open-study-section', { detail: { section } }));
      break;
    }
    case 'notices':
      setView('notice-board');
      noticeBoard.refresh();
      break;
    case 'fees':
      // ফি now has one read-only screen; Home keeps the summary card.
      setView('student-fee');
      void refreshFee();
      break;
    case 'logout':
      requestLogout();
      break;
    default:
      break;
  }
}

function enterApp() {
  // A completed login wins over an in-flight asynchronous session restore.
  sessionRestoreSequence += 1;
  // A #view shortcut in the URL opens exactly that view after any login;
  // otherwise every login lands on Home. A leftover panel from a previous
  // session must never greet the student.
  setView(viewRouteFromHash(), { history: 'replace' });
  openStudentApp(state);
  refreshDashboard();
  refreshTeaching(); refreshCourses.paint();
  dailyQuote.paint();
  refreshExams(); refreshPractice();
  refreshStudentSections();
  refreshNotices();
  window.dispatchEvent(new Event('apc-session-ready'));
  // A student's reports are their own: the module re-reads the signed-in id.
  mountReports($('#studentReports'), { panel: 'student' });
}

function leaveApp() {
  sessionRestoreSequence += 1;
  clearSession();
  window.dispatchEvent(new Event('apc-session-ended'));
  switchAuthTab('login');
  showAuthScreen();
  // Logout always lands on the login page itself — drop a leftover view hash too.
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  setAuthMessage('লগআউট হয়েছে। আবার প্রবেশ করতে মোবাইল নম্বর ও পাসওয়ার্ড দিন।');
}

/* A remembered, device-bound session is the only way to restore the app
   without retyping credentials. An account or legacy skip flag is not enough. */
async function shouldAutoLogin() {
  if (!state.account) return false;
  return hasSession();
}

renderStudent(state.student);
initNavigation({ onAction: handleAction });
/* The bell and its inbox are owned by the notification engine
   (js/notifications.js) so every panel shares one receipt list. */
const refreshNotices = () => { window.apcNoticeCenter?.paint?.(); noticeBoard.refresh(); };
const refreshRoutine = initRoutine({ getStudent: () => state.student });
initProfile({
  state,
  onStudentChange: student => { renderStudent(student); noticeBoard.refresh(); refreshTeaching(); refreshExams(); refreshPractice(); refreshCourses.paint(); refreshDashboard(); refreshRoutine(); refreshStudentSections(); refreshReports($('#studentReports')); }
});
let rosterProfileSyncFlight = null;
async function applyRosterProfileToStudent() {
  const studentId = state.student?.id;
  if (!studentId || rosterProfileSyncFlight) return rosterProfileSyncFlight;
  rosterProfileSyncFlight = syncStudentProfileFromRoster(studentId).then(account => {
    if (!account) return;
    state.account = account;
    state.student = account.student;
    if (account.status !== 'active') { leaveApp(); return; }
    renderStudent(state.student);
    noticeBoard.refresh(); refreshTeaching(); refreshExams(); refreshPractice();
    refreshCourses.paint(); refreshDashboard(); refreshRoutine(); refreshStudentSections(); refreshReports($('#studentReports'));
  }).catch(() => {}).finally(() => { rosterProfileSyncFlight = null; });
  return rosterProfileSyncFlight;
}
window.addEventListener('apc-sync-updated', event => {
  if (event.detail?.collection === 'students') void applyRosterProfileToStudent();
});
window.addEventListener('storage', event => {
  if (!event.key || event.key === ROSTER_KEY) void applyRosterProfileToStudent();
});
// Settings → Notification Settings: switches, permission, preview and history.
initNotificationSettings({ mount: '#notificationSettings' });
initConnectivity();
// Firebase is optional during online testing; offline startup remains independent.
// The connection smoke test is diagnostic-only and costs an extra SDK download,
// so it runs only when explicitly asked (index.html?fbtest=1) — never on a
// normal boot, and never as an unhandled rejection that can take the page down.
if (navigator.onLine && new URLSearchParams(location.search).get('fbtest') === '1') {
  import('./firebase-online-test.js?v=20260929-fbaudit')
    .then(({ testFirebaseOnlineConnection }) => testFirebaseOnlineConnection())
    .catch(() => {});
}
initDynamicTheme();
initAppearance();
initCopyChips();
initInstallPrompt();
registerServiceWorker();
initLogin({
  state,
  onAuthenticated: enterApp
});
initRegister({ state });
initRecovery({ state });
initLogout({ onLoggedOut: leaveApp });

// Pending-account screen is the only other place a student can leave the app.
$('#pendingLogout')?.addEventListener('click', leaveApp);

// The entry decision is asynchronous: the stored session may be encrypted.
// A #view shortcut in the URL is applied by enterApp once the screen opens.
let sessionRestoreSequence = 0;
async function restoreEntrySession() {
  const sequence = ++sessionRestoreSequence;
  const roles = await activeStaffRoles();
  if (sequence !== sessionRestoreSequence) return;
  if (roles.length) {
    window.location.replace(staffPanelPath(roles[0]));
    return;
  }
  state.account = loadAccount();
  const authenticated = await shouldAutoLogin();
  if (sequence !== sessionRestoreSequence) return;
  if (authenticated) {
    state.student = { ...state.student, ...(state.account.student || {}) };
    saveStudent(state.student);
    if (sequence !== sessionRestoreSequence) return;
    enterApp();
  } else {
    window.dispatchEvent(new Event('apc-session-ended'));
    showAuthScreen();
    switchAuthTab('login');
  }
}
window.addEventListener('popstate', () => { void restoreEntrySession(); });
/* The open student page lives in the URL hash, so a refresh reopens it. A hash
   edited (or a link opened) while the app is already on screen follows here. */
window.addEventListener('hashchange', () => {
  if ($('#appShell')?.hidden !== false) return;
  if ($('#appShell')?.classList.contains('is-pending')) return;
  setView(viewRouteFromHash(), { history: 'keep' });
});
// Back/forward cache restores an old DOM without running module startup again.
window.addEventListener('pageshow', event => {
  if (event.persisted) void restoreEntrySession();
});
void restoreEntrySession();

// Cloud writes occur in this window; native storage events alone never fire here.
window.addEventListener('storage', async event => {
  if (!event.apcRemote) return;
  try {
    if (event.key === KEYS.students) {
      const account = loadAccount();
      const id = account?.student?.id || account?.studentId;
      const roster = listDocuments('students').find(student => student.id === id);
      const status = roster?.status === 'approved' ? 'active' : roster?.status;
      if (roster && status !== account?.status) {
        await syncAccountStatus(id, roster.status);
        state.account = loadAccount();
      }
    }
    if (event.key === KEYS.account) {
      state.account = loadAccount();
      if (state.account?.student) {
        state.student = { ...defaultStudent, ...state.account.student };
        saveStudent(state.student);
        renderStudent(state.student);
      }
    }
    if (!$('#appShell').hidden) openStudentApp(state);
    refreshDashboard();
    refreshTeaching(); refreshCourses.paint();
    refreshExams(); refreshPractice();
    refreshStudentSections();
    refreshNotices();
    refreshReports($('#studentReports'));
  } catch (error) {
    console.warn('[Active Plus] cloud refresh failed:', error?.message);
  }
});
