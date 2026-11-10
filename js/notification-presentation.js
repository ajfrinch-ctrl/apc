/* Shared notification presentation rules.
 *
 * The feed and persisted records use the same category/priority vocabulary so
 * the inbox, History page and push payload adapters can converge without
 * changing the underlying Firebase event sources.
 */
export const NOTIFICATION_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'registration', label: 'ভর্তি' }),
  Object.freeze({ id: 'exam', label: 'পরীক্ষা' }),
  Object.freeze({ id: 'result', label: 'ফলাফল' }),
  Object.freeze({ id: 'notice', label: 'নোটিশ' }),
  Object.freeze({ id: 'chat', label: 'চ্যাট' }),
  Object.freeze({ id: 'system', label: 'সিস্টেম' })
]);

export const NOTIFICATION_PRIORITIES = Object.freeze([
  Object.freeze({ id: 'urgent', label: 'জরুরি' }),
  Object.freeze({ id: 'important', label: 'গুরুত্বপূর্ণ' }),
  Object.freeze({ id: 'normal', label: 'সাধারণ' })
]);

export const NOTIFICATION_ARCHIVE_AFTER_DAYS = 30;
export const NOTIFICATION_ARCHIVE_AFTER_MS = NOTIFICATION_ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;

const CATEGORY_IDS = new Set(NOTIFICATION_CATEGORIES.map(item => item.id));
const PRIORITY_IDS = new Set(NOTIFICATION_PRIORITIES.map(item => item.id));
const KIND_CATEGORY = Object.freeze({
  registration: 'registration', approved: 'registration', rejected: 'registration',
  exam: 'exam', 'exam-soon': 'exam', 'exam-live': 'exam', 'exam-review': 'exam',
  'exam-returned': 'exam', 'exam-approved': 'exam', 'exam-published': 'exam',
  result: 'result', 'result-published': 'result',
  notice: 'notice', broadcast: 'notice', announcement: 'notice', news: 'notice',
  chat: 'chat', 'class-chat': 'chat', message: 'chat'
});
const URGENT_KINDS = new Set(['broadcast', 'exam-live', 'system-urgent', 'security-alert']);
const PENDING_ACTIONABLE_KINDS = new Set(['registration', 'exam-review', 'exam-returned', 'payment-review']);
const IMPORTANT_KINDS = new Set([
  'registration', 'approved', 'rejected', 'exam-review', 'exam-returned',
  'exam-approved', 'exam-published', 'result', 'result-published', 'payment-review',
  'payment-rejected'
]);

const clean = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

export function notificationCategory(item = {}) {
  const explicit = clean(item.category);
  if (CATEGORY_IDS.has(explicit)) return explicit;
  const kind = clean(item.kind || item.type);
  return KIND_CATEGORY[kind] || 'system';
}

export function notificationPriority(item = {}) {
  const explicit = clean(item.priority);
  if (PRIORITY_IDS.has(explicit)) return explicit;
  const kind = clean(item.kind || item.type);
  const sourceCategory = clean(item.category);
  if (item.urgent === true || item.critical === true || ['urgent', 'emergency'].includes(sourceCategory) || URGENT_KINDS.has(kind)) return 'urgent';
  if (IMPORTANT_KINDS.has(kind)) return 'important';
  return 'normal';
}

export function notificationPresentation(item = {}) {
  const category = notificationCategory(item);
  const priority = notificationPriority(item);
  return {
    category,
    categoryLabel: NOTIFICATION_CATEGORIES.find(row => row.id === category)?.label || 'সিস্টেম',
    priority,
    priorityLabel: NOTIFICATION_PRIORITIES.find(row => row.id === priority)?.label || 'সাধারণ'
  };
}

function timestampOf(record) {
  const numeric = Number(record?.at);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(record?.createdAt || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Mark a record as archived once it reaches the 30-day active-inbox boundary. */
export function archiveState(record, now = Date.now(), days = NOTIFICATION_ARCHIVE_AFTER_DAYS) {
  if (!record || typeof record !== 'object') return null;
  // Pending approvals stay active until a decision; ordinary unread news can
  // move to History after 30 days and remains unread there.
  if (record.archived === true || (record.read === false && PENDING_ACTIONABLE_KINDS.has(clean(record.type)))) return record;
  const stamp = timestampOf(record);
  const age = Math.max(0, Number(now) - stamp);
  const threshold = Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000;
  if (!stamp || age < threshold) return record;
  return {
    ...record,
    archived: true,
    archivedAt: new Date(Number(now)).toISOString()
  };
}
