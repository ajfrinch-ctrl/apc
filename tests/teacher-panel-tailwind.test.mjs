/* Teacher panel — Tailwind pipeline + the picture hero (2026-10-21 rewrite).
   ----------------------------------------------------------------------------
   The owner asked for the teacher interface to be rebuilt with Tailwind and for
   the Home hero to be the picture itself: "স্বাগতম, <teacher name>" and the
   daily line sit inside the image card, and the gradient card that used to sit
   behind the artwork is gone. These assertions lock that structure and the
   scoped build it depends on. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const html = read('teacher.html');
const page = new JSDOM(html).window.document;

test('the teacher panel loads one scoped Tailwind sheet instead of an inline style block', () => {
  const links = [...page.querySelectorAll('link[rel="stylesheet"]')].map(link => link.getAttribute('href'));
  assert.equal(links.filter(href => href.startsWith('css/teacher-panel.css')).length, 1,
    'the compiled Tailwind sheet is linked exactly once');
  assert.equal(links.at(-1).split('?')[0], 'css/teacher-panel.css',
    'the teacher sheet loads after the canonical cascade');
  assert.doesNotMatch(html, /<style[\s>]/i, 'no presentation lives inside teacher.html any more');
  assert.doesNotMatch(html, /\sstyle="/, 'no inline styles sneak back into the markup');
});

test('the Tailwind build is teacher-only: preflight off, everything scoped to .teacher-reference', () => {
  const config = read('tailwind.config.cjs');
  assert.match(config, /corePlugins:\s*\{\s*preflight:\s*false\s*\}/, 'preflight stays off for the shared cascade');
  assert.match(config, /important:\s*'\.teacher-reference'/, 'every utility is prefixed with the teacher body class');
  assert.match(config, /'\.\/teacher\.html'/, 'the markup is scanned for utilities');
  assert.equal(page.body.className.trim(), 'teacher-reference', 'the scope class is still on the teacher body');

  const source = read('css/tailwind/teacher.src.css');
  assert.match(source, /@tailwind base;/, 'the base layer is declared');
  assert.match(source, /@tailwind components;/, 'the components layer is declared');
  assert.match(source, /@tailwind utilities;/, 'the utilities layer is declared');
  assert.match(source, /--t-scrim-ink:/, 'the hero scrim ink is a token, not a literal');

  const compiled = read('css/teacher-panel.css');
  assert.match(compiled, /\.teacher-reference #teacherHome \.teacher-home-intro\{/, 'the hero rule is scoped');
  assert.match(compiled, /object-fit:cover/, 'the hero artwork fills the card');
  assert.match(html, /class="teacher-hero-content [^"]*min-h-\[var\(--t-hero-min-h\)\]/,
    'the overlay text zone is laid out with Tailwind utilities');
  assert.match(compiled, /\.teacher-reference \.text-on-hero\{color:var\(--pay-on-hero\)\}/,
    'the greeting colour is a scoped Tailwind colour utility');
  /* Nothing may escape the scope: the first selector of the sheet is teacher-only. */
  assert.doesNotMatch(compiled, /(^|\})\.teacher-home-intro\{/,
    'no unscoped teacher rule reaches the other portals');
});

test('every teacher view opens on a compact page head — no hero card, no artwork', () => {
  const hero = page.querySelector('#teacherHome .teacher-home-intro');
  assert.ok(hero, 'the Home head exists');
  assert.equal(hero.hasAttribute('data-home-intro'), true, 'the status surface still anchors after the head');
  assert.equal(hero.classList.contains('panel-compact-head'), true, 'the head uses the shared compact layout');

  /* Owner request 2026-10-28: hero cards/banners are Student-Home only. The
     Teacher panel keeps the information the head carried — weekday·date pill
     and the rotating advice line — and nothing else. */
  assert.equal(hero.querySelector('.teacher-hero-scene'), null, 'no artwork scene');
  assert.equal(page.querySelector('#teacherHeroArt, [data-teacher-hero-art]'), null, 'no hero art image');
  assert.equal(page.querySelector('.teacher-hero-glint, [data-teacher-hero-glint]'), null, 'no day/night glint');
  assert.equal(hero.querySelector('span.admin-hero-icon'), null, 'no identity avatar pill');

  const content = hero.querySelector('.teacher-hero-content');
  assert.ok(content, 'the head keeps its text zone');
  const title = hero.querySelector('h1#teacherHomeTitle');
  const warm = hero.querySelector('p.teacher-hero-warm');
  assert.ok(content.contains(title), 'স্বাগতম sits in the head');
  assert.ok(content.contains(warm), 'the daily line sits in the head');
  assert.equal(title.textContent.trim(), 'স্বাগতম', 'the no-JS fallback greeting is still plain স্বাগতম');
  assert.equal(warm.textContent.trim(), 'আপনার পাঠদান ও শিক্ষার্থীদের অগ্রযাত্রায় আজকের দিনটি হোক ফলপ্রসূ।',
    'the no-JS fallback keeps the advice library head line');
  assert.ok(content.querySelector('[data-teacher-hero-date]'), 'the weekday·date pill stays');
  assert.equal(hero.querySelectorAll('.teacher-hero-scene img, [data-hero-card]').length, 0,
    'the head carries no picture layer');

  /* The old card: a padded gradient surface with a framed picture inside it. It
     must be gone — the picture is the surface, and the text floats over it. */
  const compiled = read('css/teacher-panel.css');
  const ruleFor = selector => {
    const start = compiled.indexOf(selector);
    assert.ok(start >= 0, `${selector} is declared`);
    return compiled.slice(start, compiled.indexOf('}', start));
  };
  const cardRule = ruleFor('.teacher-reference #teacherHome .teacher-home-intro{');
  assert.doesNotMatch(cardRule, /padding:/, 'the card no longer boxes the picture in padding');
  assert.doesNotMatch(cardRule, /background-image/, 'the gradient card behind the artwork is removed');
  assert.match(cardRule, /background:var\(--pay-hero-a\)/, 'the flat hero colour is only the image fallback');
  assert.match(cardRule, /overflow:hidden/, 'the picture is clipped to the card radius');
  const sceneRule = ruleFor('.teacher-reference #teacherHome .teacher-home-intro .teacher-hero-scene{');
  assert.doesNotMatch(sceneRule, /border-radius/, 'the scene is no longer a framed picture inside a card');
  assert.match(sceneRule, /position:absolute/, 'the scene fills the card behind the text');
});

test('ক্লাস uses the same compact head and two class-scoped action cards with primary data hidden', () => {
  const view = page.querySelector('#teacherClasses');
  assert.ok(view.querySelector('.home-dashboard-intro.teacher-home-intro.panel-compact-head'), 'ক্লাস starts with the compact head');
  assert.equal(view.querySelector('.teacher-hero-scene'), null, 'ক্লাস carries no hero banner');
  assert.equal(view.querySelector('#teacherClassesTitle')?.textContent.trim(), 'ক্লাস ও পাঠদান');
  const cards = [...view.querySelectorAll('.teacher-classes-actions .teacher-action-card')];
  /* ২০২৬-১১-০১: একাডেমিক হাবের দরজা হোমের কার্ডেই আছে — ক্লাস স্ক্রিনে তার
     পুনরাবৃত্তি নেই, শুধু ক্লাস-কেন্দ্রিক দুই দরজা। */
  assert.equal(cards.length, 2, 'two class-scoped action cards');
  assert.match(cards[0].textContent, /আমার ক্লাস ও বিষয়/);
  assert.match(cards[0].textContent, /ট্যাপ করে এই ক্লাসের কাজে যান/);
  assert.equal(cards[0].getAttribute('data-teacher-view'), 'homework');
  assert.match(cards[1].textContent, /রুটিন ও সময়সূচি/);
  assert.equal(cards[1].getAttribute('data-teacher-view'), 'routine-view');
  assert.equal(cards.some(card => card.getAttribute('data-teacher-view') === 'academic'), false,
    'the academic hub is not duplicated on ক্লাস');
  const panel = view.querySelector('#teacherClassPanel');
  assert.ok(panel, 'class panel exists');
  assert.equal(panel.hidden, true, 'primary class list data stays hidden');
  assert.ok(view.querySelector('#teacherClassPanel #teacherClassList'), 'the class list remains mounted inside the hidden panel');

  const examsView = page.querySelector('#teacherOnlineExams');
  assert.ok(examsView.querySelector('.home-dashboard-intro.teacher-home-intro.panel-compact-head'),
    'পরীক্ষা starts with the same compact head');
  assert.equal(examsView.querySelector('.teacher-hero-scene'), null, 'পরীক্ষা carries no hero banner');
  assert.equal(examsView.querySelector('#teacherOnlineExamsTitle')?.textContent.trim(), 'পরীক্ষা ও মূল্যায়ন');
  const examCards = [...examsView.querySelectorAll('#teacherExamActions .teacher-action-card')];
  assert.equal(examCards.length, 2, 'two full-width action cards on পরীক্ষা');
  assert.equal(examCards[0].getAttribute('data-teacher-exam'), 'new-mcq');
  assert.equal(examCards[1].getAttribute('data-teacher-exam'), 'home');
  assert.equal(examsView.querySelectorAll('#teacherExamHub .day-tab').length, 4, 'four section chips below the action cards');
  assert.equal(examsView.querySelector('.teacher-local-note')?.hidden, true, 'approval note is hidden by default');
  assert.equal(examsView.querySelector('#teacherExamWorkspace')?.hidden, true, 'exam workspace is hidden by default');

  const hub = page.querySelector('#teacherHome .teacher-academic-hub');
  assert.ok(hub, 'Home carries the academic feature card');
  assert.equal(hub.getAttribute('data-teacher-view'), 'academic', 'the card opens the academic hub screen');
  assert.match(hub.textContent, /একাডেমিক কার্যক্রম/);
  assert.match(hub.getAttribute('aria-label'), /[ঀ-৿]/, 'the card carries a Bengali aria-label');
  assert.equal(hub.tagName, 'BUTTON', 'the card is a real button');
  /* ২০২৬-১১-০১: হোমের দরজাগুলো এখন শুধু নেভিগেশন — ফর্ম খোলে গন্তব্য পেজের
     নিজস্ব তৈরি-কার্ড থেকে, হোমের ওপর মডেল হিসেবে নয়। */
  assert.ok(page.querySelector('#teacherHome .teacher-home-actions .teacher-action-card[data-teacher-view="homework"]'),
    'Home keeps a full-page বাড়ির কাজ door beside the hub');
  assert.equal(page.querySelector('#teacherHome [data-new-activity]'), null,
    'Home opens no create form of its own');
  assert.equal(page.querySelector('#teacherAcademicTitle').textContent.trim(), 'একাডেমিক কার্যক্রম',
    'the academic screen names itself after the feature');

  const compiled = read('css/teacher-panel.css');
  assert.match(compiled, /#teacherHome \.teacher-academic-hub\{/, 'the Home hub card is styled');
});

test('the ক্লাস screen renders full-width hero class cards with subject chips and 3D class artwork', () => {
  const teacherJs = read('js/teacher.js');
  assert.match(teacherJs, /class="teacher-class-hero-main"/, 'class cards render hero main body');
  assert.match(teacherJs, /class="teacher-class-subject-chip"/, 'subjects render as direct chips');
  assert.match(teacherJs, /class="teacher-class-hero-art"/, 'class cards carry 3D class artwork');
  const compiled = read('css/teacher-panel.css');
  assert.match(compiled, /teacher-class-hero-main/, 'the hero class card main column is styled');
  assert.match(compiled, /teacher-class-subject-chip/, 'the subject chip is styled');
  assert.match(compiled, /teacher-class-hero-art/, 'the 3D artwork box is styled');
  const classesView = page.querySelector('#teacherClasses');
  assert.ok(classesView.querySelector('#teacherClassCount'), 'the heading carries a count chip');
});

test('the retired teacher hero artwork is no longer referenced by any panel', () => {
  /* The 828×462 illustrations stay on disk (older backups and the student app
     do not read them), but no panel may reference them any more. */
  for (const file of ['teacher.html', 'manager.html', 'payment.html', 'admin.html']) {
    const markup = read(file);
    assert.doesNotMatch(markup, /assets\/images\/teacher-hero\//, `${file} references no hero artwork`);
    assert.doesNotMatch(markup, /data-hero-card=/, `${file} carries no hero card slot`);
  }
});

test('every teacher view starts with the compact head: heading, advice line, no artwork', () => {
  const views = [...page.querySelectorAll('.teacher-view')];
  /* 13 since the lecture-sheet studio page arrived (owner decision 2026-10-28). */
  assert.equal(views.length, 13, 'all 13 teacher views are audited');
  for (const view of views) {
    const hero = view.querySelector(':scope > .home-dashboard-intro.teacher-home-intro');
    assert.ok(hero, `${view.id} starts with a page head`);
    assert.equal(hero.classList.contains('panel-compact-head'), true, `${view.id} uses the compact head`);
    assert.equal(hero.querySelector('.teacher-hero-scene, [data-teacher-hero-art]'), null,
      `${view.id} carries no hero artwork`);
    const content = hero.querySelector(':scope > .teacher-hero-content');
    assert.ok(content, `${view.id} head has a text zone`);
    assert.ok(content.querySelector('[data-teacher-hero-date]'), `${view.id} head has a date pill`);
    const h1 = content.querySelector('.teacher-hero-welcome h1');
    const advice = content.querySelector('.teacher-hero-welcome p.teacher-hero-advice');
    assert.ok(h1 && h1.textContent.trim().length > 0, `${view.id} head has a heading`);
    assert.ok(advice && advice.textContent.trim().length > 0, `${view.id} head has an advice line`);
    /* A sub-page may show a real Back control (the lecture studio returns to
       একাডেমিক); every other page keeps the hidden top Back because the bottom
       bar already returns home. */
    const backBtn = hero.querySelector('.pay-back');
    if (backBtn) {
      const expectsVisible = view.id === 'teacherLectureSheets';
      assert.equal(backBtn.hidden, !expectsVisible, `${view.id} top back button visibility`);
    }
  }
  const moreCards = [...page.querySelectorAll('#teacherMore .teacher-more-actions .teacher-action-card')];
  assert.equal(moreCards.length, 6, 'আরও has 6 full-width action cards');
  assert.equal(page.querySelector('#teacherProfile > #teacherProfileCard')?.tagName, 'ARTICLE',
    'আমার প্রোফাইল card sits directly on #teacherProfile outside the collapsed settings groups');
});

test('single-theme Tailwind tokens unify cards, inputs, empty states, and Bengali date fields across all screens', () => {
  const compiled = read('css/teacher-panel.css');
  assert.match(compiled, /html:not\(\[data-theme=dark\]\) \.teacher-reference\{[^}]*--color-bg:#f8fafc/,
    'light theme uses the unified slate-50 page background');
  assert.match(compiled, /input\[type=date\]\[data-date-bn\]:not\(\[data-date-bn=""\]\):not\(:focus\):before\{content:attr\(data-date-bn\)/,
    'date inputs render their Bengali formatted date via data-date-bn');
});

test('the committed stylesheet is what the Tailwind build produces', { skip: !existsSync(path.join(root, 'node_modules/.bin/tailwindcss')) }, () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'apc-teacher-css-')), 'teacher-panel.css');
  try {
    execFileSync(path.join(root, 'node_modules/.bin/tailwindcss'), [
      '-c', 'tailwind.config.cjs',
      '-i', 'css/tailwind/teacher.src.css',
      '-o', out,
      '--minify'
    ], { cwd: root, stdio: 'pipe' });
    assert.equal(readFileSync(out, 'utf8'), read('css/teacher-panel.css'),
      'run `npm run build:teacher-css` and commit the result');
  } finally {
    rmSync(path.dirname(out), { recursive: true, force: true });
  }
});
