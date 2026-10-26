/* Admin → System Settings → রক্ষণাবেক্ষণ মোড.

   The flag was writable from nowhere: no control in the panel could switch it
   on, and — worse — nothing could switch a stuck notice off again. These tests
   drive the real admin.html + js/admin.js (jsdom) and assert the switch writes
   an explicit boolean to the shared settings document, which is what every
   student device reads (js/main.js). */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';

const CONFIG_KEY = 'active-plus-app-config-v1';
const readConfig = window => JSON.parse(window.localStorage.getItem(CONFIG_KEY) || 'null');

let ctx;

before(async () => {
  ctx = await loadPage('admin.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      // The stuck state a student device reported: notice on, default message.
      [CONFIG_KEY]: JSON.stringify({ maintenanceMode: true })
    }
  });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  // renderAppManagement() paints the whole settings view; the state line is the
  // signal that it has read the stored config (the inputs exist in the markup
  // from the first paint, checked or not).
  await ctx.waitFor(() => Boolean(ctx.$('#maintenanceState')?.textContent));
});

test('the settings view shows the maintenance switch and the live state', () => {
  assert.equal(ctx.$('#cfgMaintenanceMode').checked, true, 'a stuck flag is visible as ON, not hidden');
  assert.match(ctx.$('#maintenanceState').textContent, /চালু আছে/);
  assert.ok(ctx.$('#btnSaveMaintenance'), 'the switch has its own save button');
  // The user asked to remove Home warnings, not the maintenance control.
  assert.equal(ctx.$('#adminMaintenanceFlag'), null, 'Home has no duplicate status banner');
});

test('the admin can switch maintenance off — an explicit false is saved', () => {
  const { $, click, window } = ctx;
  $('#cfgMaintenanceMode').checked = false;
  click($('#btnSaveMaintenance'));
  const saved = readConfig(window);
  assert.equal(saved.maintenanceMode, false, 'the settings document carries an explicit false');
  assert.match($('#maintenanceState').textContent, /বন্ধ আছে/);
  assert.match($('.admin-toast')?.textContent || '', /বন্ধ/);
  assert.equal($('#adminMaintenanceFlag'), null, 'switching maintenance does not restore a Home banner');
});

test('the admin can set a maintenance notice and then clear it again', () => {
  const { $, click, window } = ctx;
  $('#cfgMaintenanceMode').checked = true;
  $('#cfgMaintenanceMessage').value = 'আজ রাত ১০টা পর্যন্ত বন্ধ থাকবে';
  click($('#btnSaveMaintenance'));
  assert.equal(readConfig(window).maintenanceMode, true);
  assert.equal(readConfig(window).maintenanceMessage, 'আজ রাত ১০টা পর্যন্ত বন্ধ থাকবে');
  assert.match($('#maintenanceState').textContent, /চালু আছে/);

  // Turning it off keeps the message for the next time, but the flag is off.
  $('#cfgMaintenanceMode').checked = false;
  click($('#btnSaveMaintenance'));
  assert.equal(readConfig(window).maintenanceMode, false);

  // An empty message is allowed: the app falls back to its own default notice
  // instead of freezing the default text into the settings document.
  $('#cfgMaintenanceMode').checked = true;
  $('#cfgMaintenanceMessage').value = '   ';
  click($('#btnSaveMaintenance'));
  assert.equal(readConfig(window).maintenanceMessage, '');
  assert.equal($('#cfgMaintenanceMessage').value, '', 'the box stays empty — the default is a fallback, not stored text');
});

test('every toggle writes a boolean and never drops the rest of the settings', () => {
  const saved = readConfig(ctx.window);
  assert.equal(typeof saved.maintenanceMode, 'boolean', 'the switch always writes a boolean, never a string');
  assert.ok(saved.tagline, 'branding settings survive a maintenance toggle');
  assert.equal(typeof saved.modules, 'object');
  assert.equal(saved.modules?.routine, true);
});
