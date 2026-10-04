/* Question Bank — the reusable shelf every paper is written from.
   ---------------------------------------------------------------------------
   A bank record is a *copy*: when a question is placed into an examination the
   paper owns its own question (with the exam's uid), and the bank keeps the
   original. Nothing here can orphan an examination, and deleting a bank row can
   never touch a paper that already used it.

   Record shape (all fields defaulted on read, so an older file still loads):
     { id: 'QUESTION-0001', code: 'QUESTION-0001', className, subject,
       chapterId, chapterName, topic, type, difficulty, text, options, answer,
       answerText, marks, source, tags, createdBy, createdAt, updatedBy,
       updatedAt, active }
   Types: mcq (৪টি অপশন, A–D) · true_false · short_answer · written.
   Only `mcq` questions may enter an MCQ paper — the others go into a
   short/written paper as text+marks with an optional answer text, which keeps
   the strict four-option rule of an MCQ paper intact. */
import { KEYS, readRaw, writeRaw, newId } from './database.js';
import { nextSequentialId } from './exam-core.js';

export const QUESTION_BANK_KEY = KEYS.questionBank;
export const QUESTION_BANK_VERSION = 1;

export const QUESTION_TYPES = Object.freeze({
  mcq: 'MCQ (বহুনির্বাচনি)',
  true_false: 'সত্য/মিথ্যা',
  short_answer: 'সংক্ষিপ্ত উত্তর',
  written: 'লিখিত (সৃজনশীল)'
});
export const QUESTION_DIFFICULTIES = Object.freeze({ easy: 'সহজ', medium: 'মাধ্যম', hard: 'কঠিন' });
export const QUESTION_TYPE_ORDER = Object.freeze(['mcq', 'true_false', 'short_answer', 'written']);
export const QUESTION_DIFFICULTY_ORDER = Object.freeze(['easy', 'medium', 'hard']);
/* The statuses at which an examination has actually been (or will be) sat:
   exactly these papers belong on the practice shelf, and only after their
   window has ended (a student must never drill an upcoming paper). */
export const BANKABLE_EXAM_STATUSES = Object.freeze(['published', 'completed', 'archived']);

/** An MCQ lives inside a paper as the four A–D options; everything else is a
    written-shaped question with an optional model answer. */
export const examTypeForQuestion = type => (type === 'mcq' ? 'mcq' : 'short');

const text = value => String(value ?? '').trim();
const fail = message => { throw new Error(message); };
const record = (now, actor) => ({ createdBy: actor, createdAt: now, updatedBy: actor, updatedAt: now });
const normalized = value => text(value).normalize('NFC').toLowerCase().replace(/\s+/g, ' ');

function readDatabase() {
  const raw = readRaw(QUESTION_BANK_KEY);
  if (raw === null || raw === '') return { version: QUESTION_BANK_VERSION, questions: [], updatedAt: 0, createdBy: 'SYSTEM' };
  let parsed; try { parsed = JSON.parse(raw); } catch { fail('প্রশ্ন ব্যাংকের সংরক্ষিত তথ্য পড়া যাচ্ছে না। ডেটা না মুছে সহায়তা নিন।'); }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.questions)) fail('প্রশ্ন ব্যাংকের তথ্য সঠিক নয়।');
  return { version: QUESTION_BANK_VERSION, questions: parsed.questions.filter(Boolean), updatedAt: Number(parsed.updatedAt) || 0, createdBy: text(parsed.createdBy) || 'SYSTEM' };
}

/** One row, read defensively: a file written by an older build loads as-is and
    simply gains the fields it was missing. */
export function normalizeQuestion(row = {}) {
  const type = Object.hasOwn(QUESTION_TYPES, row.type) ? row.type : 'mcq';
  const options = Array.isArray(row.options)
    ? row.options.map(option => ({ id: String(option?.id || '').trim().toUpperCase(), text: String(option?.text ?? '').trim() })).filter(option => option.id && option.text)
    : [];
  return {
    id: text(row.id),
    code: text(row.code) || text(row.id),
    className: text(row.className),
    subject: text(row.subject),
    group: text(row.group),
    chapterId: text(row.chapterId),
    chapterName: text(row.chapterName),
    topic: text(row.topic),
    /* The official window of the paper this question came from (0 for
       standalone rows): the instant-practice lane only opens a paper after
       `endAt` (so an upcoming exam's questions can never leak) and times the
       drill with the paper's original duration (`endAt - startAt`). */
    startAt: Number(row.startAt) || 0,
    endAt: Number(row.endAt) || 0,
    type,
    difficulty: Object.hasOwn(QUESTION_DIFFICULTIES, row.difficulty) ? row.difficulty : 'medium',
    text: String(row.text ?? '').trim(),
    options,
    answer: text(row.answer).toUpperCase(),
    answerText: String(row.answerText ?? '').trim(),
    marks: Number.isFinite(Number(row.marks)) ? Number(row.marks) : (type === 'mcq' ? 1 : 1),
    source: row.source && typeof row.source === 'object'
      ? { examId: text(row.source.examId), examCode: text(row.source.examCode), examTitle: text(row.source.examTitle), at: Number(row.source.at) || 0 }
      : null,
    tags: Array.isArray(row.tags) ? row.tags.map(tag => text(tag)).filter(Boolean).slice(0, 10) : [],
    createdBy: text(row.createdBy) || 'SYSTEM',
    createdAt: Number(row.createdAt) || 0,
    updatedBy: text(row.updatedBy) || text(row.createdBy) || 'SYSTEM',
    updatedAt: Number(row.updatedAt) || Number(row.createdAt) || 0,
    active: row.active !== false
  };
}

function write(database, actor) {
  const payload = { version: QUESTION_BANK_VERSION, questions: database.questions, updatedAt: Date.now(), createdBy: text(actor) || database.createdBy || 'SYSTEM' };
  writeRaw(QUESTION_BANK_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent('question-bank-updated', { detail: { at: payload.updatedAt } }));
  return payload;
}

async function mutate(fn, actor = 'SYSTEM') {
  const task = () => { const db = readDatabase(); const result = fn(db); write(db, actor); return result ?? db; };
  return navigator.locks ? navigator.locks.request(QUESTION_BANK_KEY, task) : task();
}

export const listQuestions = ({ includeInactive = true } = {}) => readDatabase().questions
  .map(normalizeQuestion)
  .filter(row => includeInactive || row.active);
export const questionById = id => listQuestions().find(row => row.id === text(id)) || null;
export const questionByCode = code => listQuestions().find(row => row.code.toUpperCase() === text(code).toUpperCase()) || null;

/** Content identity used to stop the same question being shelved twice. */
export function questionKey(row) {
  const question = normalizeQuestion(row);
  return [question.type, normalized(question.className), normalized(question.subject), normalized(question.chapterName), normalized(question.text), question.options.map(option => normalized(option.text)).join('|')].join('␟');
}

/** The single search the whole module (and every picker) uses.
    Everything is optional; `limit` keeps the DOM small on a low-end phone. */
export function searchQuestions({
  query = '', className = '', subject = '', chapterId = '', chapterName = '', topic = '',
  type = '', difficulty = '', examId = '', from = '', to = '',
  active = null, includeInactive = true, limit = 0, offset = 0, sort = 'newest'
} = {}) {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const fromAt = from ? Date.parse(`${from}T00:00:00+06:00`) : NaN;
  const toAt = to ? Date.parse(`${to}T23:59:59+06:00`) : NaN;
  /* `active: true|false` narrows to one state; leaving it out keeps working
     questions only, unless the caller asks for the whole history. */
  const activeFilter = active === true ? true : active === false ? false : null;
  let rows = listQuestions({ includeInactive: activeFilter === null ? includeInactive : true });
  if (activeFilter !== null) rows = rows.filter(row => row.active === activeFilter);
  if (className) rows = rows.filter(row => normalized(row.className) === normalized(className));
  if (subject) rows = rows.filter(row => normalized(row.subject) === normalized(subject));
  if (chapterId) rows = rows.filter(row => row.chapterId === text(chapterId));
  if (chapterName) rows = rows.filter(row => normalized(row.chapterName) === normalized(chapterName));
  if (topic) rows = rows.filter(row => normalized(row.topic) === normalized(topic));
  if (type) rows = rows.filter(row => row.type === type);
  if (difficulty) rows = rows.filter(row => row.difficulty === difficulty);
  if (examId) rows = rows.filter(row => row.source?.examId === text(examId));
  if (Number.isFinite(fromAt)) rows = rows.filter(row => row.createdAt >= fromAt);
  if (Number.isFinite(toAt)) rows = rows.filter(row => row.createdAt <= toAt);
  if (terms.length) {
    rows = rows.filter(row => {
      const haystack = normalized([
        row.code, row.id, row.className, row.subject, row.chapterName, row.topic,
        QUESTION_TYPES[row.type], QUESTION_DIFFICULTIES[row.difficulty], row.text,
        row.answerText, row.options.map(option => option.text).join(' ')
      ].join(' '));
      return terms.every(term => haystack.includes(term));
    });
  }
  rows.sort((a, b) => (sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)
    || a.code.localeCompare(b.code, 'bn'));
  const total = rows.length;
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const size = Math.max(0, Math.floor(Number(limit) || 0));
  return { rows: size ? rows.slice(start, start + size) : rows.slice(start), total, offset: start, limit: size };
}

/** Counts for the dashboard cards — never loads the question texts. */
export function questionBankStats() {
  const rows = listQuestions();
  const by = key => {
    const map = {};
    for (const row of rows) map[row[key]] = (map[row[key]] || 0) + 1;
    return map;
  };
  return { total: rows.length, active: rows.filter(row => row.active).length, byType: by('type'), bySubject: by('subject'), byClass: by('className') };
}

/** Validates one bank question. MCQ keeps the strict four A–D options and the
    option-id answer, exactly like an examination question. */
export function cleanBankQuestion(input = {}) {
  const type = Object.hasOwn(QUESTION_TYPES, input.type) ? input.type : 'mcq';
  const body = String(input.text ?? '').trim();
  const label = QUESTION_TYPES[type] || 'প্রশ্ন';
  if (!body || body.length > 1200) fail(`${label}: প্রশ্নের লেখা দিন (সর্বোচ্চ ১২০০ অক্ষর)।`);
  const className = String(input.className ?? '').trim().slice(0, 80);
  const subject = String(input.subject ?? '').trim().slice(0, 80);
  const group = String(input.group ?? '').trim().slice(0, 80);
  const startAt = Math.max(0, Math.round(Number(input.startAt) || 0));
  const endAt = Math.max(0, Math.round(Number(input.endAt) || 0));
  const chapterName = String(input.chapterName ?? '').trim().slice(0, 120);
  const chapterId = String(input.chapterId ?? '').trim().slice(0, 120);
  const topic = String(input.topic ?? '').trim().slice(0, 120);
  const difficulty = Object.hasOwn(QUESTION_DIFFICULTIES, input.difficulty) ? input.difficulty : 'medium';
  const marks = Number(input.marks);
  if (type === 'mcq') {
    const options = (input.options || []).map(option => ({ id: String(option?.id || '').trim().toUpperCase(), text: String(option?.text ?? '').trim() }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const answer = String(input.answer ?? '').trim().toUpperCase();
    if (options.length !== 4 || options.map(option => option.id).join('') !== 'ABCD' || options.some(option => !option.text || option.text.length > 500) || !['A', 'B', 'C', 'D'].includes(answer)) fail('MCQ: চারটি অপশন ও সঠিক উত্তর A/B/C/D দিন।');
    if (new Set(options.map(option => option.text)).size !== 4) fail('MCQ: একই অপশন একাধিকবার দেওয়া যাবে না।');
    return { type, text: body, className, subject, group, startAt, endAt, chapterId, chapterName, topic, difficulty, marks: 1, options, answer, answerText: '' };
  }
  if (type === 'true_false') {
    const answer = ['সত্য', 'মিথ্যা'].includes(String(input.answer ?? '').trim()) ? String(input.answer).trim() : '';
    if (!answer) fail('সত্য/মিথ্যা: সঠিক উত্তর নির্বাচন করুন।');
    if (!Number.isFinite(marks) || marks <= 0 || marks > 1000) fail('সত্য/মিথ্যা: নম্বর ১ থেকে ১০০০-এর মধ্যে দিন।');
    return { type, text: body, className, subject, group, startAt, endAt, chapterId, chapterName, topic, difficulty, marks, options: [], answer: '', answerText: answer };
  }
  if (!Number.isFinite(marks) || marks <= 0 || marks > 1000 || Math.round(marks * 100) / 100 !== marks) fail('নম্বর ১ থেকে ১০০০-এর মধ্যে দিন।');
  return { type, text: body, className, subject, group, startAt, endAt, chapterId, chapterName, topic, difficulty, marks, options: [], answer: '', answerText: String(input.answerText ?? '').trim().slice(0, 1200) };
}

/** The metadata a shelf row still needs to serve the practice lane: the
    source (only while it is empty — the first paper that shelved a question
    stays its source), the window end and the batch. */
function rowNeedsExamMetadata(row, clean) {
  return row.source === null || row.startAt <= 0 || row.endAt <= 0 || row.group !== clean.group;
}

/** The bank draft for one paper question. One builder for the manual
    "save to bank" button and the automatic backfill, so the content identity
    can never drift between the two paths. */
export function bankDraftForQuestion(exam, question) {
  return {
    id: '', type: exam.type === 'mcq' ? 'mcq' : 'written', text: question.text,
    className: exam.className || '', subject: exam.subject || '', group: exam.group || '',
    startAt: Number(exam.startAt) || 0, endAt: Number(exam.endAt) || 0,
    chapterId: exam.chapterId || '', chapterName: exam.chapterName || '', topic: exam.topic || '',
    difficulty: question.difficulty || 'medium', marks: question.marks,
    options: question.options || [], answer: question.answer || '', answerText: question.answerText || ''
  };
}

/** Every examination the students have actually sat joins the shelf, in one
    idempotent pass: a paper whose questions are all shelved already costs
    neither a write nor a lock, and rows shelved before this build existed
    are backfilled with the exam metadata practice needs (window end, batch,
    source) instead of being duplicated. */
export async function ensureExamsInBank(exams, actor = 'SYSTEM') {
  const targets = (exams || []).filter(exam =>
    exam?.type === 'mcq' && BANKABLE_EXAM_STATUSES.includes(exam.status) && (exam.questions || []).length > 0);
  if (!targets.length) return { exams: 0, added: 0, updated: 0 };
  /* Nothing new? No lock, no write, no event — the check is the common path
     on a device whose shelf is already current. */
  const current = readDatabase();
  const currentByKey = new Map(current.questions.map(row => [questionKey(normalizeQuestion(row)), row]));
  const needsWork = targets.some(exam => exam.questions.some(question => {
    const clean = cleanBankQuestion(bankDraftForQuestion(exam, question));
    const existing = currentByKey.get(questionKey(clean));
    if (!existing) return true;
    const row = normalizeQuestion(existing);
    return rowNeedsExamMetadata(row, clean);
  }));
  if (!needsWork) return { exams: 0, added: 0, updated: 0 };
  const actorName = text(actor) || 'SYSTEM';
  return mutate(db => {
    const now = Date.now();
    const byContent = new Map(db.questions.map(row => [questionKey(normalizeQuestion(row)), row]));
    let added = 0, updated = 0;
    for (const exam of targets) {
      const source = { examId: exam.id, examCode: text(exam.code), examTitle: exam.title, at: now };
      for (const question of exam.questions) {
        const clean = cleanBankQuestion(bankDraftForQuestion(exam, question));
        const key = questionKey(clean);
        const existing = byContent.get(key);
        if (existing) {
          const row = normalizeQuestion(existing);
          if (!rowNeedsExamMetadata(row, clean)) continue;
          /* A row that already remembers an exam keeps that first source:
             the same question can legally sit in two papers (repeat exams),
             and re-pointing it on every pass would churn the shelf for
             nothing. */
          Object.assign(existing, {
            ...(row.source === null ? { source: { ...source, at: Number(row.createdAt) || now } } : {}),
            ...(row.startAt <= 0 ? { startAt: clean.startAt } : {}),
            ...(row.endAt <= 0 ? { endAt: clean.endAt } : {}),
            ...(row.group !== clean.group ? { group: clean.group } : {}),
            updatedBy: actorName, updatedAt: now
          });
          updated += 1;
          continue;
        }
        const id = nextSequentialId('QUESTION', db.questions);
        const row = { id, code: id, ...clean, source, ...record(now, actorName) };
        db.questions.unshift(row);
        byContent.set(key, row);
        added += 1;
      }
    }
    return { exams: targets.length, added, updated };
  }, actorName);
}

export const questionBank = {
  async list(options) { return searchQuestions(options); },
  async stats() { return questionBankStats(); },
  async get(id) { return questionById(id); },
  /** Create (`input.id` empty) or edit one question. The id/code is issued once
      and never re-used, so a deleted question's code is not recycled. */
  async save(input = {}, actor = 'MANAGER') {
    const clean = cleanBankQuestion(input);
    return mutate(db => {
      const now = Date.now();
      const existing = input.id ? db.questions.find(row => row.id === text(input.id)) : null;
      if (input.id && !existing) fail('প্রশ্নটি খুঁজে পাওয়া যায়নি।');
      if (existing) {
        const source = existing.source || null;
        Object.assign(existing, clean, { source, updatedBy: actor, updatedAt: now });
        return normalizeQuestion(existing);
      }
      const id = nextSequentialId('QUESTION', db.questions);
      const row = {
        id, code: id, ...clean, source: null, ...record(now, actor)
      };
      db.questions.unshift(row);
      return normalizeQuestion(row);
    }, actor);
  },
  /** Shelve every question of a paper (or one question) into the bank.
      Already-shelved content is skipped, so pressing the button twice is safe. */
  async saveFromExam(exam, actor = 'MANAGER', { onlyUid = '' } = {}) {
    const questions = (exam?.questions || []).filter(question => !onlyUid || question.uid === onlyUid);
    if (!questions.length) fail('সংরক্ষণ করার মতো প্রশ্ন পাওয়া যায়নি।');
    const actorName = text(actor);
    return mutate(db => {
      const known = new Set(db.questions.map(row => questionKey(row)));
      const now = Date.now();
      let added = 0, skipped = 0;
      for (const question of questions) {
        const clean = cleanBankQuestion(bankDraftForQuestion(exam, question));
        if (known.has(questionKey(clean))) { skipped += 1; continue; }
        const id = nextSequentialId('QUESTION', db.questions);
        const row = {
          id, code: id, ...clean,
          source: { examId: exam.id, examCode: text(exam.code), examTitle: exam.title, at: now },
          ...record(now, actorName)
        };
        db.questions.unshift(row);
        known.add(questionKey(row));
        added += 1;
      }
      return { added, skipped, total: questions.length };
    }, actorName);
  },
  /** Change one field (marks, difficulty, chapter, activation) of a question. */
  async patch(id, patch = {}, actor = 'MANAGER') {
    return mutate(db => {
      const row = db.questions.find(item => item.id === text(id));
      if (!row) fail('প্রশ্নটি খুঁজে পাওয়া যায়নি।');
      const current = normalizeQuestion(row);
      const merged = { ...current, ...patch, id: current.id };
      const clean = cleanBankQuestion(merged);
      Object.assign(row, clean, { updatedBy: actor, updatedAt: Date.now() });
      return normalizeQuestion(row);
    }, actor);
  },
  async setActive(id, active, actor = 'MANAGER') {
    return mutate(db => {
      const row = db.questions.find(item => item.id === text(id));
      if (!row) fail('প্রশ্নটি খুঁজে পাওয়া যায়নি।');
      row.active = !!active;
      row.updatedBy = actor; row.updatedAt = Date.now();
      return normalizeQuestion(row);
    }, actor);
  },
  /** Removing a bank question only removes the shelf copy — a paper that
      already used it keeps its own record untouched. */
  async remove(id, actor = 'MANAGER') {
    return mutate(db => {
      const index = db.questions.findIndex(row => row.id === text(id));
      if (index < 0) fail('প্রশ্নটি খুঁজে পাওয়া যায়নি।');
      const [removed] = db.questions.splice(index, 1);
      return normalizeQuestion(removed);
    }, actor);
  }
};

/** A bank question as the examination editor expects it (paste-clean input). */
export function questionForExam(row, examType = 'mcq') {
  const question = normalizeQuestion(row);
  if (examType === 'mcq') {
    if (question.type !== 'mcq') fail('এই পরীক্ষায় শুধু চার অপশনের MCQ প্রশ্ন ব্যবহার করা যাবে।');
    return { text: question.text, marks: question.marks, options: question.options.map(option => ({ ...option })), answer: question.answer };
  }
  return { text: question.text, marks: question.marks, answerText: question.answerText || '' };
}

/** Ids that are free to be reused by a new question (never recycled by save,
    exported for the import path and for tests). */
export const bankIdFrom = questions => nextSequentialId('QUESTION', questions);
export const bankRowId = () => newId('QB');

export function watchQuestionBank(callback) {
  const handler = () => callback(listQuestions());
  window.addEventListener('storage', event => { if (event.key === QUESTION_BANK_KEY || event.key === null) handler(); });
  window.addEventListener('question-bank-updated', handler);
}
