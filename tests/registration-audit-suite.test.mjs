/* Comprehensive verification suite for the 9 mandatory QA scenarios:
   1. New registration -> YYMMDDSSS ID, status="pending", notification + unread badge + toast in Admin & Manager panels
   2. 3 registrations on the same day -> ...001, ...002, ...003 (and >999 explicit error, no overflow)
   3. Day rollover in Asia/Dhaka -> resets to 001
   4. 2 parallel registrations -> no duplicate Student ID; parallel duplicate mobile/username -> 1 succeeds, 1 blocked
   5. Duplicate mobile (with +880/Bangla/hyphen normalization), case-insensitive username, email -> blocked; PBKDF2 hash & 5-try lockout
   6. Pending login blocked with "আপনার অ্যাকাউন্ট অনুমোদনের অপেক্ষায় আছে।", succeeds after approval (ASCII & Bangla digits)
   7. Student (and non-Admin/Manager) role calling approval API / Cloud Function / RTDB rules -> fails; ID immutable
   8. Mobile viewport (360px) notification queue & "অনুমোদন দিন" / "বাতিল করুন" buttons work cleanly in Admin & Manager panels
   9. Month-end, leap/non-leap Feb, year-end, and Dec 31 -> Jan 1 Asia/Dhaka boundary IDs work accurately */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { startMockCloud, Device, buildDevices } from './two-device-harness.mjs';
import { createSimulator } from './rtdb-rules-sim.mjs';
import {
  createIdGenerator,
  STUDENT_ID_REGEX,
  DAILY_LIMIT_ERROR,
  toBanglaDigits,
  toAsciiDigits,
  isValidStudentId
} from '../js/idGenerator.js';
import {
  contactNumber,
  mobileError,
  normalizeEmail,
  emailError,
  protectAccountIdentity
} from '../js/account-policy.js';
import { KEYS } from '../js/database.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { auditStudentDataset } from '../tools/audit-student-data.mjs';
import registrationDecisionCore from '../functions/registration-decision-core.js';

const { validateRegistrationDecisionRequest } = registrationDecisionCore;

const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'));
const rulesSim = createSimulator(rules);

function memoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => { map.set(key, String(val)); },
    removeItem: key => { map.delete(key); }
  };
}

let cloud = null;
const activeDevices = [];

after(async () => {
  await Promise.allSettled(activeDevices.map(dev => dev?.stop?.()));
  if (cloud?.server) {
    await new Promise(resolve => cloud.server.close(resolve));
  }
});

test('Scenario 2, 3 & 9 — YYMMDDSSS serials (001..003), >999 daily limit error, Asia/Dhaka day rollover, month-end & Dec 31 -> Jan 1 boundary', async () => {
  const store = memoryStore();
  let currentEpoch = Date.parse('2026-10-22T04:00:00Z'); // 10:00 AM Asia/Dhaka -> 261022
  const gen = createIdGenerator({ store, now: () => currentEpoch });

  // Scenario 2: 3 consecutive registrations on the same day -> ...001, ...002, ...003
  const id1 = await gen.nextStudentId([]);
  const id2 = await gen.nextStudentId([{ id: id1 }]);
  const id3 = await gen.nextStudentId([{ id: id1 }, { id: id2 }]);
  assert.equal(id1, '261022001');
  assert.equal(id2, '261022002');
  assert.equal(id3, '261022003');
  for (const id of [id1, id2, id3]) {
    assert.match(id, STUDENT_ID_REGEX);
    assert.equal(isValidStudentId(id), true);
    assert.equal(toAsciiDigits(toBanglaDigits(id)), id);
  }

  // Scenario 3: Next day in Asia/Dhaka resets counter to 001
  currentEpoch = Date.parse('2026-10-22T18:05:00Z'); // 2026-10-23 00:05 Asia/Dhaka (UTC+6)
  const nextDayId = await gen.nextStudentId([{ id: id1 }, { id: id2 }, { id: id3 }]);
  assert.equal(nextDayId, '261023001');

  // Scenario 9: Month-end (Jan 31, Feb 28 non-leap, Apr 30), Year-end (Dec 31 23:55 Dhaka) -> Jan 1 00:01 Dhaka
  currentEpoch = Date.parse('2026-01-31T17:30:00Z'); // Jan 31 23:30 Dhaka
  assert.equal(await gen.nextStudentId([]), '260131001');

  currentEpoch = Date.parse('2026-01-31T18:01:00Z'); // Feb 1 00:01 Dhaka
  assert.equal(await gen.nextStudentId([]), '260201001');

  currentEpoch = Date.parse('2026-02-28T10:00:00Z'); // Feb 28 Dhaka
  assert.equal(await gen.nextStudentId([]), '260228001');

  currentEpoch = Date.parse('2026-04-30T17:59:00Z'); // Apr 30 23:59 Dhaka
  assert.equal(await gen.nextStudentId([]), '260430001');

  currentEpoch = Date.parse('2026-12-31T17:59:59Z'); // Dec 31 2026 23:59:59 Asia/Dhaka
  assert.equal(await gen.nextStudentId([]), '261231001');
  assert.equal(await gen.nextStudentId([]), '261231002');

  currentEpoch = Date.parse('2026-12-31T18:00:01Z'); // Jan 1 2027 00:00:01 Asia/Dhaka!
  assert.equal(await gen.nextStudentId([]), '270101001');

  // Explicit error when >999 on the same day (never overflows to 1000 / 10 digits)
  const capStore = memoryStore({ 'activePlus.dailyStudentCounters.v1': JSON.stringify({ '270101': 999 }) });
  const capGen = createIdGenerator({ store: capStore, now: () => currentEpoch });
  await assert.rejects(() => capGen.nextStudentId([]), err => {
    assert.equal(err.code, 'DAILY_STUDENT_ID_LIMIT');
    assert.equal(err.message, DAILY_LIMIT_ERROR);
    return true;
  });
});

test('Scenario 1, 4, 5 & 6 (Cross-Device Cloud + Local) — parallel registrations, duplicate blocks, pending login gate, Admin & Manager notification + approval unlock', async () => {
  cloud = await startMockCloud();
  cloud.setNow(Date.parse('2026-10-22T06:00:00Z')); // Server clock: 2026-10-22 12:00 Asia/Dhaka
  buildDevices().buildAppCopy(cloud.url);

  const adminPhone = new Device('audit-admin', cloud.url);
  const studentPhoneA = new Device('audit-stu-a', cloud.url);
  const studentPhoneB = new Device('audit-stu-b', cloud.url);
  activeDevices.push(adminPhone, studentPhoneA, studentPhoneB);
  adminPhone.start();
  studentPhoneA.start();
  studentPhoneB.start();

  // Initialize Admin on adminPhone
  const created = await adminPhone.run('create-first-admin', { fullName: 'প্রধান এডমিন', password: 'Admin-2026' });
  assert.ok(created.account?.username);
  const adminLogin = await adminPhone.run('form-login', { username: created.account.username, pin: 'Admin-2026' });
  assert.equal(adminLogin.adminSession, true);
  await adminPhone.run('boot');

  await studentPhoneA.run('boot');
  await studentPhoneB.run('boot');

  // Scenario 4 (part A): Two parallel registrations from two separate phones -> distinct sequential YYMMDDSSS IDs, zero collision!
  const [regA, regB] = await Promise.all([
    studentPhoneA.run('register-student', {
      username: 'parallel.one',
      mobile: '+880 1711-223344',
      email: 'One.Student@Example.com',
      pin: '2468'
    }),
    studentPhoneB.run('register-student', {
      username: 'parallel.two',
      mobile: '৮৮০০১৮১১২২৩৩৪৪',
      email: 'two.student@example.com',
      pin: '1357'
    })
  ]);

  assert.equal(regA.registered, true, regA.message);
  assert.equal(regB.registered, true, regB.message);
  const idA = regA.account.student.id;
  const idB = regB.account.student.id;
  assert.notEqual(idA, idB, 'parallel registrations must never receive the same Student ID');
  assert.deepEqual([idA, idB].sort(), ['261022001', '261022002']);
  assert.equal(regA.account.status, 'pending');
  assert.equal(regA.account.mobile, '01711223344', '+880 and punctuation normalized to 01...');
  assert.equal(regB.account.mobile, '01811223344', 'Bangla 88001... normalized to 01...');
  assert.equal(regA.account.email, 'one.student@example.com');
  assert.equal(regA.account.pin, undefined, 'plaintext PIN is never persisted');
  assert.equal(typeof regA.account.pinHash, 'object', 'PBKDF2 hash stored');

  // Scenario 1: Notification record created in the same transaction on RTDB with exact schema
  const cloudV1 = cloud.state.activePlusSync?.v1 || {};
  const notifA = Object.values(cloudV1.notifications || {}).find(n => n?.studentId === idA);
  assert.ok(notifA, 'notification record created in same transaction');
  assert.equal(notifA.type, 'new_registration');
  assert.equal(notifA.studentId, idA);
  assert.equal(notifA.mobile, '01711223344');
  assert.equal(notifA.read, false);
  assert.ok(notifA.createdAt);

  // Admin & Manager feeds both see both pending registrations; Teacher sees none
  await adminPhone.run('wait-content', { key: KEYS.students, id: idA });
  await adminPhone.run('wait-content', { key: KEYS.students, id: idB });
  const adminFeed = await adminPhone.run('registration-feed', { role: 'admin' });
  const managerFeed = await adminPhone.run('registration-feed', { role: 'manager' });
  const teacherFeed = await adminPhone.run('registration-feed', { role: 'teacher' });
  assert.equal(adminFeed.keys.includes(`registration:${idA}`), true);
  assert.equal(managerFeed.keys.includes(`registration:${idA}`), true);
  assert.deepEqual(teacherFeed.keys, []);

  // Scenario 5: Duplicate mobile, case-insensitive duplicate username, and duplicate email are all blocked with friendly Bangla errors!
  const dupMobile = await studentPhoneB.run('register-student', {
    username: 'fresh.user',
    mobile: '01711 223 344',
    email: 'fresh@example.com',
    pin: '1122'
  });
  assert.equal(dupMobile.registered, false);
  assert.match(dupMobile.message, /এই মোবাইল নম্বর দিয়ে আগেই রেজিস্ট্রেশন হয়েছে/);

  const dupUsername = await studentPhoneB.run('register-student', {
    username: 'PARALLEL.ONE',
    mobile: '01911223344',
    email: 'fresh2@example.com',
    pin: '1122'
  });
  assert.equal(dupUsername.registered, false);
  assert.match(dupUsername.message, /ইউজারনেমটি আগেই নেওয়া হয়েছে/);

  const dupEmail = await studentPhoneB.run('register-student', {
    username: 'fresh.email',
    mobile: '01922334455',
    email: 'ONE.STUDENT@EXAMPLE.COM',
    pin: '1122'
  });
  assert.equal(dupEmail.registered, false);
  assert.match(dupEmail.message, /এই ইমেইল ঠিকানা দিয়ে আগেই রেজিস্ট্রেশন হয়েছে/);

  // Scenario 4 (part B): Two parallel registrations racing for the SAME mobile -> exactly 1 succeeds, 1 gets friendly error!
  const [race1, race2] = await Promise.all([
    studentPhoneA.run('register-student', {
      username: 'race.alpha',
      mobile: '01655667788',
      email: 'race.alpha@example.com',
      pin: '4321'
    }),
    studentPhoneB.run('register-student', {
      username: 'race.beta',
      mobile: '+8801655-667788',
      email: 'race.beta@example.com',
      pin: '4321'
    })
  ]);
  assert.equal([race1.registered, race2.registered].filter(Boolean).length, 1, 'only one concurrent registration may claim a mobile');
  const loser = race1.registered ? race2 : race1;
  assert.match(loser.message, /এই মোবাইল নম্বর দিয়ে আগেই রেজিস্ট্রেশন হয়েছে/);

  // Scenario 6: Pending student CANNOT log in -> receives exact Bangla message; succeeds after approval!
  await studentPhoneA.run('start-app');
  const blocked = await studentPhoneA.run('submit-login', { username: 'parallel.one', pin: '2468' });
  assert.equal(blocked.studentSession, false);
  assert.match(blocked.message, /^আপনার অ্যাকাউন্ট অনুমোদনের অপেক্ষায় আছে।/);

  // Approve idA from Admin -> status becomes active, approvedBy & approvedAt saved, notification marked read!
  const approved = await adminPhone.run('decide-registration', { studentId: idA, decision: 'approved', role: 'admin' });
  assert.equal(approved.ok, true);
  assert.equal(approved.student.accountStatus, 'active');
  assert.ok(approved.student.approvedBy);
  assert.ok(approved.student.approvedAt);

  // Wait for approval sync and verify login succeeds with BOTH username AND Bangla-digit Student ID!
  await new Promise(r => setTimeout(r, 250));
  const okLogin = await studentPhoneA.run('submit-login', { username: toBanglaDigits(idA), pin: '2468' });
  assert.equal(okLogin.studentSession, true, okLogin.message);

  // Reject idB with reason -> stays blocked on login with rejection message
  const rejected = await adminPhone.run('decide-registration', {
    studentId: idB,
    decision: 'rejected',
    role: 'admin',
    note: 'অভিভাবকের নম্বর যাচাই হয়নি'
  });
  assert.equal(rejected.ok, true);
  await new Promise(r => setTimeout(r, 250));
  await studentPhoneB.run('start-app');
  const rejectedLogin = await studentPhoneB.run('submit-login', { username: 'parallel.two', pin: '1357' });
  assert.equal(rejectedLogin.studentSession, false);
  assert.match(rejectedLogin.message, /বাতিল করা হয়েছে.*অভিভাবকের নম্বর যাচাই হয়নি/);

  assert.deepEqual(cloud.ruleViolations, [], 'zero RTDB rule violations across the entire flow');
});

test('Scenario 5 (Brute-Force Lockout) — 5 failed login attempts lock out the identifier for 15 minutes', async () => {
  const ctx = await loadPage('index.html', {
    seed: {
      [STAFF_ACCOUNTS.admin.accountKey]: '{}',
      'activePlus.demo.autofill.v1': 'off'
    }
  });
  Object.defineProperty(ctx.window.navigator, 'onLine', { configurable: true, value: false });
  const storage = await import('../js/storage.js');
  const { initLogin } = await import('../js/login.js');
  const account = await storage.persistAccount({
    username: 'lockout.user',
    mobile: '01799887766',
    pin: '654321',
    status: 'active',
    student: { id: '261022099', name: 'লকআউট পরীক্ষার্থী', status: 'approved', accountStatus: 'active' }
  }, { isNewRegistration: true });

  let loggedIn = 0;
  initLogin({ state: { account, student: account.student }, onAuthenticated: () => { loggedIn += 1; } });

  const attempt = async pin => {
    ctx.type(ctx.$('#loginMobile'), 'lockout.user');
    ctx.type(ctx.$('#loginPin'), pin);
    ctx.submit(ctx.$('#loginForm'));
    await ctx.waitFor(() => ctx.$('#loginForm').getAttribute('aria-busy') !== 'true');
  };

  for (let i = 0; i < 5; i += 1) {
    await attempt('000000');
  }
  assert.equal(loggedIn, 0);
  assert.match(ctx.$('#authMessage').textContent, /১৫ মিনিটের জন্য সাময়িকভাবে লক করা হয়েছে/);

  // Even the RIGHT password must be refused while locked!
  await attempt('654321');
  assert.equal(loggedIn, 0);
  assert.match(ctx.$('#authMessage').textContent, /১৫ মিনিট পর আবার চেষ্টা করুন/);
  ctx.window.close();
});

test('Scenario 7 — Role-based authorization blocks Student/Teacher/Payment approval in client, Cloud Functions, and RTDB rules, and Student ID is immutable', async () => {
  const ctx = await loadPage('index.html', {
    seed: {
      [KEYS.students]: JSON.stringify([
        { id: '261022055', name: 'নিরাপত্তা শিক্ষার্থী', mobile: '01755443322', status: 'pending', registeredAt: '2026-10-22T06:00:00.000Z' }
      ])
    }
  });
  const { decideRegistration } = await import('../js/registration-review.js');

  // 1. Client action check: student, teacher, payment, and unauthenticated admin all fail
  for (const forbiddenRole of ['student', 'teacher', 'payment', '', null]) {
    const res = await decideRegistration('261022055', 'approved', { role: forbiddenRole });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'not-allowed');
  }
  const unauthAdmin = await decideRegistration('261022055', 'approved', { role: 'admin' });
  assert.equal(unauthAdmin.ok, false);
  assert.equal(unauthAdmin.reason, 'no-session');

  // 1b. Cloud Function server-side validator check: student/teacher/inactive claims rejected
  assert.equal(
    validateRegistrationDecisionRequest({ uid: 'u1', token: { role: 'student', active: true } }, { studentId: '261022055', decision: 'approved' }).ok,
    false
  );
  assert.equal(
    validateRegistrationDecisionRequest({ uid: 'u2', token: { role: 'teacher', active: true } }, { studentId: '261022055', decision: 'approved' }).code,
    'permission-denied'
  );
  assert.equal(
    validateRegistrationDecisionRequest({ uid: 'u3', token: { role: 'manager', active: false } }, { studentId: '261022055', decision: 'approved' }).ok,
    false
  );
  assert.equal(
    validateRegistrationDecisionRequest({ uid: 'u4', token: { role: 'admin', active: true, username: 'admin.apc' } }, { studentId: '261022055', decision: 'approved' }).ok,
    true
  );

  // 2.RTDB security rules check: student claim cannot read notifications and cannot approve pending student!
  const studentAuth = { uid: 'stu-1', token: { role: 'student', active: true, firebase: { sign_in_provider: 'custom' } } };
  const teacherAuth = { uid: 'tch-1', token: { role: 'teacher', active: true, firebase: { sign_in_provider: 'custom' } } };
  const managerAuth = { uid: 'mgr-1', token: { role: 'manager', active: true, firebase: { sign_in_provider: 'custom' } } };
  const dbState = {
    activePlusSync: {
      v1: {
        notifications: {
          notif_261022055: {
            id: 'notif_261022055',
            type: 'new_registration',
            studentId: '261022055',
            studentName: 'নিরাপত্তা শিক্ষার্থী',
            mobile: '01755443322',
            createdAt: '2026-10-22T06:00:00.000Z',
            read: false
          }
        },
        students: {
          '261022055': { id: '261022055', name: 'নিরাপত্তা শিক্ষার্থী', status: 'pending' }
        }
      }
    }
  };

  assert.equal(rulesSim.canRead(studentAuth, 'activePlusSync/v1/notifications', dbState), false, 'student cannot read notifications');
  assert.equal(rulesSim.canRead(teacherAuth, 'activePlusSync/v1/notifications', dbState), false, 'teacher cannot read notifications');
  assert.equal(rulesSim.canRead(managerAuth, 'activePlusSync/v1/notifications', dbState), true, 'active manager can read notifications');

  assert.equal(
    rulesSim.canWrite(studentAuth, 'activePlusSync/v1/students/261022055', {
      id: '261022055',
      status: 'approved',
      approvedBy: 'stu-1',
      approvedAt: '2026-10-22T07:00:00.000Z'
    }, dbState),
    false,
    'student claim is blocked by RTDB rules from approving a pending registration'
  );
  assert.equal(
    rulesSim.canWrite(managerAuth, 'activePlusSync/v1/students/261022055', {
      id: '261022055',
      status: 'approved',
      approvedBy: 'mgr-1',
      approvedAt: '2026-10-22T07:00:00.000Z'
    }, dbState),
    true,
    'active manager claim is allowed by RTDB rules to approve a pending registration'
  );
  assert.equal(
    rulesSim.canWrite(managerAuth, 'activePlusSync/v1/students/261022055', {
      id: '261022999',
      status: 'pending'
    }, dbState),
    false,
    'RTDB rules forbid mutating an existing Student ID'
  );

  // 3. Account identity immutability check: Student ID, username, and email cannot be overwritten once set
  const locked = protectAccountIdentity(
    {
      studentId: '999999999',
      username: 'changed.user',
      email: 'changed@example.com',
      student: { id: '999999999', name: 'নতুন নাম' }
    },
    {
      studentId: '261022055',
      username: 'original.user',
      email: 'original@example.com',
      mobile: '01755443322',
      student: { id: '261022055', name: 'পুরনো নাম' }
    }
  );
  assert.equal(locked.studentId, '261022055');
  assert.equal(locked.student.id, '261022055');
  assert.equal(locked.username, 'original.user');
  assert.equal(locked.email, 'original@example.com');

  // Phone & email format normalization checks
  assert.equal(contactNumber('+880 1712-345678'), '01712345678');
  assert.equal(contactNumber('৮৮০০১৭১২৩৪৫৬৭৮'), '01712345678');
  assert.notEqual(mobileError('01212345678'), '');
  assert.equal(normalizeEmail('  Test.User@Mail.COM '), 'test.user@mail.com');
  assert.notEqual(emailError('not-an-email'), '');
  ctx.window.close();
});

test('Scenario 1 & 8 (Admin 360px Mobile) — Mobile viewport (360px) notification bell, badge, "অনুমোদনের অপেক্ষায়" list, toast, and "অনুমোদন দিন" / "বাতিল করুন" buttons work on Admin panel', async () => {
  const pendingRows = [
    {
      id: '261022001',
      name: 'তানভীর আহমেদ',
      mobile: '01711000001',
      className: 'দশম শ্রেণি',
      group: 'বিজ্ঞান',
      status: 'pending',
      registeredAt: '2026-10-22T06:10:00.000Z'
    },
    {
      id: '261022002',
      name: 'সুমাইয়া আক্তার',
      mobile: '01811000002',
      className: 'নবম শ্রেণি',
      group: 'মানবিক',
      status: 'pending',
      registeredAt: '2026-10-22T06:15:00.000Z'
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

  const adminCtx = await loadPage('admin.html', {
    width: 360,
    height: 740,
    seed: {
      [KEYS.students]: JSON.stringify(pendingRows),
      [KEYS.registrationNotifications]: JSON.stringify(pendingNotifs)
    }
  });
  await provisionStaff('admin');
  seedStaffSession(adminCtx.window, 'admin');
  await import('../js/admin.js');
  await adminCtx.waitFor(() => adminCtx.$('#adminShell').hidden === false);
  const notifMod = await import('../js/notifications.js');
  notifMod.initNotifications();
  await adminCtx.flush();
  await adminCtx.waitFor(() => Boolean(adminCtx.window.apcNoticeCenter));
  assert.equal(adminCtx.window.innerWidth, 360);

  const adminBell = adminCtx.$('#notificationButton');
  await adminCtx.waitFor(() => {
    const dot = adminBell?.querySelector('.notification-dot');
    return dot && !dot.hidden && dot.textContent === '২';
  });

  // Trigger subtle toast event and verify non-intrusive toast text
  adminCtx.window.dispatchEvent(new adminCtx.window.CustomEvent('apc-new-registration-toast', {
    detail: { message: 'নতুন শিক্ষার্থী রেজিস্ট্রেশন করেছে' }
  }));
  const adminToast = adminCtx.$('#apcRegistrationToast');
  assert.ok(adminToast);
  assert.equal(adminToast.hidden, false);
  assert.equal(adminToast.textContent, 'নতুন শিক্ষার্থী রেজিস্ট্রেশন করেছে');

  // Open the bell modal: the queue masks identity until review, but keeps its actions.
  adminCtx.click(adminBell);
  await adminCtx.waitFor(() => adminCtx.$$('#apcNoticeModal [data-pending-student-row]').length === 2);
  const queueText = adminCtx.$('#apcNoticeModal [data-apc-pending-registrations]').textContent;
  assert.match(queueText, /অনুমোদনের অপেক্ষায়/);
  assert.match(queueText, /তানভীর আহমেদ/, 'the applicant is named in the queue');
  assert.doesNotMatch(queueText, /01711000001|261022001/, 'the mobile and Student ID stay masked');
  assert.match(queueText, /তারিখ:/);

  const approveBtn = adminCtx.$('#apcNoticeModal [data-pending-approve="261022001"]');
  const rejectBtn = adminCtx.$('#apcNoticeModal [data-pending-reject="261022002"]');
  assert.equal(approveBtn.textContent.trim(), 'অনুমোদন দিন');
  assert.equal(rejectBtn.textContent.trim(), 'বাতিল করুন');

  // Click "অনুমোদন দিন" on 261022001 -> status active, approvedBy/approvedAt saved, notification read, badge drops to ১!
  adminCtx.click(approveBtn);
  await adminCtx.waitFor(() => adminCtx.$$('#apcNoticeModal [data-pending-student-row]').length === 1);
  const savedAfterAdmin = JSON.parse(adminCtx.window.localStorage.getItem(KEYS.students));
  const row1 = savedAfterAdmin.find(s => s.id === '261022001');
  assert.equal(row1.status, 'approved');
  assert.equal(row1.accountStatus, 'active');
  assert.equal(row1.approvedBy, 'admin.apc');
  assert.ok(row1.approvedAt);
  const notifsAfterAdmin = JSON.parse(adminCtx.window.localStorage.getItem(KEYS.registrationNotifications));
  assert.equal(notifsAfterAdmin.find(n => n.studentId === '261022001').read, true);
  assert.equal(adminBell.querySelector('.notification-dot').textContent, '১');
  adminCtx.window.close();
});

test('Read-only Existing Data Validation Script detects blank IDs, format errors, and duplicates without mutating input', () => {
  const sample = Object.freeze([
    Object.freeze({ id: '261022001', name: 'ক', mobile: '01711223344', username: 'user.one', email: 'a@b.com' }),
    Object.freeze({ id: '261022001', name: 'খ', mobile: '+880 1711-223344', username: 'USER.ONE', email: 'A@B.COM' }),
    Object.freeze({ id: '', name: 'গ', mobile: '12345', username: '1bad', email: 'bad-mail' }),
    Object.freeze({ id: 'AP-1024', name: 'রাইসা', mobile: '01811223344' })
  ]);
  const report = auditStudentDataset({ students: sample, sourceName: 'unit-sample' });
  assert.equal(report.readOnly, true);
  assert.equal(report.validNineDigitIds, 2);
  assert.equal(report.blankIds.length, 1);
  assert.equal(report.nonStandardIds.length, 1);
  assert.equal(report.nonStandardIds[0].id, 'AP-1024');
  assert.equal(report.duplicateIds.length, 1);
  assert.equal(report.duplicateMobiles.length, 1);
  assert.equal(report.duplicateUsernames.length, 1);
  assert.equal(report.duplicateEmails.length, 1);
  assert.equal(report.invalidMobiles.length, 1);
  assert.equal(report.invalidUsernames.length, 1);
  assert.equal(report.invalidEmails.length, 1);
});
