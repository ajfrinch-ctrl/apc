import test from 'node:test';
import assert from 'node:assert/strict';
import { STAFF_PANEL_ROLES, staffRoleFromPath, applyStaffPanelTheme } from '../js/staff-panel-theme.js';

test('recognizes only the four staff entry pages', () => {
  assert.deepEqual(STAFF_PANEL_ROLES, ['teacher', 'manager', 'admin', 'payment']);
  assert.equal(staffRoleFromPath('/teacher.html'), 'teacher');
  assert.equal(staffRoleFromPath('/manager.html?from=notice'), 'manager');
  assert.equal(staffRoleFromPath('/admin.html#reports'), 'admin');
  assert.equal(staffRoleFromPath('/payment.html'), 'payment');
  assert.equal(staffRoleFromPath('/index.html'), '');
});

test('applies the role as a presentation-only root marker', () => {
  const root = { dataset: {} };
  assert.equal(applyStaffPanelTheme({ root, pathname: '/manager.html' }), 'manager');
  assert.equal(root.dataset.staffPanel, 'manager');
  assert.equal(applyStaffPanelTheme({ root, pathname: '/index.html' }), '');
  assert.equal(root.dataset.staffPanel, 'manager');
});


test('all four staff identity cards use the shared profile surface', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const [page, id] of [
    ['admin.html', 'adminProfileCard'],
    ['teacher.html', 'teacherProfileCard'],
    ['manager.html', 'managerProfileCard'],
    ['payment.html', 'payOwnProfileCard']
  ]) {
    const html = await readFile(new URL('../' + page, import.meta.url), 'utf8');
    assert.match(html, new RegExp('class="[^"]*\\bstaff-profile-card\\b[^"]*"[^>]*id="' + id + '"|id="' + id + '"[^>]*class="[^"]*\\bstaff-profile-card\\b'));
  }
});
