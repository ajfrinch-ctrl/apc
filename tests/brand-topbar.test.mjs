/* One brand everywhere: institute name + logo + slogan.

   The school's rules:
     • every page's top bar shows the same logo file (the app's own asset — no
       second copy), the institute name and the slogan;
     • the slogan stays fixed when the app rewrites it, so a saved config can
       never drop the institute name;
     • the downloaded PDFs read the same name/tagline/logo constants instead of
       repeating the words in a second place. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadPage } from './jsdom-harness.mjs';
import { BRAND_NAME, BRAND_TAGLINE, BRAND_LOGO, brandLogoSrc } from '../js/brand.js';

const PAGES = ['index.html', 'manager.html', 'teacher.html', 'admin.html', 'payment.html'];
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const contexts = [];
after(() => contexts.forEach(ctx => ctx.window.close()));

test('every page carries the logo, with the slogan on a separate line under the institute name', () => {
  for (const page of PAGES) {
    const document = new JSDOM(read(page)).window.document;
    const brand = document.querySelector('.app-brand');
    assert.ok(brand, `${page}: no brand block`);
    assert.equal(brand.querySelectorAll('img.app-brand-logo').length, 1, `${page}: exactly one logo`);
    assert.equal(brand.querySelector('.app-brand-logo')?.getAttribute('src'), BRAND_LOGO, `${page}: the shared logo asset`);
    const institute = brand.querySelector('.app-brand-institute');
    const tagline = brand.querySelector('[data-fixed-tagline]');
    assert.equal(institute?.textContent.trim(), BRAND_NAME, `${page}: the institute name`);
    assert.ok(tagline, `${page}: the slogan slot`);
    assert.equal(tagline.textContent.trim(), BRAND_TAGLINE, `${page}: the slogan`);
    assert.equal(institute.parentElement, tagline.parentElement, `${page}: name and slogan share the brand text block`);
    assert.ok(institute.compareDocumentPosition(tagline) & document.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
      `${page}: the slogan must follow the institute name`);
    assert.equal(brand.querySelector('.app-brand-sep'), null, `${page}: the separator must not put both on one line`);
  }
});

test('no panel name in any topbar — logo + slogan only', () => {
  for (const page of PAGES) {
    const brand = read(page).match(/<div class="app-brand">[\s\S]*?<\/div>/)?.[0] || '';
    assert.doesNotMatch(brand, /class="app-brand-name"/, `${page}: the panel name should be gone — logo + slogan only`);
  }
});

test('the institute name and slogan survive the app rewriting the tagline', async () => {
  const ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  contexts.push(ctx);
  const taglines = ctx.$$('[data-fixed-tagline]');
  assert.ok(taglines.length >= 1, 'the page has a tagline slot');
  for (const line of taglines) {
    assert.equal(line.textContent.trim(), BRAND_TAGLINE, 'the slogan stays on its own line');
    assert.equal(line.parentElement.querySelector('.app-brand-institute')?.textContent.trim(), BRAND_NAME,
      'rewriting the slogan does not remove the institute name above it');
    assert.equal(line.getAttribute('aria-label'), null, 'the name is not redundantly announced as part of the slogan');
  }
  assert.equal(ctx.$$('.app-brand-logo').length >= 1, true, 'the branded top bar is on the page');
});

test('the brand has one source of truth for the PDFs as well', () => {
  const brand = read('js/brand.js');
  assert.match(brand, /export const BRAND_NAME/, 'the name lives in brand.js');
  assert.match(brand, /export const BRAND_TAGLINE/, 'the tagline lives in brand.js');
  assert.equal(brandLogoSrc().endsWith(BRAND_LOGO), true);
  for (const file of ['js/exam-pdf.js', 'js/report-layout.js']) {
    const source = read(file);
    if (!/brand\.js/.test(source)) continue;
    assert.doesNotMatch(source, /const BRAND_NAME =/, `${file}: no private copy of the name`);
  }
  for (const file of ['js/exam-pdf.js']) {
    assert.match(read(file), /from '\.\/brand\.js'/, `${file}: reads the shared brand module`);
    assert.doesNotMatch(read(file), /'Active Plus Coaching'/, `${file}: never hard-codes the name`);
  }
  /* No second copy of the logo file is shipped for the brand. */
  assert.equal(BRAND_LOGO, 'assets/icons/logo-128.png');
});
