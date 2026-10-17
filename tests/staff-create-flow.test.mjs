/* The real staff-creation flow, end to end: the Admin's 3-section create form
   on admin.html → a permanent Staff ID + generated Login User ID → the new
   teacher signs in with those credentials → the Teacher panel shows exactly
   the classes and subjects that were ticked in the matrix.

   This is the acceptance path for "নতুন শিক্ষক তৈরি করে লগইন → নিজের ক্লাস
   দেখতে পাবে": nothing is faked — the form, the auth API and the panel are
   the production surfaces. A failed submit must keep the form open and
   retryable, never half-create an account.

   The teacher.html leg runs LAST: loading a second page swaps the jsdom
   globals every module resolves storage against. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { enabledClasses } from '../js/config.js';
import {
  listStaff, authenticateDirectoryStaff, STAFF_DIRECTORY_KEY
} from '../js/staff-directory.js';
import {
  TEACHER_ASSIGNMENTS_KEY, effectiveTeacherAssignments,
  isTeacherAssigned, isTeacherAssignedSubject
} from '../js/teacher-assignments.js';
import { saveStaffSession, readActiveStaffIdentity } from '../js/staff-auth.js';

const nfc = value => String(value).normalize('NFC');
const CLASS_A = enabledClasses[0];
const CLASS_B = enabledClasses[1];

let ctx;
let createdUsername = '';
let createdStaffId = '';
let ticked = {};

before(async () => {
  ctx = await loadPage('admin.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 4);
});
after(() => ctx?.window.close());

test('the three-step create wizard validates before creating an account', async () => {
  ctx.click(ctx.$('#staffCreateButton'));
  await ctx.waitFor(() => Boolean(ctx.$('#staffForm')));
  const form = ctx.$('#staffForm');

  // The three numbered sections are navigable rather than shown as one long form.
  assert.equal(form.querySelectorAll('.staff-form-section-block').length, 3, '৩টি ধাপ: পরিচয়, রোল ও যোগাযোগ, দায়িত্ব');
  assert.equal(form.dataset.currentCreateStep, '1');
  assert.ok(form.querySelector('#staffField-username[data-auto-id]'), 'Login User ID স্বয়ংক্রিয়');
  assert.ok(form.querySelector('#staffAssignmentFields[data-role="teacher"]'), 'teacher দায়িত্ব অংশ দেখায়');
  assert.equal(form.querySelector('[data-staff-create-step="2"]').hidden, true);
  assert.equal(form.querySelector('[data-staff-create-step="3"]').hidden, true);
  assert.equal(form.querySelector('[data-staff-create-footer]').hidden, true);

  const set = (id, value) => {
    const el = form.querySelector(id);
    el.value = value;
    el.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    return el;
  };
  set('#staffField-fullName', 'Karim Uddin');
  ctx.click(form.querySelector('[data-staff-step-next]'));
  await ctx.waitFor(() => form.dataset.currentCreateStep === '2');

  // A bad password confirmation blocks the next step without creating a record.
  set('#staffField-password', 'Karim-2026');
  set('#staffField-confirmPassword', 'Wrong-2026');
  set('#staffField-status', 'active');
  ctx.click(form.querySelector('[data-staff-step-next]'));
  await ctx.waitFor(() => !ctx.$('#staffFormError').hidden);
  assert.equal(form.dataset.currentCreateStep, '2');
  assert.ok(ctx.$('#staffForm'), 'একটি ব্যর্থ validation-এ ফর্ম খোলা থাকে');
  assert.equal((await listStaff()).some(item => item.fullName === 'Karim Uddin'), false, 'কোনো অর্ধেক রেকর্ড তৈরি হয়নি');
  set('#staffField-confirmPassword', 'Karim-2026');
  ctx.click(form.querySelector('[data-staff-step-next]'));
  await ctx.waitFor(() => form.dataset.currentCreateStep === '3');
  assert.equal(form.querySelector('[data-staff-create-footer]').hidden, false, 'শেষ ধাপে submit দেখা যায়');

  // Step ৩: multi-class, multi-subject duty matrix (teacher only).
  const classesField = form.querySelector('#staffField-classes');
  assert.ok(classesField, 'শ্রেণি নির্বাচন আছে');
  for (const option of classesField.options) {
    if (nfc(option.value) === nfc(CLASS_A) || nfc(option.value) === nfc(CLASS_B)) option.selected = true;
  }
  classesField.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.waitFor(() => form.querySelectorAll('input[data-class-subject]').length > 0);

  // Tick what the structure offers: Class A → up to two subjects, Class B → one.
  const boxes = [...form.querySelectorAll('input[data-class-subject]')];
  const byClass = className => boxes.filter(box => nfc(box.dataset.classSubject) === nfc(className));
  assert.ok(byClass(CLASS_A).length >= 1 && byClass(CLASS_B).length >= 1, 'প্রতি নির্বাচিত শ্রেণির বিষয় ঘর আসে');
  ticked = {};
  for (const box of byClass(CLASS_A).slice(0, 2)) {
    box.checked = true;
    (ticked[box.dataset.classSubject] ||= []).push(box.value);
  }
  for (const box of byClass(CLASS_B).slice(0, 1)) {
    box.checked = true;
    (ticked[box.dataset.classSubject] ||= []).push(box.value);
  }

  // Submit for real: the modal closes and the list carries the new card.
  ctx.submit(form);
  await ctx.waitFor(() => !ctx.$('#staffForm'));
  const record = (await listStaff()).find(item => item.fullName === 'Karim Uddin');
  assert.ok(record, 'ফর্ম জমা দিলে স্টাফ তৈরি হয়');
  createdUsername = record.username;
  createdStaffId = record.staffId;

  // Permanent Staff ID + generated Login User ID mapping.
  assert.match(createdStaffId, /^STF-\d{4}$/);
  assert.match(createdUsername, /^([a-z][a-z0-9]*)\.teacher\.apc$/, 'নিয়ম অনুযায়ী Login User ID');
  assert.notEqual(createdUsername, 'teacher.apc', 'role account-এর সাথে মেশে না');
  assert.equal(record.status, 'active');
  // The matrix is stored per class, exactly as ticked.
  for (const [className, subjects] of Object.entries(ticked)) {
    const saved = (record.assignment.classSubjects?.[className] || []).map(nfc).sort();
    assert.deepEqual(saved, subjects.map(nfc).sort(), `${className}-এর বিষয় হুবহু সংরক্ষিত`);
  }
});

test('the generated Login User ID + password are the real credentials', async () => {
  const good = await authenticateDirectoryStaff(createdUsername, 'Karim-2026');
  assert.equal(good.ok, true, good.error);
  const bad = await authenticateDirectoryStaff(createdUsername, 'Wrong-2026');
  assert.equal(bad.ok, false, 'ভুল পাসওয়ার্ডে login হয় না');
});

test('the assignment scope belongs to the new teacher alone', async () => {
  const mine = await effectiveTeacherAssignments(createdUsername);
  assert.equal(mine.length, Object.keys(ticked).length, 'নির্বাচিত শ্রেণির সংখ্যামতো assignment');
  assert.equal(isTeacherAssigned('teacher.apc', CLASS_A), false, 'role account-এ ফাঁসে না');
  for (const [className, subjects] of Object.entries(ticked)) {
    assert.equal(isTeacherAssigned(createdUsername, className), true);
    for (const subject of subjects) {
      assert.equal(isTeacherAssignedSubject(createdUsername, className, subject), true);
    }
  }
  for (const row of mine) {
    assert.equal(row.teacherUsername, createdUsername);
    assert.equal(row.staffId, createdStaffId, 'assignment Staff ID-এর সাথে বাঁধা');
    assert.equal(row.source, 'directory');
  }
});

test('a non-teacher create has no class matrix at all', async () => {
  ctx.click(ctx.$('#staffCreateButton'));
  await ctx.waitFor(() => Boolean(ctx.$('#staffForm')));
  const form = ctx.$('#staffForm');
  const role = form.querySelector('#staffField-role');
  role.value = 'manager';
  role.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.flush();
  assert.equal(form.querySelectorAll('input[data-class-subject]').length, 0, 'ম্যানেজারের ক্লাস-বিষয় ম্যাট্রিক্স নেই');
  assert.equal(form.querySelector('#staffAssignmentFields').dataset.role, 'manager');
  // Leave the dialog the way it opened — nothing created here.
  ctx.click(form.querySelector('[data-staff-modal="close"]'));
  await ctx.waitFor(() => !ctx.$('#staffForm'));
  assert.equal((await listStaff()).some(item => item.fullName === 'Karim Uddin'), true, 'আগের শিক্ষক অক্ষত');
});

test('signed in, the teacher panel shows exactly the ticked classes', async () => {
  // The real teacher.html must read exactly what the Admin's form wrote.
  // The directory is stored as an AES-GCM envelope keyed by the device key
  // (activePlus.deviceKey.v1) — copying the whole storage IS "same device".
  const seed = { 'activePlus.demo.autofill.v1': 'off' };
  for (let i = 0; i < ctx.window.localStorage.length; i += 1) {
    const key = ctx.window.localStorage.key(i);
    seed[key] = ctx.window.localStorage.getItem(key);
  }
  const page = await loadPage('teacher.html', { seed });
  try {
    // A Staff-Directory teacher signs in as a PERSON: the session carries the
    // identity (Login User ID + Staff ID). The built-in teacher.apc device
    // account is not involved at all.
    await saveStaffSession('teacher', true, {
      username: createdUsername, staffId: createdStaffId, fullName: 'Karim Uddin'
    });
    const identity = readActiveStaffIdentity();
    assert.equal(identity.username, createdUsername, 'session কোন শিক্ষক login করেছে তা জানে');

    const { teacherReady } = await import('../js/teacher.js');
    if (teacherReady) await teacherReady;
    await page.waitFor(() => page.$('#teacherShell').hidden === false);
    await page.waitFor(() => [...page.$('#teacherClassFilter').options]
      .some(option => option.textContent === 'সব নির্ধারিত শ্রেণি'));

    const options = [...page.$('#teacherClassFilter').options].map(option => nfc(option.textContent));
    for (const className of Object.keys(ticked)) {
      assert.ok(options.includes(nfc(className)), `প্যানেলে ${className} দেখা যায়: ${options.join(' | ')}`);
    }
    assert.equal(page.$('#teacherClassFilter').options.length, Object.keys(ticked).length + 1,
      'নিজের ক্লাসগুলোই — একটিও বাড়তি বা বাদ পড়া নেই');
  } finally {
    page.window.close();
  }
});
