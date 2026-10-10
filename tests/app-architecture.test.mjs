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
/* One `<section class="admin-view">` panel, from its tag to the matching close. */
function ctxSection(source, name) {
  const marker = `<section class="admin-view`;
  const start = source.indexOf(`data-view-panel="${name}"`);
  if (start < 0) return '';
  const open = source.lastIndexOf(marker, start);
  let depth = 0, i = open;
  while (i < source.length) {
    if (source.startsWith('<section', i)) depth++;
    else if (source.startsWith('</section>', i)) { depth--; if (!depth) return source.slice(open, i); }
    i++;
  }
  return source.slice(open);
}

/* One panel of a page, from its opening tag to the matching close. */
function ctxPanel(source, name) {
  const start = source.indexOf(`data-pay-panel="${name}"`);
  if (start < 0) return '';
  const open = source.lastIndexOf('<section', start);
  let depth = 0, i = open;
  while (i < source.length) {
    if (source.startsWith('<section', i)) depth++;
    else if (source.startsWith('</section>', i)) { depth--; if (!depth) return source.slice(open, i); }
    i++;
  }
  return source.slice(open);
}
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
  assert.deepEqual(ctx.$$('#examTabs [data-practice-mode]').map(tile => tile.dataset.practiceMode),
    ['instant', 'papers', 'recent']);
  assert.equal(ctx.$('[data-exam-panel="results"]').contains(ctx.$('#teacherResultsBoard')), true,
    'teacher-given marks live in the ফলাফল tab');
  assert.ok(ctx.$('#studentResultOverview'));
  setView('results', { history: 'replace' });
  assert.equal(ctx.$('#examResultsView').classList.contains('active'), true, 'the old name opens the ফলাফল page');
  assert.equal(viewRouteFromHash('#results'), 'results', 'old links still resolve');
  ctx.window.close();
});

test('পড়াশোনা has five sections and one movable teaching board', async () => {
  const ctx = await loadPage('index.html');
  assert.deepEqual(ctx.$$('#studySections [data-study-section]').map(tab => tab.dataset.studySection),
    ['courses', 'homework', 'suggestion', 'bank', 'materials', 'model-test', 'practice', 'results', 'other']);
  assert.deepEqual(ctx.$$('[data-study-panel]').map(panel => panel.dataset.studyPanel),
    ['courses', 'homework', 'suggestion', 'bank', 'materials', 'model-test', 'practice', 'results', 'other']);
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
  assert.deepEqual(ctx.$$('#profileView .pay-grid button').map(button => button.dataset.view).filter(Boolean),
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

test('Home keeps the five quick academic cards and the Notice Board tile', async () => {
  const ctx = await loadPage('index.html');
  assert.deepEqual(ctx.$$('#studentServices .pay-tile-label').map(node => node.textContent.trim()),
    ['বাড়ির কাজ', 'সাজেশন', 'প্রশ্নব্যাংক', 'পরীক্ষা', 'ফলাফল', 'Notice Board']);
  assert.deepEqual(ctx.$$('#studentServices [data-action]').map(node => node.dataset.action),
    ['homework', 'suggestion', 'question-bank']);
  assert.deepEqual(ctx.$$('#studentServices [data-view]').map(node => node.dataset.view), ['exams', 'exam-results', 'notice-board']);
  assert.equal(ctx.$('#studentServices [data-exam-tab="results"]').dataset.view, 'exam-results');
  assert.equal(ctx.$('#homeNoticeList'), null, 'the bottom নতুন Notice preview is gone');
  assert.ok(ctx.$('#studentServices [data-view="notice-board"]'), 'Notice Board stays on Home as a tile');
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

test('the teacher bottom bar is exactly হোম / কাজ দিন / রুটিন / পরীক্ষা / আরও', () => {
  const nav = teacherHtml.slice(teacherHtml.indexOf('<nav class="admin-bottom"'), teacherHtml.indexOf('</nav>', teacherHtml.indexOf('<nav class="admin-bottom"')));
  assert.deepEqual([...nav.matchAll(/data-teacher-view="([a-z-]+)"/g)].map(match => match[1]),
    ['home', 'academic', 'routine-view', 'exam', 'more']);
  assert.deepEqual([...nav.matchAll(/<span>([^<]+)<\/span>/g)].map(match => nfc(match[1])),
    ['হোম', 'কাজ দিন', 'রুটিন', 'পরীক্ষা', 'আরও'].map(nfc));
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

test('teacher Home is the launcher: welcome, one 3-column grid over existing screens, today + recent', () => {
  /* মাস্টার প্রম্পট ২০২৬-১০: Home = স্বাগতম + একটি ৩-কলাম আইকন গ্রিড +
     আজকের ক্লাস (Manager routine) + সর্বশেষ ৩টি কাজ। গ্রিড শুধু বিদ্যমান
     স্ক্রিনে রুট করে — create ফর্ম ও pay-tile শেলফ কাজ দিন হাবেই থাকে। */
  const home = teacherHtml.slice(teacherHtml.indexOf('id="teacherHome"'), teacherHtml.indexOf('id="teacherRecords"'));
  assert.match(home, /teacher-home-grid/);
  assert.deepEqual([...home.matchAll(/data-teacher-view="([a-z-]+)"/g)].map(match => match[1]),
    ['homework', 'suggestion', 'courses', 'routine-view', 'online-exams', 'notice'],
    'every grid tile routes to an existing screen');
  assert.equal((home.match(/class="pay-tile"/g) || []).length, 0, 'home grid never copies the pay-tile shelf');
  assert.equal(home.includes('data-new-activity'), false, 'create forms stay on the কাজ দিন hub');
  assert.equal(home.includes('teacherQuickActions'), false, 'home must not duplicate create tiles');
  assert.match(home, /id="teacherTodayClasses"/, 'আজকের ক্লাস from the Manager routine');
  assert.match(home, /id="teacherRecent"/, 'সাম্প্রতিক কাজ — the latest three');
  const hub = teacherHtml.slice(teacherHtml.indexOf('id="teacherAcademic"'), teacherHtml.indexOf('id="teacherNotice"'));
  assert.match(hub, /data-new-activity="homework"/);
  assert.match(hub, /data-new-activity="suggestion"/);
  assert.match(teacherHtml, /id="teacherNewActivity"/);
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

/* ---- Manager panel (docs/APP-ARCHITECTURE.md §2/§3 Manager) ---------------- */

const managerHtml = read('manager.html');

test('the Manager bottom bar is exactly হোম / শিক্ষার্থী / একাডেমিক / হিসাব / রিপোর্ট / আরও', () => {
  const nav = managerHtml.slice(managerHtml.indexOf('<nav class="admin-bottom manager-bottom"'), managerHtml.indexOf('</nav>', managerHtml.indexOf('<nav class="admin-bottom manager-bottom"')));
  assert.deepEqual([...nav.matchAll(/data-manager-view="([a-z-]+)"/g)].map(match => match[1]),
    ['dashboard', 'students', 'academic', 'finance', 'reports', 'more']);
  assert.deepEqual([...nav.matchAll(/<span class="nav-label">([^<]+)<\/span>/g)].map(match => nfc(match[1])),
    ['হোম', 'শিক্ষার্থী', 'একাডেমিক', 'হিসাব', 'রিপোর্ট', 'আরও'].map(nfc));
  for (const item of nav.split('<button').slice(1)) assert.match(item, /<svg/, 'every bottom-bar item keeps its icon');
});

test('Manager শিক্ষার্থী is one screen for the whole lifecycle, and অনুমোদন is a filter of it', () => {
  const panel = managerHtml.slice(managerHtml.indexOf('data-view-panel="students"'), managerHtml.indexOf('data-view-panel="academic"'));
  /* The three lists of the spec: pending registration, active, inactive. */
  assert.deepEqual([...panel.matchAll(/data-student-scope="([a-z]+)"/g)].map(match => match[1]),
    ['all', 'pending', 'approved', 'inactive', 'rejected']);
  assert.match(panel, /id="managerStudentQueue"/, 'the pending queue lives inside শিক্ষার্থী');
  assert.match(panel, /id="managerStudentList"/);
  assert.equal((managerHtml.match(/data-view-panel="approvals"/g) || []).length, 0, 'no second student screen');
  const source = read('js/manager.js');
  for (const action of ['approve-student', 'reject-student', 'edit-student', 'activate-student', 'deactivate-student', 'reset-password']) {
    assert.match(source, new RegExp(`'${action}'`), `শিক্ষার্থী action ${action} is missing`);
  }
  /* The old name still resolves into the same screen with the pending filter. */
  assert.match(source, /approvals: \{ view: 'students', scope: 'pending' \}/);
  assert.match(read('js/office-data.js'), /export async function setStudentStatus/, 'activate/deactivate goes through one roster writer');
  assert.match(read('js/office-data.js'), /status === 'inactive' \? 'inactive' : 'approved'/, 'deactivation is not an approval');
});

test('Manager একাডেমিক is one hub over the eight sections plus teacher management', () => {
  const hubStart = managerHtml.indexOf('data-view-panel="academic"');
  const hub = managerHtml.slice(hubStart, managerHtml.indexOf('data-view-panel="academic-records"'));
  assert.deepEqual([...hub.matchAll(/data-academic-section="([a-z]+)"/g)].map(match => match[1]),
    ['homework', 'suggestion', 'bank', 'materials', 'exams', 'results', 'routine', 'notice']);
  assert.match(hub, /id="managerAcademicTeachers"[\s\S]*data-manager-view="teachers"/, 'teacher management sits in একাডেমিক');
  const source = read('js/manager.js');
  assert.match(source, /ACADEMIC_SECTIONS = Object\.freeze\(/, 'the hub routes through one table');
  assert.match(source, /bank: \{ view: 'exams', screen: 'bank' \}/, 'প্রশ্নব্যাংক deep-links into the one exam workspace');
  assert.equal((managerHtml.match(/id="managerExamWorkspace"/g) || []).length, 1, 'one examination workspace, never a copy');
  /* Nothing academic is duplicated in আরও. */
  const more = read('js/manager.js').slice(read('js/manager.js').indexOf('const MORE_MODULES'));
  const rows = [...more.slice(0, more.indexOf(']')).matchAll(/view: '([a-z-]+)'/g)].map(match => match[1]);
  assert.deepEqual(rows, ['profile', 'settings'], 'আরও keeps only the structural modules');
});

test('Manager হিসাব owns four segments: collection, approval, due and history', () => {
  assert.deepEqual([...managerHtml.matchAll(/data-finance-segment="([a-z]+)"/g)].map(match => match[1]),
    ['collection', 'approval', 'due', 'history']);
  assert.deepEqual([...managerHtml.matchAll(/data-finance-panel="([a-z]+)"/g)].map(match => match[1]),
    ['collection', 'approval', 'due', 'history']);
  for (const id of ['mgrFinanceCollectionNote', 'managerCashList', 'managerFinanceDueList', 'managerPaymentList']) {
    assert.equal((managerHtml.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `#${id} appears once`);
  }
  assert.equal((managerHtml.match(/data-view-panel="cash-counter"/g) || []).length, 0, 'the Cash Counter review was a segment, not a screen of its own');
  const source = read('js/manager.js');
  assert.match(source, /'cash-counter': \{ view: 'finance', segment: 'approval' \}/, 'the old link still opens the approval queue');
  assert.match(source, /function renderCashCounter\(\) \{ financeSegment = 'approval';/, 'one renderer for the queue');
  /* Every money figure still comes from the shared ledger, never a copy. */
  assert.match(source, /financeRepository\.listTransactions/);
  assert.doesNotMatch(source, /saveTransaction\(/, 'the Manager never writes a counter entry');
});

test('a Manager notice is class/batch-scoped and Notice stays separate from Notification', () => {
  const form = managerHtml.slice(managerHtml.indexOf('id="managerNoticeForm"'), managerHtml.indexOf('id="managerNoticeList"'));
  assert.deepEqual([...form.matchAll(/name="(title|body|category|className|group|audience)"/g)].map(match => match[1]),
    ['title', 'body', 'category', 'className', 'group', 'audience']);
  const source = read('js/manager.js');
  assert.match(source, /className: String\(data\.get\('className'\)/, 'the composer writes the scope');
  assert.match(source, /noticeScopeText/, 'the list shows who a notice reaches');
  /* The student board reads the very same store through the shared rule. */
  assert.match(read('js/student-notice-board.js'), /loadNotices\(\)/);
  assert.match(read('js/notification-rules.js'), /export function noticeScopeMatches/);
});

/* ---------------------------- Cash Counter ---------------------------------- */

test('the Cash Counter bottom bar is exactly হোম / শিক্ষার্থী / পেমেন্ট / রিপোর্ট / আরও', async () => {
  const ctx = await loadPage('payment.html');
  const seats = ctx.$$('.admin-bottom .admin-bottom-item');
  assert.deepEqual(seats.map(seat => seat.dataset.paySection), ['home', 'students', 'payment', 'reports', 'more']);
  assert.deepEqual(seats.map(seat => nfc(seat.textContent.trim())), ['হোম', 'শিক্ষার্থী', 'পেমেন্ট', 'রিপোর্ট', 'আরও'].map(nfc));
  for (const seat of seats) assert.ok(seat.querySelector('svg'), 'every seat keeps its icon');
  assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.paySection, 'home');
  ctx.window.close();
});

test('Cash Counter শিক্ষার্থী only verifies identity, and the panel owns no academic work', async () => {
  const source = read('js/payment.js');
  /* Search returns identity + a masked contact, never dues, class or a profile. */
  assert.match(source, /searchCounterStudents/);
  assert.doesNotMatch(source, /studentFeeSummary|loadRoster|mountReports|dueStudents|whatsappTarget|renderQuickPicks/);
  assert.doesNotMatch(source, /saveRoutine|saveNotice|teachingRepository|examRepository|reviewTransaction/,
    'the counter never writes academics, notices, exams or approvals');
  const html = read('payment.html');
  for (const forbidden of [/data-academic-section/, /data-view-panel/, /data-manager-view/, /data-teacher-view/])
    assert.doesNotMatch(html, forbidden, 'another role’s surfaces do not appear here');
  const students = ctxPanel(html, 'students');
  assert.match(students, /id="paySearchCard"/);
  assert.match(students, /id="payProfileCard"/);
  assert.doesNotMatch(students, /id="payCollectionForm"/, 'the entry form belongs to the পেমেন্ট seat');
  assert.match(ctxPanel(html, 'payment'), /id="payCollectionForm"/);
  /* Every money figure comes from the ledger the Manager approves against. */
  assert.match(source, /listCounterTodayTransactions|saveCounterPayment/);
  assert.match(read('js/counter-data.js'), /financeRepository/);
  const reports = ctxPanel(html, 'reports');
  assert.match(reports, /id="paymentReports"/, 'রিপোর্ট is the existing report centre');
  assert.match(read('js/payment.js'), /mountCounterReports/);
});

test('Cash Counter হোম is the day’s own ledger: no dashboard tiles, one list, one receipt', () => {
  const html = read('payment.html');
  const home = ctxPanel(html, 'home');
  assert.match(home, /id="payTodayList"/, 'আজকের লেনদেন is the day’s list');
  assert.equal((home.match(/id="payTodayList"/g) || []).length, 1, 'the list is not duplicated per seat');
  for (const banned of ['payPulse', 'payTodayAmount', 'payMonthAmount', 'payDueStudents', 'payKeypad', 'payStickyBar', 'payDeskTools'])
    assert.doesNotMatch(html, new RegExp(`id="${banned}"`), `the narrowed counter never grows ${banned}`);
  /* Receipt → daily collection: a fresh slip closes onto হোম. */
  assert.match(read('js/payment.js'), /state\.afterReceipt='home'/);
  assert.match(read('js/payment.js'), /entry → receipt → daily collection/);
  /* আরও is the counter's own session, not a second menu. */
  const more = ctxPanel(html, 'more');
  assert.match(more, /id="payMoreLogout"/);
  assert.equal((more.match(/data-pay-section=/g) || []).length, 0, 'আরও lists no other seat');
});

/* -------------------------------- Admin ------------------------------------- */

test('the Admin bottom bar is exactly হোম / স্টাফ / রিপোর্ট / সিস্টেম / ডেটা / অ্যাকাউন্ট', () => {
  const html = read('admin.html');
  const nav = html.slice(html.indexOf('<nav class="admin-bottom"'), html.indexOf('</nav>', html.indexOf('<nav class="admin-bottom"')));
  assert.deepEqual([...nav.matchAll(/data-admin-view="([a-z-]+)"/g)].map(match => match[1]),
    ['dashboard', 'staff', 'reports', 'system', 'data', 'profile']);
  assert.deepEqual([...nav.matchAll(/<span class="nav-label">([^<]+)<\/span>/g)].map(match => nfc(match[1])),
    ['হোম', 'স্টাফ', 'রিপোর্ট', 'সিস্টেম', 'ডেটা', 'অ্যাকাউন্ট'].map(nfc));
  for (const seat of ['dashboard', 'staff', 'reports', 'system', 'data', 'profile'])
    assert.ok(nav.includes(`data-admin-view="${seat}"`), `${seat} keeps a seat`);
  assert.doesNotMatch(nav, /data-admin-view="students"/, 'student management is not an Admin seat');
  assert.doesNotMatch(html, /data-view-panel="more"/, 'the More container is retired');
});

test('Admin সিস্টেম and ডেটা are hubs over the screens that already own the work', () => {
  const html = read('admin.html');
  const system = ctxSection(html, 'system');
  assert.deepEqual([...system.matchAll(/data-admin-view="([a-z-]+)"/g)].map(match => match[1]).slice(1),
    ['roles', 'security', 'settings', 'academics', 'migration'], 'সিস্টেম holds exactly its five cards');
  const data = ctxSection(html, 'data');
  assert.match(data, /id="adminDataMenu"/);
  assert.match(data, /data-admin-view="backup"/, 'ব্যাকআপ ও রিস্টোর is reached from ডেটা');
  /* Each card's screen exists exactly once, as its own panel. */
  for (const view of ['roles', 'security', 'settings', 'academics', 'backup'])
    assert.equal((html.match(new RegExp(`data-view-panel="${view}"`, 'g')) || []).length, 1, view);
  const source = read('js/admin-permissions.js');
  assert.match(source, /export const ADMIN_SYSTEM_NAV/);
  assert.match(source, /export const ADMIN_DATA_NAV/);
  /* A screen inside a hub keeps its own seat lit. */
  assert.match(source, /export const VIEW_SEAT = Object\.freeze\(\{[\s\S]*students: 'dashboard'/);
  assert.match(read('js/admin.js'), /const seatFor = view => VIEW_SEAT\[view\] \|\| view;/);
});

test('Admin does no daily work: no class, routine, notice, exam, fee or collection control', () => {
  const html = read('admin.html');
  for (const banned of ['finance', 'routine', 'notices', 'exams', 'classes', 'cash-counter']) {
    assert.equal((html.match(new RegExp(`data-view-panel="${banned}"`, 'g')) || []).length, 0, banned);
  }
  for (const selector of ['#feeStudentSearch', '#feeCollectionForm', '#addRoutineForm', '#noticeForm', '#dashCollectFee', '#adminExamWorkspace'])
    assert.equal(html.includes(selector), false, `${selector} must not exist in the Admin page`);
  const source = read('js/admin.js');
  assert.doesNotMatch(source, /saveNotice|saveRoutine|saveCounterPayment|saveTeachingActivity/, 'no daily write path');
  /* Student accounts are never created here: self-registration is the only door,
     and Admin may only decide on one that already arrived. */
  assert.match(source, /openRegistrationReview/);
  assert.doesNotMatch(source, /createStudentAccount|registerStudent\(|saveRoster\(\[/);
});

test('the Admin slot is the only one with staff CRUD, and its hub cards are capability-gated', () => {
  const html = read('admin.html');
  const staff = ctxSection(html, 'staff');
  assert.match(staff, /id="staffList"/);
  assert.match(staff, /id="staffCreateButton"/);
  const source = read('js/admin-permissions.js');
  assert.match(source, /STAFF_MANAGE: 'staff\.manage'/);
  const adminGrant = source.slice(source.indexOf('const ADMIN = Object.freeze(['), source.indexOf(']);', source.indexOf('const ADMIN = Object.freeze([')));
  for (const withheld of ['FINANCE_COLLECT', 'FINANCE_VIEW', 'NOTICES_MANAGE', 'ROUTINE_MANAGE', 'EXAMS_PUBLISH', 'TEACHING_PANEL', 'PAYMENT_PANEL'])
    assert.equal(adminGrant.includes(withheld), false, `${withheld} stays outside Admin`);
  /* Every hub card carries the capability that unlocks it. */
  const system = ctxSection(html, 'system');
  for (const match of system.matchAll(/data-admin-view="([a-z-]+)" data-admin-cap="([a-z.]+)"/g)) {
    assert.match(match[2], /\.(manage)$/, `${match[1]} names a management capability`);
  }
  assert.equal((system.match(/data-admin-cap=/g) || []).length, 5, 'all five cards are gated');
});
