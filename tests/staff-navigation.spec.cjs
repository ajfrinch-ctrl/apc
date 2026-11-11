const { test, expect } = require('./fixtures.cjs');
const { enterPortal } = require('./portal-session.cjs');

const cases = [
  { role: 'admin', disabled: null },
  { role: 'teacher', disabled: 'finance' },
  { role: 'manager', disabled: null },
  { role: 'payment', disabled: 'academic' }
];

for (const { role, disabled } of cases) {
  test(`${role} shared navigation is keyboard-operable and role-gated`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterPortal(page, role);

    const nav = page.locator('.staff-bottom-nav');
    await expect(nav).toHaveAttribute('aria-label', 'স্টাফ নেভিগেশন');
    await expect(nav.locator(':scope > button[data-staff-tab]')).toHaveCount(5);

    const work = nav.locator('[data-staff-tab="work"]');
    await work.focus();
    await page.keyboard.press('Enter');
    await expect(work).toHaveAttribute('aria-current', 'page');

    const more = nav.locator('[data-staff-tab="more"]');
    await more.focus();
    await page.keyboard.press('Space');
    await expect(more).toHaveAttribute('aria-current', 'page');

    if (disabled) {
      const unavailable = nav.locator(`[data-staff-tab="${disabled}"]`);
      await expect(unavailable).toBeDisabled();
      await expect(unavailable).toHaveAttribute('aria-disabled', 'true');
      await expect(unavailable).not.toHaveAttribute('aria-current', 'page');
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
