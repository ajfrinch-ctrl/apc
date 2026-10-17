/* §30 glass interior guard — the transparent/glass redesign of the student
   panel (owner brief 2026-10-14) is a presentation-only layer:
     • every rule scoped to the student page (.app-shell / .bottom-nav /
       the four student modals) — a staff portal can never inherit it,
     • glass colours are color-mix() of the shared tokens (no raw hex, so
       light/dark/AMOLED keep their contrast),
     • blur has a solid fallback and motion respects reduced-motion,
     • nothing is hidden, moved or resized away (no display/visibility/
       position tricks), and the §29 login layer is untouched. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/ui-wallet.css', import.meta.url), 'utf8');
const start = css.indexOf('§30');
assert.ok(start > 0, 'the §30 glass section exists');
/* Keep this guard scoped to the actual glass/motion layer. Later, separately
   scoped panel layout rules live in the same stylesheet and have their own
   role-specific guards; including them here was a source of false failures. */
const sectionEnd = css.indexOf('/* Reference student home:', start);
assert.ok(sectionEnd > start, 'the shared glass layer has a clear boundary');
const glass = css.slice(start, sectionEnd);

test('glass tokens derive from the shared palette, never raw paint', () => {
  const foundation = readFileSync(new URL('../css/foundation.css', import.meta.url), 'utf8');
  assert.match(foundation, /--glass-bg:color-mix\(in srgb, var\(--color-surface\) 58%, transparent\)/,
    'the glass tokens live in the one palette file');
  assert.match(foundation, /--glass-accent:var\(--color-success\)/, 'the brand green #0e7a55 stays the accent');
  assert.match(foundation, /--glass-radius:20px/, 'cards round at 20px, inside the 16–24px brief');
  assert.match(foundation, /--glass-blur:18px/, 'frosted blur stays inside the 16–24px brief');
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(glass), false, 'no raw hex colours in the glass layer');
});

test('every glass rule is scoped to the student page or its modals', () => {
  const uncommented = glass.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleHeads = [...uncommented.matchAll(/(^|\n)([^\n{}@][^{]*)\{/g)].map(match => match[2].trim());
  for (const head of ruleHeads) {
    if (head.startsWith('from') || head.startsWith('to') || head.includes('%')) continue; // keyframes
    if (head === ':root' || head.includes(';')) continue; // token definitions / declarations
    assert.ok(/app-shell|bottom-nav|bottom-link|studentServices|moreServices|apcNoticeModal|noticeModal|noticeListStudent|logoutModal|editModal|resourceModal|apc-skeleton|data-theme="dark"/.test(head),
      `unscoped glass rule: ${head.slice(0, 80)}`);
  }
  assert.equal(glass.includes('.admin-shell'), false, 'admin styles out of scope');
  assert.equal(glass.includes('.auth-screen'), false, 'the login page keeps its §29 design untouched');
});

test('glass never hides, moves or shrinks a feature', () => {
  assert.equal(/display\s*:\s*none/.test(glass.replace(/prefers-reduced-motion[\s\S]*$/, '')), false,
    'only the reduced-motion block may neutralise animation, never layout');
  assert.equal(/visibility\s*:/.test(glass), false);
  assert.equal(/position\s*:\s*(absolute|fixed)/.test(glass), false, 'glass restyles in place');
  assert.match(glass, /\.bottom-link \{ min-height: 56px/, 'bottom tabs stay big touch targets');
});

test('frosting has a solid fallback and motion can be switched off', () => {
  assert.match(glass, /@supports not \(\(backdrop-filter: blur\(1px\)\)/, 'no-blur browsers get solid cards');
  assert.match(glass, /--glass-bg: var\(--color-surface\);/, 'the fallback is the solid surface token');
  assert.match(glass, /@media \(prefers-reduced-motion: reduce\)/, 'reduced motion is honoured');
  const reduced = glass.slice(glass.indexOf('prefers-reduced-motion'));
  assert.match(reduced, /animation: none !important/);
  assert.match(reduced, /transition: none !important/);
});

test('the calm motion library and glass surfaces are all present', () => {
  for (const name of ['apc-float', 'apc-bell-swing', 'apc-tab-spring', 'apc-view-in', 'apc-sheet-up', 'apc-shimmer', 'apc-pulse-dot', 'apc-pop', 'apc-twinkle', 'apc-book-sway', 'apc-tap-bounce']) {
    assert.match(glass, new RegExp(`@keyframes ${name} `), `${name} is defined`);
  }
  assert.match(glass, /\.app-shell \.pay-tile \{[^}]*backdrop-filter: blur\(var\(--glass-blur\)\)/s, 'tiles are frosted glass');
  assert.match(glass, /#editModal:not\(\[hidden\]\) \.modal[^{]*\{[^}]*animation: apc-sheet-up/s, 'student edit/resource modals rise as bottom sheets');
  // The brand row now carries the forest-green palette in Student as well as
  // staff panels; white text and soft action chips keep the identity readable.
  assert.match(glass, /\.app-shell \.app-topbar \{[^}]*background: var\(--pay-hero-a\); color: var\(--pay-on-hero\)/s,
    'the brand bar uses the shared green surface');
  assert.match(glass, /\.app-shell \.app-brand-institute \{[^}]*color: var\(--pay-on-hero\)/s,
    'brand text stays readable on the green bar');
  assert.match(glass, /\.app-shell \[aria-busy="true"\] \{[^}]*animation: apc-shimmer/s, 'busy surfaces shimmer like a skeleton');
  assert.match(glass, /\[data-theme="dark"\] \.app-shell \{/, 'AMOLED keeps the same glass language');
});

test('living icons: book sway, tap bounce and the ring that fills slowly', () => {
  assert.match(glass, /@keyframes apc-book-sway \{/, 'the book opens and closes');
  assert.match(glass, /\.bottom-link\[data-view="courses"\] svg,\s*#coursesView \.pay-tile-icon svg\[data-icon="book"\] \{\s*animation: apc-book-sway 3\.8s/s,
    'book motion is slow (2–4s) and pinned to the study seats');
  assert.match(glass, /:is\(button, a, \[role="button"\]\):active svg \{\s*animation: apc-tap-bounce/s,
    'a tap bounces the icon that was pressed');
  assert.match(glass, /@property --progress \{ syntax: '<angle>'/, 'the ring angle is a real animatable property');
  assert.match(glass, /#studyProgressRing \{ transition: --progress 1\.1s/, 'the progress ring fills slowly, never jumps');
  // One stroke voice: the line-icon system draws at 1.75 everywhere.
  const foundation = readFileSync(new URL('../css/foundation.css', import.meta.url), 'utf8');
  assert.match(foundation, /svg\{width:22px;height:22px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1\.75/,
    'every line icon shares the same stroke weight');
});

test('the action center uses the same shared glass accent and a safe-height sheet', () => {
  const sheetStart = css.indexOf('/* Action centre:');
  assert.ok(sheetStart > start, 'the action-center visual layer exists');
  const sheet = css.slice(sheetStart, css.indexOf('/* Logout confirmation:', sheetStart));
  assert.match(sheet, /:is\(#noticeModal, #apcNoticeModal\):not\(\[hidden\]\) \.modal \{[^}]*max-height: min\(92dvh, 720px\)/s,
    'the sheet is capped so its header can never slide off-screen');
  assert.match(sheet, /\.notice-filters \.chip\.active \{[^}]*background: var\(--glass-accent\)/s,
    'the active filter seat is brand green');
  assert.equal(/\.notice-filters \.chip\.active \{[^}]*--pay-hero-a/s.test(sheet), false,
    'the old navy pill must not return');
  assert.match(sheet, /\.notice-detail\.unread:not\(\.is-birthday\)/, 'birthday gold keeps its own colours');
  assert.match(sheet, /\.notice-action \{[^}]*linear-gradient\(135deg, var\(--glass-accent\)/s,
    'the card CTA is the calm brand gradient');
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(sheet), false, 'no raw paint in the action center either');
});

test('the login layer beneath is untouched', () => {
  const loginSection = css.indexOf('/* 29 ');
  assert.ok(loginSection > 0 && loginSection < start, 'the §29 login layer still ships before §30');
  assert.match(css.slice(loginSection, start), /\.auth-screen \.auth-submit \{ min-height: 54px/, '§29 rules are intact');
});
