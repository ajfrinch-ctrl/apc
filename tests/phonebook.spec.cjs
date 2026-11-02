const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

const ROSTER_SEED = [
  {
    id: 'AP-301',
    name: 'রাইসা ইসলাম',
    fatherName: 'শফিকুল ইসলাম',
    className: 'দশম শ্রেণি',
    group: 'বিজ্ঞান',
    mobile: '01712345678',
    guardianMobile: '01812345679',
    status: 'approved',
    monthlyFee: 2200
  },
  {
    id: 'AP-302',
    name: 'তানভীর আহমেদ',
    fatherName: 'আব্দুল করিম',
    className: 'অষ্টম শ্রেণি',
    group: 'A',
    mobile: '01911223344',
    guardianMobile: '01611223344',
    status: 'pending'
  }
];

async function assertZeroOverflowAndTouchTargets(page, shellSelector, mountSelector) {
  const overflow = await page.evaluate(({ shellSel, mountSel }) => {
    const shell = document.querySelector(shellSel);
    const mount = document.querySelector(mountSel);
    return {
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      shellOverflow: shell ? shell.scrollWidth - shell.clientWidth : 0,
      mountOverflow: mount ? mount.scrollWidth - mount.clientWidth : 0
    };
  }, { shellSel: shellSelector, mountSel: mountSelector });

  expect(overflow.docOverflow).toBeLessThanOrEqual(0);
  expect(overflow.shellOverflow).toBeLessThanOrEqual(1);
  expect(overflow.mountOverflow).toBeLessThanOrEqual(1);

  const undersized = await page.locator(
    `${mountSelector} .yp-mode-tab:visible, ` +
    `${mountSelector} .yp-action-btn:visible, ` +
    `${mountSelector} .yp-class-pill:visible, ` +
    `${mountSelector} .yp-status-chip:visible, ` +
    `${mountSelector} .yp-tpl-chip:visible, ` +
    `${mountSelector} .yp-send-wa-btn:visible, ` +
    `${mountSelector} .yp-copy-msg-btn:visible, ` +
    `${mountSelector} .yp-class-banner:visible`
  ).evaluateAll(elements => elements
    .map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, cls: el.className, text: el.textContent.trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter(item => item.h < 44 || item.w < 44)
  );
  expect(undersized).toEqual([]);
}

for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }]) {
  test(`Admin & Manager Yellow Pages Phonebook holds 0px overflow & >=44px targets at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => {
      const msg = String(err?.message || err || '');
      if (/auth\/network-request-failed|Supabase endpoint temporarily unreachable|Failed to fetch/i.test(msg)) return;
      errors.push(msg);
    });
    await page.route(/supabase\.co|firebaseio\.com|googleapis\.com/, route => route.abort());
    await page.setViewportSize(viewport);

    await page.addInitScript(roster => {
      localStorage.setItem('activePlus.admin.students.v1', JSON.stringify(roster));
      window.__openedWhatsappUrls = [];
      window.open = url => {
        window.__openedWhatsappUrls.push(String(url));
        return { opener: null };
      };
    }, ROSTER_SEED);

    // 1. Admin Panel Phonebook (Light + Dark AMOLED)
    await enterPortal(page, 'admin');
    await expect(page.locator('#adminShell')).toBeVisible();
    const adminAlert = page.locator('#apcAlertBackdrop');
    if (await adminAlert.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(adminAlert).toBeHidden();
    }
    await page.locator('.phonebook-hub-card[data-panel-view="phonebook"]').click();
    await expect(page.locator('.admin-view[data-view-panel="phonebook"]')).toBeVisible();
    await expect(page.locator('#adminPhonebookMount [data-yp-student-card]')).toHaveCount(2);

    await assertZeroOverflowAndTouchTargets(page, '#adminShell', '#adminPhonebookMount');

    // Open WhatsApp Draft Composer & verify 360px layout with tray expanded
    const guardianLine = page.locator('#adminPhonebookMount [data-yp-contact-key="student:AP-301:guardian"]');
    await guardianLine.locator('[data-yp-action="toggle-draft"]').click();
    await expect(page.locator('#adminPhonebookMount [data-yp-draft-tray="student:AP-301:guardian"]')).toBeVisible();
    await page.locator('#adminPhonebookMount [data-yp-template="due"]').click();
    await expect(page.locator('#adminPhonebookMount [data-yp-draft-input="student:AP-301:guardian"]')).toHaveValue(/৳২,২০০/);

    await assertZeroOverflowAndTouchTargets(page, '#adminShell', '#adminPhonebookMount');

    await page.locator('#adminPhonebookMount [data-yp-action="send-draft"]').click();
    const lastAdminUrl = await page.evaluate(() => window.__openedWhatsappUrls.at(-1));
    expect(lastAdminUrl).toMatch(/^https:\/\/wa\.me\/8801812345679\?text=/);

    // Switch to Dark AMOLED & Staff Directory tab
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.locator('#adminPhonebookMount [data-yp-tab="staff"]').click();
    await expect(page.locator('#adminPhonebookMount [data-yp-staff-card]').first()).toBeVisible();
    await assertZeroOverflowAndTouchTargets(page, '#adminShell', '#adminPhonebookMount');
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));

    // 2. Manager Panel Phonebook (from Home & More)
    await enterPortal(page, 'manager');
    await expect(page.locator('#managerShell')).toBeVisible();
    const mgrAlert = page.locator('#apcAlertBackdrop');
    if (await mgrAlert.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(mgrAlert).toBeHidden();
    }
    await page.locator('.manager-view[data-view-panel="dashboard"] [data-panel-view="phonebook"]').click();
    await expect(page.locator('.manager-view[data-view-panel="phonebook"]')).toBeVisible();
    await expect(page.locator('#managerPhonebookMount [data-yp-student-card]')).toHaveCount(2);

    await assertZeroOverflowAndTouchTargets(page, '#managerShell', '#managerPhonebookMount');

    // Check Manager Staff tab as well
    await page.locator('#managerPhonebookMount [data-yp-tab="staff"]').click();
    await expect(page.locator('#managerPhonebookMount [data-yp-staff-card]').first()).toBeVisible();
    await assertZeroOverflowAndTouchTargets(page, '#managerShell', '#managerPhonebookMount');

    expect(errors).toEqual([]);
  });
}
