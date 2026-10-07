const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onValueWritten } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');
const { noticePush, broadcastPush, examPushes, chunkTokens, tokensToPrune, messageFor } =
  require('./notification-payload.js');
const crypto = require('node:crypto');
const {
  safeKey: safeQuestionKey,
  normalizeQuestionRecord,
  questionMatchesTeacher,
  questionMatchesExamPaper,
  buildStudentQuestionProjection,
  advanceDraftAfterPublish,
  buildTeacherQuestionProjection,
  buildQuestionBankFanout
} = require('./question-bank-projection.js');

initializeApp();
const auth = getAuth();
const db = getFirestore();
const AUTH_EMAIL_DOMAIN = 'accounts.activeplus.app';
const HANDLE = /^[a-z][a-z0-9._]{3,19}$/;
const PHONE = /^01[3-9]\d{8}$/;
const STAFF_ROLES = new Set(['manager', 'teacher', 'payment', 'student']);

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}
function normalizePhone(value) {
  let v = String(value || '').trim().replace(/[০-৯]/g, d => '০১২৩৪৫৬৭৮৯'.indexOf(d));
  v = v.replace(/[\s()+-]/g, '');
  if (v.startsWith('+880')) v = `0${v.slice(4)}`;
  else if (v.startsWith('880')) v = `0${v.slice(3)}`;
  return v;
}
function validateProfile(data, { requirePhone = true } = {}) {
  const fullName = String(data.fullName || '').trim().replace(/\s+/g, ' ');
  const mobile = normalizePhone(data.mobile);
  const email = String(data.email || '').trim().toLowerCase();
  const username = normalizeUsername(data.username);
  const password = String(data.password || '');
  if (fullName.length < 2 || fullName.length > 100) throw new HttpsError('invalid-argument', 'পূর্ণ নাম ২–১০০ অক্ষরের হতে হবে।');
  if (requirePhone && !PHONE.test(mobile)) throw new HttpsError('invalid-argument', 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন।');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', 'ইমেইল ঠিকানা সঠিক নয়।');
  if (!HANDLE.test(username) || ['admin', 'administrator', 'root', 'null', 'undefined'].includes(username)) throw new HttpsError('invalid-argument', 'ইউজারনেম গ্রহণযোগ্য নয়।');
  if (password.length < 8 || password.length > 128) throw new HttpsError('invalid-argument', 'পাসওয়ার্ড ৮–১২৮ অক্ষরের হতে হবে।');
  return { fullName, mobile, email, username, password };
}
function requireCaller(request, role) {
  if (!request.auth || request.auth.token.status !== 'active' || request.auth.token.role !== role || request.auth.token.mustChangePassword === true) {
    throw new HttpsError('permission-denied', `সক্রিয় ${role} অনুমতি প্রয়োজন।`);
  }
}
function usernameDoc(username) { return db.doc(`usernameIndex/${username}`); }
function authEmail(username) { return `user.${username}@${AUTH_EMAIL_DOMAIN}`; }

/** One-time global bootstrap. The Firestore lock is claimed before creating Auth,
 * so concurrent first-admin requests cannot create two owners. */
exports.createFirstAdmin = onCall(async request => {
  const profile = validateProfile(request.data || {});
  const claimId = crypto.randomUUID();
  const bootstrapRef = db.doc('system/bootstrap');
  await db.runTransaction(async tx => {
    const lock = await tx.get(bootstrapRef);
    if (lock.exists) throw new HttpsError('already-exists', 'Initial Admin ইতিমধ্যে তৈরি হয়েছে।');
    tx.create(bootstrapRef, { state: 'provisioning', claimId, requestedAt: FieldValue.serverTimestamp() });
  });

  let user;
  const createdUsers = [];
  try {
    user = await auth.createUser({ email: authEmail(profile.username), password: profile.password, displayName: profile.fullName, disabled: false });
    createdUsers.push(user);
    await auth.setCustomUserClaims(user.uid, { role: 'admin', status: 'active', mustChangePassword: false });

    // One bootstrap identity for each operational staff role. The generated
    // passwords are returned once to the first Admin and are never written to Firestore.
    const bootstrapAccounts = [];
    for (const role of ['manager', 'teacher', 'payment']) {
      const username = `${role}.${crypto.randomBytes(4).toString('hex')}`;
      const password = crypto.randomBytes(18).toString('base64url');
      const staff = await auth.createUser({ email: authEmail(username), password, displayName: `প্রাথমিক ${role} অ্যাকাউন্ট`, disabled: false });
      createdUsers.push(staff);
      await auth.setCustomUserClaims(staff.uid, { role, status: 'active', mustChangePassword: true });
      bootstrapAccounts.push({ uid: staff.uid, role, username, password });
    }

    await db.runTransaction(async tx => {
      const lock = await tx.get(bootstrapRef);
      const handles = [profile.username, ...bootstrapAccounts.map(account => account.username)];
      const handleRefs = handles.map(usernameDoc);
      const handleDocs = await Promise.all(handleRefs.map(ref => tx.get(ref)));
      if (!lock.exists || lock.data().claimId !== claimId || handleDocs.some(doc => doc.exists)) {
        throw new HttpsError('already-exists', 'Admin bootstrap অথবা username claim আর উপলভ্য নেই।');
      }
      const now = FieldValue.serverTimestamp();
      tx.create(handleRefs[0], { uid: user.uid, role: 'admin', createdAt: now });
      tx.create(db.doc(`users/${user.uid}`), {
        uid: user.uid, role: 'admin', status: 'active', accountOwner: 'first-admin',
        fullName: profile.fullName, mobile: profile.mobile, email: profile.email,
        username: profile.username, createdAt: now, updatedAt: now
      });
      bootstrapAccounts.forEach((account, index) => {
        tx.create(handleRefs[index + 1], { uid: account.uid, role: account.role, createdAt: now });
        tx.create(db.doc(`users/${account.uid}`), {
          uid: account.uid, role: account.role, status: 'active', accountOwner: user.uid,
          fullName: `প্রাথমিক ${account.role} অ্যাকাউন্ট`, mobile: '', email: '',
          username: account.username, mustChangePassword: true, createdAt: now, updatedAt: now,
          bootstrapAccount: true
        });
      });
      tx.update(bootstrapRef, { state: 'active', uid: user.uid, username: profile.username, createdAt: now, claimId: FieldValue.delete() });
    });
    return {
      ok: true, uid: user.uid, username: profile.username, role: 'admin', status: 'active',
      bootstrapAccounts: bootstrapAccounts.map(({ role, username, password }) => ({ role, username, password }))
    };
  } catch (error) {
    await Promise.all(createdUsers.map(created => auth.deleteUser(created.uid).catch(() => {})));
    await db.runTransaction(async tx => {
      const lock = await tx.get(bootstrapRef);
      if (lock.exists && lock.data().claimId === claimId) tx.delete(bootstrapRef);
    }).catch(() => {});
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Initial Admin তৈরি হয়নি; আবার চেষ্টা করুন।');
  }
});

/** Admin provisions Manager/Teacher/Payment/Student identities. Student accounts
 * start pending; only Manager can approve/reject them. */
exports.adminCreateAccount = onCall(async request => {
  requireCaller(request, 'admin');
  const profile = validateProfile(request.data || {});
  const role = String(request.data.role || '');
  if (!STAFF_ROLES.has(role)) throw new HttpsError('invalid-argument', 'এই role তৈরি করা যাবে না।');
  const ref = usernameDoc(profile.username);
  const lockId = crypto.randomUUID();
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (doc.exists) throw new HttpsError('already-exists', 'এই username ইতিমধ্যে ব্যবহৃত।');
    tx.create(ref, { reservation: lockId, role, state: 'provisioning', createdAt: FieldValue.serverTimestamp() });
  });
  let user;
  try {
    user = await auth.createUser({ email: authEmail(profile.username), password: profile.password, displayName: profile.fullName, disabled: false });
    const status = role === 'student' ? 'pending' : 'active';
    await auth.setCustomUserClaims(user.uid, { role, status, mustChangePassword: role !== 'student' });
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (!current.exists || current.data().reservation !== lockId) throw new HttpsError('aborted', 'Username reservation বদলে গেছে।');
      const now = FieldValue.serverTimestamp();
      tx.set(ref, { uid: user.uid, role, createdAt: now });
      tx.create(db.doc(`users/${user.uid}`), {
        uid: user.uid, role, status, fullName: profile.fullName, mobile: profile.mobile,
        email: profile.email, username: profile.username, accountOwner: request.auth.uid,
        mustChangePassword: role !== 'student', createdAt: now, updatedAt: now
      });
      if (role === 'student') tx.create(db.doc(`students/${user.uid}`), {
        uid: user.uid, fullName: profile.fullName, mobile: profile.mobile, email: profile.email,
        username: profile.username, status: 'pending', createdAt: now
      });
    });
    return { ok: true, uid: user.uid, role, status, username: profile.username };
  } catch (error) {
    if (user) await auth.deleteUser(user.uid).catch(() => {});
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.exists && current.data().reservation === lockId) tx.delete(ref);
    }).catch(() => {});
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Account তৈরি হয়নি; আবার চেষ্টা করুন।');
  }
});

/** Bootstrap staff accounts cannot access app data until Firebase Auth confirms a
 * password change. The client calls this after updatePassword(), then refreshes its ID token. */
exports.completeTemporaryPasswordChange = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'প্রবেশ করুন।');
  if (request.auth.token.mustChangePassword !== true) return { ok: true, alreadyComplete: true };
  const user = await auth.getUser(request.auth.uid);
  const createdAt = Date.parse(user.metadata.creationTime || '');
  const passwordUpdatedAt = Date.parse(user.metadata.passwordUpdatedAt || '');
  if (!Number.isFinite(passwordUpdatedAt) || passwordUpdatedAt <= createdAt) {
    throw new HttpsError('failed-precondition', 'প্রথমে নতুন পাসওয়ার্ড সেট করুন।');
  }
  const profileRef = db.doc(`users/${user.uid}`);
  await db.runTransaction(async tx => {
    const profile = await tx.get(profileRef);
    if (!profile.exists || profile.data().status !== 'active') throw new HttpsError('permission-denied', 'সক্রিয় Account প্রয়োজন।');
    tx.update(profileRef, { mustChangePassword: false, updatedAt: FieldValue.serverTimestamp() });
  });
  await auth.setCustomUserClaims(user.uid, { ...user.customClaims, mustChangePassword: false });
  return { ok: true, refreshIdToken: true };
});

/** Only Manager may decide a pending student approval. Admin is intentionally
 * not accepted by this callable; Firestore rules enforce the same boundary. */
exports.managerReviewStudent = onCall(async request => {
  requireCaller(request, 'manager');
  const uid = String(request.data.uid || '');
  const decision = String(request.data.decision || '');
  const note = String(request.data.note || '').trim().slice(0, 500);
  if (!uid || !['approved', 'rejected'].includes(decision)) throw new HttpsError('invalid-argument', 'শিক্ষার্থী ও সিদ্ধান্ত নির্বাচন করুন।');
  const studentRef = db.doc(`students/${uid}`);
  const userRef = db.doc(`users/${uid}`);
  await db.runTransaction(async tx => {
    const student = await tx.get(studentRef);
    const user = await tx.get(userRef);
    if (!student.exists || !user.exists || student.data().status !== 'pending' || user.data().role !== 'student') {
      throw new HttpsError('failed-precondition', 'এই শিক্ষার্থী আর অপেক্ষমাণ নেই।');
    }
    const status = decision;
    tx.update(studentRef, { status, reviewedBy: request.auth.uid, reviewedAt: FieldValue.serverTimestamp(), reviewNote: note });
    tx.update(userRef, { status, reviewedBy: request.auth.uid, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  const user = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...user.customClaims, role: 'student', status: decision });
  return { ok: true, uid, status: decision };
});

/** Manager is the only role allowed to publish/reject pending exam records. */
exports.managerReviewExam = onCall(async request => {
  requireCaller(request, 'manager');
  const examId = String(request.data.examId || '');
  const decision = String(request.data.decision || '');
  const note = String(request.data.note || '').trim().slice(0, 500);
  if (!examId || !['publish', 'reject'].includes(decision)) throw new HttpsError('invalid-argument', 'পরীক্ষা ও সিদ্ধান্ত নির্বাচন করুন।');
  if (decision === 'reject' && !note) throw new HttpsError('invalid-argument', 'সংশোধনের কারণ লিখুন।');
  const ref = db.doc(`exams/${examId}`);
  await db.runTransaction(async tx => {
    const exam = await tx.get(ref);
    if (!exam.exists || exam.data().status !== 'pending') throw new HttpsError('failed-precondition', 'শুধু অপেক্ষমাণ পরীক্ষা পর্যালোচনা করা যাবে।');
    tx.update(ref, {
      status: decision === 'publish' ? 'published' : 'rejected',
      reviewedBy: request.auth.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewNote: decision === 'reject' ? note : '',
      ...(decision === 'publish' ? { publishedAt: FieldValue.serverTimestamp() } : {})
    });
  });
  return { ok: true, examId, status: decision === 'publish' ? 'published' : 'rejected' };
});

/** Admin can suspend/re-activate staff accounts, never approve a student. */
exports.adminSetAccountStatus = onCall(async request => {
  requireCaller(request, 'admin');
  const uid = String(request.data.uid || '');
  const status = String(request.data.status || '');
  if (!uid || !['active', 'suspended'].includes(status)) throw new HttpsError('invalid-argument', 'Account status সঠিক নয়।');
  const ref = db.doc(`users/${uid}`);
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists || doc.data().role === 'admin' || doc.data().role === 'student') {
      throw new HttpsError('failed-precondition', 'এই Account status Admin-এর মাধ্যমে বদলানো যাবে না।');
    }
    tx.update(ref, { status, updatedAt: FieldValue.serverTimestamp() });
  });
  const user = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...user.customClaims, status });
  await auth.updateUser(uid, { disabled: status !== 'active' });
  return { ok: true, uid, status };
});


/* ---------------------------------------------------------------------------
   Push notifications for the live (Realtime Database) sync bridge
   ---------------------------------------------------------------------------
   The app writes through activePlusSync/v1/* as an anonymous signed-in device.
   These three triggers watch the same nodes the app syncs and send a web push
   to every registered device:

     • a published notice          → all devices
     • the urgent announcement     → all devices, high priority
     • a published exam / released
       results                     → only that paper's participants

   Devices register themselves in activePlusSync/v1/pushTokens/<device|person>
   (js/push-notifications.js). The records hold a token, a role and an ID — no
   password hash and no session token.

   Deployment notes:
     • the region must match the Realtime Database location (asia-southeast1
       for the active-plus-coaching Singapore instance);
     • sending web push from Cloud Functions needs the Blaze plan;
     • nothing here is required for the in-app notification centre, which works
       with no Cloud Functions at all. */

const BRIDGE_ROOT = 'activePlusSync/v1';
const PUSH_TOKENS_PATH = `${BRIDGE_ROOT}/pushTokens`;
const DB_REGION = 'asia-southeast1';
const V2_ROOT = 'activePlusV2';
const mapObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const valuesOf = value => Object.values(mapObject(value)).filter(item => item && typeof item === 'object' && !Array.isArray(item));
const jsonEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

async function applyV2Updates(updates) {
  const patch = {};
  for (const [path, value] of Object.entries(updates || {})) patch[`${V2_ROOT}/${path}`] = value;
  if (Object.keys(patch).length) await getDatabase().ref().update(patch);
}

function questionHasFutureExamWindow(question, now = Date.now()) {
  return Boolean(question?.active === true && question?.source?.examId && Number(question.endAt) > now);
}

/** Teacher-authoring entry point. The draft is private and its scope is checked
 * again against the live Manager assignment before the canonical answer key is
 * written. The client never chooses its teacherId or publication role. */
exports.publishQuestionBankDraft = onCall(async request => {
  requireCaller(request, 'teacher');
  const teacherId = String(request.auth.token.teacherId || '');
  const questionId = String(request.data?.questionId || '');
  if (!safeQuestionKey(teacherId) || !safeQuestionKey(questionId)) {
    throw new HttpsError('permission-denied', 'সক্রিয় Teacher identity প্রয়োজন।');
  }
  const database = getDatabase();
  const [draftSnapshot, assignmentsSnapshot] = await Promise.all([
    database.ref(`${V2_ROOT}/questionBankDraftsByTeacher/${teacherId}/${questionId}`).get(),
    database.ref(`${V2_ROOT}/teacherAssignments`).get()
  ]);
  const draft = draftSnapshot.val();
  if (!draft || draft.id !== questionId || draft.teacherId !== teacherId || draft.status !== 'draft' || draft.question?.id !== questionId) {
    throw new HttpsError('not-found', 'নিজের অপেক্ষমাণ প্রশ্ন Draft পাওয়া যায়নি।');
  }
  let question;
  try { question = normalizeQuestionRecord(draft.question, { id: questionId }); }
  catch { throw new HttpsError('invalid-argument', 'প্রশ্নের তথ্য সঠিক নয়।'); }
  const assignmentRows = valuesOf(assignmentsSnapshot.val());
  const now = Date.now();
  if (question.source?.examId) {
    if (!safeQuestionKey(question.source.examId)) {
      throw new HttpsError('invalid-argument', 'পরীক্ষার Question Bank source সঠিক নয়।');
    }
    const examSnapshot = await database.ref(`${V2_ROOT}/exams/${question.source.examId}`).get();
    const exam = examSnapshot.val();
    if (!questionMatchesExamPaper(question, exam, teacherId) || !(Number(exam.endAt) > 0)) {
      throw new HttpsError('permission-denied', 'পরীক্ষার Question Bank source যাচাই করা যায়নি।');
    }
    question = {
      ...question,
      className: String(exam.className || ''),
      subject: String(exam.subject || ''),
      group: String(exam.group || ''),
      startAt: Number(exam.startAt) || 0,
      endAt: Number(exam.endAt) || 0,
      source: {
        examId: String(exam.id),
        examCode: String(exam.code || ''),
        examTitle: String(exam.title || ''),
        at: Number(exam.createdAt) || now
      }
    };
  }
  if (!questionMatchesTeacher(question, teacherId, assignmentRows)) {
    throw new HttpsError('permission-denied', 'এই class/group/subject-এ আপনার সক্রিয় assignment নেই।');
  }

  const profileSnapshot = await db.doc(`users/${request.auth.uid}`).get();
  const profile = profileSnapshot.exists ? profileSnapshot.data() : {};
  const displayName = String(profile.fullName || profile.username || request.auth.token.name || 'Teacher').trim().slice(0, 100);
  const canonicalRef = database.ref(`${V2_ROOT}/questionBank/${questionId}`);
  const result = await canonicalRef.transaction(current => {
    if (current) {
      // Assigned teachers may maintain assigned shared questions, but an ID
      // cannot be moved to a different class/subject/group or stripped of its
      // authoritative exam provenance.
      if (!questionMatchesTeacher(current, teacherId, assignmentRows)) return;
      const sameScope = value => String(value || '').normalize('NFC').trim().toLocaleLowerCase('en-US');
      if (sameScope(current.className) !== sameScope(question.className)
          || sameScope(current.subject) !== sameScope(question.subject)
          || sameScope(current.group).replace(/\s*বিভাগ$/, '') !== sameScope(question.group).replace(/\s*বিভাগ$/, '')) return;
      if ((current.source?.examId || '') !== (question.source?.examId || '')) return;
    }
    return {
      ...question,
      createdBy: current?.createdBy || displayName,
      createdAt: Number(current?.createdAt) || now,
      updatedBy: displayName,
      updatedAt: now,
      createdByUid: current?.createdByUid || request.auth.uid,
      updatedByUid: request.auth.uid,
      teacherId: current?.teacherId || teacherId
    };
  }, undefined, false);
  if (!result.committed) {
    throw new HttpsError('permission-denied', 'এই প্রশ্নের assignment scope বা authoritative exam source মিলছে না।');
  }
  const publishedAt = Date.now();
  // Draft flips to published ONLY if its content still equals the exact
  // question that was just promoted. If the Teacher kept editing while the
  // publish was in flight, the draft stays 'draft' and republishes the new
  // content instead of being silently marked released (see
  // advanceDraftAfterPublish in question-bank-projection.js).
  await database.ref(`${V2_ROOT}/questionBankDraftsByTeacher/${teacherId}/${questionId}`)
    .transaction(current => advanceDraftAfterPublish(current, {
      teacherId, questionId, publishedQuestion: draft.question, publishedAt
    }), undefined, false);
  return { ok: true, questionId, updatedAt: now };
});

/** Canonical Question Bank edits are mirrored in real time to assignment- and
 * student-scoped trees. Admin/Manager SDK writes are authoritative; all client
 * paths remain role-checked by RTDB rules. */
exports.projectQuestionBankRecord = onValueWritten({ ref: `${V2_ROOT}/questionBank/{questionId}`, region: DB_REGION }, async event => {
  const questionId = String(event.params.questionId || '');
  if (!safeQuestionKey(questionId)) return;
  const before = event.data.before.val();
  const after = event.data.after.val();
  if (after) {
    try { normalizeQuestionRecord(after, { id: questionId }); }
    catch (error) { throw new Error(`Invalid canonical Question Bank row ${questionId}: ${error.message}`); }
  }
  const database = getDatabase();
  const [studentsSnapshot, assignmentsSnapshot] = await Promise.all([
    database.ref(`${V2_ROOT}/students`).get(),
    database.ref(`${V2_ROOT}/teacherAssignments`).get()
  ]);
  const now = Date.now();
  const updates = buildQuestionBankFanout({
    questionId,
    before,
    after,
    students: studentsSnapshot.val() || {},
    assignments: assignmentsSnapshot.val() || {},
    now
  });
  updates[`questionBankReleaseQueue/${questionId}`] = questionHasFutureExamWindow(after, now)
    ? { endAt: Number(after.endAt), queuedAt: now }
    : null;
  await applyV2Updates(updates);
});

/** Rebuild one student's projection if their approval or class/group changes.
 * Removing approval clears only their copy, never the canonical bank. */
exports.rebuildStudentQuestionBank = onValueWritten({ ref: `${V2_ROOT}/students/{studentId}`, region: DB_REGION }, async event => {
  const studentId = String(event.params.studentId || '');
  if (!safeQuestionKey(studentId)) return;
  const student = event.data.after.val();
  const database = getDatabase();
  const projectionRef = database.ref(`${V2_ROOT}/studentQuestionBank/${studentId}`);
  if (!student || student.id !== studentId || student.status !== 'approved') {
    await projectionRef.set(null);
    return;
  }
  const [bankSnapshot, existingSnapshot] = await Promise.all([
    database.ref(`${V2_ROOT}/questionBank`).get(),
    projectionRef.get()
  ]);
  const projection = buildStudentQuestionProjection(bankSnapshot.val() || {}, student, Date.now());
  const existing = mapObject(existingSnapshot.val());
  const updates = {};
  for (const questionId of new Set([...Object.keys(existing), ...Object.keys(projection)])) {
    if (!safeQuestionKey(questionId)) continue;
    const next = projection[questionId] || null;
    if (!jsonEqual(existing[questionId] ?? null, next)) updates[`studentQuestionBank/${studentId}/${questionId}`] = next;
  }
  await applyV2Updates(updates);
});

/** Assignment edits rebuild only the affected Teacher's projection, including
 * removals, so a revoked class/subject cannot leave an old answer-key copy. */
exports.rebuildTeacherQuestionBank = onValueWritten({ ref: `${V2_ROOT}/teacherAssignments/{assignmentId}`, region: DB_REGION }, async event => {
  const before = event.data.before.val();
  const after = event.data.after.val();
  const teacherIds = new Set([before?.teacherId, after?.teacherId].map(value => String(value || '')).filter(safeQuestionKey));
  if (!teacherIds.size) return;
  const database = getDatabase();
  const [assignmentsSnapshot, bankSnapshot] = await Promise.all([
    database.ref(`${V2_ROOT}/teacherAssignments`).get(),
    database.ref(`${V2_ROOT}/questionBank`).get()
  ]);
  const assignments = valuesOf(assignmentsSnapshot.val());
  const questions = mapObject(bankSnapshot.val());
  const updates = {};
  for (const teacherId of teacherIds) {
    const projection = buildTeacherQuestionProjection(questions, teacherId, assignments);
    const existingSnapshot = await database.ref(`${V2_ROOT}/teacherQuestionBank/${teacherId}`).get();
    const existing = mapObject(existingSnapshot.val());
    for (const questionId of new Set([...Object.keys(existing), ...Object.keys(projection)])) {
      if (!safeQuestionKey(questionId)) continue;
      const next = projection[questionId] || null;
      if (!jsonEqual(existing[questionId] ?? null, next)) updates[`teacherQuestionBank/${teacherId}/${questionId}`] = next;
    }
  }
  await applyV2Updates(updates);
});

/** One-minute server release queue: exam-sourced answers are inserted in each
 * student's own bank only after the official endAt, even if no client reconnects. */
exports.releaseQuestionBankExamQuestions = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'Asia/Dhaka',
  region: DB_REGION
}, async () => {
  const database = getDatabase();
  const queueSnapshot = await database.ref(`${V2_ROOT}/questionBankReleaseQueue`).get();
  const now = Date.now();
  const due = Object.entries(mapObject(queueSnapshot.val())).filter(([, item]) => Number(item?.endAt) > 0 && Number(item.endAt) < now);
  if (!due.length) return;
  const [bankSnapshot, studentsSnapshot] = await Promise.all([
    database.ref(`${V2_ROOT}/questionBank`).get(),
    database.ref(`${V2_ROOT}/students`).get()
  ]);
  const bank = mapObject(bankSnapshot.val());
  const students = mapObject(studentsSnapshot.val());
  const updates = {};
  const processed = [];
  for (const [questionId, queued] of due) {
    if (!safeQuestionKey(questionId)) continue;
    const question = bank[questionId];
    if (!question || question.id !== questionId || question.active !== true || !question.source?.examId) {
      processed.push([questionId, Number(queued.endAt)]);
      continue;
    }
    const endAt = Number(question.endAt);
    if (endAt !== Number(queued.endAt)) {
      // A reschedule superseded this queue entry; the canonical trigger creates
      // the replacement entry, so leave it alone if it has already changed.
      if (!(endAt > now)) processed.push([questionId, Number(queued.endAt)]);
      continue;
    }
    for (const [studentId, student] of Object.entries(students)) {
      if (!safeQuestionKey(studentId) || !student || student.id !== studentId) continue;
      const projection = buildStudentQuestionProjection({ [questionId]: question }, student, now);
      if (projection[questionId]) updates[`studentQuestionBank/${studentId}/${questionId}`] = projection[questionId];
    }
    processed.push([questionId, Number(queued.endAt)]);
  }
  await applyV2Updates(updates);
  // Clear a queue entry only if it is still the same schedule we processed.
  await Promise.all(processed.map(([questionId, endAt]) => database.ref(`${V2_ROOT}/questionBankReleaseQueue/${questionId}`).transaction(
    current => current && Number(current.endAt) === endAt ? null : undefined,
    undefined,
    false
  )));
});

async function tokenEntries() {
  const snapshot = await getDatabase().ref(PUSH_TOKENS_PATH).get();
  const value = snapshot.val() || {};
  return Object.entries(value).filter(([, record]) =>
    record && typeof record.token === 'string' && record.token.length > 20);
}

async function sendPayload(entries, payload) {
  if (!entries.length) return { sent: 0, failed: 0 };
  const { token, ...template } = messageFor('unused', payload);
  const messaging = getMessaging();
  const deadTokens = new Set();
  let sent = 0;
  let failed = 0;
  for (const chunk of chunkTokens(entries, 500)) {
    const live = chunk.filter(([, record]) => !deadTokens.has(record.token));
    if (!live.length) continue;
    const tokens = live.map(([, record]) => record.token);
    const response = await messaging.sendEachForMulticast({ ...template, tokens });
    sent += response.successCount;
    failed += response.failureCount;
    const dead = new Set(tokensToPrune(response, tokens));
    if (!dead.size) continue;
    for (const token of dead) deadTokens.add(token);
    // A token for an uninstalled app would fail on every later push: drop it.
    const updates = {};
    for (const [key, record] of live) if (dead.has(record.token)) updates[`${PUSH_TOKENS_PATH}/${key}`] = null;
    if (Object.keys(updates).length) await getDatabase().ref().update(updates);
  }
  return { sent, failed };
}

const sendToEveryone = async payload => sendPayload(await tokenEntries(), payload);

const sendToStudents = async (payload) => {
  const wanted = new Set(payload.studentIds || []);
  if (!wanted.size) return { sent: 0, failed: 0 };
  const entries = (await tokenEntries()).filter(([, record]) => wanted.has(String(record.studentId || '')));
  return sendPayload(entries, payload);
};

exports.pushNotice = onValueWritten({ ref: `${BRIDGE_ROOT}/notices/{noticeId}`, region: DB_REGION }, async event => {
  const after = event.data.after.val();
  const payload = noticePush(event.data.before.val(), after);
  if (!payload) return;
  if (!payload.data.id) payload.data.id = String(event.params.noticeId || '');
  await sendToEveryone(payload);
});

exports.pushBroadcast = onValueWritten({ ref: `${BRIDGE_ROOT}/settings`, region: DB_REGION }, async event => {
  const payload = broadcastPush(event.data.before.val(), event.data.after.val());
  if (!payload) return;
  await sendToEveryone(payload);
});

exports.pushExam = onValueWritten({ ref: `${BRIDGE_ROOT}/examDb/exams/{examId}`, region: DB_REGION }, async event => {
  const after = event.data.after.val();
  const payloads = examPushes(event.data.before.val(), after);
  for (const payload of payloads) {
    if (!payload.data.id) payload.data.id = String(event.params.examId || '');
    await sendToStudents(payload);
  }
});
