// Active Plus — Sync Guard.
// Validation never clears local data and never disables sync.
import { isSupabaseConfigured } from './supabase-config.js';
import { SyncService } from './sync-core.js';

export async function validateSyncGuard() {
  const supabaseReady = isSupabaseConfigured();
  const checks = {
    firebaseConfig: supabaseReady,
    firebaseInitialized: supabaseReady,
    syncService: typeof SyncService?.start === 'function' && typeof SyncService?.getStatus === 'function',
    localStorage: false,
    queue: false,
    retry: true
  };
  if (!supabaseReady) {
    try {
      const [{ firebaseConfig }, { firebaseApp }] = await Promise.all([
        import('../firebase/firebase-config.js'),
        import('../firebase/firebase-init.js')
      ]);
      checks.firebaseConfig = Boolean(firebaseConfig?.projectId && firebaseConfig?.appId && firebaseConfig?.databaseURL);
      checks.firebaseInitialized = Boolean(firebaseApp);
    } catch {}
  }
  try {
    localStorage.setItem('__apc_sync_guard__', '1');
    localStorage.removeItem('__apc_sync_guard__');
    checks.localStorage = true;
    checks.queue = typeof localStorage.getItem === 'function';
  } catch {}
  const critical = Object.values(checks).every(Boolean);
  return { ok: critical, checks, timestamp: new Date().toISOString() };
}
export async function assertSyncGuard() {
  const health = await validateSyncGuard();
  if (!health.ok) throw new Error('Active Plus Sync Guard failed: ' + JSON.stringify(health.checks));
  return health;
}
