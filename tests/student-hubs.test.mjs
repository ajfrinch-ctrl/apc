/* The routine/class hub views behind the student panel's 3×3 tiles.
   The reported bug: a student WITH a routine taps ক্লাস রুটিন and the view
   stays on its "ক্লাস রুটিন লোড হচ্ছে…" placeholder — read as a load error.
   The hub paints from device-local office data only, so these tests pin the
   whole path: the view-change event repaints every list, the class filter
   keeps a student's own rows, and nothing in the render can throw. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { initStudentHubs } from '../js/student-hubs.js';
import { renderRoutine } from '../js/routine.js';
import { KEYS } from '../js/database.js';

const student = { id: 'HUB-S-1', name: 'রুটিনওয়ালা শিক্ষার্থী', className: 'দশম শ্রেণি', group: '' };
const ROUTINE = {
  sat: { date: '', classes: [
    { time: '08:00', period: '১ম', subject: 'গণিত', teacher: 'করিম স্যার', room: '১০১', className: 'দশম শ্রেণি' },
    { time: '10:00', period: '৩য়', subject: 'রসায়ন', teacher: 'সালমা ম্যাডাম', room: '২০২', className: 'নবম শ্রেণি' }
  ] },
  sun: { date: '', classes: [
    { time: '09:00', period: '২য়', subject: 'পদার্থবিজ্ঞান', teacher: 'রহিম স্যার', room: '১০২' }
  ] }
};

const contexts = [];
after(() => contexts.forEach(ctx => ctx.window.close()));

async function hubPage(seed = {}, who = student) {
  const ctx = await loadPage('index.html', { seed });
  contexts.push(ctx);
  const paint = initStudentHubs({ getStudent: () => who });
  ctx.window.dispatchEvent(new ctx.window.CustomEvent('apc-view-change', { detail: { view: 'routine-class' } }));
  const $ = selector => ctx.window.document.querySelector(selector);
  return { ...ctx, $, paint };
}

test('a student WITH a routine never stays on the "লোড হচ্ছে…" placeholder', async () => {
  const { $ } = await hubPage({ [KEYS.routine]: JSON.stringify(ROUTINE) });
  const list = $('#routineClassList');
  assert.ok(list, 'the ক্লাস রুটিন view list exists');
  assert.ok(!list.textContent.includes('লোড হচ্ছে'), 'the loading placeholder is gone');
  assert.match(list.textContent, /শনিবার/);
  assert.match(list.textContent, /গণিত/);
  assert.match(list.textContent, /করিম স্যার · ১০১/);
  // Six day sections, one per WEEK_DAYS entry — the full weekly routine.
  assert.equal(list.querySelectorAll('section').length, 6);
});

test('the class filter keeps this student\u2019s rows and drops other classes', async () => {
  const { $ } = await hubPage({ [KEYS.routine]: JSON.stringify(ROUTINE) });
  const list = $('#routineClassList');
  assert.ok(!list.textContent.includes('রসায়ন'), 'a row scoped to নবম শ্রেণি is not shown to দশম');
  assert.match(list.textContent, /পদার্থবিজ্ঞান/, 'a row with no className is shown to everyone');
  const today = $('#routineTodayList');
  assert.ok(!today.textContent.includes('রসায়ন'));
});

test('empty storage paints honest empty states — and throws nowhere', async () => {
  const { $ } = await hubPage({}, null);
  const list = $('#routineClassList');
  assert.ok(!list.textContent.includes('লোড হচ্ছে'));
  assert.match(list.textContent, /ক্লাস নেই।/);
  assert.match($('#classSubjectsList').textContent, /বিষয় এখনও যোগ হয়নি।/);
  assert.match($('#classTeachersList').textContent, /শিক্ষকের নাম রুটিনে এলে/);
});

test('a damaged routine file degrades to empty days instead of an error', async () => {
  const { $ } = await hubPage({ [KEYS.routine]: '{broken' });
  const list = $('#routineClassList');
  assert.ok(!list.textContent.includes('লোড হচ্ছে'));
  assert.match(list.textContent, /ক্লাস নেই।/);
});

/* The routine-day render runs inside the shared chunk-init chain: if it threw
   on a missing header element, every hub initialised after it stayed dead —
   the frozen-placeholder bug this file exists for. */
test('renderRoutine survives missing header elements without throwing', async () => {
  const ctx = await loadPage('index.html', { seed: { [KEYS.routine]: JSON.stringify(ROUTINE) } });
  contexts.push(ctx);
  for (const id of ['routineDate', 'classCount', 'emptyRoutine']) {
    ctx.window.document.getElementById(id)?.remove();
  }
  assert.doesNotThrow(() => renderRoutine('sat', student));
  assert.match(ctx.window.document.querySelector('#routineList').textContent, /গণিত/);
});
