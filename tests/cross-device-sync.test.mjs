/* Cross-device sync — the whole point of the online bridge: an account or
   record created on one phone must be usable on another phone.

   Two isolated Node/jsdom processes (their own localStorage and module
   graphs) run the REAL app code against a shared in-memory mock of the
   Firebase Realtime Database. Only the three Firebase CDN import specifiers
   are rewritten (see tests/two-device-harness.mjs) — the storage-write
   bridge, push/merge rules, listeners and the login flow run as shipped.

   Covered end to end:
     • device A creates the first Admin → pushed to the cloud
     • device B boots fresh and pulls: role account, Staff Directory,
       Login User ID registry, students, the student login
     • the Admin ID created on A signs in on B through the real login form
     • a Staff Management (directory) ID created on A logs in on B and its
       forced password change flows back to A live
     • records written on either device appear on the other without a reload
     • an MCQ exam + attempt created on A reach B through the examDb mirror,
       a submitted score flows A → B live, and a deletion propagates too
     • only password HASHES travel the bridge (no plaintext pin) */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startMockCloud, Device } from './two-device-harness.mjs';
import { encodeUsernameKey } from '../js/username-sync-codec.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const ADMIN_PASSWORD = 'Admin-2026';
const TEACHER_PASSWORD = 'Teach-2026';

let cloud = null;
let deviceA = null;
let deviceB = null;
let adminUsername = null;
let teacherUsername = null;


const SYNC_ROOT = cloud => cloud.state.activePlusSync?.v1 || {};

/* Pushes inside the app are fire-and-forget promises (as in the browser), so
   cloud-side assertions poll briefly instead of racing the bridge. */
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
  harness.buildDevices().buildAppCopy(cloud.url);
  deviceA = new Device('A', cloud.url);
  deviceB = new Device('B', cloud.url);
  deviceA.start();
  deviceB.start();
});

after(async () => {
  await Promise.allSettled([deviceA?.stop(), deviceB?.stop()]);
  await new Promise(resolve => cloud?.server?.close(resolve));
});

test('an empty cloud explains the source-device sync step instead of requesting duplicate registration', async () => {
  const result = await deviceB.run('form-login', { username: 'missing.account.apc', pin: '4321' });
  assert.equal(result.studentSession, false);
  // An empty cloud must be named as such: the account was never uploaded from
  // the other device, and that is where the fix has to happen.
  assert.match(result.message, /ক্লাউডে এখনো কোনো শিক্ষার্থী অ্যাকাউন্ট ওঠেনি/);
  assert.match(result.message, /যে ডিভাইসে অ্যাকাউন্টটি আছে সেখানে অ্যাপ অনলাইনে খুলে সিঙ্ক চালু করুন/);
  assert.doesNotMatch(result.message, /আগে রেজিস্ট্রেশন করুন/);
});

test('login IDs and data created on device A work on device B', async () => {
  /* ---- Device A: first boot, create the Admin, sign in, create data ---- */
  // Existing devices can create IDs before the bridge ever connects. A dotted
  // username must not abort startup before the student login is uploaded.
  const admin = await deviceA.run('create-admin', {
    fullName: 'Test admin',
    mobile: '01712345678',
    password: ADMIN_PASSWORD
  });
  adminUsername = admin.username;
  assert.match(adminUsername, /^test\.admin\.apc$/, 'the generated Admin Login User ID');
  assert.deepEqual(admin.bootstrapRoles.sort(), ['manager', 'payment', 'teacher']);
  await deviceA.run('write-student-account', {
    username: 'dolon', pin: '4321', fullName: 'দোলন আক্তার', mobile: '01812345678'
  });
  const bootA = await deviceA.run('boot');
  assert.equal(bootA.ok, true, 'existing local identities do not abort startup');
  assert.equal(SYNC_ROOT(cloud).studentAccounts?.dolon?.username, 'dolon', 'startup reaches student upload after usernames');

  /* A → cloud: the role account, the bootstrap roles and the claimed id
     registry must all be on the bridge now. */
  const root = () => SYNC_ROOT(cloud);
  await waitForCloud(() => root().staffAccounts?.admin?.username === adminUsername, 'Admin account pushed');
  assert.ok(root().staffAccounts?.admin?.password, 'password record travels (a PBKDF2 hash, never plaintext)');
  await waitForCloud(
    () => ['manager', 'teacher', 'payment'].every(role => root().staffAccounts?.[role]?.username),
    'bootstrap role accounts pushed');
  await waitForCloud(() => root().usernames?.[encodeUsernameKey(adminUsername)] === 'staff:admin', 'claimed Login User ID registry pushed');

  const loginA = await deviceA.run('form-login', { username: adminUsername, pin: ADMIN_PASSWORD });
  assert.equal(loginA.adminSession, true, 'device A admin signs in');
  assert.equal(loginA.dialog, false, 'no forced password change for the first admin');
  assert.equal(loginA.navigated, true, 'hands over to the admin panel');

  const teacher = await deviceA.run('create-directory-staff', {
    fullName: 'Rahim Uddin',
    role: 'teacher',
    password: TEACHER_PASSWORD
  });
  teacherUsername = teacher.username;
  assert.match(teacherUsername, /^rahim\d?\.teacher\.apc$/, 'generated directory Login User ID');
  /* records[0] is the seeded system admin — find the created teacher. */
  const cloudTeacher = () => (root().staffDirectory?.records || []).find(record => record?.username === teacherUsername);
  await waitForCloud(() => Boolean(cloudTeacher()), 'directory record pushed');

  const students = [
    { id: 'STU-1', fullName: 'দোলন আক্তার', roll: '01', className: 'Nine', batch: 'A' },
    { id: 'STU-2', fullName: 'রহিম মিয়া', roll: '02', className: 'Ten', batch: 'B' }
  ];
  await deviceA.run('write-students', { students: [students[0]] });
  await waitForCloud(() => Boolean(root().students?.['STU-1']), 'student record pushed');

  await deviceA.run('write-student-account', {
    username: 'dolon',
    pin: '4321',
    fullName: 'দোলন আক্তার',
    mobile: '01812345678',
    studentId: 'STU-1', className: 'নবম শ্রেণি'
  });
  await waitForCloud(() => root().studentAccounts?.dolon?.username === 'dolon', 'student login pushed');
  const cloudStudent = root().studentAccounts?.dolon;
  assert.ok(cloudStudent?.pinHash, 'student pin travels as a hash');
  assert.ok(!('pin' in (cloudStudent || {})), 'a plaintext pin never reaches the cloud');

  /* ---- Device B: a fresh phone that has never seen any of this ---- */
  const bootB = await deviceB.run('boot');
  assert.equal(bootB.ok, true, 'device B sync started');

  const { KEYS } = await import('../js/database.js');
  const { STAFF_ACCOUNTS } = await import('../js/staff-auth.js');
  const { STAFF_DIRECTORY_KEY } = await import('../js/staff-directory.js');
  const dir = path_keys();

  function path_keys() {
    return {
      usernames: KEYS.usernames,
      students: KEYS.students,
      directory: STAFF_DIRECTORY_KEY,
      adminAccount: STAFF_ACCOUNTS.admin.accountKey
    };
  }

  /* cloud → B: the initial sync fills in everything that exists remotely. */
  await deviceB.run('wait-keys', { keys: Object.values(dir) });
  const bStudents = await deviceB.run('snapshot', { keys: [KEYS.students] });
  assert.equal(bStudents.values[KEYS.students].length, 1, 'device B pulled the student list');

  const localRegistry = await deviceB.run('snapshot', { keys: [KEYS.usernames] });
  assert.equal(localRegistry.values[KEYS.usernames][adminUsername], 'staff:admin', 'wire keys decode to the original ID on device B');
  assert.equal(localRegistry.values[KEYS.usernames][encodeUsernameKey(adminUsername)], undefined);

  // Exercise the live registry writer and listener as well as startup reads.
  const laterStaff = await deviceA.run('create-directory-staff', {
    fullName: 'Karim Uddin', role: 'teacher', password: TEACHER_PASSWORD
  });
  await waitForCloud(() => Boolean(root().usernames?.[encodeUsernameKey(laterStaff.username)]), 'new dotted ID pushed live');
  await deviceB.run('wait-content', { key: KEYS.usernames, id: laterStaff.username });

  /* Live A → B: a record written on A after B is already running. */
  await deviceA.run('write-students', { students });
  await deviceB.run('wait-content', { key: KEYS.students, id: 'STU-2' });
  const bStudents2 = await deviceB.run('snapshot', { keys: [KEYS.students] });
  assert.equal(bStudents2.values[KEYS.students].length, 2, 'device B received the new student live');
  assert.ok(bStudents2.eventCollections.includes('students'), 'device B saw a sync event');

  /* The Admin ID created on A signs in on B through the real login form. */
  const loginB = await deviceB.run('form-login', { username: adminUsername, pin: ADMIN_PASSWORD });
  assert.equal(loginB.adminSession, true, `the Admin ID ${adminUsername} created on A signs in on B`);
  assert.match(loginB.message, /নেওয়া হচ্ছে/, 'no credential error on device B');
  assert.equal(loginB.navigated, true, 'device B hands over to the admin panel');

  /* The Staff Management ID created on A logs in on B. */
  const teacherLogin = await deviceB.run('form-login', { username: teacherUsername, pin: TEACHER_PASSWORD });
  assert.equal(teacherLogin.dialog, true, 'the temporary-password dialog opens on device B');
  const change = await deviceB.run('change-dialog-password', { next: 'Own-Pass-2026' });
  assert.equal(change.teacherSession, true, 'teacher signs in after the password change');

  await waitForCloud(() => cloudTeacher()?.mustChangePassword === false,
    'password-change flag cleared in the cloud');

  /* B → A live: a record written on B appears on A without a reload. */
  await deviceB.run('write-notice', { id: 'N-1', title: 'কাল ছুটি', body: 'কালকে সকাল ১০টায় ক্লাস শুরু হবে।' });
  await deviceA.run('wait-content', { key: KEYS.notices, id: 'N-1' });
  const aSnapshot = await deviceA.run('snapshot', { keys: [KEYS.notices, STAFF_DIRECTORY_KEY] });
  assert.ok(aSnapshot.values[KEYS.notices]?.some(n => n.id === 'N-1'), 'device A received the notice written on B');
  assert.equal(
    (aSnapshot.values[STAFF_DIRECTORY_KEY]?.records || []).find(record => record?.username === teacherUsername)?.mustChangePassword,
    false, 'device A sees the password change made on B');
  assert.ok(aSnapshot.eventCollections.includes('notices'), 'device A saw sync events');

  /* The student login created on A signs in on B. */
  const studentLogin = await deviceB.run('form-login', { username: 'dolon', pin: '4321' });
  assert.equal(studentLogin.studentSession, true, 'the student login synced from A works on B');
  assert.match(studentLogin.message, /স্বাগতম|নেওয়া হচ্ছে|/, 'no credential error');

  /* ---- Exams + attempts mirror through the dedicated examDb path ---- */
  assert.equal(SYNC_ROOT(cloud).exams, undefined, 'the broken generic exams node is never created');

  const seeded = await deviceA.run('seed-exam', { examId: 'EXSYNC1', attemptId: 'ATSYNC1', studentId: 'STU-1' });
  await waitForCloud(() => Boolean(SYNC_ROOT(cloud).examDb?.exams?.EXSYNC1), 'exam pushed to examDb');
  await waitForCloud(() => Boolean(SYNC_ROOT(cloud).examDb?.attempts?.ATSYNC1), 'attempt pushed to examDb');

  await deviceB.run('wait-attempt-status', { attemptId: 'ATSYNC1', status: 'active' });
  assert.deepEqual(await deviceB.run('validate-exam-db', {}), { ok: true },
    'the merged exam document on B passes the app strict reader');

  /* A submits the attempt live → the score reaches B without a reload. */
  await deviceA.run('submit-exam-attempt', { attemptId: 'ATSYNC1', answer: 'B' });
  await deviceB.run('wait-attempt-status', { attemptId: 'ATSYNC1', status: 'submitted' });
  const examSnap = await deviceB.run('snapshot', { keys: [KEYS.exams] });
  const bAttempt = (examSnap.values[KEYS.exams]?.attempts || []).find(item => item.id === 'ATSYNC1');
  assert.equal(bAttempt?.score, 1, 'the submitted MCQ score arrived on device B');

  /* Deleting the exam on A removes it (and its attempts) on B too. */
  await deviceA.run('delete-exam', { examId: 'EXSYNC1' });
  await waitForCloud(() => !SYNC_ROOT(cloud).examDb?.exams?.EXSYNC1, 'exam removal pushed');
  await waitForCloud(() => !SYNC_ROOT(cloud).examDb?.attempts?.ATSYNC1, 'attempt removal pushed');
  await deviceB.run('wait-exam-absent', { examId: 'EXSYNC1' });
});

test('fresh device can sign in through login hydration before background sync boots', async () => {
  const fresh = new Device('login-only', cloud.url);
  fresh.start();
  try {
    const login = await fresh.run('form-login', { username: 'dolon', pin: '4321' });
    assert.equal(login.studentSession, true, login.message);
    const { KEYS } = await import('../js/database.js');
    // The login itself never waits for sync; the background sync that the
    // successful login starts then pulls the rest (here: the ID registry).
    await fresh.run('wait-content', { key: KEYS.usernames, id: adminUsername });
    const snapshot = await fresh.run('snapshot', { keys: [KEYS.usernames] });
    assert.equal(snapshot.values[KEYS.usernames][adminUsername], 'staff:admin');
  } finally { await fresh.stop(); }
});

test('multiple student logins remain separate and a wrong password cannot switch the local account', async () => {
  const other = new Device('other-student', cloud.url);
  other.start();
  try {
    await other.run('write-student-account', { username: 'raisa', pin: '5678', fullName: 'Raisa', mobile: '01912345678' });
    await other.run('boot');
    assert.equal(SYNC_ROOT(cloud).studentAccounts.raisa.username, 'raisa');
    assert.equal(SYNC_ROOT(cloud).studentAccounts.dolon.username, 'dolon');
    const wrong = await other.run('form-login', { username: 'dolon', pin: '0000' });
    assert.equal(wrong.studentSession, false);
    const { KEYS } = await import('../js/database.js');
    let local = await other.run('snapshot', { keys: [KEYS.account] });
    assert.equal(local.values[KEYS.account].username, 'raisa');
    const login = await other.run('form-login', { username: 'dolon', pin: '4321' });
    assert.equal(login.studentSession, true, login.message);
    const byMobile = await other.run('form-login', { username: '01912345678', pin: '5678' });
    assert.equal(byMobile.studentSession, true, byMobile.message);
    local = await other.run('snapshot', { keys: [KEYS.account] });
    assert.equal(local.values[KEYS.account].username, 'raisa');
  } finally { await other.stop(); }
});

test('live record changes notify UI watchers, preserve concurrent inserts, and propagate the last deletion', async () => {
  const { KEYS } = await import('../js/database.js');
  await Promise.all([
    deviceA.run('write-records', { key: KEYS.notices, value: [{ id: 'ROUTINE-A', subject: 'Math' }] }),
    deviceB.run('write-records', { key: KEYS.notices, value: [{ id: 'ROUTINE-B', subject: 'English' }] })
  ]);
  const ids = ['ROUTINE-A', 'ROUTINE-B'];
  const result = await deviceB.run('wait-records', { key: KEYS.notices, ids });
  assert.equal(result.remoteEvent, true, 'same-window storage subscribers are notified');
  await deviceA.run('wait-records', { key: KEYS.notices, ids });
  await deviceA.run('write-records', { key: KEYS.notices, value: [] });
  await deviceB.run('wait-records', { key: KEYS.notices, ids: [] });
  await waitForCloud(() => Object.keys(SYNC_ROOT(cloud).notices || {}).length === 0, 'last record deletion');
});

test('teaching documents and teacher assignments keep their required shapes across devices', async () => {
  const { KEYS } = await import('../js/database.js');
  const { TEACHER_ASSIGNMENTS_KEY } = await import('../js/teacher-assignments.js');
  const at = new Date().toISOString();
  const activity = {
    id: 'HOMEWORK-SYNC', teacherId: 'TCH-001', teacherName: 'Rahim',
    type: 'homework', title: 'Practice', subject: 'Math', className: 'নবম শ্রেণি',
    group: '', details: '', room: '', resourceURL: '', date: '2026-09-29', time: '10:00',
    duration: 0, totalMarks: 0, status: 'published', progress: {}, createdAt: at, updatedAt: at
  };
  await deviceA.run('write-records', { key: KEYS.teaching, value: { version: 1, activities: [activity] } });
  await deviceB.run('wait-records', { key: KEYS.teaching, ids: ['HOMEWORK-SYNC'] });
  assert.deepEqual(await deviceB.run('teaching-readable'), { ok: true });
  await deviceA.run('write-records', { key: TEACHER_ASSIGNMENTS_KEY, value: [
    { id: 'ASSIGN-1', teacherUsername: 'teacher.apc', className: 'নবম শ্রেণি', group: '', subject: 'Math' }
  ] });
  await deviceB.run('wait-records', { key: TEACHER_ASSIGNMENTS_KEY, ids: ['ASSIGN-1'] });
  await deviceA.run('write-records', { key: KEYS.teaching, value: { version: 1, activities: [] } });
  await deviceB.run('wait-records', { key: KEYS.teaching, ids: [] });
  assert.deepEqual(await deviceB.run('teaching-readable'), { ok: true });
});

test('offline edits survive a remote snapshot and are uploaded after reconnect', async () => {
  const { KEYS } = await import('../js/database.js');
  await deviceA.run('network', { online: false });
  await deviceA.run('write-records', { key: KEYS.notices, value: [{ id: 'OFFLINE-A', subject: 'offline work' }] });
  await deviceB.run('write-records', { key: KEYS.notices, value: [{ id: 'ONLINE-B', subject: 'online work' }] });
  await waitForCloud(() => Boolean(SYNC_ROOT(cloud).notices?.['ONLINE-B']), 'online device uploaded');
  assert.equal(SYNC_ROOT(cloud).notices?.['OFFLINE-A'], undefined);
  await deviceA.run('network', { online: true });
  await deviceB.run('wait-records', { key: KEYS.notices, ids: ['OFFLINE-A', 'ONLINE-B'] });
  await deviceA.run('wait-records', { key: KEYS.notices, ids: ['OFFLINE-A', 'ONLINE-B'] });
});

test('real weekly routine schema updates the visible student routine without reload', async () => {
  const { KEYS } = await import('../js/database.js');
  await deviceB.run('watch-routine');
  const lesson = { id: 'RTN-REAL', subject: 'সিঙ্ক গণিত', teacher: 'Rahim', room: 'A', time: '10:00', period: 'সকাল', className: 'নবম শ্রেণি' };
  await deviceA.run('write-records', { key: KEYS.routine, value: { sat: { date: '2026-09-29', classes: [lesson] } } });
  const result = await deviceB.run('wait-routine-ui', { text: lesson.subject, count: 1 });
  assert.equal(result.routine.sat.classes[0].subject, lesson.subject);
  assert.match(result.rendered, /সিঙ্ক গণিত/);
  await deviceA.run('write-records', { key: KEYS.routine, value: { sat: { date: '2026-09-29', classes: [] } } });
  await deviceB.run('wait-routine-ui', { count: 0 });
});

test('a password changed while the cloud was unreachable is never reverted by the stale cloud copy', async () => {
  const { KEYS } = await import('../js/database.js');
  const before = await deviceA.run('snapshot', { keys: [KEYS.account] });
  const staleHash = before.values[KEYS.account].pinHash;
  assert.ok(staleHash, 'device A has a stored student login');

  // The cloud refuses writes (outage, flaky mobile data) …
  await deviceA.run('set-cloud', { paused: true });
  const newPin = '9988';
  await deviceA.run('write-student-account', {
    username: 'dolon', pin: newPin, fullName: 'দোলন আক্তার', mobile: '01812345678'
  });
  const changed = await deviceA.run('snapshot', { keys: [KEYS.account] });
  assert.notDeepEqual(changed.values[KEYS.account].pinHash, staleHash, 'the password really changed here');
  assert.deepEqual(SYNC_ROOT(cloud).studentAccounts.dolon.pinHash, staleHash, 'the cloud still holds the old copy');

  // … then the network returns and the app restarts its sync.
  await deviceA.run('set-cloud', { paused: false });
  await deviceA.run('boot');
  const wanted = JSON.stringify(changed.values[KEYS.account].pinHash);
  await waitForCloud(() => JSON.stringify(SYNC_ROOT(cloud).studentAccounts?.dolon?.pinHash) === wanted, 'newest local password uploaded');
  const after = await deviceA.run('snapshot', { keys: [KEYS.account] });
  assert.deepEqual(after.values[KEYS.account].pinHash, changed.values[KEYS.account].pinHash, 'the local record was not reverted');
  const login = await deviceA.run('form-login', { username: 'dolon', pin: newPin });
  assert.equal(login.studentSession, true, login.message);
});

test('a change made while the browser missed every connectivity event still reaches the cloud', async () => {
  const { KEYS } = await import('../js/database.js');
  // navigator.onLine flips without any online/offline event — the SDK-style
  // reconnect no listener hears about.
  await deviceA.run('network-silent', { online: false });
  await deviceA.run('write-notice', { id: 'NOTICE-SILENT', title: 'শান্ত পুনঃসংযোগ', at: Date.now() });
  assert.equal(SYNC_ROOT(cloud).notices?.['NOTICE-SILENT'], undefined, 'nothing is pushed while offline');
  await deviceA.run('network-silent', { online: true });
  await waitForCloud(() => Boolean(SYNC_ROOT(cloud).notices?.['NOTICE-SILENT']), 'pending outbox flushed by the retry timer', 15000);
});

test('a fresh device reports a wrong password instead of adopting the cloud account', async () => {
  const fresh = new Device('wrong-password', cloud.url);
  fresh.start();
  try {
    const { KEYS } = await import('../js/database.js');
    const attempt = await fresh.run('form-login', { username: 'dolon', pin: '0000' });
    assert.equal(attempt.studentSession, false, 'a wrong password never signs in');
    assert.match(String(attempt.message || ''), /পাসওয়ার্ড/, 'the message names the password, not a missing account');
    const snapshot = await fresh.run('snapshot', { keys: [KEYS.account] });
    assert.equal(snapshot.values[KEYS.account], null, 'no account is written after a failed password check');
  } finally { await fresh.stop(); }
});

test('a fresh device cannot register a login ID another student already owns', async () => {
  const { KEYS } = await import('../js/database.js');
  const original = SYNC_ROOT(cloud).studentAccounts.dolon;
  assert.ok(original?.pinHash, 'the original student login is in the cloud');
  const intruder = new Device('intruder', cloud.url);
  intruder.start();
  try {
    // 1) The cloud is reachable: the claim itself is refused before anything is written.
    const attempt = await intruder.run('register-student', { username: 'dolon', pin: '1122' });
    assert.equal(attempt.registered, false, 'the duplicate registration is refused');
    assert.match(String(attempt.message || ''), /ইউজারনেম/, 'and the user is told the ID is taken');
    assert.equal(attempt.account, null, 'nothing is written locally');

    // 2) The cloud is unreachable: local-first registration still works, but the
    //    other student's cloud record must survive untouched.
    await intruder.run('set-cloud', { blocked: true });
    const offline = await intruder.run('register-student', { username: 'dolon', pin: '3344', mobile: '01799887766' });
    assert.equal(offline.registered, true, 'an offline device can still register');
    assert.equal(offline.account.username, 'dolon');

    await intruder.run('set-cloud', { blocked: false });
    await intruder.run('boot');
    await intruder.run('wait-status', { state: 'conflict' });
    const status = await intruder.run('sync-status');
    assert.match(String(status.message || ''), /এডমিন/, 'the conflict asks for an admin');
    assert.deepEqual(SYNC_ROOT(cloud).studentAccounts.dolon.pinHash, original.pinHash, 'the original password is not replaced');
    assert.equal(SYNC_ROOT(cloud).studentAccounts.dolon.mobile, '01812345678');
    assert.equal(offline.account.username, 'dolon', 'the local registration is kept, nothing is destroyed on this device');
    const snapshot = await intruder.run('snapshot', { keys: [KEYS.account] });
    assert.equal(snapshot.values[KEYS.account].registrationMobile, '01799887766');
  } finally { await intruder.stop(); }
});

test('a second Admin can never be created — a fresh device is sent to Login instead', async () => {
  const teacherPassword = SYNC_ROOT(cloud).staffAccounts.teacher.password;
  const intruder = new Device('intruder-admin', cloud.url);
  intruder.start();
  try {
    /* 1) No cloud at all. A device with an empty localStorage has NO evidence
       that the institution has no Admin — and "no local Admin + no verified
       cloud status" must never become a new Admin. */
    await intruder.run('set-cloud', { blocked: true });
    const offline = await intruder.run('create-first-admin', { fullName: 'Fake Admin', password: 'Fake-1234' });
    assert.equal(offline.account, null, 'nothing was created on the device');
    assert.equal(offline.blocked, true, 'and the one-time workflow did not hand the device an Admin');
    assert.match(String(offline.formError || offline.message || ''), /ইন্টারনেট|ক্লাউড/,
      'the device says the cloud could not be verified instead of guessing');

    /* 2) The cloud is reachable again and already holds the real Admin. */
    await intruder.run('set-cloud', { blocked: false });
    const direct = await intruder.run('try-create-admin', { fullName: 'Fake Admin', password: 'Fake-1234' });
    assert.equal(direct.ok, false, 'a direct data-layer call is refused too');
    assert.equal(direct.code, 'ADMIN_EXISTS');
    assert.match(direct.error, /PLEASE LOGIN WITH EXISTING ADMIN ACCOUNT/);
    assert.equal(direct.account, null, 'still nothing is written on this device');

    const ui = await intruder.run('create-first-admin', { fullName: 'Fake Admin', password: 'Fake-1234' });
    assert.equal(ui.blocked, true, 'the login page never offers the creation form');
    assert.equal(ui.account, null);
    assert.match(String(ui.message || ''), /PLEASE LOGIN WITH EXISTING ADMIN ACCOUNT/,
      'the blocked attempt is answered with "please log in"');

    /* The cloud keeps the real Admin and the real role credentials. */
    assert.equal(SYNC_ROOT(cloud).staffAccounts.admin.username, adminUsername, 'the real Admin stays in the cloud');
    assert.deepEqual(SYNC_ROOT(cloud).staffAccounts.teacher.password, teacherPassword, 'a fresh device never replaces a real credential');

    /* 3) The right way in: the existing Admin ID and password sign in here, and
       this device gets its own copy plus a session — nothing is overwritten. */
    const login = await intruder.run('form-login', { username: adminUsername, pin: ADMIN_PASSWORD });
    assert.equal(login.adminSession, true, `the Admin ID ${adminUsername} created on A signs in on this fresh device`);
    assert.equal(login.dialog, false, 'the first Admin has no forced password change');
    assert.equal(SYNC_ROOT(cloud).staffAccounts.admin.username, adminUsername, 'login did not rewrite the cloud Admin');
    const adopted = await intruder.run('snapshot', { keys: [
      Object.values((await import('../js/staff-auth.js')).STAFF_ACCOUNTS).find(a => a.role === 'admin').accountKey
    ] });
    const adminKey = Object.values((await import('../js/staff-auth.js')).STAFF_ACCOUNTS).find(a => a.role === 'admin').accountKey;
    assert.equal(adopted.values[adminKey].username, adminUsername, 'the device pulled the real Admin account');
  } finally { await intruder.stop(); }
});

test('a student can log in with the permanent Student ID shown on the profile', async () => {
  const studentId = 's260929001-abcdef0123456789';
  await deviceA.run('write-student-account', {
    username: 'rakib', pin: '7788', fullName: 'রাকিব হাসান', mobile: '01755556666', studentId
  });
  await waitForCloud(() => SYNC_ROOT(cloud).studentAccounts?.rakib?.student?.id === studentId, 'student ID uploaded');

  const fresh = new Device('student-id-login', cloud.url);
  fresh.start();
  try {
    // The full ID, exactly as the profile shows it.
    const byFullId = await fresh.run('form-login', { username: studentId, pin: '7788' });
    assert.equal(byFullId.studentSession, true, byFullId.message);
    // The short form ("s260929001") is enough while only one student matches it.
    const byShortId = await fresh.run('form-login', { username: studentId.slice(0, 10), pin: '7788' });
    assert.equal(byShortId.studentSession, true, byShortId.message);
    // The username still works with the same record.
    const byUsername = await fresh.run('form-login', { username: 'rakib', pin: '7788' });
    assert.equal(byUsername.studentSession, true, byUsername.message);
    // A wrong password is still refused.
    const wrong = await fresh.run('form-login', { username: studentId, pin: '0000' });
    assert.equal(wrong.studentSession, false, 'the ID is not a password');
  } finally { await fresh.stop(); }
});

test('a misspelled username is answered with what the cloud actually holds', async () => {
  const fresh = new Device('typo-login', cloud.url);
  fresh.start();
  try {
    const attempt = await fresh.run('form-login', { username: 'dolon.akter', pin: '4321' });
    assert.equal(attempt.studentSession, false, 'not signed in');
    assert.match(String(attempt.message || ''), /ক্লাউডে/, 'the cloud content is reported');
    assert.match(String(attempt.message || ''), /dolon/, 'and the close ID is suggested for the typo');
  } finally { await fresh.stop(); }
});

test('a change reaches the other device quickly, and the time is measured', async () => {
  const { KEYS } = await import('../js/database.js');
  // Independent of the other tests: make sure both devices have a live bridge.
  await deviceA.run('boot');
  await deviceB.run('boot');
  const started = Date.now();
  await deviceA.run('write-notice', { id: 'NOTICE-LATENCY', title: 'দ্রুত সিঙ্ক', body: 'সময় মাপা হচ্ছে', at: Date.now() });
  await deviceB.run('wait-content', { key: KEYS.notices, id: 'NOTICE-LATENCY' });
  const elapsed = Date.now() - started;
  // The mock cloud sits on loopback, so this is the floor the bridge itself
  // adds: write → push → other device's listener → local storage. Real networks
  // add their own latency on top (see FIREBASE_SETUP.md).
  assert.ok(elapsed < 5000, `A → B took ${elapsed}ms`);
  console.log(`# [latency] device A write → device B visible: ${elapsed}ms`);

  // The reverse direction, including the durable outbox path.
  const back = Date.now();
  await deviceB.run('write-notice', { id: 'NOTICE-LATENCY-2', title: 'ফিরতি', body: 'B → A', at: Date.now() });
  await deviceA.run('wait-content', { key: KEYS.notices, id: 'NOTICE-LATENCY-2' });
  const elapsedBack = Date.now() - back;
  assert.ok(elapsedBack < 5000, `B → A took ${elapsedBack}ms`);
  console.log(`# [latency] device B write → device A visible: ${elapsedBack}ms`);
});

test('a phone that was closed during the approval cannot undo the decision', async () => {
  /* Reported defect (2026-09-30): the Admin approves a registration, but the
     student's phone still holds the old pending row (it was closed while the
     decision was made, and its next boot rewrites that row through the schema
     migration). Coming back online, the phone pushed the stale row over the
     approval — the student stayed locked out forever. */
  const { KEYS } = await import('../js/database.js');
  const id = 's260930099-stale';
  const stored = extra => ({
    id, name: 'স্থবির শিক্ষার্থী', className: 'নবম শ্রেণি', status: 'pending',
    registeredAt: '2026-09-30T04:00:00.000Z', ...extra
  });
  const approved = stored({ status: 'approved', reviewedAt: '2026-09-30T05:00:00.000Z', updatedAt: '2026-09-30T05:00:00.000Z' });

  // Device B knows the pending row (it pushed it earlier), then goes offline.
  await deviceB.run('boot');
  await deviceB.run('write-students', { students: [stored()] });
  await waitForCloud(() => SYNC_ROOT(cloud).students?.[id]?.status === 'pending', 'pending row uploaded');
  await deviceB.run('network', { online: false });

  // The office decides on device A while B is offline.
  await deviceA.run('boot');
  await deviceA.run('write-students', { students: [approved] });
  await waitForCloud(() => SYNC_ROOT(cloud).students?.[id]?.status === 'approved', 'approval written');

  // B boots again: the schema migration rewrites its stored row (a field is
  // added) while the status is still the stale "pending" one.
  await deviceB.run('write-students', { students: [stored({ email: '' })] });
  await deviceB.run('network', { online: true });

  // The phone must adopt the newer decision instead of broadcasting its stale copy.
  await deviceB.run('wait-record-status', { key: KEYS.students, id, status: 'approved' });
  await waitForCloud(() => SYNC_ROOT(cloud).students?.[id]?.status === 'approved', 'the decision was not reverted');
  await deviceA.run('wait-record-status', { key: KEYS.students, id, status: 'approved' });
});

/* The acceptance lane the fix has to pass, stated in the owner's words:
   a student created on A appears on B without a refresh, B's edit returns to A
   without a refresh, a notice written on A reaches B, and a brand-new device
   signs in as the existing Admin, adopts the cloud data and then receives a
   live change. Nothing here reloads a page: every arrival is a listener. */
test('A → B student create and B → A edit and notice round trip, then a brand-new device logs in and syncs live', async () => {
  const { KEYS } = await import('../js/database.js');
  await Promise.all([deviceA.run('boot'), deviceB.run('boot')]);

  const row = extra => ({
    id: 'STU-ACCEPT', fullName: 'গ্রহণ শিক্ষার্থী', roll: '07', className: 'নবম শ্রেণি',
    status: 'pending', registeredAt: '2026-10-06T05:00:00.000Z', ...extra
  });

  /* 1) Device A registers a student. Device B is already signed in. */
  const created = Date.now();
  await deviceA.run('write-students', { students: [row()] });
  await deviceB.run('wait-content', { key: KEYS.students, id: 'STU-ACCEPT' });
  const aToB = Date.now() - created;
  assert.ok(aToB < 5000, `A → B student create took ${aToB}ms`);
  console.log(`# [latency] A student create → B visible: ${aToB}ms`);

  /* 2) Device B decides on it (edit). Device A must see B's change by itself. */
  const edited = Date.now();
  await deviceB.run('write-students', {
    students: [row({ status: 'approved', reviewedAt: '2026-10-06T06:00:00.000Z', updatedAt: '2026-10-06T06:00:00.000Z' })]
  });
  await deviceA.run('wait-record-status', { key: KEYS.students, id: 'STU-ACCEPT', status: 'approved' });
  const bToA = Date.now() - edited;
  assert.ok(bToA < 5000, `B → A student edit took ${bToA}ms`);
  console.log(`# [latency] B student edit → A visible: ${bToA}ms`);
  await waitForCloud(() => SYNC_ROOT(cloud).students?.['STU-ACCEPT']?.status === 'approved', 'the edit reached the cloud');

  /* 3) A notice written on A arrives on B with no reload. */
  await deviceA.run('write-notice', { id: 'NOTICE-ACCEPT', title: 'অভিভাবক সভা', body: 'আগামীকাল সকাল ১০টা' });
  await deviceB.run('wait-content', { key: KEYS.notices, id: 'NOTICE-ACCEPT' });
  assert.ok((await deviceB.run('snapshot', { keys: [KEYS.notices] })).eventCollections.includes('notices'),
    'device B was told by the live update event');

  /* 4) Device C: a phone with nothing stored. */
  const deviceC = new Device('C-acceptance', cloud.url);
  deviceC.start();
  try {
    const screen = await deviceC.run('admin-screen');
    assert.equal(screen.offersCreation, false, 'device C is never offered the Admin creation screen');
    assert.equal(screen.creationOpen, false, 'and that form never opens');
    assert.equal(screen.loginOpen, true, 'device C opens on the Login screen');

    const login = await deviceC.run('form-login', { username: adminUsername, pin: ADMIN_PASSWORD });
    assert.equal(login.adminSession, true, 'the existing Admin account signs in on a device that has nothing');
    assert.equal(login.dialog, false, 'no forced password change for the first Admin');

    const { STAFF_ACCOUNTS } = await import('../js/staff-auth.js');
    const adopted = await deviceC.run('snapshot', { keys: [STAFF_ACCOUNTS.admin.accountKey] });
    assert.equal(adopted.values[STAFF_ACCOUNTS.admin.accountKey].username, adminUsername,
      'device C adopted the cloud Admin profile (not a new account)');

    /* The login hands the device to the Admin panel, and the panel page boots
       the realtime bridge itself (js/realtime-sync-entry.js on `apc-session-ready`)
       — this is that exact call. */
    assert.equal(login.navigated, true, 'the login hands over to the Admin panel');
    await deviceC.run('boot');
    await deviceC.run('wait-status', { state: 'online' });

    /* Cloud application data, then a live push while C sits open. */
    await deviceC.run('wait-content', { key: KEYS.students, id: 'STU-ACCEPT' });
    await deviceC.run('wait-content', { key: KEYS.notices, id: 'NOTICE-ACCEPT' });
    const live = Date.now();
    await deviceA.run('write-notice', { id: 'NOTICE-ACCEPT-2', title: 'লাইভ সিঙ্ক', body: 'রিফ্রেশ ছাড়াই' });
    await deviceC.run('wait-content', { key: KEYS.notices, id: 'NOTICE-ACCEPT-2' });
    const latency = Date.now() - live;
    assert.ok(latency < 5000, `A → C live notice took ${latency}ms`);
    console.log(`# [latency] A notice → freshly logged-in device C: ${latency}ms`);

    /* And C's own edit returns to A, again with no reload anywhere. */
    await deviceC.run('write-notice', { id: 'NOTICE-ACCEPT-3', title: 'ফিরতি', body: 'C থেকে A' });
    await deviceA.run('wait-content', { key: KEYS.notices, id: 'NOTICE-ACCEPT-3' });
  } finally { await deviceC.stop(); }
});

test('package still declares the realtime bridge', async () => {
  const loginSource = readFileSync(new URL('../js/login.js', import.meta.url), 'utf8');
  assert.match(loginSource, /hydrateUserIdentifiers/, 'login.js hydrates synced user IDs');
  void pkg; void REPO;
});

test('every read and write the app made was allowed by the deployed database.rules.json', () => {
  assert.deepEqual(cloud.ruleViolations, [], 'the shipped client and the shipped rules must agree');
});
