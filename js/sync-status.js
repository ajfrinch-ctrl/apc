import { CLOUD_PAUSED_MESSAGE } from '../sync/cloud-access.js';
/* Firebase sync status — transport, auth and local data remain separate. */
let lastSuccessfulSyncAt = '';

const codeOf = error => String(error?.code || error?.name || '').toLowerCase();
const messageFor = (state, error = null) => {
  if (state === 'paused') return CLOUD_PAUSED_MESSAGE;
  const code = codeOf(error);
  if (state === 'offline') return navigator.onLine
    ? 'ক্লাউড সংযোগ বিচ্ছিন্ন — পরিবর্তন এই ডিভাইসে আছে'
    : 'অফলাইন — পরিবর্তন এই ডিভাইসে আছে';
  if (state === 'connecting') return 'Firebase সংযোগ করা হচ্ছে…';
  if (state === 'pending') return 'পরিবর্তন Firebase-এ সিঙ্ক হচ্ছে…';
  if (state === 'online') return lastSuccessfulSyncAt ? '🟢 Firebase-এ ডেটা সিঙ্ক হয়েছে' : 'ক্লাউড সিঙ্ক যাচাই হচ্ছে…';
  if (state === 'conflict') return 'সিঙ্ক দ্বন্দ্ব — ডেটা নিরাপদে এই ডিভাইসে রাখা হয়েছে';
  if (state === 'storage') return 'ফোনের স্টোরেজ ভর্তি — পুরোনো ছবি/অ্যাপ ডেটা ফাঁকা করুন';

  if (/operation-not-allowed|admin-restricted-operation/.test(code)) {
    return 'Firebase Authentication-এ Anonymous sign-in চালু নেই';
  }
  if (/auth\/network-request-failed|network-request-failed/.test(code)) {
    return 'Firebase Authentication নেটওয়ার্কে পৌঁছাতে পারেনি';
  }
  if (/invalid-api-key|app\/invalid-api-key/.test(code)) {
    return 'Firebase Configuration Error — API key যাচাই করুন';
  }
  if (/database.*not[-_ ]found|database-not-found/.test(code)) {
    return 'Firebase Database Not Found — databaseURL যাচাই করুন';
  }
  if (/permission[-_ ]denied|permission_denied|permission/.test(code)) {
    return 'Firebase Database Permission Denied — Rules/App Check যাচাই করুন';
  }
  if (/app[-_ ]check|appcheck|missing appcheck/i.test(code + ' ' + String(error?.message || ''))) {
    return 'Firebase App Check বাধা দিচ্ছে';
  }
  if (/network|timeout|unavailable|failed-to-fetch|err_internet/.test(code + ' ' + String(error?.message || '').toLowerCase())) {
    return 'Firebase Connection Failed — নেটওয়ার্ক/Database connection যাচাই করুন';
  }
  return 'Firebase Sync Failed — বিস্তারিত কারণ Console-এ পাওয়া যাবে';
};

export function markSyncSuccess(kind = 'read') {
  if (kind === 'write' || kind === 'read') lastSuccessfulSyncAt = new Date().toISOString();
  const root = document.documentElement;
  root.dataset.firebaseLastSync = lastSuccessfulSyncAt;
}

export function setSyncStatus(state, error = null) {
  const code = codeOf(error);
  if (/QuotaExceededError|quota/i.test(code) || /QuotaExceeded/i.test(String(error?.name || ''))) {
    state = 'storage';
  }
  const message = typeof error?.publicMessage === 'string' && error.publicMessage
    ? error.publicMessage
    : messageFor(state, error);
  const root = document.documentElement;
  root.dataset.internetState = navigator.onLine ? 'online' : 'offline';
  // Transport state is set by .info/connected, not inferred from a write/UI error.
  if (!root.dataset.firebaseConnection) root.dataset.firebaseConnection = 'unknown';
  root.dataset.realtimeSync = state;
  root.dataset.realtimeSyncMessage = message;
  root.dataset.firebaseLastSync = lastSuccessfulSyncAt;
  window.dispatchEvent(new CustomEvent('apc-sync-status', {
    detail: { state, message, code, firebaseConnection: root.dataset.firebaseConnection, lastSuccessfulSyncAt }
  }));
}

export function reportSyncConflict(code) {
  const message = {
    'admin-conflict': 'এই সিস্টেমে আগে থেকেই Admin আছে — ক্লাউডে থাকা ID দিয়ে লগইন করুন',
    'login-id-conflict': 'এই ইউজারনেম অন্য ডিভাইসে আগেই ব্যবহার হচ্ছে — এডমিনকে জানান',
    'unsafe-record': 'একটি রেকর্ডে ফায়ারবেস-নিষিদ্ধ অক্ষর (. # $ [ ] /) আছে — সেটি বাদে বাকি সব সিঙ্ক হয়েছে'
  }[code] || 'একই লগইন আইডি দুই ডিভাইসে — এডমিনকে জানান';
  setSyncStatus('conflict', { code: 'conflict/' + code, publicMessage: message });
  console.warn('[Active Plus] Login ID conflict:', code);
}

export function reportSyncError(error) {
  setSyncStatus(navigator.onLine ? 'error' : 'offline', error);
  /* Never hide the cause: the exact Firebase code AND its message stay in the
     console (permission-denied, invalid-api-key, database-not-found, app-check,
     network-request-failed, unavailable …). */
  console.warn('[Active Plus] Sync failed:', error?.code || error?.name || 'unknown', error?.message || error || '');
}
