import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, SYNCABLE, LOCAL_ONLY, listDocuments, listDocumentsStrict, replaceDocuments, replaceDocumentsStrict, rememberAccount, newId } from '../js/database.js';
import { saveAccount, loadAccount, generateStudentId } from '../js/storage.js';
import { financeRepository, TRANSACTIONS_KEY, stampTransaction } from '../js/finance-data.js';
import { isPasswordRecord } from '../js/password-hash.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { buildSessionRecord } from '../js/session.js';

function setup() {
  const store = new Map();
  const session = new Map();
  const asStorage = map => ({
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key)
  });
  globalThis.window = { localStorage: asStorage(store), sessionStorage: asStorage(session) };
  return store;
}

test('collections keep the existing storage keys and leave secrets off the sync list', () => {
  assert.equal(KEYS.students, 'activePlus.admin.students.v1');
  assert.equal(KEYS.transactions, TRANSACTIONS_KEY);
  assert.equal(KEYS.teaching, 'activePlus.teaching.v1');
  assert.equal(KEYS.exams, 'activePlus.exams.v1');
  assert.equal(SYNCABLE.includes('students'), true);
  assert.equal(SYNCABLE.includes('academics'), true);
  assert.equal(SYNCABLE.includes('courseContent'), true);
  assert.equal(SYNCABLE.includes('questionBank'), false, 'answer-key bank data is not sent through the shared anonymous bridge');
  assert.equal(SYNCABLE.includes('account'), false);
  assert.equal(LOCAL_ONLY.includes('account'), true);
});

test('empty collections stay empty and round-trip without adding fields', () => {
  const store = setup();
  assert.deepEqual(listDocuments('students'), []);
  assert.deepEqual(listDocumentsStrict('transactions', () => true), []);
  replaceDocuments('notices', [{ id: 'NOT-1', title: 'বন্ধ' }]);
  assert.deepEqual(listDocuments('notices'), [{ id: 'NOT-1', title: 'বন্ধ' }]);
  const tx = { id: 'TRX-1', studentId: 'S-1', amount: 500 };
  replaceDocumentsStrict('transactions', [tx]);
  assert.deepEqual(JSON.parse(store.get(KEYS.transactions)), [tx]);
});

test('corrupt ledger is rejected and left untouched', () => {
  const store = setup();
  store.set(KEYS.transactions, 'corrupt-json');
  assert.throws(() => listDocumentsStrict('transactions', () => true));
  assert.equal(store.get(KEYS.transactions), 'corrupt-json');
});

test('account mirror keeps the login password on the device and out of the collection', async () => {
  setup();
  assert.equal(await saveAccount({
    mobile: '01711223344',
    pin: '123123',
    username: 'raisa.islam',
    student: { id: 'S-9', name: 'রাইসা', pin: 'secret', securityAnswer: 'no' }
  }), true);
  const login = loadAccount();
  // The stored record holds a PBKDF2 hash, never the plaintext PIN.
  assert.equal(login.pin, undefined);
  assert.equal(isPasswordRecord(login.pinHash), true);
  const mirrored = JSON.parse(window.localStorage.getItem(KEYS.accounts));
  assert.equal(mirrored['S-9'].username, 'raisa.islam');
  assert.equal(mirrored['S-9'].pin, undefined);
  assert.equal(mirrored['S-9'].pinHash, undefined);
  assert.equal(mirrored['S-9'].student.pin, undefined);
  assert.equal(mirrored['S-9'].student.securityAnswer, undefined);
  assert.equal(rememberAccount({ studentId: 'S-9' }), true);
});

test('new ids do not collide and student ids are not a shared counter alone', () => {
  const first = newId('NOT');
  const second = newId('NOT');
  assert.notEqual(first, second);
  // newId() is prefix + YYMMDD (6 digits) + a 3-digit daily sequence, so two
  // calls retain a readable date/sequence plus a cross-device random suffix.
  assert.match(first, /^NOT\d{9}-[a-f0-9]{16}$/);
  setup();
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  // A student id is 's' + YYMMDD + a 3-digit daily sequence. Every student
  // shares that one sequence, so the ids are unique and carry their date.
  const a = generateStudentId();
  const b = generateStudentId();
  assert.notEqual(a, b);
  assert.match(a, new RegExp(`^s${stamp}\\d{3}-[a-f0-9]{16}$`));
  // The sequence is shared by every student, so the second id must be exactly
  // one step on from the first — not a per-class counter restarting at 1.
  assert.equal(Number(b.split('-')[0].slice(-3)), Number(a.split('-')[0].slice(-3)) + 1);
});

test('stamped payments keep the exact saved fields plus a sortable time', () => {
  const now = new Date('2026-09-23T10:00:00Z');
  const tx = stampTransaction({ id: 'TRX-2', studentId: 'S-1', amount: 100, date: '২৩ সেপ্টেম্বর ২০২৬' }, now);
  assert.equal(tx.recordedAt, now.getTime());
  assert.equal(tx.createdAt, now.toISOString());
  assert.equal(tx.amount, 100);
  setup();
  const payment = STAFF_ACCOUNTS.payment;
  window.localStorage.setItem(payment.accountKey, JSON.stringify({
    role: payment.role, username: payment.username, staffId: 'PAY-TEST-1', status: 'active'
  }));
  window.localStorage.setItem(payment.sessionKey, JSON.stringify(buildSessionRecord({ owner: payment.username, ttlDays: 1 })));
  return financeRepository.saveTransaction(tx).then(saved => {
    assert.deepEqual(saved[0], { ...tx, status: 'pending', reviewHistory: [] });
  });
});
