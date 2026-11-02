/* Reproduce preview/wallet-140 from the real local app.
   npm ci; start the app on :8000, then node tools/capture-wallet.cjs.
   Optional: CHROMIUM_EXECUTABLE and APC_PREVIEW_URL.
   All sample records/session setup is limited to disposable browser contexts. */
const { chromium } = require('@playwright/test');
const { enterPortal } = require('../tests/portal-session.cjs');

const BASE = process.env.APC_PREVIEW_URL || 'http://127.0.0.1:8000';
const OUT = require('path').resolve(__dirname, '../preview/wallet-140');
require('fs').mkdirSync(OUT, { recursive: true });

async function launch() {
  return chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--headless=new']
  });
}

async function newPage(browser, { width = 390, height = 844, theme = 'light', dpr = 1 } = {}) {
  const ctx = await browser.newContext({
    baseURL: BASE, viewport: { width, height }, deviceScaleFactor: dpr,
    locale: 'bn-BD', timezoneId: 'Asia/Dhaka', serviceWorkers: 'block', reducedMotion: 'reduce'
  });
  await ctx.addInitScript(t => { try { localStorage.setItem('active-plus-appearance-v2', t); } catch {} }, theme);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-10-01T10:00:00Z'));
  page.on('pageerror', e => console.log('  [pageerror]', String(e.message).slice(0, 160)));
  return { ctx, page };
}

/* Office data every staff panel shows: roster, fees, notices, routine. */
async function seedOffice(page) {
  await page.evaluate(async () => {
    const admin = await import('/js/admin-data.js');
    const db = await import('/js/database.js');
    const K = db.KEYS;
    // Test fixture only: real Manager assignment schema, never seeded in production.
    localStorage.setItem('activePlus.manager.teacherAssignments.v1', JSON.stringify([
      { id: 'DESIGN-TAS-1', teacherUsername: 'teacher.apc', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ', subject: 'গণিত' }
    ]));
    const students = admin.adminStudents.map(s => ({ ...s }));
    localStorage.setItem(K.students, JSON.stringify(students));
    localStorage.setItem(K.transactions, JSON.stringify(admin.initialTransactions.map(t => ({ ...t }))));
    const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
    const routine = {};
    for (const d of ['sat', 'sun', 'mon', 'tue', 'wed', 'thu']) routine[d] = { date: '', classes: [] };
    const classes = [
      { id: 'c1', subject: 'গণিত', teacher: 'মো. সাইফুল ইসলাম', room: 'রুম ২০১', period: '১ম ক্লাস', time: '৩:০০ – ৪:০০', className: 'দশম শ্রেণি' },
      { id: 'c2', subject: 'পদার্থবিজ্ঞান', teacher: 'নাসরিন সুলতানা', room: 'রুম ২০২', period: '২য় ক্লাস', time: '৪:১৫ – ৫:১৫', className: 'দশম শ্রেণি' },
      { id: 'c3', subject: 'ইংরেজি', teacher: 'তানভীর আহমেদ', room: 'রুম ১০৫', period: '৩য় ক্লাস', time: '৫:৩০ – ৬:৩০', className: 'দশম শ্রেণি' }
    ];
    for (const d of ['sat', 'sun', 'mon', 'tue', 'wed', 'thu']) routine[d].classes = d === (day === 'fri' ? 'sat' : day) ? classes : classes.slice(0, 2);
    localStorage.setItem(K.routine, JSON.stringify(routine));
  });
}

async function seedStudentWork(page) {
  await page.evaluate(async () => {
    const demo = await import('/js/demo-data.js');
    const exams = demo.buildDemoExams();
    localStorage.setItem('activePlus.exams.v1', JSON.stringify({ version: 1, exams: exams.exams, attempts: exams.attempts }));
    const work = demo.buildDemoTeaching();
    const homework = work.find(item => item.type === 'homework');
    work.push({ ...homework, id: 'DESIGN-HW-DONE', title: 'ডেমো: আগের বাড়ির কাজ', progress: { 'AP-1024': { value: 'done', updatedAt: new Date().toISOString() } } });
    localStorage.setItem('activePlus.teaching.v1', JSON.stringify({ version: 1, activities: work }));
  });
}

async function enterStudent(page, { work = true, fee = 1500 } = {}) {
  const account = {
    mobile: '01700000000', registrationMobile: '01700000000', username: 'raisa.islam',
    pin: '246810', status: 'active',
    student: { id: 'AP-1024', name: 'রাইসা আক্তার', nameBn: 'রাইসা আক্তার', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ',
      studentMobile: '01700000000', guardianMobile: '01811111111', monthlyFee: fee }
  };
  await page.goto('/index.html');
  await seedOffice(page);
  if (work) await seedStudentWork(page);
  await page.evaluate(acc => localStorage.setItem('active-plus-account-v1', JSON.stringify(acc)), account);
  await page.reload();
  await page.waitForSelector('#loginForm[data-login-ready="true"]');
  await page.fill('#loginMobile', account.username);
  await page.fill('#loginPin', account.pin);
  await page.click('#loginForm button[type=submit]');
  await page.waitForSelector('#appShell:not([hidden])');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

async function enterStaff(page, role) {
  await page.goto('/offline-roles.html');
  await seedOffice(page);
  if (role === 'teacher' || role === 'manager' || role === 'admin') await seedStudentWork(page);
  await enterPortal(page, role);
  await page.waitForTimeout(700);
}

async function dismissAlerts(page) {
  for (let i = 0; i < 3; i++) {
    const ok = page.getByRole('button', { name: 'বুঝেছি' });
    if (await ok.count() && await ok.first().isVisible().catch(() => false)) {
      await ok.first().click().catch(() => {});
      await page.waitForTimeout(300);
    } else break;
  }
}

async function shot(page, name, { full = false } = {}) {
  await dismissAlerts(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log('saved', name);
}


const allScenes = [
  {
    "portal": "student",
    "view": "home",
    "theme": "light",
    "width": 390
  },
  {
    "portal": "student",
    "view": "home",
    "theme": "dark",
    "width": 390
  },
  {
    "portal": "admin",
    "view": "dashboard",
    "theme": "light",
    "width": 390
  },
  {
    "portal": "admin",
    "view": "dashboard",
    "theme": "dark",
    "width": 390
  },
  {
    "portal": "manager",
    "view": "dashboard",
    "theme": "light",
    "width": 390
  },
  {
    "portal": "manager",
    "view": "dashboard",
    "theme": "dark",
    "width": 390
  },
  {
    "portal": "teacher",
    "view": "home",
    "theme": "light",
    "width": 390
  },
  {
    "portal": "teacher",
    "view": "home",
    "theme": "dark",
    "width": 390
  },
  {
    "portal": "payment",
    "view": "home",
    "theme": "light",
    "width": 390
  },
  {
    "portal": "payment",
    "view": "home",
    "theme": "dark",
    "width": 390
  },
  {
    "portal": "login",
    "view": "home",
    "theme": "light",
    "width": 390
  },
  {
    "portal": "login",
    "view": "home",
    "theme": "dark",
    "width": 390
  },
  {
    "portal": "register",
    "view": "home",
    "theme": "light",
    "width": 390
  },
  {
    "portal": "login",
    "view": "recovery",
    "theme": "dark",
    "width": 320
  },
  {
    "portal": "student",
    "view": "routine",
    "theme": "light",
    "width": 320
  },
  {
    "portal": "student",
    "view": "courses",
    "theme": "dark",
    "width": 390
  },
  {
    "portal": "student",
    "view": "exams",
    "theme": "light",
    "width": 390
  },
  {
    "portal": "student",
    "view": "results",
    "theme": "dark",
    "width": 390
  },
  {
    "portal": "student",
    "view": "profile",
    "theme": "light",
    "width": 390
  },
  {
    "portal": "student",
    "view": "edit",
    "theme": "dark",
    "width": 320
  },
  {
    "portal": "admin",
    "view": "staff",
    "theme": "light",
    "width": 320
  },
  {
    "portal": "admin",
    "view": "reports",
    "theme": "dark",
    "width": 390
  },
  {
    "portal": "manager",
    "view": "finance",
    "theme": "light",
    "width": 390
  },
  {
    "portal": "teacher",
    "view": "homework",
    "theme": "dark",
    "width": 390
  },
  {
    "portal": "payment",
    "view": "collect",
    "theme": "light",
    "width": 390
  },
  {
    "portal": "payment",
    "view": "receipt",
    "theme": "dark",
    "width": 320
  },
  {
    "portal": "student",
    "view": "home",
    "theme": "light",
    "width": 1280
  },
  {
    "portal": "admin",
    "view": "dashboard",
    "theme": "light",
    "width": 1280
  },
  {
    "portal": "payment",
    "view": "home",
    "theme": "light",
    "width": 1280
  }
];
const scenes = process.env.CAPTURE_ONLY ? allScenes.filter(s => process.env.CAPTURE_ONLY.split(',').includes(`${s.portal}:${s.view}:${s.theme}:${s.width}`)) : allScenes;

async function go(page, portal, view) {
  if (portal === 'student') {
    if (view === 'home') await page.evaluate(() => { location.hash = ''; history.replaceState(null, '', location.pathname); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    else await page.evaluate(v => { location.hash = v; }, view);
  } else if (portal === 'admin') {
    await page.evaluate(v => { location.hash = v === 'dashboard' ? 'dashboard' : v; }, view);
  } else if (portal === 'manager') {
    await page.evaluate(v => document.querySelector(`[data-panel-view="${v}"]`)?.click(), view);
  } else if (portal === 'teacher') {
    await page.evaluate(v => document.querySelector(`[data-panel-view="${v}"]`)?.click(), view);
  }
  await page.waitForTimeout(450);
}

(async () => {
  const browser = await launch();
  const groups = new Map();
  for (const sc of scenes) {
    const key = `${sc.portal}|${sc.theme}|${sc.width}|${sc.tall ? 'tall' : ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sc);
  }
  try {
    for (const [key, list] of groups) {
      const { portal, theme, width, tall } = list[0];
      const { ctx, page } = await newPage(browser, { theme, width, height: tall ? 1700 : width <= 320 ? 640 : width >= 1000 ? 800 : 844 });
      try {
        if (portal === 'student') await enterStudent(page);
        else if (portal === 'login') { await page.goto('/index.html'); await page.waitForSelector('#loginForm[data-login-ready="true"]'); }
        else if (portal === 'register') { await page.goto('/index.html'); await page.waitForSelector('#loginForm[data-login-ready="true"]'); await page.click('[data-auth-tab="register"]'); await page.waitForTimeout(400); }
        else await enterStaff(page, portal);
        for (const sc of list) {
          if (!['login', 'register'].includes(portal) && sc.view !== 'home' && sc.view !== 'dashboard') await go(page, portal, sc.view);
          else if (sc.view === 'home' || sc.view === 'dashboard') { if (portal !== 'payment') await go(page, portal, sc.view === 'home' && portal === 'manager' ? 'dashboard' : sc.view === 'home' && portal === 'teacher' ? 'home' : sc.view); }
          if (portal === 'student' && sc.view === 'edit') {
            await go(page, 'student', 'profile');
            await dismissAlerts(page);
            await page.click('#profileView [data-action="edit-profile"]');
            await page.waitForSelector('#editModal:not([hidden])');
          }
          if (portal === 'login' && sc.view === 'recovery') {
            await page.click('#forgotPinButton');
            await page.waitForSelector('#recoveryModal:not([hidden])');
          }
          if (portal === 'payment' && ['collect','receipt'].includes(sc.view)) {
            await dismissAlerts(page);
            await page.fill('#payStudentSearch', 'AP-1024');
            await page.click('#paySearchResults .fee-search-result');
            await page.waitForFunction(() => !document.querySelector('#payProfileCollect').disabled);
            await page.click('[data-pay-section="collect"]');
            if (sc.view === 'receipt') {
              await page.fill('#payFeeAmount', '800');
              await page.click('#paySaveButton');
              await page.waitForSelector('#payReceiptBackdrop:not([hidden])');
              // Let the real transient success message expire normally.
              await page.waitForSelector('#payToast', { state: 'hidden' });
            }
          }
          const name = `${sc.portal}-${sc.view}-${sc.theme}-${sc.width}`;
          await shot(page, name, { full: sc.full });
        }
      } catch (e) { throw new Error('Capture failed: ' + key + ' ' + e.message); }
      await ctx.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL', e.stack?.slice(0, 800)); process.exit(1); });
