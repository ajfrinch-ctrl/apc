/* Cash Counter panel: হোম · শিক্ষার্থী · পেমেন্ট · রিপোর্ট · আরও (one seat per job step).
   The counter still sees no roster, dues, detailed profile or contact-sharing view:
   সার্চ = identity only, আরও = session/storage, and every figure comes from the one
   ledger through counter-data.js — the panel never writes a second copy. */
import { feeCategories, paymentMethods } from './admin-data.js';
import { monthLabel } from './finance-data.js';
import { searchCounterStudents, listCounterTodayTransactions, saveCounterPayment } from './counter-data.js';
import { mountCounterReports } from './counter-reports.js';
import { receiptMarkup, downloadReceipt } from './finance-receipt.js';
import { toBanglaNumber as bn } from './ui.js';
import { escapeHtml as esc } from './sanitize.js';
import { registerServiceWorker } from './service-worker.js';
import { goToLoginPage } from './staff-auth.js';
import { installPanelGuard, lockPanel, rememberPanelPage, watchOwnPanelSession } from './panel-lockdown.js';
import { PAYMENT_USER_ID, PAYMENT_SESSION_KEY, hasPaymentSession, clearPaymentSession } from './payment-auth.js';
import { readStaffAccount } from './staff-auth.js';
import { initAppearance } from './appearance.js';
import { mountSettingsHub } from './settings-hub.js';
import { openStaffPasswordDialog } from './staff-password-dialog.js';
export { PAYMENT_USER_ID };

registerServiceWorker();
const $ = selector => document.querySelector(selector);
const state = { view:'home', matches:[], selected:null, today:[], ready:false, saving:false, receipt:null, queryVersion:0, afterReceipt:null };
/* One seat per step of the counter's job: search → entry → verify → receipt →
   daily collection → history. Old names stay valid for anything already open. */
const COUNTER_VIEWS = Object.freeze(['home','students','payment','reports','more']);
const COUNTER_VIEW_TITLES = Object.freeze({ home:'আজকের লেনদেন', students:'শিক্ষার্থী', payment:'পেমেন্ট এন্ট্রি', reports:'পেমেন্ট রিপোর্ট', more:'আরও' });
const COUNTER_VIEW_ALIASES = Object.freeze({ today:'home', history:'reports' });
const search = $('#payStudentSearch');
const reports = mountCounterReports($('#paymentReports'));
function showCounterView(view) {
  const target=COUNTER_VIEW_ALIASES[view] || view;
  if (!COUNTER_VIEWS.includes(target) || state.saving) return false;
  state.view=target;
  document.querySelectorAll('[data-pay-panel]').forEach(panel=>{panel.hidden=panel.dataset.payPanel!==target;});
  $('#payReportsCard').hidden=target!=='reports';
  $('#counterViewTitle').textContent=COUNTER_VIEW_TITLES[target];
  document.querySelectorAll('.admin-bottom [data-pay-section]').forEach(seat=>{
    const active=seat.dataset.paySection===target;
    seat.classList.toggle('active',active);
    if(active)seat.setAttribute('aria-current','page');else seat.removeAttribute('aria-current');
  });
  return true;
}
const money = value => `৳${bn(Number(value || 0).toLocaleString('en-US'))}`;
const status = tx => tx.status === 'pending' ? 'অনুমোদন বাকি' : tx.status === 'rejected' ? 'বাতিল' : 'অনুমোদিত';
function toast(message, tone='info') {
  const el=$('#payToast'); el.textContent=message; el.dataset.tone=tone; el.hidden=false;
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>{el.hidden=true;},3400);
}
function options(select, values) {
  select.replaceChildren(...values.map(value => new Option(value,value)));
}
function configureForm() {
  options($('#payFeeType'),feeCategories);
  options($('#payFeeMethod'),paymentMethods);
  const now=new Date(), months=[];
  for(let offset=0;offset>=-12;offset--) months.push(monthLabel(new Date(now.getFullYear(),now.getMonth()+offset,1)));
  options($('#payFeeMonth'),months);
}
function renderToday() {
  $('#payTodayList').innerHTML=state.today.length ? state.today.map(tx=>`
    <button class="pay-activity-row" type="button" data-pay-tx="${esc(tx.id)}">
      <span class="pay-activity-copy"><strong>${esc(tx.studentName)}</strong><small>${tx.transactionNo ? `${esc(tx.transactionNo)} · ` : ''}${esc(tx.receiptNo || tx.id)} · ${esc(tx.method)} · ${status(tx)}</small></span>
      <span class="pay-activity-amount">${money(tx.amount)}</span>
    </button>`).join('') : '<p class="admin-empty">আজ এখনও কোনো লেনদেন নেই।</p>';
}
async function refreshToday() {
  try {
    const rows=await listCounterTodayTransactions();
    if($('#payShell').hidden) return;
    state.today=rows; state.ready=true; $('#paymentMain').dataset.counterReady='true'; $('#payLoadError').hidden=true;
  } catch {
    state.ready=false; state.today=[]; $('#paymentMain').dataset.counterReady='false';
    $('#payLoadError').textContent='লেনদেনের ডেটা পড়া যায়নি। ডেটা নিরাপদ রাখতে পেমেন্ট বন্ধ আছে। আবার চেষ্টা করুন।';
    $('#payLoadError').hidden=false;
  }
  renderToday();
  const collect=$('#payProfileCollect'); if(collect) collect.disabled=!state.ready || state.saving;
  $('#paySaveButton').disabled=!state.ready || state.saving;
}
const ENTRY_EMPTY='কোনো শিক্ষার্থী নির্বাচিত নেই — শিক্ষার্থী বিভাগে সার্চ করে যাচাই করুন।';
function clearSelection() {
  state.selected=null;
  $('#payQuickProfile').replaceChildren(); $('#payProfileCard').hidden=true;
  $('#payCollectionForm').hidden=true; $('#payCollectionForm').reset();
  $('#paySaveError').hidden=true;
  $('#payEntryStudent').textContent=ENTRY_EMPTY; $('#payEntrySearch').hidden=false;
}
function renderResults() {
  $('#paySearchResults').innerHTML=state.matches.map(student=>`
    <button class="fee-search-result" type="button" data-pay-student="${esc(student.id)}">
      <span><strong>${esc(student.name)}</strong><small>Student ID: ${esc(student.id)}${student.uniqueRoll ? ` · ইউনিক রোল: ${esc(student.uniqueRoll)}` : ''}</small>${student.mobileMasked && student.mobileMasked !== '—' ? `<small>মোবাইল: ${esc(student.mobileMasked)}</small>` : ''}${student.guardianMobileMasked && student.guardianMobileMasked !== '—' ? `<small>অভিভাবক: ${esc(student.guardianMobileMasked)}</small>` : ''}</span>
    </button>`).join('');
}
async function findStudents() {
  const version=++state.queryVersion, query=search.value.trim();
  clearSelection(); state.matches=[]; renderResults(); $('#paySearchClear').hidden=!query;
  if(!query) {$('#paySearchStatus').textContent='';return;}
  if([...query].length<2) {$('#paySearchStatus').textContent='নাম, ID, রোল বা মোবাইল লিখুন।';return;}
  $('#paySearchStatus').textContent='খোঁজা হচ্ছে…';
  try {
    const matches=await searchCounterStudents(query);
    if(version!==state.queryVersion || $('#payShell').hidden) return;
    state.matches=matches; renderResults();
    $('#paySearchStatus').textContent=matches.length ? `${bn(matches.length)}টি মিল পাওয়া গেছে` : 'কোনো মিল পাওয়া যায়নি।';
  } catch {
    if(version!==state.queryVersion) return;
    $('#paySearchStatus').textContent='সার্চ সম্পন্ন হয়নি। সংরক্ষিত ডেটা ও সেশন পরীক্ষা করুন।';
  }
}
function selectStudent(id) {
  if(state.saving) return;
  const student=state.matches.find(row=>row.id===id); if(!student) return;
  clearSelection(); state.selected=student;
  // The entered phone is a lookup secret, not a retained profile field.
  search.value=''; $('#paySearchClear').hidden=true;
  $('#paySearchResults').replaceChildren(); $('#paySearchStatus').textContent='';
  $('#payQuickProfile').innerHTML=`<div><strong>${esc(student.name)}</strong><small>Student ID: ${esc(student.id)}${student.uniqueRoll ? ` · ইউনিক রোল: ${esc(student.uniqueRoll)}` : ''}</small>${student.mobileMasked && student.mobileMasked !== '—' ? `<small>মোবাইল: ${esc(student.mobileMasked)}</small>` : ''}${student.guardianMobileMasked && student.guardianMobileMasked !== '—' ? `<small>অভিভাবক: ${esc(student.guardianMobileMasked)}</small>` : ''}</div><button id="payProfileCollect" class="admin-btn primary" type="button" ${!state.ready?'disabled':''}>পেমেন্ট নিন</button>`;
  $('#payProfileCard').hidden=false;
  $('#payProfileCard').scrollIntoView({block:'nearest',behavior:'smooth'});
}
function openForm() {
  if(!state.selected || !state.ready || state.saving) return;
  const form=$('#payCollectionForm');
  if(form.hidden) {
    form.reset(); $('#payStudent').value=state.selected.id;
    $('#paySaveError').hidden=true; form.hidden=false;
    /* The verify card names who the entry is for; the entry panel takes over. */
    $('#payEntryStudent').textContent=`${state.selected.name} · Student ID: ${state.selected.id}`;
    $('#payEntrySearch').hidden=true; $('#payProfileCollect').hidden=true;
  }
  showCounterView('payment');
  $('#payFeeAmount').focus({preventScroll:true});
}
search.addEventListener('input',()=>{if(!state.saving) void findStudents();});
$('#paySearchClear').addEventListener('click',()=>{if(state.saving)return;search.value='';void findStudents();search.focus();});
$('#payCancelButton').addEventListener('click',()=>{if(state.saving)return;clearSelection();showCounterView('students');search.focus();});
$('#payActivityRefresh').addEventListener('click',()=>{void refreshToday();});
document.addEventListener('click',event=>{
  const seat=event.target.closest('[data-pay-section]');
  if(seat) {showCounterView(seat.dataset.paySection);return;}
  if(event.target.closest('#payClosingShortcut')) {if(showCounterView('reports')) reports.preset('cash.closing');return;}
  if(event.target.closest('#payMoreLogout')) {exitCounter();return;}
  const student=event.target.closest('[data-pay-student]'); if(student) selectStudent(student.dataset.payStudent);
  if(event.target.closest('#payProfileCollect')) openForm();
  const trigger=event.target.closest('[data-pay-tx]');
  if(trigger) {const tx=state.today.find(row=>row.id===trigger.dataset.payTx);if(tx) openReceipt(tx);}
});

$('#payCollectionForm').addEventListener('submit',async event=>{
  event.preventDefault(); const form=event.currentTarget;
  if(state.saving || !state.ready || form.hidden || !state.selected) return;
  if(!form.reportValidity()) return;
  const selected=state.selected;
  if($('#payStudent').value!==selected.id) return;
  const fields={studentId:selected.id,amount:$('#payFeeAmount').value,feeType:$('#payFeeType').value,
    month:$('#payFeeMonth').value,method:$('#payFeeMethod').value,trxRef:$('#payFeeTrxId').value};
  state.saving=true; form.setAttribute('aria-busy','true'); $('#paySaveError').hidden=true;
  const controls=[...form.querySelectorAll('input,select,button')]; controls.forEach(el=>{el.disabled=true;});
  search.disabled=true; $('#paySearchClear').disabled=true; $('#paySaveLabel').textContent='সংরক্ষণ হচ্ছে…';
  let saved;
  try {saved=await saveCounterPayment(fields);}
  catch(error) {
    $('#paySaveError').textContent=error?.message || 'পেমেন্ট সংরক্ষণ হয়নি। ব্রাউজারের স্টোরেজ/খালি জায়গা পরীক্ষা করে আবার চেষ্টা করুন।';
    $('#paySaveError').hidden=false;
  } finally {
    state.saving=false; form.removeAttribute('aria-busy'); controls.forEach(el=>{el.disabled=false;});
    search.disabled=false; $('#paySearchClear').disabled=false; $('#paySaveLabel').textContent='পেমেন্ট সংরক্ষণ করুন';
  }
  if(!saved || $('#payShell').hidden) return;
  state.today=saved.today; renderToday();
  clearSelection(); search.value=''; state.matches=[]; renderResults(); $('#paySearchStatus').textContent=''; $('#paySearchClear').hidden=true;
  toast('পেমেন্ট সংরক্ষিত হয়েছে; অনুমোদন বাকি।','success');
  state.afterReceipt='home';
  openReceipt(saved.transaction);
});
async function openReceipt(tx) {
  if (!(await hasPaymentSession()) || $('#payShell').hidden) return;
  state.receipt=tx;
  $('#payReceiptTitle').textContent=tx.status==='pending'?'অস্থায়ী পেমেন্ট স্লিপ':tx.status==='rejected'?'বাতিল পেমেন্ট এন্ট্রি':'মানি রসিদ';
  $('#payReceiptSub').textContent=`রসিদ নং: ${tx.receiptNo || tx.id}`;
  $('#payReceiptBody').innerHTML=receiptMarkup(tx);
  $('#payReceiptBackdrop').hidden=false; document.body.classList.add('admin-modal-open');
}
function closeReceipt() {
  $('#payReceiptBackdrop').hidden=true; document.body.classList.remove('admin-modal-open'); state.receipt=null;
  /* entry → receipt → daily collection: closing a fresh slip lands on today's list. */
  const landing=state.afterReceipt; state.afterReceipt=null;
  if(landing) showCounterView(landing);
  $('#payActivityRefresh').focus({preventScroll:true});
}
/* A rejected-entry notification deep-links to that entry's own slip (§25). */
window.addEventListener('apc-notification-action',event=>{
  if(event.detail?.kind!=='payment-rejected') return;
  const tx=state.today.find(row=>row.id===event.detail.id);
  if(tx) openReceipt(tx);
});
$('#payReceiptClose').addEventListener('click',closeReceipt);
$('#payReceiptBackdrop').addEventListener('click',event=>{if(event.target===event.currentTarget)closeReceipt();});
$('#payReceiptDownload').addEventListener('click',async()=>{
  if(!state.receipt || !(await hasPaymentSession()) || $('#payShell').hidden) return;
  const button=$('#payReceiptDownload'); button.disabled=true;
  try {await downloadReceipt(state.receipt);} catch {toast('PDF তৈরি করা যায়নি। আবার চেষ্টা করুন।','error');}
  finally {button.disabled=false;}
});
function exitCounter() {
  clearPaymentSession(); ++state.queryVersion; state.matches=[]; state.today=[];
  clearSelection(); closeReceipt(); $('#payTodayList').replaceChildren(); $('#paySearchResults').replaceChildren();
  $('#payShell').hidden=true; goToLoginPage();
}
$('#payExitButton').addEventListener('click',exitCounter);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && !$('#payReceiptBackdrop').hidden) closeReceipt();
  if(event.key==='/' && !$('#payShell').hidden && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) {event.preventDefault();search.focus();}
});
window.addEventListener('storage',async event=>{
  if ((!event.key || event.key===PAYMENT_SESSION_KEY) && !(await hasPaymentSession())) {
    await lockPanel({ role: 'payment.html', reason: 'কাউন্টারের সেশন শেষ হয়েছে। নিরাপত্তার জন্য তথ্য বন্ধ করা হয়েছে।' });
    return;
  }
  if(!event.key || event.key==='activePlus.admin.transactions.v1') void refreshToday();
  if(!event.key || event.key==='activePlus.admin.students.v1') {++state.queryVersion;state.matches=[];renderResults();clearSelection();}
});
// The shared role guard hides the shell when its session ends. Purge its
// query/receipt surfaces too, including the dialog outside that shell.
new MutationObserver(() => {
  if (!$('#payShell').hidden) return;
  ++state.queryVersion; state.matches=[]; state.today=[]; state.ready=false;
  reports.reset(); showCounterView('home');
  clearSelection(); closeReceipt();
  $('#payReceiptBody').replaceChildren(); $('#payReceiptSub').textContent='';
  $('#payTodayList').replaceChildren(); renderResults(); search.value='';
  $('#paySearchStatus').textContent=''; $('#paymentMain').dataset.counterReady='false';
}).observe($('#payShell'), { attributes:true, attributeFilter:['hidden'] });

// A screen left open overnight never retains yesterday's ledger rows.
let day=new Date().toDateString();
const checkDay=()=>{const current=new Date().toDateString();if(current!==day){day=current;$('#payCurrentDate').textContent=new Intl.DateTimeFormat('bn-BD',{day:'numeric',month:'long',year:'numeric'}).format(new Date());void refreshToday();}};
setInterval(checkDay,30000);
window.addEventListener('focus',checkDay); document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDay();});

installPanelGuard(); void rememberPanelPage();
hasPaymentSession().then(async valid=>{
  if(!valid) return lockPanel({ role: 'payment.html', reason: 'পেমেন্ট কাউন্টার শুধু কাউন্টারের বৈধ সেশন দিয়ে খোলে।'});
  $('#payShell').hidden=false; watchOwnPanelSession('payment');
  $('#payCurrentDate').textContent=new Intl.DateTimeFormat('bn-BD',{day:'numeric',month:'long',year:'numeric'}).format(new Date());
  try {const account=await readStaffAccount('payment');$('#payMoreUser').textContent=account?.fullName || account?.username || PAYMENT_USER_ID;}
  catch {$('#payMoreUser').textContent=PAYMENT_USER_ID;}
  // আরও → the same five Settings groups every role gets. The counter's own rows
  // (নিজের তথ্য, লগআউট) stay put; the hub adds app/security/data where missing.
  mountSettingsHub({
    mount: '#payMorePanel',
    role: 'payment',
    actions: {
      /* The counter changes its own password through the same dialog every staff
         role uses (js/staff-password-dialog.js → setStaffPassword('payment')). */
      password: () => openStaffPasswordDialog({ role: 'payment', mode: 'change' }),
      logout: () => exitCounter()
    },
    session: { value: 'ডিভাইস-বাউন্ড কাউন্টার সেশন', hint: 'পেমেন্ট কাউন্টার সেশন' }
  });
  initAppearance();
  configureForm(); showCounterView('home'); await refreshToday();
});
