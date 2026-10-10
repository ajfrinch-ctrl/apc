/* Teacher panel on the real teacher.html (jsdom): the home work queue, bulk
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
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { openStaffPanel } from './staff-harness.mjs';

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
const queueTitle = () => $$('#teacherAttention .teaching-card h3').map(el => el.textContent);

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
    ready: () => [...$('#teacherHomeClass').options].some(option => option.textContent === 'সব assigned class')
  });
  assert.equal($('#teacherShell').hidden, false, 'the panel must open');
});

test('an empty panel reports that nothing is pending', () => {
  assert.equal($('#teacherPendingCount').textContent, '০');
  assert.match($('#teacherAttention').textContent, /সব কাজ শেষ/);
  assert.equal($('#teacherAttentionHint').textContent, 'সব কাজ শেষ');
});

test('the home queue lists only assigned academic work', async () => {
  await teachingRepository.saveActivity({ type: 'routine', title: 'অতিরিক্ত ক্লাস', subject: 'গণিত', className: 'দশম শ্রেণি', date: shift(-1), time: '17:00', duration: 60, status: 'published', details: 'অনুশীলনী' });
  await teachingRepository.saveActivity({ type: 'homework', title: 'আজকের কাজ', subject: 'গণিত', className: 'দশম শ্রেণি', date: todayISO(), time: '20:00', status: 'published', details: 'অনুশীলনী ১' });
  await teachingRepository.saveActivity({ type: 'suggestion', title: 'খসড়া নোটিশ', subject: 'গণিত', className: 'দশম শ্রেণি', status: 'draft', details: 'নোট' });
  await settle();
  assert.equal($('#teacherPublishedCount').textContent, '২');
  assert.equal($('#teacherDraftCount').textContent, '১');
  assert.equal($('#teacherPendingCount').textContent, '৩');
  assert.equal($('#teacherAttentionHint').textContent, '৩টি কাজ বাকি');
  assert.deepEqual(queueTitle().sort(), ['আজকের কাজ', 'অতিরিক্ত ক্লাস', 'খসড়া নোটিশ'].sort());
  assert.equal($('#navDot-routine').hidden, false);
  assert.equal($('#navDot-routine').textContent, '১');
  assert.equal($('#tabCount-homework').textContent, '১');
});

test('future-dated assignments are not counted as due', async () => {
  await teachingRepository.saveActivity({ type: 'homework', title: 'পরের সপ্তাহের কাজ', subject: 'রসায়ন', className: 'দশম শ্রেণি', date: shift(7), time: '10:00', status: 'published', details: 'দ্বিতীয় অধ্যায়' });
  await settle();
  assert.ok(!queueTitle().includes('পরের সপ্তাহের কাজ'));
  const card = $$('#teacherRecent .teaching-card').find(c => c.querySelector('h3').textContent === 'পরের সপ্তাহের কাজ');
  assert.equal(card.querySelector('.teaching-progress-line').textContent, 'অগ্রগতি ০/২ জন');
  assert.equal(card.querySelector('.teaching-progress-line').classList.contains('idle'), true);
});

test('a queue card opens the marking sheet and bulk fill marks the whole class', async () => {
  const examCard = $$('#teacherAttention .teaching-card').find(c => c.querySelector('h3').textContent === 'অতিরিক্ত ক্লাস');
  ctx.click(examCard.querySelector('.teaching-actions .primary'));
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
  const record = $$('#teacherRecordList .teaching-card, #teacherRecent .teaching-card')
    .find(c => c.querySelector('h3')?.textContent === 'অতিরিক্ত ক্লাস');
  assert.match(record.querySelector('.teaching-progress-line').textContent, /২\/২ জন • সব নথিভুক্ত/);
  assert.equal($('#navDot-routine').hidden, true, 'nothing pending on that tab any more');
});

test('"শুধু বাকিরা" filters assignment evaluation rows and bulk fill respects the filter', async () => {
  const card = $$('#teacherRecent .teaching-card').find(c => c.querySelector('h3').textContent === 'আজকের কাজ');
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
  assert.equal($('#teacherRecordsTitle').textContent, 'বাড়ির কাজ');
  assert.equal($('[data-type-tab="homework"]').getAttribute('aria-selected'), 'true');
  assert.equal($('#teacherRecordCount').textContent, '৩টি বাড়ির কাজ • প্রকাশিত ২ • খসড়া ১');
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

test('attendance records are cleared from the work queue when all present marks are saved', async () => {
  await teachingRepository.saveActivity({ type: 'routine', title: 'আজকের গণিত ক্লাস', subject: 'গণিত', className: 'দশম শ্রেণি', date: todayISO(), time: '09:00', duration: 60, status: 'published', details: 'অনুশীলনী' });
  await settle();
  const card = $$('#teacherAttention .teaching-card').find(c => c.querySelector('h3').textContent === 'আজকের গণিত ক্লাস');
  ctx.click(card.querySelector('.teaching-actions .primary'));
  const allPresent = $$('.teacher-quick-fill [data-quick-fill]').find(b => b.textContent === 'সবাই উপস্থিত');
  ctx.click(allPresent); ctx.submit($('#teacherProgressForm')); await settle();
  assert.ok(!queueTitle().includes('আজকের গণিত ক্লাস'));
  assert.equal($('#navDot-routine').hidden, true);
});

test('the home screen can be scoped to one class', async () => {
  const select = () => $('#teacherHomeClass');
  const pick = value => {
    select().value = value;
    select().dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  };
  const digits = text => Number(String(text).replace(/[০-৯]/g, d => '০১২৩৪৫৬৭৮৯'.indexOf(d)));
  const pendingAll = digits($('#teacherPendingCount').textContent);
  assert.equal(select().options[0].value, 'all');
  assert.ok(select().options.length > 5, 'the picker offers every class the app runs');

  // Both classes below have approved students, so both pieces of work are pending.
  await teachingRepository.saveActivity({ type: 'homework', title: 'দশম শ্রেণির কাজ', subject: 'গণিত', className: 'দশম শ্রেণি', date: todayISO(), time: '20:00', status: 'published', details: 'অধ্যায় ২' });
  await teachingRepository.saveActivity({ type: 'homework', title: 'অনার্সের কাজ', subject: 'বাংলা', className: 'অনার্স ১ম বর্ষ', date: todayISO(), time: '20:00', status: 'published', details: 'রচনা' });
  await settle();
  assert.equal(digits($('#teacherPendingCount').textContent), pendingAll + 2, 'both count while সব শ্রেণি is selected');
  assert.ok(queueTitle().includes('দশম শ্রেণির কাজ') && queueTitle().includes('অনার্সের কাজ'));

  pick('দশম শ্রেণি');
  assert.equal(queueTitle().includes('দশম শ্রেণির কাজ'), true);
  assert.equal(queueTitle().includes('অনার্সের কাজ'), false, 'another class drops out of the queue');
  assert.equal(digits($('#teacherPendingCount').textContent), pendingAll + 1, 'and out of the counter');
  assert.match($('#teacherAttentionHint').textContent, /দশম শ্রেণি/, 'the hint names the class');

  pick('অনার্স ১ম বর্ষ');
  assert.deepEqual(queueTitle(), ['অনার্সের কাজ'], 'that class shows only its own work');
  assert.equal($('#teacherTodayClassCount').textContent, '০');

  pick('all');
  assert.equal(digits($('#teacherPendingCount').textContent), pendingAll + 2, 'সব শ্রেণি brings everything back');
  assert.equal(/শ্রেণি|বর্ষ/.test($('#teacherAttentionHint').textContent), false, 'and the hint stops naming a class');
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
