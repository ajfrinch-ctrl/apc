/* Student Notice Board — categorized school notices, separate from the bell inbox.
   A notice stays unread until the student explicitly presses “Read ✓”. */
import { KEYS } from './database.js';
import { loadNotices } from './office-data.js';
import { loadAppConfig } from './storage.js';
import {
  NOTICE_BOARD_READ_PREFIX, NOTICE_CATEGORIES, audienceMatches, broadcastItem, noticeCategory, noticeCategoryInfo,
  noticeItem
} from './notification-rules.js';
import { notificationByKey, markRead } from './notification-store.js';

const READ_PREFIX = NOTICE_BOARD_READ_PREFIX;

const toBn = value => String(value).replace(/[0-9]/g, digit => '০১২৩৪৫৬৭৮৯'[digit]);
const MAX_READ_KEYS = 600;
const text = value => String(value ?? '').trim();
const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let root = null;
let getStudent = () => ({});
let homeGetter = null;
let selectedCategory = 'all';
let selectedKey = '';
let sessionRead = new Set();

function studentViewer() {
  const student = getStudent() || {};
  const id = text(student.id || student.studentId);
  return { kind: 'student', studentId: id, className: text(student.className), group: text(student.group) };
}

function receiptKey(studentId) {
  return READ_PREFIX + encodeURIComponent(studentId || 'guest');
}

function readReceipts(studentId) {
  const key = receiptKey(studentId);
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return { keys: new Set(), corrupt: false };
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !Array.isArray(saved.keys)) {
      return { keys: new Set(), corrupt: true };
    }
    return { keys: new Set(saved.keys.filter(item => typeof item === 'string')), corrupt: false };
  } catch { return { keys: new Set(), corrupt: true }; }
}

function boardItems(viewerOverride = null) {
  const viewer = viewerOverride || studentViewer();
  if (!viewer.studentId) return [];
  let notices = [];
  try { notices = loadNotices(); } catch { notices = []; }
  const published = notices
    .filter(notice => notice && typeof notice === 'object' && notice.id)
    .filter(notice => !notice.status || notice.status === 'published')
    .filter(notice => audienceMatches(notice, viewer))
    .map(notice => {
      const item = noticeItem(notice);
      return item ? {
        ...item,
        sourceId: String(notice.id),
        category: noticeCategory(notice),
        revision: item.key,
        kind: 'notice'
      } : null;
    })
    .filter(Boolean);

  let broadcast = null;
  try { broadcast = broadcastItem(loadAppConfig()); } catch { broadcast = null; }
  /* One board row per source record and per key: a duplicated notice id or a
     broadcast that repeats a notice key must never paint twice. Newer source
     rows win so an edited notice replaces its stale copy. */
  const bySource = new Map();
  for (const item of published) {
    const sourceTag = item.sourceId ? `${item.source}:${item.sourceId}` : item.key;
    const kept = bySource.get(sourceTag);
    if (!kept || (Number(item.at) || 0) > (Number(kept.at) || 0)) bySource.set(sourceTag, item);
  }
  const items = [];
  const keys = new Set();
  const push = item => {
    if (item && item.key && !keys.has(item.key)) { keys.add(item.key); items.push(item); }
  };
  bySource.forEach(push);
  if (broadcast) push({ ...broadcast, revision: broadcast.key });
  return items.sort((left, right) => {
    const severity = Number(right.category === 'urgent') - Number(left.category === 'urgent');
    return severity || (Number(right.at) || 0) - (Number(left.at) || 0);
  });
}

function notificationRead(item, studentId) {
  const record = notificationByKey(`student:${studentId}`, item.key);
  return record?.read === true;
}

function itemIsRead(item, studentId, receipts) {
  return sessionRead.has(JSON.stringify([studentId, item.key])) || receipts.keys.has(item.key) || notificationRead(item, studentId);
}

function whenText(item) {
  const stamp = Number(item?.at) || Date.parse(item?.updatedAt || item?.createdAt || '') || 0;
  if (!stamp) return 'সাম্প্রতিক';
  /* বাংলা তারিখ + সময়ের পর্ব, কখনো AM/PM নয়। */
  try {
    const date = new Date(stamp);
    const day = date.toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
    const hour = date.getHours();
    const phase = hour < 5 ? 'রাত' : hour < 12 ? 'সকাল' : hour < 15 ? 'দুপুর' : hour < 18 ? 'বিকাল' : hour < 20 ? 'সন্ধ্যা' : 'রাত';
    const clock = toBn(`${hour % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')}`);
    return `${day}, ${phase} ${clock}`;
  } catch { return new Date(stamp).toISOString().slice(0, 10); }
}

function categoryFor(item) {
  return NOTICE_CATEGORIES.find(category => category.id === item.category) || noticeCategoryInfo(item.category);
}

const expandedCardKeys = new Set();

function cardPreview(rawBody, maxChars = 140) {
  const normalized = text(rawBody).replace(/\s*\r?\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  const sliced = normalized.slice(0, maxChars);
  const boundary = sliced.lastIndexOf(' ');
  return `${(boundary > 80 ? sliced.slice(0, boundary) : sliced).trim()}…`;
}

function isLongNoticeBody(rawBody, maxChars = 140) {
  const clean = text(rawBody);
  if (!clean) return false;
  return clean.length > maxChars || clean.split(/\r?\n/).length > 2;
}

function cardMarkup(item, read) {
  const category = categoryFor(item);
  const urgency = item.category === 'urgent' ? ' urgent' : '';
  const title = text(item.title) || 'নোটিশ';
  const body = text(item.body);
  const key = esc(item.key);
  const longBody = isLongNoticeBody(body);
  const expanded = longBody && expandedCardKeys.has(item.key);
  const bodyMarkup = body
    ? (expanded
      ? '<div class="notice-content notification-body">' + esc(body) + '</div>'
      : '<p class="notice-card-preview">' + esc(longBody ? cardPreview(body) : body) + '</p>')
    : '';
  const expandButton = longBody
    ? '<button type="button" class="notice-board-expand" data-notice-board-expand="' + key + '" aria-expanded="' + (expanded ? 'true' : 'false') + '">' + (expanded ? 'সংক্ষিপ্ত করুন' : 'আরও দেখুন') + '</button>'
    : '';
  return '<article class="notice-board-card' + urgency + (read ? ' is-read' : ' is-unread') + (expanded ? ' is-expanded' : '') + '" data-notice-card="' + key + '">' +
    '<div class="notice-board-card-head"><span class="notice-board-tag notice-board-tag-' + category.id + '">' + esc(category.label) + '</span>' +
      '<span class="notice-board-read-state">' + (read ? 'পড়া হয়েছে ✓' : 'অপঠিত') + '</span></div>' +
    '<h2>' + esc(title) + '</h2>' +
    bodyMarkup +
    '<div class="notice-board-card-foot"><time>' + esc(whenText(item)) + '</time>' +
      '<div class="notice-board-card-actions">' + expandButton + '<button type="button" class="notice-board-open" data-notice-board-open="' + key + '" aria-controls="noticeBoardDetail">নোটিশ খুলুন</button></div></div>' +
  '</article>';
}

function paintDetail(item, studentId, receipts) {
  const detail = root.querySelector('#noticeBoardDetail');
  if (!detail || !item) { if (detail) detail.hidden = true; return; }
  const category = categoryFor(item);
  const read = itemIsRead(item, studentId, receipts);
  root.querySelector('#noticeBoardDetailCategory').textContent = category.label;
  root.querySelector('#noticeBoardDetailCategory').className = `notice-board-tag notice-board-tag-${category.id}`;
  root.querySelector('#noticeBoardDetailTitle').textContent = text(item.title) || 'নোটিশ';
  root.querySelector('#noticeBoardDetailTime').textContent = whenText(item);
  root.querySelector('#noticeBoardDetailBody').textContent = text(item.body);
  const button = root.querySelector('#noticeBoardReadButton');
  button.dataset.noticeBoardRead = item.key;
  button.textContent = 'পড়া হয়েছে ✓';
  button.disabled = read;
  root.querySelector('#noticeBoardReadStatus').textContent = read
    ? 'এই নোটিশ পড়া হিসেবে সংরক্ষিত হয়েছে ✓'
    : 'পড়া শেষ হলে «পড়া হয়েছে ✓» চাপুন।';
  detail.hidden = false;
}

function updateTileBadge(count) {
  const formatted = count > 9 ? '৯+' : String(count).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]);
  const label = `নোটিশ বোর্ড${count ? ` — ${toBn(count)}টি অপঠিত` : ''}`;
  const badge = document.getElementById('noticeBoardUnreadBadge');
  const tile = badge?.closest('.notice-board-shortcut');
  if (badge) {
    badge.hidden = count === 0;
    badge.textContent = count === 0 ? '' : formatted;
  }
  if (tile) tile.setAttribute('aria-label', label);
  document.querySelectorAll('[data-notice-unread-badge]').forEach(node => {
    node.hidden = count === 0;
    node.textContent = count === 0 ? '' : formatted;
  });
  const moreRow = document.querySelector('#profileView .notice-board-more-row');
  if (moreRow) moreRow.setAttribute('aria-label', label);
  const homeTile = document.querySelector('#homeView .notice-board-shortcut');
  if (homeTile) homeTile.setAttribute('aria-label', label);
}

/** Home preview: the unread badge on the services tile and the More row, plus
    the optional #homeNoticeList strip. Uses the exact same boardItems() reader
    as the Notice Board so Home, More menu, and Notice Board stay synchronized.
    (The one-click card that used to sit above the hero was removed on the
    owner's review — Home now keeps only the tile and the menu row.) */
function paintHomeNotices() {
  const student = (homeGetter || getStudent)() || {};
  const viewer = {
    kind: 'student', studentId: text(student.id || student.studentId),
    className: text(student.className), group: text(student.group)
  };
  const receipts = readReceipts(viewer.studentId);
  const allItems = boardItems(viewer);
  const unreadItems = allItems.filter(item => !itemIsRead(item, viewer.studentId, receipts));
  updateTileBadge(unreadItems.length);

  const mount = document.getElementById('homeNoticeList');
  if (!mount) return;
  const items = allItems.slice(0, 3);
  if (!items.length) {
    mount.innerHTML = '<p class="notice-board-empty">এখনো কোনো নোটিশ প্রকাশিত হয়নি।</p>';
    return;
  }
  mount.innerHTML = items.map(item => {
    const category = categoryFor(item);
    const read = itemIsRead(item, viewer.studentId, receipts);
    return '<article class="notice-board-card notice-board-card-compact' + (read ? ' is-read' : ' is-unread') + '" data-notice-card="' + esc(item.key) + '">' +
      '<div class="notice-board-card-head"><span class="notice-board-tag notice-board-tag-' + category.id + '">' + esc(category.label) + '</span>' +
        '<span class="notice-board-read-state">' + (read ? 'পড়া হয়েছে ✓' : 'অপঠিত') + '</span></div>' +
      '<h2>' + esc(item.title) + '</h2>' +
      '<div class="notice-board-card-foot"><time>' + esc(whenText(item)) + '</time>' +
        '<button type="button" class="notice-board-open" data-view="notice-board" data-notice-home-open="' + esc(item.key) + '">পড়ুন</button></div>' +
    '</article>';
  }).join('');
  mount.querySelectorAll('[data-notice-home-open]').forEach(button => button.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('apc-notice-open', { detail: { key: button.dataset.noticeHomeOpen } }));
  }));
}

function paint() {
  if (!root) return { total: 0, unread: 0 };
  const viewer = studentViewer();
  const receipts = readReceipts(viewer.studentId);
  const items = boardItems();
  const unreadItems = items.filter(item => !itemIsRead(item, viewer.studentId, receipts));
  const visible = selectedCategory === 'all' ? items : items.filter(item => item.category === selectedCategory);
  const summary = root.querySelector('#noticeBoardSummary');
  summary.textContent = unreadItems.length
    ? `${toBn(unreadItems.length)}টি নোটিশ এখনো পড়া হয়নি${items.length > unreadItems.length ? ` · মোট ${toBn(items.length)}টি` : ''}`
    : items.length ? 'সব নোটিশ পড়া হয়েছে ✓' : 'এখনো কোনো নোটিশ প্রকাশিত হয়নি।';
  updateTileBadge(unreadItems.length);

  root.querySelectorAll('[data-notice-board-category]').forEach(tab => {
    const active = tab.dataset.noticeBoardCategory === selectedCategory;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', active ? 'true' : 'false');
    const categoryId = tab.dataset.noticeBoardCategory;
    const matching = categoryId === 'all' ? items : items.filter(item => item.category === categoryId);
    let count = tab.querySelector('.notice-board-category-count');
    if (!count) {
      count = document.createElement('span');
      count.className = 'notice-board-category-count';
      count.setAttribute('aria-hidden', 'true');
      tab.append(count);
    }
    count.textContent = String(matching.length).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]);
  });

  const list = root.querySelector('#noticeBoardList');
  if (!items.length) {
    list.innerHTML = '<div class="notice-board-empty"><strong>এখনো কোনো নোটিশ নেই</strong><p>নতুন নোটিশ প্রকাশ হলে এখানে দেখা যাবে।</p></div>';
  } else if (!visible.length) {
    const category = NOTICE_CATEGORIES.find(item => item.id === selectedCategory);
    list.innerHTML = '<div class="notice-board-empty"><strong>' + esc(category?.label || 'এই বিভাগ') + ' বিভাগে নোটিশ নেই</strong><p>অন্য বিভাগ বেছে দেখতে পারো।</p></div>';
  } else {
    list.innerHTML = visible.map(item => cardMarkup(item, itemIsRead(item, viewer.studentId, receipts))).join('');
  }

  const selected = items.find(item => item.key === selectedKey);
  if (list) list.hidden = Boolean(selected);
  document.body.classList.toggle('notice-board-detail-open', Boolean(selected));
  if (selected) paintDetail(selected, viewer.studentId, receipts);
  else {
    selectedKey = '';
    const detail = root.querySelector('#noticeBoardDetail');
    if (detail) detail.hidden = true;
  }
  paintHomeNotices();
  return { total: items.length, unread: unreadItems.length };
}

function persistRead(item, studentId) {
  sessionRead.add(JSON.stringify([studentId, item.key]));
  const key = receiptKey(studentId);
  const receipts = readReceipts(studentId);
  if (receipts.corrupt) return false;
  const keys = [...new Set([...receipts.keys, item.key])].slice(-MAX_READ_KEYS);
  try {
    window.localStorage.setItem(key, JSON.stringify({ version: 1, keys }));
    return true;
  } catch { return false; }
}

function closeDetail() {
  const previous = selectedKey;
  if (!previous) return;
  selectedKey = '';
  paint();
  [...root.querySelectorAll('[data-notice-board-open]')]
    .find(button => button.dataset.noticeBoardOpen === previous)?.focus?.();
}

function openItem(keyOrId) {
  try { window.__apcPendingNoticeOpen = null; } catch { /* ignore */ }
  const items = boardItems();
  const item = items.find(entry => entry.key === keyOrId || entry.sourceId === keyOrId);
  if (!item) return false;
  if (selectedCategory !== 'all' && item.category !== selectedCategory) selectedCategory = 'all';
  selectedKey = item.key;
  paint();
  const detail = root.querySelector('#noticeBoardDetail');
  detail?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  root.querySelector('#noticeBoardDetail [data-notice-board-close]')?.focus?.();
  return true;
}

export function paintHomeNoticePreview({ getStudent: getter } = {}) {
  if (typeof getter === 'function') homeGetter = getter;
  paintHomeNotices();
}

export function initStudentNoticeBoard({ getStudent: getter } = {}) {
  root = document.querySelector('#notice-boardView');
  getStudent = typeof getter === 'function' ? getter : () => ({});
  if (!root) return () => {};
  if (root.dataset.noticeBoardReady === '1') return paint;
  root.dataset.noticeBoardReady = '1';

  root.addEventListener('click', event => {
    const tab = event.target.closest('[data-notice-board-category]');
    if (tab) {
      selectedCategory = NOTICE_CATEGORIES.some(item => item.id === tab.dataset.noticeBoardCategory) || tab.dataset.noticeBoardCategory === 'all'
        ? tab.dataset.noticeBoardCategory : 'all';
      paint();
      return;
    }
    if (event.target.closest('[data-notice-board-close]')) {
      closeDetail();
      return;
    }
    const readButton = event.target.closest('[data-notice-board-read]');
    if (readButton) {
      const viewer = studentViewer();
      const item = boardItems().find(entry => entry.key === readButton.dataset.noticeBoardRead);
      if (!item || itemIsRead(item, viewer.studentId, readReceipts(viewer.studentId))) return;
      const saved = persistRead(item, viewer.studentId);
      const viewerKey = `student:${viewer.studentId}`;
      markRead(viewerKey, [item.key]);
      window.dispatchEvent(new CustomEvent('apc-notifications-updated', { detail: { noticeRead: item.key } }));
      paint();
      paintHomeNotices();
      if (!saved) root.querySelector('#noticeBoardReadStatus').textContent = 'এই ডিভাইসে পঠিত চিহ্ন সংরক্ষণ হয়নি; এই সেশনে চিহ্নটি দেখা যাবে।';
      return;
    }
    const expandButton = event.target.closest('[data-notice-board-expand]');
    if (expandButton) {
      event.preventDefault();
      event.stopPropagation();
      const key = expandButton.dataset.noticeBoardExpand;
      if (expandedCardKeys.has(key)) expandedCardKeys.delete(key);
      else expandedCardKeys.add(key);
      paint();
      return;
    }
    const openButton = event.target.closest('[data-notice-board-open]');
    if (openButton) { openItem(openButton.dataset.noticeBoardOpen); return; }
    const card = event.target.closest('[data-notice-card]');
    if (card && card.closest('#noticeBoardList')) openItem(card.dataset.noticeCard);
  });

  document.addEventListener('click', event => {
    const trigger = event.target?.closest?.('[data-view="notice-board"]');
    if (!trigger) return;
    const backBtn = root.querySelector('.pay-back');
    if (!backBtn) return;
    const fromMore = Boolean(trigger.closest('#profileView'));
    backBtn.dataset.view = fromMore ? 'profile' : 'home';
    backBtn.setAttribute('aria-label', fromMore ? 'আরও মেনুতে ফিরুন' : 'হোমে ফিরুন');
  }, true);

  window.addEventListener('apc-notice-open', event => openItem(String(event.detail?.key || event.detail?.id || '')));
  document.addEventListener('click', event => {
    if (!document.body.classList.contains('notice-board-detail-open')) return;
    if (event.target?.closest?.('#noticeBoardDetail, [data-notice-board-open], [data-notice-board-close], [data-notice-board-read], [data-notice-board-category], [data-notice-card], [data-notice-home-open], #homeNoticeList, #noticeModal, #apcNoticeModal, #apcAlertBackdrop, #apcInAppAlert, [data-apc-notice-open], [data-apc-alert-open], #notificationButton')) return;
    closeDetail();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeDetail();
  });
  window.addEventListener('storage', event => {
    if (!event.key || event.key === KEYS.notices || event.key === KEYS.settings || event.key.startsWith(READ_PREFIX)) paint();
  });
  window.addEventListener('apc-sync-updated', event => {
    if (!event.detail?.collection || ['notices', 'settings'].includes(event.detail.collection)) paint();
  });
  window.addEventListener('apc-notifications-updated', paint);
  window.addEventListener('apc-session-ready', paint);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') paint(); });
  paint();
  paintHomeNotices();

  try {
    const pending = window.__apcPendingNoticeOpen;
    if (pending && (!pending.at || Date.now() - Number(pending.at) < 20000)) {
      openItem(String(pending.key || pending.id || ''));
    }
  } catch { /* ignore */ }

  const api = { refresh: () => { const result = paint(); paintHomeNotices(); return result; }, open: openItem, home: paintHomeNotices };
  window.apcStudentNoticeBoard = api;
  return api;
}
