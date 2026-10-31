/* Acceptances for the 2026-10-28 ActivePlus Coaching master plan.
 *
 *   Phase 1(a) institute address propagation — one record, every surface;
 *   Phase 1(b) "শ্রেণি চ্যাট ও মডারেশন" removed from every panel;
 *   Phase 2    lecture-sheet authoring granted to Teacher and Manager.
 *
 * The tests read production markup and the real modules (no fixtures that could
 * drift), and they fail loudly if a removed surface comes back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const doc = name => new JSDOM(read(name + '.html')).window.document;
const PANELS = ['student', 'teacher', 'manager', 'admin', 'payment'];

/* ------------------------------------------------------------------ Phase 1a */

test('institute details come from one record: no panel hard-codes the address', () => {
  /* The reported bug was three copies of the address, only one of which the
     Settings save rewrote. A literal district/campus line in markup is the
     regression this test exists for. */
  for (const panel of PANELS) {
    const html = read(panel + '.html');
    assert.doesNotMatch(html, /কানুনগোপাড়া, বোয়ালখালী/, `${panel}.html must not carry an address copy`);
    assert.doesNotMatch(html, /01819486966/, `${panel}.html must not carry the phone number copy`);
    assert.doesNotMatch(html, /activeplus\.coaching@gmail\.com/, `${panel}.html must not carry the e-mail copy`);
  }
  const org = read('js/org-info.js');
  assert.match(org, /readOrgInfo/, 'one reader for the shared record');
  assert.match(org, /DEFAULT_APP_SETTINGS/, 'fallbacks stay owned by js/config.js');
});

test('every live institute surface carries a data-org hook the painter fills', () => {
  // Dashboard institute card (the surface that stayed stale).
  const admin = doc('admin');
  const card = admin.querySelector('#adminHomeInstituteCard');
  assert.ok(card, 'the Admin dashboard keeps its institute card');
  assert.ok(card.querySelector('[data-org-name]'), 'name is painted, not literal');
  assert.ok(card.querySelector('[data-org-address]'), 'address is painted, not literal');
  assert.ok(card.querySelector('[data-org-helpline]'), 'helpline is painted');
  assert.ok(card.querySelector('[data-org-email]'), 'e-mail is painted');
  assert.ok(card.querySelector('[data-org-live]'), 'the block reveals itself only after the first paint');

  // Login screen.
  const login = doc('index');
  assert.ok(login.querySelector('.auth-org [data-org-address]'), 'the login card shows the current address');

  // Student Help sheet.
  const student = doc('student');
  const help = student.querySelector('#studentHelpModal');
  assert.ok(help, 'the Help sheet exists');
  assert.ok(help.querySelector('[data-org-address]'), 'Help reads the shared address');
  assert.ok(help.querySelector('[data-org-tel]'), 'Help dials the shared helpline');
  assert.ok(help.querySelector('[data-org-email-mail]'), 'Help mails the shared address');

  // Topbar slogan on every panel.
  for (const panel of PANELS) {
    assert.ok(doc(panel).querySelector('[data-fixed-tagline]'), `${panel} topbar slogan is painted`);
  }
});

test('a settings save repaints in the same tab — no reload required', () => {
  const storage = read('js/storage.js');
  assert.match(storage, /CustomEvent\('apc-app-config-saved'/, 'saveAppConfig announces the write in this tab');
  const org = read('js/org-info.js');
  assert.match(org, /APP_CONFIG_SAVED_EVENT/, 'the painter listens for that announcement');
  assert.match(org, /addEventListener\('storage'/, 'other tabs/devices repaint from the storage event');
  const admin = read('js/admin.js');
  assert.match(admin, /const saved = saveAppConfig\(/, 'the save result is checked');
  assert.match(admin, /applyOrgInfo\(\)/, 'the Admin repaints immediately after a save');
  assert.match(admin, /renderDashboard\(\)/, 'the dashboard card is refreshed without leaving Settings');
  assert.match(admin, /সংরক্ষিত হয়েছে — \$\{info\.address\}/, 'the toast names the saved address');
  assert.match(admin, /সংরক্ষণ করা যায়নি/, 'a failed write is reported, not silently ignored');
});

test('documents read the shared record at generation time', () => {
  for (const file of ['js/finance-receipt.js', 'js/report-layout.js']) {
    const source = read(file);
    assert.match(source, /campusAddress|readOrgInfo|orgContactLine/, `${file} reads the central record`);
  }
});

/* ------------------------------------------------------------------ Phase 1b */

test('the class-chat & moderation console is gone from Admin and Manager', () => {
  for (const panel of ['admin', 'manager']) {
    const html = read(panel + '.html');
    const document = doc(panel);
    assert.equal(document.querySelector('#classChatTopbarButton'), null, `${panel}: chat topbar button removed`);
    assert.equal(document.querySelector('[data-class-chat-mount]'), null, `${panel}: chat mount removed`);
    assert.equal(document.querySelector(`[data-${panel}-view="class-chat"]`), null, `${panel}: chat route removed`);
    assert.doesNotMatch(html, /class-chat-head\.js/, `${panel}: chat head script removed`);
    assert.doesNotMatch(html, /মডারেশন/, `${panel}: no moderation copy left`);
  }
  const adminJs = read('js/admin.js');
  assert.doesNotMatch(adminJs, /mountAdminClassChat/, 'the admin chat mount is deleted');
  const managerJs = read('js/manager.js');
  assert.doesNotMatch(managerJs, /mountManagerClassChat|managerChatFlight/, 'the manager chat mount is deleted');
  const perms = read('js/admin-permissions.js');
  assert.doesNotMatch(perms, /'class-chat'/, 'no chat route in the capability map');
});

test('moderation primitives are deleted from the chat data layer', () => {
  const chat = read('js/class-chat.js');
  for (const symbol of ['pinClassMessage', 'unpinClassMessage', 'deleteClassMessage', 'setClassRoomLock', 'assertStaffModerationAccess', 'STUDENT_LOCKED_NOTICE']) {
    assert.doesNotMatch(chat, new RegExp(`export function ${symbol}\\b|export const ${symbol}\\b`), `${symbol} is gone`);
  }
  assert.doesNotMatch(chat, /data-chat-action="(?:pin|unpin|delete|toggle-lock|unlock-banner)"/, 'no moderation controls in the UI');
  assert.doesNotMatch(chat, /data-chat-pinned-banner|data-chat-room-lock-banner|data-chat-locked-notice/, 'no lock/pin chrome');
  const relay = read('js/class-chat-relay.js');
  assert.doesNotMatch(relay, /hasPin|pinnedMessageId/, 'the relay keeps no pinned records');
});

test('the remaining chat pages still work for the roles that use them', () => {
  for (const panel of ['student', 'teacher']) {
    const document = doc(panel);
    assert.ok(document.querySelector('#classChatTopbarButton'), `${panel} keeps its chat shortcut`);
    assert.ok(document.querySelector('[data-class-chat-mount]'), `${panel} keeps its chat page`);
  }
});

/* ------------------------------------------------------------------- Phase 2 */

test('teacher and manager hold the lecture-sheet capability, not just the admin', async () => {
  const { createAccess, CAPABILITIES, VIEW_CAPABILITIES } = await import('../js/admin-permissions.js');
  for (const role of ['admin', 'teacher', 'manager']) {
    assert.equal(createAccess(role).has(CAPABILITIES.CONTENT_LECTURE_SHEETS), true, `${role} may author lecture sheets`);
  }
  assert.equal(createAccess('payment').has(CAPABILITIES.CONTENT_LECTURE_SHEETS), false, 'the counter never authors content');
  /* Inside the Admin panel the studio stays part of content oversight, so every
     admin detail page keeps inheriting exactly its hub capability. */
  assert.equal(VIEW_CAPABILITIES['content-lecture-sheets'], 'data.manage',
    'the admin studio view keeps its hub capability');
});

test('each staff panel has a single-purpose lecture-sheet page mounted with its own role', () => {
  const cases = [
    ['teacher.html', 'teacherLectureSheets', '#teacherLectureSheetsMount', 'teacher'],
    ['manager.html', 'managerLectureSheets', '#managerLectureSheetsMount', 'manager'],
    ['admin.html', 'contentLectureSheets', '#adminLectureSheetsMount', 'admin']
  ];
  for (const [file, view, mount, role] of cases) {
    const document = doc(file.replace('.html', ''));
    assert.ok(document.querySelector(`#${view}`) || document.querySelector(`[aria-labelledby="${view}Title"]`),
      `${file} has the dedicated studio page`);
    assert.ok(document.querySelector(mount), `${file} has the studio mount point`);
    /* The Admin studio is mounted from js/admin-content.js; the staff panels
       mount it from their own composition root. */
    const js = read(`js/${file === 'admin.html' ? 'admin-content' : file.replace('.html', '')}.js`);
    assert.match(js, new RegExp(`mountLectureSheetManager\\(\\{[^}]*role: '${role}'`),
      `${file} mounts the studio as ${role}`);
  }
});

test('the teacher and manager routes reach the studio', async () => {
  const teacher = read('js/teacher.js');
  assert.match(teacher, /'lecture-sheets'/);
  assert.match(teacher, /mountTeacherLectureSheets\(\)/);
  const manager = read('js/manager.js');
  assert.match(manager, /'lecture-sheets'/);
  assert.match(manager, /mountManagerLectureSheets\(\)/);
  // The store itself accepts the three authoring roles and nothing else.
  const store = read('js/lecture-sheet-store.js');
  assert.match(store, /verifyCourseStaffActor\(role\)/, 'scope is resolved from the signed-in staff session');
  const content = read('js/course-content.js');
  assert.match(content, /\['admin', 'teacher', 'manager'\]\.includes\(role\)/, 'writes stay inside the three staff roles');
});

/* ------------------------------------------------------------------- Phase 3 */

test('no panel outside Student Home carries a hero card or hero banner', () => {
  for (const panel of ['teacher', 'manager', 'payment', 'admin']) {
    const html = read(panel + '.html');
    assert.doesNotMatch(html, /teacher-hero-scene/, `${panel} carries no hero scene`);
    assert.doesNotMatch(html, /data-(?:admin|pay|manager|teacher)-hero-art/, `${panel} carries no hero artwork`);
    assert.doesNotMatch(html, /teacher-hero-glint/, `${panel} carries no day/night glint`);
    assert.doesNotMatch(html, /assets\/images\/teacher-hero\//, `${panel} references no hero image`);
    /* What survives is a compact page head: title + advice line + date pill.
       The Admin panel was flattened in its own earlier refactor and uses flat
       page headers instead, which is the same idea. */
    if (panel === 'admin') assert.match(html, /admin-page-header|admin-home/, 'the admin keeps flat page headers');
    else assert.match(html, /panel-compact-head/, `${panel} uses the shared compact head`);
  }
  /* The Student Home keeps its carousel — it is the one surface allowed one. */
  assert.match(read('student.html'), /data-student-home-hero/, 'the Student hero stays');
});

test('all non-student panels share one navigation language: same seats, same icons', () => {
  for (const panel of ['teacher', 'manager', 'payment', 'admin']) {
    const document = doc(panel);
    const bar = document.querySelector('.admin-bottom');
    assert.ok(bar, `${panel} has a bottom bar`);
    const seats = [...bar.querySelectorAll(':scope > button')];
    assert.ok(seats.length >= 4, `${panel} keeps its seats`);
    for (const seat of seats) {
      /* Same structure as the Student bar: one glyph chip + one label. */
      assert.ok(seat.querySelector('.nav-chip'), `${panel}: ${seat.textContent.trim()} has a nav chip`);
      assert.ok(seat.querySelector('svg image, svg path'), `${panel}: ${seat.textContent.trim()} draws its icon`);
      assert.ok(seat.textContent.trim().length > 0, `${panel}: every seat has a Bangla label`);
    }
    const active = seats.filter(seat => seat.hasAttribute('aria-current'));
    assert.equal(active.length, 1, `${panel} marks exactly one active seat`);
  }
});

test('a desktop rail turns the same bottom bar sideways — one implementation', () => {
  const css = read('css/ui-wallet.css');
  assert.match(css, /@media \(min-width: 1024px\)/, 'the rail is a desktop-only layer');
  assert.match(css, /grid-template-columns: 248px minmax\(0, 1fr\)/, 'the shell reserves one rail column');
  assert.match(css, /flex-direction: column;[\s\S]{0,400}?\.pay-shell > \.admin-bottom/, 'the counter rail is the same list');
  /* No second sidebar implementation may appear anywhere else. */
  for (const file of ['css/ui-layout.css', 'css/ui-components.css', 'css/ui-modern.css', 'css/app-polish.css']) {
    assert.doesNotMatch(read(file), /grid-template-columns: 248px/, `${file} must not add a second rail`);
  }
});

test('chat opens full-screen, and only the panels that own a chat page can', () => {
  const css = read('css/ui-wallet.css');
  assert.match(css, /\.app-shell\.is-chat-fullscreen/, 'the Student shell escapes to full screen');
  assert.match(css, /:has\(> \.app-main > #classChatView\.active/, 'the chat view alone triggers it');
  const student = read('js/shell.js');
  assert.match(student, /is-chat-fullscreen/, 'the student router toggles the class');
  const teacher = read('js/teacher.js');
  assert.match(teacher, /is-chat-fullscreen/, 'the teacher router toggles the class');
  /* Full-screen mode must not leave the shared chrome over the conversation. */
  const chromeRule = css.slice(css.indexOf(') > :is(.app-topbar, .bottom-nav, .admin-bottom),'));
  assert.match(chromeRule.slice(0, 400), /display: none !important/, 'the chrome hides while the chat is open');
});

test('every staff panel route is deep-linkable and Back returns to the parent page', () => {
  /* Teachers and managers keep a hash route per page (js/panel-route.js), so a
     shared link opens the same screen and Back leaves the panel only once. */
  for (const panel of ['teacher', 'manager']) {
    const js = read(`js/${panel}.js`);
    assert.match(js, /onRouteChange\(/, `${panel} restores the page named in the URL`);
    assert.match(js, /rememberRoute\(/, `${panel} keeps the URL in step with the view`);
  }
  /* Sub-pages show a real Back control; top-level pages rely on the bottom bar. */
  const teacherDoc = doc('teacher');
  const studioBack = teacherDoc.querySelector('#teacherLectureSheets .pay-back');
  assert.equal(studioBack?.getAttribute('data-teacher-view'), 'academic', 'the studio returns to একাডেমিক');
  const managerDoc = doc('manager');
  const managerStudio = managerDoc.querySelector('[data-view-panel="lecture-sheets"]');
  assert.equal(managerStudio?.querySelector('.pay-back')?.getAttribute('data-manager-view'), 'courses',
    'the manager studio returns to পাঠ্য উপকরণ');
});
