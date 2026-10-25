// Active Plus Coaching — Dual-Cloud Load-Split & Automatic Failover Coordinator.
// Pairs Supabase Realtime (Primary) with Firebase Realtime Database (Hot Standby /
// Overflow Leg):
//   1. Serves normal traffic from Primary (Supabase) while coalescing non-blocking
//      write-behind mirrors to Secondary (Firebase) so both clouds stay warm.
//   2. Automatically shifts active reads, writes, transactions, and live `onValue`
//      streams to Secondary (Firebase) when Primary hits connection limits, HTTP
//      429/503 overload, or network timeouts — and heals back once Primary recovers.
//   3. Supports optional deterministic device-hash traffic splitting (`0..100%`)
//      for high-concurrency live exams.

import {
  encryptCloudSubtree,
  decryptCloudSubtree
} from './cloud-payload-crypto.js';

function isFastFailSandboxHost() {
  if (typeof process !== 'undefined' && Boolean(process.versions?.node)) return true;
  const host = String(globalThis.location?.hostname || '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  return /^[a-z0-9-]+\.e2b\.app$/.test(host);
}

const FAST_SANDBOX = isFastFailSandboxHost();
const DEFAULT_FAILOVER_COOLDOWN_MS = 30000;
const DEFAULT_MIRROR_DEBOUNCE_MS = 350;
const SECONDARY_COLD_TIMEOUT_MS = FAST_SANDBOX ? 900 : 8000;
const SECONDARY_WARM_TIMEOUT_MS = FAST_SANDBOX ? 5000 : 10000;
const SECONDARY_UNREACHABLE_MS = FAST_SANDBOX ? 8000 : 5000;

function isBrowserOnline() {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return true;
  return navigator.onLine;
}

function cleanPath(rawPath) {
  const raw = String(rawPath || '').trim();
  if (raw === '.info/connected' || raw === '/.info/connected') return '.info/connected';
  if (raw === '.info/serverTimeOffset' || raw === '/.info/serverTimeOffset') return '.info/serverTimeOffset';
  return raw.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function keyOfPath(normPath) {
  if (!normPath) return null;
  const parts = normPath.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function cloneJson(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function makeBoolSnapshot(path, value) {
  return {
    key: keyOfPath(path),
    exists: () => true,
    val: () => Boolean(value)
  };
}

function makePlainSnapshot(path, value, existsOverride = undefined) {
  const exists = existsOverride !== undefined
    ? Boolean(existsOverride && value !== null && value !== undefined)
    : (value !== null && value !== undefined);
  const safeVal = exists ? value : null;
  return {
    key: keyOfPath(path),
    exists: () => exists,
    val: () => cloneJson(safeVal)
  };
}

async function decodeSecondarySnapshot(normPath, rawSnap) {
  if (!rawSnap || normPath.startsWith('.info/')) return rawSnap;
  const hasRaw = typeof rawSnap.exists === 'function' ? rawSnap.exists() : false;
  if (!hasRaw) return makePlainSnapshot(normPath, null, false);
  const dec = await decryptCloudSubtree(normPath, rawSnap.val());
  return makePlainSnapshot(normPath, dec.value, dec.value !== null && dec.value !== undefined);
}

function snapshotFingerprint(snap) {
  try {
    if (!snap || typeof snap.exists !== 'function' || !snap.exists()) return 'null';
    return JSON.stringify(snap.val());
  } catch {
    return String(Date.now());
  }
}

function isFailoverEligibleError(error) {
  if (!error) return false;
  const code = String(error.code || '').toLowerCase();
  const msg = String(error.message || error || '').toLowerCase();
  if (code.includes('permission-denied') || msg.includes('permission-denied') || msg.includes('outside allowed namespace')) {
    return false;
  }
  return Boolean(
    error.isOverload ||
    code === 'unavailable' ||
    code === 'network-request-failed' ||
    code === 'auth/network-request-failed' ||
    code === 'max-retries-exceeded' ||
    code === '429' ||
    code === '503' ||
    /network|timed?\s*out|unreachable|overload|rate[_ -]?limit|quota|too[_ -]?many|capacity|concurrent|fetch|abort/i.test(msg)
  );
}

function withTimeout(promise, ms, label = 'Cloud operation timed out') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(label);
      err.code = 'network-request-failed';
      reject(err);
    }, ms);
    if (typeof timer?.unref === 'function') timer.unref();
    Promise.resolve(promise).then(
      val => {
        clearTimeout(timer);
        resolve(val);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function computeDeviceShardBucket() {
  let seed = '';
  try {
    seed = globalThis.localStorage?.getItem('apc.loadShardId') || '';
    if (!seed) {
      seed = `apc-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      globalThis.localStorage?.setItem('apc.loadShardId', seed);
    }
  } catch {
    seed = 'apc-ephemeral-device';
  }
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

function resolveConfiguredSecondarySplitPct(explicitPct) {
  if (typeof explicitPct === 'number' && Number.isFinite(explicitPct)) {
    return Math.max(0, Math.min(100, Math.round(explicitPct)));
  }
  const globalPct = Number(globalThis.__APC_LOAD_SPLIT_FIREBASE_PCT__);
  if (Number.isFinite(globalPct)) {
    return Math.max(0, Math.min(100, Math.round(globalPct)));
  }
  try {
    const raw = new URLSearchParams(globalThis.location?.search || '').get('loadSplitFirebase');
    if (raw !== null && raw !== '') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, Math.round(parsed)));
    }
  } catch { /* ignore */ }
  return 0;
}

export function createDualCloudTransport({
  primary,
  secondary,
  options = {}
} = {}) {
  if (!primary?.mod) throw new Error('Dual-cloud transport requires a primary leg');
  const hasSecondary = Boolean(secondary?.mod);

  const failoverCooldownMs = Number(options.failoverCooldownMs) > 0
    ? Number(options.failoverCooldownMs)
    : DEFAULT_FAILOVER_COOLDOWN_MS;
  const mirrorDebounceMs = Number(options.mirrorDebounceMs) >= 0
    ? Number(options.mirrorDebounceMs)
    : DEFAULT_MIRROR_DEBOUNCE_MS;
  const secondaryColdTimeoutMs = Number(options.secondaryColdTimeoutMs) > 0
    ? Number(options.secondaryColdTimeoutMs)
    : SECONDARY_COLD_TIMEOUT_MS;
  const secondaryWarmTimeoutMs = Number(options.secondaryWarmTimeoutMs) > 0
    ? Number(options.secondaryWarmTimeoutMs)
    : SECONDARY_WARM_TIMEOUT_MS;

  const splitPct = hasSecondary ? resolveConfiguredSecondarySplitPct(options.loadSplitSecondaryPercent) : 0;
  const shardBucket = computeDeviceShardBucket();
  const shardedToSecondary = hasSecondary && splitPct > 0 && shardBucket < splitPct;

  let activeLegName = shardedToSecondary ? 'secondary' : 'primary';
  let failoverUntil = 0;
  let failoverReason = shardedToSecondary ? 'load-split-shard' : '';
  let failoverCount = 0;
  let mirrorCount = 0;
  let recoveryTimer = null;

  let secondaryHealthy = false;
  let secondaryUnreachableUntil = 0;
  let secondarySignInFlight = null;

  const mirrorTimers = new Map();
  const dataStreams = new Set();
  const connectedStreams = new Set();
  let primaryConnected = false;
  let secondaryConnected = false;
  let primaryConnUnsub = null;
  let secondaryConnUnsub = null;

  function syncDomDataset() {
    try {
      const ds = globalThis.document?.documentElement?.dataset;
      if (!ds) return;
      ds.cloudMode = hasSecondary ? 'dual-failover' : `${primary.name || 'supabase'}-only`;
      ds.cloudEncrypted = 'aes-256-gcm';
      ds.cloudProvider = activeLegName === 'secondary' && hasSecondary
        ? (secondary.name || 'firebase')
        : (primary.name || 'supabase');
      ds.cloudFailover = activeLegName === 'secondary' && hasSecondary ? 'active' : 'standby';
    } catch { /* non-DOM context */ }
  }

  syncDomDataset();

  function legObject(name) {
    return name === 'secondary' && hasSecondary ? secondary : primary;
  }

  function legNeedsWrapperCrypto(legName) {
    const leg = legObject(legName);
    return leg?.name === 'firebase';
  }

  function alternateLegName(name) {
    if (!hasSecondary) return 'primary';
    return name === 'primary' ? 'secondary' : 'primary';
  }

  function preferredLegName() {
    if (!hasSecondary) return 'primary';
    if (activeLegName === 'secondary') {
      if (failoverUntil > 0 && Date.now() >= failoverUntil && !shardedToSecondary) {
        return 'primary';
      }
      return 'secondary';
    }
    return 'primary';
  }

  function effectiveConnected() {
    if (!isBrowserOnline()) return false;
    if (activeLegName === 'secondary' && hasSecondary) {
      return Boolean(secondaryConnected || primaryConnected);
    }
    return Boolean(primaryConnected || (hasSecondary && secondaryConnected));
  }

  function broadcastConnectedState() {
    const isConn = effectiveConnected();
    const snap = makeBoolSnapshot('.info/connected', isConn);
    for (const sub of [...connectedStreams]) {
      if (sub.lastSent === isConn) continue;
      sub.lastSent = isConn;
      try {
        sub.callback(snap);
      } catch {}
    }
  }

  function ensureLegDb(legName, dualDb) {
    const leg = legObject(legName);
    if (!dualDb || typeof dualDb !== 'object') {
      return leg.mod.getDatabase(leg.app);
    }
    if (legName === 'secondary') {
      if (!dualDb.secondaryDb) dualDb.secondaryDb = leg.mod.getDatabase(leg.app);
      return dualDb.secondaryDb;
    }
    if (!dualDb.primaryDb) dualDb.primaryDb = leg.mod.getDatabase(leg.app);
    return dualDb.primaryDb;
  }

  function buildLegRef(legName, node) {
    const leg = legObject(legName);
    const norm = cleanPath(node?.path ?? node);
    const db = ensureLegDb(legName, node?.db);
    return leg.mod.ref(db, norm);
  }

  async function ensureSecondaryReady() {
    if (!hasSecondary) throw new Error('Secondary cloud leg is not configured');
    if (!isBrowserOnline()) {
      const err = new Error('Device is offline');
      err.code = 'network-request-failed';
      throw err;
    }
    if (Date.now() < secondaryUnreachableUntil) {
      const fastErr = new Error('Secondary cloud endpoint cooling down');
      fastErr.code = 'network-request-failed';
      throw fastErr;
    }
    const timeoutMs = secondaryHealthy ? secondaryWarmTimeoutMs : secondaryColdTimeoutMs;
    if (typeof secondary.ensureLoaded === 'function') {
      await withTimeout(secondary.ensureLoaded(), timeoutMs, 'Secondary SDK import timed out');
    }
    await withTimeout(secondary.appCheckReady ?? Promise.resolve(), timeoutMs, 'Secondary App Check timed out');
    const secAuth = secondary.mod.getAuth(secondary.app);
    if (secAuth?.currentUser) return secAuth;
    if (!secondarySignInFlight) {
      secondarySignInFlight = (async () => {
        try {
          if (typeof secAuth?.authStateReady === 'function') {
            await withTimeout(secAuth.authStateReady(), timeoutMs, 'Secondary authStateReady timed out');
          }
          if (!secAuth?.currentUser && typeof secondary.mod.signInAnonymously === 'function') {
            await withTimeout(
              secondary.mod.signInAnonymously(secAuth),
              timeoutMs,
              'Secondary anonymous sign-in timed out'
            );
          }
          secondaryHealthy = true;
          secondaryUnreachableUntil = 0;
          return secAuth;
        } catch (err) {
          secondaryUnreachableUntil = Date.now() + SECONDARY_UNREACHABLE_MS;
          throw err;
        } finally {
          secondarySignInFlight = null;
        }
      })();
    }
    return secondarySignInFlight;
  }

  async function runSecondaryOp(fn) {
    await ensureSecondaryReady();
    const timeoutMs = secondaryHealthy ? secondaryWarmTimeoutMs : secondaryColdTimeoutMs;
    try {
      const result = await withTimeout(fn(), timeoutMs, 'Secondary cloud request timed out');
      secondaryHealthy = true;
      secondaryUnreachableUntil = 0;
      return result;
    } catch (err) {
      if (isFailoverEligibleError(err)) {
        secondaryUnreachableUntil = Date.now() + SECONDARY_UNREACHABLE_MS;
      }
      throw err;
    }
  }

  function ensureSecondaryConnectionMonitor() {
    if (!hasSecondary || secondaryConnUnsub) return;
    if (Date.now() < secondaryUnreachableUntil) return;
    void ensureSecondaryReady().then(() => {
      if (secondaryConnUnsub || !connectedStreams.size) return;
      const connRef = buildLegRef('secondary', { path: '.info/connected' });
      secondaryConnUnsub = secondary.mod.onValue(connRef, snap => {
        secondaryConnected = Boolean(snap?.val?.());
        if (secondaryConnected) secondaryHealthy = true;
        broadcastConnectedState();
      }, () => {
        secondaryConnected = false;
        broadcastConnectedState();
      });
    }).catch(() => {});
  }

  function rebindStreamToLeg(stream, targetLeg) {
    if (stream.closed || stream.currentLeg === targetLeg) return;
    const prevUnsub = stream.unsubscribeLeg;
    stream.unsubscribeLeg = null;
    stream.currentLeg = targetLeg;

    const attach = () => {
      if (stream.closed || stream.currentLeg !== targetLeg) return;
      const leg = legObject(targetLeg);
      const targetRef = buildLegRef(targetLeg, { path: stream.path, db: stream.db });
      stream.unsubscribeLeg = leg.mod.onValue(
        targetRef,
        snap => {
          if (stream.closed) return;
          if (targetLeg === 'secondary') secondaryHealthy = true;
          if (legNeedsWrapperCrypto(targetLeg)) {
            void decodeSecondarySnapshot(stream.path, snap).then(decSnap => {
              if (stream.closed || stream.currentLeg !== targetLeg) return;
              const fp = snapshotFingerprint(decSnap);
              if (stream.lastFingerprint === fp) return;
              stream.lastFingerprint = fp;
              stream.callback(decSnap);
            }).catch(err => {
              if (!stream.closed && typeof stream.onError === 'function') stream.onError(err);
            });
            return;
          }
          const fp = snapshotFingerprint(snap);
          if (stream.lastFingerprint === fp) return;
          stream.lastFingerprint = fp;
          stream.callback(snap);
        },
        err => {
          if (stream.closed) return;
          if (targetLeg === 'primary' && hasSecondary && isFailoverEligibleError(err)) {
            activateFailover(err?.message || 'stream-error');
            return;
          }
          if (typeof stream.onError === 'function') stream.onError(err);
        }
      );
    };

    if (typeof prevUnsub === 'function') {
      try { prevUnsub(); } catch {}
    }

    if (targetLeg === 'secondary') {
      void ensureSecondaryReady().then(attach).catch(err => {
        if (!stream.closed && typeof stream.onError === 'function' && !isFailoverEligibleError(err)) {
          stream.onError(err);
        }
      });
    } else {
      attach();
    }
  }

  function schedulePrimaryRecoveryProbe() {
    if (recoveryTimer || !hasSecondary || shardedToSecondary) return;
    const waitMs = Math.max(250, failoverUntil - Date.now());
    recoveryTimer = setTimeout(async () => {
      recoveryTimer = null;
      if (activeLegName !== 'secondary' || shardedToSecondary) return;
      if (!isBrowserOnline()) {
        failoverUntil = Date.now() + failoverCooldownMs;
        schedulePrimaryRecoveryProbe();
        return;
      }
      try {
        const probeRef = buildLegRef('primary', { path: '.info/serverTimeOffset' });
        await primary.mod.get(probeRef);
        restorePrimaryLeg();
      } catch {
        failoverUntil = Date.now() + failoverCooldownMs;
        schedulePrimaryRecoveryProbe();
      }
    }, waitMs);
    if (typeof recoveryTimer?.unref === 'function') recoveryTimer.unref();
  }

  function activateFailover(reason = 'primary-overload') {
    if (!hasSecondary) return false;
    if (Date.now() < secondaryUnreachableUntil && !secondaryHealthy) return false;
    failoverUntil = Date.now() + failoverCooldownMs;
    failoverReason = String(reason || 'primary-overload');
    if (activeLegName !== 'secondary') {
      activeLegName = 'secondary';
      failoverCount += 1;
      syncDomDataset();
      ensureSecondaryConnectionMonitor();
      for (const stream of [...dataStreams]) {
        rebindStreamToLeg(stream, 'secondary');
      }
    }
    schedulePrimaryRecoveryProbe();
    return true;
  }

  function restorePrimaryLeg() {
    if (shardedToSecondary) return false;
    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
    failoverUntil = 0;
    failoverReason = '';
    if (activeLegName === 'primary') return false;
    activeLegName = 'primary';
    syncDomDataset();
    for (const stream of [...dataStreams]) {
      rebindStreamToLeg(stream, 'primary');
    }
    broadcastConnectedState();
    return true;
  }

  if (hasSecondary && typeof primary.mod.onSupabaseOverload === 'function') {
    primary.mod.onSupabaseOverload(detail => {
      const reason = detail?.reason || 'supabase-overload';
      // Shift proactively on explicit rate-limit/capacity/channel errors;
      // plain network blips fail over if Secondary actually responds in get/set/tx.
      if (
        reason === 'rate-limited' ||
        reason === 'service-overloaded' ||
        reason === 'capacity-or-quota' ||
        String(reason).startsWith('realtime-')
      ) {
        activateFailover(reason);
      }
    });
  }

  function scheduleStandbyMirror(normPath, nextValue, writtenLeg) {
    if (!hasSecondary || !normPath || normPath.startsWith('.info/')) return;
    const standbyLeg = alternateLegName(writtenLeg);
    if (standbyLeg === 'secondary' && Date.now() < secondaryUnreachableUntil) return;

    const prevTimer = mirrorTimers.get(normPath);
    if (prevTimer) clearTimeout(prevTimer);

    const payload = cloneJson(nextValue === undefined ? null : nextValue);
    const timer = setTimeout(async () => {
      mirrorTimers.delete(normPath);
      if (!isBrowserOnline()) return;
      try {
        if (standbyLeg === 'secondary') {
          const encMirror = payload === null
            ? null
            : await encryptCloudSubtree(normPath, payload, { firebaseRulesCompat: true });
          await runSecondaryOp(() => {
            const r = buildLegRef('secondary', { path: normPath });
            return secondary.mod.set(r, encMirror);
          });
        } else {
          await (primary.appCheckReady ?? Promise.resolve());
          const r = buildLegRef('primary', { path: normPath });
          await primary.mod.set(r, payload);
        }
        mirrorCount += 1;
      } catch {
        // Best-effort hot-standby mirror; never disrupt foreground writes.
      }
    }, mirrorDebounceMs);
    if (typeof timer?.unref === 'function') timer.unref();
    mirrorTimers.set(normPath, timer);
  }

  async function execLegGet(legName, dualRef) {
    const norm = cleanPath(dualRef?.path ?? dualRef);
    if (legName === 'secondary') {
      const rawSnap = await runSecondaryOp(() => secondary.mod.get(buildLegRef('secondary', dualRef)));
      return legNeedsWrapperCrypto('secondary') ? decodeSecondarySnapshot(norm, rawSnap) : rawSnap;
    }
    await (primary.appCheckReady ?? Promise.resolve());
    const rawPrimary = await primary.mod.get(buildLegRef('primary', dualRef));
    return legNeedsWrapperCrypto('primary') ? decodeSecondarySnapshot(norm, rawPrimary) : rawPrimary;
  }

  async function execLegSet(legName, dualRef, value) {
    const norm = cleanPath(dualRef?.path ?? dualRef);
    const shouldWrap = legNeedsWrapperCrypto(legName);
    const outVal = (!shouldWrap || value === undefined || value === null || norm.startsWith('.info/'))
      ? (value === undefined ? null : value)
      : await encryptCloudSubtree(norm, value, { firebaseRulesCompat: true });
    if (legName === 'secondary') {
      return runSecondaryOp(() => secondary.mod.set(buildLegRef('secondary', dualRef), outVal));
    }
    await (primary.appCheckReady ?? Promise.resolve());
    return primary.mod.set(buildLegRef('primary', dualRef), outVal);
  }

  async function execWrappedFirebaseTransaction(legName, dualRef, updateFn) {
    const leg = legObject(legName);
    const norm = cleanPath(dualRef?.path ?? dualRef);
    const legRef = buildLegRef(legName, dualRef);
    const MAX_SEC_RETRIES = 8;

    for (let attempt = 0; attempt < MAX_SEC_RETRIES; attempt += 1) {
      const rawSnap = await leg.mod.get(legRef);
      const rawExists = Boolean(rawSnap?.exists?.());
      const rawVal = rawExists ? rawSnap.val() : null;
      const expectedRawJson = JSON.stringify(rawVal ?? null);
      const dec = rawExists
        ? await decryptCloudSubtree(norm, rawVal)
        : { value: null, plainByPath: new Map(), cipherByPath: new Map() };
      const plainExists = Boolean(rawExists && dec.value !== null && dec.value !== undefined);
      const draftPlain = plainExists ? cloneJson(dec.value) : null;

      const nextPlain = updateFn(draftPlain);
      if (nextPlain === undefined) {
        return {
          committed: false,
          snapshot: makePlainSnapshot(norm, dec.value, plainExists)
        };
      }

      const encryptedNext = nextPlain === null
        ? null
        : await encryptCloudSubtree(norm, nextPlain, {
            firebaseRulesCompat: true,
            prevPlainByPath: dec.plainByPath,
            prevCipherByPath: dec.cipherByPath
          });

      let conflictOnServer = false;
      const txRes = await leg.mod.runTransaction(legRef, currRaw => {
        if (JSON.stringify(currRaw ?? null) === expectedRawJson) {
          return encryptedNext;
        }
        conflictOnServer = true;
        return undefined;
      });

      if (txRes?.committed) {
        return {
          committed: true,
          snapshot: makePlainSnapshot(norm, nextPlain, nextPlain !== null)
        };
      }
      if (!conflictOnServer) {
        return {
          committed: false,
          snapshot: makePlainSnapshot(norm, dec.value, plainExists)
        };
      }
    }
    const err = new Error(`Firebase encrypted transaction exceeded retries on ${norm}`);
    err.code = 'max-retries-exceeded';
    throw err;
  }

  async function execLegTransaction(legName, dualRef, updateFn) {
    if (legName === 'secondary') {
      return runSecondaryOp(() => (
        legNeedsWrapperCrypto('secondary')
          ? execWrappedFirebaseTransaction('secondary', dualRef, updateFn)
          : secondary.mod.runTransaction(buildLegRef('secondary', dualRef), updateFn)
      ));
    }
    await (primary.appCheckReady ?? Promise.resolve());
    if (legNeedsWrapperCrypto('primary')) {
      return execWrappedFirebaseTransaction('primary', dualRef, updateFn);
    }
    return primary.mod.runTransaction(buildLegRef('primary', dualRef), updateFn);
  }

  const dualApp = Object.freeze({
    name: '[DUAL_CLOUD]',
    provider: hasSecondary ? 'dual' : (primary.name || 'supabase'),
    primaryApp: primary.app,
    secondaryApp: secondary?.app || null
  });

  const appCheckReady = Promise.resolve(primary.appCheckReady);
  const browserLocalPersistence = primary.mod.browserLocalPersistence ?? { type: 'LOCAL' };

  function getAuth() {
    const pAuth = primary.mod.getAuth(primary.app);
    return {
      get currentUser() {
        if (activeLegName === 'secondary' && hasSecondary) {
          const sAuth = secondary.mod.getAuth(secondary.app);
          if (sAuth?.currentUser) return sAuth.currentUser;
        }
        return pAuth?.currentUser || (hasSecondary ? secondary.mod.getAuth(secondary.app)?.currentUser : null) || null;
      },
      async authStateReady() {
        await appCheckReady;
        if (typeof pAuth?.authStateReady === 'function') {
          await pAuth.authStateReady();
        }
      }
    };
  }

  async function setPersistence(_auth, persistence) {
    if (typeof primary.mod.setPersistence === 'function') {
      await primary.mod.setPersistence(primary.mod.getAuth(primary.app), persistence);
    }
  }

  async function signInAnonymously() {
    await appCheckReady;
    const pAuth = primary.mod.getAuth(primary.app);
    try {
      const res = await primary.mod.signInAnonymously(pAuth);
      // Warm standby auth opportunistically without blocking foreground boot.
      if (hasSecondary && activeLegName === 'secondary') {
        await ensureSecondaryReady().catch(() => {});
      }
      return res;
    } catch (primaryErr) {
      if (hasSecondary && isFailoverEligibleError(primaryErr)) {
        const sAuth = await ensureSecondaryReady();
        activateFailover(primaryErr?.message || 'auth-failover');
        return { user: sAuth.currentUser };
      }
      throw primaryErr;
    }
  }

  function getDatabase() {
    return {
      __apcDualDb: true,
      primaryDb: null,
      secondaryDb: null
    };
  }

  function ref(db, path) {
    const norm = cleanPath(path);
    return {
      __apcDualRef: true,
      db,
      path: norm,
      key: keyOfPath(norm)
    };
  }

  function isAuthoritativePrimaryPath(normPath) {
    if (!normPath) return false;
    return /^(activePlusSync\/v1\/(?:system|staffAccounts|staffDirectory|studentAccounts|usernames|mobileIndex|emailIndex|dailyStudentCounters))(?:\/|$)/.test(normPath);
  }

  function isStrictPrimaryAdminGateActive(normPath) {
    if (!hasSecondary || primary.name !== 'supabase' || secondary?.name !== 'firebase') return false;
    if (Number(globalThis.__APC_PRIMARY_ONLY_ADMIN_GATE__) > 0) return true;
    return normPath === 'activePlusSync/v1/system/adminInitialized';
  }

  function preferredLegForPath(normPath, { writeOrTx = false } = {}) {
    if (!hasSecondary) return 'primary';
    if (Number(globalThis.__APC_PRIMARY_ONLY_ADMIN_GATE__) > 0 && primary.name === 'supabase') {
      return 'primary';
    }
    const inRealFailover = failoverUntil > 0 && Date.now() < failoverUntil;
    if (isStrictPrimaryAdminGateActive(normPath) && !inRealFailover) return 'primary';
    if (writeOrTx || isAuthoritativePrimaryPath(normPath)) {
      return inRealFailover ? 'secondary' : 'primary';
    }
    return preferredLegName();
  }

  async function get(node) {
    const norm = cleanPath(dualRefPath(node));
    const strictGate = Number(globalThis.__APC_PRIMARY_ONLY_ADMIN_GATE__) > 0 && primary.name === 'supabase';
    const first = preferredLegForPath(norm);
    try {
      const snap = await execLegGet(first, node);
      if (first === 'primary' && activeLegName === 'secondary' && !shardedToSecondary) {
        restorePrimaryLeg();
      }
      return snap;
    } catch (firstErr) {
      const inRealFailover = failoverUntil > 0 && Date.now() < failoverUntil;
      if (
        !hasSecondary ||
        strictGate ||
        (isStrictPrimaryAdminGateActive(norm) && !inRealFailover) ||
        !isFailoverEligibleError(firstErr)
      ) {
        throw firstErr;
      }
      const backup = alternateLegName(first);
      try {
        const snap = await execLegGet(backup, node);
        if (backup === 'secondary') activateFailover(firstErr?.message || 'read-failover');
        else restorePrimaryLeg();
        return snap;
      } catch {
        throw firstErr;
      }
    }
  }

  function dualRefPath(node) {
    return node?.path ?? node;
  }

  async function set(node, value) {
    const norm = cleanPath(node?.path ?? node);
    const strictGate = Number(globalThis.__APC_PRIMARY_ONLY_ADMIN_GATE__) > 0 && primary.name === 'supabase';
    const first = preferredLegForPath(norm, { writeOrTx: true });
    try {
      await execLegSet(first, node, value);
      scheduleStandbyMirror(norm, value, first);
      return;
    } catch (firstErr) {
      if (!hasSecondary || strictGate || !isFailoverEligibleError(firstErr)) throw firstErr;
      const backup = alternateLegName(first);
      await execLegSet(backup, node, value);
      if (backup === 'secondary') activateFailover(firstErr?.message || 'write-failover');
      else restorePrimaryLeg();
      scheduleStandbyMirror(norm, value, backup);
    }
  }

  async function runTransaction(node, updateFn) {
    const norm = cleanPath(node?.path ?? node);
    const strictGate = Number(globalThis.__APC_PRIMARY_ONLY_ADMIN_GATE__) > 0 && primary.name === 'supabase';
    const first = preferredLegForPath(norm, { writeOrTx: true });
    try {
      const res = await execLegTransaction(first, node, updateFn);
      if (res?.committed) {
        scheduleStandbyMirror(norm, res.snapshot?.val?.(), first);
      }
      return res;
    } catch (firstErr) {
      if (!hasSecondary || strictGate || !isFailoverEligibleError(firstErr)) throw firstErr;
      const backup = alternateLegName(first);
      const res = await execLegTransaction(backup, node, updateFn);
      if (backup === 'secondary') activateFailover(firstErr?.message || 'tx-failover');
      else restorePrimaryLeg();
      if (res?.committed) {
        scheduleStandbyMirror(norm, res.snapshot?.val?.(), backup);
      }
      return res;
    }
  }

  function onValue(node, callback, cancelCallback) {
    const norm = cleanPath(node?.path ?? node);

    if (norm === '.info/connected') {
      const entry = { callback, lastSent: undefined };
      connectedStreams.add(entry);

      if (!primaryConnUnsub) {
        const pConnRef = buildLegRef('primary', { path: '.info/connected', db: node?.db });
        primaryConnUnsub = primary.mod.onValue(pConnRef, snap => {
          primaryConnected = Boolean(snap?.val?.());
          if (!primaryConnected && hasSecondary && isBrowserOnline()) {
            ensureSecondaryConnectionMonitor();
          }
          broadcastConnectedState();
        });
      }
      if (activeLegName === 'secondary' && hasSecondary) {
        ensureSecondaryConnectionMonitor();
      }
      queueMicrotask(() => {
        if (!connectedStreams.has(entry)) return;
        const isConn = effectiveConnected();
        entry.lastSent = isConn;
        callback(makeBoolSnapshot('.info/connected', isConn));
      });

      return () => {
        connectedStreams.delete(entry);
        if (!connectedStreams.size) {
          if (typeof primaryConnUnsub === 'function') {
            try { primaryConnUnsub(); } catch {}
            primaryConnUnsub = null;
          }
          if (typeof secondaryConnUnsub === 'function') {
            try { secondaryConnUnsub(); } catch {}
            secondaryConnUnsub = null;
          }
        }
      };
    }

    const stream = {
      path: norm,
      db: node?.db,
      callback,
      onError: cancelCallback,
      lastFingerprint: undefined,
      currentLeg: null,
      unsubscribeLeg: null,
      closed: false
    };
    dataStreams.add(stream);
    rebindStreamToLeg(stream, preferredLegName());

    return () => {
      stream.closed = true;
      dataStreams.delete(stream);
      if (typeof stream.unsubscribeLeg === 'function') {
        try { stream.unsubscribeLeg(); } catch {}
        stream.unsubscribeLeg = null;
      }
    };
  }

  function getDualCloudState() {
    return {
      hasSecondary,
      activeLeg: activeLegName,
      activeProvider: activeLegName === 'secondary' && hasSecondary
        ? (secondary.name || 'firebase')
        : (primary.name || 'supabase'),
      failoverActive: activeLegName === 'secondary' && hasSecondary,
      failoverReason,
      failoverCount,
      failoverUntil,
      mirrorCount,
      loadSplitSecondaryPercent: splitPct,
      shardBucket,
      shardedToSecondary
    };
  }

  function destroy() {
    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
    for (const timer of mirrorTimers.values()) clearTimeout(timer);
    mirrorTimers.clear();
    for (const s of [...dataStreams]) {
      s.closed = true;
      if (typeof s.unsubscribeLeg === 'function') {
        try { s.unsubscribeLeg(); } catch {}
      }
    }
    dataStreams.clear();
  }

  return {
    app: dualApp,
    appCheckReady,
    getAuth,
    signInAnonymously,
    setPersistence,
    browserLocalPersistence,
    getDatabase,
    ref,
    get,
    set,
    runTransaction,
    onValue,
    activateFailover,
    restorePrimaryLeg,
    getDualCloudState,
    destroy
  };
}
