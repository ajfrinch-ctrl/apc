/* The Student home hero (with a retained legacy counter mount). The first
   slide is today's advice; the next three echo summary, today's work and quick actions. */
import { createAdviceStore, DAILY_ADVICE_FALLBACK } from './daily-advice.js';
import { quoteDateKey } from './daily-quote.js';

export const HERO_FIRST_DELAY_MS = 8000;
export const HERO_AUTOPLAY_MS = 6000;
export const HERO_TRANSITION_MS = 400;

const SLIDE_COPY = Object.freeze([
  { id: 'advice', eyebrow: 'আজকের উপদেশ', title: 'আজকের পরামর্শ', image: 'advice' },
  { id: 'summary', eyebrow: 'এক নজরে', title: 'আজকের সারাংশ', image: 'study' },
  { id: 'today', eyebrow: 'আজকের কাজ', title: 'আজকের ক্লাস ও কাজ', image: 'class' },
  { id: 'quick', eyebrow: 'দ্রুত কাজ', title: 'প্রয়োজনীয় কাজ', image: 'library' }
]);

const ART_PATHS = Object.freeze({
  study: ['assets/home-hero/hero-study.avif', 'assets/home-hero/hero-study.webp'],
  class: ['assets/home-hero/hero-class.avif', 'assets/home-hero/hero-class.webp'],
  library: ['assets/home-hero/hero-library.avif', 'assets/home-hero/hero-library.webp'],
  advice: ['assets/home-hero/hero-advice.avif', 'assets/home-hero/hero-advice.webp']
});
const bnNumber = value => String(value).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]);

function formatDhakaDate(now = new Date()) {
  try {
    return new Intl.DateTimeFormat('bn-BD', {
      timeZone: 'Asia/Dhaka', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('bn-BD', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  }
}

function needsLowMotion(view) {
  const navigator = view?.navigator || globalThis.navigator;
  const connection = navigator?.connection || navigator?.mozConnection || navigator?.webkitConnection;
  return Boolean(connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType) ||
    (Number(navigator?.deviceMemory) > 0 && Number(navigator.deviceMemory) <= 2) ||
    (Number(navigator?.hardwareConcurrency) > 0 && Number(navigator.hardwareConcurrency) <= 2));
}

function createElement(documentRef, tag, className, text = '') {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function ensureContext(root, documentRef) {
  let context = root.querySelector('[data-home-hero-context]');
  if (!context) {
    context = createElement(documentRef, 'div', 'hero-slider__context');
    context.dataset.homeHeroContext = '';
    const date = createElement(documentRef, 'time', 'hero-slider__date');
    date.dataset.homeHeroDate = '';
    context.append(date);
  }
  context.classList.add('hero-slider__context');
  if (!context.querySelector('[data-home-hero-date]')) {
    const date = createElement(documentRef, 'time', 'hero-slider__date');
    date.dataset.homeHeroDate = '';
    context.append(date);
  }
  let stage = root.querySelector('[data-home-hero-slides]');
  if (!stage) {
    stage = createElement(documentRef, 'div', 'hero-slider__slides');
    stage.dataset.homeHeroSlides = '';
  }
  let transcript = root.querySelector('[data-home-hero-transcript]');
  if (!transcript) {
    transcript = createElement(documentRef, 'ol', 'hero-slider__transcript');
    transcript.dataset.homeHeroTranscript = '';
    transcript.setAttribute('aria-label', 'আজকের তথ্য');
  }
  // Keep the role-specific ID hooks, but remove the old generated carousel UI.
  root.replaceChildren(context, stage, transcript);
  return { context, stage, transcript };
}

function createSlide(documentRef, spec) {
  const slide = createElement(documentRef, 'article', `hero-slide hero-slide--${spec.id}`);
  slide.dataset.heroSlide = '';
  slide.dataset.heroId = spec.id;
  slide.setAttribute('aria-hidden', 'true');

  const picture = createElement(documentRef, 'picture', 'hero-slide__art');
  picture.setAttribute('aria-hidden', 'true');
  const [avif, webp] = ART_PATHS[spec.image];
  const source = createElement(documentRef, 'source');
  source.type = 'image/avif';
  source.srcset = avif;
  const image = createElement(documentRef, 'img');
  image.src = webp;
  image.width = 1080;
  image.height = 600;
  image.alt = '';
  image.decoding = 'async';
  image.loading = 'lazy';
  picture.append(source, image);

  const copy = createElement(documentRef, 'div', 'hero-slide__copy');
  copy.append(createElement(documentRef, 'span', 'hero-slide__eyebrow', spec.eyebrow));
  copy.append(createElement(documentRef, 'h2', '', spec.title));
  const description = createElement(documentRef, 'p', 'hero-slide__description');
  description.dataset.heroDescription = '';
  copy.append(description);
  if (spec.id === 'advice') {
    const attribution = createElement(documentRef, 'small', 'hero-slide__source');
    attribution.dataset.heroSource = '';
    copy.append(attribution);
  }
  slide.append(picture, copy);
  image.addEventListener('error', () => slide.classList.add('has-art-fallback'), { once: true });
  return slide;
}

function textOf(node, max = 140) {
  return String(node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function summaryText(documentRef) {
  const host = documentRef.querySelector('[data-hero-summary]');
  if (!host) return 'নিচের সারাংশ কার্ডে সর্বশেষ হিসাব দেখুন।';
  const cards = [...host.querySelectorAll('.admin-stat-tile, .teacher-home-summary > div, .study-progress-stats > div')];
  const values = cards.slice(0, 3).map(card => {
    const label = textOf(card.querySelector('.tile-label, small, span'));
    const value = textOf(card.querySelector('.tile-value, strong'));
    return [label, value].filter(Boolean).join(' ');
  }).filter(Boolean);
  return values.length ? values.join(' · ') : textOf(host, 120) || 'নিচের সারাংশ কার্ডে সর্বশেষ হিসাব দেখুন।';
}

function todayText(documentRef) {
  const host = documentRef.querySelector('[data-hero-today]');
  if (!host) return 'আজকের কাজ ও পরিচালনার তথ্য হোমের নিচে রয়েছে।';
  const first = host.querySelector('.teacher-home-class, .dashboard-empty-card, .dashboard-routine-row, article, p') || host;
  return textOf(first, 120) || textOf(host, 120) || 'আজকের ক্লাস ও কাজের তথ্য নিচে রয়েছে।';
}

function quickText(documentRef) {
  const host = documentRef.querySelector('[data-hero-quick]');
  if (!host) return 'প্রয়োজনীয় কাজের টাইলগুলো হোমে রয়েছে।';
  const count = host.querySelectorAll('button, a').length;
  return count ? `নিচে ${bnNumber(count)}টি দ্রুত কাজের টাইল আছে।` : 'প্রয়োজনীয় কাজের টাইলগুলো হোমে রয়েছে।';
}

function setDescription(slides, id, text) {
  const target = slides.querySelector(`[data-hero-id="${id}"] [data-hero-description]`);
  if (target) target.textContent = text;
}

function updateTranscript(transcript, advice, documentRef) {
  const rows = [
    `আজকের উপদেশ: ${advice.text}। উৎস: ${advice.source || DAILY_ADVICE_FALLBACK.source}`,
    `আজকের সারাংশ: ${summaryText(documentRef)}`,
    `আজকের ক্লাস ও কাজ: ${todayText(documentRef)}`,
    `দ্রুত কাজ: ${quickText(documentRef)}`
  ];
  transcript.replaceChildren(...rows.map(text => createElement(documentRef, 'li', '', text)));
}

/** Mounts the Student home hero; payment keeps its legacy mount separately. */
export function initHomeHero(rootOrSelector, {
  autoConnect = true,
  adviceStoreFactory = createAdviceStore
} = {}) {
  const root = typeof rootOrSelector === 'string' ? document.querySelector(rootOrSelector) : rootOrSelector;
  if (!root || root.dataset.heroReady === '1') return { stop() {}, show() {} };
  const documentRef = root.ownerDocument || globalThis.document;
  const view = documentRef?.defaultView || globalThis;
  if (!documentRef) return { stop() {}, show() {} };
  root.dataset.heroReady = '1';
  root.classList.add('hero-slider');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'আজকের তথ্য');
  root.setAttribute('aria-live', 'off');
  root.removeAttribute('aria-roledescription');
  root.removeAttribute('tabindex');

  const { stage, transcript } = ensureContext(root, documentRef);
  stage.classList.add('hero-slider__slides');
  stage.setAttribute('aria-hidden', 'true');
  transcript.classList.add('hero-slider__transcript');
  stage.replaceChildren(...SLIDE_COPY.map(spec => createSlide(documentRef, spec)));
  const adviceSlide = stage.querySelector('[data-hero-id="advice"]');
  const adviceText = adviceSlide?.querySelector('[data-hero-description]');
  const adviceSource = adviceSlide?.querySelector('[data-hero-source]');
  let advice = { ...DAILY_ADVICE_FALLBACK };
  let active = 0;
  let timer = 0;
  let stopped = false;
  let pressed = false;
  let hovering = false;
  let outsideViewport = false;
  let reducedMotion = Boolean(view.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  const noAnimation = needsLowMotion(view);
  root.classList.toggle('is-no-motion', noAnimation);

  const dateNodes = [...root.querySelectorAll('[data-home-hero-date]')];
  function updateDate(now = new Date()) {
    const key = quoteDateKey(now.getTime());
    const label = formatDhakaDate(now);
    dateNodes.forEach(node => {
      node.textContent = label;
      if (node.tagName === 'TIME') node.dateTime = key;
    });
  }
  updateDate();

  function enabledSlides() {
    return [...stage.querySelectorAll('[data-hero-slide]:not([hidden])')];
  }
  function setActive(index) {
    const slides = enabledSlides();
    if (!slides.length) return;
    active = ((Number(index) % slides.length) + slides.length) % slides.length;
    slides.forEach((slide, slot) => {
      const selected = slot === active;
      slide.classList.toggle('is-active', selected);
      slide.setAttribute('aria-hidden', String(!selected));
    });
    root.classList.toggle('is-static', slides.length < 2 || reducedMotion);
  }
  function clearTimer() {
    if (timer) view.clearTimeout(timer);
    timer = 0;
  }
  function canAdvance() {
    return !stopped && !reducedMotion && !pressed && !hovering && !outsideViewport &&
      documentRef.visibilityState !== 'hidden' && !documentRef.hidden && enabledSlides().length > 1;
  }
  function schedule() {
    clearTimer();
    if (!canAdvance()) return;
    timer = view.setTimeout(() => {
      if (!canAdvance()) { schedule(); return; }
      setActive(active + 1);
      schedule();
    }, active === 0 ? HERO_FIRST_DELAY_MS : HERO_AUTOPLAY_MS);
  }
  function refreshDescriptions() {
    setDescription(stage, 'summary', summaryText(documentRef));
    setDescription(stage, 'today', todayText(documentRef));
    setDescription(stage, 'quick', quickText(documentRef));
    updateTranscript(transcript, advice, documentRef);
  }
  function setAdvice(value) {
    advice = {
      text: String(value?.text || DAILY_ADVICE_FALLBACK.text),
      source: String(value?.source || DAILY_ADVICE_FALLBACK.source)
    };
    if (adviceText) adviceText.textContent = advice.text;
    if (adviceSource) adviceSource.textContent = advice.source;
    updateTranscript(transcript, advice, documentRef);
  }
  function applyMotionPreference(value) {
    reducedMotion = Boolean(value);
    root.classList.toggle('is-reduced-motion', reducedMotion);
    stage.querySelectorAll('[data-hero-slide]').forEach(slide => {
      slide.hidden = reducedMotion && slide.dataset.heroId !== 'advice';
    });
    setActive(0);
    schedule();
  }

  setAdvice(advice);
  refreshDescriptions();
  applyMotionPreference(reducedMotion);

  const store = adviceStoreFactory({
    autoConnect,
    onChange(state) {
      setAdvice(state?.advice || DAILY_ADVICE_FALLBACK);
      if (state?.dateKey) {
        const midday = new Date(`${state.dateKey}T06:00:00Z`);
        updateDate(midday);
      }
    }
  });

  const mutationObserver = typeof view.MutationObserver === 'function'
    ? new view.MutationObserver(refreshDescriptions)
    : null;
  for (const host of documentRef.querySelectorAll('[data-hero-summary], [data-hero-today], [data-hero-quick]')) {
    mutationObserver?.observe(host, { subtree: true, childList: true, characterData: true });
  }

  const visibilityChange = () => {
    if (documentRef.visibilityState !== 'hidden') updateDate();
    schedule();
  };
  documentRef.addEventListener('visibilitychange', visibilityChange);
  const motionQuery = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const motionChange = event => applyMotionPreference(event.matches);
  if (typeof motionQuery?.addEventListener === 'function') motionQuery.addEventListener('change', motionChange);
  else motionQuery?.addListener?.(motionChange);

  const pointerDown = () => { pressed = true; schedule(); };
  const pointerRelease = () => { pressed = false; schedule(); };
  const pointerEnter = event => {
    if (event.pointerType === 'mouse' || event.type === 'mouseenter') { hovering = true; schedule(); }
  };
  const pointerLeave = event => {
    if (event.pointerType === 'mouse' || event.type === 'mouseleave') { hovering = false; schedule(); }
  };
  root.addEventListener('pointerdown', pointerDown, { passive: true });
  documentRef.addEventListener('pointerup', pointerRelease, { passive: true });
  documentRef.addEventListener('pointercancel', pointerRelease, { passive: true });
  root.addEventListener('pointerenter', pointerEnter, { passive: true });
  root.addEventListener('pointerleave', pointerLeave, { passive: true });
  root.addEventListener('mouseenter', pointerEnter, { passive: true });
  root.addEventListener('mouseleave', pointerLeave, { passive: true });

  let intersectionObserver = null;
  let scrollFallback = null;
  if (typeof view.IntersectionObserver === 'function') {
    intersectionObserver = new view.IntersectionObserver(entries => {
      outsideViewport = !entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0);
      schedule();
    }, { threshold: 0.01 });
    intersectionObserver.observe(root);
  } else {
    scrollFallback = () => {
      const rect = root.getBoundingClientRect();
      outsideViewport = rect.bottom <= 0 || rect.top >= view.innerHeight;
      schedule();
    };
    view.addEventListener?.('scroll', scrollFallback, { passive: true });
    view.addEventListener?.('resize', scrollFallback, { passive: true });
    scrollFallback();
  }

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    store.stop?.();
    mutationObserver?.disconnect();
    intersectionObserver?.disconnect();
    if (scrollFallback) {
      view.removeEventListener?.('scroll', scrollFallback);
      view.removeEventListener?.('resize', scrollFallback);
    }
    documentRef.removeEventListener('visibilitychange', visibilityChange);
    documentRef.removeEventListener('pointerup', pointerRelease);
    documentRef.removeEventListener('pointercancel', pointerRelease);
    root.removeEventListener('pointerdown', pointerDown);
    root.removeEventListener('pointerenter', pointerEnter);
    root.removeEventListener('pointerleave', pointerLeave);
    root.removeEventListener('mouseenter', pointerEnter);
    root.removeEventListener('mouseleave', pointerLeave);
    if (typeof motionQuery?.removeEventListener === 'function') motionQuery.removeEventListener('change', motionChange);
    else motionQuery?.removeListener?.(motionChange);
  };
  view.addEventListener?.('pagehide', stop, { once: true });
  return { stop, show: setActive, store };
}
