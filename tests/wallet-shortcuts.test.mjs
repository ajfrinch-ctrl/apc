/* New student home tiles are entrances to the existing features. No tile may
   create payment data, invent homework or change the module configuration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';

async function boot(extraSeed = {}) {
  const ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off', ...extraSeed } });
  const { buildSessionRecord } = await import('../js/session.js');
  const { hashPassword } = await import('../js/password-hash.js');
  ctx.window.localStorage.setItem('active-plus-account-v1', JSON.stringify({
    username: 'raisa.islam', mobile: '01700000000', registrationMobile: '01700000000',
    pinHash: await hashPassword('246810'), status: 'active',
    student: { id: 'AP-1024', name: 'রাইসা', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ' }
  }));
  ctx.window.localStorage.setItem('active-plus-session-v1', JSON.stringify(buildSessionRecord({ owner: 'raisa.islam' })));
  await import(`../js/main.js?wallet-test=${Math.random()}`);
  await ctx.waitFor(() => ctx.$('#appShell').hidden === false);
  await ctx.flush(10);
  return ctx;
}

test('every student service tile opens its original view or truthful existing action', async () => {
  const ctx = await boot();
  const { $, click, window } = ctx;
  /* The five quick academic cards open a section of পড়াশোনা or the পরীক্ষা section. */
  const cards = [
    ['homework', 'homework', 'courses'], ['suggestion', 'suggestion', 'courses'],
    ['question-bank', 'bank', 'courses'], ['exams', null, 'exams'], ['results', null, 'exams']
  ];
  for (const [action, section, view] of cards) {
    const tile = action === 'exams' || action === 'results'
      ? $(`#studentServices [data-action="${action}"]`) || $(`#studentServices [data-exam-tab="${action}"]`) || $('#studentServices [data-view="exams"]')
      : $(`#studentServices [data-action="${action}"]`);
    click(tile);
    await ctx.flush();
    assert.equal($(`[data-view-panel="${view}"]`).classList.contains('active'), true, action);
    if (section) {
      assert.equal($(`[data-study-section="${section}"]`).getAttribute('aria-pressed'), 'true', action + ' section');
      assert.equal($(`[data-study-panel="${section}"]`).hidden, false, action + ' panel');
    }
    if (action === 'results') {
      assert.equal($('#examTabs [data-exam-tab="results"]').getAttribute('aria-pressed'), 'true', 'ফলাফল opens its tab');
      assert.equal($('[data-exam-panel="results"]').hidden, false, 'the result panel is shown');
    }
    click($('.bottom-link[data-view="home"]'));
  }
  click($('#studentServices [data-action="homework"]'));
  await ctx.flush();
  assert.equal($('#coursesView').classList.contains('active'), true);
  assert.equal($('#learningFilters [data-learning-filter="homework"]').getAttribute('aria-pressed') === 'true', true);
  click($('#coursesView .pay-back'));
  assert.equal($('#homeView').classList.contains('active'), true, 'inner-page back must be wired');

  click($('#studentServices [data-view="notice-board"]'));
  assert.equal($('#notice-boardView').classList.contains('active'), true, 'the shortcut opens the separate Notice Board');
  assert.deepEqual(ctx.$$('#noticeBoardCategories [data-notice-board-category]').map(tab => tab.dataset.noticeBoardCategory), ['all', 'urgent', 'academic', 'class', 'fee', 'exam']);
  click($('#notice-boardView .pay-back'));

  const before = window.localStorage.getItem(KEYS.transactions);
  $('#dashboardFeeCard').hidden = true; // an honest empty-data state, not a fabricated balance
  /* ফি is a read-only screen: no ledger write, ever. */
  click($('#profileView [data-view="student-fee"]'));
  await ctx.flush();
  assert.equal($('#studentFeeView').classList.contains('active'), true, 'ফি opens its own screen');
  assert.equal($('#studentFeeView').querySelectorAll('input, textarea, select, form').length, 0, 'ফি must stay read-only');
  assert.equal(window.localStorage.getItem(KEYS.transactions), before, 'fees screen must not write a ledger');
  assert.deepEqual(ctx.jsdomErrors.filter(error => !/navigation/i.test(error)), []);
});

test('the new tile entrances respect the existing optional-module settings', async () => {
  const ctx = await boot({ [KEYS.settings]: JSON.stringify({ modules: { routine: false, courses: false, results: false } }) });
  for (const selector of ['[data-action="homework"]', '[data-action="suggestion"]', '[data-action="question-bank"]', '[data-exam-tab="results"]']) {
    assert.equal(ctx.$('#studentServices ' + selector).disabled, true, selector + ' must not bypass module settings');
  }
  assert.equal(ctx.$('#studentServices [data-view="notice-board"]').disabled, false, 'an unrelated tile must stay available');
});
