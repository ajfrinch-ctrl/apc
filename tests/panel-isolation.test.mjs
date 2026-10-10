/* Panel isolation — no panel ships a shortcut into another portal.
 *
 * Each role owns exactly one door: the Admin panel must not link to the
 * Manager, Teacher, Payment or offline-role portals, and the same is true the
 * other way round. A cross-panel entry would also be a permission hole: the
 * Admin role does not hold `payment.panel` / `teaching.panel`, so the markup is
 * removed at boot — but shipping it at all would paint the shortcut for a
 * moment and leak the other portal's existence, so it must not exist.
 *
 * Checked on the shipped markup of every page (not the booted DOM), which is
 * stricter than the runtime check in tests/admin-panel-shell.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';

const PANELS = Object.freeze(['admin.html', 'manager.html', 'teacher.html', 'payment.html', 'offline-roles.html']);
const PAGES = Object.freeze(['index.html', ...PANELS]);
const LINK_CLASSES = Object.freeze(['pay-panel-link', 'teacher-panel-link', 'manager-panel-link', 'admin-panel-link', 'portal-link']);
const CROSS_PANEL_CAPS = Object.freeze(['payment.panel', 'teaching.panel', 'manager.panel']);

const documentOf = file => new JSDOM(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).window.document;

test('no page links to another portal', () => {
  for (const file of PAGES) {
    const document = documentOf(file);
    for (const anchor of document.querySelectorAll('a[href]')) {
      const href = String(anchor.getAttribute('href') || '').split('?')[0].split('#')[0];
      if (!href || /^(https?:|mailto:|tel:|data:|#)/.test(href)) continue;
      const target = href.split('/').pop();
      const other = PANELS.includes(target) && target !== file;
      assert.equal(other, false, `${file}: the page links to another portal (${href})`);
      assert.equal(/(^|\/)index\.html$/.test(href), false, `${file}: a portal may not link back to the login page from its UI`);
    }
  }
});

test('no cross-panel shortcut class or capability gate is left anywhere', () => {
  for (const file of PAGES) {
    const document = documentOf(file);
    for (const name of LINK_CLASSES) {
      assert.equal(document.querySelector(`.${name}`), null, `${file}: .${name} is still shipped`);
    }
    for (const capability of CROSS_PANEL_CAPS) {
      assert.equal(document.querySelector(`[data-admin-cap="${capability}"]`), null,
        `${file}: an element is gated on ${capability} (a cross-panel entry)`);
    }
  }
});

test('generated markup never builds a link to another portal either', () => {
  const jsDir = new URL('../js/', import.meta.url);
  for (const name of readdirSync(jsDir).filter(entry => entry.endsWith('.js'))) {
    const source = readFileSync(new URL(name, jsDir), 'utf8');
    for (const panel of PANELS) {
      const builtLink = new RegExp(`href=["'\`][^"'\`]*${panel.replace('.', '\\.')}`);
      assert.equal(builtLink.test(source), false, `js/${name}: builds a link to ${panel}`);
      // A plain path constant is fine (login routing needs it); a link is not.
      const anchorFor = new RegExp(`<a[^>]*${panel.replace('.', '\\.')}`);
      assert.equal(anchorFor.test(source), false, `js/${name}: renders an anchor to ${panel}`);
    }
  }
});

/* ---------- Panel lockdown: the same rule for the code, not just the markup --- */

const LOCK_PANELS = Object.freeze(['admin.html', 'manager.html', 'teacher.html', 'payment.html']);
/* Who may name a panel page inside a navigation call:
     • no file may navigate into a *different* panel,
     • js/login.js is the shared door (it routes a signed-in role to its own
       page) and is the only file allowed to name all four,
     • each panel's own scripts may name their own page. */
const NAV_OWNER = Object.freeze({
  'js/login.js': '*',
  'js/admin.js': 'admin.html',
  'js/manager.js': 'manager.html',
  'js/teacher.js': 'teacher.html',
  'js/payment.js': 'payment.html',
  'js/payment-auth.js': 'payment.html'
});
const NAV_CALL = /location\.(?:assign|replace)\s*\(|location\.href\s*=|window\.open\s*\(|openWindow\s*\(/;

test('no script navigates into another panel', () => {
  const jsDir = new URL('../js/', import.meta.url);
  const files = [
    ...readdirSync(jsDir).filter(name => name.endsWith('.js')).map(name => ['js/' + name, readFileSync(new URL(name, jsDir), 'utf8')]),
    ...PAGES.map(file => [file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')]),
    ['sw.js', readFileSync(new URL('../sw.js', import.meta.url), 'utf8')],
    ['firebase-messaging-sw.js', readFileSync(new URL('../firebase-messaging-sw.js', import.meta.url), 'utf8')],
    ['functions/notification-payload.js', readFileSync(new URL('../functions/notification-payload.js', import.meta.url), 'utf8')]
  ];
  for (const [name, source] of files) {
    const allowed = NAV_OWNER[name] || '';
    for (const line of source.split('\n')) {
      if (!NAV_CALL.test(line)) continue;
      for (const panel of LOCK_PANELS) {
        if (!line.includes(panel)) continue;
        assert.equal(allowed === '*' || allowed === panel, true,
          `${name}: ${panel} appears in a navigation call (${line.trim().slice(0, 90)})`);
        assert.equal(allowed === '*', false, `${name}: this file must not route between panels`);
      }
    }
  }
  // The one door really is the shared login page and nothing else.
  const lockdown = readFileSync(new URL('../js/panel-lockdown.js', import.meta.url), 'utf8');
  assert.match(lockdown, /export const LOGIN_PAGE = 'index\.html';/);
  assert.match(lockdown, /location\.assign\(LOGIN_PAGE\)/);
  assert.equal(/location\.(?:assign|replace)\s*\(\s*['"`]\.?\/?(?:admin|manager|teacher|payment)\.html/.test(lockdown), false);
});

test('offline and push fallbacks never open another panel', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  // The old fallback handed any offline navigation the student page.
  assert.equal(/match\(\s*'\.\/index\.html'\s*\)/.test(sw), false, 'sw.js still falls back to index.html');
  assert.match(sw, /const OFFLINE_DOCUMENT = `/, 'an offline navigation is answered with a card of its own');
  assert.match(sw, /const PANEL_HINT_CACHE = 'apc-panel-hint';/);
  assert.match(sw, /async function panelHintTarget\(\)/, 'a tapped notification opens this device\'s own panel');
  assert.match(sw, /const target = \(await panelHintTarget\(\)\) \|\| APP_ENTRY;/);

  const messaging = readFileSync(new URL('../firebase-messaging-sw.js', import.meta.url), 'utf8');
  assert.match(messaging, /const PANEL_HINT_CACHE = 'apc-panel-hint';/);
  assert.equal(/data\?\.url\s*\|\|/.test(messaging), false, 'a payload may not choose the page');
  assert.equal(/\|\| '\.\/index\.html'/.test(messaging), false, 'no hard-coded door default');

  const sender = readFileSync(new URL('../functions/notification-payload.js', import.meta.url), 'utf8');
  assert.equal(/index\.html/.test(sender), false, 'the sender no longer ships a page link');
  assert.equal(/fcmOptions\s*:/.test(sender), false, 'no fcmOptions.link at all');

  const rules = readFileSync(new URL('../js/notification-rules.js', import.meta.url), 'utf8');
  const payload = rules.slice(rules.indexOf('export function pushPayload'), rules.indexOf('export function pushTokenRecord'));
  assert.equal(/url:/.test(payload), false, 'the client push payload carries no page either');
  assert.equal(/index\.html/.test(payload), false);
});

test('every panel installs the lockdown guard and remembers its own page', () => {
  const entries = Object.freeze({
    'admin.html': ['js/admin.js', 'admin'],
    'manager.html': ['js/manager.js', 'manager'],
    'teacher.html': ['js/teacher.js', 'teacher'],
    'payment.html': ['js/payment.js', 'payment']
  });
  for (const [page, [script, role]] of Object.entries(entries)) {
    const document = documentOf(page);
    const sources = document.querySelectorAll('script[src]');
    const srcs = [...sources].map(node => String(node.getAttribute('src')));
    for (const other of LOCK_PANELS) {
      if (other === page) continue;
      const otherScript = entries[other][0].replace('js/', '');
      assert.equal(srcs.some(src => src.includes(otherScript)), false, `${page}: loads ${other}'s script`);
    }
    const source = readFileSync(new URL(`../${script}`, import.meta.url), 'utf8');
    assert.match(source, /import \{ installPanelGuard, lockPanel, rememberPanelPage, watchOwnPanelSession \} from '\.\/panel-lockdown\.js';/,
      `${script}: must use the shared lockdown module`);
    assert.match(source, /installPanelGuard\(\);/, `${script}: installs the runtime guard`);
    assert.match(source, /void rememberPanelPage\(\);/, `${script}: leaves the panel hint for a tapped push`);
    assert.match(source, new RegExp(`watchOwnPanelSession\\('${role}'\\)`), `${script}: locks itself when its session ends`);
    assert.match(source, /lockPanel\(\{ role: '/, `${script}: locks in place instead of navigating away`);
  }
  // The Admin boot fallback hands over only on a tap, never on a timer.
  const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
  assert.equal(/window\.location\.replace\(/.test(admin), false, 'the boot fallback must not jump anywhere');
  assert.match(admin, /apcPanelBootLogin/);
  assert.match(admin, /apcPanelBootRetry/);
});
