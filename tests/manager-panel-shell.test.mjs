import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { ROSTER_KEY } from '../js/office-data.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';

let ctx;
let managerBootMarkup;
const roster = [
  { id: 'S-PENDING', name: 'পেন্ডিং শিক্ষার্থী', className: 'অষ্টম শ্রেণি', group: 'A', mobile: '01700000000', guardianMobile: '01800000000', status: 'pending', createdAt: new Date().toISOString() },
  { id: 'S-APPROVED', name: 'অনুমোদিত শিক্ষার্থী', className: 'অষ্টম শ্রেণি', group: 'A', mobile: '01700000001', guardianMobile: '01800000001', status: 'approved', monthlyFee: 1500 }
];

before(async () => {
  ctx = await loadPage('manager.html', { seed: { [ROSTER_KEY]: JSON.stringify(roster), [STAFF_ACCOUNTS.teacher.accountKey]: JSON.stringify({ role: 'teacher', username: 'teacher.apc', fullName: 'Teacher profile', status: 'active' }) } });
  managerBootMarkup = {
    hasScreen: Boolean(ctx.$('#managerBootScreen')),
    logo: ctx.$('.manager-boot-screen > img')?.getAttribute('src'),
    slogan: ctx.$('.manager-boot-screen > p')?.textContent.trim(),
    loadingLabel: ctx.$('.manager-boot-label')?.textContent.trim(),
    loginFallbackHidden: ctx.$('#managerBootLink')?.hidden,
    shellInitiallyHidden: ctx.$('#managerShell')?.hidden
  };
  await provisionStaff('manager');
  seedStaffSession(ctx.window, 'manager');
  await import('../js/manager.js');
  await ctx.waitFor(() => ctx.$('#managerShell').hidden === false);
  await ctx.waitFor(() => ctx.$('#mgrTotalStudents').textContent === '২');
});

test('Manager cold boot shows branded loading until session validation opens the panel', () => {
  assert.deepEqual(managerBootMarkup, {
    hasScreen: true,
    logo: 'assets/icons/logo-128.png',
    slogan: 'শিখতে থাকো, এগিয়ে যাও',
    loadingLabel: 'ম্যানেজার প্যানেল খুলছে…',
    loginFallbackHidden: true,
    shellInitiallyHidden: true
  });
  assert.equal(ctx.$('#managerBootScreen'), null, 'the branded boot screen is removed after a valid session opens the panel');
  assert.equal(ctx.$('#managerBootLink'), null, 'the login escape link is not left over the operational panel');
  assert.equal(ctx.$('#managerShell').hidden, false);
});

test('Manager boots on the operational dashboard with only its allow-listed sections', () => {
  assert.deepEqual(ctx.jsdomErrors, []);
  const views = ctx.$$('.manager-view').map(view => view.dataset.viewPanel);
  assert.deepEqual(views, ['dashboard', 'students', 'academic', 'academic-records', 'classes', 'teachers', 'finance', 'notices', 'routine', 'routine-today', 'routine-tomorrow', 'routine-weekly', 'routine-class', 'routine-exam', 'routine-changed', 'routine-holiday', 'routine-important', 'routine-other', 'exams', 'courses', 'results', 'reports', 'profile', 'settings', 'advice', 'more']);
  const routes = ctx.$$('[data-manager-view]').map(button => button.dataset.managerView);
  for (const forbidden of ['staff', 'roles', 'permissions', 'security', 'backup', 'restore', 'admin']) assert.equal(routes.includes(forbidden), false);
  assert.equal(ctx.$('#managerMain a[href*="admin"]'), null);
  assert.equal(ctx.$('#mgrActiveStudents').textContent, '১');
  assert.equal(ctx.$('#mgrTotalStudents').textContent, '২');
});

test('Manager student cards start compact, show pending entries once and disclose one card at a time', async () => {
  ctx.click(ctx.$('.manager-bottom [data-manager-view="students"]'));
  await ctx.waitFor(() => ctx.$('.manager-view[data-view-panel="students"]')?.classList.contains('active'));
  await ctx.waitFor(() => ctx.$$('#managerStudentQueue [data-manager-student]').length === 1
    && ctx.$$('#managerStudentList [data-manager-student]').length === 1);

  const pendingCard = () => ctx.$('#managerStudentQueue [data-manager-student="S-PENDING"]');
  const approvedCard = () => ctx.$('#managerStudentList [data-manager-student="S-APPROVED"]');
  assert.equal(ctx.$$('#managerStudentQueue [data-manager-student]').length, 1);
  assert.equal(ctx.$$('#managerStudentList [data-manager-student="S-PENDING"]').length, 0,
    'the pending registration is not duplicated in the lower all-student list');
  assert.equal(ctx.$$('#managerStudentList [data-manager-student]').length, 1);
  for (const card of [pendingCard(), approvedCard()]) {
    assert.equal(card.querySelector('.manager-student-details').hidden, true);
    assert.equal(card.querySelector('.manager-student-details-toggle').getAttribute('aria-expanded'), 'false');
  }
  assert.match(pendingCard().querySelector('.manager-student-head').textContent, /পেন্ডিং শিক্ষার্থী/);
  assert.match(pendingCard().querySelector('.manager-student-head').textContent, /S-PENDING/);
  assert.match(pendingCard().querySelector('.manager-student-head').textContent, /অপেক্ষমাণ/);
  assert.doesNotMatch(pendingCard().querySelector('.manager-student-head').textContent, /অষ্টম শ্রেণি|01700000000/);

  ctx.click(pendingCard().querySelector('.manager-student-details-toggle'));
  await ctx.waitFor(() => pendingCard().querySelector('.manager-student-details').hidden === false);
  assert.equal(pendingCard().querySelector('.manager-student-details-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(pendingCard().querySelector('.manager-student-details-toggle').getAttribute('aria-controls'), pendingCard().querySelector('.manager-student-details').id);
  assert.match(pendingCard().querySelector('.manager-student-details').textContent, /অষ্টম শ্রেণি/);
  assert.equal(pendingCard().querySelector('[data-manager-action="approve-student"]').closest('.manager-student-details').hidden, false);

  ctx.click(approvedCard().querySelector('.manager-student-details-toggle'));
  await ctx.waitFor(() => approvedCard().querySelector('.manager-student-details').hidden === false);
  assert.equal(pendingCard().querySelector('.manager-student-details').hidden, true);
  assert.equal(ctx.$$('#managerStudentQueue .manager-student-details-toggle[aria-expanded="true"], #managerStudentList .manager-student-details-toggle[aria-expanded="true"]').length, 1);
  assert.equal(ctx.window.document.activeElement.dataset.id, 'S-APPROVED', 'focus returns to the newly rendered disclosure');

  ctx.click(approvedCard().querySelector('.manager-student-details-toggle'));
  assert.equal(ctx.$$('#managerStudentQueue .manager-student-details[hidden], #managerStudentList .manager-student-details[hidden]').length, 2,
    'the same disclosure can be clicked again to close it');

  ctx.click(ctx.$('.manager-view[data-view-panel="students"] [data-student-scope="pending"]'));
  assert.equal(ctx.$('#managerStudentQueue').hidden, false);
  assert.equal(ctx.$$('#managerStudentList [data-manager-student]').length, 0, 'pending filter uses the queue as the single source');
  ctx.click(ctx.$('.manager-view[data-view-panel="students"] [data-student-scope="approved"]'));
  assert.equal(ctx.$('#managerStudentQueue').hidden, false, 'the pending approval queue remains available beside status-filtered roster rows');
  assert.equal(ctx.$$('#managerStudentList [data-manager-student]').length, 1);
  ctx.click(ctx.$('.manager-view[data-view-panel="students"] [data-student-scope="all"]'));
  assert.equal(ctx.$('#managerStudentQueue').hidden, false);

  const search = ctx.$('#managerStudentSearch');
  ctx.type(search, 'S-PENDING');
  await ctx.waitFor(() => ctx.$$('#managerStudentQueue [data-manager-student]').length === 1);
  assert.equal(ctx.$$('#managerStudentList [data-manager-student]').length, 0,
    'search filters the queue as well without duplicating the pending entry');
  ctx.type(search, '');
  await ctx.waitFor(() => ctx.$$('#managerStudentList [data-manager-student]').length === 1);
});

test('Manager student approval updates only the pending registration through the Manager flow', async () => {
  /* অনুমোদন has no separate seat any more: the pending queue lives inside
     শিক্ষার্থী, and the old name still opens that screen with the filter set. */
  ctx.click(ctx.$('.manager-bottom [data-manager-view="students"]'));
  ctx.click(ctx.$('.manager-view[data-view-panel="students"] [data-student-scope="pending"]'));
  await ctx.flush();
  assert.equal(ctx.$$('#managerStudentQueue [data-manager-action="approve-student"]').length, 1);
  ctx.click(ctx.$('#managerStudentQueue .manager-student-details-toggle'));
  await ctx.waitFor(() => ctx.$('#managerStudentQueue [data-manager-action="approve-student"]')?.closest('.manager-student-details').hidden === false);
  ctx.click(ctx.$('#managerStudentQueue [data-manager-action="approve-student"]'));
  await ctx.waitFor(() => ctx.$$('#managerStudentQueue [data-manager-action="approve-student"]').length === 0);
  const saved = JSON.parse(ctx.window.localStorage.getItem(ROSTER_KEY));
  const decision = saved.find(student => student.id === 'S-PENDING');
  assert.equal(decision.status, 'approved');
  assert.equal(decision.reviewedBy, 'manager.apc');
  assert.ok(decision.reviewedAt);
  assert.equal(saved.find(student => student.id === 'S-APPROVED').status, 'approved');
});

test('Manager navigation refuses unknown or admin-only route identifiers', () => {
  const beforeView = ctx.$('.manager-view.active')?.dataset.viewPanel;
  for (const route of ['backup', 'security', 'staff', 'permissions', 'admin-management']) {
    assert.equal(ctx.$(`[data-view-panel="${route}"]`), null);
  }
  assert.equal(ctx.$('.manager-view.active')?.dataset.viewPanel, beforeView);
});

test('Manager alone assigns Teacher class/batch scope through the Teachers workflow', async () => {
  ctx.click(ctx.$('.manager-bottom [data-manager-view="academic"]'));
  ctx.click(ctx.$('#managerAcademicTeachers[data-manager-view="teachers"]'));
  await ctx.waitFor(() => ctx.$('#managerTeacherAssignmentForm [name=className]')?.options.length > 1);
  const form = ctx.$('#managerTeacherAssignmentForm');
  // The subject picker is a checkbox list fed by Admin's Academic setup: it only
  // fills once a class is chosen, which is the cascading step tested here.
  form.elements.className.value = 'দশম শ্রেণি';
  form.elements.className.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  form.elements.group.value = 'বিজ্ঞান বিভাগ';
  await ctx.waitFor(() => form.querySelectorAll('#managerTeacherSubjectList input[name=subject]').length > 0);
  const boxes = [...form.querySelectorAll('#managerTeacherSubjectList input[name=subject]')];
  const maths = boxes.find(box => box.value === 'গণিত');
  assert.ok(maths, 'Admin-enabled subject list must offer গণিত for দশম শ্রেণি');
  maths.checked = true;
  ctx.submit(form);
  await ctx.waitFor(() => ctx.window.localStorage.getItem(TEACHER_ASSIGNMENTS_KEY) !== null);
  const saved = JSON.parse(ctx.window.localStorage.getItem(TEACHER_ASSIGNMENTS_KEY));
  assert.equal(saved.length, 1); assert.equal(saved[0].teacherUsername, 'teacher.apc');
  assert.equal(saved[0].className, 'দশম শ্রেণি'); assert.equal(saved[0].group, 'বিজ্ঞান বিভাগ');
  assert.deepEqual(saved[0].subjects, ['গণিত']);
  assert.equal(saved[0].subject, 'গণিত');
  /* The list re-renders asynchronously after the save — wait for the card
     like every other UI assertion here. */
  await ctx.waitFor(() => ctx.$('#managerTeacherList').textContent.includes('দশম শ্রেণি'));
});

/* Tracking a student by the permanent Student ID in the Manager panel — the
   same box staff already use for names and mobile numbers. Bangla digits are
   what a Bangla keyboard produces, so they must find the student too. */
test('the running Manager panel shows no offline-workspace notice', () => {
  assert.equal(ctx.$('.manager-local-notice'), null, 'no notice element');
  assert.ok(!ctx.$('#managerMain').textContent.includes('Offline workspace'), 'no notice text');
});

test('the Manager student search finds a student by Student ID, including Bangla digits', async () => {
  const box = ctx.$('#managerStudentSearch');
  const rows = () => ctx.$$('#managerStudentList [data-manager-student]');
  ctx.click(ctx.$('[data-manager-view="students"]'));
  await ctx.waitFor(() => ctx.$('.manager-view[data-view-panel="students"]').classList.contains('active'));
  /* The status filter stays where the user left it (the previous test left it on
     the pending queue), so search starts from "সব". */
  ctx.click(ctx.$('.manager-view[data-view-panel="students"] [data-student-scope="all"]'));
  await ctx.waitFor(() => rows().length === 2);

  ctx.type(box, 's-app');                        // a real Student ID prefix
  await ctx.waitFor(() => rows().length === 1);
  assert.equal(rows()[0].dataset.managerStudent, 'S-APPROVED');

  ctx.type(box, '০১৭০০০০০০০১');                   // Bangla digits for the mobile number
  await ctx.waitFor(() => rows().length === 1);
  assert.equal(rows()[0].dataset.managerStudent, 'S-APPROVED');

  ctx.type(box, 'S-PENDING');                     // the other student's id
  await ctx.waitFor(() => rows().length === 1);
  assert.equal(rows()[0].dataset.managerStudent, 'S-PENDING');

  ctx.type(box, 's-rej');                         // an id nobody has
  await ctx.waitFor(() => rows().length === 0);
  ctx.type(box, '');
  await ctx.waitFor(() => rows().length === 2);
});

/* The "আরও" page is a normal Manager page: the bottom tab opens it, the rows
   carry the same icon + title + hint language as every other module, and a
   refresh lands back on it (the URL keeps the page). */
test('the আরও page lists every module as a real page, not a floating drawer', async () => {
  assert.equal(ctx.$('#managerMoreDrawer'), null, 'the old drawer is gone');
  ctx.click(ctx.$('.manager-bottom [data-manager-view="more"]'));
  await ctx.waitFor(() => ctx.$('.manager-view.active')?.dataset.viewPanel === 'more');

  const page = ctx.$('.manager-view[data-view-panel="more"]');
  assert.equal(page.hidden, false);
  assert.equal(ctx.$('#managerMoreTitle').textContent.trim(), 'আরও');
  assert.equal(ctx.window.location.hash, '#more', 'the open page lives in the URL');

  const footer = ctx.$$('.manager-bottom [data-manager-view]');
  assert.deepEqual(footer.map(button => button.dataset.managerView), ['dashboard', 'students', 'academic', 'finance', 'more']);
  assert.equal(ctx.$('.manager-bottom [data-manager-view="reports"]'), null, 'reports lives in More, not a sixth tab');
  const rows = ctx.$$('#managerMoreHub .pay-tile');
  assert.deepEqual(rows.map(row => row.dataset.managerView), ['profile', 'settings', 'reports', 'advice']);
  assert.equal(rows.some(row => row.dataset.managerView === 'classes'), false, 'ক্লাস পরিচালনা is not in আরও');
  for (const row of rows) {
    assert.ok(row.querySelector('.pay-tile-icon svg'), 'every tile keeps its icon');
    assert.ok(row.querySelector('.pay-tile-label').textContent.trim(), 'every tile has a title');
  }
  for (const view of ['reports', 'advice']) {
    const row = rows.find(item => item.dataset.managerView === view);
    ctx.click(row);
    await ctx.waitFor(() => ctx.$('.manager-view.active')?.dataset.viewPanel === view);
    assert.equal(ctx.$('.manager-view.active').hidden, false, `${view} is the one visible page`);
    assert.equal(ctx.$$('.manager-view.active').length, 1, 'repeat navigation never activates two pages');
    assert.equal(ctx.$('.manager-bottom [aria-current="page"]').dataset.managerView, 'more', `${view} keeps More selected`);
    assert.equal(ctx.window.location.hash, `#${view}`);
    ctx.click(ctx.$(`.manager-view[data-view-panel="${view}"] [data-manager-view="more"]`));
    await ctx.waitFor(() => ctx.$('.manager-view.active')?.dataset.viewPanel === 'more');
  }
  ctx.click(rows[0]);
  await ctx.waitFor(() => ctx.$('.manager-view.active')?.dataset.viewPanel === 'profile');
  assert.equal(ctx.window.location.hash, '#profile');
});

test('every আরও row opens its own page without an error', async () => {
  ctx.click(ctx.$('.manager-bottom [data-manager-view="more"]'));
  await ctx.flush();
  for (const row of ctx.$$('#managerMoreHub .pay-tile')) {
    if (row.classList.contains('is-logout')) continue;
    const view = row.dataset.managerView;
    ctx.click(row);
    await ctx.waitFor(() => ctx.$('.manager-view.active')?.dataset.viewPanel === view);
    assert.equal(ctx.$('.manager-view.active').hidden, false, `${view} is visible`);
    assert.equal(ctx.window.location.hash, `#${view}`, `${view} is remembered in the URL`);
    if (view !== 'more') { ctx.click(ctx.$('.manager-bottom [data-manager-view="more"]')); await ctx.flush(); }
  }
  assert.deepEqual(ctx.jsdomErrors, [], 'no page raised an error while opening');
});

test('Manager Settings re-entry clears a previously open group and keeps one active page', async () => {
  const hub = ctx.$('[data-settings-hub="manager"]');
  await ctx.waitFor(() => Boolean(hub.querySelector('[data-settings-groups]')));
  const nav = hub.querySelector('[data-settings-groups]');
  const groups = [...hub.querySelectorAll('[data-settings-group]')];
  const settings = () => ctx.$('#managerMoreHub [data-manager-view="settings"]');

  ctx.click(ctx.$('.manager-bottom [data-manager-view="more"]'));
  await ctx.flush(2);
  ctx.click(settings());
  await ctx.waitFor(() => ctx.$('.manager-view.active')?.dataset.viewPanel === 'settings');
  ctx.click(hub.querySelector('[data-settings-open="security"]'));
  await ctx.flush(2);
  assert.equal(hub.querySelector('[data-settings-group="security"]').hidden, false);
  assert.equal(nav.hidden, true);

  // Leave Settings and re-enter: stale Security content must not remain.
  ctx.click(ctx.$('.manager-bottom [data-manager-view="dashboard"]'));
  ctx.click(ctx.$('.manager-bottom [data-manager-view="more"]'));
  ctx.click(settings());
  await ctx.waitFor(() => ctx.$('.manager-view.active')?.dataset.viewPanel === 'settings');
  assert.equal(ctx.$$('.manager-view.active').length, 1);
  assert.equal(ctx.$('.manager-bottom [aria-current="page"]').dataset.managerView, 'more');
  assert.equal(nav.hidden, false, 're-entering Settings shows the group menu');
  assert.ok(groups.every(group => group.hidden), 'no stale Manager subsection stays visible');

  // Same-page re-entry is safe too: the visible group is reset on every route.
  ctx.click(hub.querySelector('[data-settings-open="account"]'));
  await ctx.flush(2);
  assert.equal(hub.querySelector('[data-settings-group="account"]').hidden, false);
  ctx.click(ctx.$('.manager-bottom [data-manager-view="dashboard"]'));
  ctx.click(ctx.$('.manager-bottom [data-manager-view="more"]'));
  ctx.click(settings());
  await ctx.waitFor(() => ctx.$('.manager-view.active')?.dataset.viewPanel === 'settings');
  assert.equal(nav.hidden, false);
  assert.ok(groups.every(group => group.hidden));
  ctx.click(ctx.$('.manager-bottom [data-manager-view="dashboard"]'));
});

test('Manager Settings is the shared five-group hub, with no duplicated control', () => {
  /* §29 — one Settings structure for every role. The Manager's own profile card,
     password row and theme switch stay where they were; the hub fills the rest. */
  const hub = ctx.$('[data-settings-hub="manager"]');
  assert.ok(hub, 'manager settings hub missing');
  assert.deepEqual([...hub.querySelectorAll('[data-settings-group]')].map(section => section.dataset.settingsGroup),
    ['account', 'notification', 'app', 'security', 'data']);
  assert.equal(ctx.$$('#darkModeToggle').length, 1, 'one theme switch (the page\'s own)');
  assert.equal(ctx.$$('[data-settings-toggle="theme"]').length, 0, 'the hub must not add a second theme switch');
  assert.equal(hub.querySelectorAll('[data-settings-row="profile"]').length, 1, 'the profile card is the profile row');
  assert.equal(hub.querySelectorAll('[data-settings-row="password"]').length, 1, 'one password row');
  assert.equal(hub.querySelectorAll('[data-settings-row="logout"]').length, 1, 'one logout row');
  assert.equal(hub.querySelectorAll('[data-settings-row="install"]').length, 1, 'app install comes from the hub');
  for (const key of ['device', 'session', 'storage']) {
    assert.equal(hub.querySelectorAll(`[data-settings-row="${key}"]`).length, 1, key);
  }
  assert.equal(hub.querySelector('[data-settings-group="notification"]').dataset.settingsOwner, 'notification',
    'the notification group stays owned by js/notification-settings.js');
});

after(() => ctx?.window.close());
