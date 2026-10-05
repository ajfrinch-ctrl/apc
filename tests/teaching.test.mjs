import test from 'node:test';
import assert from 'node:assert/strict';
import { teachingRepository as repo, TEACHING_KEY, validateActivity, matchesStudent, publishedForStudent, safeResourceURL, searchTeachingStudents } from '../js/teaching-data.js';
import { adminStudents } from '../js/admin-data.js';
import { STORAGE_KEYS } from '../js/config.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { enabledClasses } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';

function setup() {
  const assignments = enabledClasses.map((className, index) => ({ id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'Test' }));
  const storage = new Map([
    [ROSTER_KEY, JSON.stringify(adminStudents)],
    [TEACHER_ASSIGNMENTS_KEY, JSON.stringify(assignments)],
    [STAFF_ACCOUNTS.teacher.accountKey, JSON.stringify({ role: 'teacher', username: 'teacher.apc', fullName: 'Test Teacher', status: 'active' })],
    [STAFF_ACCOUNTS.manager.accountKey, JSON.stringify({ role: 'manager', username: 'manager.apc', fullName: 'Test Manager', status: 'active' })],
    [STORAGE_KEYS.account, JSON.stringify({ status: 'active', student })]
  ]); let writes = 0, events = 0, failWrite = false;
  const sessions = new Map([[STAFF_ACCOUNTS.teacher.sessionKey, '1'], [STAFF_ACCOUNTS.manager.sessionKey, '1'], [STORAGE_KEYS.session, '1']]);
  globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (failWrite) throw new Error('quota'); storage.set(key, value); writes++; } }, sessionStorage: { getItem: key => sessions.get(key) ?? null, setItem: (key, value) => sessions.set(key, value), removeItem: key => sessions.delete(key) }, dispatchEvent: () => events++ };
  return { storage, get writes() { return writes; }, get events() { return events; }, fail() { failWrite = true; } };
}
const make = (fields = {}) => ({ type: 'exam', title: 'গণিত পরীক্ষা', subject: 'গণিত', className: 'দশম শ্রেণি', group: '', date: '2026-09-25', time: '17:00', duration: 60, totalMarks: 100, status: 'published', details: 'প্রথম অধ্যায়', ...fields });
const student = adminStudents[0];

test('academic validation: required fields, real dates, time, marks and safe links', () => {
  assert.equal(validateActivity(make()).totalMarks, 100);
  for (const fields of [{ type: 'bad' }, { status: 'hidden' }, { title: '' }, { subject: '' }, { date: '2026-02-30' }, { time: '25:01' }, { duration: 0 }, { time: '23:30', duration: 60 }, { totalMarks: 0 }, { totalMarks: 2.2 }, { resourceURL: 'javascript:alert(1)' }, { resourceURL: 'data:text/html,x' }, { resourceURL: 'https://user:pass@example.com' }]) assert.throws(() => validateActivity(make(fields)));
  assert.equal(safeResourceURL('https://example.com/notes'), 'https://example.com/notes');
  assert.equal(safeResourceURL('/local'), '');
  assert.equal(validateActivity(make({ type: 'suggestion', date: '', time: '' })).time, '');
});

test('scope, normalized group, draft exclusion and student search', () => {
  assert.equal(matchesStudent(make({ group: 'বিজ্ঞান' }), student), true);
  assert.equal(matchesStudent(make({ group: 'মানবিক' }), student), false);
  assert.equal(matchesStudent(make({ className: 'নবম শ্রেণি' }), student), false);
  assert.equal(publishedForStudent([make(), make({ status: 'draft' }), make({ className: 'নবম শ্রেণি' })], student).length, 1);
  assert.deepEqual(searchTeachingStudents(adminStudents, '   '), []);
  assert.deepEqual(searchTeachingStudents(adminStudents, 'nonexistent'), []);
  for (const query of ['রাইসা', 'RAISA', 'ap1024', '০১৭০০০০০০০০']) assert.equal(searchTeachingStudents(adminStudents, query)[0].id, student.id);
});

test('CRUD durable snapshots, no seed writes, preserve legacy data, teacher ownership', async () => {
  const env = setup(); env.storage.set('activePlus.admin.transactions.v1', 'unchanged');
  assert.deepEqual(await repo.list(), { version: 1, activities: [] }); assert.equal(env.writes, 0);
  let db = await repo.saveActivity(make({ type: 'homework' })); const id = db.activities[0].id;
  assert.equal(env.events, 1); assert.equal((await repo.list()).activities[0].id, id);
  db = await repo.saveActivity(make({ type: 'homework', id, title: 'সংশোধিত কাজ', status: 'draft' }));
  assert.equal(db.activities.length, 1); assert.equal(db.activities[0].title, 'সংশোধিত কাজ');
  await assert.rejects(repo.saveActivity(make({ id: 'missing' })));
  await assert.rejects(repo.saveActivity(make({ type: 'homework', id: 'missing' })));
  db = await repo.deleteActivity(id); assert.equal(db.activities.length, 0);
  assert.equal(env.storage.get('activePlus.admin.transactions.v1'), 'unchanged');
});

test('class/batch assignment bounds student reads and activity actions', async () => {
  const env = setup();
  const assigned = [{ id: 'TAS-1', teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ', subject: 'গণিত' }];
  env.storage.set(TEACHER_ASSIGNMENTS_KEY, JSON.stringify(assigned));
  const visible = await repo.listStudents();
  assert.ok(visible.every(item => item.className === 'দশম শ্রেণি' && item.group === 'বিজ্ঞান বিভাগ'));
  await assert.rejects(repo.saveActivity(make({ type: 'homework', className: 'নবম শ্রেণি' })));
  await assert.rejects(repo.saveActivity(make({ type: 'homework', group: 'মানবিক' })));
  const db = await repo.saveActivity(make({ type: 'homework', group: 'বিজ্ঞান বিভাগ' }));
  const id = db.activities[0].id;
  await assert.rejects(repo.saveProgress(id, { unknown: 'done' }));
  await assert.rejects(repo.saveProgress(id, { '260716011': 'done' }));
  await repo.saveProgress(id, { [student.id]: 'reviewed' });
  assert.equal((await repo.list()).activities[0].progress[student.id].value, 'reviewed');
});

test('homework self-report, teacher review, attendance and published-only progress', async () => {
  setup(); let db = await repo.saveActivity(make({ type: 'homework' })); const hw = db.activities[0].id;
  db = await repo.markHomeworkDone(hw, student); assert.equal(db.activities[0].progress[student.id].value, 'done');
  const spoofedProfile = await repo.markHomeworkDone(hw, { ...student, className: 'অষ্টম শ্রেণি' });
  assert.equal(spoofedProfile.activities[0].progress[student.id].value, 'done', 'the repository trusts the signed-in profile, not caller-supplied class data');
  await assert.rejects(repo.markHomeworkDone(hw, { ...student, id: 'unknown' }), { code: 'ACCESS_DENIED' });
  await repo.saveProgress(hw, { [student.id]: 'reviewed' });
  db = await repo.markHomeworkDone(hw, student); assert.equal(db.activities[0].progress[student.id].value, 'reviewed');
  db = await repo.saveActivity(make({ type: 'routine' })); const routine = db.activities[0].id;
  db = await repo.saveProgress(routine, { [student.id]: 'present' }); assert.equal(db.activities[0].progress[student.id].value, 'present');
  await assert.rejects(repo.saveProgress(routine, { [student.id]: 'done' }));
  db = await repo.saveActivity(make({ type: 'homework', status: 'draft', date: '2026-09-26' }));
  await assert.rejects(repo.saveProgress(db.activities[0].id, { [student.id]: 10 }));
});

test('class/exam scheduling conflict, adjacent time and drafts', async () => {
  setup(); await repo.saveActivity(make({ type: 'routine' }));
  await assert.rejects(repo.saveActivity(make({ type: 'routine', time: '17:30' })));
  await repo.saveActivity(make({ type: 'routine', time: '18:00' }));
  await repo.saveActivity(make({ type: 'homework', time: '17:30', status: 'draft' }));
  assert.equal((await repo.list()).activities.length, 3);
});

test('corrupt storage and failed writes never overwrite or announce success', async () => {
  let env = setup(); env.storage.set(TEACHING_KEY, '{broken');
  await assert.rejects(repo.list()); await assert.rejects(repo.saveActivity(make({ type: 'homework' }))); assert.equal(env.writes, 0);
  assert.equal(env.storage.get(TEACHING_KEY), '{broken');
  env = setup(); env.fail(); await assert.rejects(repo.saveActivity(make({ type: 'homework' }))); assert.equal(env.events, 0); assert.equal(env.writes, 0);
  env = setup(); let db = await repo.saveActivity(make({ type: 'homework' })); db.activities[0].progress[student.id] = { value: '<img onerror=alert(1)>', updatedAt: new Date().toISOString() }; env.storage.set(TEACHING_KEY, JSON.stringify(db));
  await assert.rejects(repo.list());
});

test('approved active account is included, pending excluded, existing ID deduplicated', async () => {
  const env = setup(); const count = (await repo.listStudents()).length;
  env.storage.set(STORAGE_KEYS.account, JSON.stringify({ status: 'active', student: { ...student, id: 'NEW-1', name: 'নতুন শিক্ষার্থী' } }));
  assert.equal((await repo.listStudents()).length, count + 1);
  env.storage.set(STORAGE_KEYS.account, JSON.stringify({ status: 'pending', student: { ...student, id: 'NEW-2' } }));
  assert.equal((await repo.listStudents()).length, count);
  env.storage.set(STORAGE_KEYS.account, JSON.stringify({ status: 'active', student: { ...student, name: 'নতুন নাম' } }));
  assert.equal((await repo.listStudents()).length, count); assert.equal((await repo.listStudents())[0].name, 'নতুন নাম');
});
