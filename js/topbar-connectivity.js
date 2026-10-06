/* Presentation only: the sync indicator is the topbar's own top border.
   There is no chip, label, toast or standing message anywhere — the colour of
   that one thin line is the entire status, and it stays after a transfer ends
   so the last verdict is always readable.

     synced  (green) — the last Firebase read/write was confirmed, data is synchronized
     syncing (amber) — a transfer is running, or the outbox still has pending work
     error   (red)   — sync failed, offline, conflict or a storage problem
     idle    (grey)  — sync has not started, is paused, or has no verdict yet

   Reads only the data attributes js/sync-status.js already publishes; transport,
   authentication, local data and the sync engine itself are untouched. */
(() => {
  const FAILED = new Set(['error', 'offline', 'conflict', 'storage']);
  const WORKING = new Set(['pending', 'connecting']);
  const ANNOUNCE = {
    synced: 'ক্লাউড সিঙ্ক সম্পন্ন',
    syncing: 'ক্লাউড সিঙ্ক চলছে',
    error: 'ক্লাউড সিঙ্কে সমস্যা',
    idle: ''
  };

  /** The colour-only verdict for the bar's top border. */
  function visualState() {
    const data = document.documentElement?.dataset || {};
    const online = typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
    const state = data.realtimeSync || '';
    if (!online || FAILED.has(state)) return 'error';
    if (WORKING.has(state)) return 'syncing';
    // The cloud is reachable, but the first successful read/write is not
    // confirmed yet: "online" alone is not a finished sync.
    if (state === 'online') return data.firebaseLastSync ? 'synced' : 'syncing';
    return 'idle';
  }

  /* Screen readers still get the state: one visually hidden live region, kept
     outside the bar so no panel shows a sync label. */
  function announce(state) {
    const text = ANNOUNCE[state] || '';
    let live = document.getElementById('apcSyncAnnounce');
    if (!live) {
      if (!text || !document.body) return;
      live = document.createElement('span');
      live.id = 'apcSyncAnnounce';
      live.className = 'apc-sync-announce';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      document.body.append(live);
    }
    if (live.textContent !== text) live.textContent = text;
  }

  function update() {
    const root = document.documentElement;
    if (!root) return;
    const state = visualState();
    if (root.dataset.syncVisual !== state) root.dataset.syncVisual = state;
    announce(state);
  }

  update();
  // One attribute on <html> colours every topbar — including a bar rendered
  // later — so there is no per-bar DOM work and nothing to observe for it.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', update, { once: true });
  }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  // A finished transfer and a settled outbox both change these attributes.
  new MutationObserver(update).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-realtime-sync', 'data-firebase-last-sync']
  });
})();
