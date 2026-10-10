/* Admin navigation entries bind exactly once.

   The সিস্টেম / ডেটা hub rows live in static markup and the shell may rebuild
   itself on re-entry; a second binding would call navigate() twice per click.
   Driven on a bare admin.html (no panel boot) so every navigate call is
   observable: build the shell twice, click once, expect exactly one call.
*/
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { initAdminPanelShell } from '../js/admin-panel-ui.js';
import { createAccess } from '../js/admin-permissions.js';

let ctx;
before(async () => {
  ctx = await loadPage('admin.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
});
after(() => ctx?.window.close());

test('rebuilding the shell never duplicates hub or tile handlers', async () => {
  const calls = [];
  const onNavigate = view => calls.push(view);
  const access = createAccess('admin');
  initAdminPanelShell({ access, onNavigate });
  initAdminPanelShell({ access, onNavigate });

  const hubItem = ctx.$('#adminSystemMenu [data-admin-view="security"]');
  assert.ok(hubItem, 'the hub row survives the rebuild');
  ctx.click(hubItem);
  await ctx.flush();
  assert.deepEqual(calls, ['security'], 'one click, one navigation');

  const tile = ctx.$('#adminFeatureGrid [data-admin-view="students"]');
  if (tile) {
    calls.length = 0;
    ctx.click(tile);
    await ctx.flush();
    assert.deepEqual(calls, ['students'], 'tiles are bound once as well');
  }

  // Bottom bar buttons are rebuilt (replaceChildren) — also single-fire.
  calls.length = 0;
  ctx.click(ctx.$('.admin-bottom-item[data-admin-view="staff"]'));
  await ctx.flush();
  assert.deepEqual(calls, ['staff']);
});
