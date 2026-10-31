/* Active Plus wallet-style reskin: production markup and the loaded stylesheet,
   not obsolete/unimported skin files. Business behavior is covered separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const portals = ['student', 'admin', 'manager', 'teacher', 'payment'];
const doc = name => new JSDOM(read(name + '.html')).window.document;
const css = read('css/ui-wallet.css');

test('the active wallet skin parses, is screen-only and resolves its palette tokens', () => {
  const sheet = new JSDOM(`<style>${css}</style>`).window.document.styleSheets[0];
  assert.equal(sheet.cssRules.length, 1, 'every wallet rule must stay inside the screen wrapper');
  assert.equal(sheet.cssRules[0].conditionText, 'screen');
  assert.ok(sheet.cssRules[0].cssRules.length > 100, 'the parser dropped the actual skin');
  const defined = new Set([...read('css/foundation.css').matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1]));
  // Per-component variables are deliberately not global palette entries.
  // --tile-index is set inline per quick-access tile by the admin shell.
  // The Student learning hero uses local aliases over the existing color/tone palette.
  ['--tone', '--tone-soft', '--stat-tone', '--progress', '--tile-index'].forEach(name => defined.add(name));
  for (const [, name] of css.matchAll(/(--hero-(?:bg(?:-soft)?|ink|muted|accent))\s*:/g)) defined.add(name);
  // Palette channels scoped to one component/tile (not global palette tokens).
  for (const [, name] of css.matchAll(/(--[a-z0-9-]*(?:ink|index))\s*:/g)) defined.add(name);
  // The Manager roster uses local semantic tones for each status group.
  for (const [, name] of css.matchAll(/(--manager-status-(?:tone|soft))\s*:/g)) defined.add(name);
  for (const [, token] of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
    assert.ok(defined.has(token), 'undefined token ' + token);
  }
  // #000 in the SVG mask is geometry, not a painted colour.
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '').replace(/^\s*(?:-webkit-)?mask:[^;]+;/gm, '');
  assert.doesNotMatch(declarations, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, 'component colours belong in the one palette');
});

test('all portals keep the same uncluttered brand bar — chat only where a chat page exists', () => {
  // Owner request 2026-10-28: the "শ্রেণি চ্যাট ও মডারেশন" console was removed
  // from Admin and Manager, so their top bars hold bell + exit only. Student and
  // Teacher keep the chat page and therefore its shortcut.
  const CHAT_PORTALS = new Set(['student', 'teacher']);
  for (const name of portals) {
    const document = doc(name);
    const bar = document.querySelector('.app-topbar');
    assert.ok(bar, name + ' appbar missing');
    assert.ok(bar.querySelector('.app-brand-logo[src*="logo-128"]'));
    const expectedCount = CHAT_PORTALS.has(name) ? 3 : 2;
    assert.equal(bar.querySelectorAll('.app-topbar-actions > button').length, expectedCount, name);
    assert.equal(bar.querySelectorAll('button').length, expectedCount, 'identity/settings belong in the page head or More, not the appbar');
    const chatBtn = bar.querySelector('#classChatTopbarButton');
    if (CHAT_PORTALS.has(name)) {
      assert.ok(chatBtn, name + ' topbar chat shortcut missing');
      assert.ok(chatBtn.querySelector('svg[data-icon="chat"]'), name + ' topbar chat icon missing');
      assert.ok(chatBtn.querySelector('[data-chat-unread-dot]'), name + ' topbar chat unread dot missing');
    } else {
      assert.equal(chatBtn, null, name + ' must not carry a chat shortcut');
    }
    assert.match(bar.querySelector('[data-fixed-tagline]').textContent, /শিখতে থাকো/);
  }
});

test('top and bottom bars carry the green brand color in light and AMOLED themes', () => {
  assert.match(css, /\.app-topbar \{\s*background: var\(--pay-hero-a\); color: var\(--pay-on-hero\);/,
    'the topbar uses the shared green with high-contrast text');
  assert.match(css, /\.app-topbar-icon \{[^}]*color: var\(--pay-on-hero\)[^}]*background: var\(--pay-hero-chip\)/s,
    'topbar actions remain clear on the colored surface');
  assert.match(css, /\.bottom-nav::before, \.admin-bottom::before \{[^}]*color-mix\(in srgb, var\(--color-primary\) 12%, var\(--color-surface\)\)/s,
    'the bottom bar gets a visible brand-tinted surface');
  assert.match(css, /\.bottom-link\.active \.nav-chip, \.admin-bottom-item\.active \.nav-chip \{\s*background: var\(--color-primary\)[^}]*color: var\(--pay-on-fab\)/,
    'active routes use a filled, readable brand chip');
  assert.match(css, /html\[data-theme="dark"\] \.bottom-nav::before, html\[data-theme="dark"\] \.admin-bottom::before \{[^}]*color-mix\(in srgb, var\(--color-primary\) 16%, var\(--color-surface\)\)/s,
    'the bottom bar remains visibly tinted on AMOLED');
  assert.match(css, /\.manager-shell > \.manager-bottom > \.admin-bottom-item\.active \{\s*background: var\(--pay-hero-a\)/,
    'Manager keeps its filled active item');
});

test('student, manager and teacher have real, named service shortcuts', () => {
  const allowed = {
    manager: ['students', 'classes', 'teachers', 'routine', 'exams', 'notices', 'finance', 'reports'],
    teacher: []
  };
  const expectedCount = { manager: 9, teacher: 0 };
  const studentCards = [
    ['homework', 'বাড়ির কাজ'], ['exams', 'পরীক্ষা'], ['suggestion', 'সাজেশন'],
    ['question-bank', 'প্রশ্নব্যাংক'], ['exam-results', 'ফলাফল'], ['notice-board', 'নোটিশ বোর্ড'], ['class-chat', 'শ্রেণি চ্যাট']
  ];
  const studentTiles = [...doc('student').querySelectorAll('#studentServices .pay-tile')];
  assert.equal(studentTiles.length, studentCards.length);
  studentTiles.forEach((tile, index) => {
    const [route, label] = studentCards[index];
    assert.equal(tile.getAttribute('type'), 'button');
    assert.ok(tile.querySelector('.pay-tile-icon svg[aria-hidden="true"]'), 'student blank icon');
    assert.equal(tile.querySelector('.pay-tile-label').textContent.trim(), label);
    assert.ok(tile.dataset.view === route || tile.dataset.action === route, 'student card ' + label + ' points nowhere');
  });
  assert.equal(studentTiles[4].dataset.examTab, 'results', 'ফলাফল opens the results tab of পরীক্ষা');
  for (const [name, views] of Object.entries(allowed)) {
    const document = doc(name);
    const tiles = [...document.querySelectorAll('[aria-label="দ্রুত অ্যাক্সেস"] > .pay-tile')];
    assert.equal(tiles.length, expectedCount[name], name);
    for (const tile of tiles) {
      assert.equal(tile.getAttribute('type'), 'button');
      assert.ok(tile.querySelector('.pay-tile-icon svg[aria-hidden="true"]'), name + ' blank icon');
      assert.ok(tile.querySelector('.pay-tile-label').textContent.trim());
      const route = tile.dataset.view || tile.dataset.managerView || tile.dataset.teacherView;
      if (route) assert.ok(views.includes(route), name + ' dead route ' + route);
      else assert.ok(['homework', 'notices', 'fees'].includes(tile.dataset.action));
    }
  }
  assert.ok(read('js/admin-panel-ui.js').includes('admin-feature-tile'), 'admin must retain its capability-generated service grid');
});

test('secondary screens have accessible home/back controls and staff hub rows have round icons', () => {
  const MORE_SUBPAGES = '#reportsView, #notificationSettingsView, #myProfileView, #settingsView, #studentFeeView';
  const indexBacks = [...doc('student').querySelectorAll('.pay-back')];
  assert.ok(indexBacks.length >= 10, 'student pages keep back controls');
  for (const button of indexBacks) {
    const parent = button.closest(MORE_SUBPAGES) ? 'profile' : button.getAttribute('data-view');
    assert.equal(button.getAttribute('data-view'), parent);
    assert.ok(button.getAttribute('aria-label'));
    assert.ok(button.querySelector('svg'));
    /* 'my-profile' is the ID-card's parent route: the digital card is a
       sub-screen of আমার প্রোফাইল, so its back button returns there. */
    assert.ok(['home', 'profile', 'my-profile', 'courses', 'exams', 'routine', 'classes'].includes(parent), 'back ' + parent);
  }
  for (const [name, attribute, target, min] of [
    ['manager', 'data-manager-view', 'dashboard', 14], ['teacher', 'data-teacher-view', 'home', 10]
  ]) {
    const document = doc(name);
    const backs = [...document.querySelectorAll('.pay-back')];
    assert.ok(backs.length >= min, name);
    for (const button of backs) {
      const staffHubPage = button.closest('[data-view-panel="profile"], #teacherProfile');
      const parent = button.getAttribute(attribute);
      /* Owner decision 2026-10-28: the lecture-sheet studio is a dedicated
         sub-page, so its Back returns to the hub that opened it. */
      const allowedParents = staffHubPage
        ? ['more']
        : [target, 'routine', 'routine-view', 'academic', 'more', 'courses'];
      assert.ok(allowedParents.includes(parent), name + ' back ' + parent);
      assert.ok(button.getAttribute('aria-label'));
      assert.ok(button.querySelector('svg'));
    }
  }
  /* Admin: hub panels removed (2026-10-28 refactor) — every main screen returns home; only detail sub-views return to parent hub. */
  const adminDocument = doc('admin');
  const adminBacks = [...adminDocument.querySelectorAll('.pay-back')];
  const mainBacks = adminBacks.filter(button => !button.closest('[data-parent-view]'))
    .map(button => button.getAttribute('data-admin-back') || button.getAttribute('data-admin-view'));
  assert.deepEqual(mainBacks, Array(16).fill('dashboard'), 'hub toggle panels removed — main screens return home');
  const detailBacks = adminBacks.filter(button => button.closest('[data-parent-view]'));
  assert.equal(detailBacks.length, 35, 'each routed detail has its own Back');
  for (const button of detailBacks) {
    assert.equal(button.dataset.adminBack, button.closest('[data-parent-view]').dataset.parentView);
    assert.ok(button.getAttribute('aria-label'));
    assert.ok(button.querySelector('svg'));
  }
  for (const name of ['admin', 'manager', 'teacher']) {
    for (const row of doc(name).querySelectorAll('.admin-more-item')) {
      assert.ok(row.querySelector('.admin-more-icon, .admin-more-copy'), name + ' hub row has no icon slot');
    }
  }
});

test('hero band covers the whole hero and the summary card straddles its edge', () => {
  const css = read('css/ui-wallet.css');
  // The band must reach the hero's bottom edge: the greeting/name/meta are
  // white text and would sit on the page background in light mode otherwise.
  assert.match(css, /\.pay-hero::before \{\s*content: ''; position: absolute; z-index: -1; top: 0; bottom: 0;/);
  // The card pulls up onto the band edge (wallet signature) instead of
  // floating in a dead gap below it.
  assert.match(css, /\.study-progress-card \{\s*position: relative; margin: -22px 0 0;/);
  // The compact one-screen home keeps its small hero — no overlap there.
  assert.match(css, /#homeView\.is-empty-routine \.study-progress-card \{ margin-top: 0;/);
});

test('student home uses the full-match two-column reference grid without changing other portals', () => {
  const home = doc('student');
  const design = read('css/student-home-design.css');
  assert.ok(home.querySelector('#homeView #dashboardExamCard'), 'the exam banner is on Home');
  assert.match(read('student.html'), /css\/student-home-design\.css\?v=\d+/,
    'Student Home loads its dedicated visual layer');
  assert.match(read('sw.js'), /'\.\/css\/student-home-design\.css'/,
    'the offline worker precaches the Student-only visual layer');
  assert.match(design, /body\.student-reference #homeView #studentServices\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    'six quick actions use two equal columns');
  assert.match(design, /@media screen and \(min-width: 768px\)[\s\S]*?#appShell\s*\{[\s\S]*?border-radius: 34px/,
    'wide screens get the roomy, rounded app shell');
  assert.ok(['--student-home-welcome: #eaf3ff', '--student-home-advice: #eef0ff',
    '--student-home-routine: #e8f5ee', '--student-home-progress: #fff2df']
    .every(color => design.includes(color)), 'the four cards retain their distinct light palette');
  assert.match(design, /#studyProgressRing\s*\{\s*transition:\s*--progress 2\.4s/u,
    'the ring eases to the real computed percentage instead of showing an instant jump');
  for (const name of ['admin', 'manager', 'teacher', 'payment', 'index']) {
    assert.doesNotMatch(read(name + '.html'), /student-home-design\.css/,
      name + ' does not load Student-specific styling');
  }
});

test('exam workspace rows keep one even gap with no dead space', () => {
  const css = read('css/exam-archive.css');
  // The grid gap is the only spacer: direct <p> rows carry no margins of
  // their own (no 12px + 16px stacks), an empty status row takes no space,
  // and the first content row does not double the gap.
  assert.match(css, /\.exam-workspace>p\{margin:0\}/);
  assert.match(css, /\.exam-auto-notice:empty\{display:none\}/);
  assert.match(css, /\[data-exam-content\]>\.exam-actions:first-child\{margin-top:0\}/);
});

test('notification settings live inside a hidden view, never floating outside the panels', () => {
  for (const name of ['student', 'admin', 'manager', 'teacher']) {
    const document = doc(name);
    const mount = document.getElementById('notificationSettings');
    assert.ok(mount, name + ' is missing its notification settings mount');
    // The mount must sit inside a view panel that is hidden by default, so the
    // settings never render outside the open page (below/around the active view).
    const view = mount.closest('.view, .admin-view, .manager-view, .teacher-view');
    assert.ok(view, name + ' settings mount is outside every view panel');
    if (name === 'teacher') assert.equal(view.hidden, true, name + ' settings view is not hidden by default');
    else assert.equal(view.classList.contains('active'), false, name + ' settings view is active by default');
    // A view panel hides its whole subtree; the mount must not escape it. Inside
    // the view it now sits in the Settings hub's নোটিফিকেশন group (§29).
    assert.ok(view.contains(mount), name + ' settings mount is outside its view panel');
    assert.ok(mount.closest('[data-settings-group="notification"], #notificationSettingsView'),
      name + ' notification settings are not inside the নোটিফিকেশন group');
  }
  assert.equal(doc('payment').getElementById('notificationSettings'), null, 'counter has no staff settings mount');
});

test('counter keeps only its five job surfaces, not wallet dashboard extras', () => {
  const document = doc('payment');
  const seats = [...document.querySelectorAll('.admin-bottom [data-pay-section]')].map(seat => seat.dataset.paySection);
  assert.deepEqual(seats, ['home', 'students', 'payment', 'reports', 'more'], 'one seat per step of the counter job');
  assert.deepEqual([...document.querySelectorAll('[data-pay-panel]')].map(panel => panel.dataset.payPanel),
    ['home', 'students', 'payment', 'reports', 'more'], 'every seat owns exactly one panel');
  assert.equal(document.querySelectorAll('[data-academic-section]').length, 0, 'no academic management at the counter');
  for (const selector of ['#payStickyBar','#payKeypad','#payDeskTools','#payQuickPicks','#payTodayAmount','#payMonthAmount','#payDueStudents']) assert.equal(document.querySelector(selector),null,selector);
  for (const id of ['paySearchCard','payProfileCard','payActivityCard','payCollectionForm','payStudentSearch']) assert.equal(document.querySelectorAll('#'+id).length,1,id);
  assert.equal(document.querySelector('#payProfileCard').hidden,true);
  assert.equal(document.querySelector('#payFeeMethod').tagName,'SELECT');
  assert.match(read('js/payment.js'), /searchCounterStudents/);
  assert.ok(document.querySelector('#paymentReports'));
  assert.equal(document.querySelector('#payReportsCard').hidden,true);
  assert.match(read('js/payment.js'), /mountCounterReports/);
  assert.doesNotMatch(read('js/payment.js'), /studentFeeSummary|loadRoster|mountReports|whatsappTarget|renderQuickPicks/);
});

test('wallet assets and entry versions ship together in the offline shell', () => {
  const sw = read('sw.js');
  const version = Number(sw.match(/const CACHE_VERSION = (\d+)/)[1]);
  assert.ok(version >= 139);
  assert.ok(sw.includes("'./css/ui-wallet.css'"));
  assert.ok(!sw.includes("'./css/ui-interior.css'"), 'unused skin must not be a precache dependency');
  const appShell = sw.split('const APP_SHELL = [')[1].split('];')[0];
  for (const name of portals) {
    const links = [...read(name + '.html').matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(match => match[1]);
    assert.ok(links.some(href => href.startsWith('css/ui-wallet.css?')), `${name} must link the wallet skin`);
    if (name === 'student') {
      assert.ok(links.includes('css/hero-cards.css?v=379'), 'Student hero CSS uses the approved v379 asset pin');
      assert.ok(appShell.includes("'./css/hero-cards.css' + '?v=379'"), 'the offline shell uses the same Student hero CSS pin');
    }
    for (const href of links) {
      if (name === 'student' && href === 'css/hero-cards.css?v=379') continue;
      assert.match(href, new RegExp(`\\?v=${version}$`), `${name}: ${href} is not pinned to CACHE_VERSION`);
    }
  }
});

function palette(theme) {
  const source = read('css/foundation.css');
  const declarations = selector => [...source.split(selector + '{')[1].split('\n}')[0].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]);
  return new Map([...declarations(':root'), ...(theme === 'dark' ? declarations('html[data-theme=dark]') : [])]);
}
function rgb(value, canvas = [255, 255, 255]) {
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? [...hex].map(char => char + char).join('') : hex;
    return [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16));
  }
  const components = value.match(/[\d.]+/g).map(Number);
  return components.slice(0, 3).map((channel, index) => channel * components[3] + canvas[index] * (1 - components[3]));
}
function luminance(channels) {
  const linear = channels.map(channel => { const s = channel / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + .05) / (darker + .05);
}
for (const theme of ['light', 'dark']) test(`wallet hero, card, status and paper text clear AA (${theme})`, () => {
  const tokens = palette(theme);
  const surface = rgb(tokens.get('--color-surface'));
  const pairs = [
    ['--pay-on-hero', '--pay-hero-a', 4.5], ['--pay-on-hero-soft', '--pay-hero-a', 4.5],
    ['--pay-on-hero', '--pay-hero-b', 4.5], ['--color-primary', '--color-surface', 4.5],
    ['--pay-disc-ink', '--pay-disc', 4.5], ['--pay-success', '--pay-success-soft', 4.5],
    ['--color-warning', '--tone-amber-soft', 4.5], ['--color-danger', '--tone-rose-soft', 4.5],
    ['--color-text-secondary', '--color-surface-muted', 4.5],
    ['--pay-paper-ink', '--pay-paper', 4.5], ['--pay-paper-muted', '--pay-paper', 4.5],
    // The raised action has a large SVG, not text: non-text AA is 3:1.
    ['--pay-on-fab', '--pay-fab-a', 3], ['--pay-on-fab', '--pay-fab-b', 3]
  ];
  for (const [ink, background, minimum] of pairs) {
    const ratio = contrast(rgb(tokens.get(ink)), rgb(tokens.get(background), surface));
    assert.ok(ratio >= minimum, `${theme}: ${ink} on ${background} is only ${ratio.toFixed(2)}:1`);
  }
});

test('birthday hero keeps the colorful band visible and its ink above AA contrast', () => {
  const foundation = read('css/foundation.css');
  const stops = foundation.match(/--birthday-hero:([^;]+);/)[1].match(/#[0-9a-f]{6}/gi);
  const ink = rgb(foundation.match(/--birthday-ink:([^;]+);/)[1]);
  assert.equal(stops.length, 3, 'the celebration blend keeps all three colors');
  for (const stop of stops) assert.ok(contrast(ink, rgb(stop)) >= 4.5, `birthday text on ${stop}`);
  assert.match(css, /html\[data-birthday\] \.pay-hero::before \{ display: block; background: var\(--birthday-hero\); \}/);
  assert.match(css, /html\[data-birthday\] body\.student-reference #homeView \.pay-hero::before \{ display: block; \}/);
  assert.match(css, /html\[data-birthday\] body\.student-reference #homeView \.pay-hero :is\(\.pay-greeting, \.pay-hero-name, \.pay-hero-meta, \.pay-hero-link\)/);
});
