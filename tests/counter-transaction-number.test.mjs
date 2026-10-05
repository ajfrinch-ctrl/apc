import test, {beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {financeRepository,TRANSACTIONS_KEY} from '../js/finance-data.js';
import {STAFF_ACCOUNTS} from '../js/staff-auth.js';
let data;
beforeEach(()=>{
 data=new Map();
 data.set(STAFF_ACCOUNTS.payment.accountKey,JSON.stringify({role:'payment',username:STAFF_ACCOUNTS.payment.username,status:'active'}));
 const sessionStorage={getItem:key=>key===STAFF_ACCOUNTS.payment.sessionKey?'1':null,setItem:()=>{},removeItem:()=>{}};
 globalThis.window={localStorage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value))},sessionStorage};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
});
const date=new Date(2026,9,1);
const tx=id=>({id,studentId:'S',amount:800});
const save=(id,now=date)=>financeRepository.saveTransaction(tx(id),{serialTransaction:true,receiptDate:now});
test('public IDs start T26001/T26002, independent from immutable storage keys',async()=>{
 const first=(await save('opaque-1'))[0];assert.equal(first.transactionNo,'T26001');assert.equal(first.id,'opaque-1');
 const second=(await save('opaque-2'))[0];assert.equal(second.transactionNo,'T26002');assert.equal(second.id,'opaque-2');
});
test('serials do not reset at day/month boundaries and use the current year prefix',async()=>{
 await save('a');assert.equal((await save('b',new Date(2026,9,2)))[0].transactionNo,'T26002');
 assert.equal((await save('c',new Date(2026,10,1)))[0].transactionNo,'T26003');
 assert.equal((await save('d',new Date(2027,0,1)))[0].transactionNo,'T27001');
});
test('the ordinal continues past 999 and skips existing plain/legacy public numbers',async()=>{
 data.set(TRANSACTIONS_KEY,JSON.stringify([{...tx('old'),transactionNo:'T26999'},{...tx('T261002')} ]));
 assert.equal((await save('new'))[0].transactionNo,'T261003');
});
test('retries retain their first public number and historical records are never renamed',async()=>{
 const old={...tx('OLD'),transactionNo:'T26007',receiptNo:'KEEP'};data.set(TRANSACTIONS_KEY,JSON.stringify([old]));
 await save('NEW');await save('NEW');const rows=await save('NEXT');
 assert.equal(rows[0].transactionNo,'T26009');assert.equal(rows[1].transactionNo,'T26008');assert.deepEqual(rows[2],old);
});
test('a failed write consumes no serial and forged caller numbers cannot override allocation',async()=>{
 window.localStorage.setItem=()=>{throw new Error('QuotaExceededError')};await assert.rejects(()=>save('a'));
 window.localStorage.setItem=(key,value)=>data.set(key,String(value));
 const rows=await financeRepository.saveTransaction({...tx('a'),transactionNo:'T26888'},{serialTransaction:true,receiptDate:date});assert.equal(rows[0].transactionNo,'T26001');
});
