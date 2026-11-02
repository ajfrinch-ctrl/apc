/* A direct visit to Routine must populate the required class select.
   jsdom submit alone does not exercise native required-select validation. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { enabledClasses } from '../js/config.js';
import { loadRoutine } from '../js/office-data.js';
let ctx;
before(async () => {
  ctx = await loadPage('manager.html', { seed:{'activePlus.demo.autofill.v1':'off'} });
  await provisionStaff('manager'); seedStaffSession(ctx.window,'manager');
  await import('../js/manager.js?direct-routine-145');
  await ctx.waitFor(() => !ctx.$('#managerShell').hidden);
  // Open straight from the home service, without visiting Classes first.
  ctx.click(ctx.$('[data-view-panel="dashboard"] [data-panel-view="routine"]'));
});

test('direct Routine entry supplies all existing allowed class choices', () => {
  const select = ctx.$('#managerRoutineClass');
  assert.equal(select.options[0]?.value, '', 'a class must be chosen, not guessed');
  assert.deepEqual([...select.options].slice(1).map(option => option.value), [...enabledClasses]);
  assert.equal(ctx.$('[data-view-panel="routine"]').hidden, false);
});

test('switching routine days preserves an explicitly selected class', () => {
  const select = ctx.$('#managerRoutineClass');
  select.value = 'দশম শ্রেণি';
  ctx.click(ctx.$('[data-routine-day="thu"]'));
  assert.equal(select.value, 'দশম শ্রেণি');
  ctx.click(ctx.$('[data-routine-day="sat"]'));
  assert.equal(select.value, 'দশম শ্রেণি');
});

test('the unchanged guarded form really saves the selected class on a direct visit', async () => {
  const form = ctx.$('#managerRoutineForm');
  form.querySelector('[name="className"]').value = 'দশম শ্রেণি';
  ctx.type(form.querySelector('[name="subject"]'),'নমুনা গণিত');
  ctx.type(form.querySelector('[name="teacher"]'),'নমুনা শিক্ষক');
  ctx.type(form.querySelector('[name="room"]'),'নমুনা রুম ২');
  form.querySelector('[name="time"]').value = '16:00';
  assert.equal(form.checkValidity(), true, 'all native required controls have valid values');
  ctx.submit(form);
  await ctx.waitFor(() => (loadRoutine().sat?.classes || []).some(row => row.subject === 'নমুনা গণিত'));
  const row = loadRoutine().sat.classes.find(row => row.subject === 'নমুনা গণিত');
  assert.equal(row.className,'দশম শ্রেণি');
  assert.equal(row.teacher,'নমুনা শিক্ষক');
  assert.equal(row.status,'published');
  assert.deepEqual(ctx.jsdomErrors,[]);
});

after(() => ctx?.window.close());
