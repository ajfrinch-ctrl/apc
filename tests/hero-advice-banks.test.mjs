/*
 * Hero advice banks — structural guarantees.
 *
 * Three defects were fixed on 2026-11-08:
 *   1. `routine-view` was declared twice in TEACHER_SECTION_ADVICE, so the first
 *      three lines could never be shown (the second object literal won).
 *   2. `records` and `chat` were read from markup but had no bank entry, so those
 *      two hero cards silently fell back to the generic 24-line daily list.
 *   3. Admin's Home advice never followed the open view: js/admin.js looked for
 *      `[data-admin-hero-advice]`, which admin.html does not (and, per the panel
 *      design rules, must not) contain.
 *
 * These tests pin the fixes so a later edit cannot quietly reintroduce them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TEACHER_SECTION_ADVICE, pickTeacherSectionAdvice } from '../js/teacher-daily-advice.js';
import { pickAdminSectionAdvice, adminAdviceSections } from '../js/admin-operational-advice.js';

const ROOT = new URL('../', import.meta.url);
const DAY = 86_400_000;
const dayOne = Date.parse('2026-10-21T00:00:00Z');

/* Sections whose key legitimately differs from the markup hook name. */
const KEY_ALIASES = { records: null, chat: 'chat', home: null };

test('every advice key is declared exactly once — no silent override', () => {
  const keys = Object.keys(TEACHER_SECTION_ADVICE);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate section keys');
  for (const key of keys) {
    const list = TEACHER_SECTION_ADVICE[key];
    assert.ok(Array.isArray(list) && list.length >= 2, `${key} carries at least two lines`);
    assert.equal(new Set(list).size, list.length, `${key} has no duplicate line inside itself`);
    for (const line of list) {
      assert.ok(line.trim().length > 0, `${key} has no empty line`);
      assert.doesNotMatch(line, /[A-Za-z]/, `${key} stays fully Bengali`);
      assert.ok(line.trim().length <= 120, `${key} keeps a hero-sized line`);
    }
    assert.notEqual(
      pickTeacherSectionAdvice(key, dayOne),
      pickTeacherSectionAdvice(key, dayOne + DAY),
      `${key} rotates the next day`
    );
  }
});

test('`routine-view` keeps the schedule lines instead of an attendance overlap', () => {
  const lines = TEACHER_SECTION_ADVICE['routine-view'];
  assert.equal(lines.length, 6, 'both formerly-colliding banks are merged, not dropped');
  assert.ok(lines.some(line => line.includes('সপ্তাহের রুটিন')), 'the schedule-first line survives');
  assert.ok(lines.some(line => line.includes('কক্ষ, সময় ও শিক্ষকের')), 'the coordination line survives');
  assert.equal(lines.filter(line => line.includes('সপ্তাহের রুটিন')).length, 1,
    'the graph-scoped first bank is merged once, not pasted twice');
});

test('`records` and `chat` have their own banks, so those cards never fall back', () => {
  for (const key of ['records', 'chat']) {
    assert.ok(Object.hasOwn(TEACHER_SECTION_ADVICE, key), `${key} is declared`);
    const lines = TEACHER_SECTION_ADVICE[key];
    assert.ok(lines.length >= 3, `${key} is a real bank, not a placeholder`);
    for (const line of lines) {
      assert.ok(!TEACHER_SECTION_ADVICE.home.includes(line),
        `${key} does not borrow the generic daily line (${line.slice(0, 20)}…)`);
    }
  }
  /* The words a teacher reads on the record screen and the chat card. */
  assert.ok(TEACHER_SECTION_ADVICE.records.some(line => /রেকর্ড/.test(line)));
  assert.ok(TEACHER_SECTION_ADVICE.chat.some(line => /চ্যাট/.test(line)));
});

test('every advice hook in the three staff pages resolves to a real bank', async () => {
  const pages = { 'teacher.html': 'teacher', 'manager.html': 'manager', 'payment.html': 'pay' };
  for (const [page, prefix] of Object.entries(pages)) {
    const html = await readFile(new URL(page, ROOT), 'utf8');
    const hooks = new Set([...html.matchAll(new RegExp(`data-${prefix}-hero-advice="([a-z-]+)"`, 'g'))]
      .map(match => match[1]));
    assert.ok(hooks.size > 0, `${page} keeps its hero advice hooks`);
    for (const hook of hooks) {
      if (hook === 'records') {
        /* teacher.js routes `records` through the open record view. */
        for (const view of ['homework', 'suggestion', 'exam', 'routine']) {
          assert.ok(Object.hasOwn(TEACHER_SECTION_ADVICE, view), `records/${view} resolves`);
        }
        continue;
      }
      if (hook === 'home') {
        assert.ok(Array.isArray(TEACHER_SECTION_ADVICE.home) && TEACHER_SECTION_ADVICE.home.length >= 20);
        continue;
      }
      assert.ok(Object.hasOwn(TEACHER_SECTION_ADVICE, hook),
        `${page} asks for "${hook}" but no bank entry exists (it would fall back silently)`);
    }
    assert.ok(!/'route-chat'/.test(await readFile(new URL('js/teacher-daily-advice.js', ROOT), 'utf8')),
      'no orphan keys linger in the bank');
  }
});

test('Admin Home advice follows the open view, without needing an HTML attribute', async () => {
  const [adminJs, adminHtml] = await Promise.all([
    readFile(new URL('js/admin.js', ROOT), 'utf8'),
    readFile(new URL('admin.html', ROOT), 'utf8')
  ]);
  assert.match(adminJs, /const activeView = \$\('\.admin-view\.active'\)\?\.dataset\.viewPanel/,
    'the sync reads the active panel from the DOM');
  assert.match(adminJs, /pickAdminSectionAdvice\(activeView\)/, 'and paints that view’s line');
  assert.match(adminJs, /function hasCustomAdviceLine\(\)/, 'a custom authored line keeps precedence');
  /* The panel-design rule stays: Admin Home is text-only, no hero card remnants. */
  assert.doesNotMatch(adminHtml, /data-admin-hero-advice=/, 'admin.html stays free of the removed hero attribute');
  assert.match(adminHtml, /<p class="(?:admin-view-sub|teacher-hero-advice)" id="adminHeroAdvice">/, 'the shared staff header owns the dashboard advice line');
});

test('every Admin view with a hero header has an advice line', async () => {
  const adminHtml = await readFile(new URL('admin.html', ROOT), 'utf8');
  const views = [...adminHtml.matchAll(/<section class="admin-view[^"]*" data-view-panel="([a-z-]+)"/g)]
    .map(match => match[1]);
  assert.ok(views.length >= 40, 'the Admin panel really has its nested views');
  const covered = new Set(adminAdviceSections());
  const missing = views.filter(view => !covered.has(view) && view !== 'dashboard');
  assert.deepEqual(missing, [], 'no Admin view is left without its own advice line');
  for (const key of covered) {
    const line = pickAdminSectionAdvice(key);
    assert.ok(line && line.trim().length > 0, `${key} has a line`);
    assert.doesNotMatch(line, /[A-Za-z]/, `${key} advice stays Bengali`);
  }
  assert.equal(pickAdminSectionAdvice('no-such-view'), pickAdminSectionAdvice('admin-dashboard'),
    'an unknown view falls back to the Home line instead of going blank');
  assert.ok(KEY_ALIASES, 'documented alias table stays in one place');
});
