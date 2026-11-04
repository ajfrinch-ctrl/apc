const {test,expect}=require('./fixtures.cjs');
const PASSWORD='Existing-2026';
// Fault-injection routes must reach the network rather than a precached worker.
// Actual worker/offline behavior is exercised separately in minimal-workflows.
test.use({serviceWorkers:'block'});
for(const role of ['admin','manager','teacher','payment'])test(`stored ${role} login ID survives redesign and opens its panel`,async({page})=>{
 await page.goto('/index.html');
 const id=await page.evaluate(async ({role,password})=>{
  const {STAFF_ACCOUNTS}=await import('/js/staff-auth.js');
  const {hashPassword}=await import('/js/password-hash.js');
  const username=role==='payment'?'APC-PAY-001':`existing.${role}.apc`;
  localStorage.setItem(STAFF_ACCOUNTS[role].accountKey,JSON.stringify({username,password:await hashPassword(password),role,status:'active',fullName:'Existing User'}));
  localStorage.setItem('qa-preserve','unchanged');
  return username;
 },{role,password:PASSWORD});
 await page.reload();
 await page.fill('#loginMobile',id);await page.fill('#loginPin',PASSWORD);await page.click('#loginForm button[type=submit]');
 await expect(page).toHaveURL(new RegExp(`/${role}.html$`),{timeout:15000});
 await expect(page.locator(role==='payment'?'#payShell':`#${role}Shell`)).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('qa-preserve'))).toBe('unchanged');
});
test('missing login module never submits credentials to the URL or reloads',async({page})=>{
 await page.route(/\/js\/main\.js(?:\?.*)?$/,route=>route.abort('failed'));
 await page.goto('/index.html');
 await expect(page.locator('#appEntryError')).toBeVisible();
 let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++});
 await page.fill('#loginMobile','existing.admin.apc');await page.fill('#loginPin',PASSWORD);await page.click('#loginForm button[type=submit]');
 await expect(page.locator('#authMessage')).toContainText('লগইন লোড হয়নি');
 expect(navigations).toBe(0);expect(new URL(page.url()).search).toBe('');
});
test('panel module failure after verified login shows recovery instead of blank page',async({page})=>{
 await page.goto('/index.html');
 await page.evaluate(async password=>{
  const {STAFF_ACCOUNTS}=await import('/js/staff-auth.js');const {hashPassword}=await import('/js/password-hash.js');
  localStorage.setItem(STAFF_ACCOUNTS.admin.accountKey,JSON.stringify({username:'old.admin.apc',password:await hashPassword(password),role:'admin',fullName:'Old Admin'}));
 },PASSWORD);
 await page.route(/\/js\/admin\.js(?:\?.*)?$/,route=>route.abort('failed'));
 await page.fill('#loginMobile','old.admin.apc');await page.fill('#loginPin',PASSWORD);await page.click('#loginForm button[type=submit]');
 await expect(page).toHaveURL(/\/admin.html$/);await expect(page.locator('#appEntryError')).toBeVisible();await expect(page.locator('#appEntryError button')).toHaveText('আবার চেষ্টা করুন');
 expect(await page.evaluate(()=>localStorage.getItem('activePlus.adminAccount.v1')!==null)).toBe(true);
});
test('legacy cash userId/pin keeps its ID through mandatory password change and reload',async({page})=>{
 await page.goto('/index.html');
 await page.evaluate(()=>localStorage.setItem('activePlus.paymentAccount.v1',JSON.stringify({userId:'APC-PAY-001',pin:'456789',fullName:'Existing Cashier',staffId:'STF-0099'})));
 await page.fill('#loginMobile','APC-PAY-001');await page.fill('#loginPin','456789');await page.click('#loginForm button[type=submit]');
 await expect(page.locator('.staff-pw-backdrop')).toBeVisible();await page.fill('#staffPwNew',PASSWORD);await page.fill('#staffPwConfirm',PASSWORD);await page.locator('.staff-pw-form button[type=submit]').click();
 await expect(page).toHaveURL(/\/payment.html$/);await expect(page.locator('#payShell')).toBeVisible();
 await page.reload();await expect(page.locator('#payShell')).toBeVisible();
 const account=await page.evaluate(async()=> (await import('/js/staff-auth.js')).readStaffAccount('payment'));
 expect(account.username).toBe('APC-PAY-001');expect(account.staffId).toBe('STF-0099');expect(account.fullName).toBe('Existing Cashier');expect(account.pin).toBeUndefined();expect(typeof account.password).toBe('object');
});
for(const id of ['AP-1024','s260929001-abcdef0123456789','S-260929001'])test(`old student ID ${id} still signs in without navigation`,async({page})=>{
 await page.goto('/index.html');await page.evaluate(id=>localStorage.setItem('active-plus-account-v1',JSON.stringify({username:'existing.student',mobile:'01712345678',pin:'456789',status:'active',student:{id,name:'Existing Student',className:'দশম শ্রেণি'}})),id);
 await page.reload();await page.fill('#loginMobile',id);await page.fill('#loginPin','456789');await page.click('#loginForm button[type=submit]');await expect(page.locator('#appShell')).toBeVisible();expect(new URL(page.url()).search).toBe('');
});
