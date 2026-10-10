/* Notification rules — pure functions only.
   No DOM, no Firebase, no storage access: everything here is data in → data out
   so the delivery decisions can be tested without a browser and reused by the
   page engine (js/notifications.js) and by the sender (functions/*).

   The system has two halves:
     • the notification centre (each device keeps its own read/seen receipts)
     • the push transport (FCM token per device, filled in by Cloud Functions)

   Secrets never appear here: a token record carries a role and an ID, never a
   password hash or a session token. */

export const NOTIFY_PREFIX = 'activePlus.notifications.';
/* The local-write mark lives in its own tiny module so the boot path never
   pulls this file in; re-exported here for every existing importer. */
export { LOCAL_WRITE_KEY, markLocalSource } from './local-write-mark.js';
export const SEEN_KEY_PREFIX = `${NOTIFY_PREFIX}seen.v1:`;
export const BOOT_KEY_PREFIX = `${NOTIFY_PREFIX}boot.v1:`;
export const PROMPT_HIDDEN_KEY = `${NOTIFY_PREFIX}promptHiddenAt.v1`;
/* The same event reaches a phone twice when the app is open — once through the
   sync bridge and once as an FCM push. Both paths claim the record here first,
   so exactly one notification is shown whichever arrives first. */
export const SHOWN_KEY = `${NOTIFY_PREFIX}shown.v1`;
export const SHOWN_WINDOW_MS = 2 * 60 * 1000;

/* A record written on this device is not announced back to the person who wrote
   it. The window is short on purpose: a genuinely re-published record notifies
   again a few minutes later. */
export const SELF_AUTHOR_WINDOW_MS = 10 * 60 * 1000;
/* Seen keys are a rolling window, not a permanent archive. */
export const MAX_SEEN = 300;
/* A backlog (offline for hours) must not fire twenty system notifications. */
export const MAX_BURST = 3;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value.trim() : '');

/** Stable identity of the person using this device. */
export function viewerKeyOf(viewer) {
  if (!viewer) return 'guest';
  if (viewer.kind === 'staff') return `staff:${text(viewer.username) || text(viewer.role) || 'unknown'}`;
  return `student:${text(viewer.studentId) || text(viewer.username) || 'guest'}`;
}

/** Audience strings written by the Manager notice form. */
export const AUDIENCES = Object.freeze(['সকল শিক্ষার্থী', 'অভিভাবক', 'শিক্ষার্থী ও অভিভাবক']);

/** Normalised comparison for class / batch names (Bengali text mixes forms). */
const scopeKey = value => text(value).normalize('NFC').toLowerCase().replace(/\s+/g, ' ');

/**
 * Does a class/batch-targeted notice reach this viewer?
 *
 * A Teacher (or a Manager) may address one class and one batch instead of the
 * whole school. A notice without `className`/`group` keeps reaching everyone
 * exactly as before, so every stored notice stays visible; a notice that names
 * a class reaches only that class, and one that names a batch only that batch
 * inside the class.
 */
export function noticeScopeMatches(notice, viewer) {
  if (!notice || !viewer) return true;
  const className = text(notice.className || notice.targetClass);
  const group = text(notice.group || notice.batch || notice.targetGroup);
  if (!className && !group) return true;
  if (className && scopeKey(className) !== scopeKey(viewer.className)) return false;
  if (group && scopeKey(group) !== scopeKey(viewer.group)) return false;
  return true;
}

/**
 * Does this notice belong on this device's notice screen?
 *
 * The student app is where a student — or the guardian holding that phone —
 * signs in, so those three audiences all reach it. A record addressed to some
 * other group (a future staff-only audience) is not shown to students.
 * Staff devices see every notice: staff publish them and answer for them.
 */
export function audienceMatches(notice, viewer) {
  if (!notice) return false;
  if (viewer?.kind === 'staff') return true;
  const audience = text(notice.audience);
  if (audience && !AUDIENCES.includes(audience)) return false;
  return noticeScopeMatches(notice, viewer);
}

export const NOTICE_BOARD_READ_PREFIX = 'activePlus.noticeBoard.read.v1:';

export const NOTICE_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'urgent', label: '🔴 জরুরি', shortLabel: 'জরুরি', icon: '🔴' }),
  Object.freeze({ id: 'academic', label: '📚 Academic', shortLabel: 'Academic', icon: '📚' }),
  Object.freeze({ id: 'class', label: '🏫 Class', shortLabel: 'Class', icon: '🏫' }),
  Object.freeze({ id: 'fee', label: '💰 Fee', shortLabel: 'Fee', icon: '💰' }),
  Object.freeze({ id: 'exam', label: '📝 Exam', shortLabel: 'Exam', icon: '📝' })
]);
const NOTICE_CATEGORY_IDS = new Set(NOTICE_CATEGORIES.map(category => category.id));
const NOTICE_CATEGORY_ALIASES = Object.freeze({
  urgent: 'urgent', emergency: 'urgent', priority: 'urgent', জরুরি: 'urgent', জরুরী: 'urgent',
  academic: 'academic', academics: 'academic', study: 'academic', শিক্ষা: 'academic', একাডেমিক: 'academic',
  class: 'class', classes: 'class', ক্লাস: 'class', শ্রেণি: 'class', শ্রেণী: 'class',
  fee: 'fee', fees: 'fee', payment: 'fee', ফি: 'fee', পেমেন্ট: 'fee',
  exam: 'exam', exams: 'exam', পরীক্ষা: 'exam', পরীক্ষার: 'exam'
});

/** A published notice always belongs to exactly one Notice Board category. */
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

/** Revision of a notice: editing the text makes it unread / newsworthy again. */
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

/** Urgent banner from System Settings — reaches every device, not a class. */
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

/** Bengali-friendly date/time for a notification body. */
export function bnWhen(ms) {
  const when = new Date(Number(ms));
  if (!Number.isFinite(when.getTime())) return '';
  try {
    return when.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return when.toLocaleString();
  }
}

const participantIds = exam => (Array.isArray(exam?.participants) ? exam.participants : [])
  .map(person => text(person?.id))
  .filter(Boolean);

/**
 * A published paper is news until it is over. Sender
 * (functions/notification-payload.js) and client share this rule, so a push
 * always has a matching entry in the in-app notification list.
 */
export function stillOpenExam(exam, now = Date.now()) {
  if (exam?.resultsPublished === true) return false;
  const endsAt = Number(exam?.endAt) || Number(exam?.startAt) || 0;
  return endsAt === 0 || endsAt > Number(now);
}

/**
 * Exam news for one student device: a published paper that is not over yet,
 * and a result the office has released. Only participants are told.
 */
export function examItems(examDb, viewer, now = Date.now()) {
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
      /* A published paper is an action card, not just a generic alert. The
         title names the exact paper; the CTA goes straight to its exam card and
         starts it when the paper is currently available. */
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

/** Incomplete homework due today or tomorrow, scoped to the student's class. */
export function homeworkItems(teachingDb, viewer, now = Date.now()) {
  const timestamp = Number(now);
  const current = new Date(Number.isFinite(timestamp) ? timestamp : Date.now());
  const today = localDayKey(current);
  const tomorrowDate = new Date(current);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localDayKey(tomorrowDate);
  if (!today || !tomorrow) return [];
  const items = [];
  for (const activity of homeworkActivities(teachingDb, viewer)) {
    const due = text(activity.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || (due !== today && due !== tomorrow)) continue;
    const parsed = new Date(`${due}T12:00:00`);
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
      at: Number(now) || Date.now(),
      audience: 'নিজের শ্রেণি'
    });
  }
  return items;
}

const pad2 = value => String(value).padStart(2, '0');
const isLeapYear = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

/** `MM-DD` from a stored ISO birth date. Empty when the profile has none. */
export function birthMonthDay(birthDate) {
  const match = text(birthDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}-${match[3]}` : '';
}

/** True on the student's birthday (29 Feb falls on 1 Mar in a common year). */
export function isStudentBirthday(birthDate, now = Date.now()) {
  const stamp = birthMonthDay(birthDate);
  if (!stamp) return false;
  const date = new Date(Number(now));
  if (!Number.isFinite(date.getTime())) return false;
  const today = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  if (stamp === today) return true;
  return stamp === '02-29' && !isLeapYear(date.getFullYear()) && today === '03-01';
}

/** One greeting per year, only for the signed-in student, only on the day. */
export function birthdayItems(viewer, now = Date.now()) {
  if (viewer?.kind !== 'student' || !text(viewer.studentId) || !isStudentBirthday(viewer.birthDate, now)) return [];
  const date = new Date(Number(now) || Date.now());
  const year = date.getFullYear();
  const first = text(viewer.name).split(/\s+/)[0] || 'শিক্ষার্থী';
  return [{
    key: `birthday:${text(viewer.studentId)}:${year}`,
    source: 'account',
    sourceId: text(viewer.studentId),
    kind: 'birthday',
    target: 'home',
    title: `শুভ জন্মদিন, ${first}!`,
    body: 'Active Plus Coaching পরিবার থেকে ভালোবাসা আর শুভেচ্ছা। আজকের দিনটা আপনার — শিখতে থাকো, এগিয়ে যাও।',
    at: Number(now) || Date.now(),
    audience: 'নিজের জন্মদিন'
  }];
}

export function nextBirthdayBoundary(now = Date.now()) {
  const date = new Date(Number(now));
  if (!Number.isFinite(date.getTime())) return 0;
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return next.getTime();
}

const BIRTHDAY_STAFF = Object.freeze(['admin', 'manager', 'teacher']);

/** One-day heads-up for Admin, Manager and Teacher: whose birthday is tomorrow. */
export function birthdayAdvanceItems(students, viewer, now = Date.now()) {
  if (viewer?.kind !== 'staff' || !BIRTHDAY_STAFF.includes(text(viewer.role))) return [];
  const current = new Date(Number(now) || Date.now());
  if (!Number.isFinite(current.getTime())) return [];
  const tomorrow = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
  const year = tomorrow.getFullYear();
  const assigned = Array.isArray(viewer.assignedClasses)
    ? new Set(viewer.assignedClasses.map(scopeKey).filter(Boolean))
    : null;
  const items = [];
  for (const student of Array.isArray(students) ? students : []) {
    if (!isObject(student) || student.status === 'rejected') continue;
    const id = text(student.id);
    if (!id || !isStudentBirthday(student.birthDate, tomorrow.getTime())) continue;
    if (text(viewer.role) === 'teacher') {
      if (!assigned?.size || !assigned.has(scopeKey(student.className))) continue;
    }
    const name = text(student.name) || text(student.nameEn) || 'নাম নেই';
    const place = [text(student.className), text(student.group)].filter(Boolean).join(' • ');
    items.push({
      key: `birthday-soon:${id}:${year}`,
      source: 'students',
      sourceId: id,
      kind: 'birthday-soon',
      target: 'students',
      title: 'আগামীকাল জন্মদিন',
      body: `${place ? `${place} — ` : ''}${name}`,
      at: Number(now) || Date.now(),
      audience: 'এডমিন, ম্যানেজার ও শিক্ষক'
    });
  }
  return items;
}

/** Next local-day transition that changes a homework reminder. */
export function nextHomeworkBoundary(teachingDb, viewer, now = Date.now()) {
  const timestamp = Number(now);
  if (viewer?.kind !== 'student' || !Number.isFinite(timestamp)) return 0;
  let next = 0;
  for (const activity of homeworkActivities(teachingDb, viewer)) {
    const due = text(activity.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) continue;
    const date = new Date(`${due}T00:00:00`);
    if (localDayKey(date) !== due) continue;
    const transitions = [
      new Date(date).setDate(date.getDate() - 1),
      date.getTime(),
      new Date(date).setDate(date.getDate() + 1)
    ];
    for (const boundary of transitions) {
      if (boundary > timestamp && (!next || boundary < next)) next = boundary;
    }
  }
  return next;
}

/* Staff roles that decide on a student registration (js/admin-permissions.js
   STUDENTS_APPROVE): both see the same "new registration" item. */
export const REGISTRATION_REVIEWERS = Object.freeze(['admin', 'manager']);

/**
 * One actionable item per registration still waiting for a decision. The item
 * disappears by itself once the student is approved or rejected (on any
 * device), because only `pending` rows produce one.
 */
export function registrationItems(students, viewer) {
  if (viewer?.kind !== 'staff' || !REGISTRATION_REVIEWERS.includes(text(viewer.role))) return [];
  const items = [];
  for (const student of Array.isArray(students) ? students : []) {
    if (!isObject(student) || student.status !== 'pending') continue;
    const id = text(student.id);
    if (!id) continue;
    const name = text(student.name) || text(student.nameEn) || 'নাম নেই';
    const details = [text(student.className), text(student.group), id].filter(Boolean).join(' • ');
    items.push({
      key: `registration:${id}`,
      source: 'students',
      sourceId: id,
      kind: 'registration',
      actionable: true,
      title: 'নতুন শিক্ষার্থী রেজিস্ট্রেশন',
      body: `${name}${details ? ` — ${details}` : ''} · অনুমোদনের অপেক্ষায়`,
      at: Date.parse(text(student.registeredAt) || text(student.createdAt) || '') || 0,
      audience: 'এডমিন ও ম্যানেজার'
    });
  }
  return items;
}

/* ---- Role notifications (owner request 2026-09-30: "all necessary ones") ----

   Every rule below is derived from records that already sync to the device, so
   no new cloud node is needed. Items that ask someone to act are `actionable`
   (they keep the bell dot until opened, decided or cleared) and every item may
   carry a `target` — the panel view a tap opens. */

/** How long before the start a participant is reminded. */
export const EXAM_REMINDER_MS = 10 * 60 * 1000;

const examName = exam => {
  const name = text(exam?.title) || 'পরীক্ষা';
  const subject = text(exam?.subject);
  return `${name}${subject ? ` — ${subject}` : ''}`;
};
const money = value => `৳${Number(value) || 0}`;
const stamp = value => Date.parse(text(value)) || Number(value) || 0;

/** Student: the office decided on this student's own registration. */
export function studentDecisionItems(students, viewer) {
  if (viewer?.kind !== 'student') return [];
  const id = text(viewer.studentId);
  if (!id) return [];
  const row = (Array.isArray(students) ? students : []).find(item => isObject(item) && text(item.id) === id);
  // Only a real review (it carries reviewedAt) is news; old rows stay quiet.
  if (!row || !text(row.reviewedAt) || !['approved', 'rejected'].includes(row.status)) return [];
  const approved = row.status === 'approved';
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

/**
 * Student: "starts soon" in the reminder window and "started" while the paper
 * is open. A student who already started (or submitted) is not told to start.
 */
export function examTimingItems(examDb, viewer, now = Date.now(), reminderMs = EXAM_REMINDER_MS) {
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

/** The next moment an exam timing item appears or changes (for a timer). */
export function nextExamBoundary(examDb, viewer, now = Date.now(), reminderMs = EXAM_REMINDER_MS) {
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

/** Student: a fee the counter recorded was confirmed by the Manager. */
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

/** Manager: a fee entry waiting for approval (disappears once decided). */
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

/** Payment counter: an entry the Manager rejected, with the reason. */
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

/** Manager: a teacher sent a paper for approval. */
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

/** Teacher: the Manager's answer on a paper — returned (with reason) or published. */
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

/** Newest first, stable for equal timestamps. */
export function sortNewestFirst(items) {
  return [...items].sort((left, right) => (right.at || 0) - (left.at || 0));
}

/** The complete notification list for one device, deduplicated by key. */
export function notificationFeed({ notices = [], config = null, examDb = null, teachingDb = null, viewer = null, now = Date.now(), localWrites = null, students = null, transactions = null, cleared = null } = {}) {
  const items = [];
  const broadcast = broadcastItem(config);
  if (broadcast) items.push(broadcast);
  for (const notice of Array.isArray(notices) ? notices : []) {
    const item = noticeItem(notice);
    if (item && audienceMatches(notice, viewer)) items.push(item);
  }
  items.push(...examItems(examDb, viewer, now));
  items.push(...homeworkItems(teachingDb, viewer, now));
  items.push(...registrationItems(students, viewer));
  items.push(...studentDecisionItems(students, viewer));
  items.push(...examTimingItems(examDb, viewer, now));
  items.push(...studentPaymentItems(transactions, viewer));
  items.push(...paymentReviewItems(transactions, viewer));
  items.push(...paymentRejectedItems(transactions, viewer));
  items.push(...examReviewItems(examDb, viewer));
  items.push(...teacherExamItems(examDb, viewer));
  items.push(...birthdayItems(viewer, now));
  items.push(...birthdayAdvanceItems(students, viewer, now));
  // Items this person cleared from the list stay cleared on this device.
  const hidden = new Set(Array.isArray(cleared) ? cleared : []);
  const unique = new Map();
  for (const item of sortNewestFirst(items)) if (!unique.has(item.key) && !hidden.has(item.key)) unique.set(item.key, item);
  return [...unique.values()].map(item => ({ ...item, selfAuthored: isSelfAuthored(item, localWrites, now) }));
}

/* ---- "written on this device" marker ---------------------------------------
   saveNotices()/saveAppConfig() stamp what this device wrote. The person who
   typed the notice should not receive their own push. */


export function isSelfAuthored(item, localWrites, now = Date.now(), windowMs = SELF_AUTHOR_WINDOW_MS) {
  if (!item || !isObject(localWrites)) return false;
  const map = localWrites[item.source];
  if (!isObject(map)) return false;
  const stamp = Number(map[item.sourceId]);
  if (!Number.isFinite(stamp)) return false;
  return now - stamp <= windowMs;
}

/* ---- Delivery planning ------------------------------------------------------ */

/**
 * Which items should raise a system notification, and which keys become seen.
 *
 * `firstRun` is the first time this device runs the engine: the existing list is
 * recorded silently, because a fresh install must not replay old news. Later,
 * only keys that were never seen — and that this device did not write itself —
 * are announced, up to `maxBurst`, newest first. Everything in the feed is
 * marked seen either way, so a notification is never repeated.
 */
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

/** Keys the person emptied from the list. Only keys that still exist in the
    feed are worth remembering, so the record never grows without bound. */
export function clearedRecord(keys, liveKeys = null, at = Date.now()) {
  let list = [...new Set((Array.isArray(keys) ? keys : []).filter(key => typeof key === 'string' && key))];
  if (Array.isArray(liveKeys)) { const live = new Set(liveKeys); list = list.filter(key => live.has(key)); }
  return { version: 1, at: Number(at) || Date.now(), keys: list.slice(-MAX_CLEARED) };
}

export function seenRecord(keys, at = Date.now()) {
  return { version: 1, at: Number(at) || Date.now(), keys: Array.isArray(keys) ? keys : [] };
}

/**
 * Claim a record for display. The first caller wins; a second caller inside the
 * window is told 'already shown' instead of raising a duplicate notification.
 */
export function claimDelivery(shown, id, at = Date.now(), windowMs = SHOWN_WINDOW_MS) {
  const record = isObject(shown) ? { ...shown } : {};
  const stamp = Number(record[text(id)]);
  if (Number.isFinite(stamp) && Number(at) - stamp < windowMs) return { claim: false, record };
  for (const [key, value] of Object.entries(record)) if (Number(at) - Number(value) >= windowMs) delete record[key];
  record[text(id)] = Number(at) || Date.now();
  return { claim: true, record };
}

/* ---- In-app alert card (owner decision 2026-09-30) ---------------------------
   "Showing notifications when the app is opened is enough": new items appear
   on a card inside the app, with no phone permission needed. Each item is shown
   on the card once; it stays in the bell list afterwards. */

export const INAPP_KEY_PREFIX = `${NOTIFY_PREFIX}inapp.v1:`;
export const INAPP_MAX_ITEMS = 3;
/* Always current, so worth showing even on the very first run. */
const ALWAYS_CURRENT = new Set(['exam-soon', 'exam-live']);

/**
 * Which items the card shows now, and the receipt list to store.
 * `feed` is what the list shows (cleared items removed); `known` is every key
 * the device may remember (the full feed), so receipts cannot grow forever.
 * `initialise` (no receipt file yet: a new install, or the first run after this
 * update) shows only waiting tasks and running exams — old news stays quiet.
 */
export function planInAppAlerts({ feed = [], known = [], shown = null, initialise = false } = {}) {
  const items = (Array.isArray(feed) ? feed : []).filter(item => isObject(item) && text(item.key));
  const keep = new Set((Array.isArray(known) ? known : []).map(item => text(isObject(item) ? item.key : item)).filter(Boolean));
  for (const item of items) keep.add(item.key);
  const before = new Set(Array.isArray(shown) ? shown : []);
  const show = initialise
    ? items.filter(item => item.actionable || ALWAYS_CURRENT.has(item.kind))
    : items.filter(item => !before.has(item.key));
  // A new baseline remembers everything current; otherwise receipts are only
  // added when the card really shows an item (markInAppShown), here just pruned.
  const record = initialise ? [...keep] : [...before].filter(key => keep.has(key));
  return { show: sortNewestFirst(show), record };
}

/* ---- Push transport --------------------------------------------------------- */

/** FCM payload shown by the service worker. Kept identical to the sender's. */
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
      // No `url`: which page opens is the device's own decision (its panel hint
      // in the service worker), so no payload can send it into another panel.
      kind: text(item?.kind)
    }
  };
}

/**
 * The record a device stores in the cloud so the sender knows where to push.
 * No password, hash or session token may ever be added here.
 */
export function pushTokenRecord({ token, viewer, deviceId, at = Date.now(), platform = '', locale = '' } = {}) {
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
    updatedAt: Number(at) || Date.now()
  };
}

/** One device may hold several roles: the node key is device + person.
    The encoding must be injective — replacing a forbidden character with `-`
    gave `dev.1` and `dev-1` the same slot, so one device's push token could
    overwrite another's. Percent-encoding keeps every device separate, and the
    `%` is folded to `~` so the node key stays readable in the console; dots are
    encoded too because Realtime Database rejects `.` in a key. */
export function tokenPathKey(deviceId, viewer) {
  const raw = `${text(deviceId) || 'device'}|${viewerKeyOf(viewer)}`;
  return encodeURIComponent(raw).replace(/%/g, '~').replace(/\./g, '~2E').slice(0, 200);
}
