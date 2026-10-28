/* Apply only the raw localStorage collections exported by Admin backups.
   A failed write rolls back all keys already changed, on a best-effort basis;
   storage can itself become unavailable, in which case the caller must warn. */
export function prepareBackupRestore(data, allowedKeys) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('INVALID_BACKUP_DATA');
  const allowed = new Set(allowedKeys);
  const entries = Object.entries(data).filter(([key]) => allowed.has(key));
  if (!entries.length || entries.some(([, value]) => typeof value !== 'string')) {
    throw new Error('INVALID_BACKUP_COLLECTIONS');
  }
  return entries;
}

export function applyBackupRestore(storage, entries) {
  // Snapshot all targets before the first write. A failure here changes nothing.
  const originals = new Map(entries.map(([key]) => [key, storage.getItem(key)]));
  const touched = [];
  try {
    for (const [key, value] of entries) {
      storage.setItem(key, value);
      touched.push(key);
    }
  } catch (cause) {
    let rollbackFailed = false;
    // Free any new/larger values first, so originals that already fitted have
    // the best chance of fitting again under the same quota.
    for (const key of touched) {
      try { storage.removeItem(key); } catch { rollbackFailed = true; }
    }
    for (const key of touched) {
      const original = originals.get(key);
      if (original !== null) {
        try { storage.setItem(key, original); } catch { rollbackFailed = true; }
      }
    }
    throw new Error(rollbackFailed ? 'BACKUP_RESTORE_ROLLBACK_FAILED' : 'BACKUP_RESTORE_FAILED', { cause });
  }
}
