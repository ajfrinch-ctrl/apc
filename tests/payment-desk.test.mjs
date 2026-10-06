/* Counter 146 acceptance: today-only ledger, identity-only query search,
   simple input/select form and durable pending receipt with no suffix. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { adminStudents, paymentMethods } from '../js/admin-data.js';
import { KEYS } from '../js/database.js';
import { dateLabel } from '../js/finance-data.js';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
let ctx;
const person={...adminStudents.find(row=>row.id==='AP-1024'),uniqueRoll:'261001001',address:'PRIVATE-ADDRESS',fatherName:'PRIVATE-GUARDIAN'};
const now=new Date();
const row=(id,extra={})=>({id,receiptNo:id,studentId:person.id,studentName:person.name,amount:500,method:'নগদ (Cash)',feeType:'মাসিক বেতন',month:'নমুনা',date:dateLabel(now),recordedAt:now.getTime(),collectedBy:'পেমেন্ট কাউন্টার',status:'pending',...extra});
before(async()=>{
 ctx=await loadPage('payment.html',{seed:{'activePlus.demo.autofill.v1':'off',[KEYS.students]:JSON.stringify([person]),[KEYS.transactions]:JSON.stringify([row('TODAY'),row('YESTERDAY',{recordedAt:now.getTime()-86400000}),row('ADMIN',{collectedBy:'এডমিন'})])}});
 await provisionStaff('payment');seedStaffSession(ctx.window,'payment');
 await import('../js/payment.js');
 await ctx.waitFor(()=>ctx.$('#paymentMain').dataset.counterReady==='true');
});
test('the counter opens on হোম from a genuine session, never a directory/dashboard',()=>{
 const {$,$$}=ctx;
 assert.equal($('#payShell').hidden,false);
 /* Five seats, one per step of the counter's own job. */
 assert.deepEqual($$('.admin-bottom [data-pay-section]').map(seat=>seat.dataset.paySection),['home','students','payment','reports','more']);
 assert.equal($('.admin-bottom [aria-current="page"]').dataset.paySection,'home');
 assert.equal($('[data-pay-panel="home"]').hidden,false);
 for(const view of ['students','payment','reports','more']) assert.equal($(`[data-pay-panel="${view}"]`).hidden,true,view);
 assert.equal($('#payProfileCard').hidden,true);assert.equal($('#payCollectionForm').hidden,true);
 assert.equal($$('#paySearchResults .fee-search-result').length,0);
 assert.equal($$('#payTodayList .pay-activity-row').length,1);
 assert.match($('#payTodayList').textContent,/TODAY/);assert.doesNotMatch($('#payTodayList').textContent,/YESTERDAY|ADMIN/);
 /* The narrowed counter still has no wallet dashboard, no academic surface. */
 for(const selector of ['#payPulse','#payTodayAmount','#payMonthAmount','#payDueStudents','#payQuickPicks','#payKeypad','#payStickyBar','#payDeskTools','#payReceiptWhatsApp','[data-academic-section]','[data-view-panel]']) assert.equal($(selector),null,selector);
 assert.equal($('#payLoginForm'),null);
 assert.equal($('#payReportsCard').hidden,true);
 assert.equal($('#paymentReports').closest('[data-pay-panel]').dataset.payPanel,'reports');
 assert.ok($('#paymentReports'));
});

test('each seat opens its own step and the counter can walk the whole job',async()=>{
 const {$,$$,click,waitFor}=ctx;
 for(const [seat,title] of [['students','শিক্ষার্থী'],['payment','পেমেন্ট এন্ট্রি'],['reports','পেমেন্ট রিপোর্ট'],['more','আরও'],['home','আজকের লেনদেন']]) {
  click($(`.admin-bottom [data-pay-section="${seat}"]`));
  assert.equal($(`[data-pay-panel="${seat}"]`).hidden,false,seat);
  assert.equal($(`.admin-bottom [aria-current="page"]`).dataset.paySection,seat);
  assert.equal($('#counterViewTitle').textContent,title);
 }
 /* হোম → আজকের ক্লোজিং preselects the day's own closing report. */
 click($('#payClosingShortcut'));
 assert.equal($('[data-pay-panel="reports"]').hidden,false);
 assert.equal($('#paymentReports select[name="report"]').value,'cash.closing');
 assert.equal($('#paymentReports .counter-report-preview').textContent,'','no preview before Generate');
 /* আরও carries the session, not a student directory. */
 click($('.admin-bottom [data-pay-section="more"]'));
 assert.ok($('#payMoreUser').textContent.trim());
 assert.equal($$('#payMoreCard [data-pay-section]:not(#payEntrySearch)').length,0,'আরও is not a second menu');
 assert.equal($('[data-pay-panel="more"] .fee-search-result'),null);
 click($('.admin-bottom [data-pay-section="home"]'));
 await waitFor(()=>$('#payTodayList .pay-activity-row'));
});
test('name, ID and unique roll search render only identity; phones/guardian/classes are not search keys',async()=>{
 const {$,$$,type,click,waitFor}=ctx;
 for(const query of ['রাইসা','AP-1024','২৬১০০১০০১']) {
  type($('#payStudentSearch'),query);
  await waitFor(()=>$$('#paySearchResults .fee-search-result').length===1);
  assert.match($('#paySearchResults').textContent,/রাইসা ইসলাম/);
  assert.match($('#paySearchResults').textContent,/AP-1024/);
  assert.match($('#paySearchResults').textContent,/261001001/);
  assert.doesNotMatch($('#paySearchResults').textContent,/বকেয়া|মোবাইল|অভিভাবক|দশম|PRIVATE|017|018/);
 }
 click($('#paySearchResults .fee-search-result'));
 assert.equal($('#payProfileCard').hidden,false);
 assert.doesNotMatch($('#payQuickProfile').textContent,/বকেয়া|মোবাইল|অভিভাবক|দশম|PRIVATE|017|018/);
 for(const query of ['PRIVATE-GUARDIAN','দশম শ্রেণি']) {
  type($('#payStudentSearch'),query);
  await waitFor(()=>$('#paySearchStatus').textContent==='কোনো মিল পাওয়া যায়নি।');
  assert.equal($$('#paySearchResults .fee-search-result').length,0);
 }
});
test('query clear removes previous identity and an empty query never enumerates students',async()=>{
 ctx.type(ctx.$('#payStudentSearch'),'রাইসা');await ctx.waitFor(()=>ctx.$('#paySearchResults .fee-search-result'));
 ctx.click(ctx.$('#paySearchResults .fee-search-result'));
 ctx.click(ctx.$('#paySearchClear'));
 assert.equal(ctx.$('#payProfileCard').hidden,true);
 assert.equal(ctx.$('#payQuickProfile').textContent,'');assert.equal(ctx.$('#paySearchResults').textContent,'');
});
test('a forged result/hidden student ID cannot select another record',()=>{
 const button=ctx.window.document.createElement('button');button.dataset.payStudent='NO-STUDENT';ctx.window.document.body.append(button);ctx.click(button);button.remove();
 assert.equal(ctx.$('#payProfileCard').hidden,true);
});
test('simple payment starts with an empty amount and one method select, never a guessed due',async()=>{
 const {$,type,click,waitFor}=ctx;
 type($('#payStudentSearch'),'AP-1024');await waitFor(()=>$('#paySearchResults .fee-search-result'));
 click($('#paySearchResults .fee-search-result'));await waitFor(()=>!$('#payProfileCollect').disabled);click($('#payProfileCollect'));
 assert.equal($('#payCollectionForm').hidden,false);assert.equal($('#payFeeAmount').value,'');
 assert.deepEqual([...$('#payFeeMethod').options].map(option=>option.value),[...paymentMethods]);
 assert.equal($('#payFeeMethod').value,'নগদ (Cash)');
 assert.doesNotMatch($('#payQuickProfile').textContent,/বকেয়া|মোবাইল|দশম/);
 /* The entry panel takes the screen; the verify step keeps its own seat. */
 assert.equal($('[data-pay-panel="payment"]').hidden,false);
 assert.equal($('[data-pay-panel="students"]').hidden,true);
 assert.equal($('.admin-bottom [aria-current="page"]').dataset.paySection,'payment');
 assert.equal($('#payEntryStudent').textContent,`${person.name} · Student ID: ${person.id}`);
 assert.equal($('#payProfileCollect').hidden,true);
});
test('invalid amounts/forged methods do not write a payment',async()=>{
 const {$,type,submit,waitFor,window}=ctx;
 const before=window.localStorage.getItem(KEYS.transactions);
 type($('#payFeeAmount'),'-1');submit($('#payCollectionForm'));
 await waitFor(()=>!$('#paySaveError').hidden);
 assert.equal(window.localStorage.getItem(KEYS.transactions),before);
});
test('a double click produces one durable pending entry and one exact-format receipt',async()=>{
 const {$,type,submit,waitFor,window}=ctx;
 type($('#payFeeAmount'),'800');$('#payFeeMethod').value='বিকাশ (bKash)';type($('#payFeeTrxId'),'SAMPLE-REF');
 submit($('#payCollectionForm'));submit($('#payCollectionForm'));
 await waitFor(()=>!$('#payReceiptBackdrop').hidden);
 const rows=JSON.parse(window.localStorage.getItem(KEYS.transactions));
 const added=rows.filter(row=>row.amount===800 && row.studentId===person.id);
 assert.equal(added.length,1);assert.match(added[0].receiptNo,/^R\d{9}$/);
 assert.equal(added[0].status,'pending');assert.equal(added[0].method,'বিকাশ (bKash)');
 assert.equal(added[0].trxRef,'SAMPLE-REF');assert.equal(added[0].className,person.className);
 assert.equal(added[0].mobile,undefined);
 assert.match($('#payReceiptSub').textContent,/^রসিদ নং: R\d{9}$/);
 assert.match($('#payReceiptBody').textContent,/৳৮০০/);
 assert.doesNotMatch($('#payReceiptBody').textContent,/দশম|অভিভাবক|PRIVATE|017000|018000/);
 assert.equal($('#payProfileCard').hidden,true);assert.equal($('#payCollectionForm').hidden,true);
 assert.equal(ctx.$$('#payTodayList .pay-activity-row').length,2);
});
test('today rows can reopen only their stored, sanitised receipt',async()=>{
 ctx.click(ctx.$('#payReceiptClose'));
 assert.equal(ctx.$('#payReceiptBackdrop').hidden,true);
 /* entry → receipt → daily collection. */
 assert.equal(ctx.$('[data-pay-panel="home"]').hidden,false);
 assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.paySection,'home');
 ctx.click(ctx.$('#payTodayList .pay-activity-row'));
 await ctx.waitFor(()=>!ctx.$('#payReceiptBackdrop').hidden);
 assert.match(ctx.$('#payReceiptSub').textContent,/R\d{9}/);
 ctx.click(ctx.$('#payReceiptClose'));
});
test('storage failure keeps the draft and never opens a receipt',async()=>{
 const {$,type,click,submit,waitFor,window}=ctx;
 type($('#payStudentSearch'),'AP-1024');await waitFor(()=>$('#paySearchResults .fee-search-result'));
 click($('#paySearchResults .fee-search-result'));click($('#payProfileCollect'));type($('#payFeeAmount'),'900');
 const original=window.localStorage.setItem.bind(window.localStorage);
 const proto=Object.getPrototypeOf(window.localStorage), native=proto.setItem;
 proto.setItem=function(key,value){if(key===KEYS.transactions)throw new Error('QuotaExceededError');return native.call(this,key,value)};
 try {submit($('#payCollectionForm'));await waitFor(()=>!$('#paySaveError').hidden);assert.equal($('#payReceiptBackdrop').hidden,true);assert.equal($('#payFeeAmount').value,'900');assert.equal($('#paySaveButton').disabled,false);} finally {proto.setItem=native;}
});
test('a rejected-entry notification opens that entry’s own slip, not a bare list',async()=>{
 const {$,$$,window}=ctx;
 const rows=JSON.parse(window.localStorage.getItem(KEYS.transactions));
 const target=rows.find(row=>row.amount===800);
 window.dispatchEvent(new window.CustomEvent('apc-notification-action',{detail:{kind:'payment-rejected',id:target.id}}));
 await ctx.waitFor(()=>!$('#payReceiptBackdrop').hidden);
 assert.match($('#payReceiptBody').textContent,/৳৮০০/);
 ctx.click($('#payReceiptClose'));
 assert.equal($('#payReceiptBackdrop').hidden,true);
 /* An id the counter cannot see opens nothing — no forged slip. */
 window.dispatchEvent(new window.CustomEvent('apc-notification-action',{detail:{kind:'payment-rejected',id:'NO-SUCH-ENTRY'}}));
 await ctx.flush(4);
 assert.equal($('#payReceiptBackdrop').hidden,true);
 /* The mapping lives in the notification module, the seat in the counter page. */
 const source=read('js/notifications.js');
 assert.match(source,/payment: 'data-pay-section'/);
 assert.match(source,/'payment-rejected': 'home'/);
 assert.equal($$('.admin-bottom [data-pay-section="home"]').length,1);
});

test('corrupt ledger disables payment instead of overwriting financial history',async()=>{
 const {$,window,waitFor}=ctx;
 window.localStorage.setItem(KEYS.transactions,'broken');window.dispatchEvent(new window.StorageEvent('storage',{key:KEYS.transactions}));
 await waitFor(()=>!$('#payLoadError').hidden);
 assert.equal($('#paySaveButton').disabled,true);assert.equal($('#payTodayList .pay-activity-row'),null);
 assert.equal(window.localStorage.getItem(KEYS.transactions),'broken');
});
