/* Owner report 2026-11-08: the flash skin that appears on login, logout and
   refresh did not fit the screen — on a tablet/desktop the launch screen drew as
   a narrow 430px white column with the shell visible on both sides.

   The screen is a full-screen hand-off: it must cover the whole viewport at every
   width, keep the logo and tagline centred, sit above the shell, stay theme-aware
   and never survive the app's own entry hand-off. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const walletCss = readFileSync(new URL('../css/ui-wallet.css', import.meta.url), 'utf8');
const authCss = readFileSync(new URL('../css/ui-auth.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('../js/launch-screen.js', import.meta.url), 'utf8');
const pages = ['index.html', 'student.html', 'admin.html', 'teacher.html', 'manager.html', 'payment.html'];

const contexts = [];
after(() => contexts.forEach(ctx => ctx.window.close()));

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'u'));
  assert.ok(match, `${selector} is declared`);
  return match[1];
}

test('the launch screen covers the full viewport at every width', () => {
  // Base rule: fixed, edge to edge, above the shell.
  const base = rule(authCss, '.launch-screen');
  assert.match(base, /position:\s*fixed/u);
  assert.match(base, /inset:\s*0/u);
  assert.match(base, /z-index:\s*2000/u);
  for (const side of ['align-items:\s*center', 'justify-content:\s*center']) {
    assert.match(base, new RegExp(side, 'u'), 'logo and tagline stay optically centred');
  }

  // The wide-screen panel column must not apply to the launch/boot screens any more.
  const wide = walletCss.slice(walletCss.indexOf('@media screen and (min-width: 431px)'));
  assert.ok(wide.length > 0, 'the wide-screen block exists');
  const wideBlock = wide.slice(0, wide.indexOf('@media ', 10) === -1 ? wide.length : wide.indexOf('@media ', 10));
  const launchRule = wideBlock.match(/\.launch-screen,\s*\.manager-boot-screen\s*\{([^}]*)\}/u);
  assert.ok(launchRule, 'the launch and boot screens have their own wide-screen rule');
  assert.match(launchRule[1], /left:\s*0/u, 'no centred column offset');
  assert.match(launchRule[1], /width:\s*auto/u, 'the screen is allowed to fill the window');
  assert.doesNotMatch(launchRule[1], /max-width:\s*430px/u, 'the 430px panel cap is gone');
  assert.match(wideBlock, /\.launch-screen,\s*\.manager-boot-screen\s*\{\s*inset:\s*0;\s*\}/u,
    'the block axis is pinned to both edges too');

  // The auth form keeps its readable measure — only the flash screens changed.
  const authRule = wideBlock.match(/\.auth-screen\s*\{([^}]*)\}/u);
  assert.ok(authRule, 'the auth screen still owns a wide-screen rule');
  assert.match(authRule[1], /max-width:\s*430px/u, 'the login card stays a readable column');
});

test('the launch screen is theme-aware, motion-safe and expires on its own', () => {
  assert.match(walletCss, /\.launch-screen\s*\{\s*background:\s*var\(--color-surface\)/u, 'light/dark both come from the theme');
  assert.match(authCss, /@keyframes launch-safety\s*\{\s*to\s*\{\s*visibility:\s*hidden/u,
    'a stuck screen hides itself even if the app never dismisses it');
  assert.match(authCss, /prefers-reduced-motion[^}]*\.launch-screen\{animation:launch-safety/u,
    'reduced-motion users get the same expiry');
  assert.match(source, /timer = setTimeout\(dismiss, 2800\)/u, 'the script has its own hard deadline');
  assert.match(source, /document\.addEventListener\('keydown', dismiss/u, 'a keyboard user can skip it');
});

test('every portal loads the launch screen and hands off to the shell', () => {
  for (const page of pages) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(html, /js\/launch-screen\.js\?v=\d+/u, `${page} mounts the launch screen`);
    const dom = new JSDOM(html, { url: `http://localhost/${page}`, runScripts: 'outside-only' });
    contexts.push({ window: dom.window });
    // Boot order: the appearance module paints the theme before the screen, and
    // the entry module never has to wait for it (it only clears it on failure).
    const order = [...html.matchAll(/<script src="(js\/(?:appearance-boot|launch-screen|app-entry)\.js)[^"]*"/gu)].map(m => m[1]);
    if (order.includes('js/appearance-boot.js') || order.includes('js/app-entry.js')) {
      const iAppearance = order.indexOf('js/appearance-boot.js');
      const iLaunch = order.indexOf('js/launch-screen.js');
      if (iAppearance >= 0) assert.ok(iAppearance < iLaunch, `${page} paints the theme before the flash screen`);

    }
  }
});

test('the app entry removes the launch screen so it cannot linger over the shell', () => {
  const entry = readFileSync(new URL('../js/app-entry.js', import.meta.url), 'utf8');
  assert.match(entry, /querySelector\('\.launch-screen'\)\?\.remove\(\)/u,
    'app-entry owns the hand-off dismissal');
});
