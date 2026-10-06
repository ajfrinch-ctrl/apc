const { test, expect } = require('./fixtures.cjs');
const { enterStudentApp, enterPortal } = require('./portal-session.cjs');
const KEY = 'active-plus-account-v1';
test.use({ viewport: { width: 390, height: 844 } });
/* Every role signs in on the one shared card in index.html; a student session
   is set up by the fixture the same way a real sign-in writes it. */
async function demo(page) { await enterStudentApp(page); }
async function edit(page) { await page.locator('.bottom-nav [data-view=profile]').click(); await page.locator('#profileView [data-action=edit-profile]').first().click(); }
async function logout(page) { await page.locator('[data-action=logout]').click(); await page.locator('#logoutConfirmButton').click(); }
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);

test('registration default password and permanent number ignore tampered contact input', async ({ page }) => {
  await page.goto('/index.html'); await page.locator('.auth-tab[data-auth-tab=register]').click();
  await expect(page.locator('#regPin')).toHaveValue('123123'); await expect(page.locator('#regPinConfirm')).toHaveValue('123123');
  await page.locator('#regMobile').fill('01711223344'); await page.locator('[data-registration-step="1"] [data-next-step]').click();
  for (const [id,value] of Object.entries({nameBn:'নতুন শিক্ষার্থী',nameEn:'New Student',fatherName:'Father',motherName:'Mother',birthDate:'2010-01-01'})) await page.locator('#'+id).fill(value);
  await page.locator('#gender').selectOption('পুরুষ'); await page.locator('[data-registration-step="2"] [data-next-step]').click();
  await expect(page.locator('#studentMobile')).toHaveAttribute('readonly', '');
  await page.locator('#studentMobile').evaluate(el => { el.value = '01911223344'; });
  await page.locator('#guardianMobile').fill('01811223344'); await page.locator('#address').fill('ঢাকা'); await page.locator('[data-registration-step="3"] [data-next-step]').click();
  await page.locator('#regClass').selectOption('দশম শ্রেণি'); await page.locator('#regGroup').selectOption('বিজ্ঞান'); await page.locator('[data-registration-step="4"] [data-next-step]').click();
  await page.locator('#securityQuestion').selectOption({ index:1 }); await page.locator('#securityAnswer').fill('test'); await page.locator('.terms-label').click();
  await page.locator('#registrationForm [type=submit]').click(); await expect(page.locator('#pendingScreen')).toBeVisible();
  const account = await saved(page); expect(account.mobile).toBe('01711223344'); expect(account.registrationMobile).toBe(account.mobile); expect(account.student.studentMobile).toBe(account.mobile); expect(account.pin).toBe('123123');
  await page.locator('#pendingLogout').click(); await page.locator('#loginMobile').fill(account.mobile); await page.locator('#loginPin').fill('123123'); await page.locator('#loginForm [type=submit]').click();
  await expect(page.locator('#pendingScreen')).toBeVisible();
});

test('profile appends multiple contacts, original persists after tamper/reload and remains login ID', async ({ page }) => {
  await demo(page); await edit(page);
  await expect(page.locator('#editStudentMobile')).toHaveAttribute('readonly', '');
  await page.locator('#editStudentMobile').evaluate(el => { el.removeAttribute('readonly'); el.value = ''; });
  await page.locator('#editAdditionalMobile').fill('০১৮১১২২৩৩৪৪'); await page.locator('#profileForm [type=submit]').click();
  await expect(page.locator('#studentMobileValue')).toHaveText('০১৭০০০০০০০০'); await expect(page.locator('#studentAdditionalMobiles')).toContainText('০১৮১১২২৩৩৪৪');
  await edit(page); await page.locator('#editAdditionalMobile').fill('01911223344'); await page.locator('#profileForm [type=submit]').click();
  let account = await saved(page); expect(account.mobile).toBe('01700000000'); expect(account.additionalMobiles).toEqual(['01811223344','01911223344']);
  await page.reload(); await edit(page); await expect(page.locator('#editAdditionalMobiles')).toContainText('01811223344');
  await page.locator('#editAdditionalMobile').fill('+8801811223344'); await page.locator('#profileForm [type=submit]').click(); await expect(page.locator('.feedback-toast')).toContainText('আগেই যুক্ত আছে');
  await page.locator('#editAdditionalMobile').fill('bad-number'); await page.locator('#profileForm [type=submit]').click(); await expect(page.locator('.feedback-toast')).toContainText('সঠিক ১১ সংখ্যার');
  await page.locator('#editModal [data-close-modal]').click(); await logout(page);
  await page.locator('#loginMobile').fill('01811223344'); await page.locator('#loginPin').fill('123123'); await page.locator('#loginForm [type=submit]').click(); await expect(page.locator('#authMessage')).toContainText('সঠিক নয়');
  await page.locator('#loginMobile').fill('01700000000'); await page.locator('#loginForm [type=submit]').click(); await expect(page.locator('#appShell')).toBeVisible();
});

test('failed profile contact save keeps input and account unchanged', async ({ page }) => {
  await demo(page); await edit(page); const before = await saved(page);
  await page.evaluate(key => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if(k===key) throw new DOMException('quota','QuotaExceededError'); return set.call(this,k,v); }; }, KEY);
  await page.locator('#editAdditionalMobile').fill('01811223344'); await page.locator('#profileForm [type=submit]').click();
  await expect(page.locator('#editModal')).toBeVisible(); await expect(page.locator('#editAdditionalMobile')).toHaveValue('01811223344'); await expect(page.locator('.feedback-toast')).toContainText('সংরক্ষণ হয়নি'); expect(await saved(page)).toEqual(before);
});

test('manager password reset persists only after confirmation and keeps original phone', async ({ page }) => {
  // শিক্ষার্থী management — including a password reset — is the Manager's work,
  // never the Admin panel's.
  await demo(page); await page.evaluate(key=>{const a=JSON.parse(localStorage.getItem(key));a.pin='789789';localStorage.setItem(key,JSON.stringify(a));},KEY);
  await enterPortal(page, 'manager');
  await page.locator('.admin-bottom [data-manager-view=students]').click();
  await page.locator('[data-manager-action=reset-password][data-id="AP-1024"]').click();
  await expect(page.locator('#managerModalBody .pin-box')).toHaveText('১২৩১২৩');
  expect((await saved(page)).pin).toBe('789789');
  await page.locator('#managerModalBody [data-modal-action=confirm-reset]').click();
  expect((await saved(page)).pin).toBe('123123'); expect((await saved(page)).mobile).toBe('01700000000');
});

test('recovery defaults to 123123, requires original number and persists only after verification', async ({ page }) => {
  await demo(page);
  await page.evaluate(key => { const a=JSON.parse(localStorage.getItem(key)); a.pin='789789'; a.additionalMobiles=['01811223344']; a.securityQuestion='তোমার শৈশবের ডাকনাম কী?'; a.securityAnswer='raisa'; localStorage.setItem(key,JSON.stringify(a)); }, KEY);
  await page.locator('.bottom-nav [data-view=profile]').click(); await logout(page); await page.locator('#forgotPinButton').click();
  // Step 1 verifies the student; the new password is only asked after that.
  await expect(page.locator('#recoveryPasswordStep')).toBeHidden();
  await page.locator('#recoveryMobile').fill('01811223344'); await page.locator('#recoveryQuestion').selectOption({index:1}); await page.locator('#recoveryAnswer').fill('raisa');
  await page.locator('#recoveryForm [type=submit]').click(); await expect(page.locator('#recoveryVerifyError')).toContainText('সঠিক নয়');
  await expect(page.locator('#recoveryPasswordStep')).toBeHidden(); expect((await saved(page)).pin).toBe('789789');
  await page.locator('#recoveryMobile').fill('01700000000'); await page.locator('#recoveryForm [type=submit]').click();
  await expect(page.locator('#recoveryPasswordStep')).toBeVisible();
  await expect(page.locator('#recoveryStudentSummary')).toContainText('Student ID');
  const held=await saved(page); expect(held.pin).toBe('789789');
  await page.locator('#recoveryPin').fill('123123'); await page.locator('#recoveryPinConfirm').fill('123123');
  await page.locator('#recoveryPasswordForm [type=submit]').click();
  await expect(page.locator('#recoveryModal')).toBeHidden(); const account=await saved(page); expect(account.pin).toBe('123123'); expect(account.registrationMobile).toBe('01700000000'); expect(account.additionalMobiles).toEqual(['01811223344']);
});

test('registration number is fixed in the student info update form', async ({ page }) => {
  await demo(page); await edit(page);
  await expect(page.locator('#editRegistrationNo')).toHaveAttribute('readonly', '');
  const shown = await page.locator('#editRegistrationNo').inputValue();
  // Even a scripted value cannot leak into the saved profile.
  await page.locator('#editRegistrationNo').evaluate(el => { el.value = '999999H'; });
  await page.locator('#profileForm [type=submit]').click();
  await expect(page.locator('#editModal')).toBeHidden();
  await edit(page);
  await expect(page.locator('#editRegistrationNo')).toHaveValue(shown);
});
