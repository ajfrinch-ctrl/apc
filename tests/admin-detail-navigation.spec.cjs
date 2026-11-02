const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');
const { readFile } = require('node:fs/promises');

const groups = [
  ['data', 'more', ['data-stats', 'data-danger']],
  ['backup', 'more', ['backup-export', 'backup-restore']],
  ['audit', 'more', ['audit-log', 'audit-exam']],
  ['content', 'more', ['content-lecture-sheets', 'content-notices', 'content-records']],
  ['advice', 'more', ['advice-editor']],
  ['roles', 'system', ['roles-admin', 'roles-manager', 'roles-teacher', 'roles-payment', 'roles-student']],
  ['security', 'system', ['security-owner', 'security-password', 'security-protected', 'security-boundaries']],
  ['settings', 'system', ['settings-branding', 'settings-classes', 'settings-broadcast', 'settings-maintenance']],
  ['academics', 'system', ['academics-add', 'academics-subjects', 'academics-mapping']],
  ['migration', 'system', ['migration-teacher', 'migration-student']],
  ['profile', 'more', ['profile-account', 'profile-notification', 'profile-app', 'profile-security', 'profile-data']]
];

const feature = {
  'data-stats': '#dataCollectionList', 'data-danger': '#factoryResetButton',
  'backup-export': '#backupExportButton', 'backup-restore': '#backupRestoreButton',
  'audit-log': '#gradeAuditList', 'audit-exam': '#adminExamWorkspace',
  'content-lecture-sheets': '[data-ls-manager="admin"]',
  'content-notices': '#adminNoticeReviewList', 'content-records': '#adminContentReviewList',
  'advice-editor': '#adminDailyAdvice [data-advice-list]',
  'settings-branding': '#cfgTagline', 'settings-classes': '#classList',
  'settings-broadcast': '#cfgBroadcastMessage', 'settings-maintenance': '#cfgMaintenanceMessage',
  'academics-add': '[data-academic-class-form]', 'academics-subjects': '#adminAcademics > .admin-card',
  'academics-mapping': '#adminAcademics .exam-section-title',
  'migration-teacher': '#adminV2Migration .v2-migration-card.is-open',
  'migration-student': '#adminV2Migration .v2-migration-card.is-open'
};
for (const role of ['admin', 'manager', 'teacher', 'payment', 'student']) feature[`roles-${role}`] = `[data-role-panel="${role}"]`;
for (const key of ['owner', 'password', 'protected', 'boundaries']) feature[`security-${key}`] = `[data-security-panel="${key}"]`;
for (const key of ['account', 'notification', 'app', 'security', 'data']) feature[`profile-${key}`] = `[data-settings-group="${key}"]`;

const panel = (page, view) => page.locator(`.admin-view[data-view-panel="${view}"]`);

async function start(page) {
  // These UI checks must never create an account or synchronize test records
  // into either production cloud, even on a machine with internet access.
  await page.route(/https:\/\/[^/]*(?:supabase\.co|firebasedatabase\.app|firebaseio\.com|googleapis\.com)\//, route => route.abort());
  await page.routeWebSocket(/wss:\/\/[^/]*(?:supabase\.co|firebasedatabase\.app|firebaseio\.com)\//, socket => socket.close());
  await enterPortal(page, 'admin');
  await expect(page.locator('#adminMoreMenu [data-panel-view="data"]')).toHaveAttribute('data-nav-wired', '1');
  await expect(panel(page, 'dashboard')).toBeVisible();
}

async function openHub(page, parent, seat) {
  await page.locator(`.admin-bottom [data-panel-view="${seat}"]`).click();
  if (seat === 'system') {
    await page.locator(`#adminSystemMenu [data-panel-view="${parent}"]`).click();
  } else {
    const moreTarget = parent === 'backup' || parent === 'audit' ? 'data' : parent;
    await page.locator(`#adminMoreMenu [data-panel-view="${moreTarget}"]`).click();
    if (parent === 'backup' || parent === 'audit') await panel(page, 'data').locator(`[data-panel-view="${parent}"]`).click();
  }
  await expect(panel(page, parent)).toBeVisible();
}

async function openChild(page, parent, view) {
  const launcher = parent === 'profile'
    ? panel(page, parent).locator(`[data-settings-open="${view.slice('profile-'.length)}"]`)
    : panel(page, parent).locator(`[data-panel-view="${view}"]`);
  await expect(launcher).toBeVisible();
  const box = await launcher.boundingBox();
  expect(box.width, `${view} launcher width`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${view} launcher height`).toBeGreaterThanOrEqual(44);
  await launcher.click();
  await expect(panel(page, view)).toBeVisible();
  await expect(panel(page, parent)).toBeHidden();
}

async function expectProfileIdContrast(page) {
  const badge = panel(page, 'profile-account').locator('.staff-id-badge');
  await expect(badge).toBeVisible();
  const ratio = await badge.evaluate(element => {
    const style = getComputedStyle(element);
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const [light, dark] = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

async function checkDetailLayout(page, view, width) {
  const layout = await page.evaluate(view => {
    const root = document.querySelector(`.admin-view[data-view-panel="${view}"]`);
    const rect = node => {
      const b = node.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
    };
    const overflow = [...root.querySelectorAll('*')].filter(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || (r.left >= -1 && r.right <= innerWidth + 1)) return false;
      // A deliberate nested horizontal scroller clips its own content.
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
        if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth + 1) return false;
      }
      return true;
    }).slice(0, 12).map(el => `${el.tagName.toLowerCase()}#${el.id}.${String(el.className?.baseVal ?? el.className).replace(/\s+/g, '.')}`);
    const visible = [...document.querySelectorAll('.admin-view')].filter(el => el.getClientRects().length && getComputedStyle(el).display !== 'none').map(el => el.dataset.viewPanel);
    const back = root.querySelector('[data-admin-back]');
    const chat = document.querySelector('#apcClassChatHead:not([hidden]) .class-chat-head-bubble');
    return {
      visible, overflow, docWidth: document.documentElement.scrollWidth,
      root: rect(root), back: rect(back), title: rect(root.querySelector('h1')),
      mainBottom: rect(document.querySelector('#adminMain')).bottom,
      chatTop: chat ? rect(chat).top : null
    };
  }, view);
  expect(layout.visible, `${view} only visible view`).toEqual([view]);
  expect(layout.docWidth, `${view} document width`).toBeLessThanOrEqual(width);
  expect(layout.overflow, `${view} overflowing elements`).toEqual([]);
  expect(layout.root.left, `${view} left edge`).toBeGreaterThanOrEqual(-1);
  expect(layout.root.right, `${view} right edge`).toBeLessThanOrEqual(width + 1);
  expect(layout.back.width, `${view} Back width`).toBeGreaterThanOrEqual(44);
  expect(layout.back.height, `${view} Back height`).toBeGreaterThanOrEqual(44);
  expect(layout.back.right, `${view} heading does not overlap Back`).toBeLessThanOrEqual(layout.title.left + 1);
  if (layout.chatTop !== null) {
    expect(layout.mainBottom, `${view} chat shortcut does not cover detail controls`).toBeLessThanOrEqual(layout.chatTop + 1);
  }
  const inputs = view === 'backup-export'
    ? ['#backupExportPassphrase', '#backupExportPassphraseConfirm']
    : view === 'backup-restore' ? ['#backupRestorePassphrase', '#backupFileInput'] : [];
  for (const selector of inputs) {
    const box = await panel(page, view).locator(selector).boundingBox();
    expect(box.height, `${selector} touch target`).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  }
}

for (const width of [360, 390, 1280]) {
  test(`all More/System detail doors are isolated and fit at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
    const errors = [];
    page.on('pageerror', error => {
      if (!/auth\/network-request-failed/.test(error.message)) errors.push(error.message);
    });
    await start(page);
    for (const [parent, seat, children] of groups) {
      await openHub(page, parent, seat);
      for (const view of children) {
        await openChild(page, parent, view);
        await expect(page).toHaveURL(new RegExp(`#${view}$`));
        await expect(page.locator('.admin-bottom [aria-current="page"]')).toHaveAttribute('data-panel-view', seat);
        await expect(panel(page, view).locator(feature[view])).toBeVisible();
        await checkDetailLayout(page, view, width);
        if (['data-danger', 'profile-account', 'migration-teacher'].includes(view)) {
          await page.screenshot({ path: testInfo.outputPath(`${view}-${width}.png`) });
        }
        await panel(page, view).locator('[data-admin-back]').click();
        await expect(panel(page, parent)).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`#${parent}$`));
      }
    }
    expect(errors).toEqual([]);
  });
}

test('browser history, direct links, reload, invalid and empty hashes stay in a safe view', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await openHub(page, 'backup', 'more');
  await openChild(page, 'backup', 'backup-export');
  await page.goBack();
  await expect(page).toHaveURL(/#backup$/);
  await expect(panel(page, 'backup')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#data$/);
  await page.goForward();
  await expect(panel(page, 'backup')).toBeVisible();
  await page.goForward();
  await expect(panel(page, 'backup-export')).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/#backup-export$/);
  await expect(panel(page, 'backup-export').locator('#backupExportButton')).toBeVisible();
  await panel(page, 'backup-export').locator('[data-admin-back]').click();
  await expect(panel(page, 'backup')).toBeVisible();

  // A newly opened bookmarked route has no internal predecessor: the header
  // Back must use the declared parent instead of leaving the app.
  await page.goto('/admin.html#profile-security');
  await expect(panel(page, 'profile-security').locator('[data-settings-group="security"]')).toBeVisible();
  await panel(page, 'profile-security').locator('[data-admin-back]').click();
  await expect(page).toHaveURL(/#profile$/);
  await expect(panel(page, 'profile')).toBeVisible();
  for (const view of ['roles-teacher', 'security-owner', 'academics-add', 'migration-student', 'settings-branding', 'content-notices']) {
    await page.goto(`/admin.html#${view}`);
    await expect(panel(page, view)).toBeVisible();
    await expect(panel(page, view).locator(feature[view])).toBeVisible();
    await page.reload();
    await expect(panel(page, view).locator(feature[view])).toBeVisible();
  }
  await page.evaluate(() => { location.hash = '#finance'; });
  await expect(page).toHaveURL(/#content-notices$/);
  await expect(panel(page, 'content-notices')).toBeVisible();
  await page.evaluate(() => { location.hash = ''; });
  await expect(page).toHaveURL(/#dashboard$/);
  await expect(panel(page, 'dashboard')).toBeVisible();
});

test('moved settings, academic, migration, profile and encrypted backup controls still work', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);

  await openHub(page, 'settings', 'system');
  await openChild(page, 'settings', 'settings-branding');
  await page.locator('#cfgTagline').fill('নেভিগেশন পরীক্ষার স্লোগান');
  await page.locator('#btnSaveAppSettings').click();
  await expect(page.locator('.admin-toast')).toContainText('সংরক্ষিত');
  await panel(page, 'settings-branding').locator('[data-admin-back]').click();
  await expect(panel(page, 'settings')).toBeVisible();
  await openChild(page, 'settings', 'settings-branding');
  await expect(page.locator('#cfgTagline')).toHaveValue('নেভিগেশন পরীক্ষার স্লোগান');

  await openHub(page, 'academics', 'system');
  await openChild(page, 'academics', 'academics-add');
  await page.locator('[data-academic-class-form] input').fill('পরীক্ষা শ্রেণি');
  await page.locator('[data-academic-class-form] button').click();
  await expect(page.locator('[data-academic-status]')).toContainText('নতুন ক্লাস যোগ হয়েছে');
  await panel(page, 'academics-add').locator('[data-admin-back]').click();
  await expect(panel(page, 'academics')).toBeVisible();
  await openChild(page, 'academics', 'academics-mapping');
  await expect(panel(page, 'academics-mapping')).toContainText('পরীক্ষা শ্রেণি');

  await openHub(page, 'migration', 'system');
  await openChild(page, 'migration', 'migration-teacher');
  await page.locator('#adminV2Migration input').fill('preserved.teacher');
  await panel(page, 'migration-teacher').locator('[data-admin-back]').click();
  await expect(panel(page, 'migration')).toBeVisible();
  await openChild(page, 'migration', 'migration-student');
  await panel(page, 'migration-student').locator('[data-admin-back]').click();
  await expect(panel(page, 'migration')).toBeVisible();
  await openChild(page, 'migration', 'migration-teacher');
  await expect(page.locator('#adminV2Migration input')).toHaveValue('preserved.teacher');
  await expect(page.locator('#adminV2Migration')).toHaveCount(1);

  await openHub(page, 'profile', 'more');
  await openChild(page, 'profile', 'profile-account');
  await expectProfileIdContrast(page);
  await page.locator('[data-admin-profile-edit]').click();
  await expect(page.locator('#adminProfileName')).toBeFocused();
  await expect(page.locator('#adminProfileForm')).toBeVisible();
  await expect(page.locator('#adminProfileCard')).toHaveCount(1);
  await panel(page, 'profile-account').locator('[data-admin-back]').click();
  await expect(panel(page, 'profile')).toBeVisible();
  await openChild(page, 'profile', 'profile-app');
  const theme = panel(page, 'profile-app').locator('#darkModeToggle');
  const wasChecked = await theme.isChecked();
  await panel(page, 'profile-app').locator('label.theme-switch').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', wasChecked ? 'light' : 'dark');
  await panel(page, 'profile-app').locator('[data-admin-back]').click();
  await expect(panel(page, 'profile')).toBeVisible();
  await openChild(page, 'profile', 'profile-app');
  await expect(theme).toHaveJSProperty('checked', !wasChecked);
  await panel(page, 'profile-app').locator('[data-admin-back]').click();
  await expect(panel(page, 'profile')).toBeVisible();
  await openChild(page, 'profile', 'profile-account');
  await expectProfileIdContrast(page);

  await openHub(page, 'backup', 'more');
  await openChild(page, 'backup', 'backup-export');
  await page.locator('#backupExportPassphrase').fill('synthetic-backup-passphrase-2026');
  await page.locator('#backupExportPassphraseConfirm').fill('synthetic-backup-passphrase-2026');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#backupExportButton').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^APC-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const payload = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(payload).toMatchObject({ kind: 'active-plus-backup', version: 3, encrypted: true, algorithm: 'AES-256-GCM' });
  await expect(page.locator('#backupExportPassphrase')).toHaveValue('');
  expect(payload.data).toBeUndefined();
});
