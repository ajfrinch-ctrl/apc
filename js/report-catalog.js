/* Reports catalog — what exists, who may run it, and how it is assembled.

   A report is a small declaration:

     {
       id, category, title, subtitle,
       roles:   ['admin', …]        who may even see it
       filters: ['class', …]        only these controls appear on screen
       period:  'tx' | … | null     which date the period filter applies to
       build:   async ctx → blocks  the data, taken straight from the app's own
                                    records — nothing is invented or hard-coded
     }

   `ctx` carries the snapshot (roster, transactions, exams, attempts, teaching
   activities, notices, routine), the chosen filters, the resolved period range
   and the actor with its scope. Builders return blocks; the layout engine in
   js/report-layout.js turns those blocks into the preview and the PDF.

   Two files make up the catalog:
     js/report-catalog.js   — categories, filter metadata, assembly (this file)
     js/report-builders.js  — the report builders themselves
*/
import { createReport, addHeading, addParagraph, addNote, addKeyValues, addTiles, addTable, addQuestions } from './report-layout.js';
import { periodRange, loadSnapshot, distinctBatches, distinctClasses, distinctSubjects, distinctTeachers, distinctCounters } from './report-sources.js';
import { listStaff, publicStaff, staffReportRows, staffCounts } from './staff-directory.js';
import { listTeacherAssignments } from './teacher-assignments.js';
import { BUILDERS } from './report-builders.js';

/* ---------- categories ---------- */

export const CATEGORIES = Object.freeze([
  { id: 'student', label: 'Student Reports', labelBn: 'শিক্ষার্থী রিপোর্ট', icon: 'students', descriptionBn: 'তালিকা, প্রোফাইল, শ্রেণি ও অবস্থাভিত্তিক শিক্ষার্থী রিপোর্ট' },
  { id: 'fee', label: 'Fee & Accounts', labelBn: 'ফি ও হিসাব', icon: 'wallet', descriptionBn: 'কালেকশন, বকেয়া, লেনদেন, রসিদ ও পেমেন্ট স্ট্যাটাস রিপোর্ট' },
  { id: 'cash', label: 'Cash Counter', labelBn: 'ক্যাশ কাউন্টার', icon: 'receipt', descriptionBn: 'ক্যাশ সংগ্রহ, ক্লোজিং, অনুমোদন ও নিজ লেনদেনের রিপোর্ট' },
  { id: 'academic', label: 'Academic', labelBn: 'একাডেমিক', icon: 'book', descriptionBn: 'ক্লাস, ব্যাচ, উপস্থিতি, অ্যাসাইনমেন্ট ও অগ্রগতি রিপোর্ট' },
  { id: 'exam', label: 'Examination', labelBn: 'পরীক্ষা', icon: 'exam', descriptionBn: 'পরীক্ষার তালিকা, প্রশ্নপত্র, উত্তর, মার্কশিট ও ফলাফল রিপোর্ট' },
  { id: 'result', label: 'Result', labelBn: 'ফলাফল', icon: 'result', descriptionBn: 'রেজাল্ট, মার্কস ও পারফরম্যান্স রিপোর্ট' },
  { id: 'notice', label: 'Notice', labelBn: 'নোটিশ', icon: 'notice', descriptionBn: 'প্রকাশিত, ইতিহাস ও শ্রেণিভিত্তিক নোটিশ রিপোর্ট' },
  { id: 'staff', label: 'Staff', labelBn: 'স্টাফ', icon: 'staff', descriptionBn: 'স্টাফ তালিকা, অ্যাসাইনমেন্ট ও কার্যক্রম রিপোর্ট' },
  { id: 'management', label: 'Management Summary', labelBn: 'ম্যানেজমেন্ট সারাংশ', icon: 'summary', descriptionBn: 'ব্যবস্থাপনার সারাংশ রিপোর্ট' },
  { id: 'mine', label: 'আমার রিপোর্ট', labelBn: 'আমার রিপোর্ট', icon: 'profile', descriptionBn: 'আমার পেমেন্ট, উপস্থিতি, পরীক্ষা ও ফলাফল রিপোর্ট' }
]);

/* ---------- filters (a report only ever shows the ones it declares) ---------- */

export const PERIODS = Object.freeze([
  { id: 'all', label: 'সব সময়' },
  { id: 'daily', label: 'Daily (একদিন)' },
  { id: 'weekly', label: 'Weekly (সপ্তাহ)' },
  { id: 'monthly', label: 'Monthly (মাস)' },
  { id: 'custom', label: 'Custom Date Range' }
]);

export const FILTER_META = Object.freeze({
  period: { label: 'সময়কাল', type: 'period' },
  class: { label: 'শ্রেণি', type: 'select', options: 'classes' },
  batch: { label: 'বিভাগ / ব্যাচ', type: 'select', options: 'batches' },
  student: { label: 'শিক্ষার্থী', type: 'select', options: 'students' },
  teacher: { label: 'শিক্ষক', type: 'select', options: 'teachers' },
  counter: { label: 'ক্যাশ কাউন্টার', type: 'select', options: 'counters' },
  subject: { label: 'বিষয়', type: 'select', options: 'subjects' },
  exam: { label: 'পরীক্ষা', type: 'select', options: 'exams' },
  status: { label: 'শিক্ষার্থীর অবস্থা', type: 'select', options: 'statuses' },
  paymentStatus: { label: 'পেমেন্ট স্ট্যাটাস', type: 'select', options: 'paymentStatuses' },
  resultStatus: { label: 'ফলাফল স্ট্যাটাস', type: 'select', options: 'resultStatuses' },
  approvalStatus: { label: 'অনুমোদন স্ট্যাটাস', type: 'select', options: 'approvalStatuses' },
  staffStatus: { label: 'স্টাফ স্ট্যাটাস', type: 'select', options: 'staffStatuses' }
});

export const OPTION_VALUES = Object.freeze({
  statuses: [
    { value: 'all', label: 'সব অবস্থা' },
    { value: 'approved', label: 'অনুমোদিত' },
    { value: 'pending', label: 'অপেক্ষমাণ' },
    { value: 'rejected', label: 'বাতিল' }
  ],
  paymentStatuses: [
    { value: 'all', label: 'সব' },
    { value: 'paid', label: 'পরিশোধিত' },
    { value: 'due', label: 'বকেয়া' },
    { value: 'partial', label: 'আংশিক' }
  ],
  resultStatuses: [
    { value: 'all', label: 'সব' },
    { value: 'pass', label: 'উত্তীর্ণ' },
    { value: 'fail', label: 'অনুত্তীর্ণ' },
    { value: 'absent', label: 'অনুপস্থিত' }
  ],
  approvalStatuses: [
    { value: 'all', label: 'সব' },
    { value: 'pending', label: 'অনুমোদনের অপেক্ষায়' },
    { value: 'approved', label: 'অনুমোদিত' },
    { value: 'rejected', label: 'বাতিল' }
  ],
  staffStatuses: [
    { value: 'all', label: 'সব স্ট্যাটাস' },
    { value: 'active', label: 'সক্রিয়' },
    { value: 'inactive', label: 'নিষ্ক্রিয়' },
    { value: 'suspended', label: 'স্থগিত' }
  ]
});

/* ---------- registry ---------- */

export const REPORTS = Object.freeze(BUILDERS);

export function findReport(id) {
  return REPORTS.find(report => report.id === id) || null;
}

/** The categories a role may open, each with only the reports it may run. */
export function catalogFor(role) {
  return CATEGORIES
    .map(category => ({
      ...category,
      reports: REPORTS.filter(report => report.category === category.id && (report.roles || []).includes(role))
    }))
    .filter(category => category.reports.length);
}

/* ---------- data for the filter bar ---------- */

/** Everything the filter dropdowns need, scoped to what the actor may see. */
export function filterOptions(snapshot, actor, scope) {
  const students = (snapshot.students || []).filter(student => inScope(student, actor, scope));
  const examsAll = snapshot.exams?.exams || [];
  const exams = (actor?.role === 'teacher' && scope) ? scopeExamsForOption(examsAll, scope) : examsAll;
  return {
    classes: distinctClasses(students).map(value => ({ value, label: value })),
    batches: distinctBatches(students).map(value => ({ value, label: value })),
    students: students
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'bn'))
      .map(student => ({ value: student.id, label: `${student.name} • ${student.id}` })),
    teachers: distinctTeachers(snapshot).map(value => ({ value, label: value })),
    counters: distinctCounters(snapshot.transactions || []).map(value => ({ value, label: value })),
    subjects: distinctSubjects(snapshot).map(value => ({ value, label: value })),
    exams: exams
      .slice()
      .sort((a, b) => (Number(b.startAt) || 0) - (Number(a.startAt) || 0))
      .map(exam => ({ value: exam.id, label: `${exam.title} • ${exam.subject || ''}`.trim() })),
    statuses: OPTION_VALUES.statuses,
    paymentStatuses: OPTION_VALUES.paymentStatuses,
    resultStatuses: OPTION_VALUES.resultStatuses,
    approvalStatuses: OPTION_VALUES.approvalStatuses,
    staffStatuses: OPTION_VALUES.staffStatuses
  };
}

function inScope(student, actor, scope) {
  if (!scope || scope.role !== 'teacher') return true;
  if (actor?.role === 'student') return String(student.id) === String(scope.studentId);
  const sameGroup = (a, b) => String(a || '').normalize('NFC').trim().replace(/\s*বিভাগ$/, '').trim()
    === String(b || '').normalize('NFC').trim().replace(/\s*বিভাগ$/, '').trim();
  return (scope.pairs || []).some(pair => pair.className === student.className && (!pair.group || sameGroup(pair.group, student.group)));
}

function scopeExamsForOption(exams, scope) {
  const sameGroup = (a, b) => String(a || '').normalize('NFC').trim().replace(/\s*বিভাগ$/, '').trim()
    === String(b || '').normalize('NFC').trim().replace(/\s*বিভাগ$/, '').trim();
  return exams.filter(exam => (scope.pairs || []).some(pair =>
    pair.className === exam.className
    && (!pair.group || !exam.group || sameGroup(pair.group, exam.group))
    && (!pair.subject || !exam.subject || pair.subject === exam.subject)
  ));
}

/* ---------- assembly ---------- */

/** Resolve the period selection into the range the builders filter on. */
export function resolvePeriod(filters = {}) {
  const period = filters.period || 'all';
  return periodRange(period, {
    date: filters.date,
    week: filters.week,
    month: filters.month,
    from: filters.from,
    to: filters.to
  });
}

/** A custom range must satisfy From ≤ To; the UI refuses it before this point. */
export function validateFilters(definition, filters = {}) {
  if ((definition.filters || []).includes('period') && filters.period === 'custom') {
    const from = filters.from ? String(filters.from) : '';
    const to = filters.to ? String(filters.to) : '';
    if (!from || !to) return 'From Date ও To Date উভয়ই দিন।';
    if (from > to) return 'From Date অবশ্যই To Date-এর আগে বা সমান হতে হবে।';
  }
  if ((definition.filters || []).includes('exam') && definition.requiresExam && !filters.examId) {
    return 'একটি পরীক্ষা নির্বাচন করুন।';
  }
  if ((definition.filters || []).includes('student') && definition.requiresStudent && !filters.studentId) {
    return 'একজন শিক্ষার্থী নির্বাচন করুন।';
  }
  return '';
}

/** Blocks → layout document. Every block maps to one engine primitive. */
function applyBlocks(doc, blocks = []) {
  for (const item of blocks) {
    if (!item) continue;
    if (item.type === 'heading') addHeading(doc, item.text, { size: item.size || 13 });
    else if (item.type === 'paragraph') addParagraph(doc, item.text, { size: item.size || 11, weight: item.weight || 400, color: item.color });
    else if (item.type === 'note') addNote(doc, item.text);
    else if (item.type === 'keyValues') addKeyValues(doc, item.pairs, { columns: item.columns || 2 });
    else if (item.type === 'tiles') addTiles(doc, item.tiles, { perRow: item.perRow || 4 });
    else if (item.type === 'table') addTable(doc, { columns: item.columns, rows: item.rows, title: item.title || '', zebra: item.zebra !== false });
    else if (item.type === 'questions') addQuestions(doc, item.questions, { showAnswer: item.showAnswer !== false, showStudent: Boolean(item.showStudent) });
  }
}

/**
 * True when at least one block carries real records.
 * Summary tiles are chrome: a tile reading ০ is the report saying "nothing
 * matched", so an empty result is an empty report, not a page of zeroes.
 */
export function blocksHaveData(blocks = []) {
  return blocks.some(item => item && (
    (item.type === 'table' && (item.rows || []).length)
    || (item.type === 'questions' && (item.questions || []).length)
    || (item.type === 'keyValues' && (item.pairs || []).length)
  ));
}

/* §Report Center: when the chosen filters match nothing, the preview still opens
   and says exactly this — never a page of zeroes, never an invented row. */
export const EMPTY_MESSAGE = 'কোনো তথ্য পাওয়া যায়নি।';

/**
 * Build one report.
 * Throws { code: 'FORBIDDEN' } when the actor may not run it (checked by the
 * caller through report-access.js) and returns the layout document otherwise.
 */
export async function buildReportDocument(definition, { filters = {}, actor, scope, snapshot } = {}) {
  const data = snapshot || loadSnapshot();
  const range = resolvePeriod(filters);
  const ctx = {
    snapshot: data,
    filters,
    range,
    actor,
    scope,
    /* Staff rows are copies with the password stripped — see publicStaff(). */
    staff: async () => ((await listStaff()) || []).map(publicStaff),
    staffRows: (list, options) => staffReportRows(list || [], options || {}),
    staffCounts: list => staffCounts(list || []),
    /* Assignments live per teacher in js/teacher-assignments.js; the admin
       report walks every teacher with the same public reader. */
    assignments: async () => {
      const staff = (await listStaff()) || [];
      const rows = [];
      for (const record of staff) {
        if (record.role !== 'teacher' || !record.username) continue;
        for (const item of listTeacherAssignments(record.username)) {
          rows.push({ teacherName: record.fullName || item.teacherName, teacherUsername: record.username, ...item });
        }
      }
      return rows;
    }
  };
  const built = await definition.build(ctx);
  const blocks = (built && built.blocks) || [];
  const doc = createReport({
    title: definition.title,
    subtitle: definition.subtitle || (built && built.subtitle) || '',
    period: (built && built.period) || range.label || '',
    scopeLines: (built && built.scopeLines) || [],
    note: (built && built.note) || ''
  });
  applyBlocks(doc, blocks);
  return { doc, blocks, empty: !blocksHaveData(blocks) };
}
