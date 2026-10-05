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
 * The list has two answers: অপঠিত (default) and সব. The count on the bell comes
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
const KIND_ICON = Object.freeze({
  notice: 'icon-megaphone',
  broadcast: 'icon-bell',
  exam: 'icon-clipboard',
  homework: 'icon-clipboard',
  result: 'icon-award',
  registration: 'icon-users',
  'exam-soon': 'icon-clipboard',
  'exam-live': 'icon-clipboard',
  'exam-review': 'icon-clipboard',
  'exam-returned': 'icon-clipboard',
  'exam-approved': 'icon-clipboard',
  approved: 'icon-award',
  rejected: 'icon-bell',
  payment: 'icon-bell',
  'payment-review': 'icon-bell',
  'payment-rejected': 'icon-bell'
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
const REFRESH_KEYS = Object.freeze(['activePlus.admin.notices.v1', 'activePlus.app.config.v1', 'active-plus-app-config-v1', 'activePlus.exams.v1', 'activePlus.teaching.v1', 'activePlus.admin.students.v1', 'activePlus.admin.transactions.v1']);
const REFRESH_COLLECTIONS = Object.freeze(['notices', 'settings', 'exams', 'teaching', 'students', 'transactions']);

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bn = value => String(value).replace(/\d/g, digit => BN_DIGITS[Number(digit)]);
/** 0 hides the badge, 1–9 shows the exact number, 10+ shows "১০+". */
export function unreadBadgeText(count) {
  const value = Number(count) || 0;
  if (value <= 0) return '';
  return value > 9 ? `${bn(10)}+` : bn(value);
}

let center = null;

/* ---- helpers ---------------------------------------------------------------- */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function whenText(item) {
  const at = Number(item?.at);
  if (Number.isFinite(at) && at > 0) {
    const date = new Date(at);
    try {
      return date.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return date.toLocaleString();
    }
  }
  return String(item?.audience || '');
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
  backdrop.className = 'modal-backdrop';
  backdrop.id = MODAL_ID;
  backdrop.hidden = true;
  backdrop.innerHTML =
    '<section class="modal" role="dialog" aria-modal="true" aria-labelledby="apcNoticeTitle">' +
      '<div class="modal-header"><div><p class="eyebrow">Active Plus আপডেট</p>' +
      '<h2 id="apcNoticeTitle">অ্যাকশন সেন্টার</h2></div>' +
      '<button type="button" class="modal-close" data-apc-notice-close aria-label="বন্ধ করুন">×</button></div>' +
      '<p class="notice-read-status" data-apc-notice-status role="status"></p>' +
      '<div class="notice-filters" role="tablist" aria-label="নোটিফিকেশন দেখার ধরন">' +
        '<button type="button" class="chip active" role="tab" aria-selected="true" data-apc-notice-filter="unread">অপঠিত<span data-apc-notice-unread-chip></span></button>' +
        '<button type="button" class="chip" role="tab" aria-selected="false" data-apc-notice-filter="all">সব</button>' +
        '<button type="button" class="mini-btn notice-read-all" data-apc-notice-read-all>সব পড়া করুন</button>' +
      '</div>' +
      '<div data-apc-notice-list></div>' +
      '<p class="form-note" data-apc-notice-push role="status"></p>' +
    '</section>';
  document.body.append(backdrop);
  return backdrop;
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
  if (center) return center;
  if (!api || typeof api.feed !== 'function') return null;

  const ownsModal = !document.getElementById('noticeModal');
  const modal = document.getElementById('noticeModal') || buildModal();
  const listBox = modal.querySelector('[data-apc-notice-list], #noticeListStudent');
  const statusLine = modal.querySelector('[data-apc-notice-status], #noticeReadStatus');
  const pushNote = modal.querySelector('[data-apc-notice-push]');
  let pushRow = null;
  let shownFeed = [];
  let filter = 'unread';

  /* The filter tabs and the "read all" action, for a page modal that has the
     list but not this shell (index.html). */
  let filterRow = modal.querySelector('.notice-filters');
  if (!filterRow && listBox) {
    filterRow = document.createElement('div');
    filterRow.className = 'notice-filters';
    filterRow.innerHTML =
      '<button type="button" class="chip active" role="tab" aria-selected="true" data-apc-notice-filter="unread">অপঠিত<span data-apc-notice-unread-chip></span></button>' +
      '<button type="button" class="chip" role="tab" aria-selected="false" data-apc-notice-filter="all">সব</button>' +
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
    if (visible) {
      modal.querySelector('[data-apc-notice-close]')?.focus?.();
      void paintPush();
    }
  }

  const separatesBoard = () => {
    try { return api.viewer?.().kind === 'student'; } catch { return false; }
  };
  const centerFeed = items => separatesBoard()
    ? items.filter(item => !['notice', 'broadcast'].includes(item.kind))
    : items;

  /* Unread state: the record store is authoritative. Student notices and
     broadcasts are counted on their separate Notice Board, not under the bell. */
  function unreadKeys(feed = []) {
    if (typeof api.unreadKeys === 'function') {
      try {
        const keys = new Set(api.unreadKeys());
        if (separatesBoard()) {
          const visible = new Set(feed.map(item => item.key));
          const filtered = new Set([...keys].filter(key => visible.has(key)));
          return { count: filtered.size, keys: filtered };
        }
        const count = typeof api.unread === 'function' ? Number(api.unread()) : keys.size;
        return { count: Number.isFinite(count) ? Math.max(0, count) : keys.size, keys };
      } catch { /* fall through to the receipts */ }
    }
    if (!separatesBoard() && typeof api.unread === 'function') {
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
  }

  function paintCard(item, unread) {
    const opens = item.actionable || Boolean(item.target) || typeof api.openItem === 'function';
    const label = actionLabel(item) || (item.actionable || item.target ? 'খুলুন' : '');
    const rowOpens = opens && !label;
    const action = label
      ? '<button type="button" class="mini-btn primary notice-action" data-apc-notice-open="' + escapeHtml(item.key) + '" aria-label="' + escapeHtml(`${label}: ${item.title}`) + '">' + escapeHtml(label) + '</button>'
      : '';
    return '<article class="notice-detail' + (unread ? ' unread' : '') + (rowOpens ? ' actionable' : '') + (label ? ' has-action' : '') + '"' +
      (rowOpens ? ' data-apc-notice-open="' + escapeHtml(item.key) + '" role="button" tabindex="0"' : '') + '>' +
      '<span class="notice-detail-icon' + (item.kind === 'broadcast' ? ' light' : '') + '">' + iconMarkup(item.kind) + '</span>' +
      '<div class="notice-detail-copy"><span class="notice-time">' + escapeHtml(whenText(item)) + '</span>' +
      '<span class="notice-section-chip">' + escapeHtml(sectionOf(item)) + '</span>' +
      '<h3>' + escapeHtml(item.title) + '</h3>' +
      (item.body ? '<p>' + escapeHtml(item.body) + '</p>' : '') + action + '</div>' +
      (unread ? '<span class="notice-unread-dot" aria-label="অপঠিত"></span>' : '') + '</article>';
  }

  function paint() {
    let feed = [];
    try { feed = centerFeed(api.feed() || []); } catch { feed = []; }
    const state = unreadKeys(feed);
    const unreadItems = feed.filter(item => isUnread(item, state));
    const unread = state.count === null ? unreadItems.length : state.count;
    shownFeed = feed;

    if (clearButton) clearButton.hidden = feed.length === 0;

    const chip = modal.querySelector('[data-apc-notice-unread-chip]');
    if (chip) chip.textContent = unread ? ` ${bn(unread)}` : '';
    paintBadge(unread);

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
      listBox.innerHTML = separatesBoard()
        ? emptyState('নতুন নোটিফিকেশন নেই', 'স্কুলের notice-গুলো আলাদা Notice Board-এ থাকে।')
        : emptyState('সব নোটিফিকেশন দেখা হয়েছে', 'নতুন কোনো নোটিফিকেশন নেই।');
      return { unread, total: 0 };
    }
    const visible = filter === 'unread' ? unreadItems : feed;
    listBox.innerHTML = visible.length
      ? visible.map(item => paintCard(item, isUnread(item, state))).join('')
      : emptyState('সব নোটিফিকেশন দেখা হয়েছে', 'এখন নতুন কোনো নোটিফিকেশন নেই।');
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
      off.className = 'mini-btn reject';
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
    on.className = 'mini-btn';
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

  function open() {
    hideAlerts();                              // the list shows them all
    filter = 'unread';
    paint();
    show(true);
  }

  /* One delegated click handler serves every panel and survives a shell that is
     painted after this module runs. */
  document.addEventListener('click', event => {
    const bell = event.target?.closest?.('#notificationButton');
    if (bell) { event.preventDefault(); open(); return; }
    if (!modal.contains(event.target)) return;
    const tab = event.target?.closest?.('[data-apc-notice-filter]');
    if (tab) { filter = tab.dataset.apcNoticeFilter === 'all' ? 'all' : 'unread'; paint(); return; }
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
    if (!ownsModal) return;
    if (event.target?.closest?.('[data-apc-notice-close]') || event.target === modal) show(false);
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
    if (typeof api.openItem === 'function') {
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
      paintAlerts();
      if (!item) return;
      if ((item.actionable || item.target) && typeof api.openItem === 'function') {
        void Promise.resolve(api.openItem(item)).finally(() => paint());
      } else open();
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
      const label = actionLabel(item) || (item.actionable || item.target ? 'খুলুন' : '');
      const key = escapeHtml(item.key);
      return '<li class="apc-inapp-alert-row">' +
        '<button type="button" class="apc-inapp-alert-item" data-apc-alert-open="' + key + '">' +
          '<span class="apc-inapp-alert-icon">' + iconMarkup(item.kind) + '</span>' +
          '<span><b>' + escapeHtml(item.title) + '</b>' + (item.body ? '<small>' + escapeHtml(item.body) + '</small>' : '') + '</span>' +
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
