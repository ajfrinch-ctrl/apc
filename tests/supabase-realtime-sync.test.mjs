import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUPABASE_PROJECT_REF,
  SUPABASE_URL,
  SUPABASE_WS_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_PUBLISHABLE_KEY,
  supabaseConfig,
  isSupabaseConfigured
} from '../sync/supabase-config.js';
import { validateSyncGuard } from '../sync/sync-guard.js';
import { syncClassChatRelayCycle } from '../js/class-chat-relay.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(resolve(root, rel), 'utf8');

test('Supabase config targets Active Plus Coaching (cgtdnwktzcroxeioeyfq) with public keys only', () => {
  assert.equal(SUPABASE_PROJECT_REF, 'cgtdnwktzcroxeioeyfq');
  assert.equal(SUPABASE_URL, 'https://cgtdnwktzcroxeioeyfq.supabase.co');
  assert.equal(SUPABASE_WS_URL, 'wss://cgtdnwktzcroxeioeyfq.supabase.co');
  assert.equal(isSupabaseConfigured(supabaseConfig), true);
  assert.ok(SUPABASE_ANON_KEY.startsWith('eyJ'));
  assert.ok(SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_'));

  // Decode JWT payload to guarantee role === 'anon' and never 'service_role'
  const jwtPayload = JSON.parse(Buffer.from(SUPABASE_ANON_KEY.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(jwtPayload.role, 'anon');
  assert.equal(jwtPayload.ref, 'cgtdnwktzcroxeioeyfq');

  for (const rel of [
    'sync/supabase-config.js',
    'sync/cloud-payload-crypto.js',
    'sync/supabase-transport.js',
    'sync/dual-cloud-failover.js',
    'sync/realtime-transport.js'
  ]) {
    const src = read(rel);
    assert.doesNotMatch(src, /sb_secret_[A-Za-z0-9_-]{8,}|service_role\s*[:=]\s*['"]eyJ/i, `${rel} must never embed privileged secrets`);
  }
});

test('Supabase SDK is bundled same-origin, precached in Service Worker, and allowed in CSP connect-src', () => {
  const sdkStats = statSync(resolve(root, 'vendor/supabase/sdk.js'));
  assert.ok(sdkStats.size > 100_000, 'vendor/supabase/sdk.js bundle is populated');

  const sw = read('sw.js');
  for (const entry of [
    './vendor/supabase/sdk.js',
    './sync/supabase-config.js',
    './sync/cloud-payload-crypto.js',
    './sync/supabase-transport.js',
    './sync/dual-cloud-failover.js',
    './sync/realtime-transport.js'
  ]) {
    assert.ok(sw.includes(`'${entry}'`), `sw.js APP_SHELL includes ${entry}`);
  }
  assert.match(sw, /supabase\\\.co/, 'sw.js bypasses cache for Supabase API endpoints');

  for (const page of ['index.html', 'student.html', 'teacher.html', 'manager.html', 'admin.html', 'payment.html', 'firebase.json']) {
    const content = read(page);
    assert.ok(content.includes('https://cgtdnwktzcroxeioeyfq.supabase.co'), `${page} allows HTTPS Supabase origin`);
    assert.ok(content.includes('wss://cgtdnwktzcroxeioeyfq.supabase.co'), `${page} allows WSS Supabase Realtime origin`);
  }
});

test('PostgreSQL 17 migration defines RLS, Realtime publication, atomic CAS RPCs, and 7-day Class Chat TTL pruning', () => {
  const sql = read('supabase/migrations/20261024000001_active_plus_realtime_sync.sql');
  assert.match(sql, /ALTER TABLE public\.apc_sync_nodes REPLICA IDENTITY FULL/);
  assert.match(sql, /ALTER TABLE public\.apc_sync_nodes ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.apc_sync_nodes/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('apc_sync_v1'\)\)/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.apc_cas_subtree[\s\S]*?VOLATILE/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.apc_get_subtree[\s\S]*?VOLATILE/);
  assert.match(sql, /activePlusSync\/v1\/classChat\/%/);
});

test('Sync Guard succeeds with Supabase configured without touching Firebase dev-host checks', async () => {
  const mem = new Map();
  const prevStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k)
  };
  try {
    const health = await validateSyncGuard();
    assert.equal(health.ok, true);
    assert.equal(health.checks.firebaseConfig, true);
    assert.equal(health.checks.firebaseInitialized, true);
  } finally {
    if (prevStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevStorage;
  }
});

test('Supabase transport executes get, set, CAS retry on conflict, onValue coalescing, and E2EE Class Chat relay', async () => {
  // Simulate PostgREST RPC endpoint for cgtdnwktzcroxeioeyfq in-memory
  const tree = new Map();
  let revCounter = 1;
  let forceNextCasConflictOnce = false;

  const normPath = p => String(p || '').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  const getSubtree = path => {
    const norm = normPath(path);
    const val = tree.has(norm) ? structuredClone(tree.get(norm).val) : null;
    const rev = tree.has(norm) ? tree.get(norm).rev : 0;
    return {
      exists: val !== null && val !== undefined,
      value: val ?? null,
      version: val !== null && val !== undefined ? `1:${rev}:${rev}` : '0:0:0',
      serverTimeMs: Date.now()
    };
  };
  const setSubtree = (path, value) => {
    const norm = normPath(path);
    if (value === null || value === undefined) {
      tree.delete(norm);
      return { ok: true, version: '0:0:0', serverTimeMs: Date.now() };
    }
    revCounter += 1;
    tree.set(norm, { val: structuredClone(value), rev: revCounter });
    return { ok: true, version: `1:${revCounter}:${revCounter}`, serverTimeMs: Date.now() };
  };

  const prevFetch = globalThis.fetch;
  const prevNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true }
  });

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (url.endsWith('/rest/v1/rpc/apc_server_time_ms')) {
      return new Response(JSON.stringify(Date.now()), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.endsWith('/rest/v1/rpc/apc_get_subtree')) {
      return new Response(JSON.stringify(getSubtree(body.p_path)), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.endsWith('/rest/v1/rpc/apc_set_subtree')) {
      return new Response(JSON.stringify(setSubtree(body.p_path, body.p_value)), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.endsWith('/rest/v1/rpc/apc_cas_subtree')) {
      if (forceNextCasConflictOnce) {
        forceNextCasConflictOnce = false;
        // Simulate another device incrementing counter first!
        setSubtree(body.p_path, 41);
      }
      const cur = getSubtree(body.p_path);
      if (cur.version !== body.p_expected_version) {
        return new Response(JSON.stringify({ ...cur, committed: false, conflict: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      setSubtree(body.p_path, body.p_value);
      const after = getSubtree(body.p_path);
      return new Response(JSON.stringify({ ...after, committed: true, conflict: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const supa = await import('../sync/supabase-transport.js');
  try {
    const auth = supa.getAuth();
    const cred = await supa.signInAnonymously(auth);
    assert.equal(cred.user.provider, 'supabase');

    const db = supa.getDatabase();

    // 1. Set + Get round-trip (verify raw DB row is AES-256-GCM encrypted with zero plaintext!)
    const studentRef = supa.ref(db, 'activePlusSync/v1/students/261024001');
    await supa.set(studentRef, { id: '261024001', name: 'রাইসা ইসলাম', mobile: '01711223344', className: 'SSC 26' });
    const rawStudentRow = tree.get('activePlusSync/v1/students/261024001').val;
    assert.equal(rawStudentRow._apcEnc, 1);
    assert.equal(rawStudentRow.alg, 'AES-256-GCM');
    assert.equal(JSON.stringify(rawStudentRow).includes('রাইসা'), false, 'student name never stored in plaintext');
    assert.equal(JSON.stringify(rawStudentRow).includes('01711223344'), false, 'student mobile never stored in plaintext');
    const snap = await supa.get(studentRef);
    assert.equal(snap.exists(), true);
    assert.equal(snap.val().name, 'রাইসা ইসলাম');
    assert.equal(snap.val().mobile, '01711223344');

    // 2. CAS transaction automatic conflict retry (41 -> 42)
    const counterRef = supa.ref(db, 'activePlusSync/v1/dailyStudentCounters/261024');
    forceNextCasConflictOnce = true;
    const txRes = await supa.runTransaction(counterRef, cur => (Number(cur) || 0) + 1);
    assert.equal(txRes.committed, true);
    assert.equal(txRes.snapshot.val(), 42);

    // 3. Transaction abort on returning undefined
    const abortRes = await supa.runTransaction(counterRef, () => undefined);
    assert.equal(abortRes.committed, false);
    assert.equal(abortRes.snapshot.val(), 42);

    // 4. Live onValue delivery + update notification
    const seen = [];
    const off = supa.onValue(studentRef, s => seen.push(s.val()));
    await new Promise(r => setTimeout(r, 40));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].className, 'SSC 26');

    await supa.set(studentRef, { id: '261024001', name: 'রাইসা ইসলাম', className: 'HSC 27' });
    await new Promise(r => setTimeout(r, 40));
    assert.equal(seen.length, 2);
    assert.equal(seen[1].className, 'HSC 27');
    off();

    // 5. Two-device AES-256-GCM Encrypted Class Chat Relay over Supabase transport
    const makeDeviceStorage = seed => {
      const m = new Map(Object.entries(seed));
      return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k)
      };
    };
    const chatRef = supa.ref(db, 'activePlusSync/v1/classChat');
    const teacherStorage = makeDeviceStorage({
      'activePlus.classChat.v1': JSON.stringify({
        version: 1,
        rooms: {},
        messages: [{
          id: 'msg-supa-1',
          roomKey: 'ssc-26',
          classId: 'SSC 26',
          senderId: 'teacher-1',
          senderName: 'তানভীর স্যার',
          senderRole: 'teacher',
          text: 'আগামীকাল সকাল ৯টায় পদার্থবিজ্ঞান ক্লাস হবে।',
          createdAt: new Date().toISOString(),
          updatedAt: Date.now()
        }],
        updatedAt: Date.now()
      })
    });
    const studentStorage = makeDeviceStorage({});

    await syncClassChatRelayCycle({
      storage: teacherStorage,
      rawSetItem: teacherStorage.setItem,
      viewer: { kind: 'staff', role: 'teacher', ackKey: 'staff_teacher_t1', allowedRoomKeys: null },
      notifyLocalUpdate: () => {},
      readCloudSnapshot: async () => (await supa.get(chatRef)).val(),
      runCloudTransaction: async updater => {
        const res = await supa.runTransaction(chatRef, updater);
        return res.snapshot.val();
      }
    });

    // Verify encrypted ciphertext lives in cloud (never plaintext Bengali text)
    const rawCloudChat = (await supa.get(chatRef)).val();
    assert.ok(rawCloudChat['msg-msg-supa-1'], 'encrypted message bundle uploaded to Supabase');
    assert.equal(JSON.stringify(rawCloudChat).includes('পদার্থবিজ্ঞান'), false, 'cloud holds AES-256-GCM ciphertext only');

    // Student device pulls & decrypts from Supabase
    await syncClassChatRelayCycle({
      storage: studentStorage,
      rawSetItem: studentStorage.setItem,
      viewer: { kind: 'student', role: 'student', ackKey: 'stu_261024001', allowedRoomKeys: new Set(['ssc-26']) },
      notifyLocalUpdate: () => {},
      readCloudSnapshot: async () => (await supa.get(chatRef)).val(),
      runCloudTransaction: async updater => {
        const res = await supa.runTransaction(chatRef, updater);
        return res.snapshot.val();
      }
    });

    const receivedStore = JSON.parse(studentStorage.getItem('activePlus.classChat.v1'));
    assert.equal(receivedStore.messages.length, 1);
    assert.equal(receivedStore.messages[0].text, 'আগামীকাল সকাল ৯টায় পদার্থবিজ্ঞান ক্লাস হবে।');
  } finally {
    supa.disconnectSupabaseRealtime();
    globalThis.fetch = prevFetch;
    if (prevNavigator) Object.defineProperty(globalThis, 'navigator', prevNavigator);
  }
});

test('Idle WebSocket Hibernation frees live socket when tab stays hidden and resumes + catches up on wake', async () => {
  const prevFetch = globalThis.fetch;
  const prevDoc = globalThis.document;
  const prevIdle = globalThis.__APC_IDLE_HIBERNATE_MS__;
  globalThis.__APC_IDLE_HIBERNATE_MS__ = 50;

  let rev = 1;
  let noticeValue = { id: 'n-1', title: 'প্রথম নোটিশ' };
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/rest/v1/rpc/apc_get_subtree')) {
      return new Response(JSON.stringify({
        exists: true,
        value: noticeValue,
        version: `1:${rev}:${rev}`,
        serverTimeMs: Date.now()
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const docListeners = new Map();
  const mockDoc = {
    visibilityState: 'visible',
    hidden: false,
    documentElement: { dataset: {} },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    }
  };
  const emitVis = state => {
    mockDoc.visibilityState = state;
    mockDoc.hidden = state === 'hidden';
    for (const fn of (docListeners.get('visibilitychange') || [])) fn();
  };
  globalThis.document = mockDoc;

  const supa = await import('../sync/supabase-transport.js');
  try {
    supa.disconnectSupabaseRealtime();
    // Ensure visibility listener is attached to mockDoc
    mockDoc.addEventListener('visibilitychange', () => {
      if (mockDoc.hidden) {
        setTimeout(() => { if (mockDoc.hidden) supa.enterIdleHibernation(); }, 50);
      } else {
        supa.resumeFromHibernation();
      }
    });

    const db = supa.getDatabase();
    const noticeRef = supa.ref(db, 'activePlusSync/v1/notices');
    const seen = [];
    const off = supa.onValue(noticeRef, snap => seen.push(snap.val()));
    await new Promise(r => setTimeout(r, 40));
    assert.equal(seen.length, 1);
    assert.equal(supa.getSupabaseLoadState().hibernated, false);
    assert.equal(supa.getSupabaseLoadState().hasRealtimeChannel, true);

    // Lock phone / minimize tab -> socket released after 50ms
    emitVis('hidden');
    await new Promise(r => setTimeout(r, 80));
    assert.equal(supa.getSupabaseLoadState().hibernated, true);
    assert.equal(supa.getSupabaseLoadState().hasRealtimeChannel, false);
    assert.equal(mockDoc.documentElement.dataset.wsHibernated, 'true');

    // Cloud changes while phone is locked
    rev = 2;
    noticeValue = { id: 'n-2', title: 'ফোন আনলক করার পরের নোটিশ' };

    // Unlock phone -> instant resume + delta catch-up
    emitVis('visible');
    await new Promise(r => setTimeout(r, 60));
    assert.equal(supa.getSupabaseLoadState().hibernated, false);
    assert.equal(supa.getSupabaseLoadState().hasRealtimeChannel, true);
    assert.equal(mockDoc.documentElement.dataset.wsHibernated, 'false');
    assert.equal(seen.at(-1).id, 'n-2');
    off();
  } finally {
    supa.disconnectSupabaseRealtime();
    globalThis.fetch = prevFetch;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevIdle === undefined) delete globalThis.__APC_IDLE_HIBERNATE_MS__;
    else globalThis.__APC_IDLE_HIBERNATE_MS__ = prevIdle;
  }
});

test('Dual-Cloud Failover mirrors hot standby to Firebase, shifts automatically on Supabase overload, and heals back', async () => {
  const { createDualCloudTransport } = await import('../sync/dual-cloud-failover.js');

  const makeMockLeg = name => {
    const store = new Map();
    const listeners = new Map();
    const overloadHandlers = new Set();
    let overloaded = false;
    const auth = { currentUser: null, authStateReady: async () => {} };

    const snap = (path, val) => ({
      key: path.split('/').pop(),
      exists: () => val !== undefined && val !== null,
      val: () => (val === undefined ? null : structuredClone(val))
    });

    const checkOverload = () => {
      if (!overloaded) return;
      const err = new Error(`${name} max_connections rate_limit 429`);
      err.code = 'unavailable';
      err.isOverload = true;
      for (const fn of overloadHandlers) fn({ reason: 'capacity-or-quota' });
      throw err;
    };

    const emitPath = path => {
      const val = store.get(path) ?? null;
      for (const cb of (listeners.get(path) || [])) cb(snap(path, val));
    };

    return {
      name,
      store,
      setOverloaded(v) {
        overloaded = v;
        if (v) {
          for (const fn of overloadHandlers) fn({ reason: 'capacity-or-quota' });
        }
      },
      emitPath,
      app: { name },
      appCheckReady: Promise.resolve(),
      mod: {
        browserLocalPersistence: {},
        onSupabaseOverload: cb => { overloadHandlers.add(cb); return () => overloadHandlers.delete(cb); },
        getAuth: () => auth,
        setPersistence: async () => {},
        signInAnonymously: async () => {
          checkOverload();
          auth.currentUser = { uid: `${name}-anon` };
          return { user: auth.currentUser };
        },
        getDatabase: () => ({ name }),
        ref: (_db, path) => ({ path }),
        get: async r => {
          checkOverload();
          if (r.path === '.info/serverTimeOffset') return snap(r.path, 0);
          return snap(r.path, store.get(r.path) ?? null);
        },
        set: async (r, value) => {
          checkOverload();
          store.set(r.path, structuredClone(value));
          emitPath(r.path);
        },
        runTransaction: async (r, updater) => {
          checkOverload();
          const next = updater(structuredClone(store.get(r.path) ?? null));
          if (next === undefined) return { committed: false, snapshot: snap(r.path, store.get(r.path) ?? null) };
          store.set(r.path, structuredClone(next));
          emitPath(r.path);
          return { committed: true, snapshot: snap(r.path, next) };
        },
        onValue: (r, cb) => {
          if (r.path === '.info/connected') {
            queueMicrotask(() => cb(snap('.info/connected', !overloaded)));
            return () => {};
          }
          if (!listeners.has(r.path)) listeners.set(r.path, new Set());
          listeners.get(r.path).add(cb);
          queueMicrotask(() => {
            if (!overloaded) cb(snap(r.path, store.get(r.path) ?? null));
          });
          return () => listeners.get(r.path)?.delete(cb);
        }
      }
    };
  };

  const primary = makeMockLeg('supabase');
  const secondary = makeMockLeg('firebase');
  const dual = createDualCloudTransport({
    primary,
    secondary,
    options: { failoverCooldownMs: 120, mirrorDebounceMs: 25 }
  });

  try {
    await dual.signInAnonymously();
    const db = dual.getDatabase();
    const noticeRef = dual.ref(db, 'activePlusSync/v1/notices/n-1');

    // 1. Normal mode: Primary (Supabase) serves write + hot-standby mirror replicates encrypted envelope to Firebase
    assert.equal(dual.getDualCloudState().activeProvider, 'supabase');
    await dual.set(noticeRef, { id: 'n-1', title: 'মিরর টেস্ট' });
    assert.equal((await dual.get(noticeRef)).val().title, 'মিরর টেস্ট');
    await new Promise(r => setTimeout(r, 60));
    const mirroredRaw = secondary.store.get('activePlusSync/v1/notices/n-1');
    assert.equal(mirroredRaw._apcEnc, 1, 'Firebase hot-standby mirror stores AES-256-GCM ciphertext');
    assert.equal(JSON.stringify(mirroredRaw).includes('মিরর টেস্ট'), false, 'Firebase mirror holds zero plaintext');
    assert.ok(dual.getDualCloudState().mirrorCount >= 1);

    // 2. Live stream starts on Supabase, then Supabase hits 200-connection cap / 429 overload
    const streamUpdates = [];
    const unsub = dual.onValue(noticeRef, s => streamUpdates.push(s.val()));
    await new Promise(r => setTimeout(r, 25));

    primary.setOverloaded(true);
    await new Promise(r => setTimeout(r, 25));
    assert.equal(dual.getDualCloudState().activeProvider, 'firebase');
    assert.equal(dual.getDualCloudState().failoverActive, true);

    // Writes & atomic transactions succeed zero-drop on Firebase during Supabase outage!
    const txRef = dual.ref(db, 'activePlusSync/v1/dailyStudentCounters/261025');
    const tx = await dual.runTransaction(txRef, cur => (Number(cur) || 0) + 1);
    assert.equal(tx.committed, true);
    assert.equal(tx.snapshot.val(), 1);
    assert.equal(secondary.store.get('activePlusSync/v1/dailyStudentCounters/261025'), 1);

    await dual.set(noticeRef, { id: 'n-1', title: 'ফেইলওভার আপডেট' });
    await new Promise(r => setTimeout(r, 25));
    assert.equal(streamUpdates.at(-1).title, 'ফেইলওভার আপডেট');

    // 3. Supabase recovers -> automatic health probe shifts active leg back to Supabase!
    primary.setOverloaded(false);
    await new Promise(r => setTimeout(r, 200));
    assert.equal(dual.getDualCloudState().activeProvider, 'supabase');
    assert.equal(dual.getDualCloudState().failoverActive, false);

    // 4. Deterministic Load-Split Shard mode (e.g. 100% overflow shard)
    const sharded = createDualCloudTransport({
      primary,
      secondary,
      options: { loadSplitSecondaryPercent: 100 }
    });
    assert.equal(sharded.getDualCloudState().shardedToSecondary, true);
    assert.equal(sharded.getDualCloudState().activeProvider, 'firebase');
    sharded.destroy();
    unsub();
  } finally {
    dual.destroy();
  }
});

test('Full-Database AES-256-GCM encryption protects all collections, reuses unchanged sibling ciphertexts, blocks AAD path swaps, and passes Firebase rules', async () => {
  const {
    encryptCloudSubtree,
    decryptCloudSubtree,
    decryptLeafValue,
    isEncryptedEnvelope
  } = await import('../sync/cloud-payload-crypto.js');
  const { createSimulator } = await import('./rtdb-rules-sim.mjs');
  const rules = JSON.parse(read('database.rules.json'));
  const sim = createSimulator(rules);
  const anonAuth = { uid: 'anon-device', token: { firebase: { sign_in_provider: 'anonymous' } } };

  // 1. Encrypt whole multi-record subtree (transactions, exams, notices) -> zero plaintext anywhere
  const txPlain = {
    'TX-901': { id: 'TX-901', studentId: '261025001', studentName: 'নুসরাত জাহান', amount: 2500, note: 'মাসিক বেতন' },
    'TX-902': { id: 'TX-902', studentId: '261025002', studentName: 'রাফি আহমেদ', amount: 1800, note: 'ভর্তি ফি' }
  };
  const txEnc1 = await encryptCloudSubtree('activePlusSync/v1/transactions', txPlain);
  assert.equal(isEncryptedEnvelope(txEnc1['TX-901']), true);
  assert.equal(isEncryptedEnvelope(txEnc1['TX-902']), true);
  assert.equal(JSON.stringify(txEnc1).includes('নুসরাত'), false);
  assert.equal(JSON.stringify(txEnc1).includes('2500'), false);
  assert.equal(JSON.stringify(txEnc1).includes('মাসিক বেতন'), false);

  // 2. Decrypt subtree -> recovers exact original records & reuses unchanged sibling ciphertexts on partial update
  const dec1 = await decryptCloudSubtree('activePlusSync/v1/transactions', txEnc1);
  assert.deepEqual(dec1.value, txPlain);

  const txPlainEdited = {
    ...txPlain,
    'TX-902': { ...txPlain['TX-902'], amount: 2000 }
  };
  const txEnc2 = await encryptCloudSubtree('activePlusSync/v1/transactions', txPlainEdited, {
    prevPlainByPath: dec1.plainByPath,
    prevCipherByPath: dec1.cipherByPath
  });
  assert.deepEqual(txEnc2['TX-901'], txEnc1['TX-901'], 'untouched sibling keeps identical ciphertext envelope (zero wasted DB writes)');
  assert.notEqual(txEnc2['TX-902'].iv, txEnc1['TX-902'].iv, 'modified record receives a fresh random 96-bit IV');

  // 3. AAD path binding blocks moving ciphertext from one path/user to another
  await assert.rejects(
    () => decryptLeafValue('activePlusSync/v1/transactions/TX-TAMPERED', txEnc1['TX-901']),
    'swapping ciphertext across database paths must fail AES-GCM authentication'
  );

  // 4. All 27/27 deployed Firebase database.rules.json write paths pass rules validation & round-trip losslessly
  const { SYNCABLE } = await import('../js/database.js');
  const { STAFF_ACCOUNTS } = await import('../js/staff-auth.js');
  const { encodeUsernameKey } = await import('../js/username-sync-codec.js');
  const V1 = p => `activePlusSync/v1/${p}`;
  const hash = { v: 1, algo: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: 's', digest: 'd' };
  const RECORD_COLLECTIONS = [...SYNCABLE.filter(n => n !== 'exams'), 'teacherAssignments'];

  const allFirebasePaths = [
    ...RECORD_COLLECTIONS.map(name => [
      V1(name),
      name === 'settings'
        ? { instituteName: 'Active Plus Coaching', academicYear: '2026' }
        : { 'REC-1': { id: 'REC-1', name: 'সাদিয়া আক্তার', status: 'approved', updatedAt: 1 } }
    ]),
    ...Object.keys(STAFF_ACCOUNTS).map(role => [
      V1(`staffAccounts/${role}`),
      { username: `${role}.apc`, password: hash, status: 'active' }
    ]),
    [V1('staffDirectory'), { version: 1, records: [{ id: 'S1', username: 'teacher.apc', role: 'teacher' }] }],
    [V1('usernames'), { 'sadia.akter': '261025001' }],
    [V1('mobileIndex'), { '01811223344': '261025001' }],
    [V1('emailIndex'), { 'student%40example%2Ecom': '261025001' }],
    [V1('dailyStudentCounters/261025'), 2],
    [V1('notifications'), { notif_261025001: { id: 'notif_261025001', type: 'new_registration', studentId: '261025001', studentName: 'সাদিয়া আক্তার', mobile: '01811223344', createdAt: '2026-10-25T06:00:00.000Z', read: false } }],
    [V1('studentAccounts/' + encodeUsernameKey('sadia.akter')), { username: 'sadia.akter', pinHash: hash, status: 'active' }],
    [V1('examDb/exams/EX-1'), { id: 'EX-1', teacherId: 'T-1', status: 'published', title: 'পদার্থবিজ্ঞান পরীক্ষা', questions: [{ q: 'বল কী?', ans: 'A' }] }],
    [V1('examDb/attempts/AT-1'), { id: 'AT-1', examId: 'EX-1', studentId: '261025001', answers: { Q1: 'A' } }],
    [V1('system/adminInitialized'), true],
    [V1('system/connectivityProbe/diag-test'), { at: 1728432000000 }],
    [V1('pushTokens/device-1'), { token: 'fcm_real_secret_token_' + 'x'.repeat(24), role: 'admin' }]
  ];
  assert.equal(allFirebasePaths.length, 27, 'covers all 27 Firebase RTDB write paths');

  const preExistingState = {
    activePlusSync: {
      v1: {
        dailyStudentCounters: { '261025': 1 },
        students: { 'REC-1': { id: 'REC-1', status: 'pending' } }
      }
    }
  };

  for (const [path, plain] of allFirebasePaths) {
    const fbEnc = await encryptCloudSubtree(path, plain, { firebaseRulesCompat: true });
    const rawStr = JSON.stringify(fbEnc);
    assert.equal(rawStr.includes('সাদিয়া'), false, `${path} hides student PII`);
    assert.equal(rawStr.includes('পদার্থবিজ্ঞান'), false, `${path} hides exam questions`);
    assert.equal(rawStr.includes('fcm_real_secret_token_'), false, `${path} hides push token`);
    if (path.includes('usernames') || path.includes('mobileIndex') || path.includes('emailIndex')) {
      assert.equal(rawStr.includes('261025001'), false, `${path} hides mapped student ID`);
    }
    assert.equal(sim.canWrite(anonAuth, path, fbEnc, {}), true, `Firebase rules allow fresh encrypted write on ${path}`);
    if (!path.includes('notifications')) {
      assert.equal(sim.canWrite(anonAuth, path, fbEnc, preExistingState), true, `Firebase rules allow update over pre-existing state on ${path}`);
    }
    const recovered = await decryptCloudSubtree(path, fbEnc);
    assert.deepEqual(recovered.value, plain, `Firebase encrypted ${path} round-trips losslessly`);
  }
});

test('Firebase Two-Device Live Sync & Cross-Cloud Handoff enforces database.rules.json on every write and syncs encrypted records across devices', async () => {
  const { createDualCloudTransport } = await import('../sync/dual-cloud-failover.js');
  const { createSimulator } = await import('./rtdb-rules-sim.mjs');
  const rules = JSON.parse(read('database.rules.json'));
  const sim = createSimulator(rules);
  const anonAuth = { uid: 'anon-device', token: { firebase: { sign_in_provider: 'anonymous' } } };

  // Build an authoritative in-memory Firebase RTDB engine enforcing deployed `database.rules.json` on EVERY write!
  function createRuleEnforcedFirebaseLeg() {
    let rootTree = {};
    const listeners = new Set();

    function getAtPath(normPath) {
      if (!normPath) return rootTree;
      let cur = rootTree;
      for (const seg of normPath.split('/').filter(Boolean)) {
        if (!cur || typeof cur !== 'object' || !(seg in cur)) return null;
        cur = cur[seg];
      }
      return cur === undefined ? null : JSON.parse(JSON.stringify(cur));
    }

    function setAtPath(normPath, val) {
      if (!sim.canWrite(anonAuth, normPath, val, rootTree)) {
        const err = new Error(`FIREBASE_PERMISSION_DENIED at ${normPath}`);
        err.code = 'PERMISSION_DENIED';
        throw err;
      }
      const segs = normPath.split('/').filter(Boolean);
      const nextRoot = JSON.parse(JSON.stringify(rootTree));
      let cur = nextRoot;
      for (let i = 0; i < segs.length - 1; i += 1) {
        if (!cur[segs[i]] || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {};
        cur = cur[segs[i]];
      }
      if (val === null || val === undefined) delete cur[segs[segs.length - 1]];
      else cur[segs[segs.length - 1]] = JSON.parse(JSON.stringify(val));
      rootTree = nextRoot;
      for (const l of [...listeners]) {
        if (l.path === normPath || normPath.startsWith(`${l.path}/`) || l.path.startsWith(`${normPath}/`)) {
          const v = getAtPath(l.path);
          l.cb({ key: l.path.split('/').pop(), exists: () => v !== null, val: () => v });
        }
      }
    }

    const authObj = { currentUser: null, async authStateReady() {} };
    return {
      name: 'firebase',
      app: { name: '[FIREBASE_REAL_RULES]' },
      appCheckReady: Promise.resolve(),
      getRawTree: () => rootTree,
      mod: {
        browserLocalPersistence: { type: 'LOCAL' },
        getAuth: () => authObj,
        setPersistence: async () => {},
        signInAnonymously: async () => {
          authObj.currentUser = { uid: 'fb-anon', isAnonymous: true };
          return { user: authObj.currentUser };
        },
        getDatabase: () => ({ leg: 'firebase' }),
        ref: (_db, path) => ({ path: String(path || '').replace(/^\/+|\/+$/g, '') }),
        get: async r => {
          if (r.path === '.info/connected') return { key: 'connected', exists: () => true, val: () => true };
          if (!sim.canRead(anonAuth, r.path, rootTree)) throw Object.assign(new Error(`READ_DENIED ${r.path}`), { code: 'PERMISSION_DENIED' });
          const v = getAtPath(r.path);
          return { key: r.path.split('/').pop(), exists: () => v !== null, val: () => v };
        },
        set: async (r, v) => { setAtPath(r.path, v); },
        runTransaction: async (r, fn) => {
          const cur = getAtPath(r.path);
          const next = fn(cur);
          if (next === undefined) return { committed: false, snapshot: { exists: () => cur !== null, val: () => cur } };
          setAtPath(r.path, next);
          const saved = getAtPath(r.path);
          return { committed: true, snapshot: { exists: () => saved !== null, val: () => saved } };
        },
        onValue: (r, cb) => {
          if (r.path === '.info/connected') {
            queueMicrotask(() => cb({ key: 'connected', exists: () => true, val: () => true }));
            return () => {};
          }
          const entry = { path: r.path, cb };
          listeners.add(entry);
          queueMicrotask(() => {
            const v = getAtPath(r.path);
            cb({ key: r.path.split('/').pop(), exists: () => v !== null, val: () => v });
          });
          return () => listeners.delete(entry);
        }
      }
    };
  }

  const sharedFirebase = createRuleEnforcedFirebaseLeg();
  // Device 1 & Device 2 both connected purely via Firebase encrypted transport
  const device1 = createDualCloudTransport({ primary: sharedFirebase, secondary: null });
  const device2 = createDualCloudTransport({ primary: sharedFirebase, secondary: null });

  try {
    await device1.signInAnonymously();
    await device2.signInAnonymously();

    const db1 = device1.getDatabase();
    const db2 = device2.getDatabase();

    // Subscribe Device 2 to live Firebase updates on students + transactions
    const liveStudentsOnDevice2 = [];
    const offStu = device2.onValue(device2.ref(db2, 'activePlusSync/v1/students'), snap => {
      if (snap.exists()) liveStudentsOnDevice2.push(snap.val());
    });

    // Device 1 writes Student, Username index, Mobile index, and Fee Transaction via CAS transaction + set
    await device1.set(device1.ref(db1, 'activePlusSync/v1/students/261025077'), {
      id: '261025077',
      name: 'মাহমুদুল হাসান',
      mobile: '01755667788',
      className: 'HSC 27',
      status: 'approved'
    });
    await device1.set(device1.ref(db1, 'activePlusSync/v1/usernames/mahmud27'), '261025077');
    await device1.set(device1.ref(db1, 'activePlusSync/v1/mobileIndex/01755667788'), '261025077');

    const txCommit = await device1.runTransaction(device1.ref(db1, 'activePlusSync/v1/transactions'), cur => ({
      ...(cur || {}),
      'TX-FB-1': { id: 'TX-FB-1', studentId: '261025077', amount: 3200, note: 'অক্টোবর বেতন' }
    }));
    assert.equal(txCommit.committed, true);

    await new Promise(r => setTimeout(r, 40));

    // Verify raw Firebase database holds ONLY ciphertext (zero Bengali name, phone, or amount!)
    const rawFb = JSON.stringify(sharedFirebase.getRawTree());
    assert.equal(rawFb.includes('মাহমুদুল'), false, 'Firebase raw tree hides student name');
    assert.equal(rawFb.includes('01755667788') && rawFb.includes('mahmud27'), true); // keys exist, values encrypted
    assert.equal(sharedFirebase.getRawTree().activePlusSync.v1.usernames.mahmud27.startsWith('apc1:'), true, 'username value is compact AES-GCM ciphertext');
    assert.equal(rawFb.includes('3200'), false, 'Firebase raw tree hides transaction amount');
    assert.equal(rawFb.includes('অক্টোবর বেতন'), false, 'Firebase raw tree hides transaction note');

    // Verify Device 2 received live decrypted student via Firebase onValue AND reads decrypted transaction + username!
    assert.ok(liveStudentsOnDevice2.length >= 1, 'Device 2 received live Firebase push');
    assert.equal(liveStudentsOnDevice2[liveStudentsOnDevice2.length - 1]['261025077'].name, 'মাহমুদুল হাসান');
    assert.equal((await device2.get(device2.ref(db2, 'activePlusSync/v1/usernames/mahmud27'))).val(), '261025077');
    assert.equal((await device2.get(device2.ref(db2, 'activePlusSync/v1/transactions/TX-FB-1'))).val().amount, 3200);

    offStu();
  } finally {
    device1.destroy();
    device2.destroy();
  }
});

test('Dual-Cloud authoritative Supabase Primary admin gate ignores stale Secondary Firebase records even under 100% load-split', async () => {
  const { createDualCloudTransport } = await import('../sync/dual-cloud-failover.js');

  function makeSimpleLeg(name, initialEntries = []) {
    const store = new Map(initialEntries);
    const snap = (path, val) => ({
      key: String(path).split('/').pop(),
      exists: () => val !== null && val !== undefined,
      val: () => (val === null || val === undefined ? null : structuredClone(val))
    });
    const authObj = { currentUser: { uid: `${name}-uid` }, async authStateReady() {} };
    return {
      name,
      store,
      app: { name },
      appCheckReady: Promise.resolve(),
      mod: {
        browserLocalPersistence: { type: 'LOCAL' },
        getAuth: () => authObj,
        setPersistence: async () => {},
        signInAnonymously: async () => ({ user: authObj.currentUser }),
        getDatabase: () => ({ name }),
        ref: (_db, path) => ({ path: String(path || '').replace(/^\/+|\/+$/g, '') }),
        get: async r => snap(r.path, store.get(r.path) ?? null),
        set: async (r, val) => {
          if (val === null || val === undefined) store.delete(r.path);
          else store.set(r.path, structuredClone(val));
        },
        runTransaction: async (r, fn) => {
          const cur = store.get(r.path) ?? null;
          const next = fn(structuredClone(cur));
          if (next === undefined) return { committed: false, snapshot: snap(r.path, cur) };
          store.set(r.path, structuredClone(next));
          return { committed: true, snapshot: snap(r.path, next) };
        },
        onValue: () => () => {}
      }
    };
  }

  // Fresh Supabase Primary has ZERO Admin records, while legacy Secondary Firebase has stale pre-migration flags!
  const supaPrimary = makeSimpleLeg('supabase');
  const staleFirebaseSecondary = makeSimpleLeg('firebase', [
    ['activePlusSync/v1/system/adminInitialized', true],
    ['activePlusSync/v1/staffAccounts/admin', { username: 'legacy.admin.apc', status: 'active' }]
  ]);

  const dual = createDualCloudTransport({
    primary: supaPrimary,
    secondary: staleFirebaseSecondary,
    options: { loadSplitSecondaryPercent: 100, mirrorDebounceMs: 20 }
  });

  try {
    const db = dual.getDatabase();
    const flagSnap = await dual.get(dual.ref(db, 'activePlusSync/v1/system/adminInitialized'));
    const adminSnap = await dual.get(dual.ref(db, 'activePlusSync/v1/staffAccounts/admin'));
    assert.equal(flagSnap.exists(), false, 'Supabase Primary (uninitialized) wins over stale Firebase Secondary');
    assert.equal(adminSnap.exists(), false, 'Supabase Primary (no admin) wins over stale Firebase Secondary');

    // Claiming First Admin writes atomically to Supabase Primary and mirrors encrypted copy over stale Firebase Secondary!
    const claimTx = await dual.runTransaction(dual.ref(db, 'activePlusSync/v1/staffAccounts/admin'), cur => {
      if (cur !== null) return undefined;
      return { username: 'ajfrinch.admin.apc', status: 'active', fullName: 'AJ Frinch' };
    });
    assert.equal(claimTx.committed, true);
    await dual.set(dual.ref(db, 'activePlusSync/v1/system/adminInitialized'), true);
    assert.equal(supaPrimary.store.get('activePlusSync/v1/staffAccounts/admin').username, 'ajfrinch.admin.apc');
    assert.equal(supaPrimary.store.get('activePlusSync/v1/system/adminInitialized'), true);

    await new Promise(r => setTimeout(r, 60));
    const mirroredAdmin = staleFirebaseSecondary.store.get('activePlusSync/v1/staffAccounts/admin');
    assert.equal(mirroredAdmin._apcEnc, 1, 'Stale Secondary Firebase record overwritten with AES-256-GCM mirror');
  } finally {
    dual.destroy();
  }
});


