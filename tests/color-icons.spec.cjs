const { test, expect } = require('./fixtures.cjs');
test.use({ serviceWorkers: 'block' });

/* The standalone icon gallery page retired with the preview/ snapshots, so the
   audit wall is rebuilt here from the shipped icon module itself: every
   illustration and glyph the app can paint, mounted into one page. The counts
   are part of the contract — adding artwork means updating them on purpose. */
const ILLUSTRATION_COUNT = 33;
const GLYPH_COUNT = 64;

for (const theme of ['light', 'dark']) test(`all colour/glyph artwork renders without invalid SVG or clipping (${theme})`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /<path>|<svg>|SVG|attribute d/i.test(message.text())) errors.push(message.text()); });
  await page.goto('/index.html');
  await page.evaluate(async () => {
    const set = await import('/js/icon-set.js');
    const { iconElement } = await import('/js/icons.js');
    const host = document.createElement('div');
    host.id = 'iconAudit';
    host.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:12px';
    const wall = (box, names) => {
      box.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
      for (const name of names) {
        const cell = document.createElement('span');
        cell.className = 'picture';
        cell.append(iconElement(name));
        box.append(cell);
      }
      host.append(box);
    };
    const illustrations = document.createElement('div');
    illustrations.id = 'illustrations';
    const glyphs = document.createElement('div');
    glyphs.id = 'glyphs';
    wall(illustrations, Object.keys(set.ILLUSTRATIONS));
    wall(glyphs, Object.keys(set.GLYPHS));
    host.append(illustrations, glyphs);
    document.body.append(host);
  });
  await expect(page.locator('#illustrations svg')).toHaveCount(ILLUSTRATION_COUNT);
  await expect(page.locator('#glyphs svg')).toHaveCount(GLYPH_COUNT);
  await page.evaluate(value => { document.documentElement.setAttribute('data-theme', value); }, theme);
  await page.evaluate(() => document.fonts.ready);
  const bad = await page.locator('.picture svg').evaluateAll(icons => icons.flatMap(svg => {
    const box = svg.getBBox();
    if (!box.width || !box.height || box.x < -.1 || box.y < -.1 || box.x + box.width > 24.1 || box.y + box.height > 24.1) return [svg.dataset.icon + ': cropped/empty'];
    if (svg.dataset.iconStyle === 'color') {
      const fills = new Set([...svg.querySelectorAll('[fill]')].map(el => getComputedStyle(el).fill).filter(fill => fill !== 'none'));
      if (fills.size < 2) return [svg.dataset.icon + ': not multicolour'];
    }
    return [];
  }));
  expect(bad).toEqual([]);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  if (theme === 'dark') await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  expect(errors).toEqual([]);
});
