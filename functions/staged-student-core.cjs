'use strict';

/* Phase 7: verified Auth identity -> server-owned pending Student enrollment ->
 * Admin/Manager decision. No SDK imports so transactional behavior can be tested
 * without a live project. This is not the local registration flow. */
const { safeId } = require('./staged-exam-core.cjs');
const CLASSES = Object.freeze([
  'অষ্টম শ্রেণি', 'নবম শ্রেণি', 'দশম শ্রেণি', 'একাদশ শ্রেণি', 'দ্বাদশ শ্রেণি',
  'ডিগ্রি ১ম বর্ষ', 'ডিগ্রি ২য় বর্ষ', 'ডিগ্রি ৩য় বর্ষ',
  'অনার্স ১ম বর্ষ', 'অনার্স ২য় বর্ষ', 'অনার্স ৩য় বর্ষ', 'অনার্স ৪র্থ বর্ষ'
]);
const HANDLE = /^[a-z][a-z0-9._]{3,19}$/;
const RESERVED = new Set(['admin', 'administrator', 'root', 'null', 'undefined']);
const PHONE = /^01[3-9]\d{8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (data, fields) => plain(data) && Object.keys(data).every(key => fields.includes(key));
class EnrollmentError extends Error {
  constructor(code) { super(code); this.name = 'EnrollmentError'; this.code = code; }
}
const refuse = code => { throw new EnrollmentError(code); };
function normalizedText(value, max) {
  if (typeof value !== 'string' || !value || value !== value.trim() ||
      value !== value.normalize('NFC') || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) refuse('invalid-profile');
  return value;
}
function preparedEnrollment(data) {
  if (!exact(data, ['fullName', 'username', 'mobile', 'className', 'group', 'guardianConsent']) ||
      data.guardianConsent !== true) refuse('invalid-profile');
  const fullName = normalizedText(data.fullName, 100);
  if (fullName.length < 2) refuse('invalid-profile');
  const username = normalizedText(data.username, 20);
  const mobile = normalizedText(data.mobile, 11);
  const className = normalizedText(data.className, 80);
  const group = data.group === undefined || data.group === '' ? '' : normalizedText(data.group, 80);
  if (!HANDLE.test(username) || RESERVED.has(username) || !PHONE.test(mobile) ||
      !CLASSES.includes(className)) refuse('invalid-profile');
  return { fullName, username, mobile, className, group };
}
function verifiedAuth(caller, authUser, { allowFinal = false } = {}) {
  const uid = caller?.uid, claims = caller?.token || {};
  const address = authUser?.email;
  if (!safeId(uid) || claims.firebase?.sign_in_provider !== 'password' ||
      !safeId(authUser?.uid) || authUser.uid !== uid || authUser.disabled === true ||
      authUser.emailVerified !== true || typeof address !== 'string' ||
      !EMAIL.test(address) || address.endsWith('@accounts.activeplus.app') ||
      typeof claims.email !== 'string' || claims.email.toLowerCase() !== address.toLowerCase() ||
      claims.mustChangePassword === true) refuse('verified-email-required');
  const role = authUser.customClaims?.role, status = authUser.customClaims?.status;
  if ((role || status || authUser.customClaims?.studentId) &&
      (role !== 'student' || !['pending', ...(allowFinal ? ['approved', 'rejected'] : [])].includes(status) ||
       authUser.customClaims.studentId !== uid)) refuse('identity-reserved');
  if ((claims.role || claims.status || claims.studentId) &&
      (claims.role !== 'student' || !['pending', ...(allowFinal ? ['approved', 'rejected'] : [])].includes(claims.status) ||
       claims.studentId !== uid)) refuse('identity-reserved');
  return { uid, email: address.toLowerCase() };
}

async function registerStagedStudent({ db, auth, serverTimestamp, caller, data } = {}) {
  if (!db || typeof db.doc !== 'function' || typeof db.runTransaction !== 'function' ||
      !auth || typeof auth.getUser !== 'function' || typeof auth.setCustomUserClaims !== 'function' ||
      typeof serverTimestamp !== 'function') refuse('trusted-admin-required');
  // Validate before touching Auth/Firestore; password/claims/UID never come from the form.
  const profile = preparedEnrollment(data);
  if (!safeId(caller?.uid)) refuse('verified-email-required');
  const authUser = await auth.getUser(caller.uid);
  const { uid, email } = verifiedAuth(caller, authUser);
  const userRef = db.doc(`users/${uid}`), studentRef = db.doc(`students/${uid}`);
  const handleRef = db.doc(`usernameIndex/${profile.username}`);
  const alreadyExists = await db.runTransaction(async tx => {
    const [userSnap, studentSnap, handleSnap] = await Promise.all([
      tx.get(userRef), tx.get(studentRef), tx.get(handleRef)
    ]);
    if (userSnap.exists || studentSnap.exists || handleSnap.exists) {
      const user = userSnap.exists ? userSnap.data() : null;
      const student = studentSnap.exists ? studentSnap.data() : null;
      const handle = handleSnap.exists ? handleSnap.data() : null;
      if (user?.uid === uid && user.email === email && user.role === 'student' && user.status === 'pending' &&
          student?.uid === uid && student.status === 'pending' &&
          handle?.uid === uid && handle.role === 'student' &&
          user.username === profile.username && student.username === profile.username &&
          user.fullName === profile.fullName && student.fullName === profile.fullName &&
          student.mobile === profile.mobile && student.className === profile.className &&
          student.group === profile.group && student.guardianConsent === true) return true;
      refuse('identity-reserved');
    }
    const now = serverTimestamp();
    tx.create(handleRef, { uid, role: 'student', createdAt: now });
    tx.create(userRef, { uid, role: 'student', status: 'pending', email,
      username: profile.username, fullName: profile.fullName, mustChangePassword: false,
      createdAt: now, updatedAt: now });
    tx.create(studentRef, { uid, status: 'pending', username: profile.username,
      name: profile.fullName, fullName: profile.fullName, mobile: profile.mobile,
      className: profile.className, group: profile.group, guardianConsent: true,
      guardianConsentAt: now, createdAt: now });
    return false;
  });
  // Cross-service writes cannot be atomic. Pending docs never authorize access;
  // a failed claim update is retryable against the exact same three documents.
  await auth.setCustomUserClaims(uid, { role: 'student', status: 'pending', studentId: uid,
    mustChangePassword: false });
  return { ok: true, uid, status: 'pending', alreadyRegistered: alreadyExists, refreshIdToken: true };
}

async function reviewStagedStudent({ db, auth, serverTimestamp, caller, data } = {}) {
  if (!db || typeof db.doc !== 'function' || typeof db.runTransaction !== 'function' ||
      !auth || typeof auth.getUser !== 'function' || typeof auth.setCustomUserClaims !== 'function' ||
      typeof serverTimestamp !== 'function') refuse('trusted-admin-required');
  if (!safeId(caller?.uid) || !['admin', 'manager'].includes(caller.token?.role) || caller.token?.status !== 'active' ||
      caller.token?.mustChangePassword === true || caller.token?.firebase?.sign_in_provider !== 'password') refuse('reviewer-required');
  if (!exact(data, ['uid', 'decision', 'note']) || !safeId(data.uid) ||
      !['approved', 'rejected'].includes(data.decision)) refuse('invalid-review');
  const note = data.note === undefined ? '' : (data.note === '' ? '' : normalizedText(data.note, 500));
  if (data.decision === 'rejected' && !note) refuse('invalid-review');
  const uid = data.uid, decision = data.decision;
  const authUser = await auth.getUser(uid);
  // Admin/Manager is not the Student, so validate the target Auth record explicitly.
  if (authUser.uid !== uid || authUser.disabled || !authUser.emailVerified ||
      !EMAIL.test(authUser.email || '') || authUser.email.endsWith('@accounts.activeplus.app') ||
      authUser.customClaims?.role !== 'student' || authUser.customClaims?.studentId !== uid ||
      !['pending', decision].includes(authUser.customClaims.status)) refuse('unverified-student');
  const email = authUser.email.toLowerCase();
  const userRef = db.doc(`users/${uid}`), studentRef = db.doc(`students/${uid}`), auditRef = db.doc(`studentApprovals/${uid}`);
  const alreadyReviewed = await db.runTransaction(async tx => {
    const [u, s, audit] = await Promise.all([tx.get(userRef), tx.get(studentRef), tx.get(auditRef)]);
    const user = u.exists ? u.data() : null, student = s.exists ? s.data() : null;
    if (!user || !student || !HANDLE.test(user.username) || RESERVED.has(user.username) || user.uid !== uid || student.uid !== uid ||
        user.role !== 'student' || user.email !== email || student.username !== user.username ||
        !CLASSES.includes(student.className) || student.guardianConsent !== true ||
        user.mustChangePassword === true) refuse('profile-mismatch');
    const handle = await tx.get(db.doc(`usernameIndex/${user.username}`));
    if (!handle.exists || handle.data().uid !== uid || handle.data().role !== 'student') refuse('profile-mismatch');
    if (user.status === decision && student.status === decision && audit.exists &&
        audit.data().decision === decision && audit.data().reviewedBy === caller.uid &&
        audit.data().note === note) return true;
    if (user.status !== 'pending' || student.status !== 'pending' || audit.exists) refuse('already-reviewed');
    const now = serverTimestamp();
    tx.update(studentRef, { status: decision, reviewedBy: caller.uid, reviewedAt: now, reviewNote: note });
    tx.update(userRef, { status: decision, reviewedBy: caller.uid, reviewedAt: now, updatedAt: now });
    tx.create(auditRef, { studentId: uid, decision, reviewedBy: caller.uid, reviewedAt: now, note });
    return false;
  });
  // Retry after an Auth failure repairs the claim; do not re-open a decision.
  await auth.setCustomUserClaims(uid, { ...authUser.customClaims, role: 'student',
    status: decision, studentId: uid, mustChangePassword: false });
  return { ok: true, uid, status: decision, alreadyReviewed, refreshIdToken: true };
}

module.exports = { EnrollmentError, CLASSES, preparedEnrollment, registerStagedStudent, reviewStagedStudent };
