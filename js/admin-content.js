/* Admin content oversight — view and delete what teachers/managers published.

   Owner requirement (2026-10-19): the Admin can open every student-facing
   notice and every homework/suggestion record and delete any of them, with a
   confirm step; the Manager keeps the same power inside their own panel. This
   is review/moderation only — composing stays where it always was (teacher /
   manager composers), which keeps the "Admin does no daily work" boundary for
   write-side features while giving the owner the oversight path they asked for.

   The list repaints from the SAME stores the student board reads
   (js/office-data.js notices, js/teaching-data.js activities), so a delete is
   visible on the student notice board immediately (storage + apc-sync-updated
   propagation). Everything lives here so js/admin.js keeps no daily-write
   path of its own. */

import { loadNotices, saveNotices } from './office-data.js';
import { teachingRepository } from './teaching-data.js';
import { NOTICE_CATEGORIES } from './notification-rules.js';
import { escapeHtml } from './sanitize.js';

const CONTENT_TYPES = Object.freeze({ homework: 'বাড়ির কাজ', suggestion: 'সাজেশন' });
const state = { ready: false, toastFn: null, lectureHubPromise: null };

const categoryLabel = id => NOTICE_CATEGORIES.find(c => c.id === id)?.label || id || 'একাডেমিক';

function noticeScope(notice) {
  return [notice.className, notice.group].filter(Boolean).join(' • ') || 'সব শ্রেণি';
}

function noticeRow(notice) {
  const status = notice.status === 'draft' ? 'খসড়া' : 'প্রকাশিত';
  return `<article class="admin-card content-review-card">
    <header class="admin-card-head">
      <div><h3>${escapeHtml(notice.title || 'শিরোনাম নেই')}</h3>
      <p class="admin-view-sub">${escapeHtml(categoryLabel(notice.category))} • ${escapeHtml(noticeScope(notice))} • ${escapeHtml(notice.audience || 'সকল শিক্ষার্থী')} • ${escapeHtml(notice.date || '')}</p></div>
      <span class="badge ${notice.status === 'draft' ? 'badge-pending' : 'badge-approved'}">${status}</span>
    </header>
    <p>${escapeHtml(notice.body || '')}</p>
    <div class="row-actions">
      <button class="admin-btn danger" type="button" data-admin-content-action="delete-notice" data-id="${escapeHtml(notice.id || '')}">মুছুন</button>
    </div>
  </article>`;
}

function recordRow(activity) {
  const status = activity.status === 'draft' ? 'খসড়া' : 'প্রকাশিত';
  return `<article class="admin-card content-review-card">
    <header class="admin-card-head">
      <div><h3>${escapeHtml(activity.title || 'শিরোনাম নেই')}</h3>
      <p class="admin-view-sub">${escapeHtml(CONTENT_TYPES[activity.type] || activity.type || '')} • ${escapeHtml(activity.className || '')}${activity.group ? ` • ${escapeHtml(activity.group)}` : ''} • ${escapeHtml(activity.subject || '')} • ••••</p></div>
      <span class="badge ${activity.status === 'draft' ? 'badge-pending' : 'badge-approved'}">${status}</span>
    </header>
    <p>${escapeHtml(activity.details || 'অতিরিক্ত বিবরণ নেই।')}</p>
    <div class="row-actions">
      <button class="admin-btn danger" type="button" data-admin-content-action="delete-content" data-id="${escapeHtml(activity.id || '')}">মুছুন</button>
    </div>
  </article>`;
}

/** Repaint both lists from the shared stores. Never throws into the shell. */
export function renderAdminContent() {
  const noticeHost = document.getElementById('adminNoticeReviewList');
  const recordHost = document.getElementById('adminContentReviewList');
  if (!noticeHost && !recordHost) return;
  try {
    if (noticeHost) {
      const notices = loadNotices();
      noticeHost.innerHTML = notices.length
        ? notices.map(noticeRow).join('')
        : '<p class="admin-empty">এখনো কোনো নোটিশ জমা পড়েনি। শিক্ষক বা ম্যানেজার নোটিশ প্রকাশ করলে এখানে দেখা যাবে।</p>';
      const count = document.querySelector('[data-admin-content-count]');
      if (count) count.textContent = notices.length ? `${notices.length}টি` : '';
    }
    if (recordHost) {
      const activities = (teachingRepository && state.activities) || [];
      recordHost.innerHTML = activities.length
        ? activities.map(recordRow).join('')
        : '<p class="admin-empty">এখনো কোনো বাড়ির কাজ বা সাজেশন প্রকাশ করা হয়নি।</p>';
    }
  } catch (error) {
    console.warn('[Active Plus] content review render failed:', error?.message);
    if (noticeHost && !noticeHost.innerHTML) noticeHost.innerHTML = '<p class="admin-empty">কনটেন্ট পড়া যায়নি — আবার চেষ্টা করুন।</p>';
  }
}

function ensureAdminLectureHub() {
  const mount = document.getElementById('adminLectureSheetsMount');
  if (!mount) return Promise.resolve(null);
  if (!state.lectureHubPromise) {
    state.lectureHubPromise = import('./lecture-sheet-studio.js')
      .then(mod => mod.mountLectureSheetManager({
        mount,
        role: 'admin',
        toast: state.toastFn || (() => {})
      }))
      .catch(err => {
        state.lectureHubPromise = null;
        console.warn('[Active Plus] admin lecture studio mount failed:', err?.message || err);
        return null;
      });
  } else {
    state.lectureHubPromise = state.lectureHubPromise.then(async ctrl => {
      await ctrl?.refresh?.();
      return ctrl;
    });
  }
  return state.lectureHubPromise;
}

/** Load the teaching records the review list shows (admin session required by
 *  the repository itself). Called on view open and after every delete. */
export async function refreshAdminContentRecords() {
  try {
    const db = await teachingRepository.list({ role: 'admin' });
    state.activities = (db.activities || []).filter(a => ['homework', 'suggestion'].includes(a.type));
  } catch (error) {
    console.warn('[Active Plus] teaching content unavailable for review:', error?.message);
    state.activities = [];
  }
  renderAdminContent();
  await ensureAdminLectureHub();
}

/** Bind the confirm+delete handlers once (the shell may rebuild). */
export function initAdminContent({ toast } = {}) {
  if (typeof toast === 'function') state.toastFn = toast;
  const section = document.querySelector('#adminMain');
  if (!section || !document.querySelector('[data-view-panel="content"]') || section.dataset.contentWired === '1') return;
  section.dataset.contentWired = '1';
  const say = message => { if (typeof toast === 'function') toast(message); };
  section.addEventListener('click', async event => {
    const button = event.target.closest('[data-admin-content-action]');
    // The original notice/record controls now live in separate full views.
    if (!button || !button.closest('.admin-view[data-parent-view="content"]')) return;
    const action = button.dataset.adminContentAction;
    const id = String(button.dataset.id || '');
    if (!id) return;
    if (action === 'delete-notice') {
      if (!window.confirm('এই নোটিশটি মুছবেন? শিক্ষার্থীদের নোটিশ বোর্ড থেকেও সাথে সাথে সরে যাবে।')) return;
      try {
        const notices = loadNotices();
        const next = notices.filter(item => item?.id !== id);
        if (next.length === notices.length) { say('নোটিশটি পাওয়া যায়নি।'); return; }
        if (!saveNotices(next)) { say('নোটিশ মুছা যায়নি — ব্রাউজারের স্টোরেজ পরীক্ষা করুন।'); return; }
        renderAdminContent();
        say('নোটিশ মুছে ফেলা হয়েছে — শিক্ষার্থীদের বোর্ড থেকেও সরে গেছে।');
      } catch (error) { say(error.message || 'নোটিশ মুছা যায়নি।'); }
      return;
    }
    if (action === 'delete-content') {
      if (!window.confirm('এই কাজটি মুছবেন? শিক্ষার্থীদের তালিকা থেকেও সাথে সাথে সরে যাবে।')) return;
      try {
        await teachingRepository.deleteActivity(id, { role: 'admin', id: 'admin' });
        await refreshAdminContentRecords();
        say('কাজটি মুছে ফেলা হয়েছে — শিক্ষার্থীদের তালিকা থেকে সরে গেছে।');
      } catch (error) { say(error.message || 'কাজটি মুছা যায়নি।'); }
    }
  });
}
