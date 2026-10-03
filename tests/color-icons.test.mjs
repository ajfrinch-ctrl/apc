/* The requested new icon set must be actual layered artwork on every portal,
   not the previous single path with a coloured circle behind it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { ICON_SET, ILLUSTRATIONS, GLYPHS, iconArtwork, resolveIcon } from '../js/icon-set.js';
import { iconMarkup, iconElement, paintIcon } from '../js/icons.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const parse = html => new JSDOM(html).window.document;

test('the new family supplies layered colour services and compact matching glyphs', () => {
  assert.equal(ICON_SET, 'active-plus-color');
  assert.ok(Object.keys(ILLUSTRATIONS).length >= 30);
  assert.ok(Object.keys(GLYPHS).length >= 60);
  for (const name of Object.keys(ILLUSTRATIONS)) {
    const svg = parse(iconMarkup(name)).querySelector('svg');
    assert.equal(svg.dataset.iconSet, ICON_SET, name);
    assert.equal(svg.dataset.iconStyle, 'color', name);
    assert.ok(svg.querySelectorAll('path,rect,circle,ellipse').length >= 3, name + ' lacks layers');
    const fills = new Set([...svg.querySelectorAll('[fill]')].map(el => el.getAttribute('fill')).filter(fill => fill.startsWith('var(--icon-')));
    assert.ok(fills.size >= 2, name + ' is only a monochrome path');
    assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(svg.getAttribute('aria-hidden'), 'true');
    assert.equal(svg.getAttribute('focusable'), 'false');
    assert.ok(!svg.querySelector('image,use,symbol,text,foreignObject,script'));
    const glyph = parse(iconMarkup(name, 'nav-icon')).querySelector('svg');
    assert.equal(glyph.dataset.iconStyle, 'glyph');
    assert.ok(glyph.querySelector('path,rect,circle,ellipse'));
  }
});

test('all drawings are well-formed SVG without duplicate attributes or external IDs', () => {
  const window = new JSDOM('').window;
  const parser = new window.DOMParser();
  for (const [variant, drawings] of [['color', ILLUSTRATIONS], ['glyph', GLYPHS]]) {
    for (const name of Object.keys(drawings)) {
      const document = parser.parseFromString(iconMarkup(name, '', { variant }), 'image/svg+xml');
      assert.equal(document.querySelector('parsererror'), null, `${name}/${variant} XML error`);
      assert.equal(document.querySelectorAll('[id]').length, 0, 'repeatable inline icons must not duplicate IDs');
      assert.equal(document.querySelectorAll('[href],[onload],[onclick],script').length, 0);
    }
  }
  window.close();
});

test('staff, students, teachers, classes and role/security services have distinct art', () => {
  const names = ['staff','students','teacher','classes','book','roles','shield'];
  assert.equal(new Set(names.map(name => ILLUSTRATIONS[name])).size, names.length);
  assert.equal(resolveIcon('icon-courses'), 'book');
  assert.equal(resolveIcon('teachers'), 'teacher');
  assert.equal(resolveIcon('classes'), 'classes');
  assert.equal(resolveIcon('security'), 'shield');
  assert.equal(resolveIcon('homework'), 'assignment');
});

test('unknown names safely fall back and caller-provided attributes are escaped', () => {
  for (const name of ['unknown','__proto__','constructor','toString']) {
    assert.equal(iconArtwork(name).canonical, 'help');
    assert.ok(parse(iconMarkup(name)).querySelector('svg path'));
  }
  const document = parse(iconMarkup('"/><script>alert(1)</script>', '" onload="alert(1)'));
  assert.equal(document.querySelectorAll('script,[onload],[onclick]').length, 0);
  assert.equal(document.querySelectorAll('svg').length, 1);
});

test('static named icons on all five portals use the new set before JS boot', () => {
  for (const page of ['index','admin','manager','teacher','payment']) {
    const document = parse(read(page + '.html'));
    const icons = [...document.querySelectorAll('svg[data-icon]')];
    assert.ok(page === 'payment' ? icons.length >= 3 : icons.length > 10, page); // Minimal counter has no decorative service grid/footer.
    for (const svg of icons) {
      assert.equal(svg.dataset.iconSet, ICON_SET, page + ' old icon ' + svg.dataset.icon);
      assert.ok(svg.querySelector('path,rect,circle,ellipse'));
    }
    for (const svg of document.querySelectorAll('.pay-tile-icon svg,.admin-more-icon svg,.pay-pulse-icon svg')) {
      assert.equal(svg.dataset.iconStyle, 'color', page + ' service is not illustrated');
    }
    for (const svg of document.querySelectorAll('.nav-chip svg,.app-topbar-icon svg')) {
      assert.equal(svg.dataset.iconStyle, 'glyph', page + ' small control should have a readable compact glyph');
    }
  }
});

test('the unchanged renderer API replaces one icon, never a control or its routing', () => {
  const window = new JSDOM('<button data-admin-view="staff"><span class="admin-feature-icon"></span><span>স্টাফ</span></button><button><span class="nav-chip"></span></button>').window;
  const previous = globalThis.document;
  globalThis.document = window.document;
  try {
    const button = document.querySelector('[data-admin-view]');
    let clicks = 0;
    button.addEventListener('click', () => clicks++);
    paintIcon(button.querySelector('span'), 'staff', 'admin-feature-icon-svg');
    paintIcon(button.querySelector('span'), 'staff', 'admin-feature-icon-svg');
    assert.equal(button.querySelectorAll('svg').length, 1);
    assert.equal(button.querySelector('svg').dataset.iconStyle, 'color');
    assert.equal(button.dataset.adminView, 'staff');
    assert.match(button.textContent, /স্টাফ/);
    button.click();
    assert.equal(clicks, 1);
    paintIcon(document.querySelector('.nav-chip'), 'students', 'nav-icon');
    assert.equal(document.querySelector('.nav-chip svg').dataset.iconStyle, 'glyph');
    assert.equal(iconElement('wallet').namespaceURI, 'http://www.w3.org/2000/svg');
  } finally { globalThis.document = previous; window.close(); }
});

test('illustration paint tokens exist centrally for light and AMOLED', () => {
  const source = read('css/foundation.css');
  const root = new Map([...source.split(':root{')[1].split('\n}')[0].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2]]));
  const dark = new Map([...source.split('html[data-theme=dark]{')[1].split('\n}')[0].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2]]));
  for (const artwork of Object.values(ILLUSTRATIONS)) {
    for (const [, name] of artwork.matchAll(/var\((--icon-[\w-]+)/g)) {
      assert.ok(root.has(name), 'undefined light token ' + name);
      assert.ok(dark.has(name), 'missing AMOLED token ' + name);
    }
    assert.doesNotMatch(artwork, /#[\da-f]{3,8}\b|rgba?\(/i, 'palette may not be baked into artwork');
  }
});

test('the new icon dependency ships in the bumped offline release', () => {
  const sw = read('sw.js');
  assert.match(sw, /CACHE_VERSION = 157/);
  assert.ok(sw.includes("'./js/icon-set.js'"));
  assert.ok(existsSync(new URL('../js/icon-set.js', import.meta.url)));
  assert.match(read('js/icons.js'), /from '\.\/icon-set\.js'/);
  for (const page of ['index','admin','manager','teacher','payment','offline-roles']) {
    assert.match(read(page + '.html'), /css\/design-system\.css\?v=157/);
  }
  for (const file of ['js/icons.js','js/icon-set.js']) {
    assert.doesNotMatch(read(file), /localStorage|indexedDB|fetch\s*\(|XMLHttpRequest|firebase|https?:\/\//i);
  }
});
