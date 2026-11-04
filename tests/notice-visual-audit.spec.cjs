const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const links=(fs.readFileSync('student.html','utf8').match(/<link\b[^>]*rel="stylesheet"[^>]*>/g)||[]).join('');
for(const theme of ['light','dark']) for(const width of [320,390,1024]) {
 test(`notice visual audit ${theme} ${width}`,async({page})=>{
  await page.setViewportSize({width,height:760});
  await page.route('**/notice-audit.html',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html data-theme="${theme}"><head>${links}</head><body><button id="notificationButton">Bell</button></body></html>`}));
  await page.goto('/notice-audit.html');
  await page.evaluate(async()=>{
   const {mountNoticeCenter}=await import('/js/notice-center.js');
   let items=Array.from({length:20},(_,i)=>({key:`approved:${i}`,kind:'approved',actionable:true,title:'রেজিস্ট্রেশন অনুমোদিত হয়েছে',body:'অভিনন্দন! এখন অ্যাপের সব ফিচার ব্যবহার করতে পারবেন।',at:Date.now()}));
   const read=new Set(); window.auditOpened=0;
   window.auditCenter=mountNoticeCenter({feed:()=>items,unreadKeys:()=>items.filter(x=>!read.has(x.key)).map(x=>x.key),records:()=>items.map(x=>({...x,read:read.has(x.key)})),markRead:keys=>{keys.forEach(k=>read.add(k));return true;},clear:()=>{items=[];},openItem:()=>{window.auditOpened++;}});
   window.auditCenter.open();
  });
  const modal=page.locator('#apcNoticeModal');
  const sheet=modal.locator('.modal');
  await expect(sheet).toBeVisible();
  const metrics=await sheet.evaluate(el=>{const s=getComputedStyle(el);const list=el.querySelector('[data-apc-notice-list]');return {width:el.getBoundingClientRect().width,bottom:el.getBoundingClientRect().bottom,radius:s.borderTopLeftRadius,bg:s.backgroundColor,overflow:list.scrollHeight>list.clientHeight,shadow:s.boxShadow};});
  if(width<=600){
   expect(metrics.width).toBe(width);expect(metrics.bottom).toBe(760);expect(metrics.radius).toBe('20px');
  }else{
   expect(metrics.width).toBe(380);expect(metrics.bottom).toBeLessThanOrEqual(760);expect(metrics.radius).toBe('16px');
   const box=await sheet.boundingBox(), bell=await page.locator('#notificationButton').boundingBox();
   expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
   expect(box.y).toBeGreaterThanOrEqual(bell.y+bell.height);
  }
  expect(metrics.overflow).toBe(true);
  const contrast=await modal.locator('.notice-action').first().evaluate(el=>{
   const style=getComputedStyle(el);
   const lum=color=>{const v=color.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
   const a=lum(style.color),b=lum(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await expect(modal.locator('.apc-fb-header')).toBeVisible();
  const icon=modal.locator('.apc-fb-avatar svg').first();
  await expect(icon).toBeVisible();
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(icon).toHaveCSS('animation-name','none');
  const clear=modal.locator('[data-apc-notice-clear]');
  expect((await clear.boundingBox()).height).toBeGreaterThanOrEqual(48);
  await expect(modal.locator('[data-apc-notice-status]')).toBeVisible();
  await modal.locator('[data-apc-notice-filter="all"]').click();
  await expect(modal.locator('[data-apc-notice-filter="all"]')).toHaveAttribute('aria-selected','true');
  await modal.locator('[data-apc-notice-filter="unread"]').click();
  await modal.locator('.notice-action').first().click();expect(await page.evaluate(()=>window.auditOpened)).toBe(1);
  await page.evaluate(()=>window.auditCenter.open());
  await modal.locator('[data-apc-notice-read-all]').click();
  await expect(modal.locator('[data-apc-notice-read-all]')).toBeHidden();
  await modal.locator('[data-apc-notice-filter="unread"]').click();
  await expect(modal.locator('.notice-empty')).toBeVisible();
  await modal.locator('[data-apc-notice-filter="all"]').click();
  await clear.click();await expect(modal.locator('.notice-detail')).toHaveCount(0);
  await modal.locator('[data-apc-notice-close]').click();await expect(modal).toBeHidden();
  await page.evaluate(()=>window.auditCenter.open());await page.keyboard.press('Escape');await expect(modal).toBeHidden();
 });
}
