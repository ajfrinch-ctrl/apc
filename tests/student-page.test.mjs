/* Student page audit — the real index.html boots with a signed-in student and
   every core flow is exercised end to end: shell restore, all five bottom-nav
   views, routine day tabs, the opt-in dark theme, the notice centre bell, the
   profile edit round-trip and the logout hand-off. A regression in any of
   these fails here loudly instead of reaching a student's phone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';

const APPEARANCE_KEY = 'active-plus-appearance-v2';

/** A freshly booted student app on the real page (same seed as the UI sweep). */
async function boot({ extraSeed = {} } = {}) {
  const ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off', ...extraSeed } });
  const { window } = ctx;
  const { hashPassword } = await import('../js/password-hash.js');
  const pinHash = await hashPassword('246810');
  window.localStorage.setItem('active-plus-account-v1', JSON.stringify({
    mobile: '01700000000', registrationMobile: '01700000000', username: 'raisa.islam', pinHash,
    status: 'active', student: { id: 'AP-1024', name: 'রাইসা আক্তার', className: 'দশম শ্রেণি', group: 'A' }
  }));
  const { buildSessionRecord } = await import('../js/session.js');
  window.localStorage.setItem('active-plus-session-v1', JSON.stringify(buildSessionRecord({ owner: 'raisa.islam' })));
  await import(`../js/main.js?student-audit=${Math.random()}`);
  await ctx.waitFor(() => ctx.$('#appShell') && ctx.$('#appShell').hidden === false);
  await ctx.flush(10);
  await new Promise(resolve => setTimeout(resolve, 10));
  return ctx;
}

const navErrors = ctx => ctx.jsdomErrors.filter(error => !/navigation/i.test(error));

test('session restore lands in the app and every bottom-nav view opens', async () => {
  const ctx = await boot();
  const { $, $$, click } = ctx;
  assert.equal($('#appShell').hidden, false, 'the student shell stayed hidden');
  assert.equal($('#authScreen').hidden, true, 'the login screen must not linger');

  for (const view of ['routine', 'courses', 'exams', 'profile', 'home']) {
    click($(`.bottom-link[data-view="${view}"]`));
    await ctx.flush(4);
    const panel = $(`[data-view-panel="${view}"]`);
    assert.ok(panel, `view panel ${view} is missing`);
    assert.equal(panel.classList.contains('active'), true, `${view} did not become the active view`);
    assert.equal($(`.bottom-link[data-view="${view}"]`).getAttribute('aria-current'), 'page', `${view} link not marked current`);
    assert.equal($$('.view.active').length, 1, 'exactly one view may be active');
  }
  assert.deepEqual(navErrors(ctx), [], 'script errors on the student page');
});

test('সেটিংস is the shared five-group hub, filled around the student\'s own rows', async () => {
  const ctx = await boot();
  const { $, $$ } = ctx;
  const hub = $('#settingsView');
  assert.deepEqual([...hub.querySelectorAll('[data-settings-group]')].map(section => section.dataset.settingsGroup),
    ['account', 'notification', 'app', 'security', 'data']);
  // The student's own controls are untouched and never duplicated by the hub.
  assert.equal($$('#darkModeToggle').length, 1);
  assert.equal($$('[data-settings-toggle="theme"]').length, 0);
  assert.equal(hub.querySelectorAll('[data-settings-row="profile"]').length, 1);
  assert.equal(hub.querySelectorAll('[data-settings-row="install"]').length, 1);
  assert.equal(hub.querySelectorAll('[data-settings-row="logout"]').length, 1);
  assert.equal(hub.querySelectorAll('[data-settings-row="device"]').length, 1);
  assert.equal(hub.querySelectorAll('[data-settings-row="offline"]').length, 1);
  // What the page did not own comes from the hub.
  for (const key of ['session', 'storage']) {
    assert.equal(hub.querySelectorAll(`[data-settings-row="${key}"]`).length, 1, key);
  }
  // নোটিফিকেশন opens the one full notification screen (it is not a floating drawer).
  assert.equal(hub.querySelectorAll('[data-settings-row="notification-link"]').length, 1);
  assert.equal(navErrors(ctx).length, 0, navErrors(ctx).join('\n'));
});

test('routine day tabs switch the shown day', async () => {
  const ctx = await boot();
  const { $, click } = ctx;
  click($('.bottom-link[data-view="routine"]'));
  await ctx.flush(4);
  const before = $('#routineDate').textContent;
  const sunday = $('.day-tab[data-day="sun"]');
  assert.equal(sunday.classList.contains('active'), false, 'sunday must not start active');
  click(sunday);
  await ctx.flush(4);
  assert.equal(sunday.classList.contains('active'), true, 'the tapped day never turned active');
  assert.equal($('.day-tab.active') === sunday, true, 'two days active at once');
  assert.notEqual($('#routineDate').textContent, before, 'the date line did not follow the tab');
});

test('dark theme stays opt-in: starts light, toggling selects dark and keeps it', async () => {
  const ctx = await boot();
  const { window, $ } = ctx;
  assert.equal(window.localStorage.getItem(APPEARANCE_KEY), null, 'a fresh device must carry no choice');
  assert.equal(window.document.documentElement.dataset.theme, 'light', 'the first paint was not light');

  const toggle = $('#darkModeToggle');
  assert.ok(toggle, 'the profile theme switch is missing');
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  await ctx.flush(4);
  assert.equal(window.document.documentElement.dataset.theme, 'dark', 'selecting dark did not apply');
  assert.equal(window.localStorage.getItem(APPEARANCE_KEY), 'dark', 'the dark choice was not stored');
});

test('the bell opens the notice centre and its close button shuts it', async () => {
  const ctx = await boot();
  const { window, $, click } = ctx;
  const { initNotifications } = await import('../js/notifications.js');
  await initNotifications();
  /* On a phone, realtime-sync-entry mounts the inbox while the page loads —
     long before a finger reaches the bell. The mount rides a dynamic import,
     which needs real macrotask turns (flush() only pumps microtasks), so the
     test waits for the mounted centre exactly like the harness waits for UI. */
  await ctx.waitFor(() => window.apcNoticeCenter, 2000);
  click($('#notificationButton'));
  await ctx.flush(4);
  assert.equal($('#noticeModal').hidden, false, 'the notice modal never opened');
  assert.ok($('#noticeListStudent'), 'the notice list mount is missing');
  click($('[data-close-modal="noticeModal"]'));
  await ctx.flush(4);
  assert.equal($('#noticeModal').hidden, true, 'the notice modal did not close');
  assert.deepEqual(navErrors(ctx), [], 'script errors around the notice centre');
});

test('profile edit saves through to the card and the stored account', async () => {
  const ctx = await boot();
  const { window, $, click, type, submit } = ctx;
  click($('.bottom-link[data-view="profile"]'));
  await ctx.flush(4);
  click($('[data-action="edit-profile"]'));
  await ctx.flush(4);
  assert.equal($('#editModal').hidden, false, 'the edit modal never opened');
  type($('#editNameBn'), 'রাইসা আক্তার তুবা');
  submit($('#profileForm'));
  await ctx.flush(10);
  assert.equal($('#profileName').textContent.trim(), 'রাইসা আক্তার তুবা', 'the card still shows the old name');
  await ctx.waitFor(() => String(window.localStorage.getItem('active-plus-account-v1')).includes('তুবা'));
  assert.equal($('#editModal').hidden, true, 'the modal stayed open after saving');
});

test('logout confirms and hands back to the login screen', async () => {
  const ctx = await boot();
  const { window, $, click } = ctx;
  click($('#studentLogout'));
  await ctx.flush(4);
  assert.equal($('#logoutModal').hidden, false, 'the logout confirm modal never opened');
  click($('#logoutConfirmButton'));
  await ctx.waitFor(() => $('#authScreen').hidden === false);
  assert.equal($('#appShell').hidden, true, 'the shell must close on logout');
  assert.equal(window.localStorage.getItem('active-plus-session-v1'), null, 'the session record survived logout');
});
