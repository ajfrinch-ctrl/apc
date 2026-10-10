/* The v167 sync-indicator gallery (preview/sync-indicator-167/) is part of the
   change set: it documents the indicator with real screenshots and a live demo.

   Two things must stay true, or the gallery becomes a pretty lie:
     1. it loads the app's OWN stylesheet, script, markup and status module —
        never a copy, so it can never show a colour the app does not paint;
     2. every colour it quotes is computed from css/foundation.css here, and
        every screenshot it references exists at the captured size.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = path => existsSync(new URL(`../${path}`, import.meta.url));
const GALLERY = 'preview/sync-indicator-167/';
/* preview/ is untracked (design snapshots are too heavy for the repository),
   so a fresh clone has no gallery: the assertions then skip instead of
   crashing the suite. Where preview/ exists they run in full. */
const PRESENT = existsSync(new URL(`../${GALLERY}index.html`, import.meta.url));
const gallery = PRESENT ? read(GALLERY + 'index.html') : '';
const only = PRESENT ? test : test.skip;
/** Resolve a gallery reference the way the browser does, from the gallery dir. */
const resolve = ref => ref.startsWith('../../') ? ref.slice(6) : `${GALLERY}${ref}`;

only('the gallery loads the real app files and never a private copy', () => {
  assert.match(gallery, /href="\.\.\/\.\.\/css\/design-system\.css"/, 'the app stylesheet');
  assert.match(gallery, /src="\.\.\/\.\.\/js\/topbar-connectivity\.js"/, 'the real indicator script');
  assert.match(gallery, /import\('\.\.\/\.\.\/js\/sync-status\.js'\)/, 'the real status module drives the demo');
  assert.match(gallery, /fetch\('\.\.\/\.\.\/index\.html'\)/, 'the demo bar is taken from the app markup');
  assert.match(gallery, /parseFromString\(html, 'text\/html'\)[\s\S]{0,200}querySelector\('\.app-topbar'\)/,
    'the demo must reuse the shipped topbar markup');
  // A copy would be a second source of truth: no inlined topbar / palette here.
  assert.doesNotMatch(gallery, /<header class="app-topbar"/, 'the bar must be fetched, not pasted');
  assert.doesNotMatch(gallery, /--tone-mint|--color-danger\s*:/, 'the gallery must not redefine palette tokens');
});

only('every colour the gallery quotes is computed from the palette it documents', () => {
  const foundation = read('css/foundation.css');
  const block = selector => {
    const start = foundation.indexOf(selector);
    assert.ok(start > -1, `css/foundation.css has no ${selector}`);
    return foundation.slice(start, foundation.indexOf('\n}', start));
  };
  const light = block(':root{'), dark = block('html[data-theme=dark]');
  const hex = value => {
    const clean = value.replace('#', '');
    return `rgb(${[0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16)).join(', ')})`;
  };
  const token = (source, name) => {
    const found = source.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})`, 'i'));
    assert.ok(found, `${name} is missing`);
    return found[1];
  };
  const quoted = [
    [light, '--color-text-muted'], [light, '--tone-mint'], [light, '--color-danger'],
    [dark, '--color-text-muted'], [dark, '--tone-mint'], [dark, '--color-danger']
  ];
  // Whitespace inside rgb() is cosmetic: compare the values, not the spacing.
  const compactGallery = gallery.replace(/\s+/g, '');
  for (const [source, name] of quoted) {
    const rgb = hex(token(source, name)).replace(/\s+/g, '');
    assert.ok(compactGallery.includes(rgb), `the gallery must quote ${name} as ${rgb}`);
  }
  // The stylesheet itself must still point every state at those tokens.
  const css = read('css/ui-status.css');
  for (const [state, name] of [['synced', '--tone-mint'], ['syncing', '--tone-amber'], ['error', '--color-danger'], ['idle', '--color-text-muted']]) {
    assert.match(css, new RegExp(`data-sync-visual="${state}"[^}]*border-top-color:var\\(${name}\\)`),
      `${state} must use ${name}`);
  }
});

only('every referenced screenshot exists at the captured size (2x the 63px bar)', () => {
  const refs = [...new Set([...gallery.matchAll(/src="([^"?#]+)"/g)].map(match => match[1]))];
  const screenshots = refs.filter(ref => ref.endsWith('.png'));
  assert.ok(screenshots.length >= 11, `the gallery references ${screenshots.length} screenshots`);
  for (const ref of refs) {
    assert.ok(exists(resolve(ref)), `missing gallery asset: ${ref}`);
  }
  for (const ref of screenshots.filter(name => /state-|panel-/.test(name))) {
    const bytes = readFileSync(new URL(`../${GALLERY}${ref}`, import.meta.url));
    assert.equal(bytes.readUInt32BE(16), 840, `${ref} is not the 2x capture width`);
    const height = bytes.readUInt32BE(20);
    if (ref.startsWith('state-') || ref.startsWith('panel-')) {
      assert.equal(height, 126, `${ref} must be the 63px bar at 2x (got ${height})`);
    }
    assert.ok(statSync(new URL(`../${GALLERY}${ref}`, import.meta.url)).size > 5000, `${ref} looks empty`);
  }
});
