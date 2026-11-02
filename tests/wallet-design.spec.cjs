/* Browser acceptance for the actual five-portal reskin. All data/session
   provisioning is confined to test browser contexts; production auth is intact. */
const { test, expect } = require('./fixtures.cjs');
const { enterPortal, enterStudentApp, seed } = require('./portal-session.cjs');

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

async function prepare(page, { role, theme = 'light', width = 390, height = 844 }) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(theme => localStorage.setItem('active-plus-appearance-v2', theme), theme);
  if (role === 'student') await enterStudentApp(page);
  else await enterPortal(page, role);
  await page.evaluate(() => document.fonts.ready);
  const alert = page.locator('[data-apc-alert-ok]:visible').first();
  if (await alert.count()) await alert.click();
}
const home = { student: '#homeView', admin: '[data-view-panel="dashboard"]', manager: '[data-view-panel="dashboard"]', teacher: '#teacherHome', payment: '#paymentMain' };
const homeGrid = {
  student: '#homeView #studentServices',
  admin: '#adminFeatureGrid',
  manager: '.manager-view[data-view-panel="dashboard"] nav[aria-label="দ্রুত অ্যাক্সেস"]',
  teacher: '#teacherHome .teacher-home-actions'
};
/* ২০২৬-১০-২১: teacher Home is create-first — heroes open forms/MCQ/modals, not
   round-trip screens. Only the pure screen doors (read-only routine, materials)
   keep a pay-back-to-home round trip, so the router shortcut test scopes to them. */
const homeShortcuts = {
  manager: '.manager-view[data-view-panel="dashboard"] nav[aria-label="দ্রুত অ্যাক্সেস"] > button[data-panel-view]',
  teacher: '#teacherHome [data-panel-view="routine-view"], #teacherHome [data-panel-view="homework"]'
};
const navCount = { student: 5, admin: 6, manager: 6, teacher: 4, payment: 5 };
const shell = { student: '#appShell', admin: '#adminShell', manager: '#managerShell', teacher: '#teacherShell', payment: '#payShell' };

for (const width of [320, 390, 1280]) for (const theme of ['light', 'dark']) for (const role of ['student', 'admin', 'manager', 'teacher', 'payment']) {
  test(`${role} wallet layout fits ${width}px in ${theme}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await prepare(page, { role, width, theme });
    await expect(page.locator(shell[role])).toBeVisible();
    await expect(page.locator(home[role])).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.locator(shell[role]).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(page.locator('.app-topbar-actions > button')).toHaveCount(role === 'payment' ? 2 : 3);
    const nav = page.locator(role === 'student' ? '.bottom-nav' : '.admin-bottom');
    await expect(nav).toBeVisible();
    await expect(nav.locator(':scope > button')).toHaveCount(navCount[role]);
    expect(await nav.evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    })).toBe(true);
    const overflowingNavLabels = await nav.locator(':scope > button > span:not(.nav-chip)').evaluateAll(labels => labels
      .filter(label => label.scrollWidth > label.clientWidth + 1)
      .map(label => label.textContent.trim()));
    expect(overflowingNavLabels).toEqual([]);
    if (role !== 'payment') {
      const grid = page.locator(homeGrid[role]);
      await expect(grid).toBeVisible();
      if (role === 'teacher') {
        // ২০২৬-১০-২১: one column of four full-width hero action cards, no grid.
        expect(await grid.evaluate(el => getComputedStyle(el).flexDirection)).toBe('column');
        await expect(grid.locator('.teacher-action-card')).toHaveCount(4);
        const art = grid.locator('.teacher-action-art svg');
        expect(await art.count()).toBe(4);
        expect(await art.evaluateAll(svgs => svgs.every(svg => {
          const r = svg.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }))).toBe(true);
        expect(await art.evaluateAll(svgs => svgs.every(svg =>
          svg.dataset.iconSet === 'active-plus-soft3d' && svg.dataset.iconStyle === 'color'
          && [...svg.querySelectorAll('image')].some(image => image.getAttribute('href')?.startsWith('assets/icons/ai-3d/'))
        ))).toBe(true);
      } else {
        const columns = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
        expect(columns).toBe(role === 'admin' ? 2 : 3);
        const icons = grid.locator(role === 'admin' ? '.admin-feature-icon' : '.pay-tile-icon');
        expect(await icons.evaluateAll(elements => elements.every(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && Math.abs(r.width - r.height) < 1;
        }))).toBe(true);
        const serviceIcons = grid.locator(role === 'admin' ? '.admin-feature-icon svg' : '.pay-tile-icon svg');
        expect(await serviceIcons.count()).toBeGreaterThan(0);
        expect(await serviceIcons.evaluateAll(icons => icons.every(svg =>
          svg.dataset.iconSet === 'active-plus-soft3d' && svg.dataset.iconStyle === 'color'
          && [...svg.querySelectorAll('image')].some(image => image.getAttribute('href')?.startsWith('assets/icons/ai-3d/'))
        ))).toBe(true);
      }
    }
    expect(await nav.locator('svg').evaluateAll(icons => icons.every(svg =>
      svg.dataset.iconSet === 'active-plus-soft3d' && svg.dataset.iconStyle === 'glyph'
      && [...svg.querySelectorAll('image')].some(image => image.getAttribute('href')?.startsWith('assets/icons/ai-3d/'))
    ))).toBe(true);
    if (theme === 'dark') {
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('.app-topbar')).toHaveCSS('box-shadow', 'none');
    }
    expect(errors).toEqual([]);
  });
}

for (const role of ['manager', 'teacher']) test(`${role} service shortcuts and back controls use the original router`, async ({ page }) => {
  await prepare(page, { role, width: 320 });
  const attribute = 'data-panel-view';
  const targetHome = role === 'manager' ? 'dashboard' : 'home';
  const shortcuts = page.locator(homeShortcuts[role]);
  const routes = await shortcuts.evaluateAll((buttons, attribute) => buttons.map(button => button.getAttribute(attribute)), attribute);
  // 2026-10-21: the teacher Home is create-first (heroes open forms/MCQ/modals),
  // so only its two pure screen doors — read-only routine and materials — take
  // the pay-back round trip; the other portals keep their previous counts.
  const expectedShortcuts = role === 'manager' ? 9 : role === 'teacher' ? 2 : 7;
  expect(routes).toHaveLength(expectedShortcuts);
  for (let index = 0; index < routes.length; index++) {
    const route = routes[index];
    const backTarget = (role === 'manager' && route === 'exams') || (role === 'teacher' && route === 'online-exams') ? 'academic' : targetHome;
    await shortcuts.nth(index).click();
    await expect(page).toHaveURL(new RegExp(`#${route}$`));
    const panel = role === 'manager' ? page.locator(`.manager-view[data-view-panel="${route}"]`) : page.locator('.teacher-view:visible');
    await expect(panel).toBeVisible();
    await panel.locator(`.pay-back[${attribute}="${backTarget}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${backTarget}$`));
    if (backTarget !== targetHome) {
      const parentPanel = role === 'manager' ? `.manager-view[data-view-panel="${backTarget}"]` : '#teacherAcademic';
      await page.locator(`${parentPanel} .pay-back[${attribute}="${targetHome}"]`).click();
      await expect(page).toHaveURL(new RegExp(`#${targetHome}$`));
    }
    await expect(page.locator(homeGrid[role])).toBeVisible();
  }
});

test('student home tiles open their own study sections, notices, and a read-only fee state', async ({ page }) => {
  await prepare(page, { role: 'student', width: 320 });
  const studyRoutes = [
    ['homework', 'homework', '#homeworkView', 'homework'],
    ['suggestion', 'suggestion', '#suggestionView', 'suggestion'],
    ['question-bank', 'bank', '#questionBankView', 'question-bank']
  ];
  for (const [action, section, view, route] of studyRoutes) {
    await page.locator(`#studentServices [data-action="${action}"]`).click();
    await expect(page.locator(view)).toBeVisible();
    await expect(page.locator(`#studySections [data-study-section="${section}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`[data-study-panel="${section}"]`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#${route}$`));
    await page.locator('.bottom-nav [data-view="home"]').click();
    await expect(page.locator('#homeView')).toBeVisible();
  }
  await page.locator('#studentServices [data-view="exams"]:not([data-exam-tab])').click();
  await expect(page.locator('#examsView')).toBeVisible();
  await page.locator('.bottom-nav [data-view="home"]').click();
  await page.locator('#studentServices [data-view="exam-results"][data-exam-tab="results"]').click();
  await expect(page.locator('#examResultsView')).toBeVisible();
  await expect(page.locator('#examTabs [data-exam-tab="results"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.bottom-nav [data-view="home"]').click();
  await page.locator('#studentServices [data-view="notice-board"]').click();
  await expect(page.locator('#notice-boardView')).toBeVisible();
  await expect(page.locator('#noticeBoardCategories [data-notice-board-category="urgent"]')).toContainText('জরুরি');
  await page.locator('#notice-boardView .pay-back').click();
  await page.locator('.bottom-nav [data-view="profile"]').click();
  await page.locator('#profileView [data-view="student-fee"]').click();
  await expect(page.locator('#studentFeeView')).toBeVisible();
  await expect(page.locator('#studentFeeView input, #studentFeeView select, #studentFeeView textarea')).toHaveCount(0);
});

for (const scene of [{ width:320, theme:'dark' },{ width:390, theme:'light' }]) {
  test(`minimal payment counter completes pending/save/receipt/PDF (${scene.width}px ${scene.theme})`,async({page})=>{
    await page.setViewportSize({width:scene.width,height:740});
    await page.addInitScript(theme=>localStorage.setItem('active-plus-appearance-v2',theme),scene.theme);
    await page.goto('/demo/offline-roles.html');await seed(page,'payment');
    await page.evaluate(async()=>{const {adminStudents}=await import('/js/admin-data.js');const {KEYS}=await import('/js/database.js');localStorage.setItem(KEYS.students,JSON.stringify(adminStudents));localStorage.setItem(KEYS.transactions,'[]');});
    await page.goto('/payment.html');await expect(page.locator('#paymentMain')).toHaveAttribute('data-counter-ready','true');
    await expect(page.locator('#payProfileCard')).toBeHidden();await expect(page.locator('.admin-bottom [data-panel-view]')).toHaveCount(5);
    await page.locator('.admin-bottom [data-panel-view="students"]').click();await expect(page.locator('#payStudentsPanel')).toBeVisible();
    await page.locator('#payStudentSearch').fill('AP-1024');await page.locator('#paySearchResults .fee-search-result').click();
    await expect(page.locator('#payProfileCollect')).toBeEnabled();await page.locator('#payProfileCollect').click();
    await expect(page.locator('#payCollectionForm')).toBeVisible();await expect(page.locator('#payFeeAmount')).toHaveValue('');await page.locator('#payFeeAmount').fill('800');await page.locator('#paySaveButton').click();
    await expect(page.locator('#payReceiptBackdrop')).toBeVisible();await expect(page.locator('#payReceiptBody')).toContainText('৳৮০০');
    await expect(page.locator('#payReceiptBody')).not.toContainText('অভিভাবক');
    const tx=await page.evaluate(()=>JSON.parse(localStorage.getItem('activePlus.admin.transactions.v1')));
    expect(tx).toHaveLength(1);expect(tx[0]).toMatchObject({amount:800,status:'pending'});expect(tx[0].receiptNo).toMatch(/^C[0-9A-F]{8}-\d{6,}$/);
    expect(await page.locator('#payReceiptBackdrop .admin-modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    const waiting=page.waitForEvent('download');await page.locator('#payReceiptDownload').click();expect((await waiting).suggestedFilename()).toBe(tx[0].receiptNo+'.pdf');
    await page.keyboard.press('Escape');await expect(page.locator('#payReceiptBackdrop')).toBeHidden();
    await expect(page.locator('#payTodayList .pay-activity-row')).toHaveCount(1);
  });
}

test('horizontal filter strips stay contained and scroll to their last real control', async ({ page }) => {
  await prepare(page, { role: 'admin', width: 320 });
  await page.locator('.admin-bottom [data-panel-view="staff"]').click();
  const strips = page.locator('.admin-view.active .chip-row');
  expect(await strips.count()).toBeGreaterThan(0);
  for (let index = 0; index < await strips.count(); index++) {
    const strip = strips.nth(index);
    expect(await strip.evaluate(el => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await strip.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    const last = strip.locator('button').last();
    expect(await last.evaluate(el => el.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
    await last.click();
    await expect(last).toHaveClass(/active/);
  }
});

for (const theme of ['light', 'dark']) test(`login, recovery and registration use consistent readable forms (${theme})`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(theme => localStorage.setItem('active-plus-appearance-v2', theme), theme);
  await page.goto('/index.html');
  await expect(page.locator('#loginForm')).toHaveAttribute('data-login-ready', 'true');
  await page.locator('[data-auth-tab="register"]').click();
  await expect(page.locator('#registrationForm')).toBeVisible();
  expect(await page.locator('#registrationForm input:visible').evaluateAll(inputs => inputs.every(input => parseFloat(getComputedStyle(input).fontSize) >= 16))).toBe(true);
  await page.locator('[data-auth-tab="login"]').first().click();
  await page.locator('#forgotPinButton').click();
  await expect(page.locator('#recoveryModal')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('admin create-staff sheet fits 320px and returns focus on Escape', async ({ page }) => {
  await prepare(page, { role: 'admin', width: 320 });
  await page.locator('.admin-bottom [data-panel-view="staff"]').click();
  await page.locator('#staffCreateButton').click();
  const dialog = page.locator('#staffModalBody');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await dialog.locator('input:visible,select:visible,textarea:visible').evaluateAll(elements => elements.every(el => parseFloat(getComputedStyle(el).fontSize) >= 16))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#staffCreateButton')).toBeFocused();
});

test('student profile-edit sheet retains readable fields and keyboard close', async ({ page }) => {
  await prepare(page, { role: 'student', width: 320, theme: 'dark' });
  await page.locator('.bottom-nav [data-view="profile"]').click();
  const trigger = page.locator('#profileView [data-action="edit-profile"]').first();
  await trigger.click();
  await expect(page.locator('#editModal')).toBeVisible();
  expect(await page.locator('#editModal .modal').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.locator('#profileForm input:visible,#profileForm select:visible,#profileForm textarea:visible').evaluateAll(elements => elements.every(el => parseFloat(getComputedStyle(el).fontSize) >= 16))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#editModal')).toBeHidden();
  await expect(trigger).toBeFocused();
});

for (const role of ['student', 'payment']) test(`${role} remains usable in a short landscape viewport`, async ({ page }) => {
  await prepare(page, { role, width: 844, height: 390, theme: 'dark' });
  const nav = page.locator(role === 'student' ? '.bottom-nav' : '.admin-bottom');
  await expect(nav).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await nav.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
  })).toBe(true);
  if (role === 'student') {
    await page.locator('.bottom-nav [data-view="profile"]').click();
    await expect(page.locator('#profileView')).toBeVisible();
    await page.locator('#profileView [data-view="my-profile"]').click();
    await expect(page.locator('#myProfileView')).toBeVisible();
    await page.locator('#myProfileView .pay-back').click();
    await expect(page.locator('#profileView')).toBeVisible();
    await page.locator('.bottom-nav [data-view="home"]').click();
    await expect(page.locator('#homeView')).toBeVisible();
  } else {
    await expect(page.locator('#payTodayList')).toBeVisible();
    await expect(page.locator('#payProfileCard')).toBeHidden();
    await expect(page.locator('#payStudentSearch')).toBeHidden();
  }
});

test.describe('wallet offline shell', () => {
  test.use({ serviceWorkers: 'allow' });
  test('the new skin is precached and the login page reloads genuinely offline', async ({ page, context }) => {
    await page.goto('/index.html');
    await expect(page.locator('#loginForm')).toHaveAttribute('data-login-ready', 'true');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    const cached = await page.evaluate(async () => {
      const name = (await caches.keys()).find(key => /^active-plus-student-v\d+-minimal-education$/.test(key));
      if (!name) return false;
      const cache = await caches.open(name);
      return Boolean(await cache.match('./css/ui-wallet.css')) && Boolean(await cache.match('./js/icon-set.js'));
    });
    expect(cached).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#loginForm')).toHaveAttribute('data-login-ready', 'true');
    await expect(page.locator('#authScreen')).toBeVisible();
    await expect(page.locator('.auth-brand h1')).toHaveCSS('color', 'rgb(23, 26, 24)');
    expect(await page.locator('.auth-card').evaluate(el => getComputedStyle(el).borderRadius)).toBe('20px');
    expect(await page.locator('.auth-panel.active').evaluate(el => getComputedStyle(el).borderRadius)).toBe('0px');
    await page.locator('[data-auth-tab="register"]').click();
    await expect(page.locator('#registrationForm')).toBeVisible();
  });
});
