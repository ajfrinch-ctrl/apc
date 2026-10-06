/* Staff Management UI — the Admin Panel's staff module.

   Mobile-first: every staff member is one glass card (name → Staff ID → role →
   mobile → status) with **View | Edit | More**; More holds Reset Password,
   Activate/Deactivate and Delete.

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
const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const state = {
  query: '',
  role: 'all',
  status: 'all',
  staff: [],
  counts: null,
  openMore: null,
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

/** Extra fields per role: only what that role actually needs. */
function roleAssignmentFields(role) {
  if (role === 'teacher') {
    return [
      { name: 'classes', label: 'Assigned Class/শ্রেণি', type: 'select', multiple: true, options: enabledClasses.map(name => ({ value: name, label: name })), hint: 'তালিকা থেকে এক বা একাধিক শ্রেণি বেছে নিন' },
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

function modalShell() {
  let backdrop = $('#staffModalBackdrop');
  if (backdrop) return backdrop;
  backdrop = document.createElement('div');
  backdrop.className = 'admin-modal-backdrop staff-modal-backdrop';
  backdrop.id = 'staffModalBackdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <section class="admin-modal staff-modal" role="dialog" aria-modal="true" aria-labelledby="staffModalTitle">
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
  return backdrop;
}

function openModal(kicker, title, bodyHtml, { wide = false } = {}) {
  const backdrop = modalShell();
  $('#staffModalKicker').textContent = kicker;
  $('#staffModalTitle').textContent = title;
  const body = $('#staffModalBody');
  body.innerHTML = bodyHtml;
  backdrop.querySelector('.staff-modal').classList.toggle('is-wide', wide);
  backdrop.hidden = false;
  document.body.classList.add('staff-modal-open');
  const focusable = body.querySelector('input:not([type=hidden]), select, textarea, button');
  focusable?.focus({ preventScroll: true });
  return body;
}

function closeModal() {
  const backdrop = $('#staffModalBackdrop');
  if (!backdrop) return;
  backdrop.hidden = true;
  $('#staffModalBody').innerHTML = '';
  document.body.classList.remove('staff-modal-open');
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

function staffCard(record) {
  const meta = STAFF_ROLE_META[record.role] || STAFF_ROLE_META.other;
  const status = STAFF_STATUS[record.status] || STAFF_STATUS.inactive;
  const moreOpen = state.openMore === record.staffId;
  const initials = escapeHtml(String(record.fullName || '?').trim().slice(0, 1).toUpperCase());
  const assignment = [
    ...(record.assignment?.classes || []),
    ...(record.assignment?.subjects || []),
    record.assignment?.counter,
    record.assignment?.designation
  ].filter(Boolean).slice(0, 3);
  return `
    <article class="staff-card${record.status === 'active' ? '' : ' is-inactive'}${record.protected ? ' is-protected' : ''}" data-staff-card="${escapeHtml(record.staffId)}">
      <div class="staff-card-head">
        <span class="staff-avatar" aria-hidden="true">${initials}</span>
        <div class="staff-card-identity">
          <strong class="staff-card-name">${escapeHtml(record.fullName)}</strong>
          <p class="staff-card-line"><span class="staff-id-badge">Staff ID: ${escapeHtml(record.staffId)}</span></p>
          <p class="staff-card-line">
            <span class="staff-tag role-${escapeHtml(record.role)}">${escapeHtml(meta.labelBn)}</span>
            <span class="staff-tag muted">${escapeHtml(record.username)}</span>
          </p>
          <p class="staff-card-line">
            <span class="staff-meta">${icon('phone', 'staff-inline-icon')} ${escapeHtml(record.mobile || 'মোবাইল নেই')}</span>
          </p>
          ${assignment.length ? `<p class="staff-card-line"><span class="staff-meta">${icon('book', 'staff-inline-icon')} ${escapeHtml(assignment.join(' • '))}</span></p>` : ''}
        </div>
        <span class="badge ${status.className}">${escapeHtml(status.label)}</span>
      </div>
      ${record.protected ? '<p class="staff-protected-note">' + icon('shield', 'staff-inline-icon') + ' Current Admin → Protected • এই পরিচয় মুছে বা নিষ্ক্রিয় করা যায় না</p>' : ''}
      ${record.mustChangePassword ? '<p class="staff-password-note">' + icon('lock', 'staff-inline-icon') + ' প্রথম লগইনে পাসওয়ার্ড বদল করতে হবে</p>' : ''}
      <div class="staff-card-actions">
        <button class="mini-btn" type="button" data-staff-action="view" data-staff-id="${escapeHtml(record.staffId)}">${icon('eye', 'staff-inline-icon')}<span>View</span></button>
        <button class="mini-btn" type="button" data-staff-action="edit" data-staff-id="${escapeHtml(record.staffId)}">${icon('edit', 'staff-inline-icon')}<span>Edit</span></button>
        <button class="mini-btn more-btn" type="button" data-staff-action="more" data-staff-id="${escapeHtml(record.staffId)}" aria-expanded="${moreOpen}">${icon('more', 'staff-inline-icon')}<span>More</span></button>
      </div>
      <div class="staff-more-menu"${moreOpen ? '' : ' hidden'}>
        <button class="staff-more-item" type="button" data-staff-action="reset" data-staff-id="${escapeHtml(record.staffId)}">${icon('key', 'staff-inline-icon')}<span>Reset Password</span></button>
        <button class="staff-more-item" type="button" data-staff-action="status" data-staff-id="${escapeHtml(record.staffId)}" data-next-status="${record.status === 'active' ? 'inactive' : 'active'}">
          ${icon(record.status === 'active' ? 'pause' : 'checkCircle', 'staff-inline-icon')}
          <span>${record.status === 'active' ? 'Deactivate' : 'Activate'}</span>
        </button>
        ${record.status === 'active' && !record.protected ? `<button class="staff-more-item" type="button" data-staff-action="status" data-staff-id="${escapeHtml(record.staffId)}" data-next-status="suspended">${icon('pause', 'staff-inline-icon')}<span>Suspend</span></button>` : ''}
        <button class="staff-more-item danger" type="button" data-staff-action="delete" data-staff-id="${escapeHtml(record.staffId)}">${icon('trash', 'staff-inline-icon')}<span>Delete</span></button>
      </div>
    </article>`;
}

function renderList() {
  const host = $('#staffList');
  if (!host) return;
  const rows = filteredStaff();
  const counter = $('#staffCountBadge');
  if (counter) {
    counter.textContent = rows.length
      ? `${bn(rows.length)} জন স্টাফ দেখা যাচ্ছে`
      : 'কোনো স্টাফ পাওয়া যায়নি';
  }
  if (!state.staff.length) {
    host.innerHTML = '<p class="admin-empty">এখনো কোনো স্টাফ অ্যাকাউন্ট নেই। নিচের “স্টাফ ক্রিয়েট” বাটনে চেপে প্রথম স্টাফ যোগ করুন।</p>';
    return;
  }
  host.innerHTML = rows.length
    ? rows.map(staffCard).join('')
    : `<p class="admin-empty">“${escapeHtml(state.query)}” দিয়ে কোনো স্টাফ পাওয়া যায়নি। Staff ID, নাম, ইউজারনেম বা মোবাইল দিয়ে খুঁজুন।</p>`;
}

export async function renderStaff() {
  const host = $('#staffList');
  if (!host) return;
  state.staff = await listStaff();
  state.counts = staffCounts(state.staff);
  state.canManage = await canManageStaff();
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
}

/* ---------------------------------------------------------------------------
   Create / Edit
   ------------------------------------------------------------------------ */

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
      { name: 'password', label: 'পাসওয়ার্ড', type: 'password', required: true, hint: '৬–৩২ অক্ষর' },
      { name: 'confirmPassword', label: 'পাসওয়ার্ড নিশ্চিত করুন', type: 'password', required: true }
    ]),
    { name: 'role', label: 'Role', type: 'select', required: true, options: roleOptions, value: role },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions, value: record?.status || 'active' },
    { name: 'mobile', label: 'মোবাইল নম্বর', placeholder: '01XXXXXXXXX', value: record?.mobile },
    { name: 'email', label: 'ইমেইল (ঐচ্ছিক)', type: 'email', value: record?.email },
    { name: 'joiningDate', label: 'যোগদানের তারিখ', type: 'date', value: record?.joiningDate || '' },
    { name: 'address', label: 'ঠিকানা (ঐচ্ছিক)', max: 300, value: record?.address }
  ];
  return `
    <form id="staffForm" class="staff-form staff-create-form${editing ? ' is-editing' : ' is-creating'}" novalidate>
      ${editing ? `<div class="staff-form-notice">${icon('lock', 'staff-inline-icon')}<span>Staff ID <strong>${escapeHtml(record.staffId)}</strong> — স্থায়ী পরিচয়, পরিবর্তন করা যাবে না</span></div>` : `<div class="staff-create-guide"><span class="staff-guide-icon" aria-hidden="true">${icon('staff', 'staff-inline-icon')}</span><div><strong>৩টি সহজ ধাপে অ্যাকাউন্ট তৈরি</strong><small>পরিচিতি দিন, রোল বাছুন, তারপর দায়িত্বের তথ্য পূরণ করুন।</small></div></div>`}
      <div class="staff-form-section-block">
        <div class="staff-form-section-title"><span class="staff-section-number">১</span><div><strong>অ্যাকাউন্টের তথ্য</strong><small>স্টাফের পরিচয় ও লগইন তথ্য দিন</small></div></div>
        <div class="staff-form-grid">
          ${identityFields.slice(0, 2).map(spec => fieldRow(spec, spec.value)).join('')}
        </div>
      </div>
      <div class="staff-form-section-block">
        <div class="staff-form-section-title"><span class="staff-section-number">২</span><div><strong>রোল ও যোগাযোগ</strong><small>রোল নির্বাচন করলে Login User ID স্বয়ংক্রিয়ভাবে তৈরি হবে</small></div></div>
        <div class="staff-form-grid">
          ${identityFields.slice(2).map(spec => fieldRow(spec, spec.value)).join('')}
        </div>
      </div>
      <div class="staff-assignment staff-form-section-block" id="staffAssignmentFields" data-role="${escapeHtml(role)}">
        <div class="staff-form-section-title"><span class="staff-section-number">৩</span><div><strong id="staffAssignmentTitle">${escapeHtml(STAFF_ROLE_META[role]?.labelBn || 'স্টাফ')} — দায়িত্ব</strong><small>এই রোল অনুযায়ী প্রয়োজনীয় দায়িত্বের তথ্য দিন</small></div></div>
        <div class="staff-form-grid">
          ${roleAssignmentFields(role).map(spec => fieldRow(spec, spec.name === 'classes' ? assignment.classes : assignment[spec.name])).join('')}
        </div>
      </div>
      <div class="staff-form-footer">
        <p class="finance-error" id="staffFormError" role="alert" hidden></p>
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
      classes,
      subjects: get('subjects').split(',').map(item => item.trim()).filter(Boolean),
      batches: get('batches').split(',').map(item => item.trim()).filter(Boolean),
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
  const body = openModal('Staff Management', 'নতুন স্টাফ অ্যাকাউন্ট', staffFormHtml(null), { wide: true });
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
  const body = openModal('Staff Management', `${record.fullName} — সম্পাদনা`, staffFormHtml(record), { wide: true });
  const form = body.querySelector('#staffForm');
  refreshAutoId(form, record);
  if (record.protected) {
    const roleSelect = form.querySelector('#staffField-role');
    const statusSelect = form.querySelector('#staffField-status');
    const usernameInput = form.querySelector('#staffField-username');
    [roleSelect, statusSelect, usernameInput].forEach(control => control?.setAttribute('disabled', 'disabled'));
    const note = document.createElement('p');
    note.className = 'staff-protected-note';
    note.innerHTML = `${icon('shield', 'staff-inline-icon')} Current Admin → Protected: Role, Status ও Username লক করা আছে।`;
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

function wireForm(form, record) {
  const assignmentHost = form.querySelector('#staffAssignmentFields');
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
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
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
   Profile
   ------------------------------------------------------------------------ */

async function openProfile(staffId) {
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
    ['Role', `${escapeHtml(staffRoleLabel(record.role))}${record.role !== 'admin' && STAFF_ROLE_META[record.role] ? ` (${escapeHtml(STAFF_ROLE_META[record.role].label)})` : ''}`],
    ['Status', escapeHtml(staffStatusLabel(record.status))],
    ['মোবাইল', escapeHtml(record.mobile || '—')],
    ['ইমেইল', escapeHtml(record.email || '—')],
    ['ঠিকানা', escapeHtml(record.address || '—')],
    ['যোগদান', escapeHtml(record.joiningDate || '—')],
    ['পদবি', escapeHtml(assignment.designation || '—')],
    ['Assigned Class', (assignment.classes || []).length ? escapeHtml(assignment.classes.join(', ')) : '—'],
    ['বিষয়', (assignment.subjects || []).length ? escapeHtml(assignment.subjects.join(', ')) : '—'],
    ['ব্যাচ/স্কোপ', escapeHtml(assignment.batches?.join?.(', ') || assignment.counter || '—')],
    ['নোট', escapeHtml(assignment.notes || '—')]
  ];
  const history = Array.isArray(record.history) ? record.history : [];
  openModal('Staff Profile', record.fullName, `
    <div class="staff-profile-head">
      <span class="staff-avatar large" aria-hidden="true">${escapeHtml(String(record.fullName || '?').trim().slice(0, 1).toUpperCase())}</span>
      <div>
        <strong>${escapeHtml(record.fullName)}</strong>
        <p><span class="staff-id-badge">Staff ID: ${escapeHtml(record.staffId)}</span> <span class="badge ${(STAFF_STATUS[record.status] || STAFF_STATUS.inactive).className}">${escapeHtml(staffStatusLabel(record.status))}</span></p>
      </div>
    </div>
    <dl class="detail-grid">
      ${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}
    </dl>
    <div class="staff-activity">
      <p class="staff-form-section">Activity Summary</p>
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
  openModal('Security', `${record.fullName} — পাসওয়ার্ড রিসেট`, `
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
    closeModal();
    toastSafe(`${record.fullName} — পাসওয়ার্ড রিসেট হয়েছে (পরবর্তী লগইনে বদল করতে হবে)`);
    await refresh();
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
      <button class="admin-btn ghost" type="button" data-staff-modal="close">Cancel</button>
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
      closeModal();
      toastSafe(fallback.ok ? 'ইতিহাস অক্ষত রেখে অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে' : (result.error || 'মুছে ফেলা যায়নি'));
      await refresh();
      return;
    }
    modalError(result.error || 'মুছে ফেলা যায়নি।');
    return;
  }
  state.openMore = null;
  closeModal();
  toastSafe('স্টাফ অ্যাকাউন্ট মুছে ফেলা হয়েছে');
  await refresh();
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
  paintIcon($('#staffCreateButton .apc-icon'), 'add', 'apc-icon');

  $('#staffCreateButton')?.addEventListener('click', openCreate);

  $('#staffSearch')?.addEventListener('input', event => {
    state.query = event.target.value || '';
    state.openMore = null;
    renderList();
  });

  $('#staffSearchClear')?.addEventListener('click', () => {
    const input = $('#staffSearch');
    if (input) input.value = '';
    state.query = '';
    renderList();
    input?.focus();
  });

  $('#staffRoleFilter')?.addEventListener('click', event => {
    const chip = event.target.closest('[data-staff-role]');
    if (!chip) return;
    state.role = chip.dataset.staffRole;
    renderRoleFilter();
    renderList();
  });

  $('#staffStatusFilter')?.addEventListener('click', event => {
    const chip = event.target.closest('[data-staff-status]');
    if (!chip) return;
    state.status = chip.dataset.staffStatus;
    renderStatusFilter();
    renderList();
  });

  $('#staffList')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-staff-action]');
    if (!button) return;
    const { staffAction, staffId, nextStatus } = button.dataset;
    if (staffAction === 'more') {
      state.openMore = state.openMore === staffId ? null : staffId;
      renderList();
      return;
    }
    state.openMore = null;
    if (staffAction === 'view') await openProfile(staffId);
    else if (staffAction === 'edit') { closeModal(); await openEdit(staffId); }
    else if (staffAction === 'reset') await openReset(staffId);
    else if (staffAction === 'delete') await openDelete(staffId);
    else if (staffAction === 'confirm-delete') await confirmDelete(staffId);
    else if (staffAction === 'deactivate') await changeStatus(staffId, 'inactive');
    else if (staffAction === 'status') await changeStatus(staffId, nextStatus || 'inactive');
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#staffModalBackdrop')?.hidden) closeModal();
  });

  state.wired = true;
}

export { STAFF_ROLE_META, STAFF_STATUS };
