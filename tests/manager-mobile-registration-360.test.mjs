/* Scenario 1 & 8 (Manager 360px Mobile Viewport):
   Verifies that on a 360px mobile screen, the Manager panel header bell, unread
   count badge, subtle toast ("নতুন শিক্ষার্থী রেজিস্ট্রেশন করেছে"), "অনুমোদনের অপেক্ষায়"
   list (masked identity, date), and both "অনুমোদন দিন" & "বাতিল করুন" buttons work end-to-end. */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { KEYS } from '../js/database.js';

let ctx = null;
after(() => {
  ctx?.window?.close?.();
});

test('Manager panel at 360px mobile viewport renders unread badge, toast, "অনুমোদনের অপেক্ষায়" list, and approves/rejects cleanly', async () => {
  const pendingRows = [
    {
      id: '261022011',
      name: 'নুসরাত জাহান',
      mobile: '01722334455',
      className: 'দশম শ্রেণি',
      group: 'বিজ্ঞান',
      status: 'pending',
      registeredAt: '2026-10-22T06:20:00.000Z'
    },
    {
      id: '261022012',
      name: 'মাহমুদুল হাসান',
      mobile: '01822334455',
      className: 'অষ্টম শ্রেণি',
      group: 'সাধারণ',
      status: 'pending',
      registeredAt: '2026-10-22T06:25:00.000Z'
    }
  ];
  const pendingNotifs = pendingRows.map(row => ({
    id: `notif_${row.id}`,
    type: 'new_registration',
    studentId: row.id,
    studentName: row.name,
    mobile: row.mobile,
    createdAt: row.registeredAt,
    read: false
  }));

  ctx = await loadPage('manager.html', {
    width: 360,
    height: 740,
    seed: {
      [KEYS.students]: JSON.stringify(pendingRows),
      [KEYS.registrationNotifications]: JSON.stringify(pendingNotifs)
    }
  });
  await provisionStaff('manager');
  seedStaffSession(ctx.window, 'manager');
  await import('../js/manager.js');
  await ctx.waitFor(() => ctx.$('#managerShell').hidden === false);
  const notifMod = await import('../js/notifications.js');
  notifMod.initNotifications();
  await ctx.flush();
  await ctx.waitFor(() => Boolean(ctx.window.apcNoticeCenter));

  assert.equal(ctx.window.innerWidth, 360);

  const bell = ctx.$('#notificationButton');
  await ctx.waitFor(() => {
    const dot = bell?.querySelector('.notification-dot');
    return dot && !dot.hidden && dot.textContent === '২';
  });

  // Verify subtle toast "নতুন শিক্ষার্থী রেজিস্ট্রেশন করেছে" on Manager panel
  ctx.window.dispatchEvent(new ctx.window.CustomEvent('apc-new-registration-toast', {
    detail: { message: 'নতুন শিক্ষার্থী রেজিস্ট্রেশন করেছে' }
  }));
  const toastEl = ctx.$('#apcRegistrationToast');
  assert.ok(toastEl);
  assert.equal(toastEl.hidden, false);
  assert.equal(toastEl.textContent, 'নতুন শিক্ষার্থী রেজিস্ট্রেশন করেছে');

  // The queue names the applicant; only the mobile and Student ID stay masked
  // (owner rule 2026-10-31), so a decision can be made without a detour.
  ctx.click(bell);
  await ctx.waitFor(() => ctx.$$('[data-pending-student-row]').length === 2);
  const queueHost = ctx.$('[data-apc-pending-registrations]');
  assert.match(queueHost.textContent, /অনুমোদনের অপেক্ষায়/);
  assert.match(queueHost.textContent, /নুসরাত জাহান/, 'the applicant is named');
  for (const privateValue of ['01722334455', '261022011']) {
    assert.equal(queueHost.textContent.includes(privateValue), false, `${privateValue} stays masked`);
  }
  assert.match(queueHost.textContent, /তারিখ:/);

  // Approve 261022011 via "অনুমোদন দিন"
  const approveBtn = ctx.$('[data-pending-approve="261022011"]');
  assert.equal(approveBtn.textContent.trim(), 'অনুমোদন দিন');
  ctx.click(approveBtn);
  await ctx.waitFor(() => ctx.$$('[data-pending-student-row]').length === 1);

  // Reject 261022012 via "বাতিল করুন" with reason
  const rejectBtn = ctx.$('[data-pending-reject="261022012"]');
  assert.equal(rejectBtn.textContent.trim(), 'বাতিল করুন');
  ctx.click(rejectBtn);
  const reasonInput = ctx.$('[data-pending-reject-note="261022012"]');
  ctx.type(reasonInput, 'তথ্য অসম্পূর্ণ');
  ctx.click(ctx.$('[data-pending-reject-confirm="261022012"]'));
  await ctx.waitFor(() => ctx.$$('[data-pending-student-row]').length === 0);

  const savedRoster = JSON.parse(ctx.window.localStorage.getItem(KEYS.students));
  const approvedRow = savedRoster.find(s => s.id === '261022011');
  const rejectedRow = savedRoster.find(s => s.id === '261022012');
  assert.equal(approvedRow.status, 'approved');
  assert.equal(approvedRow.accountStatus, 'active');
  assert.equal(approvedRow.approvedBy, 'manager.apc');
  assert.ok(approvedRow.approvedAt);
  assert.equal(rejectedRow.status, 'rejected');
  assert.equal(rejectedRow.reviewNote, 'তথ্য অসম্পূর্ণ');

  const savedNotifs = JSON.parse(ctx.window.localStorage.getItem(KEYS.registrationNotifications));
  assert.equal(savedNotifs.every(n => n.read === true), true);
  assert.equal(bell.querySelector('.notification-dot').hidden, true);
});
