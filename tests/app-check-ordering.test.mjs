/* App Check readiness (audit item 19).

   App Check is DISABLED today (`APP_CHECK_SITE_KEY = ''`), so the one thing
   that must hold before it is switched on is ordering: no database or auth call
   may leave the device before `appCheckReady` resolves. Otherwise enabling the
   site key would race the first request and produce exactly the "Missing App
   Check token" failures this audit is asked to rule out.

   The gate below never resolves until the test releases it, so any request that
   slipped through ordering would be counted while the gate is still shut. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { loadPage } from './jsdom-harness.mjs';

let releaseGate;
const gate = new Promise(resolve => { releaseGate = resolve; });
/* Only operations that leave the device count: getDatabase()/ref() build local
   objects, while get/set/runTransaction/onValue/signInAnonymously hit Firebase. */
const counts = { network: 0, database: 0, auth: 0 };
const values = new Map();
const listeners = new Set();

const snapshot = path => ({ exists: () => values.has(path), val: () => (values.has(path) ? values.get(path) : null) });
const auth = { currentUser: null, authStateReady: async () => { counts.network += 1; } };
const transport = {
  firebaseApp: {}, appCheckReady: gate,
  getAuth: () => auth,
  signInAnonymously: async () => { counts.network += 1; auth.currentUser = { uid: 'device' }; return { user: auth.currentUser }; },
  signInWithEmailAndPassword: async () => { throw new Error('not used'); },
  updatePassword: async () => {}, setPersistence: async () => {}, browserLocalPersistence: {},
  getDatabase: () => { counts.database += 1; return {}; },
  ref: (_db, path) => String(path),
  get: async path => { counts.network += 1; return snapshot(path); },
  set: async (path, value) => { counts.network += 1; values.set(path, value); },
  runTransaction: async (path, update) => {
    counts.network += 1;
    const next = update(values.get(path) ?? null);
    if (next !== undefined) values.set(path, next);
    return { committed: next !== undefined, snapshot: snapshot(path) };
  },
  onValue: (path, callback) => {
    counts.network += 1;
    const listener = { path, callback, stopped: false };
    listeners.add(listener);
    queueMicrotask(() => { if (!listener.stopped) listener.callback(path === '.info/connected' ? { val: () => true } : snapshot(path)); });
    return () => { listener.stopped = true; listeners.delete(listener); };
  }
};

let hooks = null;
before(() => {
  globalThis.__apcAppCheckTransport = transport;
  hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('/firebase/firebase-init.js') || url.endsWith('/firebase/firebase-services.js')) {
        return {
          format: 'module', shortCircuit: true,
          source: `export const { ${Object.keys(transport).join(', ')} } = globalThis.__apcAppCheckTransport;`
        };
      }
      return nextLoad(url, context);
    }
  });
});
after(() => { hooks?.deregister?.(); delete globalThis.__apcAppCheckTransport; });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('nothing touches Firebase before appCheckReady resolves — so enabling App Check cannot race a request', async () => {
  const ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  globalThis.Storage = ctx.window.Storage;

  const sync = await import('../js/realtime-sync.js');
  const storage = await import('../js/storage.js');
  await storage.persistAccount({
    username: 'cloud.student', mobile: '01712345678', pin: '123456',
    status: 'active', student: { id: 'CHECK-1', name: 'App Check', className: 'নবম শ্রেণি' }
  });
  await storage.persistSession(true);

  /* Both entry points that talk to the cloud while the gate is shut. */
  const stateFlight = sync.adminInitializationState();
  const syncFlight = sync.startRealtimeSync();
  await sleep(150);

  assert.equal(counts.network, 0,
    'no request (get/set/transaction/listener/sign-in) may leave the device before App Check is ready');

  releaseGate();
  const [state] = await Promise.all([stateFlight, syncFlight]);
  assert.equal(state.ok, true, 'once App Check is ready the gate check runs');
  assert.ok(counts.network > 0, 'and only then does traffic start');
  assert.ok(counts.database > 0, 'after the database handle was built');
  ctx.window.close();
});
