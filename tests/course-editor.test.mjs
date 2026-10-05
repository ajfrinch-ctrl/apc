/* পড়াশোনা পরিচালনা করুন — the learning-library editor shared by the Teacher and
   Manager panels.

   The school's rules:
     • a Teacher writes only for the class AND subject Manager assigned to them;
     • a Manager works inside the Admin-configured structure (Academic Setup);
     • publish / unpublish / archive are the only life-cycle actions — nothing is
       ever hard-deleted, and an archived record stays on disk. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { initCourseEditor } from '../js/course-editor.js';
import { COURSE_CONTENT_KEY, archiveCourseRecord, contentById, listCourseContent, listCourseContentForStaff, saveCourseRecord, setContentPublished } from '../js/course-content.js';
import { classByName, subjectByName, subjectsForClass } from '../js/academics.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';

const TEACHER_USER = STAFF_ACCOUNTS.teacher.username;
let ctx;

let hosts = 0;
function mount() {
  const host = ctx.window.document.createElement('div');
  host.id = `courseEditorHost${hosts += 1}`;
  ctx.$('#coursesView').appendChild(host);
  return `#${host.id}`;
}

/* A real user picks from a <select>: value + a bubbling change event. */
function change(select, value) {
  const option = Array.from(select.options).find(item => item.value === value);
  assert.ok(option, `option ${value} is offered`);
  select.value = value;
  select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  return option;
}

before(async () => {
  ctx = await loadPage('index.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [TEACHER_ASSIGNMENTS_KEY]: JSON.stringify([{
        id: 'ASSIGN-0001', teacherUsername: TEACHER_USER, teacherName: 'নমুনা শিক্ষক',
        className: 'দশম শ্রেণি', group: '', subjects: ['গণিত'], active: true
      }])
    }
  });
  /* The Teacher's own account is what decides their scope, exactly like the
     real panel: without it they have no assigned class at all. */
  await provisionStaff('teacher');
  await provisionStaff('manager');
  seedStaffSession(ctx.window, 'teacher');
  seedStaffSession(ctx.window, 'manager');
});
after(() => ctx?.window.close());

test('a Teacher sees only the assigned class and its assigned subject', async () => {
  initCourseEditor({ mount: mount(), role: 'teacher', actor: 'নমুনা শিক্ষক' });
  await ctx.waitFor(() => ctx.$$('#courseEditorHost1 form select').length > 0);
  /* The teacher account is read asynchronously; wait for the scoped paint. */
  await ctx.waitFor(() => Array.from(ctx.$('#courseEditorHost1 select[name="className"]').options).length === 1);
  const classes = Array.from(ctx.$('#courseEditorHost1 select[name="className"]').options).map(option => option.value);
  assert.deepEqual(classes, ['দশম শ্রেণি'], 'only the assigned class is offered');
  const subjects = Array.from(ctx.$('#courseEditorHost1 select[name="subject"]').options).map(option => option.value);
  assert.deepEqual(subjects, ['গণিত'], 'only the assigned subject of that class is offered');
});

test('the Teacher editor refuses a subject that is not theirs and stores nothing', () => {
  const before = ctx.window.localStorage.getItem(COURSE_CONTENT_KEY);
  /* Bypass the scoped select on purpose: the submit handler is the last gate. */
  const form = ctx.$('#courseEditorHost1 form');
  const subject = ctx.$('#courseEditorHost1 select[name="subject"]');
  const rogue = ctx.window.document.createElement('option');
  rogue.value = 'পদার্থবিজ্ঞান';
  subject.appendChild(rogue);
  subject.value = 'পদার্থবিজ্ঞান';
  ctx.type(ctx.$('#courseEditorHost1 input[name="title"]'), 'বাইরে লেখা কনটেন্ট');
  ctx.submit(form);
  assert.match(ctx.$('#courseEditorHost1 [data-course-status]').textContent, /বরাদ্দ নয়/);
  assert.equal(ctx.window.localStorage.getItem(COURSE_CONTENT_KEY), before, 'nothing was written');
});

test('the Teacher editor saves inside the assignment and can publish, then archive', async () => {
  /* Back to the subject that really is theirs after the refused attempt. */
  change(ctx.$('#courseEditorHost1 select[name="subject"]'), 'গণিত');
  ctx.type(ctx.$('#courseEditorHost1 input[name="title"]'), 'বরাদ্দের ভেতরের পাঠ');
  ctx.type(ctx.$('#courseEditorHost1 textarea[name="content"]'), 'পাঠের মূল লেখা');
  ctx.submit(ctx.$('#courseEditorHost1 form'));
  await ctx.waitFor(() => /সংরক্ষিত হয়েছে/.test(ctx.$('#courseEditorHost1 [data-course-status]').textContent));
  const subject = subjectByName('গণিত');
  const [record] = await listCourseContentForStaff(
    { classId: classByName('দশম শ্রেণি').id, subjectId: subject.id, includeInactive: true },
    { role: 'teacher', actor: 'নমুনা শিক্ষক' }
  );
  assert.equal(record.title, 'বরাদ্দের ভেতরের পাঠ');
  assert.equal(record.published, false, 'it starts as a draft');
  assert.equal(listCourseContent({ classId: record.classId, subjectId: record.subjectId, publishedOnly: false }).some(item => item.id === record.id), false,
    'the general/student read API stays published-only even when a caller requests drafts');
  assert.equal(record.createdBy, STAFF_ACCOUNTS.teacher.username, 'the repository resolves the signed-in Teacher as author');
  assert.equal(record.active, true);

  ctx.click(ctx.$(`#courseEditorHost1 [data-course-publish="${record.id}"]`));
  await ctx.waitFor(() => contentById(record.id).published === true);
  ctx.click(ctx.$(`#courseEditorHost1 [data-course-archive="${record.id}"]`));
  await ctx.waitFor(() => contentById(record.id).active === false);
  const archived = contentById(record.id);
  assert.ok(archived, 'archiving never deletes the record');
  assert.equal(archived.title, 'বরাদ্দের ভেতরের পাঠ', 'the writing survives');
});

test('Teacher draft reads and lifecycle writes cannot cross authors, while Manager can review them', async () => {
  const classId = classByName('দশম শ্রেণি').id;
  const subjectId = subjectByName('গণিত').id;
  const foreign = {
    id: 'CONTENT-FOREIGN-DRAFT', classId, subjectId, group: '', chapterId: '', type: 'note',
    title: 'অন্য শিক্ষকের খসড়া', description: '', content: '', attachmentUrl: '', thumbnail: '',
    createdBy: 'other.teacher', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    published: false, active: true
  };
  const stored = JSON.parse(ctx.window.localStorage.getItem(COURSE_CONTENT_KEY));
  stored.records.push(foreign);
  ctx.window.localStorage.setItem(COURSE_CONTENT_KEY, JSON.stringify(stored));
  const scope = { classId, subjectId, includeInactive: true };
  const teacherRows = await listCourseContentForStaff(scope, { role: 'teacher', actor: 'TEACHER' });
  assert.equal(teacherRows.some(item => item.id === foreign.id), false, 'a Teacher does not read another Teacher’s draft');
  await assert.rejects(setContentPublished(foreign.id, true, { role: 'teacher', actor: 'TEACHER' }), /অন্য শিক্ষকের/);
  await assert.rejects(saveCourseRecord({ ...foreign, title: 'চুরি করে সম্পাদনা' }, { role: 'teacher', actor: 'TEACHER' }), /অন্য শিক্ষকের/);

  const managerRows = await listCourseContentForStaff(scope, { role: 'manager', actor: 'MANAGER' });
  assert.equal(managerRows.some(item => item.id === foreign.id), true, 'Manager can review the draft');
  const published = await setContentPublished(foreign.id, true, { role: 'manager', actor: 'MANAGER' });
  assert.equal(published.published, true);
  const teacherPublishedRows = await listCourseContentForStaff(scope, { role: 'teacher', actor: 'TEACHER' });
  assert.equal(teacherPublishedRows.some(item => item.id === foreign.id), true, 'published course content is visible inside the assigned scope');
  await assert.rejects(archiveCourseRecord(foreign.id, { role: 'teacher', actor: 'TEACHER' }), /অন্য শিক্ষকের/);
});

test('a Manager works within the whole Admin-configured structure', async () => {
  const host = mount();
  initCourseEditor({ mount: host, role: 'manager', actor: 'MANAGER' });
  await ctx.waitFor(() => ctx.$(`${host} select[name="className"]`)?.options.length > 0);
  const classes = Array.from(ctx.$(`${host} select[name="className"]`).options).map(option => option.value);
  assert.ok(classes.length >= 3, 'every enabled class is offered');
  assert.ok(classes.includes('নবম শ্রেণি'));
  assert.ok(!classes.some(name => /নেই|ভুয়া/.test(name)), 'only Academic Setup classes appear');
  const subjects = Array.from(ctx.$(`${host} select[name="subject"]`).options).map(option => option.value);
  assert.ok(subjects.includes(subjectByName('গণিত').name));
  /* Switching class re-cascades the subject list from the same source. */
  const ninth = classByName('নবম শ্রেণি');
  change(ctx.$(`${host} select[name="className"]`), 'নবম শ্রেণি');
  await ctx.waitFor(() => ctx.$(`${host} select[name="className"]`)?.value === ninth.name
    && JSON.stringify(Array.from(ctx.$(`${host} select[name="subject"]`)?.options || []).map(option => option.value))
      === JSON.stringify(subjectsForClass('নবম শ্রেণি').map(item => item.name)));
  const after = Array.from(ctx.$(`${host} select[name="subject"]`).options).map(option => option.value);
  assert.deepEqual(after, subjectsForClass('নবম শ্রেণি').map(item => item.name), 'the subjects follow the chosen class');
  assert.equal(ctx.$(`${host} select[name="className"]`).value, ninth.name);
});

test('every record carries its stable id and an archive is never a delete', async () => {
  const record = await saveCourseRecord({
    classId: classByName('দশম শ্রেণি').id, subjectId: subjectByName('বাংলা').id, type: 'note',
    title: 'Manager-এর নোট', published: true, createdBy: 'MANAGER'
  }, { actor: 'MANAGER', role: 'manager' });
  assert.match(record.id, /^CONTENT-\d{4}$/, 'the learning library has its own id series');
  const stored = () => JSON.parse(ctx.window.localStorage.getItem(COURSE_CONTENT_KEY)).records;
  assert.equal(stored().filter(row => row.id === record.id).length, 1, 'exactly one record, never a copy');
  /* A second save on the same id is an edit, not a new record. */
  const edited = await saveCourseRecord({ ...record, title: 'সম্পাদিত নোট' }, { actor: 'MANAGER', role: 'manager' });
  assert.equal(edited.id, record.id);
  assert.equal(stored().filter(row => row.id === record.id).length, 1);
  assert.equal(contentById(record.id).title, 'সম্পাদিত নোট');
});
