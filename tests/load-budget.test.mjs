/* The first-paint load budget is part of the contract: a change set that drags
   a feature module back into js/main.js's static graph, or swaps the WOFF2
   font back to a TTF-only @font-face, fails here instead of shipping a slower
   login screen. Numbers and rationale live in tools/load-budget.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBudgets, eagerClosure } from '../tools/load-budget.mjs';

/* Signed-in surface: fetched as the lazy chunk (js/student-features.js), so it
   must never sit in the parser-blocking boot graph again. */
const LAZY = [
  'js/report-builders.js',
  'js/exam-data.js',
  'js/course-hub.js',
  'js/student-practice.js',
  'js/reports.js',
  'js/exam-pdf.js',
  'js/staff-directory.js'
];

test('the student boot graph stays inside the first-paint load budget', () => {
  const { problems, eager } = checkBudgets();
  assert.deepEqual(problems, [], problems.join('; '));
  assert.ok(eager.modules > 0);
});

test('the signed-in feature surface stays out of the boot graph', () => {
  const { files } = eagerClosure();
  for (const module of LAZY) {
    assert.ok(!files.has(module), `${module} leaked back into the eager boot graph`);
  }
});
