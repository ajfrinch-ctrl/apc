/* Student registration review — one shared, role-guarded decision path for Admin and Manager. */
import { LEGACY_CLOUD_ENABLED } from '../sync/cloud-access.js';
import { loadRoster, saveRoster, syncAccountStatus } from './office-data.js';
import { listRegistrationNotifications, markRegistrationNotificationRead } from './registration-service.js';
import { hasStaffSession, readStaffAccount } from './staff-auth.js';
import { escapeHtml } from './sanitize.js';
import { toBanglaNumber } from './ui.js';

export const REVIEW_ROLES = Object.freeze(['admin', 'manager']);
export const REVIEW_DIALOG_ID = 'apcRegistrationReview';
export const DECIDED_EVENT = 'apc-registration-decided';

/* Privacy: no phone number or Student ID is printed in the queue until the
   reader asks for it — the reveal itself is the only place the contact layer
   appears (see the rule below). */
const PRIVACY_MASK = '••••';
/* Owner rule 2026-10-31: in a list the NAME is always readable and only the
   contact layer is hidden. The queue therefore paints the applicant's name
   straight away, while the mobile number and the Student ID stay masked behind
   that application's own “নম্বর ও আইডি দেখুন / লুকান” switch. The state lives in
   memory only, so a reload (or a fresh queue) masks them again. */
const revealedPending = new Set();

function pendingRevealed(studentId) {
  return revealedPending.has(String(studentId));
}

let busy = false;

async function verifyReviewerAccess(role) {
  if (!REVIEW_ROLES.includes(role)) return { ok: false, reason: 'not-allowed' };
  if (!(await hasStaffSession(role))) return { ok: false, reason: 'no-session' };
  try {
    const account = await readStaffAccount(role);
    if (account && (['disabled', 'inactive', 'rejected'].includes(account.status) || account.accountStatus === 'disabled')) {
      return { ok: false, reason: 'not-allowed' };
    }
    return { ok: true, reviewer: String(account?.username || role) };
  } catch {
    return { ok: true, reviewer: String(role) };
  }
}

export function formatPendingDate(studentOrRecord) {
  const raw = studentOrRecord?.registeredAt || studentOrRecord?.createdAt || '';
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      try {
        return parsed.toLocaleDateString('bn-BD', {
          timeZone: 'Asia/Dhaka',
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
      } catch {
        return parsed.toLocaleDateString('bn-BD');
      }
    }
  }
  return String(studentOrRecord?.enrolledAt || 'তারিখ নেই').trim() || 'তারিখ নেই';
}

export function listPendingRegistrations() {
  const roster = loadRoster();
  const notifications = listRegistrationNotifications();
  const notifByStudent = new Map(notifications.map(item => [String(item.studentId), item]));
  const items = [];
  const seen = new Set();

  for (const student of roster) {
    if (!student || student.status !== 'pending' || !student.id) continue;
    const id = String(student.id);
    seen.add(id);
    const notif = notifByStudent.get(id);
    items.push({
      id,
      name: String(student.name || student.nameBn || student.nameEn || notif?.studentName || 'নাম নেই').trim(),
      mobile: String(student.mobile || student.studentMobile || notif?.mobile || '—').trim(),
      className: String(student.className || '').trim(),
      group: String(student.group || '').trim(),
      createdAt: String(student.registeredAt || notif?.createdAt || student.createdAt || ''),
      dateLabel: formatPendingDate(student.registeredAt ? student : (notif || student)),
      unread: notif ? notif.read !== true : true
    });
  }

  const decidedIds = new Set(
    roster.filter(s => s && s.id && s.status && s.status !== 'pending').map(s => String(s.id))
  );
  for (const notif of notifications) {
    const id = String(notif?.studentId || '').trim();
    if (!id || notif.read === true || seen.has(id) || decidedIds.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      name: String(notif.studentName || 'নাম নেই').trim(),
      mobile: String(notif.mobile || '—').trim(),
      className: '',
      group: '',
      createdAt: String(notif.createdAt || ''),
      dateLabel: formatPendingDate(notif),
      unread: true
    });
  }

  return items.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}

/**
 * Record a decision on one pending registration.
 * Strictly restricted to verified `admin` and `manager` sessions.
 * @returns {Promise<{ok: boolean, reason?: string, student?: object}>}
 */
export async function decideRegistration(studentId, decision, { role, note = '' } = {}) {
  const normalizedDecision = decision === 'active' || decision === 'approved'
    ? 'approved'
    : decision === 'rejected'
      ? 'rejected'
      : '';
  if (!normalizedDecision) return { ok: false, reason: 'bad-decision' };

  const access = await verifyReviewerAccess(role);
  if (!access.ok) return { ok: false, reason: access.reason };

  const reason = String(note || '').trim();
  if (normalizedDecision === 'rejected' && !reason) return { ok: false, reason: 'note-required' };
  if (busy) return { ok: false, reason: 'busy' };
  busy = true;
  try {
    const sid = String(studentId || '').trim();
    const students = loadRoster();
    let index = students.findIndex(row => row?.id === sid);

    // If only the notification record arrived so far, hydrate a minimal pending row so decision can proceed.
    if (index < 0) {
      const notif = listRegistrationNotifications().find(item => item.studentId === sid);
      if (!notif) return { ok: false, reason: 'not-found' };
      students.push({
        id: sid,
        name: notif.studentName || 'নাম নেই',
        mobile: notif.mobile || '',
        status: 'pending',
        registeredAt: notif.createdAt || new Date().toISOString()
      });
      index = students.length - 1;
    }

    if (students[index].status !== 'pending') {
      return { ok: false, reason: 'already-decided', student: students[index] };
    }

    const nowIso = new Date().toISOString();
    const reviewer = access.reviewer;
    const isApproved = normalizedDecision === 'approved';
    const student = {
      ...students[index],
      status: normalizedDecision,
      accountStatus: isApproved ? 'active' : 'rejected',
      reviewedAt: nowIso,
      reviewedBy: reviewer,
      reviewedRole: role,
      updatedAt: nowIso,
      ...(isApproved
        ? { approvedBy: reviewer, approvedAt: nowIso, reviewNote: '' }
        : { reviewNote: reason, rejectionReason: reason })
    };

    const next = students.map((row, i) => (i === index ? student : row));
    if (!saveRoster(next)) return { ok: false, reason: 'save-failed' };

    await syncAccountStatus(sid, isApproved ? 'active' : 'rejected', {
      approvedBy: isApproved ? reviewer : '',
      approvedAt: isApproved ? nowIso : '',
      reviewNote: isApproved ? '' : reason
    });

    markRegistrationNotificationRead(sid, {
      readBy: reviewer,
      readAt: nowIso,
      decision: normalizedDecision
    });

    if (LEGACY_CLOUD_ENABLED && typeof navigator !== 'undefined' && navigator.onLine) {
      import('../sync/sync-core.js?v=20260929-protected')
        .then(bridge => bridge.syncRegistrationDecisionOnline({
          studentId: sid,
          studentRow: student,
          decision: normalizedDecision,
          approvedBy: isApproved ? reviewer : '',
          approvedAt: isApproved ? nowIso : '',
          reviewNote: isApproved ? '' : reason
        }))
        .catch(() => {});
    }

    window.dispatchEvent(new CustomEvent(DECIDED_EVENT, { detail: { studentId: sid, decision: normalizedDecision, role } }));
    return { ok: true, student };
  } finally {
    busy = false;
  }
}

export const DECISION_MESSAGES = Object.freeze({
  'not-allowed': 'শুধুমাত্র এডমিন ও ম্যানেজার রেজিস্ট্রেশন অনুমোদন বা বাতিল করতে পারবেন।',
  'no-session': 'সেশন যাচাই হয়নি। আবার প্রবেশ করুন।',
  'note-required': 'বাতিলের কারণ লিখুন।',
  busy: 'আগের সিদ্ধান্ত সংরক্ষণ হচ্ছে, একটু অপেক্ষা করুন।',
  'not-found': 'এই শিক্ষার্থীকে তালিকায় পাওয়া যায়নি।',
  'already-decided': 'এই রেজিস্ট্রেশনে আগেই সিদ্ধান্ত নেওয়া হয়েছে।',
  'save-failed': 'সিদ্ধান্ত সংরক্ষণ হয়নি। স্টোরেজ পরীক্ষা করুন।',
  'bad-decision': 'অজানা সিদ্ধান্ত।'
});

const STATUS_TEXT = Object.freeze({ approved: 'অনুমোদিত', active: 'অনুমোদিত', rejected: 'বাতিল', pending: 'অপেক্ষমাণ' });
const cssEscape = value => (typeof globalThis.CSS?.escape === 'function'
  ? globalThis.CSS.escape(String(value ?? ''))
  : String(value ?? '').replace(/["\\]/g, '\\$&'));

function row(label, value, { ltr = false, badgeTone = '' } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const ddClasses = [
    ltr ? 'apc-review-dd--ltr' : '',
    badgeTone ? `apc-review-dd--status is-${escapeHtml(badgeTone)}` : ''
  ].filter(Boolean).join(' ');
  const ddAttrs = `${ddClasses ? ` class="${ddClasses}"` : ''}${ltr ? ' dir="ltr"' : ''}`;
  const inner = badgeTone
    ? `<span class="apc-review-status-pill is-${escapeHtml(badgeTone)}">${escapeHtml(text)}</span>`
    : escapeHtml(text);
  return `<div class="apc-review-row"><dt>${escapeHtml(label)}</dt><dd${ddAttrs}>${inner}</dd></div>`;
}

function closeDialog() {
  document.getElementById(REVIEW_DIALOG_ID)?.remove();
  document.body.classList.remove('modal-open');
}

/**
 * Render the shared "অনুমোদনের অপেক্ষায়" pending student list inside a host element
 * (used in both Admin/Manager bell drawer and Admin student management).
 */
export function pendingQueueMarkup(items = listPendingRegistrations()) {
  if (!items.length) {
    return `<section class="apc-pending-queue" data-apc-pending-registrations>
      <div class="apc-pending-queue__head">
        <h3>অনুমোদনের অপেক্ষায়</h3>
        <span class="apc-pending-queue__count">০</span>
      </div>
      <div class="apc-pending-queue__empty-wrap">
        <span class="apc-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="m9 12 2 2 4-4"></path></svg></span>
        <p class="apc-pending-queue__empty">বর্তমানে অনুমোদনের অপেক্ষায় কোনো শিক্ষার্থী নেই।</p>
      </div>
    </section>`;
  }

  return `<section class="apc-pending-queue" data-apc-pending-registrations>
    <div class="apc-pending-queue__head">
      <h3>অনুমোদনের অপেক্ষায়</h3>
      <span class="apc-pending-queue__count">${escapeHtml(toBanglaNumber(items.length))} জন</span>
    </div>
    <ul class="apc-pending-queue__list">
      ${items.map(item => {
        const revealed = pendingRevealed(item.id);
        const who = String(item.name || '').trim() || 'নাম নেই';
        return `<li class="apc-pending-item${revealed ? ' is-revealed' : ''}" data-pending-student-row="${escapeHtml(item.id)}"${revealed ? ' data-pending-revealed="1"' : ''}>
        <div class="apc-pending-item__info">
          <strong class="apc-pending-item__name">${escapeHtml(who)}</strong>
          <div class="apc-pending-item__meta apc-pending-item__meta--summary">
            <span>তারিখ: ${escapeHtml(item.dateLabel)}</span>
            <span class="apc-pending-short-badge">অপেক্ষমাণ</span>
          </div>
          <button type="button" class="apc-pending-reveal" data-pending-reveal="${escapeHtml(item.id)}" data-pending-revealed="${revealed ? '1' : '0'}"
            aria-expanded="${revealed ? 'true' : 'false'}" aria-label="${revealed ? 'এই আবেদনের বিস্তারিত লুকান' : 'এই আবেদনের বিস্তারিত দেখান'}">${revealed ? 'সংক্ষিপ্ত করুন' : 'বিস্তারিত দেখুন'}</button>
        </div>
        <div class="apc-pending-item__detail" ${revealed ? '' : 'hidden'}>
          <div class="apc-pending-item__meta">
            <span>মোবাইল: <b dir="ltr">${escapeHtml(String(item.mobile || '—'))}</b></span>
            <span>আইডি: <b dir="ltr">${escapeHtml(String(item.id))}</b></span>
            <span>তারিখ: ${escapeHtml(item.dateLabel)}</span>
          </div>
          <div class="apc-pending-item__actions">
            <button type="button" class="mini-btn approve primary apc-pending-btn" data-pending-approve="${escapeHtml(item.id)}">অনুমোদন দিন</button>
            <button type="button" class="mini-btn reject danger apc-pending-btn" data-pending-reject="${escapeHtml(item.id)}">বাতিল করুন</button>
          </div>
        </div>
        <div class="apc-pending-item__reject-box" data-pending-reject-box="${escapeHtml(item.id)}" hidden>
          <input type="text" class="apc-pending-item__reason-input" data-pending-reject-note="${escapeHtml(item.id)}" maxlength="300" placeholder="বাতিল করার কারণ লিখুন…" aria-label="বাতিলের কারণ">
          <div class="apc-pending-item__reject-actions">
            <button type="button" class="mini-btn reject danger apc-pending-btn" data-pending-reject-confirm="${escapeHtml(item.id)}">নিশ্চিত বাতিল</button>
            <button type="button" class="mini-btn apc-pending-btn" data-pending-reject-cancel="${escapeHtml(item.id)}">ফিরে যান</button>
          </div>
        </div>
        <p class="apc-pending-item__feedback" data-pending-feedback="${escapeHtml(item.id)}" role="status" aria-live="polite" hidden></p>
      </li>`;
      }).join('')}
    </ul>
  </section>`;
}

export function bindPendingQueueActions(host, { role, onDecided, onFeedback, onRevealToggle } = {}) {
  if (!host || host.dataset.pendingQueueBound === 'true') return;
  host.dataset.pendingQueueBound = 'true';

  host.addEventListener('click', async event => {
    /* The queue's own reveal. The host repaints (the caller owns the list), so
       this only flips the memory state and hands the id back. */
    const revealBtn = event.target.closest('[data-pending-reveal]');
    if (revealBtn) {
      const id = String(revealBtn.getAttribute('data-pending-reveal') || '');
      if (!id) return;
      if (revealedPending.has(id)) revealedPending.delete(id);
      else revealedPending.add(id);
      onRevealToggle?.(id, revealedPending.has(id));
      return;
    }

    const approveBtn = event.target.closest('[data-pending-approve]');
    if (approveBtn) {
      const id = approveBtn.getAttribute('data-pending-approve');
      approveBtn.disabled = true;
      const result = await decideRegistration(id, 'approved', { role });
      if (!result.ok) {
        approveBtn.disabled = false;
        const msg = DECISION_MESSAGES[result.reason] || 'অনুমোদন সম্পন্ন হয়নি।';
        const fb = host.querySelector(`[data-pending-feedback="${cssEscape(id)}"]`);
        if (fb) { fb.textContent = msg; fb.hidden = false; }
        onFeedback?.(msg, false);
        return;
      }
      onFeedback?.('শিক্ষার্থীর রেজিস্ট্রেশন অনুমোদিত হয়েছে।', true);
      onDecided?.(result);
      return;
    }

    const rejectToggle = event.target.closest('[data-pending-reject]');
    if (rejectToggle) {
      const id = rejectToggle.getAttribute('data-pending-reject');
      const box = host.querySelector(`[data-pending-reject-box="${cssEscape(id)}"]`);
      if (box) {
        box.hidden = false;
        box.querySelector('input')?.focus?.();
      }
      return;
    }

    const rejectCancel = event.target.closest('[data-pending-reject-cancel]');
    if (rejectCancel) {
      const id = rejectCancel.getAttribute('data-pending-reject-cancel');
      const box = host.querySelector(`[data-pending-reject-box="${cssEscape(id)}"]`);
      if (box) box.hidden = true;
      const fb = host.querySelector(`[data-pending-feedback="${cssEscape(id)}"]`);
      if (fb) { fb.textContent = ''; fb.hidden = true; }
      return;
    }

    const rejectConfirm = event.target.closest('[data-pending-reject-confirm]');
    if (rejectConfirm) {
      const id = rejectConfirm.getAttribute('data-pending-reject-confirm');
      const input = host.querySelector(`[data-pending-reject-note="${cssEscape(id)}"]`);
      const note = String(input?.value || '').trim();
      const fb = host.querySelector(`[data-pending-feedback="${cssEscape(id)}"]`);
      if (!note) {
        if (fb) { fb.textContent = DECISION_MESSAGES['note-required']; fb.hidden = false; }
        input?.focus?.();
        return;
      }
      rejectConfirm.disabled = true;
      const result = await decideRegistration(id, 'rejected', { role, note });
      if (!result.ok) {
        rejectConfirm.disabled = false;
        const msg = DECISION_MESSAGES[result.reason] || 'বাতিল সম্পন্ন হয়নি।';
        if (fb) { fb.textContent = msg; fb.hidden = false; }
        onFeedback?.(msg, false);
        return;
      }
      onFeedback?.('রেজিস্ট্রেশন কারণসহ বাতিল করা হয়েছে।', true);
      onDecided?.(result);
    }
  });
}

/**
 * Open the review dialog for one student.
 * @param {string} studentId
 * @param {{ role: string, onLater?: Function, onDone?: Function }} options
 * @returns {Promise<boolean>} whether a dialog was opened
 */
export async function openRegistrationReview(studentId, { role, onLater, onDone } = {}) {
  closeDialog();
  const access = await verifyReviewerAccess(role);
  if (!access.ok) return false;
  const student = loadRoster().find(item => item?.id === studentId);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = REVIEW_DIALOG_ID;
  const pending = student?.status === 'pending';
  const heading = student ? escapeHtml(student.name || student.nameEn || 'নাম নেই') : 'শিক্ষার্থী পাওয়া যায়নি';
  backdrop.innerHTML =
    '<section class="modal" role="dialog" aria-modal="true" aria-labelledby="apcReviewTitle">' +
      '<div class="modal-header"><div><p class="eyebrow">শিক্ষার্থী রেজিস্ট্রেশন · অনুমোদনের অপেক্ষায়</p>' +
      `<h2 id="apcReviewTitle">${heading}</h2></div>` +
      '<button type="button" class="modal-close" data-review-close aria-label="বন্ধ করুন">×</button></div>' +
      (student
        ? '<dl class="apc-review-details">' +
            row('Student ID', student.id, { ltr: true }) +
            row('অবস্থা', STATUS_TEXT[student.status] || student.status, { badgeTone: student.status || 'pending' }) +
            row('শ্রেণি', student.className) +
            row('বিভাগ / গ্রুপ', student.group) +
            row('পিতার নাম', student.fatherName) +
            row('মোবাইল', student.mobile, { ltr: true }) +
            row('ইমেইল', student.email, { ltr: true }) +
            row('অভিভাবকের মোবাইল', student.guardianMobile, { ltr: true }) +
            row('ঠিকানা', student.address) +
            row('আবেদনের তারিখ', formatPendingDate(student)) +
            (pending ? '' : row('অনুমোদন/পর্যালোচনা করেছেন', [student.approvedBy || student.reviewedBy, student.reviewedRole].filter(Boolean).join(' • '))) +
            (pending ? '' : row('কারণ', student.reviewNote)) +
          '</dl>'
        : '<p class="form-note">রেকর্ডটি এখনও এই ডিভাইসে আসেনি বা মুছে গেছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।</p>') +
      (pending
        ? '<label for="apcReviewNote">বাতিলের কারণ <span>(শুধু বাতিল করলে আবশ্যক)</span></label>' +
          '<textarea id="apcReviewNote" maxlength="300" rows="2" placeholder="যেমন: তথ্য অসম্পূর্ণ"></textarea>' +
          '<p class="form-note" data-review-status role="status" aria-live="polite"></p>' +
          '<div class="modal-actions">' +
            '<button type="button" class="mini-btn approve primary" data-review-decision="approved">✓ অনুমোদন দিন</button>' +
            '<button type="button" class="mini-btn reject danger" data-review-decision="rejected">✕ বাতিল করুন</button>' +
            '<button type="button" class="mini-btn" data-review-later>পরে দেখব</button>' +
          '</div>'
        : '<p class="form-note" data-review-status role="status">' +
            (student ? 'এই রেজিস্ট্রেশনে আর কোনো সিদ্ধান্ত বাকি নেই।' : '') + '</p>' +
          '<button class="modal-action" type="button" data-review-close>ঠিক আছে</button>') +
    '</section>';
  document.body.append(backdrop);
  document.body.classList.add('modal-open');

  const status = backdrop.querySelector('[data-review-status]');
  const say = message => { if (status) status.textContent = message; };
  backdrop.addEventListener('click', async event => {
    if (event.target === backdrop || event.target.closest('[data-review-close]')) { closeDialog(); return; }
    if (event.target.closest('[data-review-later]')) { closeDialog(); onLater?.(studentId); return; }
    const button = event.target.closest('[data-review-decision]');
    if (!button) return;
    const decision = button.dataset.reviewDecision;
    const note = backdrop.querySelector('#apcReviewNote')?.value || '';
    if (decision === 'rejected' && !note.trim()) {
      say(DECISION_MESSAGES['note-required']);
      backdrop.querySelector('#apcReviewNote')?.focus();
      return;
    }
    backdrop.querySelectorAll('button').forEach(item => { item.disabled = true; });
    say('সংরক্ষণ হচ্ছে…');
    const result = await decideRegistration(studentId, decision, { role, note });
    if (!result.ok) {
      say(DECISION_MESSAGES[result.reason] || 'সিদ্ধান্ত সংরক্ষণ হয়নি।');
      backdrop.querySelectorAll('button').forEach(item => { item.disabled = false; });
      return;
    }
    closeDialog();
    onDone?.(result);
  });
  backdrop.addEventListener('keydown', event => { if (event.key === 'Escape') closeDialog(); });
  (backdrop.querySelector('[data-review-decision]') || backdrop.querySelector('[data-review-close]'))?.focus?.();
  return true;
}
