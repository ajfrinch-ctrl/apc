import test from 'node:test';
import assert from 'node:assert/strict';
import { STAFF_ADVICE_BANK, normalizeStaffAdviceSection, pickStaffSectionAdvice } from '../js/staff-daily-advice.js';

test('all staff roles share one advice bank keyed by section', () => {
  assert.deepEqual(Object.keys(STAFF_ADVICE_BANK), ['home', 'work', 'academic', 'finance', 'more']);
  assert.equal(normalizeStaffAdviceSection('admin-dashboard'), 'home');
  assert.equal(normalizeStaffAdviceSection('dashboard'), 'home');
  assert.equal(normalizeStaffAdviceSection('students'), 'work');
  assert.equal(normalizeStaffAdviceSection('online-exams'), 'academic');
  assert.equal(normalizeStaffAdviceSection('payment'), 'finance');
  assert.equal(normalizeStaffAdviceSection('profile'), 'more');
});

test('the same Dhaka date and section always returns the same sentence', () => {
  const morning = Date.parse('2026-11-02T03:00:00Z');
  const night = Date.parse('2026-11-02T16:00:00Z');
  assert.equal(pickStaffSectionAdvice('home', morning), pickStaffSectionAdvice('dashboard', night));
  assert.equal(pickStaffSectionAdvice('academic', morning), pickStaffSectionAdvice('online-exams', night));
});

test('section keys resolve to their own advice lists with a safe fallback', () => {
  const date = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(pickStaffSectionAdvice('finance', date), pickStaffSectionAdvice('payment', date));
  assert.notEqual(pickStaffSectionAdvice('home', date), pickStaffSectionAdvice('finance', date));
  assert.equal(pickStaffSectionAdvice('unknown-section', date), pickStaffSectionAdvice('home', date));
});
