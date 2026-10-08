import { LEGACY_CLOUD_ENABLED, cloudPausedResult } from '../sync/cloud-access.js';
// Active Plus — real Firebase connection smoke test.
// This is diagnostic only; it never changes local app data.

import { firebaseConfig } from '../firebase/firebase-config.js';

export async function testFirebaseOnlineConnection(timeout = 8000) {
  if (!LEGACY_CLOUD_ENABLED) return cloudPausedResult();
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  try {
    /* Diagnostic-only: the transport must be testable on a device with NO app
       login yet — that is exactly when a broken bridge needs diagnosing. The
       sync engine itself still requires an app session (sync-session.js). */
    const { firebaseApp, appCheckReady } = await import('../firebase/firebase-init.js');
    const { getAuth, signInAnonymously, getDatabase, ref, onValue, get } = await import('../firebase/firebase-services.js');
    await appCheckReady;
    const auth = getAuth(firebaseApp);
    await auth.authStateReady();
    if (!auth.currentUser) await signInAnonymously(auth);

    const db = getDatabase(firebaseApp);
    const connected = await new Promise(resolve => {
      let done = false;
      let timer;
      let stop;
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        stop?.();
        resolve(Boolean(value));
      };
      stop = onValue(ref(db, '.info/connected'), snap => {
        if (snap.val() === true) finish(true);
      }, () => finish(false));
      timer = setTimeout(() => finish(false), timeout);
    });

    return {
      ok: connected,
      reason: connected ? 'firebase-connected' : 'firebase-disconnected',
      databaseURL: firebaseConfig.databaseURL
    };
  } catch (error) {
    console.warn('[Active Plus] Firebase connection test failed:', error?.code || error?.name || 'unknown');
    return {
      ok: false,
      reason: error?.code || error?.name || 'firebase-connection-failed',
      error
    };
  }
}
