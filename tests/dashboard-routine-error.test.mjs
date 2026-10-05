/* Home → আজকের ক্লাস when the data cannot be read.
   The school's rule: the failure is a FULL-WIDTH row (never a compact chip
   squeezed into half the grid), its text wraps on a small phone, and the retry
   button lives inside the very same component so the dashboard layout is never
   disturbed. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { initStudentDashboard } from '../js/student-dashboard.js';
import { KEYS } from '../js/database.js';
import { STORAGE_KEYS } from '../js/config.js';

const student = { id: 'ROUTINE-ERR-1', name: 'নমুনা শিক্ষার্থী', className: 'দশম শ্রেণি', group: '' };
const CONTEXT = [
  null,
  () => ({ student }),
  () => null
];
const contexts = [];
after(() => contexts.forEach(ctx => ctx.window.close()));

/* A damaged exam file is what makes the dashboard's parallel load fail — the
   exact situation the error row exists for, and nothing is deleted to reach it. */
async function brokenRender() {
  const ctx = await loadPage('index.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [KEYS.exams]: '{broken',
      [STORAGE_KEYS.account]: JSON.stringify({ status: 'active', student })
    }
  });
  ctx.window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
  contexts.push(ctx);
  const refresh = initStudentDashboard({
    getStudent: () => student, getAccount: () => ({ student })
  });
  await refresh();
  return { ...ctx, refresh };
}

test('a load failure renders one full-width card with its own retry', async () => {
  const ctx = await brokenRender();
  const list = ctx.$('#dashboardRoutineList');
  assert.equal(list.dataset.state, 'error');
  const card = list.querySelector('[data-routine-error]');
  assert.ok(card, 'the error card is inside the routine list');
  assert.equal(card.getAttribute('role'), 'alert');
  assert.match(card.textContent, /আজকের ক্লাস আনা যায়নি/);
  assert.match(card.textContent, /তথ্য মুছে যায়নি/);
  const retry = card.querySelector('[data-routine-retry]');
  assert.ok(retry, 'retry lives inside the same component');
  assert.equal(card.parentElement, list, 'the card is a direct row of the list');
  assert.equal(!!card.querySelector('.dashboard-routine-error-copy'), true);
  /* The failed load deleted nothing: the file it could not read is untouched. */
  assert.equal(ctx.window.localStorage.getItem(KEYS.exams), '{broken');
});

test('retrying from inside the card restores the dashboard without a reload', async () => {
  const ctx = await brokenRender();
  ctx.window.localStorage.setItem(KEYS.exams, JSON.stringify({ version: 1, exams: [], attempts: [] }));
  ctx.click(ctx.$('#dashboardRoutineList [data-routine-retry]'));
  await ctx.waitFor(() => !ctx.$('#dashboardRoutineList [data-routine-error]'));
  assert.notEqual(ctx.$('#dashboardRoutineList').dataset.state, 'error');
  assert.equal(ctx.$('#dashboardRoutineList [data-routine-retry]'), null, 'the card is gone once the data loads');
});

test('the card is full width by contract, not by luck', () => {
  const css = readFileSync(new URL('../css/student-notebook.css', import.meta.url), 'utf8');
  assert.match(css, /\.dashboard-routine-list>\*\{[^}]*position:relative/, 'routine rows keep their shared skin');
  assert.match(css, /\.dashboard-routine-list>\.dashboard-routine-error\{[^}]*grid-column:1\/-1[^}]*width:100%/, 'the error row spans the whole grid');
  assert.match(css, /\.dashboard-routine-list>\.dashboard-routine-error::before\{content:none\}/, 'the compact row dot is removed');
  assert.match(css, /\.dashboard-routine-error \[data-routine-retry\]\{[^}]*min-height:44px/, 'the retry stays a 44px tap target');
  assert.match(css, /overflow-wrap:anywhere/, 'long text wraps instead of overflowing');
  const js = readFileSync(new URL('../js/student-dashboard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /class="dashboard-empty">আজকের তথ্য লোড করা যায়নি/, 'the old compact error paragraph is gone');
});
