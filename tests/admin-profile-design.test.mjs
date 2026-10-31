/* Admin Profile design — the hero card contains the signed-in Admin's full
   profile facts and a shortcut to the existing edit form.

   Static guards on the shipped files (the behavioural profile contract —
   editable name/mobile/email, locked Login User ID — lives in
   admin-profile-user-id.test.mjs):
     • js/admin.js renders the avatar/name/Login ID, a semantic details list
       and an edit action inside the same hero
     • css/ui-wallet.css styles those rows within the gradient band, using tokens
     • the session card carries copy plus a labelled logout button with an icon,
       and the account forms explain themselves with a hint line
     • no new palette: the profile rules compose foundation tokens only
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('the hero contains the Admin identity, all profile facts, and its existing edit shortcut', () => {
  const js = read('js/admin.js');
  const render = js.slice(js.indexOf('async function renderAdminProfile()'));
  const body = render.slice(0, render.indexOf('\n}\n', render.indexOf('host.innerHTML')));
  assert.match(body, /admin-profile-avatar/, 'initials avatar');
  assert.match(body, /admin-profile-identity/, 'name + Login ID identity block');
  assert.match(body, /escapeHtml\(displayName\)/, 'the name is escaped before it is painted');
  assert.match(body, /<div class="admin-profile-hero">[\s\S]*?<dl class="profile-list admin-profile-facts">[\s\S]*?<button class="admin-profile-edit"[^>]*data-admin-profile-edit/,
    'all profile facts and the edit shortcut are children of the same hero');
  assert.match(body, /<div class="profile-row"><dt>/, 'each fact is a semantic dt/dd pair');
  assert.match(body, /প্রোফাইল সম্পাদনা/, 'the edit action stays visible on the hero');
  assert.doesNotMatch(body, /Current Admin/, 'the old arrow badge copy is gone');
  assert.match(js, /data-admin-profile-edit[\s\S]*?accountDoor\.click\(\)/,
    'the hero edit action reuses the Account settings door');
});

test('the wallet skin styles the profile detail grid, scoped to the Admin profile', () => {
  const css = read('css/ui-wallet.css');
  const scope = '.admin-view[data-view-panel="profile"]';
  assert.match(css, new RegExp(`\\${scope.replace('[', '\\[').replace(']', '\\]')} \\.profile-list \\{[^}]*display: grid;`), 'detail grid is laid out');
  assert.ok(css.includes(`${scope} .profile-row {`), 'rows are styled tiles');
  assert.ok(css.includes(`${scope} .profile-row dt {`), 'labels are styled');
  assert.ok(css.includes(`${scope} .profile-row dd {`), 'values are styled');
  assert.ok(css.includes('.admin-profile-avatar {'), 'avatar is styled');
  assert.ok(css.includes('.admin-session-card {'), 'session row is aligned');
  // Palette rule: the profile block composes tokens, never raw colours.
  const block = css.slice(css.indexOf('/* 19 '));
  const declarations = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(declarations, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, 'profile colours belong in foundation.css');
});

test('owner design 2026-10-16: a dark identity band over row-shaped group doors', () => {
  const html = read('admin.html');
  const js = read('js/admin.js');
  const css = read('css/ui-wallet.css');
  const scope = '.admin-view[data-view-panel="profile"]';

  // The identity card is always visible: it lives above the settings hub,
  // not inside the (initially hidden) account group.
  assert.ok(html.indexOf('id="adminProfileCard"') < html.indexOf('data-settings-hub="admin"'),
    'the identity card sits above the settings hub');
  /* The band names the person signed in — the System Owner, or a second Admin
     created in Staff Management (2026-10-30), which is why the value comes from
     signedInAdmin() rather than straight off the device account. */
  assert.match(js, /লগইন আইডি: \$\{escapeHtml\(admin\.username/, 'the band names the Login ID in Bengali');
  assert.match(js, /<span class="admin-profile-status">এডমিন<\/span>/, 'the band carries the Admin pill in Bengali');
  assert.match(js, /<dl class="profile-list admin-profile-facts">/, 'all remaining Admin facts are inside the hero band');
  assert.match(js, /data-admin-profile-edit/, 'the hero keeps a profile edit action');
  assert.ok(css.includes('.admin-profile-hero {'), 'the band is styled');
  assert.ok(css.includes('.admin-profile-edit {'), 'the edit action is styled inside the band');
  assert.match(css, /\.admin-view\[data-view-panel="profile"\] > \.page-intro:first-child p\.profile-page-sub \{[^}]*color: var\(--color-text-secondary\)/,
    'the page subtitle uses readable text-secondary ink on the light canvas');
  assert.match(css, /\.admin-profile-hero \{[^}]*background: var\(--pay-hero-gradient\)/,
    'the band is the dark brand gradient, from tokens');
  assert.match(css, /\.admin-profile-hero::after \{[^}]*var\(--tone-mint\)/, 'a quiet teal wash closes the right edge');

  // The five group doors: icon disc, name, what lives inside, chevron.
  for (const hint of ['নাম, মোবাইল, পাসওয়ার্ড', 'বার্তা ও সতর্কতা', 'গাঢ় থিম ও চেহারা', 'সেশন ও লগআউট', 'ব্যাকআপ ও রিপোর্ট']) {
    assert.ok(js.includes(hint), `door hint "${hint}" is painted`);
  }
  assert.match(js, /admin-settings-door/, 'doors are painted by the Admin shell');
  assert.match(js, /iconMarkup\('chevron-right'/, 'each door ends in a chevron');
  assert.ok(css.includes(`${scope} .pay-tile.admin-settings-door {`), 'doors are rows, not tiles');
  assert.match(css, /\.pay-tile\.admin-settings-door \{[^}]*flex-direction: row;/, 'a door lays out left-to-right');
  assert.match(css, /@media \(max-width: 700px\) \{\n  \.admin-profile-avatar[\s\S]*?settings-group-grid \{ grid-template-columns: 1fr; \}/,
    'the doors stack to one column on a phone');
});

test('the profile markup explains the session and the account forms', () => {
  const html = read('admin.html');
  const profile = html.slice(html.indexOf('data-view-panel="profile"'), html.indexOf('<!-- More:'));
  assert.match(profile, /class="profile-page-sub"/, 'the page says what lives here');
  assert.match(profile, /admin-session-card/, 'session is its own row');
  assert.match(profile, /id="adminAccountLogout"[^>]*>[\s\S]*?data-icon="logout"/, 'logout carries its icon');
  assert.equal((profile.match(/admin-card-hint/g) || []).length, 2, 'both account forms carry a hint');
  assert.ok(profile.indexOf('id="adminProfileForm"') > profile.indexOf('id="adminProfileCard"'),
    'the edit form still follows the identity card');
});
