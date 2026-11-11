/* Teacher Panel — every class Admin/Manager assigned must be visible to that
   teacher, on their own login ID. Reported 2026-10-11: a teacher given ষষ্ঠ,
   সপ্তম and অষ্টম saw only one class, or the panel said "এখনো কোনো ক্লাস অ্যাসাইন
   করা হয়নি" while the data was still loading or had failed to load.

   Four links of one chain were broken, and each is pinned here:
     a) js/staff-management.js — the Admin's "Assigned Class" picker offered only
        the 12 built-in classes, so a class created in Academic Setup (ষষ্ঠ,
        সপ্তম, any custom class) could never be assigned at all;
     b) js/teacher-assignments.js — the directory projection ignored an empty
        `classSubjects` map, never merged it with `classes`, could not read class
        IDs, and dropped every class when the flat subject list was absent;
     c) js/teacher-assignments.js — a subject-less row was rejected as invalid,
        hiding that teacher's whole list;
     d) js/teacher.js — "no class assigned" was painted over a failed or still
        running load, and the class cards were inert, so a class could not be
        opened.

   The teacher.html leg runs LAST: loading a second page swaps the jsdom globals
   every module resolves storage against. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
// (no provisionStaff('teacher'): opening admin.html bootstraps the role account)
import { enabledClasses } from '../js/config.js';
import { ACADEMICS_KEY } from '../js/academics.js';
import { createStaff, findDirectoryStaffByUsername } from '../js/staff-directory.js';
import {
  TEACHER_ASSIGNMENTS_KEY, listTeacherAssignments, effectiveTeacherAssignments,
  directoryAssignmentRows, isTeacherAssigned
} from '../js/teacher-assignments.js';
import { saveStaffSession } from '../js/staff-auth.js';
import { collectionPayload, remoteToLocal } from '../js/sync-collections.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { adminStudents } from '../js/admin-data.js';

const nfc = value => String(value).normalize('NFC');
const sortNfc = list => list.map(nfc).sort();
const CLASS_SIX = '\u09b7\u09b7\u09cd\u09a0 \u09b6\u09cd\u09b0\u09c7\u09a3\u09bf';      // ষষ্ঠ শ্রেণি
const CLASS_SEVEN = '\u09b8\u09aa\u09cd\u09a4\u09ae \u09b6\u09cd\u09b0\u09c7\u09a3\u09bf';    // সপ্তম শ্রেণি
const CLASS_EIGHT = enabledClasses[0];                                // অষ্টম শ্রেণি
const MATH = '\u0997\u09a3\u09bf\u09a4';                              // গণিত
const ENGLISH = '\u0987\u0982\u09b0\u09c7\u099c\u09bf';               // ইংরেজি
const EMPTY_MESSAGE = '\u098f\u0996\u09a8\u09cb \u0995\u09cb\u09a8\u09cb \u0995\u09cd\u09b2\u09be\u09b8 \u0985\u09cd\u09af\u09be\u09b8\u09be\u0987\u09a8 \u0995\u09b0\u09be \u09b9\u09df\u09a8\u09bf';
const PENDING_MESSAGE = '\u0986\u09aa\u09a8\u09be\u09b0 \u0995\u09cd\u09b2\u09be\u09b8\u09c7\u09b0 \u09a4\u09a5\u09cd\u09af \u0986\u09a8\u09be \u09b9\u099a\u09cd\u099b\u09c7';

/* A school that runs classes the shipped list does not know about — exactly the
   state a real Academic Setup reaches once the Admin adds a class. */
const ACADEMICS = {
  version: 2,
  classes: [
    { id: 'class-junior-6', name: CLASS_SIX, active: true, order: 0 },
    { id: 'class-junior-7', name: CLASS_SEVEN, active: true, order: 1 },
    { id: 'class-junior-8', name: CLASS_EIGHT, active: true, order: 2 }
  ],
  subjects: [
    { id: 'sub-math', name: MATH, active: true, order: 0 },
    { id: 'sub-eng', name: ENGLISH, active: true, order: 1 }
  ],
  mappings: [
    { id: 'map-6-math', classId: 'class-junior-6', subjectId: 'sub-math', active: true },
    { id: 'map-7-math', classId: 'class-junior-7', subjectId: 'sub-math', active: true },
    { id: 'map-8-eng', classId: 'class-junior-8', subjectId: 'sub-eng', active: true }
  ],
  chapters: [],
  updatedAt: 1,
  createdBy: 'ADMIN'
};

let ctx;
let teacher = null;

before(async () => {
  ctx = await loadPage('admin.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [ACADEMICS_KEY]: JSON.stringify(ACADEMICS),
      [ROSTER_KEY]: JSON.stringify(adminStudents)
    }
  });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 1);
});

after(() => ctx?.window.close());

test('the Admin can pick a class created in Academic Setup — that is what gets assigned', async () => {
  ctx.click(ctx.$('#staffCreateButton'));
  await ctx.waitFor(() => Boolean(ctx.$('#staffForm')));
  const select = ctx.$('#staffForm').querySelector('#staffField-classes');
  assert.equal(select.multiple, true, 'একাধিক ক্লাস একসঙ্গে নির্বাচন করা যায়');
  const options = [...select.options].map(option => nfc(option.value));
  assert.ok(options.includes(nfc(CLASS_SIX)), '\u09b7\u09b7\u09cd\u09a0 \u09b6\u09cd\u09b0\u09c7\u09a3\u09bf \u09a8\u09bf\u09ac\u09be\u099a\u09a8\u09c7 \u09a5\u09be\u0995\u09c7');
  assert.ok(options.includes(nfc(CLASS_SEVEN)), '\u09b8\u09aa\u09cd\u09a4\u09ae \u09b6\u09cd\u09b0\u09c7\u09a3\u09bf \u09a8\u09bf\u09ac\u09be\u099a\u09a8\u09c7 \u09a5\u09be\u0995\u09c7');
  for (const className of enabledClasses) {
    assert.ok(options.includes(nfc(className)), `built-in ${className} stays selectable too`);
  }
});

test('a teacher assigned three classes gets three rows — none dropped', async () => {
  const created = await createStaff({
    fullName: 'Rashida Karim', role: 'teacher', status: 'active',
    mobile: '01711000222', email: 'rashida@example.com', joiningDate: '2026-01-05',
    password: 'Karim-2026', confirmPassword: 'Karim-2026',
    assignment: {
      classes: [CLASS_SIX, CLASS_SEVEN, CLASS_EIGHT],
      subjects: [MATH, ENGLISH],
      /* অষ্টম has no subject mapped yet — the Admin assigned the class only.
         It must still reach the teacher instead of vanishing from the list. */
      classSubjects: { [CLASS_SIX]: [MATH, ENGLISH], [CLASS_SEVEN]: [MATH] }
    }
  });
  assert.equal(created.ok, true, created.error);
  teacher = created.staff;
  assert.notEqual(teacher.username, 'teacher.apc');

  const rows = listTeacherAssignments(teacher.username);
  assert.deepEqual(rows.map(row => nfc(row.className)).sort(),
    [CLASS_SIX, CLASS_SEVEN, CLASS_EIGHT].map(nfc).sort(), 'store: one row per assigned class');
  const six = rows.find(row => nfc(row.className) === nfc(CLASS_SIX));
  assert.deepEqual(sortNfc(six.subjects), sortNfc([MATH, ENGLISH]), '\u09b7\u09b7\u09cd\u09a0\u09c7\u09b0 \u09ac\u09bf\u09b7\u09df \u09b9\u09c1\u09ac\u09b9\u09c1 \u09b0\u09df\u09c7\u099b\u09c7');
  const eight = rows.find(row => nfc(row.className) === nfc(CLASS_EIGHT));
  assert.deepEqual(eight.subjects, [], 'a class without subjects is still an assignment');

  const mine = await effectiveTeacherAssignments(teacher.username);
  assert.equal(mine.length, 3, 'merged read answers with all three classes');
  assert.equal(new Set(mine.map(row => row.className)).size, 3, 'no two rows collapse into one class');
  for (const className of [CLASS_SIX, CLASS_SEVEN, CLASS_EIGHT]) {
    assert.equal(isTeacherAssigned(teacher.username, className), true, `${className} belongs to this teacher's scope`);
  }
  assert.equal(isTeacherAssigned('teacher.apc', CLASS_SIX), false, 'another teacher inherits none of it');
});

test('whatever shape the record holds, every class in it is read back', async () => {
  const base = { username: 'shaped.teacher.apc', staffId: 'STF-0777', fullName: 'Shaped Teacher' };
  const shapes = {
    'per-class map': { classSubjects: { [CLASS_SIX]: [MATH], [CLASS_SEVEN]: [ENGLISH] } },
    'legacy flat lists': { classes: [CLASS_SIX, CLASS_SEVEN, CLASS_EIGHT], subjects: [MATH] },
    'comma-separated strings': { classes: `${CLASS_SIX},${CLASS_SEVEN}`, subjects: MATH },
    'class IDs from Academic Setup': { classIds: ['class-junior-6', 'class-junior-8'], subjects: [MATH] },
    'map plus classes (union)': { classSubjects: { [CLASS_SIX]: [MATH] }, classes: [CLASS_SIX, CLASS_EIGHT] },
    'a class mapped to nothing': { classSubjects: { [CLASS_SIX]: [MATH], [CLASS_EIGHT]: [] } },
    'empty map, flat list only': { classSubjects: {}, classes: [CLASS_SIX, CLASS_SEVEN], subjects: [MATH] }
  };
  const expected = {
    'per-class map': [[CLASS_SIX, [MATH]], [CLASS_SEVEN, [ENGLISH]]],
    'legacy flat lists': [[CLASS_SIX, [MATH]], [CLASS_SEVEN, [MATH]], [CLASS_EIGHT, [MATH]]],
    'comma-separated strings': [[CLASS_SIX, [MATH]], [CLASS_SEVEN, [MATH]]],
    'class IDs from Academic Setup': [[CLASS_SIX, [MATH]], [CLASS_EIGHT, [MATH]]],
    'map plus classes (union)': [[CLASS_SIX, [MATH]], [CLASS_EIGHT, []]],
    'a class mapped to nothing': [[CLASS_SIX, [MATH]], [CLASS_EIGHT, []]],
    'empty map, flat list only': [[CLASS_SIX, [MATH]], [CLASS_SEVEN, [MATH]]]
  };
  for (const [label, assignment] of Object.entries(shapes)) {
    const rows = directoryAssignmentRows({ ...base, assignment });
    assert.deepEqual(rows.map(row => [nfc(row.className), row.subjects.map(nfc)]),
      expected[label].map(([name, list]) => [nfc(name), list.map(nfc)]), label);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length, `${label}: distinct row ids`);
    assert.ok(rows.every(row => row.teacherUsername === base.username), `${label}: keyed to this teacher alone`);
  }
});

test('the rows survive the Firebase mirror with all three classes', async () => {
  const rows = listTeacherAssignments(teacher.username);
  const mirrored = collectionPayload('teacherAssignments', rows);
  assert.equal(Object.keys(mirrored).length, 3, 'Firebase-এ তিনটি সারিই ওঠে');
  const back = remoteToLocal('teacherAssignments', mirrored);
  const list = Array.isArray(back) ? back : Object.values(back || {});
  assert.equal(list.length, 3, 'three rows come back');
  assert.deepEqual(list.map(row => nfc(row.className)).sort(),
    [CLASS_SIX, CLASS_SEVEN, CLASS_EIGHT].map(nfc).sort(), 'every class name arrives intact');
  const six = list.find(row => nfc(row.className) === nfc(CLASS_SIX));
  assert.deepEqual(sortNfc(six.subjects), sortNfc([MATH, ENGLISH]), 'subjects survive the round-trip');
  assert.equal(six.teacherUsername, teacher.username, 'the row still belongs to this teacher');
});

test('the stored directory record keeps all three classes after the projection', async () => {
  const record = await findDirectoryStaffByUsername(teacher.username);
  assert.ok(record, 'the record is still there');
  assert.deepEqual(record.assignment.classes.map(nfc).sort(),
    [CLASS_SIX, CLASS_SEVEN, CLASS_EIGHT].map(nfc).sort(),
    'the projection never narrows what the Admin saved');
  assert.deepEqual(sortNfc(Object.keys(record.assignment.classSubjects || {})),
    sortNfc([CLASS_SIX, CLASS_SEVEN]), 'the per-class map is untouched');
});

/* ---- the panel itself, last ------------------------------------------------- */

test('the Teacher Panel lists all three classes, opens the clicked one, and never fakes an empty list', async () => {
  /* The directory is stored as an AES-GCM envelope keyed by the device key
     (activePlus.deviceKey.v1) — copying the whole storage IS "same device". */
  const seed = { 'activePlus.demo.autofill.v1': 'off' };
  for (let i = 0; i < ctx.window.localStorage.length; i += 1) {
    const key = ctx.window.localStorage.key(i);
    seed[key] = ctx.window.localStorage.getItem(key);
  }
  const page = await loadPage('teacher.html', { seed });
  try {
    /* A Staff-Directory teacher is identified by their own Login User ID +
       Staff ID, exactly as the real login flow stores them — never by name,
       never the built-in device account, never another teacher. */
    await saveStaffSession('teacher', true, {
      username: teacher.username, staffId: teacher.staffId, fullName: teacher.fullName
    });
    const { teacherReady } = await import('../js/teacher.js');
    if (teacherReady) await teacherReady;
    await page.waitFor(() => page.$('#teacherShell').hidden === false);
    await page.waitFor(() => page.$$('#teacherClassList .teaching-card').length === 3);

    const cards = page.$$('#teacherClassList .teaching-card');
    assert.equal(cards.length, 3, '\u09a4\u09bf\u09a8\u099f\u09bf \u0995\u09cd\u09b2\u09be\u09b8\u0987 \u0995\u09be\u09b0\u09cd\u09a1 \u09a6\u09c7\u0996\u09be\u09df');
    const text = nfc(cards.map(card => card.textContent).join(' '));
    for (const className of [CLASS_SIX, CLASS_SEVEN, CLASS_EIGHT]) {
      assert.ok(text.includes(nfc(className)), `${className} \u0995\u09be\u09b0\u09cd\u09a1\u09c7 \u0986\u099b\u09c7`);
    }
    assert.ok(text.includes(nfc(MATH)) && text.includes(nfc(ENGLISH)), '\u09ac\u09bf\u09b7\u09df\u0997\u09c1\u09b2\u09cb \u0995\u09be\u09b0\u09cd\u09a1\u09c7 \u0986\u099b\u09c7');
    assert.ok(!text.includes(nfc(EMPTY_MESSAGE)), '\u0995\u09cd\u09b2\u09be\u09b8 \u09a5\u09be\u0995\u09be\u09b0 \u0995\u09c7 "\u0995\u09cd\u09b2\u09be\u09b8 \u09a8\u09c7\u0987" \u09ac\u09b2\u09be \u09b9\u09df \u09a8\u09be');
    assert.equal(page.$$('#teacherClassList .teacher-class-hero-main').length, 3, 'প্রতিটি ক্লাস একটি হিরো কার্ড');
    assert.equal(page.$$('#teacherClassList .teacher-class-hero-art svg').length, 3, 'প্রতিটি ক্লাস কার্ডে 3D ক্লাস আইকন আছে');
    for (const row of page.$$('#teacherClassList .teacher-class-heading')) {
      assert.ok(row.querySelector('h3')?.textContent.trim(), 'কার্ডে ক্লাসের নাম আছে');
      assert.ok(row.querySelector('small')?.textContent.trim(), 'কার্ডে বিষয়/শিক্ষার্থী-সংখ্যা আছে');
    }
    assert.equal(page.$$('#teacherClassList .teacher-class-subjects').length, 3, 'বিষয়ের চিপ তালিকা সরাসরি দেখা যায়');
    assert.equal(page.$('#teacherDataError').hidden, true, '\u09ad\u09c1\u09b2 \u09a4\u09cd\u09b0\u09c1\u099f\u09bf \u09a6\u09c7\u0996\u09be\u09df \u09a8\u09be');
    const filterOptions = [...page.$('#teacherClassFilter').options].map(option => nfc(option.textContent));
    for (const className of [CLASS_SIX, CLASS_SEVEN, CLASS_EIGHT]) {
      assert.ok(filterOptions.includes(nfc(className)), `${className} \u09ab\u09bf\u09b2\u09cd\u099f\u09be\u09b0\u09c7\u0993 \u0986\u099b\u09c7`);
    }

    // Clicking a class enters that class's own existing workflow.
    const openButtons = page.$$('#teacherClassList [data-teacher-open-class]');
    assert.equal(openButtons.length, 3, '\u09aa\u09cd\u09b0\u09a4\u09bf\u099f\u09bf \u0995\u09cd\u09b2\u09be\u09b8 \u0986\u09b2\u09be\u09a6\u09be \u0996\u09c1\u09b2\u09b8\u09c7');
    page.click(openButtons[1]);
    await page.waitFor(() => page.$('#teacherDetailView').hidden === false);
    assert.equal(nfc(page.$('#teacherDetailTitle').textContent), nfc(CLASS_SEVEN), 'the selected class opens its own detail route');
    assert.ok(page.$('#teacherDetailContent [data-class-detail-action="homework"]'), 'class detail keeps its scoped work door');
    page.click(page.$('#teacherDetailContent [data-class-detail-action="homework"]'));
    await page.waitFor(() => page.$('#teacherRecords').hidden === false);
    assert.equal(nfc(page.$('#teacherClassFilter').value), nfc(CLASS_SEVEN), '\u0995\u09cd\u09b2\u09bf\u0995 \u0995\u09b0\u09be \u0995\u09cd\u09b2\u09be\u09b8\u099f\u09bf\u0987 filter \u09b9\u09df');

    const refresh = () => page.window.dispatchEvent(new page.window.Event('teacher-assignments-updated'));

    // A failed read must not masquerade as "nothing assigned".
    page.window.localStorage.setItem(TEACHER_ASSIGNMENTS_KEY, '{ this is not json');
    refresh();
    await page.waitFor(() => nfc(page.$('#teacherClassList').textContent).includes(nfc(PENDING_MESSAGE)));
    assert.ok(!nfc(page.$('#teacherClassList').textContent).includes(nfc(EMPTY_MESSAGE)),
      '\u09b2\u09cb\u09a1 \u09ad\u09c7\u099b\u09cd\u099f \u09b9\u09b2\u09c7 "\u0995\u09cd\u09b2\u09be\u09b8 \u09a8\u09c7\u0987" \u09ac\u09b2\u09be \u09b9\u09df \u09a8\u09be');

    // Nothing assigned for the account actually signed in: only now the empty
    // line is allowed. (The store is empty and this id owns no directory row.)
    page.window.localStorage.setItem(TEACHER_ASSIGNMENTS_KEY, '[]');
    await saveStaffSession('teacher', true, { username: 'teacher.apc', staffId: '', fullName: '' });
    refresh();
    await page.waitFor(() => nfc(page.$('#teacherClassList').textContent).includes(nfc(EMPTY_MESSAGE)));
    assert.equal(page.$$('#teacherClassList .teaching-card').length, 0, '\u09b8\u0995\u09cd\u09b0\u09bf\u09df\u0995\u09be\u09b0\u09c7 \u09a4\u09be\u09b2\u09bf\u0995\u09be \u0996\u09be\u09b2\u09bf');
  } finally {
    page.window.close();
  }
});
