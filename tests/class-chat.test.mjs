import './node-test-setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { KEYS, SYNCABLE } from '../js/database.js';
import { collectionPayload, remoteToLocal } from '../js/sync-collections.js';
import { mergeBackups } from '../js/backup-merge.js';
import {
  CLASS_CHAT_KEY,
  MAX_CHAT_MESSAGE_LENGTH,
  QUICK_REACTIONS,
  readClassChatStore,
  roomKeyForClass,
  getClassRoomView,
  sendClassMessage,
  toggleMessageReaction,
  mountClassChat,
  CLASS_CHAT_RELAY_TTL_DAYS,
  CLASS_CHAT_RELAY_TTL_MS,
  encryptChatPayload,
  decryptChatPayload,
  syncClassChatRelayCycle,
  CLASS_CHAT_READ_KEY,
  markClassRoomRead,
  getUnreadClassChatSummary,
  mountClassChatHead
} from '../js/class-chat.js';
import { createSimulator } from './rtdb-rules-sim.mjs';

let activeDom = null;
function resetStorage(roster = []) {
  activeDom?.window?.close?.();
  activeDom = new JSDOM('<!doctype html><html><body><div id="studentMount"></div><div id="teacherMount"></div><div id="mount"></div></body></html>', {
    url: 'http://localhost/'
  });
  globalThis.window = activeDom.window;
  globalThis.document = activeDom.window.document;
  globalThis.CustomEvent = activeDom.window.CustomEvent;
  globalThis.Event = activeDom.window.Event;
  globalThis.MutationObserver = activeDom.window.MutationObserver;
  window.localStorage.removeItem(CLASS_CHAT_KEY);
  window.localStorage.removeItem(CLASS_CHAT_READ_KEY);
  window.localStorage.setItem(KEYS.students, JSON.stringify(roster));
  return activeDom;
}

const ROSTER = [
  { id: 'STU-10-A', fullName: 'রাইসা ইসলাম', className: 'দশম শ্রেণি', status: 'approved' },
  { id: 'STU-10-B', fullName: 'তানভীর আহমেদ', className: 'class-10', status: 'approved' },
  { id: 'STU-09-A', fullName: 'নাবিল হাসান', className: 'নবম শ্রেণি', status: 'approved' },
  { id: 'STU-10-P', fullName: 'অপেক্ষমাণ শিক্ষার্থী', className: 'দশম শ্রেণি', status: 'pending' }
];

const studentRaisa = { id: 'STU-10-A', name: 'রাইসা ইসলাম', className: 'দশম শ্রেণি', role: 'student', status: 'approved' };
const studentTanvir = { id: 'STU-10-B', name: 'তানভীর আহমেদ', className: '10', role: 'student', status: 'approved' };
const studentNabilClass9 = { id: 'STU-09-A', name: 'নাবিল হাসান', className: 'নবম শ্রেণি', role: 'student', status: 'approved' };
const pendingStudent = { id: 'STU-10-P', name: 'অপেক্ষমাণ শিক্ষার্থী', className: 'দশম শ্রেণি', role: 'student', status: 'pending' };

const teacherActor = { id: 'TCH-01', name: 'সাইফুল স্যার', role: 'teacher', status: 'active' };
const managerActor = { id: 'MGR-01', name: 'কামরুল ম্যানেজার', role: 'manager', status: 'active' };
const adminActor = { id: 'ADM-01', name: 'প্রধান এডমিন', role: 'admin', status: 'active' };

test('1. Same-class approved students can chat, reply with quoted thread, and toggle quick reactions', () => {
  resetStorage(ROSTER);

  assert.equal(CLASS_CHAT_KEY, 'activePlus.classChat.v1');
  assert.equal(SYNCABLE.includes('classChat'), true, 'classChat is registered in SYNCABLE');

  const first = sendClassMessage({
    className: 'দশম শ্রেণি',
    text: 'আগামীকাল পদার্থবিজ্ঞান মডেল টেস্ট কোন অধ্যায় থেকে হবে?',
    actor: studentRaisa
  });
  assert.equal(first.classId, 'দশম শ্রেণি');
  assert.equal(first.senderName, 'রাইসা ইসলাম');
  assert.equal(first.senderRole, 'student');

  // Second student with alias className "10" normalizes to দশম শ্রেণি and replies
  const reply = sendClassMessage({
    className: '10',
    text: 'অধ্যায় ৩ ও ৪ থেকে হবে, স্যার গত ক্লাসে বলেছিলেন।',
    replyToId: first.id,
    actor: studentTanvir
  });
  assert.ok(reply.replyTo, 'reply snapshot is attached');
  assert.equal(reply.replyTo.id, first.id);
  assert.equal(reply.replyTo.senderName, 'রাইসা ইসলাম');
  assert.match(reply.replyTo.text, /পদার্থবিজ্ঞান মডেল টেস্ট/);

  // Quick reactions toggle on and off accurately
  for (const emoji of QUICK_REACTIONS) {
    assert.ok(['👍', '❤️', '🎉', '🙏', '💡'].includes(emoji));
  }
  toggleMessageReaction({ className: 'দশম শ্রেণি', messageId: reply.id, emoji: '👍', actor: studentRaisa });
  toggleMessageReaction({ className: 'দশম শ্রেণি', messageId: reply.id, emoji: '👍', actor: studentTanvir });
  toggleMessageReaction({ className: 'দশম শ্রেণি', messageId: reply.id, emoji: '💡', actor: studentRaisa });

  let view = getClassRoomView('দশম শ্রেণি', { actor: studentRaisa });
  assert.equal(view.title, 'দশম শ্রেণি — আলোচনা কক্ষ');
  assert.equal(view.activeMemberCount, 2, 'counts only approved দশম শ্রেণি students');
  assert.equal(view.messages.length, 2);

  const updatedReply = view.messages.find(m => m.id === reply.id);
  assert.deepEqual(updatedReply.reactions['👍'], ['STU-10-A', 'STU-10-B']);
  assert.deepEqual(updatedReply.reactions['💡'], ['STU-10-A']);

  // Toggling same emoji again removes only that student's reaction
  toggleMessageReaction({ className: 'দশম শ্রেণি', messageId: reply.id, emoji: '👍', actor: studentRaisa });
  view = getClassRoomView('দশম শ্রেণি', { actor: studentRaisa });
  assert.deepEqual(view.messages.find(m => m.id === reply.id).reactions['👍'], ['STU-10-B']);
});

test('2. Cross-class student access and unapproved student access are strictly denied', () => {
  resetStorage(ROSTER);
  const msg10 = sendClassMessage({
    className: 'দশম শ্রেণি',
    text: 'দশম শ্রেণির অভ্যন্তরীণ নোট আলোচনা',
    actor: studentRaisa
  });

  // Class 9 student trying to read Class 10 room
  assert.throws(
    () => getClassRoomView('দশম শ্রেণি', { actor: studentNabilClass9 }),
    err => err.code === 'CLASS_ACCESS_DENIED'
  );

  // Class 10 student trying to read Class 9 room
  assert.throws(
    () => getClassRoomView('নবম শ্রেণি', { actor: studentRaisa }),
    err => err.code === 'CLASS_ACCESS_DENIED'
  );

  // Class 9 student trying to post or react in Class 10 room
  assert.throws(
    () => sendClassMessage({ className: 'দশম শ্রেণি', text: 'অনধিকার প্রবেশ', actor: studentNabilClass9 }),
    err => err.code === 'CLASS_ACCESS_DENIED'
  );
  assert.throws(
    () => toggleMessageReaction({ className: 'দশম শ্রেণি', messageId: msg10.id, emoji: '👍', actor: studentNabilClass9 }),
    err => err.code === 'CLASS_ACCESS_DENIED'
  );

  // Unapproved (pending) student of Class 10 is also blocked
  assert.throws(
    () => getClassRoomView('দশম শ্রেণি', { actor: pendingStudent }),
    err => err.code === 'STUDENT_NOT_APPROVED'
  );
  assert.throws(
    () => sendClassMessage({ className: 'দশম শ্রেণি', text: 'পেন্ডিং বার্তা', actor: pendingStudent }),
    err => err.code === 'STUDENT_NOT_APPROVED'
  );
});

test('3. Teacher, Manager & Admin participate in every class room — messaging only, no moderation controls', () => {
  resetStorage(ROSTER);

  const teacherMsg = sendClassMessage({
    className: 'দশম শ্রেণি',
    text: 'রবিবার সকাল ১০টায় দশম শ্রেণির বিশেষ গণিত ক্লাস হবে।',
    actor: teacherActor
  });
  const managerMsg = sendClassMessage({
    className: 'নবম শ্রেণি',
    text: 'নবম শ্রেণির মাসিক পরীক্ষার প্রবেশপত্র অফিস থেকে সংগ্রহ করো।',
    actor: managerActor
  });
  const adminMsg = sendClassMessage({
    className: 'একাদশ শ্রেণি',
    text: 'শুক্রবার প্রতিষ্ঠান বন্ধ থাকবে।',
    actor: adminActor
  });

  assert.equal(teacherMsg.senderBadge, 'শিক্ষক');
  assert.equal(managerMsg.senderBadge, 'ম্যানেজার');
  assert.equal(adminMsg.senderBadge, 'এডমিন');

  // Staff can read every class room and every room is a normal, open room.
  assert.equal(getClassRoomView('দশম শ্রেণি', { actor: teacherActor }).messages.length, 1);
  assert.equal(getClassRoomView('নবম শ্রেণি', { actor: managerActor }).messages.length, 1);
  assert.equal(getClassRoomView('একাদশ শ্রেণি', { actor: adminActor }).messages.length, 1);
  const view10 = getClassRoomView('দশম শ্রেণি', { actor: studentRaisa });
  assert.equal(view10.canSend, true, 'no chat lock: students may always write in their own room');
  assert.equal('locked' in view10, false, 'room view carries no lock state');
  assert.equal('pinnedMessage' in view10, false, 'room view carries no pinned message');
  assert.equal('canModerate' in view10, false, 'room view carries no moderation capability');

  // A legacy record written by the removed moderation build opens as a normal
  // room instead of staying locked.
  window.localStorage.setItem(CLASS_CHAT_KEY, JSON.stringify({
    version: 1,
    rooms: { [roomKeyForClass('দশম শ্রেণি')]: { roomKey: roomKeyForClass('দশম শ্রেণি'), classId: 'দশম শ্রেণি', locked: true, pinnedMessageId: 'x', updatedAt: Date.now() } },
    messages: readClassChatStore().messages,
    updatedAt: Date.now()
  }));
  const legacyRoom = getClassRoomView('দশম শ্রেণি', { actor: studentRaisa });
  assert.equal(legacyRoom.canSend, true);
  const afterLegacyUnlock = sendClassMessage({ className: 'দশম শ্রেণি', text: 'ধন্যবাদ স্যার, বুঝতে পেরেছি!', actor: studentRaisa });
  assert.equal(afterLegacyUnlock.text, 'ধন্যবাদ স্যার, বুঝতে পেরেছি!');
});

test('4. XSS sanitization & length validation block script/HTML execution and oversized payloads', async () => {
  resetStorage(ROSTER);

  // Empty & >1000-character messages are rejected
  assert.throws(
    () => sendClassMessage({ className: 'দশম শ্রেণি', text: '   \n  ', actor: studentRaisa }),
    err => err.code === 'EMPTY_MESSAGE'
  );
  assert.throws(
    () => sendClassMessage({ className: 'দশম শ্রেণি', text: 'ক'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1), actor: studentRaisa }),
    err => err.code === 'MESSAGE_TOO_LONG'
  );

  const xssPayload = `<script>window.__pwned = true;</script><img src="x" onerror="window.__pwned = true"><svg onload="window.__pwned = true"></svg><a href="javascript:alert(1)">লিঙ্ক</a>`;
  const xssActor = {
    id: 'STU-10-A',
    name: `রাইসা <img src=x onerror="alert('name')">`,
    className: 'দশম শ্রেণি',
    role: 'student',
    status: 'approved'
  };
  sendClassMessage({ className: 'দশম শ্রেণি', text: xssPayload, actor: xssActor });

  const mount = document.getElementById('mount');
  const widget = mountClassChat(mount, {
    portal: 'student',
    getActor: () => xssActor
  });
  await new Promise(resolve => setTimeout(resolve, 25));

  const feed = mount.querySelector('[data-chat-feed]');
  assert.ok(feed, 'chat feed mounted');
  assert.equal(feed.querySelectorAll('script, iframe, object, embed').length, 0, 'no executable script/frame tags');
  assert.equal(feed.querySelectorAll('img, [onerror], [onload]').length, 0, 'no injected img or inline event handlers');
  assert.equal(Boolean(window.__pwned), false, 'XSS payload never executed');
  assert.ok(feed.querySelector('.chat-bubble-text').textContent.includes('<script>window.__pwned = true;</script>'),
    'raw payload is safely displayed as literal escaped text');

  widget.destroy();
});

test('5. Interactive DOM UI, RTDB sync adapter, and Admin backup merge work end-to-end', async () => {
  const dom = resetStorage(ROSTER);
  const studentMount = document.getElementById('studentMount');
  const teacherMount = document.getElementById('teacherMount');

  const studentUI = mountClassChat(studentMount, {
    portal: 'student',
    getActor: () => studentRaisa
  });
  const teacherUI = mountClassChat(teacherMount, {
    portal: 'teacher',
    initialClass: 'দশম শ্রেণি',
    getActor: () => teacherActor
  });
  await new Promise(resolve => setTimeout(resolve, 30));

  // Student sends via Enter key in composer
  const studentInput = studentMount.querySelector('[data-chat-input]');
  studentInput.value = 'স্যার, জৈব রসায়নের সাজেশন কি আজকে পাব?';
  studentInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(studentInput.value, '', 'composer clears after sending');
  assert.match(teacherMount.querySelector('[data-chat-feed]').textContent, /জৈব রসায়নের সাজেশন/,
    'teacher UI receives real-time update immediately');

  // No moderation chrome exists in either UI (feature removed 2026-10-28)
  assert.equal(teacherMount.querySelector('[data-chat-action="toggle-lock"]'), null);
  assert.equal(teacherMount.querySelector('[data-chat-pinned-banner]'), null);
  assert.equal(teacherMount.querySelector('[data-chat-room-lock-banner]'), null);

  // RTDB Sync adapter lossless round-trip
  const localBefore = readClassChatStore();
  const cloudPayload = collectionPayload('classChat', localBefore);
  assert.ok(cloudPayload && typeof cloudPayload === 'object');
  const restoredFromCloud = remoteToLocal('classChat', cloudPayload);
  assert.equal(restoredFromCloud.messages.length, localBefore.messages.length);
  assert.equal(Boolean(restoredFromCloud.rooms.class_10.locked), false, 'relay round-trip keeps no lock state');

  // Admin Backup merge preserves messages from two independent backups
  const backupA = {
    kind: 'active-plus-backup',
    version: 1,
    createdAt: '2026-10-22T08:00:00.000Z',
    data: { [CLASS_CHAT_KEY]: JSON.stringify(localBefore) }
  };
  const backupB = {
    kind: 'active-plus-backup',
    version: 1,
    createdAt: '2026-10-22T09:00:00.000Z',
    data: {
      [CLASS_CHAT_KEY]: JSON.stringify({
        version: 1,
        rooms: {},
        messages: [{
          id: 'MSG-BACKUP-2',
          roomKey: 'class_9',
          classId: 'নবম শ্রেণি',
          senderId: 'STU-09-A',
          senderName: 'নাবিল হাসান',
          senderRole: 'student',
          text: 'ব্যাকআপ থেকে আসা নবম শ্রেণির বার্তা',
          createdAt: '2026-10-22T08:30:00.000Z',
          updatedAt: 1761121800000
        }]
      })
    }
  };
  const { merged } = mergeBackups(backupA, backupB);
  const mergedChat = JSON.parse(merged.data[CLASS_CHAT_KEY]);
  assert.equal(mergedChat.messages.length, 2, 'both class 10 and class 9 messages survive backup merge');

  // Verify dynamic import rule in js/main.js
  const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(mainSource, /^\s*import\s+.*from\s+['"]\.\/class-chat\.js['"]/m,
    'js/main.js must never statically import class-chat.js');
  assert.match(mainSource, /import\(\s*['"]\.\/class-chat\.js['"]\s*\)/,
    'js/main.js loads class-chat.js via dynamic import()');

  studentUI.destroy();
  teacherUI.destroy();
});

test('6. UI search, reply preview bar, class switcher & draft-preserving live sync', async () => {
  const dom = resetStorage(ROSTER);
  const studentMount = document.getElementById('studentMount');
  const teacherMount = document.getElementById('teacherMount');

  const firstMsg = sendClassMessage({
    className: 'দশম শ্রেণি',
    text: 'ত্রিকোণমিতি সূত্রের তালিকা পিডিএফ আকারে লাগবে।',
    actor: studentRaisa
  });
  sendClassMessage({
    className: 'দশম শ্রেণি',
    text: 'আগামীকাল সকাল ৯টায় ক্লাস শুরু হবে।',
    actor: teacherActor
  });

  const studentUI = mountClassChat(studentMount, {
    portal: 'student',
    getActor: () => studentTanvir
  });
  const adminUI = mountClassChat(teacherMount, {
    portal: 'admin',
    initialClass: 'দশম শ্রেণি',
    getActor: () => adminActor
  });
  await new Promise(resolve => setTimeout(resolve, 30));

  // Moderation was retired: no pin/delete/lock affordances for staff, and no
  // pinned banner for students.
  assert.equal(teacherMount.querySelector('[data-chat-action="pin"]'), null, 'no pin control for staff');
  assert.equal(teacherMount.querySelector('[data-chat-action="delete"]'), null, 'no delete control for staff');
  assert.equal(studentMount.querySelector('[data-chat-pinned-banner]'), null, 'no pinned banner');

  // Reply UI flow: clicking "উত্তর দিন" opens reply preview strip above composer
  studentMount.querySelector(`[data-chat-action="reply"][data-msg-id="${firstMsg.id}"]`).click();
  const replyBar = studentMount.querySelector('[data-chat-reply-bar]');
  assert.equal(replyBar.hidden, false);
  assert.match(replyBar.textContent, /রাইসা ইসলাম/);

  // Search filter narrows visible messages and clear button restores full feed
  const searchBox = studentMount.querySelector('[data-chat-search]');
  searchBox.value = 'সকাল ৯টায়';
  searchBox.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(studentMount.querySelectorAll('[data-chat-msg-id]').length, 1);
  studentMount.querySelector('[data-chat-action="clear-search"]').click();
  assert.equal(studentMount.querySelectorAll('[data-chat-msg-id]').length, 2);

  // Staff class switcher tabs & dropdown switch between নবম শ্রেণি and দশম শ্রেণি
  const class9Tab = teacherMount.querySelector('[data-chat-select-class="নবম শ্রেণি"]');
  assert.ok(class9Tab, 'staff sees নবম শ্রেণি tab');
  class9Tab.click();
  assert.match(teacherMount.querySelector('[data-chat-room-title]').textContent, /নবম শ্রেণি — আলোচনা কক্ষ/);

  // Real-time apc-sync-updated event repaints feed WITHOUT wiping student's half-typed draft
  const composerInput = studentMount.querySelector('[data-chat-input]');
  composerInput.value = 'অর্ধেক লেখা বার্তা…';
  sendClassMessage({
    className: 'দশম শ্রেণি',
    text: 'নতুন সিঙ্ক হওয়া বার্তা',
    actor: managerActor
  });
  window.dispatchEvent(new dom.window.CustomEvent('apc-sync-updated', { detail: { collection: 'classChat' } }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(composerInput.value, 'অর্ধেক লেখা বার্তা…', 'draft text is preserved across real-time sync');
  assert.match(studentMount.querySelector('[data-chat-feed]').textContent, /নতুন সিঙ্ক হওয়া বার্তা/);

  studentUI.destroy();
  adminUI.destroy();
});

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => { map.set(String(key), String(val)); },
    removeItem: key => { map.delete(key); }
  };
}

test('chat AES-GCM fails closed instead of using Math.random for its nonce', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const subtle = globalThis.crypto.subtle;
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle } });
    await assert.rejects(
      encryptChatPayload('message', 'class_random_test', 'MSG-rng', { text: 'synthetic' }),
      /Secure random source unavailable/
    );
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
  }
});

test('7. End-to-End AES-256-GCM encrypted Firebase relay delivers across devices and auto-deletes once received', async () => {
  assert.equal(CLASS_CHAT_RELAY_TTL_DAYS, 7, 'Firebase relay TTL is set to 7 days');
  assert.equal(CLASS_CHAT_RELAY_TTL_MS, 7 * 24 * 60 * 60 * 1000);

  // Room-scoped AES-256-GCM cryptographic isolation & tamper check
  const env10 = await encryptChatPayload('message', 'class_10', 'MSG-1', { text: 'গোপন দশম শ্রেণির বার্তা' });
  assert.equal(env10.alg, 'AES-256-GCM');
  assert.doesNotMatch(JSON.stringify(env10), /গোপন দশম শ্রেণির বার্তা/);
  assert.equal(
    await decryptChatPayload('message', 'class_9', 'MSG-1', env10),
    null,
    'class_9 room key cannot decrypt class_10 ciphertext'
  );
  assert.equal(
    await decryptChatPayload('message', 'class_10', 'MSG-TAMPERED', env10),
    null,
    'swapping message ID fails AAD authentication'
  );

  // Three separate devices + one ephemeral Firebase RTDB node
  resetStorage(ROSTER);
  let firebaseNode = null;
  const runCloudTx = async updater => {
    const next = updater(firebaseNode ? JSON.parse(JSON.stringify(firebaseNode)) : null);
    firebaseNode = next ? JSON.parse(JSON.stringify(next)) : null;
    return firebaseNode;
  };
  const readCloud = async () => (firebaseNode ? JSON.parse(JSON.stringify(firebaseNode)) : null);

  const deviceRaisa = createMemoryStorage();
  const deviceTanvir = createMemoryStorage();
  const deviceTeacher = createMemoryStorage();
  const expectedRecipients = {
    class_10: ['stu_STU-10-A', 'stu_STU-10-B', 'staff_teacher_saiful']
  };

  // Raisa sends a message on Device A
  const secretText = 'আগামীকাল সকাল ৮টায় রসায়ন প্র্যাকটিক্যাল খাতা জমা দিতে হবে।';
  const sent = sendClassMessage({
    className: 'দশম শ্রেণি',
    text: secretText,
    actor: studentRaisa
  });
  deviceRaisa.setItem(CLASS_CHAT_KEY, window.localStorage.getItem(CLASS_CHAT_KEY));

  const t0 = Date.parse(sent.createdAt);
  await syncClassChatRelayCycle({
    storage: deviceRaisa,
    rawSetItem: deviceRaisa.setItem,
    readCloudSnapshot: readCloud,
    runCloudTransaction: runCloudTx,
    viewer: { kind: 'student', ackKey: 'stu_STU-10-A', allowedRoomKeys: new Set(['class_10']) },
    expectedRecipientsByRoom: expectedRecipients,
    now: t0 + 500
  });

  // Verify Firebase holds ONLY ciphertext (zero plaintext text or sender name) and passes RTDB rules
  assert.ok(firebaseNode, 'encrypted relay packet sits in Firebase waiting for classmates');
  const rawFirebaseJson = JSON.stringify(firebaseNode);
  assert.doesNotMatch(rawFirebaseJson, /রসায়ন প্র্যাকটিক্যাল/, 'plaintext message never appears in Firebase');
  assert.doesNotMatch(rawFirebaseJson, /রাইসা ইসলাম/, 'sender name never appears in plaintext in Firebase');

  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'));
  const sim = createSimulator(rules);
  const authDevice = { uid: 'anon-1', token: { firebase: { sign_in_provider: 'anonymous' } } };
  assert.equal(sim.canWrite(authDevice, 'activePlusSync/v1/classChat', firebaseNode, {}), true, 'RTDB rules allow encrypted relay write');

  // Class 9 student device syncing cannot pull or decrypt Class 10 messages
  const deviceClass9 = createMemoryStorage();
  await syncClassChatRelayCycle({
    storage: deviceClass9,
    rawSetItem: deviceClass9.setItem,
    readCloudSnapshot: readCloud,
    runCloudTransaction: runCloudTx,
    viewer: { kind: 'student', ackKey: 'stu_STU-09-A', allowedRoomKeys: new Set(['class_9']) },
    expectedRecipientsByRoom: expectedRecipients,
    now: t0 + 1000
  });
  assert.equal(deviceClass9.getItem(CLASS_CHAT_KEY), null, 'Class 9 phone ignores Class 10 encrypted envelopes');

  // Tanvir (Class 10) syncs -> receives & decrypts message into his local device storage
  await syncClassChatRelayCycle({
    storage: deviceTanvir,
    rawSetItem: deviceTanvir.setItem,
    readCloudSnapshot: readCloud,
    runCloudTransaction: runCloudTx,
    viewer: { kind: 'student', ackKey: 'stu_STU-10-B', allowedRoomKeys: new Set(['class_10']) },
    expectedRecipientsByRoom: expectedRecipients,
    now: t0 + 2000
  });
  const tanvirLocal = JSON.parse(deviceTanvir.getItem(CLASS_CHAT_KEY));
  assert.equal(tanvirLocal.messages.length, 1);
  assert.equal(tanvirLocal.messages[0].text, secretText);
  assert.ok(firebaseNode, 'still in Firebase until Teacher also receives');

  // Teacher syncs -> receives & decrypts -> all expected recipients ACKed -> Firebase auto-deletes!
  await syncClassChatRelayCycle({
    storage: deviceTeacher,
    rawSetItem: deviceTeacher.setItem,
    readCloudSnapshot: readCloud,
    runCloudTransaction: runCloudTx,
    viewer: { kind: 'staff', ackKey: 'staff_teacher_saiful', allowedRoomKeys: null },
    expectedRecipientsByRoom: expectedRecipients,
    now: t0 + 3000
  });
  assert.equal(firebaseNode, null, 'Firebase relay node is automatically wiped once all recipients received');
  assert.equal(sim.canWrite(authDevice, 'activePlusSync/v1/classChat', null, { activePlusSync: { v1: { classChat: { a: { id: 'a' } } } } }), true);

  // Subsequent syncs keep permanent local history on all devices and NEVER re-upload old messages
  await syncClassChatRelayCycle({
    storage: deviceRaisa,
    rawSetItem: deviceRaisa.setItem,
    readCloudSnapshot: readCloud,
    runCloudTransaction: runCloudTx,
    viewer: { kind: 'student', ackKey: 'stu_STU-10-A', allowedRoomKeys: new Set(['class_10']) },
    expectedRecipientsByRoom: expectedRecipients,
    now: t0 + 10000
  });
  assert.equal(firebaseNode, null, 'already-relayed messages are never re-uploaded to Firebase');
  assert.equal(JSON.parse(deviceRaisa.getItem(CLASS_CHAT_KEY)).messages[0].text, secretText);
  assert.equal(JSON.parse(deviceTanvir.getItem(CLASS_CHAT_KEY)).messages[0].text, secretText);
  assert.equal(JSON.parse(deviceTeacher.getItem(CLASS_CHAT_KEY)).messages[0].text, secretText);
});

test('8. Offline classmates can pull within 7 days, and after 7 days Firebase auto-deletes while devices keep history', async () => {
  resetStorage(ROSTER);
  let firebaseNode = null;
  const runCloudTx = async updater => {
    const next = updater(firebaseNode ? JSON.parse(JSON.stringify(firebaseNode)) : null);
    firebaseNode = next ? JSON.parse(JSON.stringify(next)) : null;
    return firebaseNode;
  };
  const readCloud = async () => (firebaseNode ? JSON.parse(JSON.stringify(firebaseNode)) : null);

  const deviceSender = createMemoryStorage();
  const deviceLateStudent = createMemoryStorage();

  const msg = sendClassMessage({
    className: 'দশম শ্রেণি',
    text: 'সপ্তাহব্যাপী রিভিশন নোট — ৭ দিনের মধ্যে অ্যাপ খুললে সিঙ্ক হবে।',
    actor: studentRaisa
  });
  deviceSender.setItem(CLASS_CHAT_KEY, window.localStorage.getItem(CLASS_CHAT_KEY));
  const t0 = Date.parse(msg.createdAt);

  // Day 0: Sender uploads to Firebase Relay (no early purge because an offline student hasn't ACKed)
  await syncClassChatRelayCycle({
    storage: deviceSender,
    rawSetItem: deviceSender.setItem,
    readCloudSnapshot: readCloud,
    runCloudTransaction: runCloudTx,
    viewer: { kind: 'student', ackKey: 'stu_STU-10-A', allowedRoomKeys: new Set(['class_10']) },
    expectedRecipientsByRoom: null,
    now: t0 + 1000
  });
  assert.ok(firebaseNode, 'Day 0: encrypted envelope stored in Firebase relay');

  // Day 5 (within 7 days): Offline student comes online and receives the message!
  const day5 = t0 + 5 * 24 * 60 * 60 * 1000;
  await syncClassChatRelayCycle({
    storage: deviceLateStudent,
    rawSetItem: deviceLateStudent.setItem,
    readCloudSnapshot: readCloud,
    runCloudTransaction: runCloudTx,
    viewer: { kind: 'student', ackKey: 'stu_STU-10-B', allowedRoomKeys: new Set(['class_10']) },
    expectedRecipientsByRoom: null,
    now: day5
  });
  assert.equal(JSON.parse(deviceLateStudent.getItem(CLASS_CHAT_KEY)).messages[0].text, msg.text,
    'Day 5: late-arriving student receives and decrypts message');
  assert.ok(firebaseNode, 'Day 5: still within 7-day relay window');

  // Day 7 + 1 second: 7-day TTL expires -> Firebase automatically purges the message, devices retain local copies!
  const after7Days = t0 + CLASS_CHAT_RELAY_TTL_MS + 1000;
  await syncClassChatRelayCycle({
    storage: deviceSender,
    rawSetItem: deviceSender.setItem,
    readCloudSnapshot: readCloud,
    runCloudTransaction: runCloudTx,
    viewer: { kind: 'student', ackKey: 'stu_STU-10-A', allowedRoomKeys: new Set(['class_10']) },
    expectedRecipientsByRoom: null,
    now: after7Days
  });
  assert.equal(firebaseNode, null, 'After 7 days: Firebase relay automatically deletes expired message');
  assert.equal(JSON.parse(deviceSender.getItem(CLASS_CHAT_KEY)).messages.length, 1,
    'Sender phone still retains permanent local chat history after Firebase expiry');
  assert.equal(JSON.parse(deviceLateStudent.getItem(CLASS_CHAT_KEY)).messages.length, 1,
    'Recipient phone still retains permanent local chat history after Firebase expiry');
});

test('9. Topbar Chat Icon & Floating Chat Head stay synced, enforce RBAC unread isolation, auto-hide inside chat, and jump staff to unread class', async () => {
  // Chat survives only where it is used: Student and Teacher. The Admin and
  // Manager "শ্রেণি চ্যাট ও মডারেশন" surfaces were removed on 2026-10-28.
  for (const portalFile of ['student.html', 'teacher.html']) {
    const html = readFileSync(new URL(`../${portalFile}`, import.meta.url), 'utf8');
    const doc = new JSDOM(html).window.document;
    const btn = doc.querySelector('.app-topbar #classChatTopbarButton');
    assert.ok(btn, `${portalFile} has #classChatTopbarButton in .app-topbar`);
    assert.ok(btn.querySelector('svg[data-icon="chat"]'), `${portalFile} topbar chat button has chat glyph`);
    assert.ok(btn.querySelector('[data-chat-unread-dot]'), `${portalFile} topbar chat button has unread dot`);
  }
  for (const strippedFile of ['manager.html', 'admin.html', 'payment.html']) {
    const doc = new JSDOM(readFileSync(new URL(`../${strippedFile}`, import.meta.url), 'utf8')).window.document;
    assert.equal(doc.querySelector('#classChatTopbarButton'), null, `${strippedFile} has no topbar chat button`);
    assert.equal(doc.querySelector('[data-class-chat-mount]'), null, `${strippedFile} has no chat mount`);
    assert.equal(doc.querySelector('[data-admin-view="class-chat"],[data-manager-view="class-chat"]'), null, `${strippedFile} has no chat route`);
  }

  // Mount a realistic Student shell with Home + Class Chat views + Topbar Chat Icon + Floating Chat Head
  const roster = [
    { id: 'STU-9A', fullName: 'সাদিয়া আক্তার', className: 'নবম শ্রেণি', status: 'approved' },
    { id: 'STU-9B', fullName: 'রাফি হাসান', className: 'নবম শ্রেণি', status: 'approved' },
    { id: 'STU-10A', fullName: 'তানভীর আহমেদ', className: 'দশম শ্রেণি', status: 'approved' }
  ];
  resetStorage(roster);
  document.body.innerHTML = `
    <div class="app-shell" id="appShell">
      <header class="app-topbar">
        <div class="app-topbar-actions">
          <button class="app-topbar-icon class-chat-topbar-button" id="classChatTopbarButton" data-view="class-chat" type="button" aria-label="শ্রেণি চ্যাট খুলুন">
            <span class="notification-dot class-chat-dot" data-chat-unread-dot hidden></span>
          </button>
        </div>
      </header>
      <main class="app-main">
        <section class="view active" id="homeView"></section>
        <section class="view" id="classChatView"><div id="studentClassChatMount"></div></section>
      </main>
    </div>
  `;

  const sadiyaActor = { id: 'STU-9A', name: 'সাদিয়া আক্তার', role: 'student', className: 'নবম শ্রেণি', status: 'approved' };
  const rafiActor = { id: 'STU-9B', name: 'রাফি হাসান', role: 'student', className: 'নবম শ্রেণি', status: 'approved' };
  const tanvirClass10 = { id: 'STU-10A', name: 'তানভীর আহমেদ', role: 'student', className: 'দশম শ্রেণি', status: 'approved' };
  const teacherActor = { id: 'TCH-01', name: 'কামরুল স্যার', role: 'teacher', kind: 'staff', status: 'active' };

  const topbarBtn = document.getElementById('classChatTopbarButton');
  topbarBtn.addEventListener('click', () => {
    document.getElementById('homeView').classList.remove('active');
    document.getElementById('classChatView').classList.add('active');
    mountClassChat('#studentClassChatMount', { portal: 'student', getActor: () => sadiyaActor });
    window.dispatchEvent(new CustomEvent('apc-view-change', { detail: { view: 'class-chat' } }));
  });

  const head = mountClassChatHead({ getActor: () => sadiyaActor });
  await head.refresh();

  const headEl = document.getElementById('apcClassChatHead');
  const topbarDot = topbarBtn.querySelector('[data-chat-unread-dot]');
  const headBadge = headEl.querySelector('[data-chat-head-badge]');
  const previewEl = headEl.querySelector('[data-chat-head-preview]');

  // Floating Chat Head stays visible on Home even with 0 unread messages
  assert.equal(headEl.hidden, false, 'Floating Chat Head stays visible on Home screen');
  assert.equal(topbarDot.hidden, true, 'No unread badge initially');
  assert.equal(headBadge.hidden, true, 'No unread badge on Chat Head initially');

  // Message in Class 10 MUST NOT increment Class 9 Sadiya's unread badge or preview!
  sendClassMessage({ className: 'দশম শ্রেণি', text: 'দশম শ্রেণির গোপন বার্তা', actor: tanvirClass10 });
  await head.refresh();
  assert.equal(topbarDot.hidden, true, 'RBAC: Class 10 message never shows unread dot for Class 9 student');
  assert.equal(headBadge.hidden, true, 'RBAC: Class 10 message never shows badge on Class 9 Chat Head');
  assert.equal(previewEl.hidden, true, 'RBAC: Class 10 message never previews on Class 9 Chat Head');

  // Sadiya's own message does not count as unread for herself
  sendClassMessage({ className: 'নবম শ্রেণি', text: 'সবাই কেমন আছো?', actor: sadiyaActor });
  await head.refresh();
  assert.equal(headBadge.hidden, true, 'Own message never counts as unread');

  // Classmate Rafi sends an XSS-attempt message in Class 9 -> unread = ১ on BOTH topbar & floating Chat Head + safe text preview!
  sendClassMessage({ className: 'নবম শ্রেণি', text: '<img src=x onerror=alert(1)> গণিত ক্লাস বিকেল ৪টায়', actor: rafiActor });
  await head.refresh();
  assert.equal(topbarDot.hidden, false, 'Topbar chat icon shows unread badge');
  assert.equal(topbarDot.textContent, '১');
  assert.equal(headBadge.hidden, false, 'Floating Chat Head shows unread badge');
  assert.equal(headBadge.textContent, '১');
  assert.equal(previewEl.hidden, false, 'Floating Chat Head shows incoming message preview pill');
  assert.equal(previewEl.querySelector('img'), null, 'Preview pill is 100% XSS-safe textContent');
  assert.match(previewEl.textContent, /গণিত ক্লাস বিকেল ৪টায়/);

  // Tapping the Floating Chat Head opens Class Chat, auto-hides the Floating Chat Head, highlights Topbar button, and clears unread badges!
  headEl.querySelector('#classChatHeadButton').click();
  await new Promise(r => setTimeout(r, 20));
  await head.refresh();
  assert.equal(document.getElementById('classChatView').classList.contains('active'), true, 'Tapping Chat Head opened Class Chat');
  assert.equal(headEl.hidden, true, 'Floating Chat Head auto-hides while inside Class Chat');
  assert.equal(topbarBtn.classList.contains('is-active'), true, 'Topbar chat icon shows active state inside Class Chat');
  assert.equal(topbarDot.hidden, true, 'Topbar unread badge clears once room is viewed');
  assert.equal(getUnreadClassChatSummary(sadiyaActor).totalUnread, 0, 'All Class 9 messages marked read');

  // Navigating back to Home re-shows the Floating Chat Head automatically with 0 unread
  document.getElementById('classChatView').classList.remove('active');
  document.getElementById('homeView').classList.add('active');
  await head.refresh();
  assert.equal(headEl.hidden, false, 'Floating Chat Head reappears automatically when back on Home');
  assert.equal(headBadge.hidden, true, 'Unread badge remains cleared');
  head.destroy();

  // Teacher multi-room unread summary + jump directly to latest unread class tab
  sendClassMessage({ className: 'একাদশ শ্রেণি', text: 'স্যার, পদার্থবিজ্ঞান ২য় পত্রের নোট লাগবে', actor: { id: 'STU-11A', name: 'মাহিন', role: 'student', className: 'একাদশ শ্রেণি', status: 'approved' } });
  const teacherSummary = getUnreadClassChatSummary(teacherActor);
  assert.ok(teacherSummary.totalUnread >= 3, 'Teacher sees unread count across all classes');
  assert.equal(teacherSummary.latestUnread?.classId, 'একাদশ শ্রেণি', 'Latest unread points to Class 11');

  window.__apcPendingChatClass = teacherSummary.latestUnread.classId;
  const teacherMount = document.createElement('div');
  document.getElementById('homeView').append(teacherMount);
  mountClassChat(teacherMount, { portal: 'teacher', getActor: () => teacherActor });
  await new Promise(r => setTimeout(r, 20));
  assert.match(teacherMount.querySelector('[data-chat-room-title]').textContent, /একাদশ শ্রেণি/,
    'Staff Class Chat opens directly on the unread class room and marks it read');
  assert.equal(getUnreadClassChatSummary(teacherActor).byClass['একাদশ শ্রেণি'] || 0, 0,
    'Opened Class 11 room unread count cleared while other unread rooms retain theirs');
  assert.ok(teacherMount.querySelector('[data-chat-tab-unread]'),
    'Inactive class tabs with unread messages still show unread badge pill');
});

test('10. Authentic WhatsApp UI: grouped bubbles, double-ticks, search & emoji drawers, portal back navigation, and AA contrast', async () => {
  const dom = resetStorage(ROSTER);
  document.body.innerHTML = `
    <section class="view active" id="classChatView">
      <div class="page-intro"><button class="pay-back" type="button" data-view="home">ফিরে যান</button></div>
      <div id="waStudentMount"></div>
    </section>
  `;
  let wentBack = false;
  document.querySelector('.pay-back').addEventListener('click', () => { wentBack = true; });

  // Consecutive messages from same classmate vs outgoing replies
  const m1 = sendClassMessage({ className: 'দশম শ্রেণি', text: 'আসসালামু আলাইকুম সবাইকে!', actor: studentTanvir });
  const m2 = sendClassMessage({ className: 'দশম শ্রেণি', text: 'আজকে গণিত ক্লাস কয়টায়?', actor: studentTanvir });
  const m3 = sendClassMessage({ className: 'দশম শ্রেণি', text: 'বিকেল ৪টায় শুরু হবে।', replyToId: m2.id, actor: studentRaisa });
  toggleMessageReaction({ className: 'দশম শ্রেণি', messageId: m2.id, emoji: '👍', actor: studentRaisa });

  const mount = document.getElementById('waStudentMount');
  const ui = mountClassChat(mount, { portal: 'student', getActor: () => studentRaisa });
  await new Promise(r => setTimeout(r, 25));

  const shell = mount.querySelector('.class-chat-shell');
  assert.ok(shell.classList.contains('is-whatsapp-ui'), 'mounts WhatsApp UI shell');

  // Portal back arrow inside WhatsApp header delegates to native view back button
  const backBtn = mount.querySelector('[data-chat-action="go-back"]');
  assert.equal(backBtn.hidden, false, 'WhatsApp back arrow visible inside portal view');
  backBtn.click();
  assert.equal(wentBack, true, 'WhatsApp back arrow triggers host portal back navigation');

  // E2EE golden banner is rendered inside feed without any <img>/<image>
  const feed = mount.querySelector('[data-chat-feed]');
  assert.ok(feed.querySelector('.class-chat-e2ee-banner'), 'WhatsApp E2EE notice banner rendered at top of feed');
  assert.equal(feed.querySelectorAll('img, image, [onerror], [onload]').length, 0, 'strictly zero img/image elements inside feed');

  // Consecutive incoming messages group cleanly; outgoing message shows double-tick SVG
  const row1 = feed.querySelector(`[data-chat-msg-id="${m1.id}"]`);
  const row2 = feed.querySelector(`[data-chat-msg-id="${m2.id}"]`);
  const row3 = feed.querySelector(`[data-chat-msg-id="${m3.id}"]`);
  assert.equal(row1.classList.contains('is-first-in-group'), true, 'first message of sender run has bubble tail class');
  assert.equal(row2.classList.contains('is-grouped'), true, 'second consecutive message from same sender is grouped');
  assert.equal(row1.querySelector('.chat-read-ticks'), null, 'incoming message does not show outgoing read ticks');
  assert.ok(row3.querySelector('.chat-read-ticks .wa-tick-svg'), 'outgoing message shows WhatsApp double-tick SVG');
  assert.ok(row2.querySelector('.chat-active-reactions .chat-reaction-pill'), 'reacted bubble displays floating WhatsApp reaction pill');

  // Bubble chevron toggles floating menu open & closed
  row1.querySelector('[data-chat-action="toggle-menu"]').click();
  assert.equal(row1.classList.contains('is-menu-open'), true, 'chevron opens bubble quick menu');
  row1.querySelector('[data-chat-action="toggle-menu"]').click();
  assert.equal(row1.classList.contains('is-menu-open'), false, 'chevron closes bubble quick menu');

  // Search toggle button opens & closes WhatsApp search drawer
  const searchToggle = mount.querySelector('[data-chat-action="toggle-search"]');
  searchToggle.click();
  assert.equal(shell.classList.contains('is-search-open'), true, 'search drawer opens');
  searchToggle.click();
  assert.equal(shell.classList.contains('is-search-open'), false, 'search drawer closes');

  // Composer smiley toggle + quick emoji insertion
  const emojiToggle = mount.querySelector('[data-chat-action="toggle-emoji"]');
  const emojiDrawer = mount.querySelector('[data-chat-emoji-drawer]');
  assert.equal(emojiDrawer.hidden, true);
  emojiToggle.click();
  assert.equal(emojiDrawer.hidden, false, 'emoji strip opens');
  const smileEmojiBtn = [...mount.querySelectorAll('[data-chat-action="insert-emoji"]')]
    .find(btn => btn.dataset.emoji === '😊');
  assert.ok(smileEmojiBtn, 'quick emoji button rendered');
  smileEmojiBtn.click();
  const input = mount.querySelector('[data-chat-input]');
  assert.equal(input.value, '😊', 'clicking quick emoji inserts into WhatsApp pill input');

  // Verify WhatsApp palette tokens in foundation.css clear WCAG AA in both light & dark themes
  const foundation = readFileSync(new URL('../css/foundation.css', import.meta.url), 'utf8');
  for (const token of ['--wa-header-bg', '--wa-wallpaper-bg', '--wa-out-bubble', '--wa-in-bubble', '--wa-bubble-ink', '--wa-send-bg']) {
    assert.match(foundation, new RegExp(`${token}\\s*:`), `${token} defined in foundation.css`);
  }
  ui.destroy();
  void dom;
});

test('11. Empty-room composer usability, disabled-when-empty পাঠান button, async pre-hydration send, sent status & one-tap quick reply', async () => {
  resetStorage(ROSTER);
  document.body.innerHTML = `
    <section class="admin-view active" data-view-panel="class-chat">
      <div class="page-intro"><h1>শ্রেণি চ্যাট</h1></div>
      <div id="emptyRoomMount" data-class-chat-mount></div>
    </section>
  `;
  const mount = document.getElementById('emptyRoomMount');
  // Simulate slow async staff account resolution while user types & sends immediately
  const ui = mountClassChat(mount, {
    portal: 'admin',
    initialClass: 'অষ্টম শ্রেণি',
    getActor: async () => {
      await new Promise(r => setTimeout(r, 25));
      return adminActor;
    }
  });

  const input = mount.querySelector('[data-chat-input]');
  const sendBtn = mount.querySelector('[data-chat-action="send"]');
  const composerWrap = mount.querySelector('[data-chat-composer-wrap]');
  const charCount = mount.querySelector('[data-chat-char-count]');

  assert.equal(
    input.getAttribute('placeholder'),
    'বার্তা লিখুন… (পাঠাতে Enter, নতুন লাইন Shift+Enter)',
    'exact Bengali composer placeholder is shown'
  );
  assert.equal(sendBtn.disabled, true, 'পাঠান button starts disabled when input is empty');
  assert.match(sendBtn.textContent, /পাঠান/, 'send button displays পাঠান');

  // Wait for initial empty-room render and verify empty state + visible composer coexist
  await new Promise(r => setTimeout(r, 40));
  const feed = mount.querySelector('[data-chat-feed]');
  assert.ok(feed.querySelector('.class-chat-empty'), 'empty room shows empty state guidance');
  assert.equal(composerWrap.hidden, false, 'composer stays visible and ready on empty room');

  // Whitespace-only keeps send disabled; real text enables it and updates char count
  input.value = '   ';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(sendBtn.disabled, true, 'whitespace-only draft keeps পাঠান disabled');

  input.value = 'অষ্টম শ্রেণির প্রথম স্বাগত বার্তা!';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(sendBtn.disabled, false, 'পাঠান enables when valid text is entered');
  assert.equal(charCount.classList.contains('is-visible'), true, 'character counter displays without blocking send');

  sendBtn.click();
  await new Promise(r => setTimeout(r, 20));

  const firstBubble = feed.querySelector('[data-chat-msg-id]');
  assert.ok(firstBubble, 'first message sent on empty room renders immediately');
  assert.equal(firstBubble.classList.contains('is-just-sent'), true, 'newly sent message carries pop-in class');
  assert.equal(firstBubble.querySelector('[data-chat-status]')?.dataset.chatStatus, 'sent', 'sent bubble shows sent indicator');
  assert.ok(firstBubble.querySelector('.chat-time')?.textContent.trim().length > 0, 'sent bubble renders timestamp');

  // Also test sending BEFORE actor hydration completes on a fresh mount
  const fastMount = document.createElement('div');
  document.body.appendChild(fastMount);
  const fastUi = mountClassChat(fastMount, {
    portal: 'admin',
    initialClass: 'নবম শ্রেণি',
    getActor: async () => {
      await new Promise(r => setTimeout(r, 30));
      return adminActor;
    }
  });
  const fastInput = fastMount.querySelector('[data-chat-input]');
  const fastSend = fastMount.querySelector('[data-chat-action="send"]');
  fastInput.value = 'দ্রুত পাঠানো বার্তা';
  fastInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  fastSend.click();
  await new Promise(r => setTimeout(r, 55));
  assert.match(fastMount.querySelector('[data-chat-feed]').textContent, /দ্রুত পাঠানো বার্তা/,
    'clicking পাঠান before async actor hydration resolves still saves and renders the message');
  fastUi.destroy();

  // One-tap quick reply button directly on bubble quotes and replies cleanly
  const quickReplyBtn = firstBubble.querySelector('.chat-quick-reply-btn[data-chat-action="reply"]');
  assert.ok(quickReplyBtn, 'one-tap quick reply button rendered next to message bubble');
  quickReplyBtn.click();
  const replyBar = mount.querySelector('[data-chat-reply-bar]');
  assert.equal(replyBar.hidden, false, 'clicking quick reply opens reply preview bar');

  input.value = 'স্বাগত বার্তার উত্তর';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(replyBar.hidden, true, 'reply bar closes after sending reply');
  assert.equal(feed.querySelectorAll('.chat-reply-quote').length, 1, 'quoted reply bubble renders cleanly');

  ui.destroy();
});

test('12. Per-class scroll preservation, unread badges, persistent lock banner, jump-free search tray & 360px mobile CSS safety', async () => {
  resetStorage(ROSTER);
  // Seed messages in অষ্টম শ্রেণি and दशম শ্রেণি (unread for Admin)
  for (let i = 1; i <= 5; i += 1) {
    sendClassMessage({ className: 'অষ্টম শ্রেণি', text: `অষ্টম বার্তা ক্রম ${i}`, actor: teacherActor });
  }
  const searchTarget = sendClassMessage({ className: 'দশম শ্রেণি', text: 'রসায়ন ল্যাব ক্লাস আগামীকাল সকাল ১০টায়', actor: studentTanvir });
  sendClassMessage({ className: 'দশম শ্রেণি', text: 'সবাই ল্যাব কোট নিয়ে আসবে', actor: studentRaisa });

  document.body.innerHTML = `
    <section class="admin-view active" data-view-panel="class-chat">
      <div class="page-intro"><h1>শ্রেণি চ্যাট</h1></div>
      <div id="staffModMount" data-class-chat-mount></div>
    </section>
  `;
  const heroIntro = document.querySelector('.page-intro');
  const mount = document.getElementById('staffModMount');
  const ui = mountClassChat(mount, {
    portal: 'admin',
    defaultClass: 'অষ্টম শ্রেণি',
    getActor: () => adminActor
  });
  await new Promise(r => setTimeout(r, 25));

  // Staff keep inline search only — the moderation toolbar is gone.
  const toolbar = mount.querySelector('.class-chat-search-drawer.is-staff-toolbar');
  assert.ok(toolbar, 'staff inline search toolbar rendered');
  assert.equal(mount.querySelector('[data-chat-action="toggle-lock"]'), null, 'no chat-lock control');

  // Active class chip has dot & is-active; দশম শ্রেণি chip & select show unread count
  const activeTab = mount.querySelector('.class-chat-tab.is-active');
  assert.equal(activeTab.dataset.chatSelectClass, 'অষ্টম শ্রেণি');
  assert.ok(activeTab.querySelector('.class-chat-tab-dot'), 'active class chip shows indicator dot');
  const class10Tab = mount.querySelector('[data-chat-select-class="দশম শ্রেণি"]');
  assert.ok(class10Tab.querySelector('[data-chat-tab-unread]'), 'unread class chip shows unread count badge');
  const selectOpt10 = [...mount.querySelectorAll('[data-chat-class-select] option')]
    .find(opt => opt.value === 'দশম শ্রেণি');
  assert.match(selectOpt10.textContent, /নতুন/, 'class dropdown option shows unread count');

  // Scroll feed in অষ্টম শ্রেণি: hero collapses and scroll position is saved per class
  const feed = mount.querySelector('[data-chat-feed]');
  Object.defineProperty(feed, 'scrollHeight', { value: 900, configurable: true });
  Object.defineProperty(feed, 'clientHeight', { value: 300, configurable: true });
  feed.scrollTop = 48;
  feed.dispatchEvent(new window.Event('scroll'));
  assert.equal(heroIntro.classList.contains('is-chat-hero-collapsed'), true, 'hero card collapses smoothly on feed scroll');

  // Switch to দশম শ্রেণি -> opens at bottom (900), clears unread; switch back -> restores scrollTop 48
  class10Tab.click();
  assert.equal(feed.scrollTop, 900, 'switching to unvisited class room scrolls cleanly to bottom');
  assert.equal(mount.querySelector('[data-chat-select-class="দশম শ্রেণি"] [data-chat-tab-unread]'), null,
    'opening দশম শ্রেণি clears its unread badge');

  mount.querySelector('[data-chat-select-class="অষ্টম শ্রেণি"]').click();
  assert.equal(feed.scrollTop, 48, 'switching back to অষ্টম শ্রেণি restores its exact scroll position');

  // Switch back to দশম শ্রেণি: a student mount in the same class stays able to
  // write (no room lock exists any more) and staff messages still arrive.
  mount.querySelector('[data-chat-select-class="দশম শ্রেণি"]').click();
  const studentCheckMount = document.createElement('div');
  document.body.appendChild(studentCheckMount);
  const studentUi = mountClassChat(studentCheckMount, { portal: 'student', getActor: () => studentTanvir });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(studentCheckMount.querySelector('[data-chat-input]').disabled, false, 'student composer is always usable in their own room');

  const staffInput = mount.querySelector('[data-chat-input]');
  staffInput.value = 'স্টাফ ঘোষণা';
  staffInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  mount.querySelector('[data-chat-action="send"]').click();
  await new Promise(r => setTimeout(r, 20));
  assert.match(feed.textContent, /স্টাফ ঘোষণা/, 'staff can send messages in the class room');
  studentUi.destroy();

  // Search results appear cleanly above composer without leaking [data-chat-msg-id] outside feed
  const searchInput = mount.querySelector('[data-chat-search]');
  const searchResults = mount.querySelector('[data-chat-search-results]');
  const composerWrap = mount.querySelector('[data-chat-composer-wrap]');
  assert.equal(composerWrap.contains(searchResults), true, 'search results tray lives inside composer wrap above input');
  searchInput.value = 'রসায়ন ল্যাব';
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(searchResults.hidden, false, 'search results tray opens cleanly above composer');
  assert.equal(searchResults.querySelectorAll('[data-chat-msg-id]').length, 0, 'search tray does not duplicate feed message IDs');
  const hitBtn = searchResults.querySelector(`[data-chat-action="jump-msg"][data-target-msg-id="${searchTarget.id}"]`);
  assert.ok(hitBtn, 'matching message appears in search tray');
  hitBtn.click();

  // Verify 360-400px mobile CSS rules have no overflowing negative margin and keep lock label visible
  const walletCss = readFileSync(new URL('../css/ui-wallet.css', import.meta.url), 'utf8');
  assert.equal(/\.class-chat-shell\s*\{[^}]*margin-inline:\s*-16px/.test(walletCss), false,
    'no -16px negative horizontal margin on .class-chat-shell that would overflow 360px screens');
  assert.equal(/\.class-chat-lock-label\s*\{\s*display:\s*none/.test(walletCss), false,
    'চ্যাট লক (স্টাফ অনলি) label stays visible on mobile viewports');

  // Verify clean-URL staff portal (/admin without .html) resolves as staff with all-room relay access
  // even when a prior student KEYS.account exists in localStorage
  const { resolveCurrentRelayViewer } = await import('../js/class-chat-relay.js');
  const cleanUrlDom = new JSDOM('<div id="adminShell"></div>', { url: 'https://active-plus-coaching.web.app/admin#class-chat' });
  const prevWin = globalThis.window;
  globalThis.window = cleanUrlDom.window;
  try {
    cleanUrlDom.window.localStorage.setItem(KEYS.account, JSON.stringify({
      username: 'tanvir10',
      student: { id: 'STU-10A', className: 'দশম শ্রেণি', status: 'approved' }
    }));
    const viewer = resolveCurrentRelayViewer(cleanUrlDom.window.localStorage);
    assert.equal(viewer.kind, 'staff', 'clean-URL /admin resolves as staff relay viewer');
    assert.equal(viewer.role, 'admin');
    assert.equal(viewer.allowedRoomKeys, null, 'staff viewer syncs all class rooms without student single-room restriction');
  } finally {
    globalThis.window = prevWin;
    cleanUrlDom.window.close();
  }

  ui.destroy();
});

test('13. Full-screen Class Chat mode: hides portal chrome, enforces >=44px back/search controls, syncs visualViewport keyboard height & exits cleanly', async () => {
  resetStorage(ROSTER);
  document.body.innerHTML = `
    <div class="admin-shell is-chat-fullscreen" id="adminShell">
      <header class="app-topbar"><button id="classChatTopbarButton" type="button">চ্যাট</button></header>
      <main class="admin-main is-chat-view" id="adminMain">
        <section class="admin-view active" data-view-panel="class-chat">
          <div class="page-intro">
            <button class="pay-back" type="button" data-admin-view="more" hidden>ফিরে যান</button>
            <h1>শ্রেণি চ্যাট ও মডারেশন</h1>
          </div>
          <div id="fsAdminMount" data-class-chat-mount="admin"></div>
        </section>
      </main>
      <nav class="admin-bottom"><button class="admin-bottom-item" data-admin-view="dashboard" type="button">ড্যাশবোর্ড</button></nav>
    </div>
  `;

  const shellEl = document.getElementById('adminShell');
  const mainEl = document.getElementById('adminMain');
  const chatView = document.querySelector('[data-view-panel="class-chat"]');
  let exitedFullscreen = false;
  document.querySelector('.pay-back').addEventListener('click', () => {
    exitedFullscreen = true;
    chatView.classList.remove('active');
    shellEl.classList.remove('is-chat-fullscreen');
    mainEl.classList.remove('is-chat-view');
  });

  // Mock mobile virtual keyboard resize via visualViewport
  let vvResizeHandler = null;
  const mockVv = {
    height: 520,
    addEventListener(type, fn) { if (type === 'resize') vvResizeHandler = fn; },
    removeEventListener(type, fn) { if (type === 'resize' && vvResizeHandler === fn) vvResizeHandler = null; }
  };
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'visualViewport', { value: mockVv, configurable: true });

  const mount = document.getElementById('fsAdminMount');
  const ui = mountClassChat(mount, { portal: 'admin', defaultClass: 'দশম শ্রেণি', getActor: () => adminActor });
  await new Promise(r => setTimeout(r, 25));

  // visualViewport keyboard shrink updates --chat-viewport-h on host shell
  assert.equal(shellEl.style.getPropertyValue('--chat-viewport-h'), '520px',
    'mobile keyboard shrink updates --chat-viewport-h on full-screen shell');
  mockVv.height = 800;
  vvResizeHandler?.();
  assert.equal(shellEl.style.getPropertyValue('--chat-viewport-h'), '',
    'closing mobile keyboard clears custom --chat-viewport-h');

  // Back button inside WhatsApp header is visible even when .pay-back has [hidden] and exits full-screen cleanly
  const backBtn = mount.querySelector('[data-chat-action="go-back"]');
  assert.equal(backBtn.hidden, false, 'WhatsApp back arrow is visible in full-screen portal view');
  backBtn.click();
  assert.equal(exitedFullscreen, true, 'clicking WhatsApp back arrow exits full-screen chat view');
  assert.equal(shellEl.classList.contains('is-chat-fullscreen'), false, 'shell exits full-screen class');

  // Verify full-screen CSS contract, >=44px touch targets, safe-area-top & pull-to-refresh guard
  const walletCss = readFileSync(new URL('../css/ui-wallet.css', import.meta.url), 'utf8');
  const foundationCss = readFileSync(new URL('../css/foundation.css', import.meta.url), 'utf8');
  const pullRefreshJs = readFileSync(new URL('../js/pull-to-refresh.js', import.meta.url), 'utf8');
  assert.match(foundationCss, /--safe-top:\s*env\(safe-area-inset-top,\s*0px\)/, '--safe-top defined in foundation.css');
  assert.match(foundationCss, /--chat-viewport-h:\s*100dvh/, '--chat-viewport-h defined in foundation.css');
  assert.match(walletCss, /\.is-chat-fullscreen[\s\S]*?>\s*:is\(\.app-topbar,\s*\.bottom-nav,\s*\.admin-bottom\)[\s\S]*?display:\s*none\s*!important/,
    'full-screen chat hides .app-topbar and bottom navigation bars');
  assert.match(walletCss, /\.class-chat-back-btn\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s,
    'back button enforces >=44x44px primary touch target');
  assert.match(walletCss, /\.class-chat-icon-btn\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s,
    'header search icon button enforces >=44x44px touch target');
  assert.match(pullRefreshJs, /is-chat-view[\s\S]*?\.class-chat-shell/,
    'pull-to-refresh ignores downward touch scroll inside full-screen chat');

  delete window.visualViewport;
  ui.destroy();
});




