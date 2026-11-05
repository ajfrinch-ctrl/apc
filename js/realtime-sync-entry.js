import { LEGACY_CLOUD_ENABLED } from '../sync/cloud-access.js';
/* Deferred, retryable sync. No page reload and no deletion of local data. */
import { reportSyncError, setSyncStatus } from '../sync/sync-status.js';
import { assertSyncGuard } from '../sync/sync-guard.js';
import { retryDelay } from '../sync/sync-retry.js';

let running = false;
let timer;
let idleScheduled = false;
let attempt = 0;
function cancelScheduled() {
  if (idleScheduled) window.cancelIdleCallback?.(timer);
  else clearTimeout(timer);
  idleScheduled = false;
}
function schedule(delay = 0) {
  cancelScheduled();
  if (!LEGACY_CLOUD_ENABLED) { setSyncStatus('paused'); return; }
  if (delay) { timer = setTimeout(bootRealtimeSync, delay); return; }
  // Sync should start as soon as the UI is usable, but never block it: the
  // first idle moment wins, with a hard cap so an idle-less browser still
  // connects quickly.
  if (typeof window.requestIdleCallback === 'function') {
    idleScheduled = true;
    timer = window.requestIdleCallback(bootRealtimeSync, { timeout: 600 });
  } else {
    timer = setTimeout(bootRealtimeSync, 250);
  }
}

async function bootRealtimeSync() {
  if (!LEGACY_CLOUD_ENABLED) { setSyncStatus('paused'); return; }
  if (!maySync()) return;
  if (!navigator.onLine) { setSyncStatus('offline'); return; }
  try {
    const { hasSyncSession } = await import('./sync-session.js');
    if (!(await hasSyncSession())) return;
  } catch { return; }
  if (running) return;
  running = true;
  setSyncStatus('connecting');
  try {
    await assertSyncGuard();
    const { startRealtimeSync } = await import('../sync/sync-core.js?v=470');
    const result = await startRealtimeSync();
    if (!result?.ok) {
      if (result?.reason !== 'session-ended' && result?.reason !== 'authentication-required') {
        if (result?.error) reportSyncError(result.error);
        if (maySync()) schedule(retryDelay(attempt++));
      }
    } else {
      attempt = 0;
      // The RTDB listeners and outbox own reconnects while healthy. Polling
      // start() here used to turn a short outage into repeated full boots.
    }
  } catch (error) {
    reportSyncError(error);
    if (maySync()) schedule(retryDelay(attempt++));
  } finally {
    running = false;
  }
}

/* Authenticated role-scoped V2 controllers (activePlusV2: Question Bank + Notices).
   They run next to the legacy bridge, never instead of it: the bridge keeps
   syncing every v1 collection, while these controllers activate solely from
   a signed-in user's custom claims — the same selector the server rules
   enforce — so a device without V2 claims stays a zero-traffic no-op until
   the staged migration provisions them. While LEGACY_CLOUD_ENABLED is true,
   staged v2 controller errors never overwrite a healthy v1 topbar verdict. */
let v2Running = false;
let v2Attempt = 0;
let v2Timer = null;

function reportStagedV2Error(error) {
  if (!LEGACY_CLOUD_ENABLED) {
    reportSyncError(error);
    return;
  }
  console.warn('[Active Plus] staged v2 sync deferred:', error?.code || error?.name || 'unknown');
}

function scheduleV2(delay) {
  window.clearTimeout(v2Timer);
  if (!LEGACY_CLOUD_ENABLED || !maySync()) return;
  v2Timer = window.setTimeout(bootStagedV2Sync, delay);
}

async function bootStagedV2Sync() {
  if (!LEGACY_CLOUD_ENABLED) return;
  if (!maySync() || !navigator.onLine || v2Running) return;
  try {
    const { hasSyncSession } = await import('./sync-session.js');
    if (!(await hasSyncSession())) return;
  } catch { return; }
  v2Running = true;
  try {
    const [
      { startQuestionBankV2Sync },
      { questionBankV2RetryDecision },
      { startNoticesV2Sync },
      { noticesV2RetryDecision }
    ] = await Promise.all([
      import('../sync/question-bank-v2-sync.js'),
      import('../sync/question-bank-v2-policy.js'),
      import('../sync/notices-v2-sync.js'),
      import('../sync/notices-v2-policy.js')
    ]);
    const [qbResult, noticesResult] = await Promise.all([
      startQuestionBankV2Sync(),
      startNoticesV2Sync()
    ]);
    const qbDecision = questionBankV2RetryDecision(qbResult);
    const noticesDecision = noticesV2RetryDecision(noticesResult);
    if (qbDecision.retry || noticesDecision.retry) {
      scheduleV2(retryDelay(v2Attempt++));
    } else {
      v2Attempt = 0;
    }
  } catch (error) {
    reportStagedV2Error(error);
    scheduleV2(retryDelay(v2Attempt++));
  } finally {
    v2Running = false;
  }
}

async function stopQuestionBankV2() {
  window.clearTimeout(v2Timer);
  v2Attempt = 0;
  try {
    const [{ stopQuestionBankV2Sync }, { stopNoticesV2Sync }] = await Promise.all([
      import('../sync/question-bank-v2-sync.js'),
      import('../sync/notices-v2-sync.js')
    ]);
    stopQuestionBankV2Sync();
    stopNoticesV2Sync();
  } catch { /* modules never loaded — nothing to stop */ }
}

/* No on-screen sync message: the topbar's top border
   (js/topbar-connectivity.js) is the only standing sync status, and sync still
   retries on its own backoff. The login page must not fetch/sync account or
   application collections before a user has signed in. */
function mountSync() {
  if (maySync()) schedule();
  if (maySync()) scheduleV2(400);
  if (maySync()) mountNotifications();
}

function maySync() {
  return !document.getElementById('authScreen') || document.getElementById('authScreen').hidden;
}
/* The notification centre is optional: a failure there never delays sync. */
function mountNotifications() {
  import('./notifications.js')
    .then(module => module.initNotifications())
    .catch(error => console.warn('[Active Plus] notifications unavailable:', error?.name || 'unknown'));
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', mountSync, { once: true });
else mountSync();

window.addEventListener('apc-session-ready', () => { if (!maySync()) return; mountNotifications(); schedule(0); scheduleV2(0); });
window.addEventListener('apc-session-ended', () => {
  cancelScheduled();
  attempt = 0;
  void stopQuestionBankV2();
});
window.addEventListener('online', () => { if (maySync()) { schedule(250); scheduleV2(250); } });
window.addEventListener('offline', () => { cancelScheduled(); window.clearTimeout(v2Timer); setSyncStatus(LEGACY_CLOUD_ENABLED ? 'offline' : 'paused'); });
window.addEventListener('apc-sync-retry', () => { if (maySync()) { schedule(0); scheduleV2(0); } });
