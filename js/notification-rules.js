import { dhakaParts, dhakaKey, nowEpoch, parseDhakaDateTime } from './time.js';
export const NOTIFY_PREFIX = 'activePlus.notifications.';
export { LOCAL_WRITE_KEY, markLocalSource } from './local-write-mark.js';
import { normalizeClassId, normalizeSectionId, matchesClassSection } from './class-key.js';
export const SEEN_KEY_PREFIX = `${NOTIFY_PREFIX}seen.v1:`;
export const BOOT_KEY_PREFIX = `${NOTIFY_PREFIX}boot.v1:`;
export const PROMPT_HIDDEN_KEY = `${NOTIFY_PREFIX}promptHiddenAt.v1`;
export const SHOWN_KEY = `${NOTIFY_PREFIX}shown.v1`;
export const SHOWN_WINDOW_MS = 2 * 60 * 1000;

export const SELF_AUTHOR_WINDOW_MS = 10 * 60 * 1000;
export const MAX_SEEN = 300;
export const MAX_BURST = 3;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value.trim() : '');

export function viewerKeyOf(viewer) {
  if (!viewer) return 'guest';
  if (viewer.kind === 'staff') return `staff:${text(viewer.username) || text(viewer.role) || 'unknown'}`;
  return `student:${text(viewer.studentId) || text(viewer.username) || 'guest'}`;
}

export const AUDIENCES = Object.freeze(['সকল শিক্ষার্থী', 'অভিভাবক', 'শিক্ষার্থী ও অভিভাবক']);

const scopeKey = value => text(value).normalize('NFC').toLowerCase().replace(/\s+/g, ' ');

export function noticeScopeMatches(notice, viewer) {
  if (!notice || !viewer) return true;
  const classId = normalizeClassId(notice);
  const sectionId = normalizeSectionId(notice);
  if (!classId && !sectionId) return true;
  return matchesClassSection(notice, viewer, { requireViewerClass: true, allowGlobalItem: true });
}

export function audienceMatches(notice, viewer) {
  if (!notice) return false;
  if (viewer?.kind === 'staff') return true;
  const audience = text(notice.audience);
  if (audience && !AUDIENCES.includes(audience)) return false;
  return noticeScopeMatches(notice, viewer);
}

export const NOTICE_BOARD_READ_PREFIX = 'activePlus.noticeBoard.read.v1:';

const row = (id, icon, bn) => Object.freeze({ id, label: `${icon} ${bn}`, shortLabel: bn, icon });
export const NOTICE_CATEGORIES = Object.freeze([
  row('urgent', '🔴', 'জরুরি'),
  row('academic', '📚', 'একাডেমিক'),
  row('class', '🏫', 'ক্লাস'),
  row('fee', '💰', 'ফি'),
  row('exam', '📝', 'পরীক্ষা')
]);
const NOTICE_CATEGORY_IDS = new Set(NOTICE_CATEGORIES.map(category => category.id));
const NOTICE_CATEGORY_ALIASES = Object.freeze({
  urgent: 'urgent', emergency: 'urgent', priority: 'urgent', জরুরি: 'urgent', জরুরী: 'urgent',
  academic: 'academic', academics: 'academic', study: 'academic', শিক্ষা: 'academic', একাডেমিক: 'academic',
  class: 'class', classes: 'class', ক্লাস: 'class', শ্রেণি: 'class', শ্রেণী: 'class',
  fee: 'fee', fees: 'fee', payment: 'fee', ফি: 'fee', পেমেন্ট: 'fee',
  exam: 'exam', exams: 'exam', পরীক্ষা: 'exam', পরীক্ষার: 'exam'
});

export function noticeCategory(notice) {
  const raw = typeof notice === 'string' ? notice : notice?.category ?? notice?.noticeCategory ?? notice?.type ?? '';
  const value = text(raw).toLowerCase().replace(/[🔴📚🏫💰📝]/gu, '').trim();
  const aliased = NOTICE_CATEGORY_ALIASES[value];
  if (NOTICE_CATEGORY_IDS.has(aliased)) return aliased;
  if (typeof notice === 'object' && notice && (notice.urgent === true || notice.priority === 'urgent')) return 'urgent';
  return 'academic';
}

export function noticeCategoryInfo(value) {
  const id = NOTICE_CATEGORY_IDS.has(value) ? value : noticeCategory(value);
  return NOTICE_CATEGORIES.find(category => category.id === id) || NOTICE_CATEGORIES[1];
}

export function noticeRevision(notice) {
  return text(notice?.updatedAt) || text(notice?.createdAt) ||
    `${text(notice?.title)}|${text(notice?.body)}|${text(notice?.date)}`;
}

export function noticeItem(notice) {
  const id = text(notice?.id);
  if (!id) return null;
  const title = text(notice?.title) || 'নোটিশ';
  const body = text(notice?.body);
  return {
    key: `notice:${id}:${noticeRevision(notice)}`,
    source: 'notices',
    sourceId: id,
    kind: 'notice',
    category: noticeCategory(notice),
    title,
    body,
    at: Date.parse(text(notice?.createdAt) || text(notice?.updatedAt) || '') || 0,
    target: 'notice-board',
    action: 'open-notice',
    actionLabel: 'নোটিশ খুলুন',
    audience: text(notice?.audience) || 'সকল শিক্ষার্থী'
  };
}

export function broadcastItem(config) {
  const message = text(config?.broadcastMessage);
  if (!config?.broadcastAlert || !message) return null;
  return {
    key: `broadcast:${message.slice(0, 160)}`,
    source: 'settings',
    sourceId: 'broadcast',
    kind: 'broadcast',
    category: 'urgent',
    title: 'জরুরি ঘোষণা',
    body: message,
    at: 0,
    target: 'notice-board',
    action: 'open-notice',
    actionLabel: 'জরুরি ঘোষণা খুলুন',
    audience: 'সকল'
  };
}

export function bnWhen(ms) {
  const when = new Date(Number(ms));
  if (!Number.isFinite(when.getTime())) return '';
  try {
    return when.toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return when.toLocaleString();
  }
}

const participantIds = exam => (Array.isArray(exam?.participants) ? exam.participants : [])
  .map(person => text(person?.id))
  .filter(Boolean);

export function stillOpenExam(exam, now = nowEpoch()) {
  if (exam?.resultsPublished === true) return false;
  const endsAt = Number(exam?.endAt) || Number(exam?.startAt) || 0;
  return endsAt === 0 || endsAt > Number(now);
}

export function examItems(examDb, viewer, now = nowEpoch()) {
  if (viewer?.kind !== 'student' || !isObject(examDb)) return [];
  const studentId = text(viewer.studentId);
  if (!studentId) return [];
  const items = [];
  for (const exam of Array.isArray(examDb.exams) ? examDb.exams : []) {
    if (!isObject(exam) || !text(exam.id)) continue;
    if (!participantIds(exam).includes(studentId)) continue;
    const name = text(exam.title) || 'পরীক্ষা';
    const subject = text(exam.subject);
    if (exam.resultsPublished === true) {
      items.push({
        key: `result:${text(exam.id)}:${Number(exam.resultsPublishedAt) || Number(exam.updatedAt) || 0}`,
        source: 'exams',
        sourceId: text(exam.id),
        kind: 'result',
        target: 'exams', // ফলাফল is a tab of the পরীক্ষা section
        action: 'open',
        actionLabel: 'ফলাফল দেখুন',
        title: 'ফলাফল প্রকাশিত হয়েছে',
        body: `${name}${subject ? ` — ${subject}` : ''} পরীক্ষার ফলাফল এখন অ্যাপে দেখা যাচ্ছে।`,
        at: Number(exam.resultsPublishedAt) || Number(exam.updatedAt) || 0,
        audience: 'অংশগ্রহণকারী'
      });
    } else if ((exam.status === 'published' || exam.status === 'completed') && stillOpenExam(exam, now)) {
      const startsAt = Number(exam.startAt) || 0;
      const endsAt = Number(exam.endAt) || startsAt;
      const attempts = (Array.isArray(examDb.attempts) ? examDb.attempts : [])
        .filter(attempt => attempt?.examId === exam.id && text(attempt?.studentId) === studentId);
      const active = attempts.some(attempt => attempt.status === 'active');
      const canStart = exam.type === 'mcq' && !attempts.length && startsAt > 0 && now >= startsAt
        && (!endsAt || now < endsAt)
        && now <= startsAt + Math.max(0, Number(exam.lateMinutes) || 0) * 60000;
      const action = active ? 'resume' : canStart ? 'start' : 'open';
      const actionLabel = active ? 'পরীক্ষায় ফিরে যাও'
        : canStart ? 'এখনই পরীক্ষা দিন'
        : startsAt > now ? 'সময়সূচি দেখুন'
        : exam.type === 'mcq' ? 'পরীক্ষা খুলুন' : 'প্রশ্নপত্র দেখুন';
      const timing = startsAt > now ? `শুরু ${bnWhen(startsAt)}`
        : endsAt > now ? 'এখন চলছে' : 'পরীক্ষা শেষ';
      items.push({
        key: `exam:${text(exam.id)}:${Number(exam.publishedAt) || Number(exam.updatedAt) || 0}`,
        source: 'exams',
        sourceId: text(exam.id),
        kind: 'exam',
        target: 'exams',
        action,
        actionLabel,
        title: name,
        body: `নতুন পরীক্ষা প্রকাশিত হয়েছে${subject ? ` · ${subject}` : ''} · ${timing}`,
        at: Number(exam.publishedAt) || Number(exam.updatedAt) || 0,
        audience: 'অংশগ্রহণকারী'
      });
    }
  }
  return items;
}

const activityGroupKey = value => String(value || '').normalize('NFC').trim().replace(/\s*বিভাগ$/, '').trim();
const localDayKey = value => {
  const date = value instanceof Date ? value : new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return '';
  return dhakaKey(date);
};
function homeworkActivities(teachingDb, viewer) {
  if (viewer?.kind !== 'student' || !text(viewer.studentId)) return [];
  const activities = Array.isArray(teachingDb) ? teachingDb : teachingDb?.activities;
  if (!Array.isArray(activities)) return [];
  return activities.filter(activity => {
    if (!isObject(activity) || activity.type !== 'homework' || activity.status !== 'published' || !text(activity.id)) return false;
    if (text(activity.className) !== text(viewer.className)) return false;
    if (activityGroupKey(activity.group) && activityGroupKey(activity.group) !== activityGroupKey(viewer.group)) return false;
    return !['done', 'reviewed'].includes(text(activity.progress?.[viewer.studentId]?.value));
  });
}

export function homeworkItems(teachingDb, viewer, now = nowEpoch()) {
  const timestamp = Number(now);
  const current = new Date(Number.isFinite(timestamp) ? timestamp : nowEpoch());
  const today = localDayKey(current);
  const tomorrow = dhakaKey(current.getTime() + 86400000);
  if (!today || !tomorrow) return [];
  const items = [];
  for (const activity of homeworkActivities(teachingDb, viewer)) {
    const due = text(activity.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || (due !== today && due !== tomorrow)) continue;
    const parsed = new Date(`${due}T12:00:00+06:00`);
    if (localDayKey(parsed) !== due) continue;
    const revision = text(activity.updatedAt) || text(activity.createdAt) || due;
    const deadline = due === today ? 'আজ জমা দিতে হবে' : 'আগামীকাল জমা দিতে হবে';
    const time = text(activity.time);
    items.push({
      key: `homework:${text(activity.id)}:${revision}`,
      source: 'teaching',
      sourceId: text(activity.id),
      kind: 'homework',
      target: 'courses',
      action: 'open-homework',
      actionLabel: 'বাড়ির কাজ খুলুন',
      title: text(activity.title) || 'বাড়ির কাজ',
      body: `${text(activity.subject) ? `${text(activity.subject)} · ` : ''}${deadline}${time ? ` · জমা ${time}` : ''}`,
      at: Number(now) || nowEpoch(),
      audience: 'নিজের শ্রেণি'
    });
  }
  return items;
}

// Keep the existing public exports while the student shell loads only the
// small date helper rather than the entire notification rule engine.
import { birthMonthDay, isStudentBirthday } from './birthday-date.js';
export { birthMonthDay, isStudentBirthday };

export function birthdayItems(viewer, now = nowEpoch()) {
  if (viewer?.kind !== 'student' || !text(viewer.studentId) || !isStudentBirthday(viewer.birthDate, now)) return [];
  const date = new Date(Number(now) || nowEpoch());
  const year = dhakaParts(date).year;
  const first = text(viewer.name).split(/\s+/)[0] || 'শিক্ষার্থী';
  return [{
    key: `birthday:${text(viewer.studentId)}:${year}`,
    source: 'account',
    sourceId: text(viewer.studentId),
    kind: 'birthday',
    target: 'home',
    title: `শুভ জন্মদিন, ${first}!`,
    body: 'Active Plus Coaching পরিবার থেকে ভালোবাসা আর শুভেচ্ছা। আজকের দিনটা আপনার — শিখতে থাকো, এগিয়ে যাও।',
    at: Number(now) || nowEpoch(),
    audience: 'নিজের জন্মদিন'
  }];
}

export function nextBirthdayBoundary(now = nowEpoch()) {
  const date = new Date(Number(now));
  if (!Number.isFinite(date.getTime())) return 0;
  const next = dhakaKey(date.getTime() + 86400000);
  return parseDhakaDateTime(`${next}T00:00`);
}

const BIRTHDAY_STAFF = Object.freeze(['admin', 'manager', 'teacher']);

function staffBirthdayItems(students, viewer, now = nowEpoch(), advance = false) {
  if (viewer?.kind !== 'staff' || !BIRTHDAY_STAFF.includes(text(viewer.role))) return [];
  const current = new Date(Number(now) || nowEpoch());
  if (!Number.isFinite(current.getTime())) return [];
  const targetDate = advance ? new Date(current.getTime() + 86400000) : current;
  const year = dhakaParts(targetDate).year;
  const assigned = Array.isArray(viewer.assignedClasses)
    ? new Set(viewer.assignedClasses.map(scopeKey).filter(Boolean))
    : null;
  const items = [];
  for (const student of Array.isArray(students) ? students : []) {
    if (!isObject(student) || student.status === 'rejected') continue;
    const id = text(student.id);
    if (!id || !isStudentBirthday(student.birthDate, targetDate.getTime())) continue;
    if (advance && text(viewer.role) === 'teacher' && (!assigned?.size || !assigned.has(scopeKey(student.className)))) continue;
    const name = text(student.name) || text(student.nameEn) || 'নাম নেই';
    const place = [text(student.className), text(student.group)].filter(Boolean).join(' • ');
    items.push({
      key: `${advance ? 'birthday-soon' : 'birthday-today'}:${id}:${year}`,
      source: 'students',
      sourceId: id,
      kind: advance ? 'birthday-soon' : 'birthday',
      target: text(viewer.role) === 'teacher' ? 'classes' : 'students',
      title: advance ? 'আগামীকাল জন্মদিন' : `আজ জন্মদিন — ${name}`,
      body: `${place ? `${place} — ` : ''}${name}`,
      at: Number(now) || nowEpoch(),
      audience: 'এডমিন, ম্যানেজার ও শিক্ষক'
    });
  }
  return items;
}

export const birthdayAdvanceItems = (students, viewer, now = nowEpoch()) =>
  staffBirthdayItems(students, viewer, now, true);

export const birthdayTodayStaffItems = (students, viewer, now = nowEpoch()) =>
  staffBirthdayItems(students, viewer, now, false);

export function nextHomeworkBoundary(teachingDb, viewer, now = nowEpoch()) {
  const timestamp = Number(now);
  if (viewer?.kind !== 'student' || !Number.isFinite(timestamp)) return 0;
  let next = 0;
  for (const activity of homeworkActivities(teachingDb, viewer)) {
    const due = text(activity.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) continue;
    const date = new Date(`${due}T00:00:00+06:00`);
    if (localDayKey(date) !== due) continue;
    const transitions = [
      date.getTime() - 86400000,
      date.getTime(),
      date.getTime() + 86400000
    ];
    for (const boundary of transitions) {
      if (boundary > timestamp && (!next || boundary < next)) next = boundary;
    }
  }
  return next;
}

export const REGISTRATION_REVIEWERS = Object.freeze(['admin', 'manager']);

export function registrationItems(students, viewer, registrationNotifications = null) {
  if (viewer?.kind !== 'staff' || !REGISTRATION_REVIEWERS.includes(text(viewer.role))) return [];
  const items = [];
  const seenIds = new Set();
  const decidedIds = new Set();
  for (const student of Array.isArray(students) ? students : []) {
    if (!isObject(student)) continue;
    const id = text(student.id);
    if (!id) continue;
    if (student.status && student.status !== 'pending') { decidedIds.add(id); continue; }
    if (student.status !== 'pending') continue;
    seenIds.add(id);
    const name = text(student.name) || text(student.nameEn) || 'নাম নেই';
    const mobile = text(student.mobile || student.studentMobile);
    const details = [text(student.className), text(student.group), mobile, id].filter(Boolean).join(' • ');
    items.push({
      key: `registration:${id}`,
      source: 'students',
      sourceId: id,
      kind: 'registration',
      actionable: true,
      studentName: name,
      mobile,
      createdAt: text(student.registeredAt) || text(student.createdAt) || text(student.enrolledAt),
      title: 'নতুন শিক্ষার্থী রেজিস্ট্রেশন',
      body: `${name}${details ? ` — ${details}` : ''} · অনুমোদনের অপেক্ষায়`,
      at: Date.parse(text(student.registeredAt) || text(student.createdAt) || '') || 0,
      audience: 'এডমিন ও ম্যানেজার'
    });
  }
  for (const notif of Array.isArray(registrationNotifications) ? registrationNotifications : []) {
    if (!isObject(notif) || notif.type !== 'new_registration' || notif.read === true) continue;
    const id = text(notif.studentId);
    if (!id || seenIds.has(id) || decidedIds.has(id)) continue;
    seenIds.add(id);
    const name = text(notif.studentName) || 'নাম নেই';
    const mobile = text(notif.mobile);
    const details = [mobile, id].filter(Boolean).join(' • ');
    items.push({
      key: `registration:${id}`,
      source: 'students',
      sourceId: id,
      kind: 'registration',
      actionable: true,
      studentName: name,
      mobile,
      createdAt: text(notif.createdAt),
      title: 'নতুন শিক্ষার্থী রেজিস্ট্রেশন',
      body: `${name}${details ? ` — ${details}` : ''} · অনুমোদনের অপেক্ষায়`,
      at: Date.parse(text(notif.createdAt) || '') || 0,
      audience: 'এডমিন ও ম্যানেজার'
    });
  }
  return items;
}

export const EXAM_REMINDER_MS = 10 * 60 * 1000;

const examName = exam => {
  const name = text(exam?.title) || 'পরীক্ষা';
  const subject = text(exam?.subject);
  return `${name}${subject ? ` — ${subject}` : ''}`;
};
const money = value => `৳${Number(value) || 0}`;
const stamp = value => Date.parse(text(value)) || Number(value) || 0;

export function studentDecisionItems(students, viewer) {
  if (viewer?.kind !== 'student') return [];
  const id = text(viewer.studentId);
  if (!id) return [];
  const row = (Array.isArray(students) ? students : []).find(item => isObject(item) && text(item.id) === id);
  // Only a real review (it carries reviewedAt) is news; old rows stay quiet.
  if (!row || !text(row.reviewedAt) || !['approved', 'active', 'rejected'].includes(row.status)) return [];
  const approved = row.status === 'approved' || row.status === 'active';
  const note = text(row.reviewNote);
  return [{
    key: `decision:${id}:${row.status}:${text(row.reviewedAt)}`,
    source: 'students',
    sourceId: id,
    kind: approved ? 'approved' : 'rejected',
    title: approved ? 'রেজিস্ট্রেশন অনুমোদিত হয়েছে' : 'রেজিস্ট্রেশন বাতিল হয়েছে',
    body: approved
      ? 'অভিনন্দন! এখন অ্যাপের সব ফিচার ব্যবহার করতে পারবে।'
      : `কারণ: ${note || 'অফিসে যোগাযোগ করো।'}`,
    at: stamp(row.reviewedAt),
    target: 'home',
    audience: 'নিজের অ্যাকাউন্ট'
  }];
}

export function examTimingItems(examDb, viewer, now = nowEpoch(), reminderMs = EXAM_REMINDER_MS) {
  if (viewer?.kind !== 'student' || !isObject(examDb)) return [];
  const studentId = text(viewer.studentId);
  if (!studentId) return [];
  const done = new Set((Array.isArray(examDb.attempts) ? examDb.attempts : [])
    .filter(attempt => isObject(attempt) && text(attempt.studentId) === studentId &&
      ['active', 'queued', 'submitted'].includes(text(attempt.status)))
    .map(attempt => text(attempt.examId)));
  const items = [];
  for (const exam of Array.isArray(examDb.exams) ? examDb.exams : []) {
    if (!isObject(exam) || !text(exam.id) || exam.status !== 'published' || exam.resultsPublished === true) continue;
    if (!participantIds(exam).includes(studentId) || done.has(text(exam.id))) continue;
    const startAt = Number(exam.startAt) || 0;
    const endAt = Number(exam.endAt) || 0;
    if (!startAt) continue;
    if (now >= startAt - reminderMs && now < startAt) {
      const minutes = Math.max(1, Math.ceil((startAt - now) / 60000));
      items.push({
        key: `exam-soon:${text(exam.id)}:${startAt}`,
        source: 'exams', sourceId: text(exam.id), kind: 'exam-soon',
        target: 'exams', action: 'open', actionLabel: 'সময়সূচি দেখুন',
        title: 'পরীক্ষা শীঘ্রই শুরু হবে',
        body: `${examName(exam)} · ${minutes} মিনিট পর শুরু (${bnWhen(startAt)})`,
        at: startAt - reminderMs, target: 'exams', audience: 'অংশগ্রহণকারী'
      });
    } else if (now >= startAt && (!endAt || now < endAt)) {
      items.push({
        key: `exam-live:${text(exam.id)}:${startAt}`,
        source: 'exams', sourceId: text(exam.id), kind: 'exam-live',
        target: 'exams', action: 'start', actionLabel: 'এখনই পরীক্ষা দিন',
        title: 'পরীক্ষা শুরু হয়েছে — এখনই অংশ নাও',
        body: `${examName(exam)}${endAt ? ` · শেষ ${bnWhen(endAt)}` : ''}`,
        at: startAt, target: 'exams', audience: 'অংশগ্রহণকারী'
      });
    }
  }
  return items;
}

export function nextExamBoundary(examDb, viewer, now = nowEpoch(), reminderMs = EXAM_REMINDER_MS) {
  if (viewer?.kind !== 'student' || !isObject(examDb)) return 0;
  const studentId = text(viewer.studentId);
  let next = 0;
  for (const exam of Array.isArray(examDb.exams) ? examDb.exams : []) {
    if (!isObject(exam) || exam.status !== 'published' || !participantIds(exam).includes(studentId)) continue;
    const startAt = Number(exam.startAt) || 0;
    for (const moment of [startAt - reminderMs, startAt, Number(exam.endAt) || 0]) {
      if (moment > now && (!next || moment < next)) next = moment;
    }
  }
  return next;
}

export function studentPaymentItems(transactions, viewer) {
  if (viewer?.kind !== 'student') return [];
  const id = text(viewer.studentId);
  if (!id) return [];
  return (Array.isArray(transactions) ? transactions : [])
    .filter(tx => isObject(tx) && text(tx.id) && text(tx.studentId) === id && tx.status === 'approved' && text(tx.reviewedAt))
    .map(tx => ({
      key: `payment:${text(tx.id)}:approved`,
      source: 'transactions', sourceId: text(tx.id), kind: 'payment',
      title: 'ফি জমা নিশ্চিত হয়েছে',
      body: `${text(tx.feeType) || 'ফি'}${text(tx.month) ? ` (${text(tx.month)})` : ''} — ${money(tx.amount)}${text(tx.receiptNo) ? ` · রসিদ ${text(tx.receiptNo)}` : ''}`,
      at: stamp(tx.reviewedAt), audience: 'নিজের অ্যাকাউন্ট'
    }));
}

export function paymentReviewItems(transactions, viewer) {
  if (viewer?.kind !== 'staff' || text(viewer.role) !== 'manager') return [];
  return (Array.isArray(transactions) ? transactions : [])
    .filter(tx => isObject(tx) && text(tx.id) && tx.status === 'pending')
    .map(tx => ({
      key: `payment-review:${text(tx.id)}`,
      source: 'transactions', sourceId: text(tx.id), kind: 'payment-review', actionable: true,
      title: 'পেমেন্ট অনুমোদনের অপেক্ষায়',
      body: `${text(tx.studentName) || 'শিক্ষার্থী'}${text(tx.studentId) ? ` (${text(tx.studentId)})` : ''} · ${text(tx.feeType) || 'ফি'}${text(tx.month) ? ` ${text(tx.month)}` : ''} — ${money(tx.amount)}`,
      at: Number(tx.recordedAt) || stamp(tx.createdAt), target: 'cash-counter', audience: 'ম্যানেজার'
    }));
}

export function paymentRejectedItems(transactions, viewer) {
  if (viewer?.kind !== 'staff' || text(viewer.role) !== 'payment') return [];
  return (Array.isArray(transactions) ? transactions : [])
    .filter(tx => isObject(tx) && text(tx.id) && tx.status === 'rejected')
    .map(tx => ({
      key: `payment-rejected:${text(tx.id)}:${text(tx.reviewedAt)}`,
      source: 'transactions', sourceId: text(tx.id), kind: 'payment-rejected',
      title: 'পেমেন্ট এন্ট্রি বাতিল হয়েছে',
      body: `${text(tx.studentName) || 'শিক্ষার্থী'} · ${money(tx.amount)} · কারণ: ${text(tx.reviewNote) || 'উল্লেখ নেই'}`,
      at: stamp(tx.reviewedAt), audience: 'পেমেন্ট কাউন্টার'
    }));
}

export function examReviewItems(examDb, viewer) {
  if (viewer?.kind !== 'staff' || text(viewer.role) !== 'manager' || !isObject(examDb)) return [];
  return (Array.isArray(examDb.exams) ? examDb.exams : [])
    .filter(exam => isObject(exam) && text(exam.id) && exam.status === 'pending')
    .map(exam => ({
      // submittedAt: a paper sent again (even unchanged) is a new request.
      key: `exam-review:${text(exam.id)}:${Number(exam.submittedAt) || Number(exam.updatedAt) || 0}`,
      source: 'exams', sourceId: text(exam.id), kind: 'exam-review', actionable: true,
      title: 'পরীক্ষা অনুমোদনের অপেক্ষায়',
      body: `${examName(exam)} · ${text(exam.className) || ''}${text(exam.teacherName) ? ` · ${text(exam.teacherName)}` : ''}${Number(exam.startAt) ? ` · শুরু ${bnWhen(exam.startAt)}` : ''}`,
      at: Number(exam.submittedAt) || Number(exam.updatedAt) || 0, target: 'exams', audience: 'ম্যানেজার'
    }));
}

export function teacherExamItems(examDb, viewer) {
  if (viewer?.kind !== 'staff' || text(viewer.role) !== 'teacher' || !isObject(examDb)) return [];
  const items = [];
  for (const exam of Array.isArray(examDb.exams) ? examDb.exams : []) {
    if (!isObject(exam) || !text(exam.id)) continue;
    if (exam.status === 'rejected') {
      items.push({
        // reviewedAt: returned a second time is a new notification.
        key: `exam-returned:${text(exam.id)}:${Number(exam.reviewedAt) || Number(exam.updatedAt) || 0}:${text(exam.reviewNote).slice(0, 40)}`,
        source: 'exams', sourceId: text(exam.id), kind: 'exam-returned', actionable: true,
        title: 'পরীক্ষা সংশোধনের জন্য ফেরত এসেছে',
        body: `${examName(exam)} · কারণ: ${text(exam.reviewNote) || 'উল্লেখ নেই'}`,
        at: Number(exam.reviewedAt) || Number(exam.updatedAt) || 0, target: 'online-exams', audience: 'শিক্ষক'
      });
    } else if (exam.status === 'published' && exam.resultsPublished !== true && Number(exam.publishedAt)) {
      items.push({
        key: `exam-approved:${text(exam.id)}:${Number(exam.publishedAt)}`,
        source: 'exams', sourceId: text(exam.id), kind: 'exam-approved',
        title: 'আপনার পরীক্ষা প্রকাশিত হয়েছে',
        body: `${examName(exam)}${Number(exam.startAt) ? ` · শুরু ${bnWhen(exam.startAt)}` : ''}`,
        at: Number(exam.publishedAt), target: 'online-exams', audience: 'শিক্ষক'
      });
    }
  }
  return items;
}

export function sortNewestFirst(items) {
  return [...items].sort((left, right) => (right.at || 0) - (left.at || 0));
}

export function notificationFeed({ notices = [], config = null, examDb = null, teachingDb = null, viewer = null, now = nowEpoch(), localWrites = null, students = null, registrationNotifications = null, transactions = null, cleared = null } = {}) {
  const items = [];
  const broadcast = broadcastItem(config);
  if (broadcast) items.push(broadcast);
  const latestNotices = new Map();
  for (const notice of Array.isArray(notices) ? notices : []) {
    if (notice?.status && notice.status !== 'published') continue;
    const item = noticeItem(notice);
    if (!item || !audienceMatches(notice, viewer)) continue;
    const prev = latestNotices.get(item.sourceId);
    if (!prev || (item.at || 0) >= (prev.at || 0)) latestNotices.set(item.sourceId, item);
  }
  items.push(...latestNotices.values());
  items.push(...examItems(examDb, viewer, now));
  items.push(...homeworkItems(teachingDb, viewer, now));
  items.push(...registrationItems(students, viewer, registrationNotifications));
  items.push(...studentDecisionItems(students, viewer));
  items.push(...examTimingItems(examDb, viewer, now));
  items.push(...studentPaymentItems(transactions, viewer));
  items.push(...paymentReviewItems(transactions, viewer));
  items.push(...paymentRejectedItems(transactions, viewer));
  items.push(...examReviewItems(examDb, viewer));
  items.push(...teacherExamItems(examDb, viewer));
  items.push(...birthdayItems(viewer, now));
  items.push(...birthdayTodayStaffItems(students, viewer, now));
  items.push(...birthdayAdvanceItems(students, viewer, now));
  // Items this person cleared from the list stay cleared on this device.
  const hidden = new Set(Array.isArray(cleared) ? cleared : []);
  const unique = new Map();
  for (const item of sortNewestFirst(items)) if (!unique.has(item.key) && !hidden.has(item.key)) unique.set(item.key, item);
  return [...unique.values()].map(item => ({ ...item, selfAuthored: isSelfAuthored(item, localWrites, now) }));
}

export function isSelfAuthored(item, localWrites, now = nowEpoch(), windowMs = SELF_AUTHOR_WINDOW_MS) {
  if (!item || !isObject(localWrites)) return false;
  const map = localWrites[item.source];
  if (!isObject(map)) return false;
  const stamp = Number(map[item.sourceId]);
  if (!Number.isFinite(stamp)) return false;
  return now - stamp <= windowMs;
}

export function planDeliveries({ feed = [], seen = [], firstRun = false, maxBurst = MAX_BURST, maxSeen = MAX_SEEN } = {}) {
  const seenSet = new Set(Array.isArray(seen) ? seen : []);
  const ordered = sortNewestFirst(feed);
  const notify = firstRun ? [] : ordered
    .filter(item => !seenSet.has(item.key) && !item.selfAuthored)
    .slice(0, Math.max(0, maxBurst));
  const keys = [];
  for (const item of ordered) {
    if (keys.includes(item.key)) continue;
    keys.push(item.key);
    if (keys.length >= maxSeen) break;
  }
  return { notify, seen: keys };
}

export const CLEARED_KEY_PREFIX = `${NOTIFY_PREFIX}cleared.v1:`;
export const MAX_CLEARED = 500;

export function clearedRecord(keys, liveKeys = null, at = nowEpoch()) {
  let list = [...new Set((Array.isArray(keys) ? keys : []).filter(key => typeof key === 'string' && key))];
  if (Array.isArray(liveKeys)) { const live = new Set(liveKeys); list = list.filter(key => live.has(key)); }
  return { version: 1, at: Number(at) || nowEpoch(), keys: list.slice(-MAX_CLEARED) };
}

export function seenRecord(keys, at = nowEpoch()) {
  return { version: 1, at: Number(at) || nowEpoch(), keys: Array.isArray(keys) ? keys : [] };
}

export function claimDelivery(shown, id, at = nowEpoch(), windowMs = SHOWN_WINDOW_MS) {
  const record = isObject(shown) ? { ...shown } : {};
  const stamp = Number(record[text(id)]);
  if (Number.isFinite(stamp) && Number(at) - stamp < windowMs) return { claim: false, record };
  for (const [key, value] of Object.entries(record)) if (Number(at) - Number(value) >= windowMs) delete record[key];
  record[text(id)] = Number(at) || nowEpoch();
  return { claim: true, record };
}

export const INAPP_KEY_PREFIX = `${NOTIFY_PREFIX}inapp.v1:`;
export const INAPP_MAX_ITEMS = 3;
const ALWAYS_CURRENT = new Set(['exam-soon', 'exam-live']);

export function planInAppAlerts({ feed = [], known = [], shown = null, initialise = false } = {}) {
  const items = (Array.isArray(feed) ? feed : []).filter(item => isObject(item) && text(item.key));
  const keep = new Set((Array.isArray(known) ? known : []).map(item => text(isObject(item) ? item.key : item)).filter(Boolean));
  for (const item of items) keep.add(item.key);
  const before = new Set(Array.isArray(shown) ? shown : []);
  const show = initialise
    ? items.filter(item => item.actionable || ALWAYS_CURRENT.has(item.kind))
    : items.filter(item => !before.has(item.key));
  const record = initialise ? [...keep] : [...before].filter(key => keep.has(key));
  return { show: sortNewestFirst(show), record };
}

export function pushPayload(item) {
  const body = text(item?.body);
  return {
    title: text(item?.title) || 'Active Plus',
    body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
    tag: text(item?.key) || 'active-plus',
    actionLabel: text(item?.actionLabel),
    data: {
      collection: text(item?.source) || 'notices',
      id: text(item?.sourceId),
      key: text(item?.key),
      kind: text(item?.kind)
    }
  };
}

export function pushTokenRecord({ token, viewer, deviceId, at = nowEpoch(), platform = '', locale = '' } = {}) {
  const value = text(token);
  if (value.length < 20) return null;
  return {
    token: value,
    role: viewer?.kind === 'staff' ? text(viewer.role) || 'staff' : 'student',
    username: text(viewer?.username),
    studentId: viewer?.kind === 'student' ? text(viewer?.studentId) : '',
    deviceId: text(deviceId),
    platform: text(platform).slice(0, 120),
    locale: text(locale).slice(0, 20),
    notifications: true,
    updatedAt: Number(at) || nowEpoch()
  };
}

export function tokenPathKey(deviceId, viewer) {
  const raw = `${text(deviceId) || 'device'}|${viewerKeyOf(viewer)}`;
  return encodeURIComponent(raw).replace(/%/g, '~').replace(/\./g, '~2E').slice(0, 200);
}
