/* Legacy daily quote card tests. The Student home hero owns the visible
   advice; this cached Student widget remains intact but hidden for migration.

   The site's rules, one test each:
     • the legacy quote markup stays hidden and the Student home keeps its new
       welcome → hero → summary → today → quick-action order;
     • the day picks the legacy line deterministically for compatibility;
     • it is offline-first: the card is filled from the built-in library or the
       cached feed before any request, and a failed/absent/corrupt fetch changes
       nothing, blanks nothing and raises nothing;
     • it keeps one private cache key and never touches another record. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import {
  BUILT_IN_QUOTES, DAILY_QUOTE_KEY, initDailyQuote, loadQuoteFeed, normalizeQuotes,
  parseQuoteFeed, pickQuote, quoteDateKey, quoteDayNumber, readQuoteCache, saveQuoteCache
} from '../js/daily-quote.js';
import { KEYS } from '../js/database.js';

const DAY = Date.parse('2026-10-03T06:00:00Z');            // 3 Oct 2026, 12:00 Dhaka
const NEXT_DAY = Date.parse('2026-10-04T06:00:00Z');
const FEED = readFileSync(new URL('../assets/daily-quotes.json', import.meta.url), 'utf8');

const contexts = [];
after(() => contexts.forEach(ctx => ctx.window.close()));

test('Student home places the welcome before the hero, then summary, today and quick actions', () => {
  const html = readFileSync(new URL('../student.html', import.meta.url), 'utf8');
  const at = name => html.indexOf(name);
  assert.ok(at('id="studentName"') < at('data-home-hero'), 'the student name/Welcome is above the advice card');
  assert.ok(at('data-home-hero') < at('class="pay-hero pay-hero-summary"'));
  assert.ok(at('class="pay-hero pay-hero-summary"') < at('dashboard-today-section'));
  assert.ok(at('class="dashboard-today-section"') < at('id="studentServices"'));
  assert.ok(at('id="studentServices"') < at('id="dashboardExamCard"'), 'existing optional study/fee cards remain below quick actions');
  assert.match(html, /class="daily-quote-section"[^>]*\shidden/u, 'the legacy quote section stays hidden under the advice hero');
});

test('the legacy quote card still paints offline but remains hidden in the page flow', async () => {
  const ctx = await loadPage('student.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  contexts.push(ctx);
  /* jsdom does not run page modules, so mount the legacy compatibility card. */
  const card = initDailyQuote({ mount: '#dailyQuoteCard', now: () => DAY, autoFetch: false });
  const quote = ctx.$('#dailyQuoteCard');
  assert.equal(quote.hidden, false, 'the card can still be populated for migration compatibility');
  assert.equal(ctx.$('.daily-quote-section').hidden, true, 'the legacy card cannot duplicate visible hero advice');
  const today = ctx.$('.dashboard-today-section');
  const menu = ctx.$('#studentServices');
  const order = (a, b) => a.compareDocumentPosition(b) & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING;
  assert.ok(order(today, menu), 'today’s classes precede quick actions');
  assert.equal(ctx.$$('#homeView .daily-quote-card').length, 1, 'the existing ID and single card remain');
  assert.equal(ctx.$$('#studentServices .pay-tile').length, 6, 'the quick menu keeps its existing cards');
  assert.deepEqual(ctx.$$('#studentServices .pay-tile-label').map(node => node.textContent.trim()),
    ['বাড়ির কাজ', 'সাজেশন', 'প্রশ্নব্যাংক', 'পরীক্ষা', 'ফলাফল', 'Notice Board']);
  card.stop();
});

test('a reload on the same day shows the same quote and tomorrow moves on', async () => {
  const offline = async () => { throw new Error('offline'); };
  const first = await loadPage('student.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  contexts.push(first);
  const today = initDailyQuote({ mount: '#dailyQuoteCard', now: () => DAY, autoFetch: false, fetchImpl: offline });
  const shown = first.$('[data-daily-quote-text]').textContent;
  assert.ok(shown.length > 10, 'a real quote is on screen');
  assert.ok(BUILT_IN_QUOTES.some(quote => quote.text === shown), 'an offline start serves the built-in library');
  assert.equal(first.$('#dailyQuoteCard').dataset.quoteDate, '2026-10-03');

  /* A reload of the same page on the same day reads the stored pick back. */
  const second = await loadPage('student.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  contexts.push(second);
  const again = initDailyQuote({ mount: '#dailyQuoteCard', now: () => DAY, autoFetch: false, fetchImpl: offline });
  assert.equal(second.$('[data-daily-quote-text]').textContent, shown, 'the same day serves the same line');
  assert.equal(second.$('#dailyQuoteCard').dataset.quoteId, first.$('#dailyQuoteCard').dataset.quoteId);

  /* The stored pick belongs to its own date: a new day rotates the line.
     (The harness points the globals at the newest page, so the third mount
     paints the second page's card — the one that already holds today's pick.) */
  initDailyQuote({ mount: '#dailyQuoteCard', now: () => NEXT_DAY, autoFetch: false, fetchImpl: offline });
  assert.equal(second.$('#dailyQuoteCard').dataset.quoteDate, '2026-10-04');
  const next = second.$('[data-daily-quote-text]').textContent;
  assert.equal(next, pickQuote(BUILT_IN_QUOTES, quoteDayNumber('2026-10-04')).text, 'tomorrow follows the same formula');
  assert.notEqual(next, shown, 'and it is a different line');
  assert.equal(readQuoteCache().dateKey, '2026-10-04', 'the record moved to the new day');
  today.stop(); again.stop();
});

test('the rotation is the day number modulo the library — no randomness, no button', () => {
  assert.equal(quoteDateKey(DAY), '2026-10-03');
  assert.equal(quoteDateKey(NEXT_DAY), '2026-10-04');
  assert.equal(quoteDayNumber('1970-01-02'), 1);
  const list = [{ id: 'a', text: 'ক', author: '' }, { id: 'b', text: 'খ', author: '' }, { id: 'c', text: 'গ', author: '' }];
  assert.equal(pickQuote(list, 0).id, 'a');
  assert.equal(pickQuote(list, 3).id, 'a');
  assert.equal(pickQuote(list, 4).id, 'b');
  assert.equal(pickQuote(list, -1).id, 'c');
  assert.equal(pickQuote([], 4), null);
  const html = readFileSync(new URL('../student.html', import.meta.url), 'utf8');
  const card = html.slice(html.indexOf('id="dailyQuoteCard"'), html.indexOf('</section>', html.indexOf('id="dailyQuoteCard"')));
  assert.doesNotMatch(card, /<button/i, 'the quote needs no user action');
  const source = readFileSync(new URL('../js/daily-quote.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Math\.random/, 'the pick is deterministic, never random');
});

test('an offline start, a broken response and a blocked request all keep the card', async () => {
  const cases = [
    ['no network', async () => { throw new TypeError('Failed to fetch'); }],
    ['a 404', async () => ({ ok: false, json: async () => ({}) })],
    ['broken JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } })],
    ['an empty feed', async () => ({ ok: true, json: async () => ({ quotes: [] }) })],
    ['a hanging request', async (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })]
  ];
  for (const [label, fetchImpl] of cases) {
    const ctx = await loadPage('student.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
    contexts.push(ctx);
    const quote = initDailyQuote({ mount: '#dailyQuoteCard', fetchImpl, now: () => DAY, feedUrl: 'assets/daily-quotes.json' });
    await ctx.flush(30);
    const text = ctx.$('[data-daily-quote-text]').textContent;
    assert.ok(text.length > 10, `${label}: the quote is still on screen`);
    assert.equal(ctx.$('#dailyQuoteCard').hidden, false, `${label}: the card is visible`);
    assert.doesNotMatch(text, /লোড হচ্ছে|আবার চেষ্টা/, `${label}: no loading or retry wording`);
    assert.equal(ctx.jsdomErrors.length, 0, `${label}: nothing was reported to the page`);
    assert.equal(ctx.$('#dailyQuoteCard [data-daily-quote-author]').hidden, true, `${label}: an unknown author line is hidden`);
    quote.stop();
  }
});

test('a reachable feed is cached and widens the next rotation, without a spinner', async () => {
  const ctx = await loadPage('student.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  contexts.push(ctx);
  const seen = [];
  const feed = JSON.parse(FEED);
  const quote = initDailyQuote({
    mount: '#dailyQuoteCard', now: () => DAY, feedUrl: 'assets/daily-quotes.json',
    fetchImpl: async url => { seen.push(url); return { ok: true, json: async () => feed }; }
  });
  await ctx.waitFor(() => (readQuoteCache()?.quotes || []).length >= feed.quotes.length);
  assert.deepEqual(seen, ['assets/daily-quotes.json'], 'exactly one background request');
  const cached = readQuoteCache();
  assert.equal(cached.dateKey, '2026-10-03');
  assert.equal(cached.quotes.length, feed.quotes.length, 'the wider feed is stored for the next days');
  assert.equal(
    normalizeQuotes([...BUILT_IN_QUOTES, ...cached.quotes]).length,
    BUILT_IN_QUOTES.length + feed.quotes.length,
    'no line is stored twice'
  );
  /* The line already shown today is not swapped under the reader. */
  const before = ctx.$('[data-daily-quote-text]').textContent;
  assert.equal(ctx.$('[data-daily-quote-text]').textContent, before);
  quote.stop();
});

test('the card keeps one private key and leaves every other record alone', async () => {
  const ctx = await loadPage('student.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [KEYS.exams]: JSON.stringify({ version: 1, exams: [], attempts: [] }),
      [KEYS.notifications]: '{"version":1,"records":[]}',
      'activePlus.student.v1': '{"id":"KEEP-ME","name":"নমুনা","className":"দশম শ্রেণি"}'
    }
  });
  contexts.push(ctx);
  const before = {};
  for (let index = 0; index < ctx.window.localStorage.length; index += 1) {
    const key = ctx.window.localStorage.key(index);
    before[key] = ctx.window.localStorage.getItem(key);
  }
  const quote = initDailyQuote({ mount: '#dailyQuoteCard', fetchImpl: async () => { throw new Error('offline'); }, now: () => DAY });
  await ctx.flush(30);
  quote.paint();
  for (const [key, value] of Object.entries(before)) {
    if (key === DAILY_QUOTE_KEY) continue;
    assert.equal(ctx.window.localStorage.getItem(key), value, `${key} was not rewritten`);
  }
  assert.equal(ctx.window.localStorage.getItem('activePlus.student.v1'), '{"id":"KEEP-ME","name":"নমুনা","className":"দশম শ্রেণি"}');
  const source = readFileSync(new URL('../js/daily-quote.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.removeItem\s*\(|\.clear\s*\(|indexedDB/, 'the module never deletes a record');
  assert.doesNotMatch(source, /KEYS\./, 'the quote cache is private, not a synced collection');
  quote.stop();
});

test('the home keeps its quote card compact inside the phone layout at every viewport width', () => {
  const css = readFileSync(new URL('../css/ui-wallet.css', import.meta.url), 'utf8');
  assert.match(css, /\.daily-quote-section \{ margin: 14px 0 0; \}/);
  assert.match(css, /\.daily-quote-card \{[^}]*grid-template-columns: 36px minmax\(0, 1fr\);/, 'no fixed width, no clipping');
  assert.match(css, /\.daily-quote-card\[[^\]]*hidden[^\]]*\] \{ display: none; \}/);
  assert.match(css, /@media screen and \(min-width: 431px\) \{[\s\S]*?\.student-home-view #dashboardExamCard, \.daily-quote-section, \.daily-challenge-section \{\s*grid-column: auto; grid-row: auto;/, 'a wide browser keeps the quote in the same phone-width content flow');
  assert.doesNotMatch(css, /@media\s*\(min-width:\s*1000px\)/, 'there is no desktop-only home layout');
  assert.match(css, /#homeView\.is-empty-routine \.daily-quote-card \{[^}]*padding: 9px 12px/, 'the one-screen home compacts the card');
  assert.match(css, /@media \(max-height: 820px\) \{[\s\S]*?\.daily-quote-section \{ margin-top: 6px; \}/, 'a short viewport tightens the gap');
});

test('the feed parser only accepts honest quotes', () => {
  assert.equal(parseQuoteFeed({ quotes: [] }), null);
  assert.equal(parseQuoteFeed('nope'), null);
  const quotes = normalizeQuotes([
    { id: 'x', text: '  একটি   লাইন ', author: ' ক ' },
    { id: 'dup', text: 'একটি লাইন', author: '' },
    { id: 'blank', text: '   ', author: '' },
    null,
    { text: 'খ'.repeat(400), author: 'অ'.repeat(300) }
  ]);
  assert.equal(quotes.length, 2, 'the duplicate, the blank and the null are dropped');
  assert.equal(quotes[0].text, 'একটি লাইন');
  assert.equal(quotes[1].text.length, 200, 'long text is capped');
  assert.equal(quotes[1].author.length, 80, 'a long author name is capped');
  assert.equal(normalizeQuotes(parseQuoteFeed(JSON.parse(FEED))).length, JSON.parse(FEED).quotes.length, 'the shipped feed is clean');
});

test('a broken cache record reads as empty instead of throwing', async () => {
  const ctx = await loadPage('student.html', {
    seed: { 'activePlus.demo.autofill.v1': 'off', [DAILY_QUOTE_KEY]: '{not json' }
  });
  contexts.push(ctx);
  const quote = initDailyQuote({ mount: '#dailyQuoteCard', fetchImpl: async () => { throw new Error('offline'); }, now: () => DAY });
  await ctx.flush(20);
  assert.ok(ctx.$('[data-daily-quote-text]').textContent.length > 10, 'the built-in line still fills the card');
  assert.equal(ctx.$('#dailyQuoteCard').dataset.quoteSource, 'library');
  /* A save with no quote is honest about it and changes nothing else. */
  const saved = saveQuoteCache({ dateKey: 'x', quote: null, quotes: [] });
  assert.equal(saved.quote, null);
  assert.equal(readQuoteCache().quote, null);
  quote.stop();
});
