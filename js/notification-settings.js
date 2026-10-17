import { iconMarkup } from './icons.js';
import { listNotifications, SECTION_LABEL } from './notification-store.js';
/* Settings → Notification Settings.

   One screen owns every notification choice a person has:
     • the master switch (off = nothing, anywhere)
     • the browser permission (asked here, on the first enable)
     • system / background notifications (the tray, when the app is closed)
     • the sound that goes with an in-app card
     • the in-app card itself
     • a preview, so nobody has to guess what a notification looks like
     • "mark everything read" and the history of what has arrived

   It never asks for the browser permission on its own: the permission request
   only happens when the person turns the switch on. A denied permission leaves
   the whole in-app half working — which is the promise the screen states.

   The screen is mounted into a view (index.html) and reads everything through
   the running notification engine (window.apcNotifications). */

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bn = value => String(value).replace(/\d/g, digit => BN_DIGITS[Number(digit)]);

const PERMISSION_COPY = Object.freeze({
  granted: { text: 'ব্রাউজার অনুমতি দেওয়া আছে — নোটিফিকেশন ফোনেই আসবে।', action: '' },
  default: { text: 'এখনো অনুমতি দেওয়া হয়নি। চালু করলে ব্রাউজার অনুমতি চাইবে।', action: 'অনুমতি দিন' },
  denied: { text: 'ব্রাউজার সেটিংসে নোটিফিকেশন ব্লক করা আছে। অনুমতি ছাড়াও অ্যাপের ভেতরের নোটিফিকেশন কাজ করবে।', action: 'কীভাবে চালু করবেন' },
  unsupported: { text: 'এই ব্রাউজারে সিস্টেম নোটিফিকেশন নেই — অ্যাপের ভেতরের নোটিফিকেশন কাজ করবে।', action: '' }
});

let root = null;
let controller = null;
let repaintSoon = null;

const $ = selector => root?.querySelector(selector);

function whenText(record) {
  const at = Date.parse(record?.createdAt || '') || Number(record?.at) || 0;
  if (!at) return '';
  const date = new Date(at);
  try { return date.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return date.toLocaleString(); }
}

function ready() {
  if (controller) return controller;
  controller = window.apcNotifications || null;
  return controller;
}

/* The notification engine is started by the page shell (js/realtime-sync-entry.js
   imports it on every panel). This screen never imports it itself: the engine is
   a per-page singleton and starting it from here would mount the inbox at the
   wrong moment. It waits for the running engine instead. */
function waitForEngine(timeout = 10000) {
  if (ready()) return Promise.resolve(controller);
  return new Promise(resolve => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (ready() || Date.now() - started > timeout) {
        window.clearInterval(timer);
        resolve(controller);
      }
    }, 120);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/* ---- rendering ---------------------------------------------------------------- */

function toggleRow(id, label, note, checked, disabled = false) {
  return '<label class="settings-toggle notice-setting-row">' +
      '<span class="settings-copy"><strong>' + esc(label) + '</strong><small>' + esc(note) + '</small></span>' +
      '<span class="toggle-switch"><input type="checkbox" id="' + id + '" ' + (checked ? 'checked ' : '') + (disabled ? 'disabled' : '') + '><i></i></span>' +
    '</label>';
}

function historyRows(records) {
  if (!records.length) return '<p class="admin-empty">এখনো কোনো নোটিফিকেশন আসেনি।</p>';
  return records.slice(0, 20).map(record => {
    const section = SECTION_LABEL[record.type] || record.section || 'নোটিশ';
    return '<button type="button" class="notice-history-row' + (record.read === false ? ' unread' : '') + '" data-notice-history="' + esc(record.key) + '">' +
        '<span class="notice-history-copy"><strong>' + esc(record.title) + '</strong>' +
        '<small>' + esc(section) + ' • ' + esc(whenText(record)) + '</small></span>' +
        '<span class="notice-history-tag">' + (record.read === false ? 'অপঠিত' : 'পড়া হয়েছে') + '</span>' +
      '</button>';
  }).join('');
}

function paint() {
  if (!root) return;
  const api = ready();
  if (!api) {
    root.innerHTML = '<p class="admin-empty">নোটিফিকেশন সিস্টেম চালু হচ্ছে…</p>';
    return;
  }
  const settings = api.settings ? api.settings() : { enabled: true, sound: true, background: true, inApp: true };
  const permission = typeof api.permission === 'function' ? api.permission() : 'unsupported';
  const state = PERMISSION_COPY[permission] || PERMISSION_COPY.unsupported;
  const unread = typeof api.unread === 'function' ? api.unread() : 0;
  const records = typeof api.records === 'function' ? api.records() : listNotifications('');
  const off = settings.enabled === false;

  root.innerHTML =
    '<div class="profile-section"><p class="eyebrow">নোটিফিকেশন</p>' +
      '<div class="settings-list">' +
        toggleRow('noticeMasterToggle', 'নোটিফিকেশন চালু', 'বন্ধ করলে কোনো নোটিফিকেশন আসবে না — বাকি সব তথ্য অক্ষত থাকবে।', settings.enabled) +
      '</div>' +
      '<p class="form-note">' + (off
        ? 'নোটিফিকেশন বন্ধ আছে। চালু করলে নতুন নোটিশ, পরীক্ষা, ফলাফল ও পেমেন্টের খবর পাবেন।'
        : 'নোটিফিকেশন চালু আছে' + (unread ? ` — ${bn(unread)}টি অপঠিত।` : '।')) + '</p>' +
    '</div>' +

    '<div class="profile-section"><p class="eyebrow">ব্রাউজার ও ব্যাকগ্রাউন্ড</p>' +
      '<div class="settings-list">' +
        '<div class="notice-permission-row">' +
          '<span class="settings-copy"><strong>ব্রাউজার অনুমতি</strong><small data-notice-permission-copy>' + esc(state.text) + '</small></span>' +
          (state.action ? '<button type="button" class="mini-btn" data-notice-permission>' + esc(state.action) + '</button>' : '<span class="notice-permission-ok">✓ চালু</span>') +
        '</div>' +
        toggleRow('noticeBackgroundToggle', 'ব্যাকগ্রাউন্ড নোটিফিকেশন',
          'অ্যাপ বন্ধ বা ব্যাকগ্রাউন্ডে থাকলেও ফোনে খবর আসবে (যেখানে ব্রাউজার সমর্থন করে)।',
          settings.background, off || permission !== 'granted') +
        toggleRow('noticeInAppToggle', 'অ্যাপের ভেতরের নোটিফিকেশন',
          'অ্যাপ খোলা থাকলে সুন্দর কার্ডে নোটিফিকেশন দেখাবে — অনুমতি ছাড়াও কাজ করে।', settings.inApp, off) +
      '</div>' +
    '</div>' +

    '<div class="profile-section"><p class="eyebrow">শব্দ ও প্রিভিউ</p>' +
      '<div class="settings-list">' +
        toggleRow('noticeSoundToggle', 'নোটিফিকেশনের শব্দ', 'নতুন নোটিফিকেশন এলে ছোট একটি টোন বাজবে।', settings.sound, off) +
        '<button type="button" class="settings-row-button" data-notice-preview>' +
          '<span class="settings-copy"><strong>প্রিভিউ দেখুন</strong><small>একটি নমুনা নোটিফিকেশন কার্ড দেখুন</small></span>' +
          '<span class="notice-history-tag">প্রিভিউ</span>' +
        '</button>' +
        '<button type="button" class="settings-row-button" data-notice-read-all-settings' + (unread ? '' : ' disabled') + '>' +
          '<span class="settings-copy"><strong>সব পড়া হিসেবে চিহ্নিত করুন</strong><small>' +
            (unread ? `${bn(unread)}টি অপঠিত নোটিফিকেশন পড়া হিসেবে চিহ্নিত হবে` : 'এখন কোনো অপঠিত নোটিফিকেশন নেই') +
          '</small></span>' +
          '<span class="notice-history-tag">' + (unread ? bn(unread) : '০') + '</span>' +
        '</button>' +
      '</div>' +
    '</div>' +

    '<div class="profile-section"><p class="eyebrow">ইতিহাস</p>' +
      '<div class="notice-history-list">' + historyRows(records) + '</div>' +
      '<p class="form-note">পুরোনো নোটিফিকেশন কখনো মুছে যায় না — এখানে সবসময় দেখা যাবে।</p>' +
    '</div>';
}

/* The screen is small (a few switches and the last 20 records), so a change
   repaints straight away; a pending deferred paint is cancelled instead of
   stacking. Nothing here waits for a timer the page might not run. */
function schedulePaint() {
  if (repaintSoon) { clearTimeout(repaintSoon); repaintSoon = null; }
  paint();
}

/**
 * @param {object} options { mount: selector or element }
 * @returns {{ paint: Function }}
 */
export function initNotificationSettings({ mount } = {}) {
  root = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!root || root.dataset.ready === '1') return { paint };
  root.dataset.ready = '1';
  paint();
  void waitForEngine().then(found => { if (found) paint(); });

  root.addEventListener('change', event => {
    const input = event.target;
    if (!input?.id) return;
    const api = ready();
    if (!api?.saveSettings) return;
    const patch = {
      noticeMasterToggle: { enabled: input.checked },
      noticeBackgroundToggle: { background: input.checked },
      noticeInAppToggle: { inApp: input.checked },
      noticeSoundToggle: { sound: input.checked }
    }[input.id];
    if (!patch) return;
    const next = api.saveSettings(patch);
    if (input.id === 'noticeMasterToggle' && next.enabled) {
      // First enable asks the browser — never before the person asked.
      if (typeof api.enable === 'function') void api.enable().then(() => paint());
      return;
    }
    paint();
  });

  root.addEventListener('click', async event => {
    const api = ready();
    if (event.target.closest('[data-notice-permission]')) {
      if (typeof api?.enable === 'function') { await api.enable(); paint(); }
      else if (typeof window.apcNoticeCenter?.showInfo === 'function') window.apcNoticeCenter.showInfo('unsupported');
      return;
    }
    if (event.target.closest('[data-notice-preview]')) {
      if (typeof api?.preview === 'function') api.preview();
      else if (typeof window.apcNoticeCenter?.showPreview === 'function') window.apcNoticeCenter.showPreview();
      return;
    }
    if (event.target.closest('[data-notice-read-all-settings]')) {
      if (typeof api?.markAllRead === 'function') api.markAllRead();
      paint();
      return;
    }
    const row = event.target.closest('[data-notice-history]');
    if (!row) return;
    const key = row.dataset.noticeHistory;
    const record = (api?.records ? api.records() : []).find(item => item.key === key);
    if (!record) return;
    if (typeof api?.markRead === 'function') api.markRead([key]);
    if (typeof api?.openItem === 'function') void api.openItem(record);
    paint();
  });

  window.addEventListener('apc-notifications-updated', schedulePaint);
  window.addEventListener('apc-notification-settings', schedulePaint);
  window.addEventListener('apc-notification', schedulePaint);
  window.addEventListener('storage', event => {
    if (!event.key || String(event.key).includes('notification')) schedulePaint();
  });
  return { paint };
}

/** Exported for the shell: the count line the Settings entry shows. */
export function notificationSettingsSummary() {
  const api = window.apcNotifications;
  const unread = typeof api?.unread === 'function' ? api.unread() : 0;
  return unread ? `${bn(unread)}টি অপঠিত` : 'নতুন কিছু নেই';
}

export { iconMarkup };
