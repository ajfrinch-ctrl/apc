/* Final Report Center sweep (§Report Center).

   The Report Center promises one workflow to *every* role:

       Report dropdown → Date/Filter → Generate → Preview → PDF

   This file proves the promise holds for each of the app's reports, headlessly
   through the real catalogue + access layer, on an empty device:

     1  every report declares the fields the dropdown needs and a role list
     2  a role's dropdown only ever offers reports that role may run
     3  every offered report runs: Generate never throws, filters never invent data
     4  "nothing matched" is one message, from one place, and it is the school's
        required wording — the preview opens either way
     5  a role can never run another role's report, even by asking for it directly
     6  the counter's own Report Center speaks the same empty wording

   The UI half (dropdown → filters → Generate → preview → PDF) is covered by
   tests/report-center.test.mjs, tests/reports-ui.test.mjs and the counter's own
   tests/payment-desk.test.mjs; this sweep covers all reports × all roles. */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { REPORTS, CATEGORIES, catalogFor, findReport, buildReportDocument, EMPTY_MESSAGE } from '../js/report-catalog.js';
import { canAccess, enforceAccess } from '../js/report-access.js';
import { loadSnapshot } from '../js/report-sources.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

/* The builders read the device's own records (roster, assignments, staff
   directory). A real page gives them the real window/localStorage; no panel
   module is imported, so the sweep stays a catalogue + access sweep. */
let ctx;
before(async () => { ctx = await loadPage('admin.html'); });
after(() => ctx?.window.close());
const ROLES = ['admin', 'manager', 'teacher', 'cash', 'student'];

/* The empty device: no roster, no ledger, no exams. Nothing may be invented. */
const EMPTY_SNAPSHOT = { students: [], transactions: [], exams: { exams: [] }, attempts: [], teaching: { activities: [] }, notices: [], routine: [], staff: [] };

test('every report declares what the dropdown, the filters and the access layer need', () => {
  assert.ok(REPORTS.length > 40, `expected the full catalogue, found ${REPORTS.length}`);
  const ids = REPORTS.map(report => report.id);
  assert.equal(new Set(ids).size, ids.length, 'report ids are unique');
  const categories = new Set(CATEGORIES.map(category => category.id));
  for (const report of REPORTS) {
    assert.ok(report.id, 'a report needs an id');
    assert.ok(report.title, `${report.id} needs a title`);
    assert.ok(categories.has(report.category), `${report.id} names an unknown category`);
    assert.ok(Array.isArray(report.filters), `${report.id} must declare its filters`);
    assert.ok((report.roles || []).length, `${report.id} must declare who may run it`);
    for (const role of report.roles) assert.ok(ROLES.includes(role), `${report.id}: unknown role ${role}`);
    assert.equal(typeof report.build, 'function', `${report.id} must be able to build`);
  }
  for (const category of CATEGORIES) {
    assert.ok(REPORTS.some(report => report.category === category.id), `${category.id} has no reports`);
  }
});

test('a role is only offered the reports it may run', () => {
  for (const role of ROLES) {
    const offered = catalogFor(role).flatMap(category => category.reports);
    assert.ok(offered.length, `${role} must be offered at least one report`);
    for (const report of offered) {
      assert.ok(canAccess(report, { role }), `${role} was offered ${report.id} which it may not run`);
      assert.ok(report.roles.includes(role));
    }
    // …and the catalogue never hides a report that role *is* allowed to run.
    for (const report of REPORTS) {
      if (!report.roles.includes(role)) continue;
      assert.ok(offered.includes(report), `${role} may run ${report.id} but it is not offered`);
    }
  }
});

test('every report every role may run generates without throwing, even with nothing stored', async () => {
  const snapshot = { ...EMPTY_SNAPSHOT, ...loadSnapshot() };
  for (const role of ROLES) {
    const actor = role === 'student'
      ? { kind: 'student', role, studentId: 'AP-1', name: 'শিক্ষার্থী', className: '', group: '' }
      : { kind: 'staff', role, username: '', name: role };
    for (const report of catalogFor(role).flatMap(category => category.reports)) {
      let outcome;
      try {
        const gate = enforceAccess(report, actor, {});
        outcome = await buildReportDocument(report, { filters: gate.filters, actor, scope: gate.scope, snapshot });
      } catch (error) {
        assert.fail(`${role} → ${report.id} failed to generate: ${error.message}`);
      }
      assert.ok(Array.isArray(outcome.blocks), `${report.id} returned no blocks`);
      assert.equal(typeof outcome.empty, 'boolean', `${report.id} must say whether it found anything`);
      /* An empty device can only ever produce an honest empty report: no block may
         carry a row when nothing exists to sum. */
      if (outcome.empty) {
        for (const block of outcome.blocks) {
          if (block.type === 'table') assert.equal((block.rows || []).length, 0, `${report.id} invented table rows`);
          if (block.type === 'keyValues') assert.equal((block.pairs || []).length, 0, `${report.id} invented key values`);
        }
      }
    }
  }
});

test('nothing matched is one message, in one place, in the required wording', () => {
  const catalog = read('js/report-catalog.js');
  assert.equal((catalog.match(/export const EMPTY_MESSAGE/g) || []).length, 1, 'one definition only');
  assert.equal(EMPTY_MESSAGE, 'কোনো তথ্য পাওয়া যায়নি।', 'the school-required wording is pinned');
  /* The UI, the PDF and the counter all read that one constant — never a copy. */
  const ui = read('js/reports.js');
  assert.match(ui, /import \{[\s\S]*EMPTY_MESSAGE[\s\S]*\} from '\.\/report-catalog\.js'/, 'the Report Center imports the message');
  assert.match(ui, /type:'note', text:EMPTY_MESSAGE/, 'the PDF carries the same message');
  assert.match(ui, /rc-preview-notice/, 'the preview states it above the page');
  const counter = read('js/counter-reports.js');
  assert.match(counter, /import \{ EMPTY_MESSAGE \} from '\.\/report-catalog\.js'/, 'the counter imports the same message');
  assert.doesNotMatch(counter, /এই filter অনুযায়ী/, 'no second wording survives in the counter');
  assert.doesNotMatch(ui, /এই filter অনুযায়ী/, 'no second wording survives in the Report Center');
});

test('a role cannot run a report it is not offered, even by asking directly', () => {
  const probes = [
    ['cash', 'student.class-wise'],
    ['teacher', 'staff.status'],
    ['manager', 'staff.status'],
    ['student', 'student.class-wise'],
    ['cash', 'academic.suggestion'],
    ['student', 'academic.suggestion']
  ];
  for (const [role, id] of probes) {
    const report = findReport(id);
    assert.ok(report, `${id} must exist`);
    if ((report.roles || []).includes(role)) continue; // the pair is legitimate
    assert.throws(() => enforceAccess(report, { kind: 'staff', role, name: role }, {}),
      error => error?.code === 'FORBIDDEN', `${role} must be refused ${id}`);
  }
  /* A student can never redirect their own reports to another student. */
  const own = findReport('mine.payment');
  assert.throws(() => enforceAccess(own, { role: 'student', studentId: 'AP-1' }, { studentId: 'AP-2' }),
    error => error?.code === 'FORBIDDEN');
});
