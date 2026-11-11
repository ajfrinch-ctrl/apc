import {
  NOTIFICATION_CATEGORIES, NOTIFICATION_PRIORITIES, notificationPresentation
} from './notification-presentation.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const bn = value => String(value).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]);
const dateText = value => {
  const stamp = Number(value?.at) || Date.parse(String(value?.createdAt || ''));
  if (!Number.isFinite(stamp) || !stamp) return 'সময় পাওয়া যায়নি';
  try { return new Intl.DateTimeFormat('bn-BD', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(stamp)); }
  catch { return new Date(stamp).toLocaleString(); }
};

export function mountNotificationHistory(api, { mount = null, page = false, onBack = null } = {}) {
  if (!api || typeof api.history !== 'function') return null;
  let root = document.querySelector('[data-apc-notification-history]');
  if (root?.__apcHistoryController) {
    root.__apcHistoryController.setPage?.({ mount, page, onBack });
    return root.__apcHistoryController;
  }
  if (!root) {
    root = document.createElement('main');
    root.className = 'apc-notification-history';
    root.dataset.apcNotificationHistory = '';
    root.hidden = true;
    root.innerHTML =
      '<header class="apc-history-header">' +
        '<button type="button" class="apc-history-back" data-apc-history-back aria-label="ফিরে যান">←</button>' +
        '<div><h1>নোটিফিকেশন হিস্টোরি</h1><p data-apc-history-count></p></div>' +
        '<button type="button" class="apc-history-read-all" data-apc-history-read-all>সব পঠিত করুন</button>' +
      '</header>' +
      '<section class="apc-history-tools" aria-label="হিস্টোরি ফিল্টার">' +
        '<label class="apc-history-search"><span>খুঁজুন</span><input type="search" data-apc-history-search placeholder="শিরোনাম বা বার্তা লিখুন"></label>' +
        '<label><span>ক্যাটাগরি</span><select data-apc-history-category><option value="all">সব ক্যাটাগরি</option></select></label>' +
        '<label><span>Priority</span><select data-apc-history-priority><option value="all">সব Priority</option></select></label>' +
        '<label><span>পঠিত অবস্থা</span><select data-apc-history-read><option value="all">সব</option><option value="unread">অপঠিত</option><option value="read">পঠিত</option></select></label>' +
      '</section>' +
      '<section class="apc-history-list" data-apc-history-list aria-live="polite"></section>' +
      '<section class="apc-history-detail" data-apc-history-detail hidden></section>';
    document.body.append(root);
    const category = root.querySelector('[data-apc-history-category]');
    for (const item of NOTIFICATION_CATEGORIES) {
      const option = document.createElement('option');
      option.value = item.id; option.textContent = item.label; category.append(option);
    }
    const priority = root.querySelector('[data-apc-history-priority]');
    for (const item of NOTIFICATION_PRIORITIES) {
      const option = document.createElement('option');
      option.value = item.id; option.textContent = item.label; priority.append(option);
    }
  }

  let pageMode = Boolean(page);
  let backHandler = onBack;
  const applyPageMode = (options = {}) => {
    pageMode = Boolean(options.page);
    if (typeof options.onBack === 'function') backHandler = options.onBack;
    const destination = typeof options.mount === 'string' ? document.querySelector(options.mount) : options.mount;
    if (destination && root.parentElement !== destination) destination.append(root);
    root.classList.toggle('is-page', pageMode);
  };
  applyPageMode({ mount, page, onBack });

  const list = root.querySelector('[data-apc-history-list]');
  const detail = root.querySelector('[data-apc-history-detail]');
  const count = root.querySelector('[data-apc-history-count]');
  const search = root.querySelector('[data-apc-history-search]');
  const category = root.querySelector('[data-apc-history-category]');
  const priority = root.querySelector('[data-apc-history-priority]');
  const readFilter = root.querySelector('[data-apc-history-read]');
  let selected = null;
  let opened = false;

  const records = () => {
    try { return Array.isArray(api.history()) ? api.history() : []; }
    catch { return []; }
  };

  function renderDetail(record) {
    if (!record) { detail.hidden = true; detail.innerHTML = ''; return; }
    const view = notificationPresentation({ kind: record.type, category: record.category, priority: record.priority });
    detail.hidden = false;
    detail.innerHTML =
      '<div class="apc-history-detail-top"><button type="button" data-apc-history-detail-back>← হিস্টোরিতে ফিরুন</button>' +
      '<span class="apc-history-priority is-' + esc(view.priority) + '">' + esc(view.priorityLabel) + '</span></div>' +
      '<p class="apc-history-meta">' + esc(view.categoryLabel) + ' · ' + esc(dateText(record)) + '</p>' +
      '<h2>' + esc(record.title || 'নোটিফিকেশন') + '</h2>' +
      '<div class="apc-history-message">' + esc(record.message || 'বিস্তারিত বার্তা নেই।') + '</div>' +
      '<p class="apc-history-meta">' + (record.read === true ? 'পঠিত' : 'অপঠিত') + '</p>' +
      '<div class="apc-history-detail-actions">' +
        (record.read === true ? '<span class="apc-history-read-state">✓ পঠিত</span>' : '<button type="button" data-apc-history-mark-read>পঠিত হিসেবে চিহ্নিত করুন</button>') +
        (record.targetType ? '<button type="button" data-apc-history-open-target>সংশ্লিষ্ট অংশ খুলুন</button>' : '') +
      '</div>';
    detail.dataset.key = record.key || '';
    detail.querySelector('[data-apc-history-open-target]')?.addEventListener('click', () => {
      const targetRecord = selected;
      close();
      try { void api.openItem?.(targetRecord); } catch {}
    });
  }

  function render() {
    const all = records();
    const query = String(search.value || '').trim().toLocaleLowerCase();
    const selectedCategory = category.value;
    const selectedPriority = priority.value;
    const selectedRead = readFilter.value;
    const visible = all.filter(record => {
      const view = notificationPresentation({ kind: record.type, category: record.category, priority: record.priority });
      if (selectedCategory !== 'all' && view.category !== selectedCategory) return false;
      if (selectedPriority !== 'all' && view.priority !== selectedPriority) return false;
      if (selectedRead === 'read' && record.read !== true) return false;
      if (selectedRead === 'unread' && record.read === true) return false;
      if (query && ![record.title, record.message, record.type].some(value => String(value || '').toLocaleLowerCase().includes(query))) return false;
      return true;
    });
    count.textContent = all.length ? bn(all.length) + 'টি আর্কাইভ করা নোটিফিকেশন' : '৩০ দিনের বেশি পুরোনো নোটিফিকেশন এখানে থাকবে';
    root.querySelector('[data-apc-history-read-all]').hidden = !all.some(record => record.read === false);
    if (!visible.length) {
      list.innerHTML = '<div class="apc-history-empty"><strong>কোনো নোটিফিকেশন পাওয়া যায়নি</strong><p>ফিল্টার পরিবর্তন করে আবার দেখুন।</p></div>';
      return;
    }
    list.innerHTML = visible.map(record => {
      const view = notificationPresentation({ kind: record.type, category: record.category, priority: record.priority });
      return '<button type="button" class="apc-history-card' + (record.read === true ? '' : ' is-unread') + '" data-apc-history-open="' + esc(record.key) + '">' +
        '<span class="apc-history-card-copy"><strong>' + esc(record.title || 'নোটিফিকেশন') + '</strong>' +
        '<span>' + esc(record.message || '') + '</span><small>' + esc(view.categoryLabel) + ' · ' + esc(dateText(record)) + '</small></span>' +
        '<span class="apc-history-priority is-' + esc(view.priority) + '">' + esc(view.priorityLabel) + '</span></button>';
    }).join('');
  }

  function open() {
    opened = true; selected = null;
    detail.hidden = true;
    root.hidden = false;
    render();
    root.querySelector('[data-apc-history-back]')?.focus();
    document.body.dataset.apcHistoryOpen = 'true';
  }
  function close() {
    opened = false; selected = null;
    root.hidden = true;
    delete document.body.dataset.apcHistoryOpen;
  }
  function leave() {
    if (pageMode && typeof backHandler === 'function') backHandler();
    else close();
  }

  if (!root.dataset.apcBound) {
    root.dataset.apcBound = 'true';
    root.addEventListener('input', event => { if (event.target === search) render(); });
    root.addEventListener('change', event => {
      if ([category, priority, readFilter].includes(event.target)) render();
    });
    root.addEventListener('click', event => {
      if (event.target.closest('[data-apc-history-back]')) { leave(); return; }
      if (event.target.closest('[data-apc-history-detail-back]')) { selected = null; renderDetail(null); return; }
      if (event.target.closest('[data-apc-history-read-all]')) {
        const keys = records().filter(record => record.read === false).map(record => record.key).filter(Boolean);
        try { if (keys.length) api.markRead?.(keys); } catch {}
        render(); return;
      }
      const card = event.target.closest('[data-apc-history-open]');
      if (card) {
        selected = records().find(record => record.key === card.dataset.apcHistoryOpen) || null;
        if (selected) {
          try { api.markRead?.([selected.key]); selected = { ...selected, read: true }; } catch {}
          renderDetail(selected);
          render();
        }
        return;
      }
      if (event.target.closest('[data-apc-history-mark-read]') && selected) {
        try { api.markRead?.([selected.key]); } catch {}
        selected = { ...selected, read: true };
        renderDetail(selected); render();
        return;
      }
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && opened) leave(); });
  }
  const controller = { open, close, refresh: render, isOpen: () => opened, setPage: applyPageMode };
  root.__apcHistoryController = controller;
  return controller;
}
