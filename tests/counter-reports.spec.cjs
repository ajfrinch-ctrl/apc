/* Real guarded counter search/serial/report UI and real PDF/CSV downloads.
   Full phones/private fields must not enter query results, report payloads,
   previews, CSV or canvas drawing. Synthetic browser contexts only. */
const {test,expect}=require('./fixtures.cjs');
const {seed}=require('./portal-session.cjs');
test.use({serviceWorkers:'block',reducedMotion:'reduce',timezoneId:'Asia/Dhaka'});
const PERSON={id:'S261001001',name:'নমুনা রাইসা',nameEn:'Sample Raisa',uniqueRoll:'261001001',className:'দশম শ্রেণি',group:'বিজ্ঞান',mobile:'01712345678',guardianMobile:'01898765432',fatherName:'PRIVATE-FATHER',address:'PRIVATE-ADDRESS',pinHash:'PRIVATE-SECRET',monthlyFee:1000};
const DATE='2026-10-01T10:00:00Z';
async function prepare(page,scene={width:390,theme:'light'}) {
 await page.setViewportSize({width:scene.width,height:844});await page.addInitScript(theme=>localStorage.setItem('active-plus-appearance-v2',theme),scene.theme);
 await page.clock.setFixedTime(new Date(DATE));await page.goto('/offline-roles.html');await seed(page,'payment');
 await page.evaluate(({person,date})=>{
  localStorage.setItem('activePlus.admin.students.v1',JSON.stringify([person]));const now=new Date(date).getTime();
  const tx={id:'IMMUTABLE-1',transactionNo:'T26007',receiptNo:'R261001001',studentId:person.id,studentName:person.name,feeType:'মাসিক বেতন',month:'অক্টোবর ২০২৬',amount:400,method:'নগদ (Cash)',recordedAt:now,collectedBy:'পেমেন্ট কাউন্টার',status:'approved',note:'PRIVATE-NOTE',mobile:person.mobile,address:person.address};
  localStorage.setItem('activePlus.admin.transactions.v1',JSON.stringify([tx,{...tx,id:'OLDER',transactionNo:'T26006',receiptNo:'R260930001',recordedAt:now-86400000}]));
 },{person:PERSON,date:DATE});
 await page.goto('/payment.html');await expect(page.locator('#paymentMain')).toHaveAttribute('data-counter-ready','true');await expect(page.locator('.launch-screen')).toHaveCount(0);
}
async function reports(page) {await page.locator('.admin-bottom [data-pay-section="reports"]').click();await expect(page.locator('#payReportsCard')).toBeVisible();}
for(const scene of [{width:320,theme:'dark'},{width:390,theme:'light'},{width:1280,theme:'light'}]) {
 test(`phone search is usable and masks central three digits (${scene.width}px ${scene.theme})`,async({page})=>{
  await prepare(page,scene);await expect(page.locator('#payReportsCard')).toBeHidden();
  for(const phone of ['01712345678','০১৭১২৩৪৫৬৭৮','+8801712345678','01898765432']) {
   await page.locator('#payStudentSearch').fill(phone);await expect(page.locator('#paySearchResults .fee-search-result')).toHaveCount(1);
   await expect(page.locator('#paySearchResults')).toContainText('0171***5678');await expect(page.locator('#paySearchResults')).toContainText('0189***5432');
   expect(await page.locator('#paySearchResults').innerText()).not.toMatch(/01712345678|01898765432|PRIVATE-/);
  }
  await page.locator('#paySearchResults .fee-search-result').click();await expect(page.locator('#payQuickProfile')).toContainText('0171***5678');
  expect(await page.locator('#payQuickProfile').innerText()).not.toMatch(/01712345678|01898765432|PRIVATE-/);
 });
 test(`all financial report types use masked contacts in real preview/PDF/CSV (${scene.width}px ${scene.theme})`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await prepare(page,scene);await reports(page);
  await expect(page.locator('#payCounterHome')).toBeHidden();await expect(page.locator('#paymentReports select[name="report"] option')).toHaveCount(21);
  await page.locator('#paymentReports select[name="report"]').selectOption('fee.transactions');
  await page.locator('#paymentReports input[name="includeMobile"]').check();
  await page.evaluate(()=>{window.__reportTexts=[];const draw=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.__reportTexts.push(String(text));return draw.call(this,text,...args);};});
  const before=await page.evaluate(()=>localStorage.getItem('activePlus.admin.transactions.v1'));
  await page.locator('#paymentReports button[type="submit"]').click();await expect(page.locator('#paymentReports .rc-pdf-preview')).toBeVisible();
  const preview=await page.locator('#paymentReports .rc-pdf-preview').innerText();expect(preview).toContain('0171***5678');expect(preview).toContain('0189***5432');expect(preview).toContain('T26007');
  expect(preview).not.toMatch(/01712345678|01898765432|PRIVATE-|IMMUTABLE-1/);
  expect(await page.locator('.counter-financial-table td').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
  expect((await page.evaluate(()=>window.__reportTexts)).join(' ')).not.toMatch(/01712345678|01898765432|PRIVATE-/);
  let waiting=page.waitForEvent('download');await page.locator('[data-counter-download="csv"]').click();const csv=await waiting;
  const bytes=require('fs').readFileSync(await csv.path(),'utf8');expect(bytes).toContain('0171***5678');expect(bytes).not.toMatch(/01712345678|01898765432|PRIVATE-/);
  waiting=page.waitForEvent('download');await page.locator('[data-counter-download="pdf"]').click();const pdf=await waiting;
  expect(require('fs').readFileSync(await pdf.path()).toString('latin1').startsWith('%PDF-1.4')).toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('activePlus.admin.transactions.v1'))).toBe(before);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.admin-bottom [data-pay-section="home"]').click();await expect(page.locator('#payReportsCard')).toBeHidden();await expect(page.locator('#payTodayList .pay-activity-row')).toHaveCount(1);
  expect(errors).toEqual([]);
 });
}
test('report catalog coverage and domain payloads keep all payment types safe',async({page})=>{
 await prepare(page);const result=await page.evaluate(async()=>{const {COUNTER_PAYMENT_REPORTS,buildCounterPaymentReport}=await import('/js/counter-report-data.js');const payloads=[];for(const def of COUNTER_PAYMENT_REPORTS)payloads.push(await buildCounterPaymentReport(def.id,{period:'all',studentId:def.mode==='student'?'S261001001':'',includeMobile:true}));return payloads;});
 expect(result).toHaveLength(20);expect(JSON.stringify(result)).not.toMatch(/01712345678|01898765432|PRIVATE-/);
});
test('serial T IDs continue across concurrent tabs and a date change without altering storage keys',async({page,context})=>{
 await prepare(page);const other=await context.newPage();await other.clock.setFixedTime(new Date(DATE));await other.goto('/payment.html');await expect(other.locator('#paymentMain')).toHaveAttribute('data-counter-ready','true');
 const fields={studentId:PERSON.id,amount:800,feeType:'মাসিক বেতন',month:'অক্টোবর ২০২৬',method:'নগদ (Cash)'};
 const write=tab=>tab.evaluate(async input=>{const {saveCounterPayment}=await import('/js/counter-data.js');return (await saveCounterPayment(input)).transaction;},fields);
 const transactions=await Promise.all([write(page),write(other)]);expect(new Set(transactions.map(tx=>tx.transactionNo))).toEqual(new Set(['T26008','T26009']));
 expect(new Set(transactions.map(tx=>tx.id)).size).toBe(2);expect(transactions.every(tx=>tx.id!==tx.transactionNo)).toBe(true);
 await page.clock.setFixedTime(new Date('2026-10-02T10:00:00Z'));const next=await write(page);expect(next.transactionNo).toBe('T26010');expect(next.receiptNo).toBe('R261002001');
});
test('reports do not discard an unsaved simple payment or expose its raw phone query',async({page})=>{
 await prepare(page);await page.locator('#payStudentSearch').fill(PERSON.guardianMobile);await page.locator('#paySearchResults .fee-search-result').click();await page.locator('#payProfileCollect').click();await page.locator('#payFeeAmount').fill('975');
 await reports(page);await page.locator('.admin-bottom [data-pay-section="home"]').click();await expect(page.locator('#payFeeAmount')).toHaveValue('975');
});
test.describe('offline reports',()=>{
 test.use({serviceWorkers:'allow'});
 test('phone lookup, report preview and downloads work after cold offline PWA reload',async({page,context})=>{
  await prepare(page,{width:390,theme:'dark'});await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
  const cdp=await context.newCDPSession(page);await cdp.send('Network.clearBrowserCache');await cdp.detach();await context.setOffline(true);await page.reload();await expect(page.locator('#paymentMain')).toHaveAttribute('data-counter-ready','true');
  await page.locator('#payStudentSearch').fill(PERSON.mobile);await expect(page.locator('#paySearchResults')).toContainText('0171***5678');
  await reports(page);await page.locator('#paymentReports select[name="report"]').selectOption('cash.pending');await page.locator('#paymentReports button[type="submit"]').click();
  await expect(page.locator('[data-counter-download="pdf"]')).toBeVisible();const waiting=page.waitForEvent('download');await page.locator('[data-counter-download="pdf"]').click();expect((await waiting).suggestedFilename()).toMatch(/\.pdf$/);
 });
});
