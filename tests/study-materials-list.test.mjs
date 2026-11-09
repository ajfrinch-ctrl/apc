/* উপকরণ ও সাজেশন — the list stays a list.

   Reported 2026-11-09: tapping উপকরণ showed the whole lecture inside the card,
   so a student could not see what materials exist. The rule now (same in
   আমার কোর্স and সাজেশন): a row carries the kind, the title and subject •
   chapter, and the material itself opens in the app — the A4 reader for a
   lecture sheet, the reading sheet for a note — never as text poured into the
   list. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { STORAGE_KEYS } from '../js/config.js';
import { COURSE_CONTENT_KEY } from '../js/course-content.js';
import { classByName, subjectByName } from '../js/academics.js';
import { initStudentStudySections } from '../js/student-study-sections.js';

const STUDENT = { id: 'STD-LIST-1', name: 'তানিয়া আক্তার', className: 'দশম শ্রেণি', group: '', status: 'approved' };
let ctx;

before(async () => {
  ctx = await loadPage('student.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  const window = ctx.window;
  window.localStorage.setItem(STORAGE_KEYS.account, JSON.stringify({ status: 'active', student: STUDENT }));
  window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
  const classId = classByName('দশম শ্রেণি').id;
  const subjectId = subjectByName('গণিত').id;
  const stamp = Date.now();
  const base = { classId, subjectId, chapterId: '', published: true, active: true, createdAt: stamp, updatedAt: stamp };
  window.localStorage.setItem(COURSE_CONTENT_KEY, JSON.stringify({
    records: [
      {
        ...base, id: 'CONTENT-0101', type: 'note', title: 'ক্লাস নোট ১',
        richContent: '<p>নোটের ভেতরের লেখা</p>', content: 'নোটের ভেতরের লেখা'
      },
      {
        ...base, id: 'CONTENT-0102', type: 'pdf', title: 'Narration মাস্টার শিট', isLectureSheet: true,
        docJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'শিটের ভেতরের লেখা' }] }] },
        pageSettings: {}
      }
    ]
  }));
  const study = initStudentStudySections({ getStudent: () => STUDENT });
  await study.refresh();
  ctx.click(ctx.$('#studySections [data-study-section="materials"]'));
});

after(() => ctx?.window.close());

test('the materials list shows titles, not the lecture body', () => {
  const list = ctx.$('#studyMaterialsList');
  assert.ok(list, 'the materials list exists');
  assert.equal(ctx.$$('#studyMaterialsList .course-item-body').length, 0, 'no material body is printed in the list');
  assert.equal(ctx.$$('#studyMaterialsList [data-study-item]').length, 2, 'both materials are listed');
  assert.match(list.textContent, /ক্লাস নোট ১/);
  assert.match(list.textContent, /Narration মাস্টার শিট/);
  assert.doesNotMatch(list.textContent, /নোটের ভেতরের লেখা/, 'the note text waits for the reader');
  assert.match(list.textContent, /A4 লেকচার শিট|PDF/, 'the kind is named on the row');
});

test('tapping a note reads it in the app, and closing returns to the list', async () => {
  const row = ctx.$$('#studyMaterialsList [data-study-open]').find(item => /ক্লাস নোট ১/.test(item.textContent));
  assert.ok(row, 'the note row is openable');
  ctx.click(row.querySelector('button'));
  await ctx.waitFor(() => ctx.$('#apcStudentMaterialReader'));
  assert.match(ctx.$('#apcStudentMaterialReader').textContent, /নোটের ভেতরের লেখা/);
  ctx.click(ctx.$('#apcStudentMaterialReader [data-smr-close]'));
  assert.equal(ctx.$('#apcStudentMaterialReader'), null, 'the reader closes');
});

test('tapping a lecture sheet opens the A4 reader, and its PDF button is still there', async () => {
  const row = ctx.$$('#studyMaterialsList [data-study-open]').find(item => /Narration মাস্টার শিট/.test(item.textContent));
  assert.ok(row.querySelector('[data-student-lecture-pdf]'), 'a sheet keeps its PDF action');
  ctx.click(row);
  await ctx.waitFor(() => ctx.$('#apcStudentLectureReader'));
  assert.match(ctx.$('#apcStudentLectureReader').textContent, /Narration মাস্টার শিট/);
  assert.ok(ctx.$('#apcStudentLectureReader [data-slr-close]'), 'the reader can be left');
});

test('the search box narrows the list by title, subject or chapter', () => {
  const box = ctx.$('#studyMaterialSearch');
  assert.ok(box, 'উপকরণ has a search box');
  ctx.type(box, 'Narration');
  assert.equal(ctx.$$('#studyMaterialsList [data-study-item]').length, 1, 'one title matches');
  ctx.type(box, 'নেই এমন কিছু');
  assert.match(ctx.$('#studyMaterialsList').textContent, /কোনো উপকরণ পাওয়া যায়নি/);
  ctx.type(box, '');
  assert.equal(ctx.$$('#studyMaterialsList [data-study-item]').length, 2, 'clearing the box restores the list');
});
