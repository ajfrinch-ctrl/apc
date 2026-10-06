/* The Report Center on the real admin.html, end to end:

     Select Report → its declared filters → Generate → paged preview → DOWNLOAD PDF

   The test drives the actual form a user fills in, with only jsdom's canvas and
   font APIs stubbed (the engine measures text on a canvas; jsdom has none).
   Assertions cover the promises that matter on a phone: the role only sees the
   reports it may run, only the declared filters appear, the preview is real
   paged A4, the download button is present and full width, and the file it
   produces carries a meaningful name.

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
import { ROSTER_KEY } from '../js/office-data.js';
import { TRANSACTIONS_KEY } from '../js/finance-data.js';

let ctx;
let catalog;
const CHAR = 8;
let lastDownload = null;

const ROOT = '#adminReports';
const $ = selector => ctx.$(`${ROOT} ${selector}`);
const $$ = selector => ctx.$$(`${ROOT} ${selector}`);

before(async () => {
  ctx = await loadPage('admin.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [ROSTER_KEY]: JSON.stringify(adminStudents),
      [TRANSACTIONS_KEY]: JSON.stringify(initialTransactions),
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
  // jsdom has no font loading API; the engine (and fixed-shell) only read it.
  Object.defineProperty(ctx.window.document, 'fonts', {
    value: { add() {}, ready: Promise.resolve() },
    configurable: true
  });

  // Catch what the download helper hands to the browser.
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
  // exam-pdf.js resolves URL from the global scope, not from `window`.
  globalThis.URL.createObjectURL = ctx.window.URL.createObjectURL;
  globalThis.URL.revokeObjectURL = ctx.window.URL.revokeObjectURL;

  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  catalog = await import('../js/report-catalog.js');
  await import('../js/admin.js');
  await ctx.waitFor(() => Boolean($('.rc-form')), 20000);
});

/** Pick a report the way a user does: choose it in the one dropdown. */
function chooseReport(id) {
  const select = $('select[name="report"]');
  assert.ok([...select.options].some(option => option.value === id), `report ${id} is offered`);
  select.value = id;
  select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
}

/** The declared filter controls, in the order the report declares them. */
const filters = () => $$('.rc-dynamic-filters .rc-field[data-filter]').map(node => node.dataset.filter);

/** The Generate button lives in the form, so submit the form. */
function generate() {
  ctx.submit($('.rc-form'));
}

test('the centre offers exactly the reports the Admin role may run', () => {
  const offered = [...$('select[name="report"]').options]
    .map(option => option.value)
    .filter(Boolean);
  const expected = catalog.REPORTS
    .filter(report => (report.roles || []).includes('admin'))
    .map(report => report.id);
  assert.deepEqual(offered, expected);
  // The role model is what limits the list, not a hand-kept copy of it.
  assert.equal(catalog.findReport('teacher.my-class').roles.includes('admin'), false);
  assert.equal(offered.includes('teacher.my-class'), false);
});

test('only the filters the selected report declares are rendered', () => {
  chooseReport('student.class-wise');
  assert.deepEqual(filters(), catalog.findReport('student.class-wise').filters);

  // A report that needs an exam asks only for an exam.
  chooseReport('exam.complete');
  assert.deepEqual(filters(), ['exam']);

  // Switching reports replaces the fields rather than stacking them up.
  chooseReport('student.all');
  assert.deepEqual(filters(), catalog.findReport('student.all').filters);
  assert.equal($('.rc-period-extra'), null, 'a report with no period asks for no dates');
});

test('a custom range offers From and To, and refuses a reversed range', async () => {
  chooseReport('fee.custom');
  assert.ok(filters().includes('period'));

  const period = $('.rc-field[data-filter="period"] .rc-control');
  period.value = 'custom';
  period.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));

  const box = $('.rc-period-extra');
  assert.ok(box, 'the From/To pair appears for a custom range');
  const [from, to] = box.querySelectorAll('input');
  assert.equal(from.type, 'date');
  assert.equal(to.type, 'date');

  // A range that ends before it starts is refused before anything is built.
  // A range that ends before it starts: From is the later day.
  const isoDay = offset => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
  from.value = isoDay(1);
  to.value = isoDay(30);
  generate();
  await ctx.waitFor(() => $('.rc-status')?.hidden === false, 10000);
  assert.match($('.rc-status').textContent, /From Date/);
  assert.equal($('.rc-preview'), null, 'a refused range never reaches the preview');
});

test('Generate builds a paged preview with a full-width download', async () => {
  chooseReport('student.all');
  generate();
  await ctx.waitFor(() => Boolean($('.rc-download')), 20000);

  const pages = $$('.rc-pdf-preview .rp-page');
  assert.ok(pages.length >= 1, 'the preview renders A4 pages');
  // The pages are the engine's own measured output, so the preview is the
  // PDF's real geometry rather than a screenshot of it.
  assert.deepEqual(pages.map(page => Number(page.dataset.page)), pages.map((_, index) => index + 1));

  const button = $('.rc-download');
  assert.match(button.textContent, /Download PDF/i);
  assert.equal($('.rc-back'), button.parentElement.querySelector('.rc-back'), 'the preview can be stepped back from');
});

test('the stylesheet keeps every page A4 and the download out of the bottom nav', () => {
  const css = readFileSync(new URL('../css/ui-features.css', import.meta.url), 'utf8');
  const page = /\.rc-pdf-preview \.rp-page\s*\{([^}]*)\}/.exec(css);
  assert.ok(page, 'the page rule exists');
  assert.match(page[1], /width:\s*794px/);
  assert.match(page[1], /height:\s*1123px/);
  const scroll = /\.rc-pdf-preview\s*\{([^}]*)\}/.exec(css);
  assert.ok(scroll, 'the preview scroll rule exists');
  assert.match(scroll[1], /min-width:\s*0/, 'the preview must not force the shell wider than the screen');
  const action = /\.rc-download\s*\{([^}]*)\}/.exec(css);
  assert.match(action[1], /width:\s*100%/, 'the download button is full width');
  assert.match(action[1], /min-height:\s*5\dpx/, 'the download button is a real touch target');
});

test('the download asks the browser for a meaningfully named PDF', async () => {
  lastDownload = null;
  ctx.click($('.rc-download'));
  await ctx.waitFor(() => Boolean(lastDownload), 20000);
  const today = new Date().toISOString().slice(0, 10);
  assert.match(lastDownload.name, new RegExp(`^ActivePlus_Student_Master_List_${today}\\.pdf$`));
  assert.equal(lastDownload.href, 'blob:active-plus-report');
});

test('the preview replaces the form, and Back returns to it', async () => {
  // One document, one blob: the preview and the download cannot drift apart.
  assert.ok($('.rc-pdf-preview').textContent.trim().length > 0, 'the preview shows the document body');
  assert.equal($('.rc-form'), null, 'the form gives way to the preview');
  ctx.click($('.rc-back'));
  await ctx.waitFor(() => Boolean($('.rc-form')), 20000);
  assert.equal($('select[name="report"]').value, 'student.all', 'Back keeps the chosen report');
  assert.equal($('.rc-pdf-preview'), null);
});

test('a report with no matching records says so instead of printing blanks', async () => {
  chooseReport('student.class-wise');
  const select = $('.rc-field[data-filter="class"] .rc-control');
  const option = [...select.options].find(node => node.value === 'অনার্স ৪র্থ বর্ষ');
  assert.ok(option, 'every enabled class is offered');
  select.value = option.value;
  select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  generate();
  await ctx.waitFor(() => Boolean($('.rc-pdf-preview')), 20000);
  // The honest empty state travels inside the document, so the PDF says it too —
  // and the preview says it above the page as well (§Report Center).
  assert.match($('.rc-pdf-preview').textContent, /কোনো তথ্য পাওয়া যায়নি/);
  assert.equal($('.rc-preview-notice').textContent, catalog.EMPTY_MESSAGE, 'the preview announces the empty result');
  assert.equal(catalog.EMPTY_MESSAGE, 'কোনো তথ্য পাওয়া যায়নি।', 'the required wording is pinned');
});
