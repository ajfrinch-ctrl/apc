/* Admin panel-wide design — every view opens with the same subtitled hero,
   hub rows end in a chevron icon (never a text arrow), and the surfaces that
   rendered unstyled for years (audit entries, role capability chips) are
   painted like the rest of the panel.

   Static guards; per-view behaviour stays with its own suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('admin.html');
const viewOf = panel => {
  const start = html.indexOf(`data-view-panel="${panel}"`);
  const next = html.indexOf('data-view-panel="', start + 10);
  return html.slice(start, next === -1 ? undefined : next);
};

test('every remaining Admin view opens with a subtitle under its title', () => {
  for (const panel of ['system', 'migration', 'roles', 'students', 'reports', 'backup', 'audit', 'security', 'academics', 'settings']) {
    assert.match(viewOf(panel), /<p class="admin-view-sub">[^<]{8,}<\/p>/, `${panel} has a subtitle`);
  }
  const css = read('css/ui-wallet.css');
  assert.ok(css.includes('.admin-view > .page-intro:first-child p.admin-view-sub {'), 'the skin paints subtitles on the hero band');
});

test('hub rows end in a chevron icon, never a text arrow, and the audit view uses the svg back button', () => {
  assert.doesNotMatch(html, /<span aria-hidden="true">→<\/span>/, 'no text arrows in hub rows');
  assert.equal((html.match(/admin-menu-arrow/g) || []).length, 9, 'system, data and More hub rows carry the arrow slot');
  const audit = viewOf('audit');
  assert.match(audit, /data-icon="back"/, 'the audit back button is the shared svg');
  assert.doesNotMatch(audit, />←<\/button>/, 'no text back arrow');
  assert.ok(audit.includes('id="gradeAuditList"') && audit.includes('id="adminExamWorkspace"'),
    'both audit surfaces stay mounted, now inside cards');
});

test('audit entries and role chips are styled surfaces, painted from tokens', () => {
  const js = read('js/admin.js');
  assert.match(js, /class="audit-entry"/, 'audit rows render as entries');
  assert.doesNotMatch(js, /style="display:flex;align-items:center;gap:6px;"/, 'the class row header is a class, not inline style');
  const css = read('css/ui-wallet.css');
  for (const selector of ['.audit-entry {', '.role-cap-list {', '.role-cap-list li.is-denied {', '.role-icon {', '.class-copy-head {']) {
    assert.ok(css.includes(selector), `${selector} is styled`);
  }
  const section = css.slice(css.indexOf('/* 23 ')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(section, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, 'panel colours belong in foundation.css');
});

test('student avatars show the student initials, grapheme-safe', () => {
  const js = read('js/admin.js');
  assert.match(js, /const initialsOf =/, 'one initials helper');
  assert.match(js, /Segmenter\('bn', \{ granularity: 'grapheme' \}\)/, 'Bengali conjuncts are kept whole');
  assert.match(js, /student-avatar" aria-hidden="true">\$\{escapeHtml\(initialsOf\(student\.name\)\)\}/,
    'the list avatar is the student, not a generic glyph');
});
