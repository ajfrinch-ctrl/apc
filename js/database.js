/* Document database for Active Plus.
   Collection names below are the Firestore names to use later.
   This adapter only talks to localStorage. Do not import the Firebase SDK here.
   Passwords and security answers stay on this device — never copy them
   into a synced collection. */

export const COLLECTIONS = Object.freeze({
  students: 'students',
  transactions: 'transactions',
  notices: 'notices',
  routine: 'routine',
  teaching: 'teaching',
  exams: 'exams',
  settings: 'settings',
  academics: 'academics',
  courseContent: 'courseContent',
  questionBank: 'questionBank',
  account: 'account',
  accounts: 'accounts',
  usernames: 'usernames',
  studentProfile: 'studentProfile'
});

/** These must not be uploaded when Firebase is added. */
export const LOCAL_ONLY = Object.freeze([
  COLLECTIONS.account,
  COLLECTIONS.accounts,
  COLLECTIONS.usernames,
  COLLECTIONS.studentProfile
]);

/** Safe to mirror. Staff passwords are not in this list.
    `exams` is listed but is NOT mirrored by the generic array path — its
    document shape ({ exams: [], attempts: [] }) uses the dedicated id-keyed
    examDb mirror in js/realtime-sync.js. */
export const SYNCABLE = Object.freeze([
  COLLECTIONS.students,
  COLLECTIONS.transactions,
  COLLECTIONS.notices,
  COLLECTIONS.routine,
  COLLECTIONS.teaching,
  COLLECTIONS.exams,
  COLLECTIONS.settings,
  COLLECTIONS.academics,
  COLLECTIONS.courseContent
]);

export const STAFF_KEYS = Object.freeze({
  adminAccount: 'activePlus.adminAccount.v1',
  adminSession: 'activePlus.adminSession.v1',
  managerAccount: 'activePlus.managerAccount.v1',
  managerSession: 'activePlus.managerSession.v1',
  teacherAccount: 'activePlus.teacherAccount.v1',
  teacherSession: 'activePlus.teacherSession.v1',
  paymentAccount: 'activePlus.paymentAccount.v1',
  paymentSession: 'activePlus.paymentSession.v1'
});

export const KEYS = Object.freeze({
  students: 'activePlus.admin.students.v1',
  transactions: 'activePlus.admin.transactions.v1',
  notices: 'activePlus.admin.notices.v1',
  routine: 'activePlus.admin.routine.v1',
  teaching: 'activePlus.teaching.v1',
  exams: 'activePlus.exams.v1',
  settings: 'active-plus-app-config-v1',
  account: 'active-plus-account-v1',
  accounts: 'activePlus.db.accounts.v1',
  usernames: 'active-plus-usernames-v1',
  studentProfile: 'active-plus-student-v1',
  notifications: 'activePlus.notifications.records.v1',
  academics: 'activePlus.academics.v1',
  courseContent: 'activePlus.courseContent.v1',
  questionBank: 'activePlus.questionBank.v1',
  notificationSettings: 'activePlus.notificationSettings.v1'
});

function storage() {
  return window.localStorage;
}

export function readRaw(key) {
  return storage().getItem(key);
}

export function writeRaw(key, value) {
  storage().setItem(key, value);
}

export function readJSON(key, fallback = null) {
  try {
    const value = storage().getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    storage().setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function writeJSONStrict(key, value) {
  storage().setItem(key, JSON.stringify(value));
}

export function listDocuments(collection) {
  const stored = readJSON(KEYS[collection], null);
  if (!Array.isArray(stored)) return [];
  return stored.filter(doc => doc && typeof doc.id === 'string' && doc.id).map(doc => ({ ...doc }));
}

export function listDocumentsStrict(collection, valid) {
  const raw = storage().getItem(KEYS[collection]);
  if (raw === null) return [];
  const records = JSON.parse(raw);
  if (!Array.isArray(records) || records.some(doc => !valid(doc))) {
    throw new Error('Invalid collection storage');
  }
  return records;
}

export function replaceDocuments(collection, docs) {
  return writeJSON(KEYS[collection], docs);
}

export function replaceDocumentsStrict(collection, docs) {
  writeJSONStrict(KEYS[collection], docs);
}

const sequenceFallback = new Map();

export function nextSequence(scope, floor = 0) {
  const key = `activePlus.idSequence.v1:${scope}`;
  let value = Math.max(floor, sequenceFallback.get(key) || 0);
  try {
    value = Math.max(value, Number(globalThis.localStorage?.getItem(key) || 0)) + 1;
    globalThis.localStorage?.setItem(key, String(value));
  } catch { value += 1; }
  sequenceFallback.set(key, value);
  return value;
}

// Date/sequence alone collides on two newly installed phones.
export function recordNonce() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function newId(prefix, now = new Date()) {
  const cleanPrefix = String(prefix || 'ID').replace(/[^A-Za-z]/g, '').toUpperCase();
  const yy = String(now.getFullYear()).slice(-2);
  const date = `${yy}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const sequence = nextSequence(`${cleanPrefix}:${date}`);
  return `${cleanPrefix}${date}${String(sequence).padStart(3, '0')}-${recordNonce()}`;
}

/** Fields safe to sync. Secrets never leave the device account. */
export function publicStudent(student) {
  if (!student || typeof student !== 'object') return null;
  const copy = { ...student };
  delete copy.pin;
  delete copy.password;
  delete copy.pinHash;
  delete copy.securityAnswer;
  delete copy.securityAnswerHash;
  delete copy.securityQuestion;
  return copy;
}

export function syncableAccount(account) {
  const id = account?.student?.id || account?.studentId;
  if (!id) return null;
  return {
    id,
    username: account.username || '',
    mobile: account.registrationMobile || account.mobile || '',
    status: account.status || 'pending',
    additionalMobiles: Array.isArray(account.additionalMobiles) ? [...account.additionalMobiles] : [],
    student: publicStudent(account.student) || { id },
    createdAt: account.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/** Mirror the device account into a student-id map, without the password. */
export function rememberAccount(account) {
  const doc = syncableAccount(account);
  if (!doc) return false;
  const map = readJSON(KEYS.accounts, {}) || {};
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  map[doc.id] = doc;
  return writeJSON(KEYS.accounts, map);
}
