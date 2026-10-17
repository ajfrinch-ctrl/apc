/* §29 — one Settings structure for staff and the Cash Counter.

   The five groups (অ্যাকাউন্ট · নোটিফিকেশন · অ্যাপ · নিরাপত্তা · ডেটা) exist in
   the same order on those role surfaces, with no duplicate control. Student
   retains the approved inline More settings instead of a second Settings page.

   This file boots the Cash Counter (the page the hub fills the most) and checks
   the live result; the Manager case lives with the Manager shell test, where that
   page is already booted. */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { SETTINGS_GROUPS, SETTINGS_ROWS } from '../js/settings-hub.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const GROUP_KEYS = SETTINGS_GROUPS.map(group => group.key);

/* The hub root and the role it serves, per page. */
const SURFACES = Object.freeze({
  /* Student keeps its small inline More settings list by the approved layout;
     staff and payment use the full five-group Settings hub. */
  'manager.html': { role: 'manager', mount: '[data-settings-hub="manager"]' },
  'teacher.html': { role: 'teacher', mount: '[data-settings-hub="teacher"]' },
  'admin.html': { role: 'admin', mount: '[data-settings-hub="admin"]' },
  'payment.html': { role: 'payment', mount: '#payMorePanel' }
});

test('staff and counter Settings carry the same five groups, in the same order', () => {
  for (const [file, surface] of Object.entries(SURFACES)) {
    const html = read(file);
    assert.match(html, new RegExp(`data-settings-hub="${surface.role}"`), `${file}: hub marker`);
    const groups = [...html.matchAll(/data-settings-group="([a-z]+)"/g)].map(match => match[1]);
    assert.deepEqual(groups, GROUP_KEYS, `${file}: group order`);
  }
});

test('student Settings stay inline in More, with one theme and trusted-device control', () => {
  const html = read('student.html');
  assert.doesNotMatch(html, /id="settingsView"|data-view="settings"/, 'student More must not duplicate a separate Settings page');
  assert.match(html, /id="moreDarkModeToggle"[^>]*data-settings-toggle="theme"|data-settings-toggle="theme"[^>]*id="moreDarkModeToggle"/);
  assert.match(html, /id="moreTrustedDeviceToggle"[^>]*data-trusted-device-toggle|data-trusted-device-toggle[^>]*id="moreTrustedDeviceToggle"/);
  const rows = [...html.matchAll(/data-settings-row="([a-z-]+)"/g)].map(match => match[1]);
  assert.equal(new Set(rows).size, rows.length, 'student More duplicates a settings row');
});

test('a row marker appears at most once per key on a page', () => {
  for (const file of Object.keys(SURFACES)) {
    const html = read(file);
    const rows = [...html.matchAll(/data-settings-row="([a-z-]+)"/g)].map(match => match[1]);
    assert.equal(new Set(rows).size, rows.length, `${file}: duplicate row marker`);
  }
});

let ctx;

before(async () => {
  ctx = await loadPage('payment.html');
  await provisionStaff('payment');
  seedStaffSession(ctx.window, 'payment', { role: 'payment' });
  await import('../js/payment.js');
  await ctx.waitFor(() => ctx.$('#payShell').hidden === false, 40000);
  // The hub fills the groups after the counter session is read: wait for a row
  // the page never had in its markup.
  await ctx.waitFor(() => ctx.$('[data-settings-hub="payment"] [data-settings-row="storage"]'), 40000);
});

after(() => ctx?.window.close());

test('the counter gets all five groups and exactly one control per setting', () => {
  assert.deepEqual(ctx.jsdomErrors, []);
  const hub = ctx.$('[data-settings-hub="payment"]');
  assert.ok(hub, 'the counter settings hub is missing');
  assert.deepEqual([...hub.querySelectorAll('[data-settings-group]')].map(section => section.dataset.settingsGroup), GROUP_KEYS);

  /* No key may appear twice anywhere in the hub, and the rows the page already
     had (নিজের তথ্য, লগআউট) were not duplicated by the hub. */
  for (const [group, keys] of Object.entries(SETTINGS_ROWS)) {
    const section = hub.querySelector(`[data-settings-group="${group}"]`);
    for (const key of keys) {
      assert.ok(section.querySelectorAll(`[data-settings-row="${key}"]`).length <= 1,
        `${group}/${key}: a setting is shown twice`);
    }
  }

  /* What the counter's page did not own comes from the hub: app (install, theme),
     security (this device, session) and data (offline, storage, sync). A counter
     has no in-app password change, so অ্যাকাউন্ট keeps just its own two rows. */
  const REQUIRED = {
    account: ['profile', 'password', 'logout'],
    app: ['install', 'theme'],
    security: ['device', 'session'],
    data: ['offline', 'storage']
  };
  for (const [group, keys] of Object.entries(REQUIRED)) {
    const section = hub.querySelector(`[data-settings-group="${group}"]`);
    for (const key of keys) {
      assert.equal(section.querySelectorAll(`[data-settings-row="${key}"]`).length, 1,
        `${group}/${key}: expected exactly one row`);
    }
  }
  assert.equal(hub.querySelectorAll('[data-settings-group="account"] [data-settings-row="password"]').length, 1,
    'the counter changes its own password through the shared dialog');

  /* One theme control on the page: the hub's row, wired to js/appearance.js. */
  assert.equal(ctx.$$('#darkModeToggle').length, 0, 'the counter has no topbar theme switch');
  assert.equal(ctx.$$('[data-settings-toggle="theme"]').length, 1, 'one theme switch in Settings');
  assert.equal(ctx.$$('#payMoreLogout').length, 1, 'the counter keeps its own logout row');
  assert.equal(hub.querySelectorAll('[data-settings-row="logout"]').length, 1);

  /* The notification group is owned by js/notification-settings.js. */
  const notification = hub.querySelector('[data-settings-group="notification"]');
  assert.equal(notification.dataset.settingsOwner, 'notification');
  assert.ok(notification.querySelector('.notification-settings-mount'), 'notification settings mount missing');
});

test('Cash Counter More re-entry clears stale Settings groups on repeated navigation', async () => {
  const hub = ctx.$('#payMorePanel');
  await ctx.waitFor(() => Boolean(hub.querySelector('[data-settings-groups]')));
  const nav = hub.querySelector('[data-settings-groups]');
  const groups = [...hub.querySelectorAll('[data-settings-group]')];

  ctx.click(ctx.$('.admin-bottom [data-pay-section="more"]'));
  await ctx.flush(2);
  ctx.click(hub.querySelector('[data-settings-open="security"]'));
  await ctx.flush(2);
  assert.equal(hub.hidden, false);
  assert.equal(nav.hidden, true);
  assert.equal(hub.querySelector('[data-settings-group="security"]').hidden, false);

  // Re-tapping More while it is already selected must return to the menu.
  ctx.click(ctx.$('.admin-bottom [data-pay-section="more"]'));
  await ctx.flush(2);
  assert.equal(nav.hidden, false);
  assert.ok(groups.every(group => group.hidden));
  assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.paySection, 'more');

  ctx.click(hub.querySelector('[data-settings-open="account"]'));
  await ctx.flush(2);
  assert.equal(hub.querySelector('[data-settings-group="account"]').hidden, false);
  ctx.click(ctx.$('.admin-bottom [data-pay-section="home"]'));
  await ctx.flush(2);
  ctx.click(ctx.$('.admin-bottom [data-pay-section="more"]'));
  await ctx.flush(2);
  assert.equal(nav.hidden, false, 'returning from Home restores the More group menu');
  assert.ok(groups.every(group => group.hidden), 'the previous Account content does not leak into More');
  assert.equal(ctx.$$('.pay-panel:not([hidden])').length, 1, 'exactly one Counter page is visible');
  ctx.click(ctx.$('.admin-bottom [data-pay-section="home"]'));
});

test('the theme row the hub adds switches the stored theme', async () => {
  const { APPEARANCE_KEY, getTheme } = await import('../js/appearance.js');
  const input = ctx.$('[data-settings-toggle="theme"]');
  input.checked = true;
  input.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.flush();
  assert.equal(getTheme(), 'dark');
  assert.equal(ctx.document.documentElement.dataset.theme, 'dark');
  assert.equal(ctx.window.localStorage.getItem(APPEARANCE_KEY), 'dark');
  input.checked = false;
  input.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.flush();
  assert.equal(getTheme(), 'light');
});
/* The counter's password row is wired to the one staff dialog: a new password
   typed there is hashed into the counter's own account (never into markup). */
test('the counter can change its own password from Settings', async () => {
  const { readStaffAccount, hasStaffSession } = await import('../js/staff-auth.js');
  assert.equal(await hasStaffSession('payment'), true, 'the counter session is still open');
  const before = await readStaffAccount('payment');
  assert.ok(before?.password, 'the provisioned counter account has a password hash');

  ctx.click(ctx.$('[data-settings-hub="payment"] [data-settings-row="password"]'));
  await ctx.waitFor(() => ctx.$('.staff-pw-backdrop'), 20000);
  assert.equal(ctx.$('.staff-pw-backdrop').dataset.staffPw, 'payment', 'the dialog serves the counter role');

  ctx.type(ctx.$('#staffPwNew'), 'Apc-Counter-2026');
  ctx.type(ctx.$('#staffPwConfirm'), 'Apc-Counter-2026');
  ctx.submit(ctx.$('.staff-pw-form'));
  await ctx.waitFor(() => !ctx.$('.staff-pw-backdrop'), 30000);

  const after = await readStaffAccount('payment');
  assert.ok(after?.password && after.password !== before.password, 'the stored hash changed');
  assert.equal(JSON.stringify(after).includes('Apc-Counter-2026'), false, 'the plaintext is never stored');
});
