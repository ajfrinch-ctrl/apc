/* hero-cards.js — Student-only decorative SVG art for existing cards.
   All artwork is inline and offline; no card content, data or routes are owned here. */

const $ = (selector, root = document) => root.querySelector(selector);
const reduceQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;
let reducedMotion = Boolean(reduceQuery?.matches);

const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" aria-hidden="true" focusable="false">${inner}</svg>`;
const delayClass = seconds => seconds ? ` hc-delay-${Math.round(seconds * 10)}` : '';
const star = (x, y, radius, delay = 0) =>
  `<circle class="hc-tw${delayClass(delay)}" cx="${x}" cy="${y}" r="${radius}" fill="#fff"/>`;
const orbit = (rotation, seconds) =>
  `<g transform="rotate(${rotation} 40 40)"><ellipse cx="40" cy="40" rx="30" ry="11" fill="none" stroke="#9FE1CB" stroke-width="1.5"/>` +
  `<circle r="3.2" fill="#fff" stroke="none"><animateMotion dur="${seconds}s" repeatCount="indefinite" path="M10,40 a30,11 0 1,0 60,0 a30,11 0 1,0 -60,0"/></circle></g>`;
const book = () =>
  `<path d="M8 60 Q24 52 40 60 V32 Q24 24 8 32z" fill="#fff" fill-opacity=".94"/>` +
  `<path d="M72 60 Q56 52 40 60 V32 Q56 24 72 32z" fill="#fff" fill-opacity=".76"/>` +
  `<path d="M40 34v27" stroke="#9FE1CB" stroke-width="2"/>`;

/* Subject precedence matters for compound labels such as “বাংলাদেশ ও বিশ্বপরিচয়”. */
const RULES = Object.freeze([
  Object.freeze(['geography', /বাংলাদেশ|বিশ্ব|ভূগোল|ইতিহাস|সমাজ|পরিবেশ|bangladesh|global\s*studies|civics|geograph|history|social/i]),
  Object.freeze(['ict', /ict|আইসিটি|তথ্য\s*(?:ও|&)?\s*(?:যোগাযোগ|প্রযুক্তি)|কম্পিউটার|প্রযুক্তি|computer/i]),
  Object.freeze(['economics', /অর্থনীতি|হিসাব|ব্যবসায়|ব্যবসায়|ফিন্যান্স|ফিনান্স|ব্যাংকিং|econom|account|business|finance|commerce/i]),
  Object.freeze(['chemistry', /রসায়ন|রসায়ন|chemistry/i]),
  Object.freeze(['biology', /জীব|উদ্ভিদ|প্রাণী|biology|botany|zoology/i]),
  Object.freeze(['physics', /পদার্থ|physics/i]),
  Object.freeze(['math', /গণিত|পরিসংখ্যান|math|statistic|algebra|geometry/i]),
  Object.freeze(['english', /ইংরেজি|english/i]),
  Object.freeze(['bangla', /বাংলা|ব্যাকরণ|সাহিত্য|bangla|bengali/i])
]);

const COLOR = Object.freeze({
  physics: '#0F6E56', chemistry: '#3C3489', biology: '#3B6D11', math: '#993C1D',
  bangla: '#993556', english: '#185FA5', ict: '#085041', geography: '#854F0B',
  economics: '#534AB7', default: '#0F6E56'
});
const ART_KEY = Object.freeze({ geography: 'globe', economics: 'economics' });

function detect(text) {
  const value = String(text || '').normalize('NFC');
  for (const [subject, pattern] of RULES) if (pattern.test(value)) return subject;
  return 'default';
}

function artForText(text) {
  const subject = detect(text);
  const key = ART_KEY[subject] || subject;
  return ART[key] || ART.default;
}

function colorForText(text) {
  return COLOR[detect(text)] || COLOR.default;
}

/* ---------- offline inline SVG library ---------- */
const ART = {
  /* Match the supplied reference art: one sun/cloud for the full day bucket. */
  morning: svg(
    `<g class="hc-spin"><g stroke="#FAC775" stroke-width="3" stroke-linecap="round">` +
    `<line x1="40" y1="6" x2="40" y2="16"/><line x1="40" y1="64" x2="40" y2="74"/>` +
    `<line x1="6" y1="40" x2="16" y2="40"/><line x1="64" y1="40" x2="74" y2="40"/>` +
    `<line x1="16" y1="16" x2="23" y2="23"/><line x1="57" y1="57" x2="64" y2="64"/>` +
    `<line x1="16" y1="64" x2="23" y2="57"/><line x1="57" y1="23" x2="64" y2="16"/></g></g>` +
    `<circle cx="40" cy="40" r="15" fill="#FAC775"/>` +
    `<g class="hc-drift"><ellipse cx="34" cy="62" rx="14" ry="6" fill="#fff"/><ellipse cx="46" cy="58" rx="10" ry="6" fill="#fff"/></g>`
  ),
  noon: svg(
    `<circle class="hc-pulse" cx="40" cy="40" r="27" fill="none" stroke="#FAC775" stroke-width="1.5"/>` +
    `<g class="hc-spin"><g stroke="#FAC775" stroke-width="3" stroke-linecap="round">` +
    `<line x1="40" y1="6" x2="40" y2="16"/><line x1="40" y1="64" x2="40" y2="74"/>` +
    `<line x1="6" y1="40" x2="16" y2="40"/><line x1="64" y1="40" x2="74" y2="40"/>` +
    `<line x1="16" y1="16" x2="23" y2="23"/><line x1="57" y1="57" x2="64" y2="64"/>` +
    `<line x1="16" y1="64" x2="23" y2="57"/><line x1="57" y1="23" x2="64" y2="16"/></g></g>` +
    `<circle cx="40" cy="40" r="15" fill="#FAC775"/>` +
    `<g class="hc-drift"><ellipse cx="34" cy="62" rx="14" ry="6" fill="#fff"/><ellipse cx="46" cy="58" rx="10" ry="6" fill="#fff"/></g>`
  ),
  afternoon: svg(
    `<clipPath id="hcDusk"><rect x="0" y="0" width="80" height="56"/></clipPath>` +
    `<g clip-path="url(#hcDusk)"><g class="hc-rise"><circle cx="40" cy="54" r="20" fill="#F0997B"/></g></g>` +
    `<line x1="6" y1="56" x2="74" y2="56" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` +
    `<line class="hc-tw" x1="22" y1="63" x2="58" y2="63" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` +
    `<line class="hc-tw hc-delay-7" x1="30" y1="69" x2="50" y2="69" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` +
    star(14, 16, 2, 0) + star(66, 22, 2.5, .8)
  ),
  night: svg(
    `<mask id="hcMoon"><rect width="80" height="80" fill="#fff"/><circle cx="50" cy="32" r="17" fill="#000"/></mask>` +
    `<g class="hc-float"><circle cx="36" cy="42" r="22" fill="#FAC775" mask="url(#hcMoon)"/></g>` +
    star(62, 14, 2.5, 0) + star(70, 44, 2, .6) + star(54, 66, 2.5, 1.1) + star(14, 12, 2, .4) + star(12, 66, 2, .9)
  ),
  party: svg(
    `<g class="hc-float"><ellipse cx="26" cy="30" rx="12" ry="15" fill="#F4C0D1"/><path d="M26 45 q-3 12 2 22" fill="none" stroke="#fff" stroke-width="1.5"/></g>` +
    `<g class="hc-float hc-delay-8"><ellipse cx="54" cy="26" rx="11" ry="14" fill="#FAC775"/><path d="M54 40 q3 12 -2 24" fill="none" stroke="#fff" stroke-width="1.5"/></g>` +
    `<rect class="hc-fall" x="12" y="4" width="5" height="5" fill="#9FE1CB"/>` +
    `<rect class="hc-fall hc-delay-10" x="40" y="2" width="5" height="5" fill="#fff"/>` +
    `<rect class="hc-fall hc-delay-19" x="68" y="6" width="5" height="5" fill="#F4C0D1"/>`
  ),

  bulb: svg(
    `<circle class="hc-pulse" cx="40" cy="34" r="26" fill="none" stroke="#FAC775" stroke-width="2"/>` +
    `<g class="hc-float"><circle cx="40" cy="34" r="16" fill="#FAC775"/>` +
    `<rect x="33" y="47" width="14" height="8" rx="2" fill="#D3D1C7"/><rect x="36" y="56" width="8" height="4" rx="2" fill="#B4B2A9"/>` +
    `<path d="M34 32 q6 -8 12 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g>` +
    star(10, 14, 2.5, 0) + star(70, 12, 2, .6) + star(68, 62, 2.5, 1.2) + star(12, 60, 2, .9)
  ),

  rocket: svg(
    `<g class="hc-float"><path d="M40 8 Q55 24 52 46 H28 Q25 24 40 8z" fill="#fff"/><circle cx="40" cy="28" r="5" fill="#185FA5"/>` +
    `<path d="M28 40 L18 56 L28 52z" fill="#FAC775"/><path d="M52 40 L62 56 L52 52z" fill="#FAC775"/>` +
    `<ellipse class="hc-flame" cx="40" cy="52" rx="5" ry="9" fill="#F0997B"/></g>` +
    star(10, 12, 2, 0) + star(70, 20, 2, .7)
  ),

  physics: svg(
    `<g class="hc-spin2">${orbit(0, 3)}${orbit(60, 4)}${orbit(120, 5)}</g>` +
    `<circle class="hc-pulse" cx="40" cy="40" r="7" fill="#FAC775"/>`
  ),
  chemistry: svg(
    `<path d="M32 11h16v20l17 30q4 8-5 8H20q-9 0-5-8l17-30z" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M20 54h40l5 8q4 7-5 7H20q-9 0-5-7z" fill="#9FE1CB"/>` +
    `<path d="M29 11h22" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` +
    `<circle class="hc-bubble" cx="33" cy="52" r="3" fill="#FAC775"/>` +
    `<circle class="hc-bubble hc-delay-9" cx="44" cy="55" r="2.5" fill="#fff"/>` +
    `<circle class="hc-bubble hc-delay-17" cx="51" cy="52" r="3.5" fill="#FAC775"/>`
  ),
  biology: svg(
    `<g class="hc-sway"><path d="M40 60V28" stroke="#9FE1CB" stroke-width="3.5" stroke-linecap="round"/>` +
    `<ellipse cx="29" cy="39" rx="12" ry="5.5" transform="rotate(-30 29 39)" fill="#9FE1CB"/>` +
    `<ellipse cx="51" cy="31" rx="12" ry="5.5" transform="rotate(30 51 31)" fill="#fff"/>` +
    `<circle cx="40" cy="24" r="5" fill="#FAC775"/></g>` +
    `<path d="M27 59h26l-3 15H30z" fill="#FAC775"/><path d="M27 59h26" stroke="#fff" stroke-width="2"/>`
  ),
  math: svg(
    `<text class="hc-float" x="8" y="32" font-size="26" fill="#fff">π</text>` +
    `<text class="hc-float hc-delay-6" x="46" y="26" font-size="26" fill="#FAC775">+</text>` +
    `<text class="hc-float hc-delay-12" x="12" y="68" font-size="26" fill="#9FE1CB">÷</text>` +
    `<text class="hc-float hc-delay-18" x="46" y="68" font-size="26" fill="#fff">√</text>`
  ),
  bangla: svg(
    book() +
    `<text class="hc-float" x="16" y="22" font-size="17" fill="#FAC775">অ</text>` +
    `<text class="hc-float hc-delay-9" x="47" y="17" font-size="17" fill="#9FE1CB">আ</text>`
  ),
  english: svg(
    `<text class="hc-bob" x="40" y="50" text-anchor="middle" font-size="36" fill="#fff">Aa</text>` +
    `<line class="hc-tw" x1="18" y1="60" x2="62" y2="60" stroke="#FAC775" stroke-width="3" stroke-linecap="round"/>` +
    `<text class="hc-float hc-delay-7" x="8" y="20" font-size="14" fill="#FAC775">B</text>` +
    `<text class="hc-float hc-delay-13" x="62" y="18" font-size="14" fill="#9FE1CB">c</text>`
  ),
  ict: svg(
    `<rect x="10" y="12" width="60" height="40" rx="5" fill="#fff" fill-opacity=".12" stroke="#fff" stroke-width="3"/>` +
    `<path d="M34 52v7M46 52v7M24 62h32" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` +
    `<rect class="hc-type" x="18" y="20" width="30" height="4" rx="2" fill="#9FE1CB"/>` +
    `<rect class="hc-type hc-delay-4" x="18" y="29" width="38" height="4" rx="2" fill="#fff"/>` +
    `<rect class="hc-type hc-delay-8" x="18" y="38" width="22" height="4" rx="2" fill="#FAC775"/>` +
    `<rect class="hc-blink hc-delay-8" x="44" y="37" width="4" height="6" fill="#fff"/>`
  ),
  globe: svg(
    `<circle cx="40" cy="40" r="27" fill="none" stroke="#fff" stroke-width="3"/>` +
    `<ellipse class="hc-globe" cx="40" cy="40" rx="11" ry="26" fill="none" stroke="#9FE1CB" stroke-width="2"/>` +
    `<ellipse class="hc-globe hc-delay-25" cx="40" cy="40" rx="21" ry="26" fill="none" stroke="#9FE1CB" stroke-width="2"/>` +
    `<path d="M14 40h52M19 26h42M19 54h42" fill="none" stroke="#fff" stroke-width="1.5"/>` +
    `<circle class="hc-pulse" cx="55" cy="29" r="3.2" fill="#FAC775"/>`
  ),
  economics: svg(
    `<path d="M10 67h60" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` +
    `<rect class="hc-grow" x="14" y="47" width="10" height="20" rx="2" fill="#fff"/>` +
    `<rect class="hc-grow hc-delay-4" x="29" y="37" width="10" height="30" rx="2" fill="#9FE1CB"/>` +
    `<rect class="hc-grow hc-delay-8" x="44" y="42" width="10" height="25" rx="2" fill="#fff"/>` +
    `<rect class="hc-grow hc-delay-12" x="59" y="25" width="10" height="42" rx="2" fill="#FAC775"/>` +
    `<g class="hc-coin"><ellipse cx="22" cy="18" rx="11" ry="7" fill="#FAC775"/><path d="M11 18v5q0 7 11 7t11-7v-5" fill="#FAC775"/><ellipse cx="22" cy="18" rx="11" ry="7" fill="#FAC775"/><text x="22" y="23" text-anchor="middle" font-size="12" fill="#854F0B">৳</text></g>`
  ),
  default: svg(
    book() + star(14, 16, 2.5, 0) + star(66, 14, 2, .6) + star(40, 12, 2, 1.1) +
    `<rect class="hc-float" x="34" y="65" width="12" height="4" rx="2" fill="#FAC775"/>`
  ),

  trophy: svg(
    `<g class="hc-bob"><path d="M27 15h26v19q0 15-13 19-13-4-13-19z" fill="#FAC775"/>` +
    `<path d="M27 20H16v8q0 11 13 12M53 20h11v8q0 11-13 12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M36 53v10M44 53v10M30 65h20" stroke="#fff" stroke-width="4" stroke-linecap="round"/></g>` +
    star(14, 14, 2.4, 0) + star(68, 17, 2.2, .7) + star(66, 63, 2, 1.2)
  ),
  hourglass: svg(
    `<g class="hc-hourglass"><path d="M23 12h34M23 68h34M27 14q0 13 13 24-13 11-13 28M53 14q0 13-13 24 13 11 13 28" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M34 31q6 6 12 0l-6 9zM34 56h12l-6-9z" fill="#FAC775"/><path d="M40 42v7" stroke="#9FE1CB" stroke-width="2" stroke-linecap="round"/></g>` +
    star(14, 18, 2, .3) + star(66, 60, 2.2, 1)
  ),
  liveClock: svg(
    `<circle cx="40" cy="40" r="29" fill="none" stroke="#fff" stroke-width="3"/>` +
    `<path d="M40 16v4M40 60v4M16 40h4M60 40h4" stroke="#9FE1CB" stroke-width="2" stroke-linecap="round"/>` +
    `<g class="hc-minute-hand"><path d="M40 40V19" stroke="#FAC775" stroke-width="3" stroke-linecap="round"/></g>` +
    `<path d="M40 40h13" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="40" cy="40" r="3.4" fill="#FAC775"/>` +
    `<circle class="hc-live-dot" cx="61" cy="18" r="5" fill="#E24B4A"/>`
  ),
  avatarRing: svg(
    `<circle class="hc-avatar-ring" cx="40" cy="40" r="35" fill="none" stroke="#FAC775" stroke-width="2.5"/>` +
    `<circle cx="40" cy="40" r="30" fill="none" stroke="#9FE1CB" stroke-width="1" stroke-opacity=".8"/>`
  ),
  feeCoin: svg(
    `<g class="hc-coin"><ellipse cx="40" cy="27" rx="19" ry="11" fill="#FAC775" stroke="#fff" stroke-width="2"/>` +
    `<path d="M21 27v23q0 11 19 11t19-11V27" fill="#FAC775" stroke="#fff" stroke-width="2"/>` +
    `<path d="M21 38q0 11 19 11t19-11M21 49q0 11 19 11t19-11" fill="none" stroke="#fff" stroke-width="1.5"/>` +
    `<text x="40" y="39" text-anchor="middle" font-size="17" fill="#854F0B">৳</text></g>`
  ),
  megaphone: svg(
    `<g class="hc-mega-pulse"><path d="M14 34h13l30-14v40L27 46H14z" fill="#FAC775" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<path d="M27 46l5 18h11l-8-21" fill="#9FE1CB" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M62 30q7 10 0 20M67 24q11 16 0 32" fill="none" stroke="#9FE1CB" stroke-width="2.5" stroke-linecap="round"/></g>`
  ),
  attendanceCheck: svg(
    `<circle cx="40" cy="40" r="31" fill="#0F6E56" fill-opacity=".9" stroke="#9FE1CB" stroke-width="2"/>` +
    `<path class="hc-check-path" d="m23 41 11 11 24-26" fill="none" stroke="#FAC775" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="52" stroke-dashoffset="52"/>`
  ),
  coffeeSteam: svg(
    `<g class="hc-steam" fill="none" stroke="#9FE1CB" stroke-width="2.5" stroke-linecap="round">` +
    `<path d="M25 32q-5-7 0-13t0-12M40 32q-5-7 0-13t0-12M55 32q-5-7 0-13t0-12"/></g>` +
    `<path d="M20 37h37v20q0 8-9 8H29q-9 0-9-8z" fill="#fff"/>` +
    `<path d="M57 42h5q8 0 8 8t-8 8h-5" fill="none" stroke="#FAC775" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M25 42h27" stroke="#FAC775" stroke-width="2" stroke-linecap="round"/>`
  )
};

const ROUTINE_CARD_SELECTOR = [
  '#routineList .routine-item', '#routineTodayList .routine-item', '#routineTomorrowList .routine-item',
  '#routineClassList .routine-item', '#routineChangedList .routine-item', '#routineImportantList .routine-item',
  '#routineOtherList .routine-item', '#classTodayList .routine-item', '#classUpcomingList .routine-item',
  '#classRecordList .routine-item'
].join(', ');

/* Public, reusable API: callers can use the same text rules without any DOM side effects. */
window.APCHeroArt = Object.freeze({
  RULES,
  detect,
  forText: artForText,
  color: colorForText
});

function setSVGPlayback(svgElement, playing) {
  if (!svgElement) return;
  const nodes = [svgElement, ...svgElement.querySelectorAll('*')];
  nodes.forEach(node => {
    if (node.style) node.style.animationPlayState = playing ? 'running' : 'paused';
    if (typeof node.getAnimations !== 'function') return;
    try {
      node.getAnimations().forEach(animation => {
        try { playing ? animation.play() : animation.pause(); }
        catch { /* A browser may reject an animation that has just detached. */ }
      });
    } catch { /* Older engines may not expose Web Animations on SVG nodes. */ }
  });
  const method = playing ? 'unpauseAnimations' : 'pauseAnimations';
  if (typeof svgElement[method] === 'function') {
    try { svgElement[method](); } catch { /* Older SVG engines may omit a timeline. */ }
  }
}

function pauseSVG(svgElement) { setSVGPlayback(svgElement, false); }
function resumeSVG(svgElement) { setSVGPlayback(svgElement, true); }

function mount(host, key, markup, slotClass) {
  if (!host) return null;
  let slot = host.querySelector(':scope > .hc-art');
  if (!slot) {
    slot = document.createElement('div');
    slot.className = `hc-art ${slotClass}`;
    slot.setAttribute('aria-hidden', 'true');
    host.prepend(slot);
  } else if (!slot.classList.contains(slotClass)) {
    slot.classList.add(slotClass);
  }
  if (slot.dataset.art !== key) {
    pauseSVG(slot.querySelector('svg'));
    slot.dataset.art = key;
    slot.innerHTML = markup;
    pauseSVG(slot.querySelector('svg'));
  }
  return slot;
}

function removeArt(host, slotClass) {
  const slot = host?.querySelector(`:scope > .hc-art.${slotClass}`);
  if (!slot) return;
  pauseSVG(slot.querySelector('svg'));
  slot.remove();
}

function timeOfDay() {
  let hour;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka', hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    hour = Number(parts.find(part => part.type === 'hour')?.value);
  } catch {
    hour = new Date().getHours();
  }
  if (!Number.isFinite(hour)) hour = new Date().getHours();
  if (hour >= 5 && hour < 16) return hour < 12 ? 'morning' : 'noon';
  if (hour >= 16 && hour < 18) return 'afternoon';
  return 'night';
}

function firstText(node, selectors) {
  for (const selector of selectors) {
    const found = node?.querySelector(selector)?.textContent?.trim();
    if (found) return found;
  }
  return node?.textContent?.trim() || '';
}

function currentHomeSubject() {
  const list = $('#dashboardRoutineList');
  if (!list) return '';
  const runningStatus = list.querySelector('[data-routine-status="running"], .dashboard-routine-status.is-running');
  const activeCard = runningStatus?.closest('.dashboard-routine-card');
  const fallbackStatus = list.querySelector('.is-live, .live, .current, [data-live="true"], [aria-current]');
  const card = activeCard || fallbackStatus?.closest('.dashboard-routine-card')
    || list.querySelector('.dashboard-routine-card') || list.firstElementChild;
  return firstText(card, ['.dashboard-routine-main > strong', '.dashboard-routine-main strong']) || card?.textContent || '';
}

function decorateSubjectCards() {
  document.querySelectorAll(`body.student-reference ${ROUTINE_CARD_SELECTOR}`).forEach(card => {
    const subjectText = firstText(card, ['.routine-body strong']);
    if (!subjectText) return;
    const subject = detect(subjectText);
    card.style.setProperty('--hc-subject', COLOR[subject] || COLOR.default);
    mount(card, subject, window.APCHeroArt.forText(subjectText), 'hc-art--subject');
  });
}

function decorateStudyToday() {
  const card = $('#coursesView .study-today-card');
  if (!card) return;
  const row = $('#studyTodayList .study-today-row');
  const subjectText = firstText(row, ['.study-today-copy h3']);
  if (!subjectText) {
    removeArt(card, 'hc-art--study-today');
    card.style.removeProperty('--hc-subject');
    return;
  }
  const subject = detect(subjectText);
  card.style.setProperty('--hc-subject', COLOR[subject] || COLOR.default);
  mount(card, subject, window.APCHeroArt.forText(subjectText), 'hc-art--study-today');
}

function decorateUpcomingExamCards() {
  const workspace = $('#studentExamWorkspace');
  if (!workspace || workspace.querySelector('.exam-question-list, .exam-timer, [data-exam-clock]')) return;
  document.querySelectorAll('#examUpcomingView #studentExamWorkspace .exam-card[data-student-exam]').forEach(card => {
    mount(card, 'hourglass', ART.hourglass, 'hc-art--hourglass');
  });
}

function updateAttendanceArt() {
  const card = $('#classesView .class-attendance-card');
  const rate = $('#classMonthAttendanceRate');
  if (!card || !rate) return;
  const latinDigits = rate.textContent.replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
  const percent = Number(latinDigits.match(/\d+(?:\.\d+)?/)?.[0]);
  if (Number.isFinite(percent) && percent > 90) {
    mount(card, 'attendance-check', ART.attendanceCheck, 'hc-art--attendance-check');
  } else {
    removeArt(card, 'hc-art--attendance-check');
  }
}

function renderArt() {
  if (!document.body?.classList.contains('student-reference')) return;
  const birthdayBanner = $('#birthdayBanner');
  const welcomeKey = birthdayBanner && !birthdayBanner.hidden ? 'party' : timeOfDay();
  mount($('.student-home-welcome'), welcomeKey, ART[welcomeKey] || ART.default, 'hc-art--welcome');
  mount($('#dailyQuoteCard'), 'bulb', ART.bulb, 'hc-art--advice');
  mount($('.study-progress-card'), 'rocket', ART.rocket, 'hc-art--progress');

  const today = $('.dashboard-today-section');
  if (today) {
    const subjectText = currentHomeSubject();
    const subject = detect(subjectText);
    const cardColor = subject === 'default' ? '#106D57' : COLOR[subject] || COLOR.default;
    today.style.setProperty('--hc-subject', cardColor);
    mount(today, subject, window.APCHeroArt.forText(subjectText), 'hc-art--today');
  }

  decorateStudyToday();
  decorateSubjectCards();
  document.querySelectorAll('#studyResultsView .study-result-summary, #studentResultOverview .exam-summary').forEach(card => {
    mount(card, 'trophy', ART.trophy, 'hc-art--trophy');
  });
  mount($('#emptyRoutine'), 'coffee-steam', ART.coffeeSteam, 'hc-art--coffee-steam');
  document.querySelectorAll('#examHubLiveList .exam-hub-live-card').forEach(card => {
    mount(card, 'live-clock', ART.liveClock, 'hc-art--live-clock');
  });
  decorateUpcomingExamCards();
  mount($('#moreAvatar'), 'avatar-ring', ART.avatarRing, 'hc-art--avatar-ring');
  mount($('#myProfileView .profile-photo-wrap'), 'avatar-ring', ART.avatarRing, 'hc-art--avatar-ring');

  const feeSummary = $('#studentFeeMount .student-fee-summary');
  const feeTiles = feeSummary ? [...feeSummary.querySelectorAll('.student-fee-stat')] : [];
  mount(feeTiles[feeTiles.length - 1], 'fee-coin', ART.feeCoin, 'hc-art--fee-coin');
  mount($('#noticeBoardDetail'), 'megaphone', ART.megaphone, 'hc-art--megaphone');
  updateAttendanceArt();
  updateMotionTargets();
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  const frame = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0));
  frame(() => {
    renderQueued = false;
    renderArt();
  });
}

const MOTION_SELECTOR = [
  'body.student-reference .hc-art > svg',
  'body.student-reference #studentServices .pay-tile-icon svg',
  'body.student-reference #studySections .pay-tile-icon svg',
  'body.student-reference #classHub .pay-tile-icon svg',
  'body.student-reference #routineHub .pay-tile-icon svg',
  'body.student-reference #examTabs [data-practice-mode] .pay-tile-icon svg',
  'body.student-reference #profileView .more-menu-row > .more-row-icon svg',
  'body.student-reference #routineDayView .routine-date .calendar-dot svg',
  'body.student-reference #studyResultsView .study-result-tip svg'
].join(', ');
let motionTargets = new Set();
let visibleByObserver = new Map();
let motionObserver = null;
let motionScheduled = false;

function hiddenByLayout(node) {
  if (!node?.isConnected || node.closest('[hidden]')) return true;
  const view = node.closest('.view');
  return Boolean(view && (!view.classList.contains('active') || view.hidden));
}

function insideActiveExam(node) {
  const workspace = node.closest('#studentExamWorkspace');
  return Boolean(workspace?.querySelector('.exam-question-list, .exam-timer, [data-exam-clock]'));
}

function inViewport(node) {
  if (hiddenByLayout(node)) return false;
  const rect = node.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const height = window.innerHeight || document.documentElement.clientHeight || 0;
  return rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
}

function orderedVisibleTargets() {
  const candidates = [...motionTargets].filter(node => {
    if (insideActiveExam(node) || hiddenByLayout(node)) return false;
    if (motionObserver) return visibleByObserver.get(node) === true;
    return inViewport(node);
  });
  return candidates.sort((left, right) => {
    const order = left.compareDocumentPosition(right);
    return order & window.Node.DOCUMENT_POSITION_FOLLOWING ? -1
      : order & window.Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
  });
}

function allocateMotion() {
  motionScheduled = false;
  const canAnimate = !reducedMotion && !document.hidden;
  const selected = canAnimate ? orderedVisibleTargets().slice(0, 6) : [];
  const selectedSet = new Set(selected);
  motionTargets.forEach(node => {
    const shouldRun = selectedSet.has(node);
    const isRunning = node.style.animationPlayState === 'running';
    if (shouldRun && !isRunning) resumeSVG(node);
    else if (!shouldRun && isRunning) pauseSVG(node);
  });
}

function scheduleMotion() {
  if (motionScheduled) return;
  motionScheduled = true;
  const frame = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0));
  frame(allocateMotion);
}

function updateMotionTargets() {
  const next = new Set(document.querySelectorAll(MOTION_SELECTOR));
  motionTargets.forEach(node => {
    if (next.has(node)) return;
    motionObserver?.unobserve(node);
    visibleByObserver.delete(node);
    pauseSVG(node);
  });
  next.forEach(node => {
    if (motionTargets.has(node)) return;
    visibleByObserver.set(node, false);
    pauseSVG(node);
    motionObserver?.observe(node);
  });
  motionTargets = next;
  if (!motionObserver) {
    visibleByObserver.clear();
  }
  scheduleMotion();
}

function startMotionObserver() {
  if (typeof window.IntersectionObserver !== 'function') return;
  motionObserver = new window.IntersectionObserver(entries => {
    entries.forEach(entry => visibleByObserver.set(entry.target, entry.isIntersecting && entry.intersectionRatio > 0));
    scheduleMotion();
  }, { root: null, threshold: [0, .01] });
}

let started = false;
function start() {
  if (started || !document.body?.classList.contains('student-reference')) return;
  started = true;
  startMotionObserver();
  renderArt();

  const root = document.documentElement;
  if (typeof MutationObserver === 'function' && root) {
    new MutationObserver(scheduleRender).observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden']
    });
  }
  window.addEventListener('apc-view-change', scheduleRender);
  window.addEventListener('apc-session-ready', scheduleRender);
  window.addEventListener('scroll', scheduleMotion, { passive: true, capture: true });
  window.addEventListener('resize', scheduleMotion, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) motionTargets.forEach(pauseSVG);
    scheduleRender();
  });
  document.addEventListener('animationend', event => {
    if (event.target?.matches?.('.hc-check-path')) event.target.classList.add('hc-check-drawn');
  });
  window.setInterval(scheduleRender, 10 * 60 * 1000); /* Keep Dhaka time art aligned with the greeting. */

  if (reduceQuery?.addEventListener) {
    reduceQuery.addEventListener('change', event => {
      reducedMotion = event.matches;
      if (reducedMotion) motionTargets.forEach(pauseSVG);
      scheduleMotion();
    });
  } else if (reduceQuery?.addListener) {
    reduceQuery.addListener(event => {
      reducedMotion = event.matches;
      if (reducedMotion) motionTargets.forEach(pauseSVG);
      scheduleMotion();
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
