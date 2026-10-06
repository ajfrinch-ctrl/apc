/* First-use Admin Account — the real index.html + js/login.js in jsdom.

   The Admin Account is the INSTITUTION's one account: it is created once and
   lives in the cloud, so this suite drives the login page with a fake cloud
   boundary (tests/admin-init-cloud.mjs) and checks:

     1. a verified fresh installation opens the one-time creation screen
     2. creation stores the Admin LOCALLY and claims it in the cloud with one
        create-only claim plus the global initialization marker
     3. the User ID is generated, never typed
     4. "Rasal Russell Chowdhury" → "rasal.admin.apc"
     5. duplicates walk rasal2 / rasal3 on the first name
     6. after creation the option disappears from the login page
     7. no other page offers it (admin.html included)
     8. a direct function call cannot create a second Admin
     9. a NEW device (empty localStorage) sees Login, never "Create Admin",
        and signs in with the existing Admin credentials
    10. an unverifiable cloud never opens creation and never writes an Admin
*/
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { createAdminCloud, installAdminCloud, removeAdminCloud } from './admin-init-cloud.mjs';
import { STAFF_ACCOUNTS, createInitialAdmin, readStaffAccount, staffAccountRecordExists } from '../js/staff-auth.js';
import { KEYS, readJSON } from '../js/database.js';

const DEMO_OFF = { 'activePlus.demo.autofill.v1': 'off' };
const PASSWORD = 'Admin-2026';

let ctx;
let cloud;
let hooks;

/* One cloud for the whole file: the first device creates the Admin in it, and
   every later device is a fresh phone against that same cloud. */
before(() => {
  cloud = createAdminCloud();
  hooks = installAdminCloud(cloud);
});
after(() => { removeAdminCloud(hooks); });

/** Open index.html and run the real login module, exactly like the app boot. */
async function openLoginPage({ onLine = true, module = '../js/login.js' } = {}) {
  const page = await loadPage('index.html', { seed: { ...DEMO_OFF } });
  if (!onLine) Object.defineProperty(page.window.navigator, 'onLine', { configurable: true, value: false });
  const { initLogin } = await import(module);
  initLogin({ state: { student: null, account: null }, onAuthenticated: () => {} });
  return page;
}

/** Wait until the one-time gate has settled: opened, removed, or explained. */
const gateSettled = page => page.waitFor(() => {
  const footnote = page.$('#firstAdminFootnote');
  if (!footnote) return true;                                  // workflow gone
  if (footnote.hidden === false) return true;                   // workflow open
  return (page.$('#authMessage')?.textContent || '').length > 0; // and explained
});

const type = (selector, value) => ctx.type(ctx.$(selector), value);
const message = () => ctx.$('#authMessage')?.textContent || '';

before(async () => {
  ctx = await openLoginPage();
  await gateSettled(ctx);
  await ctx.flush();
});

test('a verified fresh installation opens the one-time Admin creation screen', () => {
  assert.equal(ctx.$('#firstAdminPanel') !== null, true, 'the creation panel exists on the first run');
  assert.equal(ctx.$('#firstAdminFootnote').hidden, false, 'the login page shows the option');
  assert.match(ctx.$('#firstAdminFootnote').textContent, /প্রথমবার ব্যবহার করছেন/);
  assert.match(ctx.$('#openFirstAdmin').textContent, /Admin Account তৈরি করুন/);
  // The cloud answered "no Admin anywhere", so creation is the screen to show.
  assert.equal(ctx.$('#firstAdminPanel').hidden, false, 'the creation screen is the open panel');
  assert.equal(ctx.$('#loginPanel').hidden, true);
});

test('the form has no username input — only a locked, generated preview', () => {
  const panel = ctx.$('#firstAdminPanel');
  assert.equal(panel.querySelector('input[name="username"]'), null, 'the id cannot be typed');
  assert.equal(panel.querySelector('#firstAdminUsername'), null);
  const preview = panel.querySelector('#firstAdminIdPreview');
  assert.ok(preview, 'the live preview exists');
  assert.notEqual(preview.tagName, 'INPUT', 'the preview is not an editable field');
  // The rest of the required fields are there.
  for (const id of ['#firstAdminName', '#firstAdminMobile', '#firstAdminEmail', '#firstAdminPassword', '#firstAdminConfirm']) {
    assert.ok(panel.querySelector(id), `${id} is missing`);
  }
  // Passwords can be revealed like everywhere else in the app.
  assert.ok(panel.querySelector('[data-toggle-pin="firstAdminPassword"]'));
});

test('typing a full name previews the generated User ID live', () => {
  type('#firstAdminName', 'Rasal Russell Chowdhury');
  assert.equal(ctx.$('#firstAdminIdPreview').textContent, 'rasal.admin.apc');

  type('#firstAdminName', 'Karim Ahmed');
  assert.equal(ctx.$('#firstAdminIdPreview').textContent, 'karim.admin.apc');

  type('#firstAdminName', 'Md. Hasan Ali');
  assert.equal(ctx.$('#firstAdminIdPreview').textContent, 'hasan.admin.apc', 'honorifics are skipped');

  type('#firstAdminName', 'Abdullah Al Mamun');
  assert.equal(ctx.$('#firstAdminIdPreview').textContent, 'abdullah.admin.apc');

  type('#firstAdminName', '');
  assert.equal(ctx.$('#firstAdminIdPreview').textContent, '—');
});

test('creating the first Admin stores it here and claims it in the cloud', async () => {
  type('#firstAdminName', 'Rasal Russell Chowdhury');
  type('#firstAdminMobile', '01711222333');
  type('#firstAdminEmail', 'rasal@example.com');
  type('#firstAdminPassword', PASSWORD);
  type('#firstAdminConfirm', PASSWORD);
  assert.equal(ctx.$('#firstAdminIdPreview').textContent, 'rasal.admin.apc');

  ctx.submit(ctx.$('#firstAdminForm'));
  await ctx.waitFor(() => ctx.$('#firstAdminPanel') === null, 20000);
  await ctx.waitFor(async () => Boolean(await readStaffAccount('admin')));
  await ctx.flush();

  const account = await readStaffAccount('admin');
  assert.equal(account.username, 'rasal.admin.apc');
  assert.equal(account.fullName, 'Rasal Russell Chowdhury');
  assert.equal(account.mobile, '01711222333');
  assert.equal(account.email, 'rasal@example.com');
  assert.equal(account.role, 'admin');
  // The password is a hash, never the plaintext.
  assert.equal(JSON.stringify(account).includes(PASSWORD), false);
  assert.equal(typeof account.password, 'object');

  // The cloud holds the institution's Admin account and the global marker.
  assert.equal(cloud.claims, 1, 'exactly one create-only claim');
  assert.equal(cloud.record.username, 'rasal.admin.apc');
  assert.equal(typeof cloud.record.password, 'object', 'only the PBKDF2 hash travels');
  assert.equal(JSON.stringify(cloud.record).includes(PASSWORD), false);
  assert.equal(cloud.flag, true, 'adminInitialized was set with the account');

  // 6 + 12: the option is gone for good, and the id is handed to the login form.
  assert.equal(ctx.$('#firstAdminPanel'), null, 'the panel is removed, not hidden');
  assert.equal(ctx.$('#firstAdminFootnote'), null);
  assert.equal(ctx.$('#openFirstAdmin'), null);
  assert.equal(ctx.$('#loginMobile').value, 'rasal.admin.apc');
  assert.match(message(), /rasal\.admin\.apc/);
});

test('the generated ID signs in as Admin', async () => {
  // The login page is still on screen after creation — and the option is gone.
  assert.equal(ctx.$('#firstAdminPanel'), null);
  assert.equal(ctx.$('#firstAdminFootnote'), null);
  ctx.type(ctx.$('#loginMobile'), 'rasal.admin.apc');
  ctx.type(ctx.$('#loginPin'), PASSWORD);
  ctx.submit(ctx.$('#loginForm'));
  await ctx.waitFor(() => ctx.jsdomErrors.some(error => /navigation/i.test(error)) || /এডমিন প্যানেল/.test(message()), 20000);
  assert.match(message(), /এডমিন প্যানেল/);
  assert.equal(ctx.window.localStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey) !== null, true);
});

test('a direct function call cannot create a second first Admin', async () => {
  assert.equal(await staffAccountRecordExists('admin'), true);
  const second = await createInitialAdmin({
    fullName: 'Second Owner',
    mobile: '01899887766',
    email: '',
    password: 'Another-2026',
    confirmPassword: 'Another-2026'
  });
  assert.equal(second.ok, false, 'the data layer refuses while one Admin exists');
  assert.equal(second.code, 'ADMIN_EXISTS');
  assert.match(second.error, /PLEASE LOGIN WITH EXISTING ADMIN ACCOUNT/);
  assert.equal(cloud.claims, 1, 'no second claim was even attempted');
  // Even a username smuggled in is ignored: the id is always generated.
  const smuggled = await createInitialAdmin({
    fullName: 'Third Owner', mobile: '01899887755', username: 'hacker.admin.apc',
    password: 'Another-2026', confirmPassword: 'Another-2026'
  });
  assert.equal(smuggled.ok, false);
  const account = await readStaffAccount('admin');
  assert.equal(account.username, 'rasal.admin.apc', 'the first Admin is untouched');
});

test('duplicate names walk rasal2 → rasal3 on the first name', async () => {
  // The generator is shared, so the staff roles follow the same numbering.
  const { generateLoginId } = await import('../js/user-id.js');
  const taken = ['rasal.admin.apc', 'karim.manager.apc', 'tanvir.cash.apc'];
  assert.equal(generateLoginId({ fullName: 'Rasal Ahmed', role: 'admin', taken }), 'rasal2.admin.apc');
  assert.equal(generateLoginId({ fullName: 'Rasal Karim', role: 'admin', taken: [...taken, 'rasal2.admin.apc'] }), 'rasal3.admin.apc');
  assert.equal(generateLoginId({ fullName: 'Karim Hasan', role: 'manager', taken }), 'karim2.manager.apc');
  assert.equal(generateLoginId({ fullName: 'Tanvir Rahman', role: 'cash-counter', taken }), 'tanvir2.cash.apc');
  // Forbidden shapes are never produced.
  const all = [
    generateLoginId({ fullName: 'Rasal Ahmed', role: 'admin', taken }),
    generateLoginId({ fullName: 'Tanvir Rahman', role: 'cash-counter', taken })
  ];
  for (const id of all) {
    assert.doesNotMatch(id, /(admin|manager|teacher|cash)\d/);
    assert.doesNotMatch(id, /apc\d/);
    assert.ok(id.endsWith('.apc'));
  }
});

test('the Admin portal also refuses to offer the workflow', async () => {
  const panel = await loadPage('admin.html', { seed: { ...DEMO_OFF } });
  await import('../js/admin.js?no-admin');
  // No creation form anywhere in the page.
  assert.equal(panel.$('#initialAdminSetup'), null);
  assert.equal(panel.$('#initialAdminForm'), null);
  assert.equal(panel.$('form input[name="username"][id*="initial"]'), null);
  /* With no Admin session stored the panel never opens: it locks in place and
     keeps the shared login page — the only place first use is handled — as a
     button, without navigating there on its own. */
  await panel.waitFor(() => Boolean(panel.$('#apcPanelLock')));
  assert.equal(panel.$('#adminShell').hidden, true, 'the Admin panel must stay closed');
  assert.equal(panel.jsdomErrors.some(error => /navigation/i.test(error)), false, 'no automatic hand-off');
  panel.window.close();
});

/* ---- a NEW device: empty localStorage, the Admin already in the cloud ------ */

test('a new device is shown the Login screen — never "Create Admin Account"', async () => {
  const device = await openLoginPage({ module: '../js/login.js?device-b' });
  await gateSettled(device);
  await device.flush();

  assert.equal(device.window.localStorage.getItem(STAFF_ACCOUNTS.admin.accountKey), null, 'nothing is stored on this device');
  assert.equal(device.$('#firstAdminPanel'), null, 'the creation panel is removed');
  assert.equal(device.$('#firstAdminFootnote'), null, 'and so is its trigger');
  assert.equal(device.$('#openFirstAdmin'), null);
  assert.equal(device.$('#loginPanel').hidden, false, 'the login screen is what remains');
  assert.equal(device.$('#firstAdminIdPreview'), null);

  // Acceptance 4: the existing Admin credentials sign in on this device, and
  // the device ends up with its own copy plus a session — nothing is overwritten.
  device.type(device.$('#loginMobile'), cloud.record.username);
  device.type(device.$('#loginPin'), PASSWORD);
  device.submit(device.$('#loginForm'));
  await device.waitFor(() => device.window.localStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey) !== null
    || (device.$('#authMessage')?.textContent || '').length > 0, 20000);
  await device.flush();
  assert.equal(device.window.localStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey) !== null, true, 'device B signs in');
  assert.equal(cloud.record.username, 'rasal.admin.apc', 'the cloud Admin is untouched');
  assert.equal(cloud.claims, 1, 'and no new Admin was created');
  device.window.close();
});

/* ---- no verified answer: creation stays closed ----------------------------- */

test('an unverifiable cloud never opens creation and never writes an Admin', async () => {
  const device = await openLoginPage({ onLine: false, module: '../js/login.js?offline' });
  await gateSettled(device);
  await device.flush();

  assert.equal(device.$('#firstAdminFootnote').hidden, true, 'the option stays closed');
  assert.match(device.$('#authMessage').textContent, /ইন্টারনেট/);
  assert.equal(device.$('#loginMobile').value, '', 'nothing is prefilled');
  assert.equal(device.window.localStorage.getItem(STAFF_ACCOUNTS.admin.accountKey), null);

  const refused = await createInitialAdmin({
    fullName: 'Offline Owner', mobile: '01711222333', email: '',
    password: PASSWORD, confirmPassword: PASSWORD
  });
  assert.equal(refused.ok, false, 'offline creation is refused');
  assert.equal(refused.code, 'CLOUD_UNVERIFIED');
  assert.equal(await staffAccountRecordExists('admin'), false, 'nothing was stored on this device');
  assert.equal(readJSON(KEYS.usernames, null), null, 'and no Login User ID was claimed');
  device.window.close();
});
