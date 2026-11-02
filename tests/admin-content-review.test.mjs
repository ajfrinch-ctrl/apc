/* Issue 4 — Admin content oversight (Design A, 2026-10-19).

   More → নোটিশ ও কনটেন্ট lists every student-facing notice and every
   homework/suggestion record and deletes either behind a window.confirm step.
   A delete must land in the SAME stores the student board reads, so it is
   gone from the student panel immediately. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { loadNotices, saveNotices, NOTICES_KEY } from '../js/office-data.js';
import { teachingRepository, TEACHING_KEY } from '../js/teaching-data.js';

const NOTICE = {
  id: 'NTC-TEST-01', title: 'বার্ষিক পরীক্ষার সূচি', body: 'সূচি শিগগিরই জানানো হবে।',
  status: 'published', audience: 'all', category: 'exam', date: '2026-10-19'
};
const nowIso = new Date().toISOString();
const ACTIVITY = {
  id: 'HW-TEST-01', type: 'homework', title: 'গণিত অনুশীলন', subject: 'গণিত',
  className: 'দশম শ্রেণি', group: '', date: '2026-10-25', time: '17:00',
  duration: 60, totalMarks: 100, status: 'published', details: 'অধ্যায় ১ এর অনুশীলনপত্র',
  teacherId: 'TST-1', teacherName: 'Test Teacher', teacherUsername: 'teacher.apc',
  resourceURL: '', progress: {}, createdAt: nowIso, updatedAt: nowIso
};

let ctx;
const activeView = () => ctx.$('.admin-view.active')?.dataset.viewPanel;
const contentOpen = () => activeView() === 'content';

async function openDetail(view) {
  ctx.click(ctx.$('.admin-bottom-item[data-panel-view="more"]'));
  await ctx.waitFor(() => activeView() === 'more');
  ctx.click(ctx.$('#adminMoreMenu [data-panel-view="content"]'));
  await ctx.waitFor(contentOpen);
  ctx.click(ctx.$(`.admin-view[data-view-panel="content"] [data-panel-view="${view}"]`));
  await ctx.waitFor(() => activeView() === view);
}

before(async () => {
  ctx = await loadPage('admin.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [NOTICES_KEY]: JSON.stringify([NOTICE]),
      [TEACHING_KEY]: JSON.stringify({ version: 1, activities: [ACTIVITY] })
    }
  });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  await ctx.waitFor(() => ctx.$('#adminMoreMenu [data-panel-view="content"]')?.dataset.navWired === '1');
});
after(() => ctx?.window.close());

test('the content view lists notices and records with a live count', async () => {
  assert.ok(ctx.$('#adminMoreMenu [data-panel-view="content"]'), 'More hub has the নোটিশ ও কনটেন্ট row');
  await openDetail('content-notices');
  assert.equal(ctx.$('.admin-view[data-view-panel="content"]').hidden, true, 'the content hub is replaced by the notice detail');
  await ctx.waitFor(() => ctx.$$('#adminNoticeReviewList .content-review-card').length === 1);
  await ctx.waitFor(() => ctx.$$('#adminContentReviewList .content-review-card').length === 1);
  const badge = ctx.$('[data-admin-content-count]');
  assert.equal(badge.textContent.trim(), '1টি', 'the notice count badge is painted');
  const noticeCard = ctx.$('#adminNoticeReviewList .content-review-card');
  assert.match(noticeCard.textContent, /বার্ষিক পরীক্ষার সূচি/, 'the real notice title renders');
  const recordCard = ctx.$('#adminContentReviewList .content-review-card');
  assert.match(recordCard.textContent, /গণিত অনুশীলন/, 'the homework record renders');
});

test('a cancelled confirm deletes nothing', async () => {
  ctx.window.confirm = () => false;
  ctx.click(ctx.$('[data-admin-content-action="delete-notice"]'));
  await ctx.flush();
  assert.equal(loadNotices().length, 1, 'the notice survives a cancelled dialog');
  await openDetail('content-records');
  ctx.click(ctx.$('[data-admin-content-action="delete-content"]'));
  await ctx.flush();
  const db = JSON.parse(ctx.window.localStorage.getItem(TEACHING_KEY));
  assert.equal(db.activities.length, 1, 'the record survives a cancelled dialog');
});

test('confirmed deletes clear the stores the student board reads', async () => {
  ctx.window.confirm = () => true;
  await openDetail('content-notices');
  ctx.click(ctx.$('[data-admin-content-action="delete-notice"]'));
  await ctx.waitFor(() => loadNotices().length === 0, 'the notice leaves the shared store');
  await ctx.waitFor(() => ctx.$$('#adminNoticeReviewList .content-review-card').length === 0);
  assert.equal(ctx.$('#adminNoticeReviewList').textContent.includes('এখনো কোনো নোটিশ'), true,
    'the empty state replaces the list');

  await openDetail('content-records');
  ctx.click(ctx.$('[data-admin-content-action="delete-content"]'));
  await ctx.waitFor(() => JSON.parse(ctx.window.localStorage.getItem(TEACHING_KEY)).activities.length === 0,
    'the record leaves the teaching store');
  await ctx.waitFor(() => ctx.$$('#adminContentReviewList .content-review-card').length === 0);

  /* The student-facing read path sees the deletions with no extra step. */
  const listed = await teachingRepository.list({ role: 'admin' });
  assert.equal(listed.activities.length, 0, 'repository list reflects the delete');
});
