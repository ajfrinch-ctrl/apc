/* The empty Today card is a compact Today-study-style entry, not a large
   invented class/add button. Real scheduling/filtering and error states remain. */
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { initStudentDashboard } from '../js/student-dashboard.js';
import { blankRoutine, ROUTINE_KEY } from '../js/office-data.js';
import { TEACHING_KEY } from '../js/teaching-data.js';
import { TRANSACTIONS_KEY } from '../js/finance-data.js';
import { STORAGE_KEYS } from '../js/config.js';

const NativeDate = globalThis.Date;
const student = { id: 'TODAY-SAMPLE', name: 'নমুনা শিক্ষার্থী', className: 'দশম শ্রেণি', group: 'বিজ্ঞান' };
beforeEach(() => {
  globalThis.Date = class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2026-10-01T10:00:00Z'])); }
    static now() { return new NativeDate('2026-10-01T10:00:00Z').getTime(); }
  };
});
afterEach(() => { globalThis.Date = NativeDate; });

async function render({ routine = blankRoutine(), teaching = { version: 1, activities: [] } } = {}) {
  const seed = {
    'activePlus.demo.autofill.v1': 'off', [ROUTINE_KEY]: JSON.stringify(routine),
    [TEACHING_KEY]: typeof teaching === 'string' ? teaching : JSON.stringify(teaching), [TRANSACTIONS_KEY]: '[]',
    [STORAGE_KEYS.account]: JSON.stringify({ status: 'active', student })
  };
  const ctx = await loadPage('index.html', { seed });
  ctx.window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
  const refresh = initStudentDashboard({ getStudent: () => student, getAccount: () => ({ student }) });
  await refresh();
  return { ...ctx, refresh, seed };
}

test('empty Today uses the shared Today-study card/icon/copy/action layout and concise honest text', async () => {
  const ctx = await render();
  const card = ctx.$('#dashboardRoutineList .dashboard-empty-card');
  assert.ok(card.classList.contains('challenge-card'), 'same card material/row layout as Today study');
  assert.ok(card.querySelector('.challenge-icon.dashboard-empty-icon'));
  assert.ok(card.querySelector('.challenge-copy.dashboard-empty-copy'));
  assert.ok(card.querySelector('button.challenge-open[data-view="routine"]'));
  assert.equal(card.querySelector('strong').textContent, 'আজ কোনো ক্লাস নেই');
  assert.equal(card.querySelector('small').textContent, 'সময়সূচি দেখতে রুটিন খুলুন।');
  assert.equal(ctx.$('#dashboardRoutineList').dataset.state, 'empty');
  assert.equal(ctx.$$('#studentServices .pay-tile').length, 8);
  assert.ok(ctx.$('#dashboardChallengeCard'), 'do not remove or hide Today study');
});

test('the empty entry is view-only: one existing routine action, no fabricated class/progress or data writes', async () => {
  const ctx = await render();
  const root = ctx.$('#dashboardRoutineList');
  assert.equal(root.querySelectorAll('button').length, 1);
  assert.equal(root.querySelector('button').getAttribute('aria-label'), 'রুটিন খুলুন');
  assert.equal(root.querySelector('[data-action], input, form, .challenge-progress-track, [data-dashboard-class]'), null);
  for (const key of [ROUTINE_KEY, TEACHING_KEY, TRANSACTIONS_KEY]) assert.equal(ctx.window.localStorage.getItem(key), ctx.seed[key]);
});

test('a saved own-class schedule replaces the empty entry and removing it restores the compact card', async () => {
  const routine = blankRoutine();
  routine.thu.classes.push(
    { id:'OWN-CLASS', className:student.className, subject:'গণিত', teacher:'নমুনা শিক্ষক', time:'৪:০০', room:'রুম ২' },
    { id:'OTHER-CLASS', className:'নবম শ্রেণি', subject:'অন্য শ্রেণি', teacher:'অন্য শিক্ষক', time:'৫:০০' }
  );
  const ctx = await render({ routine });
  assert.equal(ctx.$('#dashboardRoutineList').dataset.state, 'ready');
  assert.equal(ctx.$$('.dashboard-routine-card').length, 1);
  assert.match(ctx.$('#dashboardRoutineList').textContent, /গণিত/);
  assert.doesNotMatch(ctx.$('#dashboardRoutineList').textContent, /অন্য শ্রেণি/);
  assert.equal(ctx.$('.dashboard-empty-card'), null);
  const before = ctx.window.localStorage.getItem(ROUTINE_KEY);
  assert.equal(before, JSON.stringify(routine), 'rendering never rewrites the saved schedule');
  ctx.window.localStorage.setItem(ROUTINE_KEY, JSON.stringify(blankRoutine()));
  await ctx.refresh();
  assert.equal(ctx.$('#dashboardRoutineList').dataset.state, 'empty');
  assert.ok(ctx.$('.dashboard-empty-card.challenge-card'));
});

test('unreadable academic data stays a truthful load error, not a fake no-classes result', async () => {
  const ctx = await render({ teaching:'{broken data' });
  assert.equal(ctx.$('#dashboardRoutineList').dataset.state, 'error');
  /* The failure is the full-width error row (its own test lives in
     dashboard-routine-error.test.mjs), never the compact no-class card. */
  assert.match(ctx.$('#dashboardRoutineList').textContent, /আজকের ক্লাস আনা যায়নি/);
  assert.ok(ctx.$('#dashboardRoutineList [data-routine-error]'), 'the full-width error row is shown');
  assert.equal(ctx.$('.dashboard-empty-card'), null);
  assert.equal(ctx.$('#homeView').classList.contains('is-empty-routine'), false);
  assert.equal(ctx.window.localStorage.getItem(TEACHING_KEY), '{broken data');
});
