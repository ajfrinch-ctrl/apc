import { KEYS, readRaw, writeJSON, newId } from './database.js';
import { normalizeClassId } from './class-key.js';
import { escapeHtml } from './sanitize.js';
import { enabledClasses } from './config.js';
import { loadRoster } from './office-data.js';
import { authenticatedStudent } from './student-access.js';
import { hasStaffSession, readStaffAccount, readActiveStaffIdentity } from './staff-auth.js';
import {
  CLASS_CHAT_READ_KEY,
  CLASS_CHAT_HEAD_POS_KEY,
  actorReadKey,
  readChatReceipts,
  markClassRoomRead,
  getUnreadClassChatSummary,
  formatUnreadCountBn,
  isChatContainerVisible,
  mountClassChatHead
} from './class-chat-head.js';
export {
  CLASS_CHAT_READ_KEY,
  CLASS_CHAT_HEAD_POS_KEY,
  actorReadKey,
  readChatReceipts,
  markClassRoomRead,
  getUnreadClassChatSummary,
  formatUnreadCountBn,
  isChatContainerVisible,
  mountClassChatHead
};
export {
  CLASS_CHAT_RELAY_TTL_DAYS,
  CLASS_CHAT_RELAY_TTL_MS,
  CLASS_CHAT_RELAY_STATE_KEY,
  CLASS_CHAT_E2EE_ALGO,
  isEncryptedChatEnvelope,
  encryptChatPayload,
  decryptChatPayload,
  applyRelayCloudTransaction,
  mergeCloudRelayIntoLocal,
  syncClassChatRelayCycle
} from './class-chat-relay.js';

export const CLASS_CHAT_KEY = KEYS.classChat;
export const MAX_CHAT_MESSAGE_LENGTH = 1000;
export const QUICK_REACTIONS = Object.freeze(['👍', '❤️', '🎉', '🙏', '💡']);
export const STAFF_ROLE_BADGES = Object.freeze({
  teacher: 'শিক্ষক',
  manager: 'ম্যানেজার',
  admin: 'এডমিন'
});

export const CORE_CHAT_CLASSES = Object.freeze([
  'অষ্টম শ্রেণি',
  'নবম শ্রেণি',
  'দশম শ্রেণি',
  'একাদশ শ্রেণি',
  'দ্বাদশ শ্রেণি'
]);

const CLASS_SHORT_LABELS = Object.freeze({
  'অষ্টম শ্রেণি': 'অষ্টম',
  'নবম শ্রেণি': 'নবম',
  'দশম শ্রেণি': 'দশম',
  'একাদশ শ্রেণি': 'একাদশ',
  'দ্বাদশ শ্রেণি': 'দ্বাদশ'
});

const CLASS_ROOM_SLUGS = Object.freeze({
  'অষ্টম শ্রেণি': 'class_8',
  'নবম শ্রেণি': 'class_9',
  'দশম শ্রেণি': 'class_10',
  'একাদশ শ্রেণি': 'class_11',
  'দ্বাদশ শ্রেণি': 'class_12'
});

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const toBnDigits = value => String(value ?? '').replace(/\d/g, d => BN_DIGITS[Number(d)]);

function chatError(message, code = 'CHAT_ERROR') {
  return Object.assign(new Error(message), { code });
}

export function roomKeyForClass(className) {
  const classId = normalizeClassId(className);
  if (!classId) return '';
  if (CLASS_ROOM_SLUGS[classId]) return CLASS_ROOM_SLUGS[classId];
  let hash = 2166136261;
  for (let i = 0; i < classId.length; i += 1) {
    hash ^= classId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `class_c${hash.toString(36)}`;
}

export function shortClassTabLabel(className) {
  const classId = normalizeClassId(className);
  return CLASS_SHORT_LABELS[classId] || classId.replace(/\s*শ্রেণি$/, '') || classId;
}

function normalizeReactions(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const emoji of QUICK_REACTIONS) {
    const val = raw[emoji];
    const list = Array.isArray(val)
      ? val.map(v => String(v || '').trim()).filter(Boolean)
      : val && typeof val === 'object'
        ? Object.keys(val).filter(k => Boolean(val[k])).map(k => k.trim()).filter(Boolean)
        : [];
    const unique = [...new Set(list)];
    if (unique.length) out[emoji] = unique;
  }
  return out;
}

function normalizeMessage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const classId = normalizeClassId(raw.classId || raw.className || '');
  const roomKey = String(raw.roomKey || roomKeyForClass(classId)).trim();
  const id = String(raw.id || '').trim();
  if (!id || !classId || !roomKey) return null;
  const senderRole = ['teacher', 'manager', 'admin'].includes(raw.senderRole) ? raw.senderRole : 'student';
  const deleted = raw.deleted === true;
  const replyRaw = !deleted && raw.replyTo && typeof raw.replyTo === 'object' ? raw.replyTo : null;
  const replyTo = replyRaw && replyRaw.id ? {
    id: String(replyRaw.id),
    senderName: String(replyRaw.senderName || 'সদস্য').slice(0, 80),
    senderRole: ['teacher', 'manager', 'admin'].includes(replyRaw.senderRole) ? replyRaw.senderRole : 'student',
    senderBadge: String(replyRaw.senderBadge || STAFF_ROLE_BADGES[replyRaw.senderRole] || ''),
    text: String(replyRaw.text || '').slice(0, 160)
  } : null;
  const createdAt = String(raw.createdAt || new Date().toISOString());
  const updatedAt = Number(raw.updatedAt) || Date.parse(createdAt) || Date.now();
  return {
    id,
    roomKey,
    classId,
    senderId: String(raw.senderId || ''),
    senderName: String(raw.senderName || 'সদস্য').slice(0, 80),
    senderRole,
    senderBadge: senderRole === 'student' ? '' : (STAFF_ROLE_BADGES[senderRole] || String(raw.senderBadge || '')),
    text: deleted ? '' : String(raw.text || '').slice(0, MAX_CHAT_MESSAGE_LENGTH),
    replyTo,
    reactions: deleted ? {} : normalizeReactions(raw.reactions),
    deleted,
    deletedBy: deleted ? String(raw.deletedBy || '') : '',
    deletedById: deleted ? String(raw.deletedById || '') : '',
    deletedByRole: deleted ? String(raw.deletedByRole || '') : '',
    deletedAt: deleted ? String(raw.deletedAt || '') : '',
    createdAt,
    updatedAt
  };
}

function normalizeRoom(raw, fallbackClassId = '') {
  const classId = normalizeClassId(raw?.classId || fallbackClassId);
  const roomKey = String(raw?.roomKey || roomKeyForClass(classId)).trim();
  if (!classId || !roomKey) return null;
  /* Chat moderation was retired (owner request 2026-10-28): rooms no longer
     carry a lock, a pin or the moderator identity. Records written by an older
     build keep those fields on disk; they are ignored on read so a previously
     locked room opens as a normal room. */
  return {
    id: roomKey,
    roomKey,
    classId,
    updatedAt: Number(raw?.updatedAt) || 1
  };
}

export function readClassChatStore() {
  try {
    const raw = readRaw(CLASS_CHAT_KEY);
    if (!raw) return { version: 1, rooms: {}, messages: [], updatedAt: 0 };
    const parsed = JSON.parse(raw);
    const rooms = {};
    if (parsed && typeof parsed.rooms === 'object' && parsed.rooms) {
      for (const [key, value] of Object.entries(parsed.rooms)) {
        const room = normalizeRoom({ ...value, roomKey: value?.roomKey || key }, value?.classId || '');
        if (room) rooms[room.roomKey] = room;
      }
    }
    const rawList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.messages) ? parsed.messages : [];
    const seen = new Set();
    const messages = [];
    for (const item of rawList) {
      const msg = normalizeMessage(item);
      if (!msg || seen.has(msg.id)) continue;
      seen.add(msg.id);
      messages.push(msg);
    }
    messages.sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.id.localeCompare(b.id));
    return {
      version: 1,
      rooms,
      messages,
      updatedAt: Number(parsed?.updatedAt) || 0
    };
  } catch {
    return { version: 1, rooms: {}, messages: [], updatedAt: 0 };
  }
}

function writeClassChatStore(store, detail = {}) {
  const next = {
    version: 1,
    rooms: store.rooms || {},
    messages: store.messages || [],
    updatedAt: Date.now()
  };
  if (!writeJSON(CLASS_CHAT_KEY, next)) {
    throw chatError('চ্যাট তথ্য সংরক্ষণ করা যায়নি — ডিভাইস স্টোরেজ পরীক্ষা করুন।', 'STORAGE_WRITE_FAILED');
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('apc-class-chat-updated', { detail }));
  }
  return next;
}

export function normalizeChatActor(input) {
  if (!input || typeof input !== 'object') {
    throw chatError('লগইন সেশন পাওয়া যায়নি। অনুগ্রহ করে আবার লগইন করুন।', 'ACCESS_DENIED');
  }
  const role = String(input.role || (input.kind === 'staff' ? 'teacher' : 'student')).trim().toLowerCase();
  if (['teacher', 'manager', 'admin'].includes(role)) {
    const status = String(input.status || input.accountStatus || 'active').trim().toLowerCase();
    if (['inactive', 'suspended', 'rejected'].includes(status)) {
      throw chatError('নিষ্ক্রিয় স্টাফ অ্যাকাউন্ট থেকে চ্যাট ব্যবহার করা যাবে না।', 'ACCESS_DENIED');
    }
    const id = String(input.id || input.staffId || input.username || `${role}.apc`).trim();
    const fallbackName = STAFF_ROLE_BADGES[role] || 'স্টাফ';
    const name = String(input.name || input.fullName || fallbackName).trim() || fallbackName;
    return {
      kind: 'staff',
      role,
      id,
      name,
      badge: STAFF_ROLE_BADGES[role],
      classId: '',
      status: 'active'
    };
  }
  const id = String(input.id || input.studentId || '').trim();
  if (!id) {
    throw chatError('শিক্ষার্থী অ্যাকাউন্ট যাচাই করা যায়নি।', 'ACCESS_DENIED');
  }
  const roster = loadRoster();
  const rosterMatch = Array.isArray(roster) ? roster.find(row => String(row?.id || '') === id) : null;
  const rawStatus = String(input.status || rosterMatch?.status || '').trim().toLowerCase();
  if (rawStatus !== 'approved') {
    throw chatError('শুধুমাত্র অনুমোদিত (approved) শিক্ষার্থীরা শ্রেণি চ্যাটে প্রবেশ করতে পারবে।', 'STUDENT_NOT_APPROVED');
  }
  if (rosterMatch && String(rosterMatch.status || '').trim().toLowerCase() !== 'approved') {
    throw chatError('আপনার শিক্ষার্থী প্রোফাইল বর্তমানে অনুমোদিত নয়।', 'STUDENT_NOT_APPROVED');
  }
  const classId = normalizeClassId(input.className || input.classId || rosterMatch?.className || '');
  if (!classId) {
    throw chatError('শিক্ষার্থীর নির্ধারিত শ্রেণি পাওয়া যায়নি।', 'INVALID_STUDENT_CLASS');
  }
  const name = String(input.name || input.fullName || rosterMatch?.fullName || rosterMatch?.name || 'শিক্ষার্থী').trim() || 'শিক্ষার্থী';
  return {
    kind: 'student',
    role: 'student',
    id,
    name,
    badge: '',
    classId,
    status: 'approved'
  };
}

export async function resolvePortalChatActor(portal = 'student', fallbackProfile = null) {
  if (['teacher', 'manager', 'admin'].includes(portal)) {
    const allowed = await hasStaffSession(portal);
    if (!allowed) throw chatError('স্টাফ সেশন যাচাই করা যায়নি। আবার লগইন করুন।', 'ACCESS_DENIED');
    const activeId = readActiveStaffIdentity();
    const account = (fallbackProfile && typeof fallbackProfile === 'object') ? fallbackProfile : await readStaffAccount(portal);
    const matchesPortal = activeId && (activeId.role === portal || activeId.role === 'admin');
    const username = (matchesPortal && activeId?.username) || account?.username || `${portal}.apc`;
    const id = (matchesPortal && activeId?.staffId) || account?.staffId || username;
    const name = (matchesPortal && activeId?.fullName) || account?.fullName || STAFF_ROLE_BADGES[portal];
    return normalizeChatActor({
      kind: 'staff',
      role: portal,
      id,
      name,
      status: account?.status || 'active'
    });
  }
  const sessionStudent = await authenticatedStudent();
  const roster = loadRoster();
  const rosterRow = Array.isArray(roster) ? roster.find(r => String(r?.id || '') === String(sessionStudent.id)) : null;
  const mergedStatus = rosterRow?.status || fallbackProfile?.status || sessionStudent.status || 'approved';
  return normalizeChatActor({
    ...sessionStudent,
    ...(fallbackProfile && typeof fallbackProfile === 'object' ? fallbackProfile : {}),
    ...(rosterRow || {}),
    id: sessionStudent.id,
    role: 'student',
    status: mergedStatus
  });
}

export function assertRoomReadAccess(actorInput, targetClassName) {
  const actor = normalizeChatActor(actorInput);
  const classId = normalizeClassId(targetClassName);
  if (!classId) {
    throw chatError('সঠিক শ্রেণি নির্বাচন করুন।', 'INVALID_CLASS');
  }
  if (actor.kind === 'student' && actor.classId !== classId) {
    throw chatError('আপনি শুধুমাত্র নিজের শ্রেণির চ্যাট রুম দেখতে ও ব্যবহার করতে পারবেন।', 'CLASS_ACCESS_DENIED');
  }
  return { actor, classId, roomKey: roomKeyForClass(classId) };
}

export function sanitizeChatText(rawText) {
  const cleaned = String(rawText ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (!cleaned) {
    throw chatError('ফাঁকা বার্তা পাঠানো যাবে না।', 'EMPTY_MESSAGE');
  }
  if (cleaned.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw chatError(`বার্তাটি সর্বোচ্চ ${toBnDigits(MAX_CHAT_MESSAGE_LENGTH)} অক্ষরের মধ্যে হতে হবে।`, 'MESSAGE_TOO_LONG');
  }
  return cleaned;
}

export function listAvailableChatClasses() {
  const seen = new Set();
  const list = [];
  const push = raw => {
    const classId = normalizeClassId(raw);
    if (!classId || seen.has(classId)) return;
    seen.add(classId);
    list.push(classId);
  };
  CORE_CHAT_CLASSES.forEach(push);
  try { (enabledClasses() || []).forEach(push); } catch { /* optional */ }
  try { (loadRoster() || []).forEach(s => push(s?.className)); } catch { /* optional */ }
  const store = readClassChatStore();
  Object.values(store.rooms).forEach(r => push(r?.classId));
  store.messages.forEach(m => push(m?.classId));
  return list;
}

export function countActiveClassMembers(className) {
  const classId = normalizeClassId(className);
  if (!classId) return 0;
  const roster = loadRoster();
  const approvedIds = new Set();
  if (Array.isArray(roster)) {
    for (const student of roster) {
      if ((student?.status === 'approved' || student?.status === 'active') && normalizeClassId(student.className) === classId && student.id) {
        approvedIds.add(String(student.id));
      }
    }
  }
  const store = readClassChatStore();
  const roomKey = roomKeyForClass(classId);
  for (const msg of store.messages) {
    if (msg.roomKey === roomKey && msg.senderRole === 'student' && msg.senderId) {
      const inRoster = Array.isArray(roster) && roster.some(s => String(s?.id || '') === msg.senderId);
      if (!inRoster) approvedIds.add(msg.senderId);
    }
  }
  return approvedIds.size;
}

export function getClassRoomView(className, { actor: actorInput, search = '' } = {}) {
  const { actor, classId, roomKey } = assertRoomReadAccess(actorInput, className);
  const store = readClassChatStore();
  const roomMessages = store.messages.filter(m => m.roomKey === roomKey);
  const q = String(search || '').trim().toLowerCase();
  // `deleted` is a legacy flag only (moderation removal is gone); tombstones
  // written by an older build stay hidden from the conversation.
  const filteredMessages = q
    ? roomMessages.filter(m => !m.deleted && (
      m.text.toLowerCase().includes(q)
      || m.senderName.toLowerCase().includes(q)
      || (m.senderBadge && m.senderBadge.toLowerCase().includes(q))
    ))
    : roomMessages;
  return {
    classId,
    roomKey,
    title: `${classId} — আলোচনা কক্ষ`,
    messages: roomMessages,
    filteredMessages,
    activeMemberCount: countActiveClassMembers(classId),
    canSend: true,
    actor
  };
}

export function sendClassMessage({ className, text, replyToId = '', actor: actorInput } = {}) {
  const { actor, classId, roomKey } = assertRoomReadAccess(actorInput, className);
  const store = readClassChatStore();
  const room = store.rooms[roomKey] || normalizeRoom({ roomKey, classId }, classId);
  const cleanText = sanitizeChatText(text);
  let replyTo = null;
  const cleanReplyId = String(replyToId || '').trim();
  if (cleanReplyId) {
    const target = store.messages.find(m => m.roomKey === roomKey && m.id === cleanReplyId && !m.deleted);
    if (target) {
      replyTo = {
        id: target.id,
        senderName: target.senderName,
        senderRole: target.senderRole,
        senderBadge: target.senderBadge || '',
        text: target.text.slice(0, 160)
      };
    }
  }
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const message = normalizeMessage({
    id: newId('MSG'),
    roomKey,
    classId,
    senderId: actor.id,
    senderName: actor.name,
    senderRole: actor.role,
    senderBadge: actor.badge || '',
    text: cleanText,
    replyTo,
    reactions: {},
    deleted: false,
    createdAt: nowIso,
    updatedAt: nowMs
  });
  store.rooms[roomKey] = { ...room, classId, roomKey };
  store.messages.push(message);
  writeClassChatStore(store, { action: 'send', classId, roomKey, messageId: message.id });
  return message;
}

export function toggleMessageReaction({ className, messageId, emoji, actor: actorInput } = {}) {
  const { actor, classId, roomKey } = assertRoomReadAccess(actorInput, className);
  if (!QUICK_REACTIONS.includes(emoji)) {
    throw chatError('অনুমোদিত ইমোজি প্রতিক্রিয়া নির্বাচন করুন।', 'INVALID_REACTION');
  }
  const store = readClassChatStore();
  const idx = store.messages.findIndex(m => m.roomKey === roomKey && m.id === String(messageId || ''));
  if (idx < 0) throw chatError('বার্তাটি পাওয়া যায়নি।', 'MESSAGE_NOT_FOUND');
  const current = store.messages[idx];
  if (current.deleted) throw chatError('মুছে ফেলা বার্তায় প্রতিক্রিয়া দেওয়া যাবে না।', 'MESSAGE_DELETED');
  const reactions = normalizeReactions(current.reactions);
  const existing = new Set(reactions[emoji] || []);
  const added = !existing.has(actor.id);
  if (added) existing.add(actor.id);
  else existing.delete(actor.id);
  if (existing.size) reactions[emoji] = [...existing];
  else delete reactions[emoji];
  const updated = {
    ...current,
    reactions,
    updatedAt: Date.now()
  };
  store.messages[idx] = updated;
  writeClassChatStore(store, { action: 'react', classId, roomKey, messageId: updated.id, emoji, added });
  return updated;
}

/* ---------- Message deletion (WhatsApp-style soft delete) -------------------
   Owner request 2026-11-01: a sender may remove their own message and staff
   (admin / teacher / manager) may remove anyone's. A Student can never remove
   somebody else's message. Deletion is a TOMBSTONE, never a purge: the record
   stays with `deleted: true`, empty text, no reactions and the moderator's
   identity, so replies/reactions can no longer target it and the feed keeps
   showing "বার্তাটি মুছে ফেলা হয়েছে" in place of the original text. */
const MODERATOR_ROLES = Object.freeze(['admin', 'teacher', 'manager']);

export function canDeleteClassMessage(actorInput, message) {
  try {
    if (!message || message.deleted) return false;
    const actor = normalizeChatActor(actorInput);
    if (MODERATOR_ROLES.includes(actor.role)) return true;
    return Boolean(message.senderId && actor.id && message.senderId === actor.id);
  } catch {
    return false;
  }
}

export function deleteClassMessage({ className, messageId, actor: actorInput } = {}) {
  const { actor, classId, roomKey } = assertRoomReadAccess(actorInput, className);
  const cleanId = String(messageId || '').trim();
  if (!cleanId) throw chatError('কোন বার্তা মুছবেন তা নির্বাচন করুন।', 'MESSAGE_NOT_FOUND');
  const store = readClassChatStore();
  const idx = store.messages.findIndex(m => m.roomKey === roomKey && m.id === cleanId);
  if (idx < 0) throw chatError('বার্তাটি পাওয়া যায়নি।', 'MESSAGE_NOT_FOUND');
  const current = store.messages[idx];
  if (current.deleted) return current;                      // already a tombstone: idempotent
  if (!canDeleteClassMessage(actor, current)) {
    throw chatError('শুধু নিজের বার্তা মুছতে পারবেন; অন্য কারও বার্তা মুছতে স্টাফ অনুমতি লাগবে।', 'FORBIDDEN');
  }
  const deleted = normalizeMessage({
    ...current,
    text: '',
    replyTo: null,
    reactions: {},
    deleted: true,
    deletedBy: actor.name || '',
    deletedById: actor.id || '',
    deletedByRole: MODERATOR_ROLES.includes(actor.role) ? actor.role : 'student',
    deletedAt: new Date().toISOString(),
    updatedAt: Date.now()
  });
  store.messages[idx] = deleted;
  writeClassChatStore(store, { action: 'delete', classId, roomKey, messageId: deleted.id });
  return deleted;
}

function avatarInitial(name) {
  const clean = String(name || '').trim();
  if (!clean) return 'স';
  const chars = Array.from(clean);
  return chars[0] || 'স';
}

function dayBucketKey(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'unknown';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function formatChatDateDivider(isoString, now = new Date()) {
  const targetKey = dayBucketKey(isoString);
  const todayKey = dayBucketKey(now.toISOString());
  const yesterday = new Date(now.getTime() - 86400000);
  const yesterdayKey = dayBucketKey(yesterday.toISOString());
  if (targetKey === todayKey) return 'আজ';
  if (targetKey === yesterdayKey) return 'গতকাল';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('bn-BD', {
      timeZone: 'Asia/Dhaka',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(date);
  } catch {
    return escapeHtml(targetKey);
  }
}

export function formatChatTimestamp(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('bn-BD', {
      timeZone: 'Asia/Dhaka',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  } catch {
    return toBnDigits(date.toTimeString().slice(0, 5));
  }
}

/* Pure inline vector glyphs (zero <img>/<image> inside [data-chat-feed]). */
const WA_SVGS = Object.freeze({
  back: '<svg class="wa-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  group: '<svg class="wa-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  search: '<svg class="wa-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  doubleTick: '<svg class="wa-tick-svg" viewBox="0 0 16 11" aria-hidden="true"><path d="M11.07.66 4.88 6.85 2.2 4.17.93 5.44l3.95 3.95 7.46-7.46L11.07.66zm3.99 0L8.87 6.85l-.93-.93-1.27 1.27 2.2 2.2 7.46-7.46-1.27-1.27z" fill="currentColor" stroke="none"/></svg>',
  chevronDown: '<svg class="wa-chevron-svg" viewBox="0 0 18 18" aria-hidden="true"><path d="m4.5 6.75 4.5 4.5 4.5-4.5"/></svg>',
  ban: '<svg class="wa-ban-svg" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7"/><path d="m4.1 4.1 9.8 9.8"/></svg>',
  smile: '<svg class="wa-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/><circle cx="9" cy="9.8" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="9.8" r="1.1" fill="currentColor" stroke="none"/></svg>',
  send: '<svg class="wa-send-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4 20.85 12 3.4 3.6l-.01 6.51L15 12 3.39 13.88l.01 6.52z" fill="currentColor" stroke="none"/></svg>',
  reply: '<svg class="wa-reply-svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 5.5 4 10l4.5 4.5M4.5 10H12a4 4 0 0 1 4 4v1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chatEmpty: '<svg class="wa-empty-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  e2eeLock: '<svg class="wa-e2ee-svg" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.6"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>'
});

const COMPOSER_EMOJIS = Object.freeze(['😊', '👍', '❤️', '🙏', '🎉', '💡', '🔥', '✅', '📚', '✍️', '🤔', '👏']);

function senderTone(role, senderId, senderName) {
  if (role === 'teacher' || role === 'manager' || role === 'admin') return role;
  const seed = String(senderId || senderName || 'student');
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return String((Math.abs(hash) % 5) + 1);
}

export function renderMessageBubbleHtml(msg, actorInput, { groupedWithPrev = false, isJustSent = false } = {}) {
  const actor = normalizeChatActor(actorInput);
  const isMine = msg.senderId === actor.id && msg.senderRole === actor.role;
  const isStaffSender = ['teacher', 'manager', 'admin'].includes(msg.senderRole);
  const roleBadgeText = isStaffSender ? (STAFF_ROLE_BADGES[msg.senderRole] || msg.senderBadge || '') : '';
  const timeLabel = formatChatTimestamp(msg.createdAt);
  const tone = senderTone(msg.senderRole, msg.senderId, msg.senderName);
  const groupClass = groupedWithPrev ? 'is-grouped' : 'is-first-in-group';

  if (msg.deleted) {
    const deletedMeta = msg.deletedByRole && STAFF_ROLE_BADGES[msg.deletedByRole]
      ? ` (${escapeHtml(STAFF_ROLE_BADGES[msg.deletedByRole])} কর্তৃক অপসারিত)`
      : '';
    return `<article class="chat-row ${isMine ? 'is-mine' : 'is-other'} ${groupClass} is-deleted" data-chat-msg-id="${escapeHtml(msg.id)}" data-sender-tone="${escapeHtml(tone)}">
      ${isMine ? '' : `<div class="chat-avatar" data-sender-tone="${escapeHtml(tone)}" aria-hidden="true">${escapeHtml(avatarInitial(msg.senderName))}</div>`}
      <div class="chat-bubble-wrap">
        <div class="chat-bubble is-deleted-bubble">
          <div class="chat-bubble-body">
            <p class="chat-deleted-copy">${WA_SVGS.ban}<span>বার্তাটি মুছে ফেলা হয়েছে${deletedMeta}</span></p>
            <span class="chat-inline-meta"><time class="chat-time" datetime="${escapeHtml(msg.createdAt)}">${escapeHtml(timeLabel)}</time></span>
          </div>
        </div>
      </div>
    </article>`;
  }

  const badgeHtml = roleBadgeText
    ? `<span class="chat-role-badge is-${escapeHtml(msg.senderRole)}">${escapeHtml(roleBadgeText)}</span>`
    : '';

  const replyTone = msg.replyTo ? senderTone(msg.replyTo.senderRole, '', msg.replyTo.senderName) : '1';
  const replyHtml = msg.replyTo
    ? `<button type="button" class="chat-reply-quote" data-chat-action="jump-msg" data-target-msg-id="${escapeHtml(msg.replyTo.id)}" data-sender-tone="${escapeHtml(replyTone)}">
        <span class="chat-reply-quote-author" data-sender-tone="${escapeHtml(replyTone)}">${escapeHtml(msg.replyTo.senderName)}${msg.replyTo.senderBadge ? ` • ${escapeHtml(msg.replyTo.senderBadge)}` : ''}</span>
        <span class="chat-reply-quote-text">${escapeHtml(msg.replyTo.text)}</span>
      </button>`
    : '';

  const reactionPickerBtns = QUICK_REACTIONS.map(emoji => {
    const users = Array.isArray(msg.reactions?.[emoji]) ? msg.reactions[emoji] : [];
    const active = users.includes(actor.id);
    return `<button type="button" class="chat-reaction-btn${users.length ? ' has-count' : ''}${active ? ' is-reacted' : ''}" data-chat-action="react" data-msg-id="${escapeHtml(msg.id)}" data-emoji="${escapeHtml(emoji)}" aria-pressed="${active ? 'true' : 'false'}" title="${escapeHtml(emoji)} প্রতিক্রিয়া">
      <span aria-hidden="true">${escapeHtml(emoji)}</span>${users.length ? `<span class="chat-reaction-count">${toBnDigits(users.length)}</span>` : ''}
    </button>`;
  }).join('');

  const activeReactionPills = QUICK_REACTIONS.map(emoji => {
    const users = Array.isArray(msg.reactions?.[emoji]) ? msg.reactions[emoji] : [];
    if (!users.length) return '';
    const active = users.includes(actor.id);
    return `<button type="button" class="chat-reaction-pill${active ? ' is-reacted' : ''}" data-chat-action="react" data-msg-id="${escapeHtml(msg.id)}" data-emoji="${escapeHtml(emoji)}" aria-pressed="${active ? 'true' : 'false'}" title="${escapeHtml(emoji)} প্রতিক্রিয়া">
      <span aria-hidden="true">${escapeHtml(emoji)}</span><span class="chat-reaction-count">${toBnDigits(users.length)}</span>
    </button>`;
  }).filter(Boolean).join('');

  /* Pin / room-lock stay retired (owner request 2026-10-28). Message deletion
     came back on 2026-11-01 as a soft delete: a sender may remove their own
     message and staff may remove anyone's, so the tray grows a "মুছুন" tool
     only for the roles allowed to use it. */
  const canDelete = canDeleteClassMessage(actor, msg);
  const deleteToolHtml = canDelete
    ? `<button type="button" class="chat-msg-tool is-danger" data-chat-action="delete" data-msg-id="${escapeHtml(msg.id)}" aria-label="বার্তাটি মুছুন">মুছুন</button>`
    : '';
  const showHeader = !isMine && !groupedWithPrev;

  return `<article class="chat-row ${isMine ? 'is-mine' : 'is-other'} ${groupClass}${isStaffSender ? ' is-staff' : ''}${activeReactionPills ? ' has-reactions' : ''}${isJustSent ? ' is-just-sent' : ''}" data-chat-msg-id="${escapeHtml(msg.id)}" data-sender-tone="${escapeHtml(tone)}">
    ${isMine ? '' : `<div class="chat-avatar is-${escapeHtml(msg.senderRole)}" data-sender-tone="${escapeHtml(tone)}" aria-hidden="true">${escapeHtml(avatarInitial(msg.senderName))}</div>`}
    <div class="chat-bubble-wrap">
      <div class="chat-bubble">
        <button type="button" class="chat-menu-trigger" data-chat-action="toggle-menu" data-msg-id="${escapeHtml(msg.id)}" aria-label="বার্তার অপশন">${WA_SVGS.chevronDown}</button>
        <header class="chat-bubble-meta${showHeader ? '' : ' is-compact-hidden'}">
          ${!isMine ? `<strong class="chat-sender-name" data-sender-tone="${escapeHtml(tone)}">${escapeHtml(msg.senderName)}</strong>${badgeHtml}` : ''}
        </header>
        ${replyHtml}
        <div class="chat-bubble-body">
          <div class="chat-bubble-text">${escapeHtml(msg.text)}</div>
          <span class="chat-inline-meta">
            <time class="chat-time" datetime="${escapeHtml(msg.createdAt)}">${escapeHtml(timeLabel)}</time>
            ${isMine ? `<span class="chat-read-ticks" data-chat-status="sent" title="পাঠানো হয়েছে" aria-label="পাঠানো হয়েছে">${WA_SVGS.doubleTick}</span>` : ''}
          </span>
        </div>
        <div class="chat-hover-tray">
          <div class="chat-reactions-bar" role="group" aria-label="প্রতিক্রিয়া">${reactionPickerBtns}</div>
          <div class="chat-msg-tools">
            <button type="button" class="chat-msg-tool" data-chat-action="reply" data-msg-id="${escapeHtml(msg.id)}">উত্তর দিন</button>
            ${deleteToolHtml}
          </div>
        </div>
      </div>
      ${activeReactionPills ? `<div class="chat-active-reactions" role="group" aria-label="সক্রিয় প্রতিক্রিয়া">${activeReactionPills}</div>` : ''}
    </div>
    <button type="button" class="chat-quick-reply-btn" data-chat-action="reply" data-msg-id="${escapeHtml(msg.id)}" aria-label="উত্তর দিন" title="উত্তর দিন">${WA_SVGS.reply}</button>
  </article>`;
}

/* ---------- Authentic WhatsApp Group-Chat Portal Widget ---------- */

export function mountClassChat(target, options = {}) {
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) return null;
  if (root.__apcClassChatInstance) {
    const pendingCls = typeof window !== 'undefined' ? normalizeClassId(window.__apcPendingChatClass || '') : '';
    if (pendingCls) {
      window.__apcPendingChatClass = '';
      try { root.__apcClassChatInstance.selectClass(pendingCls); } catch { /* ignore */ }
    }
    void root.__apcClassChatInstance.refresh();
    return root.__apcClassChatInstance;
  }

  const portal = ['teacher', 'manager', 'admin'].includes(options.portal) ? options.portal : 'student';
  const hostView = root.closest('.view, .teacher-view, .manager-view, .admin-view');
  const hostShell = root.closest('.app-shell, .admin-shell');
  const hostHeroEl = hostView?.querySelector(':scope > .page-intro') || null;
  const hasPortalBack = Boolean(hostView?.querySelector('.pay-back') || hostView);
  const pendingInitialClass = (!options.initialClass && typeof window !== 'undefined' && portal !== 'student')
    ? normalizeClassId(window.__apcPendingChatClass || '')
    : '';
  if (pendingInitialClass && typeof window !== 'undefined') window.__apcPendingChatClass = '';
  let suppressOwnEvent = false;
  const state = {
    actor: null,
    selectedClass: normalizeClassId(options.initialClass || options.defaultClass || pendingInitialClass || '') || CORE_CHAT_CLASSES[2],
    search: '',
    searchOpen: false,
    emojiOpen: false,
    openMenuMsgId: '',
    pendingDeleteId: '',
    replyTo: null,
    error: '',
    highlightedId: '',
    justSentId: '',
    sending: false,
    scrollPositions: new Map(),
    destroyed: false
  };

  const emojiStripHtml = COMPOSER_EMOJIS.map(emoji =>
    `<button type="button" class="class-chat-emoji-item" data-chat-action="insert-emoji" data-emoji="${escapeHtml(emoji)}" aria-label="${escapeHtml(emoji)} যোগ করুন">${escapeHtml(emoji)}</button>`
  ).join('');

  root.innerHTML = `
    <div class="class-chat-shell is-whatsapp-ui" data-chat-portal="${escapeHtml(portal)}">
      <header class="class-chat-header">
        <div class="class-chat-topbar">
          <button type="button" class="class-chat-back-btn" data-chat-action="go-back" aria-label="পিছনে যান" ${hasPortalBack ? '' : 'hidden'}>${WA_SVGS.back}</button>
          <span class="class-chat-room-icon" aria-hidden="true">${WA_SVGS.group}</span>
          <div class="class-chat-room-copy">
            <h2 class="class-chat-room-title" data-chat-room-title>শ্রেণি চ্যাট</h2>
            <p class="class-chat-room-sub">
              <span data-chat-member-count>সক্রিয় সদস্য: ০ জন</span>
              <span class="class-chat-sub-sep" aria-hidden="true">•</span>
              <span class="class-chat-e2ee-pill" data-chat-e2ee-badge title="বার্তা এই ডিভাইসে স্থায়ীভাবে সেভ থাকে এবং AES-256-GCM এনক্রিপ্টেড ফায়ারবেস রিলে ৭ দিন পর স্বয়ংক্রিয়ভাবে মুছে যায়">🔐 এনক্রিপ্টেড রিলে (৭ দিন)</span>
            </p>
          </div>
          <div class="class-chat-header-actions">
            <button type="button" class="class-chat-icon-btn" data-chat-action="toggle-search" aria-label="বার্তা খুঁজুন" aria-expanded="false" title="বার্তা খুঁজুন">${WA_SVGS.search}</button>
          </div>
        </div>

        <div class="class-chat-switcher-wrap" data-chat-switcher-wrap ${portal === 'student' ? 'hidden' : ''}>
          <div class="class-chat-tabs" role="tablist" aria-label="শ্রেণি নির্বাচন ট্যাব" data-chat-class-tabs></div>
          <label class="class-chat-select-label">
            <span class="sr-only">শ্রেণি নির্বাচন</span>
            <select class="class-chat-select" data-chat-class-select aria-label="শ্রেণি নির্বাচন করুন"></select>
          </label>
        </div>

        <div class="class-chat-search-drawer${portal !== 'student' ? ' is-staff-toolbar' : ''}" data-chat-search-drawer>
          <div class="class-chat-search-box">
            <span class="class-chat-search-icon" aria-hidden="true">${WA_SVGS.search}</span>
            <input type="search" class="class-chat-search-input" data-chat-search placeholder="বার্তা খুঁজুন…" autocomplete="off" aria-label="চ্যাটে বার্তা খুঁজুন">
            <button type="button" class="class-chat-search-clear" data-chat-action="clear-search" aria-label="খোঁজা মুছুন" hidden>×</button>
          </div>
        </div>
      </header>

      <div class="class-chat-access-gate" data-chat-access-gate role="status" hidden></div>

      <div class="class-chat-feed" data-chat-feed role="log" aria-live="polite" aria-label="শ্রেণি আলোচনা বার্তা তালিকা"></div>

      <p class="class-chat-error" data-chat-error role="alert" hidden></p>

      <div class="class-chat-confirm" data-chat-delete-confirm role="dialog" aria-labelledby="classChatDeleteTitle" hidden>
        <div class="class-chat-confirm-card">
          <h3 class="class-chat-confirm-title" id="classChatDeleteTitle">এই বার্তাটি মুছবেন?</h3>
          <p class="class-chat-confirm-copy" data-chat-delete-preview></p>
          <p class="class-chat-confirm-note">বার্তাটি সবার কাছ থেকে সরে যাবে — জায়গায় “বার্তাটি মুছে ফেলা হয়েছে” দেখাবে।</p>
          <div class="class-chat-confirm-actions">
            <button type="button" class="class-chat-confirm-cancel" data-chat-action="cancel-delete">বাতিল</button>
            <button type="button" class="class-chat-confirm-ok" data-chat-action="confirm-delete">হ্যাঁ, মুছুন</button>
          </div>
        </div>
      </div>

      <footer class="class-chat-composer-wrap" data-chat-composer-wrap>
        <div class="class-chat-search-results" data-chat-search-results role="region" aria-label="খোঁজার ফলাফল" hidden></div>
        <div class="class-chat-reply-bar" data-chat-reply-bar hidden></div>
        <div class="class-chat-emoji-drawer" data-chat-emoji-drawer hidden role="toolbar" aria-label="দ্রুত ইমোজি">${emojiStripHtml}</div>
        <form class="class-chat-composer" data-chat-composer-form novalidate>
          <div class="class-chat-input-pill">
            <button type="button" class="class-chat-emoji-btn" data-chat-action="toggle-emoji" aria-label="ইমোজি যোগ করুন" aria-expanded="false">${WA_SVGS.smile}</button>
            <textarea class="class-chat-input" data-chat-input rows="1" maxlength="${MAX_CHAT_MESSAGE_LENGTH}" placeholder="বার্তা লিখুন… (পাঠাতে Enter, নতুন লাইন Shift+Enter)" aria-label="বার্তা লিখুন"></textarea>
            <small class="class-chat-char-count" data-chat-char-count>০/${toBnDigits(MAX_CHAT_MESSAGE_LENGTH)}</small>
          </div>
          <button type="button" class="class-chat-send-btn" data-chat-action="send" aria-label="বার্তা পাঠান" title="বার্তা পাঠান" disabled><span class="class-chat-send-label">পাঠান</span>${WA_SVGS.send}</button>
        </form>
      </footer>
    </div>
  `;

  const el = selector => root.querySelector(selector);
  const shellEl = el('.class-chat-shell');
  const switcherWrap = el('[data-chat-switcher-wrap]');
  const classTabsEl = el('[data-chat-class-tabs]');
  const classSelectEl = el('[data-chat-class-select]');
  const titleEl = el('[data-chat-room-title]');
  const memberCountEl = el('[data-chat-member-count]');
  const searchToggleBtn = el('[data-chat-action="toggle-search"]');
  const searchInput = el('[data-chat-search]');
  const searchClearBtn = el('[data-chat-action="clear-search"]');
  const searchResultsEl = el('[data-chat-search-results]');
  const accessGateEl = el('[data-chat-access-gate]');
  const feedEl = el('[data-chat-feed]');
  const replyBarEl = el('[data-chat-reply-bar]');
  const emojiDrawerEl = el('[data-chat-emoji-drawer]');
  const emojiToggleBtn = el('[data-chat-action="toggle-emoji"]');
  const errorEl = el('[data-chat-error]');
  const composerWrapEl = el('[data-chat-composer-wrap]');
  const composerFormEl = el('[data-chat-composer-form]');
  const inputEl = el('[data-chat-input]');
  const charCountEl = el('[data-chat-char-count]');
  const sendBtnEl = el('[data-chat-action="send"]');
  const deleteConfirmEl = el('[data-chat-delete-confirm]');
  const deletePreviewEl = el('[data-chat-delete-preview]');

  function syncHostHeroCollapse(collapsed) {
    if (!hostHeroEl) return;
    hostHeroEl.classList.toggle('is-chat-hero-collapsed', Boolean(collapsed));
  }

  function syncComposerSendState() {
    if (!sendBtnEl || !inputEl) return;
    const trimmed = String(inputEl.value || '').trim();
    const canSendNow = Boolean(!inputEl.disabled && !state.sending && trimmed.length > 0 && inputEl.value.length <= MAX_CHAT_MESSAGE_LENGTH);
    sendBtnEl.disabled = !canSendNow;
    sendBtnEl.classList.toggle('is-ready', canSendNow);
  }

  function syncSearchDrawerUi() {
    const open = Boolean(state.searchOpen || state.search);
    shellEl?.classList.toggle('is-search-open', open);
    searchToggleBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function syncEmojiDrawerUi() {
    if (emojiDrawerEl) emojiDrawerEl.hidden = !state.emojiOpen;
    emojiToggleBtn?.setAttribute('aria-expanded', state.emojiOpen ? 'true' : 'false');
  }

  function renderDeleteConfirm() {
    if (!deleteConfirmEl) return;
    const pendingId = state.pendingDeleteId;
    if (!pendingId) {
      deleteConfirmEl.hidden = true;
      if (deletePreviewEl) deletePreviewEl.textContent = '';
      return;
    }
    const row = feedEl
      ? Array.from(feedEl.querySelectorAll('[data-chat-msg-id]')).find(node => node.dataset.chatMsgId === pendingId)
      : null;
    const snippet = String(row?.querySelector('.chat-bubble-text')?.textContent || '').replace(/\s+/g, ' ').slice(0, 90);
    if (deletePreviewEl) {
      deletePreviewEl.textContent = snippet ? `“${snippet}${snippet.length >= 90 ? '…' : ''}”` : '';
      deletePreviewEl.hidden = !snippet;
    }
    deleteConfirmEl.hidden = false;
    deleteConfirmEl.querySelector('[data-chat-action="confirm-delete"]')?.focus?.();
  }

  function syncOpenMenuRow() {
    if (!feedEl) return;
    for (const row of feedEl.querySelectorAll('.chat-row.is-menu-open')) {
      if (row.dataset.chatMsgId !== state.openMenuMsgId) row.classList.remove('is-menu-open');
    }
    if (state.openMenuMsgId) {
      const targetRow = Array.from(feedEl.querySelectorAll('[data-chat-msg-id]'))
        .find(node => node.dataset.chatMsgId === state.openMenuMsgId);
      targetRow?.classList.add('is-menu-open');
    }
  }

  function showError(msg = '') {
    state.error = msg;
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  }

  function autoResizeInput() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    const nextHeight = Math.min(Math.max(inputEl.scrollHeight || 24, 24), 116);
    inputEl.style.height = `${nextHeight}px`;
    if (charCountEl) {
      const len = inputEl.value.length;
      charCountEl.textContent = `${toBnDigits(len)}/${toBnDigits(MAX_CHAT_MESSAGE_LENGTH)}`;
      charCountEl.classList.toggle('is-visible', len > 0);
      charCountEl.classList.toggle('is-near-limit', len >= MAX_CHAT_MESSAGE_LENGTH - 80);
    }
    syncComposerSendState();
  }

  async function resolveCurrentActor() {
    if (typeof options.getActor === 'function') {
      const custom = await options.getActor();
      if (custom) return normalizeChatActor(custom);
    }
    const profileHint = typeof options.getStudent === 'function'
      ? options.getStudent()
      : typeof options.getStaff === 'function'
        ? await options.getStaff()
        : null;
    return resolvePortalChatActor(portal, profileHint);
  }

  function saveCurrentRoomScroll() {
    if (!feedEl || !state.selectedClass) return;
    const rk = roomKeyForClass(state.selectedClass);
    if (!rk) return;
    const distance = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight;
    state.scrollPositions.set(rk, {
      scrollTop: feedEl.scrollTop,
      atBottom: distance < 56
    });
  }

  function restoreOrScrollFeed(roomKey, force = false) {
    if (!feedEl) return;
    if (force) {
      feedEl.scrollTop = feedEl.scrollHeight;
      if (roomKey) state.scrollPositions.set(roomKey, { scrollTop: feedEl.scrollTop, atBottom: true });
      return;
    }
    const saved = roomKey ? state.scrollPositions.get(roomKey) : null;
    if (saved) {
      if (saved.atBottom) {
        feedEl.scrollTop = feedEl.scrollHeight;
      } else {
        feedEl.scrollTop = saved.scrollTop;
      }
      return;
    }
    feedEl.scrollTop = feedEl.scrollHeight;
    if (roomKey) state.scrollPositions.set(roomKey, { scrollTop: feedEl.scrollTop, atBottom: true });
  }

  function renderSearchResultsBar(view) {
    if (!searchResultsEl) return;
    const q = String(state.search || '').trim();
    if (!q) {
      searchResultsEl.hidden = true;
      searchResultsEl.innerHTML = '';
      return;
    }
    const matches = Array.isArray(view?.filteredMessages) ? view.filteredMessages : [];
    const previewItems = matches.slice(-8).reverse().map(msg => {
      const timeLabel = formatChatTimestamp(msg.createdAt);
      const snippet = String(msg.text || '').replace(/\s+/g, ' ').slice(0, 72);
      return `<button type="button" class="class-chat-search-hit" data-chat-action="jump-msg" data-target-msg-id="${escapeHtml(msg.id)}">
        <span class="class-chat-search-hit-meta"><strong>${escapeHtml(msg.senderName)}</strong><time datetime="${escapeHtml(msg.createdAt)}">${escapeHtml(timeLabel)}</time></span>
        <span class="class-chat-search-hit-text">${escapeHtml(snippet)}</span>
      </button>`;
    }).join('');
    searchResultsEl.hidden = false;
    searchResultsEl.innerHTML = `
      <div class="class-chat-search-results-head">
        <span>“${escapeHtml(q)}” — ${toBnDigits(matches.length)}টি ফলাফল</span>
        <button type="button" class="class-chat-search-results-close" data-chat-action="clear-search" aria-label="খোঁজা বন্ধ করুন">বন্ধ করুন ×</button>
      </div>
      ${matches.length ? `<div class="class-chat-search-results-list">${previewItems}</div>` : ''}
    `;
  }

  function highlightMessage(messageId) {
    if (!messageId || !feedEl) return;
    if (state.search) {
      state.search = '';
      state.searchOpen = false;
      if (searchInput) searchInput.value = '';
      if (searchClearBtn) searchClearBtn.hidden = true;
      syncSearchDrawerUi();
      paintLoaded(false);
    }
    const row = Array.from(feedEl.querySelectorAll('[data-chat-msg-id]'))
      .find(node => node.dataset.chatMsgId === String(messageId));
    if (!row) return;
    row.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    row.classList.remove('is-highlighted');
    void row.offsetWidth;
    row.classList.add('is-highlighted');
    clearTimeout(highlightMessage.timer);
    highlightMessage.timer = setTimeout(() => row.classList.remove('is-highlighted'), 1800);
  }

  function renderReplyBar() {
    if (!replyBarEl) return;
    if (!state.replyTo) {
      replyBarEl.hidden = true;
      replyBarEl.innerHTML = '';
      shellEl?.classList.remove('has-reply-draft');
      return;
    }
    replyBarEl.hidden = false;
    shellEl?.classList.add('has-reply-draft');
    const tone = senderTone(state.replyTo.senderRole || 'student', state.replyTo.senderId || '', state.replyTo.senderName);
    replyBarEl.innerHTML = `
      <div class="class-chat-reply-preview" data-sender-tone="${escapeHtml(tone)}">
        <div class="class-chat-reply-copy">
          <strong data-sender-tone="${escapeHtml(tone)}">${escapeHtml(state.replyTo.senderName)}</strong>
          <span>${escapeHtml(state.replyTo.text)}</span>
        </div>
        <button type="button" class="class-chat-reply-cancel" data-chat-action="cancel-reply" aria-label="উত্তর বাতিল করুন">×</button>
      </div>
    `;
  }

  function renderStaffClassSwitcher(classes, activeClassId) {
    if (portal === 'student' || !switcherWrap) {
      if (switcherWrap) switcherWrap.hidden = true;
      return;
    }
    switcherWrap.hidden = false;
    const store = readClassChatStore();
    const unreadSummary = state.actor ? getUnreadClassChatSummary(state.actor) : { byClass: {} };
    if (classTabsEl) {
      classTabsEl.innerHTML = classes.map(cls => {
        const active = cls === activeClassId;
        const rk = roomKeyForClass(cls);
        const count = store.messages.filter(m => m.roomKey === rk && !m.deleted).length;
        const unreadCount = !active ? (unreadSummary.byClass?.[cls] || 0) : 0;
        return `<button type="button" role="tab" class="class-chat-tab${active ? ' is-active' : ''}${unreadCount ? ' has-unread' : ''}" data-chat-select-class="${escapeHtml(cls)}" aria-selected="${active ? 'true' : 'false'}">
          ${active ? '<span class="class-chat-tab-dot" aria-hidden="true"></span>' : ''}
          <span>${escapeHtml(shortClassTabLabel(cls))}</span>
          ${unreadCount ? `<span class="class-chat-tab-unread" data-chat-tab-unread>${formatUnreadCountBn(unreadCount)}</span>` : (count ? `<span class="class-chat-tab-count">${toBnDigits(count)}</span>` : '')}
        </button>`;
      }).join('');
      const activeChip = classTabsEl.querySelector('.class-chat-tab.is-active');
      activeChip?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    if (classSelectEl) {
      classSelectEl.innerHTML = classes.map(cls => {
        const unreadCount = cls !== activeClassId ? (unreadSummary.byClass?.[cls] || 0) : 0;
        const label = unreadCount ? `${cls} (${formatUnreadCountBn(unreadCount)} নতুন)` : cls;
        return `<option value="${escapeHtml(cls)}"${cls === activeClassId ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('');
      classSelectEl.value = activeClassId;
    }
  }

  function paintGateMessage(message) {
    if (accessGateEl) {
      accessGateEl.hidden = false;
      accessGateEl.textContent = message;
    }
    if (feedEl) feedEl.hidden = true;
    if (composerWrapEl) composerWrapEl.hidden = true;
  }

  function paintLoaded(forceBottom = false) {
    if (!state.actor) return;
    const classes = listAvailableChatClasses();
    if (state.actor.kind === 'staff' && typeof window !== 'undefined' && window.__apcPendingChatClass) {
      const targetCls = normalizeClassId(window.__apcPendingChatClass);
      window.__apcPendingChatClass = '';
      if (targetCls && classes.includes(targetCls)) state.selectedClass = targetCls;
    }
    const activeClass = state.actor.kind === 'student'
      ? state.actor.classId
      : (classes.includes(state.selectedClass) ? state.selectedClass : (classes[0] || CORE_CHAT_CLASSES[2]));
    state.selectedClass = activeClass;

    if (isChatContainerVisible(root)) {
      markClassRoomRead(state.actor, activeClass);
    }

    renderStaffClassSwitcher(classes, activeClass);
    syncSearchDrawerUi();

    let view;
    try {
      view = getClassRoomView(activeClass, { actor: state.actor, search: state.search });
    } catch (err) {
      paintGateMessage(err?.message || 'চ্যাট রুম লোড করা যায়নি।');
      return;
    }

    if (accessGateEl) accessGateEl.hidden = true;
    if (feedEl) feedEl.hidden = false;
    if (composerWrapEl) composerWrapEl.hidden = false;

    if (titleEl) titleEl.textContent = view.title;
    if (memberCountEl) memberCountEl.textContent = `সক্রিয় সদস্য: ${toBnDigits(view.activeMemberCount)} জন`;

    if (state.replyTo && !view.messages.some(m => m.id === state.replyTo.id && !m.deleted)) {
      state.replyTo = null;
    }
    renderReplyBar();
    renderSearchResultsBar(view);

    if (feedEl) {
      const e2eeNoticeHtml = !state.search
        ? `<div class="class-chat-e2ee-banner">${WA_SVGS.e2eeLock}<span>এই কক্ষের বার্তাগুলো এন্ড-টু-এন্ড এনক্রিপ্টেড (৭ দিনের রিলে)। শুধুমাত্র অনুমোদিত সদস্য ও শিক্ষকগণ পড়তে পারবেন।</span></div>`
        : '';

      if (!view.filteredMessages.length) {
        const emptyText = state.search
          ? `"${escapeHtml(state.search)}" দিয়ে কোনো বার্তা পাওয়া যায়নি।`
          : `${escapeHtml(view.classId)}-এর আলোচনা কক্ষে এখনো কোনো বার্তা নেই। নিচে বার্তা লিখে আলোচনা শুরু করুন!`;
        feedEl.innerHTML = `${e2eeNoticeHtml}<div class="class-chat-empty"><span class="class-chat-empty-icon" aria-hidden="true">${WA_SVGS.chatEmpty}</span><p>${emptyText}</p></div>`;
      } else {
        let lastBucket = '';
        let prevMsg = null;
        const chunks = [e2eeNoticeHtml];
        for (const msg of view.filteredMessages) {
          const bucket = dayBucketKey(msg.createdAt);
          const newDay = bucket !== lastBucket;
          if (newDay) {
            lastBucket = bucket;
            prevMsg = null;
            chunks.push(`<div class="class-chat-date-divider chat-date-divider"><span>${escapeHtml(formatChatDateDivider(msg.createdAt))}</span></div>`);
          }
          const groupedWithPrev = Boolean(
            prevMsg
            && !newDay
            && !prevMsg.deleted
            && !msg.deleted
            && prevMsg.senderId === msg.senderId
            && prevMsg.senderRole === msg.senderRole
          );
          chunks.push(renderMessageBubbleHtml(msg, state.actor, {
            groupedWithPrev,
            isJustSent: Boolean(state.justSentId && state.justSentId === msg.id)
          }));
          prevMsg = msg;
        }
        feedEl.innerHTML = chunks.join('');
      }
      syncOpenMenuRow();
      restoreOrScrollFeed(view.roomKey, forceBottom);
    }

    if (composerFormEl) composerFormEl.hidden = false;
    if (inputEl) inputEl.disabled = false;
    syncComposerSendState();
  }

  async function refresh(forceBottom = false) {
    if (state.destroyed) return;
    try {
      state.actor = await resolveCurrentActor();
      if (state.actor.kind === 'student') state.selectedClass = state.actor.classId;
      showError('');
      paintLoaded(forceBottom);
    } catch (err) {
      state.actor = null;
      paintGateMessage(err?.message || 'শ্রেণি চ্যাট ব্যবহার করতে অনুমোদিত অ্যাকাউন্টে লগইন করুন।');
    }
  }

  async function submitComposer() {
    if (state.sending || !inputEl || inputEl.disabled) return;
    const rawDraft = inputEl.value;
    if (!String(rawDraft || '').trim()) {
      syncComposerSendState();
      return;
    }
    state.sending = true;
    syncComposerSendState();
    showError('');
    try {
      if (!state.actor) {
        state.actor = await resolveCurrentActor();
        if (state.actor.kind === 'student') state.selectedClass = state.actor.classId;
      }
      suppressOwnEvent = true;
      let sentMsg = null;
      try {
        sentMsg = sendClassMessage({
          className: state.selectedClass,
          text: rawDraft,
          replyToId: state.replyTo?.id || '',
          actor: state.actor
        });
      } finally {
        suppressOwnEvent = false;
      }
      state.justSentId = sentMsg?.id || '';
      inputEl.value = '';
      state.replyTo = null;
      state.emojiOpen = false;
      syncEmojiDrawerUi();
      autoResizeInput();
      paintLoaded(true);
    } catch (err) {
      showError(err?.message || 'বার্তা পাঠানো যায়নি।');
      paintLoaded(false);
    } finally {
      state.sending = false;
      syncComposerSendState();
    }
  }

  root.addEventListener('click', event => {
    const classBtn = event.target.closest('[data-chat-select-class]');
    if (classBtn && state.actor?.kind === 'staff') {
      const nextClass = normalizeClassId(classBtn.dataset.chatSelectClass);
      if (nextClass && nextClass !== state.selectedClass) {
        saveCurrentRoomScroll();
        state.selectedClass = nextClass;
        state.replyTo = null;
        state.openMenuMsgId = '';
        state.pendingDeleteId = '';
        state.justSentId = '';
        showError('');
        renderDeleteConfirm();
        paintLoaded(false);
      }
      return;
    }

    const actionBtn = event.target.closest('[data-chat-action]');
    if (!actionBtn) {
      if (state.openMenuMsgId && !event.target.closest('.chat-hover-tray')) {
        state.openMenuMsgId = '';
        syncOpenMenuRow();
      }
      return;
    }
    const action = actionBtn.dataset.chatAction;

    if (action === 'go-back') {
      const host = root.closest('.view, .teacher-view, .manager-view, .admin-view');
      const nativeBack = host?.querySelector('.pay-back');
      if (nativeBack) {
        nativeBack.click();
        return;
      }
      const fallbackNav = document.querySelector(
        '.bottom-link[data-view="home"], .admin-bottom-item[data-admin-view="dashboard"], .admin-bottom-item[data-manager-view="dashboard"], .admin-bottom-item[data-teacher-view="home"]'
      );
      fallbackNav?.click();
      return;
    }
    if (action === 'toggle-search') {
      state.searchOpen = !state.searchOpen;
      if (!state.searchOpen && state.search) {
        state.search = '';
        if (searchInput) searchInput.value = '';
        if (searchClearBtn) searchClearBtn.hidden = true;
        paintLoaded(false);
      } else {
        syncSearchDrawerUi();
        if (state.searchOpen) searchInput?.focus();
      }
      return;
    }
    if (action === 'clear-search') {
      state.search = '';
      state.searchOpen = false;
      if (searchInput) searchInput.value = '';
      if (searchClearBtn) searchClearBtn.hidden = true;
      syncSearchDrawerUi();
      paintLoaded(false);
      return;
    }
    if (action === 'toggle-emoji') {
      state.emojiOpen = !state.emojiOpen;
      syncEmojiDrawerUi();
      return;
    }
    if (action === 'insert-emoji') {
      const emoji = actionBtn.dataset.emoji || '';
      if (inputEl && !inputEl.disabled && emoji) {
        const start = typeof inputEl.selectionStart === 'number' ? inputEl.selectionStart : inputEl.value.length;
        const end = typeof inputEl.selectionEnd === 'number' ? inputEl.selectionEnd : inputEl.value.length;
        const nextVal = `${inputEl.value.slice(0, start)}${emoji}${inputEl.value.slice(end)}`.slice(0, MAX_CHAT_MESSAGE_LENGTH);
        inputEl.value = nextVal;
        autoResizeInput();
        inputEl.focus();
      }
      return;
    }
    if (action === 'toggle-menu') {
      const msgId = String(actionBtn.dataset.msgId || '');
      state.openMenuMsgId = state.openMenuMsgId === msgId ? '' : msgId;
      syncOpenMenuRow();
      return;
    }
    if (action === 'delete') {
      const msgId = String(actionBtn.dataset.msgId || '');
      if (!msgId || !state.actor) return;
      // Authorisation is re-checked against the live store, not the old bubble.
      const view = getClassRoomView(state.selectedClass, { actor: state.actor });
      const target = view.messages.find(m => m.id === msgId);
      if (!target || target.deleted) return;
      if (!canDeleteClassMessage(state.actor, target)) {
        showError('শুধু নিজের বার্তা মুছতে পারবেন; অন্য কারও বার্তা মুছতে স্টাফ অনুমতি লাগবে।');
        return;
      }
      showError('');
      state.pendingDeleteId = msgId;
      state.openMenuMsgId = '';
      syncOpenMenuRow();
      renderDeleteConfirm();
      return;
    }
    if (action === 'cancel-delete') {
      state.pendingDeleteId = '';
      renderDeleteConfirm();
      return;
    }
    if (action === 'confirm-delete') {
      const msgId = state.pendingDeleteId;
      if (!msgId || !state.actor) {
        state.pendingDeleteId = '';
        renderDeleteConfirm();
        return;
      }
      state.pendingDeleteId = '';
      renderDeleteConfirm();
      showError('');
      try {
        suppressOwnEvent = true;
        try {
          deleteClassMessage({ className: state.selectedClass, messageId: msgId, actor: state.actor });
        } finally {
          suppressOwnEvent = false;
        }
        if (state.replyTo?.id === msgId) state.replyTo = null;
        paintLoaded(false);
      } catch (err) {
        showError(err?.message || 'বার্তাটি মোছা যায়নি।');
        paintLoaded(false);
      }
      return;
    }
    if (action === 'send') {
      void submitComposer();
      return;
    }
    if (action === 'cancel-reply') {
      state.replyTo = null;
      renderReplyBar();
      return;
    }
    if (action === 'jump-msg') {
      highlightMessage(actionBtn.dataset.targetMsgId);
      return;
    }

    if (!state.actor) return;
    showError('');
    try {
      if (action === 'reply') {
        const view = getClassRoomView(state.selectedClass, { actor: state.actor });
        const msg = view.messages.find(m => m.id === actionBtn.dataset.msgId && !m.deleted);
        if (msg) {
          state.replyTo = {
            id: msg.id,
            senderId: msg.senderId,
            senderRole: msg.senderRole,
            senderName: msg.senderName,
            text: msg.text.slice(0, 140)
          };
          state.openMenuMsgId = '';
          syncOpenMenuRow();
          renderReplyBar();
          inputEl?.focus();
        }
      } else if (action === 'react') {
        state.openMenuMsgId = '';
        suppressOwnEvent = true;
        try {
          toggleMessageReaction({
            className: state.selectedClass,
            messageId: actionBtn.dataset.msgId,
            emoji: actionBtn.dataset.emoji,
            actor: state.actor
          });
        } finally {
          suppressOwnEvent = false;
        }
        paintLoaded(false);
      }
    } catch (err) {
      showError(err?.message || 'কাজটি সম্পন্ন করা যায়নি।');
    }
  });

  composerFormEl?.addEventListener('submit', event => {
    event.preventDefault();
    void submitComposer();
  });

  classSelectEl?.addEventListener('change', () => {
    if (state.actor?.kind !== 'staff') return;
    const nextClass = normalizeClassId(classSelectEl.value);
    if (!nextClass || nextClass === state.selectedClass) return;
    saveCurrentRoomScroll();
    state.selectedClass = nextClass;
    state.replyTo = null;
    state.openMenuMsgId = '';
    state.pendingDeleteId = '';
    state.justSentId = '';
    showError('');
    renderDeleteConfirm();
    paintLoaded(false);
  });

  feedEl?.addEventListener('scroll', () => {
    saveCurrentRoomScroll();
    if (feedEl.scrollTop > 20) syncHostHeroCollapse(true);
    else if (feedEl.scrollTop <= 4 && document.activeElement !== inputEl) syncHostHeroCollapse(false);
  }, { passive: true });

  inputEl?.addEventListener('focus', () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 520) {
      syncHostHeroCollapse(true);
    }
  });

  inputEl?.addEventListener('blur', () => {
    if (feedEl && feedEl.scrollTop <= 4) {
      syncHostHeroCollapse(false);
    }
  });

  searchInput?.addEventListener('input', () => {
    state.search = searchInput.value || '';
    if (state.search) state.searchOpen = true;
    if (searchClearBtn) searchClearBtn.hidden = !state.search;
    syncSearchDrawerUi();
    paintLoaded(false);
  });

  inputEl?.addEventListener('input', () => {
    if (state.error) showError('');
    autoResizeInput();
  });

  inputEl?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submitComposer();
    }
  });

  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.pendingDeleteId) {
      state.pendingDeleteId = '';
      renderDeleteConfirm();
    }
  });

  const onExternalUpdate = event => {
    if (state.destroyed || suppressOwnEvent) return;
    if (event?.type === 'storage' && event.key && event.key !== CLASS_CHAT_KEY && event.key !== KEYS.students) return;
    if (event?.type === 'apc-sync-updated') {
      const col = event.detail?.collection;
      if (col && col !== 'classChat' && col !== 'students' && col !== 'academics') return;
    }
    void refresh(false);
  };

  const syncVisualViewportHeight = () => {
    if (!hostShell || typeof window === 'undefined') return;
    if (state.destroyed || !isChatContainerVisible(hostView || root)) {
      hostShell.style.removeProperty('--chat-viewport-h');
      return;
    }
    const vv = window.visualViewport;
    if (vv && Number.isFinite(vv.height) && vv.height > 0 && vv.height < (window.innerHeight - 8)) {
      const nearBottom = feedEl ? (feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight) < 72 : false;
      hostShell.style.setProperty('--chat-viewport-h', `${Math.round(vv.height)}px`);
      if (nearBottom && feedEl) feedEl.scrollTop = feedEl.scrollHeight;
    } else {
      hostShell.style.removeProperty('--chat-viewport-h');
    }
  };

  window.addEventListener('storage', onExternalUpdate);
  window.addEventListener('apc-sync-updated', onExternalUpdate);
  window.addEventListener('apc-class-chat-updated', onExternalUpdate);
  window.addEventListener('hashchange', syncVisualViewportHeight);
  window.addEventListener('apc-view-change', syncVisualViewportHeight);
  window.visualViewport?.addEventListener('resize', syncVisualViewportHeight);

  const instance = {
    refresh,
    selectClass(className) {
      if (state.actor?.kind === 'student') {
        assertRoomReadAccess(state.actor, className);
      }
      saveCurrentRoomScroll();
      state.selectedClass = normalizeClassId(className) || state.selectedClass;
      state.replyTo = null;
      state.openMenuMsgId = '';
      state.pendingDeleteId = '';
      state.justSentId = '';
      renderDeleteConfirm();
      paintLoaded(false);
    },
    destroy() {
      state.destroyed = true;
      state.pendingDeleteId = '';
      renderDeleteConfirm();
      syncHostHeroCollapse(false);
      hostShell?.style.removeProperty('--chat-viewport-h');
      window.removeEventListener('storage', onExternalUpdate);
      window.removeEventListener('apc-sync-updated', onExternalUpdate);
      window.removeEventListener('apc-class-chat-updated', onExternalUpdate);
      window.removeEventListener('hashchange', syncVisualViewportHeight);
      window.removeEventListener('apc-view-change', syncVisualViewportHeight);
      window.visualViewport?.removeEventListener('resize', syncVisualViewportHeight);
      delete root.__apcClassChatInstance;
    }
  };

  root.__apcClassChatInstance = instance;
  autoResizeInput();
  syncVisualViewportHeight();
  void refresh(true);
  return instance;
}
