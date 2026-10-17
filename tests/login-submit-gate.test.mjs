import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { STORAGE_KEYS } from '../js/config.js';

// Exercise the real login form, hashing and storage without importing Firebase.
test('a saved account and legacy skip flag cannot create a login session; a wrong ID or PIN cannot enter', async () => {
  const ctx = await loadPage('index.html', { seed: {
    [STAFF_ACCOUNTS.admin.accountKey]: '{}',
    'active-plus-skip-security-v1': '1',
    'activePlus.demo.autofill.v1': 'off'
  } });
  Object.defineProperty(ctx.window.navigator, 'onLine', { configurable: true, value: false });
  const storage = await import('../js/storage.js');
  const { initLogin } = await import('../js/login.js');
  const { initRegister } = await import('../js/register.js');
  const account = await storage.persistAccount({
    username: 'login.student', mobile: '01712345678', pin: '123456', status: 'active',
    student: { id: 'STU-GATE', name: 'শিক্ষার্থী' }
  });
  assert.equal(await storage.hasSession(), false, 'a stored account and old skip preference are not authentication');
  /* The trusted-device preference lives on the student panel page now
     (student.html since 2026-10-14), so check it there, with this device's
     stored account carried over. Toggling it must still not mint a session. */
  const panelSeed = {};
  for (let i = 0; i < ctx.window.localStorage.length; i++) {
    const key = ctx.window.localStorage.key(i);
    panelSeed[key] = ctx.window.localStorage.getItem(key);
  }
  const panelCtx = await loadPage('student.html', { seed: panelSeed });
  const { initProfile } = await import('../js/profile.js');
  initProfile({ state: { account, student: account.student } });
  const trusted = panelCtx.$('#moreTrustedDeviceToggle');
  trusted.checked = true;
  trusted.dispatchEvent(new panelCtx.window.Event('change'));
  await panelCtx.waitFor(() => trusted.checked === false);
  assert.equal(await storage.hasSession(), false, 'a profile preference cannot manufacture a session');
  /* Back to the login page realm for the form checks below (the same global
     set the harness installs per page — a partial restore would leak the
     panel page's navigator.onLine into the offline login path). */
  for (const [name, value] of Object.entries({
    window: ctx.window, document: ctx.document, localStorage: ctx.window.localStorage,
    sessionStorage: ctx.window.sessionStorage, location: ctx.window.location,
    history: ctx.window.history, navigator: ctx.window.navigator,
    Element: ctx.window.Element, HTMLElement: ctx.window.HTMLElement,
    HTMLInputElement: ctx.window.HTMLInputElement, Node: ctx.window.Node
  })) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  let admitted = 0;
  initLogin({ state: { account, student: account.student }, onAuthenticated: () => { admitted++; } });
  const submit = async (identifier, password) => {
    ctx.type(ctx.$('#loginMobile'), identifier);
    ctx.type(ctx.$('#loginPin'), password);
    ctx.submit(ctx.$('#loginForm'));
    await ctx.waitFor(() => ctx.$('#loginForm').getAttribute('aria-busy') !== 'true');
  };
  await submit('login.student', '999999');
  assert.equal(admitted, 0);
  assert.equal(await storage.hasSession(), false);
  await submit('not.this.student', '123456');
  assert.equal(admitted, 0);
  assert.equal(await storage.hasSession(), false);
  await submit('login.student', '123456');
  assert.equal(admitted, 1);
  assert.equal(await storage.hasSession(), true);
  storage.clearSession();
  assert.equal(await storage.hasSession(), false);

  // A brand-new reserved staff ID is not a panel entry point on its own.
  await submit('manager.apc', 'whatever-password');
  assert.match(ctx.$('#authMessage').textContent, /অ্যাকাউন্ট পাওয়া যায়নি।/);
  assert.equal(await storage.hasSession(), false);

  // Registration saves an account but deliberately returns to the login page;
  // the just-created credentials still have to be submitted.
  ctx.window.localStorage.removeItem(STORAGE_KEYS.account);
  const registrationState = { account: null, student: {} };
  let registered = 0;
  initRegister({ state: registrationState, onRegistered: () => { registered++; } });
  const values = {
    regMobile: '01711223344', regUsername: 'gate.student', regPin: '246810', regPinConfirm: '246810',
    nameBn: 'গেট শিক্ষার্থী', nameEn: 'Gate Student', fatherName: 'পিতা', motherName: 'মাতা',
    birthDate: '2010-01-01', gender: 'নারী', guardianMobile: '01811223344', address: 'ঠিকানা',
    regClass: 'দশম শ্রেণি', regGroup: 'বিজ্ঞান', securityAnswer: 'উত্তর'
  };
  for (const [id, value] of Object.entries(values)) ctx.$('#' + id).value = value;
  const question = ctx.$('#securityQuestion');
  question.value = [...question.options].map(option => option.value).find(Boolean);
  ctx.$('#studentMobile').value = values.regMobile;
  ctx.$('#terms').checked = true;
  ctx.$('#guardianConsent').checked = true;
  ctx.submit(ctx.$('#registrationForm'));
  await ctx.flush();
  await ctx.waitFor(() => registered === 1, 5000);
  assert.equal(registered, 1, ctx.$('#authMessage').textContent);
  assert.equal(ctx.$('#authScreen').hidden, false, 'registration must not enter the app');
  assert.equal(ctx.$('#loginMobile').value, 'gate.student');
  assert.equal(ctx.$('#loginPin').value, '');
  assert.equal(await storage.hasSession(), false);
  await submit('gate.student', '246810');
  assert.equal(admitted, 2);
  assert.equal(await storage.hasSession(), true);
  ctx.window.close();
});
