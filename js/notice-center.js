import { iconMarkup as minimalIcon } from './icons.js';
import { SECTION_LABEL } from './notification-store.js';
/* The notification centre behind the bell button — one design on every panel.
 *
 * The bell in the topbar is the same control for a student, the Admin, the
 * Manager, the Teacher and the Payment counter. It shows the unread count and
 * opens the list of everything the notification engine (js/notifications.js)
 * considers news for the person using this device: office notices, the urgent
 * broadcast, and — for the student who is taking part — a new exam or a
 * published result.
 *
 * The list has two answers: সব (default) and অপঠিত — Facebook parity, filter default is “সব”. The count on the bell comes
 * from the record store (js/notification-store.js), where only `read === false`
 * counts, so it survives a refresh and never mixes two people on one device.
 *
 * Opening the list does NOT mark everything read: an item becomes read when it
 * is opened, or when the person asks for it with "সব পড়া করুন". That is why the
 * list can honestly show an unread indicator on the cards it has not opened.
 *
 * The page markup is reused when it exists (#noticeModal on the student page);
 * on the staff panels the same modal is built here, with the same classes, so
 * all six screens look and behave alike.
 */

const MODAL_ID = 'apcNoticeModal';
/** Facebook-style: 8 types with distinct avatar colors — type-appropriate icons from icons.js */
const KIND_ICON = Object.freeze({
  // নতুন নোটিশ
  notice: 'icon-notice',
  broadcast: 'icon-bell',
  // পরীক্ষার ফলাফল
  result: 'icon-result',
  exam: 'icon-exam',
  'exam-soon': 'icon-exam',
  'exam-live': 'icon-exam',
  'exam-review': 'icon-exam',
  'exam-returned': 'icon-exam',
  'exam-approved': 'icon-exam',
  // ফি রিমাইন্ডার / বকেয়া — wallet
  payment: 'icon-wallet',
  'payment-review': 'icon-wallet',
  'payment-rejected': 'icon-wallet',
  fee: 'icon-wallet',
  // অ্যাসাইনমেন্ট / হোমওয়ার্ক — assignment
  homework: 'icon-assignment',
  assignment: 'icon-assignment',
  // নিবন্ধন
  registration: 'icon-users',
  approved: 'icon-approval',
  rejected: 'icon-bell',
  // ক্লাস চ্যাট — chat
  chat: 'icon-chat',
  'class-chat': 'icon-chat',
  // সিস্টেম অ্যালার্ট — shield/warning
  system: 'icon-shield',
  alert: 'icon-warning',
  // অন্যান্য
  birthday: 'icon-result',
  'birthday-soon': 'icon-result',
  other: 'icon-bell'
});

/** Avatar background per type — Facebook palette */
const KIND_AVATAR_BG = Object.freeze({
  notice: '#E7F3FF', broadcast: '#FFE7E7',
  exam: '#E6F4EA', result: '#E6F4EA', 'exam-soon': '#FEF3C7', 'exam-live': '#FEE2E2',
  homework: '#F3E8FF', assignment: '#F3E8FF',
  registration: '#E0F2F1', approved: '#E6F4EA', rejected: '#FFE7E7',
  payment: '#FFF7E6', fee: '#FFF7E6', 'payment-review': '#FFF7E6',
  chat: '#E0F7FA', 'class-chat': '#E0F7FA',
  system: '#FFF3E0', alert: '#FFF3E0',
  birthday: '#FCE7F3', other: '#F1F5F9'
});
const KIND_AVATAR_FG = Object.freeze({
  notice: '#1877F2', broadcast: '#E41E3F',
  exam: '#0B8043', result: '#0B8043', 'exam-soon': '#D97706', 'exam-live': '#DC2626',
  homework: '#7C3AED', assignment: '#7C3AED',
  registration: '#00796B', approved: '#0B8043', rejected: '#C62828',
  payment: '#EA580C', fee: '#EA580C', 'payment-review': '#EA580C',
  chat: '#0097A7', 'class-chat': '#0097A7',
  system: '#EF6C00', alert: '#EF6C00',
  birthday: '#BE185D', other: '#64748B'
});
/* The button on an item that asks someone to act. */
const ACTION_LABEL = Object.freeze({
  registration: 'রিভিউ ও অনুমোদন',
  'payment-review': 'পেমেন্ট দেখুন',
  'exam-review': 'পরীক্ষা দেখুন',
  'exam-returned': 'সংশোধন করুন',
  'exam-approved': 'পরীক্ষা দেখুন',
  'payment-rejected': 'এন্ট্রি দেখুন',
  exam: 'পরীক্ষা খুলুন',
  'exam-soon': 'সময়সূচি দেখুন',
  'exam-live': 'এখনই পরীক্ষা দিন',
  homework: 'বাড়ির কাজ খুলুন',
  result: 'ফলাফল দেখুন',
  approved: 'অ্যাকাউন্ট দেখুন',
  rejected: 'বিস্তারিত দেখুন'
});
const actionLabel = item => String(item?.actionLabel || ACTION_LABEL[item?.kind] || '');
const REFRESH_KEYS = Object.freeze(['activePlus.admin.notices.v1', 'activePlus.app.config.v1', 'active-plus-app-config-v1', 'activePlus.exams.v1', 'activePlus.teaching.v1', 'activePlus.admin.students.v1', 'activePlus.registrationNotifications.v1', 'activePlus.admin.transactions.v1']);
const REFRESH_COLLECTIONS = Object.freeze(['notices', 'settings', 'exams', 'teaching', 'students', 'registrationNotifications', 'transactions']);

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bn = value => String(value).replace(/\d/g, digit => BN_DIGITS[Number(digit)]);
/** Facebook-style badge: 0 hidden, 1–99 exact (Bengali), 99+ capped. */
export function unreadBadgeText(count) {
  const value = Number(count) || 0;
  if (value <= 0) return '';
  if (value > 99) return `${bn(99)}+`;
  return bn(value);
}

/** Relative time in Bengali — “২ ঘন্টা আগে”, “গতকাল”, “৩ দিন আগে” */
export function timeAgoBn(at) {
  const stamp = Number(at);
  if (!Number.isFinite(stamp) || stamp <= 0) return '';
  const diff = Date.now() - stamp;
  if (diff < 0) return 'এইমাত্র';
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'এইমাত্র';
  if (sec < 90) return '১ মিনিট আগে';
  const min = Math.floor(sec / 60);
  if (min < 45) return `${bn(min)} মিনিট আগে`;
  if (min < 90) return '১ ঘন্টা আগে';
  const hr = Math.floor(min / 60);
  if (hr < 22) return `${bn(hr)} ঘন্টা আগে`;
  if (hr < 36) return 'গতকাল';
  const day = Math.floor(hr / 24);
  if (day < 7) return `${bn(day)} দিন আগে`;
  if (day < 14) return '১ সপ্তাহ আগে';
  if (day < 30) return `${bn(Math.floor(day / 7))} সপ্তাহ আগে`;
  const date = new Date(stamp);
  try { return date.toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' }); }
  catch { return date.toLocaleDateString(); }
}

let center = null;
let centerDoc = null;

/* ---- helpers ---------------------------------------------------------------- */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function whenText(item) {
  // Prefer Facebook relative time; fallback to absolute Bengali date for old items
  const t = timeAgoBn(item?.at);
  if (t) return t;
  const at = Number(item?.at);
  if (Number.isFinite(at) && at > 0) {
    const date = new Date(at);
    try { return date.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return date.toLocaleString(); }
  }
  return String(item?.audience || '');
}

function avatarStyle(kind) {
  const bg = KIND_AVATAR_BG[kind] || KIND_AVATAR_BG.other;
  const fg = KIND_AVATAR_FG[kind] || KIND_AVATAR_FG.other;
  return `background:${bg};color:${fg};border:1px solid ${bg}`;
}

function iconMarkup(kind) {
  /* A page sprite wins when it has the symbol; js/icons.js otherwise draws the
     same glyph from its own paths, so no icon is ever a blank square. */
  const wanted = KIND_ICON[kind] || 'icon-bell';
  if (document.getElementById(wanted)) return minimalIcon(wanted);
  return minimalIcon(document.getElementById('icon-bell') ? 'icon-bell' : wanted);
}

const sectionOf = item => SECTION_LABEL[item?.kind] || 'নোটিশ';

/* ---- modal ------------------------------------------------------------------ */

function buildModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop apc-fb-backdrop';
  backdrop.id = MODAL_ID;
  backdrop.hidden = true;
  backdrop.innerHTML =
    '<section class="modal apc-fb-panel" role="dialog" aria-modal="true" aria-labelledby="apcNoticeTitle">' +
      '<div class="apc-fb-handle" aria-hidden="true"></div>' +
      '<header class="apc-fb-header">' +
        /* Facebook parity: header is Notification, not Action Centre plumbing */
        '<h2 id="apcNoticeTitle" class="apc-fb-title">নোটিফিকেশন</h2>' +
        '<div class="apc-fb-header-actions">' +
          '<button type="button" class="apc-fb-mark-all" data-apc-notice-read-all aria-label="সব নোটিফিকেশন পঠিত করুন">সব পঠিত করুন</button>' +
          '<button type="button" class="modal-close apc-fb-close" data-apc-notice-close aria-label="বন্ধ করুন">×</button>' +
        '</div>' +
      '</header>' +
      /* Title, then the read status, then the approval strip (inserted at
         runtime), then the tabs: the sheet answers "what needs me?" before it
         offers a filter. */
      '<p class="notice-read-status apc-fb-status" data-apc-notice-status role="status"></p>' +
      '<div class="notice-filters apc-fb-filters" role="tablist" aria-label="নোটিফিকেশন ফিল্টার">' +
        '<button type="button" class="chip apc-fb-chip active" role="tab" aria-selected="true" data-apc-notice-filter="all">সব</button>' +
        '<button type="button" class="chip apc-fb-chip" role="tab" aria-selected="false" data-apc-notice-filter="unread">অপঠিত<span data-apc-notice-unread-chip></span></button>' +
      '</div>' +
      '<div class="apc-fb-list" data-apc-notice-list role="feed" aria-label="নোটিফিকেশন তালিকা"></div>' +
      '<p class="form-note" data-apc-notice-push role="status"></p>' +
      '<footer class="apc-fb-footer">' +
        '<button type="button" class="apc-fb-settings-link" data-apc-notice-settings>⚙️ নোটিফিকেশন সেটিংস</button>' +
      '</footer>' +
    '</section>';
  document.body.append(backdrop);
  return backdrop;
}

/* One answer for "is this a phone?", shared by the sheet and the scroll lock.
   Older Android WebViews (and non-browser DOMs) can lack matchMedia, so the
   viewport width is the fallback — the sheet must never fail to open. */
const narrowViewport = () => (typeof window.matchMedia === 'function'
  ? window.matchMedia('(max-width: 600px)').matches
  : window.innerWidth <= 600);

/** Position Facebook dropdown under bell (desktop) or as bottom sheet (mobile) */
function positionPanel(modal) {
  const panel = modal?.querySelector('.apc-fb-panel');
  const bell = document.getElementById('notificationButton');
  if (!panel || !bell) return;
  const isMobile = narrowViewport();
  if (isMobile) {
    panel.style.top = ''; panel.style.right = ''; panel.style.left = '';
    panel.style.position = '';
    return;
  }
  try {
    const rect = bell.getBoundingClientRect();
    const gap = 10;
    const panelWidth = 380;
    panel.style.position = 'fixed';
    panel.style.top = `${Math.round(rect.bottom + gap)}px`;
    let right = window.innerWidth - rect.right - (rect.width / 2) + (panelWidth / 2);
    right = Math.max(12, Math.min(right, window.innerWidth - panelWidth - 12));
    panel.style.right = `${Math.round(right)}px`;
    panel.style.left = 'auto';
  } catch { /* fallback to CSS */ }
}

/* The pretty empty state: a checked card instead of a row of buttons. */
function emptyState(title, note) {
  return '<div class="notice-empty" data-apc-notice-empty>' +
      '<span class="notice-empty-art" aria-hidden="true">' + iconMarkup('icon-award') + '</span>' +
      '<strong>' + escapeHtml(title) + '</strong>' +
      '<p>' + escapeHtml(note) + '</p>' +
    '</div>';
}

/* ---- mount ------------------------------------------------------------------ */

/**
 * @param {object} api  the notification engine (js/notifications.js)
 * @returns {{ paint: Function, open: Function, close: Function, refresh: Function }}
 */
export function mountNoticeCenter(api) {
  if (center && centerDoc === document) return center;
  if (!api || typeof api.feed !== 'function') return null;
  centerDoc = document;

  const ownsModal = !document.getElementById('noticeModal');
  const modal = document.getElementById('noticeModal') || buildModal();
  const listBox = modal.querySelector('[data-apc-notice-list], #noticeListStudent');
  const statusLine = modal.querySelector('[data-apc-notice-status], #noticeReadStatus');
  const pushNote = modal.querySelector('[data-apc-notice-push]');
  let pushRow = null;
  let shownFeed = [];
  let filter = 'all';
  let detailKey = '';
  const expandedKeys = new Set();
  const PAGE_SIZE = 40;
  let visibleLimit = PAGE_SIZE;

  const PREVIEW_CHAR_LIMIT = 140;
  const isLongBody = value => {
    const raw = String(value ?? '').trim();
    if (!raw) return false;
    return raw.length > PREVIEW_CHAR_LIMIT || raw.split(/\r?\n/).length > 2;
  };
  const buildCardPreview = value => {
    const normalized = String(value ?? '').replace(/\s*\r?\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (normalized.length <= PREVIEW_CHAR_LIMIT) return normalized;
    const sliced = normalized.slice(0, PREVIEW_CHAR_LIMIT);
    const boundary = sliced.lastIndexOf(' ');
    return `${(boundary > 80 ? sliced.slice(0, boundary) : sliced).trim()}…`;
  };

  /* The filter tabs and the "read all" action, for a page modal that has the
     list but not this shell (index.html). */
  /* Facebook parity: default “সব” — filter, chip HTML, open() and paint() aligned */
  let filterRow = modal.querySelector('.notice-filters');
  if (!filterRow && listBox) {
    filterRow = document.createElement('div');
    filterRow.className = 'notice-filters';
    filterRow.innerHTML =
      '<button type="button" class="chip active" role="tab" aria-selected="true" data-apc-notice-filter="all">সব</button>' +
      '<button type="button" class="chip" role="tab" aria-selected="false" data-apc-notice-filter="unread">অপঠিত<span data-apc-notice-unread-chip></span></button>' +
      '<button type="button" class="mini-btn notice-read-all" data-apc-notice-read-all>সব পড়া করুন</button>';
    listBox.before(filterRow);
  }

  /* "তালিকা খালি করুন": one button on every panel (page modal or built modal).
     Clearing hides the reminder; it never deletes the record or the task. */
  let clearButton = modal.querySelector('[data-apc-notice-clear]');
  if (!clearButton && typeof api.clear === 'function') {
    clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'mini-btn';
    clearButton.dataset.apcNoticeClear = '';
    clearButton.textContent = 'তালিকা খালি করুন';
    clearButton.hidden = true;
    if (statusLine) statusLine.after(clearButton);
    else if (listBox) listBox.before(clearButton);
  }

  function show(visible) {
    modal.hidden = !visible;
    const bell = document.getElementById('notificationButton');
    if (visible) {
      positionPanel(modal);
      modal.querySelector('[data-apc-notice-close]')?.focus?.();
      void paintPush();
      // Prevent background scroll on mobile sheet
      if (narrowViewport()) {
        document.body.style.overflow = 'hidden';
      }
      bell?.setAttribute('aria-expanded', 'true');
      // Trap focus inside panel
      trapFocus(modal);
    } else {
      document.body.style.overflow = '';
      bell?.setAttribute('aria-expanded', 'false');
      bell?.focus?.();
    }
    // Toggle backdrop scroll lock class
    modal.classList.toggle('is-open', visible);
  }

  function trapFocus(container) {
    const focusable = [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.hidden && !el.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const handler = e => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    if (container._apcFocusTrap) container.removeEventListener('keydown', container._apcFocusTrap);
    container._apcFocusTrap = handler;
    container.addEventListener('keydown', handler);
  }

  const isStudentViewer = () => {
    try { return api.viewer?.()?.kind === 'student'; } catch { return false; }
  };
  const reviewerRole = () => {
    try {
      const v = api.viewer?.();
      if (v?.kind === 'staff' && (v.role === 'admin' || v.role === 'manager')) return v.role;
    } catch {}
    return '';
  };

  let pendingHost = modal.querySelector('[data-apc-pending-host]');
  if (!pendingHost && reviewerRole() && listBox) {
    pendingHost = document.createElement('div');
    pendingHost.className = 'apc-pending-host';
    pendingHost.dataset.apcPendingHost = '';
    if (filterRow) filterRow.before(pendingHost);
    else listBox.before(pendingHost);
  }

  let regToastTimer = null;
  function showSubtleRegistrationToast(message = 'নতুন শিক্ষার্থী রেজিস্ট্রেশন করেছে') {
    if (!document.body) return;
    let toastEl = document.getElementById('apcRegistrationToast');
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'apcRegistrationToast';
      toastEl.className = 'apc-reg-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.append(toastEl);
    }
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(regToastTimer);
    regToastTimer = setTimeout(() => {
      if (toastEl) toastEl.hidden = true;
    }, 4500);
    if (typeof regToastTimer?.unref === 'function') regToastTimer.unref();
  }

  window.addEventListener('apc-new-registration-toast', event => {
    if (!reviewerRole()) return;
    showSubtleRegistrationToast(event?.detail?.message || 'নতুন শিক্ষার্থী রেজিস্ট্রেশন করেছে');
    repaint();
  });

  async function paintPendingRegistrations() {
    const role = reviewerRole();
    if (!role || !pendingHost) return;
    try {
      const reviewMod = await import('./registration-review.js');
      const items = reviewMod.listPendingRegistrations();
      pendingHost.classList.toggle('is-empty', items.length === 0);
      pendingHost.innerHTML = reviewMod.pendingQueueMarkup(items);
      reviewMod.bindPendingQueueActions(pendingHost, {
        role,
        /* The drawer repaints itself so an opened application shows its name
           without leaving the notification list. */
        onRevealToggle: () => paintPendingRegistrations(),
        onFeedback: msg => {
          if (statusLine && msg) statusLine.textContent = msg;
          showSubtleRegistrationToast(msg);
        },
        onDecided: result => {
          const sid = result?.student?.id;
          if (sid) {
            try { api.markRead?.([`registration:${sid}`]); } catch {}
          }
          try { api.refresh?.(); } catch {}
          paint();
        }
      });
    } catch { /* optional review module */ }
  }
  const centerFeed = items => items;
  const displayTitle = item => {
    const raw = String(item?.title || 'নোটিশ').trim() || 'নোটিশ';
    if (item?.kind === 'notice' && isStudentViewer() && !/^নতুন নোটিশ/u.test(raw)) {
      return `নতুন নোটিশ এসেছে - ${raw}`;
    }
    return raw;
  };

  /* Unread state: the record store is authoritative across notices, broadcasts,
     exams, homework and results so the bell badge reflects unread notices too. */
  function unreadKeys() {
    if (typeof api.unreadKeys === 'function') {
      try {
        const keys = new Set(api.unreadKeys());
        const count = typeof api.unread === 'function' ? Number(api.unread()) : keys.size;
        return { count: Number.isFinite(count) ? Math.max(0, count) : keys.size, keys };
      } catch { /* fall through to the receipts */ }
    }
    if (typeof api.unread === 'function') {
      try {
        const count = Number(api.unread());
        if (Number.isFinite(count)) return { count: Math.max(0, count), keys: null };
      } catch { /* fall through to the receipts */ }
    }
    const seen = new Set(api.seen ? api.seen() : []);
    return { count: null, keys: null, seen };
  }

  function isUnread(item, state) {
    if (state.keys) return state.keys.has(item.key);
    if (state.seen) return !state.seen.has(item.key) || item.actionable;
    return !item.read;
  }

  let lastUnread = 0;
  function paintBadge(unread) {
    const bell = document.getElementById('notificationButton');
    if (!bell) return;
    let dot = bell.querySelector('.notification-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'notification-dot';
      dot.setAttribute('aria-hidden', 'true');
      bell.append(dot);
    }
    const text = unreadBadgeText(unread);
    dot.textContent = text;
    dot.classList.toggle('is-count', text.length > 0);
    dot.hidden = unread === 0;
    bell.setAttribute('aria-label', unread
      ? `নোটিফিকেশন — ${bn(unread)}টি অপঠিত`
      : 'নোটিফিকেশন — সব পড়া হয়েছে');
    bell.setAttribute('aria-expanded', !modal.hidden ? 'true' : 'false');
    // Facebook pulse on new notifications
    if (unread > lastUnread && lastUnread !== 0) {
      dot.classList.remove('apc-fb-pulse');
      void dot.offsetWidth;
      dot.classList.add('apc-fb-pulse');
      setTimeout(() => dot.classList.remove('apc-fb-pulse'), 800);
    }
    lastUnread = unread;
  }

  function paintCard(item, unread) {
    const opens = Boolean(item.actionable || item.target || item.body) && (typeof api.openItem === 'function' || Boolean(item.body));
    const defaultNoticeLabel = item.kind === 'notice' ? 'নোটিশ খুলুন' : (item.kind === 'broadcast' ? 'জরুরি ঘোষণা খুলুন' : '');
    const label = actionLabel(item) || defaultNoticeLabel || (item.actionable || item.target ? 'খুলুন' : '');
    const rowOpens = opens && !label;
    const heading = displayTitle(item);
    const bodyText = String(item.body || '').trim();
    const longBody = isLongBody(bodyText);
    const expanded = longBody && expandedKeys.has(item.key);
    const bodyPreview = bodyText ? (expanded ? bodyText : buildCardPreview(bodyText)) : '';
    const bodyMarkup = bodyText
      ? (expanded
        ? '<div class="apc-fb-card-body notification-body notice-content">' + escapeHtml(bodyText) + '</div>'
        : '<p class="apc-fb-preview notification-card-preview">' + escapeHtml(bodyPreview) + '</p>')
      : '';
    const expandButton = longBody
      ? '<button type="button" class="mini-btn notice-expand-btn apc-fb-expand" data-apc-notice-expand="' + escapeHtml(item.key) + '" aria-expanded="' + (expanded ? 'true' : 'false') + '">' + (expanded ? 'সংক্ষিপ্ত করুন' : 'আরও দেখুন') + '</button>'
      : '';
    const openButton = label
      ? '<button type="button" class="mini-btn primary notice-action apc-fb-action" data-apc-notice-open="' + escapeHtml(item.key) + '" aria-label="' + escapeHtml(`${label}: ${item.title}`) + '">' + escapeHtml(label) + '</button>'
      : '';
    const actionsRow = (expandButton || openButton)
      ? '<div class="notice-card-actions apc-fb-actions">' + expandButton + openButton + '</div>'
      : '';
    const avatar = '<span class="apc-fb-avatar" style="' + avatarStyle(item.kind) + '" aria-hidden="true">' + iconMarkup(item.kind) + '</span>';
    const meta = '<div class="apc-fb-meta"><span class="apc-fb-section">' + escapeHtml(sectionOf(item)) + '</span><span class="apc-fb-dot">·</span><span class="notice-time apc-fb-time">' + escapeHtml(whenText(item)) + '</span></div>';
    // Facebook card: avatar + content + unread dot
    return '<article class="notice-detail apc-fb-card' + (unread ? ' unread apc-fb-unread' : '') + (opens ? ' actionable' : '') + (label ? ' has-action' : '') + (expanded ? ' is-expanded' : '') + (item.kind === 'birthday' || item.kind === 'birthday-soon' ? ' is-birthday' : '') + '"' +
      (opens ? ' data-apc-notice-open="' + escapeHtml(item.key) + '"' : '') +
      (rowOpens ? ' role="button" tabindex="0"' : '') + '>' +
      avatar +
      '<div class="notice-detail-copy apc-fb-copy">' +
        '<h3 class="apc-fb-title-text">' + escapeHtml(heading) + '</h3>' +
        meta +
        bodyMarkup + actionsRow +
      '</div>' +
      (unread ? '<span class="notice-unread-dot apc-fb-unread-dot" aria-label="অপঠিত"></span>' : '') +
      '</article>';
  }

  function paintDetailSheet(item) {
    const heading = displayTitle(item);
    const bodyText = String(item.body || '').trim();
    return '<article class="notice-modal-detail-sheet" data-apc-notice-detail-sheet="' + escapeHtml(item.key) + '">' +
      '<div class="notice-modal-detail-head">' +
        '<button type="button" class="mini-btn notice-detail-back" data-apc-notice-detail-back>← তালিকায় ফিরুন</button>' +
        '<span class="notice-section-chip">' + escapeHtml(sectionOf(item)) + '</span>' +
      '</div>' +
      '<span class="notice-time">' + escapeHtml(whenText(item)) + '</span>' +
      '<h3>' + escapeHtml(heading) + '</h3>' +
      (bodyText ? '<div class="notification-body notice-content">' + escapeHtml(bodyText) + '</div>' : '') +
    '</article>';
  }

  // Map feed kind → settings.types key (Facebook 8 types)
  function kindToSettingType(kind) {
    const k = String(kind || '').toLowerCase();
    if (['notice','broadcast','announcement','news'].includes(k)) return 'notice';
    if (['result','exam','exam-result','exam_result','test','grade'].includes(k)) return 'result';
    if (['fee','payment','fee_reminder','due','collection','transaction'].includes(k)) return 'fee';
    if (['homework','assignment','task','home-work','exam-submission'].includes(k)) return 'homework';
    if (['registration','admission','enrolment'].includes(k)) return 'registration';
    if (['chat','class_chat','message','conversation'].includes(k)) return 'chat';
    if (['system','alert','warning','maintenance'].includes(k)) return 'system';
    return 'other';
  }
  function isTypeEnabled(kind) {
    try {
      const s = api?.settings?.() || api?.notificationSettings?.() || null;
      if (s?.types && typeof s.types[kindToSettingType(kind)] === 'boolean') return s.types[kindToSettingType(kind)] !== false;
      // Fallback: check localStorage settings file
      const raw = localStorage.getItem('activePlus.notificationSettings.v1');
      if (raw) {
        const file = JSON.parse(raw);
        const vk = typeof api?.viewerKey === 'function' ? api.viewerKey() : '';
        const us = vk ? file?.users?.[vk] : null;
        if (us?.types && typeof us.types[kindToSettingType(kind)] === 'boolean') return us.types[kindToSettingType(kind)] !== false;
      }
    } catch {}
    return true;
  }

  let lastPaintFilter = filter;
  function paint() {
    let feed = [];
    try { feed = centerFeed(api.feed() || []); } catch { feed = []; }
    // Respect per-type toggles: hide disabled types
    try { feed = feed.filter(item => isTypeEnabled(item.kind || item.type)); } catch {}
    const state = unreadKeys(feed);
    const unreadItems = feed.filter(item => isUnread(item, state));
    const unread = state.count === null ? unreadItems.length : state.count;
    shownFeed = feed;
    // reset pagination when filter changes (gap 1 consistency)
    if (lastPaintFilter !== filter) { visibleLimit = PAGE_SIZE; lastPaintFilter = filter; }

    if (clearButton) clearButton.hidden = feed.length === 0 || Boolean(detailKey);

    const chip = modal.querySelector('[data-apc-notice-unread-chip]');
    if (chip) chip.textContent = unread ? ` ${bn(unread)}` : '';
    paintBadge(unread);
    if (reviewerRole()) void paintPendingRegistrations();

    if (statusLine) {
      statusLine.textContent = feed.length
        ? (unread ? `${bn(unread)}টি অপঠিত নোটিফিকেশন` : 'নতুন কোনো অপঠিত নোটিফিকেশন নেই।')
        : '';
    }
    const readAll = modal.querySelector('[data-apc-notice-read-all]');
    if (readAll) readAll.hidden = unread === 0;
    modal.querySelectorAll('[data-apc-notice-filter]').forEach(tab => {
      const active = tab.dataset.apcNoticeFilter === filter;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (!listBox) return { unread, total: feed.length };

    if (!feed.length) {
      detailKey = '';
      listBox.innerHTML = emptyState('সব নোটিফিকেশন দেখা হয়েছে', 'নতুন কোনো নোটিফিকেশন নেই।');
      return { unread, total: 0 };
    }
    const activeDetail = detailKey ? feed.find(item => item.key === detailKey) : null;
    if (activeDetail) {
      listBox.innerHTML = paintDetailSheet(activeDetail);
      return { unread, total: feed.length };
    }
    detailKey = '';
    const visible = filter === 'unread' ? unreadItems : feed;
    // pagination — first N only, hard cap + load more (gap 3)
    if (visible.length > visibleLimit) {
      const slice = visible.slice(0, visibleLimit);
      const remaining = visible.length - visibleLimit;
      listBox.innerHTML = slice.map(item => paintCard(item, isUnread(item, state))).join('') +
        '<button type="button" class="mini-btn apc-fb-load-more" data-apc-notice-load-more>আরও দেখুন (' + bn(remaining) + 'টি বাকি)</button>';
    } else {
      listBox.innerHTML = visible.length
        ? visible.map(item => paintCard(item, isUnread(item, state))).join('') +
          (visible.length > PAGE_SIZE ? '<p class="apc-fb-end-note">সব নোটিফিকেশন দেখানো হয়েছে</p>' : '')
        : emptyState('সব নোটিফিকেশন দেখা হয়েছে', 'এখন নতুন কোনো নোটিফিকেশন নেই।');
    }
    return { unread, total: feed.length };
  }

  /* The push row explains — and switches — the tray notifications. It is built
     only when the list is opened, so the FCM module never loads on a page that
     does not need it. */
  async function paintPush() {
    if (!pushNote || !api.pushSupport) return;
    const support = await api.pushSupport();
    pushNote.textContent = '';
    if (pushRow) { pushRow.remove(); pushRow = null; }
    const line = document.createElement('span');
    line.className = 'notice-push-copy';
    if (!support.supported) {
      line.textContent = 'এই ব্রাউজারে সিস্টেম নোটিফিকেশন নেই — অ্যাপ খোলা থাকলেও নোটিশ এখানে আসবে।';
      pushNote.append(line);
      return;
    }
    if (support.permission === 'granted') {
      line.textContent = support.hasVapidKey
        ? '✅ ডিভাইসে নোটিফিকেশন চালু — অ্যাপ বন্ধ থাকলেও আসবে।'
        : '✅ ডিভাইসে নোটিফিকেশন চালু — অ্যাপ খোলা থাকলে বা ব্যাকগ্রাউন্ডে থাকলে আসবে।';
      const off = document.createElement('button');
      off.type = 'button';
      off.className = 'mini-btn reject notice-push-btn';
      off.textContent = 'বন্ধ করুন';
      off.addEventListener('click', async () => {
        off.disabled = true;
        await api.disable();
        off.disabled = false;
        void paintPush();
      });
      pushRow = off;
      pushNote.append(line, off);
      return;
    }
    line.textContent = support.permission === 'denied'
      ? 'ব্রাউজার সেটিংসে নোটিফিকেশন ব্লক করা আছে — Chrome/Safari সেটিংস থেকে অনুমতি দিন।'
      : 'নোটিফিকেশন চালু করলে নতুন নোটিশ, পরীক্ষা ও ফলাফলের খবর সাথে সাথে পাবেন।';
    const on = document.createElement('button');
    on.type = 'button';
    on.className = 'mini-btn notice-push-btn';
    on.textContent = '🔔 চালু করুন';
    on.addEventListener('click', async () => {
      on.disabled = true;
      await api.enable();
      on.disabled = false;
      paint();
      void paintPush();
    });
    pushRow = on;
    pushNote.append(line, on);
  }

  function open(initialDetailKey = '') {
    hideAlerts();
    detailKey = initialDetailKey || '';
    filter = 'all';
    paint();
    show(true);
    // Re-position on resize/scroll while open
    const reposition = () => { if (!modal.hidden) positionPanel(modal); };
    window.addEventListener('resize', reposition, { once: true });
    window.addEventListener('scroll', reposition, { once: true, capture: true });
  }

  /* One delegated click handler serves every panel and survives a shell that is
     painted after this module runs. */
  document.addEventListener('click', event => {
    const bell = event.target?.closest?.('#notificationButton');
    if (bell) { event.preventDefault(); open(); return; }
    if (!modal.contains(event.target)) return;
    const tab = event.target?.closest?.('[data-apc-notice-filter]');
    if (tab) {
      detailKey = '';
      filter = tab.dataset.apcNoticeFilter === 'all' ? 'all' : 'unread';
      paint();
      return;
    }
    if (event.target?.closest?.('[data-apc-notice-detail-back]')) {
      event.preventDefault();
      detailKey = '';
      paint();
      return;
    }
    const expandButton = event.target?.closest?.('[data-apc-notice-expand]');
    if (expandButton) {
      event.preventDefault();
      event.stopPropagation();
      const key = expandButton.dataset.apcNoticeExpand;
      if (expandedKeys.has(key)) expandedKeys.delete(key);
      else expandedKeys.add(key);
      paint();
      return;
    }
    const loadMore = event.target?.closest?.('[data-apc-notice-load-more]');
    if (loadMore) {
      event.preventDefault();
      visibleLimit = Math.min(visibleLimit + PAGE_SIZE, 500);
      paint();
      // keep focus for accessibility
      modal.querySelector('[data-apc-notice-load-more]')?.focus?.();
      return;
    }
    if (event.target?.closest?.('[data-apc-notice-read-all]')) {
      event.preventDefault();
      readAll();
      return;
    }
    const target = event.target?.closest?.('[data-apc-notice-open]');
    if (target) { event.preventDefault(); openItem(target.dataset.apcNoticeOpen); return; }
    if (event.target?.closest?.('[data-apc-notice-clear]')) {
      event.preventDefault();
      try { api.clear?.(); } catch { /* the list repaints anyway */ }
      paint();
      if (statusLine) statusLine.textContent = 'তালিকা খালি করা হয়েছে।';
      return;
    }
    if (event.target?.closest?.('[data-apc-notice-settings]')) {
      event.preventDefault();
      show(false);
      // Try to open Settings via known selectors (student: data-view="settings", admin: data-panel-view="settings")
      const settingsBtn = document.querySelector('[data-view="settings"], [data-panel-view="settings"], [data-panel-view="more"], #notificationSettings, [data-view-panel="settings"]');
      if (settingsBtn) {
        // If it's a panel section, scroll into view; if button, click it
        if (settingsBtn.tagName === 'BUTTON' || settingsBtn.hasAttribute('data-view') || settingsBtn.hasAttribute('data-panel-view')) settingsBtn.click();
        else settingsBtn.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        // Fallback: dispatch event to let settings handle
        window.dispatchEvent(new CustomEvent('apc-open-settings'));
      }
      return;
    }
    const closeBtn = event.target?.closest?.('[data-apc-notice-close]');
    const isBackdrop = event.target === modal;
    if (closeBtn || isBackdrop) {
      event.preventDefault();
      show(false);
      return;
    }
    if (!ownsModal) return;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.hidden) show(false);
    if ((event.key === 'Enter' || event.key === ' ') && event.target?.matches?.('article[data-apc-notice-open]')) {
      event.preventDefault();
      openItem(event.target.dataset.apcNoticeOpen);
    }
  });

  /** Everything in the list is read — the explicit action, never a side effect. */
  function readAll() {
    const keys = shownFeed.map(item => item.key);
    let saved = true;
    try {
      if (typeof api.markRead === 'function') saved = api.markRead(keys) !== false;
      else if (typeof api.markAllSeen === 'function') saved = api.markAllSeen().saved !== false;
    } catch { saved = false; }
    paint();
    if (statusLine) {
      statusLine.textContent = saved
        ? 'সব নোটিফিকেশন পড়া হিসেবে চিহ্নিত করা হয়েছে।'
        : 'পড়ার অবস্থা এইবারের জন্য রাখা হয়েছে; ডিভাইসে সংরক্ষণ হয়নি।';
    }
    return saved;
  }

  /* An actionable item closes the list and opens its own dialog. Either way the
     item has now been looked at, so it is marked read before it opens. */
  function openItem(key) {
    const item = shownFeed.find(entry => entry.key === key);
    if (!item) return;
    try {
      if (typeof api.markRead === 'function') api.markRead([key]);
      else if (typeof api.markAllSeen === 'function') api.markAllSeen();
    } catch { /* opening still works */ }
    const needsInlineDetail = ((item.kind === 'notice' || item.kind === 'broadcast') && !isStudentViewer())
      || (!item.actionable && !item.target && Boolean(item.body));
    if (needsInlineDetail) {
      detailKey = item.key;
      filter = 'all';
      paint();
      return;
    }
    if (typeof api.openItem === 'function' && (item.actionable || item.target)) {
      closeModal();
      void Promise.resolve(api.openItem(item)).finally(() => paint());
      return;
    }
    paint();
  }

  /* The page modal (#noticeModal) is closed by its own page code; hide it the
     same way it is hidden there. */
  function closeModal() {
    if (ownsModal) { show(false); return; }
    const pageClose = modal.querySelector('[data-close-notice], .modal-close, [data-close-modal]');
    if (pageClose) pageClose.click();
    else modal.hidden = true;
  }

  /* ---- Popup: new notifications, and the "notifications are off" story ----
     One sheet serves both. It sits on a blurred backdrop (css/ui-features.css +
     the glass skin) and never needs the phone's notification permission: it is
     the in-app half. There is no acknowledgement button — tapping an item opens
     it, × (or Escape) puts the sheet away. */
  let alertCard = null;
  let alertBackdrop = null;
  let alertItems = [];
  let alertMode = 'items';

  const INFO_COPY = {
    denied: 'ব্রাউজার সেটিংসে এই সাইটের নোটিফিকেশন ব্লক করা আছে — Chrome/Safari সেটিংস থেকে অনুমতি দিলে নতুন নোটিশ, পরীক্ষা ও ফলাফলের খবর ফোনেই আসবে।',
    disabled: 'ডিভাইসের নোটিফিকেশন বন্ধ করা হয়েছে। অ্যাপ খোলা থাকলে নোটিশ তবুও এই তালিকায় জমা হবে — চাইলে আবার চালু করতে পারবেন।',
    unsupported: 'এই ব্রাউজারে সিস্টেম নোটিফিকেশন নেই। অ্যাপ খোলা থাকলেই নতুন নোটিশ, পরীক্ষা ও ফলাফলের খবর এখানে দেখা যাবে।'
  };

  function hideAlerts() {
    alertItems = [];
    alertMode = 'items';
    if (alertCard) alertCard.hidden = true;
    if (alertBackdrop) alertBackdrop.hidden = true;
  }

  function ensureAlertShell() {
    if (alertCard) return;
    alertBackdrop = document.createElement('div');
    alertBackdrop.className = 'apc-alert-backdrop';
    alertBackdrop.id = 'apcAlertBackdrop';
    alertBackdrop.hidden = true;
    alertCard = document.createElement('section');
    alertCard.className = 'apc-inapp-alert';
    alertCard.id = 'apcInAppAlert';
    alertCard.setAttribute('role', 'dialog');
    alertCard.setAttribute('aria-modal', 'true');
    alertCard.setAttribute('aria-labelledby', 'apcAlertTitle');
    alertBackdrop.append(alertCard);
    document.body.append(alertBackdrop);
    alertBackdrop.addEventListener('click', event => {
      if (event.target === alertBackdrop) { hideAlerts(); return; }
      if (event.target.closest('[data-apc-alert-close]')) { hideAlerts(); return; }
      if (event.target.closest('[data-apc-alert-all]')) { hideAlerts(); open(); return; }
      const row = event.target.closest('[data-apc-alert-open]');
      if (!row) return;
      const item = alertItems.find(entry => entry.key === row.dataset.apcAlertOpen);
      alertItems = alertItems.filter(entry => entry !== item);
      if (!item) { paintAlerts(); return; }
      try {
        if (typeof api.markRead === 'function') api.markRead([item.key]);
      } catch { /* opening still proceeds */ }
      const staffNoticeDetail = (item.kind === 'notice' || item.kind === 'broadcast') && !isStudentViewer();
      if (!staffNoticeDetail && (item.actionable || item.target) && typeof api.openItem === 'function') {
        hideAlerts();
        void Promise.resolve(api.openItem(item)).finally(() => paint());
      } else {
        hideAlerts();
        open(item.body ? item.key : '');
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && alertBackdrop && !alertBackdrop.hidden) hideAlerts();
    });
  }

  function alertHeader(eyebrow, title) {
    return '<header>' +
        '<span class="apc-alert-icon" aria-hidden="true">' + iconMarkup('notice') + '</span>' +
        '<div class="apc-alert-head-copy"><p class="eyebrow">' + eyebrow + '</p>' +
        '<h2 class="apc-alert-title" id="apcAlertTitle">' + title + '</h2></div>' +
        '<button type="button" class="apc-inapp-alert-close" data-apc-alert-close aria-label="বন্ধ করুন">×</button>' +
      '</header>';
  }

  function alertFooter(showAll) {
    return '<footer class="apc-alert-actions">' +
        (showAll || '') +
        '<button type="button" class="mini-btn" data-apc-alert-close>বন্ধ করুন</button>' +
      '</footer>';
  }

  function paintAlerts() {
    if (!alertItems.length) { hideAlerts(); return; }
    ensureAlertShell();
    const rows = alertItems.slice(0, 3).map(item => {
      const defaultNoticeLabel = item.kind === 'notice' ? 'নোটিশ খুলুন' : (item.kind === 'broadcast' ? 'জরুরি ঘোষণা খুলুন' : '');
      const label = actionLabel(item) || defaultNoticeLabel || (item.actionable || item.target ? 'খুলুন' : '');
      const heading = displayTitle(item);
      const preview = item.body ? buildCardPreview(item.body) : '';
      const key = escapeHtml(item.key);
      return '<li class="apc-inapp-alert-row">' +
        '<button type="button" class="apc-inapp-alert-item" data-apc-alert-open="' + key + '">' +
          '<span class="apc-inapp-alert-icon">' + iconMarkup(item.kind) + '</span>' +
          '<span class="apc-inapp-alert-copy"><b>' + escapeHtml(heading) + '</b>' + (preview ? '<small>' + escapeHtml(preview) + '</small>' : '') + '</span>' +
        '</button>' + (label
          ? '<button type="button" class="mini-btn primary apc-inapp-alert-action" data-apc-alert-open="' + key + '" aria-label="' + escapeHtml(`${label}: ${item.title}`) + '">' + escapeHtml(label) + '</button>'
          : '') +
      '</li>';
    }).join('');
    const more = alertItems.length > 3 ? 'আরও ' + bn(alertItems.length - 3) + 'টি' : '';
    alertCard.innerHTML =
      alertHeader('Active Plus আপডেট', 'নতুন নোটিফিকেশন' + (alertItems.length > 1 ? ' · ' + bn(alertItems.length) + 'টি' : '')) +
      '<ul>' + rows + '</ul>' +
      (more ? '<p class="apc-alert-note">' + more + ' নোটিফিকেশন অপেক্ষা করছে।</p>' : '') +
      alertFooter('<button type="button" class="mini-btn primary" data-apc-alert-all>সব দেখুন' + (more ? ' (' + more + ')' : '') + '</button>');
    alertMode = 'items';
    alertBackdrop.hidden = false;
    alertCard.hidden = false;
  }

  /* The same sheet, explaining that system notifications are off. Used by the
     bell and by the notification pill (js/notifications.js). */
  function showInfo(kind = 'denied') {
    if (!document.body) return false;
    const chosen = INFO_COPY[kind] ? kind : 'denied';
    ensureAlertShell();
    alertCard.innerHTML =
      alertHeader('Active Plus', 'নোটিফিকেশন বন্ধ') +
      '<p class="apc-alert-copy">' + INFO_COPY[chosen] + '</p>' +
      alertFooter('');
    alertMode = 'info';
    alertBackdrop.hidden = false;
    alertCard.hidden = false;
    return true;
  }

  /** The settings screen asks for one sample card, on the same sheet. */
  function showPreview(item = {}) {
    if (!document.body) return false;
    alertItems = [{
      key: `preview:${Date.now()}`,
      preview: true,
      kind: item.kind || 'notice',
      title: item.title || 'এটি একটি প্রিভিউ',
      body: item.body || 'নতুন নোটিশ, পরীক্ষা ও ফলাফলের খবর ঠিক এভাবেই দেখতে পাবেন।'
    }];
    paintAlerts();
    return true;
  }

  let pumping = false;
  async function pumpAlerts() {
    if (pumping || typeof api.takeAlerts !== 'function') return;
    pumping = true;
    try {
      // Never over a lock/login screen: wait for the signed-in panel.
      if (typeof api.whenReady === 'function' && !(await api.whenReady())) return;
      const incoming = api.takeAlerts() || [];
      if (!incoming.length) return;
      const keys = new Set(incoming.map(item => item.key));
      alertItems = [...incoming, ...alertItems.filter(item => !keys.has(item.key))];
      paintAlerts();
    } finally {
      pumping = false;
    }
  }
  window.addEventListener('apc-inapp-alerts', () => { void pumpAlerts(); });
  void pumpAlerts();

  function repaint() {
    paint();
    if (alertMode !== 'items' || !alertItems.length || typeof api.unreadKeys !== 'function') return;
    let unread = null;
    try { unread = new Set(api.unreadKeys()); } catch { return; }
    alertItems = alertItems.filter(item => item.preview || unread.has(item.key));
    if (alertItems.length) paintAlerts();
    else hideAlerts();
  }
  window.addEventListener('apc-notifications-updated', repaint);
  window.addEventListener('apc-notification', repaint);
  window.addEventListener('apc-notification-settings', repaint);
  window.addEventListener('apc-sync-updated', event => {
    const collection = event?.detail?.collection;
    if (!collection || REFRESH_COLLECTIONS.includes(collection)) repaint();
  });
  window.addEventListener('storage', event => {
    if (!event.key || REFRESH_KEYS.includes(event.key)) repaint();
  });
  window.addEventListener('focus', repaint);

  center = {
    paint,
    open,
    showInfo,
    showPreview,
    readAll,
    setFilter: value => { filter = value === 'all' ? 'all' : 'unread'; paint(); },
    filter: () => filter,
    close: () => show(false),
    refresh: () => { try { api.refresh?.(); } catch { /* ignore */ } paint(); },
    isOpen: () => !modal.hidden
  };
  paint();
  void paintPush();
  window.apcNoticeCenter = center;
  return center;
}

export function noticeCenter() {
  return center;
}
