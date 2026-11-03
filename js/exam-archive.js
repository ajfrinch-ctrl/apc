import { nowEpoch } from './time.js';
/* Date-wise Examination archive.
   Pure helpers shared by the Manager/Teacher examination screens: filtering,
   date-wise grouping, the workflow timeline and the permission matrix. No DOM
   and no storage here — everything is derived from the records the repository
   returns (js/exam-data.js), so the same rules can be tested on their own. */
import {
  EXAM_STATUSES, EXAM_STATUS_ORDER, EXAM_TYPES, isLiveExam, isEditableExam,
  examDateOf, examDurationMinutes, totalMarks
} from './exam-data.js';
import { toBanglaNumber as bn } from './ui.js';
import { currentTeacherId, isOwnTeacherRecord } from './teaching-data.js';

/** Every filter the Exam History / Question Archive bar can carry. */
export const EXAM_FILTERS = Object.freeze({
  query: '', date: '', from: '', to: '',
  className: 'all', subject: 'all', status: 'all', type: 'all'
});
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const BANGLA_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const BANGLA_WEEKDAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
export const STATUS_TONE = Object.freeze({
  draft: 'muted', pending: 'warning', approved: 'info', rejected: 'danger',
  published: 'success', completed: 'info', archived: 'muted'
});

export function normalizeFilters(raw = {}) {
  const clean = { ...EXAM_FILTERS };
  for (const key of Object.keys(EXAM_FILTERS)) {
    const value = raw[key];
    if (key === 'date' || key === 'from' || key === 'to') clean[key] = DATE_KEY.test(String(value || '')) ? String(value) : '';
    else if (key === 'query') clean[key] = String(value || '').trim().slice(0, 120);
    else clean[key] = value === undefined || value === null || value === '' ? 'all' : String(value);
  }
  if (clean.from && clean.to && clean.from > clean.to) [clean.from, clean.to] = [clean.to, clean.from];
  return clean;
}
export const activeFilterCount = filters => Object.entries(normalizeFilters(filters))
  .filter(([, value]) => value && value !== 'all').length;
export const examDateKey = exam => examDateOf(exam);
export const durationLabel = minutes => `${bn(Math.max(0, Math.round(Number(minutes) || 0)))} মিনিট`;
export const shortExamId = id => String(id || '').length > 12 ? `${String(id).slice(0, 8)}…` : String(id || '');
export const statusLabel = status => EXAM_STATUSES[status] || 'অজানা';
export const statusTone = status => STATUS_TONE[status] || 'muted';

/** The date header a date group carries: '০২ অক্টোবর ২০২৬, শুক্রবার'. */
export function examDateLabel(dateKey) {
  if (!DATE_KEY.test(String(dateKey || ''))) return 'তারিখ নেই';
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const weekday = BANGLA_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${bn(String(day).padStart(2, '0'))} ${BANGLA_MONTHS[month - 1]} ${bn(year)}, ${weekday}`;
}
/** Short form used inside cards: '০২-১০-২০২৬'. */
export const examDateShort = dateKey => DATE_KEY.test(String(dateKey || ''))
  ? String(dateKey).split('-').reverse().map(part => bn(part)).join('-')
  : '—';
/** Newest day first (history) or soonest day first (upcoming). */
export function groupExamsByDate(exams, { direction = 'desc' } = {}) {
  const groups = new Map();
  for (const exam of exams) {
    const date = examDateKey(exam) || 'unknown';
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(exam);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a))
    .map(([date, list]) => ({
      date,
      label: date === 'unknown' ? 'তারিখ ছাড়া পুরোনো রেকর্ড' : examDateLabel(date),
      exams: list.sort((a, b) => Number(a.startAt) - Number(b.startAt) || String(a.title).localeCompare(String(b.title), 'bn'))
    }));
}
/** Published/approved papers whose window has not closed yet, soonest first. */
export function upcomingExams(exams, now = nowEpoch()) {
  return exams
    .filter(exam => (isLiveExam(exam) || exam.status === 'approved') && Number(exam.endAt) > Number(now) && Number(exam.startAt) >= Number(now) - 86400000)
    .sort((a, b) => Number(a.startAt) - Number(b.startAt));
}
/** Name, id, subject, class and question text all take part in the search. */
export function examMatchesQuery(exam, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    exam.title, exam.subject, exam.className, exam.group, exam.id, EXAM_TYPES[exam.type], exam.createdBy, exam.teacherName,
    ...(exam.questions || []).map(question => question.text)
  ].filter(Boolean).join(' ').toLowerCase();
  return needle.split(/\s+/).every(part => haystack.includes(part));
}
export function matchesExamFilters(exam, rawFilters) {
  const filters = normalizeFilters(rawFilters);
  const date = examDateKey(exam);
  if (filters.date && date !== filters.date) return false;
  if (filters.from && (!date || date < filters.from)) return false;
  if (filters.to && (!date || date > filters.to)) return false;
  if (filters.className !== 'all' && exam.className !== filters.className) return false;
  if (filters.subject !== 'all' && exam.subject !== filters.subject) return false;
  if (filters.status === 'live') { if (!isLiveExam(exam)) return false; } else if (filters.status === 'draft') {
    if (!['draft', 'rejected'].includes(exam.status)) return false;
  } else if (filters.status === 'work') {
    if (!['draft', 'rejected', 'pending', 'approved'].includes(exam.status)) return false;
  } else if (filters.status !== 'all' && exam.status !== filters.status) return false;
  if (filters.type !== 'all' && exam.type !== filters.type) return false;
  return examMatchesQuery(exam, filters.query);
}
export const filterExams = (exams, rawFilters) => exams.filter(exam => matchesExamFilters(exam, rawFilters));
export function examCounters(exams) {
  const counters = { total: exams.length, draft: 0, pending: 0, approved: 0, published: 0, completed: 0, archived: 0, questions: 0 };
  for (const exam of exams) {
    if (Object.hasOwn(counters, exam.status)) counters[exam.status] += 1;
    counters.questions += (exam.questions || []).length;
  }
  return counters;
}
export const classOptions = exams => [...new Set(exams.map(exam => exam.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'bn'));
export const subjectOptions = exams => [...new Set(exams.map(exam => exam.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'bn'));

/** One row per exam, exactly the columns the date-wise dashboard shows. */
export function examSummaryRow(exam, now = nowEpoch()) {
  return {
    id: exam.id,
    date: examDateKey(exam),
    title: exam.title,
    className: exam.className || 'সব শ্রেণি',
    group: exam.group || '',
    subject: exam.subject,
    questions: (exam.questions || []).length,
    marks: totalMarks(exam),
    duration: examDurationMinutes(exam),
    status: exam.status,
    createdBy: exam.createdBy || exam.teacherName || '—',
    createdAt: Number(exam.createdAt) || 0,
    startAt: Number(exam.startAt) || 0,
    endAt: Number(exam.endAt) || 0,
    ended: Number(exam.endAt) > 0 && Number(exam.endAt) <= Number(now)
  };
}
/** The workflow line, with the branch statuses folded onto their step. */
export function workflowSteps(status) {
  const reached = status === 'rejected' ? 'pending' : status;
  const position = EXAM_STATUS_ORDER.indexOf(reached);
  return EXAM_STATUS_ORDER.map((step, index) => ({
    step,
    label: EXAM_STATUSES[step],
    state: index < position ? 'done' : index === position ? 'current' : 'todo'
  }));
}

/* ---------------- Permissions -------------------------------------------------
   One place decides what a role may do with a record; the repository enforces
   the same rules server-side (locally: on the stored record). */
export function examPermissions(actor, exam, { attempts = 0, openAttempts = 0, now = nowEpoch() } = {}) {
  const role = actor?.role;
  const manager = role === 'manager';
  const admin = role === 'admin';
  const reviewer = manager || admin;
  const teacher = role === 'teacher';
  const expectedId = actor?.id && actor.id !== 'TCH-001' ? actor.id : currentTeacherId();
  const own = teacher && isOwnTeacherRecord(exam?.teacherId, expectedId);
  const editable = isEditableExam(exam) && attempts === 0 && (manager || own);
  const live = isLiveExam(exam);
  return {
    view: manager || admin || own,
    questions: manager || admin || own,
    edit: editable,
    duplicate: manager || (teacher && own),
    request: editable && ['draft', 'rejected'].includes(exam.status),
    review: reviewer && ['pending', 'draft', 'rejected'].includes(exam.status),
    approve: reviewer && ['pending', 'draft', 'rejected'].includes(exam.status) && Number(exam.startAt) > now,
    publish: reviewer && ['draft', 'pending', 'approved'].includes(exam.status) && Number(exam.startAt) > now,
    unpublish: reviewer && exam.status === 'published' && openAttempts === 0,
    complete: reviewer && live && Number(exam.endAt) <= now && openAttempts === 0,
    archive: reviewer && exam.status !== 'archived' && openAttempts === 0,
    restore: reviewer && exam.status === 'archived',
    remove: ['draft', 'rejected', 'archived'].includes(exam.status) && attempts === 0 && (manager || own),
    results: manager || admin || own,
    grade: (manager || admin || own) && live && exam.type !== 'mcq',
    reschedule: reviewer && exam.status !== 'archived' && attempts === 0
  };
}
