/* Panel lockdown — no panel can reach another panel.
 *
 * The Admin panel used to be able to open the Payment counter, and any panel
 * jumped to index.html on its own when its session was missing. Both routes are
 * gone: js/panel-lockdown.js refuses a click / form post / window.open that
 * points at a *different* panel page, the shared login page is the only door
 * between panels, and a panel with no session of its own now locks in place
 * instead of leaving the page.
 *
 * These tests drive the real pages and the real modules in jsdom, so a future
 * edit that quietly re-opens a cross-panel route fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { STAFF_ACCOUNTS, activeStaffRoles, clearStaffSession, hasStaffSession, saveStaffSession } from '../js/staff-auth.js';
import { openStaffPanel, provisionStaff, seedStaffSession } from './staff-harness.mjs';

const DEMO_OFF = { 'activePlus.demo.autofill.v1': 'off' };
const PANEL_SHELLS = Object.freeze({
  'admin.html': ['../js/admin.js', '#adminShell'],
  'manager.html': ['../js/manager.js', '#managerShell'],
  'teacher.html': ['../js/teacher.js', '#teacherShell'],
  'payment.html': ['../js/payment.js', '#payShell']
});
const navigationErrors = ctx => ctx.jsdomErrors.filter(error => /navigation/i.test(error));

/* ---------- The rule itself ------------------------------------------------- */

test('a foreign panel is recognised in every link shape', async () => {
  const { PANEL_PAGES, panelFileOf } = await import('../js/panel-lockdown.js');
  assert.deepEqual(PANEL_PAGES, ['admin.html', 'manager.html', 'teacher.html', 'payment.html']);
  assert.equal(panelFileOf('./manager.html', 'admin.html'), 'manager.html');
  assert.equal(panelFileOf('/teacher.html?v=1#top', 'admin.html'), 'teacher.html');
  assert.equal(panelFileOf('payment.html', 'admin.html'), 'payment.html');
  assert.equal(panelFileOf('./admin.html', 'admin.html'), '', 'its own page is not foreign');
  assert.equal(panelFileOf('/admin.html', 'admin.html'), '');
  assert.equal(panelFileOf('index.html', 'admin.html'), '', 'the shared login page is the one door');
  assert.equal(panelFileOf('#finance', 'admin.html'), '');
  assert.equal(panelFileOf('https://wa.me/8801700000000', 'admin.html'), '');
  assert.equal(panelFileOf('https://example.com/manager.html', 'admin.html'), '', 'another origin owns that page');
  assert.equal(panelFileOf('', 'admin.html'), '');
});

test('a click or window.open into another panel is refused', async () => {
  const ctx = await loadPage('admin.html', { seed: DEMO_OFF });
  const { installPanelGuard } = await import('../js/panel-lockdown.js');
  const blocked = [];
  const guard = installPanelGuard({ own: 'admin.html', notify: file => blocked.push(file) });

  const link = ctx.document.createElement('a');
  link.href = './manager.html';
  link.textContent = 'ম্যানেজার প্যানেল';
  ctx.document.body.append(link);
  ctx.click(link);
  assert.deepEqual(blocked, ['manager.html'], 'the click was refused');
  assert.deepEqual(navigationErrors(ctx), [], 'and nothing navigated');

  assert.equal(ctx.window.open('./teacher.html', '_blank'), null, 'window.open is refused too');
  assert.deepEqual(blocked, ['manager.html', 'teacher.html']);

  // Its own page is not a cross-panel route, and neither is an external link.
  const own = ctx.document.createElement('a');
  own.href = './admin.html';
  ctx.click(own);
  ctx.window.open('https://wa.me/8801700000000', '_blank');
  assert.deepEqual(blocked, ['manager.html', 'teacher.html'], 'only another panel is refused');
  guard.uninstall();
});

test('the lock card explains the rule and offers only the shared login page', async () => {
  const ctx = await loadPage('admin.html', { seed: DEMO_OFF });
  const { showPanelLock } = await import('../js/panel-lockdown.js');
  ctx.$('#adminShell').hidden = false;

  const card = showPanelLock({ role: 'admin.html', signedIn: ['manager.html'] });
  assert.equal(ctx.$('#apcPanelLock'), card);
  assert.equal(ctx.$('#adminShell').hidden, true, 'the panel content is hidden behind the card');
  assert.match(card.textContent, /এক প্যানেল থেকে অন্য প্যানেলে নয়/);
  assert.match(card.textContent, /ম্যানেজার প্যানেল লগইন করা আছে/);
  assert.equal(card.querySelectorAll('a[href]').length, 0, 'the card never links anywhere');
  assert.deepEqual([...card.querySelectorAll('button')].map(button => button.id), ['apcPanelLockLogin', 'apcPanelLockRetry']);
  assert.equal(showPanelLock({ role: 'admin.html' }), card, 'a second call reuses the same card');

  assert.deepEqual(navigationErrors(ctx), []);
  ctx.click(ctx.$('#apcPanelLockLogin'));
  // jsdom reports the attempt without naming the page; the button's own target
  // is asserted in the isolation test (js/panel-lockdown.js holds LOGIN_PAGE).
  assert.equal(navigationErrors(ctx).length, 1, 'the one exit is the shared login page, and only a tap opens it');
});

/* ---------- Every panel, really shut --------------------------------------- */

for (const [file, [script, shellId]] of Object.entries(PANEL_SHELLS)) {
  test(`${file} locks in place with no session — it never leaves the page`, async () => {
    const ctx = await loadPage(file, { seed: DEMO_OFF });
    await import(`${script}?lockdown=${file}`);
    await ctx.waitFor(() => Boolean(ctx.$('#apcPanelLock')));
    assert.equal(ctx.$(shellId).hidden, true, 'the panel stays shut');
    if (file === 'manager.html') {
      assert.equal(ctx.$('#managerBootScreen'), null, 'a rejected Manager session reveals its existing in-place lock instead of leaving the loader up');
      assert.equal(ctx.$('#managerBootLink'), null, 'the boot-only login fallback is removed after the lock is ready');
    }
    assert.deepEqual(navigationErrors(ctx), [], 'no automatic hand-off to another page');
    assert.equal(ctx.$('#apcPanelLock').querySelectorAll('a[href]').length, 0);
  });
}

test('a device signed in as another role cannot open this panel', async () => {
  const ctx = await loadPage('admin.html', { seed: DEMO_OFF });
  await provisionStaff('manager');
  seedStaffSession(ctx.window, 'manager');
  await import('../js/admin.js?lockdown=wrong-role');
  await ctx.waitFor(() => Boolean(ctx.$('#apcPanelLock')));
  await ctx.waitFor(() => /ম্যানেজার প্যানেল লগইন করা আছে/.test(ctx.$('#apcPanelLock').textContent));
  assert.equal(ctx.$('#adminShell').hidden, true, 'the Admin panel does not open for a Manager session');
  assert.deepEqual(navigationErrors(ctx), []);
});

/* ---------- One device, one panel ------------------------------------------ */

test('signing a panel in on this device ends the other panels here', async () => {
  const ctx = await loadPage('admin.html', { seed: DEMO_OFF });
  await provisionStaff('admin');
  await provisionStaff('manager');

  assert.equal(await saveStaffSession('admin', true), true);
  assert.equal(await hasStaffSession('admin'), true);
  assert.deepEqual(await activeStaffRoles(), ['admin']);

  assert.equal(await saveStaffSession('manager', true), true);
  assert.equal(await hasStaffSession('manager'), true);
  assert.equal(await hasStaffSession('admin'), false, 'the Admin session ended when the Manager signed in here');
  assert.equal(ctx.window.localStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey), null);
  assert.equal(ctx.window.sessionStorage.getItem(STAFF_ACCOUNTS.admin.sessionKey), null);
  assert.deepEqual(await activeStaffRoles(), ['manager']);

  clearStaffSession('manager');
  assert.deepEqual(await activeStaffRoles(), []);
  ctx.window.close();
});

/* ---------- The panel's own guard ------------------------------------------- */

/* Runs last on purpose: the panel keeps loading data after its shell appears,
   and this is the only test that leaves a running panel behind. The `ready`
   wait holds until that first load has painted, so nothing of the manager's is
   still in flight when the file's other pages are opened. */
test('a panel installs the guard itself, so a later link cannot leave either', async () => {
  const ctx = await loadPage('manager.html', { seed: DEMO_OFF });
  await openStaffPanel(ctx, 'manager', {
    importPanel: () => import('../js/manager.js?lockdown=guard'),
    shellId: 'managerShell',
    ready: () => /^[০-৯]+$/.test(ctx.$('#mgrTotalStudents')?.textContent || '')
  });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(ctx.$('#managerShell').hidden, false, 'the Manager panel is open');

  const link = ctx.document.createElement('a');
  link.href = './admin.html';
  ctx.document.body.append(link);
  ctx.click(link);
  assert.deepEqual(navigationErrors(ctx), [], 'the panel guard cancelled the jump');
  await ctx.waitFor(() => Boolean(ctx.$('#apcPanelGuardNotice')));
  assert.match(ctx.$('#apcPanelGuardNotice').textContent, /এক প্যানেল থেকে অন্য প্যানেলে যাওয়া বন্ধ/);
});
