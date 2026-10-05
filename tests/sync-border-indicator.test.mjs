/* The sync indicator is the topbar's own top border — colour only.

   The school's rule: no chip, label, toast or standing message may say how sync
   is doing, and the last verdict must stay readable after the transfer ends.
   js/topbar-connectivity.js owns the single <html data-sync-visual> verdict;
   css/ui-status.css turns it into the bar's top border colour. Presentation
   only: no sync, transport, auth or storage API may appear in either file. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const BARS = '.app-topbar, .auth-topbar, .admin-topbar, .topbar, .teacher-topbar, .manager-topbar, .pay-topbar, header[class*="topbar"]';
const PAGES = ['index', 'admin', 'manager', 'teacher', 'payment'];

function boot({ online = true } = {}) {
  const dom = new JSDOM('<header class="app-topbar"><div class="app-topbar-inner"><div class="app-brand">Active Plus Coaching</div></div></header>',
    { runScripts: 'outside-only' });
  const { window: w } = dom;
  let up = online;
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => up });
  w.eval(read('js/topbar-connectivity.js'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { dom, w, setOnline: value => { up = value; } };
}

// MutationObserver is a microtask; one macrotask turn lets it deliver.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('the top border colour follows the sync state; the bar never carries sync text', async () => {
  const { dom, w, setOnline } = boot();
  const root = w.document.documentElement;
  const bar = w.document.querySelector('.app-topbar');
  const verdict = () => root.dataset.syncVisual;
  const green = async () => {
    root.dataset.realtimeSync = 'online';
    root.dataset.firebaseLastSync = '2026-10-05T00:00:00.000Z';
    await settle();
    assert.equal(verdict(), 'synced');
  };

  assert.equal(verdict(), 'idle', 'a device with no verdict yet must stay neutral');
  root.dataset.realtimeSync = 'connecting'; await settle();
  assert.equal(verdict(), 'syncing');
  root.dataset.realtimeSync = 'pending'; await settle();
  assert.equal(verdict(), 'syncing', 'pending work keeps the amber state');
  // "online" alone is not a finished sync: green needs a confirmed transfer.
  root.dataset.realtimeSync = 'online'; await settle();
  assert.equal(verdict(), 'syncing');
  await green();
  // The green line must stay after the transfer ends — that is the whole point.
  await settle(); await settle();
  assert.equal(verdict(), 'synced', 'the last successful sync stays readable');

  for (const state of ['error', 'offline', 'conflict', 'storage']) {
    root.dataset.realtimeSync = state; await settle();
    assert.equal(verdict(), 'error', `${state} is a sync problem`);
    root.dataset.firebaseLastSync = '';
    await green();
  }
  root.dataset.realtimeSync = 'paused'; await settle();
  assert.equal(verdict(), 'idle', 'sync paused or never started is neutral, never red');
  setOnline(false);
  w.dispatchEvent(new w.Event('offline')); await settle();
  assert.equal(verdict(), 'error', 'offline is red whatever the last state said');

  assert.equal(w.document.querySelector('.topbar-sync-chip, #cloudSyncStatus'), null,
    'no chip or standing banner may be painted');
  assert.equal(bar.querySelectorAll('button, [role="status"]').length, 0, 'the bar stays logo + controls only');
  assert.doesNotMatch(bar.textContent, /সিঙ্ক|Sync|Syncing|Offline/i, 'the bar must not carry a sync label');
  dom.window.close();
});

test('the state is still announced to screen readers, never shown', async () => {
  const { dom, w } = boot();
  w.document.documentElement.dataset.realtimeSync = 'connecting';
  await settle();
  const live = w.document.getElementById('apcSyncAnnounce');
  assert.ok(live, 'the colour needs a screen-reader twin');
  assert.equal(live.getAttribute('role'), 'status');
  assert.equal(live.getAttribute('aria-live'), 'polite');
  assert.match(live.textContent, /সিঙ্ক/);
  assert.equal(w.document.querySelector(BARS).contains(live), false, 'the live region must stay outside the bar');
  assert.match(read('css/ui-status.css'), /\.apc-sync-announce\{[^}]*clip-path:inset\(50%\)/,
    'the twin is visually hidden, so it is never a visible label');
  dom.window.close();
});

test('the indicator stylesheet owns every state, and no chip or banner is left anywhere', () => {
  const css = read('css/ui-status.css');
  for (const state of ['synced', 'syncing', 'error', 'idle']) {
    assert.match(css, new RegExp(`html\\[data-sync-visual="${state}"\\]`), `the ${state} colour is missing`);
  }
  // One thin line, always the same width/style: only colour may change.
  assert.match(css, /border-top:3px solid/, 'the bar keeps one thin, constant top line');
  assert.match(css, /@keyframes apc-sync-working/, 'the syncing state keeps its subtle breath');
  assert.doesNotMatch(css, /border-top-(width|style)\s*:/, 'the line must not change size between states');
  assert.doesNotMatch(css, /gradient\(|backdrop-filter/, 'the structural sheets stay flat');

  for (const file of ['css/app-polish.css', 'css/ui-wallet.css', 'css/ui-status.css', 'js/topbar-connectivity.js']) {
    assert.doesNotMatch(read(file), /topbar-sync-chip/, `${file} still ships the sync chip`);
  }
  assert.doesNotMatch(read('js/realtime-sync-entry.js'), /cloudSyncStatus/, 'the standing sync banner is gone for good');
  for (const page of PAGES) {
    assert.doesNotMatch(read(`${page}.html`), /topbar-sync-chip|cloudSyncStatus/, `${page}.html carries sync-status markup`);
  }

  // Presentation only: the verdict comes from the sync layer's own attributes.
  const js = read('js/topbar-connectivity.js');
  assert.match(js, /realtimeSync/);
  assert.match(js, /firebaseLastSync/);
  assert.doesNotMatch(js, /localStorage|indexedDB|fetch\s*\(|XMLHttpRequest|\bimport\b/,
    'the indicator must not touch data, transport or modules');
});

test('no other stylesheet fights the sync line', () => {
  const imports = [...read('css/design-system.css').matchAll(/@import\s+url\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)].map(m => m[1]);
  assert.ok(imports.includes('ui-status.css'), 'the indicator stylesheet must stay loaded');
  for (const file of imports.filter(name => name !== 'ui-status.css')) {
    for (const [, selector, body] of read(`css/${file}`).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/topbar/.test(selector)) {
        assert.doesNotMatch(body, /border-top/, `${file}: "${selector.trim()}" must not restyle the sync line`);
      }
    }
  }
});

test('every colour the indicator uses exists in the palette, in both themes', () => {
  const css = read('css/ui-status.css');
  const indicator = css.slice(css.indexOf('/* ── Sync indicator'));
  const used = [...new Set([...indicator.matchAll(/var\((--[\w-]+)\)/g)].map(match => match[1]))];
  assert.ok(used.length >= 4, 'the indicator must be token-driven, not hard-coded');
  // A colour name that the palette does not declare would silently fall back to
  // currentColor — the typo this guards against.
  const foundation = read('css/foundation.css');
  const declared = selector => {
    const start = foundation.indexOf(selector + '{');
    assert.ok(start > -1, `css/foundation.css has no ${selector} block`);
    const block = foundation.slice(start, foundation.indexOf('\n}', start));
    return new Set([...block.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  };
  const light = declared(':root');
  const dark = declared('html[data-theme=dark]');
  for (const name of used) {
    assert.ok(light.has(name), `${name} is not in the light palette`);
    assert.ok(dark.has(name), `${name} is not in the AMOLED palette`);
  }
  assert.doesNotMatch(indicator, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'the indicator must not hard-code a colour');
});
