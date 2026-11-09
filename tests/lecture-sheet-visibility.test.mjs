/* Lecture Sheet publish → student visibility.
 *
 * Why this exists: publishing a lecture sheet writes the record to the
 * authoring device's localStorage first; students only receive it once the
 * sync bridge pushes the `courseContent` collection to the cloud AND the
 * student's shelf filters accept it. Two separate failure modes used to
 * make a "published" sheet invisible:
 *
 *   1. Cloud leaf budget — Supabase enforces `octet_length(val::text) <=
 *      512 KiB` per row, and one oversized lecture-sheet leaf aborts the
 *      WHOLE collection merge on every device. The admin saw "প্রকাশিত",
 *      the student saw nothing, and no error was shown anywhere. The save /
 *      publish path must now refuse (or shed history) BEFORE the record is
 *      persisted.
 *   2. Shelf subject filter — course-library records carry `subjectName`,
 *      never the legacy `subject` field, so picking any subject in the
 *      উপকরণ/সাজেশন shelf used to hide every published record.
 *
 * These tests pin both behaviours end to end.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { STORAGE_KEYS } from '../js/config.js';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import {
  listCourseContent,
  ensureSyncLeafBudget,
  syncLeafBytes,
  SYNC_LEAF_SAFE_BYTES
} from '../js/course-content.js';
import { saveLectureSheet } from '../js/lecture-sheet-store.js';
import { initStudentStudySections } from '../js/student-study-sections.js';
import { renderLatexMathML } from '../vendor/lecture-studio/sdk.js';

const CLASS_10 = 'দশম শ্রেণি';
const STUDENT_OWN = Object.freeze({
  id: 'STD-LS-10',
  name: 'আরিফ রহমান',
  className: CLASS_10,
  group: 'বিজ্ঞান বিভাগ',
  studentMobile: '01711112222',
  guardianMobile: '01811112222',
  status: 'approved'
});
const OTHER_GROUP_STUDENT = Object.freeze({
  id: 'STD-LS-10-ARTS',
  name: 'নাদিয়া সুলতানা',
  className: CLASS_10,
  group: 'মানবিক বিভাগ',
  studentMobile: '01755556666',
  guardianMobile: '01855556666',
  status: 'approved'
});
const PUBLISHED_TITLE = 'লেকচার শিট — বীজগণিতীয় ভগ্নাংশ';

const docOf = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const bigDocOf = chunks => ({
  type: 'doc',
  content: Array.from({ length: chunks }, () => ({
    type: 'paragraph',
    content: [{ type: 'text', text: 'বাংলা '.repeat(2400) }]
  }))
});

let ctx;
before(async () => {
  ctx = await loadPage('student.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [ROSTER_KEY]: JSON.stringify([STUDENT_OWN, OTHER_GROUP_STUDENT])
    }
  });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
});

test('cloud leaf budget: oldest history snapshots are shed until the record fits', () => {
  const now = new Date().toISOString();
  const snap = version => ({
    version,
    savedAt: now,
    savedBy: 'admin',
    title: 'হিস্ট্রি স্ন্যাপশট',
    subtitle: '',
    topic: '',
    status: 'published',
    pageSettings: {},
    docJson: docOf('x'.repeat(120000)),
    richContent: '',
    content: ''
  });
  const oversizedHistory = [snap(5), snap(4), snap(3), snap(2)];
  const record = {
    id: 'CONTENT-9001', classId: 'cls', subjectId: 'sub', type: 'lesson',
    title: 'ইতিহাস trim test', isLectureSheet: true, published: true, active: true,
    docJson: docOf('ছোট'), richContent: '', content: '', history: oversizedHistory
  };
  assert.ok(syncLeafBytes(record) > SYNC_LEAF_SAFE_BYTES, 'fixture starts over budget');
  const trimmed = ensureSyncLeafBudget(record);
  assert.ok(syncLeafBytes(trimmed) <= SYNC_LEAF_SAFE_BYTES, 'trimmed record fits the cloud leaf');
  assert.ok(trimmed.history.length < oversizedHistory.length, 'oldest snapshots were dropped');
  assert.equal(trimmed.history[0].version, 5, 'the newest snapshot survives');
});

test('cloud leaf budget: a sheet that fits only with no history and still does not fit is refused loudly', () => {
  const record = {
    id: 'CONTENT-9002', classId: 'cls', subjectId: 'sub', type: 'lesson',
    title: 'বিশাল শিট', isLectureSheet: true, published: true, active: true,
    docJson: docOf('x'.repeat(400000)), richContent: '', content: '', history: []
  };
  assert.throws(
    () => ensureSyncLeafBudget(record),
    error => error?.code === 'LEAF_TOO_BIG' && /সিঙ্ক/.test(error.message)
  );
});

test('publishing an oversized lecture sheet fails loudly and writes nothing', async () => {
  await assert.rejects(
    () => saveLectureSheet({
      className: CLASS_10,
      subjectName: 'গণিত',
      title: 'বিশাল শিট',
      docJson: bigDocOf(12),
      status: 'published'
    }, { role: 'admin', actor: 'Test Admin', renderMath: renderLatexMathML }),
    error => error?.code === 'LEAF_TOO_BIG'
  );
  const stored = listCourseContent({ publishedOnly: false, includeInactive: true });
  assert.equal(stored.some(record => record.title === 'বিশাল শিট'), false, 'nothing oversized reached the store');
});

test('a normal published lecture sheet reaches the matching student shelf — and survives the subject filter', async () => {
  const saved = await saveLectureSheet({
    className: CLASS_10,
    subjectName: 'গণিত',
    group: 'বিজ্ঞান বিভাগ',
    chapterName: 'অধ্যায় ৫: বীজগণিতীয় ভগ্নাংশ',
    topic: 'লসাগু ও গসাগু',
    title: PUBLISHED_TITLE,
    docJson: docOf('লসাগু নির্ণয়ের নিয়ম: মৌলিক উৎপাদকে বিশ্লেষণ করো।'),
    status: 'published'
  }, { role: 'admin', actor: 'Test Admin', renderMath: renderLatexMathML });
  assert.equal(saved.published, true);
  assert.ok(saved.chapterId, 'auto-created chapter is linked');

  const chapterRecord = listCourseContent({ publishedOnly: false, includeInactive: true })
    .find(record => record.id === saved.chapterId);
  assert.ok(chapterRecord, 'chapter record exists in the store');
  assert.equal(chapterRecord.published, true, 'chapter went live together with the sheet');

  // The student scope: same class + same batch sees the sheet.
  const ownList = listCourseContent({
    classId: saved.classId, subjectId: saved.subjectId, group: STUDENT_OWN.group,
    groupScoped: true, publishedOnly: true
  });
  assert.equal(ownList.some(record => record.id === saved.id), true, 'own class+batch student sees the sheet');

  // A different batch in the same class must not see a batch-scoped sheet.
  const otherList = listCourseContent({
    classId: saved.classId, subjectId: saved.subjectId, group: OTHER_GROUP_STUDENT.group,
    groupScoped: true, publishedOnly: true
  });
  assert.equal(otherList.some(record => record.id === saved.id), false, 'other batch does not see a batch-scoped sheet');

  // Sign the student in (locally) and mount the real study sections.
  const account = { status: 'active', student: STUDENT_OWN };
  ctx.window.localStorage.setItem(STORAGE_KEYS.account, JSON.stringify(account));
  ctx.window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
  const sections = initStudentStudySections({ getStudent: () => STUDENT_OWN });
  await sections.refresh();

  const shelf = () => ctx.window.document.querySelector('#studyMaterialsList')?.innerHTML || '';
  assert.match(shelf(), new RegExp(PUBLISHED_TITLE), 'the উপকরণ shelf renders the published sheet');
  assert.doesNotMatch(shelf(), /পাওয়া যায়নি/, 'the empty state is not shown');

  // Regression: course records carry `subjectName`, never `subject`. Picking a
  // subject in the shelf must not hide every published record.
  const subjectSelect = ctx.window.document.querySelector('#studyMaterialSubject');
  assert.ok(subjectSelect, 'subject filter exists');
  assert.match(subjectSelect.innerHTML, /গণিত/);
  subjectSelect.value = 'গণিত';
  subjectSelect.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.match(shelf(), new RegExp(PUBLISHED_TITLE), 'the sheet stays visible when the subject filter is set');
});

test('a batch-scoped sheet stays on its own batch for another student in the UI', async () => {
  const account = { status: 'active', student: OTHER_GROUP_STUDENT };
  ctx.window.localStorage.setItem(STORAGE_KEYS.account, JSON.stringify(account));
  const sections = initStudentStudySections({ getStudent: () => OTHER_GROUP_STUDENT });
  await sections.refresh();
  const shelf = ctx.window.document.querySelector('#studyMaterialsList')?.innerHTML || '';
  assert.doesNotMatch(shelf, new RegExp(PUBLISHED_TITLE), 'মানবিক বিভাগ student does not see the বিজ্ঞান বিভাগ sheet');
});

test('the sync payload itself sheds an oversized legacy record instead of aborting the whole courseContent sync', async () => {
  const { collectionPayload } = await import('../js/sync-collections.js');
  const now = new Date().toISOString();
  const snap = version => ({
    version, savedAt: now, savedBy: 'admin', title: 'স্ন্যাপশট', subtitle: '', topic: '', status: 'published',
    pageSettings: {}, docJson: docOf('x'.repeat(150000)), richContent: '', content: ''
  });
  const giant = {
    id: 'CONTENT-9010', classId: 'cls', subjectId: 'sub', type: 'lesson',
    title: 'পুরনো বিশাল শিট', isLectureSheet: true, published: true, active: true,
    docJson: docOf('বাংলা'), richContent: '', content: '', updatedAt: now,
    history: [snap(5), snap(4), snap(3), snap(2)]
  };
  const local = { version: 1, updatedAt: now, createdBy: 'admin.apc', records: [giant] };
  const payload = collectionPayload('courseContent', local);
  const shipped = payload['CONTENT-9010'].record;
  assert.ok(syncLeafBytes(shipped) <= SYNC_LEAF_SAFE_BYTES, 'the cloud-bound leaf after shedding fits the budget');
  assert.ok(shipped.history.length < giant.history.length, 'oldest snapshots were dropped for the cloud copy');
  assert.equal(giant.history.length, 4, 'the local record is never mutated by the payload builder');
});
