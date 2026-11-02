/* UI sweep (manual tool, not part of `npm test`) — one page per process (the jsdom harness owns the globals).
   Boots the page through its real entry module, then walks EVERY view: it
   activates each footer-nav view and exercises every visible interactive
   control in it (click buttons/links, toggle checkboxes, type into fields,
   change selects). Per control it records:
     wired   — something visibly changed (DOM, value, hash)
     quiet   — no visible effect (reported for review; may be intentional)
     skipped — destructive-looking (delete/reset/logout/backup…), never clicked
     ERROR   — an uncaught script error appeared while interacting
   Usage: node tests/ui-sweep.mjs <page> <mode>   modes: guest|student, or a staff role */
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession, STAFF_TEST_PASSWORD } from './staff-harness.mjs';

const [page = 'index.html', mode = 'guest'] = process.argv.slice(2);
const DESTRUCTIVE = /মুছ|মুছে|ডিলিট|delete|রিসেট|reset|নিষ্ক্রিয়|disable|লগআউট|logout|ব্যাকআপ|backup|রিস্টোর|restore|clear|প্রত্যাখ্যান|reject|বন্ধ করুন|থামান|unregister|রিমুভ|remove|বাতিল|সেশন শেষ/i;

const ctx = await loadPage(page, { seed: { 'activePlus.demo.autofill.v1': 'off' } });
// The sweep must never touch the live Firebase project: every fetch fails fast,
// exactly like a device with no connectivity (the app is built for that).
const offlineFetch = async () => { throw new Error('offline (ui sweep)'); };
ctx.window.fetch = offlineFetch;
globalThis.fetch = offlineFetch;
const { window, document, $, $$, click, type, submit } = ctx;
const settle = async () => { await ctx.flush(2); await new Promise(resolve => setTimeout(resolve, 4)); };

/* The bell is mounted by the sync entry on every page; load it here so the
   sweep tests the real notice centre instead of a dead button. */
async function mountNoticeCentre() {
  try {
    const { initNotifications } = await import('../js/notifications.js');
    await initNotifications();
  } catch (error) {
    console.error('[sweep] notifications failed to mount:', error?.message);
  }
}

async function boot() {
  if (page === 'index.html' && mode === 'guest') {
    await import('../js/main.js');           // shows the login screen
    await settle();
    return;
  }
  if (page === 'index.html' && mode === 'student') {
    const { hashPassword } = await import('../js/password-hash.js');
    const pinHash = await hashPassword('246810');
    window.localStorage.setItem('active-plus-account-v1', JSON.stringify({
      mobile: '01700000000', registrationMobile: '01700000000', username: 'raisa.islam', pinHash,
      status: 'active', student: { id: 'AP-1024', name: 'রাইসা আক্তার', className: 'দশম শ্রেণি', group: 'A' }
    }));
    const { buildSessionRecord } = await import('../js/session.js');
    window.localStorage.setItem('active-plus-session-v1', JSON.stringify(buildSessionRecord({ owner: 'raisa.islam' })));
    await import('../js/main.js');            // restores the session, opens the student app
    await ctx.waitFor(() => $('#appShell') && $('#appShell').hidden === false);
    await settle();
    return;
  }
  await mountNoticeCentre();
  await provisionStaff(mode, STAFF_TEST_PASSWORD);
  seedStaffSession(window, mode);
  const panelModule = { 'admin.html': 'admin.js', 'manager.html': 'manager.js', 'teacher.html': 'teacher.js', 'payment.html': 'payment.js' }[page];
  if (panelModule) await import(`../js/${panelModule}`);
  await import('../js/theme-entry.js');   // the page's theme-toggle script
  await settle();
}
await boot();
await settle();

/* An async event handler that throws rejects a promise nobody awaits: Node
   would kill the process. For a UI sweep that IS the finding, so it is
   captured and attributed to the control that caused it. */
const rejections = [];
process.on('unhandledRejection', reason => {
  rejections.push(String((reason && reason.message) || reason));
});

const mutations = { count: 0 };
const observer = new window.MutationObserver(list => { mutations.count += list.length; });
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });

/* The app hides inactive views with CSS (`.admin-view{display:none}` plus an
   `.active` class), which jsdom does not compute from stylesheets — so the
   same rule is applied here: inside a view/panel container that is not the
   active one, nothing is visible. */
const VIEW_CONTAINERS = '.view, .admin-view, .manager-view, .teacher-view, .payment-view, .auth-panel, [data-view-panel]';
const inInactiveView = el => {
  const container = el.closest(VIEW_CONTAINERS);
  return Boolean(container) && !container.classList.contains('active');
};

const visible = el => {
  if (el.closest('[hidden]')) return false;
  if (el.hidden) return false;
  if (inInactiveView(el)) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
};

const labelOf = el => {
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34);
  const id = el.id ? '#' + el.id : '';
  const name = el.getAttribute('name') ? `[name=${el.getAttribute('name')}]` : '';
  const kind = el.tagName.toLowerCase() + (el.type ? `:${el.type}` : '');
  return `${kind}${id}${name}${text ? ` “${text}”` : ''}`;
};

async function closeOverlays() {
  const dialog = $$('.modal, [role="dialog"], .staff-pw-backdrop').find(visible);
  if (dialog) {
    const closers = Array.from(dialog.querySelectorAll('[data-close], .modal-close'));
    if (closers.length) click(closers[0]);
    else window.document.dispatchEvent(new window.Event('keydown', { key: 'Escape', bubbles: true }));
    await settle();
  }
  $$('[data-close], .modal-close').filter(visible).forEach(el => click(el));
  await settle();
}

async function sweep(viewName) {
  const report = [];
  const controls = $$('button, [role="button"], a[href], input, select, textarea').filter(visible);
  for (const control of controls) {
    const before = {
      errors: ctx.jsdomErrors.length, rejections: rejections.length, mutations: mutations.count,
      value: control.value, checked: control.checked, hash: window.location.hash
    };
    const label = labelOf(control);
    const destructive = DESTRUCTIVE.test(control.textContent || '') || DESTRUCTIVE.test(control.getAttribute('aria-label') || '');
    if (destructive) { report.push({ view: viewName, control: label, verdict: 'skipped' }); continue; }
    try {
      if (control.tagName === 'INPUT' && ['checkbox', 'radio'].includes(control.type)) {
        // dispatchEvent does not run a checkbox's default action in jsdom, so
        // the user's outcome is applied directly and then announced.
        control.checked = !control.checked;
        control.dispatchEvent(new window.Event('change', { bubbles: true }));
      }
      else if (control.tagName === 'INPUT' && ['text', 'search', 'number', 'tel', 'password', 'date', 'time', 'email'].includes(control.type)) {
        type(control, control.type === 'number' ? '10' : ['password', 'email'].includes(control.type) ? 'Abc-1234@example.com' : 'পরীক্ষা');
      } else if (control.tagName === 'TEXTAREA') type(control, 'পরীক্ষা');
      else if (control.tagName === 'SELECT') {
        const options = Array.from(control.options).filter(option => !option.disabled && option.value !== '');
        const target = options.find(option => option.value !== control.value) || options[0];
        if (!target) { report.push({ view: viewName, control: label, verdict: 'quiet', note: 'no option' }); continue; }
        control.value = target.value;
        control.dispatchEvent(new window.Event('change', { bubbles: true }));
      } else {
        click(control);
        // A submit button in a real browser also submits its form.
        if (control.type === 'submit' && control.form) submit(control.form);
      }
    } catch (error) {
      report.push({ view: viewName, control: label, verdict: 'ERROR', note: 'threw: ' + error.message });
      continue;
    }
    await settle();
    const changed = mutations.count !== before.mutations
      || control.value !== before.value
      || control.checked !== before.checked
      || window.location.hash !== before.hash;
    await new Promise(resolve => setTimeout(resolve, 20));   // let a rejected handler surface
    const errors = [...ctx.jsdomErrors.slice(before.errors), ...rejections.slice(before.rejections).map(reason => 'rejected: ' + reason)];
    const quietDetail = changed ? undefined
      : `value ${JSON.stringify(String(before.value).slice(0, 12))}→${JSON.stringify(String(control.value).slice(0, 12))}`
        + ` checked ${before.checked}→${control.checked}`
        + (control.disabled ? ' disabled' : '') + (control.readOnly ? ' readonly' : '');
    report.push({
      view: viewName, control: label,
      verdict: errors.length ? 'ERROR' : changed ? 'wired' : 'quiet',
      note: errors.length ? errors.join(' | ').slice(0, 180) : quietDetail
    });
    await closeOverlays();
  }
  return report;
}

const NAV = {
  'admin.html': 'data-panel-view', 'manager.html': 'data-panel-view',
  'teacher.html': 'data-panel-view', 'index.html': 'data-view'
}[page];

const report = [];
const views = [];
const navButtons = NAV ? $$(`[${NAV}]`).filter(visible) : [];
if (navButtons.length) {
  for (const button of navButtons) {
    const name = button.getAttribute(NAV);
    if (views.includes(name)) continue;
    views.push(name);
    click(button);
    await settle();
    report.push(...await sweep(name));
  }
} else {
  views.push('default');
  report.push(...await sweep('default'));
}

const topbar = $$('.app-topbar').map(bar => ({
  visible: visible(bar),
  logo: Boolean(bar.querySelector('.app-brand-logo')),
  slogan: Boolean(bar.querySelector('.app-brand-slogan')),
  bell: Boolean(bar.querySelector('#notificationButton')),
  logout: Boolean(bar.querySelector('#studentLogout, #adminExitButton, #managerLogout, #teacherExit, #payExitButton'))
}));

console.log(JSON.stringify({
  summary: {
    page, mode, views,
    controls: report.length,
    wired: report.filter(item => item.verdict === 'wired').length,
    quiet: report.filter(item => item.verdict === 'quiet').length,
    skipped: report.filter(item => item.verdict === 'skipped').length,
    errors: report.filter(item => item.verdict === 'ERROR').length,
    jsdomErrors: ctx.jsdomErrors
  },
  topbar,
  report: report.filter(item => item.verdict !== 'wired')
}, null, 1));
// The app keeps retry timers alive on purpose; the sweep is done.
process.exit(0);
