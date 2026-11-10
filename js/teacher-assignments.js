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
import { subjectsForClass, isSubjectEnabled, loadAcademics, classById } from './academics.js';
import { normalizeClassId, normalizeSectionId } from './class-key.js';

export const TEACHER_ASSIGNMENTS_KEY = 'activePlus.manager.teacherAssignments.v1';

/* A plaintext mirror of the Staff Directory's ASSIGNMENT rows — no passwords,
   no contacts, exactly the fields the teacherAssignments store already keeps
   in the clear. The directory itself lives behind an AES-GCM envelope, which
   the synchronous readers cannot open; every projection write and every async
   merged read refreshes this mirror, so the sync publish gates answer from the
   same rows the profile shows even when the main store is lagging or lost. */
export const DIRECTORY_ASSIGNMENT_MIRROR_KEY = 'activePlus.manager.teacherAssignments.dirMirror.v1';

function readMirrorRows(handle) {
  try {
    const raw = window.localStorage.getItem(DIRECTORY_ASSIGNMENT_MIRROR_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const rows = parsed?.byUser?.[handle];
    if (!Array.isArray(rows)) return [];
    return rows.filter(row => row && typeof row.className === 'string' && row.className.trim()
      && typeof row.teacherUsername === 'string' && row.teacherUsername.toLowerCase() === handle)
      .map(normalizeAssignment);
  } catch { return []; }
}

function writeMirrorRows(handle, rows) {
  const key = String(handle || '').trim().toLowerCase();
  if (!key) return;
  try {
    const raw = window.localStorage.getItem(DIRECTORY_ASSIGNMENT_MIRROR_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const byUser = parsed && typeof parsed === 'object' && parsed.byUser && typeof parsed.byUser === 'object'
      ? parsed.byUser : {};
    if (Array.isArray(rows) && rows.length) byUser[key] = rows;
    else delete byUser[key];
    window.localStorage.setItem(DIRECTORY_ASSIGNMENT_MIRROR_KEY, JSON.stringify({ v: 1, byUser }));
  } catch { /* best effort — the primary store stays authoritative */ }
}

function fail(message) { throw new Error(message); }
export const groupKey = value => normalizeSectionId(value);
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
  /* A class assignment is a class assignment even before its subjects are
     pinned down: a teacher can be given a class now and the subject mapping
     filled in later in Academic Setup. `length > 0` used to reject such a row
     outright - and one rejected row hid every other class of that teacher. */
  return Array.isArray(record.subjects) && record.subjects.length <= 30
    && record.subjects.every(subject => typeof subject === 'string' && subject.trim() && subject.length <= 80);
}

function readAssignments() {
  let raw;
  try { raw = window.localStorage.getItem(TEACHER_ASSIGNMENTS_KEY); }
  catch { fail('শিক্ষক অ্যাসাইনমেন্ট পড়া যাচ্ছে না।'); }
  if (raw === null) return [];
  let records;
  try { records = JSON.parse(raw); } catch { fail('শিক্ষক অ্যাসাইনমেন্টের সংরক্ষিত তথ্য সঠিক নয়।'); }
  /* Structural shape only. Whether the class still exists in the Academic
     Setup is a WRITE concern (saveTeacherAssignment) and a DISPLAY concern
     (selectableSubjects) — one renamed or retired class must not brick every
     teacher's assignment list (audit F4). */
  if (!Array.isArray(records) || records.some(record => !record || typeof record.id !== 'string' || typeof record.teacherUsername !== 'string' || typeof record.className !== 'string' || !record.className.trim() || typeof record.group !== 'string')) fail('শিক্ষক অ্যাসাইনমেন্টের সংরক্ষিত তথ্য সঠিক নয়।');
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
const activeAccount = account => Boolean(account)
  && !['disabled', 'inactive', 'rejected'].includes(account.status || '')
  && account.accountStatus !== 'disabled';

async function requireManagerSession() {
  if (!(await hasStaffSession('manager'))) fail('শুধু ম্যানেজার অ্যাসাইনমেন্ট পরিবর্তন করতে পারবেন।');
  const manager = await readStaffAccount('manager');
  if (activeAccount(manager)) return;
  /* Super Admin entry: the Admin's own session is the authority behind the
     Manager panel (js/manager.js boots the same way), so a device that never
     provisioned a Manager account must still be able to hand out classes —
     "Admin/Manager assignment takes effect immediately" is the contract. */
  if (await hasStaffSession('admin')) {
    const admin = await readStaffAccount('admin');
    if (activeAccount(admin)) return;
  }
  fail('সক্রিয় ম্যানেজার প্রোফাইল ছাড়া অ্যাসাইনমেন্ট পরিবর্তন করা যাবে না।');
}

/* ---------------------------------------------------------------------------
   One shared source for every assignment read
   ---------------------------------------------------------------------------

   The panel UI (profile, class pickers) answers from effectiveTeacherAssignments
   — the store MERGED with the Staff Directory record — while every publish gate
   (teaching/course/exam repositories) used to read the store alone. A record
   saved before the projection bridge existed, or a Super Admin browsing the
   Teacher panel without a teacher sign-in to re-project, then produced the
   reported split: the profile showed the classes and publishing answered
   "Manager assignment নেই". The readers below merge the directory projection
   in memory on every call, so profile, pickers and all gates answer from the
   same rows at the same moment — with no write on the read path. */

/** The directory record for this Login User ID, read synchronously (the same
 *  local envelope js/teaching-data.js already reads). No cloud, no async. */
function syncDirectoryRecordFor(username) {
  const handle = String(username || '').trim().toLowerCase();
  if (!handle) return null;
  try {
    const raw = window.localStorage.getItem('activePlus.staffDirectory.v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    return records.find(entry => entry?.kind !== 'system'
      && String(entry?.username || '').trim().toLowerCase() === handle) || null;
  } catch { return null; }
}

/** Merge base rows with incoming (projection) rows: same class/batch unions the
 *  subjects, a new class adds a row. Pure — never writes. */
function mergeAssignmentRows(base, incoming) {
  const merged = base.map(item => ({ ...item, subjects: [...item.subjects] }));
  for (const row of incoming) {
    const clash = merged.find(item =>
      item.teacherUsername.toLowerCase() === row.teacherUsername.toLowerCase()
      && item.className === row.className
      && groupKey(item.group) === groupKey(row.group));
    if (clash) {
      clash.subjects = [...new Set([...clash.subjects, ...row.subjects])];
      clash.subject = clash.subjects.join(', ');
    } else {
      merged.push({ ...row, subjects: [...row.subjects] });
    }
  }
  return merged;
}

export function listTeacherAssignments(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!normalized) return [];
  const stored = readAssignments().filter(item => item.teacherUsername.toLowerCase() === normalized);
  let projected = [];
  try {
    const record = syncDirectoryRecordFor(normalized);
    projected = record ? directoryAssignmentRows(record) : [];
  } catch { projected = []; }
  const mirrored = readMirrorRows(normalized);
  if (mirrored.length) projected = mergeAssignmentRows(projected, mirrored);
  if (!projected.length) return stored.map(item => ({ ...item, subjects: [...item.subjects] }));
  return mergeAssignmentRows(stored, projected);
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
  const cId = normalizeClassId(className);
  const groupValue = groupKey(group);
  return listTeacherAssignments(username).some(item => normalizeClassId(item) === cId && (!groupValue ? !groupKey(item.group) : !groupKey(item.group) || groupKey(item.group) === groupValue));
}
/** The teacher takes this exact subject in this class (the exam/routine gate). */
export function isTeacherAssignedSubject(username, className, subject, group = '') {
  const wanted = subjectKey(subject);
  if (!wanted) return true; // older callers that only know the class
  const cId = normalizeClassId(className);
  const groupValue = groupKey(group);
  return listTeacherAssignments(username).some(item =>
    normalizeClassId(item) === cId
    && (!groupValue ? !groupKey(item.group) : !groupKey(item.group) || groupKey(item.group) === groupValue)
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
 * Hand one Teacher the whole school: every class in the Admin's Academic Setup,
 * carrying every subject that class runs. It writes ordinary rows — one per
 * class, exactly like a hand-made assignment — so each of them stays editable
 * or removable in the Manager list afterwards. Classes with no enabled subject
 * are reported as skipped instead of silently creating empty rows.
 *
 * @returns {Promise<{assigned: string[], skipped: string[], failed: {className: string, message: string}[]}>}
 */
export async function assignEverything({ teacherUsername = '', classes } = {}) {
  await requireManagerSession();
  const wanted = [...new Set((Array.isArray(classes) ? classes : enabledClasses)
    .map(value => String(value ?? '').normalize('NFC').trim())
    .filter(Boolean))];
  const result = { assigned: [], skipped: [], failed: [] };
  for (const className of wanted) {
    const subjects = selectableSubjects(className);
    if (!subjects.length) { result.skipped.push(className); continue; }
    try {
      await saveTeacherAssignment({ className, group: '', subjects, teacherUsername });
      result.assigned.push(className);
    } catch (error) {
      result.failed.push({ className, message: String(error?.message || '') });
    }
  }
  return result;
}

/**
 * Save (or replace) one Teacher + Class + Batch assignment with any number of
 * subjects. `subject` (single string) is still accepted for older callers.
 */
export async function saveTeacherAssignment({ id = '', className, group = '', subject, subjects, teacherUsername } = {}) {
  await requireManagerSession();
  /* The Manager form picks WHO gets the work. A caller that passes no teacher
     keeps assigning to the built-in teacher.apc device account (legacy). */
  const handle = String(teacherUsername || '').trim().toLowerCase();
  let teacher;
  if (handle && handle !== 'teacher.apc') {
    const { findDirectoryStaffByUsername } = await import('./staff-directory.js');
    teacher = await findDirectoryStaffByUsername(handle);
    if (!teacher) fail('নির্বাচিত শিক্ষক পাওয়া যায়নি।');
  } else {
    teacher = await readStaffAccount('teacher');
  }
  if (!teacher || ['disabled', 'inactive', 'rejected'].includes(teacher.status) || teacher.accountStatus === 'disabled') fail('সক্রিয় Teacher account পাওয়া যায়নি।');
  const clean = { className: String(className || '').normalize('NFC').trim(), group: String(group || '').normalize('NFC').trim() };
  const wanted = [...new Set([...(Array.isArray(subjects) ? subjects : []), subject]
    .map(value => String(value ?? '').normalize('NFC').trim()).filter(Boolean))];
  /* A class is valid when the Admin's Academic Setup lists it or the shipped
     config lists it. It is never validated against the SUBJECT list — that
     made every Admin-created class impossible to assign (audit F1). */
  const knownClasses = new Set([...enabledClasses, ...loadAcademics().classes.map(item => item.name)]);
  if (!clean.className || !knownClasses.has(clean.className)) fail('শ্রেণি যাচাই করুন।');
  if (clean.group.length > 80) fail('Batch/Group যাচাই করুন।');
  if (!wanted.length) fail('অন্তত একটি বিষয় নির্বাচন করুন।');
  if (wanted.length > 30) fail('একটি assignment-এ সর্বোচ্চ ৩০টি বিষয় দেওয়া যাবে।');
  if (wanted.some(name => name.length > 80)) fail('বিষয়ের নাম যাচাই করুন।');
  const records = readAssignments();
  const normalizedUsername = String(teacher.username || '').trim().toLowerCase();
  const same = (a, b) => groupKey(a) === groupKey(b);
  /* The row this call writes: by id when the caller knows it, otherwise the
     one row this teacher+class+batch already has. Resolving it up front is what
     lets an existing row be edited instead of refused (audit F2). */
  const index = id
    ? records.findIndex(item => item.id === id && item.teacherUsername.toLowerCase() === normalizedUsername)
    : records.findIndex(item => item.teacherUsername.toLowerCase() === normalizedUsername && item.className === clean.className && same(item.group, clean.group));
  const target = index >= 0 ? records[index] : null;
  const prior = target ? target.subjects : [];
  for (const name of wanted) {
    /* New assignments follow the Admin structure. A subject the class no longer
       runs cannot be handed out again — but a subject ALREADY on this row stays
       writable, so disabling a subject in Admin Setup never freezes the row
       that carries it (audit F3). */
    if (prior.some(held => subjectKey(held) === subjectKey(name))) continue;
    if (!isSubjectEnabled(clean.className, name)) fail(`“${name}” বিষয়টি ${clean.className}-এর জন্য চালু নেই — Admin Academic Setup থেকে চালু করুন।`);
  }
  /* Wrong id and no row at all are different problems: say so. */
  if (id && index < 0) fail('অ্যাসাইনমেন্টটি পাওয়া যায়নি।');
  /* A save that does not name a row never rewrites one. The Manager form
     edits through an explicit row id, so this can only be an accidental
     double submit or a half-filled resubmit — refuse it and say what to do
     instead (audit F2). */
  if (!id && target) fail('এই Teacher, class/batch ও subject assignment আগে থেকেই আছে — বিষয় কমানো বা বদলানোর জন্য তালিকা থেকে সম্পাদনা ব্যবহার করুন।');
  const targetId = id;
  /* Overlap with another row is always a duplicate. Overlap with the row
     named by `id` is the edit itself, so that one row is exempt. */
  const duplicate = records.some(item => item.id !== targetId && item.teacherUsername.toLowerCase() === normalizedUsername && item.className === clean.className && same(item.group, clean.group) && item.subjects.some(name => wanted.some(wantedName => subjectKey(wantedName) === subjectKey(name))));
  if (duplicate) fail('এই Teacher, class/batch ও subject assignment আগে থেকেই আছে।');
  const next = { ...clean, subjects: wanted, subject: wanted.join(', '), id: targetId || newId('TAS'), teacherUsername: normalizedUsername, teacherName: String(teacher.fullName || teacher.username).trim() };
  if (index >= 0) records[index] = next; else records.unshift(next);
  return writeAssignments(records);
}
/** Add a subject to an existing Teacher + Class row (checkbox save). */
export async function addAssignmentSubject({ className, group = '', subject, teacherUsername } = {}) {
  const handle = String(teacherUsername || '').trim().toLowerCase() || String((await readStaffAccount('teacher'))?.username || '').trim().toLowerCase();
  const existing = listTeacherAssignments(handle).find(item => item.className === className && groupKey(item.group) === groupKey(group));
  return saveTeacherAssignment({ id: existing?.id || '', className, group, subjects: [...(existing?.subjects || []), subject], teacherUsername: existing?.teacherUsername || handle });
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
  return saveTeacherAssignment({ id: record.id, className: record.className, group: record.group, subjects: left, teacherUsername: record.teacherUsername });
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
  const clean = value => String(value ?? '').normalize('NFC').trim();
  const unique = list => [...new Set(list.filter(Boolean))];
  /* Admin, Manager and the local store have each written this assignment in
     their own shape over the years:
       - assignment.classSubjects : { 'অষ্টম শ্রেণি': ['গণিত', …], … }
       - assignment.classes       : a flat list of class NAMES
       - assignment.classIds      : a list of class IDS from the academic setup
     All three are read here, and a class id is resolved back to its name, so a
     teacher is never told "no class is assigned" because the record was written
     in a shape the reader happened not to know. */
  const resolveClass = value => {
    const raw = clean(value);
    if (!raw) return '';
    /* The Academic Setup is a separate store: an unreadable one must not turn a
       teacher's classes into "no class assigned". Fall back to the stored text. */
    try { return clean(classById(raw)?.name) || raw; }
    catch { return raw; }
  };
  const subjectsOf = value => unique((Array.isArray(value) ? value : [value]).map(clean));
  const rawMap = assignment.classSubjects && typeof assignment.classSubjects === 'object' && !Array.isArray(assignment.classSubjects)
    ? assignment.classSubjects
    : null;
  /* An EMPTY map is what a legacy record looks like after normalization
     (js/staff-directory.js writes `classSubjects: {}`), so it must not be read
     as "the Admin mapped nothing on purpose": only a map that actually names a
     class may suppress the flat subject list. */
  const perClass = rawMap && Object.keys(rawMap).length ? rawMap : null;
  const rowsByClass = new Map();
  for (const [className, subjects] of Object.entries(perClass || {})) {
    const name = resolveClass(className);
    const list = subjectsOf(subjects);
    if (name && (!rowsByClass.has(name) || list.length)) rowsByClass.set(name, list);
  }
  const flatSubjects = unique([
    ...subjectsOf(assignment.subjects),
    ...(Array.isArray(assignment.subjects) ? [] : [clean(assignment.subject)])
  ]);
  const listedClasses = unique([
    ...(Array.isArray(assignment.classes) ? assignment.classes : String(assignment.classes || '').split(',')),
    ...(Array.isArray(assignment.classIds) ? assignment.classIds : String(assignment.classIds || '').split(','))
  ].map(resolveClass));
  for (const name of listedClasses) {
    /* The per-class map wins where it exists; the flat subject list is applied
       only to classes the map does not describe (legacy records). */
    if (!rowsByClass.has(name)) rowsByClass.set(name, perClass ? [] : flatSubjects);
  }
  const rows = [...rowsByClass].map(([className, subjects]) => ({ className, group: '', subjects }));
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
  /* The mirror tracks the DIRECTORY side only: an empty list clears it, so a
     withdrawn assignment never survives through a stale cache. */
  writeMirrorRows(username, wanted);
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
  writeMirrorRows(handle, projected);
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
