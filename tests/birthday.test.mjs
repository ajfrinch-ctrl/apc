import test from 'node:test';
import assert from 'node:assert/strict';
import { isStudentBirthday } from '../js/birthday.js';

test('student birthday uses the Dhaka calendar date', () => {
  const midnightDhaka = Date.UTC(2026, 10, 2, 18, 0);
  assert.equal(isStudentBirthday('1990-11-03', midnightDhaka), true);
  assert.equal(isStudentBirthday('1990-11-02', midnightDhaka), false);
});

test('29 February birthdays are observed on 1 March in non-leap years', () => {
  const marchFirstDhaka = Date.UTC(2025, 1, 28, 18, 0);
  assert.equal(isStudentBirthday('2000-02-29', marchFirstDhaka), true);
  const leapDayDhaka = Date.UTC(2024, 1, 28, 18, 0);
  assert.equal(isStudentBirthday('2000-02-29', leapDayDhaka), false);
});

test('invalid or missing birth dates never trigger the birthday state', () => {
  const now = Date.UTC(2026, 10, 2, 18, 0);
  for (const value of ['', null, undefined, 'not-a-date', '2026-13-40']) {
    assert.equal(isStudentBirthday(value, now), false);
  }
});
