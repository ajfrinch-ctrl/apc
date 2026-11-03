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


test('all four staff home dashboards use the shared responsive action grid', async () => {
  const { readFile } = await import('node:fs/promises');
  const cases = [
    ['admin.html', 'adminFeatureGrid'],
    ['teacher.html', 'দ্রুত কাজ'],
    ['manager.html', 'দ্রুত অ্যাক্সেস'],
    ['payment.html', 'pay-home-actions']
  ];
  for (const [page, marker] of cases) {
    const html = await readFile(new URL('../' + page, import.meta.url), 'utf8');
    assert.ok(html.includes('staff-home-action-grid'), page + ' must use the shared action grid');
    assert.ok(html.includes(marker), page + ' must retain its role-specific home content');
  }
  const theme = await readFile(new URL('../css/staff-panel-theme.css', import.meta.url), 'utf8');
  assert.match(theme, /\.staff-home-action-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(theme, /max-width:\s*360px/);
});


test('role-specific Home summaries share the same outer surface and KPI geometry', async () => {
  const { readFile } = await import('node:fs/promises');
  const cases = [
    ['admin.html', ['staff-home-summary-surface']],
    ['teacher.html', ['staff-home-summary-surface']],
    ['manager.html', ['staff-home-summary-surface', 'staff-home-kpi']],
    ['payment.html', ['staff-home-summary-surface']]
  ];
  for (const [page, classes] of cases) {
    const html = await readFile(new URL('../' + page, import.meta.url), 'utf8');
    for (const name of classes) assert.ok(html.includes(name), page + ' must use ' + name);
  }
  const theme = await readFile(new URL('../css/staff-panel-theme.css', import.meta.url), 'utf8');
  assert.match(theme, /\.staff-home-summary-surface\s*\{[^}]*border-radius:\s*22px/s);
  assert.match(theme, /\.staff-home-kpi\s*\{[^}]*min-height:\s*88px/s);
});
