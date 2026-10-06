/* The Manager Reports page, on its own: opening it used to throw
   ('renderReportPreview is not defined') and the URL never recorded the page,
   so a refresh dropped the Manager back on the dashboard. One page per test
   file: the panel modules read the window globals of the page that loaded them. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { openStaffPanel } from './staff-harness.mjs';

test('the reports page opens from the আরও menu and survives a refresh', async () => {
  const manager = await loadPage('manager.html', {
    hash: '#reports',
    seed: { 'activePlus.demo.autofill.v1': 'off' }
  });
  await openStaffPanel(manager, 'manager', {
    importPanel: () => import('../js/manager.js'),
    shellId: 'managerShell',
    ready: () => Boolean(manager.$('.manager-view.active'))
  });
  const active = manager.$('.manager-view.active');
  assert.equal(active.dataset.viewPanel, 'reports', 'a refresh lands on Reports');
  assert.equal(active.hidden, false);
  // The রিপোর্ট seat of the bottom bar opens it too, and the URL follows.
  manager.click(manager.$('.manager-bottom [data-manager-view="more"]'));
  await manager.flush();
  manager.click(manager.$('.manager-bottom [data-manager-view="reports"]'));
  await manager.flush();
  assert.equal(manager.$('.manager-view.active').dataset.viewPanel, 'reports');
  assert.equal(manager.window.location.hash, '#reports');
  assert.deepEqual(manager.jsdomErrors, [], 'opening Reports raises no error');
  manager.window.close();
});
