/* A refresh (or an accidentally reopened tab) keeps the page that was open:
   staff panels remember it in the URL hash, and — for admin — only a page the
   signed-in role may open is restored. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';

test('the admin panel reopens the page named in the URL', async () => {
  const ctx = await loadPage('admin.html', {
    hash: '#staff',
    seed: { 'activePlus.demo.autofill.v1': 'off', [ROSTER_KEY]: JSON.stringify(adminStudents) }
  });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  // The boot finishes after the shell unhides (staff snapshot, renders, then
  // the deep link), so wait for the first rendered grid before judging.
  await ctx.waitFor(() => ctx.$$('#adminFeatureGrid .admin-feature-tile').length > 0);
  await ctx.waitFor(() => ctx.$('.admin-view.active')?.dataset.viewPanel === 'staff');
  assert.equal(ctx.$('.admin-view.active').dataset.viewPanel, 'staff', 'the hash decides the first page');
  // Opening another page updates the URL, so the next refresh stays there.
  ctx.click(ctx.$('#adminFeatureGrid [data-admin-view="students"]'));
  await ctx.waitFor(() => ctx.$('.admin-view.active')?.dataset.viewPanel === 'students');
  assert.equal(ctx.window.location.hash, '#students');
  ctx.window.close();
});
