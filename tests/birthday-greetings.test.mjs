import test from 'node:test';
import assert from 'node:assert/strict';
import { birthdayAdvanceItems, birthdayItems, isStudentBirthday, notificationFeed } from '../js/notification-rules.js';

const student = { kind: 'student', studentId: 'S-BD', name: 'রাফি আহমেদ', birthDate: '2008-10-09' };

test('a student receives one birthday greeting on their birth day', () => {
  const now = new Date(2026, 9, 9, 9, 0, 0).getTime();
  assert.equal(isStudentBirthday('2008-10-09', now), true);
  assert.equal(isStudentBirthday('2008-10-08', now), false);
  const items = birthdayItems(student, now);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'birthday');
  assert.equal(items[0].key, 'birthday:S-BD:2026');
  assert.match(items[0].title, /রাফি/);
  assert.match(items[0].body, /শুভেচ্ছা/);
  assert.equal(birthdayItems({ ...student, kind: 'staff' }, now).length, 0);
  assert.equal(birthdayItems(student, new Date(2026, 9, 10, 9, 0, 0).getTime()).length, 0);
});

test('29 February is greeted on 1 March in a common year', () => {
  assert.equal(isStudentBirthday('2008-02-29', new Date(2026, 2, 1, 10, 0, 0).getTime()), true);
  assert.equal(isStudentBirthday('2008-02-29', new Date(2024, 1, 29, 10, 0, 0).getTime()), true);
});

test('the notification feed includes the birthday card for that student', () => {
  const now = new Date(2026, 9, 9, 12, 0, 0).getTime();
  const feed = notificationFeed({ viewer: student, now });
  assert.ok(feed.some(item => item.kind === 'birthday' && item.sourceId === 'S-BD'));
});

test('Admin, Manager and Teacher are told the day before, with class and name', () => {
  const now = new Date(2026, 9, 8, 18, 0, 0).getTime();
  const roster = [
    { id: 'S-BD', name: 'রাফি আহমেদ', className: 'দশম শ্রেণি', group: 'বিজ্ঞান', birthDate: '2008-10-09', status: 'approved' },
    { id: 'S-OTHER', name: 'মিম', className: 'নবম শ্রেণি', birthDate: '2009-01-01', status: 'approved' }
  ];
  const admin = birthdayAdvanceItems(roster, { kind: 'staff', role: 'admin' }, now);
  assert.equal(admin.length, 1);
  assert.equal(admin[0].kind, 'birthday-soon');
  assert.match(admin[0].body, /দশম শ্রেণি/);
  assert.match(admin[0].body, /রাফি/);
  const teacherOwn = birthdayAdvanceItems(roster, { kind: 'staff', role: 'teacher', assignedClasses: ['দশম শ্রেণি'] }, now);
  assert.equal(teacherOwn.length, 1);
  const teacherOther = birthdayAdvanceItems(roster, { kind: 'staff', role: 'teacher', assignedClasses: ['একাদশ শ্রেণি'] }, now);
  assert.equal(teacherOther.length, 0);
  assert.equal(birthdayAdvanceItems(roster, { kind: 'staff', role: 'payment' }, now).length, 0);
  const feed = notificationFeed({ students: roster, viewer: { kind: 'staff', role: 'manager' }, now });
  assert.ok(feed.some(item => item.kind === 'birthday-soon' && item.sourceId === 'S-BD'));
});
