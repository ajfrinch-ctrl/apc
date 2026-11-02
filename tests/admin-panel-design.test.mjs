/* Admin panel-wide design — every view opens with the same subtitled hero,
   hub rows end in a chevron icon (never a text arrow), and the surfaces that
   rendered unstyled for years (audit entries, role capability chips) are
   painted like the rest of the panel.

   Static guards; per-view behaviour stays with its own suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('admin.html');
const viewOf = panel => {
  const start = html.indexOf(`data-view-panel="${panel}"`);
  const next = html.indexOf('data-view-panel="', start + 10);
  return html.slice(start, next === -1 ? undefined : next);
};

test('every remaining Admin view opens with a subtitle under its title', () => {
  for (const panel of ['system', 'migration', 'roles', 'students', 'reports', 'backup', 'audit', 'security', 'academics', 'settings']) {
    assert.match(viewOf(panel), /<p class="admin-view-sub">[^<]{8,}<\/p>/, `${panel} has a subtitle`);
  }
  const css = read('css/ui-wallet.css');
  assert.ok(css.includes('.admin-view > .page-intro:first-child p.admin-view-sub {'), 'the skin paints subtitles on the hero band');
});

test('hub rows end in a chevron icon, never a text arrow, and the audit view uses the svg back button', () => {
  assert.doesNotMatch(html, /<span aria-hidden="true">→<\/span>/, 'no text arrows in hub rows');
  assert.equal((html.match(/admin-menu-arrow/g) || []).length, 10, 'system, data, More hub rows (incl. the new নোটিশ ও কনটেন্ট row) carry the arrow slot');
  const audit = viewOf('audit');
  assert.match(audit, /data-icon="back"/, 'the audit back button is the shared svg');
  assert.doesNotMatch(audit, />←<\/button>/, 'no text back arrow');
  assert.ok(viewOf('audit-log').includes('id="gradeAuditList"') && viewOf('audit-exam').includes('id="adminExamWorkspace"'),
    'both audit surfaces stay mounted in their dedicated detail views');
});

test('audit entries and role chips are styled surfaces, painted from tokens', () => {
  const js = read('js/admin.js');
  assert.match(js, /class="audit-entry"/, 'audit rows render as entries');
  assert.doesNotMatch(js, /style="display:flex;align-items:center;gap:6px;"/, 'the class row header is a class, not inline style');
  const css = read('css/ui-wallet.css');
  for (const selector of ['.audit-entry {', '.role-cap-list {', '.role-cap-list li.is-denied {', '.role-icon {', '.class-copy-head {']) {
    assert.ok(css.includes(selector), `${selector} is styled`);
  }
  const section = css.slice(css.indexOf('/* 23 ')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(section, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, 'panel colours belong in foundation.css');
});

test('student avatars show the student initials, grapheme-safe', () => {
  const js = read('js/admin.js');
  assert.match(js, /const initialsOf =/, 'one initials helper');
  assert.match(js, /Segmenter\('bn', \{ granularity: 'grapheme' \}\)/, 'Bengali conjuncts are kept whole');
  // Privacy (owner rule 2026-10-31): the name and its initials avatar are
  // always readable; only the Student ID is masked until it is asked for.
  assert.match(js, /<span class="student-avatar" aria-hidden="true">\$\{escapeHtml\(initialsOf\(name\)\)\}/,
    'the roster avatar is drawn from the always-visible name');
  assert.match(js, /audit-id-badge">ID: \$\{escapeHtml\(revealed \? rowKey : PRIVACY_MASK\)\}/,
    'the Student ID, and only the Student ID, waits behind the reveal');
});

test('Admin Home keeps its text-only welcome while the other 16 views retain their 3D hero cards', () => {
  assert.match(html, /<body class="admin-reference">/, 'admin body carries .admin-reference');
  const allPanels = ['dashboard', 'staff', 'system', 'migration', 'roles', 'students', 'reports', 'data', 'backup', 'audit', 'security', 'academics', 'settings', 'more', 'profile', 'content', 'advice'];
  for (const panel of allPanels) {
    const chunk = viewOf(panel);
    // Hero cards removed from Admin Panel (2026-10-27): no panel loads the large 3D illustration
    assert.doesNotMatch(chunk, /teacher-hero-scene|data-admin-hero-art|data-hero-card=/,
      `${panel} no longer loads the large 3D illustration (hero card removed)`);
    // Date pill / glint / hero advice were part of the hero card and are also removed
    assert.doesNotMatch(chunk, /teacher-hero-scene|teacher-hero-date-pill|teacher-hero-glint|data-admin-hero-advice=/,
      `${panel} has no hero artwork remnants`);
  }
  const actionCardCount = (html.match(/teacher-action-card/g) || []).length;
  assert.ok(actionCardCount >= 30, `admin.html has horizontal .teacher-action-card buttons (${actionCardCount})`);
  assert.doesNotMatch(html, /id="adminHeroAdvice"[^>]*>আজকের পরামর্শ:/, 'admin home advice shows direct advice without prefix');
  const adminJs = read('js/admin.js');
  assert.doesNotMatch(adminJs, /আজকের পরামর্শ:\s*\$\{/, 'renderDashboard sets direct advice text without prefix');
  const academicsJs = read('js/admin-academics.js');
  assert.match(academicsJs, /<p class="eyebrow">পাঠ্য বিষয়<\/p>/, 'academics eyebrow is in Bengali');
  assert.doesNotMatch(academicsJs, /<p class="eyebrow">Subjects<\/p>/, 'English Subjects eyebrow is gone');
});

test('Payment Counter keeps horizontal toggle action cards but no hero card (removed 2026-10-28)', () => {
  const payHtml = read('payment.html');
  assert.match(payHtml, /<body class="pay-body payment-reference">/, 'payment body carries .payment-reference');
  for (const panel of ['home', 'students', 'payment', 'reports', 'more']) {
    const start = payHtml.indexOf(`data-pay-panel="${panel}"`);
    const next = payHtml.indexOf('data-pay-panel="', start + 15);
    const chunk = payHtml.slice(start, next === -1 ? undefined : next);
    // Owner request 2026-10-28: no panel outside Student Home carries a hero
    // card. The counter keeps its compact page head, date pill and advice line.
    assert.doesNotMatch(chunk, /teacher-hero-scene|data-pay-hero-art|teacher-hero-glint/,
      `payment ${panel} has no hero artwork`);
    assert.match(chunk, /panel-compact-head/, `payment ${panel} uses the compact page head`);
    assert.match(chunk, /data-pay-hero-date|teacher-hero-date-pill/, `payment ${panel} still shows the date`);
    assert.match(chunk, /data-pay-hero-advice=/, `payment ${panel} keeps its daily advice line`);
  }
  for (const toggle of ['today-list', 'student-search', 'payment-entry', 'select-student', 'reports-builder']) {
    assert.match(payHtml, new RegExp(`data-pay-toggle="${toggle}"`), `payment has action card ${toggle}`);
  }
});

test('strict cross-panel isolation: no portal leaks another portal shell, route name, or body class', () => {
  /* মালিক-নির্দেশ ২০২৬-১১-০২: চার স্টাফ প্যানেল এখন একটাই universal route
     অ্যাট্রিবিউট ব্যবহার করে (`data-panel-view`) — Student-এর নিজস্ব `data-view`
     অপরিবর্তিত। তাই আইসোলেশন এখন শেল/বডি-ক্লাস এবং **রুট-নাম** স্তরে যাচাই হয়:
     কোনো পোর্টাল অন্য পোর্টালের স্ক্রিন-নাম ধারণ করে না, আর নিজের শেল/বডি-ক্লাসও
     কখনো মেশে না। */
  const portals = {
    student: { html: read('student.html'), bodyClass: 'student-reference', shell: 'appShell', ownAttr: 'data-view=' },
    teacher: { html: read('teacher.html'), bodyClass: 'teacher-reference', shell: 'teacherShell', ownAttr: 'data-panel-view=' },
    manager: { html: read('manager.html'), bodyClass: 'manager-reference', shell: 'managerShell', ownAttr: 'data-panel-view=' },
    admin:   { html: read('admin.html'),   bodyClass: 'admin-reference',   shell: 'adminShell',   ownAttr: 'data-panel-view=' },
    payment: { html: read('payment.html'), bodyClass: 'payment-reference', shell: 'payShell', ownAttr: 'data-panel-view=' }
  };
  const ownRoutes = html => new Set([...html.matchAll(/data-panel-view="([a-z-]+)"/g)].map(match => match[1]));
  /* class-chat is shared by the three academic staff panels (Teacher/Manager/
     Admin); the Cash Counter has no chat, no academic work and no org admin. */
  const FOREIGN_ROUTES = {
    teacher: ['staff', 'roles', 'roles-admin', 'backup', 'backup-export', 'audit', 'audit-log', 'system', 'migration', 'finance', 'teachers', 'students', 'payment', 'collect', 'receipt'],
    manager: ['staff', 'roles', 'roles-admin', 'backup', 'backup-export', 'audit', 'audit-log', 'system', 'migration', 'homework', 'suggestion', 'payment', 'collect', 'receipt'],
    admin: ['homework', 'suggestion', 'payment', 'collect', 'receipt', 'classes', 'exams', 'notices', 'routine-view'],
    payment: ['homework', 'suggestion', 'class-chat', 'staff', 'roles', 'backup', 'audit', 'system', 'finance', 'teachers', 'lecture-sheets', 'courses', 'academic']
  };
  for (const [role, info] of Object.entries(portals)) {
    assert.ok(info.html.includes(info.bodyClass), `${role}.html carries ${info.bodyClass}`);
    assert.ok(info.html.includes(`id="${info.shell}"`), `${role}.html carries #${info.shell}`);
    assert.ok(info.html.includes(info.ownAttr), `${role}.html carries ${info.ownAttr}`);
    for (const [otherRole, otherInfo] of Object.entries(portals)) {
      if (otherRole === role) continue;
      assert.ok(!info.html.includes(otherInfo.bodyClass), `${role}.html never carries ${otherInfo.bodyClass}`);
      assert.ok(!info.html.includes(`id="${otherInfo.shell}"`), `${role}.html never carries #${otherInfo.shell}`);
      if (otherInfo.ownAttr !== info.ownAttr) {
        assert.ok(!info.html.includes(otherInfo.ownAttr), `${role}.html never carries ${otherInfo.ownAttr}`);
      }
    }
    /* One attribute name, but never another panel's route names: the union of
       the four staff vocabulary sets is shared, the *values* are not. */
    const routes = ownRoutes(info.html);
    for (const foreign of FOREIGN_ROUTES[role] || []) {
      assert.ok(!routes.has(foreign), `${role}.html never routes to the foreign screen "${foreign}"`);
    }
  }
  /* The teacher panel keeps its own hooks; the admin capability gate never
     leaks out of admin.html. */
  for (const portal of ['teacher.html', 'manager.html', 'payment.html']) {
    assert.ok(!read(portal).includes('data-admin-cap='), `${portal} carries no admin capability gate`);
  }
  const walletCss = read('css/ui-wallet.css');
  const teacherCss = read('css/teacher-panel.css');
  assert.ok(walletCss.includes('body.manager-reference .manager-student-scopes [data-student-scope="all"] { order: 10; }'), 'manager multi-card views open directly below clicked card');
  assert.ok(walletCss.includes('body.admin-reference .admin-view[data-view-panel="academics"] .admin-action-stack'), 'admin multi-card views open directly below clicked card');
  assert.ok(walletCss.includes('body.payment-reference #payHomeCard [data-pay-toggle="today-list"] { order: 20; }'), 'payment views open directly below clicked card');
  assert.ok(teacherCss.includes('#teacherOnlineExams[data-exam-tile-open=new-mcq] #teacherExamWorkspace') && teacherCss.includes('display:contents'), 'teacher exam doors open directly below clicked card');
});


