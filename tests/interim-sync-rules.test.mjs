/* INTERIM anonymous sync bridge (owner decision 2026-09-30,
   docs/INTERIM-ANONYMOUS-SYNC.md). Replaces the deny-all containment tests.

   1. The deployed database.rules.json is exactly what its generator emits.
   2. The rules expose only the nodes the app uses and refuse the destructive
      writes they can refuse (checked with the local rules simulator; the real
      engine must still be spot-checked in the Rules Playground).
   3. Local login never depends on the cloud: with every Firebase call failing
      (CDN blocked, captive portal, rules refused), saved accounts still sign
      in and unknown ones are refused without hanging the form. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { renderInterim } from '../tools/rtdb-rules/build-interim-rules.mjs';
import { createSimulator } from './rtdb-rules-sim.mjs';
import { loadPage } from './jsdom-harness.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const rules = JSON.parse(read('../database.rules.json'));
const sim = createSimulator(rules);
const anon = { uid: 'anon-device', token: { firebase: { sign_in_provider: 'anonymous' } } };
const V1 = path => `activePlusSync/v1/${path}`;
const hash = { hash: 'h', salt: 's', iterations: 600000 };
const cloud = () => ({ activePlusSync: { v1: {
  staffAccounts: { admin: { username: 'rasal.admin.apc', password: hash } },
  studentAccounts: { dolon: { username: 'dolon', pinHash: hash } },
  usernames: { dolon: 's260930001-aaaa' },
  staffDirectory: { version: 1, records: [{ id: 'A1' }] },
  students: { 'STU-1': { id: 'STU-1' } },
  pushTokens: { dev1: { token: 'x'.repeat(40) } }
} } });

test('deployed rules = generator output, and firebase.json deploys them', () => {
  assert.equal(read('../database.rules.json'), renderInterim(), 'run: node tools/rtdb-rules/build-interim-rules.mjs');
  assert.equal(JSON.parse(read('../firebase.json')).database.rules, 'database.rules.json');
  assert.equal(rules.rules['.read'], false);
  assert.equal(rules.rules['.write'], false);
});

test('signed-out clients get nothing', () => {
  for (const path of ['', 'activePlusSync', V1(''), V1('staffAccounts'), V1('students'), V1('settings')]) {
    assert.equal(sim.canRead(null, path, cloud()), false, `read ${path}`);
  }
  assert.equal(sim.canWrite(null, V1('students'), { X: { id: 'X' } }, cloud()), false);
});

test('the app nodes work for the signed-in device', () => {
  for (const path of ['staffAccounts', 'staffDirectory', 'usernames', 'studentAccount', 'studentAccounts',
    'studentAccounts/dolon', 'examDb', 'settings', 'students', 'transactions', 'notices', 'routine', 'teaching', 'teacherAssignments']) {
    assert.equal(sim.canRead(anon, V1(path), cloud()), true, `read ${path}`);
  }
  const ok = (path, value) => assert.equal(sim.canWrite(anon, V1(path), value, cloud()), true, `write ${path}`);
  ok('staffAccounts/admin', { username: 'rasal.admin.apc', password: hash, updatedAt: 'now' });
  ok('staffAccounts/teacher', { username: 't.teacher.apc', password: hash });
  ok('staffDirectory', { version: 1, records: [{ id: 'A1' }, { id: 'T1' }], updatedAt: 'now' });
  ok('usernames', { dolon: 's260930001-aaaa', raisa: 's260930002-bbbb' });
  ok('studentAccounts/raisa', { username: 'raisa', pinHash: hash });
  ok('students', { 'STU-1': { id: 'STU-1' }, 'STU-2': { id: 'STU-2' } });
  ok('notices', null); // the last record deleted
  ok('settings', { broadcast: 'কাল ছুটি', allowTeacherRegistration: true });
  ok('examDb/exams/E1', { id: 'E1', teacherId: 'T1', status: 'draft', participants: ['S1'] });
  ok('examDb/exams/E1', null);
  ok('examDb/exams', null); // factory reset clears the whole exam group
  ok('examDb/attempts', null);
  ok('examDb/attempts/A1', { id: 'A1', examId: 'E1', studentId: 'S1', status: 'active' });
  ok('pushTokens/dev2', { token: 'y'.repeat(40), role: 'student' });
  ok('pushTokens/dev1', null);
  // Factory reset (docs/FACTORY-RESET.md): every node the reset clears.
  ok('staffAccounts/admin', null);
  ok('staffAccounts/manager', null);
  ok('staffAccounts/teacher', null);
  ok('staffAccounts/payment', null);
  ok('staffDirectory', null);
  ok('usernames', null);
  ok('studentAccounts/dolon', null);
  ok('system/adminInitialized', null);
  ok('system/adminInitialized', false);
  // Diagnostic probe (js/firebase-diagnostics.js): write {at}, then delete it.
  ok('system/connectivityProbe/diag-abc123', { at: 1728432000000 });
  ok('system/connectivityProbe/diag-abc123', null);
});

test('the connectivity probe accepts only {at:number} and refuses free storage', () => {
  const probe = key => `activePlusSync/v1/system/connectivityProbe/${key}`;
  const ok = (path, value) => assert.equal(sim.canWrite(anon, path, value, cloud()), true, `write ${path}`);
  const no = (path, value) => assert.equal(sim.canWrite(anon, path, value, cloud()), false, `write ${path}`);
  ok(probe('diag-x1'), { at: Date.now() });
  assert.equal(sim.canRead(anon, probe('diag-x1'), cloud()), true, 'probe node readable like the rest of system');
  no(probe('diag-x2'), { at: 'not-a-number' }, 'at must be a number');
  no(probe('diag-x3'), { at: 1, token: 'x'.repeat(40) }, 'no extra children: the probe node is not free storage');
  no(probe('diag-x4'), { garbage: true }, 'at is required');
  no(`${probe('diag-x5')}/at`, 'text', 'the child guard refuses non-numeric at');
  no(probe('x'.repeat(80)), { at: 1 }, 'probe keys stay short');
  no(V1('system/connectivityProbe'), { a: 1 }, 'the whole probe node cannot be replaced at once');
});

test('what the interim rules refuse even for a signed-in device', () => {
  const no = (path, value, why) => assert.equal(sim.canWrite(anon, path, value, cloud()), false, why);
  assert.equal(sim.canRead(anon, '', cloud()), false, 'root is not readable');
  assert.equal(sim.canRead(anon, V1(''), cloud()), false, 'the whole bridge cannot be dumped in one read');
  assert.equal(sim.canRead(anon, V1('pushTokens'), cloud()), false, 'push tokens are write-only');
  assert.equal(sim.canRead(anon, V1('unknownNode'), cloud()), false);
  no('', null, 'no root wipe');
  no('activePlusSync', null, 'no bridge wipe');
  no(V1(''), {}, 'no v1 replace');
  no(V1(''), null, 'no v1 wipe — the factory reset deletes node by node');
  no(V1('unknownNode'), { a: 1 }, 'no free storage outside the app nodes');
  no('somethingElse/x', { a: 1 }, 'nothing outside activePlusSync');
  no(V1('staffAccounts'), null, 'the staffAccounts parent cannot be wiped in one write');
  no(V1('studentAccounts'), null, 'the studentAccounts parent cannot be wiped in one write');
  no(V1('staffAccounts/hacker'), { username: 'x', password: hash }, 'only the four staff roles');
  no(V1('staffAccounts/hacker'), null, 'unknown roles cannot be written or deleted');
  no(V1('staffAccounts/admin'), { username: 'x' }, 'a role account needs a password hash');
  no(V1('studentAccounts/dolon'), { username: 'dolon', pin: '1234' }, 'plaintext-only record refused');
  no(V1('studentAccount'), { username: 'x' }, 'legacy node is read-only');
  no(V1('studentAccount'), null, 'legacy node is read-only even for deletes');
  no(V1('system/adminInitialized'), 'yes', 'the marker must stay a boolean');
  no(V1('students/STU-9'), 'junk', 'records are objects');
  no(V1('examDb/exams/E2'), { id: 'OTHER', teacherId: 'T', status: 'draft' }, 'exam id must match its key');
  no(V1('pushTokens/dev3'), { token: 'short' }, 'token shape checked');
});

test('local login never depends on the cloud (every Firebase call fails)', async t => {
  const ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  globalThis.Storage = ctx.window.Storage;
  const unreachable = () => { throw Object.assign(new Error('network unreachable'), { code: 'unavailable' }); };
  globalThis.__deadCloud = {
    firebaseApp: {}, appCheckReady: Promise.resolve(), getAuth: unreachable,
    signInAnonymously: unreachable, signInWithEmailAndPassword: unreachable, updatePassword: unreachable,
    setPersistence: unreachable, browserLocalPersistence: {}, getDatabase: unreachable, ref: unreachable,
    get: unreachable, set: unreachable, runTransaction: unreachable, onValue: unreachable,
    getFirestore: unreachable, doc: unreachable, getDoc: unreachable, getFunctions: unreachable, httpsCallable: unreachable
  };
  const hooks = registerHooks({ load(url, context, nextLoad) {
    if (url.endsWith('/firebase/firebase-init.js') || url.endsWith('/firebase/firebase-services.js')) {
      return { format: 'module', shortCircuit: true,
        source: `export const { ${Object.keys(globalThis.__deadCloud).join(', ')} } = globalThis.__deadCloud;` };
    }
    return nextLoad(url, context);
  } });
  t.after(() => { hooks.deregister(); ctx.window.close(); delete globalThis.__deadCloud; });

  const storage = await import('../js/storage.js');
  const { initLogin } = await import('../js/login.js');
  let admitted = 0;
  initLogin({ state: { account: null, student: {} }, onAuthenticated: () => { admitted++; } });

  ctx.type(ctx.$('#loginMobile'), 'unknown.student');
  ctx.type(ctx.$('#loginPin'), '123456');
  ctx.submit(ctx.$('#loginForm'));
  await ctx.waitFor(() => ctx.$('#loginForm').getAttribute('aria-busy') !== 'true', 15000);
  assert.equal(admitted, 0, 'an unknown account is not admitted');
  assert.equal(await storage.hasSession(), false);

  await storage.persistAccount({ username: 'local.student', mobile: '01712345678', pin: '123456',
    status: 'active', student: { id: 'LOCAL-1', name: 'Student' } });
  ctx.$('#loginMobile').value = '';
  ctx.type(ctx.$('#loginMobile'), 'local.student');
  ctx.submit(ctx.$('#loginForm'));
  await ctx.waitFor(() => admitted === 1, 15000);
  assert.equal(await storage.hasSession(), true, 'saved credentials sign in with the cloud unreachable');
});
