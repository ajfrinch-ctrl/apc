import { mountStatusNotice } from './status-surface.js';
/* Notification centre for every app page.

   Two layers, one list:
     • the in-app list (the student bell already renders it) and
     • a system notification (Android/desktop notification tray) raised when a
       new notice, urgent broadcast, exam or result arrives through the sync
       bridge while the app is open — including a backgrounded tab.

   The rules live in js/notification-rules.js (pure, tested). This file only
   reads local data, keeps this device's seen receipts and shows the
   notification. It never uploads anything: the FCM device token is handled by
   js/push-notifications.js, and that module is optional — if it fails, the
   centre still works.

   A brand-new device records the existing notices silently: a fresh install
   must never replay old news as a burst of notifications. */

import { readJSON, writeJSON, loadAppConfig, loadAccount } from './storage.js';
import { KEYS, STAFF_KEYS, listDocuments } from './database.js';
import { loadNotices, loadRoster } from './office-data.js';
import { listTeacherAssignments } from './teacher-assignments.js';
import { getDeviceId } from './session.js';
import {
  BOOT_KEY_PREFIX, CLEARED_KEY_PREFIX, LOCAL_WRITE_KEY, NOTICE_BOARD_READ_PREFIX, PROMPT_HIDDEN_KEY, REGISTRATION_REVIEWERS,
  SEEN_KEY_PREFIX, SHOWN_KEY, INAPP_KEY_PREFIX, claimDelivery, planInAppAlerts, clearedRecord,
  nextExamBoundary, nextHomeworkBoundary, nextBirthdayBoundary, notificationFeed,
  planDeliveries, pushPayload, seenRecord, viewerKeyOf
} from './notification-rules.js';
import {
  listNotifications, markDelivered, markRead, notificationSettings,
  saveNotificationSettings, syncNotifications, unreadNotifications
} from './notification-store.js';

/* A notification tapped while no app window was open: the service worker
   leaves the payload here and opens the panel, which picks it up once. */
export const PENDING_CLICK_PATH = './__apc-pending-click';
// Same cache name as js/panel-lockdown.js and sw.js (not imported: the student
// page must not load the staff lockdown module just for a constant).
const PANEL_HINT_CACHE = 'apc-panel-hint';
const PENDING_CLICK_MAX_AGE_MS = 10 * 60 * 1000;

const ROLE_PAGES = Object.freeze({
  'admin.html': 'admin',
  'manager.html': 'manager',
  'teacher.html': 'teacher',
  'payment.html': 'payment'
});
const ROLE_ACCOUNT_KEYS = Object.freeze({
  admin: STAFF_KEYS.adminAccount,
  manager: STAFF_KEYS.managerAccount,
  teacher: STAFF_KEYS.teacherAccount,
  payment: STAFF_KEYS.paymentAccount
});
const ROLE_USERNAMES = Object.freeze({
  admin: 'admin.apc', manager: 'manager.apc', teacher: 'teacher.apc', payment: 'payment.apc'
});

const PROMPT_HIDE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_DEBOUNCE_MS = 400;
const ARM_FALLBACK_MS = 12000;
const SW_READY_TIMEOUT_MS = 2500;
const WATCHED_KEYS = new Set([KEYS.notices, KEYS.settings, KEYS.exams, KEYS.students, KEYS.transactions, KEYS.teaching]);
const WATCHED_COLLECTIONS = Object.freeze(['notices', 'settings', 'exams', 'students', 'transactions', 'teaching']);
/* Which records each person's notifications are built from. */
const NEEDS = Object.freeze({
  student: { students: true, transactions: true, exams: true, teaching: true },
  admin: { students: true },
  manager: { students: true, transactions: true, exams: true },
  teacher: { exams: true, students: true },
  payment: { transactions: true }
});
/* Where a tapped item goes when the payload does not name a view. */
const KIND_TARGET = Object.freeze({
  exam: 'exams', 'exam-soon': 'exams', 'exam-live': 'exams', result: 'exams', homework: 'courses', birthday: 'home', 'birthday-soon': 'students',
  notice: 'notice-board', broadcast: 'notice-board',
  approved: 'home', rejected: 'home',
  'payment-review': 'cash-counter', 'payment-rejected': 'home', 'exam-review': 'exams',
  'exam-returned': 'online-exams', 'exam-approved': 'online-exams'
});
const ACTION_KINDS = new Set(['exam', 'exam-soon', 'exam-live', 'homework', 'payment-rejected']);
const NOTICE_BOARD_KINDS = new Set(['notice', 'broadcast']);
const generalNotificationItems = items => viewer?.kind === 'student'
  ? items.filter(item => !NOTICE_BOARD_KINDS.has(item.kind))
  : items;
const generalNotificationRecords = records => viewer?.kind === 'student'
  ? records.filter(record => !NOTICE_BOARD_KINDS.has(record.type))
  : records;
const NAV_ATTRIBUTE = Object.freeze({
  student: 'data-view', manager: 'data-manager-view', teacher: 'data-teacher-view', admin: 'data-admin-view',
  /* The counter has its own five seats, so its notifications land on them. */
  payment: 'data-pay-section'
});
const MAX_TIMER_MS = 60 * 60 * 1000;
/* The part of each panel that appears only once its login is verified. A panel
   shows its own first view (dashboard/home) at that moment, so a tapped
   notification waits for it instead of being overwritten by it. */
const PANEL_SHELL = Object.freeze({
  student: '#appShell', manager: '#managerShell', teacher: '#teacherShell', admin: '#adminShell', payment: '#payShell'
});
const PANEL_READY_TIMEOUT_MS = 20000;
/* Rules versions prevent newly-added feed types from replaying old records as
   fresh. Time-critical exam reminders remain current across an upgrade. */
export const RULES_VERSION = 3;
export const RULES_KEY_PREFIX = 'activePlus.notifications.rules.v1:';
const V2_KINDS = new Set([
  'registration', 'approved', 'rejected', 'exam-soon', 'exam-live', 'payment',
  'payment-review', 'payment-rejected', 'exam-review', 'exam-returned', 'exam-approved'
]);
const V3_KINDS = new Set(['homework']);
let boundaryTimer = null;
/* Items waiting for the in-app card (shown once the panel is on screen). */
let alertQueue = [];

let controller = null;
let viewer = null;
let viewerKey = '';
let armed = false;

/* Notice Board receipts are separate from the bell, but they still suppress a
   later tray replay if notification delivery starts after the student marked
   the notice Read. */
function noticeBoardReadKeys() {
  const studentId = String(viewer?.studentId ?? '').trim();
  if (viewer?.kind !== 'student' || !studentId) return [];
  const key = NOTICE_BOARD_READ_PREFIX + encodeURIComponent(studentId);
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) || 'null');
    return Array.isArray(saved?.keys) ? saved.keys.filter(value => typeof value === 'string') : [];
  } catch { return []; }
}
let refreshTimer = null;
let armTimer = null;
let pill = null;
let pillDismiss = null;
let pillNote = '';
let pillNoteTimer = null;

/* ---- Who is using this device ---------------------------------------------- */

/* The shell in the DOM is the reliable signal (a rewritten URL still has it);
   the file name is the fallback for the moment before the body is parsed. */
const ROLE_MARKERS = Object.freeze([
  ['manager', '#managerShell'],
  ['teacher', '#teacherShell'],
  ['admin', '.admin-shell'],
  ['payment', '.pay-shell']
]);

function pageRole() {
  try {
    for (const [role, selector] of ROLE_MARKERS) {
      if (document.querySelector(selector)) return role;
    }
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    return ROLE_PAGES[page] || null;
  } catch { return null; }
}

/** The staff record on this device (plain JSON only — an encrypted envelope is
    not needed here, the role username is enough for addressing). */
function readStaffAccount(key) {
  const record = readJSON(key, null);
  return record && typeof record === 'object' && !Array.isArray(record) ? record : null;
}

export function currentViewer() {
  const role = pageRole();
  if (role) {
    const account = readStaffAccount(ROLE_ACCOUNT_KEYS[role]);
    const username = String(account?.username || ROLE_USERNAMES[role] || role);
    const assignedClasses = role === 'teacher'
      ? [...new Set(listTeacherAssignments(username).map(row => String(row.className || '').trim()).filter(Boolean))]
      : [];
    return {
      kind: 'staff',
      role,
      username,
      name: String(account?.fullName || ''),
      assignedClasses
    };
  }
  const account = loadAccount();
  const student = account?.student || {};
  const studentId = String(student.id || account?.studentId || '');
  return {
    kind: 'student',
    studentId,
    username: String(account?.username || student.username || ''),
    name: String(student.name || student.nameBn || ''),
    className: String(student.className || ''),
    group: String(student.group || ''),
    birthDate: String(student.birthDate || '')
  };
}

/* ---- Receipts ---------------------------------------------------------------- */

function readSeen() {
  const record = readJSON(SEEN_KEY_PREFIX + viewerKey, null);
  if (Array.isArray(record)) return record.filter(key => typeof key === 'string');
  return Array.isArray(record?.keys) ? record.keys.filter(key => typeof key === 'string') : [];
}

function writeSeen(keys) {
  // A receipt file that cannot be parsed is kept, never overwritten: the person
  // is told the read state is only for this session instead of silently losing
  // whatever was in there.
  try {
    const raw = window.localStorage.getItem(SEEN_KEY_PREFIX + viewerKey);
    if (raw !== null) JSON.parse(raw);
  } catch { return false; }
  return writeJSON(SEEN_KEY_PREFIX + viewerKey, seenRecord(keys));
}

/** When the "later" period ends — the stamp plus the quiet week. */
function promptHiddenUntil() {
  const stamp = Number(readJSON(PROMPT_HIDDEN_KEY, null)?.at) || 0;
  return stamp ? stamp + PROMPT_HIDE_MS : 0;
}

/* ---- Feed ------------------------------------------------------------------- */

function reviewsRegistrations() {
  return viewer?.kind === 'staff' && REGISTRATION_REVIEWERS.includes(viewer.role);
}

function readCleared() {
  const record = readJSON(CLEARED_KEY_PREFIX + viewerKey, null);
  return Array.isArray(record?.keys) ? record.keys.filter(key => typeof key === 'string') : [];
}

function needs() {
  return NEEDS[viewer?.kind === 'staff' ? viewer.role : 'student'] || {};
}

function safely(read) {
  try { return read(); } catch { return null; }
}

function rawFeed(cleared = null) {
  const want = needs();
  return notificationFeed({
    notices: loadNotices(),
    config: loadAppConfig(),
    examDb: want.exams ? readJSON(KEYS.exams, null) : null,
    teachingDb: want.teaching ? readJSON(KEYS.teaching, null) : null,
    students: want.students ? safely(loadRoster) : null,
    transactions: want.transactions ? safely(() => listDocuments('transactions')) : null,
    viewer,
    cleared,
    localWrites: readJSON(LOCAL_WRITE_KEY, null)
  });
}

/* Exam reminders and homework deadlines change with the clock, not just when
   sync writes data. Recheck at the next relevant boundary, capped hourly while
   the app is open and refreshed again when it becomes visible. */
function scheduleActionBoundary() {
  clearTimeout(boundaryTimer);
  if (!viewer) return;
  const now = Date.now();
  const boundaries = [];
  if (viewer.kind === 'student') {
    if (needs().exams) boundaries.push(nextExamBoundary(readJSON(KEYS.exams, null), viewer, now));
    if (needs().teaching) boundaries.push(nextHomeworkBoundary(readJSON(KEYS.teaching, null), viewer, now));
  }
  boundaries.push(nextBirthdayBoundary(now));
  const next = boundaries.filter(value => Number.isFinite(value) && value > now).sort((a, b) => a - b)[0];
  if (!next) return;
  const delay = Math.min(MAX_TIMER_MS, Math.max(1000, next - now + 500));
  boundaryTimer = setTimeout(() => refreshNotifications(), delay);
}

export function buildFeed() {
  return rawFeed(readCleared());
}

/**
 * Empty the list: the given keys, or everything currently shown. Cleared items
 * are also marked seen, so they never come back as a system notification.
 */
export function clearNotifications(keys = null) {
  const all = rawFeed(null).map(item => item.key);
  const target = Array.isArray(keys) ? keys : generalNotificationItems(buildFeed()).map(item => item.key);
  const saved = writeJSON(CLEARED_KEY_PREFIX + viewerKey, clearedRecord([...readCleared(), ...target], all));
  writeSeen([...new Set([...readSeen(), ...target])]);
  window.dispatchEvent(new CustomEvent('apc-notifications-updated', { detail: { cleared: target.length, saved } }));
  return { cleared: target.length, saved };
}

/** Put one cleared item back (e.g. "পরে দেখব" on a registration review). */
export function restoreNotification(key) {
  const all = rawFeed(null).map(item => item.key);
  const keys = readCleared().filter(item => item !== key);
  writeJSON(CLEARED_KEY_PREFIX + viewerKey, clearedRecord(keys, all));
  window.dispatchEvent(new CustomEvent('apc-notifications-updated', { detail: { restored: key } }));
}

/**
 * Open a registration for review from a notification (inbox or tray). The item
 * is cleared as soon as it has been looked at; "পরে দেখব" puts it back, and a
 * decision removes it for good (the student is no longer pending anywhere).
 */
export async function openRegistration(studentId) {
  const id = String(studentId || '').trim();
  if (!id || !reviewsRegistrations()) return false;
  if (!(await whenPanelReady())) return false;
  const key = `registration:${id}`;
  clearNotifications([key]);
  try {
    const module = await import('./registration-review.js');
    const opened = await module.openRegistrationReview(id, {
      role: viewer.role,
      onLater: () => restoreNotification(key),
      onDone: () => scheduleRefresh()
    });
    if (!opened) restoreNotification(key);
    return opened;
  } catch (error) {
    console.warn('[Active Plus] registration review unavailable:', error?.name || 'unknown');
    restoreNotification(key);
    return false;
  }
}

function panelVisible() {
  const shell = document.querySelector(PANEL_SHELL[viewer?.kind === 'staff' ? viewer.role : 'student'] || '');
  return Boolean(shell && !shell.hidden);
}

/** Resolves once the signed-in panel is on screen (false if it never shows). */
export async function whenPanelReady(timeout = PANEL_READY_TIMEOUT_MS) {
  if (panelVisible()) return true;
  const started = Date.now();
  while (!panelVisible()) {
    if (Date.now() - started > timeout) return false;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Let the panel finish its own first render (same task as un-hiding).
  await new Promise(resolve => setTimeout(resolve, 50));
  return true;
}

/* ---- In-app card: new notifications shown inside the app -------------------- */

function readInApp() {
  const record = readJSON(INAPP_KEY_PREFIX + viewerKey, null);
  return Array.isArray(record?.keys) ? record.keys.filter(key => typeof key === 'string') : null;
}

function writeInApp(keys) {
  return writeJSON(INAPP_KEY_PREFIX + viewerKey, { version: 1, at: Date.now(), keys });
}

/* Reading an item in the inbox is also an acknowledgement for the in-app
   popup. Keep that receipt alongside the read record so a message that was
   already read cannot reappear as "new" on the next login. */
function markInAppHandled(keys) {
  const handled = new Set((Array.isArray(keys) ? keys : [keys]).filter(key => typeof key === 'string' && key));
  if (!handled.size) return;
  const stored = readInApp();
  const baseline = stored === null ? buildFeed().map(item => item.key) : stored;
  writeInApp([...new Set([...baseline, ...handled])]);
  alertQueue = alertQueue.filter(item => item.preview || !handled.has(item.key));
}

function readRecordKeys() {
  return new Set(listNotifications(viewerKey)
    .filter(record => record.read === true)
    .map(record => record.key)
    .filter(key => typeof key === 'string' && key));
}

function queueInAppAlerts(feed, full) {
  const stored = readInApp();
  const read = readRecordKeys();
  const eligible = feed.filter(item => !read.has(item.key));
  // A read decision can race with an alert that has not reached the screen yet.
  alertQueue = alertQueue.filter(item => item.preview || !read.has(item.key));
  const queued = alertQueue.filter(item => !item.preview).map(item => item.key);
  const plan = planInAppAlerts({
    feed: eligible, known: full, initialise: stored === null,
    shown: stored === null ? null : [...stored, ...queued]
  });
  // Queued keys are not receipts yet: only the stored ones are kept (pruned).
  const known = new Set(full.map(item => item.key));
  const previous = stored === null ? plan.record : stored.filter(key => known.has(key));
  writeInApp([...new Set([...previous, ...[...read].filter(key => known.has(key))])]);
  const visible = new Set(eligible.map(item => item.key));
  const fresh = plan.show.filter(item => !queued.includes(item.key));
  alertQueue = [...fresh, ...alertQueue.filter(item => item.preview || visible.has(item.key))];
  if (alertQueue.length) window.dispatchEvent(new CustomEvent('apc-inapp-alerts', { detail: { count: alertQueue.length } }));
}

/**
 * The card takes the waiting items when it can really show them; only then do
 * they count as shown (a lock screen or reload in between loses nothing).
 */
export function takeInAppAlerts() {
  if (!viewer || !alertQueue.length) return [];
  const current = new Map(buildFeed().map(item => [item.key, item]));
  const read = readRecordKeys();
  // A sample the person asked for has no feed item behind it; a real item that
  // was marked read while waiting must not be shown on the next login.
  const items = alertQueue
    .map(item => current.get(item.key) || (item.preview ? item : null))
    .filter(item => item && (item.preview || !read.has(item.key)));
  alertQueue = [];
  if (items.length) writeInApp([...new Set([...(readInApp() || []), ...items.map(item => item.key)])]);
  return items;
}

/** Open the panel view a notification belongs to (bottom-bar button). */
function navigateTo(target) {
  const attribute = NAV_ATTRIBUTE[viewer?.kind === 'staff' ? viewer.role : 'student'];
  if (!attribute || !target) return false;
  const button = [...document.querySelectorAll(`[${attribute}]`)].find(item => item.getAttribute(attribute) === target);
  if (button) { button.click(); return true; }
  /* Legacy seats (the Cash Counter review queue is a segment of হিসাব now) have
     no button of their own: the panel that owns the alias routes it. */
  const routed = new CustomEvent('apc-notice-route', { detail: { target }, cancelable: true });
  window.dispatchEvent(routed);
  return routed.defaultPrevented;
}

/**
 * A tapped notification (inbox or tray). A registration opens its review
 * dialog; every other item opens its view. Either way the item has now been
 * seen, so it is cleared from the list.
 */
export function openNotificationTarget(data) {
  const key = String(data?.key || '');
  if (data?.kind === 'registration' || key.startsWith('registration:')) {
    return openRegistration(data.id || key.slice('registration:'.length));
  }
  const kind = String(data?.kind || '');
  const sourceId = String(data?.id || data?.sourceId || '');
  const item = rawFeed(null).find(entry => key
    ? entry.key === key
    : sourceId && entry.sourceId === sourceId && entry.kind === kind) || null;
  const isBoardItem = NOTICE_BOARD_KINDS.has(kind);
  const target = isBoardItem
    ? (viewer?.kind === 'student' ? 'notice-board' : 'home')
    : data?.target || item?.target || KIND_TARGET[kind] || '';
  const action = item?.action || data?.action || 'open';
  if (key && item && !(isBoardItem && viewer?.kind === 'student')) {
    clearNotifications([key]);
    writeSeen([...new Set([...readSeen(), key])]);
    markRead(viewerKey, [key]);
    markInAppHandled([key]);
    publish({ read: 1, opened: key });
  }
  const openTarget = () => {
    const opened = navigateTo(target);
    /* ফলাফল is a tab of the পরীক্ষা section (docs/APP-ARCHITECTURE.md §3), so a
       result notification lands on that tab instead of a view of its own. */
    if (opened && kind === 'result') document.querySelector('#examTabs [data-exam-tab="results"]')?.click();
    if (opened && isBoardItem && viewer?.kind === 'student') {
      window.dispatchEvent(new CustomEvent('apc-notice-open', {
        detail: { kind, id: sourceId, key }
      }));
    } else if (opened && ACTION_KINDS.has(kind) && sourceId) {
      window.dispatchEvent(new CustomEvent('apc-notification-action', {
        detail: { kind, id: sourceId, action, target }
      }));
    }
    return opened;
  };
  if (panelVisible()) return Promise.resolve(openTarget());
  // Tapped in the tray while the app was starting: go there once it is open.
  return whenPanelReady().then(ready => ready && openTarget());
}

async function takePendingClick() {
  try {
    if (!('caches' in window)) return null;
    const cache = await caches.open(PANEL_HINT_CACHE);
    const response = await cache.match(PENDING_CLICK_PATH);
    if (!response) return null;
    await cache.delete(PENDING_CLICK_PATH);
    const record = JSON.parse(await response.text());
    if (!record || Date.now() - Number(record.at) > PENDING_CLICK_MAX_AGE_MS) return null;
    return record.data || null;
  } catch { return null; }
}

function watchNotificationClicks() {
  try {
    navigator.serviceWorker?.addEventListener?.('message', event => {
      if (event.data?.type === 'apc-notification-click') void openNotificationTarget(event.data.data);
    });
  } catch { /* no service worker: the inbox still works */ }
  // The panel restores its session asynchronously; give it a moment first.
  setTimeout(async () => {
    const data = await takePendingClick();
    if (data) void openNotificationTarget(data);
  }, 800);
}

/** The receipt keys this device already knows about (inbox + tray agree). */
export function seenKeys() {
  return readSeen();
}

/** Everything in the feed is read: used when the inbox is opened. */
export function markAllSeen() {
  const feed = generalNotificationItems(buildFeed());
  const keys = [...new Set([...readSeen(), ...feed.map(item => item.key)])];
  const saved = writeSeen(keys);
  window.dispatchEvent(new CustomEvent('apc-notifications-updated', { detail: { read: keys.length, saved } }));
  return { count: keys.length, saved };
}

/* The person's own switches (Settings → Notification Settings) sit on top of
   the app-wide config: both have to allow a notification before it is shown. */
function userSettings() {
  try { return notificationSettings(viewerKey); } catch { return { ...NOTIFICATION_FALLBACK }; }
}
const NOTIFICATION_FALLBACK = Object.freeze({ enabled: true, sound: true, background: true, inApp: true });

function notificationsEnabled() {
  try { if (loadAppConfig().pushNotifications === false) return false; } catch { /* config unreadable */ }
  return userSettings().enabled !== false;
}

/** Only the system/tray half is switchable by the background switch. */
function systemNotificationsEnabled() {
  return notificationsEnabled() && userSettings().background !== false;
}

/** The card inside the app, which needs no phone permission at all. */
function inAppNotificationsEnabled() {
  return notificationsEnabled() && userSettings().inApp !== false;
}

function permission() {
  try {
    if (!('Notification' in window)) return 'unsupported';
    return window.Notification.permission || 'default';
  } catch { return 'unsupported'; }
}

/* ---- System notification ----------------------------------------------------- */

async function serviceWorkerRegistration() {
  try {
    if (!('serviceWorker' in navigator)) return null;
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS));
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } catch { return null; }
}

function notificationOptions(payload, supportsActions = false) {
  const options = {
    body: payload.body,
    icon: './assets/icons/icon-192.png',
    tag: payload.tag,
    data: payload.data
  };
  if (supportsActions && payload.actionLabel) {
    options.actions = [{ action: 'open', title: payload.actionLabel.slice(0, 32) }];
  }
  return options;
}

/** Android Chrome refuses `new Notification(...)`; the service worker is the
    supported path there. Service-worker notifications can also carry a button
    that opens the same focused action as the in-app Action Center. */
async function showSystemNotification(payload) {
  const registration = await serviceWorkerRegistration();
  if (registration && typeof registration.showNotification === 'function') {
    return registration.showNotification(payload.title, notificationOptions(payload, true));
  }
  return new window.Notification(payload.title, notificationOptions(payload));
}

function deliver(item) {
  const { claim, record } = claimDelivery(readJSON(SHOWN_KEY, null), item.key || item.sourceId);
  writeJSON(SHOWN_KEY, record);
  if (!claim) return;                      // the push already showed this one
  const payload = pushPayload(item);
  Promise.resolve()
    .then(() => showSystemNotification(payload))
    .then(() => markDelivered(viewerKey, [item.key]))
    .catch(error => console.warn('[Active Plus] notification not shown:', error?.name || 'unknown'));
  window.dispatchEvent(new CustomEvent('apc-notification', { detail: item }));
}

/* ---- Sound ------------------------------------------------------------------- */

/* A two-note chime, built with the Web Audio API (no asset, no network). The
   browser may refuse before the first tap on the page; that is expected and the
   card still shows. */
function playTone() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const context = new Ctx();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.05;
    oscillator.connect(gain).connect(context.destination);
    const now = context.currentTime;
    oscillator.start(now);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    oscillator.stop(now + 0.36);
    oscillator.addEventListener('ended', () => { try { context.close(); } catch { /* already closed */ } });
    return true;
  } catch { return false; }
}

/* ---- Refresh loop ------------------------------------------------------------ */

export function refreshNotifications() {
  if (!viewer) return { delivered: 0 };
  // Receipts are kept for the whole feed, cleared items included: an item put
  // back with "পরে দেখব" must not be announced a second time.
  const cleared = new Set(readCleared());
  const full = rawFeed(null);
  const feed = full.filter(item => !cleared.has(item.key));
  // While the device is not "armed" (see below) the list is only recorded, so a
  // fresh install or a half-finished cloud load cannot fire old news.
  // What this device already knew BEFORE this refresh: the receipts are read
  // state, so an item delivered for the first time now must stay unread.
  const receiptsBefore = readSeen();
  const boardReadReceipts = noticeBoardReadKeys();
  const boardRead = new Set(boardReadReceipts);
  const plan = planDeliveries({ feed: full, seen: receiptsBefore, firstRun: !armed });
  plan.notify = plan.notify.filter(item => !cleared.has(item.key) && !boardRead.has(item.key));
  const rulesVersion = Number(readJSON(RULES_KEY_PREFIX + viewerKey, null)?.version) || 1;
  if (rulesVersion < 2) {
    // Time-based exam reminders are always current, so they may still ring.
    plan.notify = plan.notify.filter(item => !V2_KINDS.has(item.kind) || item.kind === 'exam-soon' || item.kind === 'exam-live');
  }
  let upgradeRead = [];
  if (rulesVersion < 3) {
    // Homework reminders are new: don't treat assignments already on the
    // device as fresh news during the upgrade, either in the tray or popup.
    plan.notify = plan.notify.filter(item => !V3_KINDS.has(item.kind));
    upgradeRead = full.filter(item => V3_KINDS.has(item.kind)).map(item => item.key);
    const inApp = readInApp();
    if (inApp !== null) {
      writeInApp([...new Set([...inApp, ...upgradeRead])]);
    }
  }
  if (rulesVersion < RULES_VERSION && armed) {
    writeJSON(RULES_KEY_PREFIX + viewerKey, { version: RULES_VERSION, at: Date.now() });
  }
  writeSeen(plan.seen);
  // Every item this device knows about now has a record (id NOTIF-YYYYMMDD-0001).
  // Items the engine had already announced are stored as read: updating the app
  // never turns yesterday's news into unread notifications.
  try {
    syncNotifications({ userId: viewerKey, feed: full, legacyRead: [...receiptsBefore, ...cleared, ...upgradeRead, ...boardReadReceipts] });
  } catch (error) {
    console.warn('[Active Plus] notification records unavailable:', error?.name || 'unknown');
  }
  // The in-app card needs no phone permission (owner decision 2026-09-30).
  if (armed && inAppNotificationsEnabled()) queueInAppAlerts(generalNotificationItems(feed), generalNotificationItems(full));
  let delivered = 0;
  if (armed && systemNotificationsEnabled() && permission() === 'granted') {
    for (const item of plan.notify) { deliver(item); delivered += 1; }
  }
  paintPill();
  scheduleActionBoundary();
  window.dispatchEvent(new CustomEvent('apc-notifications-updated', { detail: { delivered } }));
  return { delivered, feed };
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshNotifications(), REFRESH_DEBOUNCE_MS);
}

/**
 * A brand-new device waits for the first cloud load before it announces
 * anything; a device that already holds data starts immediately. The fallback
 * timer arms the engine even if the sync never reports a status.
 */
function armWhenReady() {
  if (armed) return;
  armed = true;
  clearTimeout(armTimer);
  scheduleRefresh();
}

function watchSyncStatus(event) {
  const state = event?.detail?.state || document.documentElement.dataset.realtimeSync;
  if (state && state !== 'connecting') armWhenReady();
}

/* ---- Permission UI ----------------------------------------------------------- */

function paintPill() {
  if (!pill || !pill.isConnected) return;
  const state = permission();
  const setVisible = visible => {
    pill.hidden = !visible;
    if (pillDismiss) pillDismiss.hidden = !visible;
  };
  if (pillNote) {
    pill.hidden = false;
    if (pillDismiss) pillDismiss.hidden = true;
    pill.textContent = pillNote;
    return;
  }
  if (state === 'granted') return setVisible(false);
  if (!notificationsEnabled()) return setVisible(false);
  if (state === 'unsupported') return setVisible(false);
  if (state === 'default' && Date.now() < promptHiddenUntil()) return setVisible(false);
  setVisible(true);
  pill.textContent = state === 'denied'
    ? 'নোটিফিকেশন বন্ধ — চালু করার নিয়ম'
    : 'নোটিফিকেশন চালু করুন';
}

function noteThenHide(message, ms = 5000) {
  pillNote = message;
  clearTimeout(pillNoteTimer);
  paintPill();
  pillNoteTimer = setTimeout(() => { pillNote = ''; paintPill(); }, ms);
}

function mountPill() {
  if (pill || !document.body) return;
  const bar = document.createElement('div');
  bar.id = 'apcNotifyBar';
  pill = document.createElement('button');
  pill.type = 'button';
  pill.id = 'apcNotifyToggle';
  pill.setAttribute('aria-live', 'polite');
  // A one-time decision is allowed: the nudge can be put away for a week.
  pillDismiss = document.createElement('button');
  pillDismiss.type = 'button';
  pillDismiss.id = 'apcNotifyDismiss';
  pillDismiss.setAttribute('aria-label', 'নোটিফিকেশনের কথা পরে দেখাব');
  pillDismiss.textContent = '×';
  pillDismiss.addEventListener('click', () => {
    writeJSON(PROMPT_HIDDEN_KEY, { version: 1, at: Date.now() });
    paintPill();
  });
  pill.hidden = true;
  pill.addEventListener('click', () => {
    if (pillNote) { pillNote = ''; paintPill(); return; }
    if (permission() === 'denied') { explainOff('denied'); return; }
    if (permission() === 'unsupported') { explainOff('unsupported'); return; }
    void enableNotifications();
  });
  bar.append(pill, pillDismiss);
  mountStatusNotice(bar);
  paintPill();
}

/* ---- Enable / disable -------------------------------------------------------- */

async function registerPushTransport({ ask = false } = {}) {
  try {
    const module = await import('./push-notifications.js');
    return ask ? module.enablePush({ viewer }) : module.syncPushRegistration({ viewer });
  } catch (error) {
    console.warn('[Active Plus] push transport unavailable:', error?.name || 'unknown');
    return { ok: false, status: 'unavailable' };
  }
}

export async function enableNotifications() {
  try {
    if (!('Notification' in window)) {
      if (!explainOff('unsupported')) noteThenHide('এই ব্রাউজারে সিস্টেম নোটিফিকেশন নেই।');
      return { ok: false, status: 'unsupported' };
    }
    const permission = await window.Notification.requestPermission();
    if (permission !== 'granted') {
      pillNote = permission === 'denied'
        ? 'অনুমতি দেওয়া হয়নি — ব্রাউজার সেটিংস থেকে নোটিফিকেশন চালু করুন।'
        : '';
      paintPill();
      return { ok: false, status: permission };
    }
    writeJSON(PROMPT_HIDDEN_KEY, { version: 1, at: 0 });
    const result = await registerPushTransport({ ask: true });
    noteThenHide(result?.status === 'registered'
      ? '✅ নোটিফিকেশন চালু হয়েছে — অ্যাপ বন্ধ থাকলেও নোটিশ পাবেন।'
      : '✅ নোটিফিকেশন চালু হয়েছে (এই ডিভাইসেই দেখাবে)।');
    refreshNotifications();
    return { ok: true, status: result?.status || 'granted' };
  } catch (error) {
    console.warn('[Active Plus] notification permission failed:', error?.name || 'unknown');
    return { ok: false, status: 'error' };
  }
}

export async function disableNotifications() {
  try {
    const module = await import('./push-notifications.js');
    const result = await module.disablePush({ viewer });
    if (!explainOff('disabled')) noteThenHide('নোটিফিকেশন বন্ধ করা হয়েছে।');
    return result;
  } catch {
    return { ok: false, status: 'unavailable' };
  }
}

/* ---- Mount ------------------------------------------------------------------- */

/** The bell and its inbox. Optional: if this import fails, notifications still
    arrive in the tray and the pill still works. */
let noticeCenter = null;

function mountNoticeCenter() {
  import('./notice-center.js')
    .then(module => { noticeCenter = module.mountNoticeCenter(controller); })
    .catch(error => console.warn('[Active Plus] notification inbox unavailable:', error?.name || 'unknown'));
}

/** The popup that explains an off switch: same sheet as a fresh notification,
    with ক্যান্সেল / বুঝেছি, over the blurred backdrop. Falls back to the bar
    note when the inbox module has not loaded (it is optional on purpose). */
function explainOff(kind) {
  if (noticeCenter && typeof noticeCenter.showInfo === 'function' && noticeCenter.showInfo(kind)) return true;
  pillNote = kind === 'unsupported'
    ? 'এই ব্রাউজারে সিস্টেম নোটিফিকেশন নেই — নোটিশ তবুও এই তালিকায় জমা হবে।'
    : kind === 'disabled'
      ? 'নোটিফিকেশন বন্ধ করা হয়েছে।'
      : 'ব্রাউজার সেটিংসে এই সাইটের নোটিফিকেশন ব্লক করা আছে — Chrome/Safari সেটিংস থেকে অনুমতি দিন।';
  paintPill();
  return false;
}



/* A settings change or a read decision is visible everywhere at once. */
function publish(detail = {}) {
  try { window.dispatchEvent(new CustomEvent('apc-notifications-updated', { detail })); } catch { /* headless */ }
}

/** One sample card, requested from Settings → Notification Settings. */
function previewNotification() {
  const item = {
    key: `preview:${Date.now()}`,
    source: 'settings',
    sourceId: 'preview',
    kind: 'notice',
    title: 'নোটিফিকেশন প্রিভিউ',
    body: 'নতুন নোটিশ, পরীক্ষা ও ফলাফলের খবর ঠিক এভাবেই দেখতে পাবেন।',
    at: Date.now(),
    audience: 'সকল'
  };
  // A preview is asked for by hand, so it shows even with the in-app switch
  // off: it is the sample, not a delivery. The tray sample still follows the
  // permission and the background switch.
  if (window.apcNoticeCenter?.showPreview) window.apcNoticeCenter.showPreview(item);
  else {
    alertQueue = [{ ...item, preview: true }, ...alertQueue];
    publish({ preview: true });
    window.dispatchEvent(new CustomEvent('apc-inapp-alerts', { detail: { count: alertQueue.length } }));
  }
  if (systemNotificationsEnabled() && permission() === 'granted') {
    const payload = pushPayload(item);
    void Promise.resolve()
      .then(() => showSystemNotification(payload))
      .catch(error => console.warn('[Active Plus] preview notification not shown:', error?.name || 'unknown'));
  }
  return item;
}

export function initNotifications() {
  if (controller) return controller;
  try {
    viewer = currentViewer();
    viewerKey = viewerKeyOf(viewer);
    const firstRun = !Number(readJSON(BOOT_KEY_PREFIX + viewerKey, null)?.at);
    if (firstRun) {
      writeJSON(BOOT_KEY_PREFIX + viewerKey, { version: 1, at: Date.now() });
      writeJSON(RULES_KEY_PREFIX + viewerKey, { version: RULES_VERSION, at: Date.now() });
    }
    armed = !firstRun;                       // a device with data notifies at once
    // Permission remains available in the notice inbox; no unsolicited banner.
    const register = () => { refreshNotifications(); };
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', register, { once: true });
    else register();
    if (!armed) {
      window.addEventListener('apc-sync-status', watchSyncStatus);
      armTimer = setTimeout(armWhenReady, ARM_FALLBACK_MS);
      watchSyncStatus();
    }
    window.addEventListener('storage', event => {
      if (!event.key || WATCHED_KEYS.has(event.key)) scheduleRefresh();
    });
    window.addEventListener('apc-sync-updated', event => {
      const collection = event.detail?.collection;
      if (!collection || WATCHED_COLLECTIONS.includes(collection)) scheduleRefresh();
    });
    // Same-window data writes do not emit native storage events.
    window.addEventListener('apc-registration-decided', scheduleRefresh);
    window.addEventListener('teaching-data-updated', scheduleRefresh);
    watchNotificationClicks();
    window.addEventListener('apc-sync-status', () => { if (!armed) return; paintPill(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && armed) refreshNotifications();
    });
    if (permission() === 'granted') void registerPushTransport();
    // The card has arrived: play the person's tone when they asked for one.
    window.addEventListener('apc-inapp-alerts', () => {
      if (!viewer || !inAppNotificationsEnabled() || userSettings().sound === false) return;
      playTone();
    });
    controller = {
      refresh: refreshNotifications,
      unread: () => generalNotificationRecords(unreadNotifications(viewerKey)).length,
      unreadKeys: () => generalNotificationRecords(unreadNotifications(viewerKey)).map(record => record.key),
      records: () => generalNotificationRecords(listNotifications(viewerKey)),
      markRead: keys => {
        const list = [...new Set((Array.isArray(keys) ? keys : [keys]).map(key => String(key || '')).filter(Boolean))];
        if (!list.length) return 0;
        // Both stores move together: the record holds the unread state and the
        // receipt stops the tray from announcing the item a second time.
        writeSeen([...new Set([...readSeen(), ...list])]);
        const changed = markRead(viewerKey, list);
        markInAppHandled(list);
        publish();
        return changed;
      },
      markAllRead: () => {
        const unreadKeys = generalNotificationRecords(unreadNotifications(viewerKey)).map(record => record.key);
        markAllSeen();
        const changed = markRead(viewerKey, unreadKeys);
        markInAppHandled(unreadKeys);
        publish();
        return changed;
      },
      settings: () => userSettings(),
      saveSettings: patch => {
        const next = saveNotificationSettings(viewerKey, patch);
        if (next.enabled === false) pillNote = '';
        paintPill();
        if (next.enabled && next.background && permission() === 'granted') void registerPushTransport();
        if (next.enabled) scheduleRefresh();
        return next;
      },
      preview: () => previewNotification(),
      playTone,
      feed: () => generalNotificationItems(buildFeed()),
      seen: seenKeys,
      markAllSeen,
      clear: clearNotifications,
      restore: restoreNotification,
      takeAlerts: takeInAppAlerts,
      whenReady: () => whenPanelReady(),
      openItem: item => openNotificationTarget({ kind: item?.kind, id: item?.sourceId, key: item?.key, target: item?.target }),
      enable: enableNotifications,
      disable: disableNotifications,
      pushSupport: async () => (await import('./push-notifications.js')).pushSupport(),
      viewer: () => ({ ...viewer }),
      viewerKey: () => viewerKey,
      armed: () => armed,
      permission,
      deviceId: getDeviceId
    };
    window.apcNotifications = controller;
    // The bell/inbox needs the controller, so it is mounted after it exists.
    if (document.body) mountNoticeCenter();
    else window.addEventListener('DOMContentLoaded', mountNoticeCenter, { once: true });
    return controller;
  } catch (error) {
    console.warn('[Active Plus] notification centre failed to start:', error?.name || 'unknown');
    return null;
  }
}
