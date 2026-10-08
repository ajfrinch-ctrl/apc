import { studentRecordMarkup } from './student-record.js';
import { initAdminAcademics } from './admin-academics.js';
import { mountV2Migration } from './admin-migration.js';
import { mountSettingsHub } from './settings-hub.js';
import { iconMarkup } from './icons.js';
/* Admin panel — System Control + Staff Management + Permissions + Security +
   Data + Reports + Settings.

   Scope note: daily operations are NOT here on purpose.
     • fee collection / cash-counter entry  → payment.html (Cash Counter)
     • routine entry, daily notices         → manager.html (Manager)
     • student approval, exam publish       → manager.html (Manager)
     • teaching, homework, attendance       → teacher.html (Teacher)
   Admin sees system-level monitoring, owns every staff identity (Staff ID) and
   keeps the device's data safe. Username and password are required; the roster,
   notices and routine start empty and stay on this device. */
import { enabledClasses, DEFAULT_APP_SETTINGS, ADMIN_ID, DEFAULT_PIN, maintenanceState } from './config.js';
import { toBanglaNumber } from './ui.js';
import { classCodes } from './admin-data.js';
import { loadAppConfig, saveAppConfig, loadAccount, saveAccount } from './storage.js';
import { loadRoster, saveRoster, loadNotices, loadRoutine } from './office-data.js';
import { changeStaffPassword, updateStaffProfile, ensureBootstrapStaffAccounts, readStaffAccount, hasStaffSession, clearStaffSession, goToLoginPage, STAFF_SESSION_RULES } from './staff-auth.js';
import { installPanelGuard, lockPanel, rememberPanelPage, watchOwnPanelSession } from './panel-lockdown.js';
import { dateLabel } from './finance-data.js';
import { KEYS, readJSON, writeJSON } from './database.js';
import { mountReports, refreshReports } from './reports.js';
import { registerServiceWorker } from './service-worker.js';
import { initFixedShell } from './fixed-shell.js';
import { escapeHtml } from './sanitize.js';
import { matchesStudentQuery } from './student-search.js';
import { createAccess, CAPABILITIES, routeFromHash, VIEW_SEAT } from './admin-permissions.js';
import { rememberRoute, onRouteChange } from './panel-route.js';
import { openRegistrationReview, DECIDED_EVENT } from './registration-review.js';
import { initAdminPanelShell } from './admin-panel-ui.js';
import { paintIcon } from './icons.js';
import {
  BACKUP_STAMP_KEY,
  STAFF_DIRECTORY_KEY,
  STAFF_ROLE_META,
  STAFF_DIRECTORY_RULES,
  listStaff,
  staffActivitySummary,
  staffCounts,
  staffRoleLabel
} from './staff-directory.js';
import { initStaffManagement, renderStaff } from './staff-management.js';
import { ROLE_CAPABILITIES } from './admin-permissions.js';
import { runMigrations } from './storage/migration.js';

initFixedShell();
registerServiceWorker();
runMigrations();

const bn = toBanglaNumber;
const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));


const state = {
  students: loadRoster(),
  notices: loadNotices(),
  routine: loadRoutine(),
  enabled: new Set(enabledClasses),
  appConfig: loadAppConfig(),
  activeView: 'dashboard',
  activeDay: 'sat',
  filter: 'all',
  classFilter: 'all',
  query: '',
  /* Staff directory snapshot: kept in sync with js/staff-directory.js so the
     dashboard, reports, security and staff views read the same truth. */
  staff: [],
  staffCounts: { total: 0, active: 0, inactive: 0, suspended: 0, passwordDue: 0, byRole: {} },
  staffActivity: []
};

/* ---------- Role-based access ----------
   `access` is the single gate for what this panel may show and where it may
   navigate. It is rebuilt from the signed-in staff record's role every time the
   panel opens; the default matches admin.html until that record is read. */
let access = createAccess('admin');

/* ---------- Feedback toast ---------- */

let toastTimer;
function toast(message) {
  $('.admin-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'admin-toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 2800);
}

function persistStudents() { saveRoster(state.students); }
/* Notices and the weekly routine are no longer written from this panel — both
   are Manager-owned records (manager.html). They are only read here, for the
   routine report and the data-management statistics. */

async function enterPanel() {
  $('#adminShell').hidden = false;
  // The capability set follows the role stored in the account record — the
  // existing role system is never modified, only read.
  const account = await readStaffAccount('admin');
  access = createAccess(account?.role || 'admin');
  initAdminPanelShell({ access, onNavigate: navigate });
  // The অ্যাকাউন্ট → লগআউট row carries the same icon language as the top bar.
  paintIcon($('#adminAccountLogout .settings-icon'), 'logout', 'apc-icon-svg');
  // Staff Management is wired once; it re-reads the directory on every render
  // and calls back so the dashboard, reports and security stay in sync.
  initStaffManagement({ onChanged: onStaffChanged });
  await refreshStaffSnapshot();
  renderAll();
  // The Reports Module re-reads who is signed in and what they may see.
  /* Settings → the shared five-group structure (Admin অ্যাকাউন্ট seat). Profile,
     session/logout and password keep their own cards; the hub adds the
     notification group plus app, security and data rows. */
  mountSettingsHub({
    mount: '[data-settings-hub="admin"]',
    role: 'admin',
    session: { value: 'নিরাপত্তা নীতি অনুযায়ী সেশন', hint: 'ডিভাইস-বাউন্ড সেশন' }
  });
  mountReports($('#adminReports'), { panel: 'admin' });
  // A deep link (admin.html#staff) opens only when this role may see it;
  // anything else falls back to the first permitted tab.
  const route = routeFromHash(window.location.hash);
  setView(route && access.allowsView(route) ? route : state.activeView);
  const welcome = $('#adminWelcome');
  if (welcome) {
    welcome.textContent = 'স্বাগতম, এডমিন';
    welcome.hidden = false;
  }
  /* First-run provisioning of the other staff accounts. The one-time credential
     dialog it used to open was retired with the old login flow; nothing is shown,
     the accounts are simply ready for the shared login card. */
  readStaffAccount('admin')
    .then(account => ensureBootstrapStaffAccounts(account?.username || 'admin.apc'));
}

function exitPanel() {
  clearStaffSession('admin');
  // Logout always returns to the shared login page, never to a panel entry form.
  $('#adminShell').hidden = true;
  goToLoginPage();
}

/* ---------- View switching ---------- */

/** Which bottom seat lights up for a view that lives inside a hub. A hub's own
 *  cards (roles, security, settings, academics, backup) and the registration
 *  review reached from Home keep their seat lit while they are open. */
const seatFor = view => VIEW_SEAT[view] || view;

/**
 * Open one Admin Panel view.
 * Returns false (and changes nothing) when the role may not open it or when the
 * view is not in the DOM — this is the route guard behind every menu item,
 * shortcut, tile and hash link.
 */
function setView(view) {
  const target = String(view || '').trim();
  if (!access.allowsView(target)) return false;
  if (!$$('.admin-view').some(panel => panel.dataset.viewPanel === target)) return false;
  state.activeView = target;
  $('#adminMain')?.classList.toggle('is-staff-view', target === 'staff');
  $$('.admin-view').forEach(panel => panel.classList.toggle('active', panel.dataset.viewPanel === target));
  const seat = seatFor(target);
  $$('.admin-bottom-item').forEach(item => {
    const active = item.dataset.adminView === seat;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  $('#adminMain').scrollTo({ top: 0, behavior: 'instant' });
  // The open page is remembered in the URL: a refresh reopens it, not the
  // first permitted tab.
  rememberRoute(target);
  return true;
}

/**
 * One navigation path for every entry point (bottom bar, "More" menu, dashboard
 * tiles, shortcuts, back buttons and hash links). Permission is checked before
 * anything moves, so an unauthorised destination can never be opened — not even
 * by a hand-typed URL or a stale bookmark.
 */
function navigate(view, source) {
  const target = String(view || '').trim();
  if (!access.allowsView(target)) {
    toast('এই বিভাগে প্রবেশের অনুমতি আপনার Role-এ নেই।');
    setView(access.defaultView());
    return false;
  }
  if (source?.dataset?.studentScope === 'pending') {
    state.filter = 'pending';
    state.query = '';
    state.classFilter = 'all';
    if ($('#studentSearch')) $('#studentSearch').value = '';
    const classSelect = $('#studentClassFilter');
    if (classSelect) classSelect.value = 'all';
    $$('#studentFilterChips .chip').forEach(chip => chip.classList.toggle('active', chip.dataset.studentFilter === 'pending'));
    renderStudents();
  }
  if (!setView(target)) return false;
  if (source?.matches?.('.admin-more-item, .admin-more-back, .admin-bottom-item')) {
    const heading = $('.admin-view.active h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  }
  return true;
}

/* ---------- Dashboard ---------- */


function renderDashboard() {
  $('#dashStudentCount').textContent = bn(state.students.length);
  $('#dashClassCount').textContent = bn(state.enabled.size);
  if ($('#dashStaffCount')) $('#dashStaffCount').textContent = bn(state.staffCounts.active || 0);
  if ($('#dashProtectedCount')) {
    $('#dashProtectedCount').textContent = bn(state.staff.filter(staff => staff.protected).length || 0);
  }
  /* A switched-on maintenance notice is easy to forget, and a forgotten notice
     is exactly how students end up staring at one for days. The dashboard keeps
     saying so until the switch in System Settings is turned off again. */
  const flag = $('#adminMaintenanceFlag');
  if (flag) {
    const { on } = maintenanceState(loadAppConfig());
    flag.hidden = !on;
    flag.textContent = on
      ? '⚠️ রক্ষণাবেক্ষণ মোড চালু আছে — শিক্ষার্থী অ্যাপে সতর্কতা ব্যানার দেখা যাচ্ছে। সিস্টেম সেটিংস থেকে বন্ধ করুন।'
      : '';
  }
  const today = new Date();
  $('#adminTodayDate').textContent = dateLabel(today);
  $('#adminTodayDate').dateTime = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

/* ---------- Students ---------- */


function normalizeDigitsOnly(text) {
  return String(text || '')
    .replace(/[০-৯]/g, d => '০১২৩৪৫৬৭৮৯'.indexOf(d))
    .replace(/[^0-9]/g, '');
}

const statusMeta = Object.freeze({
  approved: { label: 'অনুমোদিত', className: 'badge-approved' },
  pending: { label: 'অপেক্ষমাণ', className: 'badge-pending' },
  rejected: { label: 'বাতিল', className: 'badge-rejected' }
});

function visibleStudents() {
  const query = state.query.trim();

  return state.students.filter(student => {
    const matchesFilter = state.filter === 'all' || student.status === state.filter;
    if (!matchesFilter) return false;
    // Class filter (student management made easy: pick a class, see only that class).
    if (state.classFilter !== 'all' && student.className !== state.classFilter) return false;
    if (!query) return true;
    // One shared rule for every panel: the permanent Student ID is the tracking
    // key (full, short, Bangla digits or without dashes), plus name, guardian
    // name, mobiles, class and group. See js/student-search.js.
    return matchesStudentQuery(student, query);
  });
}


function renderStudents() {
  const list = visibleStudents();
  const clearBtn = $('#studentSearchClear');
  const countBadge = $('#studentCountBadge');

  if (clearBtn) clearBtn.hidden = !state.query.trim();

  if (countBadge) {
    const count = list.length;
    countBadge.textContent = state.query.trim()
      ? (count > 0 ? `${bn(count)} জন শিক্ষার্থী পাওয়া গেছে` : 'কোনো ফলাফল মেলেনি')
      : `${bn(count)} জন শিক্ষার্থী`;
  }

  $('#studentList').innerHTML = list.length
    ? list.map(student => {
        const status = statusMeta[student.status] || statusMeta.pending;
        // The row stays deliberately bare: name, Student ID and status. Class,
        // guardian, address and phone numbers are personal data and appear only
        // after "তথ্য দেখুন" — never in the open list.
        return `
          <article class="student-row student-row-redesigned">
            <div class="student-row-main">
              <span class="student-avatar" aria-hidden="true">${iconMarkup("users")}</span>
              <div class="student-copy">
                <div class="student-title-line">
                  <strong>${escapeHtml(student.name || 'নাম নেই')}</strong>
                  <span class="badge ${status.className}">${status.label}</span>
                </div>
                <div class="student-meta-line">
                  <span class="audit-id-badge">ID: ${escapeHtml(student.id)}</span>
                </div>
              </div>
            </div>
            <div class="student-actions">
              <button class="mini-btn primary" type="button" data-action="view" data-id="${escapeHtml(student.id)}">তথ্য দেখুন</button>
              <button class="mini-btn" type="button" data-action="edit" data-id="${escapeHtml(student.id)}">সম্পাদনা</button>
              <button class="mini-btn" type="button" data-action="reset-pin" data-id="${escapeHtml(student.id)}">পাসওয়ার্ড রিসেট</button>
              ${student.status === 'pending' && access.has(CAPABILITIES.STUDENTS_APPROVE)
                ? `<button class="mini-btn approve" type="button" data-action="review-registration" data-id="${escapeHtml(student.id)}">রিভিউ ও অনুমোদন</button>`
                : ''}
            </div>
          </article>`;
      }).join('')
    : state.query.trim()
      ? `<div class="admin-empty-search"><p>🔍 "${escapeHtml(state.query.trim())}" দিয়ে কোনো শিক্ষার্থী পাওয়া যায়নি</p><small>Student ID, নাম, পিতার নাম, শ্রেণি বা মোবাইল নম্বর দিয়ে খুঁজে দেখুন।</small></div>`
      : '<p class="admin-empty">এই ফিল্টারে কোনো শিক্ষার্থী নেই। সার্চ বা ফিল্টার বদলে দেখুন।</p>';
}
function findStudent(id) {
  return state.students.find(student => student.id === id);
}

/* ---------- Student detail and পাসওয়ার্ড reset modal ---------- */

function openStudentDetail(student) {
  openModal('শিক্ষার্থী প্রোফাইল', student.name || 'নাম দেওয়া হয়নি', studentRecordMarkup(student), 'student-record');
  const actions = $('#adminModalBody').querySelectorAll('[data-modal-action]');
  actions.forEach(button => {
    button.addEventListener('click', () => {
      const action = button.dataset.modalAction;
      if (action === 'reset-pin') {
        openPinReset(student);
        return;
      } else if (action === 'edit') {
        openStudentEdit(student);
        return;
      }
      closeModal();
    });
  });
}

/* ---------- Student edit modal ---------- */

const editableClasses = enabledClasses;

function openStudentEdit(student) {
  const fee = student.monthlyFee ?? '';
  openModal(
    'শিক্ষার্থী তথ্য সম্পাদনা',
    `${student.name} — ${student.id}`,
    `
      <form id="studentEditForm" class="student-edit-form" novalidate>
        <div class="form-grid-2">
          <div>
            <label for="editStudentName">নাম (বাংলা) *</label>
            <input id="editStudentName" type="text" maxlength="120" value="${escapeHtml(student.name)}" required>
          </div>
          <div>
            <label for="editStudentNameEn">নাম (English)</label>
            <input id="editStudentNameEn" type="text" maxlength="120" value="${escapeHtml(student.nameEn || '')}">
          </div>
        </div>
        <label for="editStudentFather">পিতার নাম</label>
        <input id="editStudentFather" type="text" maxlength="120" value="${escapeHtml(student.fatherName || '')}">
        <div class="form-grid-2">
          <div>
            <label for="editStudentClass">শ্রেণি *</label>
            <select id="editStudentClass" required>
              ${editableClasses.map(className => `<option value="${escapeHtml(className)}" ${className === student.className ? 'selected' : ''}>${escapeHtml(className)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="editStudentGroup">বিভাগ / গ্রুপ</label>
            <input id="editStudentGroup" type="text" maxlength="80" value="${escapeHtml(student.group || '')}">
          </div>
        </div>
        <div class="form-grid-2">
          <div>
            <label for="editStudentMobile">মোবাইল *</label>
            <input id="editStudentMobile" type="tel" inputmode="numeric" maxlength="14" value="${escapeHtml(student.mobile || '')}" required>
          </div>
          <div>
            <label for="editStudentGuardianMobile">অভিভাবকের মোবাইল</label>
            <input id="editStudentGuardianMobile" type="tel" inputmode="numeric" maxlength="14" value="${escapeHtml(student.guardianMobile || '')}">
          </div>
        </div>
        <label for="editStudentAddress">ঠিকানা</label>
        <input id="editStudentAddress" type="text" maxlength="300" value="${escapeHtml(student.address || '')}">
        <label for="editStudentFee">নির্ধারিত মাসিক ফি (৳) — খালি রাখলে ডিফল্ট ৳১,৫০০</label>
        <input id="editStudentFee" type="number" min="0" max="1000000" step="1" value="${escapeHtml(String(fee))}" placeholder="1500">
        <p id="studentEditError" class="finance-error" role="alert" hidden></p>
        <div class="modal-actions">
          <button class="admin-btn primary" type="submit">সংরক্ষণ করুন</button>
          <button class="admin-btn ghost" type="button" data-edit-cancel>বাতিল</button>
        </div>
      </form>`
  );
  $('#adminModalBody [data-edit-cancel]').addEventListener('click', () => { closeModal(); });
  $('#studentEditForm').addEventListener('submit', event => {
    event.preventDefault();
    saveStudentEdit(student);
  });
}

function saveStudentEdit(student) {
  const name = $('#editStudentName').value.trim();
  const mobile = normalizeDigitsOnly($('#editStudentMobile').value);
  const guardianMobile = normalizeDigitsOnly($('#editStudentGuardianMobile').value);
  const error = $('#studentEditError');
  const fail = message => {
    error.textContent = message;
    error.hidden = false;
  };
  if (!name) return fail('শিক্ষার্থীর নাম দিন।');
  if (mobile.length !== 11 || !mobile.startsWith('01')) return fail('মোবাইল নম্বরটি ০১ দিয়ে শুরু হওয়া ১১ সংখ্যার হতে হবে।');
  if (guardianMobile && (guardianMobile.length !== 11 || !guardianMobile.startsWith('01'))) return fail('অভিভাবকের মোবাইল নম্বরটি সঠিক নয় (১১ সংখ্যা)।');
  const feeRaw = $('#editStudentFee').value.trim();
  let monthlyFee = null;
  if (feeRaw !== '') {
    monthlyFee = Number(feeRaw);
    if (!Number.isFinite(monthlyFee) || monthlyFee < 0 || monthlyFee > 1000000) return fail('মাসিক ফি সঠিক সংখ্যা দিন।');
  }
  const className = $('#editStudentClass').value;
  Object.assign(student, {
    name,
    nameEn: $('#editStudentNameEn').value.trim(),
    fatherName: $('#editStudentFather').value.trim(),
    className,
    group: $('#editStudentGroup').value.trim(),
    mobile,
    guardianMobile,
    address: $('#editStudentAddress').value.trim(),
    monthlyFee
  });
  persistStudents();
  closeModal();
  renderStudents();
  renderDashboard();
  toast(`${name} এর তথ্য সম্পাদনা করা হয়েছে`);
}

function openPinReset(student) {
  const account = loadAccount();
  const isLocal = account?.student?.id === student.id || account?.studentId === student.id;
  openModal(
    'অ্যাকাউন্ট নিরাপত্তা',
    `${student.name} — ডিফল্ট পাসওয়ার্ড`,
    `<p class="modal-copy">${isLocal ? 'নিশ্চিত করলে এই ব্রাউজারের অ্যাকাউন্টের পাসওয়ার্ড নিচের ডিফল্ট পাসওয়ার্ড হবে। নিবন্ধনের মোবাইল অপরিবর্তিত থাকবে।' : 'ডিফল্ট পাসওয়ার্ড নিচে দেওয়া আছে। এই শিক্ষার্থীর অ্যাকাউন্ট এই ব্রাউজারে নেই; এটি শুধু ডেমো, আসল পাসওয়ার্ড পরিবর্তন হবে না।'}</p>
      <div class="pin-box" aria-label="নতুন পাসওয়ার্ড">${bn(DEFAULT_PIN)}</div>
      <p id="pinResetError" class="finance-error" role="alert" hidden></p>
      <div class="modal-actions"><button class="admin-btn primary" type="button" data-modal-action="done">${isLocal ? 'রিসেট নিশ্চিত করুন' : 'বুঝেছি'}</button></div>`
  );
  $('#adminModalBody [data-modal-action="done"]').addEventListener('click', async () => {
    if (isLocal) {
      const latest = loadAccount();
      if ((latest?.student?.id !== student.id && latest?.studentId !== student.id) || !(await saveAccount({ ...latest, pin: DEFAULT_PIN }))) {
        $('#pinResetError').textContent = 'পাসওয়ার্ড সংরক্ষণ হয়নি। আবার চেষ্টা করুন।';
        $('#pinResetError').hidden = false;
        return;
      }
    }
    closeModal();
    toast(isLocal ? `${student.name} এর পাসওয়ার্ড রিসেট হয়েছে` : 'ডেমো ডিফল্ট পাসওয়ার্ড দেখানো হয়েছে');
  });
}

let modalTrigger;
function openModal(kicker, title, bodyHtml, variant = '') {
  $('#adminModalBackdrop .admin-modal').classList.toggle('student-record-modal', variant === 'student-record');
  if ($('#adminModalBackdrop').hidden) modalTrigger = document.activeElement;
  $('#adminModalKicker').textContent = kicker;
  $('#adminModalTitle').textContent = title;
  $('#adminModalBody').innerHTML = bodyHtml;
  $('#adminModalBackdrop').hidden = false;
  document.body.classList.add('admin-modal-open');
  window.setTimeout(() => $('#adminModalClose').focus(), 50);
}

function closeModal() {
  $('#adminModalBackdrop').hidden = true;
  document.body.classList.remove('admin-modal-open');
  const canRestore = modalTrigger?.isConnected && modalTrigger.matches('button, input, select, textarea, a[href], [tabindex]') && !modalTrigger.disabled && modalTrigger.getClientRects().length;
  const target = canRestore ? modalTrigger : $('#adminModalClose');
  target?.focus({ preventScroll: true });
}

/* Notices and weekly routine entry were removed from this panel: both are
   daily operations owned by the Manager portal (manager.html). The records
   themselves stay in the shared collections, so reports can still read them. */

/* ---------- Classes ---------- */

function renderClasses() {
  $('#classesCount').textContent = `${bn(state.enabled.size)} / ${bn(enabledClasses.length)} চালু`;
  $('#classList').innerHTML = enabledClasses.map(className => {
    const count = state.students.filter(student => student.className === className && student.status !== 'rejected').length;
    const enabled = state.enabled.has(className);
    const code = classCodes[className] || 'CLS-GEN';
    return `
      <div class="class-row">
        <div class="class-copy">
          <div style="display:flex;align-items:center;gap:6px;">
            <strong>${className}</strong>
            <span class="audit-id-badge purple">${code}</span>
          </div>
          <small>${bn(count)} শিক্ষার্থী</small>
        </div>
        <label class="switch" aria-label="${className} চালু বা বন্ধ করুন">
          <input type="checkbox" data-class-name="${className}" ${enabled ? 'checked' : ''}>
          <span class="switch-track"></span>
        </label>
      </div>`;
  }).join('');
}

function toggleClass(event) {
  const input = event.target;
  if (input.tagName !== 'INPUT') return;
  const className = input.dataset.className;
  if (input.checked) state.enabled.add(className);
  else state.enabled.delete(className);
  renderClasses();
  renderDashboard();
  toast(`${className} [${classCodes[className] || 'CLS-GEN'}] ${input.checked ? 'চালু' : 'বন্ধ'} করা হয়েছে (ডেমো)`);
}

/* ---------- Student App Management ---------- */

/* Teacher registration control: on/off switch + current teacher list. */
function routineTeacherNames() {
  return [...new Set(Object.values(state.routine).flatMap(info => info.classes.map(cls => cls.teacher).filter(Boolean)))];
}

function renderAppManagement() {
  const cfg = state.appConfig || loadAppConfig();
  if ($('#cfgPushNotifications')) $('#cfgPushNotifications').checked = cfg.pushNotifications !== false;
  if ($('#cfgBroadcastAlert')) $('#cfgBroadcastAlert').checked = Boolean(cfg.broadcastAlert);
  if ($('#cfgBroadcastMessage')) $('#cfgBroadcastMessage').value = cfg.broadcastMessage || '';
  if ($('#broadcastState')) {
    $('#broadcastState').textContent = cfg.broadcastAlert && cfg.broadcastMessage
      ? 'এখন চালু আছে — সব ডিভাইসে দেখা যাচ্ছে।'
      : 'এখন বন্ধ আছে।';
  }
  if ($('#cfgTagline')) $('#cfgTagline').value = cfg.tagline || 'শিখতে থাকো, এগিয়ে যাও';
  if ($('#cfgHelpline')) $('#cfgHelpline').value = cfg.helplineMobile || ADMIN_ID || '01819486966';
  if ($('#cfgWhatsapp')) $('#cfgWhatsapp').value = cfg.whatsappNumber || ADMIN_ID || '01819486966';
  if ($('#cfgEmail')) $('#cfgEmail').value = cfg.officialEmail || 'activeplus.coaching@gmail.com';
  if ($('#cfgAddress')) $('#cfgAddress').value = cfg.campusAddress || 'দিনাজপুর সদর, দিনাজপুর';
  renderMaintenanceSettings(cfg);
}

/* Maintenance mode. The switch is the only control that exists for this flag,
   so it also doubles as the way out of a notice that is stuck on: an admin who
   unchecks it and saves writes an explicit `false`, which every synced device
   then honours (js/main.js repaints on the settings write). */
function renderMaintenanceSettings(cfg = state.appConfig || loadAppConfig()) {
  const { on } = maintenanceState(cfg);
  if ($('#cfgMaintenanceMode')) $('#cfgMaintenanceMode').checked = on;
  // The stored text, never the fallback: an empty box means "use the default",
  // and saving an untouched box must not freeze the default into the document.
  if ($('#cfgMaintenanceMessage')) $('#cfgMaintenanceMessage').value = String(cfg.maintenanceMessage || '');
  if ($('#maintenanceState')) {
    $('#maintenanceState').textContent = on
      ? 'এখন চালু আছে — শিক্ষার্থী অ্যাপে সতর্কতা ব্যানার দেখা যাচ্ছে।'
      : 'এখন বন্ধ আছে — শিক্ষার্থী অ্যাপ স্বাভাবিকভাবে চলছে।';
  }
}

function saveMaintenanceFromForm() {
  const current = state.appConfig || loadAppConfig();
  const on = Boolean($('#cfgMaintenanceMode')?.checked);
  const message = $('#cfgMaintenanceMessage')?.value.trim().slice(0, 500) || '';
  /* Exactly what is in the box: an empty message is not an error, the student
     app falls back to its default notice (js/config.js maintenanceState). */
  state.appConfig = { ...current, maintenanceMode: on, maintenanceMessage: message };
  saveAppConfig(state.appConfig);
  renderMaintenanceSettings(state.appConfig);
  renderDashboard();   // the dashboard reminder follows the switch immediately
  toast(on ? 'রক্ষণাবেক্ষণ মোড চালু করা হয়েছে' : 'রক্ষণাবেক্ষণ মোড বন্ধ করা হয়েছে — ব্যানার সরে গেছে');
}

function saveAppSettingsFromForm() {
  const current = state.appConfig || loadAppConfig();
  state.appConfig = {
    ...current,
    tagline: $('#cfgTagline')?.value.trim() || current.tagline || DEFAULT_APP_SETTINGS.tagline,
    helplineMobile: $('#cfgHelpline')?.value.trim() || current.helplineMobile || DEFAULT_APP_SETTINGS.helplineMobile,
    whatsappNumber: $('#cfgWhatsapp')?.value.trim() || current.whatsappNumber || DEFAULT_APP_SETTINGS.whatsappNumber,
    officialEmail: $('#cfgEmail')?.value.trim() || current.officialEmail || DEFAULT_APP_SETTINGS.officialEmail,
    campusAddress: $('#cfgAddress')?.value.trim() || current.campusAddress || DEFAULT_APP_SETTINGS.campusAddress
  };
  saveAppConfig(state.appConfig);
  renderAppManagement();
  toast('ব্র্যান্ডিং ও যোগাযোগের তথ্য সংরক্ষিত হয়েছে');
}

/* Urgent announcement: one switch + one message that every device receives as
   a notification. Clearing the message turns it off on every device too. */
function saveBroadcastFromForm() {
  const current = state.appConfig || loadAppConfig();
  const message = $('#cfgBroadcastMessage')?.value.trim().slice(0, 500) || '';
  const alert = Boolean($('#cfgBroadcastAlert')?.checked) && Boolean(message);
  const pushOn = $('#cfgPushNotifications') ? Boolean($('#cfgPushNotifications').checked) : current.pushNotifications !== false;
  state.appConfig = { ...current, pushNotifications: pushOn, broadcastAlert: alert, broadcastMessage: message };
  saveAppConfig(state.appConfig);
  renderAppManagement();
  toast(!pushOn
    ? 'নোটিফিকেশন বন্ধ করা হয়েছে — শুধু ইন-অ্যাপ নোটিশ তালিকা থাকবে'
    : alert ? 'জরুরি ঘোষণা সব ডিভাইসে পাঠানো হয়েছে' : 'জরুরি ঘোষণা বন্ধ করা হয়েছে');
}

/* ---------- Roles & Permissions ----------
   A read-only projection of the role tree that already exists in this
   repository (firestore.rules, functions/index.js, manager.html). Nothing here
   edits it: Admin sees who may do what, and whose job an operation is. */

const ROLE_ORDER = Object.freeze(['admin', 'manager', 'teacher', 'payment', 'student']);

const ROLE_SUMMARY = Object.freeze({
  admin: 'System Control, স্টাফ ম্যানেজমেন্ট, অনুমতি, সিকিউরিটি, ডেটা, ব্যাকআপ, রিপোর্ট ও সেটিংস',
  manager: 'দৈনন্দিন অপারেশন: শিক্ষার্থী অনুমোদন, নোটিশ, রুটিন, পরীক্ষা প্রকাশ, হিসাব পর্যালোচনা',
  teacher: 'ক্লাস, বাড়ির কাজ, উপস্থিতি, সাজেশন ও পরীক্ষা — Teacher প্যানেল',
  payment: 'ফি গ্রহণ ও ক্যাশ কাউন্টার এন্ট্রি — Payment রিসিভ প্যানেল',
  student: 'নিজের প্রোফাইল, রুটিন, কোর্স, ফলাফল ও নোটিশ — শিক্ষার্থী অ্যাপ'
});

const CAPABILITY_LABELS = Object.freeze({
  'dashboard.view': 'সিস্টেম ড্যাশবোর্ড',
  'staff.manage': 'স্টাফ ম্যানেজমেন্ট (CRUD)',
  'roles.manage': 'রোল ও অনুমতি দেখা',
  'students.view': 'শিক্ষার্থী তালিকা ও প্রোফাইল',
  'students.manage': 'শিক্ষার্থী রেকর্ড হালনাগাদ',
  'students.approve': 'শিক্ষার্থী অনুমোদন/বাতিল',
  'reports.view': 'রিপোর্ট সেন্টার',
  'data.manage': 'ডেটা ম্যানেজমেন্ট',
  'backup.manage': 'ব্যাকআপ ও রিস্টোর',
  'security.manage': 'সিকিউরিটি পর্যবেক্ষণ',
  'settings.manage': 'সিস্টেম সেটিংস',
  'profile.view': 'নিজের প্রোফাইল',
  'finance.view': 'হিসাব পর্যবেক্ষণ',
  'finance.collect': 'ফি গ্রহণ',
  'notices.manage': 'নোটিশ প্রকাশ',
  'routine.manage': 'ক্লাস রুটিন এন্ট্রি',
  'classes.manage': 'ক্লাস চালু/বন্ধ',
  'app.manage': 'শিক্ষার্থী অ্যাপ কন্ট্রোল',
  'exams.view': 'পরীক্ষা দেখা',
  'exams.publish': 'পরীক্ষা প্রকাশ/প্রত্যাখ্যান',
  'teaching.panel': 'Teacher প্যানেল',
  'payment.panel': 'Payment প্যানেল'
});

const ROLE_ICONS = Object.freeze({
  admin: 'shield',
  manager: 'sliders',
  teacher: 'book',
  payment: 'wallet',
  student: 'users'
});

function renderRoles() {
  const host = $('#rolesMatrix');
  if (!host) return;
  const counts = state.staffCounts.byRole || {};
  host.innerHTML = ROLE_ORDER.map(role => {
    const capabilities = ROLE_CAPABILITIES[role] || [];
    const staffRole = role === 'payment' ? 'cash-counter' : role;
    const meta = STAFF_ROLE_META[staffRole];
    const label = meta ? `${meta.labelBn} (${meta.label})` : role === 'student' ? 'শিক্ষার্থী (Student)' : role;
    const chips = Object.keys(CAPABILITY_LABELS).map(capability => `
      <li class="${capabilities.includes(capability) ? '' : 'is-denied'}">${escapeHtml(CAPABILITY_LABELS[capability])}</li>`).join('');
    const staffCount = role === 'student' ? state.students.length : (counts[staffRole] ?? 0);
    return `
      <article class="admin-card role-card">
        <header class="admin-card-head">
          <div>
            <p class="eyebrow">${escapeHtml(role === 'student' ? 'Student' : meta ? meta.label : role)}</p>
            <h2>${escapeHtml(label)}</h2>
          </div>
          <span class="badge ${role === 'admin' ? 'badge-approved' : 'badge-pending'}">${role === 'student' ? bn(state.students.length) : bn(staffCount)} ${role === 'student' ? 'জন শিক্ষার্থী' : 'জন স্টাফ'}</span>
        </header>
        <div class="role-head">
          <span class="role-icon" aria-hidden="true"></span>
          <div><h3>${escapeHtml(ROLE_SUMMARY[role] || '')}</h3>
          <small>${capabilities.length ? `${bn(capabilities.length)}টি অনুমতি • Admin এই রোলের কাজ নিজের প্যানেলে আনে না` : 'Admin প্যানেলে কোনো অনুমতি নেই'}</small></div>
        </div>
        <ul class="role-cap-list">${chips}</ul>
      </article>`;
  }).join('');
  host.querySelectorAll('.role-card').forEach((card, index) => {
    paintIcon(card.querySelector('.role-icon'), ROLE_ICONS[ROLE_ORDER[index]] || 'shield', 'role-icon-svg');
  });
}

/* ---------- Data Management ---------- */

const DATA_COLLECTIONS = Object.freeze([
  { key: KEYS.students, label: 'শিক্ষার্থী (Roster)', hint: 'নিবন্ধন, শ্রেণি, স্ট্যাটাস' },
  { key: KEYS.transactions, label: 'লেনদেন (Finance)', hint: 'ফি আদায়ের রেকর্ড ও রসিদ তথ্য' },
  { key: KEYS.notices, label: 'নোটিশ', hint: 'প্রকাশিত ঘোষণা' },
  { key: KEYS.routine, label: 'ক্লাস রুটিন', hint: 'সাপ্তাহিক ক্লাস ও শিক্ষক' },
  { key: KEYS.teaching, label: 'একাডেমিক কার্যক্রম', hint: 'বাড়ির কাজ, উপস্থিতি, সাজেশন' },
  { key: KEYS.exams, label: 'পরীক্ষা', hint: 'প্রশ্নপত্র, উত্তর ও ফলাফল' },
  { key: KEYS.settings, label: 'অ্যাপ সেটিংস', hint: 'কনফিগারেশন ও ব্র্যান্ডিং' },
  { key: STAFF_DIRECTORY_KEY, label: 'স্টাফ ডিরেক্টরি', hint: 'Staff ID, রোল ও অ্যাসাইনমেন্ট' }
]);

function collectionCount(key) {
  const value = readJSON(key, null);
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') {
    if (Array.isArray(value.records)) return value.records.length;
    if (Array.isArray(value.activities)) return value.activities.length;
    if (Array.isArray(value.exams)) return value.exams.length;
    if (KEYS.routine === key) {
      return Object.values(value).reduce((sum, day) => sum + (Array.isArray(day?.classes) ? day.classes.length : 0), 0);
    }
    return Object.keys(value).length;
  }
  return 0;
}

function storageNote() {
  let bytes = 0;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith('activePlus') && !key.startsWith('active-plus')) continue;
      bytes += (window.localStorage.getItem(key) || '').length * 2;
    }
  } catch { return 'স্টোরেজ হিসাব করা যায়নি।'; }
  const kb = Math.round(bytes / 1024);
  return `আনুমানিক ব্যবহৃত স্টোরেজ: ${bn(kb)} KB • সব তথ্য শুধু এই ডিভাইসে থাকে (কোনো সার্ভার নয়)।`;
}

function renderDataManagement() {
  const list = $('#dataCollectionList');
  const select = $('#dataClearSelect');
  if (!list && !select) return;
  const rows = DATA_COLLECTIONS.map(item => ({ ...item, count: collectionCount(item.key) }));
  if (list) {
    list.innerHTML = rows.map(row => `
      <div class="data-row">
        <div>
          <strong>${escapeHtml(row.label)}</strong>
          <small>${escapeHtml(row.hint)}</small>
        </div>
        <span class="data-count">${bn(row.count)} টি</span>
      </div>`).join('');
  }
  const note = $('#dataStorageNote');
  if (note) note.textContent = storageNote();
  if (select && !select.options.length) {
    select.innerHTML = DATA_COLLECTIONS
      .map(item => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`).join('');
  }
}

function clearSelectedCollection() {
  const select = $('#dataClearSelect');
  const key = select?.value;
  if (!key) return;
  const item = DATA_COLLECTIONS.find(entry => entry.key === key);
  if (!item) return;
  const count = collectionCount(key);
  openModal('Data Management', `${item.label} মুছে ফেলবেন?`, `
    <p class="staff-confirm-copy">এই সংগ্রহের <strong>${bn(count)}</strong> টি রেকর্ড স্থায়ীভাবে মুছে যাবে। আগে Backup &amp; Restore থেকে ব্যাকআপ নেওয়ার পরামর্শ দেওয়া হয়।</p>
    <div class="modal-actions">
      <button class="admin-btn ghost" type="button" data-modal-action="close">বাতিল</button>
      <button class="admin-btn danger" type="button" data-modal-action="clear-data" data-clear-key="${escapeHtml(key)}">মুছে ফেলুন</button>
    </div>`);
  const button = $('#adminModalBody [data-modal-action="clear-data"]');
  button?.addEventListener('click', async () => {
    if (!access.has(CAPABILITIES.DATA_MANAGE)) {
      closeModal();
      toast('এই কাজটি শুধু Admin করতে পারবেন।');
      return;
    }
    if (key === STAFF_DIRECTORY_KEY) {
      closeModal();
      toast('স্টাফ ডিরেক্টরি সরাসরি মুছে ফেলা যায় না — স্টাফ ম্যানেজমেন্ট ব্যবহার করুন।');
      return;
    }
    try {
      window.localStorage.removeItem(key);
    } catch {
      closeModal();
      toast('ডেটা মুছে ফেলা যায়নি — স্টোরেজ পরীক্ষা করুন।');
      return;
    }
    closeModal();
    toast(`${item.label} মুছে ফেলা হয়েছে`);
    state.students = loadRoster();
    state.routine = loadRoutine();
    state.notices = loadNotices();
    await refreshStaffSnapshot();
    renderAll();
  });
}

function resetAllLocalData() {
  // Destructive reset is intentionally unavailable while offline records and
  // pending operations are the primary durable copy. No storage is cleared.
  toast('ডেটা সুরক্ষার জন্য সম্পূর্ণ রিসেট বন্ধ আছে। আগে ব্যাকআপ এক্সপোর্ট করুন।');
}

function renderBackup() {
  paintIcon($('#backupExportButton .apc-icon'), 'download', 'apc-icon');
  paintIcon($('#backupRestoreButton .apc-icon'), 'upload', 'apc-icon');
  const badge = $('#backupLastBadge');
  if (!badge) return;
  const stamp = readJSON(BACKUP_STAMP_KEY, null);
  const text = stamp ? String(stamp).slice(0, 10) : 'এখনো কোনো ব্যাকআপ নেওয়া হয়নি';
  badge.textContent = stamp ? `সর্বশেষ: ${escapeHtml(text)}` : text;
  badge.className = `badge ${stamp ? 'badge-approved' : 'badge-pending'}`;
}

function backupFileName() {
  return `APC-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

async function exportBackup() {
  if (!access.has(CAPABILITIES.BACKUP_MANAGE)) {
    toast('ব্যাকআপ শুধু Admin নিতে পারবেন।');
    return;
  }
  const payload = { kind: 'active-plus-backup', version: 1, createdAt: new Date().toISOString(), data: {} };
  for (const key of BACKUP_KEYS) {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) payload.data[key] = raw;
  }
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFileName();
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    writeJSON(BACKUP_STAMP_KEY, new Date().toISOString());
    renderBackup();
    toast('ব্যাকআপ ডাউনলোড শুরু হয়েছে');
  } catch {
    toast('ব্যাকআপ তৈরি করা যায়নি — ব্রাউজারের ডাউনলোড অনুমতি পরীক্ষা করুন।');
  }
}

async function restoreBackup(file) {
  const status = $('#backupStatus');
  if (!file) return;
  if (!access.has(CAPABILITIES.BACKUP_MANAGE)) {
    if (status) status.textContent = 'রিস্টোর শুধু Admin করতে পারবেন।';
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    if (status) status.textContent = 'এটি সঠিক ব্যাকআপ ফাইল নয় (JSON পড়া যায়নি)।';
    return;
  }
  if (payload?.kind !== 'active-plus-backup' || !payload.data || typeof payload.data !== 'object') {
    if (status) status.textContent = 'এই ফাইলটি Active Plus ব্যাকআপ নয়।';
    return;
  }
  const keys = Object.keys(payload.data);
  openModal('Backup & Restore', 'ব্যাকআপ ফিরিয়ে আনবেন?', `
    <p class="staff-confirm-copy">এই ফাইলে <strong>${bn(keys.length)}</strong>টি সংগ্রহ আছে (${escapeHtml(String(payload.createdAt || '').slice(0, 10))})। রিস্টোর করলে বর্তমান ডেটা এই তথ্য দিয়ে বদলে যাবে।</p>
    <div class="modal-actions">
      <button class="admin-btn ghost" type="button" data-modal-action="close">বাতিল</button>
      <button class="admin-btn primary" type="button" data-modal-action="restore">রিস্টোর করুন</button>
    </div>`);
  $('#adminModalBody [data-modal-action="restore"]')?.addEventListener('click', async () => {
    closeModal();
    try {
      for (const [key, value] of Object.entries(payload.data)) {
        if (BACKUP_KEYS.includes(key)) window.localStorage.setItem(key, String(value));
      }
    } catch {
      if (status) status.textContent = 'রিস্টোর করা যায়নি — স্টোরেজ পরীক্ষা করুন।';
      return;
    }
    if (status) status.textContent = `${bn(keys.length)}টি সংগ্রহ ফিরিয়ে আনা হয়েছে।`;
    toast('ব্যাকআপ থেকে ডেটা ফিরিয়ে আনা হয়েছে');
    window.setTimeout(() => window.location.reload(), 1200);
  });
}

/* ---------- Security ---------- */

async function renderSecurity() {
  const host = $('#securityPanels');
  if (!host) return;
  const owner = await readStaffAccount('admin');
  const ownerStaff = state.staff.find(staff => staff.role === 'admin') || null;
  const passwordDue = state.staff.filter(staff => staff.mustChangePassword);
  const protectedStaff = state.staff.filter(staff => staff.protected);
  const rows = [
    ['System Owner', escapeHtml(owner?.fullName || '—')],
    ['Owner Username', escapeHtml(owner?.username || '—')],
    ['Owner Staff ID', ownerStaff ? `<span class="staff-id-badge">${escapeHtml(ownerStaff.staffId)}</span>` : '—'],
    ['স্ট্যাটাস', '<span class="badge badge-approved">Protected • মুছে বা নিষ্ক্রিয় করা যায় না</span>'],
    ['Session নীতি', `${bn(STAFF_SESSION_RULES.rememberDays)} দিন (এই ডিভাইসে বাঁধা টোকেন) • ট্যাব-সেশন ট্যাব বন্ধ হলে শেষ`],
    ['Password নীতি', `${bn(STAFF_DIRECTORY_RULES.passwordMin)}–${bn(STAFF_DIRECTORY_RULES.passwordMax)} অক্ষর • PBKDF2 হ্যাশ • কখনো প্লেইন-টেক্সট নয়`],
    ['স্টাফ ম্যানেজমেন্ট', 'শুধু Admin • বাটন লুকানোই নয়, প্রতিটি পরিবর্তনে Admin সেশন যাচাই হয়'],
    ['Student ID বনাম Staff ID', escapeHtml(STAFF_DIRECTORY_RULES.studentIdNote)]
  ];
  host.innerHTML = `
    <article class="admin-card">
      <header class="admin-card-head">
        <div><p class="eyebrow">System Owner</p><h2>এডমিন পরিচয় ও সুরক্ষা</h2></div>
        <span class="badge badge-approved">Protected</span>
      </header>
      <div class="security-list">
        ${rows.map(([label, value]) => `
          <div class="security-row"><div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div></div>`).join('')}
      </div>
    </article>
    <article class="admin-card">
      <header class="admin-card-head">
        <div><p class="eyebrow">Password Health</p><h2>পাসওয়ার্ড বদল বাকি</h2></div>
        <span class="badge ${passwordDue.length ? 'badge-pending' : 'badge-approved'}">${bn(passwordDue.length)} জন</span>
      </header>
      ${passwordDue.length ? `
        <div class="security-list">
          ${passwordDue.map(staff => `
            <div class="security-row">
              <div>
                <dt>${escapeHtml(staffRoleLabel(staff.role))} • <span class="staff-id-badge">${escapeHtml(staff.staffId)}</span></dt>
                <dd>${escapeHtml(staff.fullName)} (${escapeHtml(staff.username)})</dd>
              </div>
              <button class="mini-btn" type="button" data-security-reset="${escapeHtml(staff.staffId)}">রিসেট</button>
            </div>`).join('')}
        </div>`
      : '<p class="admin-empty">সব অ্যাকাউন্টের পাসওয়ার্ড হালনাগাদ — বকেয়া কিছু নেই।</p>'}
      <p class="finance-hint">Admin রিসেট করলে নতুন পাসওয়ার্ড সাময়িক থাকে: সংশ্লিষ্ট স্টাফ প্রথম লগইনে তা বদলাতে বাধ্য থাকে। পাসওয়ার্ড কখনো দেখানো হয় না।</p>
    </article>
    <article class="admin-card">
      <header class="admin-card-head">
        <div><p class="eyebrow">Protected Accounts</p><h2>সুরক্ষিত অ্যাকাউন্ট</h2></div>
        <span class="badge badge-approved">${bn(protectedStaff.length)} টি</span>
      </header>
      <div class="security-list">
        ${protectedStaff.map(staff => `
          <div class="security-row">
            <div>
              <dt><span class="staff-id-badge">${escapeHtml(staff.staffId)}</span> ${escapeHtml(staffRoleLabel(staff.role))}</dt>
              <dd>${escapeHtml(staff.fullName)} — মুছে ফেলা ও নিষ্ক্রিয় করা বন্ধ, যাতে System Owner লক-আউট না হয়।</dd>
            </div>
          </div>`).join('') || '<p class="admin-empty">কোনো সুরক্ষিত অ্যাকাউন্ট পাওয়া যায়নি।</p>'}
      </div>
    </article>
    <article class="admin-card">
      <header class="admin-card-head">
        <div><p class="eyebrow">Role Boundary</p><h2>দৈনন্দিন কাজের মালিকানা</h2></div>
      </header>
      <div class="security-list">
        <div class="security-row"><div><dt>ফি গ্রহণ / ক্যাশ কাউন্টার</dt><dd>Cash Counter (payment.html) — Admin শুধু পর্যবেক্ষণ করে</dd></div></div>
        <div class="security-row"><div><dt>শিক্ষার্থী অনুমোদন, নোটিশ, রুটিন, পরীক্ষা প্রকাশ</dt><dd>Manager (manager.html)</dd></div></div>
        <div class="security-row"><div><dt>ক্লাস, বাড়ির কাজ, উপস্থিতি</dt><dd>Teacher (teacher.html)</dd></div></div>
      </div>
    </article>`;
  host.querySelectorAll('[data-security-reset]').forEach(button => {
    button.addEventListener('click', () => {
      navigate('staff', null);
      window.setTimeout(() => {
        const card = $(`[data-staff-card="${button.dataset.securityReset}"] [data-staff-action="more"]`);
        card?.click();
        window.setTimeout(() => $(`[data-staff-card="${button.dataset.securityReset}"] [data-staff-action="reset"]`)?.click(), 60);
      }, 80);
    });
  });
}

/* ---------- Admin Profile ---------- */

async function renderAdminProfile() {
  const host = $('#adminProfileCard');
  if (!host) return;
  const account = await readStaffAccount('admin');
  const staff = state.staff.find(item => item.role === 'admin') || null;
  const rows = [
    ['পূর্ণ নাম', escapeHtml(account?.fullName || '—')],
    ['ইউজারনেম', escapeHtml(account?.username || '—')],
    ['Staff ID', staff ? `<span class="staff-id-badge">${escapeHtml(staff.staffId)}</span>` : '—'],
    ['Role', `${escapeHtml(staffRoleLabel('admin'))} • System Owner`],
    ['মোবাইল', escapeHtml(account?.mobile || '—')],
    ['ইমেইল', escapeHtml(account?.email || '—')],
    ['স্ট্যাটাস', '<span class="badge badge-approved">Protected • সক্রিয়</span>'],
    ['যোগদান', escapeHtml(String(account?.createdAt || '').slice(0, 10) || '—')]
  ];
  // The same card fills the editable identity form: name, mobile, email.
  if ($('#adminProfileName')) $('#adminProfileName').value = account?.fullName || '';
  if ($('#adminProfileMobile')) $('#adminProfileMobile').value = account?.mobile || '';
  if ($('#adminProfileEmail')) $('#adminProfileEmail').value = account?.email || '';
  if ($('#adminProfileUserId')) $('#adminProfileUserId').textContent = account?.username || '—';

  host.innerHTML = `
    <header class="admin-card-head">
      <div><p class="eyebrow">Admin Profile</p><h2>আমার পরিচয়</h2></div>
      <span class="badge badge-approved">Current Admin → Protected</span>
    </header>
    <div class="profile-list">
      ${rows.map(([label, value]) => `
        <div class="profile-row"><div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div></div>`).join('')}
    </div>
    <p class="finance-hint">System Owner পরিচয় সুরক্ষিত: এই অ্যাকাউন্ট মুছে ফেলা, নিষ্ক্রিয় করা বা রোল বদল করা যায় না — ফলে কখনো লক-আউট হয় না।</p>`;
}

/* ---------- Render everything ---------- */

/** A view is rendered only while it exists — the capability layer removes the
 *  sections this role may not see, and every render follows it. */
function viewExists(view) {
  return Boolean($(`.admin-view[data-view-panel="${view}"]`));
}

/**
 * Refresh the staff snapshot from the directory. Every view that talks about
 * staff (dashboard, staff, roles, reports, security) reads this one copy, so a
 * change made in Staff Management is reflected everywhere.
 */
async function refreshStaffSnapshot() {
  state.staff = await listStaff();
  state.staffCounts = staffCounts(state.staff);
  state.staffActivity = state.staff.map(staff => ({
    staff,
    activity: staffActivitySummary(staff)
  }));
}

/* ---------- Academic Setup (classes ↔ subjects) ---------- */
let academicsMounted = false;
function renderAcademics() {
  if (academicsMounted) return;
  academicsMounted = true;
  initAdminAcademics({
    mount: '#adminAcademics',
    onToast: (text, isError) => toast(text, isError)
  });
}

/* ---------- V2 staged-cutover migration console ---------- */
let migrationMounted = false;
function renderMigration() {
  if (migrationMounted) return;
  migrationMounted = true;
  mountV2Migration({
    mount: '#adminV2Migration',
    onToast: (text, isError) => toast(text, isError)
  });
}

function renderAll() {
  if (viewExists('dashboard')) renderDashboard();
  if (viewExists('students')) renderStudents();
  if (viewExists('settings')) renderAppManagement();
  if (viewExists('settings')) renderClasses();
  if (viewExists('roles')) renderRoles();
  if (viewExists('data')) renderDataManagement();
  if (viewExists('backup')) renderBackup();
  if (viewExists('security')) renderSecurity();
  if (viewExists('academics')) renderAcademics();
  if (viewExists('migration')) renderMigration();
  if (viewExists('profile')) renderAdminProfile();
  if (viewExists('staff')) void renderStaff();
}

/** Called by Staff Management after every create / edit / delete / status
 *  change, so the dashboard counters and reports never go stale. */
function onStaffChanged() {
  void refreshStaffSnapshot().then(() => {
    renderDashboard();
    if (viewExists('roles')) renderRoles();
    if (viewExists('security')) renderSecurity();
    if (viewExists('profile')) renderAdminProfile();
  });
}

/* ---------- Wiring ---------- */

$('#btnSaveAppSettings')?.addEventListener('click', saveAppSettingsFromForm);
$('#btnSaveBroadcast')?.addEventListener('click', saveBroadcastFromForm);
$('#btnSaveMaintenance')?.addEventListener('click', saveMaintenanceFromForm);

$('#adminExitButton')?.addEventListener('click', exitPanel);
/* Bottom-bar tabs and "More" menu rows are rebuilt by the permission model
   (js/admin-panel-ui.js) and call `navigate` themselves; the markup-driven
   shortcuts below are wired once. */
$$('[data-admin-view]').forEach(button => {
  if (button.classList.contains('admin-bottom-item')) return;
  if (button.classList.contains('admin-more-item')) return;
  button.addEventListener('click', () => navigate(button.dataset.adminView, button));
});

/* Deep links: admin.html#finance opens Finance, an unauthorised or unknown
   #route is refused and the panel stays on the first permitted tab. An entry
   that arrived after the panel was already open — a shared link typed into the
   address bar, or the browser's Back into a page of this panel — still moves
   the panel (js/panel-route.js listens for that one event). */
onRouteChange(name => {
  if ($('#adminShell')?.hidden !== false) return;
  const route = routeFromHash('#' + name);
  if (!route || route === state.activeView) return;
  navigate(route, null);
});

/* Fee collection is the Cash Counter's job; this panel keeps no handler. */

$('#studentSearch').addEventListener('input', event => {
  state.query = event.target.value;
  renderStudents();
});

$('#studentSearchClear')?.addEventListener('click', () => {
  const input = $('#studentSearch');
  if (input) {
    input.value = '';
    state.query = '';
    renderStudents();
    input.focus();
  }
});

/* The optional filters stay folded away until they are asked for. */
(function initStudentFilterPanel() {
  const toggle = $('#studentFilterToggle');
  const panel = $('#studentFilterPanel');
  if (!toggle || !panel) return;
  const setOpen = open => {
    panel.hidden = !open;
    toggle.classList.toggle('active', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  $('#studentFilterReset')?.addEventListener('click', () => {
    state.filter = 'all';
    state.classFilter = 'all';
    state.query = '';
    if ($('#studentSearch')) $('#studentSearch').value = '';
    if ($('#studentClassFilter')) $('#studentClassFilter').value = 'all';
    $$('#studentFilterChips .chip').forEach(chip => chip.classList.toggle('active', chip.dataset.studentFilter === 'all'));
    renderStudents();
  });
})();

$('#studentFilterChips').addEventListener('click', event => {
  const chip = event.target.closest('[data-student-filter]');
  if (!chip) return;
  state.filter = chip.dataset.studentFilter;
  $$('#studentFilterChips .chip').forEach(item => item.classList.toggle('active', item === chip));
  renderStudents();
});

/* Class filter keeps student management simple: pick a class, see only that class. */
const studentClassFilter = $('#studentClassFilter');
if (studentClassFilter) {
  studentClassFilter.innerHTML = '<option value="all">সব শ্রেণির শিক্ষার্থী</option>' +
    enabledClasses.map(className => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('');
  studentClassFilter.addEventListener('change', () => {
    state.classFilter = studentClassFilter.value;
    renderStudents();
  });
}

const studentAction = event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  const student = findStudent(id);
  if (!student) return;
  // Registration decisions go through the shared review dialog, and only for a
  // role holding STUDENTS_APPROVE (Admin and Manager).
  if (action === 'review-registration') {
    if (access.has(CAPABILITIES.STUDENTS_APPROVE) && student.status === 'pending') {
      void openRegistrationReview(student.id, { role: 'admin', onDone: result => toast(result.student.status === 'approved' ? 'রেজিস্ট্রেশন অনুমোদিত হয়েছে।' : 'রেজিস্ট্রেশন কারণসহ বাতিল হয়েছে।') });
    }
  } else if (action === 'view') {
    openStudentDetail(student);
  } else if (action === 'edit') {
    openStudentEdit(student);
  } else if (action === 'reset-pin') {
    openPinReset(student);
  }
};
$('#studentList').addEventListener('click', studentAction);

/* Notice publishing and routine entry now live in the Manager portal, so this
   panel keeps no handler for them. */

$('#classList').addEventListener('change', toggleClass);

/* ---------- Staff, Data, Backup, Security and Profile wiring ---------- */

$('#dataRefreshButton')?.addEventListener('click', async () => {
  renderDataManagement();
  await refreshStaffSnapshot();
  toast('ডেটা পরিসংখ্যান হালনাগাদ করা হয়েছে');
});

$('#dataClearButton')?.addEventListener('click', clearSelectedCollection);

$('#backupExportButton')?.addEventListener('click', exportBackup);

$('#backupFileInput')?.addEventListener('change', event => {
  restoreBackup(event.target.files?.[0]);
});

$('#resetAllLocalDataButton')?.addEventListener('click', resetAllLocalData);

$('#adminAccountLogout')?.addEventListener('click', exitPanel);

$('#adminProfileForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const error = $('#adminProfileError');
  if (error) { error.hidden = true; error.textContent = ''; }
  const fullName = String($('#adminProfileName')?.value || '').trim().replace(/\s+/g, ' ');
  const mobile = String($('#adminProfileMobile')?.value || '').trim();
  const email = String($('#adminProfileEmail')?.value || '').trim().toLowerCase();
  if (fullName.length < 2 || fullName.length > 100) {
    if (error) { error.textContent = 'পূর্ণ নাম লিখুন (২–১০০ অক্ষর)।'; error.hidden = false; }
    return;
  }
  if (!/^01[3-9]\d{8}$/.test(mobile)) {
    if (error) { error.textContent = 'সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন (যেমন: ০১৭XXXXXXXX)।'; error.hidden = false; }
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (error) { error.textContent = 'সঠিক ইমেইল ঠিকানা দিন অথবা ফাঁকা রাখুন।'; error.hidden = false; }
    return;
  }
  // Only name/mobile/email move. The Login User ID and the Staff ID are locked
  // inside updateStaffProfile, so this form cannot rewrite the identity even
  // if it is submitted straight from the console.
  const result = await updateStaffProfile('admin', { fullName, mobile, email });
  if (!result.ok) {
    if (error) { error.textContent = result.error || 'তথ্য সংরক্ষণ করা যায়নি।'; error.hidden = false; }
    return;
  }
  toast('প্রোফাইল হালনাগাদ করা হয়েছে');
  await refreshStaffSnapshot();
  renderAdminProfile();
});

$('#adminPasswordForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  // Captured now: event.currentTarget is nulled once the dispatch (and the
  // awaits below) is over, so the form must be reset through this reference.
  const form = event.currentTarget;
  const error = $('#adminPasswordError');
  const current = $('#adminCurrentPassword')?.value || '';
  const next = $('#adminNewPassword')?.value || '';
  const confirm = $('#adminConfirmPassword')?.value || '';
  if (error) { error.hidden = true; error.textContent = ''; }
  if (next !== confirm) {
    if (error) { error.textContent = 'দুইবার লেখা নতুন পাসওয়ার্ড মিলছে না।'; error.hidden = false; }
    return;
  }
  const result = await changeStaffPassword('admin', current, next, confirm);
  if (!result.ok) {
    if (error) { error.textContent = result.error || 'পাসওয়ার্ড বদল করা যায়নি।'; error.hidden = false; }
    return;
  }
  form?.reset();
  toast('পাসওয়ার্ড বদল করা হয়েছে');
});

$('#adminModalClose').addEventListener('click', closeModal);
$('#adminModalBackdrop').addEventListener('click', event => {
  if (event.target === event.currentTarget) closeModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#adminModalBackdrop').hidden) closeModal();
});

// Trap modal keyboard focus while retaining the shared Escape/backdrop behavior.
document.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || $('#adminModalBackdrop').hidden) return;
  const items = [...$('#adminModalBackdrop').querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});
let cloudRefreshTimer;
// A decision taken here (list button or tapped notification) refreshes the list.
window.addEventListener(DECIDED_EVENT, () => {
  if ($('#adminShell')?.hidden) return;
  state.students = loadRoster();
  renderAll();
});
window.addEventListener('storage', event => {
  if (!event.apcRemote) return;
  clearTimeout(cloudRefreshTimer);
  cloudRefreshTimer = setTimeout(async () => {
    if ($('#adminShell').hidden) return;
    try {
      state.students = loadRoster();
      state.notices = loadNotices();
      state.routine = loadRoutine();
      await refreshStaffSnapshot();
      renderAll();
      refreshReports($('#adminReports'));
    } catch (error) {
      console.warn('[Active Plus] cloud refresh failed:', error?.message);
    }
  }, 100);
});

// Every staff login starts at index.html. This page only restores an existing session.
// One door per panel: no route of ours leaves admin.html for another panel.
installPanelGuard();
void rememberPanelPage();

async function initAdminEntry() {
  try {
    if (!(await hasStaffSession('admin'))) {
      /* The panel stays shut and explains itself instead of jumping to another
         page: the lock card holds the only two exits (login page / reload). */
      await lockPanel({ role: 'admin.html', reason: 'এডমিন প্যানেল শুধু এডমিন ইউজারনেম ও পাসওয়ার্ড দিয়ে খোলে।' });
      return;
    }
    const account = await readStaffAccount('admin');
    if (!account) {
      await lockPanel({ role: 'admin.html', clear: 'admin', reason: 'এই ডিভাইসে এডমিন অ্যাকাউন্টের রেকর্ড নেই — লগইন পেজ থেকে আবার প্রবেশ করুন।' });
      return;
    }
    await enterPanel();
    watchOwnPanelSession('admin');
  } catch (error) {
    /* Never leave admin.html blank when a stored session/account or optional
       panel initializer is corrupted. Clear only the invalid Admin session;
       application data is untouched. */
    console.error('[Active Plus] Admin panel startup failed:', error);
    await lockPanel({ role: 'admin.html', clear: 'admin', reason: 'প্যানেল চালু করা যায়নি — লগইন পেজ থেকে আবার চেষ্টা করুন।' });
  }
}
void initAdminEntry().catch(error => {
  console.error('[Active Plus] Admin entry failed:', error);
  clearStaffSession('admin');
  void lockPanel({ role: 'admin.html', reason: 'প্যানেল চালু করা যায়নি — লগইন পেজ থেকে আবার চেষ্টা করুন।' });
});
