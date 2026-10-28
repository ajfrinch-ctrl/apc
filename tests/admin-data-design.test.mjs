/* Admin Data design — record counts read as count pills and the two
   destructive cards form one marked danger zone.

   Static guards on the shipped files (the data behaviour — collection
   counts, clear-with-confirmation, factory reset — is covered elsewhere):
     • each collection row stacks its label over its hint and ends in a
       styled .data-count pill, muted when the collection is empty
     • both delete/reset cards carry .admin-danger-card and their standing
       warning is a calm .admin-danger-note, not a full error banner
     • css/ui-wallet.css paints the danger zone and the pills from
       foundation tokens only, and the page explains itself in a subtitle
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const viewOf = (html, name) => {
  const start = html.indexOf(`data-view-panel="${name}"`);
  assert.notEqual(start, -1, `${name} view exists`);
  const end = html.indexOf('data-view-panel="', start + 10);
  return html.slice(start, end === -1 ? undefined : end);
};
const dataSurfaces = html => ['data', 'data-stats', 'data-danger'].map(name => viewOf(html, name)).join('\n');

test('collection rows stack label over hint and end in a count pill', () => {
  const js = read('js/admin.js');
  const render = js.slice(js.indexOf('function renderDataManagement()'), js.indexOf('function clearSelectedCollection()'));
  assert.match(render, /class="data-row-copy"/, 'label and hint live in a stacked copy block');
  assert.match(render, /class="data-count"/, 'the count is a pill element');
  assert.match(render, /row\.count \? '' : ' is-empty'/, 'empty collections are marked so they can recede');
});

test('the two destructive cards form a marked danger zone with a calm warning', () => {
  const html = read('admin.html');
  const view = dataSurfaces(html);
  assert.equal((view.match(/admin-danger-card/g) || []).length, 2, 'both delete/reset cards are marked');
  assert.equal((view.match(/admin-danger-note/g) || []).length, 2, 'both standing warnings are calm notes');
  assert.doesNotMatch(view, /<p class="finance-error">সতর্কতা/, 'a standing warning is not painted as a form error');
  assert.match(view, /class="data-page-sub"/, 'the page says what lives here');
  assert.ok(view.includes('id="dataClearButton"') && view.includes('id="factoryResetButton"'),
    'the danger actions themselves are unchanged');
});

test('second pass: toned collection icons, a summary strip and one labelled danger zone', () => {
  const html = read('admin.html');
  const js = read('js/admin.js');
  const css = read('css/ui-wallet.css');
  const view = dataSurfaces(html);
  assert.match(view, /class="data-summary" id="dataSummary"/, 'the collections card leads with a summary strip');
  assert.match(view, /class="data-danger-zone"/, 'the destructive cards share one zone');
  assert.match(view, /class="data-danger-zone-title"/, 'the zone is labelled before any button appears');
  assert.equal((view.match(/admin-danger-icon/g) || []).length, 2, 'each danger card head carries its warning disc');
  assert.match(view, /id="dataRefreshButton"><span class="apc-icon"/, 'refresh is an icon-and-label control');

  const render = js.slice(js.indexOf('function renderDataManagement()'), js.indexOf('function clearSelectedCollection()'));
  assert.match(render, /class="data-row-icon"/, 'each collection row opens with an icon disc');
  assert.match(render, /iconMarkup\(row\.icon/, 'row icons come from the shared icon family');
  assert.match(render, /data-summary-chip/, 'the strip reports totals from the rows already counted');
  assert.match(render, /মোট রেকর্ড/, 'the strip names the total');
  const collections = js.slice(js.indexOf('const DATA_COLLECTIONS'), js.indexOf('function collectionCount'));
  assert.equal((collections.match(/icon: '/g) || []).length, 8, 'every collection names its icon');

  const scope = '.admin-view[data-view-panel="data"]';
  assert.ok(css.includes(`${scope} .data-row-icon {`), 'row icon discs are styled');
  assert.ok(css.includes(`${scope} .data-summary-chip {`), 'summary chips are styled');
  assert.ok(css.includes(`${scope} .data-danger-zone {`), 'the danger zone is one painted area');
  assert.ok(css.includes(`${scope} .admin-danger-icon {`), 'danger discs are styled');
  const section = css.slice(css.indexOf('/* 24 ')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(section, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, 'second-pass colours belong in foundation.css');
});

test('the skin paints pills, the storage footer and the danger zone from tokens only', () => {
  const css = read('css/ui-wallet.css');
  const scope = '.admin-view[data-view-panel="data"]';
  assert.ok(css.includes(`${scope} .data-count {`), 'count pill is styled');
  assert.ok(css.includes(`${scope} .data-row.is-empty .data-count {`), 'empty counts recede');
  assert.ok(css.includes(`${scope} #dataStorageNote {`), 'storage line is a quiet footer');
  assert.ok(css.includes('.admin-danger-card {'), 'danger cards are marked');
  assert.ok(css.includes('.admin-danger-note {'), 'the calm warning is styled');
  assert.ok(css.includes(`${scope} .admin-btn.danger {`), 'danger actions are filled and full-width');
  const section = css.slice(css.indexOf('/* 22 ')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(section, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, 'data colours belong in foundation.css');
});
