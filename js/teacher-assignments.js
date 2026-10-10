/* Browser-local Teacher class/batch/subject assignments. These records are a
   scope source for the offline app, not server authorization; backend
   authorization is still required.

   One record per Teacher + Class + Batch, carrying every subject that teacher
   takes in that class:
     { id, teacherUsername, teacherName, className, group, subjects: [..] }
   Older records stored a single `subject` string. They keep working: the read
   normalises them into `subjects: [subject]` (the legacy `subject` field is
   left untouched on disk until the record is next saved), so no existing
   assignment is ever lost. */
import { enabledClasses } from './config.js';
import { readStaffAccount, hasStaffSession } from './staff-auth.js';
import { newId } from './database.js';
import { subjectsForClass, isSubjectEnabled, loadAcademics } from './academics.js';

export const TEACHER_ASSIGNMENTS_KEY = 'activePlus.manager.teacherAssignments.v1';

function fail(message) { throw new Error(message); }
export const groupKey = value => String(value || '').normalize('NFC').trim().replace(/\s*বিভাগ$/, '').trim();
const subjectKey = value => String(value || '').normalize('NFC').trim().toLowerCase();

/** One stored record, normalised: `subjects` is always the full list. */
export function normalizeAssignment(record = {}) {
  const stored = Array.isArray(record.subjects) ? record.subjects : [];
  /* The legacy `subject` string only counts when there is no subject list yet;
     after a save it is a readable mirror of the list ("গণিত, রসায়ন"), not
     another subject. */
  const source = stored.length ? stored : [record.subject];
  const subjects = [...new Set(source.map(value => String(value ?? '').normalize('NFC').trim()).filter(Boolean))];
  return { ...record, subjects };
}
function validSubjectList(record) {
  return Array.isArray(record.subjects) && record.subjects.length > 0 && record.subjects.length <= 30
    && record.subjects.every(subject => typeof subject === 'string' && subject.trim() && subject.length <= 80);
}

function readAssignments() {
  let raw;
  try { raw = window.localStorage.getItem(TEACHER_ASSIGNMENTS_KEY); }
  catch { fail('শিক্ষক অ্যাসাইনমেন্ট পড়া যাচ্ছে না।'); }
  if (raw === null) return [];
  let records;
  try { records = JSON.parse(raw); } catch { fail('শিক্ষক অ্যাসাইনমেন্টের সংরক্ষিত তথ্য সঠিক নয়।'); }
  if (!Array.isArray(records) || records.some(record => !record || typeof record.id !== 'string' || typeof record.teacherUsername !== 'string' || !enabledClasses.includes(record.className) && !loadAcademics().classes.some(item => item.name === record.className) || typeof record.group !== 'string')) fail('শিক্ষক অ্যাসাইনমেন্টের সংরক্ষিত তথ্য সঠিক নয়।');
  const normalized = records.map(normalizeAssignment);
  const ids = new Set();
  for (const record of normalized) {
    if (!record.id || ids.has(record.id) || !record.teacherUsername || !validSubjectList(record) || record.group.length > 80) fail('শিক্ষক অ্যাসাইনমেন্টের সংরক্ষিত তথ্য সঠিক নয়।');
    ids.add(record.id);
  }
  return normalized;
}
function writeAssignments(records) {
  try { window.localStorage.setItem(TEACHER_ASSIGNMENTS_KEY, JSON.stringify(records)); }
  catch { fail('অ্যাসাইনমেন্ট সংরক্ষণ হয়নি। ব্রাউজারের স্টোরেজ পরীক্ষা করুন।'); }
  window.dispatchEvent(new Event('teacher-assignments-updated'));
  return records;
}
async function requireManagerSession() {
  if (!(await hasStaffSession('manager'))) fail('শুধু Manager অ্যাসাইনমেন্ট পরিবর্তন করতে পারবেন।');
  const manager = await readStaffAccount('manager');
  if (!manager || ['disabled', 'inactive', 'rejected'].includes(manager.status) || manager.accountStatus === 'disabled') fail('সক্রিয় Manager profile ছাড়া assignment পরিবর্তন করা যাবে না।');
}

export function listTeacherAssignments(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!normalized) return [];
  return readAssignments().filter(item => item.teacherUsername.toLowerCase() === normalized).map(item => ({ ...item, subjects: [...item.subjects] }));
}
/** Every class this teacher takes, with the subjects of each class. */
export function teacherScope(username) {
  return listTeacherAssignments(username).map(item => ({
    id: item.id,
    className: item.className,
    group: item.group || '',
    subjects: [...item.subjects],
    teacherName: item.teacherName || ''
  }));
}
/** Classes assigned to the teacher (optionally narrowed by subject). */
export function assignedClasses(username, subject = '') {
  const wanted = subjectKey(subject);
  return [...new Set(listTeacherAssignments(username)
    .filter(item => !wanted || item.subjects.some(name => subjectKey(name) === wanted))
    .map(item => item.className))];
}
export function subjectsForTeacherClass(username, className) {
  return [...new Set(listTeacherAssignments(username)
    .filter(item => item.className === className)
    .flatMap(item => item.subjects))];
}
export function isTeacherAssigned(username, className, group = '') {
  const groupValue = groupKey(group);
  return listTeacherAssignments(username).some(item => item.className === className && (!groupValue ? !item.group : !item.group || groupKey(item.group) === groupValue));
}
/** The teacher takes this exact subject in this class (the exam/routine gate). */
export function isTeacherAssignedSubject(username, className, subject, group = '') {
  const wanted = subjectKey(subject);
  if (!wanted) return true; // older callers that only know the class
  const groupValue = groupKey(group);
  return listTeacherAssignments(username).some(item =>
    item.className === className
    && (!groupValue ? !item.group : !item.group || groupKey(item.group) === groupValue)
    && item.subjects.some(name => subjectKey(name) === wanted));
}

/** Subjects an Admin has enabled for the class — the only ones selectable. */
export function selectableSubjects(className, { includeLegacy = [] } = {}) {
  const enabled = subjectsForClass(className).map(item => item.name);
  const legacy = Array.isArray(includeLegacy)
    ? includeLegacy.filter(name => name && !enabled.some(item => subjectKey(item) === subjectKey(name)))
    : [];
  return [...enabled, ...legacy];
}

/**
 * Save (or replace) one Teacher + Class + Batch assignment with any number of
 * subjects. `subject` (single string) is still accepted for older callers.
 */
export async function saveTeacherAssignment({ id = '', className, group = '', subject, subjects } = {}) {
  await requireManagerSession();
  const teacher = await readStaffAccount('teacher');
  if (!teacher || ['disabled', 'inactive', 'rejected'].includes(teacher.status) || teacher.accountStatus === 'disabled') fail('সক্রিয় Teacher account পাওয়া যায়নি।');
  const clean = { className: String(className || '').normalize('NFC').trim(), group: String(group || '').normalize('NFC').trim() };
  const wanted = [...new Set([...(Array.isArray(subjects) ? subjects : []), subject]
    .map(value => String(value ?? '').normalize('NFC').trim()).filter(Boolean))];
  const known = new Set(loadAcademics().subjects.map(item => subjectKey(item.name)));
  if (!clean.className || !known.has(subjectKey(clean.className)) && !enabledClasses.includes(clean.className)) fail('শ্রেণি যাচাই করুন।');
  if (clean.group.length > 80) fail('Batch/Group যাচাই করুন।');
  if (!wanted.length) fail('অন্তত একটি বিষয় নির্বাচন করুন।');
  if (wanted.length > 30) fail('একটি assignment-এ সর্বোচ্চ ৩০টি বিষয় দেওয়া যাবে।');
  if (wanted.some(name => name.length > 80)) fail('বিষয়ের নাম যাচাই করুন।');
  for (const name of wanted) {
    /* New assignments follow the Admin structure. A subject the class no
       longer runs cannot be handed out again. */
    if (!isSubjectEnabled(clean.className, name)) fail(`“${name}” বিষয়টি ${clean.className}-এর জন্য চালু নেই — Admin Academic Setup থেকে চালু করুন।`);
  }
  const records = readAssignments();
  const normalizedUsername = String(teacher.username || '').trim().toLowerCase();
  const same = (a, b) => groupKey(a) === groupKey(b);
  const duplicate = records.some(item => item.id !== id && item.teacherUsername.toLowerCase() === normalizedUsername && item.className === clean.className && same(item.group, clean.group) && item.subjects.some(name => wanted.some(wantedName => subjectKey(wantedName) === subjectKey(name))));
  if (duplicate) fail('এই Teacher, class/batch ও subject assignment আগে থেকেই আছে।');
  const index = id ? records.findIndex(item => item.id === id && item.teacherUsername.toLowerCase() === normalizedUsername) : records.findIndex(item => item.teacherUsername.toLowerCase() === normalizedUsername && item.className === clean.className && same(item.group, clean.group));
  const next = { ...clean, subjects: wanted, subject: wanted.join(', '), id: id || (index >= 0 ? records[index].id : newId('TAS')), teacherUsername: normalizedUsername, teacherName: String(teacher.fullName || teacher.username).trim() };
  if (id && index < 0) fail('অ্যাসাইনমেন্টটি পাওয়া যায়নি।');
  if (index >= 0) records[index] = next; else records.unshift(next);
  return writeAssignments(records);
}
/** Add a subject to an existing Teacher + Class row (checkbox save). */
export async function addAssignmentSubject({ className, group = '', subject } = {}) {
  const existing = listTeacherAssignments((await readStaffAccount('teacher'))?.username).find(item => item.className === className && groupKey(item.group) === groupKey(group));
  return saveTeacherAssignment({ id: existing?.id || '', className, group, subjects: [...(existing?.subjects || []), subject] });
}
export async function deleteTeacherAssignment(id) {
  await requireManagerSession();
  const records = readAssignments();
  const next = records.filter(item => item.id !== String(id || ''));
  if (next.length === records.length) fail('অ্যাসাইনমেন্টটি পাওয়া যায়নি।');
  return writeAssignments(next);
}
/** Remove one subject from a row; the row itself is dropped when it empties. */
export async function deleteAssignmentSubject(id, subject) {
  const record = listTeacherAssignments((await readStaffAccount('teacher'))?.username).find(item => item.id === id)
    || readAssignments().find(item => item.id === id);
  if (!record) fail('অ্যাসাইনমেন্টটি পাওয়া যায়নি।');
  const left = record.subjects.filter(name => subjectKey(name) !== subjectKey(subject));
  if (left.length === record.subjects.length) fail('বিষয়টি এই assignment-এ নেই।');
  if (!left.length) return deleteTeacherAssignment(id);
  return saveTeacherAssignment({ id: record.id, className: record.className, group: record.group, subjects: left });
}
export function assignedScopeForStudent(username, student) {
  return isTeacherAssigned(username, student?.className, student?.group);
}

/* ---------------------------------------------------------------------------
   Staff Directory projection (Admin → Teacher panel bridge)
   ------------------------------------------------------------------------

   The Admin's Staff Management saves a teacher's academic assignment on the
   staff record (`assignment.classSubjects` / `assignment.classes` +
   `assignment.subjects`). The Teacher panel and every scope gate read THIS
   module's store. Before this bridge the two were disconnected: an Admin-made
   teacher logged in and saw nothing. `syncTeacherAssignmentFromDirectory`
   projects the directory record into the store (one row per class carrying
   that class's subjects), keyed by the record's own Login User ID — never by
   role assumption and never by name. The projection is deterministic: it is
   re-applied on teacher sign-in and after every Admin save, so the directory
   record stays the source of truth while the store stays the query/sync shape
   (js/realtime-sync.js mirrors `TEACHER_ASSIGNMENTS_KEY` to Firebase). */

/** Marker for rows owned by a directory projection (never by the Manager UI). */
export const DIRECTORY_ASSIGNMENT_SOURCE = 'directory';

/** Stable per-row id so re-projection updates in place instead of duplicating. */
export const projectedAssignmentId = (staffId, className) =>
  `DIR-${String(staffId || 'x')}-${String(className || '').normalize('NFC').trim()}`;

/**
 * Store rows for one Staff Directory record. `assignment.classSubjects`
 * (Class → [subjects]) is the precise shape; a legacy flat record
 * (`classes` + `subjects`) keeps working: every selected class carries the
 * same subject list. Rows with no subject at all are not projected.
 */
export function directoryAssignmentRows(record = {}) {
  const assignment = record?.assignment || {};
  const username = String(record?.username || '').trim().toLowerCase();
  if (!username) return [];
  const teacherName = String(record?.fullName || record?.username || '').trim();
  const staffId = String(record?.staffId || '');
  const rows = [];
  const classSubjects = assignment.classSubjects && typeof assignment.classSubjects === 'object' && !Array.isArray(assignment.classSubjects)
    ? assignment.classSubjects
    : null;
  if (classSubjects) {
    for (const [className, subjects] of Object.entries(classSubjects)) {
      const cleanClass = String(className || '').normalize('NFC').trim();
      const list = [...new Set((Array.isArray(subjects) ? subjects : [subjects])
        .map(value => String(value ?? '').normalize('NFC').trim()).filter(Boolean))];
      if (cleanClass && list.length) rows.push({ className: cleanClass, group: '', subjects: list });
    }
  }
  if (!rows.length) {
    const classes = (Array.isArray(assignment.classes) ? assignment.classes : [])
      .map(value => String(value || '').normalize('NFC').trim()).filter(Boolean);
    const flat = (Array.isArray(assignment.subjects) ? assignment.subjects : [])
      .map(value => String(value || '').normalize('NFC').trim()).filter(Boolean);
    if (classes.length && flat.length) {
      for (const className of classes) rows.push({ className, group: '', subjects: [...flat] });
    }
  }
  return rows.map(row => ({
    ...normalizeAssignment(row),
    id: projectedAssignmentId(staffId || username, row.className),
    teacherUsername: username,
    teacherName,
    source: DIRECTORY_ASSIGNMENT_SOURCE,
    staffId
  }));
}

/** True when a store row was produced by a directory projection. */
const isProjectedRow = (item, username = '') =>
  item?.source === DIRECTORY_ASSIGNMENT_SOURCE
  && (!username || item.teacherUsername.toLowerCase() === String(username).toLowerCase());

/**
 * Replace every projected row of this staff record with the current
 * assignment. Manager-authored rows for the same teacher are left untouched.
 * Returns the written rows (empty when the record carries no assignment).
 */
export function syncTeacherAssignmentFromDirectory(record = {}) {
  const username = String(record?.username || '').trim().toLowerCase();
  if (!username) return [];
  const wanted = directoryAssignmentRows(record);
  const records = readAssignments();
  const kept = records.filter(item => !isProjectedRow(item, username))
    .map(item => ({ ...item, subjects: [...item.subjects] }));
  /* A projected row must never collide with a Manager row about the same
     class/batch — the Manager row keeps its subjects and the projection adds
     only classes the Manager row does not already cover. */
  const merged = [...kept];
  for (const row of wanted) {
    const clash = merged.find(item =>
      item.teacherUsername.toLowerCase() === username
      && item.className === row.className
      && groupKey(item.group) === groupKey(row.group));
    if (clash) {
      clash.subjects = [...new Set([...clash.subjects, ...row.subjects])];
      clash.subject = clash.subjects.join(', ');
    } else {
      merged.unshift(row);
    }
  }
  /* Only a real change is written: a teacher panel re-projects on every reload,
     and an unconditional write would loop through the update event forever. */
  const fingerprint = list => JSON.stringify(
    [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map(item => ({ id: item.id, username: item.teacherUsername, className: item.className, group: item.group, subjects: [...item.subjects].sort() }))
  );
  if (fingerprint(records) !== fingerprint(merged)) writeAssignments(merged);
  return wanted;
}

/** Drop the projected rows of a deleted staff record. Manager rows survive. */
export function removeDirectoryAssignmentRows(username) {
  const handle = String(username || '').trim().toLowerCase();
  if (!handle) return [];
  const records = readAssignments();
  const next = records.filter(item => !isProjectedRow(item, handle));
  if (next.length !== records.length) writeAssignments(next);
  return next;
}

/**
 * Everything this teacher actually takes: the store (Manager-made rows plus
 * projections) with a last-moment directory fallback merged in — a record
 * saved before this bridge existed answers without any migration step.
 */
export async function effectiveTeacherAssignments(username) {
  const handle = String(username || '').trim().toLowerCase();
  const rows = listTeacherAssignments(handle);
  let projected = [];
  try {
    const { findDirectoryStaffByUsername } = await import('./staff-directory.js');
    const record = await findDirectoryStaffByUsername(handle);
    projected = directoryAssignmentRows(record || {});
  } catch { projected = []; }
  const merged = rows.map(item => ({ ...item, subjects: [...item.subjects] }));
  for (const row of projected) {
    const clash = merged.find(item =>
      item.className === row.className && groupKey(item.group) === groupKey(row.group));
    if (clash) {
      clash.subjects = [...new Set([...clash.subjects, ...row.subjects])];
      clash.subject = clash.subjects.join(', ');
    } else {
      merged.push({ ...row, subjects: [...row.subjects] });
    }
  }
  return merged;
}
