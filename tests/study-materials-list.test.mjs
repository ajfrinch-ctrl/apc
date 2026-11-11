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
  if (!ctx.window.URL.createObjectURL) ctx.window.URL.createObjectURL = () => 'blob:study-material-test';
  if (!ctx.window.URL.revokeObjectURL) ctx.window.URL.revokeObjectURL = () => {};
  const window = ctx.window;
  window.localStorage.setItem(STORAGE_KEYS.account, JSON.stringify({ status: 'active', student: STUDENT }));
  window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
  const classId = classByName('দশম শ্রেণি').id;
  const subjectId = subjectByName('গণিত').id;
  const englishSubjectId = subjectByName('ইংরেজি').id;
  const stamp = Date.now();
  const base = { classId, subjectId, chapterId: '', published: true, active: true, createdAt: stamp, updatedAt: stamp };
  const englishBase = { ...base, subjectId: englishSubjectId };
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
      },
      {
        ...base, id: 'CONTENT-0103', type: 'pdf', title: 'বোর্ড পরীক্ষার PDF', attachmentUrl: 'https://example.com/board.pdf'
      },
      {
        ...englishBase, id: 'CONTENT-0104', type: 'note', title: 'English grammar note', content: 'Tense practice'
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
  assert.equal(ctx.$$('#studyMaterialsList [data-study-item]').length, 4, 'all materials are listed');
  assert.match(list.textContent, /ক্লাস নোট ১/);
  assert.match(list.textContent, /Narration মাস্টার শিট/);
  assert.match(list.textContent, /গণিত/, 'subject names resolve from the assigned subject id');
  assert.match(list.textContent, /ইংরেজি/, 'subject names resolve for every subject');
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

test('tapping a lecture sheet opens the generated PDF in a full-screen PDF reader', async () => {
  const row = ctx.$$('#studyMaterialsList [data-study-open]').find(item => /Narration মাস্টার শিট/.test(item.textContent));
  assert.ok(row.querySelector('[data-student-lecture-pdf]'), 'a sheet keeps its separate PDF action');
  ctx.click(row);
  await ctx.waitFor(() => ctx.$('#apcStudentPdfReader iframe')?.src.startsWith('blob:'));
  const reader = ctx.$('#apcStudentPdfReader');
  assert.match(reader.textContent, /Narration মাস্টার শিট/);
  assert.ok(reader.querySelector('[data-spdf-close]'), 'the full-screen reader can be left');
  assert.ok(reader.querySelector('[data-spdf-download]'), 'the exact displayed PDF can also be downloaded');
  ctx.click(reader.querySelector('[data-spdf-close]'));
  assert.equal(ctx.$('#apcStudentPdfReader'), null);
});

test('a linked PDF has a Read button and opens in the full-screen PDF viewer', async () => {
  const row = ctx.$$('#studyMaterialsList [data-study-open]').find(item => /বোর্ড পরীক্ষার PDF/.test(item.textContent));
  assert.ok(row.querySelector('[data-study-open-btn]'), 'linked PDF materials are readable, not download-only');
  ctx.click(row.querySelector('[data-study-open-btn]'));
  await ctx.waitFor(() => ctx.$('#apcStudentPdfReader iframe')?.src.includes('board.pdf'));
  const frame = ctx.$('#apcStudentPdfReader iframe');
  assert.ok(frame, 'the PDF reader is shown');
  assert.match(frame.src, /^https:\/\/example\.com\/board\.pdf#toolbar=1/);
  ctx.click(ctx.$('#apcStudentPdfReader [data-spdf-close]'));
});

test('the search box narrows the list by title, subject or chapter', () => {
  const box = ctx.$('#studyMaterialSearch');
  assert.ok(box, 'উপকরণ has a search box');
  ctx.type(box, 'Narration');
  assert.equal(ctx.$$('#studyMaterialsList [data-study-item]').length, 1, 'one title matches');
  ctx.type(box, 'নেই এমন কিছু');
  assert.match(ctx.$('#studyMaterialsList').textContent, /কোনো উপকরণ পাওয়া যায়নি/);
  ctx.type(box, '');
  assert.equal(ctx.$$('#studyMaterialsList [data-study-item]').length, 4, 'clearing the box restores the list');
});

test('subject filter matches materials whose records store only a subject id', () => {
  const select = ctx.$('#studyMaterialSubject');
  select.value = 'ইংরেজি';
  select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(ctx.$$('#studyMaterialsList [data-study-item]').length, 1);
  assert.match(ctx.$('#studyMaterialsList').textContent, /ইংরেজি/);
  select.value = '';
  select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
});
