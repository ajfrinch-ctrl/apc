import test from 'node:test';
import assert from 'node:assert/strict';
import { STAFF_NAV_TABS, STAFF_NAV_ROUTES, staffTabForRoute, syncStaffNavigation, bindStaffNavigation } from '../js/staff-navigation.js';

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
  assert.equal(staffTabForRoute('teacher', 'reports'), 'academic');
  assert.equal(staffTabForRoute('teacher', 'homework'), 'academic');
  assert.equal(staffTabForRoute('payment', 'reports'), 'finance');
  assert.equal(STAFF_NAV_ROUTES.teacher.finance, null);
  assert.equal(STAFF_NAV_ROUTES.payment.academic, null);
  assert.equal(staffTabForRoute('admin', 'system'), 'more');
  assert.equal(staffTabForRoute('admin', 'students'), 'work');
  assert.equal(staffTabForRoute('teacher', 'marks'), 'academic');
  assert.equal(staffTabForRoute('manager', 'class-chat'), 'more');
  assert.equal(staffTabForRoute('manager', 'routine-weekly'), 'academic');
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


test('shared click engine delegates only enabled tabs to the role route adapter', () => {
  let listener;
  const root = { addEventListener(type, fn, capture) { assert.equal(type, 'click'); assert.equal(capture, true); listener = fn; } };
  const calls = [];
  assert.equal(bindStaffNavigation({ role: 'teacher', root, onNavigate: (route, button) => calls.push([route, button]) }), true);
  const button = { disabled: false, dataset: { staffTab: 'academic' } };
  const event = {
    target: { closest: selector => selector === '.staff-bottom-nav [data-staff-tab]' ? button : null },
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; }
  };
  listener(event);
  assert.deepEqual(calls, [['academic', button]]);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  const disabled = { disabled: true, dataset: { staffTab: 'finance' } };
  listener({ target: { closest: () => disabled }, preventDefault() { throw new Error('disabled tab must not navigate'); }, stopImmediatePropagation() {} });
  assert.equal(calls.length, 1);
});
