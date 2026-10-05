/* Manager panel — the three forms that an async handler fills from the event.
   Found by the UI sweep (2026-09-29): `event.currentTarget` is null once the
   dispatch is over, so an `async` submit handler that awaits a session guard
   and THEN reads `event.currentTarget` builds `new FormData(null)` and throws
   in a real browser — publish notice, edit a student's operational info and
   add a routine entry were all silently dead. Each handler now captures the
   form synchronously; these tests fail if that regresses (jsdom throws the
   same TypeError, which surfaces as an unhandled rejection). */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { ROSTER_KEY, loadRoutine } from '../js/office-data.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';

let ctx;

const roster = [
  { id: 'S-EDIT', name: 'সম্পাদনার শিক্ষার্থী', className: 'নবম শ্রেণি', group: 'A', mobile: '01700000000', guardianMobile: '01800000000', status: 'approved', monthlyFee: 1200 }
];

before(async () => {
  ctx = await loadPage('manager.html', { seed: { [ROSTER_KEY]: JSON.stringify(roster) } });
  await provisionStaff('manager');
  seedStaffSession(ctx.window, 'manager');
  await import('../js/manager.js');
  await ctx.waitFor(() => ctx.$('#managerShell').hidden === false);
  await ctx.flush();
});

const openView = async view => {
  ctx.click(ctx.$(`.manager-bottom [data-manager-view="${view}"]`) || ctx.$(`[data-manager-view="${view}"]`));
  await ctx.flush();
};

test('publishing an operational notice from the Manager form really saves it', async () => {
  await openView('notices');
  const form = ctx.$('#managerNoticeForm');
  assert.ok(form, 'the notice form is on the page');
  ctx.type(form.querySelector('[name="title"]'), 'অভিভাবক সভা');
  ctx.type(form.querySelector('[name="body"]'), 'আগামী শুক্রবার সকাল ১০টায় অভিভাবক সভা।');
  form.querySelector('[name="audience"]').value = 'অভিভাবক';
  form.querySelector('[name="category"]').value = 'class';
  ctx.submit(form);
  await ctx.waitFor(() => ctx.$('#managerNoticeList').textContent.includes('অভিভাবক সভা'));
  const stored = JSON.parse(ctx.window.localStorage.getItem('activePlus.admin.notices.v1') || '[]');
  const notice = stored.find(item => item.title === 'অভিভাবক সভা');
  assert.ok(notice, 'the notice reached local storage (and from there the cloud bridge)');
  assert.equal(notice.audience, 'অভিভাবক');
  assert.equal(notice.category, 'class');
  assert.equal(notice.author, 'manager.apc');
  assert.equal(notice.status, 'published');
});

test('editing a notice from the Manager card persists its new category', async () => {
  await openView('notices');
  const storedBefore = JSON.parse(ctx.window.localStorage.getItem('activePlus.admin.notices.v1') || '[]');
  const notice = storedBefore.find(item => item.title === 'অভিভাবক সভা');
  assert.ok(notice, 'the published notice is available to edit');
  const values = ['পরীক্ষার দিন বদল', 'নতুন সময়সূচি প্রকাশ করা হয়েছে।', 'exam'];
  const originalPrompt = ctx.window.prompt;
  const promptCalls = [];
  ctx.window.prompt = (...args) => { promptCalls.push(args); return values.shift(); };
  try {
    ctx.click(ctx.$(`[data-manager-action="edit-notice"][data-id="${notice.id}"]`));
    await ctx.waitFor(() => promptCalls.length === 3, 3000);
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally { ctx.window.prompt = originalPrompt; }
  const updated = JSON.parse(ctx.window.localStorage.getItem('activePlus.admin.notices.v1')).find(item => item.id === notice.id);
  assert.equal(updated.category, 'exam');
  assert.equal(updated.body, 'নতুন সময়সূচি প্রকাশ করা হয়েছে।');
});

test('editing a student from the Manager card saves the operational fields', async () => {
  await openView('students');
  await ctx.waitFor(() => Boolean(ctx.$('[data-manager-action="edit-student"]')));
  ctx.click(ctx.$('[data-manager-action="edit-student"]'));
  await ctx.waitFor(() => Boolean(ctx.$('.manager-edit-form')));
  const form = ctx.$('.manager-edit-form');
  ctx.type(form.querySelector('[name="mobile"]'), '01911111111');
  ctx.type(form.querySelector('[name="group"]'), 'B');
  form.querySelector('[name="monthlyFee"]').value = '1800';
  ctx.submit(form);
  await ctx.waitFor(() => {
    const saved = JSON.parse(ctx.window.localStorage.getItem(ROSTER_KEY) || '[]');
    return saved.some(student => student.mobile === '01911111111');
  });
  const saved = JSON.parse(ctx.window.localStorage.getItem(ROSTER_KEY)).find(student => student.id === 'S-EDIT');
  assert.equal(saved.mobile, '01911111111');
  assert.equal(saved.group, 'B');
  assert.equal(saved.monthlyFee, 1800);
  assert.equal(saved.name, 'সম্পাদনার শিক্ষার্থী', 'nothing else about the student changed');
});

test('adding a routine entry from the Manager form publishes it for every panel', async () => {
  await openView('routine');
  const form = ctx.$('#managerRoutineForm');
  assert.ok(form, 'the routine form is on the page');
  ctx.type(form.querySelector('[name="subject"]'), 'ইংরেজি');
  ctx.type(form.querySelector('[name="teacher"]'), 'রহিম স্যার');
  ctx.type(form.querySelector('[name="room"]'), 'রুম ৪');
  const time = form.querySelector('[name="time"]');
  time.value = '10:30';
  time.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  const day = loadRoutine().sat ? 'sat' : Object.keys(loadRoutine())[0];
  ctx.submit(form);
  await ctx.waitFor(() => (loadRoutine()[day]?.classes || []).some(row => row.subject === 'ইংরেজি'));
  const row = loadRoutine()[day].classes.find(item => item.subject === 'ইংরেজি');
  assert.equal(row.teacher, 'রহিম স্যার');
  assert.equal(row.room, 'রুম ৪');
  assert.equal(row.period, 'সকাল', '১০:৩০ is labelled সকাল, not a different period');
  assert.match(row.time, /১০:৩০/);
  assert.equal(ctx.$('#managerRoutineList').textContent.includes('ইংরেজি'), true, 'the added row is rendered');
});

test('no unhandled rejection escapes the three forms', () => {
  assert.deepEqual(ctx.jsdomErrors, []);
});
