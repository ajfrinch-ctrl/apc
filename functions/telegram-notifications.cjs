'use strict';

// Telegram notifications for Active Plus Coaching Center.
// Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID as Firebase secrets.
// Chat messages are end-to-end encrypted in RTDB, so only metadata can be sent
// from a server trigger without weakening that privacy boundary.
const { defineSecret } = require('firebase-functions/params');
const { onValueWritten } = require('firebase-functions/v2/database');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { getDatabase } = require('firebase-admin/database');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const botToken = defineSecret('TELEGRAM_BOT_TOKEN');
const telegramChatId = defineSecret('TELEGRAM_CHAT_ID');
const BRIDGE_ROOT = 'activePlusSync/v1';
const DB_REGION = 'asia-southeast1';

function clean(value, max = 180) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

async function sendTelegram(text, eventId) {
  const token = botToken.value();
  const chatId = telegramChatId.value();
  if (!token || !chatId) throw new Error('Telegram secrets are not configured');
  const db = getFirestore();
  const eventKey = clean(eventId, 200).replace(/[^A-Za-z0-9_-]/g, '_');
  const ref = db.doc(`telegramDeliveryLedger/${eventKey || 'unknown-event'}`);
  const prior = await ref.get();
  if (prior.exists && prior.data()?.status === 'sent') return { duplicate: true };

  // Store a retryable record before sending; Telegram has no idempotency key,
  // so delivery can very rarely duplicate if the process dies after send.
  await ref.set({
    status: 'sending',
    updatedAt: FieldValue.serverTimestamp(),
    messagePreview: clean(text, 300)
  }, { merge: true });

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: clean(text, 3900), disable_web_page_preview: true })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    await ref.set({ status: 'failed', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw new Error(`Telegram send failed (HTTP ${response.status})`);
  }
  await ref.set({
    status: 'sent',
    telegramMessageId: payload.result?.message_id || null,
    sentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { sent: true };
}

exports.telegramNewRegistration = onValueWritten({
  ref: `${BRIDGE_ROOT}/notifications/{notifId}`,
  region: DB_REGION,
  secrets: [botToken, telegramChatId]
}, async event => {
  const before = event.data.before.val();
  const after = event.data.after.val();
  if (before || !after || after.type !== 'new_registration') return;
  const message = [
    '🆕 নতুন শিক্ষার্থী রেজিস্ট্রেশন',
    `নাম: ${clean(after.studentName || 'নাম পাওয়া যায়নি')}`,
    `শিক্ষার্থী ID: ${clean(after.studentId || event.params.notifId)}`,
    'Active Plus Coaching Center'
  ].join('\n');
  await sendTelegram(message, `registration-${event.id}`);
});

exports.telegramExamSubmission = onDocumentCreated({
  document: 'attempts/{attemptId}',
  secrets: [botToken, telegramChatId]
}, async event => {
  const attempt = event.data?.data();
  if (!attempt || attempt.status !== 'submitted') return;
  const [examSnap, studentSnap] = await Promise.all([
    getFirestore().doc(`exams/${clean(attempt.examId, 128)}`).get(),
    getFirestore().doc(`students/${clean(attempt.studentId, 128)}`).get()
  ]);
  const exam = examSnap.exists ? examSnap.data() : {};
  const student = studentSnap.exists ? studentSnap.data() : {};
  await sendTelegram([
    '📝 শিক্ষার্থী পরীক্ষা জমা দিয়েছে',
    `শিক্ষার্থী: ${clean(student.fullName || student.name || attempt.studentId)}`,
    `পরীক্ষা: ${clean(exam.title || attempt.examId)}`,
    `শ্রেণি: ${clean(attempt.className || student.className || 'উল্লেখ নেই')}`,
    'Active Plus Coaching Center'
  ].join('\n'), `exam-submit-${event.id}`);
});

exports.telegramResultsReleased = onDocumentUpdated({
  document: 'exams/{examId}',
  secrets: [botToken, telegramChatId]
}, async event => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.resultsReleased === true || after.resultsReleased !== true) return;
  const results = await getFirestore().collection('results').where('examId', '==', event.params.examId).get();
  await sendTelegram([
    '📊 পরীক্ষার ফলাফল প্রকাশিত হয়েছে',
    `পরীক্ষা: ${clean(after.title || event.params.examId)}`,
    `শ্রেণি: ${clean(after.className || 'উল্লেখ নেই')}`,
    `প্রকাশিত ফলাফল: ${results.size} জন`,
    'Active Plus Coaching Center'
  ].join('\n'), `results-release-${event.id}`);
});

exports.telegramClassChatAlert = onValueWritten({
  ref: `${BRIDGE_ROOT}/classChat/{recordId}`,
  region: DB_REGION,
  secrets: [botToken, telegramChatId]
}, async event => {
  const before = event.data.before.val();
  const after = event.data.after.val();
  if (before || !after || after._syncKind !== 'encrypted-message' || after.deleted === true) return;
  // Never attempt to decrypt the E2EE envelope on the server or include plaintext.
  await sendTelegram([
    '💬 ক্লাস চ্যাটে নতুন মেসেজ',
    `শ্রেণি: ${clean(after.classId || after.roomKey || 'অজানা')}`,
    `প্রেরক ID: ${clean(after.senderId || 'অজানা')}`,
    `বার্তা ID: ${clean(after.recordId || event.params.recordId)}`,
    'বার্তার লেখা end-to-end encryption-এর কারণে এখানে দেখানো হয়নি।'
  ].join('\n'), `chat-message-${event.id}`);
});
