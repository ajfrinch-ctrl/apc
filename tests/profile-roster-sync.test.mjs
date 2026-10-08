/* A student edits their own profile: the change must reach the shared roster,
   because that is what the Admin, Manager and Cash Counter panels read — and
   the roster is what the online bridge uploads to the other devices. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { STORAGE_KEYS } from '../js/config.js';
import { KEYS } from '../js/database.js';

let ctx;
let state;

before(async () => {
  ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  const { initRegister } = await import('../js/register.js');
  const { initLogin } = await import('../js/login.js');
  const { initProfile } = await import('../js/profile.js');
  state = { student: {}, account: null };
  initRegister({ state, onRegistered: () => {} });
  initLogin({ state, onAuthenticated: () => {} });
  initProfile({ state, onStudentChange: student => { state.student = student; } });
});

function fillRegistration() {
  const values = {
    regMobile: '01711223344', regUsername: 'raisa.islam', regPin: '123123', regPinConfirm: '123123',
    nameBn: 'রাইসা ইসলাম', nameEn: 'Raisa Islam', fatherName: 'আব্দুল করিম', motherName: 'সালমা বেগম',
    birthDate: '2010-03-15', gender: 'নারী', guardianMobile: '01811223344', address: 'দিনাজপুর সদর',
    regClass: 'দশম শ্রেণি', regGroup: 'বিজ্ঞান', securityAnswer: 'রাইসা'
  };
  for (const [id, value] of Object.entries(values)) ctx.$(`#${id}`).value = value;
  // The security question is a list of prepared questions: take a real option.
  const question = ctx.$('#securityQuestion');
  question.value = [...question.options].map(option => option.value).find(value => value);
  ctx.$('#studentMobile').value = values.regMobile;
  ctx.$('#terms').checked = true;
}

const roster = () => JSON.parse(ctx.window.localStorage.getItem(KEYS.students) || '[]');
const account = () => JSON.parse(ctx.window.localStorage.getItem(STORAGE_KEYS.account));
const profile = () => JSON.parse(ctx.window.localStorage.getItem(STORAGE_KEYS.student) || '{}');

test('registration writes the student into the shared roster', async () => {
  fillRegistration();
  ctx.submit(ctx.$('#registrationForm'));
  await ctx.waitFor(() => Boolean(account()));
  state.account = account();
  state.student = profile();
  const row = roster().find(student => student.id === account().student.id);
  assert.ok(row, 'the roster row exists — this is what the cloud syncs');
  assert.equal(row.name, 'রাইসা ইসলাম');
  assert.equal(row.birthDate, '2010-03-15', 'staff devices read birthdays from the roster');
  assert.equal(row.status, 'pending');
});

test('a profile edit updates the roster too, so other devices see the new details', async () => {
  const { openProfileEditor } = await import('../js/profile.js');
  openProfileEditor(state.student);
  ctx.$('#editNameBn').value = 'রাইসা ইসলাম সুমি';
  ctx.$('#editNameEn').value = 'Raisa Islam Sumi';
  ctx.$('#editGuardianMobile').value = '01911223344';
  ctx.$('#editAddress').value = 'রংপুর সদর';
  ctx.submit(ctx.$('#profileForm'));
  await ctx.waitFor(() => roster().some(student => student.name === 'রাইসা ইসলাম সুমি'));

  const id = account().student.id;
  const row = roster().find(student => student.id === id);
  assert.equal(row.nameEn, 'Raisa Islam Sumi', 'roster row carries the English name');
  assert.equal(row.guardianMobile, '01911223344', 'and the new guardian number');
  assert.equal(account().student.name, 'রাইসা ইসলাম সুমি', 'the login record changed as well');
  assert.equal(profile().name, 'রাইসা ইসলাম সুমি', 'and the device profile');
  assert.equal(roster().filter(student => student.id === id).length, 1, 'the row is updated, never duplicated');
});
