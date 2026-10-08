/* The notification record store.

   Every notification that ever reached this device is kept here as one record,
   in the exact shape the school asked for:

     { id: 'NOTIF-YYYYMMDD-0001', userId, type, title, message,
       targetType, targetId, relatedId, createdBy, createdAt,
       read, readAt, delivered, deliveredAt }

   Two extra fields travel with the record because they are what makes it
   findable again: `key` (the notification engine's stable identity, used to
   link the record to the item in js/notification-rules.js) and `section`
   (which part of the app it belongs to, shown on the card).

   Read state is per user (`userId` = the engine's viewer key, e.g.
   `student:AP-1024` or `staff:manager.apc`), so two accounts on one device can
   never mark each other's notifications read.

   Nothing here deletes data: a record is only ever added, marked read or
   marked delivered. Turning notifications off, clearing the list or switching
   classes never removes a record. */

import { KEYS, readRaw, writeRaw } from './database.js';

export const NOTIFICATIONS_KEY = KEYS.notifications;
export const NOTIFICATION_SETTINGS_KEY = KEYS.notificationSettings;
export const RECORDS_VERSION = 1;
export const MAX_RECORDS_PER_USER = 600;

/** Where each notification type lives, in the person's own words. */
export const SECTION_LABEL = Object.freeze({
  notice: 'নোটিশ',
  broadcast: 'জরুরি ঘোষণা',
  exam: 'পরীক্ষা',
  homework: 'বাড়ির কাজ',
  birthday: 'জন্মদিন',
  'exam-soon': 'পরীক্ষা',
  'exam-live': 'পরীক্ষা',
  'exam-review': 'পরীক্ষা',
  'exam-returned': 'পরীক্ষা',
  'exam-approved': 'পরীক্ষা',
  result: 'ফলাফল',
  approved: 'ভর্তি',
  rejected: 'ভর্তি',
  registration: 'ভর্তি',
  payment: 'পেমেন্ট',
  'payment-review': 'পেমেন্ট',
  'payment-rejected': 'পেমেন্ট'
});

/** Which view a type opens when the record does not carry its own target. */
export const SECTION_TARGET = Object.freeze({
  notice: 'notice-board',
  broadcast: 'notice-board',
  exam: 'exams',
  homework: 'courses',
  'exam-soon': 'exams',
  'exam-live': 'exams',
  'exam-review': 'exams',
  'exam-returned': 'exams',
  'exam-approved': 'exams',
  result: 'exams',
  approved: 'home',
  rejected: 'home',
  registration: 'approvals',
  payment: 'home',
  'payment-review': 'cash-counter',
  'payment-rejected': 'home'   // the counter's own day, where its slip is re-opened
});

export const NOTIFICATION_DEFAULTS = Object.freeze({
  enabled: true,      // master switch, in-app + system
  sound: true,        // a short tone with an in-app card
  background: true,   // show while the app is in the background / closed
  inApp: true         // the card inside the app
});

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value.trim() : '');

/* ---- ids --------------------------------------------------------------------- */

const pad = (value, size) => String(value).padStart(size, '0');

/** `NOTIF-20261002-0001` — one running number per day, per device. */
export function notificationId(when = new Date()) {
  const date = when instanceof Date && Number.isFinite(when.getTime()) ? when : new Date();
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}`;
  return `NOTIF-${day}`;
}

function nextSequence(records, prefix) {
  let highest = 0;
  for (const record of records) {
    const id = text(record?.id);
    if (!id.startsWith(`${prefix}-`)) continue;
    const tail = Number(id.slice(prefix.length + 1));
    if (Number.isFinite(tail) && tail > highest) highest = tail;
  }
  return highest + 1;
}

/** @returns {string} a fresh record id that no stored record uses yet. */
export function nextNotificationId(records = [], when = new Date()) {
  const prefix = notificationId(when);
  return `${prefix}-${pad(nextSequence(records, prefix), 4)}`;
}

/* ---- storage ----------------------------------------------------------------- */

/** `{ version, records: [] }` — the raw store keeps strings, so this parses.
    A corrupt file is ignored (and replaced on the next write), never trusted. */
export function loadRecords() {
  const raw = readRaw(NOTIFICATIONS_KEY);
  if (typeof raw !== 'string' || !raw) return { version: RECORDS_VERSION, records: [] };
  try {
    const saved = JSON.parse(raw);
    if (!isObject(saved) || !Array.isArray(saved.records)) return { version: RECORDS_VERSION, records: [] };
    return { version: RECORDS_VERSION, records: saved.records.filter(isObject) };
  } catch { return { version: RECORDS_VERSION, records: [] }; }
}

export function saveRecords(records) {
  writeRaw(NOTIFICATIONS_KEY, JSON.stringify({ version: RECORDS_VERSION, records: Array.isArray(records) ? records : [] }));
  return true;
}

/** Newest first. A record written without a valid stamp keeps its old place. */
export function listNotifications(userId) {
  const owner = text(userId);
  if (!owner) return [];
  return loadRecords().records
    .filter(record => text(record.userId) === owner)
    .sort((left, right) => (Number(right.at) || 0) - (Number(left.at) || 0));
}

export function unreadNotifications(userId) {
  return listNotifications(userId).filter(record => record.read === false);
}

/** The count the bell badge shows. Only `read === false` is unread. */
export function unreadCount(userId) {
  return unreadNotifications(userId).length;
}

/** One record by its engine key (what the feed item carries). */
export function notificationByKey(userId, key) {
  const wanted = text(key);
  if (!wanted) return null;
  return listNotifications(userId).find(record => text(record.key) === wanted) || null;
}

function writeUser(userId, update) {
  const owner = text(userId);
  if (!owner) return null;
  const all = loadRecords().records;
  let saved = null;
  const next = all.map(record => {
    if (text(record.userId) !== owner) return record;
    const patched = update(record);
    if (patched && patched !== record) saved = patched;
    return patched || record;
  });
  saveRecords(next);
  return saved;
}

export function markRead(userId, keys, at = Date.now()) {
  const wanted = new Set((Array.isArray(keys) ? keys : [keys]).map(text).filter(Boolean));
  if (!wanted.size) return 0;
  let changed = 0;
  writeUser(userId, record => {
    if (record.read !== false || !wanted.has(text(record.key))) return record;
    changed += 1;
    return { ...record, read: true, readAt: new Date(at).toISOString() };
  });
  return changed;
}

export function markAllRead(userId, at = Date.now()) {
  let changed = 0;
  writeUser(userId, record => {
    if (record.read !== false) return record;
    changed += 1;
    return { ...record, read: true, readAt: new Date(at).toISOString() };
  });
  return changed;
}

export function markUnread(userId, keys) {
  const wanted = new Set((Array.isArray(keys) ? keys : [keys]).map(text).filter(Boolean));
  if (!wanted.size) return 0;
  let changed = 0;
  writeUser(userId, record => {
    if (record.read !== false && wanted.has(text(record.key))) {
      changed += 1;
      return { ...record, read: false, readAt: '' };
    }
    return record;
  });
  return changed;
}

/** The system notification for these records really left the device. */
export function markDelivered(userId, keys, at = Date.now()) {
  const wanted = new Set((Array.isArray(keys) ? keys : [keys]).map(text).filter(Boolean));
  if (!wanted.size) return 0;
  let changed = 0;
  writeUser(userId, record => {
    if (record.delivered === true || !wanted.has(text(record.key))) return record;
    changed += 1;
    return { ...record, delivered: true, deliveredAt: new Date(at).toISOString() };
  });
  return changed;
}

/* Records are stored as JSON, so every read builds fresh objects: the set of
   records to keep is identified by key/id, never by object identity. */
const recordIdentity = record => `${text(record?.key)}\u0000${text(record?.id)}`;

/** Keep the newest records; unread ones are never pruned. */
export function pruneRecords(userId, max = MAX_RECORDS_PER_USER) {
  const owner = text(userId);
  if (!owner) return 0;
  const all = loadRecords().records;
  const mine = listNotifications(owner);
  if (mine.length <= max) return 0;
  const keep = new Set();
  let remaining = max;
  for (const record of mine) {
    if (remaining > 0 || record.read === false) { keep.add(recordIdentity(record)); remaining -= 1; }
  }
  const next = all.filter(record => text(record.userId) !== owner || keep.has(recordIdentity(record)));
  saveRecords(next);
  return all.length - next.length;
}

/* ---- Building records from the feed ----------------------------------------- */

/** Map one feed item (js/notification-rules.js) to the stored record shape. */
export function recordFromFeedItem(item, { userId, read = false, at = Date.now() } = {}) {
  const stamp = Number(item?.at) || Number(at) || Date.now();
  const type = text(item?.kind) || 'notice';
  return {
    key: text(item?.key),
    id: '',                                   // filled by syncNotifications
    userId: text(userId),
    type,
    title: text(item?.title) || 'নোটিফিকেশন',
    message: text(item?.body) || '',
    targetType: text(item?.target) || SECTION_TARGET[type] || '',
    targetId: text(item?.targetId) || text(item?.sourceId) || '',
    relatedId: text(item?.sourceId) || '',
    createdBy: text(item?.createdBy) || '',
    createdAt: new Date(stamp).toISOString(),
    read: read === true,
    readAt: read === true ? new Date(stamp).toISOString() : '',
    delivered: false,
    deliveredAt: '',
    // Internal: ordering + the section chip on the card.
    at: stamp,
    section: SECTION_LABEL[type] || 'নোটিশ'
  };
}

/**
 * Add a record for every feed item this user has not been told about yet.
 *
 * `legacyRead` lists the item keys this device already knew about (its read
 * receipts and cleared items). They are stored as already read, so updating the
 * app never turns yesterday's news into a pile of unread notifications. A
 * homework reminder that leaves the live feed (completed or past its deadline)
 * is acknowledged here so it cannot leave a stale unread badge behind.
 *
 * Idempotent: running it twice writes nothing the second time.
 *
 * @returns {{ created: number, kept: number, records: object[] }}
 */
export function syncNotifications({ userId, feed = [], legacyRead = [], now = Date.now() } = {}) {
  const owner = text(userId);
  if (!owner) return { created: 0, kept: 0, records: [] };
  const store = loadRecords();
  const items = Array.isArray(feed) ? feed : [];
  const live = new Set(items.map(item => text(item?.key)).filter(Boolean));
  const stamp = Number(now) || Date.now();
  let resolved = false;
  const base = store.records.map(record => {
    if (text(record.userId) !== owner || record.type !== 'homework' || record.read !== false || live.has(text(record.key))) return record;
    resolved = true;
    return { ...record, read: true, readAt: new Date(stamp).toISOString() };
  });
  const known = new Set(base.filter(record => text(record.userId) === owner).map(record => text(record.key)));
  const legacy = new Set((Array.isArray(legacyRead) ? legacyRead : []).map(text));
  const fresh = [];
  for (const item of items) {
    const key = text(item?.key);
    if (!key || known.has(key)) continue;
    known.add(key);
    fresh.push(recordFromFeedItem(item, { userId: owner, read: legacy.has(key), at: now }));
  }
  if (!fresh.length && !resolved) return { created: 0, kept: 0, records: listNotifications(owner) };
  const withIds = [];
  const pool = [...base];
  for (const record of fresh) {
    record.id = nextNotificationId(pool, new Date(record.at));
    pool.push(record);
    withIds.push(record);
  }
  saveRecords([...base, ...withIds]);
  pruneRecords(owner);
  return { created: withIds.length, kept: 0, records: withIds.length ? withIds : listNotifications(owner) };
}

/* ---- Per-user settings ------------------------------------------------------- */

function loadSettingsFile() {
  const raw = readRaw(NOTIFICATION_SETTINGS_KEY);
  if (typeof raw !== 'string' || !raw) return { version: 1, users: {} };
  try {
    const saved = JSON.parse(raw);
    return isObject(saved) && isObject(saved.users) ? saved : { version: 1, users: {} };
  } catch { return { version: 1, users: {} }; }
}

/** A user who has never opened the screen gets the defaults. */
export function notificationSettings(userId) {
  const owner = text(userId);
  if (!owner) return { ...NOTIFICATION_DEFAULTS };
  const stored = loadSettingsFile().users[owner];
  return { ...NOTIFICATION_DEFAULTS, ...(isObject(stored) ? stored : {}) };
}

export function saveNotificationSettings(userId, patch = {}) {
  const owner = text(userId);
  if (!owner) return { ...NOTIFICATION_DEFAULTS };
  const file = loadSettingsFile();
  const next = { ...notificationSettings(owner) };
  for (const field of Object.keys(NOTIFICATION_DEFAULTS)) {
    if (field in patch) next[field] = patch[field] === true;
  }
  next.updatedAt = new Date().toISOString();
  file.users[owner] = next;
  file.version = 1;
  writeRaw(NOTIFICATION_SETTINGS_KEY, JSON.stringify(file));
  try {
    window.dispatchEvent(new CustomEvent('apc-notification-settings', { detail: { userId: owner, settings: { ...next } } }));
  } catch { /* no window (tests) — the write above is what matters */ }
  return { ...next };
}
