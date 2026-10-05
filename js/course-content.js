/* The learning library: one collection for chapters and their content.

   Shape (the school's fields, plus the two that make a course findable):

     { id: 'CONTENT-0001', classId, subjectId, chapterId, title, type,
       description, content, attachmentUrl, thumbnail,
       createdBy, createdAt, updatedAt, published, active }

   A chapter is the same record with `type: 'chapter'`: a chapter has no
   content of its own, it groups the lessons/notes/questions below it. That
   keeps one id series (CONTENT-0001) and one storage key for the whole library,
   and every piece of content points at its chapter with `chapterId`.

   Class and subject are ids from js/academics.js (the single source of truth),
   so a subject an Admin switches off is not offered here either — but content
   that already exists keeps its classId/subjectId and stays readable: nothing
   is ever deleted.

   Published is what a student may see. Unpublished content stays a draft for
   the teacher who wrote it and the Manager, exactly like exam drafts. */

import { KEYS, readRaw, writeRaw, listDocuments } from './database.js';
import { hasStaffSession, readStaffAccount } from './staff-auth.js';
import { classById, listClasses, subjectsForClass } from './academics.js';
import { isTeacherAssignedSubject } from './teacher-assignments.js';

export const COURSE_CONTENT_KEY = KEYS.courseContent;
export const COURSE_VERSION = 1;
export const MAX_CONTENT = 4000;

/** Every kind of content the library can hold. `section` groups the tabs a
    student sees, `exam`/`result` reuse the existing Examination and Result
    modules instead of a second exam system. */
export const COURSE_TYPES = Object.freeze({
  chapter: { label: 'চ্যাপ্টার', section: 'read', icon: 'book' },
  lesson: { label: 'পাঠ', section: 'read', icon: 'book' },
  note: { label: 'নোট', section: 'notes', icon: 'edit' },
  suggestion: { label: 'সাজেশন', section: 'suggestion', icon: 'chat' },
  important_question: { label: 'গুরুত্বপূর্ণ প্রশ্ন', section: 'important', icon: 'info' },
  mcq: { label: 'MCQ', section: 'mcq', icon: 'mcq' },
  assignment: { label: 'অ্যাসাইনমেন্ট', section: 'questions', icon: 'assignment' },
  model_test: { label: 'মডেল টেস্ট', section: 'model-test', icon: 'exam' },
  previous_question: { label: 'পূর্বের প্রশ্ন', section: 'previous', icon: 'exam' },
  exam: { label: 'পরীক্ষা', section: 'exam', icon: 'exam' },
  video: { label: 'ভিডিও', section: 'read', icon: 'play' },
  pdf: { label: 'PDF', section: 'read', icon: 'download' }
});

/** The tabs a student sees, in order. */
export const COURSE_SECTIONS = Object.freeze([
  { key: 'read', label: 'পড়ুন' },
  { key: 'notes', label: 'নোট' },
  { key: 'important', label: 'গুরুত্বপূর্ণ' },
  { key: 'suggestion', label: 'সাজেশন' },
  { key: 'questions', label: 'প্রশ্ন' },
  { key: 'mcq', label: 'MCQ' },
  { key: 'previous', label: 'পূর্বের প্রশ্ন' },
  { key: 'model-test', label: 'মডেল টেস্ট' },
  { key: 'exam', label: 'পরীক্ষা' },
  { key: 'results', label: 'আমার ফলাফল' }
]);

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value.trim() : '');
const keyOf = value => text(value).normalize('NFC').toLocaleLowerCase();
const groupKey = value => text(value).normalize('NFC').replace(/\s*বিভাগ$/, '').trim().toLocaleLowerCase();
const pad = (value, size) => String(value).padStart(size, '0');

const asArray = value => (Array.isArray(value) ? value : []);

/** `{ version, records: [] }`, parsed from the raw store. */
function loadCourseContent() {
  const raw = readRaw(COURSE_CONTENT_KEY);
  if (typeof raw !== 'string' || !raw) return { version: COURSE_VERSION, records: [] };
  try {
    const saved = JSON.parse(raw);
    if (!isObject(saved) || !Array.isArray(saved.records)) return { version: COURSE_VERSION, records: [] };
    return { version: COURSE_VERSION, records: saved.records.filter(isObject) };
  } catch { return { version: COURSE_VERSION, records: [] }; }
}

function saveCourseContent(records) {
  writeRaw(COURSE_CONTENT_KEY, JSON.stringify({ version: COURSE_VERSION, updatedAt: new Date().toISOString(), records: asArray(records) }));
  return true;
}

/** The next `CONTENT-0001`-style id. */
export function nextContentId(records = []) {
  let highest = 0;
  for (const record of asArray(records)) {
    const match = /^CONTENT-(\d+)$/.exec(text(record?.id));
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `CONTENT-${pad(highest + 1, 4)}`;
}

export function typeOf(record) {
  const type = text(record?.type).toLowerCase();
  return Object.hasOwn(COURSE_TYPES, type) ? type : 'lesson';
}

export const sectionOf = record => COURSE_TYPES[typeOf(record)].section;
export const typeLabel = record => COURSE_TYPES[typeOf(record)].label;

/* ---- Queries ------------------------------------------------------------------ */

/** Only what a student may see: published and not archived. */
export const isVisible = record => record?.published === true && record?.active !== false;

/**
 * The library, filtered. Everything is optional; an empty filter is the whole
 * library. `search` is the one search box: it looks at title, description and
 * content inside the current class/subject scope.
 */
export function listCourseContent({
  classId = '', subjectId = '', chapterId = '', group = '', groupScoped = false, type = '', section = '', search = '',
  publishedOnly = true, includeInactive = false, records = null
} = {}) {
  const needle = keyOf(search);
  const source = records || loadCourseContent().records;
  const byId = new Map(source.map(record => [text(record.id), record]));
  return source
    .filter(record => {
      if (!includeInactive && record.active === false) return false;
      if (record.published !== true) return false;
      if (typeOf(record) !== 'chapter' && record.chapterId) {
        const parent = byId.get(text(record.chapterId));
        if (parent && (typeOf(parent) !== 'chapter' || parent.active === false || parent.published !== true
          || parent.classId !== record.classId || parent.subjectId !== record.subjectId)) return false;
        if (parent?.group && groupKey(parent.group) !== groupKey(record.group || parent.group)) return false;
        if (groupScoped && parent?.group && groupKey(parent.group) !== groupKey(group)) return false;
        if (!groupScoped && group && parent?.group && groupKey(parent.group) !== groupKey(group)) return false;
      }
      if (classId && text(record.classId) !== classId) return false;
      if (subjectId && text(record.subjectId) !== subjectId) return false;
      if (chapterId && text(record.chapterId) !== chapterId) return false;
      if (groupScoped && record.group && groupKey(record.group) !== groupKey(group)) return false;
      if (!groupScoped && group && record.group && groupKey(record.group) !== groupKey(group)) return false;
      if (type && typeOf(record) !== type) return false;
      if (section && sectionOf(record) !== section) return false;
      if (needle) {
        const haystack = [record.title, record.description, record.content].map(keyOf).join(' ');
        if (!haystack.includes(needle)) return false;
      }
      return true;
    })
    .sort((left, right) => text(left.title).localeCompare(text(right.title), 'bn'));
}

/** Explicit staff-only draft/archive read path. Student/general reads above
 * remain published-only even if a caller passes `publishedOnly: false`. */
export async function listCourseContentForStaff({
  classId = '', subjectId = '', group = '', type = '', section = '', search = '',
  publishedOnly = false, includeInactive = true
} = {}, { role = '', actor = '' } = {}) {
  const staffName = await requireCourseWriter(role, text(classId), text(subjectId), text(group));
  const needle = keyOf(search);
  return loadCourseContent().records.filter(record => {
    if (text(record.classId) !== text(classId) || text(record.subjectId) !== text(subjectId)) return false;
    if (!includeInactive && record.active === false) return false;
    if (publishedOnly && record.published !== true) return false;
    if (group && record.group && groupKey(record.group) !== groupKey(group)) return false;
    if (type && typeOf(record) !== type) return false;
    if (section && sectionOf(record) !== section) return false;
    if (role === 'teacher' && record.published !== true && record.createdBy !== staffName) return false;
    if (needle) {
      const haystack = [record.title, record.description, record.content].map(keyOf).join(' ');
      if (!haystack.includes(needle)) return false;
    }
    return true;
  }).sort((left, right) => text(left.title).localeCompare(text(right.title), 'bn'));
}

/** Chapters of one class+subject, in the order they were created. */
export const listChapters = (classId, subjectId, options = {}) =>
  listCourseContent({ classId, subjectId, type: 'chapter', ...options })
    .sort((left, right) => text(left.createdAt).localeCompare(text(right.createdAt)) || text(left.id).localeCompare(text(right.id)));

export const contentOfChapter = (chapterId, options = {}) =>
  listCourseContent({ chapterId, ...options }).filter(record => typeOf(record) !== 'chapter');

export function contentById(id, records = null) {
  const wanted = text(id);
  if (!wanted) return null;
  return (records || loadCourseContent().records).find(record => text(record.id) === wanted) || null;
}

/** How many pieces of content (chapters and their children) exist per class. */
export function courseCounts(classId = '', subjectId = '') {
  const records = listCourseContent({ classId, subjectId, publishedOnly: true });
  return {
    total: records.length,
    chapters: records.filter(record => typeOf(record) === 'chapter').length,
    items: records.filter(record => typeOf(record) !== 'chapter').length
  };
}

/* ---- Writes ------------------------------------------------------------------- */

function clean(patch, { records, id, actor }) {
  const type = typeOf(patch);
  const title = text(patch.title);
  if (!title) throw new Error('শিরোনাম লিখুন।');
  if (title.length > 160) throw new Error('শিরোনাম সর্বোচ্চ ১৬০ অক্ষর।');
  const description = text(patch.description);
  const content = text(patch.content);
  if (description.length > 600) throw new Error('সংক্ষিপ্ত বর্ণনা সর্বোচ্চ ৬০০ অক্ষর।');
  if (content.length > 8000) throw new Error('মূল লেখা সর্বোচ্চ ৮০০০ অক্ষর।');
  const link = text(patch.attachmentUrl);
  if (link && !/^https?:\/\//i.test(link)) throw new Error('সংযুক্তি লিংকটি https:// বা http:// দিয়ে দিন।');
  const thumbnail = text(patch.thumbnail);
  if (thumbnail && !/^https?:\/\//i.test(thumbnail) && !thumbnail.startsWith('./') && !thumbnail.startsWith('assets/')) {
    throw new Error('থাম্বনেইল লিংকটি ঠিক নয়।');
  }
  const now = new Date().toISOString();
  return {
    id: id || nextContentId(records),
    classId: text(patch.classId),
    subjectId: text(patch.subjectId),
    group: text(patch.group).slice(0, 80),
    chapterId: type === 'chapter' ? '' : text(patch.chapterId),
    title,
    type,
    description,
    content,
    attachmentUrl: link,
    thumbnail,
    createdBy: text(patch.createdBy) || actor || '',
    createdAt: text(patch.createdAt) || now,
    updatedAt: now,
    published: patch.published === true,
    active: patch.active !== false
  };
}

/** Verify every content write against the active staff role and, for a
 * Teacher, their assigned class/batch/subject. The editor controls are not the
 * permission boundary. */
async function requireCourseWriter(role, classId, subjectId, group = '') {
  if (!['teacher', 'manager'].includes(role) || !(await hasStaffSession(role))) {
    throw Object.assign(new Error('সক্রিয় Teacher বা Manager session ছাড়া course content বদলানো যাবে না।'), { code: 'ACCESS_DENIED' });
  }
  const account = await readStaffAccount(role);
  if (!account || ['disabled', 'inactive', 'rejected'].includes(account.status) || account.accountStatus === 'disabled') {
    throw Object.assign(new Error('সক্রিয় staff profile ছাড়া course content বদলানো যাবে না।'), { code: 'ACCESS_DENIED' });
  }
  const classRecord = classById(text(classId));
  if (!classRecord || !listClasses().some(item => item.id === classRecord.id)) throw new Error('সক্রিয় Academic Setup-এর শ্রেণি নির্বাচন করুন।');
  const subject = subjectsForClass(classRecord.name).find(item => item.id === text(subjectId));
  if (!subject) throw new Error('এই শ্রেণির চালু বিষয় নির্বাচন করুন।');
  if (role === 'manager' && group && !listDocuments('students').some(item =>
    item.className === classRecord.name && item.status !== 'rejected' && groupKey(item.group) === groupKey(group))) {
    throw new Error('এই শ্রেণির জন্য roster-এ থাকা batch/group নির্বাচন করুন।');
  }
  if (role === 'teacher' && !isTeacherAssignedSubject(account.username, classRecord.name, subject.name, group)) {
    throw new Error('এই class/batch/subject আপনার Manager assignment-এ নেই।');
  }
  return String(account.fullName || account.username || role).trim();
}

/**
 * Create or update one record. Re-saving keeps the id, the author and the
 * original creation date; nothing is ever deleted by an edit.
 */
export async function saveCourseRecord(patch = {}, { actor = '', role = '' } = {}) {
  const requestedClassId = text(patch.classId);
  const requestedSubjectId = text(patch.subjectId);
  const requestedGroup = text(patch.group).slice(0, 80);
  const staffName = await requireCourseWriter(role, requestedClassId, requestedSubjectId, requestedGroup);
  const save = () => {
    const store = loadCourseContent();
    const existingId = text(patch.id);
    const existing = existingId ? contentById(existingId, store.records) : null;
    if (existing && role === 'teacher' && existing.createdBy !== staffName) {
      throw Object.assign(new Error('অন্য শিক্ষকের লেখা course content সম্পাদনা করা যাবে না।'), { code: 'ACCESS_DENIED' });
    }
    if (existing && (existing.classId !== requestedClassId || existing.subjectId !== requestedSubjectId)) {
      throw new Error('সম্পাদনায় record-এর class/subject বদলানো যাবে না। নতুন record তৈরি করুন।');
    }
    const record = clean({ ...(existing || {}), ...patch, createdBy: existing?.createdBy || staffName, group: requestedGroup }, { records: store.records, id: existingId, actor: staffName || actor });
    if (!isObject(record) || !record.classId || !record.subjectId) throw new Error('অন্তত ক্লাস ও বিষয় নির্বাচন করুন।');
    if (existing) { record.createdBy = existing.createdBy; record.createdAt = existing.createdAt; }
    if (record.type !== 'chapter' && record.chapterId) {
      const parent = contentById(record.chapterId, store.records);
      if (!parent || typeOf(parent) !== 'chapter' || parent.active === false
        || parent.classId !== record.classId || parent.subjectId !== record.subjectId) {
        throw new Error('এই class/subject-এর সক্রিয় chapter নির্বাচন করুন।');
      }
      if (parent.group && !record.group) record.group = parent.group;
      if (parent.group && groupKey(parent.group) !== groupKey(record.group)) throw new Error('কনটেন্টের batch/group তার chapter-এর সঙ্গে মিলতে হবে।');
    }
    const records = existing
      ? store.records.map(item => (text(item.id) === existingId ? record : item))
      : [...store.records, record];
    if (records.length > MAX_CONTENT) throw new Error('সংরক্ষণের সীমা পূর্ণ হয়েছে।');
    saveCourseContent(records);
    return record;
  };
  return navigator.locks ? navigator.locks.request(COURSE_CONTENT_KEY, save) : save();
}

export async function setContentPublished(id, published, { role = '', actor = '' } = {}) {
  const save = async () => {
    const store = loadCourseContent();
    const wanted = text(id);
    const current = contentById(wanted, store.records);
    if (!current) return null;
    const staffName = await requireCourseWriter(role, current.classId, current.subjectId, current.group);
    if (role === 'teacher' && current.createdBy !== staffName) {
      throw Object.assign(new Error('অন্য শিক্ষকের লেখা course content প্রকাশ বা পরিবর্তন করা যাবে না।'), { code: 'ACCESS_DENIED' });
    }
    const saved = { ...current, published: published === true, updatedAt: new Date().toISOString(), updatedBy: actor || role };
    saveCourseContent(store.records.map(record => text(record.id) === wanted ? saved : record));
    return saved;
  };
  return navigator.locks ? navigator.locks.request(COURSE_CONTENT_KEY, save) : save();
}

/** Archive instead of delete: `active:false` keeps the record readable. */
export async function archiveCourseRecord(id, { role = '', actor = '' } = {}) {
  const save = async () => {
    const store = loadCourseContent();
    const wanted = text(id);
    const current = contentById(wanted, store.records);
    if (!current) return null;
    const staffName = await requireCourseWriter(role, current.classId, current.subjectId, current.group);
    if (role === 'teacher' && current.createdBy !== staffName) {
      throw Object.assign(new Error('অন্য শিক্ষকের লেখা course content archive করা যাবে না।'), { code: 'ACCESS_DENIED' });
    }
    const saved = { ...current, active: false, updatedAt: new Date().toISOString(), updatedBy: actor || role };
    saveCourseContent(store.records.map(record => text(record.id) === wanted ? saved : record));
    return saved;
  };
  return navigator.locks ? navigator.locks.request(COURSE_CONTENT_KEY, save) : save();
}

/** Announce a write so every open screen (and the student app) repaints. */
export function announceCourseChange(detail = {}) {
  try { window.dispatchEvent(new CustomEvent('apc-course-updated', { detail })); } catch { /* headless */ }
}
