/* Active Plus wallet-style reskin: production markup and the loaded stylesheet,
   not obsolete/unimported skin files. Business behavior is covered separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const portals = ['index', 'admin', 'manager', 'teacher', 'payment'];
const doc = name => new JSDOM(read(name + '.html')).window.document;
const css = read('css/ui-wallet.css');

test('the active wallet skin parses, is screen-only and resolves its palette tokens', () => {
  const sheet = new JSDOM(`<style>${css}</style>`).window.document.styleSheets[0];
  assert.equal(sheet.cssRules.length, 1, 'every wallet rule must stay inside the screen wrapper');
  assert.equal(sheet.cssRules[0].conditionText, 'screen');
  assert.ok(sheet.cssRules[0].cssRules.length > 100, 'the parser dropped the actual skin');
  const defined = new Set([...read('css/foundation.css').matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1]));
  // Per-component variables are deliberately not global palette entries.
  ['--tone', '--tone-soft', '--progress'].forEach(name => defined.add(name));
  for (const [, token] of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
    assert.ok(defined.has(token), 'undefined token ' + token);
  }
  // #000 in the SVG mask is geometry, not a painted colour.
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '').replace(/^\s*(?:-webkit-)?mask:[^;]+;/gm, '');
  assert.doesNotMatch(declarations, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, 'component colours belong in the one palette');
});

test('all portals retain the same uncluttered two-action brand bar', () => {
  for (const name of portals) {
    const document = doc(name);
    const bar = document.querySelector('.app-topbar');
    assert.ok(bar, name + ' appbar missing');
    assert.ok(bar.querySelector('.app-brand-logo[src*="logo-128"]'));
    assert.equal(bar.querySelectorAll('.app-topbar-actions > button').length, 2, name);
    assert.equal(bar.querySelectorAll('button').length, 2, 'identity/settings belong in the hero or More, not the appbar');
    assert.match(bar.querySelector('[data-fixed-tagline]').textContent, /শিখতে থাকো/);
  }
});

test('student, manager and teacher have eight real, named service shortcuts', () => {
  const allowed = {
    index: ['routine', 'courses', 'exams', 'results', 'profile'],
    manager: ['approvals', 'classes', 'teachers', 'finance', 'routine', 'exams', 'notices', 'reports'],
    teacher: ['classes', 'students', 'routine-view', 'routine', 'homework', 'online-exams', 'exam', 'reports']
  };
  for (const [name, views] of Object.entries(allowed)) {
    const document = doc(name);
    const tiles = [...document.querySelectorAll('.pay-grid > .pay-tile')];
    assert.equal(tiles.length, 8, name);
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

test('secondary screens have accessible home/back controls and staff More has round icons', () => {
  for (const [name, attribute, target, count] of [
    ['index', 'data-view', 'home', 6], ['admin', 'data-admin-view', 'dashboard', 11],
    ['manager', 'data-manager-view', 'dashboard', 14], ['teacher', 'data-teacher-view', 'home', 9]
  ]) {
    const document = doc(name);
    const backs = [...document.querySelectorAll('.pay-back')];
    assert.equal(backs.length, count, name);
    for (const button of backs) {
      // The More sub-pages (Reports, Notification Settings) go back to More.
      const parent = name === 'index' && button.closest('#reportsView, #notificationSettingsView') ? 'profile' : target;
      assert.equal(button.getAttribute(attribute), parent);
      assert.ok(button.getAttribute('aria-label'));
      assert.ok(button.querySelector('svg'));
    }
  }
  for (const name of ['manager', 'teacher']) {
    for (const row of doc(name).querySelectorAll('.admin-more-item')) {
      assert.ok(row.querySelector('.admin-more-icon svg'), name + ' menu row has no icon');
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
  for (const name of ['index', 'admin', 'manager', 'teacher']) {
    const document = doc(name);
    const mount = document.getElementById('notificationSettings');
    assert.ok(mount, name + ' is missing its notification settings mount');
    // The mount must sit inside a view panel that is hidden by default, so the
    // settings never render outside the open page (below/around the active view).
    const view = mount.closest('.view, .admin-view, .manager-view, .teacher-view');
    assert.ok(view, name + ' settings mount is outside every view panel');
    if (name === 'teacher') assert.equal(view.hidden, true, name + ' settings view is not hidden by default');
    else assert.equal(view.classList.contains('active'), false, name + ' settings view is active by default');
    // A view panel hides its whole subtree; the mount must not escape it.
    assert.equal(mount.parentElement, view, name + ' settings mount is not a direct view child subtree');
  }
  assert.equal(doc('payment').getElementById('notificationSettings'), null, 'counter has no staff settings mount');
});

test('counter keeps only the requested today/search/payment surfaces, not wallet dashboard extras', () => {
  const document = doc('payment');
  for (const selector of ['.admin-bottom','#payStickyBar','#payKeypad','#payDeskTools','#payQuickPicks','#payTodayAmount','#payMonthAmount','#payDueStudents']) assert.equal(document.querySelector(selector),null,selector);
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
  for (const name of [...portals, 'offline-roles']) {
    assert.match(read(name + '.html'), new RegExp(`css/design-system\\.css\\?v=${version}`), name);
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
