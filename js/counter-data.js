/* Narrow counter-facing API. Private roster/ledger rows never reach the UI:
   search returns identity only; reads return only this counter's today entries.
   This is device-local minimisation, not a replacement for server RBAC. */
import { listDocumentsStrict, newId } from './database.js';
import { hasStaffSession, readStaffAccount } from './staff-auth.js';
import { financeRepository, stampTransaction, dateLabel, latinDigits, newestTransactions } from './finance-data.js';
import { feeCategories, paymentMethods } from './admin-data.js';
import { searchText } from './student-search.js';
import { counterPhone, counterContacts } from './counter-privacy.js';

const denied = () => Object.assign(new Error('শুধু পেমেন্ট কাউন্টারের বৈধ সেশন ব্যবহার করতে পারবেন।'), { code:'ACCESS_DENIED' });
export async function assertCounterActor() {
  if (!(await hasStaffSession('payment'))) throw denied();
  const account = await readStaffAccount('payment');
  return account?.username || 'payment.apc';
}
function roster() {
  return listDocumentsStrict('students', row => Boolean(row && typeof row.id === 'string' && row.id));
}
const rollOf = row => String(row.uniqueRoll ?? row.uniqueRollNo ?? row.rollNo ?? row.rollNumber ?? row.roll ?? '').trim();
const packed = value => searchText(value).replace(/[\s()+\-._/]/g,'');
const identity = row => ({ id:row.id, name:String(row.name || row.nameBn || row.nameEn || 'শিক্ষার্থী'), uniqueRoll:rollOf(row) });

export async function searchCounterStudents(query) {
  await assertCounterActor();
  const text = searchText(query), compact = packed(query);
  if ([...text].length < 2 || !compact) return [];
  // Phone lookup is exact after BD/Bengali/E.164 normalisation. No guardian
  // name/address/class/status search and no unmasked phone in return values.
  const phone = counterPhone(query);
  return roster().filter(row => {
    const names = [row.name,row.nameBn,row.nameEn].some(value => searchText(value).includes(text));
    const id = packed(row.id), roll = packed(rollOf(row));
    const contact = phone && [row.studentMobile,row.mobile,row.registrationMobile,row.guardianMobile].some(value => counterPhone(value) === phone);
    return contact || names || id === compact || (compact.length >= 3 && id.includes(compact)) || (roll && roll === compact);
  }).slice(0,10).map(row => phone ? { ...identity(row), ...counterContacts(row) } : identity(row));
}

export function counterReceiptView(tx) {
  // Explicit allowlist: legacy transactions may themselves contain student PII.
  const copy = {};
  for (const key of ['id','transactionNo','receiptNo','studentId','studentName','uniqueRoll','feeType','month','amount','method','trxRef','date','recordedAt','createdAt','collectedBy','status']) {
    if (tx[key] !== undefined) copy[key] = tx[key];
  }
  return copy;
}
function isToday(tx, now) {
  const timestamp = Number.isFinite(tx.recordedAt) ? tx.recordedAt : Date.parse(tx.createdAt || '');
  if (Number.isFinite(timestamp)) {
    const day = new Date(timestamp);
    return day.getFullYear() === now.getFullYear() && day.getMonth() === now.getMonth() && day.getDate() === now.getDate();
  }
  // Legacy entries carry a Bengali date rather than a machine timestamp.
  return latinDigits(tx.date).trim() === latinDigits(dateLabel(now));
}
function ownToday(records, username, now) {
  return newestTransactions(records.filter(tx => isToday(tx,now) &&
    (tx.counterUsername ? tx.counterUsername === username : tx.collectedBy === 'পেমেন্ট কাউন্টার'))).map(counterReceiptView);
}
export async function listCounterTodayTransactions() {
  const now = new Date();
  const username = await assertCounterActor();
  return ownToday(await financeRepository.listTransactions({ role: 'payment' }),username,now);
}
export async function saveCounterPayment(input) {
  const now = new Date();
  const username = await assertCounterActor();
  const student = roster().find(row => row.id === input.studentId);
  const amount = Number(latinDigits(input.amount));
  if (!student || !Number.isSafeInteger(amount) || amount <= 0 || amount > 10000000 ||
      !feeCategories.includes(input.feeType) || !paymentMethods.includes(input.method) ||
      typeof input.month !== 'string' || !input.month.trim()) {
    throw new Error('শিক্ষার্থী ও পেমেন্টের তথ্য সঠিকভাবে পূরণ করুন।');
  }
  const tx = stampTransaction({
    id:newId('T',now), studentId:student.id,
    studentName:student.name || student.nameBn || student.nameEn || 'শিক্ষার্থী',
    uniqueRoll:rollOf(student), className:student.className || '',
    feeType:input.feeType, month:input.month.trim(), amount, method:input.method,
    trxRef:String(input.trxRef || '').trim().slice(0,120),
    collectedBy:'পেমেন্ট কাউন্টার', counterUsername:username,
    status:'pending', reviewHistory:[], note:''
  },now);
  // Pending-only and durable-before-receipt invariants remain in the repository.
  const rows = await financeRepository.saveTransaction(tx,{counterReceipt:true,serialTransaction:true,receiptDate:now});
  return { transaction:counterReceiptView(rows.find(row => row.id === tx.id)), today:ownToday(rows,username,now) };
}
