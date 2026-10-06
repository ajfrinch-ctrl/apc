const {test,expect}=require('./fixtures.cjs');
const {enterPortal}=require('./portal-session.cjs');
test.use({serviceWorkers:'block'});
for(const width of [320,390,1280]) for(const role of ['login','admin','manager','teacher','payment','student']) {
 test(`${role} redesigned at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:844});
  if(role==='login') await page.goto('/index.html');
  else if(role==='student') {
   await page.goto('/offline-roles.html');
   await page.evaluate(async()=>{
    const s=await import('/js/storage.js');
    await s.persistAccount({username:'review.student',mobile:'01700000000',pin:'123456',status:'active',student:{id:'REVIEW-1',name:'রায়হান আহমেদ',className:'অষ্টম শ্রেণি'}});
    await s.persistSession(true);
   });
   await page.goto('/index.html');
  } else await enterPortal(page,role);
  await expect(page.locator(role==='login'?'#loginForm':role==='student'?'#appShell':role==='payment'?'#payShell':`#${role}Shell`)).toBeVisible();
  await expect(page.locator('.launch-screen')).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(role==='payment') {
   const bounds=await page.locator('#payShell').boundingBox();
   expect(bounds.width).toBe(width);
   expect(bounds.x).toBe(0);
  }
  await page.screenshot({path:info.outputPath('screen.png')});
  const nav=page.locator('.admin-bottom:visible button,.bottom-nav:visible button');
  for(let i=0;i<await nav.count();i++) {
   await nav.nth(i).click();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
 });
}

// Traverse the secondary screens too, not just the default dashboards.
for (const role of ['admin','manager','teacher']) test(`${role} secondary screens at 390 dark`, async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 await enterPortal(page,role);
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 const views = role==='admin' ? ['staff','students','reports','roles','data','backup','security','settings','profile']
   : role==='manager' ? ['students','academic','classes','teachers','finance','cash-counter','notices','routine','exams','results','reports','profile']
   : ['students','classes','routine-view','homework','online-exams','suggestion','reports','profile'];
 for(const view of views) {
  if(role==='teacher'||role==='manager') await page.evaluate(({view,role})=>document.querySelector(`[data-${role}-view="${view}"]`).click(),{view,role});
  else await page.evaluate(view=>location.hash=view,view);
  await page.waitForTimeout(75);
  const visible=role==='teacher'?page.locator('.teacher-view:visible'):page.locator(`.${role==='admin'?'admin':'manager'}-view.active`);
  await expect(visible).toBeVisible();
  if(role!=='teacher') await expect(visible).toHaveAttribute('data-view-panel',view);
  const bad=await visible.evaluate(el=>[...el.querySelectorAll('input,select,textarea,button')].filter(x=>{
   const strip=x.closest('.chip-row');
   if(strip && /^(auto|scroll)$/.test(getComputedStyle(strip).overflowX)) return false;
   const r=x.getBoundingClientRect();return r.width>0&&(r.left < -1||r.right>innerWidth+1);
  }).map(el=>el.id||el.className));
  expect(bad,view).toEqual([]);
  await page.screenshot({path:info.outputPath(view+'.png')});
 }
 if(role==='admin') {
  await page.evaluate(()=>location.hash='staff');
  await page.locator('#staffCreateButton').click();
  const dialog=page.locator('#staffModalBody');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('staff-form.png')});
  await page.keyboard.press('Escape');
 }
});

test('registration uses readable full-width fields on mobile',async({page},info)=>{
 await page.setViewportSize({width:320,height:740});
 await page.goto('/index.html');
 await expect(page.locator('#loginForm')).toHaveAttribute('data-login-ready','true');
 await expect(page.locator('.launch-screen')).toHaveCount(0);
 await page.locator('[data-auth-tab="register"]').click();
 await expect(page.locator('#registrationForm')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const sizes=await page.locator('#registrationForm input:visible').evaluateAll(elements=>elements.map(el=>({width:el.getBoundingClientRect().width,font:parseFloat(getComputedStyle(el).fontSize)})));
 // Step 1 asks for the student's name (Bangla + English) as well as the
 // mobile number, Login User ID and the two password boxes.
 expect(sizes.length).toBe(6);
 expect(sizes.every(s=>s.width>=20&&s.font>=16)).toBe(true);
 await expect(page.locator('.launch-screen')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('register.png')});
 await page.locator('#regMobile').fill('01700000000');
 await page.locator('#regUsername').fill('review.student');
 await page.locator('#regPin').fill('123456');
 await page.locator('#regPinConfirm').fill('123456');
 await page.locator('[data-registration-step="1"] [data-next-step]').click();
 await expect(page.locator('#nameBn')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('register-personal.png')});
});

test('notice dialog and manager menu remain accessible on a narrow screen',async({page},info)=>{
 await page.setViewportSize({width:320,height:740});
 await enterPortal(page,'manager');
 await page.locator('.manager-bottom [data-manager-view="more"]').click();
 // "আরও" is a real page now: it must fit a 320px screen with no sideways
 // scroll, and a row opens its module in the same view.
 const menu=page.locator('#managerMoreMenu');
 await expect(menu).toBeVisible();
 const box=await menu.boundingBox();
 expect(box.x).toBeGreaterThanOrEqual(0);
 expect(box.x+box.width).toBeLessThanOrEqual(320);
 expect(await menu.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await menu.locator('[data-manager-view="profile"]').click();
 await expect(page.locator('[data-view-panel="profile"]')).toBeVisible();
 await page.locator('.notification-button').click();
 const dialog=page.locator('[role="dialog"]:visible');
 await expect(dialog).toBeVisible();
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('notifications.png')});
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
});
