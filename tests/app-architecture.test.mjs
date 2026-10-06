/* The App Architecture is a contract (docs/APP-ARCHITECTURE.md):
     • Student's bottom bar is exactly হোম / পড়াশোনা / রুটিন / পরীক্ষা / আরও;
     • পড়াশোনা is one screen with five sections, and the teacher board is a
       single instance that is *moved* between them;
     • ফলাফল is a tab of পরীক্ষা — never a second menu entry;
     • আরও holds only প্রোফাইল / রিপোর্ট / নোটিফিকেশন / ফি / সেটিংস / সহায়তা, and
       ফি is read-only;
     • every feature that existed before still exists exactly once.
   These assertions are about placement and single-sourcing, not about pixels. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const html = read('index.html');
/* Bangla text mixes precomposed and combining forms; compare in NFC. */
const nfc = value => String(value ?? '').normalize('NFC');

test('the student bottom bar is exactly হোম / পড়াশোনা / রুটিন / পরীক্ষা / আরও', async () => {
  const ctx = await loadPage('index.html');
  const links = ctx.$$('.bottom-nav .bottom-link');
  assert.deepEqual(links.map(link => link.dataset.view), ['home', 'courses', 'routine', 'exams', 'profile']);
  assert.deepEqual(links.map(link => nfc(link.textContent.trim())), ['হোম', 'পড়াশোনা', 'রুটিন', 'পরীক্ষা', 'আরও'].map(nfc));
  for (const link of links) assert.ok(link.querySelector('svg'), 'every bottom-bar item keeps its icon');
  ctx.window.close();
});

test('ফলাফল is a tab of পরীক্ষা, and #results stays only as an inbound alias', async () => {
  const ctx = await loadPage('index.html');
  const { setView, viewRouteFromHash } = await import('../js/shell.js');
  assert.equal(ctx.$('#resultsView'), null, 'the separate results view is gone');
  assert.equal(ctx.$$('[data-view="results"]').length, 0, 'no control may route to a results view of its own');
  const tabs = ctx.$$('#examTabs [data-exam-tab]');
  assert.deepEqual(tabs.map(tab => tab.dataset.examTab), ['upcoming', 'live', 'done', 'results']);
  assert.equal(ctx.$('[data-exam-panel="results"]').contains(ctx.$('#teacherResultsBoard')), true,
    'teacher-given marks live in the ফলাফল tab');
  assert.ok(ctx.$('#studentResultOverview'));
  setView('results', { history: 'replace' });
  assert.equal(ctx.$('#examsView').classList.contains('active'), true, 'the old name opens the পরীক্ষা section');
  assert.equal(viewRouteFromHash('#results'), 'results', 'old links still resolve');
  ctx.window.close();
});

test('পড়াশোনা has five sections and one movable teaching board', async () => {
  const ctx = await loadPage('index.html');
  assert.deepEqual(ctx.$$('#studySections [data-study-section]').map(tab => tab.dataset.studySection),
    ['courses', 'homework', 'suggestion', 'bank', 'materials']);
  assert.deepEqual(ctx.$$('[data-study-panel]').map(panel => panel.dataset.studyPanel),
    ['courses', 'homework', 'suggestion', 'bank', 'materials']);
  assert.equal(ctx.$$('#learningBoard').length, 1, 'the teacher board is never duplicated');
  assert.equal(ctx.$$('[data-study-slot="board"]').length, 2, 'বাড়ির কাজ and সাজেশন share the one board');
  assert.equal(ctx.$('#courseHub')?.closest('[data-study-panel]').dataset.studyPanel, 'courses');
  assert.ok(ctx.$('#studyBankList') && ctx.$('#studyMaterialsList') && ctx.$('#studySuggestionList'));
  /* The section tabs are the single visible control: the board's own filter bar
     stays in the DOM as the module's state seam and is hidden. */
  assert.equal(ctx.$('#learningFilters').hidden, true);
  ctx.window.close();
});

test('আরও holds only প্রোফাইল / রিপোর্ট / নোটিফিকেশন / ফি / সেটিংস / সহায়তা', async () => {
  const ctx = await loadPage('index.html');
  const more = ctx.$('#profileView');
  assert.deepEqual(ctx.$$('#profileView .settings-list button').map(button => button.dataset.view).filter(Boolean),
    ['my-profile', 'reports', 'notification-settings', 'student-fee', 'settings']);
  assert.ok(more.querySelector('.help-card'), 'সহায়তা stays the sixth entry');
  const academic = [...more.querySelectorAll('[data-view],[data-action]')]
    .filter(node => ['courses', 'exams', 'homework', 'suggestion', 'question-bank'].includes(node.dataset.view || node.dataset.action));
  assert.deepEqual(academic, [], 'no academic item may hide inside আরও');
  for (const view of ['my-profile', 'settings', 'student-fee']) {
    const panel = ctx.$(`[data-view-panel="${view}"]`);
    assert.ok(panel, `${view} panel missing`);
    assert.equal(panel.querySelector('.pay-back').dataset.view, 'profile', `${view} returns to আরও`);
  }
  ctx.window.close();
});

test('the ফি screen is read-only and reads the one finance store', async () => {
  const ctx = await loadPage('index.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      'activePlus.admin.transactions.v1': JSON.stringify([
        { id: 'TX-1', studentId: 'AP-ARCH-1', amount: 500, feeType: 'মাসিক বেতন', month: 'অক্টোবর ২০২৬', status: 'approved' },
        { id: 'TX-2', studentId: 'AP-ARCH-1', amount: 300, feeType: 'পরীক্ষার ফি', month: 'অক্টোবর ২০২৬', status: 'pending' }
      ])
    }
  });
  const { STORAGE_KEYS } = await import('../js/config.js');
  ctx.window.localStorage.setItem(STORAGE_KEYS.account, JSON.stringify({
    status: 'active', student: { id: 'AP-ARCH-1', name: 'আর্কিটেকচার পরীক্ষার্থী', className: 'দশম শ্রেণি', monthlyFee: 800 }
  }));
  ctx.window.sessionStorage.setItem(STORAGE_KEYS.session, '1');
  const { initStudentFee } = await import('../js/student-more.js?architecture-fee');
  const refresh = initStudentFee({ getStudent: () => ({ id: 'AP-ARCH-1', name: 'আর্কিটেকচার পরীক্ষার্থী', className: 'দশম শ্রেণি' }) });
  await refresh();
  await ctx.flush();
  const mount = ctx.$('#studentFeeMount');
  assert.match(mount.textContent, /বাকি/);
  assert.match(mount.textContent, /পরিশোধের ইতিহাস/);
  assert.equal(mount.querySelectorAll('input, textarea, select, form').length, 0, 'students never edit the ledger');
  assert.equal(ctx.$$('#studentFeeMount [data-action]').length, 0, 'no write action may live on the fee screen');
  ctx.window.close();
});

test('Home keeps the five quick academic cards and the latest-notice preview', async () => {
  const ctx = await loadPage('index.html');
  assert.deepEqual(ctx.$$('#studentServices .pay-tile-label').map(node => node.textContent.trim()),
    ['বাড়ির কাজ', 'সাজেশন', 'প্রশ্নব্যাংক', 'পরীক্ষা', 'ফলাফল', 'Notice Board']);
  assert.deepEqual(ctx.$$('#studentServices [data-action]').map(node => node.dataset.action),
    ['homework', 'suggestion', 'question-bank']);
  assert.deepEqual(ctx.$$('#studentServices [data-view]').map(node => node.dataset.view), ['exams', 'exams', 'notice-board']);
  assert.equal(ctx.$('#studentServices [data-exam-tab="results"]').dataset.view, 'exams');
  assert.ok(ctx.$('#homeNoticeList'), 'Home previews the newest notices');
  assert.ok(ctx.$('#noticeBoardList'), 'the full Notice Board still owns the categorized list');
  ctx.window.close();
});

test('every relocated feature still exists exactly once', () => {
  const required = [
    'learningList', 'learningSummary', 'learningFilters', 'courseHub', 'studentExamWorkspace', 'studentPracticeWorkspace',
    'teacherRoutineBoard', 'teacherRoutineList', 'teacherResultsBoard', 'teacherResultsList', 'noticeBoardList',
    'studentReports', 'notificationSettings', 'studentFeeMount', 'darkModeToggle', 'trustedDeviceToggle',
    'dashboardRoutineList', 'dashboardChallengeCard', 'dashboardExamCard', 'dashboardFeeCard', 'dailyQuoteCard'
  ];
  for (const id of required) {
    const count = (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
    assert.equal(count, 1, `#${id} appears ${count} times`);
  }
  assert.equal((html.match(/id="learningBoard"/g) || []).length, 1);
  /* The chapter actions and the homework completion signal are features, not
     decoration: they must survive the relocation untouched. */
  const hub = read('js/course-hub.js');
  for (const action of ['read', 'notes', 'materials', 'important', 'mcq', 'short', 'written', 'model-test', 'results']) {
    assert.match(hub, new RegExp(`key: '${action}'`), `chapter action ${action} is missing`);
  }
  const teaching = nfc(read('js/student-teaching.js'));
  assert.match(teaching, /কাজ সম্পন্ন হয়েছে জানাও/, 'the homework completion signal is missing');
  assert.match(teaching, /এটি শুধু সম্পন্ন হওয়ার খবর/, 'the completion signal keeps its honest note');
  /* Notice and Notification stay separate systems. */
  assert.match(read('js/student-notice-board.js'), /NOTICE_BOARD_READ_PREFIX/);
  assert.match(read('js/notification-store.js'), /notificationByKey|markRead/);
});

test('the retired results route has no leftover button anywhere in the app', () => {
  const pages = ['index.html', 'teacher.html', 'manager.html', 'admin.html', 'payment.html'];
  for (const page of pages) {
    const source = read(page);
    assert.doesNotMatch(source, /data-view="results"/, `${page} still routes to a results view`);
  }
  assert.doesNotMatch(html, /resultsView/, 'the removed results panel is still referenced');
});

/* ---- Teacher panel (docs/APP-ARCHITECTURE.md §9 Phase 2) -------------------- */

const teacherHtml = read('teacher.html');

test('the teacher bottom bar is exactly হোম / একাডেমিক / রুটিন / ফলাফল / আরও', () => {
  const nav = teacherHtml.slice(teacherHtml.indexOf('<nav class="admin-bottom"'), teacherHtml.indexOf('</nav>', teacherHtml.indexOf('<nav class="admin-bottom"')));
  assert.deepEqual([...nav.matchAll(/data-teacher-view="([a-z-]+)"/g)].map(match => match[1]),
    ['home', 'academic', 'routine-view', 'exam', 'more']);
  assert.deepEqual([...nav.matchAll(/<span>([^<]+)<\/span>/g)].map(match => nfc(match[1])),
    ['হোম', 'একাডেমিক', 'রুটিন', 'ফলাফল', 'আরও'].map(nfc));
  for (const item of nav.split('<button').slice(1)) assert.match(item, /<svg/, 'every bottom-bar item keeps its icon');
});

test('একাডেমিক is one hub whose six cards open the screens that already own the work', () => {
  const hub = teacherHtml.slice(teacherHtml.indexOf('id="teacherAcademic"'), teacherHtml.indexOf('id="teacherStudents"'));
  assert.deepEqual([...hub.matchAll(/data-academic-count="([a-z]+)"/g)].map(match => match[1]),
    ['homework', 'suggestion', 'bank', 'materials', 'exams', 'notice']);
  /* Nothing is rebuilt for the hub: each card points at an existing screen. */
  const routes = [...hub.matchAll(/data-(teacher-view|academic-section)="([a-z-]+)"/g)].map(match => `${match[1]}:${match[2]}`);
  assert.ok(routes.includes('teacher-view:homework'));
  assert.ok(routes.includes('teacher-view:suggestion'));
  assert.ok(routes.includes('teacher-view:courses'));
  assert.ok(routes.includes('teacher-view:notice'));
  assert.ok(routes.includes('academic-section:bank'));
  assert.ok(routes.includes('academic-section:exams'));
  /* One examination workspace: প্রশ্নব্যাংক is a screen of it, not a copy. */
  assert.equal((teacherHtml.match(/id="teacherExamWorkspace"/g) || []).length, 1);
  assert.match(read('js/exam-manager.js'), /return \{\s*open\(screen = ''\)/, 'the workspace exposes a deep link');
});

test('teacher Home puts the four create actions in front of the teacher', () => {
  const quick = teacherHtml.slice(teacherHtml.indexOf('id="teacherQuickActions"'), teacherHtml.indexOf('id="teacherAttention"'));
  assert.deepEqual([...quick.matchAll(/data-new-activity="([a-z]+)"/g)].map(match => match[1]), ['homework', 'suggestion']);
  assert.deepEqual([...quick.matchAll(/data-academic-section="([a-z]+)"/g)].map(match => match[1]), ['bank', 'exams']);
  assert.deepEqual([...quick.matchAll(/>([^<]*\+\s*[^<]+)</g)].map(match => nfc(match[1].trim())),
    ['+ বাড়ির কাজ', '+ সাজেশন', '+ প্রশ্ন', '+ পরীক্ষা'].map(nfc));
  /* The teacher's own pending work stays visible from every screen. */
  for (const dot of ['academic', 'routine', 'exam']) assert.match(teacherHtml, new RegExp(`id="navDot-${dot}"`));
});

test('teacher রুটিন is read-only: the Manager owns the schedule, the teacher records attendance', () => {
  const view = teacherHtml.slice(teacherHtml.indexOf('id="teacherRoutine"'), teacherHtml.indexOf('id="teacherAcademicReports"'));
  assert.match(nfc(view), /read-only/);
  assert.match(nfc(view), /উপস্থিতি খুলুন/, 'attendance keeps a door from the routine screen');
  assert.doesNotMatch(view, /data-routine-(save|new|edit)|id="routineForm"/, 'no routine editor in the teacher panel');
  const source = read('js/teacher.js');
  assert.doesNotMatch(source, /saveRoutine\s*\(/, 'the teacher module never writes the office routine');
});

test('teacher আরও keeps only what the new navigation does not own', () => {
  const more = teacherHtml.slice(teacherHtml.indexOf('id="teacherMore"'), teacherHtml.indexOf('id="teacherStudents"'));
  assert.deepEqual([...more.matchAll(/data-teacher-view="([a-z-]+)"/g)].map(match => match[1]),
    ['home', 'students', 'classes', 'reports', 'profile']);
  for (const academic of ['homework', 'suggestion', 'online-exams', 'courses', 'routine']) {
    assert.equal(new RegExp(`data-teacher-view="${academic}"`).test(more), false, `${academic} is duplicated in আরও`);
  }
  /* The class-test marks lane stays reachable from the ফলাফল seat. */
  assert.match(teacherHtml, /data-teacher-view="exam"/);
  const source = read('js/teacher.js');
  assert.match(source, /ACADEMIC_SECTIONS/, 'the hub routes through one table');
  assert.match(nfc(source), /classOptions/, 'the notice composer reuses the assignment picker');
});

test('a teacher notice is class/batch-scoped and stays a notice, never a notification', async () => {
  const rules = await import('../js/notification-rules.js');
  const student = { kind: 'student', studentId: 'AP-1', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ' };
  assert.equal(rules.audienceMatches({ audience: 'সকল শিক্ষার্থী', className: 'দশম শ্রেণি' }, student), true);
  assert.equal(rules.audienceMatches({ audience: 'সকল শিক্ষার্থী', className: 'নবম শ্রেণি' }, student), false,
    'another class never receives the notice');
  assert.equal(rules.audienceMatches({ audience: 'সকল শিক্ষার্থী', className: 'দশম শ্রেণি', group: 'মানবিক' }, student), false,
    'another batch inside the same class never receives it either');
  assert.equal(rules.audienceMatches({ audience: 'সকল শিক্ষার্থী' }, student), true,
    'an untargeted notice keeps reaching everyone exactly as before');
  assert.equal(rules.audienceMatches({ audience: 'সকল শিক্ষার্থী', className: 'দশম শ্রেণি' }, { kind: 'staff' }), true,
    'staff see every notice they publish');
  /* Notice and Notification stay two systems with two stores. */
  assert.match(read('js/teacher.js'), /saveNotices/, 'the composer writes the shared notice store');
  assert.match(read('js/teacher.js'), /createdByRole: 'teacher'/);
  assert.match(read('js/notification-store.js'), /notificationByKey|markRead/);
});
