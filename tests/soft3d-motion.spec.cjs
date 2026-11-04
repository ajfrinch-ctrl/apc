const {test,expect}=require('./fixtures.cjs');
const {enterStudentApp}=require('./portal-session.cjs');
test.use({serviceWorkers:'block'});
for(const reducedMotion of ['no-preference','reduce'])test(`soft3d motion ${reducedMotion}`,async({page})=>{
 await page.emulateMedia({reducedMotion});await page.setViewportSize({width:390,height:844});await enterStudentApp(page);
 const icons=page.locator('#studentServices svg[data-icon-set="active-plus-soft3d"]');
 await expect(icons).toHaveCount(7);
 for (const icon of await icons.all()) await expect(icon).toHaveCSS('animation-name',reducedMotion==='reduce'?'none':'apc-soft3d-idle');
 if(reducedMotion==='no-preference'){
  const delays=await icons.evaluateAll(items=>items.map(el=>getComputedStyle(el).animationDelay));
  expect(new Set(delays).size).toBe(7);
  expect(delays).toEqual(['0s','-0.36s','-0.72s','-1.08s','-1.44s','-1.8s','-2.16s']);
 }
 await page.locator('#studentServices [data-view="exams"]').click();await expect(page.locator('#examsView')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
