/* A lecture sheet must NEVER go live while its parent chapter stays an
   unpublished draft — students' `listCourseContent` hides every non-chapter
   record whose chapter is not published+active, so a swallowed chapter
   publish used to leave the sheet loudly "published" yet permanently
   invisible in the student panel (with zero error on any screen).

   Regression pins:
     1. A teacher who cannot publish the linked chapter gets the whole
        publish refused, and NO lecture-sheet record is stored.
     2. A teacher who owns the chapter scope gets the sheet published AND
        the parent chapter published atomically (students can see it). */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { classByName, subjectsForClass } from '../js/academics.js';
import { saveTeacherAssignment } from '../js/teacher-assignments.js';
import { saveCourseRecord, listCourseContent, listCourseContentForStaff } from '../js/course-content.js';
import { saveLectureSheet, setLectureSheetLifecycle } from '../js/lecture-sheet-store.js';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';

const CLASS_10 = 'দশম শ্রেণি';
const MATH = 'গণিত';
const ENGLISH = 'ইংরেজি';

let ctx;
let englishChapterId = '';
before(async () => {
  ctx = await loadPage('admin.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  await provisionStaff('admin');
  await provisionStaff('manager');
  await provisionStaff('teacher');

  // Teacher covers ONLY দশম শ্রেণি → গণিত. (Manager issues assignments.)
  seedStaffSession(ctx.window, 'manager');
  await saveTeacherAssignment({
    teacherUsername: STAFF_ACCOUNTS.teacher.username,
    className: CLASS_10,
    group: 'বিজ্ঞান',
    subjects: [MATH]
  });

  // Admin creates an UNPUBLISHED English chapter (outside the teacher's scope).
  seedStaffSession(ctx.window, 'admin');
  const banglaSub = subjectsForClass(CLASS_10).find(s => s.name === ENGLISH);
  const chapter = await saveCourseRecord({
    classId: classByName(CLASS_10).id,
    subjectId: banglaSub.id,
    type: 'chapter',
    title: 'ইংরেজি অধ্যায় — গ্রামার ভিত্তি',
    published: false,
    active: true,
    content: ''
  }, { role: 'admin', actor: 'Test Admin' });
  englishChapterId = chapter.id;

  // Admin also creates a published-scope গণিত chapter the teacher may use.
  const mathSub = subjectsForClass(CLASS_10).find(s => s.name === MATH);
  const mathChapter = await saveCourseRecord({
    classId: classByName(CLASS_10).id,
    subjectId: mathSub.id,
    type: 'chapter',
    title: 'গণিত অধ্যায় — বীজগণিত',
    published: true,
    active: true,
    content: ''
  }, { role: 'admin', actor: 'Test Admin' });
  ctx.mathChapterId = mathChapter.id;
});

test('a teacher who cannot publish the linked chapter gets the publish refused and nothing is stored', async () => {
  seedStaffSession(ctx.window, 'teacher');
  await assert.rejects(
    () => saveLectureSheet({
      className: CLASS_10,
      subjectName: ENGLISH,
      group: 'বিজ্ঞান',
      chapterId: englishChapterId,
      title: 'স্কপের বাইরের ইংরেজি শিট',
      docJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
      status: 'published'
    }, { role: 'teacher', actor: 'শিক্ষক তানভীর' }),
    error => error instanceof Error
  );
  const leaked = listCourseContent({ publishedOnly: false, includeInactive: true })
    .find(record => record.title === 'স্কপের বাইরের ইংরেজি শিট');
  assert.equal(leaked, undefined, 'no sheet record reached the store');
});

test('a teacher publishing inside scope publishes sheet AND parent chapter together', async () => {
  seedStaffSession(ctx.window, 'teacher');
  // Teacher creates their ownগণিত sheet under the admin-made গণিত chapter.
  const saved = await saveLectureSheet({
    className: CLASS_10,
    subjectName: MATH,
    group: 'বিজ্ঞান',
    chapterId: ctx.mathChapterId,
    title: 'স্কোপ-অভ্যন্তরের গণিত শিট',
    docJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'বীজগণিতের নিয়ম।' }] }] },
    status: 'published'
  }, { role: 'teacher', actor: 'শিক্ষক তানভীর' });
  assert.equal(saved.published, true, 'sheet is published');
  const parent = listCourseContent({ publishedOnly: false, includeInactive: true })
    .find(record => record.id === saved.chapterId);
  assert.equal(parent?.published, true, 'parent chapter went live with the sheet');
  const visible = listCourseContent({
    classId: saved.classId, subjectId: saved.subjectId, group: 'বিজ্ঞান', groupScoped: true, publishedOnly: true
  });
  assert.equal(visible.some(record => record.id === saved.id), true, 'students in scope see the sheet');
});

test('unpublish/publish round trip keeps the parent chapter gate satisfied', async () => {
  seedStaffSession(ctx.window, 'teacher');
  const saved = await saveLectureSheet({
    className: CLASS_10,
    subjectName: MATH,
    group: 'বিজ্ঞান',
    chapterId: ctx.mathChapterId,
    title: 'পুনরায় প্রকাশের শিট',
    docJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'পুনর্মূল্যায়ন।' }] }] },
    status: 'published'
  }, { role: 'teacher', actor: 'শিক্ষক তানভীর' });
  await setLectureSheetLifecycle(saved.id, 'unpublish', { role: 'teacher', actor: 'শিক্ষক তানভীর' });
  const hiddenRows = await listCourseContentForStaff({ classId: saved.classId, subjectId: saved.subjectId, group: 'বিজ্ঞান' }, { role: 'teacher' });
  const hidden = hiddenRows.find(record => record.id === saved.id);
  assert.equal(hidden?.published, false, 'unpublish flips the sheet off');
  await setLectureSheetLifecycle(saved.id, 'publish', { role: 'teacher', actor: 'শিক্ষক তানভীর' });
  const parent = listCourseContent({ publishedOnly: false, includeInactive: true })
    .find(record => record.id === saved.chapterId);
  assert.equal(parent?.published, true, 're-publish restores the chapter too');
  const again = listCourseContent({
    classId: saved.classId, subjectId: saved.subjectId, group: 'বিজ্ঞান', groupScoped: true, publishedOnly: true
  });
  assert.equal(again.some(record => record.id === saved.id), true);
});
