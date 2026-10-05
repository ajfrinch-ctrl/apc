/* Panel lockdown — one device, one panel, one door.

   Every role owns exactly one page: admin.html, manager.html, teacher.html and
   payment.html. Those four pages must never reach each other. A cross-panel
   route is both a permission hole (a role holds no capability of the other
   portal) and a real-world mistake (the counter tapping into the Admin panel
   while a guardian is watching).

   This module is the single place that knows the four file names:
     • installPanelGuard() stops a click, a form submit or a window.open that
       points at a *different* panel page, so a stray link can never open one.
     • showPanelLock() is what a panel shows instead of jumping away when its
       own session is missing, or when another role is signed in on the device.
     • watchOwnPanelSession() locks the page the moment its own session is gone
       (someone signed another panel in on this device, or it expired).
     • rememberPanelPage() leaves a hint so a tapped notification opens the
       device's own panel instead of a hard-coded page.

   The shared login page (index.html) is the only door between panels: every
   role signs in there, and only the role that signed in gets its own page. */

import { activeStaffRoles, clearStaffSession, hasStaffSession } from './staff-auth.js';

export const LOGIN_PAGE = 'index.html';
export const PANEL_PAGES = Object.freeze(['admin.html', 'manager.html', 'teacher.html', 'payment.html']);
export const PANEL_LABELS = Object.freeze({
  'admin.html': 'এডমিন প্যানেল',
  'manager.html': 'ম্যানেজার প্যানেল',
  'teacher.html': 'শিক্ষক প্যানেল',
  'payment.html': 'পেমেন্ট রিসিভ প্যানেল'
});
export const PANEL_BY_ROLE = Object.freeze({
  admin: 'admin.html', manager: 'manager.html', teacher: 'teacher.html', payment: 'payment.html'
});
const PANEL_SHELLS = Object.freeze({
  'admin.html': 'adminShell',
  'manager.html': 'managerShell',
  'teacher.html': 'teacherShell',
  'payment.html': 'payShell'
});
/** Sticky bars that live outside the shell and must go too. */
const PANEL_EXTRAS = Object.freeze(['payStickyBar']);

/** Panel pages are picked up from the DOM first (a rewritten URL still has the
    shell) and from the file name otherwise — the same rule the notification
    centre uses to decide who is using this device. */
const ROLE_MARKERS = Object.freeze([
  ['manager.html', '#managerShell'],
  ['teacher.html', '#teacherShell'],
  ['admin.html', '.admin-shell'],
  ['payment.html', '.pay-shell']
]);

export const LOCK_CARD_ID = 'apcPanelLock';
export const GUARD_NOTICE_ID = 'apcPanelGuardNotice';
export const PANEL_HINT_CACHE = 'apc-panel-hint';
export const PANEL_HINT_PATH = './__apc-last-panel';

let noticeTimer = null;
let sessionWatch = null;

/** The file name a value points at, lower-cased, without query or hash. */
function fileNameOf(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(raw)) return '';
  const withoutQuery = raw.split('#')[0].split('?')[0];
  return withoutQuery.replace(/\\/g, '/').split('/').pop().toLowerCase();
}

/** The panel page the current document is, or '' when this is not a panel. */
export function ownPanelPage(doc = globalThis.document, loc = globalThis.location) {
  try {
    for (const [file, selector] of ROLE_MARKERS) {
      if (doc?.querySelector?.(selector)) return file;
    }
    const file = fileNameOf(loc?.pathname || '');
    return PANEL_PAGES.includes(file) ? file : '';
  } catch { return ''; }
}

/**
 * The *other* panel a link, form action or window target points at.
 * Returns '' for this page itself, for non-panel files (index.html is the one
 * shared door and is allowed) and for anything outside the app.
 */
export function panelFileOf(value, own = ownPanelPage()) {
  const file = fileNameOf(value);
  if (!file || !PANEL_PAGES.includes(file)) return '';
  return file === own ? '' : file;
}

function lockNotice(message) {
  if (typeof document === 'undefined') return;
  let box = document.getElementById(GUARD_NOTICE_ID);
  if (!box) {
    box = document.createElement('div');
    box.id = GUARD_NOTICE_ID;
    box.className = 'apc-lock-notice';
    box.setAttribute('role', 'status');
    (document.body || document.documentElement).append(box);
  }
  box.textContent = message;
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { if (box) box.hidden = true; }, 6000);
}

function blockMessage(file) {
  const label = PANEL_LABELS[file] || 'অন্য প্যানেল';
  return `এক প্যানেল থেকে অন্য প্যানেলে যাওয়া বন্ধ — ${label} নিজের লগইন দিয়েই খোলে।`;
}

/**
 * Close every in-page route into another panel. The markup already ships no
 * cross-panel link (tests/panel-isolation.test.mjs), so this is the second
 * line: a link, a form or a window.open added by a later edit still cannot
 * take the person out of this panel.
 *
 * Returns a handle for tests: `blocked` lists the pages it refused.
 */
export function installPanelGuard({ own = ownPanelPage(), notify } = {}) {
  const blocked = [];
  const refuse = file => {
    blocked.push(file);
    if (typeof notify === 'function') notify(file);
    else lockNotice(blockMessage(file));
  };
  const uninstall = () => {};
  if (!own || typeof document === 'undefined') return { own, blocked, uninstall };

  const onClick = event => {
    const anchor = event.target?.closest?.('a[href], area[href]');
    if (!anchor) return;
    const foreign = panelFileOf(anchor.getAttribute('href'), own);
    if (!foreign) return;
    event.preventDefault();
    event.stopPropagation();
    refuse(foreign);
  };
  const onSubmit = event => {
    const foreign = panelFileOf(event.target?.getAttribute?.('action'), own);
    if (!foreign) return;
    event.preventDefault();
    refuse(foreign);
  };
  const originalOpen = typeof window !== 'undefined' ? window.open : null;

  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
  if (typeof window !== 'undefined' && typeof originalOpen === 'function') {
    window.open = function open(url, ...rest) {
      const foreign = panelFileOf(url, own);
      if (foreign) { refuse(foreign); return null; }
      return originalOpen.call(window, url, ...rest);
    };
  }

  return {
    own,
    blocked,
    uninstall() {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      if (typeof window !== 'undefined' && typeof originalOpen === 'function') window.open = originalOpen;
    }
  };
}

function panelLine(signedIn) {
  const labels = (Array.isArray(signedIn) ? signedIn : [])
    .map(file => PANEL_LABELS[file] || file)
    .filter(Boolean);
  if (!labels.length) return '';
  /* No logout step is asked for: the shared login page switches this device as
     soon as the other panel's own username and password are typed there. */
  return `এই ডিভাইসে এখন ${labels.join(', ')} লগইন করা আছে — প্যানেল বদলাতে লগইন পেজে গিয়ে সেই প্যানেলের ইউজারনেম ও পাসওয়ার্ড দিন।`;
}

/**
 * The screen a panel shows in place of its own content. It never links to
 * another panel: the only ways out are the shared login page and a reload.
 * Calling it twice reuses the same card.
 */
export function showPanelLock({ role = ownPanelPage(), reason = '', signedIn = [] } = {}) {
  if (typeof document === 'undefined') return null;
  const file = PANEL_PAGES.includes(String(role)) ? String(role) : ownPanelPage();
  const label = PANEL_LABELS[file] || 'এই প্যানেল';
  for (const shellId of Object.values(PANEL_SHELLS)) {
    const shell = document.getElementById(shellId);
    if (shell) shell.hidden = true;
  }
  for (const extraId of PANEL_EXTRAS) {
    const extra = document.getElementById(extraId);
    if (extra) extra.hidden = true;
  }

  let card = document.getElementById(LOCK_CARD_ID);
  if (!card) {
    card = document.createElement('section');
    card.id = LOCK_CARD_ID;
    card.className = 'apc-lock-card';
    card.setAttribute('role', 'alert');
    (document.body || document.documentElement).append(card);
  }
  card.replaceChildren();

  const eyebrow = document.createElement('p');
  eyebrow.className = 'apc-lock-eyebrow';
  eyebrow.textContent = 'এক প্যানেল থেকে অন্য প্যানেলে নয়';

  const title = document.createElement('h1');
  title.textContent = 'এই প্যানেল খোলা হয়নি';

  const copy = document.createElement('p');
  copy.textContent = String(reason || '').trim() || `${label} শুধু নিজের ইউজারনেম ও পাসওয়ার্ড দিয়ে খোলে।`;

  card.append(eyebrow, title, copy);

  const other = panelLine(signedIn);
  if (other) {
    const line = document.createElement('p');
    line.className = 'apc-lock-note';
    line.textContent = other;
    card.append(line);
  }

  const rule = document.createElement('p');
  rule.className = 'apc-lock-note';
  rule.textContent = 'নিয়ম: এক ডিভাইসে এক সময়ে একটি প্যানেল — লগইন সবসময় মিলিত লগইন পেজ থেকেই।';
  card.append(rule);

  const actions = document.createElement('div');
  actions.className = 'apc-lock-actions';
  const login = document.createElement('button');
  login.type = 'button';
  login.id = 'apcPanelLockLogin';
  login.className = 'apc-lock-primary';
  login.textContent = 'লগইন পেজে যান';
  login.addEventListener('click', () => { window.location.assign(LOGIN_PAGE); });
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.id = 'apcPanelLockRetry';
  retry.textContent = 'আবার চেষ্টা করুন';
  retry.addEventListener('click', () => { window.location.reload(); });
  actions.append(login, retry);
  card.append(actions);
  return card;
}

/** Lock this page the moment its own session is gone (another panel signed in
    on this device, a cleared browser or an expiry). */
export function watchOwnPanelSession(role, { intervalMs = 60000 } = {}) {
  if (!role || typeof window === 'undefined') return () => {};
  if (sessionWatch?.stop) sessionWatch.stop();
  let stopped = false;
  const check = async () => {
    if (stopped) return;
    try {
      if (await hasStaffSession(role)) return;
    } catch { /* an unreadable store counts as signed out */ }
    stop();
    showPanelLock({ role, reason: `${PANEL_LABELS[role] || 'এই প্যানেল'}র সেশন আর নেই — নিরাপত্তার জন্য কন্টেন্ট বন্ধ করা হয়েছে।` });
  };
  const timer = setInterval(check, intervalMs);
  const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
  document.addEventListener('visibilitychange', onVisible);
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    window.removeEventListener('pagehide', stop);
    window.removeEventListener('beforeunload', stop);
    window.document.removeEventListener('visibilitychange', onVisible);
  }
  window.addEventListener('pagehide', stop, { once: true });
  window.addEventListener('beforeunload', stop, { once: true });
  sessionWatch = { stop };
  return stop;
}

/** Lock a page whose role may not use it right now, naming whoever is signed
    in instead. Never navigates on its own — the lock card holds the exits. */
export async function lockPanel({ role = ownPanelPage(), reason = '', clear = '' } = {}) {
  let signedIn = [];
  try { signedIn = (await activeStaffRoles()).map(name => PANEL_BY_ROLE[name]).filter(file => file && file !== role); } catch { signedIn = []; }
  if (clear) {
    try { clearStaffSession(clear); } catch { /* nothing to clear */ }
  }
  return showPanelLock({ role, reason, signedIn });
}

/** Leave a hint for the service workers: this device belongs to this panel.
    A tapped push opens it again instead of a hard-coded page. */
export async function rememberPanelPage(page = ownPanelPage()) {
  const file = String(page || '').toLowerCase();
  if (!PANEL_PAGES.includes(file)) return false;
  try {
    if (typeof caches === 'undefined' || !caches.open) return false;
    const cache = await caches.open(PANEL_HINT_CACHE);
    await cache.put(PANEL_HINT_PATH, new Response(file, { headers: { 'content-type': 'text/plain' } }));
    return true;
  } catch { return false; }
}
