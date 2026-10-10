/* Admin Panel navigation: every activation is a fresh load.

   The frozen-tab bug: a tab rendered once and never again, so Home → tab
   showed whatever an earlier visit (or a failed async read) left behind.
   Locked down here on the real admin.html + js/admin.js:

     • revisiting a tab re-reads its data (a staff record created while the
       tab was closed appears on the next activation)
     • the URL hash names the open section; a hashchange (deep link, typed
       address, Back/Forward) re-activates the right section — no stale panel
       content and no URL/visual mismatch
     • clicking the same tab repeatedly never builds duplicate content
*/
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { createStaff } from '../js/staff-directory.js';

const DEMO_OFF = { 'activePlus.demo.autofill.v1': 'off' };
let ctx;

const activePanel = () => ctx.$('.admin-view.active')?.dataset.viewPanel;
const activeSeat = () => ctx.$('.admin-bottom-item.active')?.dataset.adminView;

before(async () => {
  ctx = await loadPage('admin.html', { seed: DEMO_OFF });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 4);
});
after(() => ctx?.window.close());

test('revisiting a tab reloads its data — never a stale snapshot', async () => {
  assert.equal(activePanel(), 'dashboard');
  // Open Staff Management once: the seeded directory paints.
  ctx.click(ctx.$('.admin-bottom-item[data-admin-view="staff"]'));
  await ctx.waitFor(() => activePanel() === 'staff');
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 4);
  const before = ctx.$$('#staffList .staff-card').length;

  // While the tab is "closed", a staff account is created elsewhere (API).
  const created = await createStaff({
    fullName: 'Fresh Data', password: 'Fresh-2026', confirmPassword: 'Fresh-2026', role: 'teacher'
  });
  assert.equal(created.ok, true, created.error);

  // Home → Staff again: the activation must show the new record.
  ctx.click(ctx.$('.admin-bottom-item[data-admin-view="dashboard"]'));
  await ctx.waitFor(() => activePanel() === 'dashboard');
  ctx.click(ctx.$('.admin-bottom-item[data-admin-view="staff"]'));
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length > before);
  assert.ok(ctx.$(`[data-staff-card="${created.staff.staffId}"]`), 'the fresh record is on screen');
});

test('the URL hash and the open section never disagree', async () => {
  // Deep link / typed address: #reports opens Reports on its own.
  ctx.window.location.hash = '#reports';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.waitFor(() => activePanel() === 'reports');
  assert.equal(ctx.window.location.hash, '#reports');

  ctx.window.location.hash = '#staff';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.waitFor(() => activePanel() === 'staff');
  assert.equal(activeSeat(), 'staff', 'the lit seat matches the open section');

  // An unknown hash keeps the panel where it is instead of blanking.
  ctx.window.location.hash = '#not-a-view';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.flush();
  assert.equal(activePanel(), 'staff');
});

test('clicking the same tab repeatedly builds no duplicate content and no stuck state', async () => {
  ctx.click(ctx.$('.admin-bottom-item[data-admin-view="staff"]'));
  await ctx.waitFor(() => activePanel() === 'staff');
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 4);
  const count = ctx.$$('#staffList .staff-card').length;

  for (let i = 0; i < 3; i += 1) {
    ctx.click(ctx.$('.admin-bottom-item[data-admin-view="staff"]'));
    await ctx.flush();
  }
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 4);
  assert.equal(ctx.$$('#staffList .staff-card').length, count, 'same rows, no duplicated render');

  // Hub → sub-screen → Home → hub again: each activation repaints cleanly.
  ctx.click(ctx.$('.admin-bottom-item[data-admin-view="system"]'));
  await ctx.waitFor(() => activePanel() === 'system');
  ctx.click(ctx.$('#adminSystemMenu [data-admin-view="security"]'));
  await ctx.waitFor(() => activePanel() === 'security');
  assert.equal(activeSeat(), 'system', 'the hub seat stays lit inside its sub-screen');
  ctx.click(ctx.$('.admin-bottom-item[data-admin-view="dashboard"]'));
  await ctx.waitFor(() => activePanel() === 'dashboard');
  ctx.click(ctx.$('.admin-bottom-item[data-admin-view="system"]'));
  await ctx.waitFor(() => activePanel() === 'system');
  ctx.click(ctx.$('#adminSystemMenu [data-admin-view="security"]'));
  await ctx.waitFor(() => activePanel() === 'security');
  assert.equal(activePanel(), 'security', 'the sub-screen opens again, not a frozen earlier state');
});

test('no uncaught JavaScript errors accumulated during the navigation runs', () => {
  assert.deepEqual(ctx.jsdomErrors, []);
});
