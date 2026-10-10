import { LEGACY_CLOUD_ENABLED } from '../sync/cloud-access.js';
/* Staff Directory — the Admin-owned identity layer for every non-student user.

   Why this exists
   ---------------
   A Student has a **Student ID** and lives in the roster (js/office-data.js).
   Staff never do: a Staff ID belongs to the Admin Panel only and must never be
   mixed with a Student ID. This module owns that identity:

     • one unique, permanent, searchable **Staff ID** per staff member
       (`STF-0001`, `STF-0002`, …) — never reused, never editable, never
       derived from a student record
     • Manager / Teacher / Cash Counter / other authorised staff
     • create · view · edit · activate/deactivate · reset password · delete

   What it deliberately does NOT do
   --------------------------------
     • it does not create a new role — Admin → Manager → Teacher →
       Cash Counter → Student stays exactly as it is
     • it does not change the existing authentication flow. The four device
       role accounts (admin / manager / teacher / payment) keep signing in
       through js/staff-auth.js; their records are *mirrored* here as
       `kind: 'system'` entries so Admin can see and manage every staff
       identity in one place.
     • a Student can never appear here.

   Security
   --------
   Every mutation goes through `withAdmin()`: without an active Admin session
   the call fails. Hiding a button is presentation — this is the enforcement.
   Passwords are stored as PBKDF2 records (js/password-hash.js) inside an
   AES-GCM envelope when the platform allows it (js/secure-store.js);
   a plaintext password is never written anywhere.
*/

import { KEYS, readJSON, writeJSON } from './database.js';
import { hashPassword, isPasswordRecord, verifyPassword } from './password-hash.js';
import { generateLoginId, isAutoLoginId, normalizeLoginId } from './user-id.js';
import { encryptValue, decryptValue, isEncryptedEnvelope } from './secure-store.js';
import {
  STAFF_ACCOUNTS,
  STAFF_USERNAMES,
  flagStaffPasswordChange,
  normalizeStaffUsername,
  readStaffAccount,
  setStaffPassword,
  hasStaffSession
} from './staff-auth.js';
/* Teacher-class rows live in js/teacher-assignments.js (the shape the Teacher
   panel queries and js/realtime-sync.js mirrors to Firebase). A teacher's
   assignment saved here is projected into that store so the two can never
   drift apart again. No cycle: teacher-assignments.js never imports this file
   statically. */
import { syncTeacherAssignmentFromDirectory, removeDirectoryAssignmentRows } from './teacher-assignments.js';

/** Device-local storage key. Records live here as an encrypted envelope and
    are mirrored through the optional online bridge (js/realtime-sync.js) so
    the same Login User ID signs in on any device — hashes only, never a
    plaintext password. */
export const STAFF_DIRECTORY_KEY = 'activePlus.staffDirectory.v1';
/** When the last backup was taken (shown on Backup & Restore / Security). */
export const BACKUP_STAMP_KEY = 'activePlus.lastBackupAt.v1';

export const STAFF_ID_PREFIX = 'STF';

/* Roles Admin may manage. `systemRole` is the js/staff-auth.js role key this
   staff role signs in with; `other` has none — it is a directory-only role for
   future authorised staff. */
export const STAFF_ROLES = Object.freeze(['admin', 'manager', 'teacher', 'cash-counter', 'other']);

export const STAFF_ROLE_META = Object.freeze({
  admin: { label: 'Admin', labelBn: 'এডমিন', systemRole: 'admin', order: 1, protected: true },
  manager: { label: 'Manager', labelBn: 'ম্যানেজার', systemRole: 'manager', order: 2 },
  teacher: { label: 'Teacher', labelBn: 'শিক্ষক', systemRole: 'teacher', order: 3 },
  'cash-counter': { label: 'Cash Counter', labelBn: 'ক্যাশ কাউন্টার', systemRole: 'payment', order: 4 },
  other: { label: 'Other Staff', labelBn: 'অন্যান্য স্টাফ', systemRole: null, order: 5 }
});

/** Roles Admin may pick when creating a new staff account. The system owner
 *  role is reserved for the one Admin account this device already has. */
export const CREATABLE_STAFF_ROLES = Object.freeze(['manager', 'teacher', 'cash-counter', 'other']);

export const STAFF_STATUS = Object.freeze({
  active: { label: 'সক্রিয়', labelEn: 'Active', className: 'badge-approved' },
  inactive: { label: 'নিষ্ক্রিয়', labelEn: 'Inactive', className: 'badge-pending' },
  suspended: { label: 'স্থগিত', labelEn: 'Suspended', className: 'badge-rejected' }
});

export const STAFF_STATUS_KEYS = Object.freeze(Object.keys(STAFF_STATUS));

const USERNAME_PATTERN = /^[a-z][a-z0-9._]{3,19}$/;
const MOBILE_PATTERN = /^01[3-9]\d{8}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'root', 'support', 'system', 'null', 'undefined']);

/* -------------------------------------------------------------------------
   Storage — one encrypted envelope, same pattern as js/staff-auth.js
   ---------------------------------------------------------------------- */

async function readDirectory() {
  let raw;
  try {
    raw = readJSON(STAFF_DIRECTORY_KEY, null);
  } catch {
    return null;
  }
  if (raw === null || raw === undefined) return null;
  if (isEncryptedEnvelope(raw)) {
    const plaintext = await decryptValue(raw);
    if (!plaintext) return null;
    try {
      return JSON.parse(plaintext);
    } catch {
      return null;
    }
  }
  return raw && typeof raw === 'object' && Array.isArray(raw.records) ? raw : null;
}

async function writeDirectory(directory) {
  try {
    const envelope = await encryptValue(JSON.stringify(directory));
    return envelope
      ? writeJSON(STAFF_DIRECTORY_KEY, envelope)
      : writeJSON(STAFF_DIRECTORY_KEY, directory);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------
   Helpers
   ---------------------------------------------------------------------- */

function clean(value, max = 200) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeBdMobile(value) {
  let mobile = String(value ?? '')
    .replace(/[০-৯]/g, digit => '০১২৩৪৫৬৭৮৯'.indexOf(digit))
    .replace(/[\s()+-]/g, '');
  if (mobile.startsWith('+880')) mobile = `0${mobile.slice(4)}`;
  else if (mobile.startsWith('880')) mobile = `0${mobile.slice(3)}`;
  return mobile;
}

export function staffRoleLabel(role) {
  return STAFF_ROLE_META[role]?.labelBn || STAFF_ROLE_META[role]?.label || String(role || '—');
}

export function staffStatusLabel(status) {
  return STAFF_STATUS[status]?.label || String(status || '—');
}

export function formatStaffId(sequence) {
  return `${STAFF_ID_PREFIX}-${String(sequence).padStart(4, '0')}`;
}

function nextStaffId(records) {
  const highest = records.reduce((max, record) => {
    const digits = Number(String(record.staffId || '').replace(/\D/g, ''));
    return Number.isFinite(digits) && digits > max ? digits : max;
  }, 0);
  return formatStaffId(highest + 1);
}

function newRecordId() {
  const token = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`)
    .replace(/-/g, '');
  return `staff-${token}`;
}

function blankAssignment() {
  return { classes: [], subjects: [], batches: [], classSubjects: {}, counter: '', designation: '', notes: '' };
}

function normalizeAssignment(source = {}) {
  const list = value => (Array.isArray(value) ? value : String(value || '').split(','))
    .map(item => clean(item, 80))
    .filter(Boolean)
    .slice(0, 40);
  /* Per-class subject mapping — "Class 8 → গণিত, ইংরেজি; Class 9 → গণিত".
     This is what the Teacher panel projects from; the flat lists stay as a
     readable mirror so older records and cards keep working. */
  const classSubjects = {};
  const rawMap = source.classSubjects && typeof source.classSubjects === 'object' && !Array.isArray(source.classSubjects)
    ? source.classSubjects
    : {};
  for (const [className, subjects] of Object.entries(rawMap)) {
    const name = clean(className, 80);
    const names = (Array.isArray(subjects) ? subjects : String(subjects || '').split(','))
      .map(item => clean(item, 80))
      .filter(Boolean)
      .slice(0, 30);
    if (name && names.length) classSubjects[name] = names;
  }
  return {
    classes: list(source.classes),
    subjects: list(source.subjects),
    batches: list(source.batches),
    classSubjects,
    counter: clean(source.counter, 80),
    designation: clean(source.designation, 80),
    notes: clean(source.notes, 300)
  };
}

/* -------------------------------------------------------------------------
   The four device role accounts are mirrored into the directory once, so the
   whole staff list (system owner + operational roles + new staff) is visible
   and manageable from one place. Their Staff IDs are permanent.
   ---------------------------------------------------------------------- */

const SYSTEM_ROLE_ORDER = Object.freeze(['admin', 'manager', 'teacher', 'payment']);
const SYSTEM_ROLE_TO_STAFF_ROLE = Object.freeze({
  admin: 'admin',
  manager: 'manager',
  teacher: 'teacher',
  payment: 'cash-counter'
});

async function seedSystemRecords() {
  const records = [];
  let sequence = 0;
  for (const systemRole of SYSTEM_ROLE_ORDER) {
    const spec = STAFF_ACCOUNTS[systemRole];
    if (!spec) continue;
    sequence += 1;
    const account = await readStaffAccount(systemRole);
    const staffRole = SYSTEM_ROLE_TO_STAFF_ROLE[systemRole];
    records.push({
      id: `staff-system-${systemRole}`,
      staffId: formatStaffId(sequence),
      kind: 'system',
      role: staffRole,
      systemRole,
      fullName: clean(account?.fullName || (systemRole === 'admin' ? 'System Owner (Admin)' : `প্রাথমিক ${staffRole} অ্যাকাউন্ট`), 100),
      username: normalizeStaffUsername(account?.username || spec.username),
      mobile: clean(account?.mobile || ''),
      email: clean(account?.email || ''),
      address: clean(account?.address || ''),
      joiningDate: account?.createdAt ? String(account.createdAt).slice(0, 10) : '',
      status: account?.status === 'inactive' || account?.accountStatus === 'disabled' ? 'inactive' : 'active',
      assignment: blankAssignment(),
      /* The system owner can never be deleted or deactivated from here —
         an accidental lockout of the only Admin would strand the system. */
      protected: systemRole === 'admin',
      mustChangePassword: Boolean(account?.mustChangePassword) || Boolean(account?.bootstrapAccount),
      createdAt: account?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: []
    });
  }
  return records;
}

/** Read the directory, seeding the system role accounts on first use. */
export async function ensureDirectory() {
  const existing = await readDirectory();
  if (existing) return existing;
  const records = await seedSystemRecords();
  const directory = { version: 1, records, updatedAt: new Date().toISOString() };
  await writeDirectory(directory);
  return directory;
}

/* -------------------------------------------------------------------------
   Read model
   ---------------------------------------------------------------------- */

/** A copy with every secret removed — the only shape the UI may render. */
export function publicStaff(record) {
  const {
    password: _password,
    ...safe
  } = record || {};
  return {
    ...safe,
    assignment: normalizeAssignment(safe.assignment),
    hasPassword: Boolean(record?.password) || record?.kind === 'system',
    /* A system account keeps its credential in js/staff-auth.js, so the flag
       lives on that record; directory staff keep it here. */
    mustChangePassword: Boolean(record?.mustChangePassword)
  };
}

/**
 * Every staff member, newest Staff ID last. System accounts are refreshed from
 * their live role record (name, username, mobile, status) so the directory
 * never drifts from the account that actually signs in.
 */
export async function listStaff() {
  const directory = await ensureDirectory();
  const records = Array.isArray(directory.records) ? directory.records : [];
  const merged = [];
  for (const record of records) {
    if (record.kind !== 'system' || !record.systemRole) {
      merged.push(record);
      continue;
    }
    const account = await readStaffAccount(record.systemRole);
    merged.push({
      ...record,
      fullName: clean(account?.fullName || record.fullName, 100) || record.fullName,
      username: normalizeStaffUsername(account?.username || record.username),
      mobile: clean(account?.mobile || record.mobile),
      email: clean(account?.email || record.email),
      status: account?.status === 'inactive' || account?.accountStatus === 'disabled' ? 'inactive' : record.status === 'suspended' ? 'suspended' : 'active',
      mustChangePassword: Boolean(account?.mustChangePassword) || Boolean(account?.bootstrapAccount)
    });
  }
  return merged.sort((a, b) => String(a.staffId).localeCompare(String(b.staffId)));
}

export async function findStaff(staffId) {
  const staff = await listStaff();
  return staff.find(record => record.staffId === staffId) || null;
}

/* -------------------------------------------------------------------------
   Activity history — a deactivated account keeps its history, so the UI can
   refuse a delete that would break financial/academic/activity records.
   ---------------------------------------------------------------------- */

function readCollection(key, fallback) {
  try {
    const value = readJSON(key, null);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function countMatches(list, predicate) {
  return Array.isArray(list) ? list.filter(predicate).length : 0;
}

/**
 * Best-effort scan of every device collection that can reference a staff
 * member. Nothing is mutated — this is a read-only summary used to protect
 * history and to show an activity summary on the profile.
 */
export function staffActivitySummary(record) {
  const names = new Set([record?.fullName, record?.username].filter(Boolean).map(value => String(value).trim().toLocaleLowerCase()));
  const matches = value => names.has(String(value ?? '').trim().toLocaleLowerCase());
  if (!names.size) return { total: 0, routine: 0, transactions: 0, teaching: 0, exams: 0, hasHistory: false };

  const routine = readCollection(KEYS.routine, null) || {};
  const routineCount = Object.values(routine).reduce(
    (sum, day) => sum + countMatches(day?.classes, cls => matches(cls?.teacher)),
    0
  );
  const transactions = readCollection(KEYS.transactions, []) || [];
  const transactionCount = countMatches(transactions, tx => matches(tx?.collectedBy) || matches(tx?.reviewedBy));
  const teaching = readCollection(KEYS.teaching, null) || {};
  const teachingCount = countMatches(teaching.activities, activity => matches(activity?.teacherName));
  const exams = readCollection(KEYS.exams, null) || {};
  const examCount = countMatches(exams.exams, exam => matches(exam?.teacherName) || matches(exam?.createdBy));

  const total = routineCount + transactionCount + teachingCount + examCount;
  return {
    total,
    routine: routineCount,
    transactions: transactionCount,
    teaching: teachingCount,
    exams: examCount,
    hasHistory: total > 0
  };
}

/* -------------------------------------------------------------------------
   Admin-only enforcement — every mutation below goes through it
   ---------------------------------------------------------------------- */

const NOT_ADMIN = 'শুধুমাত্র Admin স্টাফ ম্যানেজমেন্ট ব্যবহার করতে পারবেন।';

async function adminActor() {
  if (!(await hasStaffSession('admin'))) return null;
  const account = await readStaffAccount('admin');
  if (!account) return null;
  if (account.role && account.role !== 'admin') return null;
  if (account.status === 'inactive' || account.accountStatus === 'disabled') return null;
  return account;
}

/** Wrap a mutation: nothing runs unless the signed-in account is the Admin. */
async function withAdmin(work) {
  const actor = await adminActor();
  if (!actor) return { ok: false, error: NOT_ADMIN, code: 'FORBIDDEN' };
  try {
    return await work(actor);
  } catch (error) {
    return { ok: false, error: error?.message || 'সংরক্ষণ করা যায়নি।', code: 'FAILED' };
  }
}

/** Guard for callers that only need to know whether CRUD is allowed. */
export async function canManageStaff() {
  return Boolean(await adminActor());
}

/* -------------------------------------------------------------------------
   Validation
   ---------------------------------------------------------------------- */

function usernameIndex() {
  return readJSON(KEYS.usernames, {}) || {};
}

function usernameOwner(username) {
  return usernameIndex()[username] || null;
}

/**
 * Every Login User ID already taken: the device registry, the four reserved
 * staff names and the ids of the records themselves. Compared case-insensitively
 * by the generator, so "Rasal.Teacher.apc" can never slip past "rasal.teacher.apc".
 */
function takenUsernames(records = [], except = '') {
  const skip = normalizeLoginId(except);
  const all = [
    ...Object.keys(usernameIndex()),
    ...STAFF_USERNAMES,
    ...(Array.isArray(records) ? records : []).map(record => record?.username).filter(Boolean)
  ];
  return [...new Set(all.map(normalizeLoginId))].filter(name => name && name !== skip);
}

/** The one rule for a Login User ID: First Name + Role + ".apc". */
export function buildStaffLoginId(fullName, role, records = [], except = '') {
  return generateLoginId({ fullName, role, taken: takenUsernames(records, except) });
}

export function validateStaffFields(fields, { records, existing = null, autoUsername = true } = {}) {
  const errors = {};
  const fullName = clean(fields.fullName, 100);
  if (fullName.length < 2) errors.fullName = 'পূর্ণ নাম লিখুন (কমপক্ষে ২ অক্ষর)।';

  /* A Login User ID is generated ("firstname.role.apc"), never typed, so the
     username field is not validated — it is produced after this check. */
  const username = autoUsername ? '' : normalizeStaffUsername(fields.username);
  if (!autoUsername) {
    if (!USERNAME_PATTERN.test(username)) {
      errors.username = 'ইউজারনেম ৪–২০ অক্ষর; ইংরেজি ছোট হাতের অক্ষর দিয়ে শুরু করুন (অক্ষর/সংখ্যা/ডট/আন্ডারস্কোর)।';
    } else if (RESERVED_USERNAMES.has(username) || STAFF_USERNAMES.includes(username)) {
      errors.username = 'এই ইউজারনেম সংরক্ষিত — অন্য একটি বেছে নিন।';
    } else if ((records || []).some(record => record.username === username && record.staffId !== existing?.staffId)) {
      errors.username = 'এই ইউজারনেম ইতিমধ্যে ব্যবহৃত — অন্য একটি বেছে নিন।';
    } else if (username !== existing?.username && usernameOwner(username)) {
      errors.username = 'এই ইউজারনেম অন্য অ্যাকাউন্টের — অন্য একটি বেছে নিন।';
    }
  }

  if (fields.mobile && !MOBILE_PATTERN.test(normalizeBdMobile(fields.mobile))) {
    errors.mobile = 'সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন (যেমন: ০১৭XXXXXXXX)।';
  }
  if (fields.email && !EMAIL_PATTERN.test(String(fields.email).trim())) {
    errors.email = 'সঠিক ইমেইল ঠিকানা দিন অথবা ফাঁকা রাখুন।';
  }

  const role = String(fields.role || '').trim();
  if (!STAFF_ROLES.includes(role)) errors.role = 'সঠিক Role নির্বাচন করুন।';
  else if (role === 'admin' && !existing) errors.role = 'Admin (System Owner) Role নতুন করে তৈরি করা যায় না।';

  const status = String(fields.status || 'active').trim();
  if (!STAFF_STATUS_KEYS.includes(status)) errors.status = 'সঠিক Status নির্বাচন করুন।';

  if (fields.joiningDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(fields.joiningDate))) {
    errors.joiningDate = 'সঠিক যোগদানের তারিখ দিন (YYYY-MM-DD)।';
  }

  return { errors, values: { fullName, username, role, status } };
}

function passwordProblem(nextPassword, confirmPassword) {
  const password = String(nextPassword ?? '');
  if (password.length < 6 || password.length > 32) return 'পাসওয়ার্ড ৬–৩২ অক্ষরের হতে হবে।';
  if (password !== String(confirmPassword ?? '')) return 'দুইবার লেখা পাসওয়ার্ড মিলছে না।';
  return '';
}

/* -------------------------------------------------------------------------
   CREATE
   ---------------------------------------------------------------------- */

/* A generated staff Login User ID is checked against the cloud registry as
   well, so an unsynced device cannot create a second account with an ID that
   already belongs to somebody else. Offline/failed lookup = unknown = allow. */
async function loginIdTakenInCloud(username) {
  if (!LEGACY_CLOUD_ENABLED) return null;
  if (!navigator.onLine) return false;
  const bounded = promise => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('lookup timed out')), 4000))
  ]);
  try {
    const bridge = await bounded(import('./realtime-sync.js'));
    return Boolean((await bounded(bridge.usernameTakenOnline(username)))?.taken);
  } catch (error) {
    console.warn('[Active Plus] cloud login-id check unavailable:', error.message);
    return false;
  }
}

export async function createStaff(fields = {}) {
  return withAdmin(async actor => {
    const directory = await ensureDirectory();
    const records = Array.isArray(directory.records) ? directory.records : [];
    const { errors, values } = validateStaffFields(fields, { records });
    const passwordIssue = passwordProblem(fields.password, fields.confirmPassword);
    if (passwordIssue) errors.password = passwordIssue;
    if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0], errors };

    const now = new Date().toISOString();
    /* Login User ID — always generated from the name and the role:
       "rasal.teacher.apc", "rasal2.teacher.apc", …  The internal Staff ID
       above stays separate and permanent. */
    const username = buildStaffLoginId(values.fullName, values.role, records);
    const record = {
      id: newRecordId(),
      staffId: nextStaffId(records),
      kind: 'directory',
      role: values.role,
      systemRole: null,
      fullName: values.fullName,
      username,
      mobile: fields.mobile ? normalizeBdMobile(fields.mobile) : '',
      email: clean(fields.email).toLowerCase(),
      address: clean(fields.address, 300),
      joiningDate: fields.joiningDate ? String(fields.joiningDate).slice(0, 10) : '',
      status: values.status,
      assignment: normalizeAssignment(fields.assignment),
      designation: clean(fields.designation, 80),
      protected: false,
      password: await hashPassword(String(fields.password)),
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
      history: [{ at: now, action: 'created', detail: `তৈরি করেছেন ${actor.username || 'admin'}` }]
    };

    // Claim the generated id first (same device registry the student flow uses),
    // then write the record; roll back if the write fails.
    const index = usernameIndex();
    if (index[record.username] && index[record.username] !== `staff:${record.role}`) {
      return { ok: false, error: 'এই ইউজারনেম ইতিমধ্যে ব্যবহৃত — অন্য একটি বেছে নিন।', errors: { username: 'এই ইউজারনেম ইতিমধ্যে ব্যবহৃত।' } };
    }
    if (await loginIdTakenInCloud(record.username)) {
      return { ok: false, error: 'এই ইউজারনেমটি অন্য একটি ডিভাইসে আগেই নেওয়া হয়েছে — অন্য একটি বেছে নিন।', errors: { username: 'এই ইউজারনেমটি অন্য ডিভাইসে ব্যবহৃত।' } };
    }
    const claimed = { ...index, [record.username]: `staff:${record.role}` };
    if (!writeJSON(KEYS.usernames, claimed)) {
      return { ok: false, error: 'ইউজারনেম সংরক্ষণ করা যায়নি — স্টোরেজ পরীক্ষা করুন।', code: 'STORAGE' };
    }
    const saved = await writeDirectory({
      version: 1,
      records: [...records, record],
      updatedAt: now
    });
    if (saved && record.role === 'teacher') {
      /* A teacher's classes/subjects are projected into the assignment store
         the Teacher panel queries (and js/realtime-sync.js mirrors to
         Firebase) — keyed by THIS record's Login User ID. A projection
         failure never voids a saved record: it is re-applied on the teacher's
         next sign-in. */
      try { syncTeacherAssignmentFromDirectory({ ...record }); }
      catch (error) { console.warn('[Active Plus] teacher assignment projection failed:', error?.message); }
    }
    if (!saved) {
      writeJSON(KEYS.usernames, index);
      return { ok: false, error: 'স্টাফ অ্যাকাউন্ট সংরক্ষণ করা যায়নি — স্টোরেজ পরীক্ষা করুন।', code: 'STORAGE' };
    }
    return { ok: true, staff: publicStaff(record) };
  });
}

/* -------------------------------------------------------------------------
   UPDATE — the Staff ID is permanent and can never be part of a patch
   ---------------------------------------------------------------------- */

const EDITABLE_FIELDS = Object.freeze([
  'fullName', 'username', 'mobile', 'email', 'address',
  'joiningDate', 'status', 'assignment', 'designation', 'role'
]);

export async function updateStaff(staffId, patch = {}) {
  return withAdmin(async actor => {
    const directory = await ensureDirectory();
    const records = Array.isArray(directory.records) ? directory.records : [];
    const index = records.findIndex(record => record.staffId === staffId);
    if (index < 0) return { ok: false, error: 'স্টাফ অ্যাকাউন্ট পাওয়া যায়নি।', code: 'NOT_FOUND' };
    const current = records[index];

    const requested = Object.fromEntries(
      Object.entries(patch).filter(([key]) => EDITABLE_FIELDS.includes(key))
    );
    // A staff ID is permanent identity: it is never accepted from a patch.
    delete requested.staffId;
    const next = { ...current, ...requested };

    const { errors, values } = validateStaffFields(next, { records, existing: current });
    if (current.protected) {
      // System Owner protection: the owner can never lose Admin access here.
      if (values.role && values.role !== current.role) errors.role = 'System Owner-এর Role বদল করা যায় না।';
      if (values.status && values.status !== 'active') errors.status = 'System Owner-কে নিষ্ক্রিয় করা যায় না।';
      if (values.username && values.username !== current.username) {
        errors.username = 'System Owner-এর ইউজারনেম বদল করা যায় না।';
      }
    }
    if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0], errors };

    /* Login User ID follows the name and the role it was generated from.
       A hand-made id, a protected owner id and a system role id are kept as
       they are, so nothing that already signs in is broken by an edit. */
    const identityChanged = values.fullName !== current.fullName || values.role !== current.role;
    const regenerable = current.kind !== 'system' && !current.protected && isAutoLoginId(current.username, current.role);
    const username = (identityChanged && regenerable)
      ? buildStaffLoginId(values.fullName, values.role, records, current.username)
      : current.username;

    let updated = {
      ...current,
      fullName: values.fullName,
      username,
      role: values.role,
      status: values.status,
      mobile: next.mobile ? normalizeBdMobile(next.mobile) : '',
      email: clean(next.email).toLowerCase(),
      address: clean(next.address, 300),
      joiningDate: next.joiningDate ? String(next.joiningDate).slice(0, 10) : '',
      assignment: normalizeAssignment(next.assignment),
      designation: clean(next.designation, 80),
      updatedAt: new Date().toISOString(),
      history: [
        ...(Array.isArray(current.history) ? current.history : []).slice(-24),
        { at: new Date().toISOString(), action: 'updated', detail: `হালনাগাদ করেছেন ${actor.username || 'admin'}` }
      ]
    };

    if (username !== current.username && current.kind === 'directory') {
      const registry = usernameIndex();
      if (registry[username] && registry[username] !== `staff:${current.role}`) {
        return { ok: false, error: 'এই ইউজারনেম ইতিমধ্যে ব্যবহৃত।', errors: { username: 'এই ইউজারনেম ইতিমধ্যে ব্যবহৃত।' } };
      }
      const registryNext = { ...registry };
      if (registryNext[current.username] === `staff:${current.role}`) delete registryNext[current.username];
      registryNext[username] = `staff:${updated.role}`;
      if (!writeJSON(KEYS.usernames, registryNext)) {
        return { ok: false, error: 'ইউজারনেম সংরক্ষণ করা যায়নি।', code: 'STORAGE' };
      }
    }

    const nextRecords = records.map((record, position) => (position === index ? updated : record));
    const wroteDirectory = await writeDirectory({ version: 1, records: nextRecords, updatedAt: new Date().toISOString() });
    if (wroteDirectory) try {
      const oldUsername = normalizeStaffUsername(current.username);
      const newUsername = normalizeStaffUsername(updated.username);
      if (oldUsername && oldUsername !== newUsername) removeDirectoryAssignmentRows(oldUsername);
      if (updated.role === 'teacher') syncTeacherAssignmentFromDirectory({ ...updated });
      else if (newUsername) removeDirectoryAssignmentRows(newUsername);
    } catch (projectionError) {
      console.warn('[Active Plus] teacher assignment projection failed:', projectionError?.message);
    }
    if (!wroteDirectory) {
      return { ok: false, error: 'স্টাফ তথ্য সংরক্ষণ করা যায়নি — স্টোরেজ পরীক্ষা করুন।', code: 'STORAGE' };
    }
    return { ok: true, staff: publicStaff(updated) };
  });
}

/* -------------------------------------------------------------------------
   STATUS — deactivated accounts keep every historical reference
   ---------------------------------------------------------------------- */

export async function setStaffStatus(staffId, status) {
  return withAdmin(async () => {
    if (!STAFF_STATUS_KEYS.includes(status)) return { ok: false, error: 'সঠিক Status নির্বাচন করুন।' };
    const directory = await ensureDirectory();
    const records = Array.isArray(directory.records) ? directory.records : [];
    const index = records.findIndex(record => record.staffId === staffId);
    if (index < 0) return { ok: false, error: 'স্টাফ অ্যাকাউন্ট পাওয়া যায়নি।', code: 'NOT_FOUND' };
    const current = records[index];
    if (current.protected && status !== 'active') {
      return { ok: false, error: 'System Owner-কে নিষ্ক্রিয় করা যায় না — অন্য Admin তৈরি করুন অথবা প্রোফাইল থেকে পাসওয়ার্ড বদল করুন।', code: 'PROTECTED' };
    }
    const now = new Date().toISOString();
    const updated = {
      ...current,
      status,
      updatedAt: now,
      history: [
        ...(Array.isArray(current.history) ? current.history : []).slice(-24),
        { at: now, action: 'status', detail: status === 'active' ? 'সক্রিয় করা হয়েছে' : status === 'suspended' ? 'স্থগিত করা হয়েছে' : 'নিষ্ক্রিয় করা হয়েছে' }
      ]
    };
    const nextRecords = records.map((record, position) => (position === index ? updated : record));
    if (!(await writeDirectory({ version: 1, records: nextRecords, updatedAt: now }))) {
      return { ok: false, error: 'স্ট্যাটাস সংরক্ষণ করা যায়নি — স্টোরেজ পরীক্ষা করুন।', code: 'STORAGE' };
    }
    return { ok: true, staff: publicStaff(updated) };
  });
}

/* -------------------------------------------------------------------------
   PASSWORD — Admin resets it; a plaintext password is never readable again
   ---------------------------------------------------------------------- */

export async function resetStaffPassword(staffId, nextPassword, confirmPassword) {
  return withAdmin(async () => {
    const problem = passwordProblem(nextPassword, confirmPassword);
    if (problem) return { ok: false, error: problem, errors: { password: problem } };
    const directory = await ensureDirectory();
    const records = Array.isArray(directory.records) ? directory.records : [];
    const index = records.findIndex(record => record.staffId === staffId);
    if (index < 0) return { ok: false, error: 'স্টাফ অ্যাকাউন্ট পাওয়া যায়নি।', code: 'NOT_FOUND' };
    const current = records[index];
    const now = new Date().toISOString();

    // 1 — the new credential. A role account keeps it in js/staff-auth.js;
    //     a directory staff member keeps the hash on their own record.
    let updated;
    if (current.kind === 'system' && current.systemRole) {
      const result = await setStaffPassword(current.systemRole, nextPassword, confirmPassword);
      if (!result.ok) return { ok: false, error: result.error, errors: { password: result.error } };
      await flagStaffPasswordChange(current.systemRole);
      updated = { ...current, mustChangePassword: true, updatedAt: now };
    } else {
      updated = {
        ...current,
        password: await hashPassword(String(nextPassword)),
        mustChangePassword: true,
        updatedAt: now
      };
    }

    // 2 — ONE write with the new credential and its audit trail together.
    //     Building this from `records` (the array read before the update) would
    //     put the previous hash straight back.
    const stored = records.map((record, position) => (
      position === index
        ? {
            ...updated,
            history: [
              ...(Array.isArray(current.history) ? current.history : []).slice(-24),
              { at: now, action: 'password', detail: 'Admin পাসওয়ার্ড রিসেট করেছেন' }
            ]
          }
        : record
    ));
    if (!(await writeDirectory({ version: 1, records: stored, updatedAt: now }))) {
      return { ok: false, error: 'পাসওয়ার্ড সংরক্ষণ করা যায়নি — স্টোরেজ পরীক্ষা করুন।', code: 'STORAGE' };
    }
    return { ok: true, mustChangePassword: true };
  });
}

/* -------------------------------------------------------------------------
   SIGN-IN — a directory staff member uses the Staff ID identity Admin made
   ----------------------------------------------------------------------
   The four device role accounts keep signing in through js/staff-auth.js.
   Every other staff member (created in Staff Management) signs in here: the
   username/password Admin gave them, gated by the account status. On success
   the caller saves a session for that role, so the existing panel entry flow
   is reused unchanged — no second session scheme, no new storage key.
   ------------------------------------------------------------------------- */

/** Read-only lookup used by the login form for its keyboard/hint syncing. */
export async function findDirectoryStaffByUsername(username) {
  const handle = normalizeStaffUsername(username);
  if (!handle) return null;
  const directory = await readDirectory();
  if (!directory) return null;
  const record = (Array.isArray(directory.records) ? directory.records : [])
    .find(entry => entry.kind !== 'system' && entry.username === handle);
  return record ? publicStaff(record) : null;
}

/**
 * Verify a directory staff member's credentials.
 * `{ ok:true, staff, role, mustChangePassword }` or a reason the UI can show:
 * `NO_CREDENTIALS` · `INACTIVE` · `WRONG_PASSWORD`.
 */
export async function authenticateDirectoryStaff(username, password) {
  const handle = normalizeStaffUsername(username);
  const directory = await readDirectory();
  if (!handle || !directory) return { ok: false, code: 'NO_CREDENTIALS' };
  const record = (Array.isArray(directory.records) ? directory.records : [])
    .find(entry => entry.kind !== 'system' && entry.username === handle);
  if (!record) return { ok: false, code: 'NO_CREDENTIALS' };
  // Deactivated or suspended staff keep every historical record — they simply
  // cannot sign in any more.
  if (record.status !== 'active') {
    return {
      ok: false,
      code: 'INACTIVE',
      error: 'এই স্টাফ অ্যাকাউন্টটি নিষ্ক্রিয় — Admin স্টাফ ম্যানেজমেন্ট থেকে সক্রিয় করতে পারবেন।'
    };
  }
  if (!isPasswordRecord(record.password)) return { ok: false, code: 'NO_CREDENTIALS' };
  if (!(await verifyPassword(String(password ?? ''), record.password))) {
    return { ok: false, code: 'WRONG_PASSWORD' };
  }
  return {
    ok: true,
    staff: publicStaff(record),
    role: STAFF_ROLE_META[record.role]?.systemRole || null,
    mustChangePassword: Boolean(record.mustChangePassword)
  };
}

/**
 * The staff member replaces their own temporary password after signing in.
 * The current password is required as proof; no Admin session is involved.
 */
export async function changeDirectoryStaffPassword(staffId, currentPassword, nextPassword, confirmPassword) {
  const directory = await readDirectory();
  if (!directory) return { ok: false, error: 'স্টাফ অ্যাকাউন্ট পাওয়া যায়নি।', code: 'NOT_FOUND' };
  const records = Array.isArray(directory.records) ? directory.records : [];
  const index = records.findIndex(record => record.staffId === staffId && record.kind !== 'system');
  if (index < 0) return { ok: false, error: 'স্টাফ অ্যাকাউন্ট পাওয়া যায়নি।', code: 'NOT_FOUND' };
  const current = records[index];
  if (current.status !== 'active') {
    return { ok: false, error: 'এই স্টাফ অ্যাকাউন্টটি নিষ্ক্রিয়।', code: 'INACTIVE' };
  }
  if (!isPasswordRecord(current.password) || !(await verifyPassword(String(currentPassword ?? ''), current.password))) {
    return { ok: false, error: 'বর্তমান পাসওয়ার্ড সঠিক নয়।', errors: { currentPassword: 'বর্তমান পাসওয়ার্ড সঠিক নয়।' } };
  }
  const problem = passwordProblem(nextPassword, confirmPassword);
  if (problem) return { ok: false, error: problem, errors: { password: problem } };

  const now = new Date().toISOString();
  const updated = {
    ...current,
    password: await hashPassword(String(nextPassword)),
    mustChangePassword: false,
    updatedAt: now,
    history: [
      ...(Array.isArray(current.history) ? current.history : []).slice(-24),
      { at: now, action: 'password', detail: 'নিজে পাসওয়ার্ড বদল করেছেন' }
    ]
  };
  const nextRecords = records.map((record, position) => (position === index ? updated : record));
  if (!(await writeDirectory({ version: 1, records: nextRecords, updatedAt: now }))) {
    return { ok: false, error: 'পাসওয়ার্ড সংরক্ষণ করা যায়নি — স্টোরেজ পরীক্ষা করুন।', code: 'STORAGE' };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------
   DELETE — history first: an account with records is deactivated instead
   ---------------------------------------------------------------------- */

export async function deleteStaff(staffId) {
  return withAdmin(async () => {
    const directory = await ensureDirectory();
    const records = Array.isArray(directory.records) ? directory.records : [];
    const index = records.findIndex(record => record.staffId === staffId);
    if (index < 0) return { ok: false, error: 'স্টাফ অ্যাকাউন্ট পাওয়া যায়নি।', code: 'NOT_FOUND' };
    const current = records[index];

    if (current.protected) {
      return {
        ok: false,
        code: 'PROTECTED',
        error: 'System Owner অ্যাকাউন্ট মুছে ফেলা যায় না — এটি ডিভাইসের সর্বোচ্চ Admin পরিচয়।',
        suggestion: 'deactivate'
      };
    }
    if (current.kind === 'system') {
      return {
        ok: false,
        code: 'PROTECTED',
        error: 'এটি একটি সিস্টেম Role অ্যাকাউন্ট — মুছে ফেলার বদলে নিষ্ক্রিয় করুন, তাহলে লগইন বন্ধ থাকবে কিন্তু ইতিহাস অক্ষত থাকবে।',
        suggestion: 'deactivate'
      };
    }
    const activity = staffActivitySummary(current);
    if (activity.hasHistory) {
      return {
        ok: false,
        code: 'HISTORY',
        error: `এই স্টাফের সঙ্গে ${activity.total} টি রেকর্ড (লেনদেন/উপস্থিতি/পরীক্ষা/নোটিশ) যুক্ত। ইতিহাস নষ্ট না করতে অ্যাকাউন্টটি নিষ্ক্রিয় করুন।`,
        suggestion: 'deactivate',
        activity
      };
    }

    const nextRecords = records.filter(record => record.staffId !== staffId);
    if (!(await writeDirectory({ version: 1, records: nextRecords, updatedAt: new Date().toISOString() }))) {
      return { ok: false, error: 'অ্যাকাউন্ট মুছে ফেলা যায়নি — স্টোরেজ পরীক্ষা করুন।', code: 'STORAGE' };
    }
    const registry = usernameIndex();
    if (registry[current.username] === `staff:${current.role}`) {
      const released = { ...registry };
      delete released[current.username];
      writeJSON(KEYS.usernames, released);
    }
    try { removeDirectoryAssignmentRows(current.username); }
    catch (projectionError) { console.warn('[Active Plus] teacher assignment cleanup failed:', projectionError?.message); }
    return { ok: true, staffId };
  });
}

/* -------------------------------------------------------------------------
   Reports — Staff Management feeds the Admin Report Center
   ---------------------------------------------------------------------- */

export function staffReportRows(staff, { role = 'all', status = 'all', query = '' } = {}) {
  const text = normalizeStaffUsername(query).replace(/[\s-]/g, '');
  return staff
    .filter(record => (role === 'all' ? true : record.role === role))
    .filter(record => (status === 'all' ? true : record.status === status))
    .filter(record => {
      if (!text) return true;
      const haystack = [
        record.staffId,
        record.fullName,
        record.username,
        record.mobile,
        normalizeBdMobile(record.mobile)
      ]
        .map(value => normalizeStaffUsername(value).replace(/[\s-]/g, ''))
        .filter(Boolean);
      return haystack.some(value => value.includes(text));
    })
    .map(record => ({
      staffId: record.staffId,
      name: record.fullName,
      role: record.role,
      roleLabel: staffRoleLabel(record.role),
      username: record.username,
      mobile: record.mobile,
      status: record.status,
      statusLabel: staffStatusLabel(record.status),
      joiningDate: record.joiningDate || '',
      assignment: [
        ...(record.assignment?.classes || []),
        ...(record.assignment?.subjects || []),
        ...(record.assignment?.batches || []),
        record.assignment?.counter,
        record.assignment?.designation
      ].filter(Boolean).join(' • ')
    }));
}

/** Role-wise counts used by the dashboard, the security view and reports. */
export function staffCounts(staff) {
  const byRole = {};
  for (const role of STAFF_ROLES) byRole[role] = 0;
  let active = 0;
  let inactive = 0;
  let suspended = 0;
  let passwordDue = 0;
  for (const record of staff) {
    byRole[record.role] = (byRole[record.role] || 0) + 1;
    if (record.status === 'active') active += 1;
    else if (record.status === 'suspended') suspended += 1;
    else inactive += 1;
    if (record.mustChangePassword) passwordDue += 1;
  }
  return { total: staff.length, active, inactive, suspended, passwordDue, byRole };
}

export const STAFF_DIRECTORY_RULES = Object.freeze({
  passwordMin: 6,
  passwordMax: 32,
  idPrefix: STAFF_ID_PREFIX,
  /* Present so no other module needs to re-derive it: a student identity and
     a staff identity never share a namespace. */
  studentIdNote: 'Student ID (রোস্টার) ও Staff ID (স্টাফ ডিরেক্টরি) সম্পূর্ণ আলাদা — কখনো মেশানো যাবে না।'
});

export { isPasswordRecord, normalizeStaffUsername };
