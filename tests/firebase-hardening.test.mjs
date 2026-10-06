/* Firebase audit round 6 — wire safety and failure isolation.

   The audit's question was: what happens to the online bridge when one record
   in local storage is something Realtime Database refuses? Two failure modes
   were found and fixed, and this file pins both against the real shipped code
   (the same two-device jsdom harness the sync tests use):

     1. Raw-path writes — the four staff accounts, the student login and the
        exam database — write an app object as it is. One nested key holding
        `.` `#` `$` `[` `]` or `/` (an imported or hand-edited record) made the
        SDK throw, and because the startup batch shared one `await`, the WHOLE
        bridge aborted: no staff account loaded, no login, no sync.
     2. Startup isolation — a single rejected task must not abort the startup
        batch. Only a total failure (every task rejected = the cloud is
        unreachable) stays a hard stop.

   Also pinned here: the exam mirror keeps every other record in the same push
   (one bad exam does not stop the good ones), a recovered record starts
   syncing without a reload, and the audit's deployment assets (`.firebaserc`,
   the reCAPTCHA CSP sources) do not silently disappear. */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startMockCloud, Device } from './two-device-harness.mjs';
import { unsafeKeyPath, isRtdbKey } from '../js/rtdb-keys.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));

const ADMIN_PASSWORD = 'Admin-2026';
const SYNC_ROOT = cloud => cloud.state.activePlusSync?.v1 || {};

let cloud = null;
let deviceA = null;

/* A record the app's own strict reader accepts; only the fields under test
   change from one case to the next. */
const EXAM_BASE = {
  type: 'mcq', status: 'draft', class: 'নয়ম', subject: 'গণিত', teacherId: 'T1',
  teacherName: 'শিক্ষক', participants: ['STU-1'], questions: [{ id: 'q1', text: '১ + ১?', marks: 1 }],
  createdAt: '2026-09-01T10:00:00.000Z'
};

const ATTEMPT_BASE = {
  examId: 'EXAM-SAFE', studentId: 'STU-1', status: 'active', number: 1,
  answers: {}, order: [{ id: 'q1', options: ['A', 'B'] }], startedAt: 1, score: 0
};

async function waitForCloud(predicate, what, timeout = 10000) {
  const started = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - started > timeout) throw new Error('cloud wait timed out: ' + what);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

before(async () => {
  cloud = await startMockCloud();
  const harness = await import('./two-device-harness.mjs');
  harness.buildDevices({ quietConsoleError: true }).buildAppCopy(cloud.url);
  deviceA = new Device('A', cloud.url);
  deviceA.start();
});

after(async () => {
  await Promise.allSettled([deviceA?.stop()]);
  await new Promise(resolve => cloud?.server?.close(resolve));
});

test('a host of forbidden keys still lets the first Admin and the cloud bridge start', async () => {
  /* Everything an imported/hand-edited device can hold, at once:
     - a dotted exam id and a dotted exam question fact in the exam database;
     - a dotted id in the attempts list of the same database;
     - dotted keys in the student account record the login hydrates.
     Firebase rejects a key with `.` — every one of these paths would throw. */
  await deviceA.run('seed-exam-db', {
    exams: [
      // a dotted exam id would become a Realtime Database key: rejected outright
      { ...EXAM_BASE, id: 'EXAM.260929', title: 'আগের সেশন' },
      // a nested dotted key inside an otherwise fine record: also rejected
      { ...EXAM_BASE, id: 'EXAM-NESTED', title: 'নেস্টেড ফ্যাক্ট', facts: { 'গণিত.q1': 'উত্তর' } },
      { ...EXAM_BASE, id: 'EXAM-SAFE', title: 'নিরাপদ পরীক্ষা', subject: 'বিজ্ঞান' }
    ],
    attempts: [{ ...ATTEMPT_BASE, id: 'AT.1' }]
  });
  await deviceA.run('write-student-account', {
    username: 'dots.student', pin: '4321', fullName: 'দোলন আক্তার', mobile: '01812345678',
    extra: { results: { 'EXAM.260929': { score: 0, total: 1 } } }
  });
  const boot = await deviceA.run('boot');
  assert.equal(boot.ok, true, 'the bridge still starts with unpushable records on the device');

  const admin = await deviceA.run('create-admin', {
    fullName: 'Test admin', mobile: '01712345678', password: ADMIN_PASSWORD
  });
  assert.equal(admin.username, 'test.admin.apc');
  await deviceA.run('boot');
  await waitForCloud(
    () => SYNC_ROOT(cloud).staffAccounts?.admin?.username === admin.username,
    'the Admin account reaches the cloud even though the exam mirror cannot be written'
  );
  // The login bridge itself is what matters after startup: the Admin signs in.
  const login = await deviceA.run('form-login', { username: admin.username, pin: ADMIN_PASSWORD });
  assert.equal(login.adminSession, true, 'Admin login works on a device holding a forbidden-key record');
  assert.equal(login.navigated, true, 'hands over to the admin panel');
});

test('one bad exam does not stop the good records in the same push', async () => {
  await waitForCloud(() => Boolean(SYNC_ROOT(cloud).examDb?.exams?.['EXAM-SAFE']),
    'the clean exam is pushed');
  assert.equal(SYNC_ROOT(cloud).examDb?.exams?.['EXAM.260929'], undefined,
    'the dotted id can never become a Realtime Database key');
  assert.equal(SYNC_ROOT(cloud).examDb?.exams?.['EXAM-NESTED'], undefined,
    'a nested dotted key is caught before the database throws');
  assert.equal(SYNC_ROOT(cloud).examDb?.attempts?.['AT.1'], undefined,
    'a forbidden attempt id is left on the device, not thrown at the database');
  assert.equal(SYNC_ROOT(cloud).studentAccounts?.['dots.student'], undefined,
    'the student login with a dotted result map is not pushed either');
  assert.match(
    (await deviceA.run('wait-sync-state', { state: 'conflict' })).message || '',
    /ফায়ারবেস-নিষিদ্ধ/,
    'the device says which problem it is, instead of dying silently'
  );
});

test('fixing the record on the device syncs it without a reload', async () => {
  /* The teacher removes the forbidden id / dotted key on the device (that is
     what the status message asks for); the next write pushes the corrected
     document with no reload. */
  await deviceA.run('seed-exam-db', {
    exams: [
      { ...EXAM_BASE, id: 'EXAM-CLEAN', title: 'সংশোধিত' },
      { ...EXAM_BASE, id: 'EXAM-NESTED', title: 'নেস্টেড ফিক্সড', facts: { q1: 'উত্তর' } }
    ],
    attempts: [{ ...ATTEMPT_BASE, id: 'AT-CLEAN' }]
  });
  await waitForCloud(() => Boolean(SYNC_ROOT(cloud).examDb?.exams?.['EXAM-CLEAN']),
    'the corrected record is pushed by the next sync pass');
  assert.equal(SYNC_ROOT(cloud).examDb?.exams?.['EXAM-NESTED']?.facts?.q1, 'উত্তর',
    'the fixed nested key travels too');
  assert.ok(SYNC_ROOT(cloud).examDb?.attempts?.['AT-CLEAN'], 'the fixed attempt travels too');
});

test('the key guard names exactly the records Realtime Database would refuse', () => {
  /* Every raw-path record the audit walked through: what a device really holds
     when it refuses a write. */
  const staffAccount = {
    role: 'admin', username: 'rasal.admin.apc', staffId: 'A260929001',
    password: { hash: 'x', salt: 'y', iterations: 1 }, updatedAt: '2026-09-29T00:00:00.000Z'
  };
  assert.equal(unsafeKeyPath(staffAccount), '', 'a normal staff account is writable as it is');
  assert.equal(unsafeKeyPath({ ...staffAccount, password: { 'a.b': 1 } }), 'password.a.b');

  const studentAccount = {
    username: 'raisa.islam', studentId: 'S2609291', pinHash: { hash: 'x', salt: 'y', iterations: 1 },
    results: { EXAM260929: { score: 9 } }, marks: { 'গণিত': { q1: 5 } }, updatedAt: 'now'
  };
  assert.equal(unsafeKeyPath(studentAccount), '', 'the shipped shape stays writable');
  assert.equal(unsafeKeyPath({ ...studentAccount, results: { 'EXAM.260929': { score: 9 } } }), 'results.EXAM.260929');
  assert.equal(unsafeKeyPath({ ...studentAccount, marks: { 'গণিত.q1': 5 } }), 'marks.গণিত.q1');
  assert.equal(unsafeKeyPath({ ...studentAccount, marks: { ['গণিত/q1']: 5 } }), 'marks.গণিত/q1');

  /* The id itself becomes a path segment: the guard has to judge it too. */
  assert.equal(isRtdbKey('EXAM260929'), true);
  assert.equal(isRtdbKey('EXAM.260929'), false);
  assert.equal(isRtdbKey(''), false, 'an empty key is not addressable either');
  assert.equal(isRtdbKey('উত্তর#১'), false);
  assert.equal(isRtdbKey('AT-1'), true);

  /* Values are never keys: a dotted string in a value must still be writable. */
  assert.equal(unsafeKeyPath({ id: 'EXAM-SAFE', note: 'ক.খ', at: '2026.09.29' }), '');
});

test('the deployment assets the audit found are still in place', () => {
  /* Without .firebaserc every `firebase deploy --only database` targets the
     wrong (or no) project, so the documented setup step cannot succeed. */
  const rc = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8'));
  assert.equal(rc.projects.default, 'active-plus-coaching', 'the CLI target matches js/firebase-config.js');
  // js/firebase-config.js only re-exports; the values live in firebase/.
  const config = readFileSync(new URL('../firebase/firebase-config.js', import.meta.url), 'utf8');
  assert.match(config, /projectId:\s*'active-plus-coaching'/);

  /* App Check with a reCAPTCHA v3 key cannot run under a policy that blocks
     the reCAPTCHA scripts — the sync then fails with Permission denied. */
  for (const page of ['index.html', 'admin.html', 'manager.html', 'teacher.html', 'payment.html']) {
    const html = readFileSync(new URL('../' + page, import.meta.url), 'utf8');
    assert.match(html, /script-src[^;]*google\.com\/recaptcha\//, `${page} allows the reCAPTCHA script`);
    assert.match(html, /frame-src[^;]*google\.com\/recaptcha\//, `${page} allows the reCAPTCHA frame`);
  }
});

test('every read and write the app made was allowed by the deployed database.rules.json', () => {
  assert.deepEqual(cloud.ruleViolations, [], 'the shipped client and the shipped rules must agree');
});
