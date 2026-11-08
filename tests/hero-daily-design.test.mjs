/* Owner request 2026-11-08: the Student Home hero card should not look the same
   every day. The four slides keep their approved artwork, titles and copy, but
   the slide that is featured today lends its own colours, trim and decoration to
   the whole card — so the card's finish rotates with the Dhaka date while the
   structure stays put. Staff heroes are untouched.

   These tests mount the real markup and the real script, so they cover the whole
   chain: date -> featured slide -> data-hero-design -> CSS finish. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { initHomeHero } from '../js/home-hero.js';
import { STUDENT_HOME_HERO_SLIDES } from '../js/student-home-hero-entry.js';
import { initStudentDailyHero, studentDailyHeroIndex } from '../js/student-home-daily-hero.js';

const contexts = [];
after(() => contexts.forEach(ctx => ctx.window.close()));

const DESIGN_IDS = ['own-pace', 'daily-goal', 'joy-of-learning', 'daily-tip'];
const studentCss = readFileSync(new URL('../css/hero-cards.css', import.meta.url), 'utf8');
const walletCss = readFileSync(new URL('../css/ui-wallet.css', import.meta.url), 'utf8');
const foundationCss = readFileSync(new URL('../css/foundation.css', import.meta.url), 'utf8');

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

/* Every fixture re-uses the real Student Home hero so the mount markup is never
   a hand-written copy of student.html. */
async function heroFixture(now) {
  const ctx = await loadPage('student.html');
  contexts.push(ctx);
  const timers = fakeTimers(ctx.window);
  const mount = ctx.$('[data-student-home-hero]');
  mount.getBoundingClientRect = () => ({ top: 100, bottom: 420 });
  Object.defineProperty(ctx.window, 'innerHeight', { value: 800, configurable: true });
  const clock = { now };
  const carousel = initHomeHero(mount, { slides: STUDENT_HOME_HERO_SLIDES });
  const dailyHero = initStudentDailyHero(mount, { now: () => clock.now });
  return { ctx, mount, timers, carousel, dailyHero, clock };
}

test('the featured slide names the card design and the design rotates with the Dhaka date', async () => {
  const { ctx, mount, carousel, clock } = await heroFixture(Date.parse('2026-11-11T04:00:00Z'));
  assert.equal(mount.dataset.heroDesign, 'own-pace');
  assert.equal(mount.dataset.heroDesign, mount.dataset.dailyHeroSlide,
    'the design hook always mirrors today’s featured slide');
  assert.equal(mount.dataset.dailyHeroSlide,
    STUDENT_HOME_HERO_SLIDES[studentDailyHeroIndex(new Date(clock.now), STUDENT_HOME_HERO_SLIDES.length)].id,
    'the featured slide comes from the shared daily index');

  const seen = new Set([mount.dataset.heroDesign]);
  for (let day = 1; day <= 5; day += 1) {
    clock.now += 24 * 60 * 60 * 1000;
    mount.dispatchEvent(new ctx.window.Event('visibilitychange'));
    ctx.document.dispatchEvent(new ctx.window.Event('visibilitychange'));
    const design = mount.dataset.heroDesign;
    assert.equal(design, mount.dataset.dailyHeroSlide);
    assert.ok(DESIGN_IDS.includes(design), `${design} is a known slide design`);
    seen.add(design);
  }
  assert.ok(seen.size >= 3, `consecutive Dhaka dates rotate through designs (saw ${[...seen].join(', ')})`);
  carousel.stop();
});

test('every design id has an explicit CSS finish and the card keeps one design while swiping', async () => {
  const { ctx, mount, carousel } = await heroFixture(Date.parse('2026-11-11T04:00:00Z'));
  const todayDesign = mount.dataset.heroDesign;
  for (const id of DESIGN_IDS) {
    assert.match(studentCss, new RegExp(`\\.student-home-hero\\.student-home-hero\\[data-hero-design="${id}"\\]`, 'u'),
      `${id} owns a design block`);
    assert.match(studentCss, new RegExp(`\\[data-hero-design="${id}"\\][\\s\\S]{0,400}?--hero-design-tone:`, 'u'),
      `${id} sets its own accent tone`);
  }
  assert.match(studentCss, /\.student-home-hero::after\s*\{[^}]*width:\s*8px/u,
    'the daily colour rail is a thin trim, not a text-side panel');
  assert.match(studentCss, /\.student-home-hero::after\s*\{[^}]*z-index:\s*7/u,
    'the rail stays above the slides so nothing covers it');

  ctx.$('[data-hero-next]').click();
  assert.equal(mount.dataset.heroDesign, todayDesign, 'a manual swipe does not repaint the day’s design');
  ctx.$('[data-hero-next]').click();
  ctx.$('[data-hero-next]').click();
  assert.equal(mount.dataset.heroDesign, todayDesign);
  assert.equal(ctx.$$('[data-hero-slide]').length, 4, 'the four approved slides are untouched');
  carousel.stop();
});

test('the daily design never borrows the payment carousel or the staff heroes', () => {
  const designStart = studentCss.indexOf('হিরো কার্ডের দিনভিত্তিক ডিজাইন');
  assert.ok(designStart > 0, 'the daily design block is present in the Student hero stylesheet');
  const designBlock = studentCss.slice(designStart);
  for (const match of designBlock.matchAll(/^([^@{}\n][^{}]*)\{/gmu)) {
    const selector = match[1].trim();
    assert.match(selector, /body\.student-reference #homeView/u,
      `daily design selector stays on the Student home hero: ${selector}`);
    assert.doesNotMatch(selector, /pay-hero|admin|teacher|manager|cash/u);
  }
  assert.doesNotMatch(designBlock, /url\(|@import/u, 'the daily finish is inline CSS only (offline safe)');
  assert.match(walletCss, /\.hero-slide--own-pace\s*\{[^}]*--hero-bg:/u, 'per-slide palettes are still declared');
});

test('the daily design text pairs clear AA in both themes', () => {
  const palettes = (theme) => {
    const read = selector => [...foundationCss.split(selector + '{')[1].split('\n}')[0]
      .matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]);
    return new Map([...read(':root'), ...(theme === 'dark' ? read('html[data-theme=dark]') : [])]);
  };
  const hex = value => [0, 2, 4].map(index => parseInt(value.slice(index + 1, index + 3), 16));
  const lin = channel => { const s = channel / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; };
  const lum = channels => lin(channels[0]) * .2126 + lin(channels[1]) * .7152 + lin(channels[2]) * .0722;
  const ratio = (a, b) => {
    const [light, dark] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (light + .05) / (dark + .05);
  };
  const mix = (a, b, weight) => a.map((channel, index) => channel * (1 - weight) + b[index] * weight);

  const pairs = {
    'own-pace': ['--tone-blue', '--tone-violet'],
    'daily-goal': ['--tone-mint', '--tone-blue'],
    'joy-of-learning': ['--tone-amber', '--tone-coral'],
    'daily-tip': ['--tone-violet', '--tone-rose']
  };
  for (const theme of ['light', 'dark']) {
    const tokens = palettes(theme);
    const surface = hex(tokens.get('--color-surface').replace(/^#fff$/u, '#ffffff'));
    const ink = hex(tokens.get('--color-text'));
    const muted = hex(tokens.get('--color-text-secondary'));
    for (const [id, [toneToken, toneToken2]] of Object.entries(pairs)) {
      const tone = hex(tokens.get(toneToken));
      const tone2 = hex(tokens.get(toneToken2));
      // Slide wash (7%), the copy-box glow over it, the context strip tint and the kicker ink
      // are the four surfaces this change adds; the worst case of each is asserted.
      const slideWash = mix(surface, tone, .07);
      const glow = mix(slideWash, tone, .10);
      const glowFar = mix(slideWash, tone2, .06);
      const contextStrip = mix(surface, tone2, .28);
      const kicker = mix(tone, ink, .45);
      assert.ok(ratio(ink, glow) >= 4.5, `${theme}/${id}: heading on the daily glow is ${ratio(ink, glow).toFixed(2)}:1`);
      assert.ok(ratio(ink, glowFar) >= 4.5, `${theme}/${id}: heading on the far glow is ${ratio(ink, glowFar).toFixed(2)}:1`);
      assert.ok(ratio(muted, glow) >= 4.5, `${theme}/${id}: body copy on the daily glow is ${ratio(muted, glow).toFixed(2)}:1`);
      assert.ok(ratio(muted, glowFar) >= 4.5, `${theme}/${id}: body copy on the far glow is ${ratio(muted, glowFar).toFixed(2)}:1`);
      assert.ok(ratio(ink, contextStrip) >= 4.5, `${theme}/${id}: the quote on the context strip is ${ratio(ink, contextStrip).toFixed(2)}:1`);
      assert.ok(ratio(kicker, surface) >= 4.5, `${theme}/${id}: the kicker accent is ${ratio(kicker, surface).toFixed(2)}:1`);
    }
  }
  assert.match(studentCss, /\.student-home-hero \.hero-slider__context\s*\{[^}]*var\(--hero-design-tone/u,
    'the context strip is tinted from the same token the contrast check models');
  assert.match(studentCss, /\.pay-portal-kicker\s*\{[^}]*55%, var\(--color-text\)/u,
    'the kicker keeps a deep ink mix so every tone stays legible');
});

test('the daily design respects reduced motion', () => {
  const reduced = studentCss.slice(studentCss.lastIndexOf('prefers-reduced-motion'));
  assert.match(reduced, /\.student-home-hero\.hero-slider,[\s\S]*?transition:\s*none/u,
    'the card finish does not animate for reduced-motion users');
});
