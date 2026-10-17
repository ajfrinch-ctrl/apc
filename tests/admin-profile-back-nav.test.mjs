import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/* Regression: on the Admin profile a settings group could be opened but
   the way back was an invisible white-on-white text arrow (the deployed
   report: "কোন আইকনে ক্লিক করে ব্যাক করা যাচ্ছে না, আগে ক্লিক করা অংশই
   দেখাচ্ছে"), and re-entering the profile kept the old group open. */
const hubSource = await readFile(new URL('../js/settings-hub.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../css/ui-features.css', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');

test('the group back button is a real back glyph, repainted for surfaces', () => {
  assert.match(hubSource, /iconElement\('back'/, 'the back button carries the back icon, not a bare text arrow');
  assert.match(hubSource, /settings-hub-back/, 'the back button has its own settings skin class');
  assert.match(cssSource, /\.settings-group-head \.settings-hub-back\{[^}]*color:var\(--color-primary\)/,
    'the back button is painted in surface colors, not the white-on-hero pay-back skin');
  assert.match(cssSource, /\.settings-group-head \.settings-hub-back\{[^}]*width:44px/,
    'the back button keeps a 44px touch target');
  assert.match(hubSource, /data-settings-hub-back/, 'the explicit back control still exists');
  assert.match(hubSource, /addEventListener\('click'/, 'the hub keeps its delegated click handling');
});

test('re-entering the Admin profile returns the hub to its group menu', () => {
  assert.match(hubSource, /export function resetSettingsHub/, 'the hub exposes a reset back to the group menu');
  assert.match(hubSource, /__apcShowSettingsGroup/, 'reset drives the mounted hub state, not just the DOM');
  assert.match(adminSource, /resetSettingsHub\('\[data-settings-hub="admin"\]'\)/,
    'arriving on the real mounted profile hub resets any group left open earlier');
  assert.match(adminSource, /mount:\s*'\[data-settings-hub="admin"\]'/,
    'the reset target is the same element the Admin actually mounts');
});

test('group doors and the hub back path stay wired', () => {
  assert.match(hubSource, /data-settings-open/, 'group doors still open their group');
  assert.match(hubSource, /showGroup\(''\)/, 'the hub can always return to the group menu');
  assert.match(adminSource, /mountSettingsHub\(/, 'the Admin profile still mounts the shared hub');
});
