/* Capture the weather-driven login sky in a real browser, for visual review.

   The auth screen paints one photographic sky per weather state
   (css/ui-wallet.css §13 + assets/sky/*.jpg); this script walks the states and
   themes and drops PNGs into preview/ (untracked by design).

   Usage (needs the sandbox browser, same setup as tools/e2e-run.mjs):
     LD_LIBRARY_PATH=/tmp/apc-e2e-libs/lib CHROMIUM_EXECUTABLE=<path> \
       node tools/capture-auth-sky.cjs */
const { chromium } = require('@playwright/test');
const { mkdirSync } = require('node:fs');

const STATES = [
  ['clear-day', 'light'],
  ['clear-night', 'light'],
  ['rain', 'light'],
  ['storm', 'light'],
  ['dusk', 'dark'],
  ['cloudy', 'dark']
];

(async () => {
  mkdirSync('preview', { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote']
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  await page.goto('http://127.0.0.1:8080/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);   // let the clock/weather sky settle
  for (const [sky, theme] of STATES) {
    await page.evaluate(([s, t]) => {
      document.getElementById('authScreen').dataset.sky = s;
      document.documentElement.dataset.theme = t;
      document.documentElement.style.colorScheme = t;
    }, [sky, theme]);
    await page.waitForTimeout(700);  // the state's photograph decodes
    await page.screenshot({ path: `preview/auth-sky-${sky}-${theme}.png` });
    console.log(`✓ preview/auth-sky-${sky}-${theme}.png`);
  }
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
