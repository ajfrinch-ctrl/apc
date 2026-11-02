const {test,expect}=require('./fixtures.cjs');
const {enterPortal}=require('./portal-session.cjs');
test.use({serviceWorkers:'block'});

test('wide print media retains the original paper grids instead of the phone shell',async({page})=>{
 await page.setViewportSize({width:1280,height:900});
 await enterPortal(page,'admin');
 const screenShell=await page.locator('#adminShell').boundingBox();
 expect(screenShell.width).toBe(430);
 await page.emulateMedia({media:'print'});
  const printed=await page.evaluate(()=>({
  shell:document.querySelector('#adminShell').getBoundingClientRect().width,
  homeStats:document.querySelectorAll('.admin-view[data-view-panel="dashboard"] .admin-stat-tile').length,
  portals:document.querySelectorAll('.admin-view[data-view-panel="dashboard"] .admin-portal-grid > a').length,
  features:getComputedStyle(document.querySelector('#adminFeatureGrid')).gridTemplateColumns.split(' ').length,
  nav:getComputedStyle(document.querySelector('#adminShell > .admin-bottom')).display
 }));
 expect(printed.shell).toBeGreaterThan(1200);
 expect(printed.homeStats).toBe(0);
 expect(printed.portals).toBe(3);
 expect(printed.features).toBe(3);
 expect(printed.nav).toBe('none');
});
for(const width of [320,390,1280]) for(const role of ['login','admin','manager','teacher','payment','student']) {
 test(`${role} redesigned at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:844});
  if(role==='login') await page.goto('/index.html');
  else if(role==='student') {
   await page.goto('/demo/offline-roles.html');
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
  const phoneWidth=Math.min(width,430);
  const shellSelector=role==='login'?'#authScreen':role==='student'?'#appShell':role==='payment'?'#payShell':`#${role}Shell`;
  const shellBounds=await page.locator(shellSelector).boundingBox();
  expect(shellBounds.width).toBe(phoneWidth);
  expect(shellBounds.x).toBe((width-phoneWidth)/2);
  if(role!=='login') {
   await page.evaluate(()=>document.documentElement.dataset.theme='light');
   const lightChrome=await page.evaluate(()=>({
    top:getComputedStyle(document.querySelector('.app-topbar')).backgroundColor,
    topText:getComputedStyle(document.querySelector('.app-topbar')).color,
    bottom:getComputedStyle(document.querySelector('.bottom-nav,.admin-bottom'),'::before').backgroundColor
   }));
   expect(lightChrome.top).toBe('rgb(14, 122, 85)');
   expect(lightChrome.topText).toBe('rgb(255, 255, 255)');
   expect(lightChrome.bottom).not.toBe('rgb(255, 255, 255)');
   expect(lightChrome.bottom).not.toBe('rgba(0, 0, 0, 0)');
   if(role==='manager') {
    const home=await page.evaluate(()=>{
     const panel=document.querySelector('.manager-view[data-view-panel="dashboard"]');
     const intro=panel.querySelector('.manager-home-intro');
     const summary=panel.querySelector('.manager-home-summary');
     return {
      heroCards:panel.querySelectorAll('.hero-slider, .admin-hero').length,
      introVisible:!!intro && getComputedStyle(intro).display==='flex',
      headingColor:getComputedStyle(intro.querySelector('h1')).color,
      summaryBackground:getComputedStyle(summary).backgroundColor,
      tileBackgrounds:[...summary.querySelectorAll('.manager-kpi-grid > .admin-stat-tile')].map(el=>getComputedStyle(el).backgroundColor)
     };
    });
    expect(home.heroCards).toBe(0);
    expect(home.introVisible).toBe(true);
    expect(home.headingColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(home.summaryBackground).toBe('rgba(0, 0, 0, 0)');
    expect(home.tileBackgrounds).toHaveLength(3);
    expect(home.tileBackgrounds.every(color=>color!=='rgba(0, 0, 0, 0)')).toBe(true);
   }
   if(role==='student') {
    await expect(page.locator('#homeView .student-home-hero')).toBeVisible();
    await expect(page.locator('#dailyQuoteCard')).toBeHidden();
    const home=await page.evaluate(()=>{
     const identity=document.querySelector('#homeView .student-home-welcome');
     const advice=document.querySelector('#dailyQuoteCard');
     const hero=document.querySelector('#homeView .student-home-hero');
     const active=hero.querySelector('.hero-slide.is-active');
     const card=document.querySelector('#homeView .study-progress-card');
     const stats=[...card.querySelectorAll('#homeRealStatsRow > div')];
     return {
      adviceDisplay:getComputedStyle(advice).display,
      heroDisplay:getComputedStyle(hero).display,
      heroRadius:getComputedStyle(hero).borderRadius,
      heroTitle:active.querySelector('[data-hero-title]').textContent.trim(),
      heroSlides:hero.querySelectorAll('[data-hero-slide]').length,
      quote:advice.querySelector('[data-daily-quote-text]').textContent.trim(),
      adviceDate:advice.querySelector('[data-daily-quote-date]').textContent.trim(),
      adviceSummary:advice.querySelector('[data-daily-advice-summary]').textContent.trim(),
      name:getComputedStyle(identity.querySelector('.pay-hero-name')).color,
      title:getComputedStyle(card.querySelector('#homeTitle')).color,
      titleSize:parseFloat(getComputedStyle(card.querySelector('#homeTitle')).fontSize),
      subtitle:getComputedStyle(card.querySelector('.study-progress-subtitle')).color,
      metricLabels:stats.map(el=>el.querySelector('small').textContent.trim()),
      metricCount:stats.length,
      quickActions:document.querySelectorAll('#studentServices .pay-tile').length,
      tabs:document.querySelectorAll('.bottom-nav .bottom-link').length
     };
    });
    expect(home.adviceDisplay).toBe('none');
    expect(home.heroDisplay).not.toBe('none');
    expect(home.heroRadius).not.toBe('0px');
    expect(home.heroTitle.length).toBeGreaterThan(0);
    expect(home.heroSlides).toBe(4);
    expect(home.quote.length).toBeGreaterThan(10);
    expect(home.adviceDate).not.toMatch(/লোড/);
    expect(home.adviceSummary).not.toMatch(/লোড/);
    expect(home.name).toBe('rgb(23, 74, 118)');
    expect(home.title).toBe('rgb(118, 80, 27)');
    expect(home.titleSize).toBe(width <= 480 ? 14 : 19);
    expect(home.subtitle).not.toBe('rgba(0, 0, 0, 0)');
    expect(home.metricLabels).toEqual(['উপস্থিতি','গড় ফলাফল']);
    expect(home.metricCount).toBe(2);
    expect(home.quickActions).toBe(7);
    expect(home.tabs).toBe(5);
   }
   const nav=page.locator(role==='student'?'.bottom-nav':'.admin-bottom');
   const navBounds=await nav.boundingBox();
   expect(navBounds.width).toBe(phoneWidth);
   expect(navBounds.x).toBe((width-phoneWidth)/2);
   expect(await nav.evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
  }
  await page.screenshot({path:info.outputPath('screen.png')});
  const nav=page.locator('.admin-bottom:visible button,.bottom-nav:visible button');
  for(let i=0;i<await nav.count();i++) {
   await nav.nth(i).click();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  if(role!=='login') {
   await page.evaluate(()=>document.documentElement.dataset.theme='dark');
   const darkChrome=await page.evaluate(()=>({
    top:getComputedStyle(document.querySelector('.app-topbar')).backgroundColor,
    topText:getComputedStyle(document.querySelector('.app-topbar')).color,
    bottom:getComputedStyle(document.querySelector('.bottom-nav,.admin-bottom'),'::before').backgroundColor
   }));
   expect(darkChrome.top).toBe('rgb(14, 43, 31)');
   expect(darkChrome.topText).toBe('rgb(244, 246, 250)');
   expect(darkChrome.bottom).not.toBe('rgb(11, 13, 16)');
   expect(darkChrome.bottom).not.toBe('rgba(0, 0, 0, 0)');
   if(role==='manager') {
    const home=await page.evaluate(()=>{
     const panel=document.querySelector('.manager-view[data-view-panel="dashboard"]');
     const intro=panel.querySelector('.manager-home-intro');
     const summary=panel.querySelector('.manager-home-summary');
     return {
      heroCards:panel.querySelectorAll('.hero-slider, .admin-hero').length,
      introVisible:!!intro && getComputedStyle(intro).display==='flex',
      headingColor:getComputedStyle(intro.querySelector('h1')).color,
      summaryBackground:getComputedStyle(summary).backgroundColor,
      firstTile:getComputedStyle(summary.querySelector('.manager-kpi-grid > .admin-stat-tile')).backgroundColor
     };
    });
    expect(home.heroCards).toBe(0);
    expect(home.introVisible).toBe(true);
    expect(home.headingColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(home.summaryBackground).toBe('rgba(0, 0, 0, 0)');
    expect(home.firstTile).not.toBe('rgba(0, 0, 0, 0)');
   }
   if(role==='student') {
    const home=await page.evaluate(()=>{
     const identity=document.querySelector('#homeView .student-home-welcome');
     const advice=document.querySelector('#dailyQuoteCard');
     const hero=document.querySelector('#homeView .student-home-hero');
     const card=document.querySelector('#homeView .study-progress-card');
     return {
      adviceVisible:getComputedStyle(advice).display!=='none'&&!advice.hidden,
      heroVisible:getComputedStyle(hero).display!=='none',
      heroTitle:hero.querySelector('.hero-slide.is-active [data-hero-title]').textContent.trim(),
      heroSlides:hero.querySelectorAll('[data-hero-slide]').length,
      name:getComputedStyle(identity.querySelector('.pay-hero-name')).color,
      title:getComputedStyle(card.querySelector('#homeTitle')).color,
      summary:getComputedStyle(card.querySelector('.study-progress-subtitle')).color,
      metricCount:card.querySelectorAll('#homeRealStatsRow > div').length
     };
    });
    expect(home.adviceVisible).toBe(false);
    expect(home.heroVisible).toBe(true);
    expect(home.heroTitle.length).toBeGreaterThan(0);
    expect(home.heroSlides).toBe(4);
    expect(home.name).toBe('rgb(244, 246, 250)');
    expect(home.title).toBe('rgb(244, 246, 250)');
    expect(home.summary).not.toBe('rgba(0, 0, 0, 0)');
    expect(home.metricCount).toBe(2);
   }
  }
 });
}

// Traverse the secondary screens too, not just the default dashboards.
for (const role of ['admin','manager','teacher']) test(`${role} secondary screens at 390 dark`, async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 await enterPortal(page,role);
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 const views = role==='admin' ? ['staff','students','reports','roles','data','backup','security','settings','profile']
   : role==='manager' ? ['students','academic','classes','teachers','finance','cash-counter','notices','routine','exams','results','reports','profile','settings']
   : ['students','classes','routine-view','homework','online-exams','suggestion','reports','profile'];
 for(const view of views) {
  if(role==='teacher') {
   await page.evaluate(view=>document.querySelector(`[data-panel-view="${view}"]`).click(),view);
  } else if(role==='manager' && view==='cash-counter') {
   await page.evaluate(()=>{ location.hash='cash-counter'; });
  } else if(role==='manager' && view==='results') {
   await page.evaluate(()=>{
    document.querySelector('[data-panel-view="academic"]').click();
    document.querySelector('[data-academic-section="results"]').click();
   });
  } else if(role==='manager') {
   await page.evaluate(view=>document.querySelector(`[data-panel-view="${view}"]`).click(),view);
  } else await page.evaluate(view=>location.hash=view,view);
  await page.waitForTimeout(75);
  const visible=role==='teacher'?page.locator('.teacher-view:visible'):page.locator(`.${role==='admin'?'admin':'manager'}-view.active`);
  await expect(visible).toBeVisible();
  if(role!=='teacher') await expect(visible).toHaveAttribute('data-view-panel',view==='cash-counter'?'finance':view);
  if(role==='manager' && view==='cash-counter') await expect(page.locator('[data-finance-panel="approval"]')).toBeVisible();
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

test('birthday hero keeps its celebration colors and readable text',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/demo/offline-roles.html');
 await page.evaluate(async()=>{
  const storage=await import('/js/storage.js');
  await storage.persistAccount({username:'birthday.review',mobile:'01700000000',pin:'123456',status:'active',student:{id:'BIRTHDAY-1',name:'রায়হান আহমেদ',className:'অষ্টম শ্রেণি'}});
  await storage.persistSession(true);
 });
 await page.goto('/index.html');
 await expect(page.locator('#appShell')).toBeVisible();
 await page.evaluate(()=>{
  document.documentElement.dataset.theme='light';
  document.documentElement.setAttribute('data-birthday','');
 });
 const light=await page.evaluate(()=>{
  const hero=document.querySelector('#homeView .pay-hero');
  const style=getComputedStyle(hero,'::before');
  return {
   display:style.display,
   background:style.backgroundImage,
   greeting:getComputedStyle(hero.querySelector('.pay-greeting')).color,
   name:getComputedStyle(hero.querySelector('.pay-hero-name')).color,
   meta:getComputedStyle(hero.querySelector('.pay-hero-meta')).color,
   avatar:getComputedStyle(hero.querySelector('.pay-avatar')).color,
   link:getComputedStyle(hero.querySelector('.pay-hero-link')).color
  };
 });
 expect(light.display).toBe('block');
 expect(light.background).toContain('rgb(246, 193, 90)');
 for(const key of ['greeting','name','meta','avatar','link']) expect(light[key]).toBe('rgb(59, 36, 16)');
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 const dark=await page.locator('#homeView .pay-hero').evaluate(el=>({
  background:getComputedStyle(el,'::before').backgroundImage,
  name:getComputedStyle(el.querySelector('.pay-hero-name')).color
 }));
 expect(dark.background).toContain('rgb(255, 138, 122)');
 expect(dark.name).toBe('rgb(59, 36, 16)');
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
 await page.locator('.manager-bottom [data-panel-view="more"]').click();
 // "আরও" is a real page now: it must fit a 320px screen with no sideways
 // scroll, and a row opens its module in the same view.
 const menu=page.locator('#managerMoreHub');
 await expect(menu).toBeVisible();
 const box=await menu.boundingBox();
 expect(box.x).toBeGreaterThanOrEqual(0);
 expect(box.x+box.width).toBeLessThanOrEqual(320);
 expect(await menu.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await menu.locator('[data-panel-view="profile"]').click();
 await expect(page.locator('[data-view-panel="profile"]')).toBeVisible();
 await page.locator('.notification-button').click();
 const dialog=page.locator('[role="dialog"]:visible');
 await expect(dialog).toBeVisible();
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('notifications.png')});
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
});
