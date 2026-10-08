/* Registration and login-page rules from 2026-09-30:
     • registration step 1 carries the student's own name (Bangla + English);
     • every status message on the login page can be dismissed.

   Each test keeps its own page, because the app modules bind to the globals of
   the window that loaded them. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';

/* ---------- Registration + login page (index.html) ------------------------- */

test('registration asks for the student name in the first step', async () => {
  const ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  const step1 = ctx.$('[data-registration-step="1"]');
  const step2 = ctx.$('[data-registration-step="2"]');
  assert.ok(step1.querySelector('#nameBn'), 'নাম (বাংলা) is in step 1');
  assert.ok(step1.querySelector('#nameEn'), 'নাম (English) is in step 1');
  assert.ok(step1.querySelector('#regMobile'), 'the phone number stays in step 1');
  assert.ok(step1.querySelector('#regUsername'), 'the username stays in step 1');
  assert.equal(step2.querySelector('#nameBn'), null, 'the name is not asked twice');
  assert.equal(step2.querySelector('#nameEn'), null);
  assert.ok(step2.querySelector('#fatherName'), 'step 2 keeps the family details');
  assert.equal(ctx.$$('#registrationForm [name="nameBn"]').length, 1, 'exactly one Bangla name field');
  assert.equal(ctx.$$('#registrationForm [name="nameEn"]').length, 1, 'exactly one English name field');
  ctx.window.close();
});

test('a login-page message can be dismissed', async () => {
  const ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  const { setAuthMessage } = await import('../js/ui.js');
  setAuthMessage('পাসওয়ার্ড ভুল।');
  const message = ctx.$('#authMessage');
  assert.equal(message.hidden, false);
  assert.match(message.textContent, /পাসওয়ার্ড ভুল/);
  const dismiss = message.querySelector('.auth-message-close');
  assert.ok(dismiss, 'every message carries a dismiss control');
  ctx.click(dismiss);
  assert.equal(message.hidden, true, 'the message leaves the screen');
  assert.equal(message.textContent, '');
  ctx.window.close();
});

/* ---------- Panels keep the open page on refresh --------------------------- */

