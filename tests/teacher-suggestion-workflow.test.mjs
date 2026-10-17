/* Teacher panel — the সাজেশন workflow must read as suggestions, not as a notice
   board. Reported 2026-10-11: tapping the home tile "সাজেশন" appeared to open
   "একাডেমিক নোটিশ". Routing was fine; the label was not — ACTIVITY_TYPES
   named the whole `suggestion` type 'একাডেমিক নোটিশ', so the tab, the screen
   heading, the card chip, the report and even the student panel's filter all
   called a suggestion a notice, next to a real notice board that exists in the
   same panel (js/teaching-data.js, teacher.html, js/report-builders.js). */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { teachingRepository } from '../js/teaching-data.js';
import { ACTIVITY_TYPES } from '../js/teaching-data.js';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { enabledClasses } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { openStaffPanel } from './staff-harness.mjs';

/* Bangla literals can arrive precomposed or decomposed (়) — compare in NFC. */
const nfc = value => String(value).normalize('NFC');
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
const NOTISE = 'নোটি';

let ctx;
const $ = sel => ctx.$(sel);

before(async () => {
  ctx = await loadPage('teacher.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [ROSTER_KEY]: JSON.stringify(adminStudents),
      [TEACHER_ASSIGNMENTS_KEY]: JSON.stringify(enabledClasses.map((className, index) => ({
        id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'গণিত'
      })))
    }
  });
  await openStaffPanel(ctx, 'teacher', {
    importPanel: () => import('../js/teacher.js'),
    shellId: 'teacherShell',
    ready: () => [...$('#teacherClassFilter').options].some(option => option.textContent === 'সব নির্ধারিত শ্রেণি')
  });
  await teachingRepository.saveActivity({
    type: 'suggestion', title: 'অধ্যায় ৩ এর নোট', subject: 'গণিত',
    className: enabledClasses[0], status: 'published', details: 'প্রতিদিন এক ঘণ্টা অনুশীলন'
  });
  await settle();
});
after(() => ctx?.window.close());

test('the home সাজেশন tile opens the suggestion screen, not the notice board', async () => {
  ctx.click($('[data-teacher-view="suggestion"]'));
  await settle();
  assert.equal($('#teacherRecords').hidden, false, 'the records screen opens');
  assert.equal($('#teacherNotice').hidden, true, 'the notice board stays closed — these are two different things');
  const tab = $('[data-type-tab="suggestion"]');
  assert.equal(tab.getAttribute('aria-selected'), 'true', 'the suggestion tab is the selected one');
  assert.equal(nfc(tab.firstChild.textContent.trim()), nfc('সাজেশন'), 'and it is labelled সাজেশন');
});

test('the suggestion screen names itself সাজেশন everywhere the teacher reads', async () => {
  ctx.click($('[data-teacher-view="suggestion"]'));
  await settle();
  assert.equal(nfc($('#teacherRecordsTitle').textContent), nfc('সাজেশন'), 'the page heading matches where the teacher clicked');
  assert.equal(nfc($('#teacherNewActivity').textContent), nfc('+ সাজেশন'), 'the add button continues the same workflow');
  const chip = $('#teacherRecordList .teaching-kind');
  assert.ok(chip, 'the record renders');
  assert.equal(nfc(chip.textContent), nfc('সাজেশন'), 'the card says সাজেশন, not নোটিশ');
  assert.doesNotMatch(nfc($('#teacherRecords').textContent), new RegExp(NOTISE), 'nothing on this screen calls a suggestion a notice');
});

test('the notice tile still opens the notice board on its own', async () => {
  ctx.click($('[data-teacher-view="notice"]'));
  await settle();
  assert.equal($('#teacherNotice').hidden, false, 'the real notice board is its own screen');
  assert.equal($('#teacherRecords').hidden, true, 'and it is not the suggestion list wearing another name');
});

test('the mislabel cannot come back: the string is gone from the shipped app', () => {
  const files = ['js/teaching-data.js', 'js/report-builders.js', 'teacher.html', 'index.html', 'manager.html', 'admin.html', 'payment.html'];
  for (const file of files) {
    const src = nfc(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    assert.doesNotMatch(src, /একাডেমিক\s*নোটিশ/, `${file} still labels a suggestion as a notice`);
  }
  assert.equal(nfc(ACTIVITY_TYPES.suggestion.label), nfc('সাজেশন'), 'the single source of the name');
  assert.equal(nfc(ACTIVITY_TYPES.suggestion.plural), nfc('সাজেশন'));
  assert.equal(nfc(ACTIVITY_TYPES.homework.label), nfc('বাড়ির কাজ'), 'the sibling labels are untouched');
  assert.equal(nfc(ACTIVITY_TYPES.notice ?? null), 'null', 'a notice is not an activity type — it stays its own system');
});

test('the teacher report is titled as the suggestions it actually counts', () => {
  const src = nfc(readFileSync(new URL('../js/report-builders.js', import.meta.url), 'utf8'));
  const report = src.slice(src.indexOf('const teacherAcademicNotice'), src.indexOf('const teacherAcademicNotice') + 1200);
  assert.match(report, /title: 'সাজেশন রিপোর্ট'/, 'the Report Center selector shows সাজেশন');
  assert.match(report, /activitiesFor\(ctx, \['suggestion'\]\)/, 'and it really reports suggestions');
  assert.doesNotMatch(report, /Academic Notice Report/);
});
