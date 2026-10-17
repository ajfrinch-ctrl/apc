/* Admin Dashboard design — the backup banner is built from palette tokens,
   the lone quick-access tile spans the full row with its icon above the label, staff rows carry an
   avatar, and the hero greets the signed-in Admin by name.

   Static guards on the shipped files (behaviour — counts, the backup-overdue
   rule, routing — is covered by the panel-shell / storage-safety suites):
     • #backupReminder carries no inline colours; css/ui-wallet.css styles it
       and the dashboard's toned snapshot tiles from foundation tokens only
     • the is-wide feature tile spans the full grid while keeping a vertical icon/label stack, and
       the "দ্রুত অ্যাক্সেস" label hides when the permission grid is empty
     • staff-overview quick actions speak Bengali, like the rest of the panel,
       and each row opens with an initials avatar
     • the dashboard welcome uses the signed-in account's name, and the
       maintenance flag carries no emoji
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('the backup reminder is a token banner with an icon and a pill action, never inline colours', () => {
  const html = read('admin.html');
  const reminder = html.match(/<div class="admin-backup-reminder"[^>]*id="backupReminder"[^>]*>/);
  assert.ok(reminder, 'the reminder is a styled banner, not a bare paragraph');
  assert.doesNotMatch(reminder[0], /style=/, 'no inline style on the banner');
  const block = html.slice(html.indexOf('id="backupReminder"'), html.indexOf('</div>', html.indexOf('id="backupReminder"')));
  assert.match(block, /data-icon="backup"/, 'the banner carries the backup icon');
  assert.match(block, /<a class="admin-backup-action" href="#backup">/, 'the export action stays a #backup link');

  const css = read('css/ui-wallet.css');
  assert.ok(css.includes('.admin-backup-reminder {'), 'the skin styles the banner');
  assert.ok(css.includes('.admin-backup-action {'), 'the skin styles the pill action');
  const section = css.slice(css.indexOf('/* 20 ')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(section, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, 'dashboard colours belong in foundation.css');
});

test('snapshot tiles are toned and the lone quick-access tile fills the row vertically', () => {
  const css = read('css/ui-wallet.css');
  assert.match(css, /\.admin-view\[data-view-panel="dashboard"\] \.admin-stat-tile \{\s*background-image: linear-gradient\(140deg, var\(--tone-soft/,
    'each snapshot tile washes in its own tone');
  assert.match(css, /\.admin-feature-grid \.admin-feature-tile\.is-wide \{\s*grid-column: 1 \/ -1; flex-direction: column;/,
    'an odd last tile spans the row while keeping its icon above the label');
  assert.match(css, /\.admin-feature-grid \.admin-feature-tile\.is-wide \.admin-feature-label \{[^}]*text-align: center;/,
    'the full-width vertical tile keeps its label centered');
  assert.match(css, /:has\(#adminFeatureGrid\[hidden\]\) > \.pay-section-label \{ display: none; \}/,
    'the quick-access label hides with an empty permission grid');
});

test('staff overview rows open with an avatar and speak Bengali', () => {
  const js = read('js/staff-overview.js');
  assert.match(js, /staff-overview-avatar/, 'each row paints an initials avatar');
  assert.doesNotMatch(js, />View<|>Edit<|'Deactivate'|'Activate'/, 'no English quick actions remain');
  for (const label of ['দেখুন', 'সম্পাদনা', 'নিষ্ক্রিয় করুন', 'সক্রিয় করুন']) {
    assert.ok(js.includes(label), `quick action "${label}" is Bengali`);
  }
  assert.ok(read('css/ui-wallet.css').includes('.staff-overview-avatar {'), 'the avatar is styled');
});

test('second pass: unboxed dashboard intro, tone-ruled tiles, staggered quick access, soft staff rows', () => {
  const css = read('css/ui-wallet.css');
  const scope = '.admin-view[data-view-panel="dashboard"]';
  const html = read('admin.html');
  const dashboard = html.slice(html.indexOf('data-view-panel="dashboard"'), html.indexOf('data-view-panel="staff"'));
  assert.doesNotMatch(dashboard, /class="(?:[^"]*\s)?admin-hero(?:\s[^"]*)?"/u, 'the Admin dashboard has no hero card');
  assert.ok(html.includes('class="home-dashboard-intro admin-home-intro"'), 'title and date remain in an unboxed intro');
  assert.ok(css.includes(`${scope} .admin-hero-icon { box-shadow: 0 0 0 6px var(--pay-hero-chip); }`),
    'the small dashboard icon retains its halo');
  assert.ok(css.includes(`${scope} .pay-portal-kicker {`), 'the intro context has an explicit dashboard rule');
  assert.ok(css.includes('box-shadow: inset 0 4px 0 var(--tone, var(--tone-blue)), var(--pay-shadow);'),
    'each snapshot tile is ruled in its own tone');
  assert.ok(css.includes(`${scope} .admin-hero-stats .tile-value { font-size: 26px; }`),
    'snapshot numbers carry the card');
  assert.ok(css.includes('@keyframes admin-tile-in'), 'quick-access tiles arrive with a short rise');
  assert.ok(css.includes('animation-delay: calc(var(--tile-index, 0) * 45ms);'),
    'the stagger spends the --tile-index the shell sets per tile');
  assert.ok(!html.includes('staffOverviewHome') && !html.includes('staffOverviewProfile') && html.includes('id="staffList"'),
    'staff counts and management are kept in the dedicated Staff view, not Account/Profile');
  const section = css.slice(css.indexOf('/* 25 ')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(section, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i,
    'second-pass dashboard colours belong in foundation.css');
});

test('owner design 2026-10-16: unboxed Admin heading, separate toned stat cards and a full-width vertical quick tile', () => {
  const css = read('css/ui-wallet.css');
  const html = read('admin.html');
  const scope = '.admin-view[data-view-panel="dashboard"]';
  assert.match(css, new RegExp(`${scope.replaceAll('[', '\\[').replaceAll(']', '\\]')} \\.admin-hero-stats \\{\\s*gap: 10px;`),
    'the snapshot tiles sit apart, not in one divided strip');
  assert.match(css, /\.admin-hero-stats \.admin-stat-tile \{[^}]*border-radius: 16px;/, 'each tile is its own card');
  assert.match(css, /\.admin-hero-stats \.admin-stat-tile \{[^}]*inset 0 4px 0 var\(--tone/, 'each card is ruled in its tone');
  assert.ok(css.includes(`${scope} .admin-hero-icon { border-radius: 14px; }`), 'the hero mark is a rounded square');
  assert.ok(css.includes(`${scope} .pay-portal-kicker { display: none; }`), 'the welcome leads, the kicker steps aside');
  assert.ok(html.includes('class="home-dashboard-intro admin-home-intro"'), 'dashboard identity has no hero-card wrapper');
  assert.ok(css.includes(`${scope} .admin-feature-grid .admin-feature-tile.is-wide {`),
    'the lone quick tile is governed on the dashboard');
  assert.match(css, /\.admin-view\[data-view-panel="dashboard"\] \.admin-feature-grid \.admin-feature-tile\.is-wide \{\s*grid-column: 1 \/ -1; flex-direction: column;/,
    'the lone tile spans the entire grid at every viewport while keeping the vertical layout');
  assert.match(css, /\.admin-feature-grid \.admin-feature-tile\.is-wide \{\s*grid-column: 1 \/ -1;/,
    'the final full-row tile stays full-width in the phone-only layout');
  assert.match(css, /\.admin-feature-tile \{[^}]*min-height: 112px;/, 'the quick tile is a standing card');
});

test('the hero greets the signed-in Admin by name and the maintenance flag has no emoji', () => {
  const js = read('js/admin.js');
  assert.match(js, /welcome\.textContent = adminName \? `স্বাগতম, \$\{adminName\}`/, 'the welcome follows the account name');
  assert.doesNotMatch(js, /⚠️/, 'no emoji in the maintenance flag');
  assert.match(js, /রক্ষণাবেক্ষণ মোড চালু আছে/, 'the flag still says maintenance is on');
});
