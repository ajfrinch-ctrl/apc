/* Staff Management UI — the Admin Panel's staff module.

   Mobile-first: each person opens as a compact summary (name → Staff ID →
   role → status → mobile). A disclosure button reveals login/mobile/assignment
   and recent activity; View | Edit | More remain available, and More opens a
   bottom sheet holding Reset Password, Activate/Deactivate and Delete.

   Rules this UI enforces (and js/staff-directory.js enforces again server-side):

     • Staff ID is permanent — it is displayed, never editable, never reused
     • Students never appear here; a Staff ID is never a Student ID
     • A password is never displayed as plain text
     • Deleting a staff account asks for confirmation; when history is attached
       the delete is refused and deactivation is offered instead
     • The signed-in System Owner is marked Protected and cannot be
       deleted / deactivated / demoted from here
*/

import { enabledClasses } from './config.js';
import { listClasses } from './academics.js';
import { selectableSubjects } from './teacher-assignments.js';
import { toBanglaNumber } from './ui.js';
import { escapeHtml } from './sanitize.js';
import { iconMarkup, paintIcon } from './icons.js';
import { generateLoginId, isAutoLoginId } from './user-id.js';
import {
  CREATABLE_STAFF_ROLES,
  STAFF_ROLES,
  STAFF_ROLE_META,
  STAFF_STATUS,
  STAFF_STATUS_KEYS,
  STAFF_DIRECTORY_RULES,
  canManageStaff,
  createStaff,
  deleteStaff,
  findStaff,
  listStaff,
  resetStaffPassword,
  setStaffStatus,
  staffActivitySummary,
  staffCounts,
  staffRoleLabel,
  staffStatusLabel,
  updateStaff
} from './staff-directory.js';

const bn = toBanglaNumber;
const staffCollator = new Intl.Collator('bn', { numeric: true, sensitivity: 'base' });
const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const state = {
  query: '',
  role: 'all',
  status: 'all',
  sort: 'default',
  staff: [],
  counts: null,
  openMore: null,
  openDetails: null,
  pendingMoreFocusId: null,
  canManage: false,
  ready: false
};

let notify = () => {};

/* ---------------------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------------------ */

/** Every icon is an inline SVG from js/admin-icons.js inside a fixed
 *  container, so it can never overlap a label or another icon. */
function icon(key, className = 'staff-icon') {
  return iconMarkup(key, `${className} apc-icon-svg`);
}

const initialsOf = name => String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2)
  .map(word => [...word][0]).join('').toUpperCase() || '?';

function fieldRow(spec, value) {
  const { name, label, type = 'text', placeholder = '', hint = '', required = false, options = [], multiple = false, max = 120 } = spec;
  const text = String(value ?? '');
  const id = `staffField-${name}`;
  // A generated value has no form control to point at, so it gets a span
  // (a <label for> pointing at a div would be invalid).
  const labelHtml = type === 'auto-id'
    ? `<span class="auto-id-label" id="${id}-label">${escapeHtml(label)}${required ? ' *' : ''}</span>`
    : `<label for="${id}">${escapeHtml(label)}${required ? ' *' : ''}</label>`;
  let control;
  if (type === 'select') {
    control = `<select id="${id}" name="${name}"${multiple ? ' multiple size="4"' : ''}${required ? ' required' : ''}>
      ${options.map(option => {
        const optionValue = String(option.value ?? option);
        const optionLabel = String(option.label ?? option);
        const selected = multiple
          ? (Array.isArray(value) ? value.includes(optionValue) : false)
          : optionValue === text;
        return `<option value="${escapeHtml(optionValue)}"${selected ? ' selected' : ''}>${escapeHtml(optionLabel)}</option>`;
      }).join('')}
    </select>`;
  } else if (type === 'textarea') {
    control = `<textarea id="${id}" name="${name}" rows="3" maxlength="${max}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(text)}</textarea>`;
  } else if (type === 'auto-id') {
    // A generated Login User ID: shown, never typed. The value travels in a
    // hidden input so the form still submits it.
    control = `<div class="auto-id-preview" id="${id}" data-auto-id="true" aria-labelledby="${id}-label" aria-label="${escapeHtml(label)} — স্বয়ংক্রিয়ভাবে তৈরি, পরিবর্তন করা যায় না" role="status" aria-live="polite" aria-atomic="true" tabindex="0">${text ? escapeHtml(text) : '—'}</div>
      <input type="hidden" id="${id}-hidden" name="${name}" value="${escapeHtml(text)}">`;
  } else {
    const extra = type === 'date' ? '' : ` maxlength="${max}"`;
    control = `<input id="${id}" name="${name}" type="${type}" value="${escapeHtml(text)}" placeholder="${escapeHtml(placeholder)}"${extra}${required ? ' required' : ''}${type === 'password' ? ' autocomplete="new-password"' : ''}>`;
  }
  return `<div class="staff-field${type === 'textarea' ? ' wide' : ''}">
    ${labelHtml}${control}${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
  </div>`;
}

/** Every class a teacher may be given: the Admin's own Academic Setup first (a
    class created there is exactly what must be assignable - that is the point of
    the Setup), then the shipped config list. Before this the picker offered only
    the 12 built-in classes, so ষষ্ঠ/সপ্তম or any custom class could
    never reach a teacher, however often the Admin saved. */
function assignableClasses() {
  return [...new Set([...listClasses().map(item => item.name), ...enabledClasses])];
}
/** Extra fields per role: only what that role actually needs. */
function roleAssignmentFields(role, knownClasses = []) {
  if (role === 'teacher') {
    /* A class the record already carries stays selectable even if it was
       retired or renamed in the Setup: an option list without it would drop
       that class the moment the Admin saved for an unrelated edit. */
    const classes = [...new Set([...assignableClasses(), ...knownClasses.map(name => String(name || '').trim()).filter(Boolean)])];
    return [
      { name: 'classes', label: 'Assigned Class/শ্রেণি', type: 'select', multiple: true, options: classes.map(name => ({ value: name, label: name })), hint: 'তালিকা থেকে এক বা একাধিক শ্রেণি বেছে নিন' },
      { name: 'subjects', label: 'বিষয়সমূহ', placeholder: 'যেমন: উচ্চতর গণিত, পদার্থবিজ্ঞান', hint: 'কমা দিয়ে একাধিক বিষয় লিখুন' },
      { name: 'batches', label: 'ব্যাচ / বিভাগ', placeholder: 'যেমন: বিজ্ঞান বিভাগ, A ব্যাচ' }
    ];
  }
  if (role === 'manager') {
    return [
      { name: 'batches', label: 'দায়িত্বের স্কোপ (ব্যাচ/বিভাগ)', placeholder: 'যেমন: সব শ্রেণি, বিজ্ঞান বিভাগ' },
      { name: 'notes', label: 'দায়িত্বের বিবরণ', type: 'textarea', max: 300, placeholder: 'ম্যানেজারের দায়িত্ব সংক্ষেপে লিখুন' }
    ];
  }
  if (role === 'admin') {
    /* A directory Admin has no class/batch scope: the whole panel is the job.
       The note is the place to say what this particular Admin runs. */
    return [
      { name: 'notes', label: 'দায়িত্বের বিবরণ', type: 'textarea', max: 300, placeholder: 'যেমন: অর্থ ও স্টাফ ব্যবস্থাপনা, একাডেমিক তত্ত্বাবধান' }
    ];
  }
  if (role === 'cash-counter') {
    return [
      { name: 'counter', label: 'কাউন্টার / ডেস্ক', placeholder: 'যেমন: প্রধান কাউন্টার' },
      { name: 'notes', label: 'নোট', type: 'textarea', max: 300, placeholder: 'ক্যাশ কাউন্টারের নোট (ঐচ্ছিক)' }
    ];
  }
  return [
    { name: 'designation', label: 'পদবি / দায়িত্ব', placeholder: 'যেমন: লাইব্রেরিয়ান, সহকারী' },
    { name: 'notes', label: 'নোট', type: 'textarea', max: 300, placeholder: 'অতিরিক্ত তথ্য (ঐচ্ছিক)' }
  ];
}

/* ---------------------------------------------------------------------------
   Modal plumbing (one reusable glass dialog)
   ------------------------------------------------------------------------ */

function restoreMoreTriggerFocus(staffId) {
  const card = $$('#staffList .staff-card').find(item => item.dataset.staffCard === staffId);
  const more = card?.querySelector('.more-btn');
  const disclosure = card?.querySelector('.staff-details-toggle');
  const target = more && !more.closest('[hidden]') ? more : disclosure;
  (target || $('#staffSearch') || $('#staffSort') || $('#staffCreateButton'))?.focus({ preventScroll: true });
  state.pendingMoreFocusId = null;
}

function modalShell() {
  let backdrop = $('#staffModalBackdrop');
  if (backdrop) return backdrop;
  backdrop = document.createElement('div');
  backdrop.className = 'admin-modal-backdrop staff-modal-backdrop';
  backdrop.id = 'staffModalBackdrop';
  backdrop.hidden = true;
  backdrop.dataset.staffMoreSheet = '0';
  backdrop.innerHTML = `
    <section class="admin-modal staff-modal" role="dialog" aria-modal="true" aria-labelledby="staffModalTitle" tabindex="-1">
      <div class="admin-modal-header">
        <div><p class="eyebrow" id="staffModalKicker">Staff</p><h2 id="staffModalTitle">—</h2></div>
        <button class="admin-modal-close" type="button" data-staff-modal="close" aria-label="বন্ধ করুন">${icon('close', 'modal-close-icon')}</button>
      </div>
      <div class="admin-modal-body" id="staffModalBody"></div>
    </section>`;
  document.body.append(backdrop);
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) closeModal();
    if (event.target.closest('[data-staff-modal="close"]')) closeModal();
  });
  backdrop.querySelector('#staffModalBody').addEventListener('click', async event => {
    const button = event.target.closest('[data-staff-action]');
    if (!button) return;
    const { staffAction: action, staffId, nextStatus } = button.dataset;
    if (backdrop.dataset.staffMoreSheet === '1') {
      closeModal({ restoreFocus: false });
      if (action === 'reset') await openReset(staffId);
      else if (action === 'status') {
        await changeStatus(staffId, nextStatus || 'inactive');
        restoreMoreTriggerFocus(staffId);
      } else if (action === 'delete') await openDelete(staffId);
      return;
    }
    if (action === 'edit') {
      closeModal({ restoreFocus: false });
      await openEdit(staffId);
    } else if (action === 'confirm-delete') {
      await confirmDelete(staffId);
    } else if (action === 'deactivate') {
      closeModal({ restoreFocus: false });
      await changeStatus(staffId, 'inactive');
      restoreMoreTriggerFocus(staffId);
    }
  });
  return backdrop;
}

function openModal(kicker, title, bodyHtml, { wide = false, sheet = false } = {}) {
  const backdrop = modalShell();
  $('#staffModalKicker').textContent = kicker;
  $('#staffModalTitle').textContent = title;
  const body = $('#staffModalBody');
  body.innerHTML = bodyHtml;
  const dialog = backdrop.querySelector('.staff-modal');
  dialog.classList.toggle('is-wide', wide);
  dialog.classList.toggle('is-more-sheet', sheet);
  backdrop.classList.toggle('is-more-sheet', sheet);
  backdrop.dataset.staffMoreSheet = sheet ? '1' : '0';
  backdrop.hidden = false;
  document.body.classList.add('admin-modal-open');
  const focusable = body.querySelector('input:not([type=hidden]), select, textarea, button');
  focusable?.focus({ preventScroll: true });
  return body;
}

function closeModal({ restoreFocus = true } = {}) {
  const backdrop = $('#staffModalBackdrop');
  if (!backdrop) return;
  const wasMoreSheet = backdrop.dataset.staffMoreSheet === '1';
  backdrop.hidden = true;
  backdrop.dataset.staffMoreSheet = '0';
  delete backdrop.dataset.moreStaffId;
  backdrop.classList.remove('is-more-sheet');
  backdrop.querySelector('.staff-modal')?.classList.remove('is-more-sheet');
  $('#staffModalBody').innerHTML = '';
  document.body.classList.remove('admin-modal-open');
  if (wasMoreSheet) {
    state.openMore = null;
    renderList();
  }
  if (restoreFocus && state.pendingMoreFocusId) {
    restoreMoreTriggerFocus(state.pendingMoreFocusId);
  }
}

function modalError(message) {
  const box = $('#staffFormError');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

function clearModalError() {
  const box = $('#staffFormError');
  if (!box) return;
  box.textContent = '';
  box.hidden = true;
}

/* ---------------------------------------------------------------------------
   Rendering — stats, filters, cards
   ------------------------------------------------------------------------ */

function renderRoleFilter() {
  const host = $('#staffRoleFilter');
  if (!host) return;
  const options = [{ value: 'all', label: 'সব' }]
    .concat([...STAFF_ROLES].sort((a, b) => STAFF_ROLE_META[a].order - STAFF_ROLE_META[b].order)
      .map(role => ({ value: role, label: STAFF_ROLE_META[role].labelBn })));
  host.innerHTML = options.map(option => `
    <button class="chip${state.role === option.value ? ' active' : ''}" type="button" data-staff-role="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`).join('');
}

function renderStatusFilter() {
  const host = $('#staffStatusFilter');
  if (!host) return;
  const options = [{ value: 'all', label: 'সব' }]
    .concat(STAFF_STATUS_KEYS.map(key => ({ value: key, label: STAFF_STATUS[key].label })));
  host.innerHTML = options.map(option => `
    <button class="chip${state.status === option.value ? ' active' : ''}" type="button" data-staff-status="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`).join('');
}

function filteredStaff() {
  const text = state.query.trim().toLocaleLowerCase();
  const compact = text.replace(/[\s-]/g, '');
  return state.staff.filter(record => {
    if (state.role !== 'all' && record.role !== state.role) return false;
    if (state.status !== 'all' && record.status !== state.status) return false;
    if (!text) return true;
    const meta = STAFF_ROLE_META[record.role] || {};
    const haystack = [
      record.staffId, record.fullName, record.username, record.mobile,
      meta.labelBn, meta.label, record.assignment?.designation,
      ...(record.assignment?.classes || []), ...(record.assignment?.subjects || [])
    ].map(value => String(value ?? '').toLocaleLowerCase());
    return haystack.some(value => value.includes(text))
      || (compact ? haystack.some(value => value.replace(/[\s-]/g, '').includes(compact)) : false);
  });
}

function sortStaff(rows) {
  if (state.sort === 'default') return rows;
  const statusRank = { active: 0, inactive: 1, suspended: 2 };
  return [...rows].sort((a, b) => {
    if (state.sort === 'name') return staffCollator.compare(a.fullName || '', b.fullName || '');
    if (state.sort === 'id') return staffCollator.compare(a.staffId || '', b.staffId || '');
    if (state.sort === 'role') {
      const roleOrder = (STAFF_ROLE_META[a.role]?.order ?? 99) - (STAFF_ROLE_META[b.role]?.order ?? 99);
      return roleOrder || staffCollator.compare(a.fullName || '', b.fullName || '');
    }
    if (state.sort === 'status') {
      const statusOrder = (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99);
      return statusOrder || staffCollator.compare(a.fullName || '', b.fullName || '');
    }
    return 0;
  });
}

function staffMoreActionsHtml(record) {
  const staffId = escapeHtml(record.staffId);
  return `
    <div class="staff-more-menu" role="group" aria-label="স্টাফ অ্যাকশন">
      <button class="staff-more-item" type="button" data-staff-action="reset" data-staff-id="${staffId}">${icon('key', 'staff-inline-icon')}<span>পাসওয়ার্ড রিসেট</span></button>
      ${!record.protected ? `<button class="staff-more-item" type="button" data-staff-action="status" data-staff-id="${staffId}" data-next-status="${record.status === 'active' ? 'inactive' : 'active'}">
        ${icon(record.status === 'active' ? 'pause' : 'checkCircle', 'staff-inline-icon')}
        <span>${record.status === 'active' ? 'নিষ্ক্রিয় করুন' : 'সক্রিয় করুন'}</span>
      </button>` : ''}
      ${record.status === 'active' && !record.protected ? `<button class="staff-more-item" type="button" data-staff-action="status" data-staff-id="${staffId}" data-next-status="suspended">${icon('pause', 'staff-inline-icon')}<span>স্থগিত করুন</span></button>` : ''}
      ${!record.protected ? `<button class="staff-more-item danger" type="button" data-staff-action="delete" data-staff-id="${staffId}">${icon('trash', 'staff-inline-icon')}<span>মুছে ফেলুন</span></button>` : ''}
    </div>`;
}

function staffCard(record) {
  const meta = STAFF_ROLE_META[record.role] || STAFF_ROLE_META.other;
  const status = STAFF_STATUS[record.status] || STAFF_STATUS.inactive;
  const moreOpen = state.openMore === record.staffId;
  const detailsOpen = state.openDetails === record.staffId;
  const initials = escapeHtml(initialsOf(record.fullName));
  const detailId = `staff-details-${String(record.staffId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const assignment = [
    ...(record.assignment?.classes || []),
    ...(record.assignment?.subjects || []),
    record.assignment?.counter,
    record.assignment?.designation
  ].filter(Boolean).slice(0, 3);
  const history = Array.isArray(record.history) ? record.history.slice(-2).reverse() : [];
  const activity = history.length
    ? `<ul class="staff-recent-activity-list">${history.map(entry => `
        <li><small>${escapeHtml(String(entry.at || '').slice(0, 10))}</small><span>${escapeHtml(entry.detail || entry.action || 'কার্যক্রম')}</span></li>`).join('')}
      </ul>`
    : '<p class="staff-recent-activity-empty">সাম্প্রতিক কোনো অ্যাকাউন্ট কার্যক্রম নেই।</p>';
  return `
    <article class="staff-card${record.status === 'active' ? '' : ' is-inactive'}${record.protected ? ' is-protected' : ''}" data-staff-card="${escapeHtml(record.staffId)}">
      <div class="staff-card-head">
        <span class="staff-avatar" aria-hidden="true">${initials}</span>
        <div class="staff-card-identity">
          <strong class="staff-card-name">${escapeHtml(record.fullName)}</strong>
          <div class="staff-card-summary-line">
            <span class="staff-tag role-${escapeHtml(record.role)}">${escapeHtml(meta.labelBn)}</span>
            ${record.protected ? '<span class="staff-tag protected">Protected</span>' : ''}
          </div>
        </div>
        <div class="staff-card-head-side">
          <span class="badge ${status.className}">${escapeHtml(status.label)}</span>
          <button class="staff-details-toggle" type="button" data-staff-action="toggle-details" data-staff-id="${escapeHtml(record.staffId)}" aria-expanded="${detailsOpen}" aria-controls="${escapeHtml(detailId)}">
            ${icon('chevron-down', 'staff-details-chevron')}
            <span>${detailsOpen ? 'কম দেখান' : 'বিস্তারিত'}</span>
          </button>
        </div>
      </div>
      <div class="staff-card-details" id="${escapeHtml(detailId)}"${detailsOpen ? '' : ' hidden'}>
        <p class="staff-card-line"><span class="staff-meta">Staff ID: <span class="staff-id-badge">${escapeHtml(record.staffId)}</span></span></p>
        <p class="staff-card-line"><span class="staff-meta">Login User ID: <strong>${escapeHtml(record.username)}</strong></span></p>
        <p class="staff-card-line"><span class="staff-meta">${icon('phone', 'staff-inline-icon')} ${escapeHtml(record.mobile || 'মোবাইল নেই')}</span></p>
        ${assignment.length ? `<p class="staff-card-line"><span class="staff-meta">${icon('book', 'staff-inline-icon')} ${escapeHtml(assignment.join(' • '))}</span></p>` : ''}
        ${record.protected ? '<p class="staff-protected-note">' + icon('shield', 'staff-inline-icon') + ' Current Admin → Protected • এই পরিচয় মুছে বা নিষ্ক্রিয় করা যায় না</p>' : ''}
        <p class="staff-password-note">${icon('lock', 'staff-inline-icon')} ${record.mustChangePassword ? 'প্রথম লগইনে পাসওয়ার্ড বদল করতে হবে' : 'পাসওয়ার্ড এখানে দেখানো হয় না; বদলাতে আরও → পাসওয়ার্ড রিসেট ব্যবহার করুন'}</p>
        <section class="staff-recent-activity" aria-label="সাম্প্রতিক কার্যক্রম">
          <h3>সাম্প্রতিক কার্যক্রম</h3>${activity}
        </section>
        <div class="staff-card-actions">
          <button class="mini-btn" type="button" data-staff-action="view" data-staff-id="${escapeHtml(record.staffId)}">${icon('eye', 'staff-inline-icon')}<span>দেখুন</span></button>
          <button class="mini-btn" type="button" data-staff-action="edit" data-staff-id="${escapeHtml(record.staffId)}">${icon('edit', 'staff-inline-icon')}<span>সম্পাদনা</span></button>
          <button class="mini-btn more-btn" type="button" data-staff-action="more" data-staff-id="${escapeHtml(record.staffId)}" aria-haspopup="dialog" aria-expanded="${moreOpen}" aria-controls="staffModalBackdrop">${icon('more', 'staff-inline-icon')}<span>আরও</span></button>
        </div>
      </div>
    </article>`;
}

function renderList() {
  const host = $('#staffList');
  if (!host) return;
  const rows = sortStaff(filteredStaff());
  const clearBtn = $('#staffSearchClear');
  if (clearBtn) clearBtn.hidden = !state.query.trim();
  const counter = $('#staffCountBadge');
  if (counter) {
    counter.textContent = rows.length
      ? `${bn(rows.length)} জন স্টাফ দেখা যাচ্ছে`
      : 'কোনো স্টাফ পাওয়া যায়নি';
  }
  if (!state.staff.length) {
    host.innerHTML = `<div class="admin-empty apc-empty-state" role="status">
      <span class="apc-empty-icon" aria-hidden="true">${iconMarkup('staff', 'apc-icon-svg')}</span>
      <p>এখনো কোনো স্টাফ অ্যাকাউন্ট নেই। নিচের “নতুন স্টাফ তৈরি করুন” বাটনে চেপে প্রথম স্টাফ যোগ করুন।</p>
      ${state.canManage ? '<button class="mini-btn primary apc-empty-cta" type="button" data-staff-action="create-empty">নতুন স্টাফ যোগ করুন</button>' : ''}
    </div>`;
    return;
  }
  const hasActiveFilter = Boolean(state.query.trim() || state.role !== 'all' || state.status !== 'all');
  const emptyCopy = state.query.trim()
    ? `“${escapeHtml(state.query)}” দিয়ে কোনো স্টাফ পাওয়া যায়নি। Staff ID, নাম, ইউজারনেম বা মোবাইল দিয়ে খুঁজুন।`
    : 'নির্বাচিত ফিল্টারে কোনো স্টাফ পাওয়া যায়নি।';
  host.innerHTML = rows.length
    ? rows.map(staffCard).join('')
    : `<div class="admin-empty apc-empty-state" role="status">
        <span class="apc-empty-icon" aria-hidden="true">${iconMarkup('search', 'apc-icon-svg')}</span>
        <p>${emptyCopy}</p>
        ${hasActiveFilter ? '<button class="mini-btn primary apc-empty-cta" type="button" data-staff-action="reset-filters">ফিল্টার রিসেট করুন</button>' : ''}
      </div>`;
}

let renderGeneration = 0;
export async function renderStaff() {
  const host = $('#staffList');
  if (!host) return;
  // Detail disclosure and overflow actions are transient UI state: every
  // fresh entry/refresh starts collapsed so old cards cannot re-open themselves.
  state.openMore = null;
  state.openDetails = null;
  /* Every call takes a number; only the newest may touch the DOM. A slow read
     that lands after a newer one can never overwrite it with stale rows. */
  const generation = ++renderGeneration;
  try {
    const [staff, canManage] = await Promise.all([listStaff(), canManageStaff()]);
    if (generation !== renderGeneration) return;
    state.staff = staff;
    state.counts = staffCounts(state.staff);
    state.canManage = canManage;
    const createButton = $('#staffCreateButton');
    if (createButton) createButton.hidden = !state.canManage;
    if (!state.canManage) {
      const note = $('#staffReadonlyNote');
      if (note) note.hidden = false;
    }
    renderRoleFilter();
    renderStatusFilter();
    renderList();
    state.ready = true;
  } catch (error) {
    if (generation !== renderGeneration) return;
    state.ready = false;
    // A failed load says so and offers a retry — never a silently frozen tab.
    host.innerHTML = `<div class="admin-empty" role="alert"><p>${escapeHtml(error?.message || 'স্টাফ তালিকা লোড হয়নি।')}</p><button class="mini-btn" type="button" data-staff-action="retry">আবার চেষ্টা করুন</button></div>`;
  }
}

/* ---------------------------------------------------------------------------
   Create / Edit
   ------------------------------------------------------------------------ */

/* ---------------------------------------------------------------------------
   Academic assignment — per-class subject matrix (Teacher only)
   ------------------------------------------------------------------------

   One teacher may take different subjects in different classes
   (Class 8 → গণিত, ইংরেজি; Class 9 → গণিত). The flat fields stay as the
   readable mirror; this matrix is what gets projected into the Teacher
   panel's assignment store. Only the classes the Admin ticks are asked for. */

const teacherClassChoices = () => [...new Set([...listClasses().map(item => item.name), ...enabledClasses])];

function classSubjectMatrixHtml({ role, assignment, classes }) {
  if (role !== 'teacher') return '';
  const chosen = (Array.isArray(classes) ? classes : []).filter(Boolean);
  const legacy = Array.isArray(assignment?.subjects) ? assignment.subjects : [];
  const perClass = assignment?.classSubjects && typeof assignment.classSubjects === 'object' ? assignment.classSubjects : {};
  if (!chosen.length) {
    return '<p class="staff-matrix-hint">উপরের তালিকা থেকে শ্রেণি বাছলে প্রতি শ্রেণির বিষয় টিক দেওয়ার ঘর দেখা যাবে।</p>';
  }
  return chosen.map(className => {
    const options = selectableSubjects(className, { includeLegacy: [...legacy, ...(perClass[className] || [])] });
    const checked = new Set(perClass[className] || (Object.keys(perClass).length ? [] : legacy));
    const rows = options.length
      ? options.map(name => `
        <label class="staff-matrix-subject">
          <input type="checkbox" data-class-subject="${escapeHtml(className)}" value="${escapeHtml(name)}" ${checked.has(name) ? 'checked' : ''}>
          <span>${escapeHtml(name)}</span>
        </label>`).join('')
      : `<p class="staff-matrix-hint">এই ক্লাসের জন্য কোনো বিষয় চালু নেই — সিস্টেম → ক্লাস ও বিষয় থেকে চালু করুন।</p>`;
    return `
      <section class="staff-matrix-class" data-matrix-class="${escapeHtml(className)}">
        <strong class="staff-matrix-title">${escapeHtml(className)}</strong>
        <div class="staff-matrix-subjects">${rows}</div>
      </section>`;
  }).join('');
}

/** Re-render the matrix from the form's current class selection, keeping the
 *  ticks the admin has already made. */
function renderClassMatrix(form, record = null) {
  const host = form?.querySelector('#staffClassSubjects');
  if (!host) return;
  const role = form.querySelector('#staffField-role')?.value || 'teacher';
  if (role !== 'teacher') {
    host.dataset.role = role;
    host.innerHTML = '';
    return;
  }
  const classes = [...(form.querySelector('#staffField-classes')?.selectedOptions || [])].map(option => option.value);
  const boxes = [...form.querySelectorAll('input[data-class-subject]')];
  const current = {};
  for (const box of boxes.filter(box => box.checked)) {
    (current[box.dataset.classSubject] ||= []).push(box.value);
  }
  /* Ticks already on screen are authoritative (even an empty tick set). Before
     the first render the record itself seeds the matrix — its per-class map
     when it has one, else the legacy flat subjects. */
  const seededMap = boxes.length ? current : (record?.assignment?.classSubjects || {});
  const useLegacy = !boxes.length && !record?.assignment?.classSubjects;
  const assignment = {
    ...(record?.assignment || {}),
    classSubjects: seededMap,
    subjects: useLegacy ? (record?.assignment?.subjects || []) : []
  };
  host.dataset.role = 'teacher';
  host.innerHTML = classSubjectMatrixHtml({ role: 'teacher', assignment, classes });
}

function staffFormHtml(record) {
  const editing = Boolean(record);
  const role = record?.role || 'teacher';
  const roleOptions = (editing ? STAFF_ROLES : CREATABLE_STAFF_ROLES)
    .map(value => ({ value, label: `${STAFF_ROLE_META[value].labelBn} (${STAFF_ROLE_META[value].label})` }));
  const statusOptions = STAFF_STATUS_KEYS.map(value => ({ value, label: STAFF_STATUS[value].label }));
  const assignment = record?.assignment || {};
  const identityFields = [
    { name: 'fullName', label: 'পূর্ণ নাম', required: true, value: record?.fullName },
    { name: 'username', label: 'Login User ID (স্বয়ংক্রিয়)', type: 'auto-id', value: record?.username, hint: 'নিয়ম: First Name + Role + .apc — যেমন rasal.teacher.apc। স্বয়ংক্রিয়ভাবে তৈরি হয়, পরিবর্তন করা যায় না' },
    ...(editing ? [] : [
      { name: 'password', label: 'পাসওয়ার্ড', type: 'password', required: true, hint: `${bn(STAFF_DIRECTORY_RULES.passwordMin)}–${bn(STAFF_DIRECTORY_RULES.passwordMax)} অক্ষর` },
      { name: 'confirmPassword', label: 'পাসওয়ার্ড নিশ্চিত করুন', type: 'password', required: true }
    ]),
    { name: 'role', label: 'রোল', type: 'select', required: true, options: roleOptions, value: role,
      hint: 'এডমিন পুরো প্যানেলের নিয়ন্ত্রণ পায়; System Owner (প্রথম এডমিন) আলাদা ও সুরক্ষিত থাকেন' },
    { name: 'status', label: 'স্ট্যাটাস', type: 'select', options: statusOptions, value: record?.status || 'active' },
    { name: 'mobile', label: 'মোবাইল নম্বর', placeholder: '01XXXXXXXXX', value: record?.mobile },
    { name: 'email', label: 'ইমেইল (ঐচ্ছিক)', type: 'email', value: record?.email },
    { name: 'joiningDate', label: 'যোগদানের তারিখ', type: 'date', value: record?.joiningDate || '' },
    { name: 'address', label: 'ঠিকানা (ঐচ্ছিক)', max: 300, value: record?.address }
  ];
  const stepAttrs = step => editing ? '' : ` data-staff-create-step="${step}"${step > 1 ? ' hidden' : ''}`;
  const sectionClass = editing ? 'staff-form-section-block' : 'staff-form-section-block staff-create-step';
  const stepper = editing ? '' : `
      <ol class="staff-create-progress" aria-label="স্টাফ তৈরির ধাপ">
        <li data-staff-step-indicator="1" aria-current="step"><span>১</span><small>অ্যাকাউন্ট</small></li>
        <li data-staff-step-indicator="2"><span>২</span><small>রোল ও যোগাযোগ</small></li>
        <li data-staff-step-indicator="3"><span>৩</span><small>দায়িত্ব</small></li>
      </ol>`;
  return `
    <form id="staffForm" class="staff-form staff-create-form${editing ? ' is-editing' : ' is-creating'}" novalidate${editing ? '' : ' data-current-create-step="1"'}>
      ${editing ? `<div class="staff-form-notice">${icon('lock', 'staff-inline-icon')}<span>Staff ID <strong>${escapeHtml(record.staffId)}</strong> — স্থায়ী পরিচয়, পরিবর্তন করা যাবে না</span></div>` : `<div class="staff-create-guide"><span class="staff-guide-icon" aria-hidden="true">${icon('staff', 'staff-inline-icon')}</span><div><strong>৩টি সহজ ধাপে অ্যাকাউন্ট তৈরি</strong><small>প্রথমে পরিচিতি, এরপর রোল ও যোগাযোগ, শেষে দায়িত্ব দিন।</small></div></div>`}
      ${stepper}
      <p class="finance-error" id="staffFormError" role="alert" hidden></p>
      <section class="${sectionClass}"${stepAttrs(1)} aria-label="অ্যাকাউন্টের তথ্য">
        <div class="staff-form-section-title"><span class="staff-section-number">১</span><div><strong>অ্যাকাউন্টের তথ্য</strong><small>স্টাফের পরিচয় ও লগইন আইডি দেখুন</small></div></div>
        <div class="staff-form-grid">
          ${identityFields.slice(0, 2).map(spec => fieldRow(spec, spec.value)).join('')}
        </div>
        ${editing ? '' : `<div class="staff-step-actions"><button class="admin-btn primary" type="button" data-staff-step-next>পরবর্তী: রোল ও যোগাযোগ</button><button class="admin-btn ghost" type="button" data-staff-modal="close">বাতিল</button></div>`}
      </section>
      <section class="${sectionClass}"${stepAttrs(2)} aria-label="রোল ও যোগাযোগ">
        <div class="staff-form-section-title"><span class="staff-section-number">২</span><div><strong>রোল ও যোগাযোগ</strong><small>রোল নির্বাচন করলে Login User ID স্বয়ংক্রিয়ভাবে তৈরি হবে</small></div></div>
        <div class="staff-form-grid">
          ${identityFields.slice(2).map(spec => fieldRow(spec, spec.value)).join('')}
        </div>
        ${editing ? '' : `<div class="staff-step-actions"><button class="admin-btn ghost" type="button" data-staff-step-back>পেছনে</button><button class="admin-btn primary" type="button" data-staff-step-next>পরবর্তী: দায়িত্ব</button><button class="admin-btn ghost" type="button" data-staff-modal="close">বাতিল</button></div>`}
      </section>
      <section class="staff-assignment ${sectionClass}" id="staffAssignmentFields" data-role="${escapeHtml(role)}"${stepAttrs(3)} aria-label="দায়িত্ব">
        <div class="staff-form-section-title"><span class="staff-section-number">৩</span><div><strong id="staffAssignmentTitle">${escapeHtml(STAFF_ROLE_META[role]?.labelBn || 'স্টাফ')} — দায়িত্ব</strong><small>এই রোল অনুযায়ী প্রয়োজনীয় দায়িত্বের তথ্য দিন</small></div></div>
        <div class="staff-form-grid">
          ${roleAssignmentFields(role, assignment.classes).map(spec => fieldRow(spec, spec.name === 'classes' ? assignment.classes : assignment[spec.name])).join('')}
        </div>
        <div class="staff-class-subjects" id="staffClassSubjects"></div>
        ${editing ? '' : `<div class="staff-step-actions"><button class="admin-btn ghost" type="button" data-staff-step-back>পেছনে</button></div>`}
      </section>
      <div class="staff-form-footer" data-staff-create-footer${editing ? '' : ' hidden'}>
        <div class="modal-actions">
          <button class="admin-btn primary" type="submit">${icon('save', 'staff-inline-icon')}<span>${editing ? 'তথ্য সংরক্ষণ করুন' : 'স্টাফ অ্যাকাউন্ট তৈরি করুন'}</span></button>
          <button class="admin-btn ghost" type="button" data-staff-modal="close">বাতিল</button>
        </div>
      </div>
    </form>`;
}

function collectForm(form) {
  const data = new FormData(form);
  const get = name => String(data.get(name) ?? '').trim();
  const classes = data.getAll('classes').map(String);
  /* Per-class subject ticks (Teacher) are the precise assignment; the flat
     fields stay as the readable mirror. A ticked matrix overrides the comma
     list, so "Class 8 → গণিত, ইংরেজি; Class 9 → গণিত" is stored exactly. */
  const classSubjects = {};
  for (const box of form.querySelectorAll('input[data-class-subject]:checked')) {
    (classSubjects[box.dataset.classSubject] ||= []).push(box.value);
  }
  const flatSubjects = get('subjects').split(',').map(item => item.trim()).filter(Boolean);
  const matrixSubjects = [...new Set(Object.values(classSubjects).flat())];
  return {
    fullName: get('fullName'),
    username: get('username'),
    password: get('password'),
    confirmPassword: get('confirmPassword'),
    role: get('role'),
    status: get('status') || 'active',
    mobile: get('mobile'),
    email: get('email'),
    joiningDate: get('joiningDate'),
    address: get('address'),
    assignment: {
      classes: [...new Set([...classes, ...Object.keys(classSubjects)])],
      subjects: matrixSubjects.length ? matrixSubjects : flatSubjects,
      batches: get('batches').split(',').map(item => item.trim()).filter(Boolean),
      classSubjects: Object.keys(classSubjects).length ? classSubjects : undefined,
      counter: get('counter'),
      designation: get('designation'),
      notes: get('notes')
    }
  };
}

function openCreate() {
  if (!state.canManage) {
    toastSafe('শুধুমাত্র Admin স্টাফ ম্যানেজমেন্ট ব্যবহার করতে পারবেন।');
    return;
  }
  const body = openModal('স্টাফ ম্যানেজমেন্ট', 'নতুন স্টাফ অ্যাকাউন্ট', staffFormHtml(null), { wide: true });
  const form = body.querySelector('#staffForm');
  wireForm(form, null);
  refreshAutoId(form, null);
}

async function openEdit(staffId) {
  const record = state.staff.find(item => item.staffId === staffId) || await findStaff(staffId);
  if (!record) {
    toastSafe('স্টাফ অ্যাকাউন্ট পাওয়া যায়নি।');
    return;
  }
  const body = openModal('স্টাফ ম্যানেজমেন্ট', `${record.fullName} — সম্পাদনা`, staffFormHtml(record), { wide: true });
  const form = body.querySelector('#staffForm');
  refreshAutoId(form, record);
  if (record.protected) {
    const roleSelect = form.querySelector('#staffField-role');
    const statusSelect = form.querySelector('#staffField-status');
    const usernameInput = form.querySelector('#staffField-username');
    [roleSelect, statusSelect, usernameInput].forEach(control => control?.setAttribute('disabled', 'disabled'));
    const note = document.createElement('p');
    note.className = 'staff-protected-note';
    note.innerHTML = `${icon('shield', 'staff-inline-icon')} বর্তমান অ্যাডমিন → লক করা: ভূমিকা, স্ট্যাটাস ও ইউজারনেম।`;
    form.prepend(note);
  }
  wireForm(form, record);
}

/** Every Login User ID already used, so the preview never proposes a double. */
function existingUsernames(except = '') {
  return (state.staff || [])
    .map(staff => staff?.username)
    .filter(name => name && name !== except);
}

/**
 * Keep the generated id in step with the name and the role.
 * A system/protected/hand-made id is never rewritten, so nobody loses a login.
 */
function refreshAutoId(form, record = null) {
  const box = form.querySelector('#staffField-username[data-auto-id]');
  if (!box) return;
  const hidden = form.querySelector('#staffField-username-hidden');
  const locked = Boolean(record?.protected || record?.kind === 'system');
  const keepCurrent = Boolean(record) && (locked || !isAutoLoginId(record.username, record.role));
  if (keepCurrent) {
    box.textContent = record.username || '—';
    if (hidden) hidden.value = record.username || '';
    return;
  }
  const fullName = form.querySelector('#staffField-fullName')?.value || '';
  const role = form.querySelector('#staffField-role')?.value || 'teacher';
  if (!String(fullName).trim()) {
    box.textContent = '—';
    if (hidden) hidden.value = '';
    return;
  }
  const id = generateLoginId({ fullName, role, taken: existingUsernames(record?.username) });
  box.textContent = id;
  if (hidden) hidden.value = id;
}

function validateCreateStep(form, step) {
  clearModalError();
  const focusError = (control, message) => {
    control?.setAttribute('aria-invalid', 'true');
    modalError(message);
    control?.focus({ preventScroll: true });
    return false;
  };
  if (step === 1) {
    const name = form.querySelector('#staffField-fullName');
    if (!String(name?.value || '').trim()) return focusError(name, 'পূর্ণ নাম লিখুন।');
  }
  if (step === 2) {
    const role = form.querySelector('#staffField-role');
    if (!CREATABLE_STAFF_ROLES.includes(role?.value)) return focusError(role, 'স্টাফের জন্য একটি বৈধ ভূমিকা বাছুন।');
    const password = form.querySelector('#staffField-password');
    const confirm = form.querySelector('#staffField-confirmPassword');
    const value = String(password?.value || '');
    if (value.length < STAFF_DIRECTORY_RULES.passwordMin || value.length > STAFF_DIRECTORY_RULES.passwordMax) {
      return focusError(password, `পাসওয়ার্ড ${bn(STAFF_DIRECTORY_RULES.passwordMin)}–${bn(STAFF_DIRECTORY_RULES.passwordMax)} অক্ষরের হতে হবে।`);
    }
    if (value !== String(confirm?.value || '')) return focusError(confirm, 'দুটি পাসওয়ার্ড মিলছে না।');
  }
  return true;
}

function showCreateStep(form, requestedStep) {
  const sections = [...form.querySelectorAll('[data-staff-create-step]')];
  if (!sections.length) return 0;
  const step = Math.max(1, Math.min(sections.length, Number(requestedStep) || 1));
  form.dataset.currentCreateStep = String(step);
  sections.forEach(section => { section.hidden = Number(section.dataset.staffCreateStep) !== step; });
  form.querySelectorAll('[data-staff-step-indicator]').forEach(indicator => {
    if (Number(indicator.dataset.staffStepIndicator) === step) indicator.setAttribute('aria-current', 'step');
    else indicator.removeAttribute('aria-current');
  });
  const footer = form.querySelector('[data-staff-create-footer]');
  if (footer) footer.hidden = step !== sections.length;
  const activeSection = sections.find(section => Number(section.dataset.staffCreateStep) === step);
  activeSection?.querySelector('input:not([type="hidden"]), select, textarea, button')?.focus({ preventScroll: true });
  const body = $('#staffModalBody');
  if (body) body.scrollTop = 0;
  return step;
}

function wireForm(form, record) {
  const assignmentHost = form.querySelector('#staffAssignmentFields');
  if (!record) showCreateStep(form, 1);
  form.querySelector('#staffField-classes')?.addEventListener('change', () => renderClassMatrix(form, record));
  renderClassMatrix(form, record);
  form.querySelector('#staffField-fullName')?.addEventListener('input', () => refreshAutoId(form, record));
  form.querySelector('#staffField-role')?.addEventListener('change', event => {
    const role = event.target.value;
    // The role is part of the id: "rasal.teacher.apc" → "rasal.manager.apc".
    refreshAutoId(form, record);
    if (!assignmentHost) return;
    assignmentHost.dataset.role = role;
    const assignmentTitle = assignmentHost.querySelector('#staffAssignmentTitle');
    if (assignmentTitle) assignmentTitle.textContent = `${STAFF_ROLE_META[role]?.labelBn || 'স্টাফ'} — দায়িত্ব`;
    const grid = assignmentHost.querySelector('.staff-form-grid');
    if (grid) {
      grid.innerHTML = roleAssignmentFields(role)
        .map(spec => fieldRow(spec, spec.name === 'classes' ? [] : '')).join('');
    }
    // The role grid was reset: the per-class matrix follows suit.
    renderClassMatrix(form, null);
  });

  if (!record) {
    form.addEventListener('click', event => {
      const next = event.target.closest('[data-staff-step-next]');
      const back = event.target.closest('[data-staff-step-back]');
      if (!next && !back) return;
      event.preventDefault();
      const current = Number(form.dataset.currentCreateStep) || 1;
      if (next) {
        if (validateCreateStep(form, current)) showCreateStep(form, current + 1);
      } else showCreateStep(form, current - 1);
    });
    form.addEventListener('input', event => {
      event.target.removeAttribute('aria-invalid');
      if (form.querySelector('[aria-invalid="true"]')) return;
      clearModalError();
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!record && (Number(form.dataset.currentCreateStep) || 1) < 3) {
      const current = Number(form.dataset.currentCreateStep) || 1;
      if (validateCreateStep(form, current)) showCreateStep(form, current + 1);
      return;
    }
    clearModalError();
    const submit = form.querySelector('[type="submit"]');
    const fields = collectForm(form);
    if (record?.protected) {
      fields.role = record.role;
      fields.status = record.status;
      fields.username = record.username;
    }
    if (submit) { submit.disabled = true; submit.setAttribute('aria-busy', 'true'); }
    const result = record
      ? await updateStaff(record.staffId, fields)
      : await createStaff(fields);
    if (submit) { submit.disabled = false; submit.removeAttribute('aria-busy'); }
    if (!result.ok) {
      const errors = Object.entries(result.errors || {});
      if (!record && errors.length) {
        const names = errors.map(([name]) => name);
        const targetStep = names.some(name => ['fullName', 'username'].includes(name)) ? 1
          : names.some(name => ['password', 'confirmPassword', 'role', 'status', 'mobile', 'email', 'joiningDate', 'address'].includes(name)) ? 2
            : 3;
        showCreateStep(form, targetStep);
      }
      modalError(result.error || 'সংরক্ষণ করা যায়নি।');
      if (result.errors) {
        for (const [name, message] of Object.entries(result.errors)) {
          const control = form.querySelector(`#staffField-${name}`);
          control?.setAttribute('aria-invalid', 'true');
          const hint = control?.parentElement?.querySelector('small');
          if (hint) hint.textContent = message;
        }
      }
      return;
    }
    closeModal();
    toastSafe(record ? 'স্টাফ তথ্য হালনাগাদ করা হয়েছে' : `স্টাফ তৈরি হয়েছে — Staff ID ${result.staff.staffId}`);
    await refresh();
  });
}

/* ---------------------------------------------------------------------------
   More actions — the shared staff dialog presents them as a bottom sheet
   ------------------------------------------------------------------------ */

async function openMoreSheet(staffId) {
  const record = state.staff.find(item => item.staffId === staffId) || await findStaff(staffId);
  if (!record) {
    state.openMore = null;
    state.pendingMoreFocusId = null;
    renderList();
    toastSafe('স্টাফ অ্যাকাউন্ট পাওয়া যায়নি।');
    return;
  }
  state.pendingMoreFocusId = staffId;
  openModal('স্টাফ অ্যাকশন', `${record.fullName} — আরও`, staffMoreActionsHtml(record), { sheet: true });
  const backdrop = $('#staffModalBackdrop');
  if (backdrop) backdrop.dataset.moreStaffId = record.staffId;
}

/* ---------------------------------------------------------------------------
   Profile
   ------------------------------------------------------------------------ */

async function openProfile(staffId) {
  if (!(await canManageStaff())) { toastSafe('এই স্টাফ প্রোফাইল দেখার অনুমতি নেই।'); return; }
  const record = state.staff.find(item => item.staffId === staffId) || await findStaff(staffId);
  if (!record) {
    toastSafe('স্টাফ অ্যাকাউন্ট পাওয়া যায়নি।');
    return;
  }
  const activity = staffActivitySummary(record);
  const assignment = record.assignment || {};
  const rows = [
    ['Staff ID', `<span class="staff-id-badge">${escapeHtml(record.staffId)}</span>`],
    ['পূর্ণ নাম', escapeHtml(record.fullName)],
    ['ইউজারনেম', escapeHtml(record.username)],
    ['রোল', `${escapeHtml(staffRoleLabel(record.role))}${record.role !== 'admin' && STAFF_ROLE_META[record.role] ? ` (${escapeHtml(STAFF_ROLE_META[record.role].label)})` : ''}`],
    ['স্ট্যাটাস', escapeHtml(staffStatusLabel(record.status))],
    ['মোবাইল', escapeHtml(record.mobile || '—')],
    ['ইমেইল', escapeHtml(record.email || '—')],
    ['ঠিকানা', escapeHtml(record.address || '—')],
    ['যোগদান', escapeHtml(record.joiningDate || '—')],
    ['পদবি', escapeHtml(assignment.designation || '—')],
    ['নির্ধারিত শ্রেণি', (assignment.classes || []).length ? escapeHtml(assignment.classes.join(', ')) : '—'],
    ['বিষয়', (assignment.subjects || []).length ? escapeHtml(assignment.subjects.join(', ')) : '—'],
    ['ব্যাচ/স্কোপ', escapeHtml(assignment.batches?.join?.(', ') || assignment.counter || '—')],
    ['নোট', escapeHtml(assignment.notes || '—')]
  ];
  const history = Array.isArray(record.history) ? record.history : [];
  openModal('স্টাফ প্রোফাইল', record.fullName, `
    <div class="staff-profile-head">
      <span class="staff-avatar large" aria-hidden="true">${escapeHtml(initialsOf(record.fullName))}</span>
      <div>
        <strong>${escapeHtml(record.fullName)}</strong>
        <p><span class="staff-id-badge">Staff ID: ${escapeHtml(record.staffId)}</span> <span class="badge ${(STAFF_STATUS[record.status] || STAFF_STATUS.inactive).className}">${escapeHtml(staffStatusLabel(record.status))}</span></p>
      </div>
    </div>
    <dl class="detail-grid">
      ${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}
    </dl>
    <section class="staff-id-card-area" aria-label="স্টাফ ডিজিটাল আইডি কার্ড">
      <button class="admin-btn ghost" type="button" data-staff-card-toggle aria-expanded="false">স্টাফ আইডি কার্ড দেখুন</button>
      <div class="staff-id-card-print-root" hidden>
        <article class="staff-id-card-print">
          <header><img src="assets/icons/logo-128.png" alt="" width="48" height="48"><div><strong>Active Plus Coaching</strong><small>শিখতে থাকো, এগিয়ে যাও</small></div></header>
          <div class="staff-id-card-person"><span class="staff-id-card-avatar" aria-hidden="true">${escapeHtml(initialsOf(record.fullName))}</span><div><h3>${escapeHtml(record.fullName || 'স্টাফ')}</h3><p>${escapeHtml(staffRoleLabel(record.role))}</p></div></div>
          <div class="staff-id-card-number"><small>STAFF ID</small><strong>${escapeHtml(String(record.staffId || ''))}</strong></div>
          <p class="staff-id-card-status">${escapeHtml(staffStatusLabel(record.status))}</p>
        </article>
        <button class="admin-btn primary" type="button" data-staff-card-print>প্রিন্ট / PDF</button>
      </div>
    </section>
    <div class="staff-activity">
      <p class="staff-form-section">কার্যক্রমের সারসংক্ষেপ</p>
      <div class="staff-activity-grid">
        <div><small>রুটিন ক্লাস</small><strong>${bn(activity.routine)}</strong></div>
        <div><small>লেনদেন</small><strong>${bn(activity.transactions)}</strong></div>
        <div><small>একাডেমিক কার্যক্রম</small><strong>${bn(activity.teaching)}</strong></div>
        <div><small>পরীক্ষা</small><strong>${bn(activity.exams)}</strong></div>
      </div>
      ${activity.hasHistory
        ? '<p class="finance-hint">এই স্টাফের সঙ্গে ইতিহাস যুক্ত — অ্যাকাউন্ট মুছে ফেলার বদলে নিষ্ক্রিয় করাই নিরাপদ।</p>'
        : '<p class="finance-hint">এই স্টাফের সঙ্গে কোনো রেকর্ড যুক্ত নেই।</p>'}
    </div>
    ${history.length ? `
      <p class="staff-form-section">সাম্প্রতিক কার্যক্রম</p>
      <ul class="staff-history">${history.slice(-6).reverse().map(entry => `
        <li><small>${escapeHtml(String(entry.at || '').slice(0, 10))}</small> ${escapeHtml(entry.detail || entry.action || '')}</li>`).join('')}
      </ul>` : ''}
    <div class="modal-actions">
      <button class="admin-btn primary" type="button" data-staff-action="edit" data-staff-id="${escapeHtml(record.staffId)}">সম্পাদনা</button>
      <button class="admin-btn ghost" type="button" data-staff-modal="close">বন্ধ করুন</button>
    </div>`, { wide: true });
}

/* ---------------------------------------------------------------------------
   Password reset
   ------------------------------------------------------------------------ */

async function openReset(staffId) {
  const record = state.staff.find(item => item.staffId === staffId) || await findStaff(staffId);
  if (!record) return;
  openModal('নিরাপত্তা', `${record.fullName} — পাসওয়ার্ড রিসেট`, `
    <p class="finance-hint">নতুন পাসওয়ার্ড সরাসরি সংরক্ষিত হবে (হ্যাশ আকারে)। পুরোনো পাসওয়ার্ড কখনো দেখানো হয় না — স্টাফ প্রথম লগইনে এটি বদলাতে বাধ্য থাকবে।</p>
    <form id="staffPasswordForm" class="staff-form" novalidate>
      <div class="staff-form-grid">
        ${fieldRow({ name: 'newPassword', label: 'নতুন পাসওয়ার্ড', type: 'password', required: true, hint: '৬–৩২ অক্ষর' }, '')}
        ${fieldRow({ name: 'confirmPassword', label: 'পাসওয়ার্ড নিশ্চিত করুন', type: 'password', required: true }, '')}
      </div>
      <p class="finance-error" id="staffFormError" role="alert" hidden></p>
      <div class="modal-actions">
        <button class="admin-btn primary" type="submit">${icon('key', 'staff-inline-icon')}<span>পাসওয়ার্ড রিসেট করুন</span></button>
        <button class="admin-btn ghost" type="button" data-staff-modal="close">বাতিল</button>
      </div>
    </form>`);
  $('#staffPasswordForm').addEventListener('submit', async event => {
    event.preventDefault();
    clearModalError();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await resetStaffPassword(staffId, String(data.get('newPassword') || ''), String(data.get('confirmPassword') || ''));
    if (!result.ok) {
      modalError(result.error || 'পাসওয়ার্ড রিসেট করা যায়নি।');
      return;
    }
    form.reset();
    closeModal({ restoreFocus: false });
    toastSafe(`${record.fullName} — পাসওয়ার্ড রিসেট হয়েছে (পরবর্তী লগইনে বদল করতে হবে)`);
    await refresh();
    restoreMoreTriggerFocus(staffId);
  });
}

/* ---------------------------------------------------------------------------
   Delete — confirmation first, deactivation when history is attached
   ------------------------------------------------------------------------ */

async function openDelete(staffId) {
  const record = state.staff.find(item => item.staffId === staffId) || await findStaff(staffId);
  if (!record) return;
  const activity = staffActivitySummary(record);
  openModal('সতর্কতা', 'স্টাফ অ্যাকাউন্ট মুছে ফেলবেন?', `
    <p class="staff-confirm-copy">আপনি কি <strong>${escapeHtml(record.fullName)}</strong> (Staff ID: <strong>${escapeHtml(record.staffId)}</strong>) — এই Staff Account স্থায়ীভাবে মুছে ফেলতে চান?</p>
    ${activity.hasHistory ? `<p class="finance-error">এই স্টাফের সঙ্গে ${bn(activity.total)} টি রেকর্ড যুক্ত। ইতিহাস নষ্ট না করতে <strong>নিষ্ক্রিয় (Deactivate)</strong> করাই সঠিক পদ্ধতি।</p>` : ''}
    <div class="modal-actions">
      <button class="admin-btn ghost" type="button" data-staff-modal="close">বাতিল</button>
      ${activity.hasHistory
        ? `<button class="admin-btn primary" type="button" data-staff-action="deactivate" data-staff-id="${escapeHtml(record.staffId)}">নিষ্ক্রিয় করুন</button>`
        : `<button class="admin-btn danger" type="button" data-staff-action="confirm-delete" data-staff-id="${escapeHtml(record.staffId)}">${icon('trash', 'staff-inline-icon')}<span>Delete Staff</span></button>`}
    </div>`);
}

async function confirmDelete(staffId) {
  const result = await deleteStaff(staffId);
  if (!result.ok) {
    if (result.code === 'PROTECTED' || result.code === 'HISTORY') {
      const fallback = await setStaffStatus(staffId, 'inactive');
      closeModal({ restoreFocus: false });
      toastSafe(fallback.ok ? 'ইতিহাস অক্ষত রেখে অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে' : (result.error || 'মুছে ফেলা যায়নি'));
      await refresh();
      restoreMoreTriggerFocus(staffId);
      return;
    }
    modalError(result.error || 'মুছে ফেলা যায়নি।');
    return;
  }
  state.openMore = null;
  closeModal({ restoreFocus: false });
  toastSafe('স্টাফ অ্যাকাউন্ট মুছে ফেলা হয়েছে');
  await refresh();
  restoreMoreTriggerFocus(staffId);
}

async function changeStatus(staffId, status) {
  const result = await setStaffStatus(staffId, status);
  state.openMore = null;
  if (!result.ok) {
    toastSafe(result.error || 'স্ট্যাটাস পরিবর্তন করা যায়নি।');
    return;
  }
  toastSafe(status === 'active' ? 'স্টাফ অ্যাকাউন্ট সক্রিয় করা হয়েছে' : status === 'suspended' ? 'স্টাফ অ্যাকাউন্ট স্থগিত করা হয়েছে' : 'স্টাফ অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে — ইতিহাস অক্ষত আছে');
  await refresh();
}

/* ---------------------------------------------------------------------------
   Toast (reuses the panel's toast when it exists)
   ------------------------------------------------------------------------ */

function toastSafe(message) {
  const host = $('.admin-toast');
  if (host) {
    host.remove();
  }
  const el = document.createElement('div');
  el.className = 'admin-toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  window.setTimeout(() => el.remove(), 2800);
}

async function refresh() {
  await renderStaff();
  notify();
}

/* ---------------------------------------------------------------------------
   Wiring
   ------------------------------------------------------------------------ */

export function initStaffManagement({ onChanged } = {}) {
  notify = typeof onChanged === 'function' ? onChanged : () => {};
  if (state.wired || !$('#staffList')) return;
  // "নতুন স্টাফ" carries a plus inside the same fixed drop used everywhere.
  paintIcon($('#staffCreateButton .apc-icon'), 'staff', 'apc-color-icon', { variant: 'color' });

  $('#staffCreateButton')?.addEventListener('click', openCreate);

  $('#staffSearch')?.addEventListener('input', event => {
    state.query = event.target.value || '';
    state.openMore = null;
    state.openDetails = null;
    renderList();
  });

  $('#staffSearchClear')?.addEventListener('click', () => {
    const input = $('#staffSearch');
    if (input) input.value = '';
    state.query = '';
    state.openMore = null;
    state.openDetails = null;
    renderList();
    input?.focus();
  });

  $('#staffRoleFilter')?.addEventListener('click', event => {
    const chip = event.target.closest('[data-staff-role]');
    if (!chip) return;
    state.role = chip.dataset.staffRole;
    state.openMore = null;
    state.openDetails = null;
    renderRoleFilter();
    renderList();
  });

  $('#staffStatusFilter')?.addEventListener('click', event => {
    const chip = event.target.closest('[data-staff-status]');
    if (!chip) return;
    state.status = chip.dataset.staffStatus;
    state.openMore = null;
    state.openDetails = null;
    renderStatusFilter();
    renderList();
  });

  $('#staffSort')?.addEventListener('change', event => {
    state.sort = event.target.value || 'default';
    state.openMore = null;
    state.openDetails = null;
    renderList();
  });

  $('#staffList')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-staff-action]');
    if (!button) return;
    const { staffAction, staffId, nextStatus } = button.dataset;
    if (staffAction === 'toggle-details') {
      const willOpen = state.openDetails !== staffId;
      state.openMore = null;
      state.openDetails = willOpen ? staffId : null;
      renderList();
      const replacement = $$('#staffList [data-staff-action="toggle-details"]')
        .find(candidate => candidate.dataset.staffId === staffId);
      replacement?.focus({ preventScroll: true });
      return;
    }
    if (staffAction === 'more') {
      state.openDetails = staffId;
      state.openMore = staffId;
      renderList();
      await openMoreSheet(staffId);
      return;
    }
    state.openMore = null;
    if (staffAction === 'create-empty') { await openCreate(); return; }
    if (staffAction === 'reset-filters') {
      state.query = '';
      state.role = 'all';
      state.status = 'all';
      const input = $('#staffSearch');
      if (input) input.value = '';
      renderRoleFilter();
      renderStatusFilter();
      renderList();
      return;
    }
    if (staffAction === 'retry') { await renderStaff(); return; }
    if (staffAction === 'view') await openProfile(staffId);
    else if (staffAction === 'edit') { closeModal(); await openEdit(staffId); }
    else if (staffAction === 'reset') await openReset(staffId);
    else if (staffAction === 'delete') await openDelete(staffId);
    else if (staffAction === 'confirm-delete') await confirmDelete(staffId);
    else if (staffAction === 'deactivate') await changeStatus(staffId, 'inactive');
    else if (staffAction === 'status') await changeStatus(staffId, nextStatus || 'inactive');
  });

  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-staff-card-toggle]');
    if (toggle && toggle.closest('#staffModalBackdrop')) {
      const panel = toggle.nextElementSibling;
      const opening = Boolean(panel?.hidden);
      if (panel) panel.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      return;
    }
    const print = event.target.closest('[data-staff-card-print]');
    if (print && print.closest('#staffModalBackdrop')) {
      document.body.classList.add('staff-card-printing');
      const cleanup = () => document.body.classList.remove('staff-card-printing');
      window.addEventListener('afterprint', cleanup, { once: true });
      window.setTimeout(() => window.print(), 60);
    }
  });

  document.addEventListener('keydown', event => {
    const backdrop = $('#staffModalBackdrop');
    if (!backdrop || backdrop.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...backdrop.querySelectorAll(
      'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.closest('[hidden]') && element.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) {
      event.preventDefault();
      backdrop.querySelector('.staff-modal')?.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !backdrop.contains(document.activeElement))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (document.activeElement === last || !backdrop.contains(document.activeElement))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  });

  state.wired = true;
}

/* The dedicated Staff view owns staff mutations and the searchable directory.
   The Account/Profile section is reserved for the signed-in Admin's account. */
export { STAFF_ROLE_META, STAFF_STATUS, openProfile, openEdit, changeStatus, openReset, refresh as refreshStaffList };
