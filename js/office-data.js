/* Live office records: roster, notices and weekly routine.
   An empty browser starts empty. Sample arrays in admin-data.js stay available
   as fixtures for tests; they are not loaded here. */
import { loadAccount, saveAccount, saveStudent, readJSON, writeJSON } from './storage.js';
import { KEYS, listDocuments, listDocumentsStrict, replaceDocumentsStrict } from './database.js';
import { hasStaffSession, readStaffAccount } from './staff-auth.js';
import { listClasses } from './academics.js';
import { LOCAL_WRITE_KEY, markLocalSource } from './notification-rules.js';

export const ROSTER_KEY = KEYS.students;
export const NOTICES_KEY = KEYS.notices;
export const ROUTINE_KEY = KEYS.routine;
export const WEEK_DAYS = Object.freeze(['sat', 'sun', 'mon', 'tue', 'wed', 'thu']);

export function blankRoutine() {
  return Object.fromEntries(WEEK_DAYS.map(day => [day, { date: '', classes: [] }]));
}

function rosterStatus(accountStatus) {
  if (accountStatus === 'active' || accountStatus === 'approved') return 'approved';
  if (accountStatus === 'rejected') return 'rejected';
  return 'pending';
}

export function accountToRosterStudent(account) {
  const student = account?.student || {};
  const id = student.id || account?.studentId;
  if (!id) return null;
  return {
    id,
    name: student.name || student.nameBn || '',
    nameEn: student.nameEn || '',
    fatherName: student.fatherName || '',
    className: student.className || '',
    group: student.group || '',
    mobile: account.registrationMobile || account.mobile || student.studentMobile || '',
    guardianMobile: student.guardianMobile || '',
    address: student.address || '',
    status: rosterStatus(account.status),
    attendance: Number(student.attendance) || 0,
    average: Number(student.average) || 0,
    monthlyFee: student.monthlyFee ?? null,
    enrolledAt: account.createdAt ? new Date(account.createdAt).toLocaleDateString('bn-BD') : '',
    // Machine-readable application time (the notification list sorts by it).
    registeredAt: typeof account.createdAt === 'string' ? account.createdAt : '',
    lastActive: 'এই ডিভাইস'
  };
}

function mergeAccount(list) {
  const incoming = accountToRosterStudent(loadAccount());
  if (!incoming) return list;
  const index = list.findIndex(student => student.id === incoming.id);
  if (index < 0) return [...list, incoming];
  const current = list[index];
  return list.map((student, i) => (i === index ? {
    ...incoming,
    ...current,
    name: current.name || incoming.name,
    nameEn: current.nameEn || incoming.nameEn,
    mobile: current.mobile || incoming.mobile,
    className: current.className || incoming.className,
    status: current.status || incoming.status
  } : student));
}

export function loadRoster() {
  return mergeAccount(listDocuments('students'));
}

export function saveRoster(students) {
  return writeJSON(ROSTER_KEY, students);
}

/** Manager-only operational edits. Identifiers and approval state are copied
 * from the stored row, never accepted from the form. */
export async function updateStudentOperationalInfo(studentId, patch = {}) {
  if (!(await hasStaffSession('manager'))) throw Object.assign(new Error('শুধু Manager শিক্ষার্থীর operational তথ্য বদলাতে পারবেন।'), { code: 'ACCESS_DENIED' });
  const reviewer = await readStaffAccount('manager');
  if (!reviewer || ['disabled', 'inactive', 'rejected'].includes(reviewer.status) || reviewer.accountStatus === 'disabled') {
    throw Object.assign(new Error('সক্রিয় Manager profile ছাড়া এই কাজ করা যাবে না।'), { code: 'ACCESS_DENIED' });
  }
  const records = listDocumentsStrict('students', row => Boolean(row && typeof row.id === 'string' && row.id));
  const index = records.findIndex(row => row.id === String(studentId));
  if (index < 0) throw new Error('শিক্ষার্থী রেকর্ড পাওয়া যায়নি।');
  const current = records[index];
  const name = String(patch.name ?? current.name ?? '').trim();
  const mobile = String(patch.mobile ?? current.mobile ?? '').trim();
  const guardianMobile = String(patch.guardianMobile ?? current.guardianMobile ?? '').trim();
  const className = String(patch.className ?? current.className ?? '').trim();
  const group = String(patch.group ?? current.group ?? '').trim();
  const monthlyFee = Number(patch.monthlyFee ?? current.monthlyFee ?? 1500);
  if (!name || name.length > 100 || mobile.length > 32 || guardianMobile.length > 32 || group.length > 80) throw new Error('শিক্ষার্থীর নাম, মোবাইল বা batch/group তথ্য সঠিক নয়।');
  if (!listClasses().some(item => item.active !== false && item.name === className)) throw new Error('সঠিক সক্রিয় শ্রেণি নির্বাচন করুন।');
  if (!Number.isSafeInteger(monthlyFee) || monthlyFee < 0 || monthlyFee > 1000000) throw new Error('মাসিক ফি ০ থেকে ১০,০০,০০০ টাকার মধ্যে দিন।');
  const updated = {
    ...current, name, mobile, guardianMobile, className, group, monthlyFee,
    updatedAt: new Date().toISOString(), updatedBy: reviewer.username || 'manager'
  };
  records[index] = updated;
  replaceDocumentsStrict('students', records);
  return updated;
}

/** Make sure the device's student account is visible to the admin roster. */
export function upsertLocalAccount() {
  return saveRoster(loadRoster());
}

/**
 * Write this device's student into the shared roster row by row.
 *
 * `loadRoster()` prefers the *stored* row over the account, so it can never
 * carry a profile edit outward. This function is the opposite: the fields the
 * student owns (name, guardian, address, class/group, mobile numbers) are taken
 * from the account, while everything the branch owns — approval status,
 * attendance, average, monthly fee, enrolment date — stays exactly as it was.
 * The roster is one of the synced collections, so other devices receive the
 * change through the ordinary bridge.
 */
export function upsertStudentRosterRow() {
  const account = loadAccount();
  const fresh = accountToRosterStudent(account);
  if (!fresh) return false;
  const list = listDocuments('students');
  const index = list.findIndex(student => student.id === fresh.id);
  if (index < 0) return saveRoster([...list, fresh]);
  const stored = list[index];
  const row = {
    ...stored,
    name: fresh.name || stored.name,
    nameEn: fresh.nameEn || stored.nameEn,
    fatherName: fresh.fatherName || stored.fatherName,
    className: fresh.className || stored.className,
    group: fresh.group || stored.group,
    mobile: fresh.mobile || stored.mobile,
    guardianMobile: fresh.guardianMobile || stored.guardianMobile,
    address: fresh.address || stored.address,
    updatedAt: new Date().toISOString()
  };
  return saveRoster(list.map((student, i) => (i === index ? row : student)));
}

export async function syncAccountStatus(studentId, status) {
  const account = loadAccount();
  if (!account) return false;
  const id = account.student?.id || account.studentId;
  if (id !== studentId) return false;
  /* approved → active (the app's own word for a working account). Every other
     roster status keeps its name, so a rejected application and a deactivated
     student stay two different things on the device. */
  const mapped = status === 'approved' ? 'active' : String(status || 'pending');
  return saveAccount({ ...account, status: mapped });
}

/** Manager-only: mark a student active (English: approved) or inactive. The
    roster row is the record; the device account of that same student follows
    the roster exactly as it does for an approval, so the student app locks. */
export async function setStudentStatus(studentId, status) {
  if (!(await hasStaffSession('manager'))) throw Object.assign(new Error('শুধু Manager শিক্ষার্থীর অবস্থা বদলাতে পারবেন।'), { code: 'ACCESS_DENIED' });
  const reviewer = await readStaffAccount('manager');
  if (!reviewer || ['disabled', 'inactive', 'rejected'].includes(reviewer.status) || reviewer.accountStatus === 'disabled') {
    throw Object.assign(new Error('সক্রিয় Manager profile ছাড়া এই কাজ করা যাবে না।'), { code: 'ACCESS_DENIED' });
  }
  const wanted = status === 'inactive' ? 'inactive' : 'approved';
  const records = listDocumentsStrict('students', row => Boolean(row && typeof row.id === 'string' && row.id));
  const index = records.findIndex(row => row.id === String(studentId));
  if (index < 0) throw new Error('শিক্ষার্থী রেকর্ড পাওয়া যায়নি।');
  const current = records[index];
  if (current.status === 'pending') throw new Error('আগে নিবন্ধন অনুমোদন বা বাতিল করুন।');
  const updated = { ...current, status: wanted, updatedAt: new Date().toISOString(), updatedBy: reviewer.username || 'manager', statusChangedAt: new Date().toISOString() };
  records[index] = updated;
  replaceDocumentsStrict('students', records);
  await syncAccountStatus(studentId, wanted);
  return updated;
}

/** Adopt Manager-owned profile/class/fee changes from the synced roster row on
 * the student's own device. Student ID and credentials remain untouched. */
export async function syncStudentProfileFromRoster(studentId) {
  const account = loadAccount();
  if (!account) return false;
  const id = account.student?.id || account.studentId;
  if (id !== String(studentId || '') || !account.student) return false;
  const rows = listDocumentsStrict('students', row => Boolean(row && typeof row.id === 'string' && row.id));
  const row = rows.find(item => item.id === id);
  if (!row) return false;
  const current = account.student;
  const mappedStatus = row.status === 'approved' ? 'active' : row.status === 'rejected' ? 'rejected' : 'pending';
  const nextStudent = {
    ...current,
    name: row.name ?? current.name,
    nameBn: row.name ?? current.nameBn,
    fatherName: row.fatherName ?? current.fatherName,
    className: row.className ?? current.className,
    group: row.group ?? current.group,
    studentMobile: row.mobile ?? current.studentMobile,
    guardianMobile: row.guardianMobile ?? current.guardianMobile,
    monthlyFee: row.monthlyFee ?? current.monthlyFee
  };
  const nextAccount = {
    ...account,
    status: mappedStatus,
    ...(row.mobile ? { mobile: row.mobile, registrationMobile: row.mobile } : {}),
    student: nextStudent
  };
  const changed = mappedStatus !== account.status
    || nextStudent.name !== current.name || nextStudent.nameBn !== current.nameBn
    || nextStudent.fatherName !== current.fatherName || nextStudent.className !== current.className
    || nextStudent.group !== current.group || nextStudent.studentMobile !== current.studentMobile
    || nextStudent.guardianMobile !== current.guardianMobile || nextStudent.monthlyFee !== current.monthlyFee
    || (row.mobile && (account.mobile !== row.mobile || account.registrationMobile !== row.mobile));
  if (!changed) return false;
  if (!(await saveAccount(nextAccount))) return false;
  saveStudent(nextStudent);
  return loadAccount();
}

export function loadNotices() {
  return listDocuments('notices');
}

/* A notice written here is not pushed back to the person who typed it. The
   marker is local bookkeeping only and never syncs. */
function stampWrittenHere(notices) {
  try {
    let record = readJSON(LOCAL_WRITE_KEY, null);
    for (const notice of Array.isArray(notices) ? notices : []) {
      if (notice?.id) record = markLocalSource(record, 'notices', notice.id);
    }
    if (record) writeJSON(LOCAL_WRITE_KEY, record);
  } catch { /* best effort — a missing marker only means one extra notification */ }
}

export function saveNotices(notices) {
  const saved = writeJSON(NOTICES_KEY, notices);
  if (saved) stampWrittenHere(notices);
  return saved;
}

export function loadRoutine() {
  const stored = readJSON(ROUTINE_KEY, null);
  const routine = blankRoutine();
  if (!stored || typeof stored !== 'object') return routine;
  for (const day of WEEK_DAYS) {
    const info = stored[day];
    routine[day] = {
      date: typeof info?.date === 'string' ? info.date : '',
      classes: Array.isArray(info?.classes) ? info.classes.map(cls => ({ ...cls })) : []
    };
  }
  return routine;
}

export function saveRoutine(routine) {
  return writeJSON(ROUTINE_KEY, routine);
}
