/*
 * Hero card daily messages (Bengali) — spec §8.
 *
 * The four student home hero cards each carry their own list of short Bengali
 * messages. The day's message is chosen from the LOCAL date only: same day →
 * always the same line, next day → the next line, list end → first line again.
 * No Math.random, no fetch, no localStorage requirement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickHeroMessage } from '../js/home-hero.js';
import { STUDENT_HOME_HERO_SLIDES } from '../js/student-home-hero-entry.js';

const DAY = 86_400_000;
/* Fixed timestamps well inside a Dhaka calendar day (Dhaka = UTC+6). */
const t1 = Date.parse('2026-10-01T04:00:00Z');
const t2 = Date.parse('2026-10-02T04:00:00Z');
const t3 = Date.parse('2026-10-03T04:00:00Z');

test('every student hero card keeps its approved message as list head with at least three distinct Bengali lines', () => {
  assert.equal(STUDENT_HOME_HERO_SLIDES.length, 4);
  const ids = STUDENT_HOME_HERO_SLIDES.map(spec => spec.id).sort();
  assert.deepEqual(ids, ['daily-goal', 'daily-tip', 'joy-of-learning', 'own-pace']);
  for (const spec of STUDENT_HOME_HERO_SLIDES) {
    assert.ok(Array.isArray(spec.messages) && spec.messages.length >= 3,
      `${spec.id} carries a message list long enough to avoid early repeats`);
    assert.equal(spec.messages[0], spec.description,
      `${spec.id}: the approved one-line message stays the list head`);
    assert.equal(new Set(spec.messages).size, spec.messages.length,
      `${spec.id}: no duplicate lines in the cycle`);
    for (const line of spec.messages) {
      assert.ok(line.trim().length > 0);
      /* The copy box on a phone is about 52% of the card width, so a long line
         would be clipped rather than wrapped. Keep every বাণী phone-sized. */
      assert.ok(line.length <= 72, `${spec.id}: keeps each বাণী within the card's copy box`);
      assert.doesNotMatch(line, /[A-Za-z]/, `${spec.id}: the advice stays fully Bengali`);
    }
  }
});

test('every student hero card carries a full rotation bank, so a line lasts for days', () => {
  /* Owner request 2026-11-08: the four slides need "আরো উপদেশ" — three lines per card
     repeated every third day. Each card now rotates a bank of at least a full ten-day
     stretch, and the four banks stay separate so four different lines share the screen. */
  const MIN_LINES_PER_CARD = 10;
  for (const spec of STUDENT_HOME_HERO_SLIDES) {
    assert.ok(spec.messages.length >= MIN_LINES_PER_CARD,
      `${spec.id}: at least ${MIN_LINES_PER_CARD} lines so the daily line does not repeat within ten days`);
    assert.ok(spec.messages.length <= 31, `${spec.id}: the bank stays a month-sized cycle`);
  }
  const banks = STUDENT_HOME_HERO_SLIDES.map(spec => spec.messages);
  const all = banks.flat();
  assert.equal(new Set(all).size, all.length, 'no line is shared between two cards');
  for (const bank of banks) {
    const distinctStarts = new Set(bank.map(line => line.trim().split(/\s+/).slice(0, 3).join(' ')));
    assert.ok(distinctStarts.size >= Math.ceil(bank.length * 0.7),
      'the lines open differently, so consecutive days do not read like a repeat');
  }
});

test('the same local day always picks the same message — refreshes and re-logins cannot flip it', () => {
  for (const spec of STUDENT_HOME_HERO_SLIDES) {
    const morning = pickHeroMessage(spec, t1);
    const noonish = pickHeroMessage(spec, t1 + 5 * 3600_000);
    const late = pickHeroMessage(spec, t1 + 10 * 3600_000);
    assert.equal(morning, noonish);
    assert.equal(morning, late);
  }
});

test('consecutive days walk the card list in order and the cycle restarts at the end', () => {
  for (const spec of STUDENT_HOME_HERO_SLIDES) {
    const n = spec.messages.length;
    const start = spec.messages.indexOf(pickHeroMessage(spec, t1));
    assert.ok(start >= 0, `${spec.id}: the pick always lands inside the card's own list`);
    for (let i = 0; i < n; i += 1) {
      assert.equal(pickHeroMessage(spec, t1 + i * DAY), spec.messages[(start + i) % n],
        `${spec.id}: day ${i} takes the next line in the cycle`);
    }
    assert.equal(pickHeroMessage(spec, t1 + n * DAY), pickHeroMessage(spec, t1),
      `${spec.id}: after the list ends the cycle starts over — never runs out`);
    assert.notEqual(pickHeroMessage(spec, t1), pickHeroMessage(spec, t2),
      `${spec.id}: the next day shows a new line`);
  }
});

test('the four cards rotate independently, each in its own voice', () => {
  const picks = STUDENT_HOME_HERO_SLIDES.map(spec => pickHeroMessage(spec, t2));
  const t3Picks = STUDENT_HOME_HERO_SLIDES.map(spec => pickHeroMessage(spec, t3));
  assert.equal(new Set(STUDENT_HOME_HERO_SLIDES.map(spec => spec.messages.join('|'))).size, 4,
    'each card owns its own list, not one shared pool');
  assert.equal(new Set(picks).size, 4, 'four distinct lines are on screen on any given day');
  assert.notDeepEqual(picks, t3Picks, 'the next calendar day rotates the visible set');
});

test('cards without a message list (shared payment/home hero) keep their single static description', () => {
  const staticSpec = {
    id: 'own-pace',
    description: '\u0985\u09a8\u09cd\u09af\u09c7\u09b0 \u09b8\u0999\u09cd\u0997\u09c7 \u09a8\u09df\u09c1, \u0997\u09a4\u0995\u09be\u09b2\u09c7\u09b0 \u09a8\u09bf\u099c\u09c7\u09b0 \u09b8\u0999\u09cd\u0997\u09c7 \u09aa\u09cd\u09b0\u09a4\u09bf\u09af\u09cb\u0997\u09bf\u09a4\u09be \u0995\u09b0\u09cb\u0964'
  };
  for (let i = 0; i < 10; i += 1) {
    assert.equal(pickHeroMessage(staticSpec, t1 + i * DAY), staticSpec.description);
  }
});

test('titles, slide ids and the design hooks stay untouched by the message logic', () => {
  const source = readFileSync(new URL('../js/student-home-hero-entry.js', import.meta.url), 'utf8');
  assert.equal((source.match(/title: '/g) || []).length, 4, 'four title fields, one per card');
  for (const id of ['own-pace', 'daily-goal', 'joy-of-learning', 'daily-tip']) {
    assert.ok(source.includes(`id: '${id}',`), `${id} slide is still declared`);
    assert.ok(source.includes(`description: '`) && source.includes(`messages: [`), 'copy structure kept');
  }
  // exact title text stays pinned byte-for-byte by home-hero.test.mjs's approved tuples.
  const hero = readFileSync(new URL('../js/home-hero.js', import.meta.url), 'utf8');
  assert.match(hero, /'hero-slide__description'/u, 'the same description node and class are reused');
  assert.ok(hero.includes('pickHeroMessage(spec)') || hero.includes('pickHeroMessage(spec,'),
    'createSlide draws the copy through the date-stable picker');
});

test('the pick is offline and deterministic — no random, timers or network in the rule', () => {
  const hero = readFileSync(new URL('../js/home-hero.js', import.meta.url), 'utf8');
  const fnStart = hero.indexOf('export function pickHeroMessage');
  const fnEnd = hero.indexOf('\n}', fnStart);
  const body = hero.slice(fnStart, fnEnd);
  assert.ok(fnStart > 0 && fnEnd > fnStart);
  assert.ok(!body.includes('Math.random'), 'no random per load');
  assert.ok(!body.includes('fetch') && !body.includes('XMLHttpRequest'), 'no network dependence');
  assert.ok(!body.includes('localStorage'), 'localStorage is not required for the pick');
  // same inputs → same output, across fresh calls
  for (const spec of STUDENT_HOME_HERO_SLIDES) {
    assert.equal(pickHeroMessage(spec, t2), pickHeroMessage(spec, t2));
    assert.equal(pickHeroMessage(spec, t2), pickHeroMessage(spec, t2 + 1000));
  }
});
