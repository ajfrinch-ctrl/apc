/* Pure, fail-closed projection helpers for the authenticated RTDB v2 Question Bank.
 * Student copies intentionally include practice answers, but only at that
 * student's own path and only after any source exam has ended. */
'use strict';

const QUESTION_TYPES = new Set(['mcq', 'true_false', 'short_answer', 'written']);
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const SAFE_KEY = /^[A-Za-z0-9_-]{1,128}$/;
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 1200) => String(value ?? '').normalize('NFC').trim().slice(0, max);
const normalized = value => text(value, 200).toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const groupKey = value => normalized(value).replace(/\s*বিভাগ$/, '').trim();
const safeKey = value => typeof value === 'string' && SAFE_KEY.test(value);
const finiteTime = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;

function normalizeQuestionRecord(input, { id = input?.id, allowExamSource = true } = {}) {
  if (!object(input)) throw new TypeError('question must be an object');
  const questionId = text(id, 128);
  if (!safeKey(questionId) || text(input.id, 128) !== questionId) throw new TypeError('question id does not match its safe key');
  const type = QUESTION_TYPES.has(input.type) ? input.type : '';
  const className = text(input.className, 80);
  const subject = text(input.subject, 80);
  const body = text(input.text, 1200);
  if (!type || !className || !subject || !body) throw new TypeError('question type, class, subject and text are required');
  const rawOptions = Array.isArray(input.options) ? input.options : [];
  if (type === 'mcq' && rawOptions.length !== 4) throw new TypeError('MCQ requires four A-D options and a valid answer');
  const options = rawOptions.slice(0, 4).map(option => ({
    id: text(option?.id, 1).toUpperCase(),
    text: text(option?.text, 500)
  }));
  const answer = text(input.answer, 16).toUpperCase();
  const answerText = text(input.answerText, 1200);
  if (type === 'mcq' && (options.length !== 4 || options.map(option => option.id).join('') !== 'ABCD' || options.some(option => !option.text) || !['A', 'B', 'C', 'D'].includes(answer))) {
    throw new TypeError('MCQ requires four A-D options and a valid answer');
  }
  if (type === 'true_false' && !['সত্য', 'মিথ্যা'].includes(answerText)) {
    throw new TypeError('true/false question requires a Bengali answer');
  }
  const rawSource = allowExamSource && object(input.source) ? input.source : null;
  const sourceExamId = text(rawSource?.examId, 128);
  const source = sourceExamId ? {
    examId: sourceExamId,
    examCode: text(rawSource.examCode, 80),
    examTitle: text(rawSource.examTitle, 150),
    at: finiteTime(rawSource.at)
  } : null;
  const marks = Number(input.marks);
  const tags = Array.isArray(input.tags) ? input.tags.slice(0, 10).map(tag => text(tag, 80)).filter(Boolean) : [];
  return {
    id: questionId,
    code: text(input.code, 128) || questionId,
    className,
    subject,
    group: text(input.group, 80),
    chapterId: text(input.chapterId, 120),
    chapterName: text(input.chapterName, 120),
    topic: text(input.topic, 120),
    startAt: finiteTime(input.startAt),
    endAt: finiteTime(input.endAt),
    type,
    difficulty: DIFFICULTIES.has(input.difficulty) ? input.difficulty : 'medium',
    text: body,
    options,
    answer,
    answerText,
    marks: Number.isFinite(marks) && marks > 0 && marks <= 1000 ? marks : 1,
    source,
    tags,
    createdBy: text(input.createdBy, 100) || 'SYSTEM',
    createdAt: finiteTime(input.createdAt),
    updatedBy: text(input.updatedBy, 100) || text(input.createdBy, 100) || 'SYSTEM',
    updatedAt: finiteTime(input.updatedAt) || finiteTime(input.createdAt),
    active: input.active === true
  };
}

function publicQuestionCopy(question) {
  // Whitelist app-facing fields. Internal Auth UIDs and future server metadata
  // never flow into a student's practice bank.
  return {
    id: question.id,
    code: question.code,
    className: question.className,
    subject: question.subject,
    group: question.group,
    chapterId: question.chapterId,
    chapterName: question.chapterName,
    topic: question.topic,
    startAt: question.startAt,
    endAt: question.endAt,
    type: question.type,
    difficulty: question.difficulty,
    text: question.text,
    options: question.options,
    answer: question.answer,
    answerText: question.answerText,
    marks: question.marks,
    source: question.source,
    tags: question.tags,
    createdBy: question.createdBy,
    createdAt: question.createdAt,
    updatedBy: question.updatedBy,
    updatedAt: question.updatedAt,
    active: question.active
  };
}

function sourceExamHasEnded(question, now = Date.now()) {
  if (!question?.source?.examId) return true;
  const endAt = Number(question.endAt);
  return Number.isFinite(endAt) && endAt > 0 && endAt < Number(now);
}

function questionMatchesStudent(question, student, now = Date.now()) {
  if (!object(question) || !object(student) || student.status !== 'approved' || question.active !== true) return false;
  if (!text(student.className, 80) || normalized(question.className) !== normalized(student.className)) return false;
  const questionGroup = groupKey(question.group);
  if (questionGroup && questionGroup !== groupKey(student.group)) return false;
  return sourceExamHasEnded(question, now);
}

function assignmentMatchesQuestion(assignment, teacherId, question) {
  if (!object(assignment) || !safeKey(teacherId) || text(assignment.teacherId, 128) !== teacherId) return false;
  if (normalized(assignment.className) !== normalized(question.className)) return false;
  const subjects = Array.isArray(assignment.subjects) && assignment.subjects.length
    ? assignment.subjects
    : [assignment.subject];
  if (!subjects.some(subject => normalized(subject) === normalized(question.subject))) return false;
  const assignmentGroup = groupKey(assignment.group);
  const questionGroup = groupKey(question.group);
  // Match the app's assignment behavior: an ungrouped question requires an
  // ungrouped assignment; a named-group question may use a class-wide assignment.
  return questionGroup ? (!assignmentGroup || assignmentGroup === questionGroup) : !assignmentGroup;
}

function questionMatchesTeacher(question, teacherId, assignments) {
  return Array.isArray(assignments) && assignments.some(assignment => assignmentMatchesQuestion(assignment, teacherId, question));
}

function questionMatchesExamPaper(question, exam, teacherId) {
  if (!object(question) || !object(exam) || !safeKey(teacherId) || exam.teacherId !== teacherId
      || !['published', 'completed', 'archived'].includes(exam.status) || exam.type !== 'mcq'
      || question.type !== 'mcq' || !question.source?.examId || question.source.examId !== exam.id) return false;
  if (normalized(question.className) !== normalized(exam.className)
      || normalized(question.subject) !== normalized(exam.subject)
      || groupKey(question.group) !== groupKey(exam.group)) return false;
  return Array.isArray(exam.questions) && exam.questions.some(item => {
    if (!object(item) || normalized(item.text) !== normalized(question.text) || String(item.answer || '').toUpperCase() !== question.answer) return false;
    const paperOptions = Array.isArray(item.options) ? item.options : [];
    if (paperOptions.length !== 4 || !Array.isArray(question.options) || question.options.length !== 4) return false;
    const byId = new Map(paperOptions.map(option => [text(option?.id, 1).toUpperCase(), normalized(option?.text)]));
    return question.options.every(option => byId.get(option.id) === normalized(option.text));
  });
}

function buildStudentQuestionProjection(questions, student, now = Date.now()) {
  const projection = {};
  for (const [key, value] of Object.entries(questions || {})) {
    if (!safeKey(key) || !object(value) || value.id !== key || !questionMatchesStudent(value, student, now)) continue;
    try { projection[key] = publicQuestionCopy(normalizeQuestionRecord(value, { id: key })); }
    catch { /* malformed bank rows fail closed and remain for staff review */ }
  }
  return projection;
}

function buildTeacherQuestionProjection(questions, teacherId, assignments) {
  const projection = {};
  if (!safeKey(teacherId)) return projection;
  for (const [key, value] of Object.entries(questions || {})) {
    if (!safeKey(key) || !object(value) || value.id !== key || !questionMatchesTeacher(value, teacherId, assignments)) continue;
    try { projection[key] = publicQuestionCopy(normalizeQuestionRecord(value, { id: key })); }
    catch { /* malformed bank rows fail closed and remain for staff review */ }
  }
  return projection;
}

function mapValues(value) {
  if (Array.isArray(value)) return value.filter(object);
  return object(value) ? Object.values(value).filter(object) : [];
}

/** Build one atomic multi-location update for a canonical question change. */
function buildQuestionBankFanout({ questionId, before = null, after = null, students = {}, assignments = {}, now = Date.now() } = {}) {
  if (!safeKey(questionId)) throw new TypeError('unsafe question id');
  const previous = object(before) && before.id === questionId ? before : null;
  const next = object(after) && after.id === questionId ? after : null;
  const assignmentRows = mapValues(assignments);
  const studentRows = Object.entries(object(students) ? students : {});
  const updates = {};

  const teacherIds = new Set(assignmentRows.map(row => text(row.teacherId, 128)).filter(safeKey));
  for (const teacherId of teacherIds) {
    const projection = next && questionMatchesTeacher(next, teacherId, assignmentRows)
      ? publicQuestionCopy(normalizeQuestionRecord(next, { id: questionId }))
      : null;
    updates[`teacherQuestionBank/${teacherId}/${questionId}`] = projection;
  }

  // Include both old and new recipients to retract stale copies on scope or
  // active-state changes without writing to every student for every question.
  for (const [studentId, student] of studentRows) {
    if (!safeKey(studentId) || (student.id && String(student.id) !== studentId)) continue;
    const wasTarget = previous && questionMatchesStudent(previous, student, now);
    const isTarget = next && questionMatchesStudent(next, student, now);
    if (!wasTarget && !isTarget) continue;
    updates[`studentQuestionBank/${studentId}/${questionId}`] = isTarget
      ? publicQuestionCopy(normalizeQuestionRecord(next, { id: questionId }))
      : null;
  }
  return updates;
}

/* Key-order-insensitive JSON equality: two stored copies of the same draft
 * question compare equal even if their field order differs. */
function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
}

/**
 * Draft-status transition used by the `publishQuestionBankDraft` transaction.
 * The draft flips to `published` ONLY when it is still byte-identical to the
 * exact question content that was just written to the canonical bank. If the
 * Teacher edited the draft after publishing began (an in-flight race), the
 * stored `current.question` differs and the draft stays `draft`, so the next
 * publish publishes the new content instead of silently marking it released.
 * Returns the new draft value, or undefined for "leave the draft unchanged".
 */
function advanceDraftAfterPublish(current, { teacherId, questionId, publishedQuestion, publishedAt } = {}) {
  if (!object(current)) return undefined;
  if (current.teacherId !== teacherId || current.id !== questionId) return undefined;
  if (current.status !== 'draft') return undefined;
  if (!publishedQuestion || current.question?.id !== publishedQuestion.id) return undefined;
  if (canonicalJSON(current.question) !== canonicalJSON(publishedQuestion)) return undefined;
  return { ...current, status: 'published', publishedAt };
}

module.exports = {
  SAFE_KEY,
  safeKey,
  normalizeQuestionRecord,
  sourceExamHasEnded,
  questionMatchesStudent,
  questionMatchesTeacher,
  questionMatchesExamPaper,
  buildStudentQuestionProjection,
  buildTeacherQuestionProjection,
  buildQuestionBankFanout,
  canonicalJSON,
  advanceDraftAfterPublish
};
