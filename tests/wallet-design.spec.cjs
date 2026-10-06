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
    await expect(page.locator('.app-topbar-actions > button')).toHaveCount(2);
    const nav = page.locator(role === 'student' ? '.bottom-nav' : '.admin-bottom');
    if (role !== 'payment') {
    await expect(nav).toBeVisible();
    await expect(nav.locator(':scope > button')).toHaveCount(role === 'manager' ? 4 : 5);
    expect(await nav.evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    })).toBe(true);
    expect(await nav.locator('.nav-label').evaluateAll(labels => labels.every(label => label.scrollWidth <= label.clientWidth + 1))).toBe(true);
    } else { await expect(nav).toHaveCount(0); }
    if (role !== 'payment') {
      const grid = page.locator(role === 'admin' ? '.admin-feature-grid' : '.pay-grid');
      await expect(grid).toBeVisible();
      const columns = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(columns).toBe(role === 'admin' ? (width >= 1000 ? 5 : 3) : (width >= 1000 ? 8 : 4));
      const icons = grid.locator(role === 'admin' ? '.admin-feature-icon' : '.pay-tile-icon');
      expect(await icons.evaluateAll(elements => elements.every(el => {
        const r = el.getBoundingClientRect();
        return Math.abs(r.width - r.height) < 1 && r.width >= 48 && getComputedStyle(el).borderRadius === '50%';
      }))).toBe(true);
    }
    if (role !== 'payment') {
    const serviceIcons = page.locator(role === 'admin' ? '.admin-feature-icon svg' : '.pay-tile-icon svg');
    expect(await serviceIcons.count()).toBeGreaterThan(0);
    expect(await serviceIcons.evaluateAll(icons => icons.every(svg => {
      const paints = new Set([...svg.querySelectorAll('[fill]')].map(el => getComputedStyle(el).fill).filter(fill => fill !== 'none'));
      return svg.dataset.iconSet === 'active-plus-color' && svg.dataset.iconStyle === 'color' && paints.size >= 2;
    }))).toBe(true);
    expect(await nav.locator('svg').evaluateAll(icons => icons.every(svg => svg.dataset.iconSet === 'active-plus-color' && svg.dataset.iconStyle === 'glyph'))).toBe(true);
    }
    if (theme === 'dark') {
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
      await expect(page.locator('.app-topbar')).toHaveCSS('box-shadow', 'none');
    }
    expect(errors).toEqual([]);
  });
}

for (const role of ['manager', 'teacher']) test(`${role} service shortcuts and back controls use the original router`, async ({ page }) => {
  await prepare(page, { role, width: 320 });
  const attribute = `data-${role}-view`;
  const targetHome = role === 'manager' ? 'dashboard' : 'home';
  const routes = await page.locator('.pay-grid > button').evaluateAll((buttons, attribute) => buttons.map(button => button.getAttribute(attribute)), attribute);
  expect(routes).toHaveLength(8);
  for (const route of routes) {
    await page.locator(`.pay-grid > [${attribute}="${route}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${route}$`));
    const panel = role === 'manager' ? page.locator(`.manager-view[data-view-panel="${route}"]`) : page.locator('.teacher-view:visible');
    await expect(panel).toBeVisible();
    await panel.locator(`.pay-back[${attribute}="${targetHome}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${targetHome}$`));
    await expect(page.locator('.pay-grid')).toBeVisible();
  }
});

test('student home tiles open homework, notices and a truthful fee state', async ({ page }) => {
  await prepare(page, { role: 'student', width: 320 });
  for (const route of ['routine', 'courses', 'exams', 'results', 'profile']) {
    await page.locator(`#studentServices [data-view="${route}"]`).click();
    await expect(page.locator(`[data-view-panel="${route}"]`)).toBeVisible();
    await page.locator('.bottom-nav [data-view="home"]').click();
  }
  await page.locator('#studentServices [data-action="homework"]').click();
  await expect(page.locator('#coursesView')).toBeVisible();
  await expect(page.locator('#learningFilters [data-learning-filter="homework"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#coursesView .pay-back').click();
  await page.locator('#studentServices [data-view="notice-board"]').click();
  await expect(page.locator('#notice-boardView')).toBeVisible();
  await expect(page.locator('#noticeBoardCategories [data-notice-board-category="urgent"]')).toContainText('জরুরি');
  await page.locator('#notice-boardView .pay-back').click();
  await page.locator('#studentServices [data-action="fees"]').click();
  await expect(page.locator('.feedback-toast')).toContainText('তথ্য এখনও যোগ হয়নি');
  expect(await page.locator('.feedback-toast').evaluate(el => { const r=el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; })).toBe(true);
});

for (const scene of [{ width:320, theme:'dark' },{ width:390, theme:'light' }]) {
  test(`minimal payment counter completes pending/save/receipt/PDF (${scene.width}px ${scene.theme})`,async({page})=>{
    await page.setViewportSize({width:scene.width,height:740});
    await page.addInitScript(theme=>localStorage.setItem('active-plus-appearance-v2',theme),scene.theme);
    await page.goto('/offline-roles.html');await seed(page,'payment');
    await page.evaluate(async()=>{const {adminStudents}=await import('/js/admin-data.js');const {KEYS}=await import('/js/database.js');localStorage.setItem(KEYS.students,JSON.stringify(adminStudents));localStorage.setItem(KEYS.transactions,'[]');});
    await page.goto('/payment.html');await expect(page.locator('#paymentMain')).toHaveAttribute('data-counter-ready','true');
    await expect(page.locator('#payProfileCard')).toBeHidden();await expect(page.locator('.admin-bottom [data-pay-section]')).toHaveCount(5);
    await page.locator('#payStudentSearch').fill('AP-1024');await page.locator('#paySearchResults .fee-search-result').click();
    await expect(page.locator('#payProfileCollect')).toBeEnabled();await page.locator('#payProfileCollect').click();
    await expect(page.locator('#payFeeAmount')).toHaveValue('');await page.locator('#payFeeAmount').fill('800');await page.locator('#paySaveButton').click();
    await expect(page.locator('#payReceiptBackdrop')).toBeVisible();await expect(page.locator('#payReceiptBody')).toContainText('৳৮০০');
    await expect(page.locator('#payReceiptBody')).not.toContainText('অভিভাবক');
    const tx=await page.evaluate(()=>JSON.parse(localStorage.getItem('activePlus.admin.transactions.v1')));
    expect(tx).toHaveLength(1);expect(tx[0]).toMatchObject({amount:800,status:'pending'});expect(tx[0].receiptNo).toMatch(/^R\d{9}$/);
    expect(await page.locator('#payReceiptBackdrop .admin-modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    const waiting=page.waitForEvent('download');await page.locator('#payReceiptDownload').click();expect((await waiting).suggestedFilename()).toBe(tx[0].receiptNo+'.pdf');
    await page.keyboard.press('Escape');await expect(page.locator('#payReceiptBackdrop')).toBeHidden();
    await expect(page.locator('#payTodayList .pay-activity-row')).toHaveCount(1);
  });
}

test('horizontal filter strips stay contained and scroll to their last real control', async ({ page }) => {
  await prepare(page, { role: 'admin', width: 320 });
  await page.locator('.admin-bottom [data-admin-view="staff"]').click();
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
  await page.locator('.admin-bottom [data-admin-view="staff"]').click();
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
  await page.locator('#studentServices [data-view="profile"]').click();
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
  if (role === 'student') await expect(nav).toBeVisible(); else await expect(nav).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (role === 'student') expect(await nav.evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1)).toBe(true);
  if (role === 'student') {
    await page.locator('.bottom-nav [data-view="profile"]').click();
    await expect(page.locator('#profileView')).toBeVisible();
    await page.locator('#profileView .pay-back').click();
    await expect(page.locator('#studentServices')).toBeVisible();
  } else {
    await expect(page.locator('#payTodayList')).toBeVisible();
    await expect(page.locator('#payProfileCard')).toBeHidden();
    await expect(page.locator('#payStudentSearch')).toBeVisible();
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
      const cache = await caches.open('active-plus-student-v150-minimal-education');
      return Boolean(await cache.match('./css/ui-wallet.css')) && Boolean(await cache.match('./js/icon-set.js'));
    });
    expect(cached).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#loginForm')).toHaveAttribute('data-login-ready', 'true');
    await expect(page.locator('#authScreen')).toBeVisible();
    await expect(page.locator('.auth-brand h1')).toHaveCSS('color', 'rgb(255, 255, 255)');
    expect(await page.locator('.auth-panel.active').evaluate(el => getComputedStyle(el).borderRadius)).toBe('24px');
    await page.locator('[data-auth-tab="register"]').click();
    await expect(page.locator('#registrationForm')).toBeVisible();
  });
});
