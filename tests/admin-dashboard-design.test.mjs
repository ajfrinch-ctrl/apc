/* Admin Home's approved content is deliberately small. This suite guards the
   source markup and CSS; routing and real interaction are covered separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('admin.html');
const document = new JSDOM(html).window.document;
const home = document.querySelector('.admin-view[data-view-panel="dashboard"]');

test('Admin Home retains welcome, weekday/date, daily advice and three staff-portal doors', () => {
  assert.ok(home);
  for (const id of ['dashTitle', 'adminTodayWeekday', 'adminTodayDate', 'adminHeroAdvice', 'adminFeatureGrid']) {
    assert.ok(home.querySelector(`#${id}`), `${id} remains on Home`);
  }
  assert.deepEqual([...home.querySelectorAll('.admin-portal-grid > a')].map(link => link.getAttribute('href')),
    ['manager.html', 'teacher.html', 'payment.html']);
  assert.equal(home.querySelector('.pay-section-label')?.textContent.trim(), 'দ্রুত অ্যাক্সেস');
  assert.equal(document.querySelectorAll('.admin-bottom [data-admin-view]').length, 5, 'shared navigation is untouched');
});

test('Admin Home omits the picture, four counters, both reminders and five duplicate shortcuts', () => {
  for (const selector of [
    '.teacher-hero-scene', '[data-admin-hero-art]', '.admin-hero-icon',
    '.admin-home-summary', '.admin-hero-stats', '#dashStudentCount', '#dashStaffCount',
    '#dashClassCount', '#dashProtectedCount', '#adminMaintenanceFlag', '#backupReminder',
    '#adminQuickShortcuts', '.panel-hub-card', '.phonebook-hub-card'
  ]) {
    assert.equal(home.querySelector(selector), null, `${selector} does not render on Home`);
  }
  assert.ok(document.querySelector('.admin-view[data-view-panel="backup-export"] #backupExportButton'),
    'backup export still exists in its dedicated screen');
  assert.ok(document.querySelector('.admin-view[data-view-panel="settings-maintenance"] #maintenanceState'),
    'maintenance status remains in System Settings');
  assert.ok(document.querySelector('.admin-view[data-view-panel="more"] [data-admin-view="phonebook"]'),
    'phonebook remains accessible from More');
  // Class Chat restored for true edge-to-edge full-screen (all 4 portals).
  assert.ok(document.querySelector('#classChatTopbarButton'), 'global chat shortcut present');
  assert.ok(document.querySelector('[data-admin-view="class-chat"]'), 'chat route present');
  assert.ok(document.querySelector('#adminClassChatMount'), 'chat mount present');
});

test('text-only Home contracts to its content without a phantom image or clipped Bangla advice', () => {
  const css = read('css/ui-wallet.css');
  assert.match(css, /\/\* Admin Home: keep the welcome\/date\/advice, but no artwork or empty picture frame\. \*\/\s*body\.admin-reference \.admin-view\[data-view-panel="dashboard"\] \.home-dashboard-intro\.admin-home-intro \{\s*aspect-ratio: auto;\s*min-height: 0 !important;\s*background-image: none !important;/);
  assert.match(css, /\.home-dashboard-intro\.admin-home-intro::after \{\s*content: none !important;/,
    'the CSS-generated dashboard illustration is removed too');
  assert.match(css, /\.admin-home-intro \.admin-hero-title \{\s*max-width: 100% !important;/);
  assert.match(css, /\.admin-home-intro #adminHeroAdvice \{\s*max-width: 100% !important;/);
  assert.match(css, /\.admin-feature-grid \.admin-feature-tile\.is-wide \{\s*grid-column: 1 \/ -1; flex-direction: column;/,
    'the lone approval tile still spans the row');
});

test('staff management retains its own Bengali actions and Home still greets the signed-in Admin', () => {
  const js = read('js/staff-overview.js');
  assert.match(js, /staff-overview-avatar/, 'each row paints an initials avatar');
  assert.doesNotMatch(js, />View<|>Edit<|'Deactivate'|'Activate'/);
  for (const label of ['দেখুন', 'সম্পাদনা', 'নিষ্ক্রিয় করুন', 'সক্রিয় করুন']) {
    assert.ok(js.includes(label), `quick action "${label}" is Bengali`);
  }
  assert.ok(read('css/ui-wallet.css').includes('.staff-overview-avatar {'), 'the staff avatar is still styled');
  const admin = read('js/admin.js');
  assert.match(admin, /welcome\.textContent = adminName \? `স্বাগতম, \$\{adminName\}`/);
  assert.doesNotMatch(admin, /#adminMaintenanceFlag|#backupReminder|#adminQuickShortcuts|#dashClassCount/,
    'no code writes to nodes removed from Home');
});
