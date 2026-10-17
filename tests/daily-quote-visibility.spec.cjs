const {test,expect}=require('./fixtures.cjs');
const {enterStudentApp}=require('./portal-session.cjs');
test.use({serviceWorkers:'block',reducedMotion:'reduce'});
for(const width of [320,390,1024])test(`daily advice hero visible ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});await enterStudentApp(page);
 const hero=page.locator('#homeView [data-home-hero]');
 await expect(hero).toBeVisible();await hero.scrollIntoViewIfNeeded();await expect(hero).toBeInViewport();
 await expect(hero).toHaveAttribute('role','region');
 await expect(hero).toHaveAttribute('aria-label','আজকের তথ্য');
 await expect(page.locator('#dailyQuoteCard')).toBeHidden();
 const layout=await page.evaluate(()=>({
  pageFits:document.documentElement.scrollWidth<=innerWidth,
  heroFits:(()=>{const r=document.querySelector('#homeView [data-home-hero]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1})(),
  firstContentBeforeToday:document.querySelector('#homeView [data-home-hero]').compareDocumentPosition(document.querySelector('#homeView .dashboard-today-section'))&Node.DOCUMENT_POSITION_FOLLOWING
 }));
 expect(layout.pageFits).toBe(true);expect(layout.heroFits).toBe(true);expect(layout.firstContentBeforeToday).toBeTruthy();
 await page.screenshot({path:`/tmp/daily-advice-${width}.png`});
});
