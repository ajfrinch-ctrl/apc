/* Admin ▸ শিক্ষার্থী ব্যবস্থাপনা — owner report 2026-10-31:
   "শিক্ষার্থী ব্যবস্থাপনা এ শিক্ষার্থির নাম দেখাচ্ছে না।"

   The list was masked for privacy (every row read “গোপন তথ্য”) but nothing on
   the row could reveal it — only the profile modal could, so a screenful of
   students could not be told apart, and staff had to open one modal per name.

   Owner rule now in force — "প্রাইমারি ডেটা হাইড থাকবে সব ক্ষেত্রে। ক্লিক করলেই
   দেখাবে।" — so this suite pins the Yellow Pages contract onto this screen:
     • every row opens masked (name, avatar, Student ID),
     • one click on that row's “তথ্য দেখুন” reveals only that row,
     • the toolbar switch reveals / re-masks the whole roster,
     • the pending-registration queue above it has its own per-application
       reveal, because an application cannot be approved anonymously,
     • nothing is stored: a reload masks everything again.
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

test('every student row opens masked, with no name in the list text or labels', () => {
  assert.equal(rows().length, roster.length, 'the roster is listed');
  const text = ctx.$('#studentList').textContent;
  for (const student of roster) {
    assert.equal(text.includes(student.name), false, `${student.name} stays hidden until asked`);
    assert.equal(text.includes(student.id), false, 'the Student ID stays hidden too');
    assert.equal(text.includes(student.mobile), false, 'no phone number in the open list');
    assert.equal(text.includes(student.guardianMobile), false, 'no guardian number either');
  }
  assert.ok(text.includes('গোপন তথ্য'), 'each row carries the placeholder');
  // A masked row must not leak the name into an aria-label either.
  const labels = [...ctx.$('#studentList').querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label')).join(' ');
  assert.equal(/রাইসা|ফারহানা|নুসরাত/.test(labels), false, 'masked rows keep their labels name-free');
  for (const student of roster) {
    const button = revealButton(student.id);
    assert.ok(button, `${student.id} has its own reveal switch`);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.textContent.trim(), 'তথ্য দেখুন');
  }
});

test('one click reveals that row only — and the same row masks again', async () => {
  ctx.click(revealButton('AP-201'));
  await ctx.flush();

  const opened = rowFor('AP-201');
  assert.equal(opened.dataset.studentRevealed, '1', 'the opened row is marked');
  assert.match(opened.textContent, /রাইসা ইসলাম/, 'the name is shown');
  assert.match(opened.textContent, /AP-201/, 'and the Student ID');
  assert.equal(hideButton('AP-201').textContent.trim(), 'তথ্য লুকান');
  assert.equal(hideButton('AP-201').getAttribute('aria-expanded'), 'true');

  // Every other row stays masked, and their names still never appear.
  for (const other of ['AP-202', 'AP-203']) {
    assert.equal(rowFor(other).dataset.studentRevealed, undefined, `${other} is still closed`);
    assert.match(rowFor(other).textContent, /গোপন তথ্য/);
    assert.equal(rowFor(other).textContent.includes(other), false);
  }

  ctx.click(hideButton('AP-201'));
  await ctx.flush();
  assert.match(rowFor('AP-201').textContent, /গোপন তথ্য/);
  assert.equal(rowFor('AP-201').textContent.includes('রাইসা'), false, 'masking hides the name again');
});

test('the toolbar switch reveals the whole roster and masks it again', async () => {
  const toggle = ctx.$('#studentRevealAll');
  assert.equal(toggle.textContent.trim(), 'সব তথ্য দেখান');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');

  ctx.click(toggle);
  await ctx.flush();
  for (const student of roster) {
    assert.match(rowFor(student.id).textContent, new RegExp(student.name), `${student.name} is revealed`);
    assert.match(rowFor(student.id).textContent, new RegExp(student.id));
  }
  assert.equal(ctx.$('#studentRevealAll').textContent.trim(), 'সব তথ্য লুকান');
  assert.equal(ctx.$('#studentRevealAll').getAttribute('aria-pressed'), 'true');

  ctx.click(ctx.$('#studentRevealAll'));
  await ctx.flush();
  for (const student of roster) {
    assert.match(rowFor(student.id).textContent, /গোপন তথ্য/, `${student.id} is masked again`);
    assert.equal(rowFor(student.id).textContent.includes(student.name), false);
  }
  assert.equal(ctx.$('#studentRevealAll').textContent.trim(), 'সব তথ্য দেখান');
});

test('an opened row survives a repaint, and the reveal never lands in storage', async () => {
  ctx.click(revealButton('AP-203'));
  await ctx.flush();
  // Search repaints the same list: the opened row stays open, the rest masked.
  const search = ctx.$('#studentSearch');
  search.value = 'নুসরাত';
  search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  await ctx.flush();
  assert.equal(rows().length, 1, 'the search narrows the roster');
  assert.match(rows()[0].textContent, /নুসরাত জাহান/, 'the opened row keeps its reveal');
  search.value = '';
  search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  await ctx.flush();

  const keys = Object.keys(ctx.window.localStorage).filter(key => /reveal|privacy/i.test(key));
  assert.deepEqual(keys, [], 'the reveal is memory only');
});

test('a search hit opens masked until the reader asks for it', async () => {
  ctx.click(ctx.$('#studentRevealAll')); // reveal-all on
  await ctx.flush();
  ctx.click(ctx.$('#studentRevealAll')); // back to masked
  await ctx.flush();

  const search = ctx.$('#studentSearch');
  search.value = 'ফারহানা';
  search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  await ctx.flush();
  assert.equal(rows().length, 1, 'the stored record is found by name');
  assert.match(rows()[0].textContent, /গোপন তথ্য/, 'but the result is still masked');
  const button = ctx.$('#studentList [data-action="reveal-student"]');
  assert.equal(button.dataset.id, 'AP-202');
  ctx.click(button);
  await ctx.flush();
  assert.match(rows()[0].textContent, /ফারহানা নূর/, 'the reader names the record they found');

  search.value = '';
  search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  await ctx.flush();
});

test('the pending-registration queue can name the applicant before a decision', async () => {
  const queue = ctx.$('#adminPendingRegistrations');
  assert.ok(queue && !queue.hidden, 'the pending application is on screen');
  const item = queue.querySelector('[data-pending-student-row="AP-202"]');
  assert.ok(item, 'the pending student has a queue row');

  assert.match(item.textContent, /গোপন তথ্য/, 'the queue opens masked');
  assert.equal(item.textContent.includes('ফারহানা নূর'), false);
  assert.equal(item.textContent.includes('01912345678'), false, 'the mobile is masked');
  assert.match(item.textContent, /আইডি: ••••/);

  const reveal = item.querySelector('[data-pending-reveal]');
  assert.equal(reveal.textContent.trim(), 'তথ্য দেখুন');
  ctx.click(reveal);
  await ctx.flush();

  const opened = ctx.$('#adminPendingRegistrations [data-pending-student-row="AP-202"]');
  assert.equal(opened.dataset.pendingRevealed, '1');
  assert.match(opened.textContent, /ফারহানা নূর/, 'the applicant is named');
  assert.match(opened.textContent, /01912345678/, 'and their mobile is readable for a callback');
  assert.match(opened.textContent, /AP-202/, 'and the Student ID');
  assert.equal(opened.querySelector('[data-pending-reveal]').textContent.trim(), 'তথ্য লুকান');
  // The decision buttons survive the repaint.
  assert.ok(opened.querySelector('[data-pending-approve="AP-202"]'), 'approve is still wired');
  assert.ok(opened.querySelector('[data-pending-reject="AP-202"]'), 'reject is still wired');
});
