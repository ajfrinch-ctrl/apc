import { safeSetItem, showStorageError } from './storage-safety.js';
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
  courses: 'courses',
  classChat: 'classChat',
  questionBank: 'questionBank',
  account: 'account',
  accounts: 'accounts',
  usernames: 'usernames',
  studentProfile: 'studentProfile'
});

export const LOCAL_ONLY = Object.freeze([
  COLLECTIONS.account,
  COLLECTIONS.accounts,
  COLLECTIONS.usernames,
  COLLECTIONS.studentProfile
]);

export const SYNCABLE = Object.freeze([
  COLLECTIONS.students,
  COLLECTIONS.transactions,
  COLLECTIONS.notices,
  COLLECTIONS.routine,
  COLLECTIONS.teaching,
  COLLECTIONS.exams,
  COLLECTIONS.settings,
  COLLECTIONS.academics,
  COLLECTIONS.courseContent,
  COLLECTIONS.courses,
  COLLECTIONS.classChat
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
  mobiles: 'activePlus.mobiles.v1',
  emails: 'activePlus.emails.v1',
  accountVault: 'activePlus.accountVault.v1',
  registrationNotifications: 'activePlus.registrationNotifications.v1',
  pendingCloudRegistrations: 'activePlus.pendingCloudRegistrations.v1',
  studentProfile: 'active-plus-student-v1',
  notifications: 'activePlus.notifications.records.v1',
  academics: 'activePlus.academics.v1',
  courseContent: 'activePlus.courseContent.v1',
  courses: 'activePlus.courses.v1',
  classChat: 'activePlus.classChat.v1',
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
  activeAdapter.writeRaw(key, value);
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
    safeSetItem(storage(), key, JSON.stringify(value));
    return true;
  } catch (e) {
    if (e?.name === 'QuotaExceededError' || /quota/i.test(e?.message || '')) {
      showStorageError(e);
    }
    return false;
  }
}

export function writeJSONStrict(key, value) {
  try {
    safeSetItem(storage(), key, JSON.stringify(value));
  } catch (e) {
    if (e?.name === 'QuotaExceededError' || /quota/i.test(e?.message || '')) {
      showStorageError(e);
    }
    throw e;
  }
}

/** Wrap a storage write with user-visible quota feedback. Caller can check boolean. */
export function writeJSONWithFeedback(key, value, { onQuotaToast } = {}) {
  const ok = writeJSON(key, value);
  if (!ok && typeof onQuotaToast === 'function') {
    try { onQuotaToast(); } catch {}
  }
  return ok;
}

export function listDocuments(collection) {
  const stored = readJSON(KEYS[collection], null);
  if (!Array.isArray(stored)) return [];
  return stored.filter(doc => doc && typeof doc === 'object' && (typeof doc.id === 'string' && doc.id || typeof doc.staffId === 'string' && doc.staffId)).map(doc => ({ ...doc }));
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
    email: account.email || account.student?.email || '',
    status: account.status || 'pending',
    approvedBy: account.approvedBy || '',
    approvedAt: account.approvedAt || '',
    reviewNote: account.reviewNote || '',
    additionalMobiles: Array.isArray(account.additionalMobiles) ? [...account.additionalMobiles] : [],
    student: publicStudent(account.student) || { id },
    createdAt: account.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function rememberAccount(account) {
  const doc = syncableAccount(account);
  if (!doc) return false;
  const map = readJSON(KEYS.accounts, {}) || {};
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  map[doc.id] = doc;
  return writeJSON(KEYS.accounts, map);
}

const KEY_TO_COLLECTION = Object.freeze(
  Object.fromEntries(Object.entries(KEYS).filter(([k]) => SYNCABLE.includes(k)).map(([k, v]) => [v, k]))
);

export function updatedAtMillis(doc) {
  if (!doc || typeof doc !== 'object') return 0;
  for (const field of ['updatedAt', 'reviewedAt', 'publishedAt', 'createdAt', 'recordedAt']) {
    const val = doc[field];
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string') {
      const parsed = Date.parse(val);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

export function resolveConflictByUpdatedAt(localDoc, remoteDoc) {
  if (!remoteDoc) return localDoc;
  if (!localDoc) return remoteDoc;
  const localTs = updatedAtMillis(localDoc);
  const remoteTs = updatedAtMillis(remoteDoc);
  return remoteTs > localTs ? { ...localDoc, ...remoteDoc } : { ...remoteDoc, ...localDoc };
}

export function splitExamForFirestore(exam) {
  if (!exam || typeof exam !== 'object') return { examDoc: null, keyDoc: null };
  const answers = {};
  const publicQuestions = (Array.isArray(exam.questions) ? exam.questions : []).map((q, idx) => {
    const qId = q.uid || q.id || `${exam.id}-q${idx + 1}`;
    const { answer, answerText, answerKey, correct, correctAnswer, ...rest } = q || {};
    if (answer !== undefined || answerText !== undefined) {
      answers[qId] = { ...(answer !== undefined ? { answer } : {}), ...(answerText !== undefined ? { answerText } : {}) };
    }
    return rest;
  });
  const { answerKey, answers: topAnswers, answer: topAnswer, ...restExam } = exam;
  return {
    examDoc: { ...restExam, questions: publicQuestions },
    keyDoc: { examId: exam.id, answers, updatedAt: exam.updatedAt || Date.now() }
  };
}

export function mergeExamFromFirestore(examDoc, keyDoc = null) {
  if (!examDoc || typeof examDoc !== 'object') return null;
  const answers = keyDoc?.answers || {};
  const questions = (Array.isArray(examDoc.questions) ? examDoc.questions : []).map((q, idx) => {
    const qId = q.uid || q.id || `${examDoc.id}-q${idx + 1}`;
    const keyEntry = answers[qId];
    return keyEntry ? { ...q, ...keyEntry } : { ...q };
  });
  return { ...examDoc, questions };
}

export const localStorageAdapter = Object.freeze({
  kind: 'localStorage',
  readRaw: key => storage().getItem(key),
  writeRaw: (key, value) => safeSetItem(storage(), key, value)
});

let activeAdapter = localStorageAdapter;

export function getDatabaseAdapter() {
  return activeAdapter;
}

export function setDatabaseAdapter(adapter) {
  activeAdapter = adapter && typeof adapter.writeRaw === 'function' ? adapter : localStorageAdapter;
  return activeAdapter;
}

function extractRecordsForCollection(collection, parsed) {
  if (!parsed) return [];
  if (collection === 'teaching') return Array.isArray(parsed.activities) ? parsed.activities : [];
  if (collection === 'courses') return Array.isArray(parsed.courses) ? parsed.courses : [];
  if (collection === 'exams') return Array.isArray(parsed.exams) ? parsed.exams : [];
  if (collection === 'routine' && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Object.entries(parsed).flatMap(([day, info]) =>
      (info?.classes || []).map((item, idx) => ({ ...item, id: item.id || `${day}-${idx}`, day, updatedAt: item.updatedAt || info.date || 0 }))
    );
  }
  return Array.isArray(parsed) ? parsed : [];
}

export function createFirestoreAdapter({ auth = null, store = null } = {}) {
  const outbox = new Map(); // `${collection}:${id}` -> doc
  const remoteMirror = new Map(); // `${collection}:${id}` -> doc
  const keyMirror = new Map(); // `exams:${id}:private/key` -> keyDoc

  const writeRemoteDoc = async (path, data) => {
    if (store && typeof store.setDoc === 'function') {
      await store.setDoc(path, data);
    } else {
      remoteMirror.set(path, structuredClone ? structuredClone(data) : JSON.parse(JSON.stringify(data)));
    }
  };
  const readRemoteDoc = async path => {
    if (store && typeof store.getDoc === 'function') return await store.getDoc(path);
    return remoteMirror.get(path) || null;
  };

  async function flush() {
    if (auth && !auth.currentUser) return { flushed: 0, pending: outbox.size };
    let flushed = 0;
    for (const [entryKey, doc] of [...outbox.entries()]) {
      const [collection, id] = entryKey.split(':');
      if (!collection || !id) { outbox.delete(entryKey); continue; }
      if (collection === 'exams') {
        const { examDoc, keyDoc } = splitExamForFirestore(doc);
        const existing = await readRemoteDoc(`exams/${id}`);
        const winner = resolveConflictByUpdatedAt(examDoc, existing);
        await writeRemoteDoc(`exams/${id}`, winner);
        if (keyDoc) {
          keyMirror.set(`exams/${id}/private/key`, keyDoc);
          await writeRemoteDoc(`exams/${id}/private/key`, keyDoc);
        }
      } else {
        const existing = await readRemoteDoc(`${collection}/${id}`);
        const winner = resolveConflictByUpdatedAt(doc, existing);
        await writeRemoteDoc(`${collection}/${id}`, winner);
      }
      outbox.delete(entryKey);
      flushed++;
    }
    return { flushed, pending: outbox.size };
  }

  function enqueueFromKeyWrite(key, rawValue) {
    const collection = KEY_TO_COLLECTION[key];
    if (!collection) return;
    try {
      const parsed = JSON.parse(rawValue);
      for (const rec of extractRecordsForCollection(collection, parsed)) {
        if (!rec || !rec.id) continue;
        const entryKey = `${collection}:${rec.id}`;
        const prior = outbox.get(entryKey);
        outbox.set(entryKey, resolveConflictByUpdatedAt(rec, prior));
      }
    } catch { }
  }

  return {
    kind: 'firestore',
    readRaw(key) { return localStorageAdapter.readRaw(key); },
    writeRaw(key, value) {
      localStorageAdapter.writeRaw(key, value);
      enqueueFromKeyWrite(key, value);
    },
    flush,
    pendingCount: () => outbox.size,
    getRemoteDoc: path => readRemoteDoc(path),
    getPrivateKeyDoc: examId => keyMirror.get(`exams/${examId}/private/key`) || null
  };
}
