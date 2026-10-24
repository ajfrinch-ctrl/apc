// Active Plus Coaching — Supabase Realtime hierarchical sync transport.
// Provides the exact ref / get / set / runTransaction / onValue / .info/connected
// contract expected by js/realtime-sync.js and js/daily-advice.js, backed by
// PostgreSQL 17 atomic CAS RPCs + Supabase Realtime (postgres_changes + broadcast).

import { createClient } from '../vendor/supabase/sdk.js';
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_REALTIME_CHANNEL,
  supabaseConfig,
  isSupabaseConfigured
} from './supabase-config.js';
import {
  encryptCloudSubtree,
  decryptCloudSubtree
} from './cloud-payload-crypto.js';

const COALESCE_MS = 25;
const MAX_CAS_RETRIES = 18;
const RECONNECT_BASE_MS = 1500;
const RECONNECT_MAX_MS = 15000;
const FALLBACK_POLL_MS = 2500;
const INITIAL_CONNECT_TIMEOUT_MS = 1100;
const RPC_TIMEOUT_MS = 6000;
const UNREACHABLE_COOLDOWN_MS = 8000;
const DEFAULT_IDLE_HIBERNATE_MS = 30000;

let clientInstance = null;
let realtimeChannel = null;
let channelSubscribing = false;
let wsSubscribed = false;
let wsConnected = false;
let rpcHealthy = false;
let hibernated = false;
let hibernateTimer = null;
let consecutiveRpcFailures = 0;
let unreachableUntil = 0;
let reconnectTimer = null;
let reconnectAttempt = 0;
let fallbackPollTimer = null;
let serverOffsetMs = 0;
let lifecycleBound = false;

const connectionListeners = new Set();
const dataListeners = new Set();
const overloadListeners = new Set();

function getIdleHibernateMs() {
  const custom = Number(globalThis.__APC_IDLE_HIBERNATE_MS__);
  return Number.isFinite(custom) && custom >= 20 ? custom : DEFAULT_IDLE_HIBERNATE_MS;
}

function isDocumentHidden() {
  const doc = globalThis.document;
  if (!doc) return false;
  return doc.visibilityState === 'hidden' || doc.hidden === true;
}

function syncHibernationDataset() {
  try {
    if (globalThis.document?.documentElement?.dataset) {
      globalThis.document.documentElement.dataset.wsHibernated = hibernated ? 'true' : 'false';
      globalThis.document.documentElement.dataset.cloudEncrypted = 'aes-256-gcm';
    }
  } catch { /* non-DOM context */ }
}

function emitOverload(detail) {
  for (const listener of [...overloadListeners]) {
    try {
      listener(detail);
    } catch { /* ignore observer errors */ }
  }
}

export function onSupabaseOverload(listener) {
  if (typeof listener !== 'function') return () => {};
  overloadListeners.add(listener);
  return () => {
    overloadListeners.delete(listener);
  };
}

function fetchWithTimeout(input, init = {}) {
  const baseFetch = globalThis.fetch;
  if (typeof baseFetch !== 'function') {
    return Promise.reject(new Error('Global fetch is unavailable'));
  }
  if (Date.now() < unreachableUntil) {
    const fastErr = new Error('Supabase endpoint temporarily unreachable');
    fastErr.code = 'network-request-failed';
    fastErr.isOverload = consecutiveRpcFailures >= 2;
    return Promise.reject(fastErr);
  }
  if (init?.signal) return baseFetch(input, init);
  const controller = new AbortController();
  const timeoutMs = rpcHealthy ? RPC_TIMEOUT_MS : INITIAL_CONNECT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(new Error('Supabase request timed out')), timeoutMs);
  if (typeof timer?.unref === 'function') timer.unref();
  return baseFetch(input, { ...init, signal: controller.signal })
    .then(res => {
      if (res && (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504)) {
        consecutiveRpcFailures += 1;
        emitOverload({
          reason: res.status === 429 ? 'rate-limited' : 'service-overloaded',
          status: res.status,
          consecutiveRpcFailures
        });
      } else if (res && res.ok) {
        unreachableUntil = 0;
        consecutiveRpcFailures = 0;
      }
      return res;
    })
    .catch(err => {
      consecutiveRpcFailures += 1;
      unreachableUntil = Date.now() + UNREACHABLE_COOLDOWN_MS;
      if (consecutiveRpcFailures >= 1) {
        emitOverload({
          reason: 'network-or-timeout',
          message: String(err?.message || err || ''),
          consecutiveRpcFailures
        });
      }
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

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

function makeSnapshot(path, value, existsOverride = undefined) {
  const exists = existsOverride !== undefined
    ? Boolean(existsOverride && value !== null && value !== undefined)
    : (value !== null && value !== undefined);
  const safeVal = exists ? value : null;
  const key = keyOfPath(path);
  return {
    key,
    exists: () => exists,
    val: () => cloneJson(safeVal)
  };
}

function pathsOverlap(pathA, pathB) {
  if (!pathA || !pathB) return false;
  return pathA === pathB || pathA.startsWith(pathB + '/') || pathB.startsWith(pathA + '/');
}

function normalizeSupabaseError(error, fallbackMessage = 'Supabase request failed') {
  if (!error) return new Error(fallbackMessage);
  const message = String(error.message || error.details || error || fallbackMessage);
  const code = String(error.code || error.status || '');
  const wrapped = new Error(message);
  const isCapacityOrRate =
    code === '429' ||
    code === '503' ||
    code === '53300' ||
    /too[_ -]?many[_ -]?connections|max[_ -]?connections|rate[_ -]?limit|quota|overloaded|capacity|concurrent/i.test(message);
  if (code === '42501' || /permission[-_ ]denied|row-level security|outside allowed namespace/i.test(message)) {
    wrapped.code = 'permission-denied';
  } else if (isCapacityOrRate) {
    wrapped.code = 'unavailable';
    wrapped.isOverload = true;
    emitOverload({ reason: 'capacity-or-quota', code, message, consecutiveRpcFailures });
  } else if (/fetch|network|offline|timed?\s*out|econn|enotfound|unreachable/i.test(message)) {
    wrapped.code = 'network-request-failed';
    wrapped.isOverload = true;
  } else if (code) {
    wrapped.code = code;
  }
  return wrapped;
}

function setConnectedState(nextConnected) {
  const normalized = Boolean(nextConnected && isBrowserOnline());
  if (wsConnected === normalized) return;
  wsConnected = normalized;
  const snap = makeSnapshot('.info/connected', wsConnected, true);
  for (const listener of [...connectionListeners]) {
    try {
      listener.callback(snap);
    } catch (err) {
      console.warn('[Active Plus] Supabase connection listener error:', err);
    }
  }
}

export function getSupabaseClient() {
  if (clientInstance) return clientInstance;
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase configuration is incomplete');
  }
  const realtimeOpts = {
    params: { eventsPerSecond: 40 }
  };
  if (typeof globalThis.WebSocket === 'function') {
    realtimeOpts.transport = globalThis.WebSocket;
  }
  clientInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      fetch: fetchWithTimeout
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    realtime: realtimeOpts
  });
  bindBrowserLifecycle();
  return clientInstance;
}

function scheduleReconnect() {
  if (hibernated) return;
  if (reconnectTimer || (!connectionListeners.size && !dataListeners.size)) return;
  if (!isBrowserOnline()) return;
  const delay = Math.min(RECONNECT_BASE_MS * (2 ** reconnectAttempt), RECONNECT_MAX_MS);
  reconnectAttempt = Math.min(reconnectAttempt + 1, 6);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isBrowserOnline() || hibernated) return;
    teardownChannelOnly();
    ensureRealtimeChannel();
  }, delay);
  if (typeof reconnectTimer?.unref === 'function') reconnectTimer.unref();
}

function ensureFallbackPoll() {
  if (fallbackPollTimer) return;
  fallbackPollTimer = setInterval(() => {
    if (!isBrowserOnline() || !dataListeners.size) return;
    // Zero background HTTP polling while tab is hidden/hibernated or live WS is subscribed.
    if (hibernated || isDocumentHidden()) return;
    if (wsSubscribed && realtimeChannel) return;
    for (const sub of [...dataListeners]) {
      scheduleListenerRefresh(sub, 0);
    }
  }, FALLBACK_POLL_MS);
  if (typeof fallbackPollTimer?.unref === 'function') fallbackPollTimer.unref();
}

function clearHibernateTimer() {
  if (hibernateTimer) {
    clearTimeout(hibernateTimer);
    hibernateTimer = null;
  }
}

export function enterIdleHibernation() {
  clearHibernateTimer();
  if (hibernated) return false;
  hibernated = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // Release the live WebSocket slot so active foreground users keep full capacity,
  // while keeping local session & outbox calm (no false red disconnect state).
  teardownChannelOnly();
  syncHibernationDataset();
  return true;
}

export function resumeFromHibernation() {
  clearHibernateTimer();
  const wasHibernated = hibernated;
  hibernated = false;
  syncHibernationDataset();
  if (!isBrowserOnline()) return false;
  unreachableUntil = 0;
  reconnectAttempt = 0;
  if (connectionListeners.size || dataListeners.size) {
    if (!realtimeChannel) ensureRealtimeChannel();
    if (wasHibernated) {
      for (const sub of [...dataListeners]) {
        scheduleListenerRefresh(sub, 15);
      }
    }
  }
  return wasHibernated;
}

export function getSupabaseLoadState() {
  return {
    hibernated,
    wsSubscribed,
    wsConnected,
    rpcHealthy,
    hasRealtimeChannel: Boolean(realtimeChannel),
    activeListeners: dataListeners.size,
    consecutiveRpcFailures
  };
}

function teardownChannelOnly() {
  const ch = realtimeChannel;
  realtimeChannel = null;
  channelSubscribing = false;
  wsSubscribed = false;
  if (ch && clientInstance) {
    try { void clientInstance.removeChannel(ch); } catch {}
  }
  if (clientInstance?.realtime && typeof clientInstance.realtime.disconnect === 'function') {
    try { clientInstance.realtime.disconnect(); } catch {}
  }
}

export function disconnectSupabaseRealtime() {
  clearHibernateTimer();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (fallbackPollTimer) {
    clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }
  for (const sub of dataListeners) {
    if (sub.timer) clearTimeout(sub.timer);
  }
  teardownChannelOnly();
  hibernated = false;
  wsConnected = false;
  rpcHealthy = false;
  consecutiveRpcFailures = 0;
  unreachableUntil = 0;
  syncHibernationDataset();
}

function handleVisibilityChange() {
  if (isDocumentHidden()) {
    clearHibernateTimer();
    if (!connectionListeners.size && !dataListeners.size) return;
    hibernateTimer = setTimeout(() => {
      hibernateTimer = null;
      if (isDocumentHidden()) enterIdleHibernation();
    }, getIdleHibernateMs());
    if (typeof hibernateTimer?.unref === 'function') hibernateTimer.unref();
    return;
  }
  resumeFromHibernation();
}

function bindBrowserLifecycle() {
  if (lifecycleBound) return;
  lifecycleBound = true;
  syncHibernationDataset();
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('offline', () => {
      wsSubscribed = false;
      setConnectedState(false);
    });
    globalThis.addEventListener('online', () => {
      unreachableUntil = 0;
      consecutiveRpcFailures = 0;
      reconnectAttempt = 0;
      if (!isDocumentHidden()) {
        resumeFromHibernation();
      }
      if (!hibernated && (connectionListeners.size || dataListeners.size)) {
        if (!realtimeChannel) ensureRealtimeChannel();
        for (const sub of [...dataListeners]) {
          scheduleListenerRefresh(sub, 10);
        }
      }
    });
    globalThis.addEventListener('focus', () => {
      if (!isDocumentHidden() && hibernated) resumeFromHibernation();
    });
    globalThis.addEventListener('pageshow', () => {
      if (!isDocumentHidden() && hibernated) resumeFromHibernation();
    });
  }
  if (typeof globalThis.document?.addEventListener === 'function') {
    globalThis.document.addEventListener('visibilitychange', handleVisibilityChange);
  }
}

function handleIncomingPathChange(changedPath) {
  const norm = cleanPath(changedPath);
  if (!norm) return;
  for (const sub of dataListeners) {
    if (pathsOverlap(sub.path, norm)) {
      scheduleListenerRefresh(sub, COALESCE_MS);
    }
  }
}

function ensureRealtimeChannel() {
  if (!isBrowserOnline()) return null;
  if (hibernated && isDocumentHidden()) return null;
  if (hibernated && !isDocumentHidden()) {
    hibernated = false;
    syncHibernationDataset();
  }
  if (realtimeChannel || channelSubscribing) return realtimeChannel;
  const supabase = getSupabaseClient();
  channelSubscribing = true;

  const channel = supabase
    .channel(SUPABASE_REALTIME_CHANNEL, {
      config: {
        broadcast: { self: false, ack: false }
      }
    })
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'apc_sync_nodes' },
      payload => {
        const changedPath = payload?.new?.path || payload?.old?.path || '';
        if (changedPath) handleIncomingPathChange(changedPath);
      }
    )
    .on('broadcast', { event: 'apc_path_changed' }, message => {
      const changedPath = message?.payload?.path || '';
      if (changedPath) handleIncomingPathChange(changedPath);
    });

  realtimeChannel = channel;
  ensureFallbackPoll();

  channel.subscribe(status => {
    channelSubscribing = false;
    if (realtimeChannel !== channel) return;
    if (status === 'SUBSCRIBED') {
      wsSubscribed = true;
      unreachableUntil = 0;
      reconnectAttempt = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setConnectedState(true);
      return;
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      wsSubscribed = false;
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        emitOverload({ reason: `realtime-${status.toLowerCase()}`, consecutiveRpcFailures });
      }
      // Keep sync alive via HTTPS fallback only if WebSocket is blocked while RPCs succeed;
      // if browser went offline or RPCs are failing, surface disconnected immediately.
      if (!isBrowserOnline() || !rpcHealthy) {
        setConnectedState(false);
      }
      if (!hibernated) scheduleReconnect();
    }
  });

  return channel;
}

function broadcastPathChange(normPath, version = '') {
  try {
    if (!realtimeChannel || !wsConnected) return;
    void realtimeChannel.send({
      type: 'broadcast',
      event: 'apc_path_changed',
      payload: { path: normPath, version, ts: Date.now() }
    }).catch(() => {});
  } catch { /* best-effort low-latency hint; postgres_changes is authoritative */ }
}

async function fetchSubtreeRaw(normPath) {
  if (!isBrowserOnline()) {
    rpcHealthy = false;
    setConnectedState(false);
    const err = new Error('Device is offline');
    err.code = 'network-request-failed';
    throw err;
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('apc_get_subtree', { p_path: normPath });
  if (error) {
    const wrapped = normalizeSupabaseError(error, `apc_get_subtree failed for ${normPath}`);
    if (wrapped.code === 'network-request-failed') {
      rpcHealthy = false;
      setConnectedState(false);
    }
    throw wrapped;
  }
  rpcHealthy = true;
  if (typeof data?.serverTimeMs === 'number' && Number.isFinite(data.serverTimeMs)) {
    serverOffsetMs = data.serverTimeMs - Date.now();
  }
  // If WebSocket handshake is still joining or blocked by a proxy, a verified
  // HTTPS RPC proves live Supabase reachability so sync does not stall.
  if (!wsConnected && isBrowserOnline() && connectionListeners.size > 0) {
    setConnectedState(true);
  }
  const hasRaw = Boolean(data?.exists && data?.value !== null && data?.value !== undefined);
  const dec = hasRaw
    ? await decryptCloudSubtree(normPath, data.value)
    : { value: null, plainByPath: new Map(), cipherByPath: new Map() };
  const exists = Boolean(hasRaw && dec.value !== null && dec.value !== undefined);
  return {
    exists,
    value: exists ? dec.value : null,
    plainByPath: dec.plainByPath,
    cipherByPath: dec.cipherByPath,
    version: String(data?.version || '0:0:0'),
    serverTimeMs: Number(data?.serverTimeMs) || Date.now()
  };
}

function scheduleListenerRefresh(sub, delayMs = COALESCE_MS) {
  if (sub.closed) return;
  if (sub.timer) return;
  sub.timer = setTimeout(async () => {
    sub.timer = null;
    if (sub.closed) return;
    if (sub.inFlight) {
      sub.needsRerun = true;
      return;
    }
    sub.inFlight = true;
    try {
      const res = await fetchSubtreeRaw(sub.path);
      if (sub.closed) return;
      if (sub.lastVersion !== res.version) {
        sub.lastVersion = res.version;
        sub.callback(makeSnapshot(sub.path, res.value, res.exists));
      }
    } catch (error) {
      if (!sub.closed && typeof sub.onError === 'function' && error?.code === 'permission-denied') {
        sub.onError(error);
      }
    } finally {
      sub.inFlight = false;
      if (sub.needsRerun && !sub.closed) {
        sub.needsRerun = false;
        scheduleListenerRefresh(sub, COALESCE_MS);
      }
    }
  }, delayMs);
}

function notifyLocalListenersAfterMutation(mutatedPath, directResult = null) {
  for (const sub of dataListeners) {
    if (sub.closed || !pathsOverlap(sub.path, mutatedPath)) continue;
    if (directResult && sub.path === mutatedPath) {
      if (sub.lastVersion !== directResult.version) {
        sub.lastVersion = directResult.version;
        const snap = makeSnapshot(sub.path, directResult.value, directResult.exists);
        queueMicrotask(() => {
          if (!sub.closed) sub.callback(snap);
        });
      }
    } else {
      scheduleListenerRefresh(sub, 5);
    }
  }
}

/* ---- Firebase-compatible adapter surface for js/realtime-sync.js ---- */

export const supabaseApp = Object.freeze({
  name: '[SUPABASE]',
  provider: 'supabase',
  options: supabaseConfig
});

export const appCheckReady = Promise.resolve();
export const browserLocalPersistence = Object.freeze({ type: 'LOCAL' });

const authState = {
  currentUser: null,
  async authStateReady() {}
};

export function getAuth() {
  return authState;
}

export async function setPersistence() {
  return undefined;
}

export async function signInAnonymously(auth = authState) {
  if (!isBrowserOnline()) {
    const err = new Error('Network unavailable during cloud auth');
    err.code = 'auth/network-request-failed';
    throw err;
  }
  getSupabaseClient();
  const user = Object.freeze({
    uid: 'supabase-anon-client',
    isAnonymous: true,
    provider: 'supabase',
    getIdTokenResult: async () => ({
      claims: { provider: 'supabase', role: 'anon' }
    })
  });
  auth.currentUser = user;
  return { user };
}

export function getDatabase() {
  return { provider: 'supabase', client: getSupabaseClient() };
}

export function ref(_db, path) {
  const norm = cleanPath(path);
  return {
    __apcSupabaseRef: true,
    path: norm,
    key: keyOfPath(norm)
  };
}

export async function get(node) {
  const norm = cleanPath(node?.path ?? node);
  if (norm === '.info/connected') {
    ensureRealtimeChannel();
    return makeSnapshot('.info/connected', wsConnected, true);
  }
  if (norm === '.info/serverTimeOffset') {
    if (!isBrowserOnline()) {
      const err = new Error('Offline');
      err.code = 'network-request-failed';
      throw err;
    }
    const supabase = getSupabaseClient();
    const t0 = Date.now();
    const { data, error } = await supabase.rpc('apc_server_time_ms');
    if (error) throw normalizeSupabaseError(error, 'apc_server_time_ms failed');
    const rttHalf = Math.round((Date.now() - t0) / 2);
    serverOffsetMs = Number(data) - (Date.now() - rttHalf);
    rpcHealthy = true;
    return makeSnapshot('.info/serverTimeOffset', serverOffsetMs, true);
  }
  const res = await fetchSubtreeRaw(norm);
  return makeSnapshot(norm, res.value, res.exists);
}

export async function set(node, value) {
  const norm = cleanPath(node?.path ?? node);
  if (!isBrowserOnline()) {
    rpcHealthy = false;
    setConnectedState(false);
    const err = new Error('Device is offline');
    err.code = 'network-request-failed';
    throw err;
  }
  const supabase = getSupabaseClient();
  const payload = (value === undefined || value === null)
    ? null
    : await encryptCloudSubtree(norm, value, { serverOffsetMs });
  const { data, error } = await supabase.rpc('apc_set_subtree', {
    p_path: norm,
    p_value: payload
  });
  if (error) {
    const wrapped = normalizeSupabaseError(error, `apc_set_subtree failed for ${norm}`);
    if (wrapped.code === 'network-request-failed') {
      rpcHealthy = false;
      setConnectedState(false);
    }
    throw wrapped;
  }
  rpcHealthy = true;
  if (!wsConnected && isBrowserOnline() && connectionListeners.size > 0) {
    setConnectedState(true);
  }
  const version = String(data?.version || '');
  broadcastPathChange(norm, version);
  notifyLocalListenersAfterMutation(norm, null);
}

export async function runTransaction(node, updateFn) {
  const norm = cleanPath(node?.path ?? node);
  if (!isBrowserOnline()) {
    rpcHealthy = false;
    setConnectedState(false);
    const err = new Error('Device is offline');
    err.code = 'network-request-failed';
    throw err;
  }
  const supabase = getSupabaseClient();
  let state = await fetchSubtreeRaw(norm);

  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt += 1) {
    const draftInput = state.exists ? cloneJson(state.value) : null;
    const nextValue = updateFn(draftInput);

    // Returning `undefined` aborts the transaction cleanly (Firebase RTDB contract).
    if (nextValue === undefined) {
      return {
        committed: false,
        snapshot: makeSnapshot(norm, state.value, state.exists)
      };
    }

    const encryptedNext = nextValue === null
      ? null
      : await encryptCloudSubtree(norm, nextValue, {
          serverOffsetMs,
          prevPlainByPath: state.plainByPath,
          prevCipherByPath: state.cipherByPath
        });

    const { data, error } = await supabase.rpc('apc_cas_subtree', {
      p_path: norm,
      p_expected_version: state.version,
      p_value: encryptedNext
    });
    if (error) {
      const wrapped = normalizeSupabaseError(error, `apc_cas_subtree failed for ${norm}`);
      if (wrapped.code === 'network-request-failed') {
        rpcHealthy = false;
        setConnectedState(false);
      }
      throw wrapped;
    }

    rpcHealthy = true;
    if (data?.committed === true) {
      const hasRaw = Boolean(data?.exists && data?.value !== null && data?.value !== undefined);
      const dec = hasRaw
        ? await decryptCloudSubtree(norm, data.value)
        : { value: null, plainByPath: new Map(), cipherByPath: new Map() };
      const committedRes = {
        exists: Boolean(hasRaw && dec.value !== null && dec.value !== undefined),
        value: hasRaw ? dec.value : null,
        version: String(data?.version || '0:0:0')
      };
      broadcastPathChange(norm, committedRes.version);
      notifyLocalListenersAfterMutation(norm, committedRes);
      return {
        committed: true,
        snapshot: makeSnapshot(norm, committedRes.value, committedRes.exists)
      };
    }

    // Conflict: server returned the fresh encrypted subtree + version; decrypt & retry immediately!
    const hasConflictRaw = Boolean(data?.exists && data?.value !== null && data?.value !== undefined);
    const conflictDec = hasConflictRaw
      ? await decryptCloudSubtree(norm, data.value)
      : { value: null, plainByPath: new Map(), cipherByPath: new Map() };
    state = {
      exists: Boolean(hasConflictRaw && conflictDec.value !== null && conflictDec.value !== undefined),
      value: hasConflictRaw ? conflictDec.value : null,
      plainByPath: conflictDec.plainByPath,
      cipherByPath: conflictDec.cipherByPath,
      version: String(data?.version || '0:0:0'),
      serverTimeMs: Number(data?.serverTimeMs) || Date.now()
    };
  }

  const retryErr = new Error(`Supabase CAS transaction exceeded ${MAX_CAS_RETRIES} retries on ${norm}`);
  retryErr.code = 'max-retries-exceeded';
  throw retryErr;
}

export function onValue(node, callback, cancelCallback) {
  const norm = cleanPath(node?.path ?? node);

  if (norm === '.info/connected') {
    const entry = { callback };
    connectionListeners.add(entry);
    ensureRealtimeChannel();
    queueMicrotask(() => {
      if (connectionListeners.has(entry)) {
        callback(makeSnapshot('.info/connected', wsConnected, true));
      }
    });
    return () => {
      connectionListeners.delete(entry);
    };
  }

  if (norm === '.info/serverTimeOffset') {
    let active = true;
    void get(node).then(snap => {
      if (active) callback(snap);
    }).catch(err => {
      if (active && typeof cancelCallback === 'function') cancelCallback(err);
    });
    return () => { active = false; };
  }

  const sub = {
    path: norm,
    callback,
    onError: cancelCallback,
    lastVersion: null,
    timer: null,
    inFlight: false,
    needsRerun: false,
    closed: false
  };
  dataListeners.add(sub);
  ensureRealtimeChannel();
  scheduleListenerRefresh(sub, 0);

  return () => {
    sub.closed = true;
    if (sub.timer) {
      clearTimeout(sub.timer);
      sub.timer = null;
    }
    dataListeners.delete(sub);
  };
}
