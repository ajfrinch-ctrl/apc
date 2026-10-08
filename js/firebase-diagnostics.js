import { LEGACY_CLOUD_ENABLED, CLOUD_PAUSED_MESSAGE, cloudPausedResult } from '../sync/cloud-access.js';
// Active Plus — Firebase diagnostic, stage by stage.
//
// Does not clear, overwrite, or delete any LocalStorage/IndexedDB data. The
// only cloud write is a tiny `{at}` record under a dedicated probe node that
// is removed the same second (its rules path exists for exactly this).
//
// Deliberately NOT gated on an app login (hasSyncSession): this is the tool a
// fresh device uses to find out WHY the cloud bridge is down, before any
// account exists on it. Requiring a working login to diagnose a broken login
// was the old behaviour's own contradiction.

import { firebaseConfig } from '../firebase/firebase-config.js';

const READ_ROOT = 'activePlusSync/v1/settings';
const PROBE_ROOT = 'activePlusSync/v1/system/connectivityProbe';

const waitForConnection = (db, { ref, onValue }, timeoutMs = 8000) => new Promise(resolve => {
  let done = false;
  const finish = value => { if (done) return; done = true; off(); resolve(value); };
  const connectionRef = ref(db, '.info/connected');
  const off = onValue(connectionRef, snap => finish(snap.val() === true), () => finish(false));
  setTimeout(() => finish(false), timeoutMs);
});

/** What a failure code means here, and the exact console/database step that
    fixes it. Keys are matched case-insensitively against code + message. */
const EXPLANATIONS = [
  [/operation-not-allowed|admin-restricted-operation/, {
    reason: 'anonymous-auth-disabled',
    guidance: 'Firebase Console → Authentication → Sign-in method → Anonymous → Enable করুন। রুলের `auth != null` শর্তের জন্য Anonymous sign-in বাধ্যতামূলক।'
  }],
  [/invalid-api-key|api-key-not-valid/, {
    reason: 'invalid-api-key',
    guidance: 'firebase/firebase-config.js-এর apiKey/appId প্রজেক্ট সেটিংসের সাথে মেলান — `active-plus-coaching` প্রজেক্টের Web app config।'
  }],
  [/permission[-_ ]denied/, {
    reason: 'rules-denied',
    guidance: 'Database Rules deploy হয়নি বা পুরনো— টার্মিনালে চালান: firebase deploy --only database (database.rules.json ফাইলটি যায়)।'
  }],
  [/app.?check|missing app ?check|attestation/, {
    reason: 'app-check',
    guidance: 'Realtime Database-এ App Check enforcement চালু আছে কিন্তু APP_CHECK_SITE_KEY খালি। হয় enforcement বন্ধ করুন, নয় Console → App Check-এ অ্যাপ রেজিস্টার করে site key বসান।'
  }],
  [/database.*not[-_ ]found|unknown database/, {
    reason: 'database-missing',
    guidance: 'Console → Realtime Database-এ instance তৈরি করুন: নাম active-plus-coaching-default-rtdb, অঞ্চল asia-southeast1 (Singapore) — databaseURL-এর সাথে মিলিয়ে।'
  }],
  [/network-request-failed|failed to fetch|err_internet|unavailable/, {
    reason: 'network',
    guidance: 'ডিভাইস ইন্টারনেটে আছে কিনা দেখুন; Firebase/Google ডোমেইন ব্লক করা (captive portal/ad-blocker) থাকলে খুলে দিন।'
  }]
];

export function explainDiagnosticError(error) {
  const text = `${String(error?.code || '')} ${String(error?.message || error || '')}`.toLowerCase();
  const match = EXPLANATIONS.find(([pattern]) => pattern.test(text));
  return match ? match[1] : { reason: 'unknown', guidance: '' };
}

/** The write probe: create a `{at}` record, then remove it. Denied usually
    means the deployed rules predate this probe path — the rest of the rules
    can still be fine, so a denial is reported, not thrown. */
async function probeDatabaseWrite(database) {
  const { ref, set } = database;
  const key = `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 64);
  const node = ref(database.db, `${PROBE_ROOT}/${key}`);
  await set(node, { at: Date.now() });
  await set(node, null); // cleanup: the probe must leave nothing behind
  return true;
}

export async function diagnoseFirebaseSync({ timeoutMs = 8000 } = {}) {
  const result = {
    sdk: true,
    databaseURL: firebaseConfig.databaseURL,
    authentication: false,
    firebaseConnection: false,
    databaseRead: false,
    databaseWrite: 'not-tested',
    localStorageProtected: true,
    error: '',
    stages: [],
    guidance: ''
  };
  const stage = (id, ok, detail = '', guidance = '') => {
    result.stages.push({ id, ok, detail });
    if (!ok && !result.guidance) result.guidance = guidance;
    return ok;
  };

  if (!LEGACY_CLOUD_ENABLED) return { ...result, ...cloudPausedResult(), error: CLOUD_PAUSED_MESSAGE };
  try {
    if (!navigator.onLine) {
      stage('device-online', false, 'offline', 'ডিভাইস অফলাইনে — আগে ইন্টারনেট চালু করুন।');
      result.error = 'ডিভাইস বর্তমানে অফলাইনে আছে';
      return result;
    }
    const configured = Boolean(firebaseConfig?.projectId && firebaseConfig?.appId && firebaseConfig?.databaseURL);
    if (!stage('config', configured, firebaseConfig.databaseURL || 'missing',
      'firebase/firebase-config.js-এ projectId/appId/databaseURL পূর্ণ নয় এবং রিপোর্টে জানান।')) {
      result.error = 'Firebase configuration অসম্পূর্ণ';
      return result;
    }

    const { firebaseApp, appCheckReady } = await import('../firebase/firebase-init.js');
    const { getAuth, signInAnonymously, getDatabase, ref, get, set, onValue } = await import('../firebase/firebase-services.js');
    await appCheckReady;

    try {
      const auth = getAuth(firebaseApp);
      if (!auth.currentUser) await signInAnonymously(auth);
      result.authentication = Boolean(auth.currentUser);
      stage('anonymous-auth', result.authentication, auth.currentUser ? 'signed-in' : 'no-user');
    } catch (error) {
      const { reason, guidance } = explainDiagnosticError(error);
      stage('anonymous-auth', false, reason, guidance);
      throw error;
    }

    const db = getDatabase(firebaseApp);
    result.firebaseConnection = await waitForConnection(db, { ref, onValue }, timeoutMs);
    if (!result.firebaseConnection) {
      stage('socket', false, 'no-connection',
        'Realtime Database socket খোলেনি — instance নেই বা databaseURL/VPN/Ad-blocker সমস্যা। Console → Realtime Database-এ `active-plus-coaching-default-rtdb` (asia-southeast1) আছে কিনা দেখুন; Ad-blocker/ডিএনএস বন্ধ করে আবার চেষ্টা করুন।');
      result.error = 'Firebase Realtime Database connection পাওয়া যায়নি';
      return result;
    }
    stage('socket', true, 'connected');

    // Read probe: a small, world-readable-by-design node (never a dump).
    try {
      await get(ref(db, READ_ROOT));
      result.databaseRead = true;
      stage('rules-read', true, READ_ROOT);
    } catch (error) {
      const { reason, guidance } = explainDiagnosticError(error);
      stage('rules-read', false, reason, guidance);
      throw error;
    }

    // Write probe on the dedicated node. A denial here with a working read
    // means the deployed rules predate the probe path — flag it precisely.
    try {
      await probeDatabaseWrite({ db, ref, set });
      result.databaseWrite = 'pass';
      stage('rules-write-probe', true, PROBE_ROOT);
    } catch (error) {
      const { reason } = explainDiagnosticError(error);
      result.databaseWrite = reason === 'rules-denied' ? 'denied' : 'failed';
      stage('rules-write-probe', false, reason,
        'Write probe ব্যর্থ — পুরনো rules-এ probe path নেই। নতুন database.rules.json deploy করুন: firebase deploy --only database');
    }
  } catch (error) {
    const code = String(error?.code || '');
    const message = String(error?.message || error || '');
    const { reason, guidance } = explainDiagnosticError(error);
    if (!result.error) {
      if (reason === 'anonymous-auth-disabled') result.error = 'Anonymous Authentication চালু নেই';
      else if (reason === 'rules-denied') result.error = 'Firebase Database permission denied — Rules deploy করুন';
      else if (reason === 'invalid-api-key') result.error = 'Firebase API key invalid';
      else if (reason === 'app-check') result.error = 'Firebase App Check সমস্যা';
      else if (reason === 'database-missing') result.error = 'Firebase Database Not Found';
      else result.error = message || 'Firebase diagnostic failed';
    }
    if (code) result.errorCode = code;
    if (guidance && !result.guidance) result.guidance = guidance;
  }
  return result;
}

window.APC_FIREBASE_DIAGNOSTIC = diagnoseFirebaseSync;
