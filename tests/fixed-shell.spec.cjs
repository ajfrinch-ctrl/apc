const { test, expect } = require('./fixtures.cjs');
const { enterStudentApp, enterPortal } = require('./portal-session.cjs');

// These tests exercise the actual app scroll containers for every role. A tall
// sentinel makes the scroll deterministic without altering app storage or
// workflow data, then the real last-child geometry verifies footer clearance.
async function addScrollSentinel(page, mainSelector) {
  await page.locator(mainSelector).evaluate(main => {
    main.querySelector('[data-shell-scroll-sentinel]')?.remove();
    const sentinel = document.createElement('div');
    sentinel.dataset.shellScrollSentinel = 'true';
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = 'height:900px;min-height:900px;margin:0;padding:0;border:0;flex:none;';
    main.append(sentinel);
  });
}

async function chromeGeometry(page, { header, footer }) {
  return page.evaluate(({ header, footer }) => {
    const headerEl = document.querySelector(header);
    const footerEl = document.querySelector(footer);
    const top = headerEl.getBoundingClientRect();
    const bottom = footerEl.getBoundingClientRect();
    return {
      headerTop: top.top,
      headerBottom: top.bottom,
      headerPosition: getComputedStyle(headerEl).position,
      footerTop: bottom.top,
      footerBottom: bottom.bottom,
      footerPosition: getComputedStyle(footerEl).position,
      viewportHeight: innerHeight
    };
  }, { header, footer });
}

async function assertPinnedAfterScroll(page, selectors, mainSelector, scrollRoot) {
  await addScrollSentinel(page, mainSelector);
  const before = await chromeGeometry(page, selectors);
  expect(Math.abs(before.headerTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.footerBottom - before.viewportHeight)).toBeLessThanOrEqual(1);
  expect(['sticky', 'fixed']).toContain(before.headerPosition);
  expect(before.footerPosition).toBe('fixed');

  if (scrollRoot === 'document') {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  } else {
    await page.locator(mainSelector).evaluate(main => { main.scrollTop = main.scrollHeight; });
    await expect.poll(() => page.locator(mainSelector).evaluate(main => main.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  }

  const after = await chromeGeometry(page, selectors);
  expect(Math.abs(after.headerTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.footerBottom - after.viewportHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.headerTop - before.headerTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.footerTop - before.footerTop)).toBeLessThanOrEqual(1);
  const sentinelBottom = await page.locator(`${mainSelector} [data-shell-scroll-sentinel]`).evaluate(el => el.getBoundingClientRect().bottom);
  expect(sentinelBottom).toBeLessThanOrEqual(after.footerTop + 1);
}

const viewports = [
  { width: 390, height: 844 },
  { width: 844, height: 390 }
];

for (const viewport of viewports) {
  test(`Student header and bottom navigation stay pinned through scroll and tab returns (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await enterStudentApp(page);
    const selectors = { header: '#studentHeader', footer: '.bottom-nav' };
    const main = '#appMain';
    await assertPinnedAfterScroll(page, selectors, main, 'main');
    const tab = page.locator('.bottom-nav [data-view="routine"]');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await assertPinnedAfterScroll(page, selectors, main, 'main');
    await expect(page.locator('#routineView')).toBeVisible();
  });

  test(`Admin header and bottom navigation stay pinned on reports (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await enterPortal(page, 'admin');
    const selectors = { header: '#adminShell > .app-topbar', footer: '#adminShell > .admin-bottom' };
    const main = '#adminMain';
    const tab = page.locator('.admin-bottom [data-panel-view="reports"]');
    await tab.click();
    await expect(page.locator('.admin-view[data-view-panel="reports"]')).toBeVisible();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await assertPinnedAfterScroll(page, selectors, main, 'main');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await assertPinnedAfterScroll(page, selectors, main, 'main');
  });

  test(`Manager header and bottom navigation stay pinned on finance (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await enterPortal(page, 'manager');
    const selectors = { header: '#managerShell > .app-topbar', footer: '#managerShell > .admin-bottom' };
    const main = '#managerMain';
    const tab = page.locator('.manager-bottom [data-panel-view="finance"]');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => tab.evaluate(button => getComputedStyle(button).backgroundColor))
      .not.toBe('rgba(0, 0, 0, 0)');
    await assertPinnedAfterScroll(page, selectors, main, 'main');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await assertPinnedAfterScroll(page, selectors, main, 'main');
  });

  test(`Teacher header and bottom navigation stay pinned on classes (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await enterPortal(page, 'teacher');
    const selectors = { header: '#teacherShell > .app-topbar', footer: '#teacherShell > .admin-bottom' };
    const main = '#teacherMain';
    const tab = page.locator('.admin-bottom [data-panel-view="classes"]');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await assertPinnedAfterScroll(page, selectors, main, 'main');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await assertPinnedAfterScroll(page, selectors, main, 'main');
  });

  test(`Cash Counter header and bottom navigation stay pinned through document scroll (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await enterPortal(page, 'payment');
    const selectors = { header: '#payShell > .app-topbar', footer: '#payShell > .admin-bottom' };
    const main = '#paymentMain';
    const tab = page.locator('.admin-bottom [data-panel-view="payment"]');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await assertPinnedAfterScroll(page, selectors, main, 'document');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await assertPinnedAfterScroll(page, selectors, main, 'document');
  });
}

test('Manager keeps its phone shell and five-item bottom navigation on a wide desktop viewport', async ({ page }) => {
  const viewport = { width: 1280, height: 900 };
  await page.setViewportSize(viewport);
  await enterPortal(page, 'manager');
  const shell = page.locator('#managerShell');
  const nav = page.locator('#managerShell > .manager-bottom');
  const main = page.locator('#managerMain');
  await expect(shell).toBeVisible();
  await expect(nav).toBeVisible();

  const expected = [
    ['dashboard', 'হোম'], ['students', 'শিক্ষার্থী'], ['academic', 'একাডেমিক'],
    ['finance', 'হিসাব'], ['more', 'আরও']
  ];
  const actual = await nav.locator('button[data-panel-view]').evaluateAll(buttons =>
    buttons.map(button => [button.dataset.panelView, button.querySelector('.nav-label')?.textContent.trim()]));
  expect(actual).toEqual(expected);

  const initial = await page.evaluate(() => {
    const shell = document.querySelector('#managerShell');
    const header = shell.querySelector(':scope > .app-topbar');
    const nav = shell.querySelector(':scope > .manager-bottom');
    const main = document.querySelector('#managerMain');
    const rect = element => {
      const { top, right, bottom, left, width, height } = element.getBoundingClientRect();
      return { top, right, bottom, left, width, height };
    };
    return {
      shell: rect(shell), header: rect(header), nav: rect(nav), main: rect(main),
      shellDisplay: getComputedStyle(shell).display,
      headerPosition: getComputedStyle(header).position,
      navPosition: getComputedStyle(nav).position,
      navDirection: getComputedStyle(nav).flexDirection,
      viewportHeight: innerHeight
    };
  });
  expect(initial.shell.width).toBe(430);
  expect(initial.shell.left).toBe(425);
  expect(initial.shellDisplay).toBe('flex');
  expect(Math.abs(initial.header.left - initial.shell.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(initial.header.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(initial.main.left - (initial.shell.left + 1))).toBeLessThanOrEqual(1);
  expect(Math.abs(initial.main.width - (initial.shell.width - 2))).toBeLessThanOrEqual(1);
  expect(initial.nav.width).toBe(initial.shell.width);
  expect(Math.abs(initial.nav.left - initial.shell.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(initial.nav.bottom - initial.viewportHeight)).toBeLessThanOrEqual(1);
  expect(['sticky', 'relative']).toContain(initial.headerPosition);
  expect(initial.navPosition).toBe('fixed');
  expect(initial.navDirection).toBe('row');
  expect(await page.locator('.manager-bottom').evaluate(el => getComputedStyle(el).display)).toBe('flex');

  const initialHistoryLength = await page.evaluate(() => history.length);
  for (const [view] of expected) {
    const tab = nav.locator(`[data-panel-view="${view}"]`);
    await tab.click();
    await expect(page.locator(`.manager-view[data-view-panel="${view}"]`)).toBeVisible();
    await expect(page.locator('.manager-view.active')).toHaveCount(1);
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${view}`);
    await expect.poll(() => tab.evaluate(button => getComputedStyle(button).backgroundColor))
      .not.toBe('rgba(0, 0, 0, 0)');

    // Repeating the selected tab is idempotent: one visible panel and one active item.
    await tab.click();
    await expect(page.locator('.manager-view.active')).toHaveCount(1);
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    if (view === 'more') {
      for (const destination of ['profile', 'settings', 'reports', 'advice']) {
        await expect(page.locator(`#managerMoreHub [data-panel-view="${destination}"]`)).toBeVisible();
      }
      for (const destination of ['reports', 'advice']) {
        const row = page.locator(`#managerMoreHub [data-panel-view="${destination}"]`);
        await row.click();
        await expect(page.locator(`.manager-view[data-view-panel="${destination}"]`)).toBeVisible();
        await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-panel-view', 'more');
        await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${destination}`);
        await page.locator(`.manager-view[data-view-panel="${destination}"] [data-panel-view="more"]`).click();
        await expect(page.locator('.manager-view[data-view-panel="more"]')).toBeVisible();
        await row.click(); // Repeat from the hub: exactly one route/panel remains active.
        await expect(page.locator('.manager-view.active')).toHaveCount(1);
        await expect(page.locator(`.manager-view[data-view-panel="${destination}"]`)).toBeVisible();
        await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-panel-view', 'more');
        await page.locator(`.manager-view[data-view-panel="${destination}"] [data-panel-view="more"]`).click();
        await expect(page.locator('.manager-view[data-view-panel="more"]')).toBeVisible();
      }
    }
  }
  expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength);

  // More → Reports refreshes back into the same route and highlights More.
  await nav.locator('[data-panel-view="more"]').click();
  await page.locator('#managerMoreHub [data-panel-view="reports"]').click();
  await expect(page.locator('.manager-view.active')).toHaveAttribute('data-view-panel', 'reports');
  await expect(page.locator('.manager-view[data-view-panel="reports"] [data-panel-view="more"]')).toBeVisible();
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-panel-view', 'more');
  await page.reload();
  await expect(shell).toBeVisible();
  await expect(page.locator('.manager-view.active')).toHaveAttribute('data-view-panel', 'reports');
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-panel-view', 'more');
  await expect.poll(() => page.evaluate(() => history.length)).toBe(initialHistoryLength);

  await addScrollSentinel(page, '#managerMain');
  await main.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => main.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const afterScroll = await page.evaluate(() => {
    const header = document.querySelector('#managerShell > .app-topbar');
    const nav = document.querySelector('#managerShell > .manager-bottom');
    const rect = element => {
      const { top, right, bottom, left } = element.getBoundingClientRect();
      return { top, right, bottom, left };
    };
    return { header: rect(header), nav: rect(nav) };
  });
  expect(Math.abs(afterScroll.header.top - initial.header.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterScroll.nav.top - initial.nav.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterScroll.nav.bottom - initial.nav.bottom)).toBeLessThanOrEqual(1);
  const sentinelBottom = await page.locator('#managerMain [data-shell-scroll-sentinel]').evaluate(el => el.getBoundingClientRect().bottom);
  expect(sentinelBottom).toBeLessThanOrEqual(afterScroll.nav.top + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(/\/demo\/offline-roles\.html$/);
});
