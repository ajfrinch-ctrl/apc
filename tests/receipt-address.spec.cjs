/* Real canvas/PDF/PNG output, not just a receipt HTML snapshot. The text spy
   delegates to the native canvas method, so Bengali shaping/images still run. */
const { test, expect } = require('./fixtures.cjs');
test.use({ serviceWorkers:'block' });
const ADDRESS = 'কলেজ রোড, দিনাজপুর সদর';
const TAGLINE = 'শিখতে থাকো, এগিয়ে যাও';
const TX = { id:'RECEIPT-ADDRESS-TEST', receiptNo:'SAMPLE-ADDRESS', date:'১ অক্টোবর ২০২৬', studentName:'নমুনা শিক্ষার্থী', studentId:'DEMO-0001', className:'দশম শ্রেণি', feeType:'মাসিক বেতন', month:'অক্টোবর ২০২৬', method:'নগদ', amount:800, note:'পরীক্ষার নমুনা—প্রকৃত লেনদেন নয়', collectedBy:'নমুনা কাউন্টার' };

for (const variant of ['combined-tagline','address-only','copied-address']) test(`receipt address appears once in preview, PDF and PNG (${variant})`, async ({ page }, info) => {
  await page.goto('/demo/offline-roles.html');
  const config = { tagline: variant === 'address-only' ? ADDRESS : variant === 'combined-tagline' ? `${TAGLINE} • ${ADDRESS}` : TAGLINE,
    campusAddress: variant === 'copied-address' ? `${ADDRESS}\n${ADDRESS}` : ADDRESS };
  await page.evaluate(async ({ config, tx }) => {
    const { STORAGE_KEYS } = await import('/js/config.js');
    localStorage.setItem(STORAGE_KEYS.appConfig, JSON.stringify(config));
    const { receiptMarkup } = await import('/js/finance-receipt.js');
    document.body.insertAdjacentHTML('beforeend', receiptMarkup(tx));
    window.__receiptDraws = [];
    const native = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      const metrics = this.measureText(String(args[0]));
      window.__receiptDraws.push({ text:String(args[0]), y:args[2], font:this.font, top:args[2]-metrics.actualBoundingBoxAscent, bottom:args[2]+metrics.actualBoundingBoxDescent });
      return native.apply(this, args);
    };
  }, { config, tx:TX });
  await expect(page.locator('.receipt-address')).toHaveText(ADDRESS);
  await expect(page.locator('.receipt-sub')).toHaveText(TAGLINE);
  expect(await page.locator('.receipt-header').evaluate((el, address) => el.textContent.split(address).length - 1, ADDRESS)).toBe(1);
  const ready = page.waitForEvent('download');
  await page.evaluate(async tx => {
    const { downloadReceipt } = await import('/js/finance-receipt.js');
    await downloadReceipt(tx);
  }, TX);
  const download = await ready;
  expect(download.suggestedFilename()).toBe('SAMPLE-ADDRESS.pdf');
  await download.saveAs(info.outputPath('receipt-address-once.pdf'));
  const bytes = require('fs').readFileSync(await download.path()).toString('latin1');
  expect(bytes.startsWith('%PDF-1.4')).toBe(true);
  expect(bytes).toContain('/Count 1');
  expect((bytes.match(/\/Receipt Do/g) || []).length).toBe(1);
  expect((bytes.match(/\/Subtype \/Image/g) || []).length).toBe(1);
  expect(await page.evaluate(address => window.__receiptDraws.filter(draw => draw.text.includes(address)).length, ADDRESS)).toBe(1);
  expect(await page.evaluate(address => {
    const line = window.__receiptDraws.find(draw => draw.text === address);
    const title = window.__receiptDraws.find(draw => draw.text === 'পেমেন্ট স্টেটমেন্ট');
    return title.top >= line.bottom + 4;
  }, ADDRESS)).toBe(true);
  const png = await page.evaluate(async tx => {
    window.__receiptDraws.length = 0;
    const { createReceiptPNG } = await import('/js/finance-receipt.js');
    const blob = await createReceiptPNG(tx);
    return { bytes:Array.from(new Uint8Array(await blob.arrayBuffer())), draws:window.__receiptDraws };
  }, TX);
  expect(png.bytes.slice(0,8)).toEqual([137,80,78,71,13,10,26,10]);
  expect(png.draws.filter(draw => draw.text.includes(ADDRESS))).toHaveLength(1);
  const saved = await page.evaluate(async () => {
    const { STORAGE_KEYS } = await import('/js/config.js');
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.appConfig));
  });
  expect(saved).toEqual(config);
});
