/* Action Center: notification CTAs open the specific student task, not only its list. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';
import { STORAGE_KEYS } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { homeworkItems, nextHomeworkBoundary, examItems } from '../js/notification-rules.js';

const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const shiftDay = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const student = { kind: 'student', studentId: 'S-1', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ' };
const homework = (id, date, extra = {}) => ({
  id, type: 'homework', title: `কাজ ${id}`, subject: 'গণিত', className: 'দশম শ্রেণি', group: 'বিজ্ঞান',
  status: 'published', date, time: '18:00', updatedAt: `2026-10-01T10:00:00.000Z`, progress: {}, ...extra
});

test('homework due today/tomorrow is scoped, actionable, and timed for the next local-day change', () => {
  const now = new Date(2026, 9, 4, 12, 0, 0).getTime();
  const today = dayKey(new Date(now));
  const tomorrow = dayKey(shiftDay(new Date(now), 1));
  const db = { version: 1, activities: [
    homework('HW-1', tomorrow),
    homework('HW-2', today, { group: '' }),
    homework('HW-done', tomorrow, { progress: { 'S-1': { value: 'done' } } }),
    homework('HW-other-class', tomorrow, { className: 'একাদশ শ্রেণি' }),
    homework('HW-other-group', tomorrow, { group: 'মানবিক' }),
    homework('HW-later', dayKey(shiftDay(new Date(now), 3)))
  ] };

  const items = homeworkItems(db, student, now);
  assert.deepEqual(items.map(item => item.sourceId).sort(), ['HW-1', 'HW-2']);
  const dueTomorrow = items.find(item => item.sourceId === 'HW-1');
  assert.equal(dueTomorrow.kind, 'homework');
  assert.equal(dueTomorrow.title, 'কাজ HW-1');
  assert.match(dueTomorrow.body, /আগামীকাল জমা দিতে হবে/);
  assert.equal(dueTomorrow.target, 'courses');
  assert.equal(dueTomorrow.action, 'open-homework');
  assert.equal(dueTomorrow.actionLabel, 'বাড়ির কাজ খুলুন');
  assert.equal(dueTomorrow.actionable, undefined, 'an upgrade does not pop every existing assignment as fresh');
  assert.equal(nextHomeworkBoundary(db, student, now), new Date(`${tomorrow}T00:00:00`).getTime());
  assert.deepEqual(homeworkItems(db, { ...student, kind: 'staff', role: 'teacher' }, now), []);
});

test('published exam notification names the paper and selects a safe direct action', () => {
  const now = Date.now();
  const exam = {
    id: 'EX-1', title: 'গণিত MCQ Test', subject: 'গণিত', type: 'mcq', status: 'published',
    startAt: now - 60_000, endAt: now + 15 * 60_000, lateMinutes: 10,
    publishedAt: now - 120_000, participants: [{ id: student.studentId }]
  };
  const live = examItems({ exams: [exam], attempts: [] }, student, now)[0];
  assert.equal(live.title, 'গণিত MCQ Test');
  assert.match(live.body, /নতুন পরীক্ষা প্রকাশিত হয়েছে/);
  assert.equal(live.actionLabel, 'এখনই পরীক্ষা দিন');
  assert.equal(live.action, 'start');
  assert.equal(live.target, 'exams');

  const active = examItems({ exams: [exam], attempts: [{ examId: exam.id, studentId: student.studentId, status: 'active' }] }, student, now)[0];
  assert.equal(active.action, 'resume');
  assert.equal(active.actionLabel, 'পরীক্ষায় ফিরে যাও');
});

test('the bell and in-app alert both render a distinct action button', async () => {
  const ctx = await loadPage('manager.html');
  const { mountNoticeCenter } = await import('../js/notice-center.js?action-center-ui');
  const homeworkItem = {
    key: 'homework:HW-1:rev1', source: 'teaching', sourceId: 'HW-1', kind: 'homework',
    title: 'অধ্যায় ৩ অনুশীলনী', body: 'পদার্থবিজ্ঞান · আগামীকাল জমা দিতে হবে', target: 'courses',
    action: 'open-homework', actionLabel: 'বাড়ির কাজ খুলুন', at: Date.now()
  };
  const examItem = {
    key: 'exam-live:EX-2:123', source: 'exams', sourceId: 'EX-2', kind: 'exam-live',
    title: 'পরীক্ষা শুরু হয়েছে', body: 'গণিত MCQ Test', target: 'exams',
    action: 'start', actionLabel: 'এখনই পরীক্ষা দিন', at: Date.now()
  };
  let read = false;
  let pendingAlerts = [];
  const opened = [];
  const api = {
    feed: () => [homeworkItem],
    unread: () => read ? 0 : 1,
    unreadKeys: () => read ? [] : [homeworkItem.key],
    markRead: keys => { read = true; return keys.length; },
    seen: () => read ? [homeworkItem.key] : [],
    openItem: item => { opened.push(item); return true; },
    takeAlerts: () => { const items = pendingAlerts; pendingAlerts = []; return items; },
    whenReady: async () => true,
    pushSupport: async () => ({ supported: false, secureContext: true, permission: 'unsupported', hasVapidKey: false }),
    enable: async () => ({ ok: false, status: 'unsupported' }),
    disable: async () => ({ ok: true, status: 'off' }),
    refresh: () => {}
  };
  const center = mountNoticeCenter(api);
  ctx.click(ctx.$('#notificationButton'));
  const modal = ctx.$('#apcNoticeModal');
  assert.equal(modal.querySelector('#apcNoticeTitle').textContent, 'অ্যাকশন সেন্টার');
  const taskButton = modal.querySelector('button.notice-action[data-apc-notice-open="homework:HW-1:rev1"]');
  assert.equal(taskButton.textContent, 'বাড়ির কাজ খুলুন');
  ctx.click(taskButton);
  await ctx.flush();
  assert.equal(opened.at(-1).sourceId, 'HW-1');
  assert.equal(modal.hidden, true);

  pendingAlerts = [examItem];
  ctx.window.dispatchEvent(new ctx.window.CustomEvent('apc-inapp-alerts', { detail: { count: 1 } }));
  await ctx.waitFor(() => Boolean(ctx.$('#apcInAppAlert .apc-inapp-alert-action')));
  const examButton = ctx.$('#apcInAppAlert .apc-inapp-alert-action');
  assert.equal(examButton.textContent, 'এখনই পরীক্ষা দিন');
  ctx.click(examButton);
  await ctx.flush();
  assert.equal(opened.at(-1).sourceId, 'EX-2');
  assert.equal(center.isOpen(), false);
});

test('a due homework task already on-device stays read when rule version 3 is introduced', async () => {
  const now = new Date();
  const today = dayKey(now);
  const viewerKey = `student:${student.studentId}`;
  const activity = homework('HW-OLD', today);
  const ctx = await loadPage('index.html', { seed: {
    [KEYS.account]: JSON.stringify({ username: 'rahim', status: 'active', student: {
      id: student.studentId, name: 'রহিম', className: student.className, group: student.group
    } }),
    [KEYS.teaching]: JSON.stringify({ version: 1, activities: [activity] }),
    [`activePlus.notifications.boot.v1:${viewerKey}`]: JSON.stringify({ version: 1, at: Date.now() - 60_000 }),
    [`activePlus.notifications.rules.v1:${viewerKey}`]: JSON.stringify({ version: 2, at: Date.now() - 60_000 })
  } });
  ctx.$('#appShell').hidden = false;
  const alerts = [];
  ctx.window.addEventListener('apc-inapp-alerts', event => alerts.push(event.detail));
  const notifications = await import('../js/notifications.js?action-center-v3-upgrade');
  const engine = notifications.initNotifications();
  await ctx.flush();

  const record = engine.records().find(item => item.type === 'homework' && item.relatedId === activity.id);
  assert.ok(record, 'the assignment can still be opened from the notification history');
  assert.equal(record.read, true, 'the new reminder must not create an unread badge on upgrade');
  assert.equal(engine.unread(), 0);
  assert.deepEqual(alerts, [], 'existing work does not appear as a new in-app alert');
  assert.equal(JSON.parse(ctx.window.localStorage.getItem(`activePlus.notifications.rules.v1:${viewerKey}`)).version, 3);
});

test('an Action Center homework CTA opens and expands the matching student work', async () => {
  const tomorrow = dayKey(shiftDay(new Date(), 1));
  const activity = {
    id: 'ACT-HW-1', type: 'homework', title: 'অধ্যায় ৩ অনুশীলনী', subject: 'গণিত',
    className: 'দশম শ্রেণি', group: 'বিজ্ঞান', date: tomorrow, time: '18:00', duration: 0,
    totalMarks: 0, status: 'published', details: 'অনুশীলনী ১–৫ শেষ করো।', resourceURL: '', room: '',
    teacherId: 'TCH-001', teacherName: 'শিক্ষক', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), progress: {}
  };
  const studentAccount = {
    username: 'rahim', status: 'active', student: {
      id: student.studentId, name: 'রহিম', username: 'rahim', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ'
    }
  };
  const viewerKey = `student:${student.studentId}`;
  const ctx = await loadPage('index.html', { seed: {
    [KEYS.account]: JSON.stringify(studentAccount),
    [KEYS.teaching]: JSON.stringify({ version: 1, activities: [activity] }),
    [TEACHER_ASSIGNMENTS_KEY]: JSON.stringify([{
      id: 'TAS-1', teacherUsername: 'teacher.apc', teacherName: 'শিক্ষক',
      className: 'দশম শ্রেণি', group: '', subjects: ['গণিত']
    }]),
    [`activePlus.notifications.boot.v1:${viewerKey}`]: JSON.stringify({ version: 1, at: Date.now() - 60_000 }),
    [`activePlus.notifications.rules.v1:${viewerKey}`]: JSON.stringify({ version: 3, at: Date.now() - 60_000 })
  } });
  ctx.window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
  ctx.$('#appShell').hidden = false;
  const routes = [];
  ctx.$$('button[data-view="courses"]').forEach(button => button.addEventListener('click', () => routes.push('courses')));
  const { initStudentTeaching } = await import('../js/student-teaching.js?action-center-integration');
  const refreshTeaching = initStudentTeaching({ getStudent: () => ({ ...student, name: 'রহিম' }) });
  await refreshTeaching();
  const notifications = await import('../js/notifications.js?action-center-integration');
  const engine = notifications.initNotifications();
  await ctx.flush();
  const item = engine.feed().find(entry => entry.kind === 'homework' && entry.sourceId === activity.id);
  assert.ok(item, 'the due task entered the student notification feed');
  const actions = [];
  ctx.window.addEventListener('apc-notification-action', event => actions.push(event.detail));
  await engine.openItem(item);
  await ctx.waitFor(() => ctx.$('#learningList [data-learning-id="ACT-HW-1"] .learning-card-toggle')?.getAttribute('aria-expanded') === 'true');
  assert.ok(routes.includes('courses'), 'the CTA routed to the Learning Hub');
  assert.equal(actions.at(-1).kind, 'homework');
  assert.equal(actions.at(-1).id, activity.id);
  assert.match(ctx.$('#learningList').textContent, /অনুশীলনী ১–৫ শেষ করো/);
});
