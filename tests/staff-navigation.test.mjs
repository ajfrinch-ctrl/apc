import test from 'node:test';
import assert from 'node:assert/strict';
import { STAFF_NAV_TABS, STAFF_NAV_ROUTES, staffTabForRoute, syncStaffNavigation } from '../js/staff-navigation.js';

test('all staff roles share the same five visible navigation seats', () => {
  assert.deepEqual(STAFF_NAV_TABS.map(tab => [tab.key, tab.label]), [
    ['home', 'হোম'], ['work', 'কাজ'], ['academic', 'একাডেমিক'], ['finance', 'হিসাব'], ['more', 'আরও']
  ]);
  for (const role of ['admin', 'teacher', 'manager', 'payment']) {
    assert.deepEqual(Object.keys(STAFF_NAV_ROUTES[role]), ['home', 'work', 'academic', 'finance', 'more']);
  }
});

test('role tabs resolve to existing role-specific routes', () => {
  assert.equal(staffTabForRoute('admin', 'staff'), 'work');
  assert.equal(staffTabForRoute('teacher', 'academic'), 'academic');
  assert.equal(staffTabForRoute('manager', 'finance'), 'finance');
  assert.equal(staffTabForRoute('payment', 'payment'), 'finance');
  assert.equal(staffTabForRoute('admin', 'system'), 'more');
  assert.equal(staffTabForRoute('teacher', 'marks'), 'academic');
  assert.equal(staffTabForRoute('manager', 'class-chat'), 'more');
  assert.equal(staffTabForRoute('payment', 'profile'), 'more');
  assert.equal(staffTabForRoute('unknown', 'home'), '');
});

test('sync updates only the active state and current-page marker', () => {
  const makeButton = key => ({
    dataset: { staffTab: key }, classList: { value: false, toggle(_name, value) { this.value = value; } },
    attrs: {}, setAttribute(name, value) { this.attrs[name] = value; },
    removeAttribute(name) { delete this.attrs[name]; }
  });
  const buttons = ['home', 'work', 'academic', 'finance', 'more'].map(makeButton);
  const root = { querySelectorAll: () => buttons };
  assert.equal(syncStaffNavigation('manager', 'finance', root), 'finance');
  assert.deepEqual(buttons.map(button => button.classList.value), [false, false, false, true, false]);
  assert.equal(buttons[3].attrs['aria-current'], 'page');
  assert.equal(buttons[0].attrs['aria-current'], undefined);
});
