/* Production and generated images carry a descriptive alt value. Decorative
   icons are SVGs; these checks cover real <img> elements across the PWA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadPage } from './jsdom-harness.mjs';
import { initHomeHero } from '../js/home-hero.js';
import { renderPreviewHTML } from '../js/report-layout.js';

const HTML_PAGES = [
  'admin.html', 'demo/offline-roles.html', 'index.html', 'manager.html',
  'payment.html', 'privacy.html', 'student.html', 'teacher.html', 'tools/merge-backups.html'
];

test('all static PWA page images have non-empty alt text', () => {
  for (const file of HTML_PAGES) {
    const document = new JSDOM(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).window.document;
    for (const image of document.querySelectorAll('img')) {
      assert.ok(image.hasAttribute('alt'), `${file}: <img> is missing alt`);
      assert.ok(image.getAttribute('alt').trim(), `${file}: <img> has an empty alt`);
    }
  }
});

test('Shared carousel illustrations and report-preview logos get descriptive alt text at runtime', async () => {
  // The Payment Counter no longer hosts the carousel (owner request 2026-10-28);
  // the shared implementation is exercised on a fresh mount instead.
  const ctx = await loadPage('student.html');
  const mount = ctx.document.createElement('div');
  mount.setAttribute('data-home-hero', '');
  ctx.document.body.appendChild(mount);
  const carousel = initHomeHero(mount);
  const heroImages = mount.querySelectorAll('[data-hero-slide] img');
  assert.equal(heroImages.length, 4);
  assert.ok([...heroImages].every(image => image.alt.trim()), 'all four hero illustrations describe their content');
  carousel.stop();
  ctx.window.close();

  const preview = renderPreviewHTML([{
    index: 1,
    items: [{ kind: 'image', image: { src: 'assets/icons/logo-128.png' }, x: 0, y: 0, w: 24, h: 24 }]
  }]);
  const logo = new JSDOM(preview).window.document.querySelector('img');
  assert.ok(logo?.alt.includes('Active Plus Coaching'), 'the generated report logo names the organisation');
});
