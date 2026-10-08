/* Exam notifications act on the named paper, starting or resuming that attempt. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { EXAM_KEY, examTemplate, validateExam } from '../js/exam-data.js';
import { STORAGE_KEYS } from '../js/config.js';

const student = { id: 'STU-NOTIFY-1', name: 'রহিম', className: 'দশম শ্রেণি', group: '' };
const makeExam = (id, title, now, startOffset) => ({
  ...validateExam({
    type: 'mcq', title, subject: 'গণিত', className: student.className,
    startAt: now + startOffset, endAt: now + 15 * 60_000, lateMinutes: 10,
    negative: 0, passPercent: 33, template: examTemplate('mcq')
  }),
  id, teacherId: 'TCH-1', teacherName: 'শিক্ষক', status: 'published',
  publishedAt: now - 60_000, createdAt: now - 60_000, updatedAt: now,
  participants: [{ ...student }]
});

test('the notification action starts and resumes the exact exam it names', async () => {
  const now = Date.now();
  const target = makeExam('EX-NOTIFY-TARGET', 'গণিতের নির্দিষ্ট পরীক্ষা', now, -60_000);
  // A later exam is listed first, ensuring the action must resolve by ID.
  const other = makeExam('EX-NOTIFY-OTHER', 'অন্য গণিত পরীক্ষা', now, -30_000);
  const ctx = await loadPage('index.html', { seed: {
    'activePlus.demo.autofill.v1': 'off',
    [STORAGE_KEYS.account]: JSON.stringify({ status: 'active', student })
  } });
  ctx.window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
  ctx.window.localStorage.setItem(EXAM_KEY, JSON.stringify({ version: 1, exams: [target, other], attempts: [] }));
  ctx.$('#appShell').hidden = false;
  ctx.window.HTMLElement.prototype.scrollIntoView = function () {};

  const { initStudentExams } = await import('../js/student-exams.js?notification-action');
  initStudentExams({ getStudent: () => student, getAccount: () => ({ status: 'active' }) });
  ctx.click(ctx.$('#examTabs [data-exam-tab="live"]'));
  await ctx.waitFor(() => Boolean(ctx.$(`[data-student-exam="${target.id}"]`)));

  const notify = action => ctx.window.dispatchEvent(new ctx.window.CustomEvent('apc-notification-action', {
    detail: { kind: 'exam', id: target.id, action, target: 'exams' }
  }));
  notify('start');
  await ctx.waitFor(() => {
    const saved = JSON.parse(ctx.window.localStorage.getItem(EXAM_KEY));
    return saved.attempts.some(attempt => attempt.examId === target.id && attempt.studentId === student.id && attempt.status === 'active')
      && Boolean(ctx.$('.exam-question-list'));
  });
  assert.equal(ctx.$('#studentExamWorkspace h2').textContent, target.title);
  const started = JSON.parse(ctx.window.localStorage.getItem(EXAM_KEY)).attempts.find(attempt => attempt.examId === target.id);
  assert.equal(started.status, 'active');
  assert.equal(JSON.parse(ctx.window.localStorage.getItem(EXAM_KEY)).attempts.some(attempt => attempt.examId === other.id), false);

  ctx.click(ctx.$('[data-student-exam-action="list"]'));
  await ctx.waitFor(() => Boolean(ctx.$(`[data-student-exam="${target.id}"]`)));
  notify('resume');
  await ctx.waitFor(() => Boolean(ctx.$('.exam-question-list')));
  assert.equal(ctx.$('#studentExamWorkspace h2').textContent, target.title);
  ctx.window.close();
});
