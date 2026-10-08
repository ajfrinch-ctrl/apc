/* Authenticated, role-scoped Question Bank realtime client for activePlusV2.
 * Wired into js/realtime-sync-entry.js, but claims-gated: it only activates
 * for a signed-in user whose custom claims authorize a Question Bank path
 * (see sync/question-bank-v2-policy.js), so devices stay no-ops until the
 * staged migration provisions claims and the v2 rules. The legacy anonymous
 * bridge does not call it and does not include questionBank. */
import { firebaseApp, appCheckReady } from '../firebase/firebase-init.js';
import {
  getAuth, getDatabase, ref, get, set, runTransaction, onValue as firebaseOnValue
} from '../firebase/firebase-services.js';
import { callCloudFunction } from './cloud-auth.js';
import { questionBankSyncPlan } from './question-bank-v2-policy.js';
import { KEYS, readJSON } from '../js/database.js';
import { QUESTION_BANK_KEY, normalizeQuestion } from '../js/question-bank.js';
import { createRecordSync, mergeRecordOperations, stableJSON } from '../js/record-sync.js';
import { isRtdbKey, unsafeKeyPath } from '../js/rtdb-keys.js';

const ROOT = 'activePlusV2';
const OUTBOX_PREFIX = 'activePlus.v2QuestionBankOutbox.v1:';
const BASELINE_PREFIX = 'activePlus.v2QuestionBankBaseline.v1:';
const OWNED_PREFIX = 'activePlus.v2QuestionBankOwnedIds.v1:';
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const text = value => String(value ?? '').normalize('NFC').trim();
const norm = value => text(value).toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const groupKey = value => norm(value).replace(/\s*বিভাগ$/, '').trim();
const parseMap = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

let activeController = null;

function localQuestionMap() {
  const doc = readJSON(KEYS.questionBank, null);
  if (!doc || doc.version !== 1 || !Array.isArray(doc.questions)) return {};
  const rows = {};
  for (const item of doc.questions) {
    if (!item || typeof item.id !== 'string' || !isRtdbKey(item.id) || unsafeKeyPath(item)) continue;
    rows[item.id] = normalizeQuestion(item);
  }
  return rows;
}

function writeLocalQuestionMap(map, { source = 'v2-cloud' } = {}) {
  const current = readJSON(KEYS.questionBank, null) || {};
  const questions = Object.entries(map || {})
    .filter(([id, row]) => isRtdbKey(id) && row && row.id === id && !unsafeKeyPath(row))
    .map(([, row]) => normalizeQuestion(row));
  const now = Date.now();
  const payload = {
    version: 1,
    questions,
    updatedAt: now,
    createdBy: text(current.createdBy) || 'SYNC'
  };
  window.localStorage.setItem(KEYS.questionBank, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent('question-bank-updated', { detail: { at: now, source } }));
}

function setJSON(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readOutbox(key) {
  const value = readJSON(key, {});
  return parseMap(value);
}

function readOwnedIds(key) {
  const value = readJSON(key, []);
  return new Set(Array.isArray(value) ? value.filter(isRtdbKey) : []);
}

function assignmentsContainQuestion(rows, teacherId, question) {
  const subject = norm(question.subject);
  const qGroup = groupKey(question.group);
  return Object.values(parseMap(rows)).some(assignment => {
    if (!assignment || String(assignment.teacherId || '') !== teacherId) return false;
    if (norm(assignment.className) !== norm(question.className)) return false;
    const subjects = Array.isArray(assignment.subjects) && assignment.subjects.length
      ? assignment.subjects
      : [assignment.subject];
    if (!subjects.some(name => norm(name) === subject)) return false;
    const assignmentGroup = groupKey(assignment.group);
    return qGroup ? (!assignmentGroup || assignmentGroup === qGroup) : !assignmentGroup;
  });
}

async function withQuestionBankLock(task) {
  if (navigator.locks?.request) return navigator.locks.request(QUESTION_BANK_KEY, task);
  return task();
}

function publicProjection(snapshotValue) {
  const projection = {};
  for (const [id, raw] of Object.entries(parseMap(snapshotValue))) {
    if (!isRtdbKey(id) || !raw || raw.id !== id || unsafeKeyPath(raw)) continue;
    projection[id] = normalizeQuestion(raw);
  }
  return projection;
}

function mergeProjectionIntoLocal(remote, previousIds, pendingRows = {}) {
  return withQuestionBankLock(() => {
    const current = localQuestionMap();
    const next = { ...current };
    const pendingIds = new Set(Object.keys(pendingRows));
    const remoteIds = new Set(Object.keys(remote));
    for (const id of previousIds) {
      if (remoteIds.has(id) || pendingIds.has(id) || !next[id]) continue;
      // Keep offline/history data, but withdraw it from the student's active
      // practice lane when the server removes a projection. Teacher screens
      // still retain the row for audit/reconciliation.
      next[id] = { ...next[id], active: false, updatedAt: Date.now() };
    }
    for (const [id, row] of Object.entries(remote)) {
      if (pendingIds.has(id)) continue;
      next[id] = row;
    }
    for (const [id, row] of Object.entries(pendingRows)) {
      if (!isRtdbKey(id) || !row || row.id !== id || unsafeKeyPath(row)) continue;
      next[id] = normalizeQuestion(row);
    }
    writeLocalQuestionMap(next);
    return new Set([...previousIds, ...remoteIds, ...pendingIds]);
  });
}

function checkClaims(user, claims) {
  const provider = claims?.firebase?.sign_in_provider || '';
  return questionBankSyncPlan(claims, provider);
}

async function startCanonicalSync({ user, db, uid }) {
  const path = `${ROOT}/questionBank`;
  const node = ref(db, path);
  const stateKey = `${BASELINE_PREFIX}${uid}:canonical`;
  const bridge = createRecordSync({
    loadState: () => readJSON(stateKey, null),
    saveState: value => setJSON(stateKey, value),
    readLocal: localQuestionMap,
    writeLocal: value => writeLocalQuestionMap(value),
    commit: async operations => {
      const entries = Object.entries(operations).filter(([id, operation]) =>
        isRtdbKey(id) && (operation.value === null || (operation.value && !unsafeKeyPath(operation.value))));
      await Promise.all(entries.map(async ([id, operation]) => {
        const recordRef = ref(db, `${path}/${id}`);
        await runTransaction(recordRef, current => {
          const remote = current == null ? {} : { [id]: current };
          if (operation.seed && current != null) return current;
          const merged = mergeRecordOperations(remote, { [id]: operation });
          if (!Object.hasOwn(merged, id)) return null;
          if (current != null && stableJSON(merged[id]) === stableJSON(current)) return current;
          const value = copy(merged[id]);
          // Preserve server-only ownership/audit metadata; the local UI neither
          // reads nor writes custom Auth UIDs.
          if (current && value && typeof value === 'object') {
            if (current.createdByUid) value.createdByUid = current.createdByUid;
            if (current.updatedByUid) value.updatedByUid = current.updatedByUid;
            if (current.teacherId) value.teacherId = current.teacherId;
          }
          value.updatedByUid = user.uid;
          return value;
        }, { applyLocally: false });
      }));
      const snapshot = await get(node);
      return publicProjection(snapshot.val());
    }
  });
  const snapshot = await get(node);
  bridge.receive(snapshot.exists() ? publicProjection(snapshot.val()) : {});
  await bridge.flush();
  const stop = firebaseOnValue(node, value => {
    bridge.receive(value.exists() ? publicProjection(value.val()) : {});
    void bridge.flush().catch(error => console.warn('[Active Plus] v2 Question Bank write queued:', error?.code || error?.name || 'unknown'));
  }, error => console.warn('[Active Plus] v2 Question Bank listener unavailable:', error?.code || error?.name || 'unknown'));
  const onLocalChange = () => {
    bridge.capture();
    if (navigator.onLine) void bridge.flush().catch(error => console.warn('[Active Plus] v2 Question Bank write queued:', error?.code || error?.name || 'unknown'));
  };
  window.addEventListener('question-bank-updated', onLocalChange);
  const onOnline = () => { void bridge.flush().catch(() => {}); };
  window.addEventListener('online', onOnline);
  return () => {
    stop();
    window.removeEventListener('question-bank-updated', onLocalChange);
    window.removeEventListener('online', onOnline);
  };
}

async function startTeacherSync({ user, db, plan }) {
  const teacherId = plan.teacherId;
  const projectionPath = `activePlusV2/teacherQuestionBank/${teacherId}`;
  const draftsPath = `${plan.draftPath}`;
  const assignmentsPath = 'activePlusV2/teacherAssignments';
  const outboxKey = `${OUTBOX_PREFIX}${user.uid}:teacher`;
  const ownedKey = `${OWNED_PREFIX}${user.uid}:teacher`;
  let assignments = {};
  let assignmentsReady = false;
  let projections = {};
  let drafts = {};
  let pending = readOutbox(outboxKey);
  let observed = localQuestionMap();
  let ownedIds = readOwnedIds(ownedKey);
  let applyingRemote = false;
  let connected = navigator.onLine;
  let flushFlight = null;
  let timer = null;
  const stops = [];

  const persist = () => {
    setJSON(outboxKey, pending);
    setJSON(ownedKey, [...ownedIds]);
  };

  async function applyRemote() {
    const remote = { ...projections };
    for (const [id, draft] of Object.entries(drafts)) {
      if (draft?.status === 'draft' && draft.teacherId === teacherId && draft.question?.id === id) {
        remote[id] = normalizeQuestion(draft.question);
      }
    }
    applyingRemote = true;
    try {
      ownedIds = await mergeProjectionIntoLocal(remote, ownedIds, pending);
      observed = localQuestionMap();
      persist();
    } finally { applyingRemote = false; }
  }

  function captureLocal() {
    if (applyingRemote || !assignmentsReady) return;
    const current = localQuestionMap();
    const ids = new Set([...Object.keys(observed), ...Object.keys(current)]);
    let changed = false;
    for (const id of ids) {
      if (stableJSON(current[id] ?? null) === stableJSON(observed[id] ?? null)) continue;
      const row = current[id] || observed[id];
      if (!row || !assignmentsContainQuestion(assignments, teacherId, row)) continue;
      if (current[id]) {
        pending[id] = normalizeQuestion(current[id]);
      } else {
        // A Teacher removal is a soft archive in V2; do not destroy a historical
        // question or a question already referenced by an exam paper.
        pending[id] = { ...normalizeQuestion(row), active: false, updatedAt: Date.now() };
        current[id] = pending[id];
      }
      changed = true;
    }
    observed = current;
    if (changed) {
      persist();
      writeLocalQuestionMap(current, { source: 'v2-teacher-outbox' });
      void flushPending();
    }
  }

  async function flushPending() {
    if (flushFlight) return flushFlight;
    if (!connected || !navigator.onLine || !assignmentsReady || !Object.keys(pending).length) return;
    flushFlight = (async () => {
      for (const [questionId, question] of Object.entries({ ...pending })) {
        if (!isRtdbKey(questionId) || !question || !assignmentsContainQuestion(assignments, teacherId, question) || unsafeKeyPath(question)) continue;
        const draft = { id: questionId, teacherId, status: 'draft', question: normalizeQuestion(question) };
        try {
          await set(ref(db, `${draftsPath}/${questionId}`), draft);
          await callCloudFunction('publishQuestionBankDraft', { questionId });
          if (stableJSON(pending[questionId]) === stableJSON(question)) delete pending[questionId];
          persist();
        } catch (error) {
          console.warn('[Active Plus] v2 Question Bank draft queued:', error?.code || error?.name || 'unknown');
        }
      }
    })().finally(() => { flushFlight = null; });
    return flushFlight;
  }

  // Use an initial claim-scoped read before installing realtime listeners.
  const [teacherSnapshot, draftSnapshot, assignmentSnapshot] = await Promise.all([
    get(ref(db, projectionPath)), get(ref(db, draftsPath)), get(ref(db, assignmentsPath))
  ]);
  projections = publicProjection(teacherSnapshot.val());
  drafts = parseMap(draftSnapshot.val());
  assignments = parseMap(assignmentSnapshot.val());
  assignmentsReady = true;
  await applyRemote();
  captureLocal();
  await flushPending();

  stops.push(firebaseOnValue(ref(db, projectionPath), snapshot => {
    projections = publicProjection(snapshot.val());
    void applyRemote();
  }, error => console.warn('[Active Plus] v2 Teacher Question Bank unavailable:', error?.code || error?.name || 'unknown')));
  stops.push(firebaseOnValue(ref(db, draftsPath), snapshot => {
    drafts = parseMap(snapshot.val());
    void applyRemote();
  }, error => console.warn('[Active Plus] v2 Teacher Question Bank drafts unavailable:', error?.code || error?.name || 'unknown')));
  stops.push(firebaseOnValue(ref(db, assignmentsPath), snapshot => {
    assignments = parseMap(snapshot.val());
    assignmentsReady = true;
    captureLocal();
  }, error => console.warn('[Active Plus] v2 Teacher assignments unavailable:', error?.code || error?.name || 'unknown')));
  stops.push(firebaseOnValue(ref(db, '.info/connected'), snapshot => {
    connected = snapshot.val() === true;
    if (connected) void flushPending();
  }));

  const onLocalChange = () => captureLocal();
  const onOnline = () => { connected = true; void flushPending(); };
  const onOffline = () => { connected = false; };
  window.addEventListener('question-bank-updated', onLocalChange);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  timer = setInterval(() => { if (connected && navigator.onLine) void flushPending(); }, 3000);
  return () => {
    stops.forEach(stop => stop());
    clearInterval(timer);
    window.removeEventListener('question-bank-updated', onLocalChange);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

async function startStudentSync({ user, db, plan }) {
  const node = ref(db, plan.readPath);
  const ownedKey = `${OWNED_PREFIX}${user.uid}:student`;
  let ownedIds = readOwnedIds(ownedKey);
  let applyingRemote = false;
  const apply = async snapshot => {
    const remote = publicProjection(snapshot.val());
    applyingRemote = true;
    try {
      ownedIds = await mergeProjectionIntoLocal(remote, ownedIds);
      setJSON(ownedKey, [...ownedIds]);
    } finally { applyingRemote = false; }
  };
  const initial = await get(node);
  await apply(initial);
  const stop = firebaseOnValue(node, snapshot => { void apply(snapshot); }, error => {
    console.warn('[Active Plus] v2 Student Question Bank unavailable:', error?.code || error?.name || 'unknown');
  });
  return stop;
}

export async function startQuestionBankV2Sync() {
  if (activeController) return { ok: true, alreadyStarted: true };
  await appCheckReady;
  const auth = getAuth(firebaseApp);
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) return { ok: false, reason: 'authentication-required' };
  const token = await user.getIdTokenResult(true);
  const plan = checkClaims(user, token.claims || {});
  if (!plan.ok) return { ok: false, reason: plan.reason };
  const db = getDatabase(firebaseApp);
  let stop;
  try {
    if (plan.mode === 'canonical') stop = await startCanonicalSync({ user, db, uid: user.uid });
    else if (plan.mode === 'teacher') stop = await startTeacherSync({ user, db, plan });
    else stop = await startStudentSync({ user, db, plan });
  } catch (error) {
    return { ok: false, reason: 'question-bank-v2-sync-failed', error };
  }
  const onSessionEnded = () => stopQuestionBankV2Sync();
  window.addEventListener('apc-session-ended', onSessionEnded, { once: true });
  activeController = {
    stop: () => {
      stop?.();
      window.removeEventListener('apc-session-ended', onSessionEnded);
      activeController = null;
    },
    uid: user.uid,
    role: plan.role
  };
  return { ok: true, role: plan.role, stop: activeController.stop };
}

export function stopQuestionBankV2Sync() {
  activeController?.stop();
}
