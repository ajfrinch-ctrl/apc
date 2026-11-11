/* মালিক-নির্দেশ ২০২৬-১১-০১ — শিক্ষক প্যানেলের নেভিগেশন ও ডুপ্লিকেট-দরজা।

   চুক্তি (contract) যা এই ফাইল পাহারা দেয়:
     1. প্রতিটি মেনু-আইটেম একটি সম্পূর্ণ পেজ: setView + `#hash`, শুধুই সেই
        স্ক্রিন দৃশ্যমান, আর মূল কনটেন্ট (তালিকা/এডিটর) নিজে থেকেই খোলা —
        আলাদা "তালিকা দেখুন" টগল-কার্ড নেই।
     2. দরজা কখনো ফর্ম-প্রথম নয়: ফর্ম খোলে গন্তব্য পেজের নিজস্ব তৈরি-কার্ড
        থেকে; বাতিল করলে শিক্ষক ওই পেজেই থাকেন।
     3. এক ফিচার, এক রুট-নাম: নম্বর-লেন `#marks`, উপস্থিতি-লেন `#attendance`,
        পরীক্ষা-ওয়ার্কস্পেস `#online-exams`, রুটিন `#routine-view`; পুরোনো
        `#exam` / `#routine` alias হিসেবে আগের স্ক্রিনেই খোলে।
     4. হোম পাঁচ-দরজার লঞ্চার (২ হাব + ৩ শর্টকাট), ক্লাস স্ক্রিনে একাডেমিক
        হাবের পুনরাবৃত্তি নেই।
   যা ইচ্ছাকৃতভাবে ছোঁয়া হয় না: panel-lockdown, staff session, ৪-স্লট নিচের
   নেভিগেশন, class-chat fullscreen। */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { openStaffPanel } from './staff-harness.mjs';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { enabledClasses } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';

const nfc = text => String(text || '').normalize('NFC');
const settle = () => new Promise(resolve => setTimeout(resolve, 40));

let ctx;
const $ = selector => ctx.$(selector);
const $$ = selector => ctx.$$(selector);
const visibleScreens = () => $$('.teacher-view').filter(el => !el.hidden).map(el => el.id);
/* jsdom কখনো scripted hash-bodoler জন্য hashchange ছোঁড়ে না; তাই URL বসিয়ে
   ইভেন্টটা নিজে ছোঁড়া হয় — ব্রাউজারে শেয়ার-লিংক বা Back যা করে, ঠিক তাই। */
const followHash = async hash => {
  ctx.window.location.hash = hash;
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await settle();
};

before(async () => {
  ctx = await loadPage('teacher.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [ROSTER_KEY]: JSON.stringify(adminStudents),
      [TEACHER_ASSIGNMENTS_KEY]: JSON.stringify(enabledClasses.map((className, index) => ({
        id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: 'Test'
      })))
    }
  });
  await openStaffPanel(ctx, 'teacher', {
    importPanel: () => import('../js/teacher.js'),
    shellId: 'teacherShell',
    ready: () => [...$('#teacherClassFilter').options].some(option => option.textContent === 'সব নির্ধারিত শ্রেণি')
  });
});

after(() => { try { ctx.window.close(); } catch { /* already gone */ } });

test('হোম একটি কাজ-কেন্দ্রিক লঞ্চার: এক প্রধান দরজা + তিনটি কাজের কার্ড', () => {
  const home = $('#teacherHome');
  const doors = $$('#teacherHome [data-panel-view]');
  assert.deepEqual(doors.map(el => el.dataset.panelView),
    ['work-new', 'work-published', 'work-activity', 'routine-view'],
    'হোমের দরজা: নতুন কাজ · প্রকাশিত কাজ · শিক্ষার্থী কার্যক্রম · রুটিন');
  const primary = $('#teacherHome .teacher-work-primary');
  assert.ok(primary, 'একটাই প্রধান প্রবেশদরজা');
  assert.equal(nfc(primary.textContent).includes('নতুন কাজ তৈরি করুন'), true);
  assert.equal($$('#teacherHome .teacher-action-card').length, 3, 'তিনটি সংক্ষিপ্ত কাজের কার্ড');
  assert.equal(home.querySelectorAll('[data-new-activity], [data-new-notice], [data-teacher-exam]').length, 0,
    'হোম থেকে সরাসরি কোনো ফর্ম/উইজার্ড খোলে না');
  assert.equal($$('#teacherHome [data-panel-view="academic"]').length, 0,
    'একাডেমিক হাব এখন "আরও"-তে, হোমের দ্বিতীয় দরজা নয়');
  assert.equal($$('#teacherHome [data-panel-view="class-chat"]').length, 0,
    'শ্রেণি চ্যাটও "আরও"-তে');
  for (const gone of ['courses', 'notice', 'exam', 'homework']) {
    assert.equal($$(`#teacherHome [data-panel-view="${gone}"]`).length, 0,
      `${gone} এখন কাজ-প্যানেল বা আরও-র ভেতরে`);
  }
});

test('হোম → নতুন কাজ: `#work-new` রুট, কাজ-প্যানেলের প্রথম ধাপ খোলে', async () => {
  ctx.click($('#teacherHome [data-panel-view="work-new"]'));
  await settle();
  assert.equal(ctx.window.location.hash, '#work-new', 'রুট URL-এ লেখা হয়');
  assert.deepEqual(visibleScreens(), ['teacherClasses'], 'কাজ-প্যানেলই একমাত্র স্ক্রিন');
  assert.equal($('#workPane-new').hidden, false, 'নতুন কাজের অংশ খোলা');
  assert.equal($('#teacherClassPane').hasAttribute('hidden'), true, 'ক্লাস-তালিকা সরে যায়');
  assert.equal($('#teacherModalBackdrop').hidden, true, 'দরজা ট্যাপে মডেল খোলে না');
  assert.ok($$('#teacherWorkMount [data-work-category]').length >= 5, 'প্রথম ধাপে কাজের বিভাগ দেখা যায়');
  assert.notEqual($('[data-work-start]'), null, 'উইজার্ড শুরু করার নিয়ন্ত্রণ আছে');
});

test('তৈরি-কর্ম: routed detail page-এ ফর্ম খোলে, বাতিলে মালিক পেজে ফেরা', async () => {
  await followHash('#homework');
  assert.equal(ctx.window.location.hash, '#homework', 'পুরোনো deep link আগের মতোই কাজ করে');
  ctx.click($('#teacherRecords [data-records-action="create"]'));
  await settle();
  assert.deepEqual(visibleScreens(), ['teacherDetailView'], 'ফর্মের নিজস্ব route/detail পেজ');
  assert.ok(nfc($('#teacherDetailTitle').textContent).startsWith('নতুন') && $('#teacherDetailTitle').textContent.includes('কাজ'));
  assert.ok($('#teacherActivityForm'), 'activity form is inline in the destination page');
  assert.equal($('#teacherModalBackdrop').hidden, true, 'লম্বা ফর্মে overlay modal নেই');
  ctx.click($('#teacherDetailContent [data-close-teacher]'));
  await settle();
  assert.deepEqual(visibleScreens(), ['teacherRecords'], 'বাতিল করলে মালিক তালিকায় ফেরা');
  assert.equal(ctx.window.location.hash, '#homework');
});

test('একাডেমিক হাব: কাজ তৈরির দরজা নেই, শুধু রিসোর্স ও রিপোর্ট', async () => {
  await followHash('#home');
  ctx.click($('.admin-bottom [data-panel-view="academic"]'));
  await settle();
  assert.equal(ctx.window.location.hash, '#academic');
  assert.deepEqual(visibleScreens(), ['teacherAcademic']);
  assert.equal($$('#teacherAcademic [data-new-activity], #teacherAcademic [data-new-notice]').length, 0,
    'হাবে ফর্ম-প্রথম দরজা নেই');
  for (const gone of ['homework', 'suggestion', 'notice']) {
    assert.equal($$(`#teacherAcademic [data-panel-view="${gone}"]`).length, 0,
      `${gone} তৈরির দরজা হাব থেকে বাদ`);
  }
  assert.equal($$('#teacherAcademic [data-panel-view="work-new"]').length, 1, 'একটাই সূত্র — কাজ প্যানেলে');
  assert.ok(nfc($('#teacherAcademic').textContent).includes('কাজ'), 'হাব বলে দেয় কাজ কোথায় তৈরি হয়');

  ctx.click($('#teacherAcademic [data-panel-view="online-exams"]'));
  await settle();
  assert.equal(ctx.window.location.hash, '#online-exams');
  assert.deepEqual(visibleScreens(), ['teacherOnlineExams']);

  await followHash('#notice');
  assert.deepEqual(visibleScreens(), ['teacherNotice'], 'নোটিশ বোর্ডের deep link অটুট');
  assert.equal($('#teacherNotice').dataset.noticeOpen, '1', 'প্রকাশিত/খসড়া তালিকা আগেই খোলা');
  ctx.click($('#teacherNewNotice'));
  await settle();
  assert.deepEqual(visibleScreens(), ['teacherDetailView'], 'নোটিশ কম্পোজারের নিজস্ব route/detail পেজ');
  assert.ok($('#teacherNoticeForm'), 'notice form is inline in the destination page');
  ctx.click($('#teacherDetailContent [data-close-teacher]'));
  await settle();
  assert.deepEqual(visibleScreens(), ['teacherNotice'], 'বাতিলে নোটিশ বোর্ডে থাকা');
});

test('একই ফিচার দুই জায়গা থেকে একই ভিউ ও একই hash-এ পৌঁছায়', async () => {
  await followHash('#home');
  ctx.click($('.admin-bottom [data-panel-view="academic"]'));
  await settle();
  ctx.click($('#teacherAcademic [data-panel-view="online-exams"]'));
  await settle();
  const fromHub = ctx.window.location.hash;
  assert.equal(fromHub, '#online-exams');
  assert.deepEqual(visibleScreens(), ['teacherOnlineExams']);

  await followHash('#home');
  await followHash('#online-exams');
  assert.equal(ctx.window.location.hash, fromHub, 'হাব-দরজা ও সরাসরি রুট একই hash দেয়');
  assert.deepEqual(visibleScreens(), ['teacherOnlineExams']);
});

test('নম্বর ও ফলাফল একটি আলাদা লেন ও আলাদা রুট (`#marks`), পুরোনো `#exam` alias', async () => {
  await followHash('#online-exams');
  ctx.click($('#teacherOnlineExams [data-panel-view="exam"]'));
  await settle();
  assert.equal(ctx.window.location.hash, '#marks', 'নম্বর-লেনের নিজস্ব রুট');
  assert.equal(nfc($('#teacherRecordsTitle').textContent.trim()), nfc('নম্বর ও ফলাফল'),
    'শিরোনাম পরীক্ষা-ওয়ার্কস্পেসের নাম নকল করে না');
  assert.equal($('#teacherOnlineExamHint').hidden, false, 'পরীক্ষা-সিটে যাওয়ার সূত্র দেখায়');
  for (const legacy of ['#exam', '#marks']) {
    await followHash('#home');
    await followHash(legacy);
    assert.equal(nfc($('#teacherRecordsTitle').textContent.trim()), nfc('নম্বর ও ফলাফল'),
      `${legacy} আগের স্ক্রিনেই খোলে`);
  }
});

test('রুটিন ও উপস্থিতি আলাদা পেজ ও আলাদা রুট (`#routine-view` / `#attendance`)', async () => {
  await followHash('#routine-view');
  assert.deepEqual(visibleScreens(), ['teacherRoutine'], 'রুটিন পেজ');
  assert.equal($('#teacherRoutine').dataset.routineOpen, '1', 'সময়সূচি-তালিকা আগেই খোলা');
  assert.equal(nfc($('#teacherRoutineTitle').textContent.trim()), nfc('ক্লাস রুটিন'));
  assert.equal($$('#teacherRoutine [data-panel-view="routine"]').length, 1, 'উপস্থিতির একটাই দরজা');
  ctx.click($('#teacherRoutine [data-panel-view="routine"]'));
  await settle();
  assert.equal(ctx.window.location.hash, '#attendance');
  assert.equal(nfc($('#teacherRecordsTitle').textContent.trim()), nfc('উপস্থিতি ক্লাস'));
  for (const legacy of ['#routine', '#attendance']) {
    await followHash('#home');
    await followHash(legacy);
    assert.equal(nfc($('#teacherRecordsTitle').textContent.trim()), nfc('উপস্থিতি ক্লাস'),
      `${legacy} আগের স্ক্রিনেই খোলে`);
  }
});

test('রিপোর্ট/উপকরণের মোড-কার্ড ট্যাবের মতো: খোলা প্যান কখনো নিজে বন্ধ হয় না', async () => {
  await followHash('#reports');
  const reports = $('#teacherAcademicReports');
  assert.equal(reports.dataset.reportsOpen, 'generator', 'রিপোর্ট পেজ ডিফল্টে জেনারেটর খোলে');
  assert.equal(reports.querySelector('.rp-section').hidden, false, 'জেনারেটর প্যান দৃশ্যমান');
  ctx.click(reports.querySelector('[data-reports-action="summary"]'));
  await settle();
  assert.equal(reports.dataset.reportsOpen, 'summary');
  ctx.click(reports.querySelector('[data-reports-action="summary"]'));
  await settle();
  assert.equal(reports.dataset.reportsOpen, 'summary', 'একই কার্ডে আবার চাপ দিলেও প্যান খালি হয় না');
  ctx.click(reports.querySelector('[data-reports-action="generator"]'));
  await settle();
  assert.equal(reports.dataset.reportsOpen, 'generator');

  await followHash('#courses');
  const courses = $('#teacherCourses');
  assert.equal(courses.dataset.coursesOpen, 'materials', 'উপকরণ পেজ ডিফল্টে তালিকা/এডিটর খোলে');
  ctx.click(courses.querySelector('[data-courses-action="chapters"]'));
  await settle();
  assert.equal(courses.dataset.coursesOpen, 'chapters');
  ctx.click(courses.querySelector('[data-courses-action="chapters"]'));
  await settle();
  assert.equal(courses.dataset.coursesOpen, 'chapters', 'একই কার্ডে আবার চাপ দিলেও প্যান খালি হয় না');
});

test('মার্কআপ স্তরে দরজার হিসাব: হোম ৪, ক্লাস ২, একাডেমিক ৫ (তৈরি-দরজা শূন্য)', () => {
  const html = readFileSync(new URL('../teacher.html', import.meta.url), 'utf8');
  const section = id => {
    const start = html.indexOf(`<section id="${id}"`);
    const next = html.indexOf('<section id="teacher', start + 10);
    return html.slice(start, next > 0 ? next : html.lastIndexOf('<nav class="admin-bottom"'));
  };
  const doors = chunk => [...chunk.matchAll(/data-panel-view="([a-z-]+)"/g)].map(match => match[1]).filter(v => v !== 'home');
  assert.deepEqual(doors(section('teacherHome')), ['work-new', 'work-published', 'work-activity', 'routine-view']);
  assert.deepEqual(doors(section('teacherClasses')), ['homework', 'routine-view'], 'ক্লাস স্ক্রিনে একাডেমিক হাবের পুনরাবৃত্তি নেই');
  assert.deepEqual(doors(section('teacherAcademic')),
    ['work-new', 'online-exams', 'lecture-sheets', 'reports', 'routine-view'],
    'হাবে কাজ তৈরির দরজা নেই — এক সূত্র কাজ প্যানেলে, বাকিগুলো রিসোর্স');
  assert.equal(html.includes('data-courses-action="new"') && section('teacherAcademic').includes('data-courses-action="new"'), false,
    'নতুন লেকচার শিটের দ্বিতীয় দরজা হাবে নেই');
});

