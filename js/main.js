import { iconMarkup } from './icons.js';
/* Application composition root. Feature modules can be replaced independently. */
import { runMigrations } from './storage/migration.js';
import { KEYS, listDocuments } from './database.js';
import { syncAccountStatus, syncStudentProfileFromRoster, ROSTER_KEY } from './office-data.js';
import { STORAGE_KEYS, defaultStudent, maintenanceState } from './config.js';
import { loadStudent, loadAccount, hasSession, saveStudent, clearSession, loadAppConfig } from './storage.js';
import { escapeHtml } from './sanitize.js';
import { $, setAuthMessage, showFeedback, openModal } from './ui.js';
import { renderStudent, openStudentApp, showAuthScreen, setView, viewRouteFromHash } from './shell.js';
import { initAppearance } from './appearance.js';
import { activeStaffRoles } from './staff-auth.js';
import { staffPanelPath } from './login.js';
import { switchAuthTab, initLogin } from './login.js';
import { requestLogout, initLogout } from './logout.js';
import { initNavigation } from './navigation.js';
import { initFixedShell } from './fixed-shell.js';
import { loadStudentFeatures } from './student-features.js';

/* Composition root for login and student shells. */
const ON_AUTH_PAGE = Boolean($('#authScreen'));
const ON_APP_PAGE = Boolean($('#appShell'));
const STUDENT_PANEL_URL = 'student.html';

function goToStudentPanel() {
  // js/login.js has already persisted the session at this point; the panel
  // page restores it and applies any #view shortcut in the URL.
  window.location.assign(`${STUDENT_PANEL_URL}${window.location.hash || ''}`);
}

/* Always reveal the login shell before optional startup work. A failure in any
   secondary feature must never leave the entry page completely blank. */
showAuthScreen();
switchAuthTab('login');

initFixedShell();
runMigrations();
/* The login card, the signed-in shell and the Help sheet all show the ONE
   institute record (js/org-info.js). It is loaded as a lazy chunk so the login
   screen's first paint stays inside the load budget; the painter installs its
   listeners as soon as the module lands and re-runs after every settings
   save/sync. */
let orgInfo = null;
const orgInfoReady = import('./org-info.js')
  .then(mod => { orgInfo = mod; mod.initOrgInfo(); return mod; })
  .catch(() => null);
const repaintOrgInfo = () => { try { orgInfo?.applyOrgInfo(); } catch { /* paint self-guards */ } };

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

/* Paint the current maintenance notice. */
function applyMaintenanceMode(cfg = loadAppConfig()) {
  const { on } = maintenanceState(cfg);
  if (!on) {
    MAINTENANCE_HOSTS.forEach(({ id }) => $(`#${id}`)?.remove());
    $('#appMaintenanceBanner')?.remove();   // legacy cleanup: id from an older build, no page renders it
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

  // 1. Institute name / slogan / contact — one record, one painter.
  repaintOrgInfo();

  // 3. Maintenance Mode
  applyMaintenanceMode(cfg);

  // 4. Registration Permission
  const regTab = $('[data-auth-tab="register"]');
  if (regTab) {
    const regBlocked = cfg.allowRegistration === false;
    regTab.disabled = regBlocked;
    regTab.style.opacity = regBlocked ? '0.5' : '';
    if (regBlocked) regTab.title = 'বর্তমানে নতুন রেজিস্ট্রেশন বন্ধ রয়েছে';
    else regTab.removeAttribute('title');
  }

  // 5. Module Toggles
  $('.bottom-link[data-view="routine"]')?.classList.toggle('disabled-nav', cfg.modules?.routine === false);
  $('.bottom-link[data-view="courses"]')?.classList.toggle('disabled-nav', cfg.modules?.courses === false);
  $('.bottom-link[data-view="exams"]')?.classList.toggle('disabled-nav', cfg.modules?.results === false);

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
  } else {
    delete document.documentElement.dataset.timeTheme;
  }
}

applyAppConfig(appConfig);

/* Re-apply live app settings (maintenance banner, module toggles, tagline) on remote sync. */
window.addEventListener('storage', event => {
  if (!event || event.key === null || event.key === STORAGE_KEYS.appConfig) applyAppConfig(loadAppConfig());
});
window.addEventListener('apc-sync-updated', event => {
  if (event?.detail?.collection === 'settings') applyAppConfig(loadAppConfig());
});
window.addEventListener('apc-app-config', () => applyAppConfig(loadAppConfig()));

const state = {
  student: loadStudent(),
  account: loadAccount()
};
/* Signed-in features load on demand. */
const featureHandles = {};
let classChatFlight = null;
function ensureStudentClassChat() {
  const mount = $('#studentClassChatMount');
  if (!mount) return;
  classChatFlight ??= import('./class-chat.js').catch(err => { classChatFlight = null; throw err; });
  void classChatFlight.then(mod => mod.mountClassChat(mount, { portal: 'student', getStudent: () => state.student }))
    .catch(err => console.warn('[Active Plus] class-chat load failed:', err?.message));
}
window.addEventListener('apc-view-change', e => { if (e.detail?.view === 'class-chat') ensureStudentClassChat(); });
const noticeBoard = { refresh: (...args) => featureHandles.noticeBoard?.refresh?.(...args) };
const refreshExams = Object.assign(
  (...args) => featureHandles.refreshExams?.(...args),
  { setTab: tab => featureHandles.refreshExams?.setTab?.(tab) }
);
const refreshPractice = (...args) => featureHandles.refreshPractice?.(...args);
const refreshTeaching = (...args) => featureHandles.refreshTeaching?.(...args);
const refreshStudySections = (...args) => featureHandles.refreshStudySections?.(...args);
const refreshFee = (...args) => featureHandles.refreshFee?.(...args);
const refreshStudentSections = () => { void refreshStudySections(); void refreshFee(); };
const refreshDashboard = (...args) => featureHandles.refreshDashboard?.(...args);
const refreshCourses = Object.assign(
  (...args) => featureHandles.refreshCourses?.(...args),
  { paint: (...args) => featureHandles.refreshCourses?.paint?.(...args) }
);
const dailyQuote = { paint: (...args) => featureHandles.dailyQuote?.paint?.(...args) };
const refreshRoutine = (...args) => featureHandles.refreshRoutine?.(...args);
const refreshReports = (...args) => featureHandles.refreshReports?.(...args);
const openProfileEditor = (...args) => featureHandles.openProfileEditor?.(...args);
const shareStudentOnWhatsApp = (...args) => featureHandles.shareStudentOnWhatsApp?.(...args);

function refreshSignedInSurface() {
  refreshDashboard();
  refreshRoutine();
  refreshTeaching(); refreshCourses.paint();
  dailyQuote.paint();
  refreshExams(); refreshPractice();
  refreshStudentSections();
  refreshNotices();
  refreshReports($('#studentReports'));
  if ($('#classChatView')?.classList.contains('active')) ensureStudentClassChat();
}

/* Wire lazily loaded student feature modules. */
function initStudentFeatureSurface(f) {
  const boot = (name, init) => {
    try { return init(); }
    catch (error) {
      console.warn(`[Active Plus] ${name} init failed:`, error?.message);
      return undefined;
    }
  };
  featureHandles.noticeBoard = boot('notice-board', () => f.noticeBoard.initStudentNoticeBoard({ getStudent: () => state.student }));
  featureHandles.refreshExams = boot('exams', () => f.exams.initStudentExams({ getStudent: () => state.student, getAccount: () => state.account }));
  featureHandles.refreshPractice = boot('practice', () => f.practice.initStudentPractice({ getStudent: () => state.student, getAccount: () => state.account }));
  featureHandles.refreshTeaching = boot('teaching', () => f.teaching.initStudentTeaching({ getStudent: () => state.student }));
  featureHandles.refreshStudySections = boot('study-sections', () => f.studySections.initStudentStudySections({ getStudent: () => state.student, teaching: featureHandles.refreshTeaching }));
  featureHandles.refreshFee = boot('fee', () => f.fee.initStudentFee({ getStudent: () => state.student }));
  featureHandles.refreshDashboard = boot('dashboard', () => f.dashboard.initStudentDashboard({ getStudent: () => state.student, getAccount: () => state.account }));
  featureHandles.refreshCourses = boot('course-hub', () => f.courseHub.initCourseHub({
    getStudent: () => state.student,
    onAction: action => {
      if (action.kind === 'chapter-mcq-practice') {
        setView('exams');
        window.apcStudentPractice?.setMode?.('instant');
        refreshExams.setTab?.('practice');
        if (window.apcStudentPractice?.openChapter) window.apcStudentPractice.openChapter(action);
        else refreshPractice();
      } else if (action.kind === 'chapter-model-test') {
        setView('exams');
        window.dispatchEvent(new CustomEvent('apc-notification-action', {
          detail: { kind: 'exam', id: action.examId, action: 'start' }
        }));
      }
    }
  }));
  featureHandles.dailyQuote = boot('daily-quote', () => f.dailyQuote.initDailyQuote({ mount: '#dailyQuoteCard' }));
  featureHandles.refreshRoutine = boot('routine', () => f.routine.initRoutine({ getStudent: () => state.student }));
  boot('hubs', () => f.hubs.initStudentHubs({ getStudent: () => state.student }));
  boot('profile', () => f.profile.initProfile({
    state,
    onStudentChange: student => { renderStudent(student); noticeBoard.refresh(); refreshTeaching(); refreshExams(); refreshPractice(); refreshCourses.paint(); refreshDashboard(); refreshRoutine(); refreshStudentSections(); refreshReports($('#studentReports')); }
  }));
  // More owns the student's settings; only the missing runtime facts are added.
  boot('settings-hub', () => f.settingsHub.mountStudentMoreSettings({
    mount: '#moreDeviceSettings',
    session: { value: 'লগইন সেশন এই ডিভাইসে', hint: 'নিরাপত্তার জন্য সেশন ডিভাইস-বাউন্ড' }
  }));
  boot('notification-settings', () => f.notificationSettings.initNotificationSettings({ mount: '#notificationSettings' }));
  boot('reports', () => f.reports.mountReports($('#studentReports'), { panel: 'student' }));
  featureHandles.refreshReports = f.reports.refreshReports;
  featureHandles.openProfileEditor = f.profile.openProfileEditor;
  featureHandles.shareStudentOnWhatsApp = f.profile.shareStudentOnWhatsApp;
  // The chunk can land after a session was already restored (a slow first load):
  // repaint whatever is on screen so no signed-in view ever stays empty.
  if ($('#appShell')?.hidden === false) refreshSignedInSurface();
}

let studentFeaturesFlight = null;
let studentFeaturesRetries = 0;
/* Recover from failed optional feature loads. */
const STUDENT_FEATURES_RETRY_DELAYS = Object.freeze([1200, 4000]);
function bootStudentFeatures() {
  studentFeaturesFlight ??= loadStudentFeatures()
    .then(initStudentFeatureSurface)
    .catch(error => {
      // A failed chunk must never blank the app: the next navigation or login
      // retries it, and the auth screen never depended on it.
      studentFeaturesFlight = null;
      console.warn('[Active Plus] feature chunk unavailable:', error?.message);
      const delay = STUDENT_FEATURES_RETRY_DELAYS[studentFeaturesRetries];
      if (delay !== undefined) {
        studentFeaturesRetries += 1;
        window.setTimeout(() => { void bootStudentFeatures(); }, delay);
        return;
      }
      showFeedback('অ্যাপের কিছু অংশ লোড হয়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।');
    });
  return studentFeaturesFlight;
}
bootStudentFeatures();

/* A control that names a tab of the পরীক্ষা section (Home's ফলাফল card) opens
   that tab. Tabs inside the section are handled by the exam module itself. */
document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-exam-tab]');
  if (!trigger || trigger.closest('#examTabs')) return;
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
      void import('./install.js').then(({ installApp }) => installApp());
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
      // Reads the CURRENT institute record at open time (address change bug fix).
      openModal('studentHelpModal');
      repaintOrgInfo();
      void orgInfoReady.then(mod => mod?.applyOrgInfo());
      break;
    /* Home icon-grid shortcuts. Each one only opens something that already
       exists: a filtered list, the bell's inbox, or the fee card on Home. */
    case 'homework':
    case 'suggestion':
    case 'question-bank': {
      const section = action === 'homework' ? 'homework' : action === 'suggestion' ? 'suggestion' : 'bank';
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
  sessionRestoreSequence += 1;
  setView(viewRouteFromHash(), { history: 'replace' });
  openStudentApp(state);
  refreshSignedInSurface();
  window.dispatchEvent(new Event('apc-session-ready'));
}

function leaveApp() {
  sessionRestoreSequence += 1;
  clearSession();
  window.dispatchEvent(new Event('apc-session-ended'));
  if (ON_APP_PAGE) {
    window.location.replace('index.html');
    return;
  }
  switchAuthTab('login');
  showAuthScreen();
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  setAuthMessage('');
}

async function shouldAutoLogin() {
  if (!state.account) return false;
  return hasSession();
}

renderStudent(state.student);
initNavigation({ onAction: handleAction });
const refreshNotices = () => { window.apcNoticeCenter?.paint?.(); noticeBoard.refresh(); };
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
if (navigator.onLine && new URLSearchParams(location.search).get('fbtest') === '1') {
  import('./firebase-online-test.js?v=20261008-syncfix')
    .then(({ testFirebaseOnlineConnection }) => testFirebaseOnlineConnection())
    .catch(() => {});
}
void import('./theme.js').then(({ initDynamicTheme }) => initDynamicTheme());
initAppearance();
void import('./copy.js').then(({ initCopyChips }) => initCopyChips());
void import('./install.js').then(({ initInstallPrompt }) => initInstallPrompt());
void import('./service-worker.js').then(({ registerServiceWorker }) => registerServiceWorker()).catch(() => {});
initLogin({
  state,
  onAuthenticated: ON_AUTH_PAGE ? goToStudentPanel : enterApp
});
if (ON_AUTH_PAGE) {
  void import('./register.js').then(({ initRegister }) => initRegister({ state }));
  void import('./recovery.js').then(({ initRecovery }) => initRecovery({ state }));
}
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
    if (ON_AUTH_PAGE) {
      // The session is real, so the panel lives on its own page now.
      window.location.replace(`${STUDENT_PANEL_URL}${window.location.hash || ''}`);
      return;
    }
    state.student = { ...state.student, ...(state.account.student || {}) };
    saveStudent(state.student);
    if (sequence !== sessionRestoreSequence) return;
    enterApp();
  } else if (ON_APP_PAGE) {
    // No session: the panel page never renders for a signed-out visitor.
    window.location.replace('index.html');
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

window.addEventListener('storage', async event => {
  if (!event.apcRemote) return;
  try {
    if (event.key === KEYS.students) {
      const account = loadAccount();
      const id = account?.student?.id || account?.studentId;
      const roster = listDocuments('students').find(student => student.id === id);
      const status = roster?.status === 'approved' || roster?.status === 'active' ? 'active' : roster?.status;
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
    refreshSignedInSurface();
  } catch (error) {
    console.warn('[Active Plus] cloud refresh failed:', error?.message);
  }
});
