/* কেন্দ্রীয় Work Registry-র চুক্তি (২০২৬-১১-১১)।

   এই টেস্ট কোনো UI নয় — Registry নিজেই সত্য কি না তা যাচাই করে:
     • প্রতিটি এন্ট্রির প্রতিটি বাধ্যতামূলক ফিল্ড আছে;
     • প্রতিটি ফিচার Student Panel-এর একটি বাস্তব view-তে যায়;
     • প্রতিটি store/key/repository সত্যিই প্রজেক্টে আছে;
     • শিক্ষক যা পারেন না (পরীক্ষা প্রকাশ) তা Registry-ও বলতে পারে না;
     • scope-এর বাইরে কিছু তৈরি করা যায় না। */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  APPROVAL, OWNERS, STUDENT_VIEWS, WORK_CATEGORIES, WORK_FEATURES, WORK_STATUSES,
  featureById, featuresOf, filterByStatus, planWork, recordStatus, requiresApproval,
  scopeWithinAssignment, statusMeta, teacherCan, teacherFeatures, validateWorkRegistry,
  workRegistrySummary
} from '../js/work-registry.js';
import { KEYS } from '../js/database.js';

const nfc = value => String(value ?? '').normalize('NFC');
const studentHtml = readFileSync(new URL('../student.html', import.meta.url), 'utf8');
const studentViews = new Set([...studentHtml.matchAll(/data-view-panel="([^"]+)"/g)].map(match => match[1]));

test('the registry is internally complete — no feature can be added half-declared', () => {
  const report = validateWorkRegistry();
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.count, WORK_FEATURES.length);
  assert.equal(new Set(WORK_FEATURES.map(feature => feature.id)).size, WORK_FEATURES.length, 'ids are unique');
});

test('every feature lands on a real Student Panel view that exists in student.html', () => {
  for (const feature of WORK_FEATURES) {
    assert.ok(studentViews.has(feature.student.view),
      `${feature.id} → student view "${feature.student.view}" is not in student.html`);
    assert.ok(Object.values(STUDENT_VIEWS).includes(feature.student.view), `${feature.id} uses a declared view`);
    assert.equal(nfc(feature.student.panel).length > 0, true, `${feature.id} names its student panel section`);
  }
});

test('every declared store and repository exists in the codebase', () => {
  const knownKeys = new Set(Object.values(KEYS));
  const repositoryFiles = {
    teachingRepository: 'js/teaching-data.js',
    courseRepository: 'js/course-data.js',
    'course-content.js': 'js/course-content.js',
    questionBank: 'js/question-bank.js',
    examRepository: 'js/exam-data.js',
    'office-data.js saveNotices': 'js/office-data.js',
    'office-data.js loadRoutine': 'js/office-data.js',
    'class-chat.js': 'js/class-chat.js'
  };
  for (const feature of WORK_FEATURES) {
    assert.ok(knownKeys.has(feature.store.key), `${feature.id} store key ${feature.store.key} is a real KEYS entry`);
    assert.match(feature.store.path, /^activePlusSync\/v1\//, `${feature.id} uses the live RTDB root`);
    const file = repositoryFiles[feature.store.repository];
    assert.ok(file, `${feature.id} names a repository the audit knows`);
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${feature.id} repository file exists`);
  }
});

test('the Teacher can publish daily content but never publish an exam alone', () => {
  assert.equal(teacherCan('homework', 'publish'), true);
  assert.equal(teacherCan('suggestion', 'publish'), true);
  assert.equal(teacherCan('notice', 'publish'), true);
  assert.equal(teacherCan('online-exam', 'publish'), false, 'exam publication belongs to Admin/Manager');
  assert.equal(teacherCan('exam-marks', 'publish'), false, 'results publication is approval-gated');
  assert.equal(requiresApproval('online-exam'), true);
  assert.equal(requiresApproval('homework'), false);
  /* Read-only institutional surfaces cannot be created even if someone calls
     the registry directly. */
  assert.equal(teacherCan('class-routine', 'create'), false);
  assert.equal(teacherCan('course-chapter', 'create'), false);
  assert.equal(featureById('class-routine').owner, OWNERS.MANAGER);
});

test('the exam plan offers approval submission, never a publish button', () => {
  const plan = planWork({
    featureId: 'online-exam',
    role: 'teacher',
    scope: { className: 'দশম শ্রেণি', subject: 'গণিত' },
    assignments: [{ className: 'দশম শ্রেণি', group: '', subjects: ['গণিত'] }]
  });
  assert.equal(plan.ok, true, plan.blocked.join(', '));
  const ids = plan.actions.map(action => action.id);
  assert.ok(ids.includes('approval'));
  assert.equal(ids.includes('publish'), false, 'no direct publish action for an exam');
  assert.equal(plan.approval, APPROVAL.ADMIN_MANAGER);
});

test('a homework plan is direct, but only inside the teacher’s assignment', () => {
  const base = { featureId: 'homework', role: 'teacher', scope: { className: 'দশম শ্রেণি', subject: 'গণিত' }, assignments: [{ className: 'দশম শ্রেণি', group: '', subjects: ['গণিত'] }] };
  const allowed = planWork(base);
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.actions.map(action => action.id), ['draft', 'publish', 'preview']);

  const missingClass = planWork({ ...base, scope: {} });
  assert.equal(missingClass.ok, false);
  assert.match(missingClass.blocked.join(' '), /শ্রেণি/);

  const otherClass = planWork({ ...base, scope: { className: 'একাদশ শ্রেণি', subject: 'গণিত' } });
  assert.equal(otherClass.ok, false);
  assert.match(otherClass.blocked.join(' '), /অ্যাসাইনমেন্ট/);

  const otherSubject = planWork({ ...base, scope: { className: 'দশম শ্রেণি', subject: 'ইংরেজি' } });
  assert.equal(otherSubject.ok, false, 'a subject outside the assignment is refused');
});

test('scope matching respects class, group and subject, and ignores the legacy Test placeholder', () => {
  const feature = featureById('homework');
  const rows = [{ className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ', subjects: ['গণিত', 'ইংরেজি'] }];
  assert.equal(scopeWithinAssignment(feature, { className: 'দশম শ্রেণি', subject: 'গণিত' }, rows), true);
  assert.equal(scopeWithinAssignment(feature, { className: 'দশম শ্রেণি', subject: 'ইংরেজি', group: 'বিজ্ঞান বিভাগ' }, rows), true);
  assert.equal(scopeWithinAssignment(feature, { className: 'দশম শ্রেণি', subject: 'ইংরেজি', group: 'মানবিক' }, rows), false);
  assert.equal(scopeWithinAssignment(feature, { className: 'নবম শ্রেণি' }, rows), false);
  assert.equal(scopeWithinAssignment(feature, { className: 'দশম শ্রেণি' }, [{ className: 'দশম শ্রেণি', group: '', subjects: ['Test'] }]), true);
});

test('status labels map to the stored statuses, nothing is invented', () => {
  const stored = new Set(['draft', 'published']);
  for (const status of stored) assert.ok(WORK_STATUSES[status], `${status} has a Bengali label`);
  assert.equal(statusMeta('pending').label, 'অনুমোদনের অপেক্ষায়');
  assert.equal(recordStatus({ status: 'published' }), 'published');
  assert.equal(recordStatus({ published: true }), 'published');
  assert.equal(recordStatus({ published: false }), 'draft');
  assert.equal(recordStatus({}), 'draft');
  assert.equal(recordStatus({ status: 'something-new' }), 'draft', 'unknown statuses never leak through');

  const rows = [{ status: 'draft' }, { status: 'published' }, { status: 'pending' }, { status: 'rejected' }];
  assert.equal(filterByStatus(rows, 'all').length, 4);
  assert.equal(filterByStatus(rows, 'draft').length, 2, 'rejected work stays in the draft lane');
  assert.equal(filterByStatus(rows, 'published').length, 1);
});

test('every category has at least one creatable feature and the registry summary agrees', () => {
  for (const category of WORK_CATEGORIES) {
    assert.ok(featuresOf(category.id, { includeReadOnly: false }).length > 0, `${category.id} has a creatable feature`);
  }
  const summary = workRegistrySummary();
  assert.equal(summary.total, WORK_FEATURES.length);
  assert.equal(summary.creatable, teacherFeatures().length);
  assert.deepEqual(summary.readOnly.sort(), ['class-routine', 'course-chapter']);
  assert.ok(summary.approvalGated.includes('online-exam'));
});

test('the core student features are all reachable from the registry', () => {
  const required = ['homework', 'suggestion', 'lecture-sheet', 'class-note', 'question-bank', 'online-exam', 'notice', 'attendance', 'exam-marks'];
  for (const id of required) assert.ok(featureById(id), `${id} is registered`);
  assert.equal(featureById('homework').student.view, 'homework');
  assert.equal(featureById('online-exam').student.view, 'exams');
  assert.equal(featureById('attendance').student.view, 'class-attendance');
  assert.equal(featureById('notice').student.view, 'notice-board');
  assert.equal(featureById('question-bank').student.view, 'question-bank');
});
