/* The mobile layout rules the school asked for on 2026-09-30, as they show up
   in the Admin panel:
     • the student list shows nothing personal until it is asked for, and its
       class/status filters stay folded away;
     • the staff page keeps one universal search box and a create button at the
       bottom of the list.
   (The registration and login-page rules live in
   tests/registration-first-step.test.mjs; the refresh keeps the open page in
   tests/panel-refresh-route.test.mjs.) */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

/* ---------- Student management: nothing personal in the open list ---------- */

let admin;
before(async () => {
  admin = await loadPage('admin.html', {
    seed: { 'activePlus.demo.autofill.v1': 'off', [ROSTER_KEY]: JSON.stringify(adminStudents) }
  });
  await provisionStaff('admin');
  seedStaffSession(admin.window, 'admin');
  await import('../js/admin.js');
  await admin.waitFor(() => admin.$('#adminShell').hidden === false);
  await admin.waitFor(() => Boolean(admin.$('#studentList .student-row')));
  admin.click(admin.$('#adminFeatureGrid [data-admin-view="students"]'));
  await admin.flush();
});
after(() => admin?.window.close());

test('the student list shows no phone, class or guardian until it is asked for', () => {
  const rows = admin.$$('#studentList .student-row');
  assert.ok(rows.length > 0);
  assert.equal(admin.$$('#studentList .student-meta-line small').length, 0, 'no phone line in the list');
  assert.equal(admin.$$('#studentList .student-meta-line span').length, rows.length, 'each row keeps only the Student ID chip');
  const text = admin.$('#studentList').textContent;
  for (const student of adminStudents) {
    assert.ok(text.includes(student.name), `${student.name} is listed`);
    if (student.mobile) assert.ok(!text.includes(student.mobile), 'the phone number is not printed');
    if (student.guardianMobile) assert.ok(!text.includes(student.guardianMobile), 'the guardian number is not printed');
    if (student.address) assert.ok(!text.includes(student.address), 'the address is not printed');
  }
  // The full record is one deliberate tap away.
  assert.ok(admin.$('#studentList [data-action="view"]'), 'the "তথ্য দেখুন" action stays');
});

test('the class and status filters are folded away until the filter button is used', () => {
  const panel = admin.$('#studentFilterPanel');
  const toggle = admin.$('#studentFilterToggle');
  assert.ok(panel.hidden, 'filters start folded');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  admin.click(toggle);
  assert.equal(panel.hidden, false, 'the filter panel opens on request');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(admin.$('#studentClassFilter'), 'a class dropdown is available');
  assert.ok(admin.$('#studentFilterChips .chip'), 'a status filter is available');

  // Filtering by status narrows the list without any search text.
  const pending = adminStudents.filter(student => student.status === 'pending').length;
  admin.click(admin.$$('#studentFilterChips .chip').find(chip => chip.dataset.studentFilter === 'pending'));
  const rows = admin.$$('#studentList .student-row');
  assert.equal(rows.length, pending, 'only pending students are listed');
  admin.click(admin.$('#studentFilterReset'));
  assert.equal(admin.$$('#studentList .student-row').length, adminStudents.length, 'reset brings everyone back');
});

/* ---------- Staff management: search + a create button at the bottom ------- */

test('staff management keeps one search box and the create button at the bottom', () => {
  const html = read('admin.html');
  assert.match(html, /id="staffSearch"/, 'the universal search box stays');
  assert.equal((html.match(/id="staffCreateButton"/g) || []).length, 1, 'exactly one create button');
  const createIndex = html.indexOf('id="staffCreateButton"');
  const listIndex = html.indexOf('id="staffList"');
  assert.ok(createIndex > listIndex, 'the create button sits after the list');
  assert.ok(html.indexOf('staff-create-bar') > listIndex);
});

/* ---------- Button rows: fill the screen in even shares (item 9) ---------- */

test('every action row shares the screen width evenly, in every viewport', () => {
  const css = read('css/ui-forms.css');
  const rows = ['.step-actions', '.modal-actions', '.logout-actions', '.staff-pw-actions', '.pay-form-actions', '.row-actions'];
  const children = suffix => rows.map(row => row + suffix).join(',');
  assert.ok(
    css.includes(`${rows.join(',')}{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))`),
    'action rows split the width in halves'
  );
  assert.ok(css.includes(`${children('>:only-child')}{grid-column:1/-1}`), 'a lone button takes the full width');
  assert.ok(css.includes(`${children('>:nth-child(3):last-child')}{grid-column:1/-1}`), 'a third button gets a full line');
  assert.ok(!/\.step-actions>\*\{flex:1\}/.test(css), 'the old phone-only width rule is gone');
  const phone = css.match(/@media\(max-width:560px\)\{([\s\S]*?)\}\s*$/);
  assert.ok(phone, 'the phone media query stays');
  assert.ok(!phone[1].includes('.step-actions'), 'the even-share rule is not confined to the phone query');
});

/* The feature rows (staff cards, exam authoring, teaching, manager lists, the
   student's own rows, receipt/lock actions) used to declare `display:flex` with
   `flex:1` buttons: with three buttons they squeezed into equal thirds — the
   exact thing the school rule forbids. They are in the same one rule now. */

test('every feature action row follows the same school rule, and none re-declares a layout', () => {
  const css = read('css/ui-forms.css');
  const featureRows = ['.exam-actions', '.teaching-actions', '.manager-actions', '.staff-card-actions',
    '.staff-form-footer', '.student-actions', '.teacher-quick-actions', '.receipt-actions',
    '.learning-card-actions', '.rc-actions', '.apc-lock-actions', '.student-record-actions'];
  assert.ok(css.includes(`${featureRows.join(',')}{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))`),
    'a feature row is missing from the school rule');
  // The rows live in shared comma-separated rules, so read the rule that carries
  // the trailing-odd handling and check every feature row is in it.
  const blockOf = marker => {
    const rest = css.slice(css.indexOf(marker));
    return rest.slice(0, rest.indexOf('}'));
  };
  const trailing = blockOf('.exam-actions>:nth-child(odd):last-child');
  const lone = blockOf('.exam-actions>:only-child');
  for (const row of featureRows) {
    assert.ok(trailing.includes(`${row}>:nth-child(odd):last-child`), `${row}: a trailing odd button must end on its own line`);
    assert.ok(lone.includes(`${row}>:only-child`), `${row}: a lone button must take the full width`);
  }
  // No other sheet may take the layout back, and no leftover flex rule may
  // squeeze the buttons into equal columns again.
  for (const file of readdirSync(new URL('../css', import.meta.url))) {
    if (!file.endsWith('.css')) continue;
    const text = read(`css/${file}`);
    for (const row of featureRows) {
      const bare = row.slice(1);
      const layout = new RegExp(`\\.${bare}\\s*[^{}]*\\{[^}]*display:\\s*(flex|inline-flex)`);
      assert.ok(!layout.test(text), `${file} gives .${bare} its own flex layout again`);
      const squeeze = new RegExp(`\\.${bare}\\s+button[^{}]*\\{[^}]*flex:\\s*1`);
      assert.ok(!squeeze.test(text), `${file} squeezes .${bare} buttons with flex:1 again`);
    }
  }
});

test('registration step one closes with one full-width button', () => {
  const html = read('index.html');
  const start = html.indexOf('<div class="step-actions">');
  const row = html.slice(start, html.indexOf('</div>', start));
  assert.ok(row.startsWith('<div class="step-actions"><button'), 'the lone button opens the row — no empty spacer');
  assert.equal((row.match(/<button/g) || []).length, 1, 'exactly one button in the row');
});
