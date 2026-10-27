const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');
// Five shared seats: Home, Staff, Reports, System, More. Data/Profile/Advice
// remain in the More hub; daily operations stay with their owning panels.
const mobileViews = ['dashboard', 'staff', 'reports', 'system', 'more'];
const systemViews = ['roles', 'security', 'settings', 'academics', 'migration'];
async function enter(page) {
  await enterPortal(page, 'admin');
  await expect(page.locator('#adminShell')).toBeVisible();
}
async function bottom(page, view) {
  await page.locator(`.admin-bottom [data-admin-view="${view}"]`).click();
}
async function more(page, view) {
  await bottom(page, 'more');
  await page.locator(`#adminMoreMenu .admin-more-item[data-admin-view="${view}"]`).click();
}
function recordUnexpectedPageErrors(page, errors) {
  page.on('pageerror', error => {
    if (/auth\/network-request-failed/.test(error.message)) return; // offline Firebase in the test sandbox
    errors.push(error.message);
  });
}

test('Admin Home stays compact, readable and tappable at 320/390px in both themes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
  await enter(page);
  await page.evaluate(() => document.fonts.ready);
  const home = page.locator('.admin-view[data-view-panel="dashboard"]');
  await expect(home.locator('#dashTitle')).toContainText('স্বাগতম');
  await expect(home.locator('#adminTodayDate')).toBeVisible();
  await expect(home.locator('#adminHeroAdvice')).toBeVisible();
  await expect(home.locator('#adminFeatureGrid .admin-feature-tile')).toHaveCount(1);
  await expect(home.locator('.admin-portal-grid > a')).toHaveCount(3);

  for (const theme of ['light', 'dark']) {
    await page.evaluate(async choice => (await import('/js/appearance.js')).setTheme(choice), theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.evaluate(() => {
        const home = document.querySelector('.admin-view[data-view-panel="dashboard"]');
        const intro = home.querySelector('.admin-home-intro');
        const box = element => {
          const { left, right, top, bottom, height } = element.getBoundingClientRect();
          return { left, right, top, bottom, height };
        };
        const hero = box(intro);
        const approval = box(home.querySelector('#adminFeatureGrid .admin-feature-tile'));
        const links = [...home.querySelectorAll('.admin-portal-grid > a')].map(box);
        const footer = [...document.querySelectorAll('.admin-bottom button')].map(box);
        return {
          documentWidth: document.documentElement.scrollWidth,
          hero, approval, links, footer,
          backgroundImage: getComputedStyle(intro).backgroundImage,
          illustration: getComputedStyle(intro, '::after').content,
          adviceWidth: home.querySelector('#adminHeroAdvice').scrollWidth,
          adviceClientWidth: home.querySelector('#adminHeroAdvice').clientWidth,
          textColor: getComputedStyle(home.querySelector('#adminHeroAdvice')).color,
          weekdayColor: getComputedStyle(home.querySelector('.admin-weekday-label')).color,
          dateChipColor: getComputedStyle(home.querySelector('.admin-hero-date-chip')).color
        };
      });
      expect(layout.documentWidth).toBeLessThanOrEqual(width);
      expect(layout.backgroundImage).toBe('none');
      expect(layout.illustration).toBe('none');
      expect(layout.hero.height).toBeLessThan(300);
      expect(layout.adviceWidth).toBeLessThanOrEqual(layout.adviceClientWidth);
      expect(layout.textColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(layout.weekdayColor).toBe(layout.dateChipColor);
      expect(layout.hero.bottom).toBeLessThanOrEqual(layout.approval.top);
      expect(layout.approval.bottom).toBeLessThanOrEqual(layout.links[0].top);
      for (const rect of [layout.hero, layout.approval, ...layout.links, ...layout.footer]) {
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(width);
      }
      for (const rect of [layout.approval, ...layout.links, ...layout.footer]) {
        expect(rect.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: testInfo.outputPath(`admin-home-${width}-${theme}.png`) });
    }
  }
});

for (const width of [320, 390]) {
test(`compact dashboard and five-item mobile footer (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
      const errors = [];
      recordUnexpectedPageErrors(page, errors);
      await enter(page);
      const footer = page.locator('.admin-bottom');
      await expect(footer.locator('button')).toHaveCount(5);
      expect(await footer.locator('button').evaluateAll(buttons => buttons.map(b => b.dataset.adminView))).toEqual(mobileViews);
      await expect(page.locator('#dashTitle')).toBeVisible();
      await expect(page.locator('#adminTodayDate')).toHaveText('২২ সেপ্টেম্বর ২০২৬');
      await expect(page.locator('#adminTodayDate')).toHaveAttribute('datetime', '2026-09-22');
      await expect(page.locator('#adminHeroAdvice')).toBeVisible();
      const home = page.locator('.admin-view[data-view-panel="dashboard"]');
      await expect(home.locator('.teacher-hero-scene, [data-admin-hero-art], .admin-home-summary, .admin-hero-stats')).toHaveCount(0);
      await expect(home.locator('#adminMaintenanceFlag, #backupReminder, #adminQuickShortcuts, .teacher-chat-hub')).toHaveCount(0);
      await expect(home.locator('.admin-portal-grid > a')).toHaveCount(3);
      expect(await home.locator('.admin-portal-grid > a').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(['manager.html', 'teacher.html', 'payment.html']);
      // Student review lives on the roster, not in a duplicate dashboard queue.
      await expect(page.locator('.admin-hero-foot, #dashPendingCount')).toHaveCount(0);
      await expect(page.locator('#dashAppStatusRow, #dashTodayList, #dashPendingList, #dashNoticeCount')).toHaveCount(0);
      // Permission grid: one generated icon + one label per allowed section.
      const tiles = page.locator('#adminFeatureGrid .admin-feature-tile');
      await expect(tiles).toHaveCount(1);
      const quickGrid = page.locator('#adminFeatureGrid');
      const [quickGridBox, quickTileBox] = await Promise.all([quickGrid.boundingBox(), tiles.first().boundingBox()]);
      expect(Math.abs(quickTileBox.width - quickGridBox.width)).toBeLessThanOrEqual(1);
      // The current Admin skin uses full-width horizontal action cards.
      expect(await tiles.first().evaluate(tile => getComputedStyle(tile).flexDirection)).toBe('row');
      // One inline SVG per tile, inside a fixed container: never a missing image.
      expect(await tiles.locator('.admin-feature-icon svg').evaluateAll(icons => icons.length)).toBe(1);
      expect(await tiles.locator('.admin-feature-icon > svg').evaluateAll(icons => icons.every(icon => icon.querySelector('image[href], path, circle, rect')))).toBe(true);
      expect(await tiles.locator('.admin-feature-label').evaluateAll(labels => labels.every(label => label.textContent.trim().length > 1))).toBe(true);
      // System Owner monitoring is not mixed with the Cash Counter collection action.
      await expect(page.locator('#dashCollectFee, #btnFinanceGoCollect')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const view of mobileViews) {
        await bottom(page, view);
        await expect(page.locator(`.admin-view[data-view-panel="${view}"]`)).toBeVisible();
        await expect(footer.locator('[aria-current=page]')).toHaveCount(1);
        await expect(footer.locator('[aria-current=page]')).toHaveAttribute('data-admin-view', view);
      }
      // Every footer tab shows exactly one icon, inside its chip (no emoji, no
      // empty chip, no second painted icon).
      const icons = page.locator('.admin-bottom .nav-chip > svg.nav-icon');
      await expect(icons).toHaveCount(5);
      expect(await icons.evaluateAll(list => list.every(icon => Boolean(icon.querySelector('image[href], path, circle, rect'))))).toBe(true);
      // The selected tab changes colour and background — it never grows past its
      // container, so an icon can never ride over the label below it.
      const activeChip = await page.locator('.admin-bottom [aria-current=page] .nav-chip').boundingBox();
      const activeIcon = await page.locator('.admin-bottom [aria-current=page] svg.nav-icon').boundingBox();
      expect(activeIcon.width).toBeLessThanOrEqual(activeChip.width);
      expect(activeIcon.height).toBeLessThanOrEqual(activeChip.height);
      const activeBg = await page.locator('.admin-bottom [aria-current=page] .nav-chip').evaluate(el => getComputedStyle(el).backgroundColor);
      const idleBg = await page.locator('.admin-bottom button:not([aria-current=page]) .nav-chip').first().evaluate(el => getComputedStyle(el).backgroundColor);
      expect(activeBg).not.toBe(idleBg);
      // Labels stay readable and are never clipped away.
      expect(await page.locator('.admin-bottom .nav-label').evaluateAll(labels => labels.every(label => label.textContent.trim().length > 1))).toBe(true);
      expect(await page.locator('.admin-bottom .nav-label').evaluateAll(labels => labels.every(label => parseFloat(getComputedStyle(label).fontSize) >= 11))).toBe(true);

      // সিস্টেম hub: four cards, each opening the screen that owns the work.
      await expect(page.locator('#adminSystemMenu .admin-more-item')).toHaveCount(5);
      await expect(page.locator('.teacher-panel-link')).toHaveCount(0);
      for (const view of systemViews) {
        await bottom(page, 'system');
        const button = page.locator(`#adminSystemMenu[data-admin-view="${view}"], #adminSystemMenu .admin-more-item[data-admin-view="${view}"]`);
        await button.focus();
        await page.keyboard.press('Enter');
        const panel = page.locator(`.admin-view[data-view-panel="${view}"]`);
        await expect(panel).toBeVisible();
        await expect(panel.locator('h1')).toBeFocused();
        await expect(footer.locator('[aria-current=page]')).toHaveAttribute('data-admin-view', 'system');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      // More maps Data, Content, Profile and Advice without a sixth bottom seat.
      await bottom(page, 'more');
      await expect(page.locator('#adminMoreMenu .admin-more-item')).toHaveCount(4);
      expect(await page.locator('#adminMoreMenu .admin-more-item').evaluateAll(items => items.map(item => item.dataset.adminView))).toEqual(['data', 'content', 'profile', 'advice']);
      await page.locator('#adminMoreMenu .admin-more-item[data-admin-view=data]').click();
      await expect(page.locator('.admin-view[data-view-panel=data]')).toBeVisible();
      await expect(footer.locator('[aria-current=page]')).toHaveAttribute('data-admin-view', 'more');
      await expect(page.locator('#adminDataMenu .admin-more-item')).toHaveCount(1);
      await page.locator('#adminDataMenu .admin-more-item[data-admin-view=backup]').click();
      await expect(page.locator('.admin-view[data-view-panel=backup]')).toBeVisible();
      await expect(footer.locator('[aria-current=page]')).toHaveAttribute('data-admin-view', 'more');
      // Subview Back buttons are intentionally hidden in the five-seat shell.
      await bottom(page, 'more');
      await page.locator('#adminMoreMenu .admin-more-item[data-admin-view=data]').click();
      await expect(page.locator('.admin-view[data-view-panel=data]')).toBeVisible();
      await bottom(page, 'more');
      await expect(page.locator('.admin-view[data-view-panel=more]')).toBeVisible();
      await page.locator('#adminMoreMenu .admin-more-item[data-admin-view=advice]').click();
      await expect(page.locator('.admin-view[data-view-panel=advice]')).toBeVisible();
      await page.locator('[data-admin-section-toggle="advice-editor"]').click();
      await expect(page.locator('#adminDailyAdvice [data-advice-list]')).toBeVisible();
      await expect(footer.locator('[aria-current=page]')).toHaveAttribute('data-admin-view', 'more');
      await bottom(page, 'more');
      await expect(page.locator('.admin-view[data-view-panel=more]')).toBeVisible();
      await bottom(page, 'reports');
      await expect(page.locator('.admin-view[data-view-panel="reports"]')).toBeVisible();
      await expect(page.locator('#adminReports')).toBeVisible();
      await expect(page.locator('#feeStudentSearch, #feeCollectionForm')).toHaveCount(0);
      await expect(footer.locator('[aria-current=page]')).toHaveAttribute('data-admin-view', 'reports');
      await bottom(page, 'staff');
      await expect(page.locator('#staffList .staff-card').first()).toBeVisible();
      await bottom(page, 'dashboard');
      await expect(page.locator('#dashCollectFee')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

for (const width of [320, 390]) {
  test(`Staff Management cards and action menus start collapsed and reset on navigation/filter changes (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await enter(page);
    await bottom(page, 'staff');

    const cards = page.locator('#staffList .staff-card');
    const backdrop = page.locator('#staffModalBackdrop');
    const sheet = page.locator('#staffModalBackdrop.is-more-sheet .staff-more-menu');
    const openMenus = sheet;
    await expect(cards).toHaveCount(4);
    await expect(page.locator('.admin-view.active')).toHaveCount(1);
    await expect(page.locator('.admin-view.active')).toHaveAttribute('data-view-panel', 'staff');
    await expect(openMenus).toHaveCount(0);
    await expect(page.locator('#staffSort')).toBeVisible();
    await page.locator('#staffSort').selectOption('role');
    await expect(page.locator('#staffList .staff-card').nth(0)).toHaveAttribute('data-staff-card', 'STF-0001');
    await page.locator('#staffSort').selectOption('default');

    const collapsedDetails = page.locator('#staffList .staff-card-details[hidden]');
    const ownerCard = page.locator('#staffList [data-staff-card="STF-0001"]');
    const managerCard = page.locator('#staffList [data-staff-card="STF-0002"]');
    const ownerDetails = ownerCard.locator('.staff-card-details');
    const managerDetails = managerCard.locator('.staff-card-details');
    const ownerMore = ownerCard.locator('.more-btn');
    const managerMore = managerCard.locator('.more-btn');
    await expect(collapsedDetails).toHaveCount(4);
    await expect(page.locator('#staffList .staff-details-toggle[aria-expanded="false"]')).toHaveCount(4);
    await expect(page.locator('#staffList .staff-card-mobile-summary')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await ownerCard.locator('.staff-details-toggle').click();
    await expect(ownerDetails).toBeVisible();
    await expect(ownerCard.locator('.staff-card-summary-line')).toContainText('মোবাইল নেই');
    await expect(page.locator('#staffList .staff-details-toggle[aria-expanded="true"]')).toHaveCount(1);
    await ownerMore.click();
    await expect(backdrop).toBeVisible();
    await expect(sheet).toBeVisible();
    await expect(openMenus).toHaveCount(1);
    await expect(ownerMore).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#staffModalBody .staff-more-item')).toHaveCount(1); // System Owner: reset only.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(backdrop).toBeHidden();
    await expect(openMenus).toHaveCount(0);
    await expect(ownerMore).toHaveAttribute('aria-expanded', 'false');
    await expect(ownerMore).toBeFocused();

    // The sheet is a true modal surface: actions are outside the card and the
    // original More trigger regains focus when the user taps the backdrop.
    await managerCard.locator('.staff-details-toggle').click();
    await expect(ownerDetails).toBeHidden();
    await expect(managerDetails).toBeVisible();
    await expect(page.locator('#staffList .staff-details-toggle[aria-expanded="true"]')).toHaveCount(1);
    await managerMore.click();
    await expect(sheet).toBeVisible();
    await expect(page.locator('#staffModalBody .staff-more-item')).toHaveCount(4);
    await expect(managerMore).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#staffModalBackdrop .staff-modal').evaluate(async dialog => {
      await Promise.all(dialog.getAnimations().map(animation => animation.finished));
    });
    const sheetBox = await page.locator('#staffModalBackdrop .staff-modal').boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(Math.abs(sheetBox.x + sheetBox.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(sheetBox.y + sheetBox.height - viewport.height)).toBeLessThanOrEqual(2);
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#staffModalBackdrop [data-staff-modal="close"]')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#staffModalBody .staff-more-item').last()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#staffModalBackdrop [data-staff-modal="close"]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#staffModalBody .staff-more-item').first()).toBeFocused();
    await backdrop.click({ position: { x: 4, y: 4 } });
    await expect(backdrop).toBeHidden();
    await expect(managerMore).toHaveAttribute('aria-expanded', 'false');
    await expect(managerMore).toBeFocused();

    // The close button works after repeated open/close cycles too.
    await managerMore.click();
    await expect(sheet).toBeVisible();
    await page.locator('#staffModalBackdrop [data-staff-modal="close"]').click();
    await expect(backdrop).toBeHidden();
    await expect(openMenus).toHaveCount(0);

    // Changing the list filter closes transient actions rather than leaving a
    // hidden menu or expanded detail poised to reopen when the filter is cleared.
    await page.locator('#staffRoleFilter [data-staff-role="teacher"]').click();
    await expect(cards).toHaveCount(1);
    await expect(openMenus).toHaveCount(0);
    await expect(page.locator('#staffList .staff-card-details[hidden]')).toHaveCount(1);
    await page.locator('#staffRoleFilter [data-staff-role="all"]').click();
    await expect(cards).toHaveCount(4);

    // Refreshing while a disclosure is open clears its transient state too.
    await page.locator('#staffList [data-staff-card="STF-0001"] .staff-details-toggle').click();
    await expect(ownerDetails).toBeVisible();
    await page.reload();
    await expect(page.locator('#adminShell')).toBeVisible();
    await bottom(page, 'staff');
    await expect(page.locator('.admin-view.active')).toHaveAttribute('data-view-panel', 'staff');
    await expect(page.locator('#staffList .staff-card-details[hidden]')).toHaveCount(4);
    await expect(openMenus).toHaveCount(0);

    // Leaving and re-entering Staff starts with a clean, collapsed state.
    await page.locator('#staffList [data-staff-card="STF-0001"] .staff-details-toggle').click();
    await expect(ownerDetails).toBeVisible();
    await page.locator('#staffList [data-staff-card="STF-0001"] .more-btn').click();
    await expect(openMenus).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(openMenus).toHaveCount(0);
    await bottom(page, 'dashboard');
    await bottom(page, 'staff');
    await expect(openMenus).toHaveCount(0);
    await expect(page.locator('.admin-view.active')).toHaveCount(1);
    await expect(page.locator('.admin-view.active')).toHaveAttribute('data-view-panel', 'staff');
    await expect(page.locator('#staffList .more-btn[aria-expanded="false"]')).toHaveCount(4);
    await expect(collapsedDetails).toHaveCount(4);
    await expect(page.locator('#staffList .staff-details-toggle[aria-expanded="false"]')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('the Admin Profile omits the staff summary and the Staff tab owns the full directory', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  await more(page, 'profile');
  await page.locator('[data-settings-hub="admin"] [data-settings-open="account"]').click();
  const subtitleColors = await page.evaluate(() => {
    const subtitle = document.querySelector('.admin-view[data-view-panel="profile"] .profile-page-sub');
    document.documentElement.dataset.theme = 'light';
    const light = getComputedStyle(subtitle).color;
    document.documentElement.dataset.theme = 'dark';
    const dark = getComputedStyle(subtitle).color;
    document.documentElement.dataset.theme = 'light';
    return { light, dark };
  });
  expect(subtitleColors.light).not.toBe('rgba(0, 0, 0, 0)');
  expect(subtitleColors.dark).not.toBe('rgba(0, 0, 0, 0)');
  expect(subtitleColors.dark).not.toBe(subtitleColors.light, 'the subtitle remains readable in both themes');

  const profile = page.locator('.admin-view[data-view-panel="profile"]');
  const identity = page.locator('#adminProfileCard');
  await expect(identity.locator('.admin-profile-hero')).toBeVisible();
  await expect(identity.locator('.profile-row')).toHaveCount(5);
  expect((await identity.locator('.profile-row dt').allTextContents()).map(label => label.trim())).toEqual([
    'স্টাফ আইডি', 'মোবাইল', 'ইমেইল', 'স্ট্যাটাস', 'যোগদান'
  ]);
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(identity.locator('[data-admin-profile-edit]')).toBeVisible();
  const narrowHero = await identity.locator('.admin-profile-hero').boundingBox();
  expect(narrowHero.x).toBeGreaterThanOrEqual(0);
  expect(narrowHero.x + narrowHero.width).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(profile.locator('#staffOverviewProfile, .staff-overview-card, .staff-overview-count')).toHaveCount(0);

  // The Account group retains the editor; staff management stays on its tab.
  await expect(profile.locator('#adminProfileForm')).toBeVisible();
  await expect(profile.locator('#adminProfileName')).toBeVisible();
  await more(page, 'profile');
  await expect(profile.locator('[data-settings-groups]')).toBeVisible();
  await profile.locator('[data-settings-open="account"]').click();
  await expect(profile.locator('#adminProfileForm')).toBeVisible();
  await bottom(page, 'staff');
  await expect(page.locator('.admin-view.active')).toHaveAttribute('data-view-panel', 'staff');
  await expect(page.locator('#staffList .staff-card')).toHaveCount(4);
  await more(page, 'profile');
  await expect(profile.locator('#staffOverviewProfile, .staff-overview-card')).toHaveCount(0);
  await bottom(page, 'staff');
  await expect(page.locator('.admin-view.active')).toHaveAttribute('data-view-panel', 'staff');
});

test('the Admin student roster retains filters and exposes pending review actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  // The offline panel intentionally starts with an empty roster. Seed only this
  // isolated browser context so route/filter assertions use known records.
  await page.evaluate(async students => {
    const { saveRoster } = await import('/js/office-data.js');
    if (!saveRoster(students)) throw new Error('E2E roster fixture could not be stored');
  }, [
    { id: 'AP-E2E-001', name: 'রাইসা ইসলাম', nameEn: 'Raisa Islam', className: 'দশম শ্রেণি', status: 'approved', mobile: '01700000001', attendance: 0, average: 0, monthlyFee: null },
    { id: 'AP-E2E-002', name: 'ইমন হাসান', nameEn: 'Imon Hasan', className: 'নবম শ্রেণি', status: 'pending', mobile: '01700000002', attendance: 0, average: 0, monthlyFee: null }
  ]);
  await page.reload();
  await expect(page.locator('#adminShell')).toBeVisible();
  const alertClose = page.locator('#apcAlertBackdrop [data-apc-alert-close]').first();
  await alertClose.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
  if (await alertClose.isVisible().catch(() => false)) await alertClose.click();
  const studentShortcut = page.locator('#adminFeatureGrid .admin-feature-tile[data-admin-view="students"]');
  await expect(studentShortcut).toBeVisible();
  await studentShortcut.click();
  await expect(page.locator('.admin-view[data-view-panel="students"]')).toBeVisible();
  await expect(page.locator('.admin-bottom [aria-current=page]')).toHaveAttribute('data-admin-view', 'dashboard');

  const firstStudent = page.locator('#studentList .student-row').first();
  await expect(firstStudent).toBeVisible();
  const studentName = (await firstStudent.locator('.student-copy strong').innerText()).trim();
  const statusClass = await firstStudent.locator('.badge').getAttribute('class');
  const status = /badge-approved/.test(statusClass) ? 'approved' : /badge-rejected/.test(statusClass) ? 'rejected' : 'pending';
  const search = page.locator('#studentSearch');
  await search.fill(studentName);
  await expect(page.locator('#studentList .student-row')).toHaveCount(1);
  await page.locator('#studentFilterToggle').click();
  await expect(page.locator('#studentFilterToggle')).toHaveAttribute('aria-expanded', 'true');
  const selectedFilter = page.locator(`[data-student-filter=${status}]`);
  await selectedFilter.click();
  await expect(selectedFilter).toHaveClass(/active/);
  await expect(page.locator('#studentList .student-row')).toHaveCount(1);

  await bottom(page, 'dashboard');
  await expect(page.locator('.admin-view[data-view-panel="dashboard"]')).toBeVisible();
  await studentShortcut.click();
  await expect(search).toHaveValue(studentName);
  await expect(selectedFilter).toHaveClass(/active/);
  await expect(page.locator('#studentList .student-row')).toHaveCount(1);

  // Clear the query to inspect the pending queue and its role-authorized review
  // controls; direct approval is still mediated by the shared review dialog.
  await search.fill('');
  const pendingFilter = page.locator('[data-student-filter=pending]');
  await pendingFilter.click();
  await expect(pendingFilter).toHaveClass(/active/);
  const pendingCount = await page.locator('#studentList .student-row').count();
  await expect(page.locator('#studentList [data-action=view]')).toHaveCount(pendingCount);
  await expect(page.locator('#studentList [data-action=review-registration]')).toHaveCount(pendingCount);
  await expect(page.locator('#studentList [data-action=approve], #studentList [data-action=reject]')).toHaveCount(0);
  await expect(page.locator('.manager-approval-note')).toHaveCount(0);
  if (pendingCount > 0) {
    await page.locator('#studentList [data-action=review-registration]').first().click();
    await expect(page.locator('#apcRegistrationReview')).toBeVisible();
    await expect(page.locator('#apcRegistrationReview [data-review-decision=approved]')).toBeVisible();
    await page.locator('#apcRegistrationReview [data-review-later]').click();
    await expect(page.locator('#apcRegistrationReview')).toHaveCount(0);
  }
});

test('a hash route opens only what this role may open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  await expect(page.locator('.admin-view[data-view-panel=dashboard]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#staff'; });
  await expect(page.locator('.admin-view[data-view-panel=staff]')).toBeVisible();
  await expect(page.locator('.admin-bottom [aria-current=page]')).toHaveAttribute('data-admin-view', 'staff');
  // Unknown or foreign routes never move the panel.
  await page.evaluate(() => { window.location.hash = '#finance'; });
  await expect(page.locator('.admin-view[data-view-panel=staff]')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#teaching'; });
  await expect(page.locator('.admin-view[data-view-panel=staff]')).toBeVisible();
  // Nothing role-foreign is in the DOM in the first place.
  await expect(page.locator('.teacher-panel-link, .pay-panel-link')).toHaveCount(0);
});

test('secondary controls remain functional after removing Home-only counters and shortcuts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  recordUnexpectedPageErrors(page, errors);
  await enter(page);
  await bottom(page, 'system');
  await page.locator('#adminSystemMenu .admin-more-item[data-admin-view=settings]').click();
  await page.locator('[data-admin-section-toggle="settings-classes"]').click();
  const enabled = page.locator('#classList input:checked');
  const className = await enabled.first().getAttribute('data-class-name');
  const classRow = page.locator('#classList .class-row').filter({ hasText: className });
  await classRow.locator('label.switch').click();
  await expect(page.locator(`#classList input[data-class-name="${className}"]`)).not.toBeChecked();
  await bottom(page, 'dashboard');
  await expect(page.locator('.admin-view[data-view-panel="dashboard"] .admin-home-summary')).toHaveCount(0);
  await bottom(page, 'system');
  await page.locator('#adminSystemMenu .admin-more-item[data-admin-view=settings]').click();
  await page.locator('[data-admin-section-toggle="settings-classes"]').click();
  await expect(page.locator(`#classList input[data-class-name="${className}"]`)).not.toBeChecked();
  // Notice publishing belongs to the Manager portal: creating a staff account
  // is the Admin-side equivalent and must stay fully functional.
  await bottom(page, 'staff');
  await page.locator('#staffCreateButton').click();
  await page.locator('#staffField-fullName').fill('মোবাইল স্টাফ');
  await page.locator('#staffForm [data-staff-create-step="1"] [data-staff-step-next]').click();
  await page.locator('#staffField-password').fill('Mobile-2026');
  await page.locator('#staffField-confirmPassword').fill('Mobile-2026');
  await page.locator('#staffField-role').selectOption('manager');
  await expect(page.locator('#staffField-username')).toHaveText(/\.manager\.apc$/);
  await page.locator('#staffForm [data-staff-create-step="2"] [data-staff-step-next]').click();
  await expect(page.locator('#staffForm [data-staff-create-step="3"]')).toBeVisible();
  await page.locator('#staffForm button[type=submit]').click();
  await expect(page.locator('#staffList')).toContainText('মোবাইল স্টাফ');
  await expect(page.locator('#staffList .staff-id-badge').first()).toContainText('STF-');
  await bottom(page, 'system');
  await page.locator('#adminSystemMenu .admin-more-item[data-admin-view=settings]').click();
  await expect(page.locator('#cfgMaintenanceMode')).toBeAttached();
  await page.locator('[data-admin-section-toggle="settings-branding"]').click();
  await page.locator('#btnSaveAppSettings').click();
  await expect(page.locator('.admin-toast')).toContainText('সংরক্ষিত');
  expect(errors).toEqual([]);
});

for (const width of [320, 390]) {
  test(`Account → Security → Account never carries stale Admin content (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = [];
    recordUnexpectedPageErrors(page, errors);
    await enter(page);
    const footer = page.locator('.admin-bottom');
    const groupNav = page.locator('[data-settings-hub="admin"] [data-settings-groups]');
    const groups = page.locator('[data-settings-hub="admin"] [data-settings-group]');

    await more(page, 'profile');
    await expect(page.locator('.admin-view[data-view-panel="profile"]')).toBeVisible();
    await page.locator('[data-settings-hub="admin"] [data-settings-open="account"]').click();
    await expect(page.locator('[data-settings-group="account"]')).toBeVisible();
    await expect(page.locator('[data-settings-group="security"]')).toBeHidden();
    // The redesigned Admin hub has no in-card Back button; re-enter via More.
    await more(page, 'profile');
    await page.locator('[data-settings-hub="admin"] [data-settings-open="security"]').click();
    await expect(page.locator('[data-settings-group="security"]')).toBeVisible();

    // Leave Account for the system Security page, then return to Account.
    await bottom(page, 'system');
    await page.locator('#adminSystemMenu .admin-more-item[data-admin-view="security"]').click();
    await expect(page.locator('.admin-view[data-view-panel="security"]')).toBeVisible();
    await expect(footer.locator('[aria-current=page]')).toHaveAttribute('data-admin-view', 'system');
    await more(page, 'profile');
    await expect(page.locator('.admin-view[data-view-panel="profile"]')).toBeVisible();
    await expect(groupNav).toBeVisible();
    await expect(groups).toHaveCount(5);
    await expect(page.locator('[data-settings-group]:not([hidden])')).toHaveCount(0);
    await expect(footer.locator('[aria-current=page]')).toHaveAttribute('data-admin-view', 'more');

    // Repeated account entry and the two group doors remain deterministic.
    await more(page, 'profile');
    await expect(groupNav).toBeVisible();
    await page.locator('[data-settings-hub="admin"] [data-settings-open="account"]').click();
    await expect(page.locator('[data-settings-group="account"]')).toBeVisible();
    await expect(page.locator('[data-settings-group="security"]')).toBeHidden();
    // The redesigned Admin hub has no in-card Back button; re-enter via More.
    await more(page, 'profile');
    await page.locator('[data-settings-hub="admin"] [data-settings-open="security"]').click();
    await expect(page.locator('[data-settings-group="security"]')).toBeVisible();
    await more(page, 'profile');
    await expect(groupNav).toBeVisible();
    await expect(page.locator('[data-settings-group]:not([hidden])')).toHaveCount(0);

    // Refresh restores the route but not the stale open group. Staff Back/Forward
    // intentionally leaves/returns to the panel rather than traversing each tab.
    await page.reload();
    await expect(page.locator('#adminShell')).toBeVisible();
    await expect(page.locator('.admin-view[data-view-panel="profile"]')).toBeVisible();
    await expect(page.locator('[data-settings-hub="admin"] [data-settings-groups]')).toBeVisible();
    await expect(page.locator('[data-settings-group]:not([hidden])')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/demo\/offline-roles\.html/);
    await page.goForward();
    await expect(page).toHaveURL(/admin\.html#profile/);
    await expect(page.locator('.admin-view[data-view-panel="profile"]')).toBeVisible();
    await expect(page.locator('[data-settings-group]:not([hidden])')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('wide viewport keeps the same five-item interface without a sidebar', async ({ page }) => {
  const viewportWidth = 1280;
  await page.setViewportSize({ width: viewportWidth, height: 900 });
  await enter(page);
  await expect(page.locator('.admin-side, .admin-nav-item')).toHaveCount(0);
  await expect(page.locator('.admin-bottom')).toBeVisible();
  await expect(page.locator('.admin-bottom button')).toHaveCount(5);
  const phoneShell = await page.locator('#adminShell').boundingBox();
  expect(phoneShell.width).toBe(430);
  expect(phoneShell.x).toBe(425);
  const bottomBar = await page.locator('.admin-bottom').boundingBox();
  expect(bottomBar.width).toBe(phoneShell.width);
  expect(bottomBar.x).toBe(phoneShell.x);
  const quickGrid = page.locator('#adminFeatureGrid');
  const quickTile = page.locator('#adminFeatureGrid .admin-feature-tile');
  await expect(quickTile).toHaveCount(1);
  const [quickGridBox, quickTileBox] = await Promise.all([quickGrid.boundingBox(), quickTile.boundingBox()]);
  expect(Math.abs(quickTileBox.width - quickGridBox.width)).toBeLessThanOrEqual(1);
  expect(await quickTile.evaluate(tile => getComputedStyle(tile).flexDirection)).toBe('row');
  for (const view of mobileViews) {
    await bottom(page, view);
    await expect(page.locator(`.admin-view[data-view-panel="${view}"]`)).toBeVisible();
    await expect(page.locator('.admin-bottom [aria-current=page]')).toHaveAttribute('data-admin-view', view);
  }
  for (const view of systemViews) {
    await bottom(page, 'system');
    await page.locator(`#adminSystemMenu .admin-more-item[data-admin-view="${view}"]`).click();
    await expect(page.locator(`.admin-view[data-view-panel="${view}"]`)).toBeVisible();
    await expect(page.locator('.admin-bottom [aria-current=page]')).toHaveAttribute('data-admin-view', 'system');
  }
  await more(page, 'data');
  await page.locator('#adminDataMenu .admin-more-item[data-admin-view=backup]').click();
  await expect(page.locator('.admin-view[data-view-panel=backup]')).toBeVisible();
  await expect(page.locator('.admin-bottom [aria-current=page]')).toHaveAttribute('data-admin-view', 'more');
});
