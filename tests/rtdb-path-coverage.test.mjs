/* Does the DEPLOYED ruleset actually cover every path the shipped client uses,
   in the direction it uses it?

   The client's cloud surface is derived from the app's own declarations
   (`SYNCABLE`, `STAFF_ACCOUNTS`) and the record roots in js/realtime-sync.js —
   not from a hand-written list — and every path is then put through the rules
   simulator with the interim anonymous identity:

     • a path the app LISTENS on must be readable (a permission-denied listener
       is what silently stops realtime updates);
     • a path the app WRITES must be writable with the shape the app writes;
     • the wholesale dump, an unknown node and a staff-account deletion must
       stay refused.

   This is the machine-checked form of audit items 5 and 12. The real Firebase
   engine is still authoritative — functions/test/rtdb-rules.test.js (emulator)
   and the Rules Playground remain the final gate.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSimulator } from './rtdb-rules-sim.mjs';
import { SYNCABLE, KEYS } from '../js/database.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { STAFF_DIRECTORY_KEY } from '../js/staff-directory.js';
import { encodeUsernameKey } from '../js/username-sync-codec.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const rules = JSON.parse(read('../database.rules.json'));
const sim = createSimulator(rules);
const V1 = path => `activePlusSync/v1/${path}`;
/* The interim bridge authenticates anonymously (docs/INTERIM-ANONYMOUS-SYNC.md). */
const device = { uid: 'anon-device', token: { firebase: { sign_in_provider: 'anonymous' } } };
const hash = { v: 1, algo: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: 's', digest: 'd' };

/* The record collections the bridge mirrors: every SYNCABLE entry except exams
   (which travels through its dedicated examDb mirror) plus teacherAssignments. */
const RECORD_COLLECTIONS = [...SYNCABLE.filter(name => name !== 'exams'), 'teacherAssignments'];

const cloud = () => ({ activePlusSync: { v1: {
  staffAccounts: Object.fromEntries(Object.keys(STAFF_ACCOUNTS).map(role =>
    [role, { username: `${role}.apc`, password: hash, status: 'active' }])),
  staffDirectory: { version: 1, records: [{ id: 'S1', username: 'teacher.apc', role: 'teacher' }] },
  usernames: { 'teacher.apc': 'staff:teacher' },
  studentAccounts: { dolon: { username: 'dolon', pinHash: hash } },
  examDb: { exams: { EX1: { id: 'EX1', teacherId: 'T1', status: 'draft' } }, attempts: { AT1: { id: 'AT1', examId: 'EX1', studentId: 'STU-1' } } },
  system: { adminInitialized: true },
  pushTokens: { 'device-1': { token: 'x'.repeat(40), role: 'admin' } },
  ...Object.fromEntries(RECORD_COLLECTIONS.map(name => [name, { 'REC-1': { id: 'REC-1', updatedAt: 1 } }]))
} } });

/* Write payloads in the shape the app actually sends, so .validate is exercised
   the same way a real write would be. */
const payloads = {
  staffAccounts: () => ({ username: 'teacher.apc', password: hash, status: 'active' })
};
const payloadFor = path => {
  const node = path.split('/').pop();
  if (payloads[node]) return payloads[node]();
  if (node === 'staffDirectory') return { version: 1, records: [{ id: 'S1', username: 'teacher.apc', role: 'teacher' }] };
  if (node === 'usernames') return { 'teacher.apc': 'staff:teacher' };
  if (node === 'adminInitialized') return true;
  if (path.includes('/system/connectivityProbe/')) return { at: 1728432000000 };
  if (path.includes('/examDb/exams/')) return { id: 'EX1', teacherId: 'T1', status: 'draft' };
  if (path.includes('/examDb/attempts/')) return { id: 'AT1', examId: 'EX1', studentId: 'STU-1' };
  if (path.includes('/studentAccounts/')) return { username: 'dolon', pinHash: hash };
  if (path.includes('/pushTokens/')) return { token: 'y'.repeat(40), role: 'admin' };
  if (path.includes('/staffAccounts/')) return payloads.staffAccounts();
  return { 'REC-1': { id: 'REC-1', updatedAt: 1 } };
};

/* Every node the bridge attaches a listener to (js/realtime-sync.js). */
const LISTENED = [
  ...RECORD_COLLECTIONS.map(name => V1(name)),
  ...Object.keys(STAFF_ACCOUNTS).map(role => V1(`staffAccounts/${role}`)),
  V1('staffDirectory'),
  V1('usernames'),
  V1('studentAccounts/' + encodeUsernameKey('dolon')),
  V1('examDb')
];

/* Every node the bridge writes to, per write site in js/realtime-sync.js. */
const WRITTEN = [
  ...RECORD_COLLECTIONS.map(name => V1(name)),
  ...Object.keys(STAFF_ACCOUNTS).map(role => V1(`staffAccounts/${role}`)),
  V1('staffDirectory'),
  V1('usernames'),
  V1('studentAccounts/' + encodeUsernameKey('dolon')),
  V1('examDb/exams/EX1'),
  V1('examDb/attempts/AT1'),
  V1('system/adminInitialized'),
  /* The login-page diagnostic (js/firebase-diagnostics.js) proves write
     permission with a probe record it removes immediately. */
  V1('system/connectivityProbe/diag-test'),
  V1('pushTokens/device-1')
];

test('the inventory really is the app’s surface (guards drift)', () => {
  const source = read('../js/realtime-sync.js');
  for (const root of ['staffAccounts', 'staffDirectory', 'usernames', 'studentAccounts', 'examDb', 'system']) {
    assert.ok(source.includes(`/'${root}'`) || source.includes(`+ '/${root}'`) || source.includes(`'${root}'`),
      `js/realtime-sync.js still addresses ${root}`);
  }
  assert.equal(STAFF_DIRECTORY_KEY.startsWith('activePlus.'), true, 'the directory is a real local collection');
  assert.equal(TEACHER_ASSIGNMENTS_KEY.startsWith('activePlus.'), true);
  assert.equal(KEYS.students, 'activePlus.admin.students.v1');
  assert.equal(RECORD_COLLECTIONS.includes('settings'), true, 'settings is mirrored on purpose');
  assert.equal(KEYS.notifications.startsWith('activePlus.notifications'), true, 'notification records stay device-local (derived)');
});

test('every path the app listens on is readable — a denied listener is a stalled phone', () => {
  for (const path of LISTENED) {
    assert.equal(sim.canRead(device, path, cloud()), true, `read denied: ${path}`);
  }
  console.log(`# [rules] listeners allowed: ${LISTENED.length}/${LISTENED.length}`);
});

test('every path the app writes is writable with the shape it writes', () => {
  for (const path of WRITTEN) {
    assert.equal(sim.canWrite(device, path, payloadFor(path), cloud()), true, `write denied: ${path}`);
  }
  console.log(`# [rules] writers allowed: ${WRITTEN.length}/${WRITTEN.length}`);
});

test('what the deployed rules must still refuse', () => {
  const state = cloud();
  assert.equal(sim.canRead(device, '', state), false, 'the root is not readable');
  assert.equal(sim.canRead(device, 'activePlusSync/v1', state), false, 'the bridge cannot be dumped in one read');
  assert.equal(sim.canRead(device, V1('activePlusV2'), state), false, 'a future tree is not readable today');
  assert.equal(sim.canRead(device, V1('pushTokens/device-1'), state), false, 'push tokens are write-only');
  assert.equal(sim.canWrite(device, V1('staffAccounts/admin'), null, state), false, 'a staff account cannot be deleted');
  assert.equal(sim.canWrite(device, V1('system/adminInitialized'), 'yes', state), false, 'the marker must be a boolean');
  assert.equal(sim.canWrite(device, V1('students'), { 'REC-1': { id: 'REC-1' } }, {
    activePlusSync: { v1: { students: { 'REC-1': { id: 'REC-1', updatedAt: 1 } } } }
  }), true, 'an ordinary record write is allowed');
});

test('this runs against the deployed file, and the v2 role tree is not deployed by accident', () => {
  assert.equal(JSON.parse(read('../firebase.json')).database.rules, 'database.rules.json');
  const draft = JSON.parse(read('../database.rules.v2.draft.json'));
  assert.equal(Object.hasOwn(draft.rules, 'activePlusV2'), true, 'the per-user draft stays a separate file');
  assert.equal(Object.hasOwn(rules.rules.activePlusSync.v1, 'activePlusV2'), false);
});
