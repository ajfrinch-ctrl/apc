/* Phase 4 — runtime proof that a shared link opens the right page and that the
   conversation takes the whole screen.

   One panel, one boot, one window: the Teacher page is opened from a deep link
   (`teacher.html#lecture-sheets`, exactly what a shared link or a refresh
   produces), the studio is checked, Back returns to its hub, and the chat is
   then opened from inside that same window so the full-screen class can be
   observed live. Booting several panels in one file would let one panel's
   pending async work run against the next panel's document, so each panel keeps
   its own suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';

test('a shared link reopens the studio, Back returns to the hub, chat takes the full screen', async t => {
  const ctx = await loadPage('teacher.html', {
    seed: { 'activePlus.demo.autofill.v1': 'off' },
    hash: '#lecture-sheets'
  });
  const { window, document } = ctx;
  t.after(() => window.close());

  await provisionStaff('teacher');
  seedStaffSession(window, 'teacher');
  await import('../js/teacher.js?deeplink-2026-10-28');
  await ctx.waitFor(() => ctx.$('#teacherShell').hidden === false);

  /* 1. The deep link chose the page; the home page is not painted behind it. */
  assert.equal(window.location.hash, '#lecture-sheets', 'the URL still names the page');
  assert.equal(ctx.$('#teacherLectureSheets').hidden, false, 'the studio page is open');
  assert.equal(ctx.$('#teacherHome').hidden, true, 'the home page stays closed');
  assert.equal(ctx.$('[data-panel-view="lecture-sheets"]').getAttribute('aria-current'), null,
    'a sub-page does not pretend to be a bottom seat');

  /* 2. The page shows only its own work, with a real Back control. */
  await ctx.waitFor(() => ctx.$('#teacherLectureSheetsMount .ls-manager-wrap'));
  const studio = ctx.$('#teacherLectureSheetsMount .ls-manager-wrap');
  assert.ok(studio.querySelector('[data-ls-mgr-action="open-create"]'), 'the create tool is offered');
  assert.ok(studio.querySelector('[data-ls-sheet-list]'), 'existing sheets are listed');
  const back = ctx.$('#teacherLectureSheets .pay-back');
  assert.equal(back.hidden, false, 'Back is visible on a sub-page');
  assert.equal(back.getAttribute('data-panel-view'), 'academic', 'Back names the hub it returns to');

  /* 3. Back goes to that hub, and the URL follows. */
  ctx.click(back);
  await ctx.waitFor(() => ctx.$('#teacherAcademic').hidden === false);
  assert.equal(window.location.hash, '#academic', 'the URL follows the Back control');
  assert.equal(ctx.$('#teacherLectureSheets').hidden, true, 'the studio page closes');

  /* 4. The chat opens from the panel's own entry and takes the full screen. */
  ctx.click(ctx.$('[data-panel-view="class-chat"]'));
  await ctx.waitFor(() => ctx.$('#teacherClassChat').hidden === false);
  assert.ok(ctx.$('#teacherShell').classList.contains('is-chat-fullscreen'),
    'the shell escapes the rail and the bottom bar for the conversation');
  assert.equal(window.location.hash, '#class-chat', 'the chat page is linkable too');

  /* 5. Leaving the chat restores the normal chrome. */
  ctx.click(ctx.$('#teacherClassChat .pay-back'));
  await ctx.waitFor(() => ctx.$('#teacherClassChat').hidden === true);
  assert.equal(ctx.$('#teacherShell').classList.contains('is-chat-fullscreen'), false,
    'the standard chrome comes back');

  assert.deepEqual(ctx.jsdomErrors.filter(error => !/navigation/i.test(error)), [],
    'the panel handled the deep link and the chat without an error');
});
