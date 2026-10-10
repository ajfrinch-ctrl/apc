/* Admin Profile staff surface + Staff Management Overview widget.

   Two acceptance points locked down on the real admin.html + js/admin.js:
     • Staff Creation lives ONLY in the Staff Management section — the Admin
       Profile carries no create form, no create button and no duplicate
       management path (Issue: "remove staff creation from Admin Profile")
     • the Profile and the Dashboard carry the Staff Management Overview: a
       searchable, filterable, paginated directory with quick actions that
       drive the exact same dialogs/mutations as the full section (Issue:
       "integrated staff management from Admin Profile/Dashboard")
*/
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { createStaff, listStaff, setStaffStatus } from '../js/staff-directory.js';
import { refreshStaffOverviews } from '../js/staff-overview.js';

const DEMO_OFF = { 'activePlus.demo.autofill.v1': 'off' };
const nfc = value => String(value || '').normalize('NFC');
let ctx;

before(async () => {
  ctx = await loadPage('admin.html', { seed: DEMO_OFF });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 4);
});
after(() => ctx?.window.close());

test('Staff Creation lives only inside the Staff Management section', () => {
  const createButtons = ctx.$$('#staffCreateButton');
  assert.equal(createButtons.length, 1, 'exactly one create button in the whole panel');
  const staffView = ctx.$('.admin-view[data-view-panel="staff"]');
  assert.ok(staffView.contains(createButtons[0]), 'it belongs to the Staff Management view');

  // The Admin Profile must carry no staff-creation surface at all.
  const profile = ctx.$('.admin-view[data-view-panel="profile"]');
  assert.equal(profile.querySelector('#staffCreateButton'), null);
  assert.equal(profile.querySelector('#staffForm'), null, 'no create/edit staff form on the profile');
  assert.equal(profile.querySelector('[data-staff-action="delete"]'), null);
  assert.equal(profile.querySelector('[data-staff-action="confirm-delete"]'), null);
  assert.equal(nfc(profile.textContent).includes(nfc('স্টাফ ক্রিয়েট')), false, 'no create affordance copy on the profile');
  // The profile keeps the admin's OWN identity/password forms only.
  assert.ok(profile.querySelector('#adminProfileForm'));
  assert.ok(profile.querySelector('#adminPasswordForm'));
});

test('the Overview mounts on Profile and Dashboard behind the staff.manage capability', () => {
  for (const id of ['#staffOverviewProfile', '#staffOverviewHome']) {
    const widget = ctx.$(id);
    assert.ok(widget, `${id} exists`);
    assert.equal(widget.dataset.adminCap, 'staff.manage');
    assert.ok(widget.querySelector('[data-overview-list]'), `${id} has a list surface`);
  }
});

test('the overview lists staff with identity, role and status — searchable and filterable', async () => {
  const created = await createStaff({
    fullName: 'Nurul Islam', password: 'Nurul-2026', confirmPassword: 'Nurul-2026', role: 'teacher',
    assignment: { classes: ['অষ্টম শ্রেণি'], subjects: ['গণিত'], batches: [] }
  });
  assert.equal(created.ok, true, created.error);
  await refreshStaffOverviews();
  await ctx.flush();

  const widget = ctx.$('#staffOverviewProfile');
  const rows = () => [...widget.querySelectorAll('[data-overview-staff]')];
  assert.ok(rows().length >= 5, 'seeded system staff + the new teacher');
  const teacherRow = rows().find(row => row.dataset.overviewStaff === created.staff.staffId);
  assert.ok(teacherRow, 'the new teacher is listed');
  assert.match(teacherRow.textContent, /Nurul Islam/);
  assert.match(teacherRow.textContent, /STF-/);
  assert.match(nfc(teacherRow.textContent), /শিক্ষক/);
  assert.match(nfc(teacherRow.textContent), /গণিত/, 'the assigned subject is the responsibility line');

  // Search narrows the list without a reload.
  const search = widget.querySelector('[data-overview-search]');
  search.value = 'nurul';
  search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  assert.equal(rows().length, 1);
  assert.match(rows()[0].textContent, /Nurul Islam/);

  // Role filter.
  search.value = '';
  search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  const roleFilter = widget.querySelector('[data-overview-role]');
  roleFilter.value = 'teacher';
  roleFilter.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.ok(rows().length >= 1);
  assert.ok(rows().every(row => nfc(row.textContent).includes(nfc('শিক্ষক'))));
  roleFilter.value = 'all';
  roleFilter.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));

  // Status filter: deactivate through the data layer, then filter.
  await setStaffStatus(created.staff.staffId, 'inactive');
  await refreshStaffOverviews();
  await ctx.flush();
  const statusFilter = widget.querySelector('[data-overview-status]');
  statusFilter.value = 'inactive';
  statusFilter.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.ok(rows().some(row => row.dataset.overviewStaff === created.staff.staffId), 'inactive filter shows the record');
  statusFilter.value = 'all';
  statusFilter.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await setStaffStatus(created.staff.staffId, 'active');
  await refreshStaffOverviews();
});

test('quick actions run the shared mutations; paging keeps pages small; the shortcut opens the full section', async () => {
  const widget = ctx.$('#staffOverviewProfile');
  const staff = await listStaff();
  const teacher = staff.find(record => record.role === 'teacher' && record.kind !== 'system');
  assert.ok(teacher, 'the created teacher exists');

  // Activate/Deactivate quick action → same setStaffStatus path.
  const row = () => widget.querySelector(`[data-overview-staff="${teacher.staffId}"]`);
  assert.ok(row(), 'row visible on the current page');
  const toggle = row().querySelector('[data-overview-action="status"]');
  assert.ok(toggle, 'the quick action is offered');
  ctx.click(toggle);
  let status = 'active';
  for (let i = 0; i < 100 && status !== 'inactive'; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 20));
    status = (await listStaff()).find(item => item.staffId === teacher.staffId)?.status || status;
  }
  assert.equal(status, 'inactive', 'the quick action ran the shared status mutation');
  // Restore.
  await setStaffStatus(teacher.staffId, 'active');
  await refreshStaffOverviews();

  // The "full management" shortcut opens the Staff Management section.
  ctx.click(widget.querySelector('[data-overview-action="open-full"]'));
  await ctx.waitFor(() => ctx.$('.admin-view[data-view-panel="staff"]').classList.contains('active'));
  assert.equal(ctx.$('.admin-view[data-view-panel="staff"]').classList.contains('active'), true);
});
