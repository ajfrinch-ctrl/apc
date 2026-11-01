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

test('হোম একটি পাঁচ-দরজার লঞ্চার: দুই হাব + তিন শর্টকাট, কোনো ফর্ম-প্রথম দরজা নেই', () => {
  const home = $('#teacherHome');
  const doors = $$('#teacherHome [data-teacher-view]');
  assert.deepEqual(doors.map(el => el.dataset.teacherView),
    ['academic', 'class-chat', 'homework', 'online-exams', 'routine-view'],
    'হোমের দরজা: একাডেমিক হাব · শ্রেণি চ্যাট · বাড়ির কাজ · পরীক্ষা · ক্লাস রুটিন');
  assert.equal($$('#teacherHome .teacher-action-card').length, 3, 'তিনটি ফুল-ওয়াইড শর্টকাট কার্ড');
  assert.equal(home.querySelectorAll('[data-new-activity], [data-new-notice], [data-teacher-exam]').length, 0,
    'হোম থেকে সরাসরি কোনো ফর্ম/উইজার্ড খোলে না');
  assert.equal(home.querySelector('.teacher-action-secondary'), null, 'সেকেন্ডারি চিপ-সারি বাদ');
  for (const gone of ['courses', 'notice', 'exam']) {
    assert.equal($$(`#teacherHome [data-teacher-view="${gone}"]`).length, 0,
      `${gone} এখন হাব/সিটের ভেতরে, হোমের দ্বিতীয় দরজা নয়`);
  }
});

test('হোম → বাড়ির কাজ: `#homework` রুট, শুধু রেকর্ডস পেজ, তালিকা আগেই খোলা', async () => {
  ctx.click($('#teacherHome [data-teacher-view="homework"]'));
  await settle();
  assert.equal(ctx.window.location.hash, '#homework', 'রুট URL-এ লেখা হয়');
  assert.deepEqual(visibleScreens(), ['teacherRecords'], 'একটাই স্ক্রিন দৃশ্যমান');
  assert.equal($('#teacherRecords').dataset.recordsOpen, '1', 'তালিকা-প্যান নিজে থেকেই খোলা');
  assert.equal($('#teacherModalBackdrop').hidden, true, 'দরজা ট্যাপে মডেল খোলে না');
  assert.equal(nfc($('#teacherRecordsTitle').textContent.trim()), nfc('বাড়ির কাজ'), 'পেজ-শিরোনাম মিলে যায়');
  assert.notEqual($('#teacherRecordList').innerHTML, '', 'তালিকা একই পেজে রেন্ডার হয়');
  assert.equal($$('[data-records-action="list"], [data-notice-action="list"], [data-routine-action="list"]').length, 0,
    'ইন-প্লেস "তালিকা দেখুন" টগল আর কোথাও নেই');
});

test('তৈরি-কর্ম: পেজের নিজস্ব কার্ড ফর্ম খোলে, বাতিলে শিক্ষক ওই পেজেই থাকেন', async () => {
  ctx.click($('#teacherRecords [data-records-action="create"]'));
  await settle();
  assert.equal($('#teacherModalBackdrop').hidden, false, 'পেজের তৈরি-কার্ড ফর্ম খোলে');
  assert.equal(nfc($('#teacherModalTitle').textContent), nfc('নতুন বাড়ির কাজ'));
  ctx.click($('#teacherModalClose'));
  await settle();
  assert.equal($('#teacherModalBackdrop').hidden, true);
  assert.deepEqual(visibleScreens(), ['teacherRecords'], 'বাতিল করলে সেই পেজেই ফেরা');
});

test('একাডেমিক হাব: দরজাগুলো সম্পূর্ণ পেজ খোলে, হাবের ওপর মডেল নয়', async () => {
  ctx.click($('#teacherHome .teacher-academic-hub'));
  await settle();
  assert.equal(ctx.window.location.hash, '#academic');
  assert.deepEqual(visibleScreens(), ['teacherAcademic']);
  assert.equal($$('#teacherAcademic [data-new-activity], #teacherAcademic [data-new-notice]').length, 0,
    'হাবে ফর্ম-প্রথম দরজা নেই');

  ctx.click($('#teacherAcademic [data-teacher-view="notice"]'));
  await settle();
  assert.equal(ctx.window.location.hash, '#notice');
  assert.deepEqual(visibleScreens(), ['teacherNotice']);
  assert.equal($('#teacherModalBackdrop').hidden, true, 'নোটিশ দরজা মডেল খোলে না');
  assert.equal($('#teacherNotice').dataset.noticeOpen, '1', 'প্রকাশিত/খসড়া তালিকা আগেই খোলা');
  ctx.click($('#teacherNewNotice'));
  await settle();
  assert.equal($('#teacherModalBackdrop').hidden, false, 'বোর্ডের নিজস্ব বাটন কম্পোজার খোলে');
  ctx.click($('#teacherModalClose'));
  await settle();
  assert.deepEqual(visibleScreens(), ['teacherNotice'], 'বাতিলে বোর্ডেই থাকা');

  ctx.click($('#teacherNotice [data-teacher-view="home"]'));
  await settle();
  ctx.click($('#teacherHome .teacher-academic-hub'));
  await settle();
  ctx.click($('#teacherAcademic [data-teacher-view="suggestion"]'));
  await settle();
  assert.equal(ctx.window.location.hash, '#suggestion');
  assert.equal(nfc($('#teacherRecordsTitle').textContent.trim()), nfc('সাজেশন'), 'শিরোনাম খোলা টাইপের নাম নেয়');
  assert.equal($('#teacherModalBackdrop').hidden, true);
});

test('একই ফিচার দুই মেনু থেকে একই ভিউ ও একই hash-এ পৌঁছায়', async () => {
  ctx.click($('.admin-bottom [data-teacher-view="home"]'));
  await settle();
  ctx.click($('#teacherHome [data-teacher-view="online-exams"]'));
  await settle();
  const fromHome = ctx.window.location.hash;
  assert.equal(fromHome, '#online-exams');
  assert.deepEqual(visibleScreens(), ['teacherOnlineExams']);
  ctx.click($('.admin-bottom [data-teacher-view="home"]'));
  await settle();
  ctx.click($('.admin-bottom [data-teacher-view="online-exams"]'));
  await settle();
  assert.equal(ctx.window.location.hash, fromHome, 'হোম-কার্ড ও নিচের সিট একই hash দেয়');
});

test('নম্বর ও ফলাফল একটি আলাদা লেন ও আলাদা রুট (`#marks`), পুরোনো `#exam` alias', async () => {
  ctx.click($('.admin-bottom [data-teacher-view="online-exams"]'));
  await settle();
  ctx.click($('#teacherOnlineExams [data-teacher-view="exam"]'));
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
  assert.equal($$('#teacherRoutine [data-teacher-view="routine"]').length, 1, 'উপস্থিতির একটাই দরজা');
  ctx.click($('#teacherRoutine [data-teacher-view="routine"]'));
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

test('মার্কআপ স্তরে ডুপ্লিকেট-দরজার হিসাব: হোম ৫, ক্লাস ২, একাডেমিক ৬', () => {
  const html = readFileSync(new URL('../teacher.html', import.meta.url), 'utf8');
  const section = id => {
    const start = html.indexOf(`<section id="${id}"`);
    const next = html.indexOf('<section id="teacher', start + 10);
    return html.slice(start, next > 0 ? next : html.lastIndexOf('<nav class="admin-bottom"'));
  };
  const doors = chunk => [...chunk.matchAll(/data-teacher-view="([a-z-]+)"/g)].map(match => match[1]).filter(v => v !== 'home');
  assert.deepEqual(doors(section('teacherHome')), ['academic', 'class-chat', 'homework', 'online-exams', 'routine-view']);
  assert.deepEqual(doors(section('teacherClasses')), ['homework', 'routine-view'], 'ক্লাস স্ক্রিনে একাডেমিক হাবের পুনরাবৃত্তি নেই');
  assert.deepEqual(doors(section('teacherAcademic')),
    ['homework', 'suggestion', 'lecture-sheets', 'courses', 'notice'], 'হাবে এক দরজা প্রতি ফিচার');
  assert.equal(html.includes('data-courses-action="new"') && section('teacherAcademic').includes('data-courses-action="new"'), false,
    'নতুন লেকচার শিটের দ্বিতীয় দরজা হাবে নেই');
});
