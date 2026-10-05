/* Finance domain helpers. Records live in the transactions collection.
   Swap the database adapter for Firestore later; the payment UI awaits its save. */
import { KEYS, listDocumentsStrict, replaceDocumentsStrict } from './database.js';
import { hasStaffSession, readStaffAccount } from './staff-auth.js';
import { authenticatedStudent } from './student-access.js';
import { latinDigits as sharedLatinDigits, searchStudentsByQuery } from './student-search.js';
export const TRANSACTIONS_KEY = KEYS.transactions;
export const DEFAULT_MONTHLY_FEE = 1500;
export const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
export const latinDigits = sharedLatinDigits;   // one implementation, see js/student-search.js
const banglaDigits = value => String(value).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[digit]);
export const monthLabel = (date = new Date()) => `${MONTHS[date.getMonth()]} ${banglaDigits(date.getFullYear())}`;
export const dateLabel = (date = new Date()) => `${banglaDigits(date.getDate())} ${monthLabel(date)}`;

export const searchStudents = searchStudentsByQuery;

function paymentDate(value) {
  const text = latinDigits(value).trim();
  const [day, month, year] = text.split(/\s+/);
  const index = MONTHS.indexOf(month);
  if (index >= 0 && Number(day) && Number(year)) return new Date(Number(year), index, Number(day)).getTime();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

const recordedAt = tx => Number.isFinite(tx?.recordedAt) ? tx.recordedAt : paymentDate(tx?.date);
export function newestTransactions(transactions) {
  // Machine time wins when a record has it; same-day ties stay insertion-stable.
  return [...transactions].sort((a, b) => recordedAt(b) - recordedAt(a));
}

/** New ledger rows keep the Bengali display date and a sortable timestamp. */
export function stampTransaction(fields, now = new Date()) {
  return {
    ...fields,
    date: fields.date || dateLabel(now),
    recordedAt: Number.isFinite(fields.recordedAt) ? fields.recordedAt : now.getTime(),
    createdAt: fields.createdAt || now.toISOString()
  };
}

export function isFinalizedTransaction(tx) {
  // Existing records predate review workflow and remain valid; new records must
  // be explicitly approved by Manager before counting toward paid/due totals.
  return tx?.status == null || tx.status === 'approved';
}

export function studentFeeSummary(student, transactions, now = new Date()) {
  const month = monthLabel(now);
  const own = transactions.filter(tx => tx.studentId === student.id && isFinalizedTransaction(tx));
  const monthly = own.filter(tx => tx.month === month);
  const configured = student.monthlyFee;
  const monthlyFee = configured != null && configured !== '' && Number.isFinite(Number(configured)) && Number(configured) >= 0
    ? Number(configured) : DEFAULT_MONTHLY_FEE;
  const paid = monthly.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const tuitionPaid = monthly.filter(tx => tx.feeType === 'মাসিক বেতন').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  return { month, monthlyFee, paid, tuitionPaid, due: Math.max(0, monthlyFee - tuitionPaid), lastPayment: newestTransactions(own)[0] || null };
}

function validTransaction(tx) {
  return Boolean(tx && tx.id && tx.studentId && Number.isFinite(Number(tx.amount))
    && (tx.status == null || ['pending', 'approved', 'rejected'].includes(tx.status))
    && (tx.reviewHistory == null || Array.isArray(tx.reviewHistory)));
}

function readTransactions() {
  return listDocumentsStrict('transactions', validTransaction);
}

function accessDenied(message = 'এই লেনদেনের ডেটা দেখার অনুমতি নেই।') {
  return Object.assign(new Error(message), { code: 'ACCESS_DENIED' });
}
async function requireFinanceRole(role) {
  if (!['admin', 'manager', 'payment'].includes(role) || !(await hasStaffSession(role))) throw accessDenied();
  const account = await readStaffAccount(role);
  if (!account || ['disabled', 'inactive', 'rejected'].includes(account.status) || account.accountStatus === 'disabled') throw accessDenied();
  return account;
}

// Display receipts are short and daily; transaction IDs remain collision-resistant.
// Allocate inside the SAME ledger lock/write, using plain and historical
// suffixed receipts as the floor. No previous receipt is renamed.
function counterReceiptNumber(records, now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('রসিদের তারিখ সঠিক নয়।');
  const prefix = `R${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const pattern = new RegExp(`^${prefix}(\\d{3,})(?:-[a-f0-9]{16})?$`, 'i');
  const last = records.reduce((maximum, row) => {
    const match = String(row.receiptNo || '').match(pattern);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  if (last >= 999) throw new Error('আজকের রসিদের ক্রমিক সীমা ৯৯৯ পূর্ণ হয়েছে। পেমেন্ট সংরক্ষণ হয়নি।');
  return `${prefix}${String(last + 1).padStart(3, '0')}`;
}

// Public Transaction ID: T + two-digit year + a running ordinal (minimum
// three digits), NOT a daily counter. Keep .id as the immutable sync key so
// independent offline devices cannot overwrite rows with a short display ID.
function publicTransactionNumber(records, now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('ট্রানজ্যাকশনের তারিখ সঠিক নয়।');
  const prefix = `T${String(now.getFullYear()).slice(-2)}`;
  const pattern = new RegExp(`^${prefix}(\\d{3,})$`);
  const last = records.reduce((maximum, row) => {
    const match = String(row.transactionNo || row.id || '').match(pattern);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  if (!Number.isSafeInteger(last + 1)) throw new Error('ট্রানজ্যাকশনের ক্রমিক সীমা পূর্ণ হয়েছে।');
  return `${prefix}${String(last + 1).padStart(3, '0')}`;
}

export const financeRepository = {
  async listTransactions(actor = null) {
    let role = actor?.role || '';
    if (!role) {
      for (const candidate of ['manager', 'admin', 'payment']) {
        if (await hasStaffSession(candidate)) { role = candidate; break; }
      }
      if (!role) {
        try {
          const student = await authenticatedStudent();
          return readTransactions().filter(tx => tx.studentId === student.id);
        } catch {
          /* Empty unauthenticated installs stay empty; a non-empty ledger is
             never returned merely because a panel forgot to pass its actor. */
          const rows = readTransactions();
          if (!rows.length) return [];
          throw accessDenied();
        }
      }
    }
    if (role === 'student') {
      const student = await authenticatedStudent(actor.studentId || actor.id);
      return readTransactions().filter(tx => tx.studentId === student.id);
    }
    const account = await requireFinanceRole(role);
    const rows = readTransactions();
    if (role !== 'payment') return rows;
    const username = String(account.username || '');
    return rows.filter(tx => tx.counterUsername
      ? tx.counterUsername === username
      : tx.collectedBy === 'পেমেন্ট কাউন্টার');
  },
  async saveTransaction(transaction, { counterReceipt = false, serialTransaction = false, receiptDate = new Date(), actor = null } = {}) {
    const role = actor?.role || 'payment';
    if (role !== 'payment') throw accessDenied('শুধু পেমেন্ট কাউন্টার নতুন লেনদেন সংরক্ষণ করতে পারবে।');
    await requireFinanceRole(role);
    const save = () => {
      // Re-read before writing so another tab's collections are not overwritten.
      const records = readTransactions();
      if (!records.some(tx => tx.id === transaction.id)) {
        const entry = { ...transaction, status: 'pending', reviewHistory: [] };
        if (serialTransaction) entry.transactionNo = publicTransactionNumber(records, receiptDate);
        if (counterReceipt) entry.receiptNo = counterReceiptNumber(records, receiptDate);
        // New collection attempts can never self-approve through this write path.
        delete entry.reviewedAt; delete entry.reviewedBy; delete entry.reviewNote;
        records.unshift(entry);
      }
      replaceDocumentsStrict('transactions', records);
      return records;
    };
    return navigator.locks ? navigator.locks.request(TRANSACTIONS_KEY, save) : save();
  },
  async reviewTransaction(transactionId, decision, reason = '') {
    if (!(await hasStaffSession('manager'))) throw Object.assign(new Error('শুধু Manager লেনদেন পর্যালোচনা করতে পারবেন।'), { code: 'ACCESS_DENIED' });
    if (!['approved', 'rejected'].includes(decision)) throw new Error('সিদ্ধান্ত সঠিক নয়।');
    const note = String(reason ?? '').trim().slice(0, 500);
    if (decision === 'rejected' && !note) throw new Error('বাতিলের কারণ লিখুন।');
    const reviewer = await readStaffAccount('manager');
    const review = () => {
      const records = readTransactions();
      const index = records.findIndex(tx => tx.id === transactionId);
      if (index < 0) throw Object.assign(new Error('লেনদেনটি পাওয়া যায়নি।'), { code: 'NOT_FOUND' });
      const original = records[index];
      if (original.status !== 'pending') throw Object.assign(new Error('এই এন্ট্রির সিদ্ধান্ত আগেই নেওয়া হয়েছে।'), { code: 'ALREADY_REVIEWED' });
      const history = Array.isArray(original.reviewHistory) ? original.reviewHistory : [];
      records[index] = {
        ...original,
        status: decision,
        reviewedAt: new Date().toISOString(),
        reviewedBy: reviewer?.username || 'manager',
        reviewNote: note,
        reviewHistory: [...history, { decision, reason: note, reviewedAt: new Date().toISOString(), reviewedBy: reviewer?.username || 'manager' }]
      };
      replaceDocumentsStrict('transactions', records);
      return records;
    };
    return navigator.locks ? navigator.locks.request(TRANSACTIONS_KEY, review) : review();
  }
};
