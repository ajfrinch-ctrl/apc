const {test,expect}=require('./fixtures.cjs');
const {enterStudentApp}=require('./portal-session.cjs');
test.use({serviceWorkers:'block',reducedMotion:'reduce'});
for(const width of [320,390,1024])test(`Student Home Hero carousel is visible and unclipped at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await enterStudentApp(page);
 const card=page.locator('#homeView .student-home-hero');
 await expect(card).toBeVisible();await card.scrollIntoViewIfNeeded();await expect(card).toBeInViewport();
 await expect(card).toHaveAttribute('role','region');
 await expect(card).toHaveAttribute('aria-roledescription','carousel');
 await expect(card.locator('[data-hero-slide]')).toHaveCount(4);
 const hiddenQuoteText = page.locator('[data-daily-quote-text]');
 await expect(hiddenQuoteText).not.toContainText('তৈরি হচ্ছে');
 await expect(card.locator('[data-student-daily-quote-text]')).toHaveText((await hiddenQuoteText.textContent()).trim());
 const dateKey = await card.locator('[data-home-hero-date]').getAttribute('datetime');
 const [year, month, day] = dateKey.split('-').map(Number);
 const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
 const ids = ['own-pace', 'daily-goal', 'joy-of-learning', 'daily-tip'];
 const todayIndex = ((dayNumber % ids.length) + ids.length) % ids.length;
 const expectedId = ids[todayIndex];
 const expectedSlide = await page.evaluate(async id => {
  const { STUDENT_HOME_HERO_SLIDES } = await import('/js/student-home-hero-entry.js');
  return STUDENT_HOME_HERO_SLIDES.find(slide => slide.id === id);
 }, expectedId);
 await expect(card.locator(`[data-hero-id="${expectedId}"]`)).toHaveClass(/is-active/);
 await expect(card.locator('[data-hero-slide].is-active [data-hero-title]')).toHaveText(expectedSlide.title);
 const description = await card.locator('[data-hero-slide].is-active [data-hero-description]').textContent();
 expect(expectedSlide.messages).toContain(description.trim());
 await expect(card.locator('.hero-slider__controls button')).toHaveCount(2);
 await expect(card.locator('.hero-slider__indicators [data-hero-dot]')).toHaveCount(4);
 for (const id of ids) {
  await expect(card.locator(`[data-hero-id="${id}"] img`)).toHaveAttribute('loading', id === expectedId ? 'eager' : 'lazy');
 }
 await expect(page.locator('#homeView #dailyQuoteCard')).toBeHidden();
 await expect(page.locator('[data-daily-quote-date]')).not.toContainText('লোড হচ্ছে');
 await expect(page.locator('[data-daily-quote-text]')).not.toContainText('তৈরি হচ্ছে');
 const layout=await page.evaluate(()=>({
  pageFits:document.documentElement.scrollWidth<=innerWidth,
  cardFits:(()=>{const r=document.querySelector('#homeView .student-home-hero').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1})(),
  cardHeight:document.querySelector('#homeView .student-home-hero').getBoundingClientRect().height,
  imageFit:getComputedStyle(document.querySelector('#homeView .student-home-hero img')).objectFit,
  order:(()=>{
   const selectors=['.student-home-welcome','.student-home-hero','#dailyQuoteCard','.dashboard-today-section','.pay-hero.pay-hero-summary','#studentServices','.bottom-nav'];
   const nodes=selectors.map(selector=>document.querySelector('#homeView '+selector) || document.querySelector(selector));
   return nodes.every((node,index)=>node&&(index===nodes.length-1||Boolean(node.compareDocumentPosition(nodes[index+1])&Node.DOCUMENT_POSITION_FOLLOWING)));
  })(),
  metrics:document.querySelectorAll('#homeRealStatsRow > div').length,
  shortcuts:document.querySelectorAll('#studentServices .pay-tile').length,
  tabs:document.querySelectorAll('.bottom-nav .bottom-link').length
 }));
 expect(layout.pageFits).toBe(true);expect(layout.cardFits).toBe(true);expect(layout.cardHeight).toBeGreaterThan(230);expect(layout.cardHeight).toBeLessThanOrEqual(350);
 expect(layout.imageFit).toBe('contain');expect(layout.order).toBeTruthy();
 expect(layout.metrics).toBe(2);expect(layout.shortcuts).toBe(7);expect(layout.tabs).toBe(5);
 await page.screenshot({path:`/tmp/student-hero-${width}.png`});
});
