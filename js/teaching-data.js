/* Local academic repository. Keep the existing Student and Transaction schemas intact.
   These async methods can be replaced with authenticated API calls later. */
import { enabledClasses, STORAGE_KEYS } from './config.js';
import { loadRoster } from './office-data.js';
import { KEYS, readRaw, writeRaw, newId } from './database.js';
import { isTeacherAssigned, assignedScopeForStudent } from './teacher-assignments.js';
import { hasStaffSession, readStaffAccount } from './staff-auth.js';
import { authenticatedStudent } from './student-access.js';
import { searchStudentsByQuery } from './student-search.js';

export const TEACHING_KEY = KEYS.teaching;
export const DEMO_TEACHER = Object.freeze({ id: 'TCH-001', name: 'মো. সাইফুল ইসলাম' });
export const ACTIVITY_TYPES = Object.freeze({
  exam: { label: 'নম্বর ও ফলাফল', plural: 'নম্বর ও ফলাফল', progress: '' },
  homework: { label: 'বাড়ির কাজ', plural: 'বাড়ির কাজ', progress: 'জমার অবস্থা' },
  suggestion: { label: 'একাডেমিক নোটিশ', plural: 'একাডেমিক নোটিশ', progress: '' },
  routine: { label: 'উপস্থিতি ক্লাস', plural: 'উপস্থিতি ক্লাস', progress: 'উপস্থিতি' }
});
export const PROGRESS_LABELS = Object.freeze({ pending: 'বাকি', done: 'সম্পন্ন জানিয়েছে', reviewed: 'দেখা হয়েছে', present: 'উপস্থিত', absent: 'অনুপস্থিত', late: 'দেরিতে উপস্থিত' });
export { escapeHtml as escapeText } from './sanitize.js';
export function todayISO(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
export function displayDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
}
export function safeResourceURL(value) {
  if (!value) return '';
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}
const groupKey = value => String(value || '').normalize('NFC').trim().replace(/\s*বিভাগ$/, '').trim();
export function matchesStudent(activity, student) {
  const classKey = value => String(value || '').normalize('NFC').trim();
  return classKey(activity.className) === classKey(student.className) && (!activity.group || groupKey(activity.group) === groupKey(student.group));
}
export function publishedForStudent(activities, student) {
  return activities.filter(a => a.status === 'published' && matchesStudent(a, student));
}
export const searchTeachingStudents = searchStudentsByQuery;
function fail(message) { throw new Error(message); }
function academicClassNames() {
  try {
    const saved = JSON.parse(readRaw(KEYS.academics) || 'null');
    if (Array.isArray(saved?.classes)) return saved.classes.map(item => item?.name).filter(Boolean);
  } catch { /* retain the shipped class list when old Academic Setup is unreadable */ }
  return enabledClasses;
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && todayISO(date) === value;
}
export function validateActivity(input) {
  const text = key => String(input[key] || '').trim();
  const type = text('type'), title = text('title'), subject = text('subject'), className = text('className');
  if (!Object.hasOwn(ACTIVITY_TYPES, type) || !['draft', 'published'].includes(input.status)) fail('কাজের ধরন ও অবস্থা সঠিকভাবে নির্বাচন করুন।');
  if (!title || title.length > 150 || !subject || subject.length > 80) fail('শিরোনাম ও বিষয় পূরণ করুন (সর্বোচ্চ ১৫০ ও ৮০ অক্ষর)।');
  if (!academicClassNames().includes(className)) fail('সঠিক শ্রেণি নির্বাচন করুন।');
  const group = text('group'), details = text('details'), room = text('room'), resourceURL = text('resourceURL');
  if (group.length > 80 || details.length > 3000 || room.length > 120 || resourceURL.length > 1000) fail('লেখা নির্ধারিত সীমার মধ্যে রাখুন।');
  if (resourceURL && !safeResourceURL(resourceURL)) fail('সহায়ক লিংকটি https:// বা http:// দিয়ে দিন।');
  const date = type === 'suggestion' ? (text('date') || todayISO()) : text('date');
  const time = type === 'suggestion' ? '' : text('time');
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (type === 'homework') {
    if (Boolean(date) !== Boolean(time)) fail('জমার তারিখ দিলে সময়ও দিন, অথবা দুটোই ফাঁকা রাখুন।');
    if (date && (!validDate(date) || !validTime)) fail('সঠিক জমার তারিখ ও সময় দিন।');
  } else {
    if (!validDate(date)) fail('সঠিক তারিখ দিন।');
    if (type !== 'suggestion' && !validTime) fail('সঠিক সময় দিন।');
  }
  const timed = ['exam', 'routine'].includes(type);
  const duration = timed ? Number(input.duration) : 0;
  if (timed && (!Number.isInteger(duration) || duration < 5 || duration > 300)) fail('সময়কাল ৫ থেকে ৩০০ মিনিটের মধ্যে দিন।');
  if (timed && minutes(time) + duration > 1440) fail('ক্লাস/পরীক্ষা একই দিনের মধ্যে শেষ হতে হবে।');
  const totalMarks = type === 'exam' ? Number(input.totalMarks) : 0;
  if (type === 'exam' && (!Number.isInteger(totalMarks) || totalMarks < 1 || totalMarks > 1000)) fail('পূর্ণমান ১ থেকে ১০০০-এর মধ্যে দিন।');
  return { type, title, subject, className, group, details, room: timed ? room : '', resourceURL, date, time, duration, totalMarks, status: input.status };
}
function minutes(time) { const [h, m] = time.split(':').map(Number); return h * 60 + m; }
function readData() {
  const raw = readRaw(TEACHING_KEY);
  if (raw === null) return { version: 1, activities: [] };
  let db;
  try { db = JSON.parse(raw); } catch { fail('শিক্ষকের সংরক্ষিত ডেটা পড়া যাচ্ছে না। ডেটা না মুছে সহায়তা নিন।'); }
  if (db?.version !== 1 || !Array.isArray(db.activities) || db.activities.some(a => !a || typeof a.id !== 'string' || !a.teacherId || !a.progress || typeof a.progress !== 'object' || Array.isArray(a.progress))) fail('শিক্ষকের সংরক্ষিত ডেটা সঠিক নয়।');
  const ids = new Set();
  for (const a of db.activities) {
    validateActivity(a);
    if (ids.has(a.id) || !a.id || typeof a.updatedAt !== 'string' || typeof a.createdAt !== 'string' || typeof a.teacherName !== 'string' || !Number.isFinite(Date.parse(a.updatedAt)) || !Number.isFinite(Date.parse(a.createdAt))) fail('শিক্ষকের সংরক্ষিত ডেটা সঠিক নয়।');
    ids.add(a.id);
    for (const p of Object.values(a.progress)) {
      const value = p?.value;
      const valid = a.type === 'exam' ? typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= a.totalMarks && Number.isInteger(value * 2)
        : a.type === 'homework' ? ['pending', 'done', 'reviewed'].includes(value)
        : a.type === 'routine' && ['present', 'absent', 'late'].includes(value);
      if (!valid || !Number.isFinite(Date.parse(p.updatedAt))) fail('সংরক্ষিত নম্বর/অগ্রগতির ডেটা সঠিক নয়।');
    }
  }
  return db;
}
function approvedRoster() {
  const students = loadRoster().filter(s => s.status === 'approved').map(s => ({ ...s }));
  // Include the current approved student account without changing stored office records.
  try {
    const account = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.account) || 'null');
    if (account?.status === 'active' && typeof account.student?.id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(account.student.id) && typeof account.student.name === 'string' && account.student.name.trim() && academicClassNames().includes(account.student.className)) {
      const current = { ...account.student, mobile: account.student.studentMobile || account.mobile, status: 'approved' };
      const index = students.findIndex(s => s.id === current.id);
      if (index < 0) students.push(current); else students[index] = { ...students[index], ...current };
    }
  } catch { /* Existing app owns student-account recovery. */ }
  return students;
}
function roster() { return approvedRoster().filter(student => assignedScopeForStudent('teacher.apc', student)); }
function teacherSnapshot(db) {
  return { ...db, activities: db.activities.filter(activity => activity.teacherId === DEMO_TEACHER.id && isTeacherAssigned('teacher.apc', activity.className, activity.group)) };
}
function studentSnapshot(db, student) {
  return {
    version: db.version,
    activities: db.activities
      .filter(activity => activity.status === 'published' && matchesStudent(activity, student))
      .map(activity => {
        const ownProgress = activity.progress?.[student.id];
        return { ...activity, progress: ownProgress ? { [student.id]: { ...ownProgress } } : {} };
      })
  };
}
function assertAssigned(className, group = '') {
  if (!isTeacherAssigned('teacher.apc', className, group)) fail('এই class/batch-এ আপনার Manager assignment নেই।');
}
async function requireRoleSession(role) {
  if (!(await hasStaffSession(role))) fail(`সক্রিয় ${role === 'teacher' ? 'Teacher' : 'Manager'} session ছাড়া এই কাজ করা যাবে না।`);
  const account = await readStaffAccount(role);
  if (!account || ['disabled', 'inactive', 'rejected'].includes(account.status) || account.accountStatus === 'disabled') fail(`সক্রিয় ${role === 'teacher' ? 'Teacher' : 'Manager'} profile ছাড়া এই কাজ করা যাবে না।`);
}
async function mutate(change) {
  const save = () => {
    const db = readData();
    change(db);
    writeRaw(TEACHING_KEY, JSON.stringify(db));
    window.dispatchEvent(new Event('teaching-data-updated'));
    return db;
  };
  return navigator.locks ? navigator.locks.request(TEACHING_KEY, save) : save();
}
function ownedActivity(db, id) {
  const activity = db.activities.find(a => a.id === id);
  if (!activity || activity.teacherId !== DEMO_TEACHER.id || !isTeacherAssigned('teacher.apc', activity.className, activity.group)) fail('কাজটি পাওয়া যায়নি বা এই class/batch-এর assignment নেই।');
  return activity;
}
export const teachingRepository = {
  async list(actor = null) {
    if (actor?.role === 'student') return teachingRepository.listForStudent(actor.studentId || actor.id);
    if (actor?.role === 'manager') { await requireRoleSession('manager'); return readData(); }
    if (actor?.role === 'teacher') { await requireRoleSession('teacher'); return teacherSnapshot(readData()); }
    if (await hasStaffSession('manager')) { await requireRoleSession('manager'); return readData(); }
    if (await hasStaffSession('teacher')) { await requireRoleSession('teacher'); return teacherSnapshot(readData()); }
    const student = await authenticatedStudent();
    return studentSnapshot(readData(), student);
  },
  async listForStudent(studentId) {
    const student = await authenticatedStudent(studentId);
    return studentSnapshot(readData(), student);
  },
  async listForManager() { await requireRoleSession('manager'); return readData(); },
  async listStudents() { await requireRoleSession('teacher'); return roster(); },
  async listApprovedStudents() { await requireRoleSession('manager'); return approvedRoster(); },
  async saveActivity(input) {
    await requireRoleSession('teacher');
    const fields = validateActivity(input);
    if (fields.type === 'exam') fail('পরীক্ষার খসড়া ও অনুমোদনের জন্য Examination workflow ব্যবহার করুন।');
    assertAssigned(fields.className, fields.group);
    const teacher = await readStaffAccount('teacher');
    const teacherName = String(teacher?.fullName || teacher?.username || '').trim();
    if (!teacherName) fail('Teacher profile পাওয়া যায়নি।');
    const db = await mutate(db => {
      const old = input.id ? ownedActivity(db, input.id) : null;
      if (old && old.type !== fields.type) fail('কাজের ধরন বদলানো যাবে না।');
      if (old && Object.keys(old.progress).length && (old.className !== fields.className || groupKey(old.group) !== groupKey(fields.group))) fail('নম্বর/অগ্রগতি আছে। এই কাজের শ্রেণি বা বিভাগ বদলানো যাবে না।');
      if (fields.type === 'exam' && old && Object.values(old.progress).some(p => Number(p.value) > fields.totalMarks)) fail('পূর্ণমান সংরক্ষিত নম্বরের চেয়ে কম হতে পারে না।');
      if (fields.status === 'published' && ['exam', 'routine'].includes(fields.type)) {
        const conflict = db.activities.some(a => a.id !== old?.id && a.teacherId === DEMO_TEACHER.id && a.status === 'published' && ['exam', 'routine'].includes(a.type) && a.date === fields.date && minutes(a.time) < minutes(fields.time) + fields.duration && minutes(fields.time) < minutes(a.time) + a.duration);
        if (conflict) fail('এই সময়ে আপনার আরেকটি ক্লাস/পরীক্ষা আছে। সময় বদলান।');
      }
      const now = new Date().toISOString();
      const activity = { ...fields, id: old?.id || newId('ACT'), teacherId: DEMO_TEACHER.id, teacherName, createdAt: old?.createdAt || now, updatedAt: now, progress: old?.progress || {} };
      if (old) db.activities[db.activities.indexOf(old)] = activity; else db.activities.unshift(activity);
    });
    return teacherSnapshot(db);
  },
  async deleteActivity(id) {
    await requireRoleSession('teacher');
    const db = await mutate(data => { const activity = ownedActivity(data, id); if (activity.type === 'exam') fail('পরীক্ষার রেকর্ড এখানে মুছতে বা পরিবর্তন করতে পারবেন না।'); data.activities = data.activities.filter(a => a.id !== id); });
    return teacherSnapshot(db);
  },
  async saveProgress(id, entries) {
    await requireRoleSession('teacher');
    const db = await mutate(db => {
      const activity = ownedActivity(db, id);
      if (activity.type === 'exam') fail('নম্বর ও ফলাফল কেবল Manager-approved Examination workflow-এ পরিবর্তন করা যাবে।');
      if (activity.status !== 'published' || activity.type === 'suggestion') fail('আগে কাজটি প্রকাশ করুন।');
      const allowed = roster().filter(s => matchesStudent(activity, s));
      for (const [studentId, raw] of Object.entries(entries)) {
        if (!allowed.some(s => s.id === studentId)) fail('শিক্ষার্থী এই শ্রেণি/বিভাগের অন্তর্ভুক্ত নয়।');
        if (raw === '') { delete activity.progress[studentId]; continue; }
        const value = activity.type === 'exam' ? Number(raw) : raw;
        if (activity.type === 'exam' && (!['number', 'string'].includes(typeof raw) || !String(raw).trim() || !Number.isFinite(value) || value < 0 || value > activity.totalMarks || !Number.isInteger(value * 2))) fail('নম্বর শূন্য থেকে পূর্ণমানের মধ্যে দিন (০.৫ ধাপে)।');
        if (activity.type === 'homework' && !['pending', 'done', 'reviewed'].includes(value)) fail('জমার অবস্থা সঠিক নয়।');
        if (activity.type === 'routine' && !['present', 'absent', 'late'].includes(value)) fail('উপস্থিতির অবস্থা সঠিক নয়।');
        activity.progress[studentId] = { value, updatedAt: new Date().toISOString() };
      }
    });
    return teacherSnapshot(db);
  },
  async markHomeworkDone(id, student) {
    const actual = await authenticatedStudent(student?.id);
    const db = await mutate(db => {
      const activity = db.activities.find(item => item.id === id);
      if (!activity || activity.type !== 'homework' || activity.status !== 'published'
        || !matchesStudent(activity, actual)
        || !roster().some(row => row.id === actual.id && matchesStudent(activity, row))) {
        fail('এই বাড়ির কাজ সম্পন্ন জানানোর অনুমতি নেই।');
      }
      if (activity.progress[actual.id]?.value === 'reviewed') return;
      activity.progress[actual.id] = { value: 'done', updatedAt: new Date().toISOString() };
    });
    return studentSnapshot(db, actual);
  }
};
export function watchTeachingData(callback) {
  window.addEventListener('storage', event => {
    if ([null, TEACHING_KEY, STORAGE_KEYS.account, STORAGE_KEYS.student, 'activePlus.manager.teacherAssignments.v1'].includes(event.key)) callback();
  });
  window.addEventListener('teaching-data-updated', callback);
}
