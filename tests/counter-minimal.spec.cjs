/* Requested counter only: no roster/dues/contacts/history, query-only identity,
   simple payment and exact RYYMMDDNNN receipts, including real offline download. */
const { test, expect } = require('./fixtures.cjs');
const { seed } = require('./portal-session.cjs');
test.use({serviceWorkers:'block',reducedMotion:'reduce',timezoneId:'Asia/Dhaka'});
const DATE='2026-10-01T10:00:00Z';
const person={id:'S261001001',name:'নমুনা রাইসা',nameEn:'Sample Raisa',uniqueRoll:'261001001',className:'PRIVATE-CLASS',group:'PRIVATE-GROUP',mobile:'01700000000',guardianMobile:'01800000000',fatherName:'PRIVATE-GUARDIAN',address:'PRIVATE-ADDRESS',monthlyFee:8888,status:'approved'};
async function prepare(page,scene={width:390,theme:'light'}) {
 await page.setViewportSize({width:scene.width,height:844});
 await page.addInitScript(theme=>localStorage.setItem('active-plus-appearance-v2',theme),scene.theme);
 await page.clock.setFixedTime(new Date(DATE));
 await page.goto('/offline-roles.html');await seed(page,'payment');
 await page.evaluate(({person,date})=>{
  const now=new Date(date).getTime();
  localStorage.setItem('activePlus.admin.students.v1',JSON.stringify([person]));
  const tx={id:'TODAY',studentId:person.id,studentName:'আজকের নমুনা',receiptNo:'R261001001',amount:500,method:'নগদ (Cash)',feeType:'মাসিক বেতন',month:'অক্টোবর ২০২৬',recordedAt:now,collectedBy:'পেমেন্ট কাউন্টার',status:'approved',className:person.className,mobile:person.mobile};
  localStorage.setItem('activePlus.admin.transactions.v1',JSON.stringify([tx,{...tx,id:'OLD',studentName:'OLD-HISTORY',recordedAt:now-86400000},{...tx,id:'FUTURE',studentName:'FUTURE-HISTORY',recordedAt:now+86400000},{...tx,id:'OTHER',studentName:'OTHER-COLLECTOR',counterUsername:'other.apc'}]));
 },{person,date:DATE});
 await page.goto('/payment.html');await expect(page.locator('#paymentMain')).toHaveAttribute('data-counter-ready','true');
 await page.evaluate(()=>document.fonts.ready);
}
async function privateFieldsAbsent(page) {
 const text=await page.locator('body').innerText();
 expect(text).not.toMatch(/PRIVATE-|01700000000|01800000000|০১৭০০০০০০০০|০১৮০০০০০০০০|বকেয়া|বকেয়া|8888|৮৮৮৮/);
}
async function openPayment(page,query=person.id) {
 /* The counter's five seats are home/students/payment/reports/more: the
    identity-only search sits in the শিক্ষার্থী seat, not on the home screen. */
 await page.locator('.admin-bottom [data-pay-section=students]').click();
 await expect(page.locator('#payStudentsPanel')).toBeVisible();
 await page.locator('#payStudentSearch').fill(query);
 await page.locator('#paySearchResults .fee-search-result').click();
 await expect(page.locator('#payProfileCollect')).toBeEnabled();
 await page.locator('#payProfileCollect').click();await expect(page.locator('#payCollectionForm')).toBeVisible();
}
for(const scene of [{width:320,theme:'dark'},{width:390,theme:'light'},{width:1280,theme:'light'}]) {
 test(`today-only counter has no directory/dues/extras and universal search reveals identity only (${scene.width}px ${scene.theme})`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await prepare(page,scene);
  await expect(page.locator('#payTodayList .pay-activity-row')).toHaveCount(1);
  await expect(page.locator('#payTodayList')).not.toContainText(/OLD-HISTORY|FUTURE-HISTORY|OTHER-COLLECTOR/);
  await expect(page.locator('#paySearchResults .fee-search-result')).toHaveCount(0);await expect(page.locator('#payProfileCard')).toBeHidden();
  for(const selector of ['#payQuickPicks','#payDueStudents','#payMonthAmount','#payDeskTools','#payKeypad','#payStickyBar','#payReceiptWhatsApp']) await expect(page.locator(selector)).toHaveCount(0);
  await privateFieldsAbsent(page);
  await expect(page.locator('#payReportsCard')).toBeHidden();
  await expect(page.locator('#paymentReports')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const query of ['নমুনা রাইসা','s261001001','২৬১০০১০০১']) {
   await page.locator('.admin-bottom [data-pay-section=students]').click();
   await page.locator('#payStudentSearch').fill(query);
   await expect(page.locator('#paySearchResults .fee-search-result')).toHaveCount(1);
   await expect(page.locator('#paySearchResults')).toContainText(person.id);await privateFieldsAbsent(page);
  }
  for(const query of [person.fatherName,person.className]) {
   await page.locator('#payStudentSearch').fill(query);
   await expect(page.locator('#paySearchStatus')).toHaveText('কোনো মিল পাওয়া যায়নি।');
   await expect(page.locator('#paySearchResults .fee-search-result')).toHaveCount(0);
  }
  await page.locator('#paySearchClear').click();await expect(page.locator('#payProfileCard')).toBeHidden();
  expect(errors).toEqual([]);
 });
 test(`simple payment is pending/durable and its PDF filename has exactly the requested receipt number (${scene.width}px ${scene.theme})`,async({page})=>{
  await prepare(page,scene);await openPayment(page,person.uniqueRoll);
  await expect(page.locator('#payFeeAmount')).toHaveValue('');await expect(page.locator('#payFeeMethod')).toHaveValue('নগদ (Cash)');
  await page.locator('#payFeeAmount').fill('800');await page.locator('#paySaveButton').click();
  await expect(page.locator('#payReceiptBackdrop')).toBeVisible();await expect(page.locator('#payReceiptSub')).toHaveText('রসিদ নং: R261001002');
  await privateFieldsAbsent(page);
  const tx=await page.evaluate(()=>JSON.parse(localStorage.getItem('activePlus.admin.transactions.v1')));
  expect(tx).toHaveLength(5);expect(tx[0]).toMatchObject({amount:800,status:'pending',receiptNo:'R261001002',className:person.className});
  await expect(page.locator('#payReceiptBody')).not.toContainText(person.className);await expect(page.locator('#payReceiptBody')).toContainText('অনুমোদন বাকি');
  const waiting=page.waitForEvent('download');await page.locator('#payReceiptDownload').click();
  const pdf=await waiting;expect(pdf.suggestedFilename()).toBe('R261001002.pdf');
  expect(require('fs').readFileSync(await pdf.path()).toString('latin1').startsWith('%PDF-1.4')).toBe(true);
  await page.keyboard.press('Escape');await expect(page.locator('#payReceiptBackdrop')).toBeHidden();
  await expect(page.locator('#payTodayList .pay-activity-row')).toHaveCount(2);
  await expect(page.locator('#payProfileCard')).toBeHidden();
 });
}
test('today rolls over locally instead of leaving yesterday visible',async({page})=>{
 await prepare(page);await expect(page.locator('#payTodayList')).toContainText('আজকের নমুনা');
 await page.clock.setFixedTime(new Date('2026-10-02T10:00:00Z'));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('#payTodayList')).not.toContainText('আজকের নমুনা');
 await expect(page.locator('#payTodayList')).toContainText('FUTURE-HISTORY');
});
test('simultaneous tabs allocate distinct short receipts under the shared real ledger lock',async({page,context})=>{
 await prepare(page);
 const other=await context.newPage();await other.clock.setFixedTime(new Date(DATE));await other.goto('/payment.html');
 await expect(other.locator('#paymentMain')).toHaveAttribute('data-counter-ready','true');
 const fields={studentId:person.id,amount:700,feeType:'মাসিক বেতন',month:'অক্টোবর ২০২৬',method:'নগদ (Cash)'};
 const write=(tab)=>tab.evaluate(async input=>{const {saveCounterPayment}=await import('/js/counter-data.js');return (await saveCounterPayment(input)).transaction.receiptNo;},fields);
 const numbers=await Promise.all([write(page),write(other)]);
 expect(new Set(numbers)).toEqual(new Set(['R261001002','R261001003']));
});
test('ending the counter session purges its identity/receipt surfaces as the shared guard locks it',async({page})=>{
 await prepare(page);await openPayment(page);await page.locator('#payFeeAmount').fill('800');await page.locator('#paySaveButton').click();
 await expect(page.locator('#payReceiptBackdrop')).toBeVisible();
 await page.evaluate(async()=>{const {clearPaymentSession,PAYMENT_SESSION_KEY}=await import('/js/payment-auth.js');clearPaymentSession();window.dispatchEvent(new StorageEvent('storage',{key:PAYMENT_SESSION_KEY}));});
 await expect(page.locator('#payShell')).toBeHidden();await expect(page.locator('#payReceiptBackdrop')).toBeHidden();
 await expect(page.locator('#payReceiptBody')).toBeEmpty();await expect(page.locator('#payQuickProfile')).toBeEmpty();
 await expect(page.locator('#payTodayList')).toBeEmpty();
});
test.describe('offline minimal counter',()=>{
 test.use({serviceWorkers:'allow'});
 test('first payment/PDF after clearing HTTP cache and reloading offline stays private and exact-numbered',async({page,context})=>{
  await prepare(page,{width:320,theme:'dark'});
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
  const cdp=await context.newCDPSession(page);await cdp.send('Network.clearBrowserCache');await cdp.detach();
  await context.setOffline(true);await page.reload();
  await expect(page.locator('#paymentMain')).toHaveAttribute('data-counter-ready','true');
  expect(await page.evaluate(()=>navigator.onLine)).toBe(false);
  await openPayment(page,'নমুনা রাইসা');await page.locator('#payFeeAmount').fill('800');await page.locator('#paySaveButton').click();
  await expect(page.locator('#payReceiptBackdrop')).toBeVisible();await privateFieldsAbsent(page);
  const waiting=page.waitForEvent('download');await page.locator('#payReceiptDownload').click();
  expect((await waiting).suggestedFilename()).toBe('R261001002.pdf');
 });
});
