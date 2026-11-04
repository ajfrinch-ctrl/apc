const { test, expect } = require('./fixtures.cjs');
const { enterStudentApp } = require('./portal-session.cjs');
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
for (const width of [320, 390, 430, 1024]) {
  test(`reference dashboard preserves shortcuts and navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await enterStudentApp(page);
    await expect(page.locator('#homeView')).toBeVisible();
    await expect(page.locator('#studentServices .pay-tile')).toHaveCount(7);
    await expect(page.locator('#dashboardPendingSummary')).not.toContainText('লোড');
    const advice = page.locator('#dailyQuoteCard');
    const hero = page.locator('#homeView .student-home-hero');
    const grid = page.locator('#studentServices');
    const routine = page.locator('.dashboard-today-section');
    await expect(hero).toBeVisible();
    await expect(advice).toBeHidden();
    await expect(hero.locator('[data-hero-slide]')).toHaveCount(4);
    await expect(page.locator('#homeView .hc-art')).toHaveCount(4);
    await expect(page.locator('#homeView .hc-art').first()).toHaveAttribute('aria-hidden', 'true');
    await expect.poll(() => page.evaluate(() => {
      const art = document.querySelector('.hc-art--welcome')?.dataset.art;
      const greeting = document.querySelector('#dayGreeting')?.textContent.trim();
      if (!document.querySelector('#birthdayBanner')?.hidden) return art === 'party' && greeting?.startsWith('শুভ জন্মদিন');
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
      const expectedArt = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 16 ? 'noon' : hour >= 16 && hour < 18 ? 'afternoon' : 'night';
      const expectedGreeting = hour >= 5 && hour < 12 ? 'শুভ সকাল' : hour >= 12 && hour < 17 ? 'শুভ অপরাহ্ণ' : hour >= 17 && hour < 20 ? 'শুভ সন্ধ্যা' : 'শুভ রাত্রি';
      return art === expectedArt && greeting === expectedGreeting;
    })).toBe(true);
    const emptyRoutineArtClear = await page.evaluate(() => {
      const action = document.querySelector('.dashboard-empty-card .challenge-open')?.getBoundingClientRect();
      const art = document.querySelector('.hc-art--today')?.getBoundingClientRect();
      if (!action || !art) return true;
      return action.right <= art.left || action.left >= art.right || action.bottom <= art.top || action.top >= art.bottom;
    });
    expect(emptyRoutineArtClear).toBe(true);
    await expect(page.locator('[data-daily-quote-date]')).not.toContainText('লোড হচ্ছে');
    await expect(page.locator('[data-daily-quote-text]')).not.toContainText('তৈরি হচ্ছে');
    await expect(page.locator('[data-daily-advice-summary]')).not.toContainText('লোড হচ্ছে');
    await expect(page.locator('#homeView [data-home-hero]')).toHaveCount(1);
    await expect(hero.locator('.hero-slider__controls button')).toHaveCount(2);
    await expect(hero.locator('.hero-slider__indicators [data-hero-dot]')).toHaveCount(4);
    await expect(page.locator('#homeRealStatsRow > div')).toHaveCount(2);
    const shortcuts = page.locator('#studentServices');
    const desktop = width >= 768;
    await expect(shortcuts).toHaveCSS('gap', desktop ? '12px' : width <= 359 ? '8px' : '9px');
    const shortcutHeight = await shortcuts.locator('.pay-tile').first().evaluate(el => el.getBoundingClientRect().height);
    expect(shortcutHeight).toBeGreaterThanOrEqual(desktop ? 138 : width <= 359 ? 92 : 100);
    await expect(shortcuts.locator('.pay-tile').first()).toHaveCSS('border-radius', desktop ? '25px' : '17px');
    await expect(shortcuts.locator('.pay-tile-icon').first()).toHaveCSS('width', desktop ? '68px' : '48px');
    await expect(shortcuts.locator('.pay-tile-icon').first()).toHaveCSS('height', desktop ? '68px' : '48px');
    await expect(shortcuts.locator('.pay-tile').first()).toHaveCSS('background-color', 'rgb(234, 242, 255)');
    await expect(shortcuts.locator('.pay-tile-label').first()).toHaveCSS('color', 'rgb(34, 79, 125)');
    await expect(shortcuts.locator('.pay-tile-icon svg').first()).toHaveCSS('filter', 'none');
    await expect(page.locator('.student-home-welcome')).toHaveCSS('background-color', 'rgb(234, 243, 255)');
    await expect(page.locator('.student-home-welcome .pay-hero-name')).toHaveCSS('color', 'rgb(23, 74, 118)');
    await expect(page.locator('.dashboard-today-section')).toHaveCSS('background-color', 'rgb(232, 245, 238)');
    await expect(hero).toHaveCSS('border-radius', width >= 768 ? '28px' : '22px');
    await expect(page.locator('#homeView .study-progress-card')).toHaveCSS('background-color', 'rgb(255, 242, 223)');
    await expect(page.locator('#homeView .study-progress-card #homeTitle')).toHaveCSS('color', 'rgb(118, 80, 27)');
    const order = await page.evaluate(() => {
      const nodes = ['.student-home-welcome', '.student-home-hero', '#dailyQuoteCard', '.dashboard-today-section',
        '#homeView .pay-hero.pay-hero-summary', '#studentServices', '.bottom-nav'];
      const ordered = nodes.map(selector => document.querySelector(selector));
      return ordered.every((node, index) => node && (
        index === ordered.length - 1 || Boolean(node.compareDocumentPosition(ordered[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING)
      ));
    });
    expect(order).toBe(true);
    expect((await routine.boundingBox()).y).toBeLessThan((await grid.boundingBox()).y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.bottom-nav .bottom-link')).toHaveCount(5);
    await expect(page.locator('.bottom-nav .bottom-link.active')).toHaveAttribute('data-view', 'home');
    const activeColor = await page.locator('.bottom-nav .bottom-link.active').evaluate(el => getComputedStyle(el).color);
    const activeChipColor = await page.locator('.bottom-nav .bottom-link.active .nav-chip').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(activeColor).toBe('rgb(85, 73, 179)');
    expect(activeChipColor).toBe('rgb(85, 73, 179)');
    await expect(page.locator('#notificationButton')).toBeVisible();
    await page.locator('#studentServices [data-view="exams"]').click();
    await expect(page.locator('#examsView')).toBeVisible();
    await page.locator('.bottom-nav [data-view="home"]').click();
    await expect(page.locator('.home-progress-details')).toHaveCount(0);
  });
}

test('Student Home pastel hero and quick-access cards keep readable contrast in dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterStudentApp(page);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await expect(page.locator('.student-home-welcome .pay-hero-name')).toHaveCSS('color', 'rgb(244, 246, 250)');
  await expect(page.locator('#homeView .study-progress-card #homeTitle')).toHaveCSS('color', 'rgb(244, 246, 250)');
  await expect(page.locator('#studentServices .pay-tile').first()).toHaveCSS('background-color', 'rgb(41, 75, 105)');
  await expect(page.locator('#studentServices .pay-tile-label').first()).toHaveCSS('color', 'rgb(242, 247, 255)');
  await expect(page.locator('#studentServices .pay-tile-icon svg').first()).toHaveCSS('filter', 'none');
});

for (const width of [320, 390, 430]) {
  test(`Student mobile routes share title/back rhythm and token surfaces at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await enterStudentApp(page);
    const routes = ['notice-board', 'routine', 'courses', 'exams', 'classes', 'reports', 'student-fee', 'my-profile', 'student-id-card', 'study-results'];
    for (const route of routes) {
      await page.evaluate(async route => {
        const { setView } = await import('/js/shell.js');
        setView(route, { history: 'keep' });
      }, route);
      const visual = await page.evaluate(route => {
        const view = document.querySelector('.view.active');
        const intro = view.querySelector(':scope > .page-intro');
        const title = intro?.querySelector('h1');
        const back = intro?.querySelector('.pay-back');
        const main = document.querySelector('#appMain');
        return {
          route,
          titleSize: title ? getComputedStyle(title).fontSize : '',
          titleWeight: title ? getComputedStyle(title).fontWeight : '',
          introPaddingTop: intro ? getComputedStyle(intro).paddingTop : '',
          backVisible: back ? getComputedStyle(back).display !== 'none' : false,
          backSize: back ? Math.round(back.getBoundingClientRect().width) : 0,
          headerTop: Math.round(document.querySelector('#studentHeader').getBoundingClientRect().top),
          noOverflow: document.documentElement.scrollWidth <= innerWidth && main.scrollWidth <= main.clientWidth
        };
      }, route);
      expect(visual.titleSize, route).toBe('21px');
      expect(visual.titleWeight, route).toBe('700');
      expect(visual.introPaddingTop, route).toBe('10px');
      expect(visual.backVisible, route).toBe(!['routine', 'courses', 'exams', 'classes'].includes(route));
      if (visual.backVisible) expect(visual.backSize, route).toBe(48);
      expect(visual.headerTop, route).toBe(0);
      expect(visual.noOverflow, route).toBe(true);
    }

    await page.evaluate(async () => {
      const { setView } = await import('/js/shell.js');
      setView('home', { history: 'keep' });
    });
    const home = await page.evaluate(() => {
      const resolve = property => {
        const probe = document.createElement('i');
        probe.style.color = `var(${property})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      const summary = document.querySelector('#homeView .pay-hero.pay-hero-summary');
      const card = summary.querySelector('.study-progress-card');
      return {
        avatar: getComputedStyle(document.querySelector('#homeView .student-home-welcome .pay-avatar')).backgroundColor,
        primary: resolve('--color-primary'),
        summaryBackground: getComputedStyle(summary).backgroundColor,
        cardBackground: getComputedStyle(card).backgroundColor,
        surface: resolve('--color-surface'),
        cardImage: getComputedStyle(card).backgroundImage,
        progressCardHeight: card.getBoundingClientRect().height,
        progressRingWidth: card.querySelector('.progress-ring').getBoundingClientRect().width,
        realStatsDisplay: getComputedStyle(card.querySelector('#homeRealStatsRow')).display,
        visibleMetricCount: card.querySelectorAll('#homeRealStatsRow > div').length,
        visibleMetricLabels: [...card.querySelectorAll('#homeRealStatsRow small')].map(el => el.textContent.trim()),
        profileLinkDisplay: getComputedStyle(summary.querySelector('.pay-hero-link')).display,
        statBackgrounds: [...card.querySelectorAll('.study-progress-stats > div')].map(el => getComputedStyle(el).backgroundColor),
        mutedSurface: (() => {
          const probe = document.createElement('i');
          probe.style.backgroundColor = 'var(--color-surface-muted)';
          document.body.append(probe);
          const color = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return color;
        })()
      };
    });
    expect(home.avatar).toBe(home.surface);
    expect(home.summaryBackground).toBe('rgba(0, 0, 0, 0)');
    expect(home.cardBackground).toBe('rgb(255, 242, 223)');
    expect(home.cardImage).toContain('linear-gradient');
    expect(home.progressCardHeight).toBeLessThan(240);
    expect(home.progressRingWidth).toBe(58);
    expect(home.realStatsDisplay).toBe('flex');
    expect(home.visibleMetricCount).toBe(2);
    expect(home.visibleMetricLabels).toEqual(['উপস্থিতি', 'গড় ফলাফল']);
    expect(home.profileLinkDisplay).toBe('none');
    expect(new Set(home.statBackgrounds)).toEqual(new Set(['rgba(0, 0, 0, 0)']));

    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    const darkHome = await page.evaluate(() => {
      const resolve = property => {
        const probe = document.createElement('i');
        probe.style.backgroundColor = `var(${property})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      };
      const summary = document.querySelector('#homeView .pay-hero.pay-hero-summary');
      const card = summary.querySelector('.study-progress-card');
      return {
        avatar: getComputedStyle(document.querySelector('#homeView .student-home-welcome .pay-avatar')).backgroundColor,
        primary: resolve('--color-primary'),
        summaryBackground: getComputedStyle(summary).backgroundColor,
        cardBackground: getComputedStyle(card).backgroundColor,
        surface: resolve('--color-surface'),
        visibleMetricCount: card.querySelectorAll('#homeRealStatsRow > div').length,
        statBackgrounds: [...card.querySelectorAll('.study-progress-stats > div')].map(el => getComputedStyle(el).backgroundColor),
        mutedSurface: resolve('--color-surface-muted')
      };
    });
    expect(darkHome.avatar).toBe(darkHome.surface);
    expect(darkHome.summaryBackground).toBe('rgba(0, 0, 0, 0)');
    expect(darkHome.cardBackground).toBe('rgb(92, 71, 41)');
    expect(darkHome.visibleMetricCount).toBe(2);
    expect(new Set(darkHome.statBackgrounds)).toEqual(new Set(['rgba(0, 0, 0, 0)']));

    await page.evaluate(async () => {
      const { setView } = await import('/js/shell.js');
      setView('student-id-card', { history: 'keep' });
    });
    const cardText = page.locator('#studentIdCardPreview svg text').first();
    await expect(cardText).toBeVisible();
    await expect.poll(() => cardText.evaluate(el => getComputedStyle(el).stroke)).toBe('none');
  });
}

for (const width of [320, 360, 390, 430, 448]) {
  test(`Student Home Hero carousel stays visible and unclipped at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 448 ? 438 : 844 });
    await enterStudentApp(page);
    const card = page.locator('#homeView .student-home-hero');
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeInViewport();
    await expect(page.locator('#dailyQuoteCard')).toBeHidden();
    await expect(card.locator('[data-hero-slide]')).toHaveCount(4);
    await expect(card.locator('[data-hero-slide].is-active')).toHaveCount(1);
    await expect(card.locator('.hero-slider__controls button')).toHaveCount(2);
    await expect(card.locator('.hero-slider__indicators [data-hero-dot]')).toHaveCount(4);

    const approved = await page.evaluate(async () => (await import('/js/student-home-hero-entry.js')).STUDENT_HOME_HERO_SLIDES);
    for (const { id, title, messages } of approved) {
      const slide = card.locator(`[data-hero-id="${id}"]`);
      await expect(slide.locator('[data-hero-title]')).toHaveText(title);
      const message = await slide.locator('[data-hero-description]').textContent();
      expect(messages).toContain(message.trim());
      await expect(slide.locator('img')).toHaveAttribute('alt', /বাংলাদেশি/u);
    }

    const layout = await card.evaluate(el => {
      const box = el.getBoundingClientRect();
      const controls = el.querySelector('.hero-slider__controls').getBoundingClientRect();
      const slides = [...el.querySelectorAll('[data-hero-slide]')];
      const slideHeights = slides.map(slide => slide.getBoundingClientRect().height);
      const copiesFit = slides.every(slide => {
        const copy = slide.querySelector('.hero-slide__copy').getBoundingClientRect();
        const title = slide.querySelector('.hero-slide__copy h2').getBoundingClientRect();
        const message = slide.querySelector('.hero-slide__description').getBoundingClientRect();
        return title.top >= copy.top - 1 && message.bottom <= copy.bottom + 1 && title.bottom <= message.top + 1;
      });
      return {
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height,
        scrollsHorizontally: el.scrollWidth > el.clientWidth + 1,
        imageFit: getComputedStyle(el.querySelector('img')).objectFit,
        images: [...el.querySelectorAll('img')].map(image => ({ width: image.naturalWidth, height: image.naturalHeight })),
        heightsMatch: slideHeights.every(height => Math.abs(height - slideHeights[0]) < 1),
        lastCopyBeforeControls: [...el.querySelectorAll('.hero-slide__description')].every(node => node.getBoundingClientRect().bottom <= controls.top + 2),
        copiesFit,
        metricCount: document.querySelectorAll('#homeRealStatsRow > div').length
      };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(width + 1);
    expect(layout.width).toBeGreaterThan(250);
    expect(layout.height).toBeGreaterThan(230);
    expect(layout.scrollsHorizontally).toBe(false);
    expect(layout.imageFit).toBe('contain');
    expect(layout.images).toEqual(Array(4).fill({ width: 1280, height: 720 }));
    expect(layout.heightsMatch).toBe(true);
    expect(layout.copiesFit).toBe(true);
    expect(layout.lastCopyBeforeControls).toBe(true);
    expect(layout.metricCount).toBe(2);
  });
}
