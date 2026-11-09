/* Student-only daily selection for the existing four-slide Home carousel.
   A Dhaka calendar date picks the featured slide; the selection updates again
   at midnight or when a hidden tab becomes visible. */
import { STUDENT_HOME_HERO_SLIDES } from './student-home-hero-entry.js?v=480';
import { pickHeroMessage } from './home-hero.js?v=480';
import {
  BUILT_IN_QUOTES, pickQuote, quoteDateKey, quoteDayNumber, readQuoteCache
} from './daily-quote.js';

const DEFAULT_SLIDE_COUNT = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export function studentDailyHeroIndex(now = Date.now(), slideCount = DEFAULT_SLIDE_COUNT) {
  const supplied = now instanceof Date ? now.getTime() : Number(now);
  const timestamp = Number.isFinite(supplied) ? supplied : Date.now();
  const count = Math.max(1, Math.trunc(Number(slideCount) || DEFAULT_SLIDE_COUNT));
  const day = quoteDayNumber(quoteDateKey(timestamp));
  return ((day % count) + count) % count;
}

/** Uses the same offline-first daily quote data as the hidden legacy renderer. */
export function studentDailyQuoteForDate(dateKey, cached = readQuoteCache()) {
  const key = String(dateKey || quoteDateKey());
  if (cached?.dateKey === key && cached.quote?.text) return cached.quote;
  const library = Array.isArray(cached?.quotes) && cached.quotes.length > 1
    ? cached.quotes
    : BUILT_IN_QUOTES;
  return pickQuote(library, quoteDayNumber(key)) || BUILT_IN_QUOTES[0];
}

function formatDhakaDate(now) {
  try {
    return new Intl.DateTimeFormat('bn-BD', {
      timeZone: 'Asia/Dhaka', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('bn-BD', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(now);
  }
}

function delayUntilNextDhakaDate(now, dateKey = quoteDateKey(now)) {
  let low = now;
  let span = DAY_MS;
  let high = now + span;
  for (let attempt = 0; quoteDateKey(high) === dateKey && attempt < 4; attempt += 1) {
    span *= 2;
    high = now + span;
  }
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (quoteDateKey(middle) === dateKey) low = middle;
    else high = middle;
  }
  return Math.max(1000, high - now + 25);
}

const isDocumentHidden = documentRef => documentRef.visibilityState === 'hidden' || documentRef.hidden;

/** Selects today's featured slide without changing the carousel's copy or controls. */
export function initStudentDailyHero(rootOrSelector, options = {}) {
  const root = typeof rootOrSelector === 'string'
    ? globalThis.document?.querySelector(rootOrSelector)
    : rootOrSelector;
  const documentRef = root?.ownerDocument || globalThis.document;
  const view = documentRef?.defaultView || globalThis;
  if (!root || !documentRef || root.dataset.studentDailyHeroReady === '1') {
    return { refresh() {}, stop() {} };
  }

  const slides = [...root.querySelectorAll('[data-hero-slide]')];
  const nextButton = root.querySelector('[data-hero-next]');
  const dateNode = root.querySelector('[data-home-hero-date]');
  const context = root.querySelector('[data-home-hero-context]');
  if (slides.length < 2 || !nextButton || !context) return { refresh() {}, stop() {} };

  let quoteBox = context.querySelector('[data-student-daily-quote]');
  if (!quoteBox) {
    quoteBox = documentRef.createElement('div');
    quoteBox.className = 'student-home-daily-quote';
    quoteBox.dataset.studentDailyQuote = '';
    quoteBox.setAttribute('aria-live', 'polite');
    quoteBox.setAttribute('aria-atomic', 'true');
    const quoteText = documentRef.createElement('span');
    quoteText.className = 'student-home-daily-quote__text';
    quoteText.dataset.studentDailyQuoteText = '';
    const quoteAuthor = documentRef.createElement('small');
    quoteAuthor.className = 'student-home-daily-quote__author';
    quoteAuthor.dataset.studentDailyQuoteAuthor = '';
    quoteBox.append(quoteText, quoteAuthor);
    context.append(quoteBox);
  }
  const quoteTextNode = quoteBox.querySelector('[data-student-daily-quote-text]');
  const quoteAuthorNode = quoteBox.querySelector('[data-student-daily-quote-author]');

  const readNow = () => {
    const supplied = typeof options.now === 'function' ? options.now() : Date.now();
    const timestamp = supplied instanceof Date ? supplied.getTime() : Number(supplied);
    return Number.isFinite(timestamp) ? timestamp : Date.now();
  };
  let activeDateKey = '';
  let timer = 0;
  let stopped = false;
  root.dataset.studentDailyHeroReady = '1';

  function refresh(now = readNow()) {
    const dateKey = quoteDateKey(now);
    if (dateNode) {
      dateNode.textContent = formatDhakaDate(new Date(now));
      dateNode.dateTime = dateKey;
    }
    if (dateKey === activeDateKey) return false;

    activeDateKey = dateKey;
    const dailyQuote = studentDailyQuoteForDate(dateKey);
    if (quoteTextNode) quoteTextNode.textContent = dailyQuote.text;
    if (quoteAuthorNode) {
      quoteAuthorNode.textContent = dailyQuote.author ? `— ${dailyQuote.author}` : '';
      quoteAuthorNode.hidden = !dailyQuote.author;
    }
    root.dataset.dailyHeroQuoteId = dailyQuote.id || '';

    const targetIndex = studentDailyHeroIndex(now, slides.length);
    const currentIndex = Math.max(0, slides.findIndex(slide => slide.classList.contains('is-active')));
    slides.forEach((slide, index) => {
      const spec = STUDENT_HOME_HERO_SLIDES.find(item => item.id === slide.dataset.heroId)
        || STUDENT_HOME_HERO_SLIDES[index];
      const descNode = slide.querySelector('[data-hero-description]');
      if (descNode && spec) descNode.textContent = pickHeroMessage(spec, now);
      const image = slide.querySelector('img');
      if (!image) return;
      const selected = index === targetIndex;
      image.setAttribute('loading', selected ? 'eager' : 'lazy');
      if (selected) image.setAttribute('fetchpriority', 'high');
      else image.removeAttribute('fetchpriority');
    });

    const forwardSteps = (targetIndex - currentIndex + slides.length) % slides.length;
    for (let step = 0; step < forwardSteps; step += 1) nextButton.click();
    root.dataset.dailyHeroDate = dateKey;
    root.dataset.dailyHeroSlide = slides[targetIndex].dataset.heroId || '';
    /* The featured slide also sets the card's finish: today's slide owns the
       accent, wash, border and decoration (css/hero-cards.css), so the whole
       hero looks different each day while the four illustrations and titles
       stay exactly as approved. Swiping to another slide changes only the
       message — the day's design belongs to the day. */
    root.dataset.heroDesign = root.dataset.dailyHeroSlide || '';
    return true;
  }

  function clearTimer() {
    if (timer) view.clearTimeout(timer);
    timer = 0;
  }

  function schedule() {
    clearTimer();
    if (stopped || isDocumentHidden(documentRef)) return;
    const now = readNow();
    const dateKey = quoteDateKey(now);
    if (dateKey !== activeDateKey) refresh(now);
    if (stopped || isDocumentHidden(documentRef)) return;
    timer = view.setTimeout(() => {
      timer = 0;
      if (isDocumentHidden(documentRef)) return;
      refresh(readNow());
      schedule();
    }, delayUntilNextDhakaDate(now, dateKey));
  }

  const onVisibilityChange = () => {
    if (isDocumentHidden(documentRef)) clearTimer();
    else {
      refresh(readNow());
      schedule();
    }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    documentRef.removeEventListener('visibilitychange', onVisibilityChange);
    view.removeEventListener?.('pagehide', stop);
  };

  documentRef.addEventListener('visibilitychange', onVisibilityChange);
  view.addEventListener?.('pagehide', stop, { once: true });
  refresh(readNow());
  schedule();

  return { refresh, stop };
}

if (typeof document !== 'undefined') {
  for (const root of document.querySelectorAll('[data-student-home-hero]')) {
    initStudentDailyHero(root);
  }
}
