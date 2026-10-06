/* Report builders — data → blocks, one function per report.

   Every builder receives:
     ctx.snapshot  the app's own records (roster, transactions, exams, attempts,
                   teaching activities, notices, routine)
     ctx.filters   what the user chose, already through enforceAccess()
     ctx.range     the resolved period (from/to/label)
     ctx.actor     who is asking
     ctx.scope     the records they are allowed to reach

   and returns `{ scopeLines, blocks }`. Nothing here invents a number: totals
   are reduced over the very rows the report prints, and each record is counted
   once (a student's best attempt, one ledger row per transaction).

   This module is free of DOM work so it can be unit-tested directly. */
import { toBanglaNumber as bn } from './ui.js';
import { number as toNumber, parseDate, formatDate, monthLabelOf, inRange, txTime,
  studentEnrolledAt, activityTime, monthlyFeeOf, dueSummary, studentStatusLabel, examTime,
  examDuration, isPublishedExam, isTakenExam, isUpcomingExam, bestAttempts, submittedAttempts,
  resultFor, questionBreakdown, attemptCounters, attendanceStats, ACTIVITY_LABELS,
  PROGRESS_TEXT, totalMarks, gradeFor, EXAM_TYPES, EXAM_STATUSES} from './report-sources.js';
import { scopeStudents, scopeActivities, scopeExams, ownStudent } from './report-access.js';

/* ---------- formatting ---------- */

const dash = value => (value === undefined || value === null || String(value).trim() === '' ? '—' : String(value));
const num = value => bn(Math.round(Number(value) || 0));
const money = value => `৳${bn(Math.round(Number(value) || 0).toLocaleString('en-US'))}`;
const percent = value => `${bn(Math.round(Number(value) || 0))}%`;
/** The ledger stores a display date; an ISO stamp is formatted, never printed raw. */
const dateLabel = value => (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim())
  ? formatDate(parseDate(value)) : dash(value));
const ratio = (part, whole) => (Number(whole) ? percent(Number(part) / Number(whole) * 100) : '—');

/* ---------- shared block shapes ---------- */

const table = (columns, rows, title = '') => ({ type: 'table', columns, rows, title });
const kv = (pairs, columns = 2) => ({ type: 'keyValues', pairs, columns });
const tiles = (list, perRow = 4) => ({ type: 'tiles', tiles: list, perRow });
const heading = text => ({ type: 'heading', text });
const para = text => ({ type: 'paragraph', text });
const note = text => ({ type: 'note', text });
const questions = (list, options = {}) => ({ type: 'questions', questions: list, ...options });

/* ---------- shared column sets ---------- */

const STUDENT_COLUMNS = () => ([
  { label: 'Student ID', width: 1.1 },
  { label: 'নাম', width: 1.7 },
  { label: 'শ্রেণি', width: 1.2 },
  { label: 'বিভাগ', width: 1.1 },
  { label: 'মোবাইল', width: 1.2 },
  { label: 'অভিভাবক', width: 1.2 },
  { label: 'স্ট্যাটাস', width: 0.9 }
]);

const studentRow = student => ([
  dash(student.id),
  dash(student.name),
  dash(student.className),
  dash(student.group || 'সাধারণ'),
  student.mobile ? bn(String(student.mobile)) : '—',
  student.guardianMobile ? bn(String(student.guardianMobile)) : '—',
  studentStatusLabel[student.status] || dash(student.status)
]);

/** Fee/transaction columns: everything the accounts office asks for. */
const TX_COLUMNS = () => ([
  { label: 'তারিখ', width: 1.1 },
  { label: 'রসিদ নং', width: 1.4 },
  { label: 'Student ID', width: 1.1 },
  { label: 'শিক্ষার্থী', width: 1.5 },
  { label: 'শ্রেণি', width: 1 },
  { label: 'বিভাগ', width: 1 },
  { label: 'ফি ও মাস', width: 1.3 },
  { label: 'পরিমাণ', width: 0.9, align: 'right', emphasis: true },
  { label: 'মাধ্যম', width: 1 },
  { label: 'অনুমোদন', width: 1 },
  { label: 'আদায়কারী', width: 1.2 }
]);

const approvalLabel = tx => (
  tx.status === 'pending' ? 'অপেক্ষমাণ' : tx.status === 'rejected' ? 'বাতিল' : 'অনুমোদিত'
);

const txRow = (tx, studentMap) => {
  const student = studentMap.get(String(tx.studentId)) || {};
  return [
    dateLabel(tx.date),
    dash(tx.receiptNo || tx.id),
    dash(tx.studentId),
    dash(tx.studentName || student.name),
    dash(tx.className || student.className),
    dash(student.group || 'সাধারণ'),
    `${dash(tx.feeType)} • ${dash(tx.month)}`,
    money(tx.amount),
    dash(tx.method),
    approvalLabel(tx),
    dash(tx.collectedBy || 'এডমিন')
  ];
};

const ATTENDANCE_COLUMNS = () => ([
  { label: 'তারিখ', width: 1.1 },
  { label: 'বিষয়', width: 1.4 },
  { label: 'শিক্ষার্থী', width: 1.6 },
  { label: 'Student ID', width: 1.1 },
  { label: 'শ্রেণি', width: 1.1 },
  { label: 'বিভাগ', width: 1 },
  { label: 'অবস্থা', width: 1 }
]);

const RESULT_COLUMNS = () => ([
  { label: 'র‍্যাংক', width: 0.7 },
  { label: 'Student ID', width: 1.1 },
  { label: 'শিক্ষার্থী', width: 1.6 },
  { label: 'শ্রেণি', width: 1.1 },
  { label: 'বিভাগ', width: 1 },
  { label: 'প্রাপ্ত নম্বর', width: 1 },
  { label: 'মোট নম্বর', width: 1 },
  { label: 'শতাংশ', width: 0.9 },
  { label: 'গ্রেড', width: 0.7 },
  { label: 'ফলাফল', width: 0.9 }
]);

/* ---------- scoped selections ---------- */

function studentMapOf(snapshot) {
  return new Map((snapshot.students || []).map(student => [String(student.id), student]));
}

function studentsFor(ctx) {
  let list = (ctx.snapshot.students || []).slice();
  if (ctx.actor?.role === 'student') list = ownStudent(list, ctx.scope?.studentId);
  else list = scopeStudents(list, ctx.actor, ctx.scope);
  const { className, batch, status, studentId } = ctx.filters;
  if (studentId) list = list.filter(student => String(student.id) === String(studentId));
  if (className && className !== 'all') list = list.filter(student => student.className === className);
  if (batch && batch !== 'all') list = list.filter(student => (student.group || 'সাধারণ') === batch);
  if (status && status !== 'all') {
    list = list.filter(student => (student.status === status) || (status === 'approved' && student.status === 'active'));
  }
  return list;
}

function transactionsFor(ctx, { period = true } = {}) {
  let list = (ctx.snapshot.transactions || []).slice();
  if (ctx.actor?.role === 'student') list = list.filter(tx => String(tx.studentId) === String(ctx.scope?.studentId));
  if (period) list = list.filter(tx => inRange(txTime(tx), ctx.range));
  const { className, batch, studentId, counter, approvalStatus, method } = ctx.filters;
  const map = studentMapOf(ctx.snapshot);
  if (studentId) list = list.filter(tx => String(tx.studentId) === String(studentId));
  if (className && className !== 'all') {
    list = list.filter(tx => tx.className === className || map.get(String(tx.studentId))?.className === className);
  }
  if (batch && batch !== 'all') {
    list = list.filter(tx => (map.get(String(tx.studentId))?.group || 'সাধারণ') === batch);
  }
  if (counter && counter !== 'all') list = list.filter(tx => (tx.collectedBy || 'এডমিন') === counter);
  if (approvalStatus && approvalStatus !== 'all') list = list.filter(tx => (tx.status || 'approved') === approvalStatus);
  if (method && method !== 'all') list = list.filter(tx => tx.method === method);
  return list.sort((a, b) => (txTime(b) || 0) - (txTime(a) || 0));
}

function examsFor(ctx, { period = false, publishedOnly = false } = {}) {
  let list = (ctx.snapshot.exams?.exams || []).slice();
  list = scopeExams(list, ctx.actor, ctx.scope);
  if (publishedOnly) list = list.filter(isPublishedExam);
  const { examId, className, batch, subject, teacher } = ctx.filters;
  if (examId) list = list.filter(exam => exam.id === examId);
  if (className && className !== 'all') list = list.filter(exam => !exam.className || exam.className === className);
  if (batch && batch !== 'all') {
    const key = value => String(value || '').normalize('NFC').trim().replace(/\s*বিভাগ$/, '').trim();
    list = list.filter(exam => !exam.group || key(exam.group) === key(batch));
  }
  if (subject && subject !== 'all') list = list.filter(exam => exam.subject === subject);
  if (teacher && teacher !== 'all') list = list.filter(exam => exam.teacherName === teacher);
  if (period) list = list.filter(exam => inRange(examTime(exam), ctx.range));
  return list.sort((a, b) => (examTime(b) || 0) - (examTime(a) || 0));
}

function activitiesFor(ctx, types = null) {
  let list = (ctx.snapshot.teaching?.activities || []).slice();
  list = scopeActivities(list, ctx.actor, ctx.scope);
  if (types) list = list.filter(activity => types.includes(activity.type));
  const { className, batch, subject, teacher } = ctx.filters;
  if (className && className !== 'all') list = list.filter(activity => activity.className === className);
  if (batch && batch !== 'all') {
    const key = value => String(value || '').normalize('NFC').trim().replace(/\s*বিভাগ$/, '').trim();
    list = list.filter(activity => !activity.group || key(activity.group) === key(batch));
  }
  if (subject && subject !== 'all') list = list.filter(activity => activity.subject === subject);
  if (teacher && teacher !== 'all') list = list.filter(activity => activity.teacherName === teacher);
  list = list.filter(activity => inRange(activityTime(activity), ctx.range));
  return list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function noticesFor(ctx, { period = false } = {}) {
  let list = (ctx.snapshot.notices || []).slice();
  if (ctx.actor?.role === 'student') {
    // A student only ever receives notices meant for them.
    const student = studentMapOf(ctx.snapshot).get(String(ctx.scope?.studentId || '')) || {};
    list = list.filter(item => {
      const audience = String(item.audience || 'সব শিক্ষার্থী');
      return audience === 'সব শিক্ষার্থী'
        || (student.className && audience.includes(student.className))
        || (student.group && audience.includes(student.group));
    });
  }
  if (period && ctx.filters.period !== 'all') list = list.filter(item => inRange(noticeTime(item), ctx.range));
  return list.sort((a, b) => (noticeTime(b) || 0) - (noticeTime(a) || 0));
}

const scopeLine = ctx => {
  const lines = [];
  const { className, batch, studentId, subject, counter } = ctx.filters || {};
  if (className && className !== 'all') lines.push(`শ্রেণি: ${className}`);
  if (batch && batch !== 'all') lines.push(`বিভাগ: ${batch}`);
  if (subject && subject !== 'all') lines.push(`বিষয়: ${subject}`);
  if (counter && counter !== 'all') lines.push(`কাউন্টার: ${counter}`);
  if (studentId) {
    const student = studentMapOf(ctx.snapshot).get(String(studentId));
    if (student) lines.push(`শিক্ষার্থী: ${student.name} (${student.id})`);
  }
  if (ctx.actor?.role === 'teacher' && ctx.scope?.classes?.length) lines.push(`আমার assignment: ${ctx.scope.classes.join(', ')}`);
  return lines;
};

/** Exam information block — the header every examination report opens with. */
function examInfoBlock(exam) {
  const total = totalMarks(exam);
  return kv([
    ['পরীক্ষার নাম', exam.title],
    ['Exam ID', exam.id],
    ['বিষয়', exam.subject || '—'],
    ['শ্রেণি', exam.className || 'সব শ্রেণি'],
    ['বিভাগ / ব্যাচ', exam.group || 'সব'],
    ['পরীক্ষার ধরন', EXAM_TYPES[exam.type] || exam.type],
    ['তারিখ', examTime(exam) ? formatDate(examTime(exam)) : '—'],
    ['সময়কাল', examDuration(exam)],
    ['মোট প্রশ্ন', num((exam.questions || []).length)],
    ['মোট নম্বর', num(total)],
    ['পাস নম্বর', num(Math.ceil(total * (Number(exam.passPercent) || 33) / 100))],
    ['নেগেটিভ মার্ক', exam.type === 'mcq' ? num(exam.negative) : 'প্রযোজ্য নয়']
  ], 3);
}

/**
 * Question rows for printing: every question in order, every option, with the
 * marks and the obtained marks in Bengali. Nothing is abbreviated — a 50
 * question paper prints 50 questions.
 */
function questionRows(exam, attempt) {
  return questionBreakdown(exam, attempt, { withOptions: true })
    .map(row => ({ ...row, no: `প্রশ্ন ${row.no}`, marks: num(row.marks), obtained: num(row.obtained) }));
}

/** Only finalized (approved) money counts toward a collection total. */
const isFinalized = tx => tx.status == null || tx.status === 'approved';
const sumAmount = rows => rows.reduce((sum, tx) => sum + (isFinalized(tx) ? toNumber(tx.amount) : 0), 0);

export {
  dash, num, money, percent, ratio, table, kv, tiles, heading, para, note, questions,
  STUDENT_COLUMNS, studentRow, TX_COLUMNS, txRow, ATTENDANCE_COLUMNS, RESULT_COLUMNS,
  studentMapOf, studentsFor, transactionsFor, examsFor, activitiesFor, noticesFor,
  scopeLine, examInfoBlock, isFinalized, sumAmount, attendanceStats, PROGRESS_TEXT, ACTIVITY_LABELS
};

/* ==========================================================================
   A. STUDENT REPORTS
   ========================================================================== */

const studentList = ({ title, subtitle, filter }) => ({
  id: `student.${filter}`,
  category: 'student',
  title,
  subtitle,
  roles: ['admin', 'manager'],
  filters: ['class', 'batch', 'status'],
  period: 'enrolled',
  async build(ctx) {
    const students = studentsFor(ctx);
    const list = filter === 'all' ? students : students.filter(student => (
      filter === 'approved' ? ['approved', 'active'].includes(student.status)
        : student.status === filter
    ));
    const enrolled = list.filter(student => inRange(studentEnrolledAt(student), ctx.range));
    const rows = (filter === 'enrolled' ? list : enrolled).map(studentRow);
    return {
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট শিক্ষার্থী', value: num(enrolled.length) },
          { label: 'অনুমোদিত', value: num(enrolled.filter(s => ['approved', 'active'].includes(s.status)).length) },
          { label: 'অপেক্ষমাণ', value: num(enrolled.filter(s => s.status === 'pending').length) },
          { label: 'বাতিল', value: num(enrolled.filter(s => s.status === 'rejected').length) }
        ]),
        table(STUDENT_COLUMNS(), rows, 'শিক্ষার্থীর তালিকা')
      ]
    };
  }
});

const studentProfile = {
  id: 'student.profile',
  category: 'student',
  title: 'Student Profile Report',
  subtitle: 'একজন শিক্ষার্থীর পূর্ণ প্রোফাইল — পরিচয়, ফি, উপস্থিতি ও ফলাফল',
  roles: ['admin', 'manager', 'student'],
  filters: ['student'],
  requiresStudent: true,
  async build(ctx) {
    const students = studentsFor(ctx);
    if (!students.length) return { scopeLines: scopeLine(ctx), blocks: [] };
    const student = students[0];
    const month = monthLabelOf(Date.now());
    const own = (ctx.snapshot.transactions || []).filter(tx => String(tx.studentId) === String(student.id));
    const summary = dueSummary(student, own, month);
    const attendance = activitiesFor(ctx, ['routine']);
    const results = (ctx.snapshot.exams?.exams || []).flatMap(exam => {
      const attempt = bestAttempts(ctx.snapshot.exams?.attempts || [], exam.id)
        .find(item => String(item.studentId) === String(student.id));
      if (!attempt) return [];
      const result = resultFor(exam, attempt);
      return [{
        exam: exam.title,
        subject: exam.subject,
        date: examTime(exam) ? formatDate(examTime(exam)) : '—',
        score: result.score,
        total: result.total,
        percentLabel: result.percentLabel,
        grade: result.grade,
        pass: result.pass ? 'উত্তীর্ণ' : 'অনুত্তীর্ণ'
      }];
    });
    const present = attendance.filter(activity => activity.progress?.[student.id]?.value === 'present').length;
    const absent = attendance.filter(activity => activity.progress?.[student.id]?.value === 'absent').length;
    const late = attendance.filter(activity => activity.progress?.[student.id]?.value === 'late').length;
    const sessions = present + absent + late;

    return {
      scopeLines: [`শিক্ষার্থী: ${student.name} (${student.id})`],
      blocks: [
        kv([
          ['Student ID', student.id],
          ['নাম', student.name],
          ['নাম (ইংরেজি)', student.nameEn || '—'],
          ['পিতার নাম', student.fatherName || '—'],
          ['শ্রেণি', student.className],
          ['বিভাগ', student.group || 'সাধারণ'],
          ['মোবাইল', student.mobile ? bn(String(student.mobile)) : '—'],
          ['অভিভাবক', student.guardianMobile ? bn(String(student.guardianMobile)) : '—'],
          ['স্ট্যাটাস', studentStatusLabel[student.status] || student.status],
          ['মাসিক বেতন', money(monthlyFeeOf(student))],
          ['চলতি মাস', month],
          ['ভর্তির তারিখ', student.enrolledAt || '—']
        ], 3),
        tiles([
          { label: 'মোট পরিশোধ', value: money(own.filter(isFinalized).reduce((sum, tx) => sum + toNumber(tx.amount), 0)) },
          { label: 'চলতি মাসের বকেয়া', value: money(summary.due) },
          { label: 'উপস্থিতি', value: sessions ? ratio(present + late, sessions) : '—' },
          { label: 'গড় ফলাফল', value: results.length ? ratio(results.reduce((sum, r) => sum + Number(r.percentLabel.replace(/[^\d.]/g, '')) || 0, 0) / results.length, 100) : '—' }
        ]),
        heading('সাম্প্রতিক পেমেন্ট'),
        table(TX_COLUMNS(), own.slice().sort((a, b) => (txTime(b) || 0) - (txTime(a) || 0)).slice(0, 30).map(tx => txRow(tx, studentMapOf(ctx.snapshot)))),
        heading('উপস্থিতির সারাংশ'),
        kv([
          ['মোট সেশন', num(sessions)],
          ['উপস্থিত', num(present)],
          ['দেরিতে', num(late)],
          ['অনুপস্থিত', num(absent)]
        ], 4),
        heading('পরীক্ষার ফলাফল'),
        table([
          { label: 'পরীক্ষা', width: 2 }, { label: 'বিষয়', width: 1.2 }, { label: 'তারিখ', width: 1.1 },
          { label: 'প্রাপ্ত নম্বর', width: 1 }, { label: 'মোট নম্বর', width: 1 }, { label: 'শতাংশ', width: 0.9 },
          { label: 'গ্রেড', width: 0.7 }, { label: 'ফলাফল', width: 1 }
        ], results.map(item => [item.exam, item.subject, item.date, num(item.score), num(item.total), item.percentLabel, item.grade, item.pass]))
      ]
    };
  }
};

const studentClassWise = {
  id: 'student.class-wise',
  category: 'student',
  title: 'Class-wise Student Report',
  subtitle: 'নির্বাচিত শ্রেণির শিক্ষার্থী — যোগাযোগ, ফি ও একাডেমিক সারাংশ',
  roles: ['admin', 'manager'],
  filters: ['class', 'batch', 'status'],
  async build(ctx) {
    const students = studentsFor(ctx);
    const map = studentMapOf(ctx.snapshot);
    const month = monthLabelOf(Date.now());
    const rows = students.map(student => {
      const summary = dueSummary(student, (ctx.snapshot.transactions || []).filter(tx => String(tx.studentId) === String(student.id)), month);
      return [
        dash(student.id), dash(student.name), dash(student.group || 'সাধারণ'),
        student.mobile ? bn(String(student.mobile)) : '—',
        studentStatusLabel[student.status] || dash(student.status),
        money(summary.monthlyFee), money(summary.paid), money(summary.due)
      ];
    });
    const totalDue = students.reduce((sum, student) => sum + dueSummary(student, (ctx.snapshot.transactions || []).filter(tx => String(tx.studentId) === String(student.id)), month).due, 0);
    return {
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট শিক্ষার্থী', value: num(students.length) },
          { label: 'অনুমোদিত', value: num(students.filter(s => ['approved', 'active'].includes(s.status)).length) },
          { label: 'মোট বকেয়া', value: money(totalDue) },
          { label: 'শ্রেণি', value: ctx.filters.className && ctx.filters.className !== 'all' ? ctx.filters.className : 'সব' }
        ]),
        table([
          { label: 'Student ID', width: 1.1 }, { label: 'নাম', width: 1.7 }, { label: 'বিভাগ', width: 1.1 },
          { label: 'মোবাইল', width: 1.2 }, { label: 'স্ট্যাটাস', width: 0.9 },
          { label: 'মাসিক ফি', width: 1 }, { label: 'পরিশোধিত', width: 1 }, { label: 'বকেয়া', width: 1, emphasis: true }
        ], rows, 'শ্রেণিভিত্তিক তালিকা')
      ]
    };
  }
};

const studentBatchWise = {
  id: 'student.batch-wise',
  category: 'student',
  title: 'Batch-wise Student Report',
  subtitle: 'বিভাগ / ব্যাচ অনুযায়ী শিক্ষার্থীর তালিকা',
  roles: ['admin', 'manager'],
  filters: ['class', 'batch', 'status'],
  async build(ctx) {
    const students = studentsFor(ctx);
    const groups = new Map();
    for (const student of students) {
      const key = student.group || 'সাধারণ';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(student);
    }
    const blocks = [
      tiles([
        { label: 'মোট শিক্ষার্থী', value: num(students.length) },
        { label: 'বিভাগ', value: num(groups.size) }
      ], 4)
    ];
    for (const [batch, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'bn'))) {
      blocks.push(heading(`বিভাগ: ${batch} • ${num(list.length)} জন`));
      blocks.push(table(STUDENT_COLUMNS(), list.map(studentRow)));
    }
    return { scopeLines: scopeLine(ctx), blocks };
  }
};

const studentStatusReport = {
  id: 'student.status',
  category: 'student',
  title: 'Student Status Report',
  subtitle: 'অবস্থা অনুযায়ী শিক্ষার্থীর সারাংশ ও তালিকা',
  roles: ['admin', 'manager'],
  filters: ['class', 'batch'],
  async build(ctx) {
    const students = studentsFor(ctx);
    const counts = ['approved', 'pending', 'rejected'].map(status => ({
      status,
      label: studentStatusLabel[status] || status,
      count: students.filter(student => student.status === status || (status === 'approved' && student.status === 'active')).length
    }));
    return {
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles(counts.map(item => ({ label: item.label, value: num(item.count) })), 4),
        table([
          { label: 'অবস্থা', width: 1.4 }, { label: 'শিক্ষার্থী', width: 1, align: 'right' }, { label: 'শতাংশ', width: 1, align: 'right' }
        ], counts.map(item => [item.label, num(item.count), ratio(item.count, students.length)])),
        heading('বিস্তারিত তালিকা'),
        table(STUDENT_COLUMNS(), students.map(studentRow))
      ]
    };
  }
};

/* ==========================================================================
   B. FEE & ACCOUNTS REPORTS
   ========================================================================== */

/** The four period reports share one builder; only the period differs. */
const collectionReport = ({ id, title, subtitle, period, roles }) => ({
  id,
  category: 'fee',
  title,
  subtitle,
  roles: roles || ['admin', 'manager', 'cash'],
  filters: ['period', 'class', 'batch', 'approvalStatus'],
  period: 'tx',
  defaultPeriod: period,
  async build(ctx) {
    const rows = transactionsFor(ctx);
    const map = studentMapOf(ctx.snapshot);
    const approved = rows.filter(isFinalized);
    const pending = rows.filter(tx => tx.status === 'pending');
    const rejected = rows.filter(tx => tx.status === 'rejected');
    const byMethod = new Map();
    for (const tx of approved) byMethod.set(tx.method || '—', (byMethod.get(tx.method || '—') || 0) + toNumber(tx.amount));
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট আদায় (অনুমোদিত)', value: money(sumAmount(rows)) },
          { label: 'লেনদেন', value: num(approved.length) },
          { label: 'অপেক্ষমাণ', value: num(pending.length) },
          { label: 'গড় আদায়', value: money(approved.length ? sumAmount(rows) / approved.length : 0) }
        ]),
        table([{ label: 'মাধ্যম', width: 1.6 }, { label: 'লেনদেন', width: 1, align: 'right' }, { label: 'পরিমাণ', width: 1.2, align: 'right', emphasis: true }],
          [...byMethod.entries()].map(([method, amount]) => [method, num(approved.filter(tx => (tx.method || '—') === method).length), money(amount)]),
          'মাধ্যমভিত্তিক আদায়'),
        table(TX_COLUMNS(), rows.map(tx => txRow(tx, map)), 'লেনদেনের তালিকা'),
        note(`নোট: অনুমোদিত ${num(approved.length)} টি, অপেক্ষমাণ ${num(pending.length)} টি, বাতিল ${num(rejected.length)} টি। Manager অনুমোদনের পর লেনদেন চূড়ান্ত হিসাবে গণ্য হয়।`)
      ]
    };
  }
});

const feeStudentWise = {
  id: 'fee.student-wise',
  category: 'fee',
  title: 'Student-wise Payment Report',
  subtitle: 'নির্বাচিত শিক্ষার্থীর সব পেমেন্ট ও বকেয়া',
  roles: ['admin', 'manager', 'cash'],
  filters: ['period', 'student'],
  period: 'tx',
  requiresStudent: true,
  async build(ctx) {
    const rows = transactionsFor(ctx);
    const map = studentMapOf(ctx.snapshot);
    const student = map.get(String(ctx.filters.studentId)) || null;
    const month = monthLabelOf(Date.now());
    const summary = student ? dueSummary(student, ctx.snapshot.transactions || [], month) : null;
    const blocks = [];
    if (student) {
      blocks.push(kv([
        ['Student ID', student.id], ['নাম', student.name], ['শ্রেণি', student.className],
        ['বিভাগ', student.group || 'সাধারণ'], ['মাসিক বেতন', money(monthlyFeeOf(student))],
        ['চলতি মাসে পরিশোধ', money(summary.paid)], ['বকেয়া', money(summary.due)]
      ], 3));
    }
    blocks.push(tiles([
      { label: 'মোট পরিশোধ', value: money(sumAmount(rows)) },
      { label: 'লেনদেন', value: num(rows.length) },
      { label: 'চলতি বকেয়া', value: money(summary ? summary.due : 0) }
    ], 4));
    blocks.push(table(TX_COLUMNS(), rows.map(tx => txRow(tx, map)), 'পেমেন্টের তালিকা'));
    return { period: ctx.range.label, scopeLines: scopeLine(ctx), blocks };
  }
};

const feeByGroup = ({ id, title, groupBy, roles }) => ({
  id,
  category: 'fee',
  title,
  subtitle: groupBy === 'class' ? 'শ্রেণিভিত্তিক আদায়ের সারাংশ' : 'বিভাগভিত্তিক আদায়ের সারাংশ',
  roles: roles || ['admin', 'manager'],
  filters: ['period', 'class', 'batch', 'approvalStatus'],
  period: 'tx',
  async build(ctx) {
    const rows = transactionsFor(ctx);
    const map = studentMapOf(ctx.snapshot);
    const groups = new Map();
    for (const tx of rows) {
      const student = map.get(String(tx.studentId)) || {};
      const key = groupBy === 'class' ? (tx.className || student.className || '—') : (student.group || 'সাধারণ');
      if (!groups.has(key)) groups.set(key, { key, count: 0, amount: 0, students: new Set() });
      const entry = groups.get(key);
      entry.students.add(String(tx.studentId));
      if (isFinalized(tx)) { entry.count += 1; entry.amount += toNumber(tx.amount); }
    }
    const list = [...groups.values()].sort((a, b) => b.amount - a.amount);
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট আদায়', value: money(list.reduce((sum, item) => sum + item.amount, 0)) },
          { label: groupBy === 'class' ? 'শ্রেণি' : 'বিভাগ', value: num(list.length) },
          { label: 'লেনদেন', value: num(list.reduce((sum, item) => sum + item.count, 0)) },
          { label: 'শিক্ষার্থী', value: num(list.reduce((sum, item) => sum + item.students.size, 0)) }
        ]),
        table([
          { label: groupBy === 'class' ? 'শ্রেণি' : 'বিভাগ', width: 1.8 },
          { label: 'শিক্ষার্থী', width: 1, align: 'right' },
          { label: 'লেনদেন', width: 1, align: 'right' },
          { label: 'আদায়', width: 1.2, align: 'right', emphasis: true },
          { label: 'গড়', width: 1, align: 'right' }
        ], list.map(item => [item.key, num(item.students.size), num(item.count), money(item.amount), money(item.count ? item.amount / item.count : 0)])),
        heading('লেনদেনের তালিকা'),
        table(TX_COLUMNS(), rows.map(tx => txRow(tx, map)))
      ]
    };
  }
});

const feeDueList = {
  id: 'fee.due-list',
  category: 'fee',
  title: 'Due List Report',
  subtitle: 'নির্বাচিত মাসের বকেয়া তালিকা',
  roles: ['admin', 'manager'],
  filters: ['class', 'batch', 'student'],
  period: 'monthly',
  async build(ctx) {
    const month = ctx.range.label && ctx.filters.period !== 'all' && ctx.filters.period !== 'custom'
      ? monthLabelOf(ctx.range.from) : monthLabelOf(Date.now());
    const students = studentsFor(ctx).filter(student => ['approved', 'active'].includes(student.status));
    const rows = [];
    let total = 0;
    for (const student of students) {
      const summary = dueSummary(student, ctx.snapshot.transactions || [], month);
      if (summary.due <= 0) continue;
      total += summary.due;
      rows.push([
        dash(student.id), dash(student.name), dash(student.className), dash(student.group || 'সাধারণ'),
        student.mobile ? bn(String(student.mobile)) : '—',
        money(summary.monthlyFee), money(summary.paid), money(summary.due)
      ]);
    }
    return {
      period: month,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট বকেয়া', value: money(total) },
          { label: 'বকেয়া শিক্ষার্থী', value: num(rows.length) },
          { label: 'গড় বকেয়া', value: money(rows.length ? total / rows.length : 0) }
        ], 4),
        table([
          { label: 'Student ID', width: 1.1 }, { label: 'নাম', width: 1.7 }, { label: 'শ্রেণি', width: 1.1 },
          { label: 'বিভাগ', width: 1 }, { label: 'মোবাইল', width: 1.2 },
          { label: 'মাসিক ফি', width: 1 }, { label: 'পরিশোধিত', width: 1 }, { label: 'বকেয়া', width: 1, emphasis: true }
        ], rows, 'বকেয়া তালিকা')
      ]
    };
  }
};

const feeDueCollection = {
  id: 'fee.due-collection',
  category: 'fee',
  title: 'Due Collection Report',
  subtitle: 'নির্বাচিত সময়ে বকেয়া থেকে আদায়কৃত পরিমাণ',
  roles: ['admin', 'manager', 'cash'],
  filters: ['period', 'class', 'batch'],
  period: 'tx',
  async build(ctx) {
    const month = monthLabelOf(ctx.range.from === -Infinity ? Date.now() : ctx.range.from);
    const students = studentsFor(ctx);
    const ids = new Set(students.map(student => String(student.id)));
    const payments = transactionsFor(ctx).filter(tx => ids.has(String(tx.studentId)));
    const rows = [];
    let collected = 0;
    for (const student of students) {
      const before = dueSummary(student, (ctx.snapshot.transactions || []).filter(tx => String(tx.studentId) === String(student.id)), month);
      if (before.due <= 0 && before.paid <= 0) continue;
      const paid = payments.filter(tx => String(tx.studentId) === String(student.id))
        .reduce((sum, tx) => sum + (isFinalized(tx) ? toNumber(tx.amount) : 0), 0);
      collected += paid;
      rows.push([
        dash(student.id), dash(student.name), dash(student.className), dash(student.group || 'সাধারণ'),
        money(before.due), money(paid), money(Math.max(0, before.due - paid))
      ]);
    }
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'বকেয়া থেকে আদায়', value: money(collected) },
          { label: 'শিক্ষার্থী', value: num(rows.length) },
          { label: 'অবশিষ্ট বকেয়া', value: money(rows.reduce((sum, row) => sum + Number(String(row[6]).replace(/[^\d]/g, '')) || 0, 0)) }
        ]),
        table([
          { label: 'Student ID', width: 1.1 }, { label: 'নাম', width: 1.7 }, { label: 'শ্রেণি', width: 1.1 },
          { label: 'বিভাগ', width: 1 }, { label: 'মাসের বকেয়া', width: 1.1 },
          { label: 'আদায়', width: 1.1, emphasis: true }, { label: 'অবশিষ্ট', width: 1.1 }
        ], rows, 'বকেয়া আদায়ের তালিকা')
      ]
    };
  }
};

const feeTransactions = {
  id: 'fee.transactions',
  category: 'fee',
  title: 'Payment Transaction Report',
  subtitle: 'নির্বাচিত সময়ের সব লেনদেন — অনুমোদনের অবস্থাসহ',
  roles: ['admin', 'manager', 'cash'],
  filters: ['period', 'class', 'batch', 'student', 'approvalStatus', 'counter'],
  period: 'tx',
  async build(ctx) {
    const rows = transactionsFor(ctx);
    const map = studentMapOf(ctx.snapshot);
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট লেনদেন', value: num(rows.length) },
          { label: 'অনুমোদিত আদায়', value: money(sumAmount(rows)) },
          { label: 'অপেক্ষমাণ', value: num(rows.filter(tx => tx.status === 'pending').length) },
          { label: 'বাতিল', value: num(rows.filter(tx => tx.status === 'rejected').length) }
        ]),
        table(TX_COLUMNS(), rows.map(tx => txRow(tx, map)), 'লেনদেন')
      ]
    };
  }
};

const feeReceipts = {
  id: 'fee.receipts',
  category: 'fee',
  title: 'Receipt Report',
  subtitle: 'রসিদ নম্বর অনুযায়ী ইস্যুকৃত সব রসিদ',
  roles: ['admin', 'manager', 'cash'],
  filters: ['period', 'class', 'student'],
  period: 'tx',
  async build(ctx) {
    const rows = transactionsFor(ctx);
    const map = studentMapOf(ctx.snapshot);
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট রসিদ', value: num(rows.length) },
          { label: 'মোট পরিমাণ', value: money(sumAmount(rows)) }
        ], 4),
        table([
          { label: 'রসিদ নং', width: 1.8 }, { label: 'তারিখ', width: 1.1 }, { label: 'Student ID', width: 1.1 },
          { label: 'শিক্ষার্থী', width: 1.6 }, { label: 'ফি ও মাস', width: 1.4 },
          { label: 'পরিমাণ', width: 1, align: 'right', emphasis: true }, { label: 'মাধ্যম', width: 1 }, { label: 'আদায়কারী', width: 1.2 }
        ], rows.map(tx => {
          const student = map.get(String(tx.studentId)) || {};
          return [
            dash(tx.receiptNo || tx.id), dateLabel(tx.date), dash(tx.studentId),
            dash(tx.studentName || student.name), `${dash(tx.feeType)} • ${dash(tx.month)}`,
            money(tx.amount), dash(tx.method), dash(tx.collectedBy || 'এডমিন')
          ];
        }), 'রসিদ তালিকা')
      ]
    };
  }
};

const feePaymentStatus = {
  id: 'fee.payment-status',
  category: 'fee',
  title: 'Payment Status Report',
  subtitle: 'চলতি মাসে কে পরিশোধ করেছে, কে বকেয়া আছে',
  roles: ['admin', 'manager', 'cash'],
  filters: ['class', 'batch', 'paymentStatus'],
  period: 'monthly',
  async build(ctx) {
    const month = monthLabelOf(Date.now());
    const students = studentsFor(ctx).filter(student => ['approved', 'active'].includes(student.status));
    const rows = students.map(student => {
      const summary = dueSummary(student, ctx.snapshot.transactions || [], month);
      return {
        student,
        summary,
        state: summary.due <= 0 ? 'paid' : (summary.paid > 0 ? 'partial' : 'due')
      };
    }).filter(entry => !ctx.filters.paymentStatus || ctx.filters.paymentStatus === 'all' || entry.state === ctx.filters.paymentStatus);
    return {
      period: month,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'পরিশোধিত', value: num(rows.filter(entry => entry.state === 'paid').length) },
          { label: 'আংশিক', value: num(rows.filter(entry => entry.state === 'partial').length) },
          { label: 'বকেয়া', value: num(rows.filter(entry => entry.state === 'due').length) },
          { label: 'মোট বকেয়া', value: money(rows.reduce((sum, entry) => sum + entry.summary.due, 0)) }
        ]),
        table([
          { label: 'Student ID', width: 1.1 }, { label: 'নাম', width: 1.7 }, { label: 'শ্রেণি', width: 1.1 },
          { label: 'বিভাগ', width: 1 }, { label: 'মাসিক ফি', width: 1 }, { label: 'পরিশোধিত', width: 1 },
          { label: 'বকেয়া', width: 1, emphasis: true }, { label: 'অবস্থা', width: 1 }
        ], rows.map(({ student, summary, state }) => [
          dash(student.id), dash(student.name), dash(student.className), dash(student.group || 'সাধারণ'),
          money(summary.monthlyFee), money(summary.paid), money(summary.due),
          state === 'paid' ? 'পরিশোধিত' : state === 'partial' ? 'আংশিক' : 'বকেয়া'
        ]), 'পেমেন্ট অবস্থা')
      ]
    };
  }
};

/* ==========================================================================
   C. CASH COUNTER REPORTS
   ========================================================================== */

const CASH_COLUMNS = () => ([
  { label: 'তারিখ', width: 1.1 },
  { label: 'Transaction ID', width: 1.5 },
  { label: 'রসিদ', width: 1.4 },
  { label: 'শিক্ষার্থী', width: 1.6 },
  { label: 'পরিমাণ', width: 1, align: 'right', emphasis: true },
  { label: 'মাধ্যম', width: 1 },
  { label: 'ক্যাশ কাউন্টার', width: 1.3 },
  { label: 'Manager অনুমোদন', width: 1.3 },
  { label: 'চূড়ান্ত অবস্থা', width: 1.2 }
]);

const cashRow = tx => ([
  dateLabel(tx.date),
  dash(tx.transactionNo || tx.id),
  dash(tx.receiptNo || tx.id),
  dash(tx.studentName),
  money(tx.amount),
  dash(tx.method),
  dash(tx.collectedBy || 'এডমিন'),
  tx.status === 'pending' ? 'অপেক্ষমাণ' : tx.status === 'rejected' ? 'বাতিল' : 'অনুমোদিত',
  tx.status === 'pending' ? 'চূড়ান্ত নয়' : tx.status === 'rejected' ? 'বাতিল' : 'চূড়ান্ত'
]);

const cashCollection = ({ id, title, subtitle, period }) => ({
  id,
  category: 'cash',
  title,
  subtitle,
  roles: ['admin', 'manager', 'cash'],
  filters: ['period', 'counter', 'approvalStatus'],
  period: 'tx',
  defaultPeriod: period,
  async build(ctx) {
    const rows = transactionsFor(ctx);
    const approved = rows.filter(isFinalized);
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট সংগ্রহ', value: money(sumAmount(rows)) },
          { label: 'অনুমোদিত', value: num(approved.length) },
          { label: 'অপেক্ষমাণ', value: num(rows.filter(tx => tx.status === 'pending').length) },
          { label: 'বাতিল', value: num(rows.filter(tx => tx.status === 'rejected').length) }
        ]),
        table(CASH_COLUMNS(), rows.map(cashRow), 'ক্যাশ কাউন্টার লেনদেন')
      ]
    };
  }
});

const cashHistory = {
  id: 'cash.history',
  category: 'cash',
  title: 'Transaction History',
  subtitle: 'ক্যাশ কাউন্টারের সম্পূর্ণ লেনদেন ইতিহাস',
  roles: ['admin', 'manager', 'cash'],
  filters: ['period', 'counter', 'approvalStatus'],
  period: 'tx',
  async build(ctx) {
    const rows = transactionsFor(ctx);
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট লেনদেন', value: num(rows.length) },
          { label: 'অনুমোদিত আদায়', value: money(sumAmount(rows)) }
        ], 4),
        table(CASH_COLUMNS(), rows.map(cashRow), 'লেনদেন ইতিহাস')
      ]
    };
  }
};

const cashByStatus = ({ id, title, subtitle, status }) => ({
  id,
  category: 'cash',
  title,
  subtitle,
  roles: ['admin', 'manager', 'cash'],
  filters: ['period', 'counter'],
  period: 'tx',
  async build(ctx) {
    const rows = transactionsFor(ctx).filter(tx => (tx.status || 'approved') === status);
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'লেনদেন', value: num(rows.length) },
          { label: 'পরিমাণ', value: money(rows.reduce((sum, tx) => sum + toNumber(tx.amount), 0)) }
        ], 4),
        table(CASH_COLUMNS(), rows.map(cashRow), title)
      ]
    };
  }
});

const cashClosing = {
  id: 'cash.closing',
  category: 'cash',
  title: 'Cash Closing Report',
  subtitle: 'নির্বাচিত দিনের কাউন্টার বন্ধের হিসাব — মাধ্যমভিত্তিক সংগ্রহ',
  roles: ['admin', 'manager', 'cash'],
  filters: ['period', 'counter'],
  period: 'tx',
  defaultPeriod: 'daily',
  async build(ctx) {
    const rows = transactionsFor(ctx);
    const byMethod = new Map();
    for (const tx of rows.filter(isFinalized)) {
      const key = tx.method || '—';
      const entry = byMethod.get(key) || { method: key, count: 0, amount: 0 };
      entry.count += 1; entry.amount += toNumber(tx.amount);
      byMethod.set(key, entry);
    }
    const list = [...byMethod.values()].sort((a, b) => b.amount - a.amount);
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'দিনের সংগ্রহ', value: money(sumAmount(rows)) },
          { label: 'অনুমোদিত লেনদেন', value: num(rows.filter(isFinalized).length) },
          { label: 'অপেক্ষমাণ', value: num(rows.filter(tx => tx.status === 'pending').length) },
          { label: 'মাধ্যম', value: num(list.length) }
        ]),
        table([{ label: 'মাধ্যম', width: 1.8 }, { label: 'লেনদেন', width: 1, align: 'right' }, { label: 'পরিমাণ', width: 1.3, align: 'right', emphasis: true }],
          list.map(entry => [entry.method, num(entry.count), money(entry.amount)]), 'মাধ্যমভিত্তিক ক্লোজিং'),
        table(CASH_COLUMNS(), rows.map(cashRow), 'সব লেনদেন')
      ]
    };
  }
};

const cashOwnHistory = {
  id: 'cash.own-history',
  category: 'cash',
  title: 'Own Transaction History',
  subtitle: 'নিজের কাউন্টার থেকে গৃহীত লেনদেন',
  roles: ['cash'],
  filters: ['period'],
  period: 'tx',
  async build(ctx) {
    /* enforceAccess() pins the counter for this report, so "own" cannot be
       widened from the UI, a URL or the console. */
    const counter = ctx.filters.counter || ctx.scope?.counter || 'পেমেন্ট কাউন্টার';
    const rows = transactionsFor(ctx).filter(tx => (tx.collectedBy || 'এডমিন') === counter);
    return {
      period: ctx.range.label,
      scopeLines: [`আদায়কারী: ${dash(counter)}`],
      blocks: [
        tiles([
          { label: 'আমার লেনদেন', value: num(rows.length) },
          { label: 'অনুমোদিত আদায়', value: money(sumAmount(rows)) },
          { label: 'অপেক্ষমাণ', value: num(rows.filter(tx => tx.status === 'pending').length) }
        ]),
        table(CASH_COLUMNS(), rows.map(cashRow), 'আমার লেনদেন')
      ]
    };
  }
};

/* ==========================================================================
   D. ACADEMIC REPORTS
   ========================================================================== */

const academicClass = {
  id: 'academic.class',
  category: 'academic',
  title: 'Class Report',
  subtitle: 'নির্বাচিত শ্রেণির ক্লাস, উপস্থিতি, কাজ ও ফলাফলের সারাংশ',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['class', 'batch'],
  async build(ctx) {
    const students = studentsFor(ctx);
    const activities = activitiesFor(ctx);
    const classes = activities.filter(activity => activity.type === 'routine');
    const blocks = [
      tiles([
        { label: 'শিক্ষার্থী', value: num(students.length) },
        { label: 'ক্লাস সেশন', value: num(classes.length) },
        { label: 'বাড়ির কাজ', value: num(activities.filter(a => a.type === 'homework').length) },
        { label: 'একাডেমিক নোটিশ', value: num(activities.filter(a => a.type === 'suggestion').length) }
      ])
    ];
    blocks.push(heading('ক্লাস সেশন'));
    blocks.push(table([
      { label: 'তারিখ', width: 1.1 }, { label: 'বিষয়', width: 1.6 }, { label: 'শ্রেণি', width: 1.2 },
      { label: 'বিভাগ', width: 1.1 }, { label: 'উপস্থিত', width: 0.9, align: 'right' },
      { label: 'দেরিতে', width: 0.9, align: 'right' }, { label: 'অনুপস্থিত', width: 1, align: 'right' },
      { label: 'উপস্থিতির হার', width: 1.2, align: 'right' }
    ], classes.map(activity => {
      const stats = attendanceStats(activity);
      return [
        dateLabel(activity.date), dash(activity.subject || activity.title), dash(activity.className), dash(activity.group || 'সব'),
        num(stats.present), num(stats.late), num(stats.absent), percent(stats.rate)
      ];
    })));
    blocks.push(heading('শিক্ষার্থী'));
    blocks.push(table(STUDENT_COLUMNS(), students.map(studentRow)));
    return { scopeLines: scopeLine(ctx), blocks };
  }
};

const academicBatch = {
  id: 'academic.batch',
  category: 'academic',
  title: 'Batch Report',
  subtitle: 'বিভাগ / ব্যাচ অনুযায়ী একাডেমিক সারাংশ',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['class', 'batch'],
  async build(ctx) {
    const students = studentsFor(ctx);
    const groups = new Map();
    for (const student of students) {
      const key = student.group || 'সাধারণ';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(student);
    }
    const blocks = [tiles([{ label: 'মোট শিক্ষার্থী', value: num(students.length) }, { label: 'বিভাগ', value: num(groups.size) }], 4)];
    for (const [batch, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'bn'))) {
      blocks.push(heading(`বিভাগ: ${batch} • ${num(list.length)} জন`));
      blocks.push(table(STUDENT_COLUMNS(), list.map(studentRow)));
    }
    return { scopeLines: scopeLine(ctx), blocks };
  }
};

const academicTeacherWise = {
  id: 'academic.teacher-wise',
  category: 'academic',
  title: 'Teacher-wise Academic Report',
  subtitle: 'শিক্ষক অনুযায়ী ক্লাস, বাড়ির কাজ ও মূল্যায়ন',
  roles: ['admin', 'manager'],
  filters: ['period', 'teacher', 'class', 'subject'],
  period: 'activity',
  async build(ctx) {
    const activities = activitiesFor(ctx);
    const byTeacher = new Map();
    for (const activity of activities) {
      const key = activity.teacherName || '—';
      const entry = byTeacher.get(key) || { teacher: key, classes: 0, homework: 0, notices: 0, exams: 0, subjects: new Set() };
      if (activity.type === 'routine') entry.classes += 1;
      if (activity.type === 'homework') entry.homework += 1;
      if (activity.type === 'suggestion') entry.notices += 1;
      if (activity.type === 'exam') entry.exams += 1;
      if (activity.subject) entry.subjects.add(activity.subject);
      byTeacher.set(key, entry);
    }
    const list = [...byTeacher.values()].sort((a, b) => b.classes + b.homework - (a.classes + a.homework));
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'শিক্ষক', value: num(list.length) },
          { label: 'ক্লাস সেশন', value: num(list.reduce((sum, item) => sum + item.classes, 0)) },
          { label: 'বাড়ির কাজ', value: num(list.reduce((sum, item) => sum + item.homework, 0)) },
          { label: 'মূল্যায়ন', value: num(list.reduce((sum, item) => sum + item.exams, 0)) }
        ]),
        table([
          { label: 'শিক্ষক', width: 1.8 }, { label: 'বিষয়সমূহ', width: 2 },
          { label: 'ক্লাস', width: 0.8, align: 'right' }, { label: 'বাড়ির কাজ', width: 1, align: 'right' },
          { label: 'নোটিশ', width: 0.9, align: 'right' }, { label: 'মূল্যায়ন', width: 1, align: 'right' }
        ], list.map(item => [
          item.teacher, [...item.subjects].join(', ') || '—',
          num(item.classes), num(item.homework), num(item.notices), num(item.exams)
        ]), 'শিক্ষকভিত্তিক কার্যক্রম')
      ]
    };
  }
};

const academicAttendance = {
  id: 'academic.attendance',
  category: 'academic',
  title: 'Attendance Report',
  subtitle: 'ক্লাস সেশনভিত্তিক উপস্থিতি ও অনুপস্থিতির তালিকা',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['period', 'class', 'batch', 'subject', 'student'],
  period: 'activity',
  async build(ctx) {
    const sessions = activitiesFor(ctx, ['routine']);
    const map = studentMapOf(ctx.snapshot);
    const rows = [];
    for (const session of sessions) {
      for (const [studentId, entry] of Object.entries(session.progress || {})) {
        if (ctx.filters.studentId && String(studentId) !== String(ctx.filters.studentId)) continue;
        const student = map.get(String(studentId)) || {};
        rows.push([
          dash(session.date), dash(session.subject || session.title), dash(student.name || studentId),
          dash(studentId), dash(student.className), dash(student.group || 'সাধারণ'),
          PROGRESS_TEXT[entry?.value] || dash(entry?.value)
        ]);
      }
    }
    const present = rows.filter(row => row[6] === 'উপস্থিত').length;
    const late = rows.filter(row => row[6] === 'দেরিতে উপস্থিত').length;
    const absent = rows.filter(row => row[6] === 'অনুপস্থিত').length;
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট এন্ট্রি', value: num(rows.length) },
          { label: 'উপস্থিত', value: num(present) },
          { label: 'দেরিতে', value: num(late) },
          { label: 'অনুপস্থিত', value: num(absent) }
        ]),
        table(ATTENDANCE_COLUMNS(), rows, 'উপস্থিতির বিস্তারিত')
      ]
    };
  }
};

const academicAttendanceSummary = {
  id: 'academic.attendance-summary',
  category: 'academic',
  title: 'Student Attendance Summary',
  subtitle: 'প্রতি শিক্ষার্থীর উপস্থিতির সারাংশ',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['period', 'class', 'batch'],
  period: 'activity',
  async build(ctx) {
    const students = studentsFor(ctx);
    const sessions = activitiesFor(ctx, ['routine']);
    let totalPresent = 0, totalAbsent = 0, totalLate = 0;
    const rows = students.map(student => {
      let present = 0, absent = 0, late = 0;
      for (const session of sessions) {
        const value = session.progress?.[student.id]?.value;
        if (value === 'present') present += 1;
        else if (value === 'absent') absent += 1;
        else if (value === 'late') late += 1;
      }
      totalPresent += present; totalAbsent += absent; totalLate += late;
      const total = present + absent + late;
      return [
        dash(student.id), dash(student.name), dash(student.className), dash(student.group || 'সাধারণ'),
        num(total), num(present), num(late), num(absent), total ? percent((present + late) / total * 100) : '—'
      ];
    });
    const all = totalPresent + totalAbsent + totalLate;
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'শিক্ষার্থী', value: num(students.length) },
          { label: 'মোট সেশন', value: num(sessions.length) },
          { label: 'সার্বিক উপস্থিতি', value: all ? percent((totalPresent + totalLate) / all * 100) : '—' },
          { label: 'অনুপস্থিত', value: num(totalAbsent) }
        ]),
        table([
          { label: 'Student ID', width: 1.1 }, { label: 'নাম', width: 1.7 }, { label: 'শ্রেণি', width: 1.1 },
          { label: 'বিভাগ', width: 1 }, { label: 'মোট সেশন', width: 1, align: 'right' },
          { label: 'উপস্থিত', width: 0.9, align: 'right' }, { label: 'দেরিতে', width: 0.9, align: 'right' },
          { label: 'অনুপস্থিত', width: 1, align: 'right' }, { label: 'উপস্থিতির হার', width: 1.2, align: 'right', emphasis: true }
        ], rows, 'উপস্থিতির সারাংশ')
      ]
    };
  }
};

const academicAssignment = {
  id: 'academic.assignment',
  category: 'academic',
  title: 'Assignment Report',
  subtitle: 'দেওয়া বাড়ির কাজের তালিকা ও অগ্রগতি',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['period', 'class', 'batch', 'subject', 'teacher'],
  period: 'activity',
  async build(ctx) {
    const activities = activitiesFor(ctx, ['homework']);
    const rows = activities.map(activity => {
      const stats = Object.values(activity.progress || {});
      const done = stats.filter(entry => ['done', 'reviewed'].includes(entry?.value)).length;
      return [
        dateLabel(activity.date), dash(activity.title), dash(activity.subject),
        dash(activity.className), dash(activity.group || 'সব'),
        dash(activity.teacherName), num(stats.length), num(done), stats.length ? percent(done / stats.length * 100) : '—'
      ];
    });
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট কাজ', value: num(activities.length) },
          { label: 'জমা পড়েছে', value: num(rows.reduce((sum, row) => sum + Number(String(row[7]).replace(/[^\d]/g, '')) || 0, 0)) }
        ], 4),
        table([
          { label: 'তারিখ', width: 1 }, { label: 'শিরোনাম', width: 2 }, { label: 'বিষয়', width: 1.2 },
          { label: 'শ্রেণি', width: 1.1 }, { label: 'বিভাগ', width: 1 }, { label: 'শিক্ষক', width: 1.4 },
          { label: 'দায়িত্ব', width: 0.9, align: 'right' }, { label: 'জমা', width: 0.9, align: 'right' }, { label: 'হার', width: 0.9, align: 'right' }
        ], rows, 'বাড়ির কাজ')
      ]
    };
  }
};

const academicSuggestion = {
  id: 'academic.suggestion',
  category: 'academic',
  title: 'Suggestion Report',
  subtitle: 'দেওয়া সাজেশনের তালিকা, অধ্যায় ও শ্রেণি',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['period', 'class', 'batch', 'subject', 'teacher'],
  period: 'activity',
  async build(ctx) {
    const activities = activitiesFor(ctx, ['suggestion']);
    const rows = activities.map(activity => [
      dateLabel(activity.date), dash(activity.title), dash(activity.subject),
      dash(activity.details || activity.chapter || '—'), dash(activity.className),
      dash(activity.group || 'সব'), dash(activity.teacherName), dash(activity.status)
    ]);
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট সাজেশন', value: num(activities.length) },
          { label: 'বিষয়', value: num(new Set(activities.map(item => item.subject).filter(Boolean)).size) }
        ], 4),
        table([
          { label: 'তারিখ', width: 1 }, { label: 'শিরোনাম', width: 2 }, { label: 'বিষয়', width: 1.2 },
          { label: 'বিস্তারিত', width: 2.2 }, { label: 'শ্রেণি', width: 1.1 }, { label: 'বিভাগ', width: 1 },
          { label: 'শিক্ষক', width: 1.4 }, { label: 'অবস্থা', width: 1 }
        ], rows, 'সাজেশন')
      ]
    };
  }
};

const academicAssignmentSubmission = {
  id: 'academic.assignment-submission',
  category: 'academic',
  title: 'Assignment Submission Report',
  subtitle: 'কে জমা দিয়েছে, কে দেয়নি — কাজভিত্তিক বিস্তারিত',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['period', 'class', 'batch', 'subject', 'student'],
  period: 'activity',
  async build(ctx) {
    const activities = activitiesFor(ctx, ['homework']);
    const map = studentMapOf(ctx.snapshot);
    const rows = [];
    for (const activity of activities) {
      for (const [studentId, entry] of Object.entries(activity.progress || {})) {
        if (ctx.filters.studentId && String(studentId) !== String(ctx.filters.studentId)) continue;
        const student = map.get(String(studentId)) || {};
        rows.push([
          dateLabel(activity.date), dash(activity.title), dash(activity.subject),
          dash(student.name || studentId), dash(studentId), dash(student.className),
          PROGRESS_TEXT[entry?.value] || dash(entry?.value)
        ]);
      }
    }
    const done = rows.filter(row => ['জমা দিয়েছে', 'দেখা হয়েছে'].includes(row[6])).length;
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট এন্ট্রি', value: num(rows.length) },
          { label: 'জমা', value: num(done) },
          { label: 'বাকি', value: num(rows.length - done) },
          { label: 'জমার হার', value: rows.length ? percent(done / rows.length * 100) : '—' }
        ]),
        table([
          { label: 'তারিখ', width: 1 }, { label: 'কাজ', width: 1.8 }, { label: 'বিষয়', width: 1.1 },
          { label: 'শিক্ষার্থী', width: 1.6 }, { label: 'Student ID', width: 1.1 },
          { label: 'শ্রেণি', width: 1 }, { label: 'অবস্থা', width: 1.1 }
        ], rows, 'জমার বিস্তারিত')
      ]
    };
  }
};

const academicPerformance = {
  id: 'academic.performance',
  category: 'academic',
  title: 'Academic Performance Report',
  subtitle: 'উপস্থিতি, কাজ জমা ও ফলাফল — এক নজরে',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['period', 'class', 'batch'],
  period: 'activity',
  async build(ctx) {
    const students = studentsFor(ctx);
    const sessions = activitiesFor(ctx, ['routine']);
    const homework = activitiesFor(ctx, ['homework']);
    const exams = examsFor(ctx);
    const attempts = ctx.snapshot.exams?.attempts || [];
    const rows = students.map(student => {
      let present = 0, absent = 0;
      for (const session of sessions) {
        const value = session.progress?.[student.id]?.value;
        if (value === 'present' || value === 'late') present += 1;
        else if (value === 'absent') absent += 1;
      }
      const totalSessions = present + absent;
      let submitted = 0, assigned = 0;
      for (const activity of homework) {
        const entry = activity.progress?.[student.id];
        if (!entry) continue;
        assigned += 1;
        if (['done', 'reviewed'].includes(entry.value)) submitted += 1;
      }
      const own = exams.flatMap(exam => bestAttempts(attempts, exam.id).filter(item => String(item.studentId) === String(student.id))
        .map(item => resultFor(exam, item)));
      const average = own.length ? own.reduce((sum, item) => sum + item.percent, 0) / own.length : null;
      return [
        dash(student.id), dash(student.name), dash(student.className), dash(student.group || 'সাধারণ'),
        totalSessions ? percent(present / totalSessions * 100) : '—',
        assigned ? percent(submitted / assigned * 100) : '—',
        num(own.length),
        average === null ? '—' : percent(average)
      ];
    });
    const graded = rows.map(row => Number(String(row[7]).replace(/[^\d.]/g, ''))).filter(value => Number.isFinite(value) && value > 0);
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'শিক্ষার্থী', value: num(students.length) },
          { label: 'ক্লাস সেশন', value: num(sessions.length) },
          { label: 'বাড়ির কাজ', value: num(homework.length) },
          { label: 'মূল্যায়ন', value: num(exams.length) }
        ]),
        table([
          { label: 'Student ID', width: 1.1 }, { label: 'নাম', width: 1.7 }, { label: 'শ্রেণি', width: 1.1 },
          { label: 'বিভাগ', width: 1 }, { label: 'উপস্থিতি', width: 1, align: 'right' },
          { label: 'কাজ জমা', width: 1, align: 'right' }, { label: 'পরীক্ষা', width: 0.9, align: 'right' },
          { label: 'গড় ফলাফল', width: 1.1, align: 'right', emphasis: true }
        ], rows, 'একাডেমিক পারফরম্যান্স')
      ]
    };
  }
};

/* ---------- teacher-scoped academic reports ---------- */

const teacherMyClass = {
  id: 'teacher.my-class',
  category: 'academic',
  title: 'My Class Report',
  subtitle: 'আমার assignment-এর শ্রেণিসমূহ — ক্লাস, উপস্থিতি ও কাজ',
  roles: ['teacher'],
  filters: ['class', 'batch'],
  async build(ctx) {
    const classes = ctx.scope?.pairs || [];
    const sessions = activitiesFor(ctx, ['routine']);
    const homework = activitiesFor(ctx, ['homework']);
    const blocks = [
      kv([
        ['আমার নাম', ctx.actor?.name || '—'],
        ['Username', ctx.actor?.username || '—'],
        ['Assignment', classes.map(item => `${item.className}${item.group ? ` (${item.group})` : ''}`).join(', ') || '—'],
        ['বিষয়সমূহ', (ctx.scope?.subjects || []).join(', ') || '—']
      ], 2),
      tiles([
        { label: 'ক্লাস সেশন', value: num(sessions.length) },
        { label: 'বাড়ির কাজ', value: num(homework.length) },
        { label: 'বিষয়', value: num((ctx.scope?.subjects || []).length) },
        { label: 'শ্রেণি', value: num((ctx.scope?.classes || []).length) }
      ])
    ];
    blocks.push(heading('আমার ক্লাস সেশন'));
    blocks.push(table([
      { label: 'তারিখ', width: 1.1 }, { label: 'বিষয়', width: 1.8 }, { label: 'শ্রেণি', width: 1.2 },
      { label: 'বিভাগ', width: 1.1 }, { label: 'উপস্থিত', width: 0.9, align: 'right' },
      { label: 'অনুপস্থিত', width: 1, align: 'right' }, { label: 'হার', width: 1, align: 'right' }
    ], sessions.map(activity => {
      const stats = attendanceStats(activity);
      return [dateLabel(activity.date), dash(activity.subject || activity.title), dash(activity.className),
        dash(activity.group || 'সব'), num(stats.present), num(stats.absent), percent(stats.rate)];
    })));
    return { scopeLines: scopeLine(ctx), blocks };
  }
};

const teacherMyBatch = {
  id: 'teacher.my-batch',
  category: 'academic',
  title: 'My Batch Report',
  subtitle: 'আমার assignment-এর ব্যাচভিত্তিক শিক্ষার্থী ও অগ্রগতি',
  roles: ['teacher'],
  filters: ['class', 'batch'],
  async build(ctx) {
    const students = studentsFor(ctx);
    const groups = new Map();
    for (const student of students) {
      const key = student.group || 'সাধারণ';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(student);
    }
    const sessions = activitiesFor(ctx, ['routine']);
    const blocks = [tiles([{ label: 'আমার শিক্ষার্থী', value: num(students.length) }, { label: 'বিভাগ', value: num(groups.size) }], 4)];
    for (const [batch, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'bn'))) {
      blocks.push(heading(`বিভাগ: ${batch} • ${num(list.length)} জন`));
      blocks.push(table([
        { label: 'Student ID', width: 1.1 }, { label: 'নাম', width: 1.8 }, { label: 'শ্রেণি', width: 1.2 },
        { label: 'মোবাইল', width: 1.2 }, { label: 'স্ট্যাটাস', width: 1 }
      ], list.map(student => [
        dash(student.id), dash(student.name), dash(student.className),
        student.mobile ? bn(String(student.mobile)) : '—',
        studentStatusLabel[student.status] || dash(student.status)
      ])));
    }
    if (!groups.size) blocks.push(para('আমার assignment-এ এই filter-এ কোনো শিক্ষার্থী পাওয়া যায়নি।'));
    void sessions;
    return { scopeLines: scopeLine(ctx), blocks };
  }
};

const teacherStudentAcademic = {
  id: 'teacher.student-academic',
  category: 'academic',
  title: 'Student Academic Report',
  subtitle: 'আমার scope-এর একজন শিক্ষার্থীর একাডেমিক চিত্র',
  roles: ['teacher'],
  filters: ['student', 'class', 'batch'],
  requiresStudent: true,
  async build(ctx) {
    const students = studentsFor(ctx);
    if (!students.length) return { scopeLines: scopeLine(ctx), blocks: [] };
    const student = students[0];
    const sessions = activitiesFor(ctx, ['routine']);
    const homework = activitiesFor(ctx, ['homework']);
    const exams = examsFor(ctx);
    const attempts = ctx.snapshot.exams?.attempts || [];
    let present = 0, absent = 0, late = 0;
    for (const session of sessions) {
      const value = session.progress?.[student.id]?.value;
      if (value === 'present') present += 1;
      else if (value === 'absent') absent += 1;
      else if (value === 'late') late += 1;
    }
    const results = exams.flatMap(exam => bestAttempts(attempts, exam.id)
      .filter(item => String(item.studentId) === String(student.id))
      .map(item => ({ exam, result: resultFor(exam, item) })));
    return {
      scopeLines: [`শিক্ষার্থী: ${student.name} (${student.id})`],
      blocks: [
        kv([
          ['Student ID', student.id], ['নাম', student.name], ['শ্রেণি', student.className],
          ['বিভাগ', student.group || 'সাধারণ'], ['স্ট্যাটাস', studentStatusLabel[student.status] || student.status]
        ], 3),
        tiles([
          { label: 'উপস্থিত', value: num(present) },
          { label: 'দেরিতে', value: num(late) },
          { label: 'অনুপস্থিত', value: num(absent) },
          { label: 'উপস্থিতির হার', value: (present + absent + late) ? percent((present + late) / (present + absent + late) * 100) : '—' }
        ]),
        heading('বাড়ির কাজ'),
        table([
          { label: 'তারিখ', width: 1 }, { label: 'কাজ', width: 2 }, { label: 'বিষয়', width: 1.2 }, { label: 'অবস্থা', width: 1.2 }
        ], homework.map(activity => [
          dateLabel(activity.date), dash(activity.title), dash(activity.subject),
          PROGRESS_TEXT[activity.progress?.[student.id]?.value] || 'বাকি'
        ])),
        heading('পরীক্ষার ফলাফল'),
        table([
          { label: 'পরীক্ষা', width: 2 }, { label: 'বিষয়', width: 1.2 }, { label: 'প্রাপ্ত', width: 1 },
          { label: 'মোট', width: 1 }, { label: 'শতাংশ', width: 1 }, { label: 'গ্রেড', width: 0.8 }, { label: 'ফলাফল', width: 1 }
        ], results.map(({ exam, result }) => [
          dash(exam.title), dash(exam.subject), num(result.score), num(result.total),
          result.percentLabel, result.grade, result.pass ? 'উত্তীর্ণ' : 'অনুত্তীর্ণ'
        ]))
      ]
    };
  }
};

const teacherAcademicNotice = {
  id: 'teacher.academic-notice',
  category: 'academic',
  title: 'Academic Notice Report',
  subtitle: 'আমার scope-এ প্রকাশিত একাডেমিক নোটিশ',
  roles: ['teacher'],
  filters: ['period', 'class', 'batch', 'subject'],
  period: 'activity',
  async build(ctx) {
    const notices = activitiesFor(ctx, ['suggestion']);
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([{ label: 'নোটিশ', value: num(notices.length) }], 4),
        table([
          { label: 'তারিখ', width: 1.1 }, { label: 'শিরোনাম', width: 2.2 }, { label: 'বিষয়', width: 1.2 },
          { label: 'শ্রেণি', width: 1.1 }, { label: 'বিভাগ', width: 1.1 }, { label: 'অবস্থা', width: 1 }
        ], notices.map(activity => [
          dateLabel(activity.date), dash(activity.title), dash(activity.subject),
          dash(activity.className), dash(activity.group || 'সব'), dash(activity.status)
        ]), 'একাডেমিক নোটিশ')
      ]
    };
  }
};

/* ==========================================================================
   E. EXAMINATION REPORTS
   ========================================================================== */

const EXAM_LIST_COLUMNS = () => ([
  { label: 'Exam ID', width: 1.3 },
  { label: 'পরীক্ষার নাম', width: 2 },
  { label: 'বিষয়', width: 1.2 },
  { label: 'শ্রেণি', width: 1.1 },
  { label: 'বিভাগ', width: 1 },
  { label: 'তারিখ', width: 1.2 },
  { label: 'সময়', width: 1.1 },
  { label: 'প্রশ্ন', width: 0.7, align: 'right' },
  { label: 'নম্বর', width: 0.8, align: 'right' },
  { label: 'অবস্থা', width: 1.1 }
]);

const examRow = exam => ([
  dash(exam.id), dash(exam.title), dash(exam.subject), dash(exam.className || 'সব'),
  dash(exam.group || 'সব'), examTime(exam) ? formatDate(examTime(exam)) : '—',
  examDuration(exam), num((exam.questions || []).length), num(totalMarks(exam)),
  EXAM_STATUSES[exam.status] || dash(exam.status)
]);

const examList = ({ id, title, subtitle, pick }) => ({
  id,
  category: 'exam',
  title,
  subtitle,
  roles: ['admin', 'manager', 'teacher'],
  filters: ['period', 'class', 'batch', 'subject'],
  period: 'exam',
  async build(ctx) {
    const exams = examsFor(ctx, { period: true }).filter(exam => (pick ? pick(exam, ctx) : true));
    const taken = exams.filter(isTakenExam);
    const upcoming = exams.filter(isUpcomingExam);
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'পরীক্ষা', value: num(exams.length) },
          { label: 'অনুষ্ঠিত', value: num(taken.length) },
          { label: 'আসন্ন', value: num(upcoming.length) },
          { label: 'মোট নম্বর', value: num(exams.reduce((sum, exam) => sum + totalMarks(exam), 0)) }
        ]),
        table(EXAM_LIST_COLUMNS(), exams.map(examRow), 'পরীক্ষার তালিকা')
      ]
    };
  }
});

const examParticipation = {
  id: 'exam.participation',
  category: 'exam',
  title: 'Examination Participation Report',
  subtitle: 'কে পরীক্ষায় অংশ নিয়েছে, কে অনুপস্থিত ছিল',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['exam', 'class', 'batch'],
  requiresExam: true,
  async build(ctx) {
    const exam = examsFor(ctx)[0];
    if (!exam) return { scopeLines: scopeLine(ctx), blocks: [] };
    const attempts = submittedAttempts(ctx.snapshot.exams?.attempts || [], exam.id);
    const attended = new Set(attempts.map(attempt => String(attempt.studentId)));
    const participants = exam.participants || [];
    const rows = participants.map(person => [
      dash(person.id), dash(person.name), dash(person.className), dash(person.group || '—'),
      attended.has(String(person.id)) ? 'অংশ নিয়েছে' : 'অনুপস্থিত',
      dash((exam.absentIds || []).includes(person.id) ? 'হ্যাঁ' : 'না')
    ]);
    return {
      scopeLines: scopeLine(ctx),
      blocks: [
        examInfoBlock(exam),
        tiles([
          { label: 'অংশগ্রহণকারী', value: num(participants.length) },
          { label: 'উত্তর জমা', value: num(attempts.length) },
          { label: 'অনুপস্থিত', value: num(participants.length - attempts.length) },
          { label: 'অংশগ্রহণের হার', value: participants.length ? percent(attempts.length / participants.length * 100) : '—' }
        ]),
        table([
          { label: 'Student ID', width: 1.2 }, { label: 'নাম', width: 2 }, { label: 'শ্রেণি', width: 1.2 },
          { label: 'বিভাগ', width: 1.1 }, { label: 'অবস্থা', width: 1.3 }, { label: 'তালিকাভুক্ত অনুপস্থিত', width: 1.4 }
        ], rows, 'অংশগ্রহণ')
      ]
    };
  }
};

const examSummary = {
  id: 'exam.summary',
  category: 'exam',
  title: 'Examination Summary Report',
  subtitle: 'পরীক্ষার সারাংশ — গড়, সর্বোচ্চ, সর্বনিম্ন ও পাসের হার',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['exam', 'class', 'batch'],
  requiresExam: true,
  async build(ctx) {
    const exam = examsFor(ctx)[0];
    if (!exam) return { scopeLines: scopeLine(ctx), blocks: [] };
    const attempts = bestAttempts(ctx.snapshot.exams?.attempts || [], exam.id);
    const results = attempts.map(attempt => resultFor(exam, attempt));
    const scores = results.map(item => item.score);
    const total = totalMarks(exam);
    const passCount = results.filter(item => item.pass).length;
    const rows = attempts.map((attempt, index) => {
      const result = results[index];
      return [
        num(index + 1), dash(attempt.studentId), dash(attempt.name || attempt.studentId),
        dash(attempt.className), dash(attempt.group || '—'),
        num(result.score), num(result.total), result.percentLabel, result.grade,
        result.pass ? 'উত্তীর্ণ' : 'অনুত্তীর্ণ'
      ];
    });
    return {
      scopeLines: scopeLine(ctx),
      blocks: [
        examInfoBlock(exam),
        tiles([
          { label: 'অংশগ্রহণ', value: num(attempts.length) },
          { label: 'গড় নম্বর', value: scores.length ? num(scores.reduce((a, b) => a + b, 0) / scores.length) : '—' },
          { label: 'সর্বোচ্চ', value: num(scores.length ? Math.max(...scores) : 0) },
          { label: 'পাসের হার', value: attempts.length ? percent(passCount / attempts.length * 100) : '—' }
        ]),
        table(RESULT_COLUMNS(), rows, 'ফলাফলের তালিকা')
      ]
    };
  }
};

/** Full MCQ question paper: every question, every option, the correct answer. */
const examQuestionPaper = {
  id: 'exam.question-paper',
  category: 'exam',
  title: 'Question Paper Report',
  subtitle: 'সম্পূর্ণ প্রশ্নপত্র — সব প্রশ্ন ও সব অপশন',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['exam'],
  requiresExam: true,
  async build(ctx) {
    const exam = examsFor(ctx)[0];
    if (!exam) return { scopeLines: scopeLine(ctx), blocks: [] };
    const rows = questionRows(exam, null);
    return {
      scopeLines: scopeLine(ctx),
      blocks: [
        examInfoBlock(exam),
        heading('নির্দেশনা'),
        para(exam.instructions || 'নির্দেশনা দেওয়া হয়নি।'),
        questions(rows, { showAnswer: false, showStudent: false })
      ]
    };
  }
};

const examAnswerKey = {
  id: 'exam.answer-key',
  category: 'exam',
  title: 'Answer Key Report',
  subtitle: 'প্রতিটি প্রশ্নের সঠিক উত্তর ও ব্যাখ্যা',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['exam'],
  requiresExam: true,
  async build(ctx) {
    const exam = examsFor(ctx)[0];
    if (!exam) return { scopeLines: scopeLine(ctx), blocks: [] };
    const rows = questionRows(exam, null);
    return {
      scopeLines: scopeLine(ctx),
      blocks: [
        examInfoBlock(exam),
        table([
          { label: 'প্রশ্ন', width: 0.7 }, { label: 'প্রশ্নের লেখা', width: 3.4 },
          { label: 'সঠিক উত্তর', width: 1.1 }, { label: 'নম্বর', width: 0.8, align: 'right' }, { label: 'ব্যাখ্যা', width: 2 }
        ], rows.map(row => [row.no, row.text, row.answerText, row.marks, row.explanation || '—']), 'উত্তরমালা'),
        questions(rows, { showAnswer: true, showStudent: false })
      ]
    };
  }
};

const examMarksSheet = {
  id: 'exam.marks-sheet',
  category: 'exam',
  title: 'Marks Sheet',
  subtitle: 'প্রশ্নভিত্তিক নম্বরপত্র',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['exam', 'class', 'batch'],
  requiresExam: true,
  async build(ctx) {
    const exam = examsFor(ctx)[0];
    if (!exam) return { scopeLines: scopeLine(ctx), blocks: [] };
    const attempts = bestAttempts(ctx.snapshot.exams?.attempts || [], exam.id);
    const rows = attempts.map((attempt, index) => {
      const result = resultFor(exam, attempt);
      const counters = attemptCounters(exam, attempt);
      return [
        num(index + 1), dash(attempt.studentId), dash(attempt.name || attempt.studentId),
        dash(attempt.className), dash(attempt.group || '—'),
        counters.attempted, counters.correct, counters.wrong, counters.unanswered,
        num(result.score), num(result.total), result.percentLabel, result.grade,
        result.pass ? 'উত্তীর্ণ' : 'অনুত্তীর্ণ'
      ];
    });
    return {
      scopeLines: scopeLine(ctx),
      blocks: [
        examInfoBlock(exam),
        table([
          { label: 'র‍্যাংক', width: 0.7 }, { label: 'Student ID', width: 1.1 }, { label: 'নাম', width: 1.7 },
          { label: 'শ্রেণি', width: 1.1 }, { label: 'বিভাগ', width: 1 },
          { label: 'উত্তর', width: 0.8, align: 'right' }, { label: 'সঠিক', width: 0.8, align: 'right' },
          { label: 'ভুল', width: 0.8, align: 'right' }, { label: 'অনুত্তরিত', width: 1, align: 'right' },
          { label: 'প্রাপ্ত', width: 0.9, align: 'right' }, { label: 'মোট', width: 0.9, align: 'right' },
          { label: 'শতাংশ', width: 0.9, align: 'right' }, { label: 'গ্রেড', width: 0.7 }, { label: 'ফলাফল', width: 1, emphasis: true }
        ], rows, 'নম্বরপত্র')
      ]
    };
  }
};

const examByGroup = ({ id, title, subtitle, groupBy }) => ({
  id,
  category: 'exam',
  title,
  subtitle,
  roles: ['admin', 'manager', 'teacher'],
  filters: ['period', 'class', 'batch', 'subject'],
  period: 'exam',
  async build(ctx) {
    const exams = examsFor(ctx, { period: true, publishedOnly: true });
    const attempts = ctx.snapshot.exams?.attempts || [];
    const blocks = [tiles([
      { label: 'পরীক্ষা', value: num(exams.length) },
      { label: 'উত্তরপত্র', value: num(exams.reduce((sum, exam) => sum + bestAttempts(attempts, exam.id).length, 0)) }
    ], 4)];
    const groups = new Map();
    for (const exam of exams) {
      const key = groupBy === 'student' ? null : (groupBy === 'class' ? (exam.className || 'সব') : groupBy === 'batch' ? (exam.group || 'সাধারণ') : (exam.subject || '—'));
      if (groupBy === 'student') {
        for (const attempt of bestAttempts(attempts, exam.id)) {
          const studentKey = String(attempt.studentId);
          const entry = groups.get(studentKey) || { key: studentKey, name: attempt.name || studentKey, className: attempt.className, group: attempt.group, exams: [] };
          entry.exams.push({ exam, attempt });
          groups.set(studentKey, entry);
        }
      } else {
        const entry = groups.get(key) || { key, exams: [] };
        entry.exams.push(exam);
        groups.set(key, entry);
      }
    }
    if (groupBy === 'student') {
      const rows = [...groups.values()].map(entry => {
        const results = entry.exams.map(({ exam, attempt }) => resultFor(exam, attempt));
        const average = results.length ? results.reduce((sum, item) => sum + item.percent, 0) / results.length : 0;
        return [
          dash(entry.key), dash(entry.name), dash(entry.className), dash(entry.group || '—'),
          num(entry.exams.length), num(results.reduce((sum, item) => sum + item.score, 0)),
          num(results.reduce((sum, item) => sum + item.total, 0)),
          percent(average), num(results.filter(item => item.pass).length)
        ];
      });
      blocks.push(table([
        { label: 'Student ID', width: 1.2 }, { label: 'নাম', width: 1.8 }, { label: 'শ্রেণি', width: 1.1 },
        { label: 'বিভাগ', width: 1 }, { label: 'পরীক্ষা', width: 0.9, align: 'right' },
        { label: 'প্রাপ্ত নম্বর', width: 1.1, align: 'right' }, { label: 'মোট নম্বর', width: 1.1, align: 'right' },
        { label: 'গড় শতাংশ', width: 1.1, align: 'right', emphasis: true }, { label: 'উত্তীর্ণ', width: 0.9, align: 'right' }
      ], rows, 'শিক্ষার্থীভিত্তিক পরীক্ষার সারাংশ'));
    } else {
      const rows = [...groups.values()].map(entry => {
        const list = entry.exams;
        const counts = list.map(exam => bestAttempts(attempts, exam.id).length);
        const results = list.flatMap(exam => bestAttempts(attempts, exam.id).map(attempt => resultFor(exam, attempt)));
        const average = results.length ? results.reduce((sum, item) => sum + item.percent, 0) / results.length : 0;
        return [
          dash(entry.key), num(list.length), num(counts.reduce((a, b) => a + b, 0)),
          num(list.reduce((sum, exam) => sum + totalMarks(exam), 0)),
          percent(average), num(results.filter(item => item.pass).length), num(results.filter(item => !item.pass).length)
        ];
      });
      blocks.push(table([
        { label: groupBy === 'class' ? 'শ্রেণি' : groupBy === 'batch' ? 'বিভাগ' : 'বিষয়', width: 1.8 },
        { label: 'পরীক্ষা', width: 0.9, align: 'right' }, { label: 'উত্তরপত্র', width: 1, align: 'right' },
        { label: 'মোট নম্বর', width: 1.1, align: 'right' }, { label: 'গড় শতাংশ', width: 1.1, align: 'right', emphasis: true },
        { label: 'উত্তীর্ণ', width: 1, align: 'right' }, { label: 'অনুত্তীর্ণ', width: 1, align: 'right' }
      ], rows, `${groupBy === 'class' ? 'শ্রেণি' : groupBy === 'batch' ? 'বিভাগ' : 'বিষয়'}ভিত্তিক সারাংশ`));
    }
    return { period: ctx.range.label, scopeLines: scopeLine(ctx), blocks };
  }
});

/**
 * COMPLETE EXAMINATION REPORT — exam information, the entire question paper
 * with every MCQ option, the correct answer and the explanation. Nothing is
 * abbreviated: all questions print, in order, flowing across pages.
 */
const examComplete = {
  id: 'exam.complete',
  category: 'exam',
  title: 'Complete Examination Report',
  subtitle: 'পরীক্ষার পূর্ণ তথ্য + সম্পূর্ণ প্রশ্নপত্র + সঠিক উত্তর',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['exam'],
  requiresExam: true,
  async build(ctx) {
    const exam = examsFor(ctx)[0];
    if (!exam) return { scopeLines: scopeLine(ctx), blocks: [] };
    const rows = questionRows(exam, null);
    const blocks = [
      examInfoBlock(exam),
      kv([
        ['নেগেটিভ মার্কিং', exam.type === 'mcq' ? num(exam.negative) : 'প্রযোজ্য নয়'],
        ['পাসের শতাংশ', percent(exam.passPercent ?? 33)],
        ['অবস্থা', EXAM_STATUSES[exam.status] || exam.status],
        ['নির্দেশনা', exam.instructions || '—']
      ], 2),
      heading(`সম্পূর্ণ প্রশ্নপত্র • সব ${num(rows.length)} টি প্রশ্ন`),
      questions(rows, { showAnswer: true, showStudent: false })
    ];
    return { scopeLines: scopeLine(ctx), blocks };
  }
};

/** Student-specific complete exam report: question-wise performance. */
const examCompleteStudent = {
  id: 'exam.complete-student',
  category: 'exam',
  title: 'Student-wise Complete Exam Report',
  subtitle: 'শিক্ষার্থীর তথ্য + পূর্ণ প্রশ্নপত্র + প্রশ্নভিত্তিক ফলাফল',
  roles: ['admin', 'manager', 'teacher', 'student'],
  filters: ['exam', 'student'],
  requiresExam: true,
  requiresStudent: true,
  async build(ctx) {
    const exam = examsFor(ctx)[0];
    if (!exam) return { scopeLines: scopeLine(ctx), blocks: [] };
    const studentId = String(ctx.filters.studentId || ctx.scope?.studentId || '');
    const attempt = bestAttempts(ctx.snapshot.exams?.attempts || [], exam.id)
      .find(item => String(item.studentId) === studentId);
    const student = studentMapOf(ctx.snapshot).get(studentId) || { id: studentId, name: attempt?.name || '—' };
    const rows = questionRows(exam, attempt || null);
    const counters = attemptCounters(exam, attempt || null);
    const result = resultFor(exam, attempt || null);
    return {
      scopeLines: [`শিক্ষার্থী: ${student.name} (${student.id})`],
      blocks: [
        heading('শিক্ষার্থীর তথ্য'),
        kv([
          ['Student ID', student.id], ['নাম', student.name],
          ['শ্রেণি', student.className || attempt?.className || '—'],
          ['বিভাগ', student.group || attempt?.group || '—']
        ], 4),
        examInfoBlock(exam),
        heading('পরীক্ষার সারাংশ'),
        tiles([
          { label: 'মোট প্রশ্ন', value: counters.totalLabel },
          { label: 'উত্তর', value: counters.attempted },
          { label: 'সঠিক', value: counters.correct },
          { label: 'ভুল', value: counters.wrong }
        ]),
        tiles([
          { label: 'অনুত্তরিত', value: counters.unanswered },
          { label: 'নির্ভুলতা', value: counters.accuracy },
          { label: 'প্রাপ্ত নম্বর', value: `${counters.obtained} / ${counters.marks}` },
          { label: 'শতাংশ', value: result.percentLabel }
        ]),
        heading('চূড়ান্ত ফলাফল'),
        kv([
          ['গ্রেড', result.grade], ['ফলাফল', result.pass ? 'উত্তীর্ণ' : 'অনুত্তীর্ণ'],
          ['জমার সময়', attempt?.finishedAt ? formatDate(attempt.finishedAt) : '—'],
          ['প্রচেষ্টা', attempt ? num(attempt.number) : '—']
        ], 4),
        heading('প্রশ্নভিত্তিক ফলাফল'),
        questions(rows, { showAnswer: true, showStudent: true })
      ]
    };
  }
};

/**
 * COMBINED REPORT — exam information, complete question paper, correct answers,
 * the student's answers, question-wise performance, marks, result and summary.
 */
const examCombined = {
  id: 'exam.combined',
  category: 'exam',
  title: 'Complete Examination + Student Result',
  subtitle: 'একই রিপোর্টে পূর্ণ প্রশ্নপত্র ও শিক্ষার্থীর ফলাফল',
  roles: ['admin', 'manager', 'teacher', 'student'],
  filters: ['exam', 'student'],
  requiresExam: true,
  requiresStudent: true,
  async build(ctx) {
    const base = await examCompleteStudent.build(ctx);
    const exam = examsFor(ctx)[0];
    if (!exam) return { scopeLines: scopeLine(ctx), blocks: [] };
    const studentId = String(ctx.filters.studentId || ctx.scope?.studentId || '');
    const attempt = bestAttempts(ctx.snapshot.exams?.attempts || [], exam.id).find(item => String(item.studentId) === studentId);
    const counters = attemptCounters(exam, attempt || null);
    const result = resultFor(exam, attempt || null);
    const blocks = [...base.blocks];
    blocks.push(heading('সামগ্রিক সারাংশ'));
    blocks.push(table([
      { label: 'বিবরণ', width: 2.4 }, { label: 'মান', width: 1, align: 'right' }
    ], [
      ['মোট প্রশ্ন', counters.totalLabel],
      ['উত্তর দেওয়া হয়েছে', counters.attempted],
      ['সঠিক', counters.correct],
      ['ভুল', counters.wrong],
      ['অনুত্তরিত', counters.unanswered],
      ['নির্ভুলতা', counters.accuracy],
      ['প্রাপ্ত নম্বর', `${counters.obtained} / ${counters.marks}`],
      ['শতাংশ', result.percentLabel],
      ['গ্রেড', result.grade],
      ['ফলাফল', result.pass ? 'উত্তীর্ণ' : 'অনুত্তীর্ণ']
    ]));
    return { scopeLines: base.scopeLines, blocks };
  }
};

/* ==========================================================================
   F. RESULT REPORTS
   ========================================================================== */

const resultSummary = {
  id: 'result.summary',
  category: 'result',
  title: 'Result Report',
  subtitle: 'নির্বাচিত পরীক্ষার ফলাফল — র‍্যাংকসহ',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['exam', 'class', 'batch', 'resultStatus'],
  requiresExam: true,
  async build(ctx) {
    const exam = examsFor(ctx)[0];
    if (!exam) return { scopeLines: scopeLine(ctx), blocks: [] };
    const attempts = bestAttempts(ctx.snapshot.exams?.attempts || [], exam.id);
    const results = attempts.map(attempt => ({ attempt, result: resultFor(exam, attempt) }))
      .filter(({ result }) => {
        if (!ctx.filters.resultStatus || ctx.filters.resultStatus === 'all') return true;
        if (ctx.filters.resultStatus === 'pass') return result.pass;
        if (ctx.filters.resultStatus === 'fail') return !result.pass;
        return false;
      });
    const rows = results.map(({ attempt, result }, index) => [
      num(index + 1), dash(attempt.studentId), dash(attempt.name || attempt.studentId),
      dash(attempt.className), dash(attempt.group || '—'),
      num(result.score), num(result.total), result.percentLabel, result.grade,
      result.pass ? 'উত্তীর্ণ' : 'অনুত্তীর্ণ'
    ]);
    const scores = results.map(item => item.result.score);
    return {
      scopeLines: scopeLine(ctx),
      blocks: [
        examInfoBlock(exam),
        tiles([
          { label: 'উত্তরপত্র', value: num(rows.length) },
          { label: 'গড়', value: scores.length ? num(scores.reduce((a, b) => a + b, 0) / scores.length) : '—' },
          { label: 'সর্বোচ্চ', value: num(scores.length ? Math.max(...scores) : 0) },
          { label: 'উত্তীর্ণ', value: num(results.filter(item => item.result.pass).length) }
        ]),
        table(RESULT_COLUMNS(), rows, 'ফলাফল')
      ]
    };
  }
};

const resultMarks = {
  id: 'result.marks',
  category: 'result',
  title: 'Marks Report',
  subtitle: 'কাজ / মূল্যায়নভিত্তিক নম্বর',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['period', 'class', 'batch', 'subject', 'student'],
  period: 'activity',
  async build(ctx) {
    const activities = activitiesFor(ctx, ['exam']);
    const map = studentMapOf(ctx.snapshot);
    const rows = [];
    for (const activity of activities) {
      for (const [studentId, entry] of Object.entries(activity.progress || {})) {
        if (ctx.filters.studentId && String(studentId) !== String(ctx.filters.studentId)) continue;
        const student = map.get(String(studentId)) || {};
        const marks = Number(entry?.value) || 0;
        rows.push([
          dateLabel(activity.date), dash(activity.title), dash(activity.subject || '—'),
          dash(student.name || studentId), dash(studentId), dash(student.className),
          dash(student.group || '—'), num(marks), num(activity.totalMarks || 0),
          activity.totalMarks ? percent(marks / Number(activity.totalMarks) * 100) : '—',
          gradeFor(marks, Number(activity.totalMarks) || 0, 33)
        ]);
      }
    }
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মূল্যায়ন', value: num(activities.length) },
          { label: 'এন্ট্রি', value: num(rows.length) }
        ], 4),
        table([
          { label: 'তারিখ', width: 1 }, { label: 'মূল্যায়ন', width: 1.8 }, { label: 'বিষয়', width: 1.1 },
          { label: 'শিক্ষার্থী', width: 1.6 }, { label: 'Student ID', width: 1.1 }, { label: 'শ্রেণি', width: 1 },
          { label: 'বিভাগ', width: 1 }, { label: 'প্রাপ্ত', width: 0.8, align: 'right' },
          { label: 'মোট', width: 0.8, align: 'right' }, { label: 'শতাংশ', width: 0.9, align: 'right' }, { label: 'গ্রেড', width: 0.7 }
        ], rows, 'নম্বরের তালিকা')
      ]
    };
  }
};

const resultPerformance = {
  id: 'result.performance',
  category: 'result',
  title: 'Academic Performance Report',
  subtitle: 'শিক্ষার্থীভিত্তিক সামগ্রিক ফলাফল',
  roles: ['admin', 'manager', 'teacher'],
  filters: ['class', 'batch'],
  async build(ctx) {
    const students = studentsFor(ctx);
    const exams = examsFor(ctx, { publishedOnly: true });
    const attempts = ctx.snapshot.exams?.attempts || [];
    const rows = students.map(student => {
      const own = exams.flatMap(exam => bestAttempts(attempts, exam.id)
        .filter(item => String(item.studentId) === String(student.id))
        .map(item => resultFor(exam, item)));
      const average = own.length ? own.reduce((sum, item) => sum + item.percent, 0) / own.length : null;
      return [
        dash(student.id), dash(student.name), dash(student.className), dash(student.group || 'সাধারণ'),
        num(own.length), num(own.filter(item => item.pass).length), num(own.filter(item => !item.pass).length),
        average === null ? '—' : percent(average),
        average === null ? '—' : gradeFor(average, 100, 33)
      ];
    });
    return {
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'শিক্ষার্থী', value: num(students.length) },
          { label: 'পরীক্ষা', value: num(exams.length) },
          { label: 'মূল্যায়নযোগ্য', value: num(rows.filter(row => row[4] !== '০').length) }
        ]),
        table([
          { label: 'Student ID', width: 1.1 }, { label: 'নাম', width: 1.7 }, { label: 'শ্রেণি', width: 1.1 },
          { label: 'বিভাগ', width: 1 }, { label: 'পরীক্ষা', width: 0.9, align: 'right' },
          { label: 'উত্তীর্ণ', width: 0.9, align: 'right' }, { label: 'অনুত্তীর্ণ', width: 1, align: 'right' },
          { label: 'গড়', width: 1, align: 'right', emphasis: true }, { label: 'গ্রেড', width: 0.8 }
        ], rows, 'একাডেমিক পারফরম্যান্স')
      ]
    };
  }
};

/* ==========================================================================
   G. NOTICE REPORTS

   A notice record is { id, title, body, audience, date, createdAt, status,
   author } — there is no class/batch field on it, so "class/batch-wise"
   groups by the audience the notice was actually published to. Nothing else
   is invented here.
   ========================================================================== */

const NOTICE_COLUMNS = () => ([
  { label: 'তারিখ', width: 1.1 },
  { label: 'শিরোনাম', width: 1.8 },
  { label: 'বিবরণ', width: 2.8 },
  { label: 'Audience', width: 1.2 },
  { label: 'প্রকাশক', width: 1.1 },
  { label: 'অবস্থা', width: 1 }
]);

const noticeTime = item => parseDate(item?.createdAt) ?? parseDate(item?.date);

const noticeRow = item => ([
  dateLabel(item.date) === '—' && noticeTime(item) ? formatDate(noticeTime(item)) : dateLabel(item.date),
  dash(item.title), dash(item.body), dash(item.audience || 'সব শিক্ষার্থী'),
  dash(item.author || '—'), dash(item.status || 'প্রকাশিত')
]);

const noticeReport = ({ id, title, subtitle, filter, allTime = false }) => ({
  id,
  category: 'notice',
  title,
  subtitle,
  roles: ['admin', 'manager', 'teacher'],
  filters: allTime ? [] : ['period'],
  period: 'notice',
  async build(ctx) {
    const list = noticesFor(ctx, { period: !allTime })
      .filter(item => (filter === 'all' ? true : (item.status || 'published') === filter));
    return {
      period: allTime ? 'সব সময়' : ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'নোটিশ', value: num(list.length) },
          { label: 'প্রকাশিত', value: num(list.filter(item => (item.status || 'published') === 'published').length) },
          { label: 'Audience', value: num(new Set(list.map(item => item.audience || 'সব শিক্ষার্থী')).size) },
          { label: 'সর্বশেষ', value: list.length ? dash(list[0].date || '—') : '—' }
        ]),
        table(NOTICE_COLUMNS(), list.map(noticeRow), 'নোটিশ তালিকা')
      ]
    };
  }
});

/** Class / Batch-wise: grouped by the audience each notice was published to. */
const noticeByAudience = {
  id: 'notice.audience-wise',
  category: 'notice',
  title: 'Class / Batch-wise Notice',
  subtitle: 'কোন নোটিশ কার জন্য — audience অনুযায়ী',
  roles: ['admin', 'manager', 'teacher', 'student'],
  filters: [],
  period: 'notice',
  async build(ctx) {
    const list = noticesFor(ctx, { period: false });
    const groups = new Map();
    for (const item of list) {
      const key = item.audience || 'সব শিক্ষার্থী';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const blocks = [tiles([
      { label: 'নোটিশ', value: num(list.length) },
      { label: 'Audience গ্রুপ', value: num(groups.size) }
    ], 4)];
    for (const [audience, items] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      blocks.push(heading(`Audience: ${audience} • ${num(items.length)} টি`));
      blocks.push(table(NOTICE_COLUMNS(), items.map(noticeRow)));
    }
    return { scopeLines: scopeLine(ctx), blocks };
  }
};

/* ==========================================================================
   H. STAFF REPORTS — identity only

   Rows come from js/staff-directory.js#staffReportRows, which copies the
   safe fields out of a directory record. A password or credential never
   reaches a report: the report prints only what that function returns.
   ========================================================================== */

const STAFF_COLUMNS = () => ([
  { label: 'Staff ID', width: 1.2 },
  { label: 'নাম', width: 1.6 },
  { label: 'রোল', width: 1.1 },
  { label: 'মোবাইল', width: 1.2 },
  { label: 'Username', width: 1.5 },
  { label: 'স্ট্যাটাস', width: 1 },
  { label: 'যোগদান', width: 1.1 },
  { label: 'Assignment', width: 1.5 }
]);

const staffRow = record => ([
  dash(record.staffId), dash(record.name), dash(record.roleLabel || record.role),
  record.mobile ? bn(String(record.mobile)) : '—',
  dash(record.username), dash(record.statusLabel || record.status),
  dash(record.joiningDate || '—'), dash(record.assignment || '—')
]);

const staffReport = ({ id, title, subtitle, roleFilter }) => ({
  id,
  category: 'staff',
  title,
  subtitle,
  roles: ['admin'],
  staffOnly: true,
  filters: [],
  async build(ctx) {
    const staff = (await ctx.staff()) || [];
    const rows = ctx.staffRows(staff, { role: roleFilter || 'all' });
    const counts = ctx.staffCounts(staff);
    return {
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'মোট স্টাফ', value: num(counts.total) },
          { label: 'সক্রিয়', value: num(counts.active) },
          { label: 'নিষ্ক্রিয়', value: num(counts.inactive + counts.suspended) },
          { label: 'পাসওয়ার্ড বদল বাকি', value: num(counts.passwordDue) }
        ]),
        table(STAFF_COLUMNS(), rows.map(staffRow), 'স্টাফ তালিকা'),
        note('নোট: নিরাপত্তার জন্য কোনো পাসওয়ার্ড এই রিপোর্টে দেখানো হয় না।')
      ]
    };
  }
});

const staffStatus = {
  id: 'staff.status',
  category: 'staff',
  title: 'Staff Status Report',
  subtitle: 'স্ট্যাটাস অনুযায়ী স্টাফের সারাংশ',
  roles: ['admin'],
  staffOnly: true,
  filters: ['staffStatus'],
  async build(ctx) {
    const staff = (await ctx.staff()) || [];
    const counts = ctx.staffCounts(staff);
    const groups = new Map();
    const chosen = ctx.filters.staffStatus && ctx.filters.staffStatus !== 'all' ? ctx.filters.staffStatus : null;
    for (const record of ctx.staffRows(staff, { status: chosen || 'all' })) {
      const key = record.statusLabel || record.status || '—';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    const blocks = [
      tiles([
        { label: 'মোট', value: num(counts.total) },
        { label: 'সক্রিয়', value: num(counts.active) },
        { label: 'নিষ্ক্রিয়', value: num(counts.inactive) },
        { label: 'স্থগিত', value: num(counts.suspended) }
      ])
    ];
    for (const [status, rows] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      blocks.push(heading(`স্ট্যাটাস: ${status} • ${num(rows.length)} জন`));
      blocks.push(table(STAFF_COLUMNS(), rows.map(staffRow)));
    }
    return { scopeLines: scopeLine(ctx), blocks };
  }
};

const staffTeacherAssignment = {
  id: 'staff.teacher-assignment',
  category: 'staff',
  title: 'Teacher Assignment Report',
  subtitle: 'শিক্ষকের শ্রেণি, ব্যাচ ও বিষয় বণ্টন',
  roles: ['admin', 'manager'],
  filters: ['class', 'subject'],
  async build(ctx) {
    const assignments = (await ctx.assignments()) || [];
    const list = assignments.filter(item => (
      (!ctx.filters.className || ctx.filters.className === 'all' || item.className === ctx.filters.className)
      && (!ctx.filters.subject || ctx.filters.subject === 'all' || item.subject === ctx.filters.subject)
    ));
    return {
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'অ্যাসাইনমেন্ট', value: num(list.length) },
          { label: 'শিক্ষক', value: num(new Set(list.map(item => item.teacherUsername)).size) },
          { label: 'শ্রেণি', value: num(new Set(list.map(item => item.className)).size) },
          { label: 'বিষয়', value: num(new Set(list.map(item => item.subject)).size) }
        ]),
        table([
          { label: 'শিক্ষক', width: 1.7 }, { label: 'Username', width: 1.4 },
          { label: 'শ্রেণি', width: 1.2 }, { label: 'বিভাগ / ব্যাচ', width: 1.3 }, { label: 'বিষয়', width: 1.4 }
        ], list.map(item => [
          dash(item.teacherName), dash(item.teacherUsername), dash(item.className),
          dash(item.group || 'সব'), dash(item.subject)
        ]), 'অ্যাসাইনমেন্ট')
      ]
    };
  }
};

const staffActivity = {
  id: 'staff.activity',
  category: 'staff',
  title: 'Staff Activity Report',
  subtitle: 'শিক্ষকের ক্লাস, বাড়ির কাজ, নোটিশ ও মূল্যায়ন',
  roles: ['admin', 'manager'],
  filters: ['period', 'teacher', 'class', 'subject'],
  period: 'activity',
  async build(ctx) {
    const activities = activitiesFor(ctx);
    const byTeacher = new Map();
    for (const activity of activities) {
      const key = activity.teacherName || '—';
      const entry = byTeacher.get(key) || { teacher: key, total: 0, routine: 0, homework: 0, suggestion: 0, exam: 0 };
      entry.total += 1;
      if (entry[activity.type] !== undefined) entry[activity.type] += 1;
      byTeacher.set(key, entry);
    }
    const list = [...byTeacher.values()].sort((a, b) => b.total - a.total);
    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        tiles([
          { label: 'কার্যক্রম', value: num(activities.length) },
          { label: 'শিক্ষক', value: num(list.length) },
          { label: 'ক্লাস সেশন', value: num(list.reduce((sum, item) => sum + item.routine, 0)) },
          { label: 'বাড়ির কাজ', value: num(list.reduce((sum, item) => sum + item.homework, 0)) }
        ]),
        table([
          { label: 'শিক্ষক', width: 2 }, { label: 'ক্লাস সেশন', width: 1, align: 'right' },
          { label: 'বাড়ির কাজ', width: 1, align: 'right' }, { label: 'নোটিশ', width: 1, align: 'right' },
          { label: 'মূল্যায়ন', width: 1, align: 'right' }, { label: 'মোট', width: 1, align: 'right', emphasis: true }
        ], list.map(item => [
          item.teacher, num(item.routine), num(item.homework), num(item.suggestion), num(item.exam), num(item.total)
        ]), 'কার্যক্রম')
      ]
    };
  }
};

/* ==========================================================================
   I. MANAGEMENT SUMMARY
   ========================================================================== */

const managementSummary = {
  id: 'management.summary',
  category: 'management',
  title: 'Management Summary',
  subtitle: 'প্রতিষ্ঠানের সামগ্রিক চিত্র — শিক্ষার্থী, ফি, উপস্থিতি, পরীক্ষা ও ফলাফল',
  roles: ['admin', 'manager'],
  filters: ['period'],
  period: 'tx',
  async build(ctx) {
    const students = studentsFor(ctx);
    const transactions = transactionsFor(ctx);
    const approved = transactions.filter(isFinalized);
    const pending = transactions.filter(tx => tx.status === 'pending');
    const rejected = transactions.filter(tx => tx.status === 'rejected');
    const month = monthLabelOf(ctx.range.from === -Infinity ? Date.now() : ctx.range.from);
    const dues = students
      .filter(student => ['approved', 'active'].includes(student.status))
      .map(student => dueSummary(student, ctx.snapshot.transactions || [], month))
      .filter(summary => summary.due > 0);
    const newStudents = students.filter(student => inRange(studentEnrolledAt(student), ctx.range));
    const sessions = activitiesFor(ctx, ['routine']);
    const exams = examsFor(ctx, { period: true, publishedOnly: true });
    const attempts = ctx.snapshot.exams?.attempts || [];
    const results = exams.flatMap(exam => bestAttempts(attempts, exam.id).map(attempt => resultFor(exam, attempt)));
    const classes = new Set(students.map(student => student.className).filter(Boolean));
    const batches = new Set(students.map(student => student.group || 'সাধারণ'));

    return {
      period: ctx.range.label,
      scopeLines: scopeLine(ctx),
      blocks: [
        heading('শিক্ষার্থী'),
        tiles([
          { label: 'মোট শিক্ষার্থী', value: num(students.length) },
          { label: 'নতুন ভর্তি', value: num(newStudents.length) },
          { label: 'সক্রিয়', value: num(students.filter(s => ['approved', 'active'].includes(s.status)).length) },
          { label: 'নিষ্ক্রিয় / বাতিল', value: num(students.filter(s => !['approved', 'active'].includes(s.status)).length) }
        ]),
        heading('আর্থিক'),
        tiles([
          { label: 'মোট আদায়', value: money(sumAmount(transactions)) },
          { label: 'লেনদেন', value: num(approved.length) },
          { label: 'অনুমোদনের অপেক্ষায়', value: num(pending.length) },
          { label: 'বাতিল', value: num(rejected.length) }
        ]),
        tiles([
          { label: 'মোট বকেয়া', value: money(dues.reduce((sum, item) => sum + item.due, 0)) },
          { label: 'বকেয়া শিক্ষার্থী', value: num(dues.length) },
          { label: 'শ্রেণি', value: num(classes.size) },
          { label: 'বিভাগ', value: num(batches.size) }
        ]),
        heading('একাডেমিক'),
        tiles([
          { label: 'ক্লাস সেশন', value: num(sessions.length) },
          { label: 'পরীক্ষা', value: num(exams.length) },
          { label: 'উত্তরপত্র', value: num(results.length) },
          { label: 'উত্তীর্ণ', value: num(results.filter(item => item.pass).length) }
        ]),
        table([
          { label: 'সূচক', width: 2.4 }, { label: 'মান', width: 1.2, align: 'right', emphasis: true }
        ], [
          ['মোট শিক্ষার্থী', num(students.length)],
          ['নতুন ভর্তি (নির্বাচিত সময়)', num(newStudents.length)],
          ['সক্রিয় শিক্ষার্থী', num(students.filter(s => ['approved', 'active'].includes(s.status)).length)],
          ['নিষ্ক্রিয় / বাতিল', num(students.filter(s => !['approved', 'active'].includes(s.status)).length)],
          ['মোট ফি আদায়', money(sumAmount(transactions))],
          ['মোট বকেয়া (' + month + ')', money(dues.reduce((sum, item) => sum + item.due, 0))],
          ['মোট লেনদেন', num(transactions.length)],
          ['অনুমোদনের অপেক্ষায়', num(pending.length)],
          ['মোট শ্রেণি', num(classes.size)],
          ['মোট বিভাগ', num(batches.size)],
          ['ক্লাস সেশন', num(sessions.length)],
          ['পরীক্ষা', num(exams.length)],
          ['উত্তরপত্র', num(results.length)],
          ['উত্তীর্ণ', num(results.filter(item => item.pass).length)],
          ['অনুত্তীর্ণ', num(results.filter(item => !item.pass).length)]
        ], 'সারাংশ সূচক')
      ]
    };
  }
};

/* ==========================================================================
   J. "আমার রিপোর্ট" — a student only ever sees their own records
   ========================================================================== */

const myReport = ({ id, title, subtitle, build }) => ({
  id,
  category: 'mine',
  title,
  subtitle,
  roles: ['student'],
  filters: [],
  async build(ctx) {
    const blocks = await build(ctx);
    return { scopeLines: [`শিক্ষার্থী: ${ctx.actor?.name || '—'} (${ctx.scope?.studentId || '—'})`], blocks };
  }
});

const myPayment = myReport({
  id: 'mine.payment',
  title: 'My Payment Report',
  subtitle: 'আমার সব পেমেন্ট',
  async build(ctx) {
    const rows = transactionsFor(ctx);
    const map = studentMapOf(ctx.snapshot);
    return [
      tiles([
        { label: 'মোট পরিশোধ', value: money(sumAmount(rows)) },
        { label: 'লেনদেন', value: num(rows.filter(isFinalized).length) }
      ], 4),
      table(TX_COLUMNS(), rows.map(tx => txRow(tx, map)), 'আমার পেমেন্ট')
    ];
  }
});

const myDue = myReport({
  id: 'mine.due',
  title: 'My Due Report',
  subtitle: 'আমার বকেয়া',
  async build(ctx) {
    const month = monthLabelOf(Date.now());
    const student = studentMapOf(ctx.snapshot).get(String(ctx.scope?.studentId)) || {};
    const summary = dueSummary(student, ctx.snapshot.transactions || [], month);
    return [
      kv([
        ['Student ID', student.id], ['নাম', student.name], ['শ্রেণি', student.className],
        ['বিভাগ', student.group || 'সাধারণ'], ['মাস', month], ['মাসিক বেতন', money(summary.monthlyFee)],
        ['পরিশোধিত', money(summary.paid)], ['বকেয়া', money(summary.due)]
      ], 3),
      tiles([
        { label: 'চলতি মাসের বকেয়া', value: money(summary.due) },
        { label: 'পরিশোধিত', value: money(summary.paid) }
      ], 4)
    ];
  }
});

const myReceipt = myReport({
  id: 'mine.receipt',
  title: 'My Receipt Report',
  subtitle: 'আমার সব রসিদ',
  async build(ctx) {
    const rows = transactionsFor(ctx);
    return [
      tiles([{ label: 'রসিদ', value: num(rows.length) }, { label: 'মোট', value: money(sumAmount(rows)) }], 4),
      table([
        { label: 'রসিদ নং', width: 2 }, { label: 'তারিখ', width: 1.2 }, { label: 'ফি ও মাস', width: 1.6 },
        { label: 'পরিমাণ', width: 1.1, align: 'right', emphasis: true }, { label: 'মাধ্যম', width: 1.1 }, { label: 'অবস্থা', width: 1.1 }
      ], rows.map(tx => [
        dash(tx.receiptNo || tx.id), dash(tx.date), `${dash(tx.feeType)} • ${dash(tx.month)}`,
        money(tx.amount), dash(tx.method), approvalLabel(tx)
      ]), 'আমার রসিদ')
    ];
  }
});

const myAttendance = myReport({
  id: 'mine.attendance',
  title: 'My Attendance Report',
  subtitle: 'আমার উপস্থিতি',
  async build(ctx) {
    const sessions = activitiesFor(ctx, ['routine']);
    const rows = sessions.map(session => {
      const value = session.progress?.[ctx.scope?.studentId]?.value;
      return [dash(session.date), dash(session.subject || session.title), dash(session.className), PROGRESS_TEXT[value] || '—'];
    });
    const present = rows.filter(row => row[3] === 'উপস্থিত').length;
    const late = rows.filter(row => row[3] === 'দেরিতে উপস্থিত').length;
    const absent = rows.filter(row => row[3] === 'অনুপস্থিত').length;
    return [
      tiles([
        { label: 'মোট সেশন', value: num(rows.length) },
        { label: 'উপস্থিত', value: num(present) },
        { label: 'দেরিতে', value: num(late) },
        { label: 'অনুপস্থিত', value: num(absent) }
      ]),
      table([
        { label: 'তারিখ', width: 1.2 }, { label: 'বিষয়', width: 2 }, { label: 'শ্রেণি', width: 1.3 }, { label: 'অবস্থা', width: 1.3 }
      ], rows, 'আমার উপস্থিতি')
    ];
  }
});

const myAssignment = myReport({
  id: 'mine.assignment',
  title: 'My Assignment Report',
  subtitle: 'আমার বাড়ির কাজ ও জমার অবস্থা',
  async build(ctx) {
    const homework = activitiesFor(ctx, ['homework']);
    const rows = homework.map(activity => [
      dateLabel(activity.date), dash(activity.title), dash(activity.subject),
      PROGRESS_TEXT[activity.progress?.[ctx.scope?.studentId]?.value] || 'বাকি'
    ]);
    const done = rows.filter(row => ['জমা দিয়েছে', 'দেখা হয়েছে'].includes(row[3])).length;
    return [
      tiles([
        { label: 'মোট কাজ', value: num(rows.length) },
        { label: 'জমা', value: num(done) },
        { label: 'বাকি', value: num(rows.length - done) },
        { label: 'জমার হার', value: rows.length ? percent(done / rows.length * 100) : '—' }
      ]),
      table([
        { label: 'তারিখ', width: 1.1 }, { label: 'কাজ', width: 2.4 }, { label: 'বিষয়', width: 1.3 }, { label: 'অবস্থা', width: 1.3 }
      ], rows, 'আমার বাড়ির কাজ')
    ];
  }
});

const myExamination = myReport({
  id: 'mine.examination',
  title: 'My Examination Report',
  subtitle: 'আমার পরীক্ষাসমূহ ও অংশগ্রহণ',
  async build(ctx) {
    const exams = examsFor(ctx, { publishedOnly: true });
    const attempts = ctx.snapshot.exams?.attempts || [];
    const rows = exams.map(exam => {
      const attempt = bestAttempts(attempts, exam.id).find(item => String(item.studentId) === String(ctx.scope?.studentId));
      return [
        dash(exam.title), dash(exam.subject), examTime(exam) ? formatDate(examTime(exam)) : '—',
        examDuration(exam), num((exam.questions || []).length), num(totalMarks(exam)),
        attempt ? 'অংশ নিয়েছি' : 'অংশ নিইনি'
      ];
    });
    return [
      tiles([
        { label: 'পরীক্ষা', value: num(rows.length) },
        { label: 'অংশগ্রহণ', value: num(rows.filter(row => row[6] === 'অংশ নিয়েছি').length) }
      ], 4),
      table([
        { label: 'পরীক্ষা', width: 2 }, { label: 'বিষয়', width: 1.3 }, { label: 'তারিখ', width: 1.2 },
        { label: 'সময়', width: 1.1 }, { label: 'প্রশ্ন', width: 0.8, align: 'right' },
        { label: 'নম্বর', width: 0.9, align: 'right' }, { label: 'অংশগ্রহণ', width: 1.2 }
      ], rows, 'আমার পরীক্ষা')
    ];
  }
});

const myMarks = myReport({
  id: 'mine.marks',
  title: 'My Marks Report',
  subtitle: 'আমার নম্বরপত্র',
  async build(ctx) {
    const exams = examsFor(ctx, { publishedOnly: true });
    const attempts = ctx.snapshot.exams?.attempts || [];
    const rows = exams.map(exam => {
      const attempt = bestAttempts(attempts, exam.id).find(item => String(item.studentId) === String(ctx.scope?.studentId));
      const counters = attemptCounters(exam, attempt || null);
      return [
        dash(exam.title), dash(exam.subject), counters.attempted, counters.correct,
        counters.wrong, counters.unanswered, `${counters.obtained} / ${counters.marks}`, counters.accuracy
      ];
    }).filter(row => row[2] !== '০' || row[6] !== '০ / ০');
    return [
      table([
        { label: 'পরীক্ষা', width: 2 }, { label: 'বিষয়', width: 1.3 }, { label: 'উত্তর', width: 0.8, align: 'right' },
        { label: 'সঠিক', width: 0.8, align: 'right' }, { label: 'ভুল', width: 0.8, align: 'right' },
        { label: 'অনুত্তরিত', width: 1, align: 'right' }, { label: 'প্রাপ্ত নম্বর', width: 1.2, align: 'right', emphasis: true },
        { label: 'নির্ভুলতা', width: 1, align: 'right' }
      ], rows, 'আমার নম্বর')
    ];
  }
});

const myResult = myReport({
  id: 'mine.result',
  title: 'My Result Report',
  subtitle: 'আমার ফলাফল — গ্রেড ও শতাংশসহ',
  async build(ctx) {
    const exams = examsFor(ctx, { publishedOnly: true });
    const attempts = ctx.snapshot.exams?.attempts || [];
    const rows = [];
    for (const exam of exams) {
      const attempt = bestAttempts(attempts, exam.id).find(item => String(item.studentId) === String(ctx.scope?.studentId));
      if (!attempt) continue;
      const result = resultFor(exam, attempt);
      rows.push([
        dash(exam.title), dash(exam.subject), examTime(exam) ? formatDate(examTime(exam)) : '—',
        num(result.score), num(result.total), result.percentLabel, result.grade, result.pass ? 'উত্তীর্ণ' : 'অনুত্তীর্ণ'
      ]);
    }
    const percents = rows.map(row => Number(String(row[5]).replace(/[^\d.]/g, ''))).filter(Boolean);
    return [
      tiles([
        { label: 'পরীক্ষা', value: num(rows.length) },
        { label: 'উত্তীর্ণ', value: num(rows.filter(row => row[7] === 'উত্তীর্ণ').length) },
        { label: 'গড় শতাংশ', value: percents.length ? percent(percents.reduce((a, b) => a + b, 0) / percents.length) : '—' }
      ]),
      table([
        { label: 'পরীক্ষা', width: 1.9 }, { label: 'বিষয়', width: 1.2 }, { label: 'তারিখ', width: 1.1 },
        { label: 'প্রাপ্ত', width: 0.9, align: 'right' }, { label: 'মোট', width: 0.9, align: 'right' },
        { label: 'শতাংশ', width: 1, align: 'right', emphasis: true }, { label: 'গ্রেড', width: 0.8 }, { label: 'ফলাফল', width: 1.1 }
      ], rows, 'আমার ফলাফল')
    ];
  }
});

const myPerformance = myReport({
  id: 'mine.performance',
  title: 'My Academic Performance Report',
  subtitle: 'উপস্থিতি, কাজ ও ফলাফল — আমার সামগ্রিক চিত্র',
  async build(ctx) {
    const sessions = activitiesFor(ctx, ['routine']);
    const homework = activitiesFor(ctx, ['homework']);
    const exams = examsFor(ctx, { publishedOnly: true });
    const attempts = ctx.snapshot.exams?.attempts || [];
    const id = String(ctx.scope?.studentId);
    let present = 0, absent = 0, late = 0;
    for (const session of sessions) {
      const value = session.progress?.[id]?.value;
      if (value === 'present') present += 1;
      else if (value === 'absent') absent += 1;
      else if (value === 'late') late += 1;
    }
    const totalSessions = present + absent + late;
    const assigned = homework.filter(activity => activity.progress?.[id]).length;
    const submitted = homework.filter(activity => ['done', 'reviewed'].includes(activity.progress?.[id]?.value)).length;
    const results = exams.flatMap(exam => bestAttempts(attempts, exam.id)
      .filter(item => String(item.studentId) === id).map(item => resultFor(exam, item)));
    const average = results.length ? results.reduce((sum, item) => sum + item.percent, 0) / results.length : null;
    return [
      tiles([
        { label: 'উপস্থিতির হার', value: totalSessions ? percent((present + late) / totalSessions * 100) : '—' },
        { label: 'কাজ জমা', value: assigned ? percent(submitted / assigned * 100) : '—' },
        { label: 'পরীক্ষা', value: num(results.length) },
        { label: 'গড় ফলাফল', value: average === null ? '—' : percent(average) }
      ]),
      kv([
        ['মোট সেশন', num(totalSessions)], ['উপস্থিত', num(present)], ['দেরিতে', num(late)],
        ['অনুপস্থিত', num(absent)], ['দায়িত্ব পাওয়া কাজ', num(assigned)], ['জমা দেওয়া', num(submitted)],
        ['পরীক্ষা', num(results.length)], ['উত্তীর্ণ', num(results.filter(item => item.pass).length)]
      ], 4),
      table([
        { label: 'পরীক্ষা', width: 2 }, { label: 'বিষয়', width: 1.3 }, { label: 'প্রাপ্ত', width: 1, align: 'right' },
        { label: 'মোট', width: 1, align: 'right' }, { label: 'শতাংশ', width: 1, align: 'right', emphasis: true },
        { label: 'গ্রেড', width: 0.9 }, { label: 'ফলাফল', width: 1.2 }
      ], results.map((result, index) => [
        dash(exams[index]?.title), dash(exams[index]?.subject), num(result.score),
        num(result.total), result.percentLabel, result.grade, result.pass ? 'উত্তীর্ণ' : 'অনুত্তীর্ণ'
      ]), 'আমার একাডেমিক পারফরম্যান্স')
    ];
  }
});

/* ==========================================================================
   REGISTRY
   ========================================================================== */

export const BUILDERS = Object.freeze([
  /* A. Student */
  studentList({ filter: 'all', title: 'Student Master List', subtitle: 'সব শিক্ষার্থীর পূর্ণ তালিকা' }),
  studentProfile,
  studentList({ filter: 'pending', title: 'New Registration Report', subtitle: 'নতুন আবেদন — অনুমোদনের অপেক্ষায়' }),
  studentList({ filter: 'approved', title: 'Approved Registration Report', subtitle: 'অনুমোদিত শিক্ষার্থী' }),
  studentList({ filter: 'rejected', title: 'Rejected Registration Report', subtitle: 'বাতিল করা আবেদন' }),
  studentList({ filter: 'active', title: 'Active Student Report', subtitle: 'সক্রিয় শিক্ষার্থী' }),
  studentList({ filter: 'inactive', title: 'Inactive Student Report', subtitle: 'নিষ্ক্রিয় / স্থগিত শিক্ষার্থী' }),
  studentClassWise,
  studentBatchWise,
  studentStatusReport,

  /* B. Fee & Accounts */
  collectionReport({ id: 'fee.daily', title: 'Daily Fee Collection', subtitle: 'নির্বাচিত দিনের ফি আদায়', period: 'daily' }),
  collectionReport({ id: 'fee.weekly', title: 'Weekly Fee Collection', subtitle: 'নির্বাচিত সপ্তাহের ফি আদায়', period: 'weekly', roles: ['admin', 'manager'] }),
  collectionReport({ id: 'fee.monthly', title: 'Monthly Fee Collection', subtitle: 'নির্বাচিত মাসের ফি আদায়', period: 'monthly', roles: ['admin', 'manager'] }),
  collectionReport({ id: 'fee.custom', title: 'Custom Date Collection', subtitle: 'নির্দিষ্ট তারিখ সীমার ফি আদায়', period: 'custom', roles: ['admin', 'manager'] }),
  feeStudentWise,
  feeByGroup({ id: 'fee.class-wise', title: 'Class-wise Payment Report', groupBy: 'class' }),
  feeByGroup({ id: 'fee.batch-wise', title: 'Batch-wise Payment Report', groupBy: 'batch' }),
  feeDueList,
  feeDueCollection,
  feeTransactions,
  feeReceipts,
  feePaymentStatus,

  /* C. Cash Counter */
  cashCollection({ id: 'cash.daily-collection', title: 'Daily Cash Collection', subtitle: 'দিনের ক্যাশ সংগ্রহ', period: 'daily' }),
  cashCollection({ id: 'cash.counter-wise', title: 'Cash Counter-wise Collection', subtitle: 'কাউন্টার অনুযায়ী সংগ্রহ', period: 'monthly' }),
  cashHistory,
  cashByStatus({ id: 'cash.pending', title: 'Pending Approval', subtitle: 'Manager অনুমোদনের অপেক্ষায় থাকা লেনদেন', status: 'pending' }),
  cashByStatus({ id: 'cash.approved', title: 'Approved Transactions', subtitle: 'অনুমোদিত লেনদেন', status: 'approved' }),
  cashByStatus({ id: 'cash.rejected', title: 'Rejected Transactions', subtitle: 'বাতিল করা লেনদেন', status: 'rejected' }),
  cashClosing,
  cashOwnHistory,

  /* D. Academic */
  academicClass,
  academicBatch,
  academicTeacherWise,
  academicAttendance,
  academicAttendanceSummary,
  academicAssignment,
  academicSuggestion,
  academicAssignmentSubmission,
  academicPerformance,
  teacherMyClass,
  teacherMyBatch,
  teacherStudentAcademic,
  teacherAcademicNotice,

  /* E. Examination */
  examList({ id: 'exam.list', title: 'Examination List', subtitle: 'সব পরীক্ষার তালিকা', pick: () => true }),
  examList({ id: 'exam.upcoming', title: 'Upcoming Examination', subtitle: 'আসন্ন পরীক্ষা', pick: isUpcomingExam }),
  examList({ id: 'exam.completed', title: 'Completed Examination', subtitle: 'অনুষ্ঠিত পরীক্ষা', pick: isTakenExam }),
  examList({
    id: 'exam.taken',
    title: 'Taken Examination',
    subtitle: 'যে পরীক্ষায় অন্তত একজন উত্তর জমা দিয়েছে',
    pick: (exam, ctx) => isTakenExam(exam) && submittedAttempts(ctx.snapshot.exams?.attempts || [], exam.id).length > 0
  }),
  examParticipation,
  examSummary,
  examQuestionPaper,
  examAnswerKey,
  examMarksSheet,
  examByGroup({ id: 'exam.student-wise', title: 'Student-wise Examination Report', subtitle: 'শিক্ষার্থীভিত্তিক পরীক্ষার সারাংশ', groupBy: 'student' }),
  examByGroup({ id: 'exam.class-wise', title: 'Class-wise Examination Report', subtitle: 'শ্রেণিভিত্তিক পরীক্ষার সারাংশ', groupBy: 'class' }),
  examByGroup({ id: 'exam.batch-wise', title: 'Batch-wise Examination Report', subtitle: 'বিভাগভিত্তিক পরীক্ষার সারাংশ', groupBy: 'batch' }),
  examByGroup({ id: 'exam.subject-wise', title: 'Subject-wise Examination Report', subtitle: 'বিষয়ভিত্তিক পরীক্ষার সারাংশ', groupBy: 'subject' }),
  examComplete,
  examCompleteStudent,
  examCombined,

  /* F. Result */
  resultSummary,
  resultMarks,
  resultPerformance,

  /* G. Notice */
  noticeReport({ id: 'notice.list', title: 'Notice List', subtitle: 'নির্বাচিত সময়ের সব নোটিশ', filter: 'all' }),
  noticeReport({ id: 'notice.published', title: 'Published Notice', subtitle: 'প্রকাশিত নোটিশ', filter: 'published' }),
  noticeByAudience,
  noticeReport({ id: 'notice.history', title: 'Notice History', subtitle: 'সব সময়ের নোটিশ', filter: 'all', allTime: true }),

  /* H. Staff (Admin only — the staff directory is Admin-owned) */
  staffReport({ id: 'staff.managers', title: 'Manager List', subtitle: 'ম্যানেজারদের তালিকা', roleFilter: 'manager' }),
  staffReport({ id: 'staff.teachers', title: 'Teacher List', subtitle: 'শিক্ষকদের তালিকা', roleFilter: 'teacher' }),
  staffReport({ id: 'staff.cashiers', title: 'Cash Counter List', subtitle: 'ক্যাশ কাউন্টারের তালিকা', roleFilter: 'cash-counter' }),
  staffStatus,
  staffTeacherAssignment,
  staffActivity,

  /* I. Management */
  managementSummary,

  /* J. আমার রিপোর্ট (Student) */
  myPayment, myDue, myReceipt, myAttendance, myAssignment, myExamination, myMarks, myResult, myPerformance
]);
