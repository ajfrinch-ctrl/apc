/* The one-time Admin initialization, end to end through the REAL modules:

     js/admin-initialization.js → sync/sync-core.js → js/realtime-sync.js

   Only the Firebase network boundary is replaced (exactly like
   tests/login-sync-lifecycle.test.mjs does), so the cloud state check, the
   create-only claim transaction, the global initialization marker and the
   credential hydration an untouched phone goes through all run as shipped.

   Acceptance list of the fix:
     1. Device A → create the first Admin → succeeds (local + cloud + marker)
     2. Device A → logout → login → succeeds
     3. Device B → first open → LOGIN, never "Create Admin Account"
     4. Device B → existing Admin credentials → login succeeds
     5. Device C → first open → LOGIN, never "Create Admin Account"
     6. app update / reload / cache refresh → never asks to create the Admin again
     plus: duplicate-claim blocking, unverifiable-cloud failure, and that nothing
     an existing Admin owns is ever rewritten.
*/
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { loadPage } from './jsdom-harness.mjs';
import { STAFF_ACCOUNTS, clearStaffSession, readStaffAccount } from '../js/staff-auth.js';

const DEMO_OFF = { 'activePlus.demo.autofill.v1': 'off' };
const ADMIN_PASSWORD = 'Admin-2026';
const ADMIN_ID = 'rasal.admin.apc';
const STAFF_PATH = 'activePlusSync/v1/staffAccounts/admin';
const FLAG_PATH = 'activePlusSync/v1/system/adminInitialized';

/* ---- the fake Firebase boundary: one in-memory Realtime Database ---------- */

const cloud = {
  values: new Map(),
  transactions: [],
  reads: [],
  writes: [],
  failReads: false,
  auth: { currentUser: null, authStateReady: async () => {} }
};

const snapshot = path => ({
  exists: () => cloud.values.has(path),
  val: () => (cloud.values.has(path) ? cloud.values.get(path) : null)
});

const transport = {
  firebaseApp: {}, appCheckReady: Promise.resolve(),
  getAuth: () => cloud.auth,
  signInAnonymously: async () => { cloud.auth.currentUser = { uid: 'test-device' }; return { user: cloud.auth.currentUser }; },
  signInWithEmailAndPassword: async () => { throw new Error('not used'); },
  updatePassword: async () => {},
  setPersistence: async () => {}, browserLocalPersistence: {},
  getDatabase: () => ({}),
  ref: (_db, path) => String(path),
  get: async path => {
    cloud.reads.push(path);
    if (cloud.failReads) throw Object.assign(new Error('network unreachable'), { code: 'unavailable' });
    return snapshot(path);
  },
  set: async (path, value) => { cloud.writes.push(path); cloud.values.set(path, value); },
  runTransaction: async (path, update) => {
    const next = update(cloud.values.get(path) ?? null);
    // A transaction returning undefined aborts and leaves the value alone.
    if (next === undefined) return { committed: false, snapshot: snapshot(path) };
    cloud.values.set(path, next);
    cloud.transactions.push(path);
    return { committed: true, snapshot: snapshot(path) };
  },
  onValue: () => () => {}
};

let hooks = null;
before(() => {
  globalThis.__apcAdminTestTransport = transport;
  hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('/firebase/firebase-init.js') || url.endsWith('/firebase/firebase-services.js')) {
        return {
          format: 'module', shortCircuit: true,
          source: `export const { ${Object.keys(transport).join(', ')} } = globalThis.__apcAdminTestTransport;`
        };
      }
      return nextLoad(url, context);
    }
  });
});
after(() => { hooks?.deregister?.(); delete globalThis.__apcAdminTestTransport; });

/* ---- one "phone" = one page with its own localStorage -------------------- */

/** Async app work (a cloud pull, a claim, a login) resolves on macrotasks.
    Every page in this file shares one Node process, and the app modules read
    the bare `localStorage` global that jsdom-harness points at the newest
    page — so a flow still in flight when the next device opens would write
    into that next device. Draining the previous device keeps devices apart. */
const settle = async (ticks = 4) => {
  for (let index = 0; index < ticks; index += 1) await new Promise(resolve => setTimeout(resolve, 15));
};

let deviceSeq = 0;

async function openDevice({ seed = {}, onLine = true } = {}) {
  await settle();
  const page = await loadPage('index.html', { seed: { ...DEMO_OFF, ...seed } });
  if (!onLine) Object.defineProperty(page.window.navigator, 'onLine', { configurable: true, value: false });
  // realtime-sync patches Storage.prototype.setItem, exactly as in a browser.
  if (!globalThis.Storage) Object.defineProperty(globalThis, 'Storage', { value: page.window.Storage, configurable: true, writable: true });
  const { initLogin } = await import(`../js/login.js?device=${++deviceSeq}`);
  initLogin({ state: { student: null, account: null }, onAuthenticated: () => {} });
  await settle();
  page.ready = page.waitFor(() => {
    const footnote = page.$('#firstAdminFootnote');
    if (!footnote) return true;
    if (footnote.hidden === false) return true;
    return (page.$('#authMessage')?.textContent || '').length > 0;
  });
  return page;
}

/** Everything a device keeps locally — used to re-open the SAME device after an
    app update / reload (its storage survives, the page is built again). */
function localSnapshot(page) {
  const seed = {};
  const storage = page.window.localStorage;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    seed[key] = storage.getItem(key);
  }
  return seed;
}

const sessionOf = page => page.window.localStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey);
const navigated = (page, from = 0) => page.jsdomErrors.slice(from).some(error => /navigation/i.test(error));

async function submitLogin(page, username, password) {
  const from = page.jsdomErrors.length;   // a previous sign-in already navigated
  page.type(page.$('#loginMobile'), username);
  page.type(page.$('#loginPin'), password);
  page.submit(page.$('#loginForm'));
  await page.waitFor(() => sessionOf(page) !== null || navigated(page, from) || /সঠিক নয়|সংরক্ষিত নেই|যাচাই/.test(page.$('#authMessage')?.textContent || ''), 20000);
  await page.flush();
  await settle();
}

/* ---- 1. Device A creates the institution's Admin ------------------------- */

let deviceA = null;

test('device A: a verified fresh installation creates the one Admin Account', async () => {
  deviceA = await openDevice();
  await deviceA.ready;
  await deviceA.flush();

  // No Admin anywhere: the creation screen is what the login page opens with.
  assert.equal(deviceA.$('#firstAdminPanel') !== null, true);
  assert.equal(deviceA.$('#firstAdminPanel').hidden, false, 'the first-use screen is open');
  assert.equal(deviceA.$('#loginPanel').hidden, true);

  deviceA.type(deviceA.$('#firstAdminName'), 'Rasal Russell Chowdhury');
  deviceA.type(deviceA.$('#firstAdminMobile'), '01711222333');
  deviceA.type(deviceA.$('#firstAdminPassword'), ADMIN_PASSWORD);
  deviceA.type(deviceA.$('#firstAdminConfirm'), ADMIN_PASSWORD);
  deviceA.submit(deviceA.$('#firstAdminForm'));
  await deviceA.waitFor(() => deviceA.$('#firstAdminPanel') === null, 20000);
  await deviceA.waitFor(async () => Boolean(await readStaffAccount('admin')));
  await deviceA.flush();

  const account = await readStaffAccount('admin');
  assert.equal(account.username, ADMIN_ID, 'the generated Login User ID');
  assert.equal(JSON.stringify(account).includes(ADMIN_PASSWORD), false, 'only a hash is stored here');

  // The cloud holds the record and the global marker, from one atomic claim.
  assert.equal(cloud.transactions.filter(path => path === STAFF_PATH).length, 1, 'exactly one claim transaction');
  assert.equal(cloud.values.get(STAFF_PATH)?.username, ADMIN_ID);
  assert.equal(typeof cloud.values.get(STAFF_PATH)?.password, 'object', 'the PBKDF2 hash travels');
  assert.equal(JSON.stringify(cloud.values.get(STAFF_PATH)).includes(ADMIN_PASSWORD), false);
  assert.equal(cloud.values.get(FLAG_PATH), true, 'adminInitialized is set with the account');

  // The one-time workflow is over on this device too.
  assert.equal(deviceA.$('#firstAdminPanel'), null);
  assert.equal(deviceA.$('#openFirstAdmin'), null);
  assert.equal(deviceA.$('#loginMobile').value, ADMIN_ID, 'the new ID is handed to the login form');
});

/* ---- 2. logout → login on the same device -------------------------------- */

test('device A: logout then login with the same credentials succeeds', async () => {
  await submitLogin(deviceA, ADMIN_ID, ADMIN_PASSWORD);
  assert.equal(sessionOf(deviceA) !== null, true, 'device A signs in');
  assert.equal(navigated(deviceA, 0), true, 'and hands over to the Admin panel');

  // The panel's logout clears the session (never the account or any data).
  clearStaffSession('admin');
  assert.equal(sessionOf(deviceA), null, 'the session is gone');
  assert.equal((await readStaffAccount('admin')).username, ADMIN_ID, 'the Admin account itself is untouched');

  await submitLogin(deviceA, ADMIN_ID, ADMIN_PASSWORD);
  assert.equal(sessionOf(deviceA) !== null, true, 'the same credentials sign in again');
  assert.equal(cloud.values.get(STAFF_PATH).username, ADMIN_ID, 'and nothing in the cloud was rewritten');
  assert.equal(cloud.transactions.filter(path => path === STAFF_PATH).length, 1, 'no second claim');
});

/* ---- 3 + 4. Device B: first open shows Login, then signs in -------------- */

test('device B: a first open shows the Login screen — never "Create Admin Account"', async () => {
  const deviceB = await openDevice();
  await deviceB.ready;
  await deviceB.flush();

  // A device may cache the record it was sent by the cloud (that is how the
  // login form knows the role). What it must never have is an account of its
  // own — so any local copy has to be the cloud Admin, field for field.
  const cachedB = deviceB.window.localStorage.getItem(STAFF_ACCOUNTS.admin.accountKey);
  if (cachedB !== null) {
    assert.equal(JSON.parse(cachedB).createdAt, cloud.values.get(STAFF_PATH).createdAt, 'the local copy is the cloud record, not a fresh one');
    assert.equal((await readStaffAccount('admin')).username, ADMIN_ID);
  }
  assert.equal(deviceB.$('#firstAdminPanel'), null, 'the creation screen is not offered');
  assert.equal(deviceB.$('#firstAdminFootnote'), null, 'and neither is its trigger');
  assert.equal(deviceB.$('#loginPanel').hidden, false, 'the login screen is what the device opens');

  // The cloud was asked before that decision — never localStorage alone.
  assert.ok(cloud.reads.includes(STAFF_PATH), 'the Admin record was read from the cloud');
  assert.ok(cloud.reads.includes(FLAG_PATH), 'and so was the initialization marker');

  await submitLogin(deviceB, ADMIN_ID, ADMIN_PASSWORD);
  assert.equal(sessionOf(deviceB) !== null, true, 'the existing Admin credentials sign in on device B');
  assert.equal(navigated(deviceB, 0), true, 'device B opens the Admin panel');
  const pulled = await readStaffAccount('admin');
  assert.equal(pulled.username, ADMIN_ID, 'device B keeps its own copy of the same account');
  assert.equal(cloud.values.get(STAFF_PATH).username, ADMIN_ID, 'the cloud account is unchanged');
  assert.equal(cloud.transactions.filter(path => path === STAFF_PATH).length, 1, 'login never creates anything');
  deviceB.window.close();
});

/* ---- 5. Device C: the same again ----------------------------------------- */

test('device C: a first open shows the Login screen too', async () => {
  const deviceC = await openDevice();
  await deviceC.ready;
  await deviceC.flush();
  const cachedC = deviceC.window.localStorage.getItem(STAFF_ACCOUNTS.admin.accountKey);
  if (cachedC !== null) assert.equal(JSON.parse(cachedC).username, ADMIN_ID, 'only the cloud Admin, never a new one');
  assert.equal(deviceC.$('#firstAdminPanel'), null);
  assert.equal(deviceC.$('#loginPanel').hidden, false);
  deviceC.window.close();
});

/* ---- 6. app update / reload / cache refresh ------------------------------ */

test('an app update on device A never asks to create the Admin again', async () => {
  const preserved = localSnapshot(deviceA);
  assert.ok(preserved[STAFF_ACCOUNTS.admin.accountKey], 'the Admin record is part of what a reload keeps');
  deviceA.window.close();

  // A brand-new page for the SAME device (update, reload, cache refresh): the
  // storage and every record survive, and the workflow must stay gone.
  deviceA = await openDevice({ seed: preserved });
  await deviceA.ready;
  await deviceA.flush();

  assert.equal(deviceA.$('#firstAdminPanel'), null, 'no creation screen after the update');
  assert.equal(deviceA.$('#firstAdminFootnote'), null);
  assert.equal(deviceA.$('#openFirstAdmin'), null);
  assert.equal(deviceA.$('#loginPanel').hidden, false);
  assert.equal((await readStaffAccount('admin')).username, ADMIN_ID, 'the Admin account is still there');
  assert.equal(cloud.values.get(STAFF_PATH).username, ADMIN_ID);
  assert.equal(cloud.transactions.filter(path => path === STAFF_PATH).length, 1, 'and still exactly one claim');

  await submitLogin(deviceA, ADMIN_ID, ADMIN_PASSWORD);
  assert.equal(sessionOf(deviceA) !== null, true, 'login still works after the update');
  deviceA.window.close();
});

/* ---- duplicate creation is blocked by the cloud, not by local state ------ */

test('a second Admin cannot be claimed, even from a device with nothing stored', async () => {
  const { createInitialAdmin } = await import('../js/staff-auth.js');
  const outsider = await openDevice();
  await outsider.ready;
  await outsider.flush();
  const before = cloud.transactions.length;

  const attempt = await createInitialAdmin({
    fullName: 'Second Owner', mobile: '01899887766', email: '',
    password: 'Another-2026', confirmPassword: 'Another-2026'
  });
  assert.equal(attempt.ok, false, 'the direct data-layer call is refused');
  assert.equal(attempt.code, 'ADMIN_EXISTS');
  assert.match(attempt.error, /PLEASE LOGIN WITH EXISTING ADMIN ACCOUNT/);
  assert.equal(await readStaffAccount('admin'), null, 'nothing was written on this device');
  assert.equal(cloud.transactions.length, before, 'and the cloud was never asked to claim');
  assert.equal(cloud.values.get(STAFF_PATH).username, ADMIN_ID, 'the real Admin is untouched');
  outsider.window.close();
});

/* ---- no verified cloud answer: no creation, no writes -------------------- */

test('an offline device and an unreachable cloud both refuse to create an Admin', async () => {
  const { createInitialAdmin } = await import('../js/staff-auth.js');
  const offline = await openDevice({ onLine: false });
  await offline.ready;
  await offline.flush();
  assert.equal(offline.$('#firstAdminPanel').hidden !== false, true, 'the creation screen stays closed');
  assert.match(offline.$('#authMessage').textContent, /ইন্টারনেট/);

  const attempt = await createInitialAdmin({
    fullName: 'Offline Owner', mobile: '01711223344', email: '',
    password: 'Another-2026', confirmPassword: 'Another-2026'
  });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.code, 'CLOUD_UNVERIFIED');
  assert.equal(await readStaffAccount('admin'), null, 'nothing is stored');
  offline.window.close();

  // navigator.onLine lies (captive portal): the failed read is still not a
  // "no Admin" answer, so creation stays closed.
  const flaky = await openDevice();
  await flaky.ready;
  await flaky.flush();
  cloud.failReads = true;
  try {
    const unreachable = await createInitialAdmin({
      fullName: 'Portal Owner', mobile: '01711223344', email: '',
      password: 'Another-2026', confirmPassword: 'Another-2026'
    });
    assert.equal(unreachable.ok, false);
    assert.equal(unreachable.code, 'CLOUD_UNVERIFIED');
  } finally { cloud.failReads = false; }
  assert.equal(await readStaffAccount('admin'), null, 'still nothing is stored');
  flaky.window.close();
});
