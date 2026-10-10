/* Question templates for every exam type (school request, 2026-09-30):
   the teacher sees the template, copies it, pastes it into the box below and
   edits the questions. The data rules and the real teacher exam editor
   (teacher.html + js/exam-manager.js) are both checked here — one page per test
   file, because the panel modules read the globals of the window that loaded
   them. */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { openStaffPanel } from './staff-harness.mjs';
import { EXAM_TYPES, EXAM_SAMPLE_TEMPLATES, examTemplate, parseQuestions } from '../js/exam-data.js';
import { enabledClasses } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';

const TYPES = Object.keys(EXAM_TYPES);   // mcq, written, short

test('every exam type has its own ready-made template that parses', () => {
  for (const type of TYPES) {
    const template = examTemplate(type);
    assert.ok(template && template.includes('প্রশ্ন:'), `${type} has a question template`);
    const questions = parseQuestions(template, type);
    assert.equal(questions.length, 2, `${type} template shows two questions`);
    if (type === 'mcq') {
      assert.equal(template.includes('নম্বর'), false, 'MCQ marks are fixed, so its template has no marks line');
      assert.ok(questions.every(q => q.options.length === 4 && q.answer), 'each MCQ has options and an answer');
    } else {
      assert.ok(questions.every(q => q.marks > 0), `${type} asks for marks`);
      assert.notEqual(questions[0].marks, questions[1].marks, `${type} shows two different marks`);
    }
  }
});

test('every exam type offers a list of named samples, and each sample parses', () => {
  for (const type of TYPES) {
    const list = EXAM_SAMPLE_TEMPLATES[type];
    assert.ok(Array.isArray(list) && list.length >= 5, `${type} has several samples (${list?.length})`);
    for (const [name, text] of list) {
      assert.ok(typeof name === 'string' && name.trim(), 'every sample is named');
      const questions = parseQuestions(text, type);
      assert.ok(questions.length >= 1, `${type} / ${name} parses into questions`);
    }
  }
  assert.equal(EXAM_SAMPLE_TEMPLATES.mcq.length, 30, 'the 30 MCQ samples stay available');
});

/* ---------- The editor the teacher actually uses --------------------------- */

let ctx;
const $ = sel => ctx.$(sel);
before(async () => {
  ctx = await loadPage('teacher.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [TEACHER_ASSIGNMENTS_KEY]: JSON.stringify(enabledClasses.map((className, index) => ({ id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'Test', subjects: ['গণিত', 'ইংরেজি', 'বিজ্ঞান', 'বাংলা', 'Test'] })))
    }
  });
  await openStaffPanel(ctx, 'teacher', {
    importPanel: () => import('../js/teacher.js'),
    shellId: 'teacherShell',
    ready: () => [...$('#teacherClassFilter').options].some(option => option.textContent === 'সব assigned class')
  });
  ctx.click($('[data-teacher-view="online-exams"]'));
  await ctx.waitFor(() => Boolean($('#teacherExamWorkspace [data-exam-action="new-mcq"]')));
});

/** Leave whatever editor is open and start a new exam of this type. */
async function startExam(type) {
  if (!$('#teacherExamWorkspace [data-exam-action="new-' + type + '"]')) {
    ctx.click($('#teacherExamWorkspace [data-exam-action="list"]'));
    await ctx.waitFor(() => Boolean($('#teacherExamWorkspace [data-exam-action="new-' + type + '"]')));
  }
  ctx.click($('#teacherExamWorkspace [data-exam-action="new-' + type + '"]'));
  await ctx.waitFor(() => $('.exam-template-panel')?.dataset.examType === type);
}
after(() => ctx?.window.close());

test('each exam type opens with its template on screen, ready to copy', async () => {
  for (const type of TYPES) {
    await startExam(type);
    const panel = $('.exam-template-panel');
    assert.ok(panel, `${type}: the template panel is part of the form`);
    assert.equal(panel.dataset.examType, type, `${type}: the panel belongs to this exam type`);
    assert.equal(panel.closest('details'), null, `${type}: the teacher does not have to open a folded section`);
    assert.match(panel.querySelector('h3').textContent, /প্রশ্নের টেমপ্লেট/);
    assert.ok(panel.querySelector('[data-exam-action="copy-template"]'), `${type}: copy action`);
    assert.ok(panel.querySelector('[data-exam-action="use-template"]'), `${type}: insert action`);

    const options = ctx.$$('[data-template-index] option');
    assert.equal(options.length, EXAM_SAMPLE_TEMPLATES[type].length, `${type}: the picker lists this type’s samples`);
    const copyBox = $('[data-copy-template]');
    assert.equal(copyBox.readOnly, true, 'the template box is for copying');
    assert.equal(copyBox.value, EXAM_SAMPLE_TEMPLATES[type][0][1], 'it starts on the first sample');
    assert.ok(parseQuestions(copyBox.value, type).length >= 1, `${type}: the shown template is valid`);
  }
});

test('choosing another sample, inserting it and copying it all work', async () => {
  const type = 'written';
  await startExam(type);
  const copyBox = $('[data-copy-template]');
  $('[data-template-index]').value = '1';
  $('[data-template-index]').dispatchEvent(new ctx.window.Event('change'));
  assert.equal(copyBox.value, EXAM_SAMPLE_TEMPLATES[type][1][1], 'the box follows the picker');

  ctx.click($('[data-exam-action="use-template"]'));
  assert.equal($('[name=template]').value, EXAM_SAMPLE_TEMPLATES[type][1][1], 'the paste box is filled');
  await ctx.waitFor(() => /প্রশ্ন/.test($('[data-parsed-preview]').textContent));
  assert.match($('[data-parsed-preview]').textContent, /প্রশ্ন/, 'the pasted template is previewed');

  ctx.click($('[data-exam-action="copy-template"]'));
  await ctx.flush(10);
  assert.ok(copyBox.value.includes('প্রশ্ন'), 'the copy box still holds the template text');
  assert.equal(ctx.jsdomErrors.length, 0, 'no error while using the templates');
});

test('the 30-question MCQ sample belongs to the MCQ editor alone', async () => {
  await startExam('mcq');
  assert.ok($('[data-exam-action="sample-30"]'), 'MCQ keeps the 30-sample buttons');
  ctx.click($('[data-exam-action="sample-30"]'));
  assert.equal($('[name=template]').value.split('---').length, 30, 'thirty MCQ questions are inserted');

  await startExam('written');
  assert.equal($('[data-exam-action="sample-30"]'), null, 'a written paper is not offered MCQ samples');
  assert.ok($('[data-exam-action="use-template"]'), 'it has its own template actions');
});
