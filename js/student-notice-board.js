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
  const items = [...published];
  if (broadcast) items.push({ ...broadcast, revision: broadcast.key });
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
  try { return new Date(stamp).toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return new Date(stamp).toLocaleString(); }
}

function categoryFor(item) {
  return NOTICE_CATEGORIES.find(category => category.id === item.category) || noticeCategoryInfo(item.category);
}

function cardMarkup(item, read) {
  const category = categoryFor(item);
  const urgency = item.category === 'urgent' ? ' urgent' : '';
  const title = text(item.title) || 'নোটিশ';
  const body = text(item.body);
  const key = esc(item.key);
  return '<article class="notice-board-card' + urgency + (read ? ' is-read' : ' is-unread') + '" data-notice-card="' + key + '">' +
    '<div class="notice-board-card-head"><span class="notice-board-tag notice-board-tag-' + category.id + '">' + esc(category.label) + '</span>' +
      '<span class="notice-board-read-state">' + (read ? 'পড়া হয়েছে ✓' : 'অপঠিত') + '</span></div>' +
    '<h2>' + esc(title) + '</h2>' +
    (body ? '<p>' + esc(body.length > 160 ? body.slice(0, 157) + '…' : body) + '</p>' : '') +
    '<div class="notice-board-card-foot"><time>' + esc(whenText(item)) + '</time>' +
      '<button type="button" class="notice-board-open" data-notice-board-open="' + key + '" aria-controls="noticeBoardDetail">Notice খুলুন</button></div>' +
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
  button.textContent = read ? 'পড়া হয়েছে ✓' : 'Read ✓';
  button.disabled = read;
  root.querySelector('#noticeBoardReadStatus').textContent = read
    ? 'এই notice পড়া হিসেবে সংরক্ষিত।'
    : 'Notice পড়া শেষ হলে Read ✓ চাপো।';
  detail.hidden = false;
}

function updateTileBadge(count) {
  const badge = document.getElementById('noticeBoardUnreadBadge');
  const tile = badge?.closest('.notice-board-shortcut');
  if (!badge) return;
  badge.hidden = count === 0;
  badge.textContent = count > 9 ? '৯+' : String(count).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]);
  if (tile) tile.setAttribute('aria-label', `Notice Board${count ? ` — ${count}টি অপঠিত` : ''}`);
}

/** Home preview: the three newest notices this student may see. It is the
    same boardItems() reader the Notice Board paints, so a notice can never
    appear on Home while being missing from the board. */
function paintHomeNotices() {
  const mount = document.getElementById('homeNoticeList');
  if (!mount) return;
  const student = (homeGetter || getStudent)() || {};
  const viewer = {
    kind: 'student', studentId: text(student.id || student.studentId),
    className: text(student.className), group: text(student.group)
  };
  const receipts = readReceipts(viewer.studentId);
  const items = boardItems(viewer).slice(0, 3);
  if (!items.length) {
    mount.innerHTML = '<p class="notice-board-empty">এখনো কোনো notice প্রকাশিত হয়নি।</p>';
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
    ? `${unreadItems.length}টি notice এখনো পড়া হয়নি${items.length > unreadItems.length ? ` · মোট ${items.length}টি` : ''}`
    : items.length ? 'সব notice পড়া হয়েছে ✓' : 'এখনো কোনো notice প্রকাশিত হয়নি।';
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
    list.innerHTML = '<div class="notice-board-empty"><strong>Notice Board খালি</strong><p>নতুন notice প্রকাশ হলে এখানে দেখা যাবে।</p></div>';
  } else if (!visible.length) {
    const category = NOTICE_CATEGORIES.find(item => item.id === selectedCategory);
    list.innerHTML = '<div class="notice-board-empty"><strong>' + esc(category?.label || 'এই বিভাগ') + ' notice নেই</strong><p>অন্য বিভাগ বেছে দেখতে পারো।</p></div>';
  } else {
    list.innerHTML = visible.map(item => cardMarkup(item, itemIsRead(item, viewer.studentId, receipts))).join('');
  }

  const selected = items.find(item => item.key === selectedKey);
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

function openItem(keyOrId) {
  const items = boardItems();
  const item = items.find(entry => entry.key === keyOrId || entry.sourceId === keyOrId);
  if (!item) return false;
  selectedKey = item.key;
  paint();
  const detail = root.querySelector('#noticeBoardDetail');
  detail?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
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
      const previous = selectedKey;
      selectedKey = '';
      paint();
      [...root.querySelectorAll('[data-notice-board-open]')]
        .find(button => button.dataset.noticeBoardOpen === previous)?.focus?.();
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
      if (!saved) root.querySelector('#noticeBoardReadStatus').textContent = 'এই ডিভাইসে Read state সংরক্ষণ হয়নি; এই সেশনে চিহ্নটি দেখা যাবে।';
      return;
    }
    const openButton = event.target.closest('[data-notice-board-open]');
    if (openButton) openItem(openButton.dataset.noticeBoardOpen);
  });

  window.addEventListener('apc-notice-open', event => openItem(String(event.detail?.key || event.detail?.id || '')));
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

  const api = { refresh: () => { const result = paint(); paintHomeNotices(); return result; }, open: openItem, home: paintHomeNotices };
  window.apcStudentNoticeBoard = api;
  return api;
}
