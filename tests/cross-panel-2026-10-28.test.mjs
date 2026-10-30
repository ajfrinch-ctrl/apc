/* Phase 4 — cross-panel acceptance for the 28 Oct 2026 master plan.

   One test per promise the owner made to stakeholders:

     • the four staff panels (Teacher, Manager, Payment, Admin) share the
       Student navigation contract — same chip, same icon set, same seats;
     • the chat only appears on the panels that own one, and always full screen;
     • the lecture-sheet studio is reachable by Teacher, Manager and Admin but
       never by the Payment counter;
     • institute details reach the documents, not just the dashboard.

   These assertions read the same markup and CSS the browser gets — no mocks of
   app logic. Layout is checked at the CSS-rule level because jsdom has no
   layout engine; the runtime side (deep links, Back, full-screen chat, the
   studio actually mounting) is proven per panel in
   tests/panel-deeplink-2026-10-28.test.mjs and each panel's own suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/* A panel's markup, parsed but not booted: these are contract checks, and each
   panel already boots for real in its own suite (teacher-panel-tailwind,
   manager-panel-shell, admin-panel-shell, counter-*). Booting several panels in
   one file would let one panel's async work run against the next panel's DOM. */
const doc = file => new JSDOM(read(file), { url: 'http://localhost/' });

const PANELS = [
  { file: 'teacher.html', attr: 'data-teacher-view', studio: '#teacherLectureSheetsMount', chat: true },
  { file: 'manager.html', attr: 'data-manager-view', studio: '#managerLectureSheetsMount', chat: false },
  { file: 'payment.html', attr: 'data-pay-section', studio: null, chat: false },
  { file: 'admin.html', attr: 'data-admin-view', studio: '#adminLectureSheetsMount', chat: false }
];

test('all four staff panels share one navigation contract', () => {
  for (const panel of PANELS) {
    const { window } = doc(panel.file);
    const seats = [...window.document.querySelectorAll('.admin-bottom > button')];
    assert.ok(seats.length >= 4, `${panel.file}: at least four seats`);
    for (const seat of seats) {
      assert.ok(seat.querySelector('.nav-chip'), `${panel.file}: every seat has a chip`);
      assert.ok(seat.querySelector('svg image, svg path'), `${panel.file}: every seat draws an icon`);
      assert.ok(seat.querySelector('.nav-label')?.textContent.trim(), `${panel.file}: every seat is labelled`);
      assert.ok(seat.hasAttribute(panel.attr), `${panel.file}: every seat names the page it opens`);
    }
    assert.equal(seats.filter(seat => seat.hasAttribute('aria-current')).length, 1,
      `${panel.file}: exactly one seat is current`);
    /* The Student bar and every staff bar share the icon set, so a 3D glyph
       never turns flat (or vice versa) when a user changes panel. */
    for (const image of window.document.querySelectorAll('.admin-bottom .nav-chip image')) {
      assert.match(image.getAttribute('href'), /^assets\/icons\/ai-3d\//, `${panel.file}: the 3D icon set`);
    }
    window.close();
  }
});

test('one bottom bar on phones, one rail on desktop — no second implementation', () => {
  const css = read('css/ui-wallet.css');
  /* Phone: one rule paints both bars, so height and safe area cannot drift. */
  assert.match(css, /\.bottom-nav, \.admin-bottom \{[^}]*min-height: calc\(66px \+ var\(--safe-bottom\)\)/,
    'the phone bar has one height for every panel');
  /* Desktop: the same list turns sideways inside the shared shell grid. */
  const desktop = css.slice(css.indexOf('@media (min-width: 1024px)', css.indexOf('PANEL SHELL')));
  assert.match(desktop, /grid-template-columns: 248px minmax\(0, 1fr\)/, 'the rail reserves one column');
  assert.match(desktop, /flex-direction: column/, 'the bottom list turns sideways');
  for (const shell of ['.app-shell', '.admin-shell']) assert.ok(desktop.includes(shell), `${shell} uses the rail`);
  assert.match(desktop, /\.pay-shell > \.admin-bottom/, 'the counter uses the same rail');
  for (const file of ['css/ui-layout.css', 'css/ui-components.css', 'css/ui-features.css', 'css/ui-forms.css']) {
    assert.doesNotMatch(read(file), /grid-template-columns: 248px/, `${file} must not add a second rail`);
  }
});

test('the chat is full screen, and only the panel that owns one links it', () => {
  const css = read('css/ui-wallet.css');
  assert.match(css, /\.app-shell\.is-chat-fullscreen/, 'the shell escapes to full screen');
  assert.match(css, /:has\(> \.app-main > #classChatView\.active/, 'only the chat page triggers it');

  const teacher = doc('teacher.html').window;
  const teacherChatEntry = teacher.document.querySelector('[data-teacher-view="class-chat"]');
  assert.ok(teacherChatEntry, 'the teacher panel links its chat page');
  assert.ok(teacher.document.querySelector('#teacherClassChat'), 'the teacher chat page exists');
  for (const role of ['manager', 'payment', 'admin']) {
    const window = doc(`${role}.html`).window;
    assert.equal(window.document.querySelector('[data-class-chat-mount], #classChatTopbarButton, [data-manager-view="class-chat"], [data-admin-view="class-chat"], [data-pay-section="class-chat"]'),
      null, `${role} has no chat page or shortcut`);
    /* Nor do the panel routers mount one. */
    assert.doesNotMatch(read(`js/${role}.js`), /mountClassChat|addClassChatTopbarButton|ClassChatMount/,
      `${role}.js mounts no chat`);
    window.close();
  }
  /* Student and Teacher keep theirs, and both go full screen. */
  assert.match(read('student.html'), /id="classChatView"/, 'the student chat page stays');
  assert.match(read('js/shell.js'), /is-chat-fullscreen/, 'the student shell escapes to full screen');
  assert.match(read('js/teacher.js'), /is-chat-fullscreen/, 'the teacher shell escapes to full screen');
  teacher.close();
});

test('the lecture-sheet studio is staff work, never a counter task', () => {
  for (const panel of PANELS) {
    const window = doc(panel.file).window;
    const html = read(panel.file);
    if (panel.studio) {
      assert.ok(window.document.querySelector(panel.studio), `${panel.file}: the studio page is mounted`);
    } else {
      assert.equal(window.document.querySelector('#teacherLectureSheetsMount, #managerLectureSheetsMount, #adminLectureSheetsMount'),
        null, `${panel.file}: no studio mount`);
      assert.doesNotMatch(html, /lecture-sheet/i, `${panel.file}: the counter never links the studio`);
    }
    window.close();
  }
  /* All three staff roles hold the capability that powers the create tools. */
  const permissions = read('js/admin-permissions.js');
  assert.match(permissions, /CONTENT_LECTURE_SHEETS/, 'the capability exists');
  const access = read('js/lecture-sheet-store.js');
  assert.match(access, /resolveLectureScope/, 'the store resolves a role-scoped writer');
});

test('institute details reach every document surface from the one record', () => {
  /* Documents read the one record (Admin → Settings) instead of spelling the
     address out: receipts and report letterheads take cfg.campusAddress, the
     Help sheet is painted by js/org-info.js through data-org-* hooks. */
  for (const file of ['js/finance-receipt.js', 'js/report-layout.js']) {
    const source = read(file);
    assert.match(source, /campusAddress/, `${file} reads the institute address from the shared config`);
    assert.match(source, /loadAppConfig|cfg\./, `${file} takes it from the live config, not a constant`);
    assert.doesNotMatch(source, /কানুনগোপাড়া, বোয়ালখালী|01819486966/, `${file} hard-codes no institute detail`);
  }
  assert.match(read('js/main.js'), /org-info|orgInfo/, 'the student Help sheet is painted from the one record');
  assert.match(read('student.html'), /data-org-address/, 'the Help sheet carries org hooks, not text');
  /* The same guard for the pages themselves. */
  for (const file of ['admin.html', 'manager.html', 'teacher.html', 'payment.html', 'student.html', 'index.html']) {
    assert.doesNotMatch(read(file), /কানুনগোপাড়া, বোয়ালখালী, চট্টগ্রাম/, `${file} hard-codes no address`);
  }
});
