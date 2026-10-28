/* Academic structure — the single source of truth for classes and subjects.
 *
 * Admin defines which classes exist and which subjects each class runs
 * (js/admin.js → Academic Setup). Every other module reads the structure from
 * here instead of keeping its own copy: teacher assignments, examinations,
 * routine, notices/notifications, courses and the student side.
 *
 * Safety rules the rest of the app relies on:
 *   • additive, idempotent migration — the first read after an update records
 *     what already exists (classes from js/config.js plus every class/subject
 *     pair seen in teacher assignments, exams and teaching records) and never
 *     rewrites or deletes a stored record;
 *   • deactivating a class/subject only stops it appearing in new pickers —
 *     historical exams, results, routine, assignments and courses stay;
 *   • no `localStorage.clear()`, no database reset, missing fields get
 *     defaults on read.
 *
 * The module is pure storage + logic (no DOM), so it can be tested directly.
 */
import { KEYS, readRaw, writeRaw } from './database.js';

export const ACADEMICS_KEY = KEYS.academics;
export const ACADEMICS_VERSION = 2;

/* The class list the app shipped with; the seed keeps the exact names, so old
   records that carry a class name keep matching after the update. */
const DEFAULT_CLASSES = Object.freeze([
  'অষ্টম শ্রেণি', 'নবম শ্রেণি', 'দশম শ্রেণি', 'একাদশ শ্রেণি', 'দ্বাদশ শ্রেণি',
  'ডিগ্রি ১ম বর্ষ', 'ডিগ্রি ২য় বর্ষ', 'ডিগ্রি ৩য় বর্ষ',
  'অনার্স ১ম বর্ষ', 'অনার্স ২য় বর্ষ', 'অনার্স ৩য় বর্ষ', 'অনার্স ৪র্থ বর্ষ'
]);

/* Subjects a class runs by default. These are only defaults: Admin turns any
   row off, and the mapping rows are editable in the Admin panel. */
const SUBJECT_LIBRARY = Object.freeze([
  'বাংলা', 'ইংরেজি', 'গণিত', 'বিজ্ঞান', 'আইসিটি',
  'পদার্থবিজ্ঞান', 'রসায়ন', 'জীববিজ্ঞান', 'উচ্চতর গণিত',
  'হিসাববিজ্ঞান', 'ব্যবস্থাপনা', 'ফিন্যান্স, ব্যাংকিং ও বীমা', 'অর্থনীতি',
  'পৌরনীতি ও সুশাসন', 'ইসলাম শিক্ষা', 'ভূগোল', 'মনোবিজ্ঞান', 'সমাজবিজ্ঞান'
]);
const SCIENCE_GRADES = ['নবম শ্রেণি', 'দশম শ্রেণি', 'একাদশ শ্রেণি', 'দ্বাদশ শ্রেণি'];
const HIGHER_GRADES = ['একাদশ শ্রেণি', 'দ্বাদশ শ্রেণি'];
const DEFAULT_SUBJECTS = Object.freeze({
  junior: ['বাংলা', 'ইংরেজি', 'গণিত', 'বিজ্ঞান', 'আইসিটি'],
  science: ['বাংলা', 'ইংরেজি', 'গণিত', 'পদার্থবিজ্ঞান', 'রসায়ন', 'জীববিজ্ঞান', 'উচ্চতর গণিত', 'আইসিটি'],
  higher: ['বাংলা', 'ইংরেজি', 'হিসাববিজ্ঞান', 'ব্যবস্থাপনা', 'ফিন্যান্স, ব্যাংকিং ও বীমা', 'অর্থনীতি', 'আইসিটি'],
  general: ['বাংলা', 'ইংরেজি', 'গণিত', 'আইসিটি']
});
/* ---- Subject Code and Class Code -------------------------------------------
   A code is the short, permanent name a paper carries: BN for বাংলা, MT for
   গণিত. It comes from this master list, is written once onto the subject
   record and is never editable afterwards — renaming a subject (বাংলা →
   বাংলা ১ম পত্র) leaves its code and every exam code that used it untouched.
   `EXAM_SUBJECT_CODES` is the school's own list; anything else falls back to a
   generated two-to-four letter code, allocated once and then frozen. */
export const EXAM_SUBJECT_CODES = Object.freeze({
  'বাংলা': 'BN', 'ইংরেজি': 'EN', 'গণিত': 'MT', 'বিজ্ঞান': 'SC', 'আইসিটি': 'ICT',
  'তথ্য ও যোগাযোগ প্রযুক্তি': 'ICT', 'পদার্থবিজ্ঞান': 'PH', 'রসায়ন': 'CH', 'জীববিজ্ঞান': 'BI',
  'উচ্চতর গণিত': 'HM', 'হিসাববিজ্ঞান': 'AC', 'ব্যবস্থাপনা': 'MG',
  'ফিন্যান্স, ব্যাংকিং ও বীমা': 'FI', 'অর্থনীতি': 'EC', 'পৌরনীতি ও সুশাসন': 'PS',
  'ইসলাম শিক্ষা': 'IS', 'ভূগোল': 'GE', 'মনোবিজ্ঞান': 'PY', 'সমাজবিজ্ঞান': 'SO'
});
/* Class number the paper code carries: অষ্টম → 08, দশম → 10. Degree and honours
   years keep their own numbers so no two classes share a code. */
export const EXAM_CLASS_CODES = Object.freeze({
  'অষ্টম শ্রেণি': '08', 'নবম শ্রেণি': '09', 'দশম শ্রেণি': '10',
  'একাদশ শ্রেণি': '11', 'দ্বাদশ শ্রেণি': '12',
  'ডিগ্রি ১ম বর্ষ': '21', 'ডিগ্রি ২য় বর্ষ': '22', 'ডিগ্রি ৩য় বর্ষ': '23',
  'অনার্স ১ম বর্ষ': '31', 'অনার্স ২য় বর্ষ': '32', 'অনার্স ৩য় বর্ষ': '33', 'অনার্স ৪র্থ বর্ষ': '34'
});

const latin = value => String(value || '').replace(/[^A-Za-z]/g, '').toUpperCase();
/** A stable 2–4 letter code that no other subject is using. */
function allocateSubjectCode(name, subjects = []) {
  const used = new Set(subjects.map(item => text(item.code).toUpperCase()).filter(Boolean));
  const known = EXAM_SUBJECT_CODES[text(name)];
  /* The school's master list wins only while its code is still free. Two
     subjects that share a map entry ('আইসিটি' and
     'তথ্য ও যোগাযোগ প্রযুক্তি' both map to ICT) must not be handed the same
     paper code (audit F5). */
  if (known && !used.has(known)) return known;
  const letters = latin(name);
  const candidates = [letters.slice(0, 2), letters.slice(0, 3), letters.slice(0, 4)].filter(value => value.length >= 2);
  for (const candidate of candidates) if (!used.has(candidate)) return candidate;
  /* No Latin letters left: keep the master code and number it, so the paper
     code still reads as the subject it belongs to. */
  if (known) {
    for (let index = 2; index <= 99; index += 1) {
      const candidate = known + index;
      if (!used.has(candidate)) return candidate;
    }
  }
  // A Bangla-only subject with no Latin letters gets S01, S02 … in order.
  for (let index = 1; index <= 99; index += 1) {
    const candidate = `S${String(index).padStart(2, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
  return `X${String(subjects.length + 1).padStart(2, '0')}`;
}
/** Same idea for a class: the school's list first, then the digits it carries. */
function allocateClassCode(name, classes = []) {
  const known = EXAM_CLASS_CODES[text(name)];
  if (known) return known;
  const used = new Set(classes.map(item => text(item.code)).filter(Boolean));
  const digits = String(name).replace(/[^0-9০-৯]/g, '').replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  const candidates = [digits.slice(0, 2), digits.slice(0, 1)].filter(value => value.length >= 1);
  for (const candidate of candidates) {
    const padded = candidate.padStart(2, '0');
    if (!used.has(padded)) return padded;
  }
  for (let index = 1; index <= 99; index += 1) {
    const candidate = String(index).padStart(2, '0');
    if (!used.has(candidate)) return candidate;
  }
  return '99';
}

/* Chapters live in the same master: class + subject → অধ্যায় ১, Chapter 2 …
   A question and an exam both point at a chapter id, and a chapter that is
   switched off keeps every question that already named it. */
export function chapterIdFor(className, subjectName, chapterName, existing = []) {
  const base = `CHAP-${slug(className)}-${slug(subjectName)}-${slug(chapterName)}`;
  let id = base, index = 2;
  while (existing.some(record => record.id === id)) id = `${base}-${index++}`;
  return id;
}

/* Other modules that already hold class/subject pairs; the seed adopts them so
   an existing assignment or exam can never point at a row that does not exist. */
const OBSERVED_SOURCES = Object.freeze([
  { key: 'activePlus.manager.teacherAssignments.v1', kind: 'assignment' },
  { key: KEYS.exams, kind: 'exam' },
  { key: KEYS.teaching, kind: 'activity' }
]);

const fail = message => { throw new Error(message); };
const text = (value, cap = 120) => String(value ?? '').normalize('NFC').trim().slice(0, cap);
export const keyOf = value => text(value).toLowerCase();
/* Bengali vowel signs and other combining marks are \p{M}, so they must stay
   in the slug or 'দশম শ্রেণি' would lose its matras and two different names
   could collide on one id. */
const slug = value => text(value)
  .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

export function classIdFor(name, existing = []) {
  const base = `CLASS-${slug(name) || 'CLASS'}`;
  let id = base, index = 2;
  while (existing.some(record => record.id === id)) id = `${base}-${index++}`;
  return id;
}
export function subjectIdFor(name, existing = []) {
  const base = `SUB-${slug(name) || 'SUBJECT'}`;
  let id = base, index = 2;
  while (existing.some(record => record.id === id)) id = `${base}-${index++}`;
  return id;
}
export function mappingIdFor(classId, subjectId, existing = []) {
  const base = `MAP-${classId.replace(/^CLASS-/, '')}-${subjectId.replace(/^SUB-/, '')}`;
  let id = base, index = 2;
  while (existing.some(record => record.id === id)) id = `${base}-${index++}`;
  return id;
}

const defaultSubjectsFor = className =>
  SCIENCE_GRADES.includes(className) ? DEFAULT_SUBJECTS.science
    : HIGHER_GRADES.includes(className) ? DEFAULT_SUBJECTS.higher
      : /ডিগ্রি|অনার্স/.test(className) ? [...DEFAULT_SUBJECTS.general, 'হিসাববিজ্ঞান', 'ব্যবস্থাপনা']
        : DEFAULT_SUBJECTS.junior;

function record(now, actor = 'ADMIN') {
  return { createdBy: actor, createdAt: now, updatedAt: now };
}

/** Everything an older copy of the app already has on this device. */
function observedPairs() {
  const pairs = [];
  for (const source of OBSERVED_SOURCES) {
    let rows = null;
    try { rows = JSON.parse(readRaw(source.key) ?? 'null'); } catch { rows = null; }
    if (source.kind === 'exam') rows = Array.isArray(rows?.exams) ? rows.exams : [];
    if (source.kind === 'activity') rows = Array.isArray(rows?.activities) ? rows.activities : [];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const className = text(row?.className);
      const subjects = source.kind === 'assignment'
        ? [row?.subject, ...(Array.isArray(row?.subjects) ? row.subjects : [])]
        : [row?.subject];
      for (const subject of subjects) {
        if (className && text(subject)) pairs.push({ className, subject: text(subject) });
      }
    }
  }
  return pairs;
}

function emptyDatabase(now, actor = 'ADMIN') {
  return { version: ACADEMICS_VERSION, classes: [], subjects: [], mappings: [], chapters: [], updatedAt: now, createdBy: actor };
}

/** Chapters another copy of the app already holds (course library, or a paper
    that named one). Adopted so no stored record points at a missing chapter. */
function observedChapters(db) {
  const rows = [];
  const push = (classId, subjectId, name, at) => {
    const clean = text(name, 120);
    if (!classId || !subjectId || !clean) return;
    rows.push({ classId, subjectId, name: clean, at: Number(at) || 0 });
  };
  for (const source of [
    { key: KEYS.courseContent, kind: 'course' },
    { key: KEYS.exams, kind: 'exam' }
  ]) {
    let parsed = null;
    try { parsed = JSON.parse(readRaw(source.key) ?? 'null'); } catch { parsed = null; }
    const list = source.kind === 'course' ? (Array.isArray(parsed?.records) ? parsed.records : [])
      : (Array.isArray(parsed?.exams) ? parsed.exams : []);
    for (const row of list) {
      if (source.kind === 'course') {
        if (text(row?.type) !== 'chapter') continue;
        push(text(row.classId), text(row.subjectId), row.title, Date.parse(row.createdAt || ''));
      } else {
        const classRecord = db.classes.find(item => keyOf(item.name) === keyOf(row?.className));
        const subjectRecord = db.subjects.find(item => keyOf(item.name) === keyOf(row?.subject));
        push(classRecord?.id, subjectRecord?.id, row?.chapterName || row?.chapter, row?.createdAt);
      }
    }
  }
  return rows;
}

/** Seed/repair pass: add anything missing, never touch what is stored. */
function migrate(database, now, actor = 'ADMIN') {
  const db = {
    version: ACADEMICS_VERSION,
    classes: Array.isArray(database?.classes) ? database.classes.filter(Boolean) : [],
    subjects: Array.isArray(database?.subjects) ? database.subjects.filter(Boolean) : [],
    mappings: Array.isArray(database?.mappings) ? database.mappings.filter(Boolean) : [],
    chapters: Array.isArray(database?.chapters) ? database.chapters.filter(Boolean) : [],
    /* The shipped class/subject list is seeded exactly once. A later rename or
       deactivation must never make the seed add its old name back. */
    seededDefaults: database?.seededDefaults === true,
    updatedAt: Number(database?.updatedAt) || now,
    createdBy: text(database?.createdBy) || actor
  };
  let changed = false;
  const firstSeed = !db.seededDefaults;
  if (firstSeed) {
    db.seededDefaults = true;
    changed = true;
  }
  const classNames = ['অষ্টম শ্রেণি', ...DEFAULT_CLASSES].filter((name, index, all) => all.indexOf(name) === index);
  if (firstSeed) {
    for (const name of classNames) {
      if (db.classes.some(item => keyOf(item.name) === keyOf(name))) continue;
      db.classes.push({ id: classIdFor(name, db.classes), name, active: true, order: db.classes.length, ...record(now, actor) });
      changed = true;
    }
  }
  /* Subjects adopted from existing records may be free text ("Test", a
     misspelling): they are added as real subjects so no stored record dangles. */
  const observed = observedPairs();
  const seededPairs = firstSeed ? classNames.flatMap(name => defaultSubjectsFor(text(name)).map(subject => ({ className: text(name), subject }))) : [];
  for (const { className, subject } of [...observed, ...seededPairs]) {
    if (SUBJECT_LIBRARY.includes(subject)) {
      if (!db.subjects.some(item => keyOf(item.name) === keyOf(subject))) {
        db.subjects.push({ id: subjectIdFor(subject, db.subjects), name: subject, active: true, ...record(now, actor) });
        changed = true;
      }
    } else if (!db.subjects.some(item => keyOf(item.name) === keyOf(subject))) {
      db.subjects.push({ id: subjectIdFor(subject, db.subjects), name: subject, active: true, ...record(now, actor) });
      changed = true;
    }
    const classRecord = db.classes.find(item => keyOf(item.name) === keyOf(className));
    const subjectRecord = db.subjects.find(item => keyOf(item.name) === keyOf(subject));
    if (!classRecord || !subjectRecord) continue;
    if (db.mappings.some(item => item.classId === classRecord.id && item.subjectId === subjectRecord.id)) continue;
    db.mappings.push({ id: mappingIdFor(classRecord.id, subjectRecord.id, db.mappings), classId: classRecord.id, subjectId: subjectRecord.id, active: true, ...record(now, actor) });
    changed = true;
  }
  /* Codes are written once and then never touched again: a renamed subject or
     class keeps the code its papers were published with. */
  for (const item of db.classes) {
    if (text(item.code)) continue;
    item.code = allocateClassCode(item.name, db.classes);
    item.codeLockedAt = item.codeLockedAt || now;
    changed = true;
  }
  for (const item of db.subjects) {
    if (text(item.code)) continue;
    item.code = allocateSubjectCode(item.name, db.subjects);
    item.codeLockedAt = item.codeLockedAt || now;
    changed = true;
  }
  for (const row of observedChapters(db)) {
    if (db.chapters.some(item => item.classId === row.classId && item.subjectId === row.subjectId && keyOf(item.name) === keyOf(row.name))) continue;
    db.chapters.push({
      id: chapterIdFor(db.classes.find(item => item.id === row.classId)?.name || '', db.subjects.find(item => item.id === row.subjectId)?.name || '', row.name, db.chapters),
      classId: row.classId, subjectId: row.subjectId, name: row.name,
      order: db.chapters.filter(item => item.classId === row.classId && item.subjectId === row.subjectId).length,
      active: true, ...record(row.at || now, actor)
    });
    changed = true;
  }
  return { db, changed };
}

function readDatabase() {
  let raw = null;
  try { raw = readRaw(ACADEMICS_KEY); } catch { fail('Academic setup পড়া যাচ্ছে না।'); }
  if (raw === null || raw === '') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') fail('Academic setup-এর সংরক্ষিত তথ্য সঠিক নয়।');
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Academic setup')) throw error;
    fail('Academic setup-এর সংরক্ষিত তথ্য সঠিক নয়।');
  }
}
function write(database) {
  writeRaw(ACADEMICS_KEY, JSON.stringify(database));
  window.dispatchEvent(new CustomEvent('apc-academics-updated', { detail: { at: database.updatedAt } }));
  return database;
}
/** The stored structure, migrated in place (idempotent) when it is out of date. */
export function loadAcademics() {
  const stored = readDatabase();
  if (!stored) {
    const now = Date.now();
    return write(migrate(emptyDatabase(now, 'SYSTEM'), now, 'SYSTEM').db);
  }
  const { db, changed } = migrate(stored, Date.now(), text(stored.createdBy) || 'SYSTEM');
  return changed ? write(db) : db;
}
export function watchAcademics(callback) {
  const handler = () => callback(loadAcademics());
  window.addEventListener('apc-academics-updated', handler);
  window.addEventListener('storage', event => { if (event.key === ACADEMICS_KEY || event.key === null) handler(); });
}

/* ---- reads ------------------------------------------------------------------ */

export function listClasses({ includeInactive = false } = {}) {
  return loadAcademics().classes
    .filter(item => includeInactive || item.active !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'bn'));
}
export function listSubjects({ includeInactive = false } = {}) {
  return loadAcademics().subjects
    .filter(item => includeInactive || item.active !== false)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'bn'));
}
export const classById = id => loadAcademics().classes.find(item => item.id === id) || null;
export const classByName = name => loadAcademics().classes.find(item => keyOf(item.name) === keyOf(name)) || null;
export const subjectById = id => loadAcademics().subjects.find(item => item.id === id) || null;
export const subjectByName = name => loadAcademics().subjects.find(item => keyOf(item.name) === keyOf(name)) || null;

/** Active mappings, newest configuration wins for a repeated pair. */
export function listMappings({ includeInactive = false } = {}) {
  const seen = new Set();
  return loadAcademics().mappings
    .filter(item => {
      if (!includeInactive && item.active === false) return false;
      if (seen.has(`${item.classId}|${item.subjectId}`)) return false;
      seen.add(`${item.classId}|${item.subjectId}`);
      return true;
    });
}
export function subjectsForClass(className, { includeInactive = false } = {}) {
  const classRecord = classByName(className);
  if (!classRecord) return [];
  const byId = new Map(listSubjects({ includeInactive }).map(item => [item.id, item]));
  return listMappings({ includeInactive })
    .filter(item => item.classId === classRecord.id)
    .map(item => byId.get(item.subjectId))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'bn'));
}
export function subjectNamesForClass(className, options) {
  return subjectsForClass(className, options).map(item => item.name);
}
export function isSubjectEnabled(className, subject) {
  if (!className || !subject) return false;
  return subjectsForClass(className).some(item => keyOf(item.name) === keyOf(subject));
}
export function classesForSubject(subject) {
  const subjectRecord = subjectByName(subject);
  if (!subjectRecord) return [];
  const byId = new Map(listClasses().map(item => [item.id, item]));
  return listMappings().filter(item => item.subjectId === subjectRecord.id).map(item => byId.get(item.classId)).filter(Boolean);
}
/** Class names as the rest of the app still stores them (plain names). */
export const classNames = ({ includeInactive = false } = {}) => listClasses({ includeInactive }).map(item => item.name);

/* ---- codes ------------------------------------------------------------------- */

/** The permanent code of a class (`10` for দশম শ্রেণি). '' when unknown. */
export function classCodeFor(className) {
  const db = loadAcademics();
  const item = className ? db.classes.find(entry => keyOf(entry.name) === keyOf(className)) : null;
  /* A record that never got its code frozen (older copies, hand-edited rows)
     falls back to an allocation — but against the WHOLE class list. Allocating
     against `[]` let two records share one code (audit F5/F11). */
  return text(item?.code) || (item ? allocateClassCode(item.name, db.classes) : '');
}
/** The permanent code of a subject (`MT` for গণিত). '' when unknown. */
export function subjectCodeFor(subjectName) {
  const db = loadAcademics();
  const item = subjectName ? db.subjects.find(entry => keyOf(entry.name) === keyOf(subjectName)) : null;
  return text(item?.code) || (item ? allocateSubjectCode(item.name, db.subjects) : '');
}
/** Both codes at once, for the paper-code builder. */
export function academicCodes(className, subjectName) {
  return { classCode: classCodeFor(className), subjectCode: subjectCodeFor(subjectName) };
}

/* ---- chapters ---------------------------------------------------------------- */

/** Chapters of one class+subject, in the order Admin arranged them. */
export function listChapters(className, subjectName, { includeInactive = false } = {}) {
  const classRecord = classByName(className);
  const subjectRecord = subjectByName(subjectName);
  if (!classRecord || !subjectRecord) return [];
  return loadAcademics().chapters
    .filter(item => item.classId === classRecord.id && item.subjectId === subjectRecord.id)
    .filter(item => includeInactive || item.active !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'bn'));
}
export const chapterById = id => loadAcademics().chapters.find(item => item.id === id) || null;
export function chapterByName(className, subjectName, chapterName) {
  const wanted = keyOf(chapterName);
  return listChapters(className, subjectName, { includeInactive: true }).find(item => keyOf(item.name) === wanted) || null;
}
/** Every chapter of one subject across all classes (the Question Bank filter). */
export function listChaptersForSubject(subjectName) {
  const subjectRecord = subjectByName(subjectName);
  if (!subjectRecord) return [];
  return loadAcademics().chapters
    .filter(item => item.subjectId === subjectRecord.id && item.active !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'bn'));
}

/* ---- writes (Admin) --------------------------------------------------------- */

async function requireAdmin() {
  try {
    const { hasStaffSession, readStaffAccount } = await import('./staff-auth.js');
    if (!(await hasStaffSession('admin'))) fail('শুধু অ্যাডমিন একাডেমিক স্ট্রাকচার বদলাতে পারবেন।');
    const account = await readStaffAccount('admin');
    if (!account || ['disabled', 'inactive', 'rejected'].includes(account.status)) fail('সক্রিয় অ্যাডমিন অ্যাকাউন্ট ছাড়া এই কাজ করা যাবে না।');
  } catch (error) {
    if (error instanceof Error && /Admin/.test(error.message)) throw error;
    fail('শুধু অ্যাডমিন একাডেমিক স্ট্রাকচার বদলাতে পারবেন।');
  }
}

function mutate(mutator, actor = 'ADMIN') {
  const db = loadAcademics();
  const now = Date.now();
  mutator(db, now);
  db.updatedAt = now;
  db.createdBy = actor;
  return write(db);
}

export async function saveClass({ id = '', name, active = true, order } = {}) {
  await requireAdmin();
  const clean = text(name, 80);
  if (!clean) fail('Class-এর নাম লিখুন।');
  return mutate((db, now) => {
    const existing = id ? db.classes.find(item => item.id === id) : null;
    if (id && !existing) fail('Class-টি পাওয়া যায়নি।');
    if (db.classes.some(item => item.id !== id && keyOf(item.name) === keyOf(clean))) fail('এই নামে একটি Class আগেই আছে।');
    if (existing) {
      existing.name = clean;
      existing.active = active !== false;
      if (Number.isFinite(Number(order))) existing.order = Number(order);
      existing.updatedAt = now;
    } else {
      db.classes.push({ id: classIdFor(clean, db.classes), name: clean, active: active !== false, order: Number.isFinite(Number(order)) ? Number(order) : db.classes.length, ...record(now) });
    }
  });
}
export async function setClassActive(id, active) {
  await requireAdmin();
  return mutate((db, now) => {
    const item = db.classes.find(record => record.id === id);
    if (!item) fail('Class-টি পাওয়া যায়নি।');
    item.active = active !== false;
    item.updatedAt = now;
    /* Deactivating a class hides it from new pickers; its subjects, mappings,
       exams, results and assignments are untouched. */
  });
}
export async function saveSubject({ id = '', name, active = true } = {}) {
  await requireAdmin();
  const clean = text(name, 80);
  if (!clean) fail('বিষয়ের নাম লিখুন।');
  return mutate((db, now) => {
    const existing = id ? db.subjects.find(item => item.id === id) : null;
    if (id && !existing) fail('বিষয়টি পাওয়া যায়নি।');
    if (db.subjects.some(item => item.id !== id && keyOf(item.name) === keyOf(clean))) fail('এই নামে একটি বিষয় আগেই আছে।');
    if (existing) {
      /* The name may change; the code never does (published exam codes are
         built from it). A code that somehow arrived empty is filled in once. */
      existing.name = clean;
      existing.active = active !== false;
      if (!text(existing.code)) { existing.code = allocateSubjectCode(clean, db.subjects); existing.codeLockedAt = now; }
      existing.updatedAt = now;
    } else {
      const code = allocateSubjectCode(clean, db.subjects);
      db.subjects.push({ id: subjectIdFor(clean, db.subjects), name: clean, code, codeLockedAt: now, active: active !== false, ...record(now) });
    }
  });
}

/**
 * Add one chapter to a class+subject (no duplicates for the same pair), or
 * rename an existing one when `id` is given. Nothing is ever deleted.
 */
export async function saveChapter({ id = '', className, subjectName, name, order, active = true } = {}) {
  await requireAdmin();
  const clean = text(name, 120);
  if (!clean) fail('অধ্যায়ের নাম লিখুন।');
  const classRecord = classByName(className);
  const subjectRecord = subjectByName(subjectName);
  if (!classRecord || !subjectRecord) fail('আগে ক্লাস ও বিষয় নির্বাচন করুন।');
  return mutate((db, now) => {
    const existing = id ? db.chapters.find(item => item.id === id) : null;
    if (id && !existing) fail('অধ্যায়টি পাওয়া যায়নি।');
    if (db.chapters.some(item => item.id !== id && item.classId === classRecord.id && item.subjectId === subjectRecord.id && keyOf(item.name) === keyOf(clean))) {
      fail('এই নামে একটি অধ্যায় আগেই আছে।');
    }
    if (existing) {
      existing.name = clean;
      existing.active = active !== false;
      if (Number.isFinite(Number(order))) existing.order = Number(order);
      existing.updatedAt = now;
    } else {
      db.chapters.push({
        id: chapterIdFor(classRecord.name, subjectRecord.name, clean, db.chapters),
        classId: classRecord.id, subjectId: subjectRecord.id, name: clean,
        order: Number.isFinite(Number(order)) ? Number(order)
          : db.chapters.filter(item => item.classId === classRecord.id && item.subjectId === subjectRecord.id).length,
        active: active !== false, ...record(now)
      });
    }
  });
}

export async function setChapterActive(id, active) {
  await requireAdmin();
  return mutate((db, now) => {
    const item = db.chapters.find(record => record.id === id);
    if (!item) fail('অধ্যায়টি পাওয়া যায়নি।');
    item.active = active !== false;
    item.updatedAt = now;
    /* Switching a chapter off only hides it from new pickers: questions and
       exams that already named it keep working. */
  });
}

/** Used by the paper builder: find or create the chapter a paper names. */
export async function ensureChapter(className, subjectName, chapterName) {
  const found = chapterByName(className, subjectName, chapterName);
  if (found) return found;
  await saveChapter({ className, subjectName, name: chapterName });
  return chapterByName(className, subjectName, chapterName);
}
export async function setSubjectActive(id, active) {
  await requireAdmin();
  return mutate((db, now) => {
    const item = db.subjects.find(record => record.id === id);
    if (!item) fail('বিষয়টি পাওয়া যায়নি।');
    item.active = active !== false;
    item.updatedAt = now;
  });
}
/** Turn one class+subject pair on/off. One pair, one row — no duplicates. */
export async function setClassSubject({ classId, subjectId, active = true } = {}) {
  await requireAdmin();
  if (!classId || !subjectId) fail('Class ও Subject নির্বাচন করুন।');
  return mutate((db, now) => {
    if (!db.classes.some(item => item.id === classId)) fail('Class-টি পাওয়া যায়নি।');
    if (!db.subjects.some(item => item.id === subjectId)) fail('বিষয়টি পাওয়া যায়নি।');
    const existing = db.mappings.find(item => item.classId === classId && item.subjectId === subjectId);
    if (existing) {
      existing.active = active !== false;
      existing.updatedAt = now;
      return;
    }
    db.mappings.push({ id: mappingIdFor(classId, subjectId, db.mappings), classId, subjectId, active: active !== false, ...record(now) });
  });
}
/** Attach/remove by name — the shape every other module already speaks. */
export async function setClassSubjectByName(className, subjectName, active = true) {
  const classRecord = classByName(className) || (await saveClass({ name: className }), classByName(className));
  const subjectRecord = subjectByName(subjectName) || (await saveSubject({ name: subjectName }), subjectByName(subjectName));
  return setClassSubject({ classId: classRecord.id, subjectId: subjectRecord.id, active });
}
