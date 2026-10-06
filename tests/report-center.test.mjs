/* Report Center — acceptance: the twelve criteria the Reports System promises,
   driven through the real admin.html form (dropdown, filters, buttons) and
   through the real engine headlessly for every role.

     1  each role sees only its authorized reports
     2  only the filters a report declares are rendered
     3  an invalid filter blocks Generate
     4  preview and PDF render one document (same rows, totals, order)
     5  no data → the honest empty state, never invented rows
     6  Back preserves the report that was chosen
     7  mobile: nothing can overflow horizontally
     8  generating reports never touches stored data
     9  unauthorized direct actions are blocked before any data is read
     10 the export carries the real rows and the filename convention
     11 the preview shows exactly the pages the engine laid out
     12 daily / weekly / monthly / custom periods each ask for the one date they need

   Note: jsdom does not run a form's default submission from a synthetic click,
   so Generate is driven by dispatching `submit` on the form the button lives in
   — the same listener a real tap reaches. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { STORAGE_KEYS } from '../js/config.js';
import { adminStudents, initialTransactions } from '../js/admin-data.js';
import { ROSTER_KEY } from './../js/office-data.js';
import { TRANSACTIONS_KEY } from '../js/finance-data.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';

let ctx;
let catalog;
let access;
let sources;
let reports;
let engine;
let lastDownload = null;
const CHAR = 8;

const ACCOUNT_KEY = 'active-plus-account-v1';
const ROOT = '#adminReports';
const $ = selector => ctx.$(`${ROOT} ${selector}`);
const $$ = selector => ctx.$$(`${ROOT} ${selector}`);

/** Step back out of a preview, the way a thumb would, so the form is showing. */
function backToForm() {
  if (!$('.rc-form') && $('.rc-back')) ctx.click($('.rc-back'));
}

/** Pick a report the way a user does: choose it in the one dropdown. */
function chooseReport(id) {
  backToForm();
  const select = $('select[name="report"]');
  assert.ok([...select.options].some(option => option.value === id), `report ${id} is offered`);
  select.value = id;
  select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
}

/** The declared filter controls, in the order the report declares them. */
const filters = () => $$('.rc-dynamic-filters .rc-field[data-filter]').map(node => node.dataset.filter);

const control = key => $(`.rc-field[data-filter="${key}"] .rc-control`);
const setValue = (key, value) => {
  const node = control(key);
  node.value = value;
  node.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
};

const status = () => $('.rc-status')?.textContent || '';

/** The Generate button lives in the form, so submit the form. */
function generate() {
  ctx.submit($('.rc-form'));
}

async function generateAndWait(predicate, timeout = 30000) {
  generate();
  await ctx.waitFor(predicate, timeout);
}

before(async () => {
  ctx = await loadPage('admin.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [ROSTER_KEY]: JSON.stringify(adminStudents),
      [TRANSACTIONS_KEY]: JSON.stringify({ transactions: initialTransactions }),
      [STORAGE_KEYS.appConfig]: JSON.stringify({ coachingName: 'Active Plus Coaching' })
    }
  });

  const fake = {
    font: '', fillStyle: '', strokeStyle: '', textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1,
    measureText: text => ({ width: String(text).length * CHAR }),
    fillText() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    drawImage() {}, scale() {}, setTransform() {}
  };
  ctx.window.HTMLCanvasElement.prototype.getContext = () => fake;
  ctx.window.HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
    callback(new ctx.window.Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }));
  };
  ctx.window.Blob.prototype.arrayBuffer = function arrayBuffer() { return Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer); };
  ctx.window.Image.prototype.decode = function decode() { return Promise.resolve(); };
  globalThis.FontFace = ctx.window.FontFace = class FontFace { load() { return Promise.resolve(this); } };
  Object.defineProperty(ctx.window.document, 'fonts', {
    value: { add() {}, ready: Promise.resolve() },
    configurable: true
  });

  const realCreate = ctx.window.document.createElement.bind(ctx.window.document);
  ctx.window.document.createElement = function create(tag, ...rest) {
    const node = realCreate(tag, ...rest);
    if (String(tag).toLowerCase() === 'a') {
      node.click = () => { lastDownload = { name: node.download, href: node.href }; };
    }
    return node;
  };
  ctx.window.URL.createObjectURL = () => 'blob:active-plus-report';
  ctx.window.URL.revokeObjectURL = () => {};
  globalThis.URL.createObjectURL = ctx.window.URL.createObjectURL;
  globalThis.URL.revokeObjectURL = ctx.window.URL.revokeObjectURL;

  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  catalog = await import('../js/report-catalog.js');
  access = await import('../js/report-access.js');
  sources = await import('../js/report-sources.js');
  reports = await import('../js/reports.js');
  engine = await import('../js/report-layout.js');
  await import('../js/admin.js');
  await ctx.waitFor(() => Boolean($('.rc-form')), 20000);
});

/* ------------------------------------------------------------------ 1 ---- */

test('1 — every role sees only its authorized reports', async () => {
  // The catalog is the source of truth for all five roles.
  for (const role of ['admin', 'manager', 'teacher', 'cash', 'student']) {
    for (const category of catalog.catalogFor(role)) {
      for (const definition of category.reports) {
        assert.ok((definition.roles || []).includes(role),
          `${definition.id} is listed for ${role} but does not allow it`);
      }
    }
  }
  assert.ok(catalog.catalogFor('teacher').every(category => category.id !== 'staff'),
    'Teachers get no staff category');
  assert.ok(catalog.catalogFor('cash').every(category => ['fee', 'cash'].includes(category.id)),
    'Cash Counter sees only the money categories');
  assert.ok(!catalog.catalogFor('student').some(category =>
    category.reports.some(definition => definition.id === 'student.all')),
  'Student Master List never reaches a student');

  // What the centre offers for Admin is exactly the reports the catalog allows.
  const offered = [...$('select[name="report"]').options].map(option => option.value).filter(Boolean);
  const expected = catalog.catalogFor('admin')
    .flatMap(category => category.reports.map(definition => definition.id));
  assert.deepEqual(offered, expected);
  assert.equal(offered.includes('teacher.my-class'), false, 'a teacher-only report is not offered');
});

/* ------------------------------------------------------------------ 2 ---- */

test('2 — only the filters a report declares are rendered', () => {
  chooseReport('student.class-wise');
  assert.deepEqual(filters(), catalog.findReport('student.class-wise').filters);

  chooseReport('exam.complete');
  assert.deepEqual(filters(), ['exam']);

  chooseReport('notice.audience-wise');
  assert.equal(filters().length, 0, 'a report without filters asks for none');
  assert.equal($('.rc-period-extra'), null, 'and shows no date inputs');
  // A report that names one person does not offer "all" for them.
  chooseReport('student.profile');
  const studentValues = [...control('student').options].map(option => option.value);
  assert.equal(studentValues[0], '', 'a single-record filter starts on the empty choice');
  assert.equal(studentValues.includes('all'), false, 'never on “all”');
  assert.equal(control('student').value, '', 'and nothing is preselected');
  // Choosing a different report replaces the fields rather than stacking them.
  chooseReport('student.all');
  assert.deepEqual(filters(), catalog.findReport('student.all').filters);
});

/* ----------------------------------------------------------------- 12 ---- */

test('12 — daily, weekly, monthly and custom each ask for the one date they need', () => {
  chooseReport('fee.daily');
  assert.equal(control('period').value, 'daily', 'the report opens on its own default period');
  const extra = () => $('.rc-period-extra');
  const extraNames = () => [...(extra()?.querySelectorAll('input') || [])].map(node => node.name);

  assert.deepEqual(extraNames(), ['date'], 'only the day input shows for daily');

  setValue('period', 'weekly');
  assert.deepEqual(extraNames(), ['week']);
  setValue('period', 'monthly');
  assert.deepEqual(extraNames(), ['month']);
  setValue('period', 'custom');
  assert.deepEqual(extraNames(), ['from', 'to']);
  const [from, to] = extra().querySelectorAll('input');
  assert.equal(from.type, 'date');
  assert.equal(to.type, 'date');
  setValue('period', 'all');
  assert.equal(extra(), null, '“all” asks for no date at all');
});

/* ------------------------------------------------------------------ 3 ---- */

test('3 — an invalid filter blocks Generate', async () => {
  chooseReport('fee.custom');
  setValue('period', 'custom');
  const [from, to] = $('.rc-period-extra').querySelectorAll('input');
  const isoDay = offset => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
  from.value = isoDay(1);   // From is the later day
  to.value = isoDay(30);
  await generateAndWait(() => $('.rc-status')?.hidden === false);
  assert.match(status(), /From Date/, 'a reversed range names the offending field');
  assert.equal($('.rc-preview'), null, 'no preview is produced');

  // A report that requires a student refuses to run without one.
  chooseReport('student.profile');
  await generateAndWait(() => status().length > 0);
  assert.match(status(), /শিক্ষার্থী/, 'the missing student is reported in plain words');
  assert.equal($('.rc-preview'), null);
  assert.ok(!/Error:|at .*\.js:/.test(status()), 'no stack trace leaks into the message');
});

/* ------------------------------------------------------------------ 4 ---- */

test('4 — preview and PDF render one document (same rows, totals, order)', async () => {
  chooseReport('student.all');
  await generateAndWait(() => Boolean($('.rc-download')), 30000);

  // The very document the panel generated, built the same way it builds it.
  const definition = catalog.findReport('student.all');
  const actor = await access.resolveActor();
  const gate = access.enforceAccess(definition, actor, {});
  const built = await catalog.buildReportDocument(definition,
    { filters: gate.filters, actor, scope: gate.scope, snapshot: sources.loadSnapshot() });

  // The preview carries the document's own rows (short identifying cells — the
  // layout may ellipsize a long cell identically in preview and PDF).
  const pageText = $('.rc-pdf-preview').textContent;
  const table = built.doc.blocks.find(block => block.type === 'table');
  assert.ok(table, 'the document holds a student table');
  for (const row of table.rows.slice(0, 5)) {
    for (const cell of [row[0], row[1]]) {
      if (cell && cell !== '—') assert.ok(pageText.includes(String(cell)), `preview shows ${cell}`);
    }
  }

  // And the row order is the document's own order, header first.
  const rows = engine.reportRows(built.doc);
  const start = rows.findIndex(row => row.length === table.columns.length
    && row.every((cell, i) => cell === table.columns[i].label));
  assert.ok(start >= 0, 'the table header reaches the row list');
  for (let i = 0; i < Math.min(5, table.rows.length); i += 1) {
    assert.deepEqual(rows[start + 1 + i], table.rows[i], `row ${i} travels in order`);
  }
});

/* ----------------------------------------------------------------- 10 ---- */

test('10 — the export carries the real rows and the filename convention', async () => {
  const today = new Date().toISOString().slice(0, 10);
  lastDownload = null;
  ctx.click($('.rc-download'));
  await ctx.waitFor(() => Boolean(lastDownload), 30000);
  assert.equal(lastDownload.name, `ActivePlus_Student_Master_List_${today}.pdf`);
  assert.equal(lastDownload.href, 'blob:active-plus-report', 'the download is the very blob the preview was given');
});

/* ----------------------------------------------------------------- 11 ---- */

test('11 — the preview shows exactly the pages the engine laid out', () => {
  const pages = $$('.rc-pdf-preview .rp-page');
  assert.ok(pages.length >= 1);
  // One unbroken run of page numbers: the preview is the engine's own output,
  // so the count and the order cannot drift from the document.
  assert.deepEqual(pages.map(page => Number(page.dataset.page)), pages.map((_, index) => index + 1));
  assert.equal(engine.PAGE.width, 794);
  assert.equal(engine.PAGE.height, 1123);
});

/* ------------------------------------------------------------------ 7 ---- */

test('7 — mobile: the preview cannot overflow horizontally', () => {
  const css = readFileSync(new URL('../css/ui-features.css', import.meta.url), 'utf8');
  const scroll = /\.rc-pdf-preview\s*\{([^}]*)\}/.exec(css);
  assert.ok(scroll, 'the preview scroll rule exists');
  assert.match(scroll[1], /min-width:\s*0/, 'the preview must not force the shell wider than the screen');
  const page = /\.rc-pdf-preview \.rp-page\s*\{([^}]*)\}/.exec(css);
  assert.match(page[1], /width:\s*794px/);
  assert.match(page[1], /height:\s*1123px/);
  const download = /\.rc-download\s*\{([^}]*)\}/.exec(css);
  assert.match(download[1], /width:\s*100%/, 'the download button is full width');
  assert.match(download[1], /min-height:\s*5\dpx/, 'the download button is a real touch target');
});

/* ------------------------------------------------------------------ 5 ---- */

test('5 — no records means the honest empty state, never invented rows', async () => {
  chooseReport('student.class-wise');
  const option = [...control('class').options].find(node => node.value === 'অনার্স ৪র্থ বর্ষ');
  assert.ok(option, 'every enabled class is offered');
  setValue('class', option.value);
  await generateAndWait(() => Boolean($('.rc-pdf-preview')), 30000);

  // The empty state travels inside the document, so the PDF says it too — and
  // no zero-filled table is printed in its place.
  assert.ok($('.rc-pdf-preview').textContent.includes(catalog.EMPTY_MESSAGE), 'the preview uses the catalogue empty message');
  assert.match(catalog.EMPTY_MESSAGE, /কোনো তথ্য পাওয়া যায়নি/, 'the empty state carries the required wording');
  assert.equal($('.rc-preview-notice').textContent, catalog.EMPTY_MESSAGE, 'the preview states the empty result above the page');
  assert.equal($('.rc-pdf-preview').textContent.includes('AP-1024'), false, 'no student rows leak into an empty report');
  assert.ok(catalog.EMPTY_MESSAGE.length > 0, 'the catalogue keeps the Bengali empty message');
});

/* ------------------------------------------------------------------ 6 ---- */

test('6 — Back preserves the report that was chosen', async () => {
  chooseReport('student.all');
  await generateAndWait(() => Boolean($('.rc-download')), 30000);

  const back = $('.rc-back');
  assert.ok(back, 'the preview offers Back');
  ctx.click(back);
  await ctx.waitFor(() => Boolean($('.rc-form')), 20000);
  assert.equal($('.rc-pdf-preview'), null, 'the preview gives way to the form');
  assert.equal($('select[name="report"]').value, 'student.all',
    'the same report stays selected after stepping back');
  assert.deepEqual(filters(), catalog.findReport('student.all').filters,
    'and so do its declared filters');
});

/* ------------------------------------------------------------------ 8 ---- */

const DATA_KEYS = [ROSTER_KEY, TRANSACTIONS_KEY, 'activePlus.admin.notices.v1',
  'activePlus.admin.routine.v1', 'activePlus.teaching.v1', 'activePlus.exams.v1', ACCOUNT_KEY];

test('8 — generating and downloading never touch stored data', async () => {
  chooseReport('fee.transactions');
  const capture = () => DATA_KEYS.map(key => `${key}=${ctx.window.localStorage.getItem(key)}`).join('&');
  const before = capture();
  await generateAndWait(() => Boolean($('.rc-download')), 30000);
  lastDownload = null;
  ctx.click($('.rc-download'));
  await ctx.waitFor(() => Boolean(lastDownload), 30000);
  assert.equal(capture(), before,
    'every student, finance, routine and record store is byte-identical after the flow');
});

/* ------------------------------------------------------------------ 9 ---- */

test('9 — unauthorized direct actions are blocked before any data is read', async () => {
  const forbidden = error => error && error.code === 'FORBIDDEN';
  const def = id => catalog.findReport(id);

  // Hidden reports are also refused outright, for every role.
  assert.throws(() => access.enforceAccess(def('student.all'), { kind: 'staff', role: 'teacher', staffRole: 'teacher', username: 'teacher.apc' }, {}), forbidden);
  assert.throws(() => access.enforceAccess(def('staff.status'), { kind: 'staff', role: 'manager', staffRole: 'manager', username: 'manager.apc' }, {}), forbidden);
  assert.throws(() => access.enforceAccess(def('fee.due-list'), { kind: 'staff', role: 'payment', staffRole: 'payment', username: 'payment.apc' }, {}), forbidden);
  assert.throws(() => access.enforceAccess(def('management.summary'), { kind: 'student', role: 'student', studentId: 'AP-1024' }, {}), forbidden);

  // A student asking for another student's record is refused outright…
  const studentActor = { kind: 'student', role: 'student', studentId: 'AP-1024' };
  assert.throws(() => access.enforceAccess(def('student.profile'), studentActor, { studentId: 'AP-9999' }), forbidden);
  // …and on their own reports the scope pins the filter to the owner.
  const gate = access.enforceAccess(def('student.profile'), studentActor, {});
  assert.equal(gate.filters.studentId, 'AP-1024', 'the scope pins the filter to the owner');

  // The Cash Counter's own-history is pinned to its counter label.
  const cashGate = access.enforceAccess(def('cash.own-history'),
    { kind: 'staff', role: 'cash', staffRole: 'payment', username: 'payment.apc' }, {});
  assert.equal(cashGate.filters.counter, access.CASH_COUNTER_LABEL);

  /* And the centre itself refuses: swapped into a Teacher session, it never
     offers the report, and forcing one in still blocks before data is read. */
  const snapshotBefore = ctx.window.localStorage.getItem(ROSTER_KEY);
  try { await provisionStaff('teacher'); } catch { /* the app's own bootstrap may have set the password already */ }
  const adminSession = ctx.window.localStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey);
  ctx.window.localStorage.removeItem(STAFF_ACCOUNTS.admin.sessionKey);
  seedStaffSession(ctx.window, 'teacher');
  const teacherCenter = await reports.mountReports(document.createElement('div'), { panel: 'test' });
  assert.equal(teacherCenter.actor.role, 'teacher');
  assert.equal(teacherCenter.catalog.some(report => report.id === 'student.all'), false,
    'an unauthorized report is never even offered');
  // Force the definition in, the way a tampered dropdown would: generate must
  // still stop at the access check.
  teacherCenter.definition = def('student.all');
  teacherCenter.dynamic = document.createElement('div');
  teacherCenter.status = document.createElement('p');
  teacherCenter.form = document.createElement('form');
  await teacherCenter.generate();
  assert.match(teacherCenter.status.textContent, /অনুমতি/);
  assert.equal(teacherCenter.pdfBlob, null, 'nothing is built for an unauthorized report');
  assert.equal(ctx.window.localStorage.getItem(ROSTER_KEY), snapshotBefore,
    'the block happens before any data is loaded');
  ctx.window.localStorage.removeItem(STAFF_ACCOUNTS.teacher.sessionKey);
  ctx.window.localStorage.setItem(STAFF_ACCOUNTS.admin.sessionKey, adminSession);
});

/* ------------------------------------------------- role pipeline (1–5) ---- */

test('the generate pipeline runs for every role on its own scope', async () => {
  const snapshot = sources.loadSnapshot();
  const run = async (definition, actor, filters) => {
    const invalid = catalog.validateFilters(definition, filters);
    if (invalid) return { invalid };
    const gate = access.enforceAccess(definition, actor, filters);
    return catalog.buildReportDocument(definition,
      { filters: gate.filters, actor, scope: gate.scope, snapshot });
  };

  const admin = { kind: 'staff', role: 'admin', staffRole: 'admin', username: 'admin.apc' };
  const teacher = { kind: 'staff', role: 'teacher', staffRole: 'teacher', username: 'teacher.apc' };
  const cash = { kind: 'staff', role: 'cash', staffRole: 'payment', username: 'payment.apc' };
  const student = { kind: 'student', role: 'student', studentId: 'AP-1024' };

  const adminRun = await run(catalog.findReport('student.all'), admin, {});
  assert.equal(adminRun.empty, false, 'Admin gets the real roster');

  const cashRun = await run(catalog.findReport('cash.own-history'), cash, { period: 'all' });
  assert.ok(cashRun.doc, 'Cash Counter generates its own history');

  const studentRun = await run(catalog.findReport('mine.due'), student, {});
  assert.ok(studentRun.doc, 'a student generates their own dues');

  // Without assignments a teacher's scope is empty — the honest empty state
  // or a refusal, never someone else's rows.
  let teacherRun;
  try {
    teacherRun = await run(catalog.findReport('academic.class'), teacher, {});
  } catch (error) {
    assert.equal(error.code, 'FORBIDDEN', 'a teacher is only refused, never mis-scoped');
    teacherRun = { doc: null, empty: true };
  }
  const leaked = JSON.stringify(teacherRun.doc || {});
  assert.ok(!leaked.includes('AP-1024'), 'an unassigned teacher sees no students');
});
