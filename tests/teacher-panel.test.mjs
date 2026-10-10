/* Teacher panel on the real teacher.html (jsdom): the redesigned home
   (welcome + 3-column launcher grid + আজকের ক্লাস + সর্বশেষ ৩টি কাজ), bulk
   marking, grouping and paging. The Playwright spec covers CRUD end to end;
   this file covers the management layer added on top of it. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { teachingRepository, todayISO } from '../js/teaching-data.js';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { enabledClasses } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { STAFF_ACCOUNTS, updateStaffProfile } from '../js/staff-auth.js';
import { openStaffPanel } from './staff-harness.mjs';

/* Bangla literals from different files can carry precomposed or decomposed
   nukta forms (ড়/য়) — compare in one normalization, like the architecture
   suite does. */
const nfc = value => String(value).normalize('NFC');

const shift = days => {
  const d = new Date(`${todayISO()}T12:00:00`);
  d.setDate(d.getDate() + days);
  return todayISO(d);
};
const settle = () => new Promise(resolve => setTimeout(resolve, 40));

let ctx;
const $ = sel => ctx.$(sel);
const $$ = sel => ctx.$$(sel);
const cards = sel => $$(`${sel} .teaching-card`);
const recentTitles = () => $$('#teacherRecent .teaching-card h3').map(el => el.textContent);
const homeCard = title => $$('#teacherRecent .teaching-card').find(c => c.querySelector('h3')?.textContent === title);

before(async () => {
  ctx = await loadPage('teacher.html', {
    seed: { 'activePlus.demo.autofill.v1': 'off', [ROSTER_KEY]: JSON.stringify(adminStudents), [TEACHER_ASSIGNMENTS_KEY]: JSON.stringify(enabledClasses.map((className, index) => ({ id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'Test' }))) }
  });
  await openStaffPanel(ctx, 'teacher', {
    importPanel: () => import('../js/teacher.js'),
    shellId: 'teacherShell',
    /* The shell unhides before reload() has read the roster and assignments, so
       wait for the class pickers reload() rewrites — that is the first frame
       that carries real data, and every assertion below reads from it. */
    ready: () => [...$('#teacherClassFilter').options].some(option => option.textContent === 'সব assigned class')
  });
  assert.equal($('#teacherShell').hidden, false, 'the panel must open');
});

test('an empty home reports honestly: no classes today, no work yet', () => {
  assert.match($('#teacherTodayClasses').textContent, /আজ কোনো নির্ধারিত ক্লাস নেই/);
  assert.match($('#teacherRecent').textContent, /এখনও কোনো academic কাজ যোগ করা হয়নি/);
  assert.equal($('#teacherTodayClassCount').textContent, '০টি ক্লাস');
  assert.equal($('#navDot-academic').hidden, true, 'nothing pending anywhere yet');
});

test('the header and welcome hero show the teacher name from the staff profile', async () => {
  /* A provisioned test account starts without a display name — the home must
     still greet politely and keep the header slot hidden; once the profile
     carries a name, both places update after the next data event. */
  assert.equal($('#teacherHomeTitle').textContent, 'স্বাগতম', 'no name on the account yet — a plain welcome');
  assert.equal($('#teacherHeaderName').hidden, true, 'do not show a blank header name');
  const updated = await updateStaffProfile('teacher', { fullName: 'পরীক্ষা শিক্ষক' });
  assert.equal(updated.ok, true);
  ctx.window.dispatchEvent(new ctx.window.CustomEvent('teaching-data-updated'));
  await settle();
  assert.equal($('#teacherHomeTitle').textContent, 'স্বাগতম, পরীক্ষা শিক্ষক');
  assert.equal($('#teacherHeaderName').hidden, false);
  assert.equal($('#teacherHeaderName').textContent, 'পরীক্ষা শিক্ষক');
  assert.match($('#teacherHome').textContent, /আপনার আজকের কাজগুলো দেখে নিন।/);
});

test('home is welcome + one 3-column grid over existing screens + today + recent', () => {
  const tiles = $$('#teacherHome .teacher-home-tile');
  assert.equal(tiles.length, 6, 'ছয়টি ফিচার-টাইল');
  assert.ok($('.teacher-home-grid'), 'the grid container exists');
  assert.deepEqual(tiles.map(t => t.dataset.teacherView),
    ['homework', 'suggestion', 'courses', 'routine-view', 'online-exams', 'notice'],
    'প্রতিটি টাইল একটি বিদ্যমান স্ক্রিনে যায়');
  assert.equal($$('#teacherHome [data-new-activity]').length, 0, 'create forms stay on the কাজ দিন hub');
  assert.ok($('#teacherTodayClasses'), 'আজকের ক্লাস section');
  assert.ok($('#teacherRecent'), 'সাম্প্রতিক কাজ section');
});

test('recent work shows the latest three with name, class and status', async () => {
  await teachingRepository.saveActivity({ type: 'routine', title: 'অতিরিক্ত ক্লাস', subject: 'গণিত', className: 'দশম শ্রেণি', date: shift(-1), time: '17:00', duration: 60, status: 'published', details: 'অনুশীলনী' });
  await teachingRepository.saveActivity({ type: 'homework', title: 'আজকের কাজ', subject: 'গণিত', className: 'দশম শ্রেণি', date: todayISO(), time: '20:00', status: 'published', details: 'অনুশীলনী ১' });
  await teachingRepository.saveActivity({ type: 'suggestion', title: 'খসড়া নোটিশ', subject: 'গণিত', className: 'দশম শ্রেণি', status: 'draft', details: 'নোট' });
  await settle();
  assert.deepEqual(recentTitles().sort(), ['অতিরিক্ত ক্লাস', 'আজকের কাজ', 'খসড়া নোটিশ'].sort(), 'সর্বশেষ ৩টি কাজ');
  const draft = homeCard('খসড়া নোটিশ');
  assert.match(draft.querySelector('.teaching-status').textContent, /খসড়া/, 'status chip');
  assert.match(draft.querySelector('small').textContent, /দশম শ্রেণি/, 'class line');
  assert.equal(homeCard('আজকের কাজ').querySelector('.teaching-status').textContent, 'প্রকাশিত');
  assert.equal($('#navDot-routine').textContent, '১', 'pending attendance still counts on its seat');
  assert.equal($('#tabCount-homework').textContent, '১');
});

test('future-dated work is not pending, and the records card shows its progress', async () => {
  await teachingRepository.saveActivity({ type: 'homework', title: 'পরের সপ্তাহের কাজ', subject: 'রসায়ন', className: 'দশম শ্রেণি', date: shift(7), time: '10:00', status: 'published', details: 'দ্বিতীয় অধ্যায়' });
  await settle();
  const card = homeCard('পরের সপ্তাহের কাজ');
  assert.ok(card, 'the newest work is one of the three on home');
  assert.equal(card.querySelector('.teaching-progress-line'), null, 'a future deadline is not flagged pending');
  ctx.click($('[data-type-tab="homework"]'));
  await settle();
  const record = $$('#teacherRecordList .teaching-card').find(c => c.querySelector('h3').textContent === 'পরের সপ্তাহের কাজ');
  assert.equal(record.querySelector('.teaching-progress-line').textContent, 'অগ্রগতি ০/২ জন');
  assert.equal(record.querySelector('.teaching-progress-line').classList.contains('idle'), true);
  ctx.click($('.admin-bottom [data-teacher-view="home"]'));
  await settle();
});

test('a home card opens the marking sheet and bulk fill marks the whole class', async () => {
  await teachingRepository.saveActivity({ type: 'routine', title: 'গতকালের ক্লাস', subject: 'গণিত', className: 'দশম শ্রেণি', date: shift(-1), time: '11:00', duration: 60, status: 'published', details: 'অনুশীলনী' });
  await settle();
  const card = homeCard('গতকালের ক্লাস');
  assert.equal($('#navDot-routine').textContent, '২', 'দুটি উপস্থিতি বাকি');
  ctx.click(card.querySelector('.teaching-actions .primary'));
  assert.equal($('#teacherModalBackdrop').hidden, false);
  const fields = $$('[data-progress-id]');
  assert.equal(fields.length, 2, 'দশম শ্রেণি has two approved students');
  assert.match($('#teacherProgressSummary').textContent, /২ জনের ০ জন নথিভুক্ত • বাকি ২ জন/);

  const allPresent = $$('.teacher-quick-fill [data-quick-fill]').find(b => b.textContent === 'সবাই উপস্থিত');
  ctx.click(allPresent);
  assert.deepEqual(fields.map(f => f.value), ['present', 'present']);
  assert.match($('#teacherProgressSummary').textContent, /২ জনের ২ জন নথিভুক্ত • সব সম্পূর্ণ/);

  ctx.submit($('#teacherProgressForm'));
  await settle();
  assert.equal($('#teacherModalBackdrop').hidden, true);
  assert.equal(homeCard('গতকালের ক্লাস').querySelector('.teaching-progress-line'), null, 'the home card drops its pending line');
  assert.equal($('#navDot-routine').textContent, '১', 'one attendance record is still open');
  ctx.click($('[data-type-tab="routine"]'));
  await settle();
  const record = $$('#teacherRecordList .teaching-card').find(c => c.querySelector('h3')?.textContent === 'গতকালের ক্লাস');
  assert.match(record.querySelector('.teaching-progress-line').textContent, /২\/২ জন • সব নথিভুক্ত/);
  ctx.click($('.admin-bottom [data-teacher-view="home"]'));
  await settle();
});

test('"শুধু বাকিরা" filters assignment evaluation rows and bulk fill respects the filter', async () => {
  ctx.click($('[data-type-tab="homework"]'));
  await settle();
  const card = $$('#teacherRecordList .teaching-card').find(c => c.querySelector('h3').textContent === 'আজকের কাজ');
  ctx.click(card.querySelector('[data-record-action="progress"]'));
  const fields = $$('[data-progress-id]');
  fields[0].value = 'done'; fields[0].dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.match($('#teacherProgressSummary').textContent, /২ জনের ১ জন নথিভুক্ত/);
  ctx.click($('#teacherOnlyMissing'));
  assert.deepEqual($$('[data-progress-row]').map(r => r.hidden), [true, false]);
  ctx.click($$('.teacher-quick-fill [data-quick-fill]').find(b => b.textContent === 'সবাই দেখা হয়েছে'));
  assert.equal(fields[0].value, 'done'); assert.equal(fields[1].value, 'reviewed');
  ctx.click($('#teacherOnlyMissing')); assert.deepEqual($$('[data-progress-row]').map(r => r.hidden), [false, false]);
  ctx.click($('#teacherModalClose'));
});

test('assignment tabs scope their saved records and report the status split', async () => {
  await teachingRepository.saveActivity({ type: 'homework', title: 'আগামীকালের কাজ', subject: 'পদার্থ', className: 'দশম শ্রেণি', date: shift(1), time: '10:00', status: 'draft', details: 'দ্বিতীয় অধ্যায়' });
  await settle(); ctx.click($('[data-type-tab="homework"]'));
  assert.equal($('#teacherRecords').hidden, false); assert.equal($('#teacherHome').hidden, true);
  assert.equal(nfc($('#teacherRecordsTitle').textContent), nfc('বাড়ির কাজ'));
  assert.equal($('[data-type-tab="homework"]').getAttribute('aria-selected'), 'true');
  assert.equal(nfc($('#teacherRecordCount').textContent), nfc('৩টি বাড়ির কাজ • প্রকাশিত ২ • খসড়া ১'));
  const labels = $$('#teacherRecordList .teacher-group-label').map(el => el.firstChild.textContent);
  assert.equal(labels[0], 'আজ'); assert.equal(labels[1], 'আগামীকাল'); assert.equal(labels.length, 3);
  assert.equal($('#tabCount-homework').textContent, '৩');
});

test('a long list pages instead of scrolling forever', async () => {
  for (let i = 0; i < 17; i += 1) {
    await teachingRepository.saveActivity({ type: 'suggestion', title: `সাজেশন ${i + 1}`, subject: 'গণিত', className: 'দশম শ্রেণি', status: 'published', details: 'নোট' });
  }
  await settle();
  ctx.click($('[data-type-tab="suggestion"]'));
  await settle();

  assert.equal(cards('#teacherRecordList').length, 15);
  assert.equal($('#teacherRecordMore').hidden, false);
  assert.equal($('#teacherRecordMore').textContent, 'আরও ৩টি একাডেমিক নোটিশ দেখুন');
  ctx.click($('#teacherRecordMore'));
  assert.equal(cards('#teacherRecordList').length, 18);
  assert.equal($('#teacherRecordMore').hidden, true);

  // A new search starts from the first page again.
  ctx.type($('#teacherRecordSearch'), 'সাজেশন ১');
  assert.ok(cards('#teacherRecordList').length < 18);
});

test('the student roster still needs a search before listing anyone', () => {
  ctx.click($('[data-teacher-view="students"]'));
  assert.equal($('#teacherStudents').hidden, false);
  assert.equal(cards('#teacherStudentList').length, 0);
  ctx.type($('#teacherStudentSearch'), 'AP-1024');
  assert.equal(cards('#teacherStudentList').length, 1);
  assert.match($('#teacherStudentCount').textContent, /১ জন অনুমোদিত শিক্ষার্থী/);
});

test('attendance marks clear the home card\u2019s pending line when all present is saved', async () => {
  await teachingRepository.saveActivity({ type: 'routine', title: 'আজকের গণিত ক্লাস', subject: 'গণিত', className: 'দশম শ্রেণি', date: todayISO(), time: '09:00', duration: 60, status: 'published', details: 'অনুশীলনী' });
  await settle();
  ctx.click($('.admin-bottom [data-teacher-view="home"]'));
  await settle();
  const card = homeCard('আজকের গণিত ক্লাস');
  assert.match(card.querySelector('.teaching-progress-line').textContent, /উপস্থিতি বাকি/);
  ctx.click(card.querySelector('.teaching-actions .primary'));
  const allPresent = $$('.teacher-quick-fill [data-quick-fill]').find(b => b.textContent === 'সবাই উপস্থিত');
  ctx.click(allPresent); ctx.submit($('#teacherProgressForm')); await settle();
  assert.equal(homeCard('আজকের গণিত ক্লাস').querySelector('.teaching-progress-line'), null);
  assert.equal($('#navDot-routine').textContent, '১', 'only the older open record remains');
});

test('the records screen keeps the class scope picker the home no longer needs', async () => {
  const select = () => $('#teacherClassFilter');
  const pick = value => {
    select().value = value;
    select().dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  };
  assert.equal(select().options[0].value, 'all');
  assert.ok(select().options.length > 5, 'the picker offers every class the app runs');

  // Both classes below have approved students, so both pieces of work are real.
  await teachingRepository.saveActivity({ type: 'homework', title: 'দশম শ্রেণির কাজ', subject: 'গণিত', className: 'দশম শ্রেণি', date: todayISO(), time: '20:00', status: 'published', details: 'অধ্যায় ২' });
  await teachingRepository.saveActivity({ type: 'homework', title: 'অনার্সের কাজ', subject: 'বাংলা', className: 'অনার্স ১ম বর্ষ', date: todayISO(), time: '20:00', status: 'published', details: 'রচনা' });
  await settle();
  ctx.click($('[data-type-tab="homework"]'));
  await settle();
  const titles = () => $$('#teacherRecordList .teaching-card h3').map(el => el.textContent);
  assert.ok(titles().includes('দশম শ্রেণির কাজ') && titles().includes('অনার্সের কাজ'));

  pick('দশম শ্রেণি');
  assert.equal(titles().includes('দশম শ্রেণির কাজ'), true);
  assert.equal(titles().includes('অনার্সের কাজ'), false, 'another class drops out of the list');

  pick('all');
  assert.ok(titles().includes('অনার্সের কাজ'), 'সব assigned class brings everything back');
  assert.equal($('#teacherTodayClassCount').textContent, '০টি ক্লাস', 'no manager routine is seeded in this panel');
});

test('Teacher Settings is the shared five-group hub, with no duplicated control', () => {
  /* §29 — one Settings structure for every role. The Teacher's profile card,
     password row and theme switch stay; the hub fills the rest, including the
     notification group the Teacher page already had. */
  const hub = $('[data-settings-hub="teacher"]');
  assert.ok(hub, 'teacher settings hub missing');
  assert.deepEqual([...hub.querySelectorAll('[data-settings-group]')].map(section => section.dataset.settingsGroup),
    ['account', 'notification', 'app', 'security', 'data']);
  assert.equal($$('#darkModeToggle').length, 1, 'one theme switch (the page\'s own)');
  assert.equal($$('[data-settings-toggle="theme"]').length, 0, 'the hub must not add a second theme switch');
  assert.equal(hub.querySelectorAll('[data-settings-row="profile"]').length, 1, 'profile');
  assert.equal(hub.querySelectorAll('[data-settings-row="password"]').length, 1, 'password');
  for (const key of ['install', 'device', 'session', 'offline', 'storage']) {
    assert.equal(hub.querySelectorAll(`[data-settings-row="${key}"]`).length, 1, key);
  }
  assert.equal(hub.querySelector('[data-settings-group="notification"]').dataset.settingsOwner, 'notification');
});

test('the grid doors open their own screens and the routine lives on one screen', async () => {
  ctx.click($('#teacherHome [data-teacher-view="routine-view"]'));
  await settle();
  assert.equal($('#teacherRoutine').hidden, false, 'উপস্থিতি door opens the routine screen');
  const tabs = $$('.teacher-routine-tabs [data-routine-tab]');
  assert.equal(tabs.length, 9, 'নয়টি বিভাগ এক সারিতে');
  assert.equal($('#teacherRoutineToday'), null, 'the nine separate pages are gone');
  ctx.click($('.teacher-routine-tabs [data-routine-tab="exam"]'));
  await settle();
  assert.equal($('.teacher-routine-tabs [data-routine-tab="exam"]').getAttribute('aria-selected'), 'true');
  assert.equal($('.teacher-routine-tabs [data-routine-tab="today"]').getAttribute('aria-selected'), 'false');
  ctx.click($('#teacherHome [data-teacher-view="homework"]'));
  await settle();
  assert.equal($('#teacherRecords').hidden, false, 'বাড়ির কাজ door opens the records screen');
  ctx.click($('#teacherHome [data-teacher-view="courses"]'));
  await settle();
  assert.equal($('#teacherCourses').hidden, false, 'উপকরণ door opens its own screen');
  ctx.click($('.admin-bottom [data-teacher-view="home"]'));
  await settle();
  assert.equal($('#teacherHome').hidden, false, 'bottom nav brings the teacher back home');
});

test('the exam seat lands on one CTA and four doors, not a nine-tile shelf', async () => {
  assert.ok($('.teacher-cta'), 'একটি primary CTA');
  const chips = $$('#teacherExamHub .day-tab');
  assert.equal(chips.length, 4, 'চারটি বিভাগ-দরজা');
  assert.equal($$('#teacherExamHub .pay-tile').length, 0, 'the nine-tile shelf is gone');
  ctx.click($('.teacher-cta'));
  await settle();
  assert.equal($('#teacherOnlineExams').hidden, false);
  assert.equal($('#teacherExamWorkspace').hidden, false, 'CTA opens the workspace home');
  assert.ok($('#teacherExamWorkspace [data-exam-action="new-mcq"]'), 'create buttons live one tap in');
});
