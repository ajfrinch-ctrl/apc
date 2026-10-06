import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';
import { encodeUsernameKey } from '../js/username-sync-codec.js';

// Real login, session storage, sync entry and implementation; only Firebase's
// network boundary is mocked. No production module is copied or rewritten.
/* The login page's startup workflow asks the CLOUD whether the institution has
   an Admin (APP START → cloud Admin check → Login or first-use form). Those two
   nodes are the only Firebase reads allowed before a submit; no staff, student
   or application collection may be touched. */
const ADMIN_GATE_PATHS = new Set([
  'activePlusSync/v1/staffAccounts/admin',
  'activePlusSync/v1/system/adminInitialized'
]);
const isAdminGatePath = path => ADMIN_GATE_PATHS.has(path);

test('login waits for submit and credentials; sync starts with a session and stops on logout', async t => {
  const ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  globalThis.Storage = ctx.window.Storage;
  const values = new Map();
  const listeners = new Set();
  const reads = [];
  const writes = [];
  let authentications = 0;
  let readGate = null;
  const snapshot = path => ({ exists: () => values.has(path), val: () => values.get(path) ?? null });
  const auth = { currentUser: null, authStateReady: async () => {} };
  const transport = {
    firebaseApp: {}, appCheckReady: Promise.resolve(),
    getAuth: () => auth,
    signInAnonymously: async () => { authentications++; auth.currentUser = { uid: 'test' }; },
    setPersistence: async () => {}, browserLocalPersistence: {},
    getDatabase: () => ({}), ref: (_, path) => path,
    get: async path => { reads.push(path); if (readGate) await readGate; return snapshot(path); },
    set: async (path, value) => { writes.push(path); values.set(path, value); },
    runTransaction: async (path, update) => {
      const next = update(values.get(path) ?? null);
      if (next !== undefined) { writes.push(path); values.set(path, next); }
      return { snapshot: snapshot(path), committed: next !== undefined };
    },
    onValue: (path, callback) => {
      const listener = { path, callback, stopped: false };
      listeners.add(listener);
      return () => { listener.stopped = true; listeners.delete(listener); };
    }
  };
  globalThis.__sessionTestTransport = transport;
  const hooks = registerHooks({
    load(url, context, nextLoad) {
    // Test-only opt-in: production ships a hard disabled policy and deny-all rules.
    if (url.endsWith('/sync/cloud-access.js')) {
      const original = nextLoad(url, context);
      return { ...original, source: String(original.source).replace('LEGACY_CLOUD_ENABLED = false', 'LEGACY_CLOUD_ENABLED = true') };
    }
      if (url.endsWith('/firebase/firebase-init.js') || url.endsWith('/firebase/firebase-services.js')) {
        return { format: 'module', shortCircuit: true, source:
          `export const { ${Object.keys(transport).join(', ')} } = globalThis.__sessionTestTransport;` };
      }
      return nextLoad(url, context);
    }
  });
  t.after(() => { hooks.deregister(); ctx.window.close(); delete globalThis.__sessionTestTransport; });
  const storage = await import('../js/storage.js');
  const { initLogin } = await import('../js/login.js');
  let admitted = 0;
  initLogin({ state: { account: null, student: {} }, onAuthenticated: () => { admitted++; } });
  // Import after DOMContentLoaded: catches declaration-order regressions too.
  await import('../js/realtime-sync-entry.js');
  ctx.type(ctx.$('#loginMobile'), 'cloud.student');
  ctx.type(ctx.$('#loginPin'), '123456');
  ctx.window.dispatchEvent(new ctx.window.Event('online'));
  ctx.window.dispatchEvent(new ctx.window.Event('apc-sync-retry'));
  await new Promise(resolve => setTimeout(resolve, 350));
  // The Admin-initialization gate is the ONE cloud step the required startup
  // workflow needs (APP START → cloud Admin check → Login / first-use form):
  // one anonymous transport identity plus the gate's read-only lookups.
  assert.equal(authentications, 1, 'only the Admin gate authenticated the transport');
  const nonGateReads = reads.filter(path => !isAdminGatePath(path));
  assert.deepEqual(nonGateReads, [], 'opening/typing/retrying on login must only read the Admin gate');
  assert.ok(reads.length > 0, 'the Admin gate really asked the cloud — never localStorage alone');
  assert.deepEqual(writes, [], 'the startup gate never writes');
  assert.equal(admitted, 0);
  // No standing sync message: the topbar's own top border is the only
  // indicator (js/topbar-connectivity.js), and the login screen has no topbar.
  assert.equal(ctx.$('#cloudSyncStatus'), null, 'the login screen must not paint a sync banner');
  assert.equal(ctx.$('.topbar-sync-chip'), null, 'the sync chip is gone');

  const remote = await storage.persistAccount({ username: 'cloud.student', mobile: '01712345678',
    pin: '123456', status: 'active', student: { id: 'SYNC-GATE', name: 'শিক্ষার্থী' } });
  ctx.window.localStorage.removeItem(KEYS.account);
  values.set('activePlusSync/v1/studentAccounts/' + encodeUsernameKey('cloud.student'), remote);
  const submit = async password => {
    ctx.type(ctx.$('#loginPin'), password);
    ctx.submit(ctx.$('#loginForm'));
    await ctx.waitFor(() => ctx.$('#loginForm').getAttribute('aria-busy') !== 'true');
  };
  await submit('000000');
  assert.equal(admitted, 0);
  assert.equal(await storage.hasSession(), false);
  assert.equal(storage.loadAccount(), null, 'wrong password must not adopt the cloud account');
  assert.equal(authentications, 1, 'cloud transport authenticates only after submit');
  assert.equal(reads.filter(path => !isAdminGatePath(path)).length, 1, 'wrong cloud password does not hydrate unrelated staff records');
  assert.deepEqual(writes, []);

  const sync = await import('../js/realtime-sync.js');
  assert.equal((await sync.startRealtimeSync()).reason, 'authentication-required');
  assert.equal(listeners.size, 0);
  // Missing fixed-role accounts can be read from another device without any
  // full-sync writes or credential-less provisioning.
  const { hashPassword } = await import('../js/password-hash.js');
  const { authenticateStaff } = await import('../js/staff-auth.js');
  values.set('activePlusSync/v1/staffAccounts/teacher', {
    username: 'cloud.teacher.apc', password: await hashPassword('Teacher-2026'), status: 'active'
  });
  assert.equal((await sync.hydrateStaffAccounts()).ok, true);
  assert.equal((await authenticateStaff('teacher', 'cloud.teacher.apc', 'wrong')).ok, false);
  assert.equal((await authenticateStaff('teacher', 'cloud.teacher.apc', 'Teacher-2026')).ok, true);
  assert.deepEqual(writes, [], 'staff credential hydration is read-only too');
  await submit('123456');
  assert.equal(admitted, 1);
  assert.equal(await storage.hasSession(), true);
  assert.equal((await sync.startRealtimeSync()).ok, true);
  assert.ok(listeners.size > 0);

  const stale = [...listeners];
  storage.clearSession();
  ctx.window.dispatchEvent(new ctx.window.Event('apc-session-ended'));
  assert.equal(listeners.size, 0, 'logout unsubscribes every realtime listener');
  assert.ok(stale.every(listener => listener.stopped));
  const before = { reads: reads.length, writes: writes.length };
  ctx.window.localStorage.setItem(KEYS.students, '[]');
  ctx.window.dispatchEvent(new ctx.window.Event('online'));
  // A queued callback already delivered by Firebase is also ignored.
  stale.forEach(listener => listener.callback({ exists: () => false, val: () => null }));
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal((await sync.startRealtimeSync()).reason, 'authentication-required');
  assert.deepEqual({ reads: reads.length, writes: writes.length }, before);

  // Logging out during startup must not install listeners after late reads.
  await storage.persistSession(true);
  let release;
  readGate = new Promise(resolve => { release = resolve; });
  const boot = sync.startRealtimeSync();
  await ctx.waitFor(() => reads.length > before.reads);
  storage.clearSession();
  ctx.window.dispatchEvent(new ctx.window.Event('apc-session-ended'));
  const writesAtLogout = writes.length;
  readGate = null;
  release();
  assert.equal((await boot).reason, 'session-ended');
  assert.equal(listeners.size, 0);
  assert.equal(writes.length, writesAtLogout, 'late startup reads must not trigger new writes after logout');
});
