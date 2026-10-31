/* Full 3-device end-to-end verification of Firebase Realtime Database sync:
   Phone 1 (Student index.html), Phone 2 (Admin admin.html), Phone 3 (Manager manager.html)
   all connected to the mock RTDB server enforcing database.rules.json.

   Proves:
   1. Online student registration immediately syncs in real time to BOTH Admin
      and Manager phones (without reload), renders in `#adminPendingRegistrations`
      and `#managerStudentQueue`, lights up the bell unread badge (`১`), fires
      `"নতুন শিক্ষার্থী রেজিস্ট্রেশন করেছে"`, and NEVER wipes the unread badge on
      subsequent refreshes / 15-second polls.
   2. Offline student registration queues locally in `pendingCloudRegistrations`
      and automatically syncs to Firebase as soon as internet returns (`online`),
      appearing live on BOTH Admin and Manager phones (`২` unread).
   3. Manager approving on Phone 3 updates Admin's phone in real time (auto-clearing
      Admin's unread registration record for that student) and immediately unlocks
      student login on Phone 1 — with zero database.rules.json violations. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockCloud, Device } from './two-device-harness.mjs';
import { KEYS } from '../js/database.js';

let cloud;
let studentPhone;
let adminPhone;
let managerPhone;

const waitForAsync = async (fn, timeoutMs = 15000) => {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for realtime condition');
};

before(async () => {
  cloud = await startMockCloud();
  const harness = await import('./two-device-harness.mjs');
  harness.buildDevices().buildAppCopy(cloud.url);
  studentPhone = new Device('rt-student-phone', cloud.url);
  adminPhone = new Device('rt-admin-phone', cloud.url);
  managerPhone = new Device('rt-manager-phone', cloud.url);
  for (const phone of [studentPhone, adminPhone, managerPhone]) phone.start();
});

after(async () => {
  await Promise.allSettled([studentPhone?.stop(), adminPhone?.stop(), managerPhone?.stop()]);
  await new Promise(resolve => cloud?.server?.close(resolve));
});

test('end-to-end 3-phone realtime sync: Student registration (online & offline-recovery) -> Admin & Manager live UI + persistent unread badge + toast -> approval -> Student login', async () => {
  // 1. Provision institution Admin and open real Admin & Manager portals on separate phones
  const created = await adminPhone.run('create-first-admin', { fullName: 'প্রধান এডমিন', password: 'Admin-2026' });
  assert.ok(created.account?.username, 'First admin created');

  const adminPortal = await adminPhone.run('open-staff-portal', { role: 'admin' });
  const managerPortal = await managerPhone.run('open-staff-portal', { role: 'manager' });
  assert.equal(adminPortal.ok, true, 'Admin portal booted with realtime sync');
  assert.equal(managerPortal.ok, true, 'Manager portal booted with realtime sync');

  await adminPhone.run('open-staff-students-view', { role: 'admin' });
  await managerPhone.run('open-staff-students-view', { role: 'manager' });

  // 2. Student registers ONLINE on Phone 1
  const regOnline = await studentPhone.run('register-student', {
    username: 'tanvir.live',
    pin: '482915',
    mobile: '01798765432',
    email: 'tanvir.live@example.com',
    nameBn: 'তানভীর হাসান',
    nameEn: 'Tanvir Hasan'
  });
  assert.equal(regOnline.registered, true, regOnline.message);
  const onlineStudentId = regOnline.account?.student?.id || regOnline.account?.studentId;
  assert.match(String(onlineStudentId), /^\d{9}$/, 'Online student gets 9-digit YYMMDDSSS ID');

  // Pending student login is blocked before approval
  const blockedLogin = await studentPhone.run('form-login', { username: 'tanvir.live', pin: '482915' });
  assert.equal(blockedLogin.studentSession, false);
  assert.match(blockedLogin.message, /আপনার অ্যাকাউন্ট অনুমোদনের অপেক্ষায় আছে/);

  // 3. BOTH Admin Phone AND Manager Phone receive the registration & notification in REAL TIME
  const adminLive1 = await waitForAsync(async () => {
    const st = await adminPhone.run('staff-portal-state', { role: 'admin' });
    return st.pendingRowIds.includes(String(onlineStudentId)) && st.unread >= 1 ? st : null;
  });
  assert.equal(adminLive1.pendingHostHidden, false, 'Admin pending registrations queue is immediately visible on Students tab');
  assert.match(adminLive1.hostText, /তানভীর হাসান/, 'the live queue names the applicant at once');
  assert.doesNotMatch(adminLive1.hostText, /01798765432/);
  assert.equal(adminLive1.hostText.includes(String(onlineStudentId)), false, 'the queue masks the mobile and ID');
  assert.match(adminLive1.pendingCardLabel, /১/, 'Admin pending card displays live count');
  assert.equal(adminLive1.badgeHidden, false, 'Admin bell unread badge is visible');
  assert.equal(adminLive1.badgeText, '১', 'Admin bell unread badge shows ১');
  assert.ok(adminLive1.toasts.includes('নতুন শিক্ষার্থী রেজিস্ট্রেশন করেছে'), 'Admin receives live Bangla registration toast');

  const managerLive1 = await waitForAsync(async () => {
    const st = await managerPhone.run('staff-portal-state', { role: 'manager' });
    return st.pendingRowIds.includes(String(onlineStudentId)) && st.unread >= 1 ? st : null;
  });
  assert.match(managerLive1.hostText, /তানভীর হাসান/);
  assert.match(managerLive1.hostText, new RegExp(onlineStudentId));
  assert.match(managerLive1.pendingCardLabel, /১ অপেক্ষমাণ/, 'Manager pending badge updates live');
  assert.equal(managerLive1.badgeHidden, false, 'Manager bell unread badge is visible');
  assert.equal(managerLive1.badgeText, '১', 'Manager bell unread badge shows ১');
  assert.ok(managerLive1.toasts.includes('নতুন শিক্ষার্থী রেজিস্ট্রেশন করেছে'), 'Manager receives live Bangla registration toast');

  // 4. Regression proof: subsequent refreshes / 15s polls NEVER wipe unread registration badges!
  const adminAfterPolls = await adminPhone.run('refresh-notifications', { times: 3 });
  const managerAfterPolls = await managerPhone.run('refresh-notifications', { times: 3 });
  assert.equal(adminAfterPolls.unread, 1, 'Admin unread badge stays 1 across repeated refresh cycles');
  assert.equal(managerAfterPolls.unread, 1, 'Manager unread badge stays 1 across repeated refresh cycles');
  assert.ok(adminAfterPolls.unreadKeys.includes(`registration:${onlineStudentId}`));
  assert.ok(managerAfterPolls.unreadKeys.includes(`registration:${onlineStudentId}`));

  // 5. Offline registration on Student Phone -> auto-syncs to Firebase when internet returns!
  await studentPhone.run('network', { online: false });
  const regOffline = await studentPhone.run('register-student', {
    username: 'nusrat.offline',
    pin: '739184',
    mobile: '01876543219',
    email: 'nusrat.offline@example.com',
    nameBn: 'নুসরাত জাহান',
    nameEn: 'Nusrat Jahan'
  });
  assert.equal(regOffline.registered, true, regOffline.message);
  const offlineStudentId = regOffline.account?.student?.id || regOffline.account?.studentId;
  assert.match(String(offlineStudentId), /^\d{9}$/);

  const queuedBeforeOnline = await studentPhone.run('pending-cloud-queue');
  assert.equal(queuedBeforeOnline.queue.length, 1, 'Offline registration is queued for cloud sync');

  // Reconnect Student Phone -> `online` event flushes queued registration automatically
  await studentPhone.run('network', { online: true });

  await waitForAsync(async () => {
    const q = await studentPhone.run('pending-cloud-queue');
    return q.queue.length === 0 ? true : null;
  });

  // Both Admin and Manager phones receive Nusrat Jahan in real time!
  const adminLive2 = await waitForAsync(async () => {
    const st = await adminPhone.run('staff-portal-state', { role: 'admin' });
    return st.pendingRowIds.includes(String(offlineStudentId)) && st.unread === 2 ? st : null;
  });
  assert.equal(adminLive2.badgeText, '২', 'Admin bell badge increments to ২');

  const managerLive2 = await waitForAsync(async () => {
    const st = await managerPhone.run('staff-portal-state', { role: 'manager' });
    return st.pendingRowIds.includes(String(offlineStudentId)) && st.unread === 2 ? st : null;
  });
  assert.equal(managerLive2.badgeText, '২', 'Manager bell badge increments to ২');

  // 6. Manager approves Tanvir Hasan on Phone 3 -> Admin Phone updates live + Student logs in on Phone 1!
  const approved = await managerPhone.run('decide-pending-student', {
    studentId: onlineStudentId,
    decision: 'approved',
    role: 'manager'
  });
  assert.equal(approved.ok, true);

  // Admin Phone automatically sees Tanvir leave pending queue and unread count drops from 2 to 1!
  const adminAfterDecision = await waitForAsync(async () => {
    await adminPhone.run('wait-content', { key: KEYS.students, id: onlineStudentId });
    const st = await adminPhone.run('staff-portal-state', { role: 'admin' });
    return !st.unreadKeys.includes(`registration:${onlineStudentId}`) && st.unread === 1 ? st : null;
  });
  assert.equal(adminAfterDecision.badgeText, '১', 'Admin unread badge drops from ২ to ১ automatically after Manager approves');

  // Student Phone immediately logs in with Tanvir's account!
  const unlockedLogin = await studentPhone.run('form-login', { username: 'tanvir.live', pin: '482915' });
  assert.equal(unlockedLogin.studentSession, true, 'Approved student immediately logs in across devices');
  const statusAfterUnlock = await studentPhone.run('wait-account-status', { status: 'active' });
  assert.equal(statusAfterUnlock.accountStatus, 'active');

  // 7. Live Class Chat E2EE relay across Manager Phone <-> Admin Phone in real time!
  await managerPhone.run('send-class-chat', {
    className: 'দশম শ্রেণি',
    text: 'দশম শ্রেণির শিক্ষার্থীদের স্বাগতম! আগামীকাল ক্লাস বিকেল ৪টায়।',
    actor: { id: 'manager', name: 'ম্যানেজার', role: 'manager', status: 'active' }
  });
  const adminChatView = await waitForAsync(async () => {
    const view = await adminPhone.run('read-class-chat', {
      className: 'দশম শ্রেণি',
      actor: { id: 'admin', name: 'প্রধান এডমিন', role: 'admin', status: 'active' }
    });
    return view.messages.some(m => m.text.includes('আগামীকাল ক্লাস বিকেল ৪টায়')) ? view : null;
  });
  assert.equal(adminChatView.messages.length, 1, 'Class Chat message encrypted, synced over RTDB, and decrypted live on second phone');

  // Every single RTDB read & write obeyed database.rules.json
  assert.deepEqual(cloud.ruleViolations, [], 'Zero RTDB security/validation rule violations');
});
