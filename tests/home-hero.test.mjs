import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { JSDOM } from 'jsdom';
import { initHomeHero, HERO_AUTOPLAY_MS, HERO_FIRST_DELAY_MS, HERO_TRANSITION_MS } from '../js/home-hero.js';

const contexts = [];
after(() => contexts.forEach(ctx => ctx.window.close()));
const staticFactory = ({ onChange }) => {
  onChange?.({ advice: { id: 'ADV-TEST', text: 'প্রতিদিনের অনুশীলনেই দক্ষতা বাড়ে।', source: 'Active Plus Coaching' } });
  return { stop() {} };
};
function fakeTimers(window) {
  const rows = [];
  let id = 0;
  window.setTimeout = (callback, delay) => { rows.push({ id: ++id, callback, delay, cleared: false }); return id; };
  window.clearTimeout = timerId => { const row = rows.find(item => item.id === timerId); if (row) row.cleared = true; };
  return rows;
}

test('the Student home alone mounts the shared advice hero after the separate welcome; other role homes have no hero cards', () => {
  const studentHtml = readFileSync(new URL('../student.html', import.meta.url), 'utf8');
  assert.equal((studentHtml.match(/data-home-hero(?![-\w])/g) || []).length, 1, 'Student has one hero mount');
  assert.match(studentHtml, /js\/home-hero-entry\.js\?v=\d+/u, 'Student loads the shared entry');
  const studentDocument = new JSDOM(studentHtml).window.document;
  const welcome = studentDocument.querySelector('#homeView .student-home-welcome');
  const studentHero = studentDocument.querySelector('#homeView [data-home-hero]');
  assert.ok(welcome && studentHero);
  assert.ok(welcome.compareDocumentPosition(studentHero) & studentDocument.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
    'student name/Welcome precedes the advice hero');
  assert.ok(welcome.querySelector('#studentName') && welcome.querySelector('#dayGreeting'));

  for (const [page, selector] of [
    ['teacher.html', '#teacherHome'],
    ['manager.html', '.manager-view[data-view-panel="dashboard"]'],
    ['admin.html', '.admin-view[data-view-panel="dashboard"]']
  ]) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const doc = new JSDOM(html).window.document;
    const home = doc.querySelector(selector);
    assert.ok(home, `${page} home exists`);
    assert.equal(home.querySelector('[data-home-hero], .hero-slider, .admin-hero'), null, `${page} has no hero card`);
    assert.doesNotMatch(html, /js\/home-hero-entry\.js\?v=\d+/u, `${page} does not load the Student hero entry`);
  }
  const manager = new JSDOM(readFileSync(new URL('../manager.html', import.meta.url), 'utf8')).window.document;
  const managerHome = manager.querySelector('.manager-view[data-view-panel="dashboard"]');
  const managerSummary = managerHome.querySelector('.manager-home-summary');
  const managerToday = managerHome.querySelector('.manager-today-classes');
  const managerQuick = managerHome.querySelector('nav[aria-label="দ্রুত অ্যাক্সেস"]');
  assert.ok(managerSummary && managerToday && managerQuick);
  assert.ok(managerSummary.compareDocumentPosition(managerToday) & manager.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(managerToday.compareDocumentPosition(managerQuick) & manager.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
    'Manager summary, today classes, and quick actions stay in the required order');

  const payment = readFileSync(new URL('../payment.html', import.meta.url), 'utf8');
  assert.equal((payment.match(/data-home-hero(?![-\w])/g) || []).length, 1, 'payment retains its legacy mount hook');
  assert.match(readFileSync(new URL('../js/home-hero-entry.js', import.meta.url), 'utf8'), /pay-counter-minimal/u);
  assert.equal(HERO_FIRST_DELAY_MS, 8000);
  assert.equal(HERO_AUTOPLAY_MS, 6000);
  assert.equal(HERO_TRANSITION_MS, 400);
});

test('hero exposes four ordered slides and a screen-reader transcript with no carousel controls', async () => {
  const ctx = await loadPage('student.html'); contexts.push(ctx);
  const mount = ctx.$('[data-home-hero]');
  const carousel = initHomeHero(mount, { autoConnect: false, adviceStoreFactory: staticFactory });
  assert.equal(mount.getAttribute('role'), 'region');
  assert.equal(mount.getAttribute('aria-label'), 'আজকের তথ্য');
  assert.equal(mount.getAttribute('aria-live'), 'off');
  assert.equal(mount.hasAttribute('tabindex'), false);
  assert.equal(ctx.$$('[data-hero-slide]').length, 4);
  assert.equal(ctx.$$('.hero-slider__transcript li').length, 4);
  assert.equal(ctx.$$('.hero-slide[aria-hidden="false"]').length, 1);
  assert.equal(ctx.$('[data-hero-slide]').dataset.heroId, 'advice');
  assert.equal(ctx.$('[data-hero-id="advice"] [data-hero-description]').textContent, 'প্রতিদিনের অনুশীলনেই দক্ষতা বাড়ে।');
  assert.equal(ctx.$('[data-hero-id="advice"] [data-hero-source]').textContent, 'Active Plus Coaching');
  assert.equal(ctx.$$('.hero-slider button, .hero-slider [data-hero-dot], .hero-slider__control').length, 0);
  assert.equal(mount.querySelector('[data-home-hero-date]')?.tagName, 'TIME');
  carousel.stop();
});

test('autoplay uses an 8-second first wait, six-second repeats, and pauses on hover/press', async () => {
  const ctx = await loadPage('student.html'); contexts.push(ctx);
  const timers = fakeTimers(ctx.window);
  const mount = ctx.$('[data-home-hero]');
  mount.getBoundingClientRect = () => ({ top: 100, bottom: 270 });
  Object.defineProperty(ctx.window, 'innerHeight', { value: 800, configurable: true });
  const carousel = initHomeHero(mount, { autoConnect: false, adviceStoreFactory: staticFactory });
  assert.equal(timers.find(timer => !timer.cleared)?.delay, HERO_FIRST_DELAY_MS);
  const first = timers.find(timer => !timer.cleared);
  first.callback();
  assert.equal(ctx.$('.hero-slide.is-active').dataset.heroId, 'summary');
  assert.equal(timers.filter(timer => !timer.cleared).at(-1)?.delay, HERO_AUTOPLAY_MS);

  mount.dispatchEvent(new ctx.window.MouseEvent('mouseenter', { bubbles: false }));
  assert.equal(timers.filter(timer => !timer.cleared).length, 0, 'hover clears the pending timer');
  mount.dispatchEvent(new ctx.window.MouseEvent('mouseleave', { bubbles: false }));
  assert.equal(timers.filter(timer => !timer.cleared).at(-1)?.delay, HERO_AUTOPLAY_MS);
  mount.dispatchEvent(new ctx.window.Event('pointerdown', { bubbles: true }));
  assert.equal(timers.filter(timer => !timer.cleared).length, 0, 'press clears the pending timer');
  ctx.document.dispatchEvent(new ctx.window.Event('pointerup'));
  assert.equal(timers.filter(timer => !timer.cleared).at(-1)?.delay, HERO_AUTOPLAY_MS);
  carousel.stop();
});

test('reduced motion shows one static advice slide while retaining all four transcript entries', async () => {
  const ctx = await loadPage('student.html'); contexts.push(ctx);
  const timers = fakeTimers(ctx.window);
  const listeners = new Set();
  ctx.window.matchMedia = query => ({
    media: query,
    matches: true,
    addEventListener(type, callback) { if (type === 'change') listeners.add(callback); },
    removeEventListener(type, callback) { if (type === 'change') listeners.delete(callback); }
  });
  const mount = ctx.$('[data-home-hero]');
  const carousel = initHomeHero(mount, { autoConnect: false, adviceStoreFactory: staticFactory });
  assert.equal(mount.classList.contains('is-reduced-motion'), true);
  assert.equal(ctx.$$('[data-hero-slide]:not([hidden])').length, 1);
  assert.equal(ctx.$('.hero-slide.is-active').dataset.heroId, 'advice');
  assert.equal(ctx.$$('.hero-slider__transcript li').length, 4);
  assert.equal(timers.filter(timer => !timer.cleared).length, 0);
  carousel.stop();
});

test('missing artwork keeps the slide and daily advice text intact', async () => {
  const ctx = await loadPage('student.html'); contexts.push(ctx);
  const mount = ctx.$('[data-home-hero]');
  const carousel = initHomeHero(mount, { autoConnect: false, adviceStoreFactory: staticFactory });
  ctx.$('[data-hero-id="summary"] img').dispatchEvent(new ctx.window.Event('error'));
  assert.equal(ctx.$$('[data-hero-slide]').length, 4);
  assert.ok(ctx.$('[data-hero-id="summary"]').classList.contains('has-art-fallback'));
  ctx.$('[data-hero-id="advice"] img').dispatchEvent(new ctx.window.Event('error'));
  assert.equal(ctx.$$('[data-hero-slide]').length, 4);
  assert.ok(ctx.$('[data-hero-id="advice"]').classList.contains('has-art-fallback'));
  assert.equal(ctx.$('[data-hero-id="advice"] [data-hero-description]').textContent, 'প্রতিদিনের অনুশীলনেই দক্ষতা বাড়ে।');
  carousel.stop();
});

test('Student hero CSS sets exact spacing/height, 320px fit, motion and reduced-motion behavior', () => {
  const css = readFileSync(new URL('../css/ui-wallet.css', import.meta.url), 'utf8');
  const foundation = readFileSync(new URL('../css/foundation.css', import.meta.url), 'utf8');
  assert.match(css, /\.hero-slider\s*\{[^}]*height:\s*170px[^}]*margin:\s*12px auto 14px/u);
  assert.match(css, /@media\s*\(max-width:\s*359px\)[\s\S]*?\.hero-slider\s*\{[^}]*height:\s*160px/u);
  assert.match(css, /\.hero-slider\s*\{[^}]*max-width:\s*520px/u);
  assert.match(css, /\.hero-slide\s*\{[^}]*400ms ease-out/u);
  assert.match(css, /\.hero-slider__transcript\s*\{[^}]*clip-path:\s*inset\(50%\)/u);
  assert.match(css, /\.hero-slide__copy p\s*\{[^}]*-webkit-line-clamp:\s*3/u);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*?\.hero-slide[^}]*transition:\s*none/u);
  assert.match(css, /button,\[role="button"\],a\.btn\{[^}]*min-height:48px!important/u);
  assert.match(css, /html\[data-theme="dark"\] body\{background:var\(--color-bg\)!important/u);
  assert.match(foundation, /--color-accent:\s*var\(--color-primary\)/u);
  assert.match(foundation, /--color-on-accent:\s*#062016/u);
  assert.match(foundation, /--color-bg:\s*#000/u);
  for (const alias of ['.btn', '.tab', '.chip', '.card', '.tile', '.modal', '.sheet', '.badge', '.empty', '.appbar', '.bottom-nav', '.back']) {
    assert.ok(css.includes(alias), `semantic alias ${alias} exists`);
  }
});
