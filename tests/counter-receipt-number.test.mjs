import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { financeRepository, TRANSACTIONS_KEY } from '../js/finance-data.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
let data;
beforeEach(() => {
  data = new Map();
  const storage = { getItem:key=>data.get(key) ?? null, setItem:(key,value)=>data.set(key,String(value)) };
  data.set(STAFF_ACCOUNTS.payment.accountKey, JSON.stringify({ role: 'payment', username: STAFF_ACCOUNTS.payment.username, status: 'active' }));
  const sessionStorage = { getItem:key=>key === STAFF_ACCOUNTS.payment.sessionKey ? '1' : null, setItem:()=>{}, removeItem:()=>{} };
  globalThis.window = { localStorage:storage, sessionStorage };
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
});
const date = new Date(2026,9,1,16,30);
const tx = id => ({id,studentId:'TEST-S',studentName:'নমুনা',amount:800,recordedAt:date.getTime(),status:'approved'});
const save = (id, receiptDate=date) => financeRepository.saveTransaction(tx(id),{counterReceipt:true,receiptDate});

test('counter receipts are exactly R + YYMMDD + three daily digits, without a suffix', async () => {
  let rows = await save('T-1');
  assert.equal(rows[0].receiptNo,'R261001001');
  rows = await save('T-2');
  assert.equal(rows[0].receiptNo,'R261001002');
  assert.equal(rows[0].status,'pending');
  assert.match(rows[0].receiptNo,/^R\d{9}$/);
});
test('the receipt sequence resets on a new local calendar day and year', async () => {
  await save('T-1');
  assert.equal((await save('T-2',new Date(2026,9,2)))[0].receiptNo,'R261002001');
  assert.equal((await save('T-3',new Date(2027,0,1)))[0].receiptNo,'R270101001');
});
test('existing plain and legacy-suffixed receipts set the floor; historical numbers stay untouched', async () => {
  const legacy = { ...tx('OLD'),receiptNo:'R261001007-0011223344556677',status:'approved' };
  data.set(TRANSACTIONS_KEY,JSON.stringify([legacy]));
  const rows = await save('NEW');
  assert.equal(rows[0].receiptNo,'R261001008');
  assert.deepEqual(rows[1],legacy);
});
test('idempotent saves preserve the first receipt and do not consume a new ordinal', async () => {
  await save('T-1'); await save('T-1');
  const rows = await save('T-2');
  assert.equal(rows.length,2); assert.equal(rows[0].receiptNo,'R261001002');
  assert.equal(rows[1].receiptNo,'R261001001');
});
test('three-digit overflow is refused, never expanded or given a random suffix', async () => {
  data.set(TRANSACTIONS_KEY,JSON.stringify([{ ...tx('OLD'),receiptNo:'R261001999'}]));
  const before = data.get(TRANSACTIONS_KEY);
  await assert.rejects(()=>save('NEW'),/৯৯৯|999|ক্রমিক/);
  assert.equal(data.get(TRANSACTIONS_KEY),before);
});
test('a failed durable write or corrupt ledger does not print/consume a receipt', async () => {
  window.localStorage.setItem=()=>{throw new Error('QuotaExceededError')};
  await assert.rejects(()=>save('T-1'),/Quota/);
  window.localStorage.setItem=(key,value)=>data.set(key,String(value));
  assert.equal((await save('T-1'))[0].receiptNo,'R261001001');
  data.set(TRANSACTIONS_KEY,'broken');
  await assert.rejects(()=>save('T-2'));
  assert.equal(data.get(TRANSACTIONS_KEY),'broken');
});
test('normal non-counter saves retain their supplied receipt and existing repository contract', async () => {
  const entry={...tx('LEGACY'),receiptNo:'KEEP-OLD'};
  const rows=await financeRepository.saveTransaction(entry);
  assert.equal(rows[0].receiptNo,'KEEP-OLD'); assert.equal(rows[0].status,'pending');
});
