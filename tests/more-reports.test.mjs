/* More menus are compact entry points. Builders belong to their own page;
   navigation must not rewrite a payment, clear a draft or change report access. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { TRANSACTIONS_KEY } from '../js/finance-data.js';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';

const contexts = [];
async function studentPage() {
  const ctx = await loadPage('student.html', { seed: { 'activePlus.demo.autofill.v1': 'off', [TRANSACTIONS_KEY]: '[]' } });
  contexts.push(ctx);
  return ctx;
}

async function counterPage() {
  const ctx = await loadPage('payment.html', { seed: {
    'activePlus.demo.autofill.v1': 'off', [ROSTER_KEY]: JSON.stringify(adminStudents), [TRANSACTIONS_KEY]: '[]'
  } });
  await provisionStaff('payment');
  seedStaffSession(ctx.window, 'payment');
  contexts.push(ctx);
  await import(`../js/payment.js?more-menu=144-${Math.random()}`);
  await ctx.waitFor(() => !ctx.$('#payShell').hidden);
  await ctx.waitFor(() => !ctx.$('#payProfileCollect')?.disabled || ctx.$('#payLoadError').hidden);
  return ctx;
}

test('student More contains a report menu row, never an always-open report builder', async () => {
  const ctx = await studentPage();
  const more = ctx.$('#profileView');
  assert.equal(more.querySelector('#studentReports'), null);
  /* The More menu is the panel's row list (নতুন থিম): the report entrance is a
     row there, never an always-open report builder. */
  const menu = more.querySelector('.more-menu [data-view="reports"]');
  assert.ok(menu, 'reports is a named More menu entry');
  assert.match(menu.textContent, /আমার রিপোর্ট/);
  assert.equal(ctx.$('#studentReports').closest('[data-view-panel]').dataset.viewPanel, 'reports');
  assert.equal(ctx.$$('#studentReports').length, 1, 'one builder/mount, not a duplicated report engine');
});

test('student report page, parent More highlight, Back and deep links use the existing router', async () => {
  const ctx = await studentPage();
  const { setView, viewRouteFromHash } = await import('../js/shell.js');
  const { initNavigation } = await import('../js/navigation.js');
  initNavigation({});
  setView('profile');
  const before = ctx.window.localStorage.getItem(TRANSACTIONS_KEY);
  ctx.click(ctx.$('#profileView [data-view="reports"]'));
  assert.equal(viewRouteFromHash('#reports'), 'reports');
  assert.equal(ctx.window.location.hash, '#reports');
  assert.equal(ctx.$('.view.active').id, 'reportsView');
  assert.equal(ctx.$('.bottom-link[aria-current="page"]').dataset.view, 'profile');
  assert.equal(ctx.$$('.bottom-link[aria-current="page"]').length, 1);
  assert.ok(ctx.$('#reportsView .pay-back[data-view="profile"]'));
  ctx.click(ctx.$('#reportsView .pay-back'));
  assert.equal(ctx.$('.view.active').id, 'profileView');
  assert.equal(ctx.window.location.hash, '#profile');
  assert.equal(ctx.window.localStorage.getItem(TRANSACTIONS_KEY), before);
});

test('the narrowed counter keeps a private আরও seat and no student-profile directory', async () => {
  const ctx = await loadPage('payment.html');
  for (const selector of ['#payDeskTools','#payQuickPicks','.fee-profile-details','.fee-balance-grid','.student-search-results-table']) assert.equal(ctx.$(selector), null, selector);
  /* আরও holds the counter's own session, not a menu of other roles' work. */
  assert.equal(ctx.$('#payMorePanel').hidden, true);
  /* ২০২৬-১১-০২: কাউন্টারের নিজের পরিচয় এখন আলাদা প্রোফাইল স্ক্রিনে; আরও-তে
     থাকে শুধু সেটিংস হাব (অ্যাকাউন্ট গ্রুপে লগআউট)। */
  /* The static page carries the profile card and an empty account group; the
     one inline form (profile · password · logout) is rendered by
     js/staff-account-forms.js, exactly as in Admin. */
  assert.equal(ctx.$$('#payOwnProfileCard').length, 1, 'payOwnProfileCard');
  assert.equal(ctx.$('#payMorePanel [data-settings-group="account"]').children.length, 0,
    'the account group is filled by the shared form, never hand-copied per panel');
  assert.ok(ctx.$('#paymentReports'));
  assert.equal(ctx.$('#payReportsCard').hidden,true);
  assert.equal(ctx.$('#payProfileCard').hidden, true);
  assert.equal(ctx.$('#payCollectionForm').hidden, true);
  assert.ok(ctx.$('#payStudentSearch'));
  assert.ok(ctx.$('#payTodayList'));
});

test('only an explicit identity search opens a brief/payment entry; cancel clears it without a save', async () => {
  const ctx = await counterPage();
  const { $, click, type, waitFor, window } = ctx;
  await waitFor(() => $('#paymentMain').dataset.counterReady === 'true');
  const before = window.localStorage.getItem(TRANSACTIONS_KEY);
  type($('#payStudentSearch'),'AP-1024');
  await waitFor(() => $('#paySearchResults .fee-search-result'));
  click($('#paySearchResults .fee-search-result'));
  await waitFor(() => !$('#payProfileCollect').disabled);
  click($('#payProfileCollect')); type($('#payFeeAmount'),'975');
  click($('#payCancelButton'));
  assert.equal($('#payProfileCard').hidden,true);
  assert.equal($('#payCollectionForm').hidden,true);
  assert.equal($('#payQuickProfile').textContent,'');
  assert.equal(window.localStorage.getItem(TRANSACTIONS_KEY),before);
});

after(() => contexts.forEach(ctx => ctx.window.close()));
