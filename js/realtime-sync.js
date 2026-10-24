import { LEGACY_CLOUD_ENABLED, assertCloudAccess, cloudPausedResult } from '../sync/cloud-access.js';
/* Active Plus — Realtime Database online test sync.
   Offline-first: localStorage remains the source used by the UI.

   Mirrored, each with its own merge rules:
     • application collections (students, transactions, notices, routine,
       teaching, settings, teacher assignments) through a durable per-record
       outbox (js/record-sync.js) — offline edits and deletions survive
       reloads and are merged into current server state
     • the four staff role accounts and the AES-encrypted Staff Directory
     • the claimed Login User ID registry
     • one student login record per login ID (studentAccounts/<encoded-id>),
       selected on a device only after its password has been verified
     • the exam database (exams + attempts) through its dedicated mirror

   Only records that already hold PBKDF2 password HASHES travel the bridge — a
   plaintext password or security answer never does, and sessions stay
   device-bound. This anonymous bridge is re-enabled as an INTERIM measure by
   owner decision (2026-09-30): see docs/INTERIM-ANONYMOUS-SYNC.md for the
   accepted risk and docs/RTDB-PER-USER-RULES-PLAN.md for the replacement. */
import {
  firebaseApp, appCheckReady, getAuth, signInAnonymously, setPersistence,
  browserLocalPersistence, getDatabase, ref, get, set, runTransaction,
  onValue as firebaseOnValue
} from '../sync/realtime-transport.js';
import { SYNCABLE, KEYS } from './database.js';
import { STAFF_ACCOUNTS } from './staff-auth.js';
import { encodeRealtimeRecords, decodeRealtimeRecords } from './realtime-value-codec.js';
import { collectionPayload, remoteToLocal } from './sync-collections.js';
import { createRecordSync, mergeRecordOperations } from './record-sync.js';
import { chooseStaffCopy, chooseStudentCopy, sameStudentRecord, loginIdOf, matchesLoginIdentifier, findLoginMatches, suggestIdentifiers, recordTime } from './sync-merge.js';
import { reportSyncConflict, reportSyncError, setSyncStatus, markSyncSuccess } from './sync-status.js';
import { unsafeKeyPath, isRtdbKey } from './rtdb-keys.js';
import { isPasswordRecord, verifyPassword } from './password-hash.js';
import { normalizeUsername, contactNumber, normalizeEmail } from './account-policy.js';
import { dhakaYYMMDD, formatStudentId, maxExistingDailySerial, MAX_DAILY_STUDENTS, DAILY_LIMIT_ERROR } from './idGenerator.js';
import { TEACHER_ASSIGNMENTS_KEY } from './teacher-assignments.js';
import { STAFF_DIRECTORY_KEY } from './staff-directory.js';
import { encodeUsernameRegistry, decodeUsernameRegistry, encodeUsernameKey } from './username-sync-codec.js';
import { isEncryptedEnvelope, decryptValue, encryptValue } from './secure-store.js';

const DB_ROOT = 'activePlusSync/v1';
let started = false;
const lastRemote = new Map();
const STAFF_ROOT = DB_ROOT + '/staffAccounts';
const DIRECTORY_ROOT = DB_ROOT + '/staffDirectory';
const USERNAMES_ROOT = DB_ROOT + '/usernames';
const MOBILE_INDEX_ROOT = DB_ROOT + '/mobileIndex';
const EMAIL_INDEX_ROOT = DB_ROOT + '/emailIndex';
const DAILY_COUNTERS_ROOT = DB_ROOT + '/dailyStudentCounters';
const NOTIFICATIONS_ROOT = DB_ROOT + '/notifications';
/* Institution-wide markers (is the one-time Admin initialization complete?). */
const SYSTEM_ROOT = DB_ROOT + '/system';
const STUDENT_ROOT = DB_ROOT + '/studentAccount'; // read-only legacy migration
const STUDENTS_ROOT = DB_ROOT + '/studentAccounts';
const EXAMDB_ROOT = DB_ROOT + '/examDb';

const rawSetItem = Storage.prototype.setItem;
const subscriptions = new Set();
let booting = null;
let authFlight = null;
let connected = false;
let ready = false;
let syncFailed = false;
let syncEnabled = false;
let syncGeneration = 0;
let hasConnected = false;
let partialFailures = [];
let partialRetry = null;
let lastPartialRetry = 0;
let classChatPending = false;

function notifyRemote(key, collection) {
  try {
    const event = new window.StorageEvent('storage', {
      key, newValue: localStorage.getItem(key), storageArea: localStorage,
      url: location.href
    });
    Object.defineProperty(event, 'apcRemote', { value: true });
    window.dispatchEvent(event);
  } catch {
    try {
      const fallbackEvent = new Event('storage');
      Object.defineProperties(fallbackEvent, {
        key: { value: key },
        newValue: { value: localStorage.getItem(key) },
        apcRemote: { value: true }
      });
      window.dispatchEvent(fallbackEvent);
    } catch { /* apc-sync-updated below always notifies listeners */ }
  }
  window.dispatchEvent(new CustomEvent('apc-sync-updated', { detail: { collection, key } }));
}

function remoteWrite(key, value, collection) {
  const serialized = JSON.stringify(value);
  if (localStorage.getItem(key) === serialized) return true;
  rawSetItem.call(localStorage, key, serialized);
  notifyRemote(key, collection);
  return true;
}

function syncError(error) {
  if (!syncEnabled) return;
  syncFailed = true;
  reportSyncError(error);
}

function recordSyncError(error) {
  // A failed outbox write stays queued for retry; it does not invalidate the
  // RTDB listeners. Only a failed listener or a failed boot needs resubscribe.
  if (!syncEnabled) return;
  reportSyncError(error);
}

/* A login ID claimed twice (two devices, one of them not synced yet) must stay
   visible instead of being retried away: it needs a human decision. */
let conflict = null;
function reportConflict(code) {
  conflict = { code };
  reportSyncConflict(code);
}
function clearConflict(code) {
  if (!conflict || (code && conflict.code !== code)) return;
  conflict = null;
  paintSyncStatus();
}

function isPermissionDenied(error) {
  const detail = `${error?.code || ''} ${error?.name || ''} ${error?.message || ''}`.toLowerCase();
  return /permission[-_ ]denied/.test(detail);
}

function onValue(node, callback) {
  const generation = syncGeneration;
  const unsubscribe = firebaseOnValue(node, snapshot => {
    if (!syncEnabled || generation !== syncGeneration) return;
    Promise.resolve().then(() => {
      if (syncEnabled && generation === syncGeneration) return callback(snapshot);
    }).catch(syncError);
  }, error => {
    if (!syncEnabled || generation !== syncGeneration) return;
    syncFailed = true;
    syncError(error);
  });
  subscriptions.add(unsubscribe);
  return unsubscribe;
}

/**
 * Subscribe to a newly introduced auxiliary RTDB node without turning core
 * sync red if the live Firebase project has not yet deployed rules for it.
 */
function onOptionalValue(node, callback, { label = 'optional', onPermissionDenied = null } = {}) {
  const generation = syncGeneration;
  let unsubscribe = null;
  unsubscribe = firebaseOnValue(node, snapshot => {
    if (!syncEnabled || generation !== syncGeneration) return;
    Promise.resolve().then(() => {
      if (syncEnabled && generation === syncGeneration) return callback(snapshot);
    }).catch(error => {
      if (isPermissionDenied(error)) {
        onPermissionDenied?.(error);
        console.warn(`[Active Plus] Optional RTDB node rules not yet deployed (${label}); keeping core sync active.`);
        if (unsubscribe) {
          subscriptions.delete(unsubscribe);
          try { unsubscribe(); } catch {}
        }
        return;
      }
      syncError(error);
    });
  }, error => {
    if (!syncEnabled || generation !== syncGeneration) return;
    if (isPermissionDenied(error)) {
      onPermissionDenied?.(error);
      console.warn(`[Active Plus] Optional RTDB node rules not yet deployed (${label}); keeping core sync active.`);
      if (unsubscribe) {
        subscriptions.delete(unsubscribe);
        try { unsubscribe(); } catch {}
      }
      return;
    }
    syncFailed = true;
    syncError(error);
  });
  subscriptions.add(unsubscribe);
  return unsubscribe;
}

function hasOutboxPending() {
  return [...recordBridges.values()].some(bridge => bridge.hasPending())
    || examSync.pending.size > 0
    || classChatPending;
}

/** Push everything still waiting in the durable outboxes. */
async function flushPending() {
  if (!syncEnabled) return;
  const bridges = [...recordBridges.values()];
  await Promise.all([
    ...bridges.map(bridge => bridge.flush()),
    pushExamDb(),
    syncClassChat()
  ]);
}

function paintSyncStatus() {
  if (!navigator.onLine) setSyncStatus('offline');
  else if (conflict) return;
  else if (syncFailed || partialFailures.length) setSyncStatus('error', partialFailures[0]?.error);
  else if (!connected && hasConnected) setSyncStatus('offline');
  else if (!connected) setSyncStatus('connecting');
  else if (!ready) setSyncStatus('connecting');
  else if (hasOutboxPending()) setSyncStatus('pending');
  else setSyncStatus('online');
}

export async function ensureCloudAuth() {
  assertCloudAccess();
  if (authFlight) return authFlight;
  authFlight = (async () => {
    await appCheckReady;
    const auth = getAuth(firebaseApp);
    // One persisted transport identity per device: reloads reuse it instead of
    // minting a new anonymous user on every visit.
    try { await setPersistence(auth, browserLocalPersistence); } catch { /* private mode: memory */ }
    await auth.authStateReady();
    if (auth.currentUser) return auth.currentUser;
    /* INTERIM anonymous test bridge (owner decision, 2026-09-30). The database
       rules only require `auth != null`, so this identity proves nothing about
       the app login — the local PBKDF2 check and the app session gate do. See
       docs/INTERIM-ANONYMOUS-SYNC.md for the accepted risk and the exit plan
       (docs/RTDB-PER-USER-RULES-PLAN.md). */
    const credential = await signInAnonymously(auth);
    return credential?.user || auth.currentUser;
  })().finally(() => { authFlight = null; });
  return authFlight;
}

function localKey(collection) {
  return collection === 'teacherAssignments' ? TEACHER_ASSIGNMENTS_KEY : KEYS[collection];
}

function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch { return null; }
}

function staffRoleByAccountKey(key) {
  return Object.keys(STAFF_ACCOUNTS).find(role => STAFF_ACCOUNTS[role].accountKey === key) || null;
}

async function readStaffLocal(role) {
  const spec = STAFF_ACCOUNTS[role];
  if (!spec) return null;
  try {
    const raw = localStorage.getItem(spec.accountKey);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (isEncryptedEnvelope(parsed)) {
      const plaintext = await decryptValue(parsed);
      if (!plaintext) return null;
      return JSON.parse(plaintext);
    }
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

async function writeStaffLocal(role, account) {
  const spec = STAFF_ACCOUNTS[role];
  if (!spec || !account || typeof account !== 'object') return false;
  return remoteWrite(spec.accountKey, account, 'staffAccounts');
}

/* ---- Cross-device login identities (Staff Directory, Login User ID
   registry and the local student login). ------------------------------- */

/** Directory record: stored as an AES-GCM envelope when the platform allows,
    so accept both shapes on the way in and keep the envelope on the way out. */
async function readDirectoryLocal() {
  try {
    const raw = readLocal(STAFF_DIRECTORY_KEY);
    if (raw === null) return null;
    if (isEncryptedEnvelope(raw)) {
      const plaintext = await decryptValue(raw);
      if (!plaintext) return null;
      return JSON.parse(plaintext);
    }
    return raw && typeof raw === 'object' ? raw : null;
  } catch { return null; }
}

/** Claimed Login User IDs: username → owner marker. */
function readUsernamesLocal() {
  const value = readLocal(KEYS.usernames);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** The single local student login. Plaintext secrets never sync. */
function studentAccountPayload(account) {
  if (!account || typeof account !== 'object') return null;
  const safe = { ...account };
  delete safe.pin;
  delete safe.securityAnswer;
  return safe;
}

const isDirectoryRecord = value =>
  Boolean(value) && typeof value === 'object' && Array.isArray(value.records);
const isUsernamesRecord = value =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isStudentAccountRecord = value =>
  Boolean(value) && typeof value === 'object' && isPasswordRecord(value.pinHash);

const staffFlights = new Map();
function syncStaffRole(role) {
  const generation = syncGeneration;
  const live = () => syncEnabled && generation === syncGeneration;
  if (!live()) return Promise.resolve();
  if (staffFlights.has(role)) return staffFlights.get(role);
  const flight = (async () => {
    const local = await readStaffLocal(role);
    if (!live()) return;
    const node = ref(getDatabase(firebaseApp), STAFF_ROOT + '/' + role);
    const snap = await get(node);
    if (!live()) return;
    const remote = snap.exists() ? snap.val() : null;
    const decision = chooseStaffCopy(local, remote, { role });
    if (decision === 'conflict') {
      // Two different Admin usernames: the account the other devices already
      // use wins, and the system created on this device is discarded.
      await writeStaffLocal(role, remote);
      lastRemote.set('staff:' + role, JSON.stringify(remote));
      reportConflict('admin-conflict');
      return;
    }
    if (decision === 'remote') {
      // The cloud copy (a real credential, or an account that was never
      // personalised here) must not be replaced by this device's copy.
      await writeStaffLocal(role, remote);
      lastRemote.set('staff:' + role, JSON.stringify(remote));
      // The Admin account reached the cloud from some other device: make sure
      // the global initialization marker says so too.
      if (role === 'admin' && isPasswordRecord(remote?.password)) void ensureAdminInitializedFlag();
      return;
    }
    // Only a complete credential record is uploaded (the rules require a
    // username and a password hash); a half-initialised local role is kept here.
    if (!local || typeof local.username !== 'string' || !local.username || !isPasswordRecord(local.password)) return;
    /* Never hand Realtime Database a key it will reject: the write would fail
       and, before this guard, take the whole startup batch with it. */
    const unsafe = unsafeKeyPath(local);
    if (unsafe) { reportConflict('unsafe-record'); return; }
    await set(node, local);
    lastRemote.set('staff:' + role, JSON.stringify(local));
    if (role === 'admin') {
      clearConflict('admin-conflict');
      void ensureAdminInitializedFlag();
    }
  })().finally(() => staffFlights.delete(role));
  staffFlights.set(role, flight);
  return flight;
}

const pushStaffRole = role => syncStaffRole(role);

/* Directory changes are merged by permanent record ID, not by replacing the
   entire staff list. The baseline only stores revision dates, never secrets. */
const DIRECTORY_BASELINE = 'activePlus.directorySyncBaseline.v2';
let directoryQueue = Promise.resolve();
function syncDirectory({ readOnly = false } = {}) {
  const generation = syncGeneration;
  const live = () => readOnly || (syncEnabled && generation === syncGeneration);
  const work = directoryQueue.catch(() => {}).then(async () => {
    if (!live()) return;
    const beforeRaw = localStorage.getItem(STAFF_DIRECTORY_KEY);
    const local = await readDirectoryLocal();
    if (!live()) return;
    const baseline = readLocal(DIRECTORY_BASELINE);
    const records = Object.fromEntries((local?.records || []).map(record => [record.id, record]));
    const operations = {};
    for (const [id, record] of Object.entries(records)) {
      if (baseline && baseline[id] === record.updatedAt) continue;
      operations[id] = { value: record, ...(!baseline ? { seed: true } : {}) };
    }
    if (local && baseline) for (const id of Object.keys(baseline)) {
      if (!Object.hasOwn(records, id)) operations[id] = { value: null };
    }
    const node = ref(getDatabase(firebaseApp), DIRECTORY_ROOT);
    let remote;
    if (!readOnly && Object.keys(operations).length) {
      const result = await runTransaction(node, current => {
        if (!live()) return;
        const existing = Object.fromEntries((current?.records || []).map(record => [record.id, record]));
        return {
          version: 1,
          records: Object.values(mergeRecordOperations(existing, operations)),
          updatedAt: current?.updatedAt || local?.updatedAt || new Date().toISOString()
        };
      }, { applyLocally: false });
      remote = result.snapshot.val();
    } else remote = (await get(node)).val();
    if (!live()) return;
    if (!remote && !baseline) return;
    remote = { version: 1, ...remote, records: remote?.records || [] };
    if (!isDirectoryRecord(remote)) throw new Error('Invalid remote staff directory');
    const applied = readOnly ? { ...remote, records: Object.values(mergeRecordOperations(
      Object.fromEntries(remote.records.map(record => [record.id, record])), operations
    )) } : remote;
    const envelope = await encryptValue(JSON.stringify(applied));
    if (!live()) return;
    // A user may have edited while encryption/network was pending. Their next
    // queued write uses the old baseline and must not be overwritten here.
    if (localStorage.getItem(STAFF_DIRECTORY_KEY) !== beforeRaw) return;
    rawSetItem.call(localStorage, DIRECTORY_BASELINE, JSON.stringify(
      Object.fromEntries(remote.records.map(record => [record.id, record.updatedAt || '']))
    ));
    lastRemote.set('staffDirectory', JSON.stringify(remote));
    remoteWrite(STAFF_DIRECTORY_KEY, envelope || applied, 'staffDirectory');
  });
  directoryQueue = work;
  return work;
}
const pushDirectory = () => syncDirectory();

/**
 * Login User ID registry. Remote wins when present; otherwise the local
 * registry is uploaded. With `merge` the local claims survive and remote
 * claims are added on top — used on the login path so an offline claim
 * made on this device is not lost mid-session.
 */
async function syncUsernames() {
  const generation = syncGeneration;
  if (!syncEnabled) return;
  const local = readUsernamesLocal() || {};
  const node = ref(getDatabase(firebaseApp), USERNAMES_ROOT);
  const result = await runTransaction(node, current => {
    if (!syncEnabled || generation !== syncGeneration) return undefined;
    const merged = { ...encodeUsernameRegistry(local), ...(current || {}) };
    // Nothing claimed anywhere yet: writing an empty registry would delete the
    // node (the rules refuse that), so abort and leave the cloud untouched.
    return Object.keys(merged).length ? merged : undefined;
  }, { applyLocally: false });
  if (!syncEnabled || generation !== syncGeneration) return;
  const remote = result.snapshot.val() || {};
  lastRemote.set('usernames', JSON.stringify(remote));
  remoteWrite(KEYS.usernames, decodeUsernameRegistry(remote), 'usernames');
}

const pushUsernames = () => syncUsernames();

/* Each student now has a separate login record. The old singleton is read
   only for migration and never copied over an unrelated signed-in student. */
function studentKey(account) {
  return normalizeUsername(account?.username || account?.student?.username || '') ||
    contactNumber(account?.registrationMobile || account?.mobile || '');
}
const studentMatches = (account, identifier) => matchesLoginIdentifier(account, identifier);
let studentFlight = null;
function syncStudentAccount() {
  const generation = syncGeneration;
  if (!syncEnabled) return Promise.resolve();
  if (studentFlight) return studentFlight;
  studentFlight = (async () => {
    const local = studentAccountPayload(readLocal(KEYS.account));
    const key = studentKey(local);
    if (!key || !isPasswordRecord(local?.pinHash)) return;
    const unsafe = unsafeKeyPath(local);
    if (unsafe) { reportConflict('unsafe-record'); return; }
    const node = ref(getDatabase(firebaseApp), STUDENTS_ROOT + '/' + encodeUsernameKey(key));
    const result = await runTransaction(node, current => {
      // Only a write that really changes something is committed: 'remote'
      // needs no write, and a duplicate login ID must abort untouched.
      if (!syncEnabled || generation !== syncGeneration) return;
      return chooseStudentCopy(local, current) === 'local' ? local : undefined;
    }, { applyLocally: false });
    if (!syncEnabled || generation !== syncGeneration) return;
    const remote = result.snapshot.val();
    if (!isStudentAccountRecord(remote) || studentKey(remote) !== key) return;
    lastRemote.set('student:' + key, JSON.stringify(remote));
    if (sameStudentRecord(local, remote)) {
      clearConflict('login-id-conflict');
      // The cloud copy is what other devices use: adopt it only when it really
      // is newer than what this device holds now. The copy this flight read can
      // be older than a change that arrived while the write was in flight — an
      // approval flipping the account to 'active', for example — and adopting it
      // would undo that change.
      const current = studentAccountPayload(readLocal(KEYS.account));
      if (sameStudentRecord(current, remote) && recordTime(remote) > recordTime(current)) {
        remoteWrite(KEYS.account, remote, 'studentAccount');
      }
    } else {
      // Another student owns this login ID in the cloud. Keep both records —
      // the local registration stays usable here, nothing is destroyed.
      reportConflict('login-id-conflict');
    }
  })().finally(() => {
    studentFlight = null;
    // A change made while this write was in flight (a registration approval,
    // for example) was not part of the transaction above. One more pass pushes
    // the newest local copy; it stops as soon as the cloud is up to date.
    const local = studentAccountPayload(readLocal(KEYS.account));
    const key = studentKey(local);
    const remembered = key ? lastRemote.get('student:' + key) : null;
    if (!key || !remembered || !isPasswordRecord(local?.pinHash)) return;
    try {
      if (recordTime(local) > recordTime(JSON.parse(remembered))) pushStudentAccount().catch(syncError);
    } catch { /* unreadable memory is only a missed retry */ }
  });
  return studentFlight;
}

const pushStudentAccount = () => syncStudentAccount();

/** Is this login ID already claimed in the cloud (by any role)? Best effort:
    a failed or offline lookup answers "unknown" and never blocks the caller. */
export async function usernameTakenOnline(username) {
  const name = loginIdOf({ username });
  if (!name) return { ok: true, taken: false };
  if (!navigator.onLine) return { ok: false, taken: false, offline: true };
  try {
    await ensureCloudAuth();
    const db = getDatabase(firebaseApp);
    const [claims, record, directory] = await Promise.all([
      get(ref(db, USERNAMES_ROOT)),
      get(ref(db, STUDENTS_ROOT + '/' + encodeUsernameKey(name))),
      get(ref(db, DIRECTORY_ROOT))
    ]);
    const claimed = decodeUsernameRegistry(claims.val() || {});
    const staff = Object.values(directory.val()?.records || {});
    const taken = Boolean(claimed[name]) || Boolean(record.val()) ||
      staff.some(employee => loginIdOf(employee) === name);
    return { ok: true, taken };
  } catch (error) {
    console.warn('[Active Plus] login-id check unavailable:', error?.code || error?.name || 'unknown');
    return { ok: false, taken: false, error };
  }
}
async function hydrateStudent(identifier, password) {
  if (!identifier) return { found: false };
  const db = getDatabase(firebaseApp);
  // The login ID is the key, so it is read directly. A mobile number or a
  // Student ID is not a key: those need a lookup (see below).
  let account = (await get(ref(db, STUDENTS_ROOT + '/' + encodeUsernameKey(normalizeUsername(identifier))))).val();
  if (!studentMatches(account, identifier)) account = null;
  // A miss is reported with what the cloud really holds, so "not found" can be
  // told apart from "nothing was ever uploaded from the other device".
  let cloudAccounts = 0;
  let similar = [];
  if (!account) {
    const snapshot = await get(ref(db, STUDENTS_ROOT));
    const records = Object.values(snapshot.val() || {}).filter(Boolean);
    cloudAccounts = records.length;
    const matches = findLoginMatches(records, identifier);
    // "s260929001" is only usable while exactly one student matches it.
    if (matches.length > 1) return { found: true, ambiguous: true };
    account = matches[0] || null;
    if (!account) similar = suggestIdentifiers(records, identifier);
  }
  if (!account) {
    const legacy = (await get(ref(db, STUDENT_ROOT))).val();
    if (studentMatches(legacy, identifier)) account = legacy;
    else return { found: false, cloudAccounts, similar };
  }
  if (!account || !isPasswordRecord(account.pinHash)) return { found: false };
  // Never replace the active local profile on a failed password attempt.
  if (!(await verifyPassword(password, account.pinHash))) return { found: true, credentialMismatch: true };
  // The password was verified against this cloud record, so it is this person's
  // account: a previous duplicate-ID warning is settled now.
  clearConflict('login-id-conflict');
  remoteWrite(KEYS.account, account, 'studentAccount');
  // Credential reads must not wait for a write transaction (or write permission).
  if (ready) listenStudentAccount();
  return { found: true };
}

/* ---- Exam database (exams + attempts) ---------------------------------------
   `activePlus.exams.v1` is ONE document: { version: 1, exams: [], attempts: [] }.
   The generic collection bridge only mirrors id-lists, so the exam database
   gets a dedicated id-keyed mirror: examDb/exams/<id> and examDb/attempts/<id>.

   Merge rules per id — fill-missing, remote-wins on differing content, remote
   deletions honoured — with one protection: an id this device has just changed
   locally but has not pushed yet (offline write, slow network) is never
   overwritten, filled or deleted by a stale remote copy. That pending local
   write wins and reaches the cloud on the next successful push.

   Orphan attempts (their exam has not arrived here yet) wait in memory and are
   applied when the exam arrives, because the app's strict document validation
   rejects an attempt whose exam is missing from the same document. */
const EXAM_SYNC_SPACES = ['exams', 'attempts'];
const examSync = {
  lastRemote: { exams: new Map(), attempts: new Map() },
  lastLocal: { exams: new Map(), attempts: new Map() },
  pending: new Set(),   // `${space}/${id}` changed locally, not pushed yet
  orphans: new Map()    // attemptId -> remote attempt awaiting its exam
};

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Order-insensitive JSON — the database stores keys alphabetically. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readExamDbLocal() {
  let raw = null;
  try { raw = localStorage.getItem(KEYS.exams); } catch {}
  if (raw === null) return { db: { version: 1, exams: [], attempts: [] }, readable: true };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.version === 1 &&
        Array.isArray(parsed.exams) && Array.isArray(parsed.attempts)) {
      return { db: parsed, readable: true };
    }
  } catch {}
  // Corrupt local document: the cloud copy may still repair it, but nothing
  // from this device may overwrite the cloud until the app rebuilds the file.
  return { db: { version: 1, exams: [], attempts: [] }, readable: false };
}

const examItemValid = item =>
  isPlainObject(item) && typeof item.id === 'string' && item.id &&
  typeof item.teacherId === 'string' && Array.isArray(item.participants) &&
  ['draft', 'pending', 'rejected', 'published'].includes(item.status);

const attemptItemValid = item =>
  isPlainObject(item) && typeof item.id === 'string' && item.id &&
  typeof item.examId === 'string' && typeof item.studentId === 'string' &&
  ['active', 'queued', 'submitted'].includes(item.status) &&
  (item.number === 1 || item.number === 2) && isPlainObject(item.answers) &&
  Array.isArray(item.order) && Number.isFinite(item.startedAt);

function markLocalExamChanges() {
  const { db, readable } = readExamDbLocal();
  if (!readable) return;
  for (const space of EXAM_SYNC_SPACES) {
    const seen = new Set();
    for (const item of db[space]) {
      seen.add(item.id);
      if (examSync.lastLocal[space].get(item.id) !== stableStringify(item)) {
        examSync.pending.add(`${space}/${item.id}`);
      }
    }
    for (const id of examSync.lastLocal[space].keys()) {
      if (!seen.has(id)) examSync.pending.add(`${space}/${id}`);
    }
  }
}

async function pushExamDb() {
  if (!syncEnabled) return;
  const { db, readable } = readExamDbLocal();
  if (!readable) return;
  const tasks = [];
  const unsafeIds = [];
  for (const space of EXAM_SYNC_SPACES) {
    const valid = space === 'exams' ? examItemValid : attemptItemValid;
    const localIds = new Set();
    for (const item of db[space]) {
      if (!valid(item)) continue;
      /* This mirror writes each record as it is, so a nested key Firebase
         rejects (a hand-edited record, a future question id like `q1.2`) is
         left on the device and reported — one bad record never stops the rest. */
      const unsafe = !isRtdbKey(item.id) || unsafeKeyPath(item);
      if (unsafe) { unsafeIds.push(`${space}/${item.id}`); continue; }
      localIds.add(item.id);
      const json = stableStringify(item);
      const key = `${space}/${item.id}`;
      if (examSync.lastRemote[space].get(item.id) === json) {
        examSync.lastLocal[space].set(item.id, json);
        examSync.pending.delete(key);
        continue;
      }
      tasks.push(set(ref(getDatabase(firebaseApp), `${EXAMDB_ROOT}/${space}/${item.id}`), item).then(() => {
        examSync.lastRemote[space].set(item.id, json);
        examSync.lastLocal[space].set(item.id, json);
        examSync.pending.delete(key);
        markSyncSuccess('write');
      }));
    }
    for (const id of [...examSync.lastRemote[space].keys()]) {
      if (localIds.has(id)) continue;
      tasks.push(set(ref(getDatabase(firebaseApp), `${EXAMDB_ROOT}/${space}/${id}`), null).then(() => {
        examSync.lastRemote[space].delete(id);
        examSync.lastLocal[space].delete(id);
        examSync.pending.delete(`${space}/${id}`);
        markSyncSuccess('write');
      }));
    }
  }
  if (unsafeIds.length) reportConflict('unsafe-record');
  else clearConflict('unsafe-record');
  await Promise.all(tasks);
}

const pushLocalExamDb = () => {
  markLocalExamChanges();
  if (!ready || !navigator.onLine) { paintSyncStatus(); return Promise.resolve(); }
  setSyncStatus('pending');
  return pushExamDb().then(paintSyncStatus);
};

/** Merge one cloud snapshot of examDb into the local document (single write). */
function applyExamDbRemote(remoteRoot) {
  const remoteExams = isPlainObject(remoteRoot?.exams) ? remoteRoot.exams : {};
  const remoteAttempts = isPlainObject(remoteRoot?.attempts) ? remoteRoot.attempts : {};
  const { db } = readExamDbLocal();
  let changed = false;

  // Firebase returns an array when every child key is a sequential integer and
  // drops empty objects entirely; both shapes must be restored before the app's
  // strict document validation reads the file.
  const asMap = value => {
    if (!Array.isArray(value)) return value || {};
    const map = {};
    value.forEach((entry, index) => { if (entry !== null) map[String(index)] = entry; });
    return map;
  };
  const asList = value => {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    return Object.keys(value).sort((left, right) => Number(left) - Number(right)).map(key => value[key]);
  };

  const upsert = (space, item) => {
    const remoteJson = stableStringify(item);
    const key = `${space}/${item.id}`;
    if (examSync.pending.has(key)) return;
    const items = db[space];
    const index = items.findIndex(entry => entry.id === item.id);
    if (index === -1) {
      items.push(item);
      examSync.lastLocal[space].set(item.id, remoteJson);
      changed = true;
    } else if (stableStringify(items[index]) !== remoteJson) {
      items[index] = item;
      examSync.lastLocal[space].set(item.id, remoteJson);
      changed = true;
    }
  };

  const remoteExamIds = new Set();
  for (const raw of Object.values(remoteExams)) {
    const item = { ...raw, participants: raw.participants || [] };
    if (!examItemValid(item)) continue;
    remoteExamIds.add(item.id);
    examSync.lastRemote.exams.set(item.id, stableStringify(item));
    upsert('exams', item);
  }
  for (let i = db.exams.length - 1; i >= 0; i -= 1) {
    const id = db.exams[i].id;
    if (remoteExamIds.has(id) || examSync.pending.has(`exams/${id}`)) continue;
    if (!examSync.lastRemote.exams.has(id)) continue;   // the cloud never had it
    db.exams.splice(i, 1);
    examSync.lastRemote.exams.delete(id);
    examSync.lastLocal.exams.delete(id);
    changed = true;
  }

  const liveExamIds = new Set(db.exams.map(item => item.id));
  const remoteAttemptIds = new Set();
  for (const raw of Object.values(remoteAttempts)) {
    const item = { ...raw, answers: asMap(raw.answers), order: asList(raw.order) };
    if (!attemptItemValid(item)) continue;
    remoteAttemptIds.add(item.id);
    examSync.lastRemote.attempts.set(item.id, stableStringify(item));
    if (!liveExamIds.has(item.examId)) { examSync.orphans.set(item.id, item); continue; }
    examSync.orphans.delete(item.id);
    upsert('attempts', item);
  }
  for (const [id, item] of [...examSync.orphans]) {
    if (!liveExamIds.has(item.examId)) continue;
    examSync.orphans.delete(id);
    upsert('attempts', item);
  }
  for (let i = db.attempts.length - 1; i >= 0; i -= 1) {
    const attempt = db.attempts[i];
    if (examSync.pending.has(`attempts/${attempt.id}`)) continue;
    const examGone = !liveExamIds.has(attempt.examId);
    const deletedRemotely = !remoteAttemptIds.has(attempt.id) && examSync.lastRemote.attempts.has(attempt.id);
    if (!examGone && !deletedRemotely) continue;
    db.attempts.splice(i, 1);
    examSync.lastRemote.attempts.delete(attempt.id);
    examSync.lastLocal.attempts.delete(attempt.id);
    changed = true;
  }

  if (!changed) return false;
  remoteWrite(KEYS.exams, db, 'exams');
  window.dispatchEvent(new CustomEvent('apc-sync-updated', { detail: { collection: 'exams' } }));
  window.dispatchEvent(new Event('exam-data-updated'));
  return true;
}

async function syncExamDb() {
  const generation = syncGeneration;
  if (!syncEnabled) return;
  const node = ref(getDatabase(firebaseApp), EXAMDB_ROOT);
  const snap = await get(node);
  if (!syncEnabled || generation !== syncGeneration) return;
  if (!snap.exists()) {
    // Fresh cloud space: this device seeds it.
    await pushExamDb();
    return;
  }
  applyExamDbRemote(snap.val());
  await pushExamDb();
}

function listenExamDb() {
  onValue(ref(getDatabase(firebaseApp), EXAMDB_ROOT), snap => {
    try { applyExamDbRemote(snap.val() || {}); } catch (error) {
      console.warn('[Active Plus] exam db listener failed', error);
    }
  });
}

const RECORD_COLLECTIONS = [...SYNCABLE.filter(name => name !== 'exams' && name !== 'classChat'), 'teacherAssignments'];
const recordBridges = new Map();
const COURSES_FALLBACK_ROOT = DB_ROOT + '/courseContent/__apcCoursesRelayV1';
let coursesRulesBlocked = false;
let coursesFallbackListening = false;
const CLASSCHAT_ROOT = DB_ROOT + '/classChat';
const CLASSCHAT_FALLBACK_ROOT = DB_ROOT + '/routine/__apcClassChatRelayV1';
let classChatQueue = Promise.resolve();
let classChatRelayModulePromise = null;
let classChatRulesBlocked = false;
let classChatFallbackListening = false;

function loadClassChatRelayModule() {
  classChatRelayModulePromise ??= import('./class-chat-relay.js').catch(error => {
    classChatRelayModulePromise = null;
    throw error;
  });
  return classChatRelayModulePromise;
}

function listenClassChatFallback() {
  if (classChatFallbackListening || !syncEnabled) return;
  classChatFallbackListening = true;
  onOptionalValue(ref(getDatabase(firebaseApp), CLASSCHAT_FALLBACK_ROOT), snap => {
    const raw = snap.exists() ? (snap.val()?.entries || null) : null;
    return syncClassChat(raw).catch(error => {
      console.warn('[Active Plus] class chat fallback relay listener failed', error);
    });
  }, { label: 'classChatFallback' });
}

async function runClassChatCycleOnce(preloadedSnapshot, live) {
  const { syncClassChatRelayCycle } = await loadClassChatRelayModule();
  if (!live()) return;
  const db = getDatabase(firebaseApp);
  const usingFallback = classChatRulesBlocked;
  const node = ref(db, usingFallback ? CLASSCHAT_FALLBACK_ROOT : CLASSCHAT_ROOT);
  await syncClassChatRelayCycle({
    storage: localStorage,
    rawSetItem,
    notifyLocalUpdate: () => notifyRemote(KEYS.classChat, 'classChat'),
    readCloudSnapshot: async () => {
      if (preloadedSnapshot !== undefined) return preloadedSnapshot;
      const snap = await get(node);
      if (!live()) throw new Error('session-ended');
      markSyncSuccess('read');
      if (!snap.exists()) return null;
      return usingFallback ? (snap.val()?.entries || null) : snap.val();
    },
    runCloudTransaction: async updater => {
      if (!live()) throw new Error('session-ended');
      const result = await runTransaction(node, current => {
        if (!live()) return;
        if (!usingFallback) return updater(current);
        const curEntries = current && typeof current === 'object' ? (current.entries || null) : null;
        const nextEntries = updater(curEntries);
        if (nextEntries === null) return null;
        return { _syncKind: 'chat-relay', updatedAt: Date.now(), entries: nextEntries };
      }, { applyLocally: false });
      if (!live()) throw new Error('session-ended');
      markSyncSuccess('write');
      const val = result.snapshot.val();
      return usingFallback ? (val?.entries || null) : val;
    }
  });
}

function syncClassChat(preloadedSnapshot = undefined) {
  const generation = syncGeneration;
  const live = () => syncEnabled && generation === syncGeneration;
  if (!live()) return Promise.resolve();
  const work = classChatQueue.catch(() => {}).then(async () => {
    if (!live()) return;
    try {
      await runClassChatCycleOnce(preloadedSnapshot, live);
      classChatPending = false;
    } catch (error) {
      if (!classChatRulesBlocked && isPermissionDenied(error)) {
        classChatRulesBlocked = true;
        listenClassChatFallback();
        try {
          await runClassChatCycleOnce(undefined, live);
          classChatPending = false;
          return;
        } catch (fallbackErr) {
          if (isPermissionDenied(fallbackErr)) { classChatPending = false; return; }
          throw fallbackErr;
        }
      }
      if (isPermissionDenied(error)) { classChatPending = false; return; }
      throw error;
    }
  });
  classChatQueue = work;
  return work;
}

const pushClassChat = () => {
  classChatPending = true;
  if (!ready || !navigator.onLine) { paintSyncStatus(); return Promise.resolve(); }
  setSyncStatus('pending');
  return syncClassChat().then(paintSyncStatus);
};

function listenClassChat() {
  if (classChatRulesBlocked) {
    listenClassChatFallback();
    return;
  }
  onOptionalValue(ref(getDatabase(firebaseApp), CLASSCHAT_ROOT), snap => {
    return syncClassChat(snap.exists() ? snap.val() : null).catch(error => {
      console.warn('[Active Plus] class chat relay listener failed', error);
    });
  }, {
    label: 'classChat',
    onPermissionDenied: () => {
      classChatRulesBlocked = true;
      listenClassChatFallback();
      void syncClassChat().catch(() => {});
    }
  });
}

function normalizeCollectionSnapshot(collection, value) {
  const decoded = decodeRealtimeRecords(value || {});
  return collectionPayload(collection, remoteToLocal(collection, decoded)) || {};
}

function extractCoursesFallbackRecords(val) {
  if (!val || typeof val !== 'object') return {};
  const records = val.records;
  return records && typeof records === 'object' && !Array.isArray(records) ? records : {};
}

function ensureCoursesFallbackListener() {
  if (coursesFallbackListening || !syncEnabled) return;
  coursesFallbackListening = true;
  const bridge = recordBridge('courses');
  onOptionalValue(ref(getDatabase(firebaseApp), COURSES_FALLBACK_ROOT), snapshot => {
    if (!snapshot.exists()) {
      bridge.capture();
      if (!bridge.hasView()) return;
      bridge.receive({});
      return;
    }
    bridge.receive(normalizeCollectionSnapshot('courses', extractCoursesFallbackRecords(snapshot.val())));
  }, { label: 'courseContent/__apcCoursesRelayV1' });
}

function recordBridge(collection) {
  if (recordBridges.has(collection)) return recordBridges.get(collection);
  const key = localKey(collection);
  const stateKey = 'activePlus.syncOutbox.v2:' + collection;
  const node = ref(getDatabase(firebaseApp), DB_ROOT + '/' + collection);
  const bridge = createRecordSync({
    loadState: () => readLocal(stateKey),
    saveState: value => rawSetItem.call(localStorage, stateKey, JSON.stringify(value)),
    readLocal: () => collectionPayload(collection, readLocal(key)),
    writeLocal: value => remoteWrite(key, remoteToLocal(collection, value), collection),
    commit: async operations => {
      const generation = syncGeneration;
      if (!syncEnabled) throw new Error('session-ended');
      if (collection === 'courses') {
        const commitFallback = async () => {
          const fallbackNode = ref(getDatabase(firebaseApp), COURSES_FALLBACK_ROOT);
          const fallbackResult = await runTransaction(fallbackNode, current => {
            if (!syncEnabled || generation !== syncGeneration) return;
            const decoded = decodeRealtimeRecords(extractCoursesFallbackRecords(current));
            const merged = mergeRecordOperations(decoded, operations);
            return {
              id: '__apcCoursesRelayV1',
              _syncKind: 'coursesRelay',
              updatedAt: Date.now(),
              records: encodeRealtimeRecords(merged)
            };
          }, { applyLocally: false });
          if (!syncEnabled || generation !== syncGeneration) throw new Error('session-ended');
          markSyncSuccess('write');
          return normalizeCollectionSnapshot('courses', extractCoursesFallbackRecords(fallbackResult.snapshot.val()));
        };
        if (coursesRulesBlocked) return commitFallback();
        try {
          const result = await runTransaction(node, current => {
            if (!syncEnabled || generation !== syncGeneration) return;
            const decoded = decodeRealtimeRecords(current || {});
            return encodeRealtimeRecords(mergeRecordOperations(decoded, operations));
          }, { applyLocally: false });
          if (!syncEnabled || generation !== syncGeneration) throw new Error('session-ended');
          markSyncSuccess('write');
          return normalizeCollectionSnapshot(collection, result.snapshot.val());
        } catch (error) {
          if (!isPermissionDenied(error)) throw error;
          coursesRulesBlocked = true;
          ensureCoursesFallbackListener();
          return commitFallback();
        }
      }
      const result = await runTransaction(node, current => {
        if (!syncEnabled || generation !== syncGeneration) return;
        const decoded = decodeRealtimeRecords(current || {});
        return encodeRealtimeRecords(mergeRecordOperations(decoded, operations));
      }, { applyLocally: false });
      if (!syncEnabled || generation !== syncGeneration) throw new Error('session-ended');
      markSyncSuccess('write');
      return normalizeCollectionSnapshot(collection, result.snapshot.val());
    }
  });
  recordBridges.set(collection, bridge);
  return bridge;
}

async function syncCollection(collection) {
  const generation = syncGeneration;
  if (!syncEnabled) return;
  const bridge = recordBridge(collection);
  if (collection === 'courses') {
    const syncCoursesFallback = async () => {
      const fallbackSnap = await get(ref(getDatabase(firebaseApp), COURSES_FALLBACK_ROOT));
      if (!syncEnabled || generation !== syncGeneration) return;
      markSyncSuccess('read');
      if (!fallbackSnap.exists()) {
        bridge.capture();
        if (bridge.hasView()) bridge.receive({});
        await bridge.flush();
        return;
      }
      bridge.receive(normalizeCollectionSnapshot('courses', extractCoursesFallbackRecords(fallbackSnap.val())));
      await bridge.flush();
    };
    if (coursesRulesBlocked) {
      await syncCoursesFallback();
      return;
    }
    try {
      const snapshot = await get(ref(getDatabase(firebaseApp), DB_ROOT + '/courses'));
      if (!syncEnabled || generation !== syncGeneration) return;
      markSyncSuccess('read');
      if (!snapshot.exists()) {
        bridge.capture();
        if (bridge.hasView()) bridge.receive({});
        await bridge.flush();
        return;
      }
      bridge.receive(normalizeCollectionSnapshot('courses', snapshot.val()));
      await bridge.flush();
      return;
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      coursesRulesBlocked = true;
      await syncCoursesFallback();
      return;
    }
  }
  const snapshot = await get(ref(getDatabase(firebaseApp), DB_ROOT + '/' + collection));
  if (!syncEnabled || generation !== syncGeneration) return;
  markSyncSuccess('read');
  if (!snapshot.exists()) {
    /* A never-created RTDB node is not a remote deletion. But a device whose
       durable record view already exists must still accept a later empty
       snapshot (for example, the synced deletion of the last row). */
    bridge.capture();
    if (bridge.hasView()) bridge.receive({});
    await bridge.flush();
    return;
  }
  bridge.receive(normalizeCollectionSnapshot(collection, snapshot.val()));
  await bridge.flush();
}

async function pushCollection(collection) {
  const bridge = recordBridge(collection);
  bridge.capture();
  if (!ready || !navigator.onLine) { paintSyncStatus(); return; }
  setSyncStatus('pending');
  await bridge.flush();
  paintSyncStatus();
}

function installLocalWriteBridge() {
  if (window.__apcRealtimeSyncBridge) return;
  const pushIdentityKey = key => {
    if (key === STAFF_DIRECTORY_KEY) return pushDirectory();
    if (key === KEYS.usernames) return pushUsernames();
    if (key === KEYS.account) return pushStudentAccount();
    if (key === KEYS.exams) return pushLocalExamDb();
    if (key === KEYS.classChat) return pushClassChat();
    return null;
  };
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    const result = originalSetItem.call(this, key, value);
    if (syncEnabled && this === window.localStorage) {
      const staffRole = staffRoleByAccountKey(key);
      if (staffRole) pushStaffRole(staffRole).catch(syncError);
      for (const collection of RECORD_COLLECTIONS) {
        if (collection === 'exams') continue;   // mirrored by the dedicated examDb path
        if (localKey(collection) === key) {
          pushCollection(collection).catch(recordSyncError);
        }
      }
      try {
        const errorHandler = (key === KEYS.exams || key === KEYS.classChat) ? recordSyncError : syncError;
        pushIdentityKey(key)?.catch(errorHandler);
      } catch {}
    }
    return result;
  };
  window.addEventListener('storage', event => {
    if (!syncEnabled || event.apcRemote || event.storageArea !== window.localStorage) return;
    for (const collection of RECORD_COLLECTIONS) {
      if (collection === 'exams') continue;     // mirrored by the dedicated examDb path
      if (localKey(collection) === event.key) {
        pushCollection(collection).catch(recordSyncError);
      }
    }
    const role = staffRoleByAccountKey(event.key);
    if (role) pushStaffRole(role).catch(syncError);
    try {
      const errorHandler = (event.key === KEYS.exams || event.key === KEYS.classChat) ? recordSyncError : syncError;
      pushIdentityKey(event.key)?.catch(errorHandler);
    } catch {}
  });
  window.__apcRealtimeSyncBridge = true;
}

function listenStaffRole(role) {
  const node = ref(getDatabase(firebaseApp), STAFF_ROOT + '/' + role);
  onValue(node, snap => {
    if (!snap.exists()) return;
    const remote = snap.val();
    if (!remote || typeof remote !== 'object' || !remote.username || !remote.password) return;
    const serialized = JSON.stringify(remote);
    if (lastRemote.get('staff:' + role) === serialized) return;
    lastRemote.set('staff:' + role, serialized);
    writeStaffLocal(role, remote).then(() => {
      window.dispatchEvent(new CustomEvent('apc-sync-updated', { detail: { collection: 'staffAccounts', role } }));
    }).catch(error => console.warn('[Active Plus] staff listener failed', error));
  });
}

function listenIdentity(rootPath, label, isValid, applyLocal) {
  const node = ref(getDatabase(firebaseApp), rootPath);
  onValue(node, async snap => {
    if (!snap.exists()) return;
    const remote = snap.val();
    if (!isValid(remote)) return;
    const serialized = JSON.stringify(remote);
    if (lastRemote.get(label) === serialized) return;
    lastRemote.set(label, serialized);
    await applyLocal(remote);
    window.dispatchEvent(new CustomEvent('apc-sync-updated', { detail: { collection: label } }));
  });
}

const listenDirectory = () => onValue(ref(getDatabase(firebaseApp), DIRECTORY_ROOT), snap => {
  if (lastRemote.get('staffDirectory') === JSON.stringify(snap.val())) return;
  return syncDirectory();
});
const listenUsernames = () =>
  listenIdentity(USERNAMES_ROOT, 'usernames', isUsernamesRecord, value => { remoteWrite(KEYS.usernames, decodeUsernameRegistry(value), 'usernames'); });
let stopStudent = null;
let studentListeningKey = null;
function listenStudentAccount() {
  const key = studentKey(readLocal(KEYS.account));
  if (studentListeningKey === key && stopStudent) return;
  stopStudent?.();
  subscriptions.delete(stopStudent);
  studentListeningKey = key;
  if (!key) { stopStudent = null; return; }
  stopStudent = onValue(ref(getDatabase(firebaseApp), STUDENTS_ROOT + '/' + encodeUsernameKey(key)), snap => {
    const remote = snap.val();
    const local = readLocal(KEYS.account);
    if (studentKey(local) !== key || !isStudentAccountRecord(remote)) return;
    if (!sameStudentRecord(local, remote)) {
      // Another student owns this login ID in the cloud: never adopt their
      // record here (that would silently replace this device's account).
      reportConflict('login-id-conflict');
      return;
    }
    lastRemote.set('student:' + key, JSON.stringify(remote));
    // Adopt the cloud copy only when it is genuinely newer than this device's.
    // A phone that just flipped to 'active' after an approval must not be put
    // back to the office's older copy (a stale 'pending' login record).
    if (recordTime(remote) > recordTime(local)) remoteWrite(KEYS.account, remote, 'studentAccount');
  });
}

/* ---- Global Admin initialization -------------------------------------------
   The institution has exactly ONE Admin Account and it is not per device, so
   "does an Admin exist?" is a cloud question. The answer combines the global
   marker (`system/adminInitialized`) with the Admin record itself: a database
   written before the marker existed is NEVER read as "no Admin". Nothing here
   reads or writes localStorage — the caller only learns what the cloud holds. */

const isAdminRecord = value =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
  (typeof value.username === 'string' || Boolean(value.password));

// Read only the first-use Admin state. Do not hydrate other accounts or start
// syncing application records merely because the login page was opened.
export async function adminInitializationState() {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  try {
    await ensureCloudAuth();
    const db = getDatabase(firebaseApp);
    /* The Admin RECORD is the source of truth, so it is read first: a deployed
       database whose rules do not allow the `system` marker yet must not turn
       an existing Admin into an unanswerable question. */
    const adminSnapshot = await get(ref(db, STAFF_ROOT + '/admin'));
    const record = adminSnapshot.exists() ? adminSnapshot.val() : null;
    const recordExists = isAdminRecord(record);
    let flag = false;
    try {
      const flagSnapshot = await get(ref(db, SYSTEM_ROOT + '/adminInitialized'));
      flag = flagSnapshot.exists() && flagSnapshot.val() === true;
    } catch (error) {
      // Only when no record exists does the marker matter, and an unreadable
      // marker is never "not initialized": the caller stays fail-closed and
      // says the cloud could not be verified. Log the exact reason.
      if (!recordExists) throw error;
      console.warn('[Active Plus] adminInitialized marker unreadable:', error?.code || error?.message || error);
    }
    return { ok: true, initialized: flag || recordExists, flag, recordExists };
  } catch (error) {
    return { ok: false, reason: 'admin-check-failed', error };
  }
}

/** Compatibility answer for the login page's first-use gate. */
export async function firstAdminExistsOnline() {
  const state = await adminInitializationState();
  return state.ok ? { ok: true, exists: state.initialized } : state;
}

/* The flag is written only AFTER the Admin record exists, and it is a marker,
   not the source of truth: a device that holds the record keeps the system
   initialised even if this one write never lands. */
async function writeAdminInitializedFlag() {
  const snapshot = await get(ref(getDatabase(firebaseApp), SYSTEM_ROOT + '/adminInitialized'));
  if (snapshot.exists() && snapshot.val() === true) return { ok: true, already: true };
  await set(ref(getDatabase(firebaseApp), SYSTEM_ROOT + '/adminInitialized'), true);
  return { ok: true };
}

/* Best-effort marker for a record that already reached the cloud (a legacy
   install, or a device that carried the Admin account from an older release).
   A failure here never fails the sync it was called from. */
let adminFlagFlight = null;
function ensureAdminInitializedFlag() {
  if (adminFlagFlight) return adminFlagFlight;
  adminFlagFlight = writeAdminInitializedFlag()
    .catch(error => console.warn('[Active Plus] Admin initialization flag not stored:', error?.message || error))
    .finally(() => { adminFlagFlight = null; });
  return adminFlagFlight;
}

/**
 * Atomically create the institution's Admin Account.
 *
 * The transaction runs on the server, so of two fresh devices submitting at
 * the same moment only one commits; the loser is told the Admin already exists
 * and is left with nothing written — no duplicate, and no half-created Admin
 * that a later sync would have to discard.
 */
export async function claimFirstAdminAccount(record) {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  if (!isAdminRecord(record) || !isPasswordRecord(record?.password)) {
    return { ok: false, reason: 'invalid-record' };
  }
  try {
    await ensureCloudAuth();
    const result = await runTransaction(ref(getDatabase(firebaseApp), STAFF_ROOT + '/admin'), current => {
      // Anything already stored here — even a record written by an older
      // release — means the one Admin Account exists and creation is closed.
      if (isAdminRecord(current)) return;
      return record;
    }, { applyLocally: false });
    if (!result.committed) return { ok: false, reason: 'admin-exists' };
    await ensureAdminInitializedFlag();
    return { ok: true };
  } catch (error) {
    syncError(error);
    return { ok: false, reason: 'claim-failed', error };
  }
}

/* ---- Factory reset ---------------------------------------------------------
   The Admin panel's «সম্পূর্ণ ডাটাবেজ রিসেট» (docs/FACTORY-RESET.md) returns the
   institution's database to a genuine fresh start, so the login screen offers
   the first-use Admin Account setup again. The rules refuse one big wipe of
   the bridge, so every node is removed individually. Push-token registrations
   are write-only and cannot be enumerated; orphaned tokens are harmless (FCM
   deliveries to them simply fail) and are left in place. */

/* Same set as the rules generator's record collections
   (tools/rtdb-rules/build-interim-rules.mjs): every collection mirrored at
   the collection level, except `exams`, which travels through the examDb
   mirror. */
const RESET_COLLECTIONS = Object.freeze([...SYNCABLE.filter(name => name !== 'exams'), 'teacherAssignments']);

/**
 * Delete everything the institution owns under the v1 bridge.
 *
 * Resolves to
 *   { ok: true,  cleared: [path…], failed: [] }
 *   { ok: false, reason: 'offline' | 'reset-failed', … }
 *   { ok: false, failed: [{ path, reason }…] }  — partial wipe; the caller
 *                                                  must keep local data intact
 */
export async function resetCloudDatabase() {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  const cleared = [];
  const failed = [];
  // No listener may stay attached while the database is emptied: an empty
  // snapshot would be merged back into this device, and an outbox retry could
  // re-push a local record mid-wipe.
  stopRealtimeSync();
  try {
    await ensureCloudAuth();
    const db = getDatabase(firebaseApp);
    const drop = async (path, { optional = false } = {}) => {
      try {
        await set(ref(db, path), null);
        cleared.push(path);
      } catch (error) {
        if (optional && isPermissionDenied(error)) return;
        failed.push({ path, reason: error?.code || error?.message || 'write-failed' });
      }
    };
    for (const name of RESET_COLLECTIONS) {
      await drop(`${DB_ROOT}/${name}`, { optional: name === 'classChat' });
    }
    await drop(`${EXAMDB_ROOT}/exams`);
    await drop(`${EXAMDB_ROOT}/attempts`);
    await drop(USERNAMES_ROOT);
    await drop(MOBILE_INDEX_ROOT, { optional: true });
    await drop(EMAIL_INDEX_ROOT, { optional: true });
    await drop(DAILY_COUNTERS_ROOT, { optional: true });
    await drop(NOTIFICATIONS_ROOT, { optional: true });
    await drop(DIRECTORY_ROOT);
    /* Student login records: the rules allow deletion per login key, not of
       the parent — enumerate, then remove one by one. */
    try {
      const snapshot = await get(ref(db, STUDENTS_ROOT));
      const children = snapshot.exists() ? Object.keys(snapshot.val() || {}) : [];
      for (const key of children) await drop(`${STUDENTS_ROOT}/${key}`);
    } catch (error) {
      failed.push({ path: STUDENTS_ROOT, reason: error?.code || error?.message || 'read-failed' });
    }
    for (const role of Object.keys(STAFF_ACCOUNTS)) await drop(`${STAFF_ROOT}/${role}`);
    // The marker goes last: while the Admin record still exists the system
    // still counts as initialized, so no device misreads the gap in between.
    await drop(`${SYSTEM_ROOT}/adminInitialized`);
    if (failed.length) return { ok: false, cleared, failed };
    return { ok: true, cleared, failed };
  } catch (error) {
    syncError(error);
    return { ok: false, reason: 'reset-failed', error, cleared, failed };
  }
}

function hasReviewerLocalSession() {
  for (const role of ['admin', 'manager']) {
    const spec = STAFF_ACCOUNTS[role];
    if (!spec) continue;
    try {
      if (window.sessionStorage?.getItem(spec.sessionKey) || window.localStorage?.getItem(spec.sessionKey)) {
        return true;
      }
    } catch { /* ignore blocked storage */ }
  }
  return false;
}

function mergeRegistrationNotificationLists(localItems, remoteMap) {
  const byId = new Map();
  for (const item of Array.isArray(localItems) ? localItems : []) {
    if (item && typeof item === 'object' && item.id && item.studentId) {
      byId.set(item.id, { ...item });
    }
  }
  if (remoteMap && typeof remoteMap === 'object') {
    for (const [key, remote] of Object.entries(remoteMap)) {
      if (!remote || typeof remote !== 'object' || !remote.studentId) continue;
      const id = String(remote.id || key);
      const prev = byId.get(id);
      const read = Boolean(prev?.read || remote.read);
      byId.set(id, {
        ...(prev || {}),
        ...remote,
        id,
        read,
        ...(prev?.readAt && !remote.readAt ? { readAt: prev.readAt } : {}),
        ...(prev?.readBy && !remote.readBy ? { readBy: prev.readBy } : {})
      });
    }
  }
  return [...byId.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

let notificationsRulesBlocked = false;

async function syncRegistrationNotifications() {
  if (!syncEnabled || !hasReviewerLocalSession() || notificationsRulesBlocked) return;
  const generation = syncGeneration;
  const db = getDatabase(firebaseApp);
  let snap;
  try {
    snap = await get(ref(db, NOTIFICATIONS_ROOT));
  } catch (error) {
    if (isPermissionDenied(error)) {
      notificationsRulesBlocked = true;
      console.warn('[Active Plus] notifications RTDB rules not yet deployed; deriving registration alerts from synced students.');
      return;
    }
    throw error;
  }
  if (!syncEnabled || generation !== syncGeneration) return;
  const remote = snap.exists() ? snap.val() : {};
  const local = readLocal(KEYS.registrationNotifications) || [];
  const merged = mergeRegistrationNotificationLists(local, remote);
  remoteWrite(KEYS.registrationNotifications, merged, 'registrationNotifications');
  for (const item of merged) {
    const remoteItem = remote?.[item.id];
    if (!remoteItem || (item.read && !remoteItem.read)) {
      try {
        await set(ref(db, `${NOTIFICATIONS_ROOT}/${item.id}`), item);
      } catch { /* best-effort push of local read state */ }
    }
  }
}

function listenRegistrationNotifications() {
  if (!hasReviewerLocalSession() || notificationsRulesBlocked) return;
  onOptionalValue(ref(getDatabase(firebaseApp), NOTIFICATIONS_ROOT), snapshot => {
    const remote = snapshot.exists() ? snapshot.val() : {};
    const local = readLocal(KEYS.registrationNotifications) || [];
    const merged = mergeRegistrationNotificationLists(local, remote);
    remoteWrite(KEYS.registrationNotifications, merged, 'registrationNotifications');
  }, {
    label: 'notifications',
    onPermissionDenied: () => { notificationsRulesBlocked = true; }
  });
}

function randomHexSuffix(byteLength = 6) {
  const bytes = new Uint8Array(byteLength);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Obtain authoritative server epoch milliseconds via RTDB ServerValue.TIMESTAMP. */
export async function getServerTimeMs() {
  if (!LEGACY_CLOUD_ENABLED || !navigator.onLine) return Date.now();
  try {
    await ensureCloudAuth();
  } catch {
    return Date.now();
  }
  const db = getDatabase(firebaseApp);
  const probeKey = `clock-${randomHexSuffix(6)}`;
  const probeRef = ref(db, `${SYSTEM_ROOT}/connectivityProbe/${probeKey}`);
  try {
    await set(probeRef, { at: { '.sv': 'timestamp' } });
    const snap = await get(probeRef);
    const serverAt = Number(snap.val()?.at);
    if (Number.isFinite(serverAt) && serverAt > 0) return serverAt;
  } catch {
    /* Fall back cleanly to device clock if probe read/write is unavailable */
  } finally {
    void set(probeRef, null).catch(() => {});
  }
  return Date.now();
}

/**
 * Fallback atomic registration using ONLY legacy pre-deployed RTDB nodes
 * (`usernames`, `students`, `studentAccounts`) when `mobileIndex` or
 * `dailyStudentCounters` rules have not yet been deployed to Firebase Console.
 */
async function registerStudentViaLegacyNodes({
  db,
  cleanMobile,
  cleanUsername,
  cleanEmail,
  preferredStudentId = '',
  userKey,
  claimToken,
  buildRecords
}) {
  let usernameReserved = false;
  let reservedStudentId = '';
  const preferredId = /^\d{9}$/.test(String(preferredStudentId || '').trim()) ? String(preferredStudentId).trim() : '';
  const rollbackLegacy = async () => {
    const cleanup = [];
    if (usernameReserved) {
      cleanup.push(runTransaction(ref(db, USERNAMES_ROOT), current => {
        if (!current || typeof current !== 'object' || current[userKey] !== claimToken) return undefined;
        const next = { ...current };
        delete next[userKey];
        return Object.keys(next).length ? next : undefined;
      }, { applyLocally: false }).catch(() => {}));
    }
    if (reservedStudentId) {
      cleanup.push(runTransaction(ref(db, `${DB_ROOT}/students/${reservedStudentId}`), current => {
        if (!current || typeof current !== 'object' || current.__claimToken !== claimToken) return undefined;
        return null;
      }, { applyLocally: false }).catch(() => {}));
    }
    await Promise.allSettled(cleanup);
  };

  try {
    let userDup = false;
    let alreadyRegisteredSameId = false;
    const userTx = await runTransaction(ref(db, USERNAMES_ROOT), current => {
      const map = current && typeof current === 'object' ? current : {};
      if (map[userKey] !== undefined && map[userKey] !== null) {
        if (preferredId && map[userKey] === preferredId) alreadyRegisteredSameId = true;
        userDup = true;
        return;
      }
      return { ...map, [userKey]: claimToken };
    }, { applyLocally: false });
    if (alreadyRegisteredSameId) {
      return { ok: true, studentId: preferredId, idempotent: true };
    }
    if (!userTx.committed || userDup || userTx.snapshot.val()?.[userKey] !== claimToken) {
      return {
        ok: false,
        reason: 'duplicate',
        field: 'username',
        error: 'এই ইউজারনেমটি আগেই নেওয়া হয়েছে। অন্য একটি বেছে নিন — এটি পরে বদলানো যাবে না।'
      };
    }
    usernameReserved = true;

    const serverMs = await getServerTimeMs();
    const datePrefix = dhakaYYMMDD(serverMs);
    let dupField = '';
    let overLimit = false;
    let candidateId = '';

    const studentClaimTx = await runTransaction(ref(db, `${DB_ROOT}/students`), current => {
      dupField = '';
      overLimit = false;
      candidateId = '';
      const rawMap = current && typeof current === 'object' ? current : {};
      const rows = Object.values(decodeRealtimeRecords(rawMap)).filter(Boolean);
      for (const row of rows) {
        const rowMobile = contactNumber(row?.registrationMobile || row?.mobile || row?.studentMobile || '');
        if (rowMobile && rowMobile === cleanMobile) { dupField = 'mobile'; return; }
        const rowUser = normalizeUsername(row?.username || '');
        if (rowUser && rowUser === cleanUsername) { dupField = 'username'; return; }
        if (cleanEmail) {
          const rowEmail = normalizeEmail(row?.email || '');
          if (rowEmail && rowEmail === cleanEmail) { dupField = 'email'; return; }
        }
      }
      if (preferredId && !rawMap[preferredId]) {
        candidateId = preferredId;
      } else {
        const nextSerial = maxExistingDailySerial(datePrefix, rows) + 1;
        if (nextSerial > MAX_DAILY_STUDENTS) {
          overLimit = true;
          return;
        }
        candidateId = formatStudentId(datePrefix, nextSerial);
        if (rawMap[candidateId]) { dupField = 'id'; return; }
      }
      return {
        ...rawMap,
        [candidateId]: {
          id: candidateId,
          status: 'pending',
          registrationMobile: cleanMobile,
          mobile: cleanMobile,
          username: cleanUsername,
          ...(cleanEmail ? { email: cleanEmail } : {}),
          createdAt: new Date(serverMs).toISOString(),
          __claimToken: claimToken
        }
      };
    }, { applyLocally: false });

    if (!studentClaimTx.committed || dupField || overLimit || !candidateId) {
      await rollbackLegacy();
      if (overLimit) return { ok: false, reason: 'daily-limit', field: 'id', error: DAILY_LIMIT_ERROR };
      if (dupField === 'mobile') return { ok: false, reason: 'duplicate', field: 'mobile', error: 'এই মোবাইল নম্বর দিয়ে আগেই রেজিস্ট্রেশন হয়েছে।' };
      if (dupField === 'email') return { ok: false, reason: 'duplicate', field: 'email', error: 'এই ইমেইল ঠিকানা দিয়ে আগেই রেজিস্ট্রেশন হয়েছে।' };
      return {
        ok: false,
        reason: 'duplicate',
        field: 'username',
        error: 'এই ইউজারনেমটি আগেই নেওয়া হয়েছে। অন্য একটি বেছে নিন — এটি পরে বদলানো যাবে না।'
      };
    }
    reservedStudentId = candidateId;

    const { studentRow, cloudAccount, notificationRecord } = await buildRecords({ studentId: reservedStudentId, serverMs });
    const safeCloudAccount = studentAccountPayload(cloudAccount);
    const encodedStudentsMap = encodeRealtimeRecords({ [reservedStudentId]: studentRow });
    const encodedStudentNode = encodedStudentsMap[reservedStudentId] || studentRow;

    await Promise.all([
      set(ref(db, `${STUDENTS_ROOT}/${userKey}`), safeCloudAccount),
      set(ref(db, `${DB_ROOT}/students/${reservedStudentId}`), encodedStudentNode),
      runTransaction(ref(db, USERNAMES_ROOT), current => ({
        ...(current && typeof current === 'object' ? current : {}),
        [userKey]: reservedStudentId
      }), { applyLocally: false }),
      set(ref(db, `${NOTIFICATIONS_ROOT}/${notificationRecord.id}`), notificationRecord).catch(error => {
        if (isPermissionDenied(error)) {
          notificationsRulesBlocked = true;
          return;
        }
        throw error;
      })
    ]);

    return { ok: true, studentId: reservedStudentId, serverMs, studentRow, cloudAccount: safeCloudAccount, notificationRecord };
  } catch (error) {
    await rollbackLegacy();
    return { ok: false, reason: 'network-unavailable', error };
  }
}

/**
 * Atomic online student registration:
 *  1) Reserves mobile, username, and optional email via RTDB transactions
 *  2) Obtains authoritative server time in Asia/Dhaka and increments dailyStudentCounters/<YYMMDD> (001–999)
 *  3) Writes studentAccounts/<username>, students/<studentId>, and notifications/<notifId>
 *  4) Rolls back claims if any pre-commit step fails
 */
export async function registerStudentAtomicallyOnline({ mobile, username, email = '', preferredStudentId = '', buildRecords }) {
  if (!LEGACY_CLOUD_ENABLED) return cloudPausedResult();
  if (!navigator.onLine) return { ok: false, reason: 'network-unavailable', offline: true };

  const cleanMobile = contactNumber(mobile);
  const cleanUsername = normalizeUsername(username);
  const cleanEmail = normalizeEmail(email);
  const preferredId = /^\d{9}$/.test(String(preferredStudentId || '').trim()) ? String(preferredStudentId).trim() : '';
  const userKey = encodeUsernameKey(cleanUsername);
  const emailKey = cleanEmail ? encodeUsernameKey(cleanEmail) : '';
  const claimToken = `pending:${randomHexSuffix(6)}`;

  let db;
  try {
    const user = await ensureCloudAuth();
    if (!user) return { ok: false, reason: 'network-unavailable' };
    db = getDatabase(firebaseApp);
  } catch (error) {
    return { ok: false, reason: 'network-unavailable', error };
  }

  let mobileClaimed = false;
  let usernameClaimed = false;
  let emailClaimed = false;

  const rollbackClaims = async () => {
    const tasks = [];
    if (mobileClaimed) {
      tasks.push(runTransaction(ref(db, `${MOBILE_INDEX_ROOT}/${cleanMobile}`), cur => (cur === claimToken ? null : undefined), { applyLocally: false }).catch(() => {}));
    }
    if (usernameClaimed) {
      tasks.push(runTransaction(ref(db, `${USERNAMES_ROOT}/${userKey}`), cur => (cur === claimToken ? null : undefined), { applyLocally: false }).catch(() => {}));
    }
    if (emailClaimed && emailKey) {
      tasks.push(runTransaction(ref(db, `${EMAIL_INDEX_ROOT}/${emailKey}`), cur => (cur === claimToken ? null : undefined), { applyLocally: false }).catch(() => {}));
    }
    await Promise.allSettled(tasks);
  };

  try {
    // Pre-check existing cloud directory, student accounts, and roster for legacy unindexed duplicates.
    const [dirSnap, existingAccSnap, allStudentsSnap, allAccountsSnap] = await Promise.all([
      get(ref(db, DIRECTORY_ROOT)),
      get(ref(db, `${STUDENTS_ROOT}/${userKey}`)),
      get(ref(db, `${DB_ROOT}/students`)),
      get(ref(db, STUDENTS_ROOT))
    ]);

    if (preferredId && existingAccSnap.exists()) {
      const existingAcc = existingAccSnap.val();
      const existingId = String(existingAcc?.student?.id || existingAcc?.studentId || '').trim();
      const existingMob = contactNumber(existingAcc?.registrationMobile || existingAcc?.mobile || '');
      if (existingId === preferredId && existingMob === cleanMobile) {
        return { ok: true, studentId: preferredId, idempotent: true };
      }
    }

    const staffRecords = Object.values(dirSnap.val()?.records || {});
    if (existingAccSnap.exists() || staffRecords.some(emp => loginIdOf(emp) === cleanUsername)) {
      return {
        ok: false,
        reason: 'duplicate',
        field: 'username',
        error: 'এই ইউজারনেমটি আগেই নেওয়া হয়েছে। অন্য একটি বেছে নিন — এটি পরে বদলানো যাবে না।'
      };
    }

    const rawStudentsVal = allStudentsSnap.exists() ? (allStudentsSnap.val() || {}) : {};
    const existingStudents = Object.values(decodeRealtimeRecords(rawStudentsVal)).filter(Boolean);
    const existingAccounts = Object.values(allAccountsSnap.val() || {}).filter(Boolean);

    for (const row of [...existingStudents, ...existingAccounts]) {
      const rowMobile = contactNumber(row?.registrationMobile || row?.mobile || row?.student?.studentMobile || '');
      if (rowMobile && rowMobile === cleanMobile) {
        return { ok: false, reason: 'duplicate', field: 'mobile', error: 'এই মোবাইল নম্বর দিয়ে আগেই রেজিস্ট্রেশন হয়েছে।' };
      }
      const rowUser = normalizeUsername(row?.username || row?.student?.username || '');
      if (rowUser && rowUser === cleanUsername) {
        return {
          ok: false,
          reason: 'duplicate',
          field: 'username',
          error: 'এই ইউজারনেমটি আগেই নেওয়া হয়েছে। অন্য একটি বেছে নিন — এটি পরে বদলানো যাবে না।'
        };
      }
      if (cleanEmail) {
        const rowEmail = normalizeEmail(row?.email || row?.student?.email || '');
        if (rowEmail && rowEmail === cleanEmail) {
          return { ok: false, reason: 'duplicate', field: 'email', error: 'এই ইমেইল ঠিকানা দিয়ে আগেই রেজিস্ট্রেশন হয়েছে।' };
        }
      }
    }

    // 1. Atomic transaction on mobileIndex/<mobile>
    const mobileTx = await runTransaction(ref(db, `${MOBILE_INDEX_ROOT}/${cleanMobile}`), current => {
      if (current !== null && current !== undefined) return;
      return claimToken;
    }, { applyLocally: false });
    if (!mobileTx.committed || mobileTx.snapshot.val() !== claimToken) {
      return { ok: false, reason: 'duplicate', field: 'mobile', error: 'এই মোবাইল নম্বর দিয়ে আগেই রেজিস্ট্রেশন হয়েছে।' };
    }
    mobileClaimed = true;

    // 2. Atomic transaction on usernames/<userKey>
    const userTx = await runTransaction(ref(db, `${USERNAMES_ROOT}/${userKey}`), current => {
      if (current !== null && current !== undefined) return;
      return claimToken;
    }, { applyLocally: false });
    if (!userTx.committed || userTx.snapshot.val() !== claimToken) {
      await rollbackClaims();
      return {
        ok: false,
        reason: 'duplicate',
        field: 'username',
        error: 'এই ইউজারনেমটি আগেই নেওয়া হয়েছে। অন্য একটি বেছে নিন — এটি পরে বদলানো যাবে না।'
      };
    }
    usernameClaimed = true;

    // 3. Atomic transaction on emailIndex/<emailKey> (when email provided)
    if (emailKey) {
      const emailTx = await runTransaction(ref(db, `${EMAIL_INDEX_ROOT}/${emailKey}`), current => {
        if (current !== null && current !== undefined) return;
        return claimToken;
      }, { applyLocally: false });
      if (!emailTx.committed || emailTx.snapshot.val() !== claimToken) {
        await rollbackClaims();
        return { ok: false, reason: 'duplicate', field: 'email', error: 'এই ইমেইল ঠিকানা দিয়ে আগেই রেজিস্ট্রেশন হয়েছে।' };
      }
      emailClaimed = true;
    }

    // 4. Authoritative server time -> Asia/Dhaka YYMMDD -> atomic daily serial (001–999)
    const serverMs = await getServerTimeMs();
    const datePrefix = dhakaYYMMDD(serverMs);
    let studentId = '';

    if (preferredId && !rawStudentsVal[preferredId]) {
      const prefPrefix = preferredId.slice(0, 6);
      const prefSerial = Number(preferredId.slice(6));
      if (prefSerial >= 1 && prefSerial <= MAX_DAILY_STUDENTS) {
        await runTransaction(ref(db, `${DAILY_COUNTERS_ROOT}/${prefPrefix}`), current => {
          const curNum = Number(current) || 0;
          return prefSerial > curNum ? prefSerial : undefined;
        }, { applyLocally: false }).catch(() => {});
        studentId = preferredId;
      }
    }

    if (!studentId) {
      const floor = maxExistingDailySerial(datePrefix, existingStudents);
      let overLimit = false;
      const seqTx = await runTransaction(ref(db, `${DAILY_COUNTERS_ROOT}/${datePrefix}`), current => {
        const base = Math.max(Number(current) || 0, floor);
        if (base >= MAX_DAILY_STUDENTS) {
          overLimit = true;
          return;
        }
        return base + 1;
      }, { applyLocally: false });
      if (!seqTx.committed || overLimit) {
        await rollbackClaims();
        return { ok: false, reason: 'daily-limit', field: 'id', error: DAILY_LIMIT_ERROR };
      }
      const serial = Number(seqTx.snapshot.val());
      studentId = formatStudentId(datePrefix, serial);
    }

    // 5. Build and persist student account, roster row, notification, and finalized index claims
    const { studentRow, cloudAccount, notificationRecord } = await buildRecords({ studentId, serverMs });
    const safeCloudAccount = studentAccountPayload(cloudAccount);
    const encodedStudentsMap = encodeRealtimeRecords({ [studentId]: studentRow });
    const encodedStudentNode = encodedStudentsMap[studentId] || studentRow;

    await Promise.all([
      set(ref(db, `${MOBILE_INDEX_ROOT}/${cleanMobile}`), studentId),
      set(ref(db, `${USERNAMES_ROOT}/${userKey}`), studentId),
      ...(emailKey ? [set(ref(db, `${EMAIL_INDEX_ROOT}/${emailKey}`), studentId)] : []),
      set(ref(db, `${STUDENTS_ROOT}/${userKey}`), safeCloudAccount),
      set(ref(db, `${DB_ROOT}/students/${studentId}`), encodedStudentNode),
      set(ref(db, `${NOTIFICATIONS_ROOT}/${notificationRecord.id}`), notificationRecord).catch(error => {
        if (isPermissionDenied(error)) {
          notificationsRulesBlocked = true;
          return;
        }
        throw error;
      })
    ]);

    return { ok: true, studentId, serverMs, studentRow, cloudAccount: safeCloudAccount, notificationRecord };
  } catch (error) {
    await rollbackClaims();
    if (isPermissionDenied(error)) {
      return registerStudentViaLegacyNodes({
        db,
        cleanMobile,
        cleanUsername,
        cleanEmail,
        preferredStudentId: preferredId,
        userKey,
        claimToken,
        buildRecords
      });
    }
    return { ok: false, reason: 'network-unavailable', error };
  }
}

/**
 * Push an Admin/Manager registration decision (approve or reject) to RTDB so
 * the student's login record, shared roster row, and notification read state
 * update immediately across devices.
 */
export async function syncRegistrationDecisionOnline({
  studentId,
  studentRow,
  decision,
  approvedBy = '',
  approvedAt = '',
  reviewNote = ''
}) {
  if (!LEGACY_CLOUD_ENABLED || !navigator.onLine) return { ok: false, reason: 'offline' };
  if (!hasReviewerLocalSession()) return { ok: false, reason: 'not-allowed' };
  const sid = String(studentId || '').trim();
  if (!sid) return { ok: false, reason: 'missing-id' };
  try {
    await ensureCloudAuth();
    const db = getDatabase(firebaseApp);
    const mappedAccountStatus = decision === 'approved' || decision === 'active' ? 'active' : 'rejected';
    const nowIso = approvedAt || new Date().toISOString();

    if (studentRow && typeof studentRow === 'object') {
      const encodedMap = encodeRealtimeRecords({ [sid]: studentRow });
      const encodedRow = encodedMap[sid] || studentRow;
      await runTransaction(ref(db, `${DB_ROOT}/students/${sid}`), current => ({
        ...(current && typeof current === 'object' ? current : {}),
        ...encodedRow,
        id: sid
      }), { applyLocally: false });
    }

    // Update studentAccounts/<loginKey> so a pending student can immediately sign in on any device.
    let targetUserKey = '';
    const candidateName = normalizeUsername(studentRow?.username || '');
    if (candidateName) targetUserKey = encodeUsernameKey(candidateName);
    if (targetUserKey) {
      const snap = await get(ref(db, `${STUDENTS_ROOT}/${targetUserKey}`));
      if (snap.exists()) {
        const currentAcc = snap.val();
        await set(ref(db, `${STUDENTS_ROOT}/${targetUserKey}`), {
          ...currentAcc,
          status: mappedAccountStatus,
          ...(approvedBy ? { approvedBy } : {}),
          ...(approvedAt ? { approvedAt } : {}),
          ...(reviewNote ? { reviewNote } : {}),
          updatedAt: nowIso,
          student: {
            ...(currentAcc.student || {}),
            status: decision === 'approved' || decision === 'active' ? 'approved' : 'rejected'
          }
        });
      } else {
        targetUserKey = '';
      }
    }
    if (!targetUserKey) {
      const allAccSnap = await get(ref(db, STUDENTS_ROOT));
      const entries = Object.entries(allAccSnap.val() || {});
      for (const [k, acc] of entries) {
        const accId = String(acc?.student?.id || acc?.studentId || '').trim();
        if (accId === sid && isPasswordRecord(acc?.pinHash)) {
          await set(ref(db, `${STUDENTS_ROOT}/${k}`), {
            ...acc,
            status: mappedAccountStatus,
            ...(approvedBy ? { approvedBy } : {}),
            ...(approvedAt ? { approvedAt } : {}),
            ...(reviewNote ? { reviewNote } : {}),
            updatedAt: nowIso,
            student: {
              ...(acc.student || {}),
              status: decision === 'approved' || decision === 'active' ? 'approved' : 'rejected'
            }
          });
          break;
        }
      }
    }

    // Mark matching notification(s) as read: true in RTDB (best-effort if rules not yet deployed).
    if (!notificationsRulesBlocked) {
      try {
        const notifSnap = await get(ref(db, NOTIFICATIONS_ROOT));
        if (notifSnap.exists()) {
          const notifMap = notifSnap.val() || {};
          for (const [nId, item] of Object.entries(notifMap)) {
            if (item && (item.studentId === sid || nId === `reg-${sid}`) && !item.read) {
              await set(ref(db, `${NOTIFICATIONS_ROOT}/${nId}`), {
                ...item,
                read: true,
                readAt: nowIso,
                ...(approvedBy ? { readBy: approvedBy } : {})
              });
            }
          }
        }
      } catch (error) {
        if (isPermissionDenied(error)) notificationsRulesBlocked = true;
        else throw error;
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'decision-sync-failed', error };
  }
}

/**
 * Refresh a student's latest approval state from RTDB during login so a newly
 * approved student is unlocked immediately without needing an active session first.
 */
export async function refreshStudentApprovalOnline(account) {
  if (!LEGACY_CLOUD_ENABLED || !navigator.onLine || !account) return { ok: false, reason: 'offline' };
  const sid = String(account.student?.id || account.studentId || '').trim();
  const uname = normalizeUsername(account.username || account.student?.username || '');
  try {
    await ensureCloudAuth();
    const db = getDatabase(firebaseApp);
    const reads = [
      sid ? get(ref(db, `${DB_ROOT}/students/${sid}`)) : Promise.resolve(null),
      uname ? get(ref(db, `${STUDENTS_ROOT}/${encodeUsernameKey(uname)}`)) : Promise.resolve(null)
    ];
    const [rowSnap, accSnap] = await Promise.all(reads);
    const row = rowSnap?.exists?.() ? rowSnap.val() : null;
    const remoteAcc = accSnap?.exists?.() ? accSnap.val() : null;
    const rowStatus = row?.status;
    const accStatus = remoteAcc?.status;

    if (rowStatus === 'approved' || rowStatus === 'active' || accStatus === 'active' || accStatus === 'approved') {
      return {
        ok: true,
        status: 'active',
        approvedBy: row?.approvedBy || remoteAcc?.approvedBy || row?.reviewedBy || '',
        approvedAt: row?.approvedAt || remoteAcc?.approvedAt || row?.reviewedAt || '',
        row
      };
    }
    if (rowStatus === 'rejected' || accStatus === 'rejected') {
      return {
        ok: true,
        status: 'rejected',
        reviewNote: row?.reviewNote || remoteAcc?.reviewNote || '',
        row
      };
    }
    if (rowStatus === 'inactive' || accStatus === 'inactive') {
      return { ok: true, status: 'inactive', row };
    }
    return { ok: true, status: account.status || 'pending', row };
  } catch (error) {
    return { ok: false, reason: 'refresh-failed', error };
  }
}

/**
 * Periodic <=15s fallback poll for Admin/Manager panels while open: refreshes
 * `students` and `notifications` even if an SSE/WebSocket listener stalls.
 */
export async function pollRegistrationFeedOnline() {
  if (!LEGACY_CLOUD_ENABLED || !navigator.onLine || !hasReviewerLocalSession()) {
    return { ok: false, reason: 'skipped' };
  }
  try {
    await ensureCloudAuth();
    const db = getDatabase(firebaseApp);
    const studentsSnap = await get(ref(db, `${DB_ROOT}/students`));
    if (studentsSnap.exists()) {
      const bridge = recordBridge('students');
      bridge.receive(normalizeCollectionSnapshot('students', studentsSnap.val()));
    }
    if (!notificationsRulesBlocked) {
      try {
        const notifSnap = await get(ref(db, NOTIFICATIONS_ROOT));
        if (notifSnap.exists()) {
          const local = readLocal(KEYS.registrationNotifications) || [];
          const merged = mergeRegistrationNotificationLists(local, notifSnap.val());
          remoteWrite(KEYS.registrationNotifications, merged, 'registrationNotifications');
        }
      } catch (error) {
        if (isPermissionDenied(error)) notificationsRulesBlocked = true;
        else throw error;
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'poll-failed', error };
  }
}

export async function hydrateStaffAccounts({ preserveLocalAdmin = false } = {}) {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  try {
    await ensureCloudAuth();
    for (const role of Object.keys(STAFF_ACCOUNTS)) {
      if (role === 'admin' && preserveLocalAdmin && await readStaffLocal(role)) continue;
      // Credential hydration is read-only, even if this device has local edits.
      const snapshot = await get(ref(getDatabase(firebaseApp), STAFF_ROOT + '/' + role));
      const account = snapshot.val();
      if (account?.username && isPasswordRecord(account.password)) await writeStaffLocal(role, account);
    }
    return { ok: true };
  } catch (error) {
    syncError(error);
    return { ok: false, reason: 'staff-sync-failed', error };
  }
}

/**
 * Cross-device Login IDs: Staff Directory records, the claimed Login User ID
 * registry and the requested student login. The student account is only
 * selected after its password has been verified. Unrelated collections never
 * gate this login path. This remains a compatibility bridge, not server auth.
 */
export async function hydrateUserIdentifiers({ identifier = '', password = '' } = {}) {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  try {
    await ensureCloudAuth();
    // A student login is read-only. Unrelated registry/directory writes must
    // never turn a verified account into a sync failure or hold login hostage.
    const student = await hydrateStudent(identifier, password);
    if (student.found) return { ok: true, ...student };
    await syncDirectory({ readOnly: true });
    return { ok: true, ...student };
  } catch (error) {
    syncError(error);
    return { ok: false, reason: 'identity-sync-failed', error };
  }
}

function listenCollection(collection) {
  const bridge = recordBridge(collection);
  if (collection === 'courses') {
    if (coursesRulesBlocked) {
      ensureCoursesFallbackListener();
      return;
    }
    onOptionalValue(ref(getDatabase(firebaseApp), DB_ROOT + '/courses'), snapshot => {
      if (!snapshot.exists()) {
        bridge.capture();
        if (!bridge.hasView()) return;
        bridge.receive({});
        return;
      }
      bridge.receive(normalizeCollectionSnapshot('courses', snapshot.val()));
    }, {
      label: 'courses',
      onPermissionDenied: () => {
        coursesRulesBlocked = true;
        ensureCoursesFallbackListener();
      }
    });
    return;
  }
  onValue(ref(getDatabase(firebaseApp), DB_ROOT + '/' + collection), snapshot => {
    if (!snapshot.exists()) {
      bridge.capture();
      if (!bridge.hasView()) return;
      bridge.receive({});
      return;
    }
    bridge.receive(normalizeCollectionSnapshot(collection, snapshot.val()));
  });
}

let pendingTimer = null;
let attemptTimer = null;

/** A record left in the outbox (failed write, or an edit made before startup)
    is retried by itself, so nothing waits for a reload or a new click. */
function schedulePendingFlush() {
  window.clearInterval(pendingTimer);
  pendingTimer = window.setInterval(() => {
    if (!ready || !navigator.onLine || !connected) return;
    if (!hasOutboxPending()) return;
    flushPending().then(async () => {
      /* A queued write that finally landed proves the transport works again.
         Repair the collections whose boot read failed now, so the app can say
         "synced" again within seconds — the 20s watchdog would re-boot every
         listener instead of retrying the one collection that failed. */
      if (!hasOutboxPending() && partialFailures.length && !partialRetry) {
        lastPartialRetry = Date.now();
        await retryPartialSync();
      }
      paintSyncStatus();
    }).catch(recordSyncError);
  }, 3000);
}

window.addEventListener('apc-student-login', () => {
  // The student just signed in with a verified password: pull their exam data
  // in the background. The background startup does the same, only later.
  if (!ready) return;
  void syncExamDb().catch(syncError);
});

export function stopRealtimeSync() {
  syncEnabled = false;
  syncGeneration += 1;
  booting = null;
  ready = false;
  started = false;
  connected = false;
  hasConnected = false;
  partialFailures = [];
  coursesRulesBlocked = false;
  coursesFallbackListening = false;
  classChatRulesBlocked = false;
  classChatFallbackListening = false;
  classChatPending = false;
  notificationsRulesBlocked = false;
  for (const stop of subscriptions) stop();
  subscriptions.clear();
  stopStudent = null;
  studentListeningKey = null;
  window.clearInterval(pendingTimer);
  // The watchdog interval remains installed but is inert while signed out.
}
window.addEventListener('apc-session-ended', stopRealtimeSync);

export async function startRealtimeSync() {
  if (!LEGACY_CLOUD_ENABLED) {
    stopRealtimeSync();
    setSyncStatus('paused');
    return cloudPausedResult();
  }
  // Every entry point (manual retry, reconnect, storage bridge, login) must
  // use a real app session, not merely Firebase anonymous authentication.
  const generation = syncGeneration;
  let session;
  try {
    const { hasSyncSession } = await import('./sync-session.js');
    session = await hasSyncSession();
  } catch {
    session = false;
  }
  if (!session || generation !== syncGeneration) {
    if (!session && generation === syncGeneration) stopRealtimeSync();
    return { ok: false, reason: 'authentication-required' };
  }
  syncEnabled = true;
  if (!navigator.onLine) { setSyncStatus('offline'); return { ok: false, reason: 'offline' }; }
  if (booting) return booting;
  if (started && !syncFailed) {
    // Already running: still push anything the outbox is holding. A database
    // reconnect does not fire the browser's `online` event, so without this the
    // pending change could sit unsent until the next reload.
    if (connected) {
      try { await flushPending(); } catch (error) { recordSyncError(error); }
      await retryPartialSync();
    }
    paintSyncStatus();
    return { ok: true };
  }
  const flight = (async () => {
    ready = false;
    syncFailed = false;
    partialFailures = [];
    setSyncStatus('connecting');
    for (const stop of subscriptions) stop();
    subscriptions.clear();
    window.clearInterval(pendingTimer);
    stopStudent = null;
    studentListeningKey = null;
    try {
      // Capture local changes even if authentication later fails.
      for (const collection of RECORD_COLLECTIONS) recordBridge(collection);
      installLocalWriteBridge();
      const cloudUser = await ensureCloudAuth();
      if (!cloudUser) {
        stopRealtimeSync();
        setSyncStatus('error');
        return { ok: false, reason: 'authentication-required' };
      }
      if (!syncEnabled || generation !== syncGeneration) return { ok: false, reason: 'session-ended' };
      onValue(ref(getDatabase(firebaseApp), '.info/connected'), snap => {
        const wasConnected = connected;
        connected = snap.val() === true;
        if (connected) {
          hasConnected = true;
          // Firebase reconnects listeners itself. Only pending writes need a
          // push; the rest of the application must not rehydrate on every blip.
          if (!wasConnected && ready) {
            void flushPending().then(paintSyncStatus).catch(recordSyncError);
            void retryPartialSync();
          }
        }
        document.documentElement.dataset.firebaseConnection = connected ? 'connected' : 'disconnected';
        paintSyncStatus();
      });
      const tasks = [
        ...RECORD_COLLECTIONS.map(collection => () => syncCollection(collection)),
        () => syncExamDb(),
        () => syncClassChat(),
        // Cross-device login identities: without these, an ID created on one
        // phone never reaches the cloud until it is edited again, and a
        // password changed elsewhere is never received here.
        ...Object.keys(STAFF_ACCOUNTS).map(role => () => syncStaffRole(role)),
        () => syncDirectory(),
        () => syncUsernames(),
        () => syncStudentAccount(),
        () => syncRegistrationNotifications()
      ];
      // Keep failed collections separate. An independent node's rejection must
      // neither discard working listeners nor be falsely painted "synced".
      const results = await Promise.allSettled(tasks.map(run => run()));
      if (!syncEnabled || generation !== syncGeneration) return { ok: false, reason: 'session-ended' };
      partialFailures = results.flatMap((result, index) => result.status === 'rejected'
        ? [{ run: tasks[index], error: result.reason }] : []);
      if (partialFailures.length === tasks.length) throw partialFailures[0].error;
      if (partialFailures.length) {
        lastPartialRetry = Date.now();
        reportSyncError(partialFailures[0].error);
      }
      for (const collection of RECORD_COLLECTIONS) listenCollection(collection);
      listenExamDb();
      listenClassChat();
      for (const role of Object.keys(STAFF_ACCOUNTS)) listenStaffRole(role);
      listenDirectory();
      listenUsernames();
      listenStudentAccount();
      listenRegistrationNotifications();
      ready = true;
      started = true;
      schedulePendingFlush();
      markSyncSuccess('read');
      paintSyncStatus();
    return { ok: true, mode: 'realtime-test-sync' };
    } catch (error) {
      if (!syncEnabled || generation !== syncGeneration) return { ok: false, reason: 'session-ended' };
      started = false;
      syncFailed = true;
      syncError(error);
      return { ok: false, reason: 'sync-failed', error };
    }
  })();
  booting = flight;
  try { return await flight; } finally { if (booting === flight) booting = null; }
}

/* `connected` mirrors ONLY Firebase's .info/connected. The browser's offline
   event is often a blip in which the database socket never drops; clearing
   `connected` here meant no .info/connected=true ever followed, so the
   pending-flush timer (which requires `connected`) stranded offline edits. */
window.addEventListener('offline', () => {
  if (syncEnabled) setSyncStatus('offline');
});
window.addEventListener('online', () => {
  if (!syncEnabled) return;
  // Do not discard healthy subscriptions. A failed listener does need a retry;
  // otherwise push whatever the outbox collected while the browser was offline.
  if (syncFailed) { void startRealtimeSync(); return; }
  if (ready && connected) void flushPending().then(paintSyncStatus).catch(recordSyncError);
  paintSyncStatus();
});
// The SDK owns transport reconnects; only detached listeners and independent
// failed boot tasks need retries. Never rehydrate every collection for a normal
// browser offline/online cycle, even one lasting several minutes.
async function retryPartialSync() {
  if (partialRetry || !syncEnabled || !ready || !connected || !partialFailures.length) return partialRetry;
  const generation = syncGeneration;
  const failures = partialFailures;
  partialRetry = (async () => {
    const results = await Promise.allSettled(failures.map(({ run }) => run()));
    if (!syncEnabled || generation !== syncGeneration) return;
    partialFailures = failures.flatMap((task, index) => results[index].status === 'rejected'
      ? [{ run: task.run, error: results[index].reason }] : []);
    if (partialFailures.length) reportSyncError(partialFailures[0].error);
    else paintSyncStatus();
  })().finally(() => { partialRetry = null; });
  return partialRetry;
}
attemptTimer = window.setInterval(() => {
  if (!navigator.onLine || !syncEnabled || booting) return;
  if (syncFailed) { void startRealtimeSync(); return; }
  if (!connected || !ready || !partialFailures.length || partialRetry) return;
  if (Date.now() - lastPartialRetry < 60000) return;
  lastPartialRetry = Date.now();
  void retryPartialSync();
}, 20000);
