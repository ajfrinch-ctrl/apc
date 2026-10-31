import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { JSDOM } from 'jsdom';
import { initHomeHero, HERO_AUTOPLAY_MS, HERO_FIRST_DELAY_MS, HERO_TRANSITION_MS, pickHeroMessage } from '../js/home-hero.js';
import { STUDENT_HOME_HERO_SLIDES } from '../js/student-home-hero-entry.js';
import {
  initStudentDailyHero, studentDailyHeroIndex, studentDailyQuoteForDate
} from '../js/student-home-daily-hero.js';

const contexts = [];
after(() => contexts.forEach(ctx => ctx.window.close()));

function fakeTimers(window) {
  const rows = [];
  let id = 0;
  window.setTimeout = (callback, delay) => { rows.push({ id: ++id, callback, delay, cleared: false, fired: false }); return id; };
  window.clearTimeout = timerId => {
    const row = rows.find(item => item.id === timerId);
    if (row && !row.fired) row.cleared = true;
  };
  return rows;
}

function fireNextTimer(timers) {
  const row = timers.find(item => !item.cleared && !item.fired);
  assert.ok(row, 'an autoplay timer is scheduled');
  row.fired = true;
  row.callback();
}

function pointerEvent(window, type, { pointerType = 'touch', x, y }) {
  const event = new window.Event(type, { bubbles: true });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    clientX: { value: x },
    clientY: { value: y },
    isPrimary: { value: true }
  });
  return event;
}

/* The Payment Counter used to host the shared carousel. Owner request
   2026-10-28 removed that hero card; the shared implementation is still used by
   Student Home, so its behaviour tests mount it on a fresh element instead of a
   staff page. */
async function carouselPage() {
  const ctx = await loadPage('student.html');
  contexts.push(ctx);
  const mount = ctx.document.createElement('div');
  mount.setAttribute('data-home-hero', '');
  ctx.document.body.appendChild(mount);
  return { ctx, mount };
}

test('Student Home replaces the visible advice card with a private hero while Payment keeps its shared hook', () => {
  const studentHtml = readFileSync(new URL('../student.html', import.meta.url), 'utf8');
  const studentDocument = new JSDOM(studentHtml).window.document;
  const home = studentDocument.querySelector('#homeView');
  const studentHero = home.querySelector('[data-student-home-hero]');
  assert.equal(home.querySelectorAll('[data-home-hero]').length, 1, 'Student has one carousel mount');
  assert.match(studentHtml, /js\/student-home-hero-entry\.js\?v=379/u, 'Student loads its isolated hero entry');
  assert.match(studentHtml, /js\/student-home-daily-hero\.js\?v=379/u, 'Student loads its date-based featured-slide selector');
  assert.doesNotMatch(studentHtml, /js\/home-hero-entry\.js\?v=\d+/u, 'Student does not initialize the Payment carousel entry');
  const topBar = studentDocument.querySelector('#studentHeader');
  const welcome = home.querySelector('.student-home-welcome');
  const advice = home.querySelector('#dailyQuoteCard');
  const progress = home.querySelector('.pay-hero.pay-hero-summary');
  const today = home.querySelector('.dashboard-today-section');
  const shortcuts = home.querySelector('#studentServices');
  const bottomNav = studentDocument.querySelector('.bottom-nav');
  const ordered = [topBar, welcome, studentHero, advice, today, progress, shortcuts, bottomNav];
  assert.ok(ordered.every(Boolean), 'the daily-advice home landmarks exist');
  ordered.slice(0, -1).forEach((node, index) => {
    assert.ok(node.compareDocumentPosition(ordered[index + 1]) & studentDocument.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
      `Student Home landmark ${index} precedes landmark ${index + 1}`);
  });
  assert.ok(welcome.querySelector('#studentName') && welcome.querySelector('#dayGreeting'));
  assert.ok(advice.querySelector('[data-daily-quote-date]') && advice.querySelector('[data-daily-advice-summary]'));
  assert.match(readFileSync(new URL('../css/hero-cards.css', import.meta.url), 'utf8'),
    /student-home-hero-section #dailyQuoteCard\s*\{[^}]*display:\s*none\s*!important/u,
    'the old quote renderer stays in the DOM but is no longer visible');
  assert.equal(home.querySelector('.hero-slider__controls, [data-hero-dot]'), null, 'the Student entry mounts controls after parsing');
  assert.equal(home.querySelectorAll('.study-progress-card .study-progress-stats').length, 1, 'there is only one visible metric row');
  assert.equal(home.querySelectorAll('#homeRealStatsRow > div').length, 2, 'the progress card exposes only two metrics');
  assert.equal(home.querySelectorAll('#dashboardWeeklyProgress, #dashboardTermProgress, #dashboardExamCount').length, 0, 'extra progress/exam metrics are not rendered');
  assert.equal(bottomNav.querySelectorAll('.bottom-link').length, 5, 'all five tabs remain');

  for (const [page, selector] of [
    ['teacher.html', '#teacherHome'],
    ['manager.html', '.manager-view[data-view-panel="dashboard"]'],
    ['admin.html', '.admin-view[data-view-panel="dashboard"]']
  ]) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const doc = new JSDOM(html).window.document;
    const roleHome = doc.querySelector(selector);
    assert.ok(roleHome, `${page} home exists`);
    assert.equal(roleHome.querySelector('[data-home-hero], .hero-slider, .admin-hero'), null, `${page} has no hero card`);
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

  // Owner request 2026-10-28: no hero card outside Student Home, so the Payment
  // Counter carries no carousel mount and no carousel entry script.
  const payment = readFileSync(new URL('../payment.html', import.meta.url), 'utf8');
  const paymentDocument = new JSDOM(payment).window.document;
  assert.equal(paymentDocument.querySelectorAll('[data-home-hero], .hero-slider').length, 0, 'payment carries no hero mount');
  assert.doesNotMatch(payment, /js\/home-hero-entry\.js/u, 'payment no longer loads the shared hero entry');
  assert.equal(HERO_FIRST_DELAY_MS, 5000);
  assert.equal(HERO_AUTOPLAY_MS, 5000);
  assert.equal(HERO_TRANSITION_MS, 380);
});
test('Student-specific hero presents the four approved messages and versioned local 16:9 illustrations', async () => {
  const ctx = await loadPage('student.html'); contexts.push(ctx);
  const mount = ctx.$('[data-student-home-hero]');
  const carousel = initHomeHero(mount, { slides: STUDENT_HOME_HERO_SLIDES });
  assert.equal(mount.querySelector('.pay-portal-kicker')?.textContent, 'আজকের পড়ার অনুপ্রেরণা');
  assert.doesNotMatch(mount.querySelector('.pay-portal-kicker')?.textContent || '', /অনুপ্রেরনা/u,
    'the daily-reading inspiration label uses the correct ণ spelling');
  const expected = [
    ['own-pace', 'নিজের ছন্দে', 'অন্যের সঙ্গে নয়, গতকালের নিজের সঙ্গে প্রতিযোগিতা করো।', 'hero-own-pace.webp'],
    ['daily-goal', 'আজকের লক্ষ্য', 'আজ অন্তত ২০ মিনিট মনোযোগ দিয়ে পড়ার চেষ্টা করো।', 'hero-daily-goal.webp'],
    ['joy-of-learning', 'শেখার আনন্দ', 'প্রতিটি নতুন বিষয় তোমাকে আরও দক্ষ করে তুলছে।', 'hero-joy-of-learning.webp'],
    ['daily-tip', 'আজকের পরামর্শ', 'পড়ার পর বই বন্ধ করে নিজের ভাষায় বিষয়টি মনে করার চেষ্টা করো।', 'hero-daily-tip.webp']
  ];
  assert.equal(ctx.$$('[data-hero-slide]').length, 4);
  assert.equal(ctx.$('[data-hero-slide].is-active').dataset.heroId, 'own-pace');
  assert.equal(ctx.$$('.hero-slider__controls button').length, 2);
  assert.equal(ctx.$$('.hero-slider__indicators [data-hero-dot]').length, 4);

  expected.forEach(([id, title, description, imageName], index) => {
    const slide = ctx.$(`[data-hero-id="${id}"]`);
    assert.equal(slide.querySelector('[data-hero-title]').textContent, title);
    const spec = STUDENT_HOME_HERO_SLIDES.find(item => item.id === id);
    assert.equal(spec.description, description, 'the approved message stays list head');
    assert.equal(slide.querySelector('[data-hero-description]').textContent, pickHeroMessage(spec),
      'the render is the date-stable pick from this card\'s message list');
    const image = slide.querySelector('img');
    assert.ok(image.alt.trim(), `${id} has meaningful alternative text`);
    assert.equal(image.getAttribute('src'), `assets/student-home-hero/${imageName}?v=379`);
    assert.equal(image.getAttribute('width'), '1280');
    assert.equal(image.getAttribute('height'), '720');
    assert.equal(image.getAttribute('loading'), index === 0 ? 'eager' : 'lazy');
  });
  carousel.stop();
});

test('Student daily inspiration cycles a different featured slide and quote for each Dhaka date', () => {
  const dates = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'];
  const selected = dates.map(date => {
    const timestamp = Date.parse(`${date}T12:00:00Z`);
    return STUDENT_HOME_HERO_SLIDES[studentDailyHeroIndex(timestamp)].id;
  });
  const dailyQuotes = dates.map(date => studentDailyQuoteForDate(date, null).text);
  assert.deepEqual(selected, ['daily-goal', 'joy-of-learning', 'daily-tip', 'own-pace', 'daily-goal']);
  assert.equal(new Set(dailyQuotes).size, dates.length, 'the daily quote library supplies a fresh line on each date');
  const oneQuoteCache = {
    dateKey: '2026-10-03', quote: { id: 'cached-only', text: 'একটি পুরোনো লাইন', author: '' },
    quotes: [{ id: 'cached-only', text: 'একটি পুরোনো লাইন', author: '' }]
  };
  assert.notEqual(studentDailyQuoteForDate('2026-10-04', oneQuoteCache).text, oneQuoteCache.quote.text,
    'a too-small cached feed falls back to the larger built-in library instead of repeating');
});

test('Student daily inspiration changes at Dhaka midnight and catches up after a hidden tab', async () => {
  const ctx = await loadPage('student.html'); contexts.push(ctx);
  const timers = fakeTimers(ctx.window);
  const mount = ctx.$('[data-student-home-hero]');
  mount.getBoundingClientRect = () => ({ top: 100, bottom: 420 });
  Object.defineProperty(ctx.window, 'innerHeight', { value: 800, configurable: true });
  let now = Date.parse('2026-10-03T17:59:50Z'); // ten seconds before midnight in Dhaka
  const carousel = initHomeHero(mount, { slides: STUDENT_HOME_HERO_SLIDES });
  const dailyHero = initStudentDailyHero(mount, { now: () => now });

  assert.equal(ctx.$('[data-hero-slide].is-active').dataset.heroId, 'daily-goal');
  assert.equal(ctx.$('[data-home-hero-date]').dateTime, '2026-10-03');
  assert.equal(ctx.$('[data-student-daily-quote-text]').textContent,
    studentDailyQuoteForDate('2026-10-03', null).text);
  assert.equal(ctx.$('[data-student-daily-quote]').getAttribute('aria-live'), 'polite');
  const firstDailyQuote = ctx.$('[data-student-daily-quote-text]').textContent;
  assert.equal(ctx.$('[data-hero-slide].is-active img').getAttribute('loading'), 'eager',
    'the date-selected slide gets the eager image request');
  assert.equal(ctx.$('[data-hero-id="own-pace"] img').getAttribute('loading'), 'lazy');

  const midnightTimer = timers.find(item => !item.cleared && !item.fired && item.delay > HERO_AUTOPLAY_MS);
  assert.ok(midnightTimer && midnightTimer.delay < 12_000, 'the next daily refresh is scheduled for Dhaka midnight');
  now = Date.parse('2026-10-03T18:00:01Z');
  midnightTimer.fired = true;
  midnightTimer.callback();
  assert.equal(ctx.$('[data-home-hero-date]').dateTime, '2026-10-04');
  assert.equal(ctx.$('[data-hero-slide].is-active').dataset.heroId, 'joy-of-learning');
  assert.equal(ctx.$('[data-student-daily-quote-text]').textContent,
    studentDailyQuoteForDate('2026-10-04', null).text);
  assert.notEqual(ctx.$('[data-student-daily-quote-text]').textContent, firstDailyQuote,
    'the midnight refresh replaces yesterday’s quote with a new one');

  const nextMidnightTimer = timers.find(item => !item.cleared && !item.fired && item.delay > HERO_AUTOPLAY_MS);
  assert.ok(nextMidnightTimer, 'the following daily refresh is scheduled');
  Object.defineProperty(ctx.document, 'visibilityState', { configurable: true, value: 'hidden' });
  Object.defineProperty(ctx.document, 'hidden', { configurable: true, value: true });
  ctx.document.dispatchEvent(new ctx.window.Event('visibilitychange'));
  assert.equal(nextMidnightTimer.cleared, true, 'the daily timer pauses while the document is hidden');

  now = Date.parse('2026-10-04T18:00:01Z');
  Object.defineProperty(ctx.document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(ctx.document, 'hidden', { configurable: true, value: false });
  ctx.document.dispatchEvent(new ctx.window.Event('visibilitychange'));
  assert.equal(ctx.$('[data-home-hero-date]').dateTime, '2026-10-05');
  assert.equal(ctx.$('[data-hero-slide].is-active').dataset.heroId, 'daily-tip',
    'returning after midnight selects the current day without waiting for a timer');
  assert.equal(ctx.$('[data-student-daily-quote-text]').textContent,
    studentDailyQuoteForDate('2026-10-05', null).text,
    'returning after midnight also catches up the quote');
  dailyHero.stop();
  carousel.stop();
});

test('the carousel has four linked illustrations, exact Bangla copy, alt text, arrows and active dots', async () => {
  const { ctx, mount } = await carouselPage();
  const carousel = initHomeHero(mount);
  const expected = [
    ['own-pace', 'নিজের ছন্দে', 'অন্যের সঙ্গে নয়, গতকালের নিজের সঙ্গে প্রতিযোগিতা করো।', 'hero-own-pace.webp'],
    ['daily-goal', 'আজকের লক্ষ্য', 'আজ অন্তত ২০ মিনিট মনোযোগ দিয়ে পড়ো।', 'hero-daily-goal.webp'],
    ['joy-of-learning', 'শেখার আনন্দ', 'প্রতিটি নতুন বিষয় তোমার দক্ষতা আরও বাড়ায়।', 'hero-joy-of-learning.webp'],
    ['daily-tip', 'আজকের পরামর্শ', 'পড়া শেষে বই বন্ধ করে, নিজের ভাষায় বিষয়টি মনে করো।', 'hero-daily-tip.webp']
  ];

  assert.equal(mount.getAttribute('role'), 'region');
  assert.equal(mount.getAttribute('aria-roledescription'), 'carousel');
  assert.equal(mount.getAttribute('aria-live'), 'off');
  assert.equal(ctx.$$('[data-hero-slide]').length, 4);
  assert.equal(ctx.$$('.hero-slide.is-active').length, 1);
  assert.equal(ctx.$('[data-hero-slide].is-active').dataset.heroId, 'own-pace');
  assert.equal(ctx.$$('.hero-slider__controls button').length, 2);
  assert.equal(ctx.$$('.hero-slider__indicators [data-hero-dot]').length, 4);
  assert.equal(ctx.$('.hero-slider__dot.is-active').dataset.slideIndex, '0');
  assert.equal(ctx.$('[data-hero-previous]').getAttribute('aria-label'), 'আগের স্লাইড');
  assert.equal(ctx.$('[data-hero-next]').getAttribute('aria-label'), 'পরের স্লাইড');

  expected.forEach(([id, title, description, imageName], index) => {
    const slide = ctx.$(`[data-hero-id="${id}"]`);
    assert.ok(slide, `${id} slide exists in order`);
    assert.equal(slide.querySelector('[data-hero-title]').textContent, title);
    assert.equal(slide.querySelector('[data-hero-description]').textContent, description);
    const image = slide.querySelector('img');
    assert.ok(image.alt.trim(), `${id} image has meaningful alt text`);
    assert.equal(image.getAttribute('src'), `assets/home-hero/${imageName}`);
    assert.equal(image.getAttribute('width'), '1280');
    assert.equal(image.getAttribute('height'), '720');
    assert.equal(image.getAttribute('loading'), index === 0 ? 'eager' : 'lazy');
  });
  assert.equal(ctx.$('[data-home-hero-date]')?.tagName, 'TIME');
  carousel.stop();
});

test('shared and Student-specific hero files are included in the offline worker precache', () => {
  const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const images = ['hero-own-pace.webp', 'hero-daily-goal.webp', 'hero-joy-of-learning.webp', 'hero-daily-tip.webp'];
  for (const image of images) {
    assert.ok(worker.includes(`'./assets/home-hero/${image}'`), `${image} remains available to Payment`);
    assert.ok(worker.includes(`'./assets/student-home-hero/${image}' + '?v=379'`), `${image} is versioned for Student offline use`);
  }
  assert.ok(worker.includes("'./js/home-hero.js' + '?v=379'"), 'the Student-compatible slider module is precached');
  assert.ok(worker.includes("'./js/student-home-hero-entry.js' + '?v=379'"), 'the Student entry is precached');
  assert.ok(worker.includes("'./js/student-home-daily-hero.js' + '?v=379'"), 'the Student daily selector is precached');
});

test('autoplay advances every five seconds, wraps after four slides, and pauses on hover/press', async () => {
  const { ctx, mount } = await carouselPage();
  const timers = fakeTimers(ctx.window);
  mount.getBoundingClientRect = () => ({ top: 100, bottom: 420 });
  Object.defineProperty(ctx.window, 'innerHeight', { value: 800, configurable: true });
  const carousel = initHomeHero(mount);
  assert.equal(timers.find(timer => !timer.cleared)?.delay, HERO_FIRST_DELAY_MS);

  for (const expected of ['daily-goal', 'joy-of-learning', 'daily-tip', 'own-pace']) {
    fireNextTimer(timers);
    assert.equal(ctx.$('.hero-slide.is-active').dataset.heroId, expected);
    assert.equal(timers.find(timer => !timer.cleared && !timer.fired)?.delay, HERO_AUTOPLAY_MS);
  }

  mount.dispatchEvent(new ctx.window.MouseEvent('mouseenter', { bubbles: false }));
  assert.equal(timers.filter(timer => !timer.cleared && !timer.fired).length, 0, 'hover clears the pending timer');
  mount.dispatchEvent(new ctx.window.MouseEvent('mouseleave', { bubbles: false }));
  assert.equal(timers.filter(timer => !timer.cleared && !timer.fired).at(-1)?.delay, HERO_AUTOPLAY_MS);
  mount.dispatchEvent(new ctx.window.Event('pointerdown', { bubbles: true }));
  assert.equal(timers.filter(timer => !timer.cleared && !timer.fired).length, 0, 'press clears the pending timer');
  ctx.document.dispatchEvent(new ctx.window.Event('pointerup'));
  assert.equal(timers.filter(timer => !timer.cleared && !timer.fired).at(-1)?.delay, HERO_AUTOPLAY_MS);
  carousel.stop();
});

test('a hidden document pauses autoplay and visibility restores it at the five-second interval', async () => {
  const { ctx, mount } = await carouselPage();
  const timers = fakeTimers(ctx.window);
  mount.getBoundingClientRect = () => ({ top: 100, bottom: 420 });
  Object.defineProperty(ctx.window, 'innerHeight', { value: 800, configurable: true });
  const carousel = initHomeHero(mount);
  assert.equal(timers.filter(timer => !timer.cleared && !timer.fired).length, 1);

  Object.defineProperty(ctx.document, 'visibilityState', { configurable: true, value: 'hidden' });
  Object.defineProperty(ctx.document, 'hidden', { configurable: true, value: true });
  ctx.document.dispatchEvent(new ctx.window.Event('visibilitychange'));
  assert.equal(timers.filter(timer => !timer.cleared && !timer.fired).length, 0, 'a hidden tab clears its pending timer');
  assert.equal(ctx.$('.hero-slide.is-active').dataset.heroId, 'own-pace', 'the hidden tab does not advance the slide');

  Object.defineProperty(ctx.document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(ctx.document, 'hidden', { configurable: true, value: false });
  ctx.document.dispatchEvent(new ctx.window.Event('visibilitychange'));
  assert.equal(timers.filter(timer => !timer.cleared && !timer.fired).at(-1)?.delay, HERO_FIRST_DELAY_MS,
    'the active first slide resumes with the normal five-second delay');
  carousel.stop();
});

test('touch swipe moves horizontally but leaves vertical scrolling gestures alone', async () => {
  const { ctx, mount } = await carouselPage();
  const timers = fakeTimers(ctx.window);
  mount.getBoundingClientRect = () => ({ top: 100, bottom: 420 });
  Object.defineProperty(ctx.window, 'innerHeight', { value: 800, configurable: true });
  const carousel = initHomeHero(mount);

  mount.dispatchEvent(pointerEvent(ctx.window, 'pointerdown', { x: 210, y: 100 }));
  ctx.document.dispatchEvent(pointerEvent(ctx.window, 'pointerup', { x: 202, y: 175 }));
  assert.equal(ctx.$('.hero-slide.is-active').dataset.heroId, 'own-pace', 'vertical movement does not change slides');

  mount.dispatchEvent(pointerEvent(ctx.window, 'pointerdown', { x: 220, y: 100 }));
  ctx.document.dispatchEvent(pointerEvent(ctx.window, 'pointerup', { x: 145, y: 106 }));
  assert.equal(ctx.$('.hero-slide.is-active').dataset.heroId, 'daily-goal', 'swiping left shows the next slide');
  mount.dispatchEvent(pointerEvent(ctx.window, 'pointerdown', { x: 140, y: 100 }));
  ctx.document.dispatchEvent(pointerEvent(ctx.window, 'pointerup', { x: 220, y: 104 }));
  assert.equal(ctx.$('.hero-slide.is-active').dataset.heroId, 'own-pace', 'swiping right shows the previous slide');
  carousel.stop();
  assert.ok(timers.length > 0);
});

test('reduced motion disables autoplay/transitions but leaves all slides and manual arrows usable', async () => {
  const { ctx, mount } = await carouselPage();
  const timers = fakeTimers(ctx.window);
  ctx.window.matchMedia = query => ({
    media: query,
    matches: true,
    addEventListener() {},
    removeEventListener() {}
  });
  const carousel = initHomeHero(mount);
  assert.equal(mount.classList.contains('is-reduced-motion'), true);
  assert.equal(ctx.$$('[data-hero-slide]').length, 4);
  assert.equal(ctx.$$('[data-hero-slide][hidden]').length, 0);
  assert.equal(ctx.$('.hero-slide.is-active').dataset.heroId, 'own-pace');
  assert.equal(timers.filter(timer => !timer.cleared && !timer.fired).length, 0);
  ctx.$('[data-hero-next]').click();
  assert.equal(ctx.$('.hero-slide.is-active').dataset.heroId, 'daily-goal');
  assert.equal(timers.filter(timer => !timer.cleared && !timer.fired).length, 0);
  carousel.stop();
});

test('missing artwork falls back to the pastel card without removing slide copy or navigation', async () => {
  const { ctx, mount } = await carouselPage();
  const carousel = initHomeHero(mount);
  ctx.$('[data-hero-id="daily-goal"] img').dispatchEvent(new ctx.window.Event('error'));
  assert.equal(ctx.$$('[data-hero-slide]').length, 4);
  assert.ok(ctx.$('[data-hero-id="daily-goal"]').classList.contains('has-art-fallback'));
  assert.equal(ctx.$('[data-hero-id="daily-goal"] [data-hero-description]').textContent,
    'আজ অন্তত ২০ মিনিট মনোযোগ দিয়ে পড়ো।');
  assert.equal(ctx.$$('.hero-slider__controls button').length, 2);
  carousel.stop();
});

test('hero CSS preserves the shared Payment treatment and Student no-crop responsive layout', () => {
  const css = readFileSync(new URL('../css/ui-wallet.css', import.meta.url), 'utf8');
  const studentCss = readFileSync(new URL('../css/hero-cards.css', import.meta.url), 'utf8');
  assert.match(css, /\.hero-slider\s*\{[^}]*height:\s*clamp\(290px,\s*31vw,\s*360px\)/u);
  assert.match(css, /\.hero-slider__dot\.is-active\s*\{[^}]*background:\s*var\(--color-primary\)/u);
  assert.match(css, /\.hero-slider__arrow\s*\{[^}]*var\(--color-primary\)/u);
  assert.match(css, /\.hero-slider__arrow:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--color-primary\)/u);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.hero-slider\s*\{[^}]*height:\s*320px/u);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.hero-slide\s*\{[^}]*grid-template-rows:\s*96px minmax\(0,\s*1fr\)/u);
  assert.match(css, /@media\s*\(max-width:\s*359px\)[\s\S]*?\.hero-slide\s*\{[^}]*grid-template-rows:\s*100px minmax\(0,\s*1fr\)/u);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.hero-slide__art img\s*\{[^}]*object-fit:\s*cover/u);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.hero-slide__copy h2\s*\{[^}]*text-wrap:\s*balance/u);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.hero-slide__description\s*\{[^}]*text-wrap:\s*pretty/u);
  assert.match(css, /@media\s*\(max-width:\s*359px\)[\s\S]*?\.hero-slider\s*\{[^}]*height:\s*310px/u);
  assert.match(css, /\.hero-slide__art img\s*\{[^}]*object-fit:\s*contain/u);
  assert.match(css, /\.hero-slide__art img\s*\{[^}]*object-position:\s*right center/u);
  assert.match(css, /\.hero-slide\s*\{[^}]*380ms cubic-bezier/u);
  assert.match(css, /\.hero-slider__controls\s*\{/u);
  assert.match(css, /touch-action:\s*pan-y/u);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*?\.hero-slide[^}]*transition:\s*none/u);
  assert.match(studentCss, /student-home-hero\.hero-slider[\s\S]*?height:\s*clamp\(280px,\s*30vw,\s*350px\)/u);
  assert.match(studentCss, /student-home-hero \.hero-slide__art img\s*\{[^}]*object-fit:\s*contain !important/u);
  assert.match(studentCss, /@media screen and \(max-width: 640px\)[\s\S]*?student-home-hero \.hero-slide__art img\s*\{[^}]*object-fit:\s*contain !important/u);
  assert.match(studentCss, /@media screen and \(max-width: 640px\)[\s\S]*?student-home-hero \.hero-slide__copy\s*\{[^}]*width:\s*52%/u);
  assert.match(studentCss, /student-home-hero \.student-home-daily-quote__text\s*\{[^}]*-webkit-line-clamp:\s*2/u);
  assert.match(studentCss, /student-home-hero \.hero-slider__context\s*\{[^}]*height:\s*84px/u);
  assert.match(studentCss, /student-home-hero-section #dailyQuoteCard\s*\{[^}]*display:\s*none !important/u);
  assert.match(studentCss, /prefers-reduced-motion:\s*reduce[\s\S]*?student-home-hero \.hero-slide[^}]*transition:\s*none/u);
  assert.match(css, /button,\[role="button"\],a\.btn\{[^}]*min-height:48px!important/u);
});
