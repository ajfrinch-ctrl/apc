const { test, expect } = require('./fixtures.cjs');

const { enterPortal } = require('./portal-session.cjs');

/* Layout acceptance uses a provisioned device-bound test session, like the
   other portal specs. First-admin generation, online ownership checks and
   sign-in are separately exercised by first-admin-setup.test.mjs. No production
   login or permission check is bypassed or changed by this presentation work. */
async function setup(page) {
  await enterPortal(page, 'admin');
  await expect(page.locator('#adminShell')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [320, 360, 375, 390, 412, 430]) {
  test(`Admin sections, icons and footer fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await setup(page);
    for (const view of ['dashboard', 'staff', 'students', 'reports', 'system', 'roles', 'migration', 'academics', 'data', 'backup', 'audit', 'security', 'settings', 'more', 'profile', 'advice']) {
      await page.evaluate(view => { location.hash = view; }, view);
      await expect(page.locator(`.admin-view.active[data-view-panel="${view}"]`)).toBeVisible();
      await expect(page.locator('.admin-view.active')).toHaveCount(1);
      const seat = ({ students: 'dashboard', roles: 'system', migration: 'system', academics: 'system', security: 'system', settings: 'system', data: 'more', backup: 'more', audit: 'more', profile: 'more', advice: 'more', more: 'more' })[view] || view;
      await expect(page.locator('.admin-bottom [aria-current="page"]')).toHaveAttribute('data-admin-view', seat);
      const result = await page.evaluate(() => {
        const bar = document.querySelector('.admin-bottom').getBoundingClientRect();
        const main = document.querySelector('#adminMain');
        main.scrollTop = main.scrollHeight;
        const overflow = [...document.querySelectorAll('.admin-shell *')].filter(el => {
          const strip = el.closest('.chip-row');
          if (strip && /^(auto|scroll)$/.test(getComputedStyle(strip).overflowX)) return false;
          const carouselViewport = el.closest('.hero-slider__viewport');
          if (carouselViewport && getComputedStyle(carouselViewport).overflowX === 'hidden') return false;
          const r = el.getBoundingClientRect();
          return r.width && r.height && (r.left < -1 || r.right > innerWidth + 1);
        }).map(el => el.className);
        return {
          overflow,
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          covered: document.querySelector('.admin-view.active').getBoundingClientRect().bottom > bar.top + 1,
          footerVisible: bar.top >= 0 && bar.bottom <= innerHeight,
          labels: [...document.querySelectorAll('.admin-bottom .nav-label')].every(el => parseFloat(getComputedStyle(el).fontSize) >= 11 && el.scrollWidth <= el.clientWidth + 1)
        };
      });
      expect(result, view).toEqual({ overflow: [], pageOverflow: false, covered: false, footerVisible: true, labels: true });
    }
    await expect(page.locator('.admin-bottom button')).toHaveCount(5);
    // Icons are inline SVG now: one per container, drawn, and never overflowing
    // the chip, card, button, header or bottom bar that holds them.
    const icons = page.locator('.admin-shell svg.nav-icon, .admin-shell svg.admin-feature-icon-svg, .admin-shell svg.admin-more-icon-svg, .admin-shell svg.app-topbar-icon');
    expect(await icons.count()).toBeGreaterThan(4);
    const iconFit = await page.evaluate(() => {
      const bad = [];
      for (const svg of document.querySelectorAll('.admin-shell svg.nav-icon, .admin-shell svg.admin-feature-icon-svg, .admin-shell svg.admin-more-icon-svg, .admin-shell svg.app-topbar-icon')) {
        const box = svg.getBoundingClientRect();
        const parent = svg.parentElement.getBoundingClientRect();
        if (!parent.width && !parent.height) continue; // inactive views are legitimately hidden
        if (!box.width || !box.height) bad.push('empty:' + svg.parentElement.className);
        else if (box.width > parent.width + 1 || box.height > parent.height + 1) bad.push('overflow:' + svg.parentElement.className);
        if (!svg.querySelector('image[href], path, circle, rect')) bad.push('blank:' + svg.parentElement.className);
      }
      return bad;
    });
    expect(iconFit).toEqual([]);
    await page.locator('.admin-bottom [data-admin-view="staff"]').click();
    await expect(page.locator('.admin-bottom [aria-current="page"]')).toHaveAttribute('data-admin-view', 'staff');
    await page.evaluate(() => { location.hash = 'finance'; });
    await expect(page.locator('[data-view-panel="teaching"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
