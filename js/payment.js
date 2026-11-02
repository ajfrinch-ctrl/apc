/* Cash Counter panel: restored - see full file in next commit */
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
import { mountSettingsHub, resetSettingsHub } from './settings-hub.js';
import { mountStaffAccountGroup } from './staff-account-forms.js';
import { mountProfileSelfEdit } from './staff-self-edit.js';
import { openStaffPasswordDialog } from './staff-password-dialog.js';
import { pickTeacherSectionAdvice } from './teacher-daily-advice.js';
import { initOrgInfo } from './org-info.js';
export { PAYMENT_USER_ID };

registerServiceWorker();
initOrgInfo();
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { view:'home', matches:[], selected:null, today:[], ready:false, saving:false, receipt:null, queryVersion:0, afterReceipt:null };
/* প্রতিটি স্ক্রিন আলাদা (মালিক-নির্দেশ ২০২৬-১১-০২): প্রোফাইল আর সেটিংস এক জায়গা নয়। */
const COUNTER_VIEWS = Object.freeze(['home','students','payment','reports','profile','more']);
const COUNTER_VIEW_TITLES = Object.freeze({ home:'আজকের লেনদেন', students:'শিক্ষার্থী', payment:'পেমেন্ট এন্ট্রি', reports:'পেমেন্ট রিপোর্ট', profile:'আমার প্রোফাইল', more:'আরও' });
const COUNTER_VIEW_ALIASES = Object.freeze({ today:'home', history:'reports' });
const search = $('#payStudentSearch');
const reports = mountCounterReports($('#paymentReports'));

function syncCounterHeading() {
  const root = document.documentElement;
  const isDark = root.getAttribute('data-theme') === 'dark' || root.classList.contains('dark') || document.body?.classList.contains('dark');
  const mode = isDark ? 'night' : 'day';
  const today = new Date();
  let wd = '';
  try {
    wd = new Intl.DateTimeFormat('bn-BD', { timeZone: 'Asia/Dhaka', weekday: 'long' }).format(today);
  } catch {
    wd = new Intl.DateTimeFormat('bn-BD', { weekday: 'long' }).format(today);
  }
  const datePart = new Intl.DateTimeFormat('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }).format(today);
  const fullDateLabel = `${wd} · ${datePart}`;

  $$('[data-home-intro]').forEach(card => {
    card.dataset.heroMode = mode;
  });
  $$('[data-pay-hero-date]').forEach(node => {
    node.textContent = fullDateLabel;
  });
  $$('[data-pay-hero-advice]').forEach(box => {
    const key = box.dataset.payHeroAdvice || 'finance';
    const p = box.querySelector('.teacher-hero-advice');
    const line = pickTeacherSectionAdvice(key);
    if (p && line) p.textContent = line;
  });
}

function showCounterView(view) {
  const target=COUNTER_VIEW_ALIASES[view] || view;
  if (!COUNTER_VIEWS.includes(target) || state.saving) return false;
  state.view=target;
  if (target === 'more') resetSettingsHub('[data-settings-hub="payment"]');
  document.querySelectorAll('[data-pay-panel]').forEach(panel=>{
    panel.hidden=panel.dataset.payPanel!==target;
    delete panel.dataset.payOpen;
  });
  $$('[data-pay-toggle]').forEach(btn => {
    btn.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  });
  $('#payReportsCard').hidden=target!=='reports';
  $('#counterViewTitle').textContent=COUNTER_VIEW_TITLES[target];
  document.querySelectorAll('.admin-bottom [data-panel-view]').forEach(seat=>{
    const active=seat.dataset.panelView===target;
    seat.classList.toggle('active',active);
    if(active)seat.setAttribute('aria-current','page');else seat.removeAttribute('aria-current');
  });
  // The counter's More surface is its Settings hub; every return starts at the
  // group menu instead of retaining a previous subsection.
  if(target==='more') resetSettingsHub('#payMorePanel');
  syncCounterHeading();
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
    if (!$('#paymentMain') || $('#payShell')?.hidden) return;
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
      <span><strong>${esc(student.name)}</strong><small>শিক্ষার্থীর আইডি: ${esc(student.id)}${student.uniqueRoll ? ` · ইউনিক রোল: ${esc(student.uniqueRoll)}` : ''}</small>${student.mobileMasked && student.mobileMasked !== '—' ? `<small>মোবাইল: ${esc(student.mobileMasked)}</small>` : ''}${student.guardianMobileMasked && student.guardianMobileMasked !== '—' ? `<small>অভিভাবক: ${esc(student.guardianMobileMasked)}</small>` : ''}</span>
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
  search.value=''; $('#paySearchClear').hidden=true;
  $('#paySearchResults').replaceChildren(); $('#paySearchStatus').textContent='';
  $('#payQuickProfile').innerHTML=`<div><strong>${esc(student.name)}</strong><small>শিক্ষার্থীর আইডি: ${esc(student.id)}${student.uniqueRoll ? ` · ইউনিক রোল: ${esc(student.uniqueRoll)}` : ''}</small>${student.mobileMasked && student.mobileMasked !== '—' ? `<small>মোবাইল: ${esc(student.mobileMasked)}</small>` : ''}${student.guardianMobileMasked && student.guardianMobileMasked !== '—' ? `<small>অভিভাবক: ${esc(student.guardianMobileMasked)}</small>` : ''}</div><button id="payProfileCollect" class="admin-btn primary" type="button" ${!state.ready?'disabled':''}>পেমেন্ট নিন</button>`;
  $('#payProfileCard').hidden=false;
  $('#payProfileCard').scrollIntoView({block:'nearest',behavior:'smooth'});
}
function openForm() {
  if(!state.selected || !state.ready || state.saving) return;
  const form=$('#payCollectionForm');
  if(form.hidden) {
    form.reset(); $('#payStudent').value=state.selected.id;
    $('#paySaveError').hidden=true; form.hidden=false;
    $('#payEntryStudent').textContent=`${state.selected.name} · শিক্ষার্থীর আইডি: ${state.selected.id}`;
    $('#payEntrySearch').hidden=true; $('#payProfileCollect').hidden=true;
  }
  showCounterView('payment');
  const entryPanel = $('#payEntryPanel');
  const entryBtn = $('[data-pay-toggle="payment-entry"]');
  if (entryPanel) entryPanel.dataset.payOpen = 'payment-entry';
  if (entryBtn) { entryBtn.classList.add('is-open'); entryBtn.setAttribute('aria-expanded', 'true'); }
  $('#payFeeAmount').focus({preventScroll:true});
}
search.addEventListener('input',()=>{
  const stuPanel = $('#payStudentsPanel');
  const stuBtn = $('[data-pay-toggle="student-search"]');
  if (stuPanel) stuPanel.dataset.payOpen = 'student-search';
  if (stuBtn) { stuBtn.classList.add('is-open'); stuBtn.setAttribute('aria-expanded', 'true'); }
  if(!state.saving) void findStudents();
});
$('#paySearchClear').addEventListener('click',()=>{if(state.saving)return;search.value='';void findStudents();search.focus();});
$('#payCancelButton').addEventListener('click',()=>{if(state.saving)return;clearSelection();showCounterView('students');search.focus();});
$('#payActivityRefresh').addEventListener('click',()=>{void refreshToday();});
document.addEventListener('click',event=>{
  const toggleBtn = event.target.closest('[data-pay-toggle]');
  if (toggleBtn) {
    const key = toggleBtn.dataset.payToggle || '';
    if (key === 'select-student') {
      showCounterView('students');
      const stuPanel = $('#payStudentsPanel');
      const stuBtn = $('[data-pay-toggle="student-search"]');
      if (stuPanel) stuPanel.dataset.payOpen = 'student-search';
      if (stuBtn) { stuBtn.classList.add('is-open'); stuBtn.setAttribute('aria-expanded', 'true'); }
      search.focus({ preventScroll: true });
      return;
    }
    const panel = toggleBtn.closest('[data-pay-panel]');
    if (panel) {
      const next = panel.dataset.payOpen === key ? '' : key;
      if (next) panel.dataset.payOpen = next;
      else delete panel.dataset.payOpen;
      panel.querySelectorAll('[data-pay-toggle]').forEach(btn => {
        const active = Boolean(next && btn.dataset.payToggle === next);
        btn.classList.toggle('is-open', active);
        btn.setAttribute('aria-expanded', active ? 'true' : 'false');
      });
    }
    return;
  }
  const seat=event.target.closest('[data-panel-view]');
  if(seat) {
    const targetSec = seat.dataset.panelView;
    showCounterView(targetSec);
    if (targetSec === 'students' && seat.closest('#payHomeCard, #payEntryPanel')) {
      const stuPanel = $('#payStudentsPanel');
      const stuBtn = $('[data-pay-toggle="student-search"]');
      if (stuPanel) stuPanel.dataset.payOpen = 'student-search';
      if (stuBtn) { stuBtn.classList.add('is-open'); stuBtn.setAttribute('aria-expanded', 'true'); }
    }
    return;
  }
  if(event.target.closest('#payClosingShortcut')) {
    if(showCounterView('reports')) {
      const repPanel = $('#payReportsPanel');
      const repBtn = $('[data-pay-toggle="reports-builder"]');
      if (repPanel) repPanel.dataset.payOpen = 'reports-builder';
      if (repBtn) { repBtn.classList.add('is-open'); repBtn.setAttribute('aria-expanded', 'true'); }
      reports.preset('cash.closing');
    }
    return;
  }
  if(event.target.closest('[data-settings-row="logout"]')) {exitCounter();return;}
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
  /* entry → receipt → daily collection */
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
  const landing=state.afterReceipt; state.afterReceipt=null;
  if(landing) showCounterView(landing);
  $('#payActivityRefresh').focus({preventScroll:true});
}
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
  clearPaymentSession();
  window.dispatchEvent(new Event('apc-session-ended'));
  ++state.queryVersion; state.matches=[]; state.today=[];
  clearSelection(); closeReceipt(); $('#payTodayList').replaceChildren(); $('#paySearchResults').replaceChildren();
  $('#payShell').hidden=true; goToLoginPage();
}
$('#payExitButton').addEventListener('click',exitCounter);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && !$('#payReceiptBackdrop').hidden) closeReceipt();
  if(event.key==='/' && !$('#payShell').hidden && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) {event.preventDefault();search.focus();}
});
function refreshCounterStudentsLive() {
  if (state.saving) return;
  if (search && search.value.trim().length >= 2 && !state.selected) {
    void findStudents();
    return;
  }
  ++state.queryVersion;
  state.matches=[];
  renderResults();
  if (!state.selected || $('#payCollectionForm')?.hidden) clearSelection();
}
window.addEventListener('storage',async event=>{
  if ((!event.key || event.key===PAYMENT_SESSION_KEY) && !(await hasPaymentSession())) {
    await lockPanel({ role: 'payment.html', reason: 'কাউন্টারের সেশন শেষ হয়েছে। নিরাপত্তার জন্য তথ্য বন্ধ করা হয়েছে।' });
    return;
  }
  if(!event.key || event.key==='activePlus.admin.transactions.v1') void refreshToday();
  if(!event.key || event.key==='activePlus.admin.students.v1') refreshCounterStudentsLive();
});
window.addEventListener('apc-sync-updated', event => {
  if ($('#payShell')?.hidden) return;
  const col = event?.detail?.collection;
  if (!col || col === 'transactions') void refreshToday();
  if (!col || col === 'students') refreshCounterStudentsLive();
});
new MutationObserver(() => {
  if (!$('#payShell').hidden) return;
  ++state.queryVersion; state.matches=[]; state.today=[]; state.ready=false;
  reports.reset(); showCounterView('home');
  clearSelection(); closeReceipt();
  $('#payReceiptBody').replaceChildren(); $('#payReceiptSub').textContent='';
  $('#payTodayList').replaceChildren(); renderResults(); search.value='';
  $('#paySearchStatus').textContent=''; $('#paymentMain').dataset.counterReady='false';
}).observe($('#payShell'), { attributes:true, attributeFilter:['hidden'] });

let day=new Date().toDateString();
const checkDay=()=>{const current=new Date().toDateString();if(current!==day){day=current;$('#payCurrentDate').textContent=new Intl.DateTimeFormat('bn-BD',{day:'numeric',month:'long',year:'numeric'}).format(new Date());syncCounterHeading();void refreshToday();}};
window.setInterval(checkDay,30000);
window.addEventListener('focus',checkDay); document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDay();});

installPanelGuard(); void rememberPanelPage();
hasPaymentSession().then(async valid=>{
  if(!valid) return lockPanel({ role: 'payment.html', reason: 'পেমেন্ট কাউন্টার শুধু কাউন্টারের বৈধ সেশন দিয়ে খোলে।'});
  $('#payShell').hidden=false; watchOwnPanelSession('payment');
  syncCounterHeading();
  $('#payCurrentDate').textContent=new Intl.DateTimeFormat('bn-BD',{day:'numeric',month:'long',year:'numeric'}).format(new Date());
  /* প্রোফাইল স্ক্রিন: শুধু পরিচয় কার্ড + নিজের তথ্য সম্পাদনা। সেটিংসের বাকি সব
     (ফর্ম, পাসওয়ার্ড, লগআউট) হাবের অ্যাকাউন্ট গ্রুপে — Admin-এর হুবহু একই। */
  const renderOwnProfile = account => {
    const host = $('#payOwnProfileCard');
    if (!host) return;
    host.innerHTML = `<div class="manager-profile-list"><div><small>নাম</small><strong>${esc(account?.fullName || '—')}</strong></div>`
      + `<div><small>ইউজারনেম</small><strong>${esc(account?.username || PAYMENT_USER_ID)}</strong></div>`
      + `<div><small>মোবাইল</small><strong>${esc(account?.mobile || '—')}</strong></div>`
      + `<div><small>ইমেইল</small><strong>${esc(account?.email || '—')}</strong></div>`
      + `<div><small>ভূমিকা</small><strong>ক্যাশ কাউন্টার</strong></div>`
      + `<div><small>সেশন</small><strong>ডিভাইস-বাউন্ড</strong></div></div>`
      + `<div class="row-actions"><button class="admin-btn primary" type="button" data-profile-edit>নিজের তথ্য সম্পাদনা</button></div>`;
  };
  let paymentAccount = null;
  try { paymentAccount = await readStaffAccount('payment'); } catch { paymentAccount = null; }
  renderOwnProfile(paymentAccount || { username: PAYMENT_USER_ID });
  mountProfileSelfEdit({
    role: 'payment',
    card: '#payOwnProfileCard',
    current: () => paymentAccount,
    render: async () => {
      try { paymentAccount = (await readStaffAccount('payment')) || paymentAccount; } catch { /* keep it */ }
      renderOwnProfile(paymentAccount);
    },
    toast: message => toast(message)
  });
  mountStaffAccountGroup({
    hub: '#payMorePanel',
    role: 'payment',
    logoutId: 'payMoreLogout',
    onLogout: () => exitCounter(),
    current: () => paymentAccount,
    toast: message => toast(message)
  });
  mountSettingsHub({
    mount: '#payMorePanel',
    role: 'payment',
    actions: {
      password: () => openStaffPasswordDialog({ role: 'payment', mode: 'change' }),
      logout: () => exitCounter()
    },
    session: { value: 'ডিভাইস-বাউন্ড কাউন্টার সেশন', hint: 'পেমেন্ট কাউন্টার সেশন' }
  });
  initAppearance();
  try {
    const heroObs = new MutationObserver(() => syncCounterHeading());
    if (document.documentElement) heroObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  } catch {}
  configureForm(); showCounterView('home'); await refreshToday();
  window.dispatchEvent(new Event('apc-session-ready'));
});
