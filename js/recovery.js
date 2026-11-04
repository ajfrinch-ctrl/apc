/* পাসওয়ার্ড recovery feature — দুই ধাপে reset:
     1. শিক্ষার্থী যাচাই: ইউজারনেম/মোবাইল নম্বর + নিরাপত্তা প্রশ্নের উত্তর মিললে তবেই
        পরের ধাপ খোলে (উত্তর ও পাসওয়ার্ড কেবল PBKDF2 hash হিসেবেই সংরক্ষিত হয়)।
     2. সংক্ষিপ্ত তথ্য দেখে নতুন পাসওয়ার্ড দুইবার দিয়ে পরিবর্তন।
   Step 2 cannot be reached without a successful step 1: the form stays hidden and
   the handler re-checks the verified record, so hiding markup is never the guard. */
import { $, openModal, closeModal, setAuthMessage } from './ui.js';
import { matchesLoginIdentifier } from './sync-merge.js';
import { loadAccount, listLocalAccounts, persistAccount, verifySecurityAnswer } from './storage.js';
import { escapeHtml } from './sanitize.js';

const STATUS_LABELS = Object.freeze({ approved: 'সক্রিয়', active: 'সক্রিয়', pending: 'অপেক্ষমাণ', rejected: 'বাতিল' });

/** Show a few digits so the student can recognise the number without it being
    readable over a shoulder. */
function maskNumber(value) {
  const text = String(value || '');
  if (text.length < 7) return text ? '•'.repeat(text.length) : '—';
  return `${text.slice(0, 3)}${'•'.repeat(text.length - 6)}${text.slice(-3)}`;
}

function setStepError(node, message) {
  if (!node) return;
  node.textContent = message || '';
  node.hidden = !message;
}

/** সংক্ষিপ্ত তথ্য — just enough for the student to recognise the account. */
function renderSummary(account) {
  const student = account.student || {};
  const rows = [
    ['নাম', student.nameBn || student.name || '—'],
    ['Student ID', student.id || account.studentId || '—'],
    ['ক্লাস ও বিভাগ', [student.className, student.group].filter(Boolean).join(' • ') || '—'],
    ['লগইন আইডি', account.username || student.username || '—'],
    ['মোবাইল নম্বর', maskNumber(account.registrationMobile || account.mobile)],
    ['অ্যাকাউন্টের অবস্থা', STATUS_LABELS[account.status] || account.status || '—']
  ];
  const host = $('#recoveryStudentSummary');
  if (!host) return;
  host.innerHTML = `<p class="recovery-summary-title">আপনার অ্যাকাউন্ট</p><dl>${rows
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('')}</dl>`;
}

async function handleVerify(event, state, session) {
  event.preventDefault();
  const formElement = event.currentTarget;
  if (!formElement.checkValidity()) {
    formElement.reportValidity();
    return;
  }
  if (session.busy) return;
  session.busy = true;
  try {
    const form = new FormData(formElement);
    const typed = String(form.get('mobile') || '').trim();
    const candidates = listLocalAccounts();
    if (!candidates.length && state.account) candidates.push(state.account);
    if (!candidates.length) {
      closeModal('recoveryModal');
      setAuthMessage('এই ডিভাইসে কোনো রেজিস্টার্ড অ্যাকাউন্ট পাওয়া যায়নি।');
      return;
    }
    const targetAccount = candidates.find(acc => matchesLoginIdentifier(acc, typed)) || null;
    const answer = String(form.get('answer') || '');
    const matches = Boolean(targetAccount)
      && form.get('question') === targetAccount.securityQuestion
      && (await verifySecurityAnswer(targetAccount, answer));
    if (!matches) {
      session.verified = null;
      setStepError($('#recoveryVerifyError'), 'ইউজারনেম/মোবাইল নম্বর, প্রশ্ন বা উত্তর সঠিক নয়');
      return;
    }
    setStepError($('#recoveryVerifyError'), '');
    state.account = targetAccount;
    session.verified = { account: targetAccount, answer };
    renderSummary(targetAccount);
    showPasswordStep();
  } finally {
    session.busy = false;
  }
}

async function handlePasswordChange(event, state, session) {
  event.preventDefault();
  const formElement = event.currentTarget;
  if (!formElement.checkValidity()) {
    formElement.reportValidity();
    return;
  }
  const error = $('#recoveryPasswordError');
  if (!session.verified) {
    // Reachable only if step 2 were shown without a verification; never persist.
    setStepError(error, 'আগে শিক্ষার্থী যাচাই করুন।');
    showVerifyStep();
    return;
  }
  const form = new FormData(formElement);
  const pin = String(form.get('pin') || '');
  const pinConfirm = String(form.get('pinConfirm') || '');
  if (!/^\d{4,6}$/.test(pin)) return setStepError(error, 'নতুন পাসওয়ার্ড ৪ থেকে ৬ সংখ্যার হতে হবে');
  if (pin !== pinConfirm) return setStepError(error, 'দুটি পাসওয়ার্ড এক নয়। আবার মিলিয়ে দিন।');
  if (session.busy) return;
  session.busy = true;
  try {
    // The proven answer travels with the account so a legacy plaintext answer is
    // replaced by a hash in the same save; nothing plaintext is ever stored.
    state.account = await persistAccount({ ...session.verified.account, pin, securityAnswer: session.verified.answer });
    session.verified = null;
    setStepError(error, '');
    closeModal('recoveryModal');
    resetRecovery(session);
    $('#loginMobile').value = state.account.username || state.account.mobile;
    setAuthMessage('নতুন পাসওয়ার্ড সংরক্ষণ হয়েছে। এখন লগইন করুন।', true);
  } catch {
    setStepError(error, 'পাসওয়ার্ড সংরক্ষণ হয়নি। আবার চেষ্টা করুন।');
  } finally {
    session.busy = false;
  }
}

function showPasswordStep() {
  $('#recoveryVerifyStep').hidden = true;
  $('#recoveryPasswordStep').hidden = false;
  $('#recoveryPasswordForm')?.reset();
  setStepError($('#recoveryPasswordError'), '');
  window.setTimeout(() => $('#recoveryPin')?.focus(), 50);
}

function showVerifyStep() {
  $('#recoveryPasswordStep').hidden = true;
  $('#recoveryVerifyStep').hidden = false;
  setStepError($('#recoveryVerifyError'), '');
  window.setTimeout(() => $('#recoveryAnswer')?.focus(), 50);
}

/** Back to a clean step 1: the old answer is not reused for the next attempt. */
function resetRecovery(session) {
  session.verified = null;
  session.busy = false;
  $('#recoveryForm')?.reset();
  $('#recoveryPasswordForm')?.reset();
  setStepError($('#recoveryVerifyError'), '');
  setStepError($('#recoveryPasswordError'), '');
  const summary = $('#recoveryStudentSummary');
  if (summary) summary.innerHTML = '';
  showVerifyStep();
}

export function initRecovery({ state }) {
  const session = { verified: null, busy: false };
  $('#recoveryForm')?.addEventListener('submit', event => handleVerify(event, state, session));
  $('#recoveryPasswordForm')?.addEventListener('submit', event => handlePasswordChange(event, state, session));
  $('#recoveryBack')?.addEventListener('click', () => resetRecovery(session));
  const button = $('#forgotPinButton');
  button?.addEventListener('click', () => {
    resetRecovery(session);
    openModal('recoveryModal');
  });
  // The auth screen can appear before this lazy module loads. Do not offer a
  // recovery button until its handler is actually ready.
  if (button) button.disabled = false;
}
