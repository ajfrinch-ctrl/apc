import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations, migrateStudentRecord, CURRENT_DATA_VERSION, DATA_VERSION_KEY } from '../js/storage/migration.js';
import { KEYS } from '../js/database.js';
import { STAFF_ACCOUNTS, createInitialAdmin, readStaffAccount, authenticateStaff } from '../js/staff-auth.js';
import { clearSession, loadAccount, saveAccount, loadAppConfig, saveAppConfig } from '../js/storage.js';
import { createAdminCloud, installAdminCloud, removeAdminCloud, setOnline } from './admin-init-cloud.mjs';

/* The institution's first Admin is claimed in the cloud, so this suite installs
   a fake cloud boundary and reports an online device (tests/admin-init-cloud.mjs). */
let adminHooks = null;
before(() => {
  setOnline(true);
  adminHooks = installAdminCloud(createAdminCloud());
});
after(() => removeAdminCloud(adminHooks));

function setupStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  globalThis.window = {
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
      get length() { return store.size; },
      key: index => Array.from(store.keys())[index]
    },
    sessionStorage: {
      getItem: key => null,
      setItem: () => {},
      removeItem: () => {}
    }
  };
  return store;
}

test('RULE 1 & 10: Local data survives update/re-run; never resets existing admin or users', async () => {
  const store = setupStorage();
  
  // 1. Create first admin
  const adminRes = await createInitialAdmin({
    fullName: 'Rahim Admin',
    mobile: '01711223344',
    email: 'rahim@example.com',
    password: 'Password123',
    confirmPassword: 'Password123'
  });
  assert.equal(adminRes.ok, true);
  assert.equal(adminRes.account.username, 'rahim.admin.apc');
  
  // 2. Simulate app update / migration
  runMigrations();
  
  // 3. Admin account still exists and credentials verify
  const adminAccount = await readStaffAccount('admin');
  assert.ok(adminAccount);
  assert.equal(adminAccount.username, 'rahim.admin.apc');
  assert.equal(adminAccount.fullName, 'Rahim Admin');
  
  const auth = await authenticateStaff('admin', 'rahim.admin.apc', 'Password123');
  assert.equal(auth.ok, true);
});

test('RULE 6: Safe migration preserves existing records and fills missing fields', () => {
  const oldStudent = {
    id: 'STD-101',
    name: 'Rahim',
    mobile: '01711223344'
  };
  
  const migrated = migrateStudentRecord(oldStudent);
  assert.equal(migrated.id, 'STD-101');
  assert.equal(migrated.name, 'Rahim');
  assert.equal(migrated.mobile, '01711223344');
  assert.equal(migrated.email, '');
  assert.equal(migrated.status, 'pending');
  
  const store = setupStorage({
    [KEYS.students]: JSON.stringify([oldStudent])
  });
  
  runMigrations();
  
  const updatedList = JSON.parse(store.get(KEYS.students));
  assert.equal(updatedList.length, 1);
  assert.equal(updatedList[0].id, 'STD-101');
  assert.equal(updatedList[0].name, 'Rahim');
  assert.equal(updatedList[0].email, '');
  assert.equal(store.get(DATA_VERSION_KEY), String(CURRENT_DATA_VERSION));
});

test('RULE 9: Logout clears session only; user accounts and data are never deleted', async () => {
  const store = setupStorage();
  
  await saveAccount({
    username: 'test.student',
    mobile: '01811223344',
    pin: '123123',
    student: { id: 'STU-001', name: 'Test Student' }
  });
  
  assert.ok(loadAccount());
  
  // Logout
  clearSession();
  
  // Account and student data still fully preserved
  const preserved = loadAccount();
  assert.ok(preserved);
  assert.equal(preserved.username, 'test.student');
});


test('a schema-complete student row is left untouched by the boot migration', () => {
  /* The roster syncs record-by-record. Rewriting a row that needs no change
     looks like a fresh local edit to the cloud bridge, and a phone that was
     closed while the office approved a registration would then push its stale
     "pending" copy back over the approval. */
  const row = {
    id: 's260930001-abcd', name: 'রহিম', nameEn: 'Rahim', fatherName: 'পিতা',
    className: 'নবম শ্রেণি', group: 'বিজ্ঞান', mobile: '01711223344',
    guardianMobile: '01811223344', address: 'ঢাকা', email: '', status: 'approved',
    attendance: 0, average: 0, monthlyFee: null, enrolledAt: '৩০/৯/২০২৬',
    lastActive: 'এই ডিভাইস', registeredAt: '2026-09-30T04:00:00.000Z',
    reviewedAt: '2026-09-30T05:00:00.000Z'
  };
  const same = migrateStudentRecord(row);
  assert.equal(same, row, 'the very same object comes back');
  assert.equal(same.status, 'approved');

  const store = setupStorage({ [KEYS.students]: JSON.stringify([row]) });
  runMigrations();
  assert.deepEqual(JSON.parse(store.get(KEYS.students)), [row], 'nothing was rewritten');
});

test('a legacy student row is still filled in, keeping the real status', () => {
  const legacy = { id: 'STD-9', name: 'পুরাতন', mobile: '01711223344', status: 'approved' };
  const migrated = migrateStudentRecord(legacy);
  assert.notEqual(migrated, legacy, 'a record that gained fields is rebuilt');
  assert.equal(migrated.status, 'approved', 'the office decision is preserved');
  assert.equal(migrated.email, '');
  assert.equal(migrated.guardianMobile, '');
});
