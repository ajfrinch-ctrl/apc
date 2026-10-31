/* Admin ▸ শিক্ষার্থী ব্যবস্থাপনা — the name-visibility contract.

   History, because it explains the final shape:
     • the list once masked every field and offered no way to reveal it, so a
       screenful of rows read “গোপন তথ্য” and staff had to open one profile per
       name (owner report 2026-10-31: “শিক্ষার্থির নাম দেখাচ্ছে না”);
     • a fix then masked rows *with* a per-row reveal;
     • the owner settled the rule on 2026-10-31 —
       **“তালিকায় নাম সবসময় দেখা যাক, শুধু ফোন/আইডি লুকানো থাকুক”**.

   So this suite pins the settled rule, not the intermediate one:
     • the student's name and initials avatar are always painted,
     • the Student ID opens as `••••` behind that row's own “আইডি দেখুন”,
     • no phone number ever reaches this list at all,
     • the toolbar switch reveals / re-masks every ID at once,
     • the pending-registration queue names the applicant immediately and hides
       only the mobile + ID,
     • nothing is stored: a reload masks the IDs again.
*/
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { ROSTER_KEY } from '../js/office-data.js';

const roster = [
  { id: 'AP-201', name: 'রাইসা ইসলাম', fatherName: 'শফিকুল ইসলাম', className: 'নবম শ্রেণি', group: 'A', mobile: '01812345679', guardianMobile: '01812345670', status: 'approved', monthlyFee: 2000 },
  { id: 'AP-202', name: 'ফারহানা নূর', fatherName: 'মাহবুব আলম', className: 'দশম শ্রেণি', group: 'B', mobile: '01912345678', guardianMobile: '01912345670', status: 'pending', createdAt: new Date().toISOString() },
  { id: 'AP-203', name: 'নুসরাত জাহান', fatherName: 'আবুল কাশেম', className: 'নবম শ্রেণি', group: 'A', mobile: '01712345670', guardianMobile: '01712345671', status: 'approved', monthlyFee: 2000 }
];

let ctx;

before(async () => {
  ctx = await loadPage('admin.html', { seed: { 'activePlus.demo.autofill.v1': 'off', [ROSTER_KEY]: JSON.stringify(roster) } });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false, 20000);
  /* Open শিক্ষার্থী ব্যবস্থাপনা through the same route the sidebar uses, then
     unfold "সব শিক্ষার্থী দেখুন" — the directory panel starts collapsed. */
  ctx.window.location.hash = 'students';
  ctx.window.dispatchEvent(new ctx.window.HashChangeEvent('hashchange'));
  await ctx.flush();
  const allCard = ctx.$('[data-admin-student-card="all"]');
  if (allCard && allCard.getAttribute('aria-expanded') !== 'true') ctx.click(allCard);
  await ctx.waitFor(() => ctx.$$('#studentList .student-row').length === roster.length);
});

after(() => ctx?.window?.close?.());

const rows = () => ctx.$$('#studentList .student-row');
const rowFor = id => ctx.$(`#studentList [data-student-row="${id}"]`);
const revealButton = id => ctx.$(`#studentList [data-action="reveal-student"][data-id="${id}"]`);
const hideButton = id => ctx.$(`#studentList [data-action="hide-student"][data-id="${id}"]`);

test('every row names the student, and only the ID waits behind a button', () => {
  assert.equal(rows().length, roster.length, 'the roster is listed');
  const text = ctx.$('#studentList').textContent;
  for (const student of roster) {
    assert.ok(text.includes(student.name), `${student.name} is readable at a glance`);
    const row = rowFor(student.id);
    /* The avatar is drawn from the name, never a placeholder. */
    assert.match(row.querySelector('.student-avatar').textContent.trim(), /^[^\s•]+$/, 'the avatar is initials, not a mask');
    assert.match(row.textContent, /ID: ••••/, `${student.id} keeps its ID masked`);
    assert.equal(
      row.querySelector('.audit-id-badge').textContent.includes(student.id),
      false,
      'the real Student ID is not printed before the reveal'
    );
  }
  /* Phone numbers never reach this list, masked or not. */
  for (const student of roster) {
    assert.equal(text.includes(student.mobile), false, 'no student mobile in the open list');
    assert.equal(text.includes(student.guardianMobile), false, 'no guardian number either');
  }
  for (const student of roster) {
    const button = revealButton(student.id);
    assert.ok(button, `${student.id} has its own ID reveal`);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.textContent.trim(), 'আইডি দেখুন');
  }
});

test('one click reveals that row\'s ID only — names keep showing either way', async () => {
  ctx.click(revealButton('AP-201'));
  await ctx.flush();

  const opened = rowFor('AP-201');
  assert.equal(opened.dataset.studentRevealed, '1', 'the opened row is marked');
  assert.match(opened.querySelector('.audit-id-badge').textContent, /AP-201/, 'the Student ID is shown');
  assert.match(opened.textContent, /রাইসা ইসলাম/, 'the name is still there');
  assert.equal(hideButton('AP-201').textContent.trim(), 'আইডি লুকান');
  assert.equal(hideButton('AP-201').getAttribute('aria-expanded'), 'true');

  for (const other of ['AP-202', 'AP-203']) {
    assert.equal(rowFor(other).dataset.studentRevealed, undefined, `${other} is still closed`);
    assert.match(rowFor(other).textContent, /ID: ••••/, `${other} keeps its ID masked`);
    assert.equal(rowFor(other).textContent.includes(other), false);
  }

  ctx.click(hideButton('AP-201'));
  await ctx.flush();
  assert.match(rowFor('AP-201').querySelector('.audit-id-badge').textContent, /••••/);
  assert.match(rowFor('AP-201').textContent, /রাইসা ইসলাম/, 'hiding the ID never hides the name');
});

test('the toolbar switch reveals every ID and masks them again', async () => {
  const toggle = ctx.$('#studentRevealAll');
  assert.equal(toggle.textContent.trim(), 'সব আইডি দেখান');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');

  ctx.click(toggle);
  await ctx.flush();
  for (const student of roster) {
    assert.match(rowFor(student.id).querySelector('.audit-id-badge').textContent, new RegExp(student.id));
    assert.match(rowFor(student.id).textContent, new RegExp(student.name), 'names stay readable throughout');
  }
  assert.equal(ctx.$('#studentRevealAll').textContent.trim(), 'সব আইডি লুকান');
  assert.equal(ctx.$('#studentRevealAll').getAttribute('aria-pressed'), 'true');

  ctx.click(ctx.$('#studentRevealAll'));
  await ctx.flush();
  for (const student of roster) {
    assert.match(rowFor(student.id).textContent, /ID: ••••/, `${student.id} is masked again`);
    assert.match(rowFor(student.id).textContent, new RegExp(student.name), 'and still named');
  }
  assert.equal(ctx.$('#studentRevealAll').textContent.trim(), 'সব আইডি দেখান');
});

test('an opened row survives a repaint, and the reveal never lands in storage', async () => {
  ctx.click(revealButton('AP-203'));
  await ctx.flush();
  // Search repaints the same list: the opened row stays open, others stay masked.
  const search = ctx.$('#studentSearch');
  search.value = 'নুসরাত';
  search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  await ctx.flush();
  assert.equal(rows().length, 1, 'the search narrows the roster');
  assert.match(rows()[0].textContent, /নুসরাত জাহান/, 'the opened row is named');
  assert.match(rows()[0].querySelector('.audit-id-badge').textContent, /AP-203/, 'and keeps its reveal');
  search.value = '';
  search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  await ctx.flush();

  const keys = Object.keys(ctx.window.localStorage).filter(key => /reveal|privacy/i.test(key));
  assert.deepEqual(keys, [], 'the reveal is memory only');
});

test('a name search finds the record without needing a reveal', async () => {
  ctx.click(ctx.$('#studentRevealAll')); // reveal-all on
  await ctx.flush();
  ctx.click(ctx.$('#studentRevealAll')); // back to masked
  await ctx.flush();

  const search = ctx.$('#studentSearch');
  search.value = 'ফারহানা';
  search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  await ctx.flush();
  assert.equal(rows().length, 1, 'the stored record is found by name');
  assert.match(rows()[0].textContent, /ফারহানা নূর/, 'the hit is named — that is the point of the rule');
  assert.match(rows()[0].textContent, /ID: ••••/, 'its ID is still hidden');
  const button = ctx.$('#studentList [data-action="reveal-student"]');
  assert.equal(button.dataset.id, 'AP-202');
  ctx.click(button);
  await ctx.flush();
  assert.match(rows()[0].querySelector('.audit-id-badge').textContent, /AP-202/, 'the reader sees the ID on request');

  search.value = '';
  search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  await ctx.flush();
});

test('the pending queue names the applicant up front and hides only mobile + ID', async () => {
  const queue = ctx.$('#adminPendingRegistrations');
  assert.ok(queue && !queue.hidden, 'the pending application is on screen');
  const item = queue.querySelector('[data-pending-student-row="AP-202"]');
  assert.ok(item, 'the pending student has a queue row');

  assert.match(item.textContent, /ফারহানা নূর/, 'the applicant is named without a click');
  assert.equal(item.textContent.includes('01912345678'), false, 'the mobile is masked');
  assert.match(item.textContent, /আইডি: ••••/);
  assert.equal(item.textContent.includes('AP-202'), false, 'the Student ID is masked');
  /* Decision buttons are usable while the contact layer is hidden. */
  assert.ok(item.querySelector('[data-pending-approve="AP-202"]'), 'approve is wired');
  assert.ok(item.querySelector('[data-pending-reject="AP-202"]'), 'reject is wired');

  const reveal = item.querySelector('[data-pending-reveal]');
  assert.equal(reveal.textContent.trim(), 'নম্বর ও আইডি দেখুন');
  ctx.click(reveal);
  await ctx.flush();

  const opened = ctx.$('#adminPendingRegistrations [data-pending-student-row="AP-202"]');
  assert.equal(opened.dataset.pendingRevealed, '1');
  assert.match(opened.textContent, /01912345678/, 'the mobile is readable for a callback');
  assert.match(opened.textContent, /AP-202/, 'and the Student ID');
  assert.match(opened.textContent, /ফারহানা নূর/, 'the name never moved');
  assert.equal(opened.querySelector('[data-pending-reveal]').textContent.trim(), 'নম্বর ও আইডি লুকান');
  assert.ok(opened.querySelector('[data-pending-approve="AP-202"]'), 'approve is still wired');
  assert.ok(opened.querySelector('[data-pending-reject="AP-202"]'), 'reject is still wired');
});
