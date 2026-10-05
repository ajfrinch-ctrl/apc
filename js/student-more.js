/* Student ফি — read-only. The ledger belongs to the Cash Counter and the
   Manager (js/finance-data.js); this screen only reads the student's own rows
   through the same repository the Home fee card uses. There is no form, no
   write call and no local copy of the numbers (docs/APP-ARCHITECTURE.md §3). */
import { financeRepository, studentFeeSummary, isFinalizedTransaction } from './finance-data.js';
import { KEYS } from './database.js';
import { toBanglaNumber as bn } from './ui.js';

const STATUS_LABELS = Object.freeze({
  approved: 'অনুমোদিত ✓',
  pending: 'যাচাইয়ের অপেক্ষায়',
  rejected: 'বাতিল'
});

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const num = value => bn(value);
const text = value => String(value ?? '').trim();

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `৳ ${bn(number.toLocaleString('en-IN'))}` : '৳ ০';
}

function when(tx) {
  const raw = tx.paidAt || tx.date || tx.createdAt || '';
  if (!raw) return '—';
  const date = new Date(raw);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' })
    : esc(raw);
}

export function initStudentFee({ getStudent }) {
  const mount = $('#studentFeeMount');
  if (!mount) return () => {};
  let request = 0;

  function rowsOf(transactions) {
    return [...transactions].sort((left, right) => String(right.paidAt || right.date || right.createdAt || '')
      .localeCompare(String(left.paidAt || left.date || left.createdAt || '')));
  }

  function render(transactions) {
    const student = getStudent() || {};
    const summary = studentFeeSummary({ ...student, monthlyFee: student.monthlyFee }, transactions);
    const history = rowsOf(transactions);
    const cleared = summary.due === 0 && summary.monthlyFee > 0;
    mount.innerHTML = `
      <div class="student-fee-summary">
        <article class="student-fee-stat"><small>${esc(summary.month)}-এর ফি</small><strong>${amount(summary.monthlyFee)}</strong></article>
        <article class="student-fee-stat"><small>পরিশোধ হয়েছে</small><strong>${amount(summary.paid)}</strong></article>
        <article class="student-fee-stat ${summary.due > 0 ? 'is-due' : 'is-clear'}"><small>বাকি</small><strong>${amount(summary.due)}</strong></article>
        <article class="student-fee-stat ${cleared ? 'is-clear' : 'is-due'}"><small>অবস্থা</small><strong>${cleared ? 'পরিশোধিত ✓' : summary.due > 0 ? 'বাকি আছে' : 'তথ্য যোগ হয়নি'}</strong></article>
      </div>
      <p class="teacher-local-note">${summary.lastPayment ? `সর্বশেষ পরিশোধ: ${amount(summary.lastPayment.amount)} • ${esc(when(summary.lastPayment))}` : 'এখনো কোনো পরিশোধ নথিভুক্ত হয়নি।'}</p>
      <h2 class="student-fee-heading">পরিশোধের ইতিহাস</h2>
      <div class="student-fee-history">${history.length ? history.map(tx => `
        <article class="student-fee-row" data-fee-row="${esc(tx.id)}">
          <div><strong>${amount(tx.amount)}</strong><small>${esc(tx.feeType || 'ফি')}${tx.month ? ` • ${esc(tx.month)}` : ''}</small></div>
          <div><small>${esc(when(tx))}</small><span class="student-fee-status ${esc(tx.status || 'approved')}">${esc(STATUS_LABELS[tx.status] || STATUS_LABELS.approved)}</span></div>
          <small class="student-fee-receipt">রসিদ ${esc(tx.id)}${isFinalizedTransaction(tx) ? '' : ' • হিসাবে ধরা হয়নি'}</small>
        </article>`).join('') : '<p class="teacher-empty">এই ফোনে এখনো কোনো পরিশোধের তথ্য নেই। Cash Counter এন্ট্রি করলে এখানে দেখা যাবে।</p>'}</div>`;
  }

  async function refresh() {
    const current = ++request;
    try {
      const transactions = await financeRepository.listTransactions({ role: 'student', studentId: getStudent()?.id });
      if (current !== request) return;
      render(Array.isArray(transactions) ? transactions : []);
    } catch {
      if (current !== request) return;
      mount.innerHTML = '<p class="teacher-empty">ফি-র তথ্য আনা যায়নি। সংযোগ ফিরলে আবার চেষ্টা হবে — কিছু মুছে যায়নি।</p>';
    }
  }

  window.addEventListener('storage', event => {
    if (!event.key || event.key === KEYS.transactions) void refresh();
  });
  window.addEventListener('apc-sync-updated', event => {
    if (!event.detail?.collection || ['transactions', 'payments'].includes(event.detail.collection)) void refresh();
  });
  window.addEventListener('apc-session-ready', () => void refresh());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
  void refresh();
  return refresh;
}
