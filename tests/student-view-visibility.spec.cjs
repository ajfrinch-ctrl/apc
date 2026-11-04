/* Regression for the Student shell's historical Home/Profile overlap and
   topbar rules that used to hide the header on selected routes. */
const { test, expect } = require('./fixtures.cjs');
const { enterStudentApp } = require('./portal-session.cjs');

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

async function expectOnlyStudentView(page, route) {
  await expect(page.locator(`.view[data-view-panel="${route}"]`)).toBeVisible();
  await expect(page.locator('.view.active')).toHaveCount(1);
  await expect(page.locator('.view:visible')).toHaveCount(1);
  // Class chat intentionally owns the full viewport and hides shell chrome.
  if (route === 'class-chat') await expect(page.locator('#studentHeader')).toBeHidden();
  else await expect(page.locator('#studentHeader')).toBeVisible();
}

test('bottom navigation and every Student route keep one view and the topbar visible', async ({ page }) => {
  await enterStudentApp(page);

  for (const view of ['home', 'courses', 'routine', 'exams', 'profile', 'home']) {
    await page.locator(`.bottom-nav [data-view="${view}"]`).click();
    await expectOnlyStudentView(page, view);
    if (view !== 'home') await expect(page.locator('#homeView')).toBeHidden();
  }

  // Exercise every shipped main and nested route through the real view router,
  // including Profile, ID card, Class hub and Study results pages.
  const routes = await page.locator('.view[data-view-panel]').evaluateAll(panels =>
    panels.map(panel => panel.dataset.viewPanel));
  for (const route of routes) {
    await page.evaluate(async route => {
      const { setView } = await import('/js/shell.js');
      setView(route, { history: 'keep' });
    }, route);
    await expectOnlyStudentView(page, route);
  }

  // Leave fullscreen chat before checking pending-approval shell chrome.
  await page.evaluate(async () => (await import('/js/shell.js')).setView('home', { history: 'keep' }));
  await expect(page.locator('#studentHeader')).toBeVisible();
  // The pending-approval state is still part of the signed-in Student panel;
  // keep the same topbar there while hiding regular navigation/content.
  await page.locator('#appShell').evaluate(shell => shell.classList.add('is-pending'));
  await expect(page.locator('#studentHeader')).toBeVisible();
  await expect(page.locator('#pendingScreen')).toBeVisible();
  await page.locator('#appShell').evaluate(shell => shell.classList.remove('is-pending'));
});

test('rapid tab/hash interleaving never leaves two student views visible', async ({ page }) => {
  await enterStudentApp(page);

  // Fire navigation from three directions without waiting in between — nav
  // clicks, hash writes and direct setView calls racing each other.
  await page.evaluate(async () => {
    const { setView } = await import('/js/shell.js');
    const taps = ['courses', 'routine', 'exams', 'profile', 'home'];
    const jobs = taps.map((view, index) => new Promise(resolve => {
      window.setTimeout(() => {
        const link = document.querySelector(`.bottom-nav [data-view="${view}"]`);
        if (index % 2 === 0 && link) link.click();
        else if (index % 2 === 1) window.location.hash = `#${view}`;
        resolve();
      }, index * 15);
    }));
    setView('exams', { history: 'keep' });
    await Promise.all(jobs);
    setView('home', { history: 'keep' });
  });
  await page.waitForTimeout(150);

  await expect(page.locator('.view.active')).toHaveCount(1);
  await expect(page.locator('.view:visible')).toHaveCount(1);
  await expect(page.locator('.view[data-view-panel="home"]')).toBeVisible();

  // One more pass over each bottom tab, checking after every single tap.
  for (const view of ['home', 'courses', 'routine', 'exams', 'profile']) {
    await page.locator(`.bottom-nav [data-view="${view}"]`).click();
    await expect(page.locator('.view.active')).toHaveCount(1);
    await expect(page.locator('.view:visible')).toHaveCount(1);
    await expect(page.locator(`.view[data-view-panel="${view}"]`)).toBeVisible();
  }
});
