/* Delivery budget — the weight each role actually installs.

   Install used to pull one list for every device: 4 × panel pages, the panel
   roots, the report builder, the exam manager, the lecture studio and its
   598 KB Tiptap SDK — a student on a prepaid Bangladeshi connection paid for
   the staff half they can never open. sw.js now keeps two lists over one cache
   and one release pin, and the page names the shell it needs at registration.

   These checks are structural on purpose: they read the shipped sw.js, the two
   registrars and the panel pages, so a future edit that re-merges the lists —
   or forgets the hint — fails here rather than on a student's data bill. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** The `'./x' + '?v=…'` entries of one precache array, as written. */
function shellEntries(name) {
  const block = read('sw.js').split(`const ${name} = [`)[1].split('];')[0];
  return [...block.matchAll(/'(\.[^']*)'(?:\s*\+\s*'([^']*)')?/g)].map(([, path, suffix = '']) => path + suffix);
}

const APP = shellEntries('APP_SHELL');
const STAFF = shellEntries('STAFF_SHELL');

test('the two precache sets are disjoint, complete and installed together', () => {
  assert.ok(APP.length > 200, 'the student half keeps the full student app');
  assert.ok(STAFF.length >= 40, 'the staff half is a real set, not a token');
  assert.deepEqual(APP.filter(entry => STAFF.includes(entry)), [], 'no file is in both lists');
  /* install() and the activate() retry fill the same, hint-aware set. */
  const sw = read('sw.js');
  assert.match(sw, /const PRECACHE = \[\.\.\.APP_SHELL, \.\.\.STAFF_SHELL\]/, 'the staff device still gets everything');
  assert.match(sw, /function precacheUrls\(\)[\s\S]{0,160}PRECACHE : APP_SHELL/, 'the hint picks the set');
  assert.match(sw, /await fillCache\(cache, precacheUrls\(\)\)/, 'install honours it');
  assert.match(sw, /const shellUrls = precacheUrls\(\)/, 'and so does the activate retry');
  /* No hint is the student set: the smaller install is the safe default. */
  assert.match(sw, /=== 'staff' \? 'staff' : 'student'/, 'an unknown or missing hint means student');
});

test('a student device never installs a staff page or the studio', () => {
  for (const entry of ['./admin.html', './manager.html', './teacher.html', './payment.html',
    './js/admin.js', './js/teacher.js', './js/manager.js', './js/payment.js',
    './js/lecture-sheet-studio.js', './vendor/lecture-studio/sdk.js',
    './js/exam-manager.js', './css/teacher-panel.css']) {
    assert.ok(STAFF.includes(entry), `${entry} is staff work and belongs in the staff half`);
    assert.ok(!APP.includes(entry), `${entry} must not be forced on a student device`);
  }
  /* What the student app really needs stays in the student half. */
  for (const entry of ['./student.html', './index.html', './js/main.js', './js/shell.js',
    './vendor/firebase/sdk.js', './vendor/supabase/sdk.js', './css/ui-wallet.css',
    './js/notice-center.js', './js/course-hub.js', './js/lecture-sheet-pdf.js',
    /* The report builder is shared: js/student-features.js imports js/reports.js,
       which is why the whole report chain stays in the student half. */
    './js/reports.js', './js/report-catalog.js', './js/report-builders.js']) {
    assert.ok(APP.includes(entry), `${entry} is student work and stays in the student half`);
  }
});

test('every device asks for the shell it needs, at both registration points', () => {
  const registrar = read('js/service-worker.js');
  assert.match(registrar, /const STAFF_PAGES = \['admin\.html', 'manager\.html', 'teacher\.html', 'payment\.html'\]/,
    'the four staff panels are named once');
  assert.match(registrar, /shell=\$\{shellHint\(\)\}/, 'the main registrar names the shell');
  const early = read('js/cache-refresh.js');
  assert.match(early, /shell=\$\{staffPage \? 'staff' : 'student'\}/,
    'the early registrar agrees, so the two never race into different sets');
  /* Every page loads one of those two registrars, so no page is left unnamed. */
  for (const page of ['index.html', 'student.html', 'admin.html', 'manager.html', 'teacher.html', 'payment.html']) {
    const html = read(page);
    assert.match(html, /service-worker\.js\?v=\d+|cache-refresh\.js\?v=\d+/, `${page} registers the worker`);
  }
});

test('nothing in the staff half is reachable from the student pages', () => {
  /* Textual proof over the pages the Student app loads: no student page and no
     module it loads may name a staff-only file. A false "not needed" here is a
     broken student feature, so the check is on the shipped text itself. */
  const studentFacing = ['student.html', 'index.html', 'privacy.html',
    'js/main.js', 'js/shell.js', 'js/app-entry.js', 'js/notifications.js', 'js/notice-center.js',
    'js/student-features.js', 'js/student-study-sections.js', 'js/course-hub.js', 'js/lecture-sheet-pdf.js'];
  const staffOnly = STAFF.filter(entry => entry.endsWith('.js') && !entry.includes('?'));
  for (const file of studentFacing) {
    const source = read(file);
    for (const entry of staffOnly) {
      const name = entry.replace('./', '');
      /* A mention inside a comment is fine; an import is not. */
      const imported = new RegExp(`(?:from|import\\s*\\()\\s*['"\`][^'"\`]*${name.replace('.', '\\.')}`).test(source);
      assert.equal(imported, false, `${file} must not import ${name}`);
    }
  }
});

test('versioned assets are immutable at the edge; the worker and HTML never are', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const rule = vercel.headers.find(header => header.source === '/(js|css|assets|vendor|sync|firebase)/(.*)');
  assert.ok(rule, 'versioned asset paths have their own rule');
  assert.deepEqual(rule.has, [{ type: 'query', key: 'v' }],
    'the immutable header is scoped to ?v= URLs, so an unversioned fetch still revalidates');
  assert.equal(rule.headers.find(header => header.key === 'Cache-Control').value,
    'public, max-age=31536000, immutable');
  /* sw.js and the HTML must keep revalidating or an update could never land. */
  const worker = vercel.headers.find(header => header.source === '/(sw\\.js|firebase-messaging-sw\\.js)');
  assert.match(worker.headers[0].value, /no-cache/);
  const pages = vercel.headers.find(header => header.source === '/(.*\\.html)');
  assert.match(pages.headers[0].value, /no-cache/);

  const firebase = JSON.parse(read('firebase.json'));
  const font = firebase.hosting.headers.find(header => header.source === 'assets/fonts/**.woff2');
  assert.ok(font, 'Firebase Hosting pins the font itself (it cannot match a query string)');
  assert.match(font.headers[0].value, /immutable/);
});

test('the release pin is still one number across pages, worker and cache', () => {
  const sw = read('sw.js');
  const cacheVersion = Number(sw.match(/const CACHE_VERSION = (\d+)/)?.[1]);
  const swVersion = Number(read('js/service-worker.js').match(/SW_VERSION = (\d+)/)?.[1]);
  const refreshVersion = Number(read('js/cache-refresh.js').match(/DEFAULT_VERSION = (\d+)/)?.[1]);
  assert.equal(cacheVersion, swVersion);
  assert.equal(cacheVersion, refreshVersion);
  for (const page of ['index.html', 'student.html', 'admin.html', 'manager.html', 'teacher.html', 'payment.html']) {
    const pins = [...read(page).matchAll(/\?v=(\d+)/g)].map(match => Number(match[1]))
      .filter(pin => pin !== 379); // the Student hero keeps its documented staging build
    assert.ok(pins.length >= 10, `${page} is version-pinned`);
    assert.deepEqual([...new Set(pins)], [cacheVersion], `${page} pins every asset to this build`);
  }
});
