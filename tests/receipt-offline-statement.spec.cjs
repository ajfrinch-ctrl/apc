/* Real PWA cache + real fonts/canvas/Blob downloads. No PDF or application
   APIs are mocked. Data is synthetic and confined to disposable test contexts. */
const { test, expect } = require('./fixtures.cjs');
const { seed } = require('./portal-session.cjs');
const fs = require('fs');
test.use({ serviceWorkers: 'allow', reducedMotion: 'reduce' });

const ADDRESS = 'কলেজ রোড, দিনাজপুর সদর';
const TX = {
  id: 'SAMPLE-OFFLINE', receiptNo: 'SAMPLE-OFFLINE', date: '২ অক্টোবর ২০২৬',
  studentName: 'নমুনা শিক্ষার্থী', studentId: 'DEMO-0001', className: 'দশম শ্রেণি',
  feeType: 'মাসিক বেতন', month: 'অক্টোবর ২০২৬', method: 'নগদ', trxRef: 'SAMPLE-REF',
  amount: 800, status: 'approved', collectedBy: 'নমুনা কাউন্টার',
  note: 'পরীক্ষার নমুনা — এটি প্রকৃত লেনদেন নয়'
};

async function readyOfflineShell(page, context) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  expect(await page.evaluate(async () => {
    const cache = await caches.open('active-plus-student-v150-minimal-education');
    return Boolean(await cache.match('./js/finance-receipt.js'))
      && Boolean(await cache.match('./assets/fonts/NotoSansBengali-Variable.ttf'));
  })).toBe(true);
  // Prove generation is not depending on a primed browser HTTP cache or on a
  // previous receipt. CacheStorage (the installed PWA) deliberately remains.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.detach();
  await context.setOffline(true);
  await page.reload();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
}

async function instrument(page) {
  await page.evaluate(async () => {
    // Import while ALREADY offline; the worker must supply this module graph.
    window.__offlineReceipt = await import('/js/finance-receipt.js');
    await document.fonts.ready;
    window.__statement = { texts: [], fills: [], images: 0, borders: 0, sources: [], fetches: [] };
    const NativeFont = FontFace;
    window.FontFace = class extends NativeFont {
      constructor(name, source, options) {
        super(name, source, options);
        window.__statement.sources.push({ name, binary: source instanceof ArrayBuffer });
      }
    };
    const nativeText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      const metric = this.measureText(String(args[0]));
      window.__statement.texts.push({ text: String(args[0]), color: this.fillStyle, y: args[2], top: args[2] - metric.actualBoundingBoxAscent, bottom: args[2] + metric.actualBoundingBoxDescent });
      return nativeText.apply(this, args);
    };
    for (const [name, key] of [['drawImage','images'], ['strokeRect','borders']]) {
      const native = CanvasRenderingContext2D.prototype[name];
      CanvasRenderingContext2D.prototype[name] = function (...args) {
        window.__statement[key]++;
        return native.apply(this, args);
      };
    }
    const nativeFill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      window.__statement.fills.push({ color: this.fillStyle, rect: args });
      return nativeFill.apply(this, args);
    };
    window.fetch = (...args) => {
      window.__statement.fetches.push(String(args[0]));
      return Promise.reject(new Error('Network fetch forbidden in offline PDF test'));
    };
  });
}

async function verifyDocument(page, download, status, info) {
  await download.saveAs(info.outputPath('monochrome-offline-statement.pdf'));
  const bytes = fs.readFileSync(await download.path());
  const pdf = bytes.toString('latin1');
  expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  expect(pdf).toContain('/Count 1');
  expect((pdf.match(/\/Subtype \/Image/g) || []).length).toBe(1);
  expect((pdf.match(/\/Receipt Do/g) || []).length).toBe(1);
  const draws = await page.evaluate(() => window.__statement);
  expect(draws.sources).toEqual([{ name: 'ReceiptBangla', binary: true }]);
  expect(draws.fetches).toEqual([]);
  expect(draws.images).toBe(0);
  expect(draws.borders).toBe(0);
  expect(draws.fills).toHaveLength(1);
  expect(draws.fills[0].color).toBe('#ffffff');
  expect(draws.texts.every(draw => draw.color === '#000000')).toBe(true);
  expect(draws.texts.filter(draw => draw.text.includes(ADDRESS))).toHaveLength(1);
  expect(draws.texts.map(draw => draw.text)).toContain('পেমেন্ট স্টেটমেন্ট');
  expect(draws.texts.map(draw => draw.text)).toContain(`অবস্থা: ${status}`);
  expect(draws.texts.some(draw => /ড্যাশবোর্ড|ক্যাশ ব্যালেন্স|শিখতে থাকো/.test(draw.text))).toBe(false);
  if (status !== 'পরিশোধিত') expect(draws.texts.some(draw => draw.text.includes('পরিশোধিত'))).toBe(false);
  const address = draws.texts.find(draw => draw.text === ADDRESS);
  const title = draws.texts.find(draw => draw.text === 'পেমেন্ট স্টেটমেন্ট');
  expect(title.top).toBeGreaterThanOrEqual(address.bottom + 4);
  // Inspect the actual JPEG embedded in the downloaded PDF, not a separately
  // drawn HTML preview. Every pixel must be grayscale, with mostly white paper.
  const start = bytes.indexOf('4 0 obj\n');
  const stream = bytes.indexOf('stream\n', start) + 7;
  const length = Number(bytes.subarray(start, stream).toString('latin1').match(/\/Length (\d+)/)[1]);
  const jpeg = Array.from(bytes.subarray(stream, stream + length));
  const image = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0, ink = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.max(pixels[i], pixels[i+1], pixels[i+2]) - Math.min(pixels[i], pixels[i+1], pixels[i+2]) > 1) colored++;
      if (pixels[i] < 220) ink++;
    }
    const result = { colored, inkFraction: ink / (canvas.width * canvas.height) };
    bitmap.close(); canvas.width = canvas.height = 0;
    return result;
  }, jpeg);
  expect(image.colored).toBe(0);
  expect(image.inkFraction).toBeGreaterThan(0.005);
  expect(image.inkFraction).toBeLessThan(0.12);
}

test('first PDF and PNG after an offline PWA reload are plain monochrome statements with one address', async ({ page, context }, info) => {
  await page.goto('/index.html');
  await expect(page.locator('#loginForm')).toHaveAttribute('data-login-ready', 'true');
  const config = {
    // A comma-only legacy tagline and inline copied address were not handled
    // by the previous slogan-specific cleanup. The statement has no slogan.
    tagline: `শিখতে থাকো, এগিয়ে যাও, ${ADDRESS}`,
    campusAddress: `${ADDRESS} • ${ADDRESS}`
  };
  await page.evaluate(async ({ config, tx }) => {
    const { STORAGE_KEYS } = await import('/js/config.js');
    const { KEYS } = await import('/js/database.js');
    localStorage.setItem(STORAGE_KEYS.appConfig, JSON.stringify(config));
    localStorage.setItem(KEYS.transactions, JSON.stringify([tx]));
  }, { config, tx: TX });
  await readyOfflineShell(page, context);
  await expect(page.locator('#loginForm')).toHaveAttribute('data-login-ready', 'true');
  expect(await page.evaluate(() => [...document.fonts].filter(font => font.family === 'ReceiptBangla').length)).toBe(0);
  await instrument(page);
  const waiting = page.waitForEvent('download');
  await page.evaluate(tx => window.__offlineReceipt.downloadReceipt(tx), TX);
  const download = await waiting;
  expect(download.suggestedFilename()).toBe('SAMPLE-OFFLINE.pdf');
  await verifyDocument(page, download, 'পরিশোধিত', info);
  const png = await page.evaluate(async tx => {
    window.__statement.texts.length = 0;
    const blob = await window.__offlineReceipt.createReceiptPNG(tx);
    return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), texts: window.__statement.texts };
  }, TX);
  expect(png.bytes.slice(0,8)).toEqual([137,80,78,71,13,10,26,10]);
  expect(png.texts.filter(draw => draw.text === ADDRESS)).toHaveLength(1);
  expect(png.texts.every(draw => draw.color === '#000000')).toBe(true);
  const saved = await page.evaluate(async () => {
    const { STORAGE_KEYS } = await import('/js/config.js');
    const { KEYS } = await import('/js/database.js');
    return { config: JSON.parse(localStorage.getItem(STORAGE_KEYS.appConfig)), tx: JSON.parse(localStorage.getItem(KEYS.transactions)) };
  });
  expect(saved).toEqual({ config, tx: [TX] });
});

test('the real counter saves a pending payment and downloads its simple statement completely offline', async ({ page, context }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => localStorage.setItem('active-plus-appearance-v2', 'dark'));
  await page.goto('/offline-roles.html');
  await seed(page, 'payment');
  await page.evaluate(async address => {
    const { adminStudents } = await import('/js/admin-data.js');
    const { KEYS } = await import('/js/database.js');
    localStorage.setItem(KEYS.students, JSON.stringify(adminStudents));
    localStorage.setItem(KEYS.transactions, JSON.stringify([]));
    localStorage.setItem(KEYS.settings, JSON.stringify({ tagline: address, campusAddress: address }));
  }, ADDRESS);
  await page.goto('/payment.html');
  await expect(page.locator('#payShell')).toBeVisible();
  await readyOfflineShell(page, context);
  await expect(page.locator('#payShell')).toBeVisible();
  await page.locator('#payStudentSearch').fill('AP-1024');
  await page.locator('#paySearchResults .fee-search-result').click();
  await expect(page.locator('#payProfileCollect')).toBeEnabled();
  await page.locator('#payProfileCollect').click();
  await expect(page.locator('#payCollectionForm')).toBeVisible();
  await page.locator('#payFeeAmount').fill('800');
  await page.locator('#paySaveButton').click();
  await expect(page.locator('#payReceiptBackdrop')).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem('activePlus.admin.transactions.v1'));
  expect(JSON.parse(before)).toHaveLength(1);
  expect(JSON.parse(before)[0]).toMatchObject({ amount: 800, status: 'pending' });
  await instrument(page);
  const waiting = page.waitForEvent('download');
  await page.locator('#payReceiptDownload').click();
  await verifyDocument(page, await waiting, 'অনুমোদন বাকি', info);
  await expect(page.locator('#payReceiptDownload')).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('activePlus.admin.transactions.v1'))).toBe(before);
  await expect(page.locator('#payTodayList')).toContainText('অনুমোদন বাকি');
  // The day list shows the entry; nothing in the counter claims it as collected
  // money yet, and the counter owns no approved-total tile at all.
  await expect(page.locator('#payTodayAmount, #payTodayCount, [data-pay-total]')).toHaveCount(0);
});
