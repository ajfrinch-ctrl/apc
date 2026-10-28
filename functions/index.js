const { setGlobalOptions } = require('firebase-functions/v2');
// Existing RTDB triggers/scheduler keep their explicit Singapore region below.
// All callables (and future Firestore triggers) use the requested South Asia region.
setGlobalOptions({ region: 'asia-south1' });
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
const {
  safeKey: safeNoticeKey,
  normalizeNoticeRecord,
  normalizeNoticeDraft,
  noticeMatchesTeacher,
  buildStudentNoticeProjection,
  buildNoticeFanout,
  advanceNoticeDraftAfterPublish
} = require('./notice-projection.js');
const {
  linkedTeacherClaims,
  migrationForTeacher,
  entriesOfLegacyAssignments,
  v2IdentityClaims
} = require('./teacher-assignment-migration.js');
const {
  legacyStudentRows,
  mobileProposals,
  v2StudentRecord
} = require('./v2-roster-migration.js');
const { scoreAttempt, keyAnswers } = require('./exam-scoring.js');
const { ExamSubmissionError, safeForManagerReview, submitStagedExam } = require('./staged-exam-core.cjs');
const { AttemptError, resultId, validStagedAttempt, submitStagedAttempt } = require('./staged-attempt-core.cjs');
const { ReleaseError, closeStagedExamForRelease } = require('./staged-release-core.cjs');
const { EnrollmentError, registerStagedStudent, reviewStagedStudent } = require('./staged-student-core.cjs');
const { PaymentError, configureStagedFee, submitStagedPayment, inspectStagedPayment, reviewStagedPayment } = require('./staged-payment-core.cjs');
const { requestStagedReversal, decideStagedReversal } = require('./staged-reversal-core.cjs');
const { readStagedPaymentPosition } = require('./staged-payment-position-core.cjs');

initializeApp();
const auth = getAuth();
const db = getFirestore();
const HANDLE = /^[a-z][a-z0-9._]{3,19}$/;
const PHONE = /^01[3-9]\d{8}$/;
const STAFF_ROLES = new Set(['manager', 'teacher', 'payment']);

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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('@accounts.activeplus.app')) throw new HttpsError('invalid-argument', 'বাস্তব ইমেইল ঠিকানা প্রয়োজন।');
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

/** Keep the old DEFAULT region (us-central1) while disabling this endpoint:
 * changing its region would leave the original unauthenticated URL alive.
 * Deploy this deny-all stub to every formerly deployed region before running
 * bootstrap-first-admin.cjs. Verify live inventory before any prod cutover. */
exports.createFirstAdmin = onCall({ region: 'us-central1' }, () => {
  throw new HttpsError('permission-denied', 'First Admin requires operator-only Admin SDK bootstrap.');
});

/** Admin provisions staff identities using real email/password Auth accounts.
 * Students use the separately staged verified-email enrollment workflow. */
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
    user = await auth.createUser({ email: profile.email, password: profile.password, displayName: profile.fullName, disabled: false });
    const status = 'active';
    await auth.setCustomUserClaims(user.uid, { role, status, mustChangePassword: true, ...v2IdentityClaims(role, user.uid) });
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (!current.exists || current.data().reservation !== lockId) throw new HttpsError('aborted', 'Username reservation বদলে গেছে।');
      const now = FieldValue.serverTimestamp();
      tx.set(ref, { uid: user.uid, role, createdAt: now });
      tx.create(db.doc(`users/${user.uid}`), {
        uid: user.uid, role, status, fullName: profile.fullName, mobile: profile.mobile,
        email: profile.email, username: profile.username, accountOwner: request.auth.uid,
        mustChangePassword: true, createdAt: now, updatedAt: now
      });
    });
    return { ok: true, uid: user.uid, role, status, username: profile.username };
  } catch (error) {
    let removed = !user;
    if (user) {
      try { await auth.deleteUser(user.uid); removed = true; } catch { /* keep reservation for manual recovery */ }
    }
    // A failed Auth rollback must never free this handle for a second UID.
    if (removed) await db.runTransaction(async tx => {
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

/** Separate from the live local form: create Email/Password Auth in a dev
 * project, verify the email, then call this App Check-gated endpoint. No
 * client may create role claims or Firestore student/username documents. */
exports.studentRegisterForReview = onCall({ enforceAppCheck: true }, async request => {
  try {
    return await registerStagedStudent({ db, auth, serverTimestamp: () => FieldValue.serverTimestamp(),
      caller: request.auth, data: request.data });
  } catch (error) {
    if (error instanceof EnrollmentError) {
      const code = error.code === 'identity-reserved' ? 'already-exists'
        : error.code === 'verified-email-required' ? 'permission-denied' : 'invalid-argument';
      throw new HttpsError(code, 'যাচাইকৃত Student পরিচয় বা নিবন্ধনের তথ্য গ্রহণযোগ্য নয়।');
    }
    throw new HttpsError('internal', 'নিবন্ধন যাচাই সম্পন্ন হয়নি; অবস্থা যাচাই করে পুনরায় চেষ্টা করুন।');
  }
});

/** Only Manager may decide a verified, pending staged Student enrollment.
 * Profile/username link and Auth identity must agree before issuing claims. */
exports.managerReviewStudent = onCall({ enforceAppCheck: true }, async request => {
  try {
    return await reviewStagedStudent({ db, auth, serverTimestamp: () => FieldValue.serverTimestamp(),
      caller: request.auth, data: request.data });
  } catch (error) {
    if (error instanceof EnrollmentError) {
      const code = ['manager-required', 'profile-mismatch', 'unverified-student'].includes(error.code) ? 'permission-denied'
        : error.code === 'already-reviewed' ? 'failed-precondition' : 'invalid-argument';
      throw new HttpsError(code, 'Student পরিচয় বা Manager সিদ্ধান্ত যাচাই করা যায়নি।');
    }
    throw new HttpsError('internal', 'পর্যালোচনার অবস্থা যাচাই করুন; একই সিদ্ধান্তে পুনরায় চেষ্টা করুন।');
  }
});

/** Admin configures one verified fee projection, never by browser/profile form. */
exports.adminConfigureStudentFee = onCall({ enforceAppCheck: true }, async request => {
  try {
    return await configureStagedFee({ db, auth, caller: request.auth, data: request.data,
      serverTimestamp: () => FieldValue.serverTimestamp() });
  } catch (error) {
    if (error instanceof PaymentError) {
      throw new HttpsError(error.code === 'summary-reserved' ? 'already-exists'
        : ['student-denied', 'role-denied'].includes(error.code) ? 'permission-denied' : 'invalid-argument',
      'Student ফি বা অনুমতি যাচাই করা যায়নি।');
    }
    throw new HttpsError('internal', 'ফি projection যাচাই করুন; প্রয়োজনে একই অনুরোধ পুনরায় পাঠান।');
  }
});

/** Cash Counter records a server-numbered pending receipt, not a settled bill. */
exports.counterSubmitPayment = onCall({ enforceAppCheck: true }, async request => {
  try {
    return await submitStagedPayment({ db, caller: request.auth, data: request.data,
      serverTimestamp: () => FieldValue.serverTimestamp(), clock: Date.now });
  } catch (error) {
    if (error instanceof PaymentError) {
      throw new HttpsError(['request-reserved', 'reference-reserved'].includes(error.code) ? 'already-exists'
        : ['student-denied', 'role-denied'].includes(error.code) ? 'permission-denied' : 'invalid-argument',
      'অর্থ গ্রহণের পরিচয় বা রসিদের তথ্য যাচাই করা যায়নি।');
    }
    throw new HttpsError('internal', 'রসিদ লেখা হয়েছে কি না যাচাই করে একই requestId দিয়ে আবার চেষ্টা করুন।');
  }
});

/** Manager may inspect only a known receipt's review fields, not the ledger. */
exports.managerInspectPayment = onCall({ enforceAppCheck: true }, async request => {
  try {
    return await inspectStagedPayment({ db, caller: request.auth, id: request.data?.id });
  } catch (error) {
    if (error instanceof PaymentError) throw new HttpsError('permission-denied', 'রসিদ যাচাই করা যায়নি।');
    throw new HttpsError('internal', 'রসিদের অবস্থা যাচাই করুন।');
  }
});

/** A distinct Manager decision is required before a pending receipt counts. */
exports.managerReviewPayment = onCall({ enforceAppCheck: true }, async request => {
  try {
    return await reviewStagedPayment({ db, caller: request.auth, data: request.data,
      serverTimestamp: () => FieldValue.serverTimestamp() });
  } catch (error) {
    if (error instanceof PaymentError) {
      throw new HttpsError(error.code === 'already-reviewed' ? 'failed-precondition'
        : ['role-denied', 'unverified-receipt'].includes(error.code) ? 'permission-denied' : 'invalid-argument',
      'রসিদের সিদ্ধান্ত বা পরিচয় যাচাই করা যায়নি।');
    }
    throw new HttpsError('internal', 'সিদ্ধান্ত লেখা হয়েছে কি না যাচাই করে একই সিদ্ধান্তে আবার চেষ্টা করুন।');
  }
});

/** Manager requests a one-time accounting correction for an approved receipt.
 * This does not issue a refund or change the original transaction. */
exports.managerRequestPaymentReversal = onCall({ enforceAppCheck: true }, async request => {
  try {
    return await requestStagedReversal({ db, caller: request.auth, data: request.data,
      serverTimestamp: () => FieldValue.serverTimestamp() });
  } catch (error) {
    if (error instanceof PaymentError) {
      throw new HttpsError(error.code === 'reversal-reserved' ? 'already-exists'
        : ['role-denied', 'unverified-receipt'].includes(error.code) ? 'permission-denied' : 'invalid-argument',
      'মূল রসিদ বা সংশোধনের আবেদন যাচাই করা যায়নি।');
    }
    throw new HttpsError('internal', 'সংশোধনের আবেদন হয়েছে কি না যাচাই করে একই তথ্য দিয়ে আবার চেষ্টা করুন।');
  }
});

/** A distinct Admin makes the final, one-time accounting decision. */
exports.adminDecidePaymentReversal = onCall({ enforceAppCheck: true }, async request => {
  try {
    return await decideStagedReversal({ db, caller: request.auth, data: request.data,
      serverTimestamp: () => FieldValue.serverTimestamp() });
  } catch (error) {
    if (error instanceof PaymentError) {
      throw new HttpsError(error.code === 'reversal-reserved' ? 'failed-precondition'
        : ['role-denied', 'unverified-receipt', 'unverified-reversal'].includes(error.code) ? 'permission-denied' : 'invalid-argument',
      'সংশোধনের সিদ্ধান্ত বা পরিচয় যাচাই করা যায়নি।');
    }
    throw new HttpsError('internal', 'সিদ্ধান্ত হয়েছে কি না যাচাই করে একই তথ্য দিয়ে আবার চেষ্টা করুন।');
  }
});

/** Read-only, capped, verified Student payment position for Admin only.
 * No browser ledger write, local due change or public settlement claim. */
exports.adminReadStudentPaymentPosition = onCall({ enforceAppCheck: true }, async request => {
  try {
    return await readStagedPaymentPosition({ db, caller: request.auth, data: request.data });
  } catch (error) {
    if (error instanceof PaymentError) {
      throw new HttpsError(['role-denied', 'student-denied'].includes(error.code) ? 'permission-denied'
        : ['ledger-too-large', 'unverified-ledger', 'unverified-receipt', 'unverified-reversal'].includes(error.code)
          ? 'failed-precondition' : 'invalid-argument',
      'যাচাইকৃত হিসাব-সারাংশ তৈরি করা যায়নি; তথ্য/সীমা পর্যালোচনা করুন।');
    }
    throw new HttpsError('internal', 'হিসাবের অবস্থা যাচাই করুন; অসম্পূর্ণ ফল ব্যবহার করবেন না।');
  }
});

/** Staged MCQ submission: trusted transaction creates the public pending paper
 * and its private answer key together. App Check + Teacher email Auth required.
 * No UI calls this yet; do not deploy without emulator rules/role verification. */
exports.teacherSubmitExamForReview = onCall({ enforceAppCheck: true }, async request => {
  requireCaller(request, 'teacher');
  try {
    return await submitStagedExam({
      db, serverTimestamp: () => FieldValue.serverTimestamp(), caller: request.auth,
      data: request.data, now: Date.now()
    });
  } catch (error) {
    if (error instanceof ExamSubmissionError) {
      const code = error.code === 'exam-id-reserved' ? 'already-exists'
        : ['teacher-auth-required', 'profile-mismatch', 'class-denied'].includes(error.code) ? 'permission-denied'
        : error.code === 'invalid-window' ? 'failed-precondition' : 'invalid-argument';
      throw new HttpsError(code, 'পরীক্ষার তথ্য বা অনুমতি গ্রহণযোগ্য নয়।');
    }
    throw new HttpsError('internal', 'পরীক্ষা জমা হয়নি; অবস্থা যাচাই করে পুনরায় চেষ্টা করুন।');
  }
});

/** Manager is the only role allowed to publish/reject pending exam records. */
exports.managerReviewExam = onCall(async request => {
  requireCaller(request, 'manager');
  const examId = String(request.data?.examId || '');
  const decision = String(request.data?.decision || '');
  const note = String(request.data?.note || '').trim().slice(0, 500);
  if (!safeQuestionKey(examId) || !['publish', 'reject'].includes(decision)) throw new HttpsError('invalid-argument', 'পরীক্ষা ও সিদ্ধান্ত নির্বাচন করুন।');
  if (decision === 'reject' && !note) throw new HttpsError('invalid-argument', 'সংশোধনের কারণ লিখুন।');
  const ref = db.doc(`exams/${examId}`);
  await db.runTransaction(async tx => {
    const exam = await tx.get(ref);
    if (!exam.exists || exam.data().status !== 'pending') throw new HttpsError('failed-precondition', 'শুধু অপেক্ষমাণ পরীক্ষা পর্যালোচনা করা যাবে।');
    if (decision === 'publish') {
      const key = await tx.get(ref.collection('private').doc('key'));
      if (!key.exists || !safeForManagerReview(exam.data(), key.data(), Date.now())) {
        throw new HttpsError('failed-precondition', 'নিরাপদ প্রশ্ন ও উত্তরমালা ছাড়া প্রকাশ করা যাবে না।');
      }
    }
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

/** Staged single-use MCQ attempt; no browser Firestore writes and no answer key
 * read. The exam is re-read in the transaction, including its release lock. */
exports.studentSubmitExamAttempt = onCall({ enforceAppCheck: true }, async request => {
  try {
    return await submitStagedAttempt({
      db, serverTimestamp: () => FieldValue.serverTimestamp(),
      caller: request.auth, data: request.data, clock: Date.now
    });
  } catch (error) {
    if (error instanceof AttemptError) {
      const code = ['student-auth-required', 'profile-mismatch', 'exam-denied'].includes(error.code) ? 'permission-denied'
        : ['window-closed', 'attempt-exists'].includes(error.code) ? 'failed-precondition' : 'invalid-argument';
      throw new HttpsError(code, 'পরীক্ষায় অংশগ্রহণের অনুমতি বা সময়সীমা গ্রহণযোগ্য নয়।');
    }
    throw new HttpsError('internal', 'উত্তরপত্র জমা হয়নি; অবস্থা যাচাই করে পুনরায় চেষ্টা করুন।');
  }
});

/** Admin can suspend/re-activate staff accounts, never approve a student. */
exports.adminSetAccountStatus = onCall(async request => {
  requireCaller(request, 'admin');
  const uid = String(request.data.uid || '');
  const status = String(request.data.status || '');
  if (!uid || !['active', 'suspended'].includes(status)) throw new HttpsError('invalid-argument', 'Account status সঠিক নয়।');
  const ref = db.doc(`users/${uid}`);
  let accountRole = '';
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists || doc.data().role === 'admin' || doc.data().role === 'student') {
      throw new HttpsError('failed-precondition', 'এই Account status Admin-এর মাধ্যমে বদলানো যাবে না।');
    }
    accountRole = String(doc.data().role || '');
    tx.update(ref, { status, updatedAt: FieldValue.serverTimestamp() });
  });
  const user = await auth.getUser(uid);
  // Backfill the V2 link for accounts created before the staged migration:
  // teacherId/studentId always equal the account's own Auth uid.
  await auth.setCustomUserClaims(uid, { ...user.customClaims, status, ...v2IdentityClaims(accountRole || String(user.customClaims?.role || ''), uid) });
  await auth.updateUser(uid, { disabled: status !== 'active' });
  // Staff deactivate/re-activate rewrites the account's authorization: every
  // refresh token dies so no device keeps serving the old role/status view.
  await auth.revokeRefreshTokens(uid);
  return { ok: true, uid, status };
});

/**
 * Release one finished exam: score every attempt against the private answer
 * key and publish the answers. Scoring and answer release live here so no
 * client can ever read the key or mint a score early:
 *
 *   • the exam window must have ended (`endAt` in the past);
 *   • the key is read from `exams/{examId}/private/key` (student-inaccessible);
 *   • every `attempts` row of the exam is scored and written to `results` as
 *     `res_<sha256(examId,studentId)>` (Admin SDK; deterministic, no ambiguous
 *     separator collisions; re-running the release stays idempotent);
 *   • the answers are copied to `exams/{examId}/releasedKey/answers` with a
 *     `releasedAt` stamp — the only answer document students may read, and
 *     only after release.
 *
 * Callers: Admin/Manager always; the owning teacher for their own paper. */
exports.releaseExamResults = onCall(async request => {
  if (!request.auth || request.auth.token.status !== 'active' || request.auth.token.mustChangePassword === true) {
    throw new HttpsError('permission-denied', 'সক্রিয় অ্যাকাউন্ট প্রয়োজন।');
  }
  const examId = String(request.data?.examId || '');
  if (!safeQuestionKey(examId)) throw new HttpsError('invalid-argument', 'examId সঠিক নয়।');
  const callerUid = request.auth.uid;
  let closed;
  try {
    closed = await closeStagedExamForRelease({
      db, serverTimestamp: () => FieldValue.serverTimestamp(), caller: request.auth,
      examId, clock: Date.now
    });
  } catch (error) {
    if (error instanceof ReleaseError) {
      throw new HttpsError('failed-precondition', 'পরীক্ষাটি যাচাইকৃত বা শেষ হয়নি।');
    }
    throw new HttpsError('internal', 'ফলাফল প্রকাশের অবস্থা যাচাই করুন।');
  }
  if (closed.alreadyReleased) return { ok: true, examId, alreadyReleased: true };
  const { exam, key } = closed;
  const examRef = db.doc(`exams/${examId}`);
  const attemptsSnapshot = await db.collection('attempts').where('examId', '==', examId).get();
  // Validate the entire set BEFORE scoring any row. A bad legacy/forged
  // attempt holds the release lock for operator review, never a partial leak.
  const pending = [];
  attemptsSnapshot.forEach(attemptDoc => {
    const attempt = attemptDoc.data();
    if (!validStagedAttempt(attempt, exam, attemptDoc.id)) {
      throw new HttpsError('failed-precondition', 'অযাচাইকৃত উত্তরপত্র আছে; প্রকাশ বন্ধ রাখা হয়েছে।');
    }
    pending.push(attempt);
  });
  const releasedAt = FieldValue.serverTimestamp();
  let attemptsScored = 0;
  const writes = [];
  for (const attempt of pending) {
    const studentId = attempt.studentId;
    attemptsScored += 1;
    const scored = scoreAttempt(key, attempt);
    const id = resultId(examId, studentId);
    writes.push(db.collection('results').doc(id).set({
      id,
      examId,
      studentId,
      className: attempt.className != null ? attempt.className : (exam.className != null ? exam.className : ''),
      score: scored.score,
      total: scored.total,
      correct: scored.correct,
      wrong: scored.wrong,
      unanswered: scored.unanswered,
      scoredBy: 'releaseExamResults',
      gradedAt: releasedAt
    }, { merge: true }));
  }
  await Promise.all(writes);
  await examRef.collection('releasedKey').doc('answers').set({
    examId,
    answers: keyAnswers(key),
    questions: Array.isArray(key.questions)
      ? key.questions.map(question => ({
        uid: question && question.uid != null ? question.uid : (question && question.id != null ? question.id : ''),
        answer: question && question.answer != null ? question.answer : ''
      }))
      : [],
    releasedAt,
    releasedBy: callerUid
  }, { merge: true });
  await examRef.set({ resultsReleaseState: 'released', resultsReleased: true, resultsReleasedAt: releasedAt }, { merge: true });
  return { ok: true, examId, attemptsScored };
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

/** Teacher notice-publishing callable (docs/RTDB-PER-USER-RULES-PLAN.md §5).
 * Verifies the authenticated active Teacher's assignment scope against the
 * private draft under `noticeDraftsByAuthor/<uid>/<noticeId>` before writing
 * canonical `activePlusV2/notices/<noticeId>`. */
exports.publishNotice = onCall(async request => {
  requireCaller(request, 'teacher');
  const teacherId = String(request.auth.token.teacherId || '');
  const authorUid = String(request.auth.uid || '');
  const noticeId = String(request.data?.noticeId || '');
  if (!safeNoticeKey(teacherId) || !safeNoticeKey(authorUid) || !safeNoticeKey(noticeId)) {
    throw new HttpsError('permission-denied', 'সক্রিয় Teacher identity প্রয়োজন।');
  }
  const database = getDatabase();
  const [draftSnapshot, assignmentsSnapshot] = await Promise.all([
    database.ref(`${V2_ROOT}/noticeDraftsByAuthor/${authorUid}/${noticeId}`).get(),
    database.ref(`${V2_ROOT}/teacherAssignments`).get()
  ]);
  const rawDraft = draftSnapshot.val();
  if (!rawDraft || rawDraft.id !== noticeId || rawDraft.authorUid !== authorUid) {
    throw new HttpsError('not-found', 'নিজের অপেক্ষমাণ নোটিশ Draft পাওয়া যায়নি।');
  }
  let draft;
  try {
    draft = normalizeNoticeDraft(rawDraft, { id: noticeId, authorUid });
  } catch {
    throw new HttpsError('invalid-argument', 'নোটিশ Draft-এর তথ্য সঠিক নয়।');
  }
  const assignmentRows = valuesOf(assignmentsSnapshot.val());
  if (!noticeMatchesTeacher(draft, teacherId, assignmentRows)) {
    throw new HttpsError('permission-denied', 'এই শ্রেণি বা বিভাগে নোটিশ প্রকাশের সক্রিয় assignment আপনার নেই।');
  }
  const profileSnapshot = await db.doc(`users/${authorUid}`).get();
  const profile = profileSnapshot.exists ? profileSnapshot.data() : {};
  const displayName = String(profile.fullName || profile.username || request.auth.token.name || draft.createdBy || 'Teacher').trim().slice(0, 100);
  const nowIso = new Date().toISOString();
  const canonicalNotice = normalizeNoticeRecord({
    ...draft,
    id: noticeId,
    status: 'published',
    published: true,
    createdBy: displayName,
    updatedAt: nowIso
  }, { id: noticeId });

  const canonicalRef = database.ref(`${V2_ROOT}/notices/${noticeId}`);
  const result = await canonicalRef.transaction(current => {
    if (current) {
      if (current.createdByUid && current.createdByUid !== authorUid) return;
      if (!noticeMatchesTeacher(current, teacherId, assignmentRows)) return;
    }
    return {
      ...canonicalNotice,
      createdBy: current?.createdBy || displayName,
      createdAt: current?.createdAt || draft.createdAt || nowIso,
      updatedAt: nowIso,
      createdByUid: current?.createdByUid || authorUid,
      updatedByUid: authorUid,
      teacherId: current?.teacherId || teacherId
    };
  }, undefined, false);
  if (!result.committed) {
    throw new HttpsError('permission-denied', 'অন্য কারো বা অনুমোদনবিহীন নোটিশ পরিবর্তন করা যাবে না।');
  }
  await database.ref(`${V2_ROOT}/noticeDraftsByAuthor/${authorUid}/${noticeId}`)
    .transaction(current => advanceNoticeDraftAfterPublish(current, {
      authorUid,
      noticeId,
      publishedDraft: rawDraft
    }), undefined, false);
  return { ok: true, noticeId, updatedAt: nowIso };
});

/** Fan out canonical published notices to matching approved students under
 * `activePlusV2/studentNotices/<studentId>/<noticeId>` and retract stale copies. */
exports.projectNoticeRecord = onValueWritten({ ref: `${V2_ROOT}/notices/{noticeId}`, region: DB_REGION }, async event => {
  const noticeId = String(event.params.noticeId || '');
  if (!safeNoticeKey(noticeId)) return;
  const before = event.data.before.val();
  const after = event.data.after.val();
  if (after) {
    try { normalizeNoticeRecord(after, { id: noticeId }); }
    catch (error) { throw new Error(`Invalid canonical Notice row ${noticeId}: ${error.message}`); }
  }
  const database = getDatabase();
  const studentsSnapshot = await database.ref(`${V2_ROOT}/students`).get();
  const updates = buildNoticeFanout({
    noticeId,
    before,
    after,
    students: studentsSnapshot.val() || {}
  });
  await applyV2Updates(updates);
});

/** Rebuild a student's `studentNotices/<studentId>` subtree when their approval
 * status, class, or group changes. */
exports.rebuildStudentNotices = onValueWritten({ ref: `${V2_ROOT}/students/{studentId}`, region: DB_REGION }, async event => {
  const studentId = String(event.params.studentId || '');
  if (!safeNoticeKey(studentId)) return;
  const student = event.data.after.val();
  const database = getDatabase();
  const projectionRef = database.ref(`${V2_ROOT}/studentNotices/${studentId}`);
  if (!student || student.id !== studentId || student.status !== 'approved') {
    await projectionRef.set(null);
    return;
  }
  const [noticesSnapshot, existingSnapshot] = await Promise.all([
    database.ref(`${V2_ROOT}/notices`).get(),
    projectionRef.get()
  ]);
  const projection = buildStudentNoticeProjection(noticesSnapshot.val() || {}, student);
  const existing = mapObject(existingSnapshot.val());
  const updates = {};
  for (const noticeId of new Set([...Object.keys(existing), ...Object.keys(projection)])) {
    if (!safeNoticeKey(noticeId)) continue;
    const next = projection[noticeId] || null;
    if (!jsonEqual(existing[noticeId] ?? null, next)) updates[`studentNotices/${studentId}/${noticeId}`] = next;
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

/**
 * Staged-migration link step for accounts that predate the V2 claims.
 *
 * • Dry run (no `username`): reports which legacy usernames carry assignment
 *   rows, without writing anything.
 * • With `username`: verifies the identity server-side through
 *   `usernameIndex` → `users/{uid}` → Firebase Auth, then sets the secure
 *   `teacherId` claim via linkedTeacherClaims(). An inactive, disabled or
 *   non-Teacher identity is rejected — the legacy username alone is never
 *   trusted.
 * • With `applyAssignments: true`: additionally writes that Teacher's migrated
 *   rows to `activePlusV2/teacherAssignments/{id}` (Admin SDK writes bypass
 *   rules, so this is safe before the V2 rules deploy). Legacy bridge rows are
 *   never modified or deleted; unresolved rows are reported, not dropped.
 */
exports.adminProvisionV2Identities = onCall(async request => {
  requireCaller(request, 'admin');
  const username = normalizeUsername(request.data?.username);
  const applyAssignments = request.data?.applyAssignments === true;
  const database = getDatabase();
  const legacySnapshot = await database.ref(`${BRIDGE_ROOT}/teacherAssignments`).get();
  const legacyValue = legacySnapshot.val();
  const legacyRows = entriesOfLegacyAssignments(legacyValue);

  if (!username) {
    const usernames = new Set();
    for (const [, row] of legacyRows) usernames.add(normalizeUsername(row?.teacherUsername));
    usernames.delete('');
    return { ok: true, preview: true, usernames: [...usernames].sort(), totalRows: legacyRows.length };
  }
  if (!HANDLE.test(username)) {
    throw new HttpsError('invalid-argument', 'username গ্রহণযোগ্য নয়।');
  }

  const indexSnapshot = await usernameDoc(username).get();
  const uid = String(indexSnapshot.exists ? indexSnapshot.data()?.uid || '' : '');
  if (!safeQuestionKey(uid)) throw new HttpsError('not-found', 'এই username-এর যাচাইযোগ্য অ্যাকাউন্ট পাওয়া যায়নি।');
  const profileSnapshot = await db.doc(`users/${uid}`).get();
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  const record = await auth.getUser(uid).catch(() => null);
  if (!profile || !record) throw new HttpsError('not-found', 'এই username-এর যাচাইযোগ্য অ্যাকাউন্ট পাওয়া যায়নি।');
  if (record.disabled) throw new HttpsError('failed-precondition', 'ডিজেবল করা অ্যাকাউন্ট লিংক করা যাবে না।');
  const identity = {
    uid,
    username: normalizeUsername(profile.username) || username,
    role: String(profile.role || ''),
    status: String(profile.status || ''),
    disabled: false,
    mustChangePassword: profile.mustChangePassword === true
  };
  if (identity.username !== username) {
    throw new HttpsError('failed-precondition', 'username index এবং profile মিলছে না।');
  }
  let claims;
  try {
    claims = linkedTeacherClaims({ uid, profile: identity, authClaims: record.customClaims || {} });
  } catch {
    throw new HttpsError('failed-precondition', 'শুধু সক্রিয় Teacher অ্যাকাউন্ট লিংক করা যায়।');
  }
  await auth.setCustomUserClaims(uid, claims);
  // Linking rewrites the account's role/status claims — a role change for
  // every session already in flight. Force every device to re-authenticate.
  await auth.revokeRefreshTokens(uid);

  const migration = migrationForTeacher(legacyValue, username, identity);
  if (applyAssignments && migration.assignments.length) {
    const patch = {};
    for (const row of migration.assignments) patch[`${V2_ROOT}/teacherAssignments/${row.id}`] = row;
    await database.ref().update(patch);
  }
  return {
    ok: true,
    uid,
    username,
    linkedClaims: { role: claims.role, status: claims.status, teacherId: claims.teacherId },
    assignments: migration.assignments,
    unresolved: migration.unresolved,
    applied: applyAssignments
  };
});

/**
 * Staged-migration roster step. Legacy roster rows live under
 * `activePlusSync/v1/students/{recordId}` with local record ids and no link to
 * any Firebase Auth account; V2 addresses a student's own paths by the claim
 * `studentId` (=== Auth uid). Each legacy row must therefore be re-keyed under
 * the matching account's uid by an explicit Admin decision — a wrong match is a
 * privacy breach, so the callable only PROPOSES candidates by normalized
 * mobile and never auto-links.
 *
 * • `{ preview: true }`: legacy rows with candidate accounts per row.
 * • `{ studentId, uid }`: validates both sides, returns the proposed V2 row.
 * • `{ studentId, uid, apply: true }`: additionally writes
 *   `activePlusV2/students/{uid}` (additive; a row created by the new account
 *   flow is never overwritten) and backfills the `studentId` claim. The legacy
 *   bridge row is never modified or deleted.
 */
exports.adminMigrateStudentToV2 = onCall(async request => {
  requireCaller(request, 'admin');
  const preview = request.data?.preview === true;
  const studentId = String(request.data?.studentId || '');
  const uid = String(request.data?.uid || '');
  const apply = request.data?.apply === true;
  const database = getDatabase();
  const legacySnapshot = await database.ref(`${BRIDGE_ROOT}/students`).get();
  const legacyValue = legacySnapshot.val();

  if (preview) {
    const accountsSnapshot = await db.collection('users').where('role', '==', 'student').get();
    const accounts = accountsSnapshot.docs.map(docSnap => docSnap.data());
    return { ok: true, preview: true, proposals: mobileProposals(legacyValue, accounts) };
  }

  if (!safeQuestionKey(studentId) || !safeQuestionKey(uid)) {
    throw new HttpsError('invalid-argument', 'studentId এবং uid যাচাই করুন।');
  }
  const rows = new Map(legacyStudentRows(legacyValue));
  const legacyRow = rows.get(studentId);
  if (!legacyRow) throw new HttpsError('not-found', 'এই লেগাসি শিক্ষার্থী রেকর্ড পাওয়া যায়নি।');
  const profileSnapshot = await db.doc(`users/${uid}`).get();
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  const record = await auth.getUser(uid).catch(() => null);
  if (!profile || !record || profile.role !== 'student') {
    throw new HttpsError('failed-precondition', 'এই uid-এর যাচাইযোগ্য শিক্ষার্থী অ্যাকাউন্ট পাওয়া যায়নি।');
  }
  let migrationRecord;
  try {
    migrationRecord = v2StudentRecord(legacyRow, { uid, accountStatus: String(profile.status || 'pending') });
  } catch (error) {
    throw new HttpsError('failed-precondition', `মাইগ্রেশন রো তৈরি করা যায়নি: ${error.message}`);
  }
  if (!apply) return { ok: true, proposed: migrationRecord };

  const targetRef = database.ref(`${V2_ROOT}/students/${uid}`);
  const result = await targetRef.transaction(current => {
    // Never overwrite a row the new account flow created; re-running the same
    // confirmed migration is allowed (idempotent).
    if (current && current.migratedFromLegacy !== true) return;
    return migrationRecord;
  }, undefined, false);
  if (!result.committed) {
    throw new HttpsError('failed-precondition', 'এই শিক্ষার্থীর রো আগে থেকেই নতুন অ্যাকাউন্ট ফ্লোতে তৈরি — ওভাররাইট করা হয়নি।');
  }
  const claims = record.customClaims || {};
  if (claims.studentId !== uid) {
    await auth.setCustomUserClaims(uid, { ...claims, ...v2IdentityClaims('student', uid) });
  }
  return { ok: true, applied: true, migrated: migrationRecord };
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

const { validateRegistrationDecisionRequest: validateDecisionCore } = require('./registration-decision-core');

function validateRegistrationDecisionRequest(auth, data = {}) {
  const checked = validateDecisionCore(auth, data);
  if (!checked.ok) {
    throw new HttpsError(checked.code, checked.message);
  }
  return checked;
}

exports.validateRegistrationDecisionRequest = validateRegistrationDecisionRequest;

exports.decideStudentRegistration = onCall(async request => {
  const { role, studentId, decision, note } = validateRegistrationDecisionRequest(request.auth, request.data);
  const database = getDatabase();
  const studentRef = database.ref(`${BRIDGE_ROOT}/students/${studentId}`);
  const snap = await studentRef.get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'শিক্ষার্থীর আবেদন পাওয়া যায়নি।');
  }
  const current = snap.val() || {};
  if (current.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'এই আবেদনটি ইতিমধ্যে নিষ্পত্তি হয়েছে।');
  }
  const nowIso = new Date().toISOString();
  const actor = String(request.auth.token?.username || request.auth.token?.email || request.auth.uid);
  const nextRow = {
    ...current,
    id: studentId,
    status: decision,
    accountStatus: decision === 'approved' ? 'active' : 'rejected',
    reviewedBy: actor,
    reviewedRole: role,
    reviewedAt: nowIso,
    updatedAt: nowIso,
    ...(decision === 'approved'
      ? { approvedBy: actor, approvedAt: nowIso, reviewNote: '' }
      : { reviewNote: note, rejectionReason: note })
  };
  await studentRef.set(nextRow);
  const notifRef = database.ref(`${BRIDGE_ROOT}/notifications/reg-${studentId}`);
  const notifSnap = await notifRef.get();
  if (notifSnap.exists()) {
    await notifRef.update({ read: true, readAt: nowIso, readBy: actor });
  }
  return { ok: true, student: nextRow };
});

exports.pushNewRegistration = onValueWritten({ ref: `${BRIDGE_ROOT}/notifications/{notifId}`, region: DB_REGION }, async event => {
  const before = event.data.before.val();
  const after = event.data.after.val();
  if (before || !after || after.type !== 'new_registration' || after.read === true) return;
  const entries = (await tokenEntries()).filter(([, record]) => record.role === 'admin' || record.role === 'manager');
  if (!entries.length) return;
  await sendPayload(entries, {
    title: 'নতুন শিক্ষার্থী রেজিস্ট্রেশন করেছে',
    body: `${String(after.studentName || 'নতুন শিক্ষার্থী')} (ID: ${String(after.studentId || '')}) অনুমোদনের অপেক্ষায় আছে।`,
    data: { kind: 'registration', id: String(after.studentId || event.params.notifId || '') }
  });
});

// Optional Telegram alerts; secrets are read only by server-side triggers.
Object.assign(exports, require('./telegram-notifications.cjs'));
