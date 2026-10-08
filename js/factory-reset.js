/* Factory reset — the local half (docs/FACTORY-RESET.md).
   The cloud half lives in js/realtime-sync.js (`resetCloudDatabase`), reached
   through the sync boundary (sync/sync-core.js). This module only clears THIS
   device: every Active Plus key in localStorage and the whole sessionStorage.

   Every key the app owns starts with `activePlus` or `active-plus`
   (js/database.js KEYS/STAFF_KEYS, sessions, device ids, settings, sync
   outboxes, notification records…). Anything else in the browser's storage
   does not belong to the app and is left untouched. */

const APP_PREFIXES = Object.freeze(['activePlus', 'active-plus']);

const isAppKey = key => typeof key === 'string' && APP_PREFIXES.some(prefix => key.startsWith(prefix));

/**
 * Remove every app-owned record from this device's storage.
 * Returns the list of removed localStorage keys (for tests/diagnostics).
 * Never throws — a blocked storage must not strand the reset flow.
 */
export function clearLocalAppData() {
  const removed = [];
  try {
    const storage = window.localStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!isAppKey(key)) continue;
      storage.removeItem(key);
      removed.push(key);
    }
  } catch { /* storage unavailable: nothing to clear */ }
  try {
    window.sessionStorage.clear();
  } catch { /* storage unavailable: nothing to clear */ }
  return removed;
}
