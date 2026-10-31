/* Active Plus Coaching — Encrypted Ephemeral Class Chat Relay (7-Day TTL).
 *
 * Architecture ("Store-and-Forward Relay" like WhatsApp):
 *   1. Permanent history lives ONLY on each user's own device (`activePlus.classChat.v1`).
 *   2. Outgoing messages & room states are encrypted client-side on the sender's
 *      device with room-scoped AES-256-GCM (Web Crypto API + AAD bound to room & ID)
 *      before ever touching Firebase Realtime Database (`activePlusSync/v1/classChat`).
 *      Plaintext `text`, `senderName`, and `replyTo` NEVER appear in Firebase.
 *   3. Receiving devices decrypt envelopes for their authorized class room(s),
 *      save them permanently to local storage, and post a lightweight delivery ACK.
 *   4. Firebase acts strictly as a temporary relay:
 *      • Every relayed message automatically expires and is purged from Firebase
 *        after 7 days (`CLASS_CHAT_RELAY_TTL_MS = 7 * 24 * 60 * 60 * 1000`).
 *      • Once every expected class recipient (all approved class students + active
 *        staff) acknowledges receipt, the relay deletes the message from Firebase
 *        immediately without waiting 7 days.
 *      • Deleting from Firebase NEVER deletes messages already stored on devices,
 *        and devices NEVER re-upload expired/already-relayed messages back to Firebase.
 */
import { KEYS, readRaw } from './database.js';
import { normalizeClassId } from './class-key.js';
import { loadRoster } from './office-data.js';
import { STAFF_ACCOUNTS } from './staff-auth.js';
import { STAFF_DIRECTORY_KEY } from './staff-directory.js';
import { TEACHER_ASSIGNMENTS_KEY } from './teacher-assignments.js';
import { encodeRealtimeRecords, decodeRealtimeRecords } from './realtime-value-codec.js';

export const CLASS_CHAT_RELAY_TTL_DAYS = 7;
export const CLASS_CHAT_RELAY_TTL_MS = CLASS_CHAT_RELAY_TTL_DAYS * 24 * 60 * 60 * 1000;
export const CLASS_CHAT_RELAY_STATE_KEY = 'activePlus.classChatRelay.v1';
export const CLASS_CHAT_E2EE_ALGO = 'AES-256-GCM';

const ENVELOPE_VERSION = 1;
const PBKDF2_ITERATIONS = 10000;
const DEFAULT_DOMAIN_SEED = 'ActivePlusCoaching:ClassChatE2EE:v1';
const roomKeyCache = new Map();

const CLASS_ROOM_SLUGS = Object.freeze({
  'অষ্টম শ্রেণি': 'class_8',
  'নবম শ্রেণি': 'class_9',
  'দশম শ্রেণি': 'class_10',
  'একাদশ শ্রেণি': 'class_11',
  'দ্বাদশ শ্রেণি': 'class_12'
});

function roomSlugForClass(className) {
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

function subtleCrypto() {
  const cryptoObj = globalThis.crypto;
  return cryptoObj && cryptoObj.subtle ? cryptoObj.subtle : null;
}

// Only used for a non-authenticating local relay device identifier. Never use
// this fallback for keys or nonces: AES-GCM requires a cryptographic RNG.
function randomBytes(length) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function secureIv() {
  const api = globalThis.crypto;
  if (!api || typeof api.getRandomValues !== 'function') throw new Error('Secure random source unavailable');
  return api.getRandomValues(new Uint8Array(12));
}

const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const fromHex = hex => {
  const clean = String(hex || '').trim();
  if (!clean || clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

export function sanitizeAckKey(rawId) {
  const clean = String(rawId || '').trim().replace(/[.#$/[\]\s]+/g, '_');
  return clean.slice(0, 96);
}

function configuredWorkspaceSalt(storage = globalThis.window?.localStorage) {
  try {
    const raw = storage?.getItem?.(KEYS.settings);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return typeof parsed?.chatEncryptionSalt === 'string' ? parsed.chatEncryptionSalt.trim() : '';
  } catch {
    return '';
  }
}

async function deriveRoomAesKey(roomKey, secretSeed = '') {
  const cleanRoom = String(roomKey || '').trim();
  const subtle = subtleCrypto();
  if (!cleanRoom || !subtle) return null;
  const seed = String(secretSeed || '').trim();
  const cacheId = `${cleanRoom}::${seed}`;
  if (roomKeyCache.has(cacheId)) return roomKeyCache.get(cacheId);

  const encoder = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(`${DEFAULT_DOMAIN_SEED}|room:${cleanRoom}|seed:${seed}`),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const aesKey = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(`apc-chat-room-salt-v1:${cleanRoom}`),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  roomKeyCache.set(cacheId, aesKey);
  return aesKey;
}

function aadBytes(kind, roomKey, recordId) {
  return new TextEncoder().encode(`apc-chat-e2ee-v1|${kind}|${roomKey}|${recordId}`);
}

export function isEncryptedChatEnvelope(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.v === ENVELOPE_VERSION
    && value.alg === CLASS_CHAT_E2EE_ALGO
    && typeof value.iv === 'string'
    && value.iv.length === 24
    && typeof value.ct === 'string'
    && value.ct.length >= 32
  );
}

/**
 * Encrypts a chat message or room payload with room-scoped AES-256-GCM.
 * Ciphertext is cryptographically bound via AAD to (kind, roomKey, recordId).
 */
export async function encryptChatPayload(kind, roomKey, recordId, payload, { secretSeed = '' } = {}) {
  const key = await deriveRoomAesKey(roomKey, secretSeed);
  const subtle = subtleCrypto();
  if (!key || !subtle) throw new Error('Web Crypto AES-256-GCM unavailable');
  const iv = secureIv();
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadBytes(kind, roomKey, recordId) },
    key,
    encoded
  );
  return {
    v: ENVELOPE_VERSION,
    alg: CLASS_CHAT_E2EE_ALGO,
    iv: toHex(iv),
    ct: toHex(new Uint8Array(encrypted))
  };
}

/**
 * Decrypts a room-scoped AES-256-GCM chat envelope; returns null if tampered,
 * corrupted, or decrypted with the wrong room key / AAD.
 */
export async function decryptChatPayload(kind, roomKey, recordId, envelope, { secretSeed = '' } = {}) {
  if (!isEncryptedChatEnvelope(envelope)) return null;
  const key = await deriveRoomAesKey(roomKey, secretSeed);
  const subtle = subtleCrypto();
  if (!key || !subtle) return null;
  const iv = fromHex(envelope.iv);
  const ct = fromHex(envelope.ct);
  if (!iv || iv.length !== 12 || !ct) return null;
  try {
    const buffer = await subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aadBytes(kind, roomKey, recordId) },
      key,
      ct
    );
    const parsed = JSON.parse(new TextDecoder().decode(buffer));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function readLocalJson(storage, key) {
  try {
    const raw = storage ? storage.getItem(key) : readRaw(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function defaultRawSetItem(key, value) {
  if (typeof globalThis.Storage !== 'undefined' && typeof globalThis.Storage.prototype?.setItem === 'function' && this instanceof globalThis.Storage) {
    return globalThis.Storage.prototype.setItem.call(this, key, value);
  }
  return this.setItem(key, value);
}

function writeLocalRaw(storage, key, value, rawSetItem = defaultRawSetItem) {
  const serialized = JSON.stringify(value);
  if (storage.getItem(key) === serialized) return false;
  rawSetItem.call(storage, key, serialized);
  return true;
}

export function readRelayState(storage = globalThis.window?.localStorage) {
  const parsed = readLocalJson(storage, CLASS_CHAT_RELAY_STATE_KEY);
  const deviceId = typeof parsed?.deviceId === 'string' && parsed.deviceId
    ? parsed.deviceId
    : `dev_${toHex(randomBytes(8))}`;
  return {
    version: 1,
    deviceId,
    relayedMessages: parsed?.relayedMessages && typeof parsed.relayedMessages === 'object'
      ? { ...parsed.relayedMessages }
      : {},
    relayedRooms: parsed?.relayedRooms && typeof parsed.relayedRooms === 'object'
      ? { ...parsed.relayedRooms }
      : {}
  };
}

function saveRelayState(storage, state, rawSetItem = defaultRawSetItem) {
  if (!storage) return;
  writeLocalRaw(storage, CLASS_CHAT_RELAY_STATE_KEY, {
    version: 1,
    deviceId: state.deviceId,
    relayedMessages: state.relayedMessages || {},
    relayedRooms: state.relayedRooms || {}
  }, rawSetItem);
}

function parseTimestamp(value) {
  if (Number.isFinite(value) && value > 0) return value;
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function normalizeStore(raw) {
  const rooms = raw?.rooms && typeof raw.rooms === 'object' && !Array.isArray(raw.rooms)
    ? { ...raw.rooms }
    : {};
  const messages = Array.isArray(raw?.messages)
    ? raw.messages.filter(m => m && typeof m.id === 'string' && m.id && m.roomKey)
    : [];
  return {
    version: 1,
    rooms,
    messages,
    updatedAt: Number(raw?.updatedAt) || 0
  };
}

/**
 * Resolves the signed-in viewer's ACK key & authorized room set on the current page.
 * Students are strictly restricted to their own approved class room; staff may sync all rooms.
 */
export function resolveCurrentRelayViewer(storage = globalThis.window?.localStorage) {
  const state = readRelayState(storage);
  try {
    const pathname = String(globalThis.window?.location?.pathname || '').toLowerCase();
    const isExplicitStudentPage = /(?:^|\/)student(?:\.html)?\/?$/.test(pathname);
    const doc = globalThis.window?.document || null;
    const shellByRole = {
      admin: '#adminShell',
      manager: '#managerShell',
      teacher: '#teacherShell',
      payment: '#payShell'
    };
    const buildStaffViewer = (role, spec) => {
      const account = readLocalJson(storage, spec.accountKey);
      const uname = typeof account?.username === 'string' && account.username.trim()
        ? account.username.trim()
        : role;
      const id = sanitizeAckKey(`staff_${role}_${uname}`);
      return { kind: 'staff', role, ackKey: id || state.deviceId, allowedRoomKeys: null };
    };
    for (const [role, spec] of Object.entries(STAFF_ACCOUNTS)) {
      const routeRe = new RegExp(`(?:^|/)${role}(?:\\.html)?/?$`, 'i');
      if (routeRe.test(pathname)) return buildStaffViewer(role, spec);
      const shellEl = shellByRole[role] ? doc?.querySelector?.(shellByRole[role]) : null;
      if (shellEl && !shellEl.hidden) return buildStaffViewer(role, spec);
    }
    if (!isExplicitStudentPage) {
      for (const [role, spec] of Object.entries(STAFF_ACCOUNTS)) {
        const hasStaffSess = Boolean(
          globalThis.window?.sessionStorage?.getItem?.(spec.sessionKey)
          || storage?.getItem?.(spec.sessionKey)
        );
        if (hasStaffSess) return buildStaffViewer(role, spec);
      }
    }
    const account = readLocalJson(storage, KEYS.account);
    const student = account?.student || account;
    if (student?.id && student?.className) {
      const classId = normalizeClassId(student.className);
      const roomKey = roomSlugForClass(classId);
      return {
        kind: 'student',
        role: 'student',
        studentId: String(student.id),
        classId,
        ackKey: sanitizeAckKey(`stu_${student.id}`),
        allowedRoomKeys: roomKey ? new Set([roomKey]) : new Set()
      };
    }
  } catch { /* fallback to deviceId */ }
  return { kind: 'device', role: 'unknown', ackKey: sanitizeAckKey(state.deviceId), allowedRoomKeys: null };
}

/**
 * Computes expected recipient ACK keys per room when both approved class students
 * and at least one staff account are known, enabling early auto-deletion once
 * every member of the class + staff has received a message.
 */
export function computeExpectedRecipientsByRoom(storage = globalThis.window?.localStorage) {
  try {
    const roster = readLocalJson(storage, KEYS.students) || loadRoster() || [];
    if (!Array.isArray(roster) || !roster.length) return null;

    const staffKeys = new Set();
    for (const [role, spec] of Object.entries(STAFF_ACCOUNTS)) {
      if (role === 'payment') continue;
      const acc = readLocalJson(storage, spec.accountKey);
      if (acc?.username) staffKeys.add(sanitizeAckKey(`staff_${role}_${acc.username}`));
    }
    const assignments = readLocalJson(storage, TEACHER_ASSIGNMENTS_KEY);
    const directory = readLocalJson(storage, STAFF_DIRECTORY_KEY);
    if (!staffKeys.size && !Array.isArray(directory?.records) && !assignments) {
      // Without known staff recipients on this device, rely on the 7-day TTL
      // rather than deleting before teachers have a chance to pull the message.
      return null;
    }
    if (!staffKeys.size) return null;

    const byRoom = {};
    for (const row of roster) {
      if (row?.status !== 'approved' || !row?.id || !row?.className) continue;
      const roomKey = roomSlugForClass(row.className);
      if (!roomKey) continue;
      byRoom[roomKey] ??= new Set(staffKeys);
      byRoom[roomKey].add(sanitizeAckKey(`stu_${row.id}`));
    }
    const out = {};
    for (const [roomKey, set] of Object.entries(byRoom)) {
      if (set.size >= 2) out[roomKey] = [...set];
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function allExpectedRecipientsAcked(entry, expectedRecipientsByRoom) {
  if (!expectedRecipientsByRoom) return false;
  const expected = expectedRecipientsByRoom[entry?.roomKey];
  if (!Array.isArray(expected) || expected.length === 0) return false;
  const acks = entry?.acks && typeof entry.acks === 'object' ? entry.acks : {};
  const requiredAt = Number(entry?.updatedAt) || 1;
  return expected.every(rawKey => {
    const key = sanitizeAckKey(rawKey);
    return key && Number(acks[key] || 0) >= requiredAt;
  });
}

/* Chat moderation (pin / lock) was retired 2026-10-28, so the relay keeps no
   permanent records any more: every room and message entry expires on the same
   7-day TTL as before. Legacy `locked`/`pinned` flags on old entries are
   ignored instead of extending their life. */
function isEntryExpired(entry, _pinnedIdsByRoom, now) {
  if (!entry || typeof entry !== 'object') return true;
  if (entry._syncKind === 'metadata') return false;
  if (entry._syncKind === 'encrypted-room' || entry._syncKind === 'room') {
    const expiresAt = Number(entry.expiresAt) || 0;
    return expiresAt > 0 && now >= expiresAt;
  }
  const expiresAt = Number(entry.expiresAt) || (
    (parseTimestamp(entry.createdAtMs || entry.record?.createdAt || entry.updatedAt) || now) + CLASS_CHAT_RELAY_TTL_MS
  );
  return now >= expiresAt;
}

/**
 * Pure synchronous cloud-state reducer executed inside Firebase `runTransaction`.
 *   1. Purges relay messages older than the 7-day TTL.
 *   2. Upserts outgoing AES-256-GCM encrypted envelopes.
 *   3. Records delivery ACKs for decrypted messages.
 *   4. Immediately purges a message once all expected recipients ACKed.
 */
export function applyRelayCloudTransaction(currentDecoded, {
  outgoingMessages = [],
  outgoingRooms = [],
  ackMessageIds = [],
  ackKey = '',
  expectedRecipientsByRoom = null,
  now = Date.now()
} = {}) {
  const next = {};
  const source = currentDecoded && typeof currentDecoded === 'object' ? currentDecoded : {};
  for (const [k, v] of Object.entries(source)) {
    if (k !== '__metadata' && v && typeof v === 'object') next[k] = { ...v };
  }

  for (const roomNode of outgoingRooms) {
    const prev = next[roomNode.id];
    if (!prev || Number(roomNode.updatedAt) >= Number(prev.updatedAt || 0)) {
      next[roomNode.id] = roomNode;
    }
  }

  for (const msgNode of outgoingMessages) {
    const prev = next[msgNode.id];
    const prevUpdated = Number(prev?.updatedAt || 0);
    if (!prev || Number(msgNode.updatedAt) >= prevUpdated) {
      const mergedAcks = Number(msgNode.updatedAt) === prevUpdated
        ? { ...(prev?.acks || {}), ...(msgNode.acks || {}) }
        : { ...(msgNode.acks || {}) };
      next[msgNode.id] = { ...msgNode, acks: mergedAcks };
    }
  }

  const cleanAckKey = sanitizeAckKey(ackKey);
  if (cleanAckKey && ackMessageIds.length) {
    for (const msgId of ackMessageIds) {
      const nodeKey = `msg-${msgId}`;
      const existing = next[nodeKey];
      if (!existing || existing._syncKind !== 'encrypted-message') continue;
      const acks = existing.acks && typeof existing.acks === 'object' ? { ...existing.acks } : {};
      acks[cleanAckKey] = Math.max(Number(acks[cleanAckKey] || 0), Number(existing.updatedAt || 0), now);
      next[nodeKey] = { ...existing, acks };
    }
  }

  for (const [nodeKey, entry] of Object.entries(next)) {
    if (isEntryExpired(entry, null, now)) {
      delete next[nodeKey];
      continue;
    }
    if (entry._syncKind === 'encrypted-message' && allExpectedRecipientsAcked(entry, expectedRecipientsByRoom)) {
      delete next[nodeKey];
    }
  }

  const remainingKeys = Object.keys(next);
  if (!remainingKeys.length) return null;

  next.__metadata = {
    id: '__metadata',
    _syncKind: 'metadata',
    relay: 'e2ee-ephemeral-v1',
    ttlDays: CLASS_CHAT_RELAY_TTL_DAYS,
    updatedAt: now
  };
  return next;
}

async function buildOutgoingBundles(localStore, relayState, {
  allowedRoomKeys = null,
  ackKey = '',
  secretSeed = '',
  now = Date.now()
} = {}) {
  const outgoingRooms = [];
  const outgoingMessages = [];

  for (const [roomKey, room] of Object.entries(localStore.rooms || {})) {
    if (!roomKey || !room || typeof room !== 'object') continue;
    if (allowedRoomKeys && !allowedRoomKeys.has(roomKey)) continue;
    const updatedAt = Number(room.updatedAt) || 0;
    const relayedAt = Number(relayState.relayedRooms[roomKey] || 0);
    if (!updatedAt || updatedAt <= relayedAt) continue;
    if (relayedAt === 0 && (now - updatedAt) >= CLASS_CHAT_RELAY_TTL_MS) {
      continue;
    }
    const envelope = await encryptChatPayload('room', roomKey, roomKey, room, { secretSeed });
    outgoingRooms.push({
      id: `room-${roomKey}`,
      _syncKind: 'encrypted-room',
      recordId: roomKey,
      roomKey,
      classId: room.classId || '',
      updatedAt,
      expiresAt: now + CLASS_CHAT_RELAY_TTL_MS,
      envelope
    });
  }

  const cleanAckKey = sanitizeAckKey(ackKey);
  for (const msg of localStore.messages || []) {
    if (!msg?.id || !msg?.roomKey) continue;
    if (allowedRoomKeys && !allowedRoomKeys.has(msg.roomKey)) continue;
    const updatedAt = Number(msg.updatedAt) || parseTimestamp(msg.createdAt) || 0;
    const relayedAt = Number(relayState.relayedMessages[msg.id] || 0);
    if (updatedAt <= relayedAt) continue;

    const createdAtMs = parseTimestamp(msg.createdAt) || updatedAt || now;
    const expiresAt = createdAtMs + CLASS_CHAT_RELAY_TTL_MS;
    if (now >= expiresAt) {
      // Never upload messages older than 7 days from local device archive to Firebase.
      relayState.relayedMessages[msg.id] = updatedAt;
      continue;
    }

    const secretPayload = {
      id: msg.id,
      roomKey: msg.roomKey,
      classId: msg.classId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      senderRole: msg.senderRole,
      senderBadge: msg.senderBadge || '',
      text: msg.deleted ? '' : (msg.text || ''),
      replyTo: msg.deleted ? null : (msg.replyTo || null),
      reactions: msg.deleted ? {} : (msg.reactions || {}),
      deleted: Boolean(msg.deleted),
      deletedBy: msg.deletedBy || '',
      deletedById: msg.deletedById || '',
      deletedByRole: msg.deletedByRole || '',
      deletedAt: msg.deletedAt || '',
      createdAt: msg.createdAt,
      updatedAt
    };
    const envelope = await encryptChatPayload('message', msg.roomKey, msg.id, secretPayload, { secretSeed });
    outgoingMessages.push({
      id: `msg-${msg.id}`,
      _syncKind: 'encrypted-message',
      recordId: msg.id,
      roomKey: msg.roomKey,
      classId: msg.classId,
      deleted: Boolean(msg.deleted),
      createdAtMs,
      updatedAt,
      expiresAt,
      acks: cleanAckKey ? { [cleanAckKey]: Math.max(now, updatedAt) } : {},
      envelope
    });
  }

  return { outgoingRooms, outgoingMessages };
}

/**
 * Decrypts incoming cloud relay records for authorized rooms and merges them
 * additively into `localStore` WITHOUT deleting local history when Firebase
 * relay entries expire or are auto-purged.
 */
export async function mergeCloudRelayIntoLocal(cloudDecoded, localStore, relayState, {
  allowedRoomKeys = null,
  ackKey = '',
  secretSeed = '',
  now = Date.now()
} = {}) {
  const entries = Object.values(cloudDecoded || {}).filter(item => item && typeof item === 'object');
  const nextRooms = { ...(localStore.rooms || {}) };
  const msgMap = new Map((localStore.messages || []).map(m => [m.id, m]));
  let localChanged = false;
  const ackNeededIds = [];
  let hasExpiredInCloud = false;
  const cleanAckKey = sanitizeAckKey(ackKey);

  for (const item of entries) {
    if (item._syncKind === 'metadata') continue;
    if (isEntryExpired(item, null, now)) {
      hasExpiredInCloud = true;
      continue;
    }
    const roomKey = String(item.roomKey || item.record?.roomKey || '').trim();
    if (!roomKey) continue;
    if (allowedRoomKeys && !allowedRoomKeys.has(roomKey)) continue;

    if (item._syncKind === 'encrypted-room') {
      const decrypted = await decryptChatPayload('room', roomKey, item.recordId || roomKey, item.envelope, { secretSeed });
      if (!decrypted) continue;
      const incomingUpdated = Number(decrypted.updatedAt || item.updatedAt || 0);
      const currentUpdated = Number(nextRooms[roomKey]?.updatedAt || 0);
      relayState.relayedRooms[roomKey] = Math.max(Number(relayState.relayedRooms[roomKey] || 0), incomingUpdated);
      if (incomingUpdated > currentUpdated || !nextRooms[roomKey]) {
        nextRooms[roomKey] = { ...decrypted, roomKey };
        localChanged = true;
      }
      continue;
    }

    if (item._syncKind === 'room' && item.record) {
      const incomingUpdated = Number(item.record.updatedAt || item.updatedAt || 0);
      const currentUpdated = Number(nextRooms[roomKey]?.updatedAt || 0);
      relayState.relayedRooms[roomKey] = Math.max(Number(relayState.relayedRooms[roomKey] || 0), incomingUpdated);
      if (incomingUpdated > currentUpdated || !nextRooms[roomKey]) {
        nextRooms[roomKey] = { ...item.record, roomKey };
        localChanged = true;
      }
      continue;
    }

    if (item._syncKind === 'encrypted-message') {
      const msgId = String(item.recordId || '').trim();
      if (!msgId) continue;
      const decrypted = await decryptChatPayload('message', roomKey, msgId, item.envelope, { secretSeed });
      if (!decrypted || decrypted.id !== msgId || decrypted.roomKey !== roomKey) continue;
      const incomingUpdated = Number(decrypted.updatedAt || item.updatedAt || 0);
      const existing = msgMap.get(msgId);
      const existingUpdated = Number(existing?.updatedAt || parseTimestamp(existing?.createdAt) || 0);
      relayState.relayedMessages[msgId] = Math.max(Number(relayState.relayedMessages[msgId] || 0), incomingUpdated);
      if (!existing || incomingUpdated > existingUpdated) {
        msgMap.set(msgId, decrypted);
        localChanged = true;
      }
      const alreadyAckedAt = cleanAckKey ? Number(item.acks?.[cleanAckKey] || 0) : 0;
      if (cleanAckKey && alreadyAckedAt < Number(item.updatedAt || incomingUpdated || 1)) {
        ackNeededIds.push(msgId);
      }
      continue;
    }

    if (item._syncKind === 'message' && item.record?.id) {
      // Legacy plaintext fallback migration: adopt locally so old test/dev messages aren't lost.
      const legacy = item.record;
      const incomingUpdated = Number(legacy.updatedAt || item.updatedAt || 0);
      const existing = msgMap.get(legacy.id);
      const existingUpdated = Number(existing?.updatedAt || 0);
      relayState.relayedMessages[legacy.id] = Math.max(Number(relayState.relayedMessages[legacy.id] || 0), incomingUpdated);
      if (!existing || incomingUpdated > existingUpdated) {
        msgMap.set(legacy.id, legacy);
        localChanged = true;
      }
    }
  }

  const sortedMessages = [...msgMap.values()].sort(
    (a, b) => (parseTimestamp(a.createdAt) - parseTimestamp(b.createdAt)) || String(a.id).localeCompare(String(b.id))
  );

  return {
    localChanged,
    ackNeededIds,
    hasExpiredInCloud,
    nextStore: {
      version: 1,
      rooms: nextRooms,
      messages: sortedMessages,
      updatedAt: localChanged ? Math.max(Number(localStore.updatedAt || 0), now) : Number(localStore.updatedAt || 0)
    }
  };
}

/**
 * Runs one complete Device <-> Firebase Relay synchronization cycle:
 *   - Encrypts & pushes unsent local messages/rooms (< 7 days old)
 *   - Pulls & decrypts remote envelopes for authorized rooms into permanent local storage
 *   - Posts delivery ACKs and purges expired (>= 7 days) or fully-ACKed envelopes from Firebase
 */
export async function syncClassChatRelayCycle({
  storage = globalThis.window?.localStorage,
  rawSetItem = defaultRawSetItem,
  notifyLocalUpdate = null,
  readCloudSnapshot,
  runCloudTransaction,
  viewer = null,
  expectedRecipientsByRoom = undefined,
  secretSeed = undefined,
  now = Date.now()
} = {}) {
  if (!storage) return { pushed: 0, received: 0, acked: 0 };
  const resolvedViewer = viewer || resolveCurrentRelayViewer(storage);
  const ackKey = sanitizeAckKey(resolvedViewer?.ackKey || '');
  const allowedRoomKeys = resolvedViewer?.allowedRoomKeys || null;
  const seed = secretSeed !== undefined ? secretSeed : configuredWorkspaceSalt(storage);
  const recipientsMap = expectedRecipientsByRoom !== undefined
    ? expectedRecipientsByRoom
    : computeExpectedRecipientsByRoom(storage);

  const relayState = readRelayState(storage);
  const localBefore = normalizeStore(readLocalJson(storage, KEYS.classChat));

  const { outgoingRooms, outgoingMessages } = await buildOutgoingBundles(localBefore, relayState, {
    allowedRoomKeys,
    ackKey,
    secretSeed: seed,
    now
  });

  let cloudDecoded = {};
  if (outgoingRooms.length || outgoingMessages.length) {
    const rawAfterPush = await runCloudTransaction(currentRaw => {
      const decoded = decodeRealtimeRecords(currentRaw || {});
      const updated = applyRelayCloudTransaction(decoded, {
        outgoingRooms,
        outgoingMessages,
        ackKey,
        expectedRecipientsByRoom: recipientsMap,
        now
      });
      return updated === null ? null : encodeRealtimeRecords(updated);
    });
    cloudDecoded = decodeRealtimeRecords(rawAfterPush || {});
    for (const r of outgoingRooms) relayState.relayedRooms[r.recordId] = Math.max(relayState.relayedRooms[r.recordId] || 0, r.updatedAt);
    for (const m of outgoingMessages) relayState.relayedMessages[m.recordId] = Math.max(relayState.relayedMessages[m.recordId] || 0, m.updatedAt);
  } else if (typeof readCloudSnapshot === 'function') {
    const rawSnap = await readCloudSnapshot();
    cloudDecoded = decodeRealtimeRecords(rawSnap || {});
  }

  const latestLocal = normalizeStore(readLocalJson(storage, KEYS.classChat));
  const merged = await mergeCloudRelayIntoLocal(cloudDecoded, latestLocal, relayState, {
    allowedRoomKeys,
    ackKey,
    secretSeed: seed,
    now
  });

  if (merged.localChanged) {
    writeLocalRaw(storage, KEYS.classChat, merged.nextStore, rawSetItem);
    if (typeof notifyLocalUpdate === 'function') notifyLocalUpdate(merged.nextStore);
  }

  if ((merged.ackNeededIds.length || merged.hasExpiredInCloud) && typeof runCloudTransaction === 'function') {
    await runCloudTransaction(currentRaw => {
      const decoded = decodeRealtimeRecords(currentRaw || {});
      const updated = applyRelayCloudTransaction(decoded, {
        ackMessageIds: merged.ackNeededIds,
        ackKey,
        expectedRecipientsByRoom: recipientsMap,
        now
      });
      return updated === null ? null : encodeRealtimeRecords(updated);
    });
  }

  saveRelayState(storage, relayState, rawSetItem);
  return {
    pushed: outgoingMessages.length + outgoingRooms.length,
    localChanged: merged.localChanged,
    acked: merged.ackNeededIds.length
  };
}
