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
import { sanitizeRichHtml, sanitizeLectureHtml, isSafeLectureImageSrc } from './rich-sanitize.js';

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
        const haystack = [record.title, record.subtitle, record.topic, record.chapterName, record.description, record.content].map(keyOf).join(' ');
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
      const haystack = [record.title, record.subtitle, record.topic, record.chapterName, record.description, record.content].map(keyOf).join(' ');
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

export const DEFAULT_LECTURE_PAGE_SETTINGS = Object.freeze({
  orientation: 'portrait',
  margins: 'normal',
  showLogo: true,
  showWatermark: true,
  showHeader: true,
  showFooter: true,
  showPageNumbers: true,
  headerText: '',
  footerText: '',
  fontFamily: 'Noto Sans Bengali',
  baseFontSize: 12,
  lineHeight: 1.6
});

export function normalizeLecturePageSettings(raw = {}) {
  const src = isObject(raw) ? raw : {};
  const orientation = src.orientation === 'landscape' ? 'landscape' : 'portrait';
  const margins = ['narrow', 'normal', 'wide'].includes(src.margins) ? src.margins : 'normal';
  const baseFontSize = Math.min(20, Math.max(9, Number(src.baseFontSize) || 12));
  const lineHeight = Math.min(2.4, Math.max(1.15, Number(src.lineHeight) || 1.6));
  const fontFamily = text(src.fontFamily).slice(0, 64) || 'Noto Sans Bengali';
  return {
    orientation,
    margins,
    showLogo: src.showLogo !== false,
    showWatermark: src.showWatermark !== false,
    showHeader: src.showHeader !== false,
    showFooter: src.showFooter !== false,
    showPageNumbers: src.showPageNumbers !== false,
    headerText: text(src.headerText).slice(0, 140),
    footerText: text(src.footerText).slice(0, 140),
    fontFamily,
    baseFontSize,
    lineHeight
  };
}

function sanitizeDocJsonNode(node, depth = 0, stats = { images: 0 }) {
  if (!isObject(node) || depth > 24) return null;
  const nodeType = text(node.type);
  if (!nodeType || !/^[a-zA-Z][a-zA-Z0-9_]{0,36}$/.test(nodeType)) return null;
  const out = { type: nodeType };
  if (typeof node.text === 'string') {
    out.text = node.text.slice(0, 40000);
  }
  if (isObject(node.attrs)) {
    const cleanAttrs = {};
    for (const [k, v] of Object.entries(node.attrs)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,32}$/.test(k)) continue;
      if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
        cleanAttrs[k] = v;
      } else if (typeof v === 'string') {
        if (nodeType === 'image' && k === 'src') {
          if (!isSafeLectureImageSrc(v)) return null;
          stats.images += 1;
          if (stats.images > 12) throw new Error('একটি লেকচার শিটে সর্বোচ্চ ১২টি ছবি যুক্ত করা যাবে।');
          cleanAttrs[k] = v.trim();
        } else {
          cleanAttrs[k] = v.slice(0, 2000);
        }
      } else if (Array.isArray(v) && v.every(n => typeof n === 'number' && Number.isFinite(n))) {
        cleanAttrs[k] = v.slice(0, 24);
      }
    }
    if (Object.keys(cleanAttrs).length) out.attrs = cleanAttrs;
  }
  if (Array.isArray(node.marks) && node.marks.length) {
    const marks = [];
    for (const m of node.marks.slice(0, 12)) {
      if (!isObject(m) || typeof m.type !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,32}$/.test(m.type)) continue;
      const cm = { type: m.type };
      if (isObject(m.attrs)) {
        const ma = {};
        for (const [mk, mv] of Object.entries(m.attrs)) {
          if (!/^[a-zA-Z][a-zA-Z0-9_]{0,32}$/.test(mk)) continue;
          if (mv === null || typeof mv === 'boolean' || (typeof mv === 'number' && Number.isFinite(mv))) ma[mk] = mv;
          else if (typeof mv === 'string') ma[mk] = mv.slice(0, 500);
        }
        if (Object.keys(ma).length) cm.attrs = ma;
      }
      marks.push(cm);
    }
    if (marks.length) out.marks = marks;
  }
  if (Array.isArray(node.content)) {
    out.content = node.content
      .slice(0, 1500)
      .map(child => sanitizeDocJsonNode(child, depth + 1, stats))
      .filter(Boolean);
  }
  return out;
}

export function sanitizeLectureDocJson(rawDoc) {
  if (!isObject(rawDoc) || rawDoc.type !== 'doc') {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  const cleaned = sanitizeDocJsonNode(rawDoc, 0, { images: 0 }) || { type: 'doc', content: [{ type: 'paragraph' }] };
  const serialized = JSON.stringify(cleaned);
  if (serialized.length > 480000) {
    throw new Error('ডকুমেন্টের আকার ক্লাউড সংরক্ষণের নিরাপদ সীমা অতিক্রম করেছে — ছবির আকার বা সংখ্যা কমান।');
  }
  if (!Array.isArray(cleaned.content) || !cleaned.content.length) {
    cleaned.content = [{ type: 'paragraph' }];
  }
  return cleaned;
}

function clean(patch, { records, id, actor }) {
  const isLectureSheet = patch.isLectureSheet === true;
  const type = typeOf(patch);
  const title = text(patch.title);
  if (!title) throw new Error('শিরোনাম লিখুন।');
  if (title.length > 160) throw new Error('শিরোনাম সর্বোচ্চ ১৬০ অক্ষর।');
  const description = text(patch.description);
  const content = isLectureSheet ? text(patch.content).slice(0, 80000) : text(patch.content);
  const richContent = isLectureSheet
    ? sanitizeLectureHtml(patch.richContent || '')
    : sanitizeRichHtml(patch.richContent || '');
  if (description.length > 600) throw new Error('সংক্ষিপ্ত বর্ণনা সর্বোচ্চ ৬০০ অক্ষর।');
  if (!isLectureSheet && content.length > 8000) throw new Error('মূল লেখা সর্বোচ্চ ৮০০০ অক্ষর।');
  const link = text(patch.attachmentUrl);
  if (link && !/^https?:\/\//i.test(link)) throw new Error('সংযুক্তি লিংকটি https:// বা http:// দিয়ে দিন।');
  const thumbnail = text(patch.thumbnail);
  if (thumbnail && !/^https?:\/\//i.test(thumbnail) && !thumbnail.startsWith('./') && !thumbnail.startsWith('assets/')) {
    throw new Error('থাম্বনেইল লিংকটি ঠিক নয়।');
  }
  const now = new Date().toISOString();
  const published = patch.published === true;
  const active = patch.active !== false;
  const base = {
    id: id || nextContentId(records),
    classId: text(patch.classId),
    subjectId: text(patch.subjectId),
    group: text(patch.group).slice(0, 80),
    chapterId: type === 'chapter' ? '' : text(patch.chapterId),
    title,
    type,
    description,
    content,
    richContent,
    attachmentUrl: link,
    thumbnail,
    createdBy: text(patch.createdBy) || actor || '',
    createdAt: text(patch.createdAt) || now,
    updatedAt: now,
    published,
    active
  };
  if (!isLectureSheet) return base;

  const classRec = classById(base.classId);
  const subjRec = classRec ? subjectsForClass(classRec.name).find(item => item.id === base.subjectId) : null;
  const status = !active ? 'archived' : (published ? 'published' : 'draft');
  return {
    ...base,
    isLectureSheet: true,
    subtitle: text(patch.subtitle).slice(0, 200),
    topic: text(patch.topic).slice(0, 160),
    chapterName: text(patch.chapterName).slice(0, 160),
    className: text(patch.className) || classRec?.name || '',
    subjectName: text(patch.subjectName) || subjRec?.name || '',
    teacherId: text(patch.teacherId).slice(0, 120),
    teacherName: text(patch.teacherName).slice(0, 160),
    docJson: sanitizeLectureDocJson(patch.docJson),
    pageSettings: normalizeLecturePageSettings(patch.pageSettings),
    status,
    publishedAt: published ? (text(patch.publishedAt) || now) : text(patch.publishedAt),
    docVersion: Math.max(1, Math.trunc(Number(patch.docVersion) || 1)),
    history: Array.isArray(patch.history) ? patch.history.slice(0, 5) : []
  };
}

/** Verify every content write against the active staff role and, for a
 * Teacher, their assigned class/batch/subject. The editor controls are not the
 * permission boundary. */
async function requireCourseWriter(role, classId, subjectId, group = '') {
  if (!['admin', 'teacher', 'manager'].includes(role) || !(await hasStaffSession(role))) {
    throw Object.assign(new Error('সক্রিয় শিক্ষক, ম্যানেজার বা অ্যাডমিন সেশন ছাড়া কনটেন্ট বদলানো যাবে না।'), { code: 'ACCESS_DENIED' });
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
    throw new Error('এই ক্লাস/ব্যাচ/বিষয় আপনার ম্যানেজার অ্যাসাইনমেন্টে নেই।');
  }
  return String(account.fullName || account.username || role).trim();
}

export async function verifyCourseStaffActor(role) {
  if (!['admin', 'teacher', 'manager'].includes(role) || !(await hasStaffSession(role))) {
    throw Object.assign(new Error('অনুমোদিত স্টাফ সেশন পাওয়া যায়নি।'), { code: 'ACCESS_DENIED' });
  }
  const account = await readStaffAccount(role);
  if (!account || ['disabled', 'inactive', 'rejected'].includes(account.status) || account.accountStatus === 'disabled') {
    throw Object.assign(new Error('সক্রিয় স্টাফ অ্যাকাউন্ট পাওয়া যায়নি।'), { code: 'ACCESS_DENIED' });
  }
  return {
    role,
    username: String(account.username || '').trim(),
    staffId: String(account.staffId || account.id || account.username || role).trim(),
    displayName: String(account.fullName || account.username || role).trim()
  };
}

/**
 * Create or update one record. Re-saving keeps the id, the author and the
 * original creation date; nothing is ever deleted by an edit.
 */
export async function saveCourseRecord(patch = {}, { actor = '', role = '', expectedVersion = null, recordHistory = false } = {}) {
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
    if (existing && !patch.allowReassignScope && (existing.classId !== requestedClassId || existing.subjectId !== requestedSubjectId)) {
      throw new Error('সম্পাদনায় record-এর class/subject বদলানো যাবে না। নতুন record তৈরি করুন।');
    }
    if (existing && expectedVersion !== null && expectedVersion !== undefined && Number.isFinite(Number(expectedVersion))
      && Number(existing.docVersion || 1) !== Number(expectedVersion)) {
      throw Object.assign(
        new Error('অন্য ডিভাইস বা ট্যাবে ডকুমেন্টটি ইতিমধ্যে আপডেট হয়েছে — সংঘর্ষ এড়াতে আগে পর্যালোচনা করুন।'),
        { code: 'VERSION_CONFLICT', currentVersion: Number(existing.docVersion || 1), currentRecord: existing }
      );
    }
    const nextVersion = existing ? (Math.max(1, Number(existing.docVersion) || 1) + 1) : 1;
    let nextHistory = Array.isArray(existing?.history) ? [...existing.history] : [];
    if (existing && existing.isLectureSheet && recordHistory) {
      const snapshotJson = JSON.stringify(existing.docJson || {}).length <= 120000 ? existing.docJson : null;
      nextHistory = [
        {
          version: Number(existing.docVersion) || 1,
          savedAt: existing.updatedAt || existing.createdAt,
          savedBy: existing.updatedBy || existing.createdBy || '',
          title: existing.title || '',
          subtitle: existing.subtitle || '',
          topic: existing.topic || '',
          status: existing.status || (existing.published ? 'published' : 'draft'),
          pageSettings: existing.pageSettings || DEFAULT_LECTURE_PAGE_SETTINGS,
          docJson: snapshotJson,
          richContent: snapshotJson ? '' : String(existing.richContent || '').slice(0, 60000),
          content: String(existing.content || '').slice(0, 20000)
        },
        ...nextHistory
      ].slice(0, 5);
    }
    const record = clean(
      {
        ...(existing || {}),
        ...patch,
        docVersion: nextVersion,
        history: patch.history !== undefined ? patch.history : nextHistory,
        createdBy: existing?.createdBy || staffName,
        group: requestedGroup
      },
      { records: store.records, id: existingId, actor: staffName || actor }
    );
    if (!isObject(record) || !record.classId || !record.subjectId) throw new Error('অন্তত ক্লাস ও বিষয় নির্বাচন করুন।');
    if (existing) {
      record.createdBy = existing.createdBy;
      record.createdAt = existing.createdAt;
      record.updatedBy = staffName || actor || role;
    }
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
    const now = new Date().toISOString();
    const isPub = published === true;
    const nextActive = isPub ? true : current.active !== false;
    const saved = {
      ...current,
      published: isPub,
      active: nextActive,
      ...(current.isLectureSheet ? {
        status: !nextActive ? 'archived' : (isPub ? 'published' : 'draft'),
        publishedAt: isPub ? now : (current.publishedAt || ''),
        docVersion: Math.max(1, Number(current.docVersion) || 1) + 1
      } : {}),
      updatedAt: now,
      updatedBy: staffName || actor || role
    };
    saveCourseContent(store.records.map(record => text(record.id) === wanted ? saved : record));
    return saved;
  };
  return navigator.locks ? navigator.locks.request(COURSE_CONTENT_KEY, save) : save();
}

/** Archive instead of delete: `active:false` keeps the record readable. */
export async function archiveCourseRecord(id, { role = '', actor = '', restore = false } = {}) {
  const save = async () => {
    const store = loadCourseContent();
    const wanted = text(id);
    const current = contentById(wanted, store.records);
    if (!current) return null;
    const staffName = await requireCourseWriter(role, current.classId, current.subjectId, current.group);
    if (role === 'teacher' && current.createdBy !== staffName) {
      throw Object.assign(new Error('অন্য শিক্ষকের লেখা course content archive করা যাবে না।'), { code: 'ACCESS_DENIED' });
    }
    const now = new Date().toISOString();
    const nextActive = restore === true;
    const nextPublished = nextActive ? Boolean(current.published) : false;
    const saved = {
      ...current,
      active: nextActive,
      published: current.isLectureSheet && !nextActive ? false : current.published,
      ...(current.isLectureSheet ? {
        status: !nextActive ? 'archived' : (nextPublished ? 'published' : 'draft'),
        docVersion: Math.max(1, Number(current.docVersion) || 1) + 1
      } : {}),
      updatedAt: now,
      updatedBy: staffName || actor || role
    };
    saveCourseContent(store.records.map(record => text(record.id) === wanted ? saved : record));
    return saved;
  };
  return navigator.locks ? navigator.locks.request(COURSE_CONTENT_KEY, save) : save();
}

/** Announce a write so every open screen (and the student app) repaints. */
export function announceCourseChange(detail = {}) {
  try { window.dispatchEvent(new CustomEvent('apc-course-updated', { detail })); } catch { /* headless */ }
}
