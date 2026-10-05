const {test,expect}=require('./fixtures.cjs');
const {enterPortal}=require('./portal-session.cjs');
const fs=require('node:fs/promises');
test.use({viewport:{width:390,height:844}});
async function roster(page,count=1){await page.evaluate(async count=>{
 const {ROSTER_KEY}=await import('/js/office-data.js');
 localStorage.setItem(ROSTER_KEY,JSON.stringify(Array.from({length:count},(_,i)=>({id:`QA-${i}`,name:`শিক্ষার্থী ${i}`,mobile:`017${String(10000000+i)}`,className:'দশম শ্রেণি',status:'approved',monthlyFee:1000,enrolledAt:'2026-09-01'}))));
},count);}
test('SDK network failure is caught with no standing sync notice on the login screen',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://www.gstatic.com/**',r=>r.abort('connectionfailed'));
 await page.goto('/index.html');
 expect(errors).toEqual([]);
 // Sync status is colour-only now: the login screen has no topbar, so it must
 // show no chip, banner or sync label — only the html-level verdict may exist.
 await expect(page.locator('#cloudSyncStatus, .topbar-sync-chip')).toHaveCount(0);
 expect(['idle','syncing','error']).toContain(await page.evaluate(()=>document.documentElement.dataset.syncVisual));
 await expect(page.locator('#loginForm')).toBeVisible();
});
test('report: 60 real rows paginate, download PDF, empty filter opens preview',async({page})=>{
 await enterPortal(page,'admin');await roster(page,60);await page.reload();
 await page.locator('.admin-bottom [data-admin-view=reports]').click();
 await page.locator('select[name=report]').selectOption('student.all');
 await page.locator('.rc-generate').click();await expect(page.locator('.rc-pdf-preview .rp-page').first()).toBeVisible();
 expect(await page.locator('.rp-page').count()).toBeGreaterThan(1);
 await expect(page.locator('.rc-pdf-preview')).toContainText('শিক্ষার্থী 59');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const download=page.waitForEvent('download');await page.locator('.rc-download').click();const file=await download;const bytes=await fs.readFile(await file.path());expect(bytes.subarray(0,8).toString()).toContain('%PDF-1.');expect(bytes.toString('latin1')).toContain('%%EOF');
 await page.locator('.rc-back').click();await page.locator('select[name=report]').selectOption('student.pending');await page.locator('.rc-generate').click();await expect(page.locator('.rc-pdf-preview')).toBeVisible();await expect(page.locator('.rc-pdf-preview')).toContainText('কোনো');
});
test('teacher: all 30 MCQ templates render, apply and copy without changing academic engine',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await page.addInitScript(()=>localStorage.setItem('activePlus.manager.teacherAssignments.v1',JSON.stringify([{id:'QA-AS',teacherUsername:'teacher.apc',teacherName:'QA Teacher',className:'দশম শ্রেণি',group:'',subject:'গণিত'}])));
 await enterPortal(page,'teacher');await page.locator('.admin-bottom [data-teacher-view=online-exams]').click();
 await page.locator('[data-exam-action=new-mcq]').click();
 await expect(page.locator('[data-template-index] option')).toHaveCount(30);
 for(let i=0;i<30;i++){await page.locator('[data-template-index]').selectOption(String(i));await page.locator('[data-exam-action=use-template]').click();await expect(page.locator('[name=template]')).not.toHaveValue('');}
 await page.locator('[data-exam-action=copy-template]').click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('প্রশ্ন');
 await page.locator('[data-exam-action=sample-30]').click();const text=await page.locator('[name=template]').inputValue();expect(text.split('---').length).toBe(30);
});
test('offline update preserves sentinel, existing account and all protected assets',async({page,context})=>{
 await enterPortal(page,'admin');await page.evaluate(()=>localStorage.setItem('qa-existing-data','must-survive'));
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.ready;await r.update();});
 await expect.poll(()=>page.evaluate(async()=> (await caches.keys()).some(k=>k.includes('v116')))).toBe(true);
 const cached=await page.evaluate(async()=>{const c=await caches.open('active-plus-student-v116-minimal-education');return (await c.keys()).map(r=>new URL(r.url).pathname)});
 for(const p of ['/firebase/firebase-config.js','/firebase/firebase-init.js','/sync/sync-core.js','/sync/sync-guard.js','/sync/sync-retry.js','/js/icons.js','/css/ui-status.css','/css/app-polish.css','/css/student-record.css'])expect(cached).toContain(p);
 await context.setOffline(true);await page.reload();await expect(page.locator('#adminShell')).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('qa-existing-data'))).toBe('must-survive');await context.setOffline(false);
});
test('staff modal: visible heading, keyboard focus containment and Escape close',async({page})=>{
 await enterPortal(page,'admin');await page.locator('.admin-bottom [data-admin-view=staff]').click();await page.locator('#staffCreateButton').click();
 const dialog=page.locator('[role=dialog]:visible');await expect(dialog).toHaveCount(1);await expect(dialog).toHaveAttribute('aria-modal','true');
 for(let i=0;i<35;i++)await page.keyboard.press('Tab');expect(await dialog.evaluate(e=>e.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
});
test('payment search, collection, durable transaction and receipt PDF',async({page})=>{
 await enterPortal(page,'payment');await roster(page);await page.reload();
 await page.locator('#payStudentSearch').fill('QA-0');await page.locator('#paySearchResults .fee-search-result').click();
 await page.locator('#payProfileCollect').click();await page.locator('#payFeeAmount').fill('800');await page.locator('#payCollectionForm button[type=submit]').click();
 await expect(page.locator('#payReceiptBackdrop')).toBeVisible();await expect(page.locator('#payReceiptBody')).toContainText('৮০০');
 const saved=await page.evaluate(async()=>{const {TRANSACTIONS_KEY}=await import('/js/finance-data.js');return JSON.parse(localStorage.getItem(TRANSACTIONS_KEY))});expect(saved.some(t=>t.studentId==='QA-0'&&t.amount===800)).toBe(true);
 const pending=page.waitForEvent('download');await page.locator('#payReceiptDownload').click();const file=await pending;expect((await fs.readFile(await file.path())).subarray(0,8).toString()).toContain('%PDF-1.');
 await page.screenshot({path:'test-results/receipt-390.png'});
 await page.locator('#payReceiptClose').click();await expect(page.locator('#payReceiptBackdrop')).toBeHidden();
});
