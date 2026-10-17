/* Admin Profile stays focused on the signed-in Admin's own identity/settings;
   the staff count and full directory live only in Staff Management. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';

const DEMO_OFF = { 'activePlus.demo.autofill.v1': 'off' };
let ctx;

before(async () => {
  ctx = await loadPage('admin.html', { seed: DEMO_OFF });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 4);
  await ctx.waitFor(() => ctx.$$('#adminProfileCard .profile-row').length === 5);
});
after(() => ctx?.window.close());

test('Staff Creation lives only inside the Staff Management section', () => {
  const createButtons = ctx.$$('#staffCreateButton');
  assert.equal(createButtons.length, 1, 'exactly one create button in the whole panel');
  const staffView = ctx.$('.admin-view[data-view-panel="staff"]');
  assert.ok(staffView.contains(createButtons[0]), 'it belongs to the Staff Management view');

  const profile = ctx.$('.admin-view[data-view-panel="profile"]');
  assert.equal(profile.querySelector('#staffCreateButton'), null);
  assert.equal(profile.querySelector('#staffForm'), null, 'no create/edit staff form on the profile');
  assert.equal(profile.querySelector('[data-staff-action="delete"]'), null);
  assert.equal(profile.querySelector('[data-staff-action="confirm-delete"]'), null);
  assert.ok(profile.querySelector('#adminProfileForm'), 'the Admin can still edit their own profile');
  assert.ok(profile.querySelector('#adminPasswordForm'), 'the Admin can still change their own password');
});

test('the Admin hero card contains identity and every profile fact in one place', () => {
  const profile = ctx.$('.admin-view[data-view-panel="profile"]');
  const card = ctx.$('#adminProfileCard');
  const hero = card.querySelector('.admin-profile-hero');
  assert.ok(hero, 'identity and details hero remains visible');
  assert.match(hero.textContent, /এডমিন/);
  assert.match(hero.textContent, /admin\.apc/);
  assert.ok(hero.querySelector('.admin-profile-facts'), 'the facts grid lives inside the hero');
  assert.ok(hero.querySelector('[data-admin-profile-edit]'), 'the hero retains a profile edit option');
  assert.equal([...card.children].some(child => child.classList.contains('profile-list')), false,
    'no separate details list sits below the hero');

  const labels = [...hero.querySelectorAll('.profile-row dt')].map(node => node.textContent.trim());
  assert.deepEqual(labels, ['স্টাফ আইডি', 'মোবাইল', 'ইমেইল', 'স্ট্যাটাস', 'যোগদান']);
  assert.equal(labels.includes('পূর্ণ নাম'), false, 'the name is already in the hero');
  assert.equal(labels.includes('ইউজারনেম'), false, 'the Login ID is already in the hero');
  assert.equal(labels.includes('ভূমিকা'), false, 'the Admin role is already in the hero');

  // Keep the Account/Profile section limited to the Admin's own account.
  // Staff counts and the full searchable directory belong on the Staff tab.
  assert.equal(profile.querySelector('#staffOverviewProfile'), null, 'Profile has no staff summary card');
  assert.equal(profile.querySelector('.staff-overview-card'), null);
  assert.equal(profile.querySelector('.staff-overview-count'), null);
  assert.equal(profile.querySelector('[data-overview-action="open-full"]'), null);
  assert.ok(staffViewHasDirectory(ctx), 'the dedicated Staff view still holds the searchable directory');
});

test('the hero edit shortcut opens and focuses the existing Account profile form', async () => {
  const button = ctx.$('#adminProfileCard [data-admin-profile-edit]');
  assert.ok(button);
  ctx.click(button);
  const form = ctx.$('#adminProfileForm');
  await ctx.waitFor(() => form.closest('[data-settings-group]')?.hidden === false);
  assert.equal(form.closest('[data-settings-group]').dataset.settingsGroup, 'account');
  assert.equal(ctx.window.document.activeElement, ctx.$('#adminProfileName'));
  ctx.click(ctx.$('[data-settings-hub="admin"] [data-settings-hub-back]'));
  await ctx.waitFor(() => ctx.$('[data-settings-hub="admin"] [data-settings-groups]').hidden === false);
});

function staffViewHasDirectory(context) {
  const view = context.$('.admin-view[data-view-panel="staff"]');
  return Boolean(view?.querySelector('#staffList .staff-card') && view.querySelector('#staffSearch'));
}
