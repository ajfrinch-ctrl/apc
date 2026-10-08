/* Native visual/navigation acceptance. Synthetic sessions use the existing
   fixture helpers; report access, PDF rendering and stored drafts are real. */
const { test, expect } = require('./fixtures.cjs');
const { enterStudentApp, enterPortal } = require('./portal-session.cjs');
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

const SCENES = [
  { width: 320, height: 740, theme: 'dark' },
  { width: 390, height: 844, theme: 'light' },
  { width: 1280, height: 900, theme: 'light' }
];
async function prepare(page, role, scene = SCENES[1]) {
  await page.setViewportSize({ width: scene.width, height: scene.height });
  await page.addInitScript(theme => localStorage.setItem('active-plus-appearance-v2', theme), scene.theme);
  if (role === 'student') await enterStudentApp(page);
  else await enterPortal(page, role);
  const shell = { student: '#appShell', payment: '#payShell', admin: '#adminShell', manager: '#managerShell', teacher: '#teacherShell' }[role];
  // The shared fixture submits a real login; network-idle is not a guarantee
  // its asynchronous credential/session work has finished on a busy runner.
  // Wait for authenticated UI before an immediate offline reload, not a timer.
  await expect(page.locator(shell)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
async function fits(page, selector) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(selector).evaluate(el => {
    const box = el.getBoundingClientRect();
    // Header ::before intentionally paints a viewport-wide brand band across
    // the main's gutters. Check real controls/copy, not its decorative overflow.
    const content = [...el.querySelectorAll('button,input,select,textarea,h1,h2,p,strong,small,nav')]
      .map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
    return box.left >= -1 && box.right <= innerWidth + 1 &&
      content.every(rect => rect.left >= -1 && rect.right <= innerWidth + 1);
  })).toBe(true);
}

for (const scene of SCENES) {
  test(`student More is a compact menu and opens/back-closes its own report page (${scene.width}px ${scene.theme})`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await prepare(page, 'student', scene);
    await page.locator('.bottom-nav [data-view="profile"]').click();
    await expect(page.locator('#profileTitle')).toHaveText('আরও');
    await expect(page.locator('#profileView')).toBeVisible();
    await expect(page.locator('#studentReports')).toBeHidden();
    await expect(page.locator('#profileView .rc-form')).toHaveCount(0);
    await expect(page.locator('#profileView .pay-grid [data-view="reports"]')).toBeVisible();
    await fits(page, '#profileView');
    await page.locator('#profileView [data-view="reports"]').click();
    await expect(page).toHaveURL(/#reports$/);
    await expect(page.locator('#reportsView')).toBeVisible();
    await expect(page.locator('#profileView')).toBeHidden();
    await expect(page.locator('#studentReports select[name="report"]')).toBeVisible();
    await expect(page.locator('.bottom-nav [aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('.bottom-nav [data-view="profile"]')).toHaveAttribute('aria-current', 'page');
    await fits(page, '#reportsView');
    await page.locator('#reportsView .pay-back').click();
    await expect(page).toHaveURL(/#profile$/);
    await expect(page.locator('#profileView')).toBeVisible();
    await expect(page.locator('#studentReports')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test(`minimal counter omits More/report/directory screens (${scene.width}px ${scene.theme})`,async({page})=>{
    await prepare(page,'payment',scene);
    await expect(page.locator('#paymentMain')).toHaveAttribute('data-counter-ready','true');
    for(const selector of ['#payDeskTools','#payKeypad','#payStickyBar','[data-admin-view]','[data-teacher-view]','[data-manager-view]']) await expect(page.locator(selector)).toHaveCount(0);
    await expect(page.locator('nav.admin-bottom [data-pay-section]')).toHaveCount(5);
    await expect(page.locator('#payProfileCard')).toBeHidden();
    await expect(page.locator('#payReportsCard')).toBeHidden();
    await expect(page.locator('#paymentReports')).toHaveCount(1);
    await expect(page.locator('#payTodayList')).toBeVisible();
    await fits(page,'#paymentMain');
  });

}

for (const role of ['admin','manager','teacher']) for (const scene of SCENES.slice(0,2)) {
  test(`${role} keeps the authorised reports on their own screen (${scene.width}px ${scene.theme})`, async ({ page }) => {
    await prepare(page, role, scene);
    const attribute = `data-${role}-view`;
    const reports = `#${role}Reports`;
    await expect(page.locator(reports)).toBeHidden();
    if (role === 'teacher') {
      /* Teacher reaches the report center one level in: আরও → রিপোর্ট. */
      const root = '#teacherMore';
      await page.locator(`.admin-bottom [${attribute}="more"]`).click();
      await expect(page.locator(root)).toBeVisible();
      await fits(page, root);
      await page.locator(`${root} [${attribute}="reports"]`).click();
      await expect(page.locator(`${reports} select[name="report"]`)).toBeVisible();
      await expect(page.locator(root)).toBeHidden();
      await page.locator(`.admin-bottom [${attribute}="more"]`).click();
      await expect(page.locator(root)).toBeVisible();
      await expect(page.locator(reports)).toBeHidden();
      return;
    }
    /* Admin and Manager each own a reports seat (Phase 3/5): the report center
       is that screen, and it never becomes a second row inside More. */
    await page.locator(`.admin-bottom [${attribute}="reports"]`).click();
    await expect(page.locator(`${reports} select[name="report"]`)).toBeVisible();
    if (role === 'manager') {
      await page.locator(`.admin-bottom [${attribute}="more"]`).click();
      await expect(page.locator('[data-view-panel="more"]')).toBeVisible();
      await expect(page.locator(`${reports} select[name="report"]`)).toBeHidden();
    } else {
      await page.locator(`.admin-bottom [${attribute}="dashboard"]`).click();
      await expect(page.locator(`${reports} select[name="report"]`)).toBeHidden();
    }
  });
}

test('student report deep links survive reload and browser Back returns to the compact More menu', async ({ page }) => {
  await prepare(page, 'student');
  await page.locator('.bottom-nav [data-view="profile"]').click();
  await page.locator('#profileView [data-view="reports"]').click();
  await page.reload();
  await expect(page.locator('#reportsView')).toBeVisible();
  await expect(page.locator('#studentReports select[name="report"]')).toBeVisible();
  await expect(page.locator('.bottom-nav [data-view="profile"]')).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page.locator('#profileView')).toBeVisible();
  await expect(page.locator('#studentReports')).toBeHidden();
});

test('counter cancelling a simple draft removes its brief identity without writing a payment',async({page})=>{
  await prepare(page,'payment',SCENES[0]);
  await page.evaluate(async()=>{const {adminStudents}=await import('/js/admin-data.js');const {KEYS}=await import('/js/database.js');localStorage.setItem(KEYS.students,JSON.stringify(adminStudents));localStorage.setItem(KEYS.transactions,'[]');});
  await page.reload();await expect(page.locator('#paymentMain')).toHaveAttribute('data-counter-ready','true');
  await page.locator('.admin-bottom [data-pay-section="students"]').click();
  await page.locator('#payStudentSearch').fill('AP-1024');await page.locator('#paySearchResults .fee-search-result').click();await page.locator('#payProfileCollect').click();await page.locator('#payFeeAmount').fill('975');
  const before=await page.evaluate(()=>localStorage.getItem('activePlus.admin.transactions.v1'));
  await page.locator('#payCancelButton').click();await expect(page.locator('#payProfileCard')).toBeHidden();
  expect(await page.evaluate(()=>localStorage.getItem('activePlus.admin.transactions.v1'))).toBe(before);
});

for (const role of ['student']) test(`${role} still generates and downloads a real scoped report from the arranged menu`, async ({ page }) => {
  await prepare(page, role);
  let reports;
  if (role === 'student') {
    await page.locator('.bottom-nav [data-view="profile"]').click();
    await page.locator('#profileView [data-view="reports"]').click();
    reports = page.locator('#studentReports');
  }
  const select = reports.locator('select[name="report"]');
  await expect(select).toBeVisible();
  const id = role === 'student' ? 'mine.payment' : 'cash.own-history';
  expect(await select.locator('option').evaluateAll(options => options.map(option => option.value))).toContain(id);
  const before = await page.evaluate(() => localStorage.getItem('activePlus.admin.transactions.v1'));
  await select.selectOption(id);
  await reports.locator('.rc-generate').click();
  await expect(reports.locator('.rc-preview')).toBeVisible();
  const waiting = page.waitForEvent('download');
  await reports.locator('.rc-download').click();
  const download = await waiting;
  expect(download.suggestedFilename()).toMatch(/^ActivePlus_.*\.pdf$/);
  const bytes = require('fs').readFileSync(await download.path()).toString('latin1');
  expect(bytes.startsWith('%PDF-1.4')).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('activePlus.admin.transactions.v1'))).toBe(before);
  await reports.locator('.rc-back').click();
  await expect(reports.locator('select[name="report"]')).toHaveValue(id);
});

test.describe('arranged menus remain offline', () => {
  test.use({ serviceWorkers: 'allow' });
  for (const role of ['student','payment']) test(`${role} opens its scoped screen after a cold offline PWA reload`, async ({ page, context }) => {
    await prepare(page, role);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once:true }));
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    await cdp.detach();
    await context.setOffline(true);
    await page.reload();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    if (role === 'student') {
      await expect(page.locator('#appShell')).toBeVisible();
      await page.locator('.bottom-nav [data-view="profile"]').click();
      await expect(page.locator('#studentReports')).toBeHidden();
      await page.locator('#profileView [data-view="reports"]').click();
      await expect(page.locator('#studentReports select[name="report"]')).toBeVisible();
      await page.reload();
      await expect(page.locator('#reportsView')).toBeVisible();
      await expect(page.locator('.bottom-nav [data-view="profile"]')).toHaveAttribute('aria-current','page');
      await page.locator('#reportsView .pay-back').click();
      await expect(page.locator('#studentReports')).toBeHidden();
    } else {
      await expect(page.locator('#payShell')).toBeVisible();
      await expect(page.locator('#paymentMain')).toHaveAttribute('data-counter-ready','true');
      await expect(page.locator('#paymentReports')).toHaveCount(1);
      await expect(page.locator('#payReportsCard')).toBeHidden();
      await expect(page.locator('#payDeskTools, [data-admin-view], [data-teacher-view]')).toHaveCount(0);
      await expect(page.locator('#payProfileCard')).toBeHidden();
      await expect(page.locator('#payTodayList')).toBeVisible();
    }
  });
});
