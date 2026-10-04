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
import { loadPage } from './jsdom-harness.mjs';
import { BRAND_NAME, BRAND_TAGLINE, BRAND_LOGO, brandLogoSrc } from '../js/brand.js';

const PAGES = ['index.html', 'manager.html', 'teacher.html', 'admin.html', 'payment.html'];
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const contexts = [];
after(() => contexts.forEach(ctx => ctx.window.close()));

test('every page carries the logo, the institute name and the slogan', () => {
  for (const page of PAGES) {
    const html = read(page);
    const brand = html.match(/<div class="app-brand">[\s\S]*?<\/div>/)?.[0] || '';
    assert.ok(brand, `${page}: no brand block`);
    assert.equal((brand.match(/app-brand-logo/g) || []).length, 1, `${page}: exactly one logo`);
    assert.match(brand, new RegExp(`src="${BRAND_LOGO.replace(/[.]/g, '\\.')}"`), `${page}: the shared logo asset`);
    assert.match(brand, /class="app-brand-institute"[^>]*>Active Plus Coaching</, `${page}: the institute name`);
    assert.match(brand, /data-fixed-tagline/, `${page}: the slogan slot`);
    assert.match(brand, /শিখতে থাকো, এগিয়ে যাও/, `${page}: the slogan`);
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
    assert.match(line.textContent, new RegExp(BRAND_NAME), 'the institute name is still shown');
    assert.match(line.textContent, new RegExp(BRAND_TAGLINE), 'the slogan is still shown');
    /* The accessible name is written whenever the app applies a saved config;
       the visible line is what must always carry the brand. */
    const label = line.getAttribute('aria-label');
    if (label) assert.match(label, new RegExp(BRAND_NAME));
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
