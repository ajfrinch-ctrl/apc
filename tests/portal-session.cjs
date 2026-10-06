/* Shared sign-in for the browser specs.

   Every staff portal used to carry a login form of its own. Signing in now
   happens once, on the shared card in index.html, and a panel opens from the
   device-bound session that sign-in wrote. The specs care about the panel, not
   about re-testing the login form, so they sign in the way a first real
   sign-in does — through the app's own storage layer — and then load the
   panel. That keeps the specs honest (the same code path a user goes through)
   without duplicating the credential UI fifteen times. */

const E2E_PASSWORD = 'Apc-E2E-2026';

const ROLE_USERNAMES = Object.freeze({
  admin: 'admin.apc',
  manager: 'manager.apc',
  teacher: 'teacher.apc',
  payment: 'payment.apc',
  cash: 'payment.apc'
});

/** Provision the role's password and write a valid device-bound session. */
async function seed(page, role, password = E2E_PASSWORD) {
  await page.evaluate(async ({ role, password }) => {
    const auth = await import('/js/staff-auth.js');
    let provisioned = false;
    if (role === 'admin') {
      /* The first Admin is created once for the institution, in the cloud
         (js/admin-initialization.js). On a machine that can reach it — and that
         has never initialized this project — the real workflow runs. In the
         offline E2E sandbox there is no Firebase, so the fixture falls back to
         provisioning the reserved role account straight through the storage
         layer, exactly like tests/legacy-login.spec.cjs does. Nothing here can
         weaken the app: creation stays closed for an unverified device. */
      const created = await auth.createInitialAdmin({
        fullName: 'E2E Owner', mobile: '01700000000', email: '',
        password, confirmPassword: password
      });
      if (!created.ok && created.code !== 'CLOUD_UNVERIFIED' && created.code !== 'ADMIN_EXISTS') {
        throw new Error(`first admin: ${created.error}`);
      }
      provisioned = created.ok;
    }
    if (!provisioned) await auth.provisionStaffAccount(role, password, password);
    const session = await auth.saveStaffSession(role, true);
    if (!session) throw new Error(`no session for ${role}`);
  }, { role, password });
}

/** Sign a role in and land on its panel, signed in. */
async function enterPortal(page, role, panel = role) {
  const target = {
    admin: 'admin.html', manager: 'manager.html',
    teacher: 'teacher.html', payment: 'payment.html'
  }[panel];
  if (!target) throw new Error(`unknown portal: ${panel}`);
  // Seed on a page of the same origin that is not the panel, so the panel's own
  // boot check cannot race the provisioning.
  await page.goto('/offline-roles.html');
  await seed(page, role);
  await page.goto(`/${target}`);
  await page.waitForLoadState('networkidle');
  return page;
}

/** Sign a student in on the shared card and open the student app. */
async function enterStudentApp(page, { id = 'AP-1024', name = 'রাইসা', className = 'দশম শ্রেণি' } = {}) {
  const account = {
    mobile: '01700000000',
    registrationMobile: '01700000000',
    username: 'raisa.islam',
    pin: '246810',
    status: 'active',
    student: { id, name, className }
  };
  await page.addInitScript(key => {
    localStorage.setItem(key, localStorage.getItem(key));
  }, ACCOUNT_KEY);
  await page.goto('/index.html');
  await page.evaluate(async ({ key, account }) => {
    localStorage.setItem(key, JSON.stringify(account));
  }, { key: ACCOUNT_KEY, account });
  await page.reload();
  await page.fill('#loginMobile', account.username);
  await page.fill('#loginPin', account.pin);
  await page.click('#loginForm button[type=submit]');
  await page.waitForLoadState('networkidle');
  return page;
}

const ACCOUNT_KEY = 'active-plus-account-v1';

/* ---------- two devices ----------

   The app keeps one panel per device: whichever staff session was written last
   owns that browser profile, and index.html sends the device to that panel. Two
   roles therefore cannot share one browser context in a spec — each role needs
   its own device (context), exactly like two people with two phones. Data moves
   between devices the way it does in production: the shared collections are
   copied over, which is what the synced collections carry. */

/** A second device: its own storage, same viewport/timezone as the spec. */
async function newDevice(context, { viewport, timezoneId } = {}) {
  const browser = context.browser();
  const fresh = await browser.newContext({
    viewport: viewport || context._options?.viewport || { width: 390, height: 844 },
    timezoneId: timezoneId || context._options?.timezoneId || 'UTC',
    baseURL: context._options?.baseURL || 'http://127.0.0.1:8000'
  });
  fresh.__apcDevice = true;
  return fresh;
}

/** Copy the shared collections from one device to another (a sync). */
async function syncStorage(fromPage, toPage, keys) {
  if (!Array.isArray(keys) || !keys.length) throw new Error('syncStorage needs the storage keys to move');
  const payload = await fromPage.evaluate(keys => {
    const out = {};
    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (value !== null) out[key] = value;
    }
    return out;
  }, keys);
  await toPage.evaluate(payload => {
    for (const [key, value] of Object.entries(payload)) localStorage.setItem(key, value);
  }, payload);
  return Object.keys(payload).length;
}

module.exports = { enterPortal, enterStudentApp, seed, newDevice, syncStorage, E2E_PASSWORD, ROLE_USERNAMES };