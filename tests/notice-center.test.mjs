/* The notification bell + inbox, and the one topbar every panel shares.
 *
 * Two things are verified here:
 *   1. every page ships the exact same topbar — brand, slogan, bell, sign-out —
 *      with nothing else in it, and
 *   2. the bell on any panel opens the inbox, shows what is unread, escapes the
 *      text it renders, and marks the list read in one receipt store.
 *
 * jsdom only; the tray/notification-permission parts need a browser and live in
 * the Playwright specs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';

const PAGES = Object.freeze([
  { file: 'index.html', name: 'শিক্ষার্থী অ্যাপ', exit: 'studentLogout', login: 'Active Plus Coaching' },
  { file: 'admin.html', name: 'এডমিন প্যানেল', exit: 'adminExitButton' },
  { file: 'manager.html', name: 'ম্যানেজার প্যানেল', exit: 'managerLogout' },
  { file: 'teacher.html', name: 'শিক্ষক প্যানেল', exit: 'teacherExit' },
  { file: 'payment.html', name: 'পেমেন্ট রিসিভ', exit: 'payExitButton' }
]);

const markup = file => new JSDOM(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).window.document;

/* Icons are inline SVG (js/icons.js; no sprite, no <use>): an icon must be
   present and drawable — it carries its own shapes. */
const drawable = svg => Boolean(svg && svg.querySelector('path, rect, circle, line, polyline, polygon'));

/** The bar a signed-in person sees: brand + slogan + bell + sign-out. */
function shellBar(document, exitId) {
  return [...document.querySelectorAll('.app-topbar')]
    .find(bar => bar.querySelector(`#${exitId}`));
}

/** Same markup everywhere, ignoring the two values that must differ per panel. */
function normalised(bar) {
  // No bar shows a panel name any more (logo + slogan only); the strip below
  // stays as a guard. ids, titles and data-actions differ per panel
  // by necessity (that is how the shell wires them) — everything else, order,
  // classes, icons, labels, must be byte-for-byte the same.
  return bar.outerHTML
    .replace(/<strong class="app-brand-name">[\s\S]*?<\/strong>/, '')
    .replace(/\s(?:id|title|data-action)="[^"]*"/g, '');
}

test('every panel ships the identical topbar: logo, slogan, bell, sign-out only', () => {
  const shapes = new Map();
  for (const page of PAGES) {
    const document = markup(page.file);
    const bars = document.querySelectorAll('.app-topbar');
    assert.ok(bars.length >= 1, `${page.file} has no topbar`);
    const bar = shellBar(document, page.exit);
    assert.ok(bar, `${page.file} has no signed-in topbar`);

    const brand = bar.querySelector('.app-brand');
    assert.ok(brand, `${page.file}: the brand is missing`);
    assert.equal(brand.querySelectorAll('img.app-brand-logo').length, 1, `${page.file}: the logo is missing`);
    assert.ok(brand.querySelector('[data-fixed-tagline]').textContent.trim().length > 1, `${page.file}: the slogan is missing`);

    if (page.login) {
      // The login screen has no topbar: its brand is the large logo card, with
      // no control in it — there is nobody to notify or sign out yet.
      const auth = document.getElementById('authScreen');
      assert.ok(auth, `${page.file}: the login screen is missing`);
      assert.equal(auth.querySelectorAll('.app-topbar').length, 0, `${page.file}: a topbar is back on the login screen`);
      const card = auth.querySelector('.auth-card .auth-brand');
      assert.ok(card, `${page.file}: the login brand card is missing`);
      assert.equal(card.querySelectorAll('img[src*="logo"]').length, 1, `${page.file}: the login logo is missing`);
      assert.equal(card.querySelector('h1')?.textContent.trim(), page.login, `${page.file}: the login brand name changed`);
      assert.ok(card.querySelector('p')?.textContent.trim().length > 1, `${page.file}: the login slogan is missing`);
      assert.equal(card.querySelectorAll('button, [data-theme-toggle], time').length, 0, 'the login brand carries a control');
      assert.equal(auth.querySelectorAll('#notificationButton, .app-topbar-exit').length, 0, 'bell or sign-out on the login screen');
    }
    {
      assert.equal(bars.length, 1, `${page.file} paints an unexpected number of topbars`);
      const actions = bar.querySelector('.app-topbar-actions');
      assert.ok(actions, `${page.file}: the action cluster is missing`);
      const bell = actions.querySelector('#notificationButton');
      assert.ok(bell, `${page.file}: the notification bell is missing`);
      assert.ok(drawable(bell.querySelector('svg[data-icon="bell"]')), `${page.file}: the bell has no icon`);
      assert.ok(bell.querySelector('.notification-dot'), `${page.file}: the bell has no unread dot`);
      const exit = actions.querySelector('.app-topbar-exit');
      assert.ok(exit, `${page.file}: sign-out is missing`);
      assert.equal(exit.id, page.exit, `${page.file}: sign-out changed id`);
      assert.ok(drawable(exit.querySelector('svg[data-icon="logout"]')), `${page.file}: sign-out has no icon`);
      assert.equal(actions.querySelectorAll('button').length, 2, `${page.file}: the topbar holds more than the bell and sign-out`);
      // Nothing else may sit in the bar — no theme switch, date, name chip or menu.
      assert.equal(bar.querySelectorAll('[data-theme-toggle], time, .student-date, .manager-top-actions, .topbar-chip').length, 0,
        `${page.file}: an extra control is back in the topbar`);
      assert.equal(bar.querySelectorAll('button').length, 2, `${page.file}: the topbar has an extra button`);
      // Dark mode still has a home on every panel: the same switch row the
      // student profile uses — sun/moon chip + the app's toggle switch.
      if (page.file === 'payment.html') {
        assert.equal(document.querySelector('.theme-switch'), null, 'minimal counter has no extra settings panel');
        continue;
      }
      const themeSwitch = document.querySelector('.theme-switch');
      assert.ok(themeSwitch, `${page.file}: dark mode lost its switch`);
      assert.ok(drawable(themeSwitch.querySelector('.theme-switch-icon svg[data-icon="sun"]'))
        && drawable(themeSwitch.querySelector('.theme-switch-icon svg[data-icon="moon"]')), `${page.file}: the switch lost an icon`);
      // The row keeps its short, stable name; the AMOLED explanation is the
      // sub-label, so this assertion never depends on the marketing wording
      // (js/appearance.js exposes THEME_LABEL for the full name).
      assert.ok(themeSwitch.textContent.includes('গাঢ় থিম'), `${page.file}: the switch label changed`);
      assert.ok(themeSwitch.textContent.includes('AMOLED'), `${page.file}: the switch lost its theme explanation`);
      const checkbox = themeSwitch.querySelector('#darkModeToggle');
      assert.ok(checkbox && checkbox.type === 'checkbox', `${page.file}: the switch is not wired to the theme checkbox`);
      assert.ok(themeSwitch.querySelector('.toggle-switch i'), `${page.file}: the switch lost its track`);
      const shape = normalised(bar);
      shapes.set(page.file, shape);
    }
  }
  const [first, ...rest] = [...shapes.values()];
  for (const shape of rest) assert.equal(shape, first, 'the panels no longer share one topbar design');
});

test('the bell shows the unread count; the inbox filters unread/all and marks read on request', async () => {
  const ctx = await loadPage('manager.html');
  const { mountNoticeCenter, noticeCenter } = await import('../js/notice-center.js');
  const read = new Set();
  const items = [
    { key: 'notice:N1:r1', source: 'notices', sourceId: 'N1', kind: 'notice', title: 'ক্লাস বন্ধ', body: 'আগামীকাল ক্লাস বন্ধ।', at: Date.parse('2026-09-29T10:00:00Z'), audience: 'সকল শিক্ষার্থী' },
    { key: 'broadcast:evil', source: 'settings', sourceId: 'broadcast', kind: 'broadcast', title: 'জরুরি ঘোষণা', body: '<img src=x onerror=alert(1)> সাবধান', at: 0, audience: 'সকল' }
  ];
  let seenAll = 0;
  const unreadItems = () => items.filter(item => !read.has(item.key));
  const api = {
    feed: () => items,
    unread: () => unreadItems().length,
    unreadKeys: () => unreadItems().map(item => item.key),
    records: () => items.map(item => ({ ...item, read: read.has(item.key) })),
    markRead: keys => { keys.forEach(key => read.add(key)); return keys.length; },
    seen: () => [...read],
    markAllSeen: () => { seenAll += 1; items.forEach(item => read.add(item.key)); return { count: seenAll, saved: true }; },
    pushSupport: async () => ({ supported: true, secureContext: true, permission: 'default', hasVapidKey: false }),
    enable: async () => ({ ok: true, status: 'granted' }),
    disable: async () => ({ ok: true, status: 'off' }),
    refresh: () => {}
  };

  const center = mountNoticeCenter(api);
  assert.ok(center, 'the inbox did not mount');
  assert.equal(noticeCenter(), center, 'a second mount replaced the first');

  const bell = ctx.$('#notificationButton');
  const dot = ctx.$('#notificationButton .notification-dot');
  assert.equal(dot.hidden, false, 'the badge is hidden while two items are unread');
  assert.equal(dot.textContent, '২', 'the badge shows the exact count');
  assert.equal(bell.getAttribute('aria-label'), 'নোটিফিকেশন — ২টি অপঠিত');

  ctx.click(bell);
  const modal = ctx.document.querySelector('#apcNoticeModal');
  assert.ok(modal, 'the inbox modal was not created on a staff panel');
  assert.equal(modal.hidden, false, 'the inbox did not open');
  // Opening the list is not reading it: the badge and the unread cards stay.
  assert.equal(seenAll, 0, 'opening the inbox must not mark everything read');
  assert.equal(dot.hidden, false, 'the badge survived opening the list');
  assert.equal(modal.querySelectorAll('.notice-detail').length, 2);
  assert.equal(modal.querySelectorAll('.notice-detail.unread').length, 2);
  assert.equal(modal.querySelector('[data-apc-notice-status]').textContent, '২টি অপঠিত নোটিফিকেশন');
  assert.equal(modal.querySelectorAll('img').length, 0, 'an item body injected markup');
  assert.ok(modal.querySelector('[data-apc-notice-empty]') === null, 'the empty card is not shown while items exist');

  // "সব" shows the same two; the unread tab comes back to them.
  ctx.click(modal.querySelector('[data-apc-notice-filter="all"]'));
  assert.equal(modal.querySelectorAll('.notice-detail').length, 2);
  ctx.click(modal.querySelector('[data-apc-notice-filter="unread"]'));
  assert.equal(modal.querySelectorAll('.notice-detail').length, 2);

  // The explicit action reads them and the badge goes away.
  ctx.click(modal.querySelector('[data-apc-notice-read-all]'));
  assert.equal(dot.hidden, true, 'the badge stayed after reading everything');
  assert.equal(bell.getAttribute('aria-label'), 'নোটিফিকেশন — সব পড়া হয়েছে');
  assert.equal(modal.querySelector('[data-apc-notice-status]').textContent, 'সব নোটিফিকেশন পড়া হিসেবে চিহ্নিত করা হয়েছে।');
  assert.ok(modal.querySelector('[data-apc-notice-read-all]').hidden, 'the read-all action hides when nothing is unread');

  // Nothing unread left: a checked card, and no acknowledgement buttons.
  const empty = modal.querySelector('[data-apc-notice-empty]');
  assert.ok(empty, 'the empty state is shown');
  assert.match(empty.textContent, /সব নোটিফিকেশন দেখা হয়েছে/);
  assert.match(empty.textContent, /নতুন কোনো নোটিফিকেশন নেই/);
  assert.equal(empty.querySelectorAll('button').length, 0, 'the empty state offers no buttons');
  assert.doesNotMatch(modal.textContent, /বুঝেছি|ঠিক আছে|আমি বুঝেছি/, 'no acknowledgement wording is left');

  // The switch for tray notifications is offered right in the inbox.
  await ctx.waitFor(() => Boolean(modal.querySelector('[data-apc-notice-push] button')));
  assert.match(modal.querySelector('[data-apc-notice-push] button').textContent, /চালু করুন/);

  ctx.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(modal.hidden, true, 'Escape did not close the inbox');

  // The login screen keeps its brand-only bar (no bell to wire there).
  const index = await loadPage('index.html');
  assert.equal(index.$('#authScreen .app-topbar button'), null, 'the login bar grew a button');
});

test('a receipt that cannot be saved keeps the message list honest', async () => {
  const ctx = await loadPage('teacher.html');
  // A fresh module instance: the inbox is a singleton per page load.
  const { mountNoticeCenter } = await import('../js/notice-center.js?unsaveable');
  const items = [{ key: 'notice:N9:r1', source: 'notices', sourceId: 'N9', kind: 'notice', title: 'নোটিশ', body: 'পাঠ', at: 0, audience: 'সকল শিক্ষার্থী' }];
  mountNoticeCenter({
    feed: () => items,
    seen: () => [],
    markAllSeen: () => ({ count: 1, saved: false }),
    pushSupport: async () => ({ supported: false, secureContext: true, permission: 'unsupported', hasVapidKey: false }),
    enable: async () => ({ ok: false, status: 'unsupported' }),
    disable: async () => ({ ok: false, status: 'off' }),
    refresh: () => {}
  });
  ctx.click(ctx.$('#notificationButton'));
  const modal = ctx.document.querySelector('#apcNoticeModal');
  assert.equal(modal.hidden, false);
  assert.equal(modal.querySelectorAll('.notice-detail').length, 1, 'the list still renders');
  // This engine only offers markAllSeen, and its receipt cannot be saved.
  ctx.click(modal.querySelector('[data-apc-notice-read-all]'));
  assert.equal(modal.querySelector('[data-apc-notice-status]').textContent, 'পড়ার অবস্থা এইবারের জন্য রাখা হয়েছে; ডিভাইসে সংরক্ষণ হয়নি।');
  // An unsupported browser is explained instead of offering a dead button.
  await ctx.waitFor(() => modal.querySelector('[data-apc-notice-push]').textContent.trim().length > 0);
  assert.equal(modal.querySelector('[data-apc-notice-push] button'), null);
  assert.match(modal.querySelector('[data-apc-notice-push]').textContent, /সিস্টেম নোটিফিকেশন নেই/);
});

test('the redesigned dark-mode switch really flips the theme', async () => {
  const ctx = await loadPage('admin.html');
  const { initAppearance, APPEARANCE_KEY } = await import('../js/appearance.js');
  initAppearance();
  const checkbox = ctx.$('.theme-switch #darkModeToggle');
  assert.ok(checkbox, 'the switch has no checkbox to click');
  const before = ctx.document.documentElement.dataset.theme;
  checkbox.checked = before !== 'dark';
  checkbox.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  const after = ctx.document.documentElement.dataset.theme;
  assert.notEqual(after, before, 'flipping the switch did not change the theme');
  assert.equal(ctx.window.localStorage.getItem(APPEARANCE_KEY), after, 'the choice was not stored for this device');
  // The icon chip follows the theme: sun in light mode, moon in dark.
  assert.ok(ctx.$('.theme-switch .theme-switch-icon .icon-sun'), 'the sun icon is missing');
  assert.ok(ctx.$('.theme-switch .theme-switch-icon .icon-moon'), 'the moon icon is missing');
});
