/* Admin Panel shell — permission-driven UI on the real admin.html + js/admin.js
   (jsdom, so no browser download is needed).

   Covers the acceptance list that can be checked without a device:
     • only the sections the Admin role holds are rendered
     • nothing role-specific survives anywhere in the DOM (menus, cards,
       shortcuts, cross-panel links, list rows)
     • every bottom-bar entry carries a generated icon + a readable label
     • the dashboard grid is generated from the same permission model
     • a hash route opens only when the role may open it
   The browser-only parts (active-state animation, 320–430px layout) live in
   tests/admin-navigation.spec.cjs and tests/mobile-layout.spec.cjs. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import {
  CAPABILITIES,
  createAccess,
  routeFromHash,
  enforceCapabilities,
  VIEW_CAPABILITIES
} from '../js/admin-permissions.js';

let ctx;

before(async () => {
  ctx = await loadPage('admin.html', {
    seed: { 'activePlus.demo.autofill.v1': 'off', [ROSTER_KEY]: JSON.stringify(adminStudents) }
  });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  await ctx.waitFor(() => ctx.$$('#adminFeatureGrid .admin-feature-tile').length > 0);
  await ctx.waitFor(() => Boolean(ctx.$('.admin-bottom [aria-current="page"]')));
});

test('the Admin role keeps system control only — no daily operations', () => {
  const access = createAccess('admin');
  for (const capability of [
    CAPABILITIES.DASHBOARD,
    CAPABILITIES.STAFF_MANAGE,
    CAPABILITIES.ROLES_MANAGE,
    CAPABILITIES.STUDENTS_VIEW,
    CAPABILITIES.STUDENTS_MANAGE,
    CAPABILITIES.REPORTS_VIEW,
    CAPABILITIES.DATA_MANAGE,
    CAPABILITIES.BACKUP_MANAGE,
    CAPABILITIES.SECURITY_MANAGE,
    CAPABILITIES.SETTINGS_MANAGE,
    CAPABILITIES.PROFILE_VIEW,
    CAPABILITIES.ADVICE_MANAGE
  ]) {
    assert.equal(access.has(capability), true, `Admin must keep ${capability}`);
  }
  // Cash Counter / Manager / Teacher territory, including daily operations.
  for (const capability of [
    CAPABILITIES.FINANCE_COLLECT,
    CAPABILITIES.NOTICES_MANAGE,
    CAPABILITIES.ROUTINE_MANAGE,
    CAPABILITIES.CLASSES_MANAGE,
    CAPABILITIES.APP_MANAGE,
    CAPABILITIES.EXAMS_VIEW,
    CAPABILITIES.EXAMS_PUBLISH,
    CAPABILITIES.TEACHING_PANEL,
    CAPABILITIES.PAYMENT_PANEL
  ]) {
    assert.equal(access.has(capability), false, `Admin must not hold ${capability}`);
  }
  assert.equal(createAccess('admin').allowsView('finance'), false, 'the collection view no longer exists');
  assert.equal(createAccess('admin').allowsView('routine'), false);
  assert.equal(createAccess('admin').allowsView('notices'), false);
  assert.equal(createAccess('admin').allowsView('staff'), true);
  assert.equal(createAccess('payment').has(CAPABILITIES.FINANCE_COLLECT), true, 'Cash Counter keeps fee collection');
  assert.equal(createAccess('manager').has(CAPABILITIES.STUDENTS_APPROVE), true, 'Manager keeps student approval');
  // Owner decision 2026-09-30: the Admin may approve/reject registrations too.
  assert.equal(createAccess('admin').has(CAPABILITIES.STUDENTS_APPROVE), true, 'Admin approves registrations too');
  for (const role of ['teacher', 'payment']) assert.equal(createAccess(role).has(CAPABILITIES.STUDENTS_APPROVE), false, `${role} never approves`);
  assert.equal(createAccess('manager').has(CAPABILITIES.NOTICES_MANAGE), false);
  assert.equal(createAccess('admin').defaultView(), 'dashboard');
});

test('the panel boots without markup or module errors', () => {
  assert.deepEqual(ctx.jsdomErrors, []);
});

test('hash routes resolve only to known views', () => {
  assert.equal(routeFromHash('#staff'), 'staff');
  assert.equal(routeFromHash('#finance'), null, 'collection is not an Admin route any more');
  assert.equal(routeFromHash('#routine'), null);
  assert.equal(routeFromHash('#notices'), null);
  assert.equal(routeFromHash('#') + '', 'null');
  assert.equal(routeFromHash('#approvals'), null);
  assert.equal(routeFromHash('#/students'), 'students');
  for (const view of Object.keys(VIEW_CAPABILITIES)) assert.equal(routeFromHash(`#${view}`), view);
  assert.equal(routeFromHash('#more'), 'more', 'the shared More hub is a valid Admin route');
});

test('the bottom bar renders one icon + label per permitted tab', () => {
  const items = ctx.$$('.admin-bottom button');
  assert.deepEqual(items.map(button => button.dataset.adminView), ['dashboard', 'staff', 'reports', 'system', 'more']);
  for (const button of items) {
    // Exactly one icon, drawn inside a fixed container: the chip.
    const chip = button.querySelector('.nav-chip');
    const icon = chip?.querySelector('svg.nav-icon');
    const label = button.querySelector('.nav-label');
    assert.ok(chip, `${button.dataset.adminView} has no icon container`);
    assert.ok(icon, `${button.dataset.adminView} has no generated icon`);
    assert.equal(chip.children.length, 1, `${button.dataset.adminView} paints more than one icon`);
    assert.equal(icon.getAttribute('aria-hidden'), 'true');
    // Icons render from the shared ai-3d artwork set (js/icon-set.js): the
    // inline <svg> carries an <image> pointing at a local file, so "not
    // empty" means the artwork is referenced and that file actually ships.
    const artwork = icon.querySelector('image');
    assert.ok(artwork?.getAttribute('href'), `${button.dataset.adminView} icon is empty`);
    assert.ok(existsSync(new URL('../' + artwork.getAttribute('href'), import.meta.url)),
      `${button.dataset.adminView} icon artwork is missing: ${artwork.getAttribute('href')}`);
    assert.ok(label && label.textContent.trim().length > 1, `${button.dataset.adminView} has no label`);
  }
  // The active tab is marked for both CSS and assistive tech.
  assert.equal(ctx.$$('.admin-bottom [aria-current="page"]').length, 1);
  assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.adminView, 'dashboard');
  // Header: the same bar as every other panel — brand and slogan on the left,
  // the notification bell and sign-out on the right, and nothing else. The
  // date, the theme switch and every shortcut moved out of the topbar.
  const header = ctx.$('.app-topbar');
  assert.ok(header, 'the Admin panel has no topbar');
  assert.equal(ctx.$$('.app-topbar').length, 1, 'the Admin panel paints more than one topbar');
  const brand = header.querySelector('.app-brand');
  assert.ok(brand, 'the topbar has no brand');
  assert.equal(brand.querySelectorAll('img').length, 1, 'the brand paints more than one logo');
  assert.ok(brand.querySelector('[data-fixed-tagline]').textContent.trim().length > 1, 'the slogan is missing');
  const bell = header.querySelector('#notificationButton');
  assert.ok(bell, 'the topbar has no notification button');
  assert.equal(bell.querySelectorAll('svg').length, 1, 'the bell paints more than one icon');
  assert.ok(bell.querySelector('svg[data-icon="bell"]'));
  assert.ok(bell.querySelector('.notification-dot'), 'the bell has no unread dot');
  const exit = header.querySelector('.app-topbar-exit');
  assert.ok(exit, 'the sign-out button is missing');
  assert.equal(exit.id, 'adminExitButton');
  assert.equal(exit.querySelectorAll('svg').length, 1, 'sign-out paints more than one icon');
  assert.ok(exit.querySelector('svg[data-icon="logout"]'));
  assert.equal(header.querySelectorAll('button').length, 2, 'the topbar holds more than notification + sign-out');
  assert.equal(header.querySelectorAll('[data-theme-toggle], time, .student-date').length, 0, 'a control that belongs elsewhere is still in the topbar');
  // Dark mode stays reachable: it lives in System Settings as a switch row —
  // icon chip (sun in light, moon in dark), label and the app's toggle switch.
  const themeSwitch = ctx.$('.admin-view[data-view-panel="profile"] .theme-card .theme-switch');
  assert.ok(themeSwitch, 'dark mode has no home on the Admin panel');
  assert.ok(themeSwitch.querySelector('.theme-switch-icon svg[data-icon="sun"]'), 'the switch has no sun icon');
  assert.ok(themeSwitch.querySelector('.theme-switch-icon svg[data-icon="moon"]'), 'the switch has no moon icon');
  // Short stable name on the row, AMOLED explanation underneath.
  assert.ok(themeSwitch.textContent.includes('গাঢ় থিম'), 'the switch lost its label');
  assert.ok(themeSwitch.textContent.includes('AMOLED'), 'the switch lost its theme explanation');
  const checkbox = themeSwitch.querySelector('.toggle-switch input#darkModeToggle');
  assert.ok(checkbox, 'the switch is not connected to the theme checkbox');
  assert.equal(checkbox.type, 'checkbox');
  // The theme switch is never in the topbar: the bar holds the bell and sign-out only.
  assert.equal(header.querySelector('.theme-switch, #darkModeToggle, [data-theme-toggle]'), null,
    'the theme switch is back in the topbar');
});

test('the dashboard grid is generated from the permission model', () => {
  const tiles = ctx.$$('#adminFeatureGrid .admin-feature-tile');
  assert.deepEqual(tiles.map(tile => tile.dataset.adminView), [
    'students'
  ]);
  for (const tile of tiles) {
    const wrap = tile.querySelector('.admin-feature-icon');
    const icon = wrap?.querySelector('svg');
    assert.ok(icon, `${tile.dataset.adminView} tile has no icon`);
    assert.equal(wrap.children.length, 1, `${tile.dataset.adminView} tile paints more than one icon`);
    assert.ok(tile.querySelector('.admin-feature-label')?.textContent.trim().length > 1);
    assert.ok(tile.dataset.adminCap, `${tile.dataset.adminView} tile carries no capability`);
  }
  // System overview uses one generated icon and exposes no daily collection CTA.
  assert.ok(ctx.$('.admin-hero-icon svg'));
  assert.equal(ctx.$('#dashCollectFee'), null);
  // Four snapshot tiles: students, staff, classes, protected accounts.
  assert.equal(ctx.$$('.admin-hero-stats .tile-icon svg').length, 4);
  assert.ok(ctx.$('#dashStaffCount'), 'the dashboard counts staff');
  assert.ok(ctx.$('#dashProtectedCount'), 'the dashboard shows protected accounts');
});

test('nothing outside the Admin role survives in the DOM', () => {
  // Approval workflow belongs to the Manager portal.
  assert.equal(ctx.$('#dashPendingCount'), null);
  assert.equal(ctx.$('.admin-hero-foot'), null);
  assert.equal(ctx.$$('.manager-approval-note').length, 0);
  // Cross-panel entries belong to their own roles.
  assert.equal(ctx.$('.teacher-panel-link'), null);
  assert.equal(ctx.$('.pay-panel-link'), null);
  assert.equal(ctx.$$('[data-admin-cap="teaching.panel"]').length, 0);
  assert.equal(ctx.$$('[data-admin-cap="payment.panel"]').length, 0);
  // Daily operations are entirely gone — views and every control inside them.
  for (const view of ['finance', 'routine', 'notices', 'exams']) {
    assert.equal(ctx.$(`.admin-view[data-view-panel="${view}"]`), null, `${view} must not be an Admin section`);
  }
  assert.equal(ctx.$$('#feeStudentSearch, #feeCollectionForm, #btnFinanceGoCollect, #dashCollectFee, #addRoutineForm, #noticeForm').length, 0);
  assert.equal(ctx.$$('#studentLedgerList [data-action="quick-collect"]').length, 0);
  // Reports is the report builder alone: the finance summary, the recent
  // payments block and the ledger moved out of this page by request
  // (2026-09-30) — money is handled in the Cash Counter panel and seen through
  // generated reports here.
  assert.equal(ctx.$('#adminReports'), ctx.$('.admin-view[data-view-panel="reports"] #adminReports'));
  assert.ok(ctx.$('.admin-view[data-view-panel="reports"] #adminReports'), 'the report builder stays');
  assert.equal(ctx.$$('[data-finance-tab]').length, 0);
  assert.equal(ctx.$$('.finance-panel').length, 0);
  assert.equal(ctx.$('#financeTotalCollected'), null);
  assert.equal(ctx.$('#recentTrxList'), null);
  assert.equal(ctx.$('#studentLedgerList'), null);
  assert.equal(ctx.$('.reports-group-title'), null);
  // System sections are untouched.
  for (const view of ['dashboard', 'staff', 'reports', 'system', 'more', 'roles', 'students', 'data', 'backup', 'security', 'settings', 'profile', 'advice']) {
    assert.equal(ctx.$$(`[data-admin-view="${view}"]`).length > 0, true, `${view} should still be reachable`);
  }
});

test('no exam publish/approval control lives in the Admin panel', () => {
  // Exam records are read in Reports; publishing stays with the Manager portal.
  assert.ok(ctx.$('#adminExamWorkspace'), 'Admin has an exam grading workspace on the audit page');
  const labels = ctx.$$('.admin-shell button').map(button => button.textContent);
  for (const label of labels) {
    assert.doesNotMatch(label, /প্রকাশ করুন|অনুমোদন দিয়ে|ফি গ্রহণ/, 'Admin must not publish, approve or collect');
  }
});

test('a hash route opens a permitted view and moves the active tab', async () => {
  ctx.window.location.hash = '#staff';
  await ctx.waitFor(() => ctx.$('.admin-view[data-view-panel="staff"]').classList.contains('active'));
  assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.adminView, 'staff');

  ctx.window.location.hash = '#settings';
  await ctx.waitFor(() => ctx.$('.admin-view[data-view-panel="settings"]').classList.contains('active'));
  assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.adminView, 'system',
    'a screen inside the সিস্টেম hub keeps its own seat lit');

  ctx.window.location.hash = '#backup';
  await ctx.waitFor(() => ctx.$('.admin-view[data-view-panel="backup"]').classList.contains('active'));
  assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.adminView, 'more');

  ctx.window.location.hash = '#profile';
  await ctx.waitFor(() => ctx.$('.admin-view[data-view-panel="profile"]').classList.contains('active'));
  assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.adminView, 'more');

  ctx.window.location.hash = '#advice';
  await ctx.waitFor(() => ctx.$('.admin-view[data-view-panel="advice"]').classList.contains('active'));
  assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.adminView, 'more');

  ctx.window.location.hash = '#students';
  await ctx.waitFor(() => ctx.$('.admin-view[data-view-panel="students"]').classList.contains('active'));
  assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.adminView, 'dashboard',
    'the registration review reached from হোম keeps হোম lit');

  // A route that belongs to another panel never moves the panel.
  ctx.window.location.hash = '#finance';
  await ctx.flush();
  assert.equal(ctx.$('.admin-view[data-view-panel="students"]').classList.contains('active'), true);
  assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.adminView, 'dashboard');
  ctx.window.location.hash = '';
});

test('Account → Security → Account reopens the correct Admin content on every return', async () => {
  const hub = ctx.$('[data-settings-hub="admin"]');
  const moreSeat = ctx.$('.admin-bottom [data-admin-view="more"]');
  const accountRow = ctx.$('#adminMoreMenu [data-admin-view="profile"]');
  const systemSeat = ctx.$('.admin-bottom [data-admin-view="system"]');
  const openAccount = async () => { ctx.click(moreSeat); await ctx.flush(3); ctx.click(accountRow); await ctx.flush(4); };
  await ctx.waitFor(() => Boolean(hub.querySelector('[data-settings-groups]')));
  const groupNav = hub.querySelector('[data-settings-groups]');
  const groups = [...hub.querySelectorAll('[data-settings-group]')];
  const onlyVisibleGroup = key => {
    assert.equal(groups.filter(section => !section.hidden).length, 1, 'exactly one Account group is visible');
    assert.equal(hub.querySelector(`[data-settings-group="${key}"]`).hidden, false, `${key} content is visible`);
    assert.equal(hub.querySelector(`[data-settings-group="${key === 'account' ? 'security' : 'account'}"]`).hidden, true,
      'the other group must not leak into the visible page');
  };

  await openAccount();
  assert.equal(ctx.$('.admin-view.active')?.dataset.viewPanel, 'profile');
  ctx.click(hub.querySelector('[data-settings-open="account"]'));
  await ctx.flush(2);
  onlyVisibleGroup('account');

  // Open Security, leave the Account surface, then return via the Account seat.
  ctx.click(hub.querySelector('[data-settings-hub-back]'));
  ctx.click(hub.querySelector('[data-settings-open="security"]'));
  await ctx.flush(2);
  onlyVisibleGroup('security');
  ctx.click(systemSeat);
  await ctx.flush(4);
  ctx.click(ctx.$('#adminSystemMenu .admin-more-item[data-admin-view="security"]'));
  await ctx.flush(4);
  assert.equal(ctx.$('.admin-view.active')?.dataset.viewPanel, 'security');
  assert.equal(ctx.$$('.admin-view.active').length, 1, 'Security is the only open Admin page');
  await openAccount();
  assert.equal(ctx.$('.admin-view.active')?.dataset.viewPanel, 'profile');
  assert.equal(ctx.$$('.admin-view.active').length, 1, 'Account is the only open Admin page');
  assert.equal(groupNav.hidden, false, 'returning to Account restores its group menu');
  assert.ok(groups.every(section => section.hidden), 'no stale Security/Account section remains open');
  assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.adminView, 'more');

  // Repeat the same route click, then open both groups in sequence.
  await openAccount();
  assert.equal(groupNav.hidden, false, 'a repeated Account entry remains idempotent');
  ctx.click(hub.querySelector('[data-settings-open="account"]'));
  await ctx.flush(2);
  onlyVisibleGroup('account');
  ctx.click(hub.querySelector('[data-settings-hub-back]'));
  ctx.click(hub.querySelector('[data-settings-open="security"]'));
  await ctx.flush(2);
  onlyVisibleGroup('security');

  ctx.click(ctx.$('.admin-bottom [data-admin-view="dashboard"]'));
  await ctx.flush(2);
});

test('a role with no capability leaves the panel empty — menus, cards and routes', async () => {
  // A fresh, untouched copy of the panel: nothing has been rendered yet, so the
  // capability layer is the only thing that has touched the markup.
  const fresh = await loadPage('admin.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  const empty = createAccess('student');
  const removed = enforceCapabilities({ root: fresh.document, access: empty });
  // Every capability-gated section is gone; the two hubs hold only gated cards,
  // so nothing is left for a role with no capability at all.
  assert.deepEqual(fresh.$$('.admin-view').map(view => view.dataset.viewPanel), []);
  // Leaving never depends on a capability: the topbar sign-out is always there.
  assert.equal(fresh.$$('.admin-more-item').length, 0, 'no hub card survives an empty role');
  assert.ok(fresh.$('#adminExitButton'), 'the topbar logout stays for every signed-in role');
  assert.equal(fresh.$$('#adminFeatureGrid .admin-feature-tile').length, 0);
  assert.equal(fresh.$$('[data-admin-cap]').length, 0);
  assert.ok(removed.views.length > 0);
  assert.ok(removed.elements.length > 0);

  // Building the shell with the same empty access leaves no navigation at all:
  // not a tab, not a tile, not even the bar itself.
  const { initAdminPanelShell } = await import('../js/admin-panel-ui.js');
  const built = initAdminPanelShell({ access: empty, onNavigate: () => {} });
  assert.equal(built.bottomButtons.length, 0);
  assert.deepEqual(built.bottomEntries, []);
  assert.equal(built.tiles.length, 0);
  assert.equal(built.systemItems.length, 0);
  assert.equal(built.dataItems.length, 0);
  assert.equal(fresh.$$('.admin-bottom button').length, 0);
  assert.equal(fresh.$('.admin-bottom').hidden, true);
  assert.equal(fresh.$$('.admin-view').length, 0);
});

test('Admin Settings is the shared five-group hub, with no duplicated control', () => {
  /* §29 — one Settings structure for every role: অ্যাকাউন্ট · নোটিফিকেশন · অ্যাপ ·
     নিরাপত্তা · ডেটা. The Admin's own profile/session/password cards stay; the hub
     adds the notification group and the rows the seat did not have. */
  const hub = ctx.$('[data-settings-hub="admin"]');
  assert.ok(hub, 'admin settings hub missing');
  assert.deepEqual([...hub.querySelectorAll('[data-settings-group]')].map(section => section.dataset.settingsGroup),
    ['account', 'notification', 'app', 'security', 'data']);
  assert.equal(ctx.$$('#darkModeToggle').length, 1, 'one theme switch (the page\'s own)');
  assert.equal(ctx.$$('[data-settings-toggle="theme"]').length, 0, 'the hub must not add a second theme switch');
  /* The identity card (profile) sits above the hub on the Account page
     (owner design 2026-10-16), so it is counted on the page, not in the hub;
     it still exists exactly once. */
  assert.equal(ctx.$$('.admin-view[data-view-panel="profile"] [data-settings-row="profile"]').length, 1, 'profile');
  for (const key of ['password', 'logout']) {
    assert.equal(hub.querySelectorAll(`[data-settings-row="${key}"]`).length, 1, key);
  }
  for (const key of ['install', 'device', 'session', 'offline', 'storage']) {
    assert.equal(hub.querySelectorAll(`[data-settings-row="${key}"]`).length, 1, key);
  }
  assert.equal(hub.querySelector('[data-settings-group="notification"]').dataset.settingsOwner, 'notification');
  /* Owner design 2026-10-16: the five doors are rows — name, what lives
     inside, and a chevron — and the identity band sits above the hub. */
  const doors = [...hub.querySelectorAll('.admin-settings-door')];
  assert.deepEqual(doors.map(door => door.dataset.settingsOpen),
    ['account', 'notification', 'app', 'security', 'data']);
  for (const door of doors) {
    assert.ok(door.querySelector('.admin-settings-door-copy small')?.textContent.trim().length > 1,
      `${door.dataset.settingsOpen} door names what lives inside`);
    assert.ok(door.querySelector('.admin-settings-door-chevron svg'), `${door.dataset.settingsOpen} door ends in a chevron`);
  }
  const identity = ctx.$('#adminProfileCard');
  assert.ok(identity, 'the identity band is mounted');
  assert.ok(identity.compareDocumentPosition(hub) & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING,
    'the identity band sits above the hub');
});
