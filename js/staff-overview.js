/* Optional compact Staff Management Overview renderer.

   Admin Account/Profile does not mount this widget; the dedicated Staff
   Management view remains the canonical searchable directory and owns every
   management action. Count-only mode omits rows, search, credentials,
   assignments and mutation controls.

   This is a VIEW onto the one Staff Management system, never a second one:
   every row is a js/staff-directory.js record. Optional non-compact embeds use
   the same openProfile / openEdit / changeStatus actions as the main section.

   Presentation and wiring only — no storage key, no role rule and no new
   permission: visibility is the `staff.manage` capability on the mount card
   and mutations are refused again by js/staff-directory.js without an Admin
   session. */

import { listStaff, canManageStaff, STAFF_ROLE_META, STAFF_STATUS } from './staff-directory.js';
import { openProfile, openEdit, changeStatus } from './staff-management.js';
import { escapeHtml } from './sanitize.js';
import { toBanglaNumber } from './ui.js';

const bn = toBanglaNumber;
const PAGE_SIZE_FULL = 6;
const PAGE_SIZE_COMPACT = 4;

const mounted = [];

/** One compact row: identity, role, responsibility and status, then actions. */
function rowHtml(record, { canManage, compact }) {
  const meta = STAFF_ROLE_META[record.role] || STAFF_ROLE_META.other;
  const status = STAFF_STATUS[record.status] || STAFF_STATUS.inactive;
  const assignment = record.assignment || {};
  const duty = [
    ...(assignment.classes || []),
    ...(assignment.classSubjects ? Object.keys(assignment.classSubjects) : []),
    ...(assignment.subjects || []),
    assignment.designation,
    assignment.counter
  ].filter(Boolean);
  const dutyText = [...new Set(duty)].slice(0, 4).join(' • ');
  const initials = String(record.fullName || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(word => [...word][0]).join('').toUpperCase() || '?';
  return `
    <article class="staff-overview-row" data-overview-staff="${escapeHtml(record.staffId)}">
      <span class="staff-overview-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
      <div class="staff-overview-identity">
        <strong>${escapeHtml(record.fullName)}</strong>
        <p class="staff-overview-meta">
          <span class="staff-id-badge">${escapeHtml(record.staffId)}</span>
          <span class="staff-tag role-${escapeHtml(record.role)}">${escapeHtml(meta.labelBn)}</span>
          ${compact ? '' : `<span class="staff-overview-login">${escapeHtml(record.username)}</span>`}
        </p>
        ${!compact && dutyText ? `<p class="staff-overview-duty">${escapeHtml(dutyText)}</p>` : ''}
      </div>
      <div class="staff-overview-side">
        <span class="badge ${status.className}">${escapeHtml(status.label)}</span>
        ${canManage && !compact ? `
        <div class="staff-overview-actions">
          <button class="mini-btn" type="button" data-overview-action="view" data-staff-id="${escapeHtml(record.staffId)}">দেখুন</button>
          <button class="mini-btn" type="button" data-overview-action="edit" data-staff-id="${escapeHtml(record.staffId)}">সম্পাদনা</button>
          <button class="mini-btn" type="button" data-overview-action="status" data-staff-id="${escapeHtml(record.staffId)}" data-next-status="${record.status === 'active' ? 'inactive' : 'active'}">${record.status === 'active' ? 'নিষ্ক্রিয় করুন' : 'সক্রিয় করুন'}</button>
        </div>` : ''}
      </div>
    </article>`;
}

function shellHtml({ title, compact, countOnly, withSearch }) {
  return `
    <header class="admin-card-head">
      <div><h2>${escapeHtml(title)}</h2></div>
      <button class="mini-btn" type="button" data-overview-action="open-full">সম্পূর্ণ স্টাফ ম্যানেজমেন্ট</button>
    </header>
    ${withSearch ? `
    <div class="staff-overview-toolbar">
      <input class="staff-overview-search" type="search" data-overview-search placeholder="নাম, Staff ID, ইউজারনেম বা মোবাইল" aria-label="স্টাফ অনুসন্ধান">
      <select class="staff-overview-filter" data-overview-role aria-label="রোল ফিল্টার">
        <option value="all">সব রোল</option>
        ${Object.entries(STAFF_ROLE_META).map(([key, meta]) => `<option value="${escapeHtml(key)}">${escapeHtml(meta.labelBn)}</option>`).join('')}
      </select>
      <select class="staff-overview-filter" data-overview-status aria-label="স্ট্যাটাস ফিল্টার">
        <option value="all">সব স্ট্যাটাস</option>
        ${Object.entries(STAFF_STATUS).map(([key, meta]) => `<option value="${escapeHtml(key)}">${escapeHtml(meta.label)}</option>`).join('')}
      </select>
    </div>` : ''}
    <div class="staff-overview-count" data-overview-count role="status" aria-live="polite"></div>
    ${countOnly ? '' : '<div class="staff-overview-list" data-overview-list></div>'}
    ${compact ? '' : `
    <div class="staff-overview-pager">
      <button class="mini-btn" type="button" data-overview-action="prev">আগের</button>
      <span class="staff-overview-page" data-overview-page></span>
      <button class="mini-btn" type="button" data-overview-action="next">পরের</button>
    </div>`}`;
}

/**
 * Mount one overview widget.
 * @param {{ mount: string|Element, onNavigate?: (view: string) => void,
 *          onToast?: (text: string) => void, compact?: boolean, countOnly?: boolean, title?: string }} options
 */
export function mountStaffOverview({ mount, onNavigate, onToast, compact = false, countOnly = false, title = 'স্টাফ ম্যানেজমেন্ট ওভারভিউ' } = {}) {
  const root = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!root || root.dataset.overviewReady === '1') {
    const existing = mounted.find(item => item.root === root);
    if (existing) void refreshOne(existing);
    return existing || { refresh: async () => {} };
  }
  root.dataset.overviewReady = '1';
  const notify = typeof onToast === 'function' ? onToast : () => {};
  const navigate = typeof onNavigate === 'function' ? onNavigate : () => {};
  const state = { query: '', role: 'all', status: 'all', page: 1, rows: [], canManage: false, compact, countOnly, title };
  const api = { root, state, refresh: () => refreshOne(api) };

  root.classList.toggle('is-compact', compact);
  root.classList.toggle('is-count-only', countOnly);
  root.innerHTML = shellHtml({ title, compact, countOnly, withSearch: !compact && !countOnly });
  const listHost = root.querySelector('[data-overview-list]');
  const countHost = root.querySelector('[data-overview-count]');
  const pageHost = root.querySelector('[data-overview-page]');

  const filtered = () => {
    const text = state.query.trim().toLocaleLowerCase();
    const compactQuery = text.replace(/[\s-]/g, '');
    return state.rows.filter(record => {
      if (state.role !== 'all' && record.role !== state.role) return false;
      if (state.status !== 'all' && record.status !== state.status) return false;
      if (!text) return true;
      const haystack = [record.staffId, record.fullName, record.username, record.mobile, String(record.role || '')]
        .map(value => String(value ?? '').toLocaleLowerCase());
      return haystack.some(value => value.includes(text))
        || (compactQuery ? haystack.some(value => value.replace(/[\s-]/g, '').includes(compactQuery)) : false);
    });
  };

  const paint = () => {
    const rows = filtered();
    const pageSize = state.compact ? PAGE_SIZE_COMPACT : PAGE_SIZE_FULL;
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (state.page > pages) state.page = pages;
    const slice = rows.slice((state.page - 1) * pageSize, state.page * pageSize);
    if (countHost) countHost.textContent = rows.length ? `${bn(rows.length)} জন স্টাফ` : 'কোনো স্টাফ পাওয়া যায়নি';
    if (pageHost) pageHost.textContent = `${bn(state.page)} / ${bn(pages)}`;
    if (listHost) {
      listHost.innerHTML = slice.length
        ? slice.map(record => rowHtml(record, { canManage: state.canManage, compact: state.compact })).join('')
        : '<p class="admin-empty">এই ফিল্টারে কোনো স্টাফ নেই।</p>';
    }
    root.querySelectorAll('[data-overview-action="prev"]').forEach(button => { button.disabled = state.page <= 1; });
    root.querySelectorAll('[data-overview-action="next"]').forEach(button => { button.disabled = state.page >= pages; });
  };

  const load = async () => {
    if (listHost) listHost.innerHTML = '<p class="admin-empty">লোড হচ্ছে…</p>';
    else if (countHost) countHost.textContent = 'স্টাফের সংখ্যা লোড হচ্ছে…';
    try {
      const [rows, canManage] = await Promise.all([listStaff(), canManageStaff()]);
      state.rows = rows;
      state.canManage = canManage;
      paint();
    } catch (error) {
      const message = escapeHtml(error?.message || 'স্টাফ তালিকা লোড হয়নি।');
      if (listHost) {
        listHost.innerHTML = `<div class="admin-empty" role="alert"><p>${message}</p><button class="mini-btn" type="button" data-overview-action="retry">আবার চেষ্টা করুন</button></div>`;
      } else if (countHost) {
        countHost.innerHTML = `<span role="alert">${message}</span> <button class="mini-btn" type="button" data-overview-action="retry">আবার চেষ্টা করুন</button>`;
      }
    }
  };
  api.reload = load;

  root.addEventListener('input', event => {
    const search = event.target.closest('[data-overview-search]');
    if (!search) return;
    state.query = search.value || '';
    state.page = 1;
    paint();
  });
  root.addEventListener('change', event => {
    const role = event.target.closest('[data-overview-role]');
    const status = event.target.closest('[data-overview-status]');
    if (role) { state.role = role.value; state.page = 1; paint(); }
    if (status) { state.status = status.value; state.page = 1; paint(); }
  });
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-overview-action]');
    if (!button) return;
    const action = button.dataset.overviewAction;
    const staffId = button.dataset.staffId || '';
    if (action === 'open-full') { navigate('staff'); return; }
    if (action === 'prev') { state.page = Math.max(1, state.page - 1); paint(); return; }
    if (action === 'next') { state.page += 1; paint(); return; }
    if (action === 'retry') { await load(); return; }
    if (!state.canManage) {
      notify('শুধুমাত্র Admin স্টাফ অ্যাকাউন্ট দেখতে বা বদলাতে পারবেন।');
      return;
    }
    button.disabled = true;
    try {
      if (action === 'view') await openProfile(staffId);
      else if (action === 'edit') await openEdit(staffId);
      else if (action === 'status') {
        // changeStatus runs the same mutation + toast as the full section.
        await changeStatus(staffId, button.dataset.nextStatus || 'inactive');
      }
    } finally {
      button.disabled = false;
      await load();
    }
  });

  mounted.push(api);
  void load();
  return api;
}

/** Refresh every mounted overview (staff changed somewhere in the panel). */
export async function refreshStaffOverviews() {
  await Promise.all(mounted.map(async api => {
    try {
      if (api.reload) await api.reload();
      else await refreshOne(api);
    } catch { /* each widget paints its own error state */ }
  }));
}

async function refreshOne(api) {
  if (api?.reload) return api.reload();
}
