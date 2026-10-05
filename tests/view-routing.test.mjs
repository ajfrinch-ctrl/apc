/* Student views are deep links (#routine, #courses, …): setView keeps the URL
   hash in step, user navigation pushes history so Back walks the visited
   views, and tap-to-copy chips copy the live ID — all on the real index.html
   (jsdom, no browser download needed). */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';

const DEMO_OFF = { 'activePlus.demo.autofill.v1': 'off' };
let ctx;
let setView;
let viewRouteFromHash;
let initCopyChips;

before(async () => {
  ctx = await loadPage('index.html', { seed: DEMO_OFF });
  ({ setView, viewRouteFromHash } = await import('../js/shell.js'));
  ({ initCopyChips } = await import('../js/copy.js'));
  initCopyChips();
});

test('every hash route maps to a student view and junk hashes fall back to home', () => {
  assert.equal(viewRouteFromHash('#routine'), 'routine');
  assert.equal(viewRouteFromHash('#profile'), 'profile');
  assert.equal(viewRouteFromHash('#notice-board'), 'notice-board');
  assert.equal(viewRouteFromHash(''), 'home');
  assert.equal(viewRouteFromHash('#unknown-page'), 'home');
  assert.equal(viewRouteFromHash('#home'), 'home');
});

test('the Notice Board has its own deep link while Home stays selected in the bottom bar', () => {
  setView('notice-board', { history: 'replace' });
  assert.equal(ctx.window.location.hash, '#notice-board');
  assert.equal(ctx.$('#notice-boardView').classList.contains('active'), true);
  assert.equal(ctx.$('.bottom-link[data-view="home"]').classList.contains('active'), true);
  assert.equal(ctx.$('.bottom-link[data-view="routine"]').classList.contains('active'), false);
  setView('home', { history: 'replace' });
});

test('setView syncs the hash route and pushes history so Back walks the views', () => {
  const { window } = ctx;
  const start = window.location.pathname + window.location.search;
  assert.equal(window.location.hash, '');

  setView('routine', { history: 'push' });
  assert.equal(window.location.hash, '#routine');
  assert.equal(ctx.$('#routineView').classList.contains('active'), true);

  setView('results', { history: 'push' });
  assert.equal(window.location.hash, '#results');

  // A repeated tap on the current view must not add a history entry.
  const depth = window.history.length;
  setView('results', { history: 'push' });
  assert.equal(window.history.length, depth);

  // Back goes to the previous view: popstate is answered with a keep-mode
  // switch so the URL and the panel stay in agreement without re-pushing.
  window.history.back();
  return new Promise(resolve => {
    window.addEventListener('popstate', () => {
      setView(viewRouteFromHash(), { history: 'keep' });
      assert.equal(window.location.hash, '#routine');
      assert.equal(ctx.$('#routineView').classList.contains('active'), true);
      // keep-mode never touches the URL.
      setView('home', { history: 'keep' });
      assert.equal(window.location.hash, '#routine');
      window.history.replaceState(null, '', start);
      resolve();
    }, { once: true });
  });
});

test('home normalises a leftover #home hash away', () => {
  const { window } = ctx;
  const start = window.location.pathname + window.location.search;
  window.history.replaceState(null, '', start + '#home');
  setView('home', { history: 'replace' });
  assert.equal(window.location.hash, '');
});

test('tapping an ID chip copies the live value and confirms with a toast', async () => {
  const { window, document } = ctx;
  let copied = null;
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async text => { copied = text; } }
  });

  document.getElementById('studentId').textContent = 'APC-2026-0007';
  ctx.click(document.querySelector('.profile-card [data-copy-target]'));
  await ctx.waitFor(() => copied !== null);
  assert.equal(copied, 'APC-2026-0007');
  assert.match(document.querySelector('.feedback-toast')?.textContent || '', /কপি হয়েছে/);
});

test('the placeholder dash chip never copies and Enter copies from the keyboard', async () => {
  const { window, document } = ctx;
  let copied = null;
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async text => { copied = text; } }
  });

  const chip = document.querySelector('.profile-card [data-copy-target]');
  document.getElementById('studentId').textContent = '—';
  ctx.click(chip);
  await ctx.flush();
  assert.equal(copied, null, 'an empty ID must not be copied');

  document.getElementById('studentId').textContent = 'APC-2026-0007';
  chip.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await ctx.waitFor(() => copied !== null);
  assert.equal(copied, 'APC-2026-0007');
});
