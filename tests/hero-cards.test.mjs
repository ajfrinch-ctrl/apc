/* The Student-only decorative art remains additive beside the new Home hero
   carousel. It stays offline, respects reduced motion and does not alter the
   separate Payment carousel entry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../student.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../js/hero-cards.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/hero-cards.css', import.meta.url), 'utf8');
const homeCss = readFileSync(new URL('../css/student-home-design.css', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('Student hero art mounts onto the welcome, advice, progress and today surfaces', () => {
  const dom = new JSDOM(html, { url: 'http://localhost/student.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: true });
  window.requestAnimationFrame = callback => { callback(0); return 1; };
  window.setInterval = () => 1;

  const list = window.document.querySelector('#dashboardRoutineList');
  list.innerHTML = '<article class="dashboard-routine-card"><strong>গণিত</strong><span data-routine-status="scheduled">রুটিনে আছে</span></article>'
    + '<article class="dashboard-routine-card"><strong>পদার্থবিজ্ঞান</strong><span data-routine-status="running">চলছে</span></article>';
  window.document.querySelector('#birthdayBanner').hidden = false;
  window.eval(source);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

  const slots = [
    '.student-home-welcome > .hc-art--welcome',
    '#dailyQuoteCard > .hc-art--advice',
    '.study-progress-card > .hc-art--progress',
    '.dashboard-today-section > .hc-art--today'
  ];
  for (const selector of slots) {
    const slot = window.document.querySelector(selector);
    assert.ok(slot, `${selector} is mounted`);
    assert.equal(slot.getAttribute('aria-hidden'), 'true', `${selector} is decorative to assistive technology`);
    assert.ok(slot.querySelector('svg'), `${selector} contains local inline SVG`);
  }
  assert.equal(window.document.querySelector('.hc-art--welcome').dataset.art, 'party', 'birthday art follows the visible banner');
  assert.equal(window.document.querySelector('.hc-art--today').dataset.art, 'physics', 'the currently running class takes priority over the first row');
  assert.equal(window.APCHeroArt.detect('রসায়ন'), 'chemistry');
  assert.equal(window.APCHeroArt.detect('গণিত'), 'math');
  const homeHero = window.document.querySelector('#homeView [data-student-home-hero]');
  assert.equal(window.document.querySelectorAll('#homeView [data-home-hero]').length, 1);
  assert.ok(homeHero, 'decorative card art does not remove the Student hero mount');
  assert.equal(homeHero.querySelector('.hc-art'), null, 'the large carousel image is not treated as decorative SVG art');
  assert.ok(window.document.querySelector('#studentName'), 'art mounting does not replace Student content');
  assert.ok(window.document.querySelector('#studentServices [data-action="homework"]'), 'existing shortcut routes remain');
  dom.window.close();
});

test('welcome artwork changes across Dhaka morning, noon, afternoon and night', () => {
  const periods = [
    { hour: 8, name: 'morning', motion: ['.hc-spin', '.hc-drift'] },
    { hour: 11, name: 'morning', motion: ['.hc-spin', '.hc-drift'] },
    { hour: 12, name: 'noon', motion: ['.hc-spin', '.hc-pulse', '.hc-drift'] },
    { hour: 15, name: 'noon', motion: ['.hc-spin', '.hc-pulse', '.hc-drift'] },
    { hour: 16, name: 'afternoon', motion: ['.hc-rise', '.hc-tw'] },
    { hour: 17, name: 'afternoon', motion: ['.hc-rise', '.hc-tw'] },
    { hour: 19, name: 'night', motion: ['.hc-float', '.hc-tw'] },
    { hour: 20, name: 'night', motion: ['.hc-float', '.hc-tw'] },
    { hour: 22, name: 'night', motion: ['.hc-float', '.hc-tw'] }
  ];

  for (const period of periods) {
    const dom = new JSDOM(html, { url: 'http://localhost/student.html', runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    window.matchMedia = () => ({ matches: false });
    window.requestAnimationFrame = callback => { callback(0); return 1; };
    window.setInterval = () => 1;
    window.Intl.DateTimeFormat = function () {
      return { formatToParts: () => [{ type: 'hour', value: String(period.hour).padStart(2, '0') }] };
    };
    window.document.querySelector('#birthdayBanner').hidden = true;
    window.eval(source);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const art = window.document.querySelector('.hc-art--welcome');
    assert.equal(art.dataset.art, period.name, `${period.name} greeting art follows Dhaka local time`);
    for (const selector of period.motion) assert.ok(art.querySelector(selector), `${period.name} art includes ${selector}`);
    dom.window.close();
  }
});

test('Student Home uses softer hero tiles while its decorative art remains scoped and motion-aware', () => {
  assert.match(html, /css\/hero-cards\.css\?v=\d+/u);
  assert.match(html, /js\/hero-cards\.js\?v=\d+/u);
  assert.match(css, /prefers-reduced-motion:\s*reduce/u);
  assert.match(css, /pointer-events:\s*none/u);
  assert.match(css, /body\.student-reference #homeView/u);
  assert.match(homeCss, /#studentServices \.pay-tile\s*\{[^}]*--home-tile:\s*#eaf2ff[^}]*background-color:\s*var\(--home-tile\)/u);
  assert.match(homeCss, /#studentServices \.pay-tile-icon svg\s*\{[^}]*filter:\s*none/u,
    'quick-access tiles retain the full-color 3D artwork');
  assert.match(homeCss, /html\[data-theme="dark"\][^}]*#studentServices/u, 'dark mode keeps a separate readable tile palette');
  assert.match(worker, /'\.\/css\/hero-cards\.css'/u);
  assert.match(worker, /'\.\/js\/hero-cards\.js'/u);
});

test('the art entry belongs only to Student; the staff panels load no hero scripts', () => {
  assert.match(html, /js\/hero-cards\.js\?v=\d+/u);
  for (const page of ['payment.html', 'teacher.html', 'manager.html', 'admin.html']) {
    const staffHtml = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.doesNotMatch(staffHtml, /hero-cards\.js/u, `${page} loads no art entry`);
    // Owner request 2026-10-28: the staff hero carousel is gone entirely.
    assert.doesNotMatch(staffHtml, /home-hero-entry\.js/u, `${page} loads no hero carousel entry`);
    assert.doesNotMatch(staffHtml, /data-home-hero|teacher-hero-scene/u, `${page} carries no hero markup`);
  }
});
