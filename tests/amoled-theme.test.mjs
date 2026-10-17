/* AMOLED dark theme guards.

   The palette is defined once, in css/foundation.css, and every portal reads
   the same variables — so a second palette appearing anywhere is the bug this
   file exists to catch. The dark theme is the AMOLED one: a true-black canvas
   (the pixels an OLED panel actually switches off), surfaces one hairline step
   above it, and text that still clears WCAG AA on those surfaces, which is the
   part that silently rots when someone "brightens" a grey. Component-level
   dark tuning is allowed in css/app-polish.css, but only as flat overrides
   (App WebViews on older Android engines cannot parse nested CSS, and a syntax
   error there would drop the whole block). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME_COLOR, themeColorFor } from '../js/appearance.js';

const read = path => readFileSync(path, 'utf8');
// The five shipped pages. demo/offline-roles.html is the developers' role
// workspace (out of the production deploy) and is deliberately not in this list.
const PAGES = ['student', 'admin', 'manager', 'teacher', 'payment'];

function hex(value) {
  const clean = value.trim().replace(/^#/, '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const channel = c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The declared value of one custom property inside one rule block. */
function token(css, selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(block, `no rule for ${selector}`);
  const found = block[1].match(new RegExp(`${property}\\s*:\\s*([^;]+);`));
  assert.ok(found, `${property} is not declared for ${selector}`);
  return found[1].trim();
}

test('the AMOLED canvas is true black and every surface steps up from it', () => {
  const css = read('css/foundation.css');
  const dark = selector => token(css, 'html[data-theme=dark]', `--${selector}`);
  assert.equal(dark('color-bg'), '#000', 'the dark canvas must be true black');
  // A card has to be visible as a card: black, then surface, then muted tile.
  assert.equal(luminance(hex(dark('color-bg'))), 0);
  assert.ok(luminance(hex(dark('color-surface'))) > 0, 'dark surfaces cannot sit on #000');
  assert.ok(luminance(hex(dark('color-surface-muted'))) > luminance(hex(dark('color-surface'))),
    'the muted tile must stay a step above the card it sits on');
  assert.equal(dark('shadow-sm'), 'none', 'an invisible shadow on black is still paint work');
});

test('AMOLED text clears WCAG AA on the surfaces it is painted on', () => {
  const css = read('css/foundation.css');
  const dark = name => hex(token(css, 'html[data-theme=dark]', `--${name}`));
  const bg = dark('color-bg');
  const surface = dark('color-surface');
  const muted = dark('color-surface-muted');
  for (const [name, paint] of [['color-text', bg], ['color-text', surface], ['color-text', muted]]) {
    assert.ok(contrast(dark(name), paint) >= 4.5,
      `${name} on ${paint} is below AA (${contrast(dark(name), paint).toFixed(2)}:1)`);
  }
  for (const name of ['color-text-secondary', 'color-text-muted']) {
    for (const paint of [bg, surface]) {
      assert.ok(contrast(dark(name), paint) >= 4.5,
        `${name} on ${paint} is below AA (${contrast(dark(name), paint).toFixed(2)}:1)`);
    }
  }
  for (const name of ['color-success', 'color-warning', 'color-danger']) {
    assert.ok(contrast(dark(name), surface) >= 4.5,
      `${name} on a dark card is below AA (${contrast(dark(name), surface).toFixed(2)}:1)`);
  }
});

test('the palette is declared once, in foundation.css', () => {
  const core = ['--color-bg', '--color-surface', '--color-surface-muted', '--color-border', '--color-text', '--color-primary'];
  const foundation = read('css/foundation.css');
  for (const property of core) {
    assert.match(foundation, new RegExp(`${property}\\s*:`), `${property} is missing from the palette`);
  }
  // Every other sheet may only arrange those variables — a second palette is
  // how one portal drifts away from the others.
  for (const file of ['css/app-polish.css', 'css/ui-layout.css', 'css/ui-components.css', 'css/ui-forms.css', 'css/ui-features.css', 'css/ui-status.css', 'css/ui-auth.css', 'css/student-record.css']) {
    assert.doesNotMatch(read(file), /--color-(bg|surface|surface-muted|border|text|text-secondary|text-muted)\s*:/,
      `${file} declares palette tokens; they belong in css/foundation.css`);
  }
});

test('the dark AMOLED overrides are flat rules, never nested CSS', () => {
  const css = read('css/app-polish.css');
  const start = css.indexOf('/* ── AMOLED dark: component tuning');
  assert.ok(start > -1, 'app-polish.css no longer carries the AMOLED block');
  const block = css.slice(start);
  let depth = 0;
  for (const character of block) {
    if (character === '{') {
      depth += 1;
      assert.equal(depth, 1, 'a nested rule sneaked into the AMOLED overrides');
    } else if (character === '}') {
      depth -= 1;
      assert.ok(depth >= 0, 'unbalanced braces in the AMOLED overrides');
    }
  }
  assert.equal(depth, 0, 'unbalanced braces in the AMOLED overrides');
  for (const part of ['app-topbar', 'bottom-nav', 'admin-bottom']) {
    assert.match(block, new RegExp(`html\\[data-theme="dark"\\] \\.${part}\\b`),
      `${part} must sit on the black canvas, not on a grey surface`);
  }
});

test('every page tells the browser the same colours the module applies', () => {
  assert.equal(THEME_COLOR.dark, '#000000');
  for (const page of PAGES) {
    const html = read(`${page}.html`);
    const meta = html.match(/<meta name="theme-color" content="([^"]+)">/);
    assert.ok(meta, `${page}.html has no theme-color meta`);
    assert.equal(meta[1].toLowerCase(), THEME_COLOR.light.toLowerCase(),
      `${page}.html pins a different light colour than js/appearance.js`);
    assert.equal(themeColorFor('light'), THEME_COLOR.light);
    assert.equal(themeColorFor('dark'), THEME_COLOR.dark);
  }
});

test('the modal backdrop is a themed token, not a fixed dark wash', () => {
  const components = read('css/ui-components.css');
  assert.match(components, /\.modal-backdrop[^{]*\{[^}]*background:var\(--modal-backdrop\)/,
    'the backdrop must follow the theme token');
  assert.doesNotMatch(components, /background:#17243866/,
    'the old fixed backdrop wash is back');
  assert.match(read('css/foundation.css'), /--modal-backdrop:#000000d9/,
    'AMOLED modals need a near-opaque backdrop');
});

test('the theme switch shows exactly the theme the app is in', () => {
  const components = read('css/ui-components.css');
  // The knob used to follow [aria-checked=true], which nothing ever set on the
  // row — the switch stayed visually "off" while the app was dark. It follows
  // the checkbox the user actually presses now.
  assert.match(components, /\.toggle-switch input:checked~i\{transform:translateX\(/,
    'the knob no longer follows the checkbox');
  assert.doesNotMatch(components, /\[aria-checked=true\] \.toggle-switch::after/,
    'the knob is back on aria-checked');
  assert.match(components, /\.toggle-switch input\[type=checkbox\]\{position:absolute/,
    'the checkbox must cover the whole track so the row is tappable');
  for (const page of PAGES) {
    const html = read(`${page}.html`);
    if (page === 'payment') {
      assert.match(html, /js\/appearance-boot\.js/);
      assert.match(html, /js\/theme-entry\.js/);
      assert.doesNotMatch(html, /id="darkModeToggle"/); // Latest scope removes extra counter settings, not saved AMOLED support.
      continue;
    }
    if (page === 'student') {
      /* The approved student layout keeps options inline in More. It uses the
         same native switch and appearance module as staff, without a duplicate
         Settings route. */
      const row = html.match(/<label class="more-menu-row more-toggle theme-switch">[\s\S]{0,1400}?<\/label>/);
      assert.ok(row, 'student.html has no More theme switch row');
      assert.match(row[0], /<input type="checkbox" data-settings-toggle="theme" id="moreDarkModeToggle">/);
      assert.match(row[0], /<span class="more-setting-copy"><strong>[^<]+<\/strong><small>[^<]+<\/small><\/span>/);
      continue;
    }
    const row = html.match(/<label class="settings-toggle theme-switch">[\s\S]{0,1400}?<\/label>/);
    assert.ok(row, `${page}.html has no theme switch row`);
    assert.match(row[0], /<span class="toggle-switch"><input type="checkbox" id="darkModeToggle"><i><\/i><\/span>/,
      `${page}.html: the switch is not connected to the checkbox`);
    // Title and sub-label are two lines — a plain <span> collapses them into one.
    assert.match(row[0], /<span class="settings-copy"><strong>[^<]+<\/strong><small>[^<]+<\/small><\/span>/,
      `${page}.html: the switch label no longer stacks title over sub-label`);
  }
});

test('the wallet skin is a screen-only layer with accessible blur fallbacks', () => {
  const skin = read('css/ui-wallet.css');
  assert.match(skin.trimStart(), /^\/\*[\s\S]*?\*\/\s*@media screen \{/,
    'print must retain the flat ink-friendly document');
  const supports = skin.indexOf('@supports ((-webkit-backdrop-filter');
  assert.ok(supports > -1, 'dialog blur must stay behind a capability check');
  assert.doesNotMatch(skin.slice(0, supports), /(?:-webkit-)?backdrop-filter\s*:(?!\s*none\b)/,
    'an ordinary card or topbar must not depend on blur');
  assert.match(skin, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*backdrop-filter: none/);
  assert.match(skin, /@media \(prefers-reduced-motion: reduce\)[\s\S]*scroll-behavior: auto/);
  const imports = [...read('css/design-system.css').matchAll(/@import\s+url\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)].map(m => m[1]);
  assert.equal(imports.at(-1), 'ui-wallet.css', 'the active skin must load last');
});

test('AMOLED glass keeps the canvas black and the text readable', () => {
  const css = read('css/foundation.css');
  const dark = name => token(css, 'html[data-theme=dark]', `--${name}`);
  const alpha = value => {
    const match = value.match(/rgba\([^)]*?,\s*([\d.]+)\s*\)/);
    assert.ok(match, `${value} is not an rgba() value`);
    return Number(match[1]);
  };
  // A frosted card on true black is still mostly the canvas: 5–8 % white keeps
  // the pixels off AND keeps #f4f6fa on it far above AA (see the contrast test).
  assert.ok(alpha(dark('glass-surface')) <= 0.08,
    'the dark glass pane is too bright for a true-black canvas');
  assert.ok(alpha(dark('glass-chip')) <= 0.1,
    'the dark glass chip is too bright for a true-black canvas');
  // The one lift that must stay visible on black is the glass rim.
  assert.ok(alpha(dark('glass-border')) >= 0.08, 'the glass rim disappears on black');
  assert.match(dark('glass-shadow'), /rgba\(0,0,0,0\)/,
    'a black shadow on black is only paint work — the card shadow must stay transparent');
});

test('the logo follows the theme instead of staying a white plate', () => {
  // Two artworks, same drawing: the light one is the original, the dark one is
  // the same ink re-painted for a black canvas (light strokes, lifted accents).
  const png = name => readFileSync(new URL(`../assets/icons/${name}`, import.meta.url));
  const [light, dark] = [png('logo-128.png'), png('logo-128-dark.png')];
  for (const [name, bytes] of [['logo-128.png', light], ['logo-128-dark.png', dark]]) {
    // IHDR: width, height, bit depth, colour type. Colour type 6 = RGBA, so the
    // mark can sit on any background (no baked-in white).
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.equal(width, 128, `${name}: width changed`);
    assert.equal(height, 128, `${name}: height changed`);
    assert.equal(bytes[25], 6, `${name}: the plate is still baked in (not RGBA)`);
  }
  assert.notDeepEqual([...light.subarray(0, 500)], [...dark.subarray(0, 500)],
    'the dark artwork is a copy of the light one');

  // Every page paints the logo through the same swapper, early in <head>, and
  // the swapper is the only place that knows both file names.
  const swapper = readFileSync(new URL('../js/theme-logos.js', import.meta.url), 'utf8');
  assert.match(swapper, /logo-128\.png/);
  assert.match(swapper, /logo-128-dark\.png/);
  assert.match(swapper, /active-plus-appearance-v2/, 'the swapper must read the same stored theme as the app');
  assert.match(swapper, /apc:theme/, 'the swapper must follow live theme changes');
  for (const page of PAGES) {
    const html = read(`${page}.html`);
    const boot = html.indexOf('js/appearance-boot.js');
    const logos = html.indexOf('js/theme-logos.js');
    assert.ok(boot > -1 && logos > boot, `${page}.html: the logo swapper must load with the pre-paint boot`);
    assert.ok(html.indexOf('js/theme-logos.js') < html.indexOf('</head>'), `${page}.html: the swapper loads too late`);
  }
  // And the shell ships both files, or an offline install would fall back.
  const sw = read('sw.js');
  assert.ok(sw.includes("'./assets/icons/logo-128.png'"), 'the light logo left the precache');
  assert.ok(sw.includes("'./assets/icons/logo-128-dark.png'"), 'the dark logo is not precached');
});
