/* "Synced" must be earned (audit item 16).

   A cloud that REFUSES the write (permission-denied, the exact thing broken
   rules or a blocked App Check produce) must never leave the app painted as
   synchronized — and the change must still be on the device, queued, and must
   land by itself once the cloud accepts again. No page reload anywhere. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';

const values = new Map();
const writes = [];
let failWrites = true;
let dbCalls = 0;
const listeners = new Set();

const snapshot = path => ({ exists: () => values.has(path), val: () => (values.has(path) ? values.get(path) : null) });
const auth = { currentUser: null, authStateReady: async () => {} };

const transport = {
  firebaseApp: {}, appCheckReady: Promise.resolve(),
  getAuth: () => auth,
  signInAnonymously: async () => { auth.currentUser = { uid: 'test-device' }; return { user: auth.currentUser }; },
  signInWithEmailAndPassword: async () => { throw new Error('not used'); },
  updatePassword: async () => {}, setPersistence: async () => {}, browserLocalPersistence: {},
  getDatabase: () => ({}), ref: (_db, path) => String(path),
  get: async path => { dbCalls += 1; return snapshot(path); },
  set: async (path, value) => { writes.push(path); values.set(path, value); },
  runTransaction: async (path, update) => {
    dbCalls += 1;
    if (failWrites) throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' });
    const next = update(values.get(path) ?? null);
    if (next === undefined) return { committed: false, snapshot: snapshot(path) };
    writes.push(path); values.set(path, next);
    return { committed: true, snapshot: snapshot(path) };
  },
  onValue: (path, callback) => {
    const listener = { path, callback, stopped: false };
    listeners.add(listener);
    queueMicrotask(() => {
      if (listener.stopped) return;
      if (path === '.info/connected') listener.callback({ val: () => true });
      else listener.callback(snapshot(path));
    });
    return () => { listener.stopped = true; listeners.delete(listener); };
  }
};

let hooks = null;
before(() => {
  globalThis.__apcTruthTransport = transport;
  hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('/firebase/firebase-init.js') || url.endsWith('/firebase/firebase-services.js')) {
        return {
          format: 'module', shortCircuit: true,
          source: `export const { ${Object.keys(transport).join(', ')} } = globalThis.__apcTruthTransport;`
        };
      }
      return nextLoad(url, context);
    }
  });
});
after(() => { hooks?.deregister?.(); delete globalThis.__apcTruthTransport; });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const status = ctx => ({
  state: ctx.document.documentElement.dataset.realtimeSync || '',
  message: ctx.document.documentElement.dataset.realtimeSyncMessage || '',
  lastSync: ctx.document.documentElement.dataset.firebaseLastSync || ''
});
const studentsInCloud = () => values.get('activePlusSync/v1/students') || null;

test('a refused write is never called synced, the change is kept, and it lands when the cloud accepts', async () => {
  const ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  globalThis.Storage = ctx.window.Storage;

  // A real session: an account plus a verified session marker.
  const storage = await import('../js/storage.js');
  await storage.persistAccount({
    username: 'cloud.student', mobile: '01712345678', pin: '123456',
    status: 'active', student: { id: 'SYNC-TRUTH', name: 'সত্য যাচাই', className: 'নবম শ্রেণি' }
  });
  await storage.persistSession(true);
  assert.equal(await storage.hasSession(), true, 'the device holds a verified session');

  const sync = await import('../js/realtime-sync.js');
  const boot = await sync.startRealtimeSync();
  assert.equal(boot.ok, true, 'the bridge booted');
  assert.equal(failWrites, true, 'the cloud is still refusing writes');

  // A change made now goes through the outbox; the cloud refuses it.
  ctx.window.localStorage.setItem(KEYS.students, JSON.stringify([{ id: 'STU-TRUTH', fullName: 'সত্য যাচাই' }]));
  await sleep(400);

  const refused = status(ctx);
  assert.equal(refused.state, 'error', `a refused write must paint an error, not a sync: ${JSON.stringify(refused)}`);
  assert.notEqual(refused.state, 'online', 'never "online" while the write was rejected');
  assert.equal(studentsInCloud(), null, 'the record really did not reach the cloud');

  // Nothing was lost or hidden: the device keeps the change and the queue.
  const local = JSON.parse(ctx.window.localStorage.getItem(KEYS.students));
  assert.equal(local.some(row => row.id === 'STU-TRUTH'), true, 'the change is still on the device');
  const outbox = ctx.window.localStorage.getItem('activePlus.syncOutbox.v2:students');
  assert.ok(outbox && outbox.includes('STU-TRUTH'), 'and it is queued for retry');

  // The cloud accepts again: the queue drains by itself, with no reload.
  failWrites = false;
  await sleep(3500); // the pending-flush timer runs every 3s
  assert.ok(studentsInCloud()?.['STU-TRUTH'], 'the queued change reached the cloud after recovery');
  for (let attempt = 0; attempt < 40 && status(ctx).state !== 'online'; attempt += 1) await sleep(100);
  const healed = status(ctx);
  assert.equal(healed.state, 'online', `after the retry the app may say synced: ${JSON.stringify(healed)}`);
  assert.ok(healed.lastSync, 'and only now is there a successful-sync timestamp');
  assert.match(healed.message, /সিঙ্ক/, 'the status line names the sync state');
  ctx.window.close();
});
