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
  assert.ok(audit.includes('id="gradeAuditList"') && audit.includes('id="adminExamWorkspace"'),
    'both audit surfaces stay mounted, now inside cards');
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
  // Privacy: list avatar is masked until explicit view
  assert.match(js, /student-avatar.*is-masked|PRIVACY_MASK/, 'the list avatar is masked for privacy');
});

test('Admin Home keeps its text-only welcome while the other 16 views retain their 3D hero cards', () => {
  assert.match(html, /<body class="admin-reference">/, 'admin body carries .admin-reference');
  const allPanels = ['dashboard', 'staff', 'system', 'migration', 'roles', 'students', 'reports', 'data', 'backup', 'audit', 'security', 'academics', 'settings', 'more', 'profile', 'content', 'advice'];
  for (const panel of allPanels) {
    const chunk = viewOf(panel);
    if (panel === 'dashboard') {
      assert.doesNotMatch(chunk, /teacher-hero-scene|data-admin-hero-art|data-hero-card=/,
        'Home never loads the large 3D illustration');
    } else {
      assert.match(chunk, /teacher-hero-scene/, `${panel} still has a 3D hero scene`);
      assert.match(chunk, /data-admin-hero-art/, `${panel} still has a 3D hero art image`);
      assert.match(chunk, /data-hero-card=/, `${panel} still has a hero card key`);
    }
    assert.match(chunk, /teacher-hero-date-pill/, `${panel} has top-right weekday·date pill`);
    assert.match(chunk, /teacher-hero-glint/, `${panel} has top-right sun/moon glint`);
    assert.match(chunk, /data-admin-hero-advice=/, `${panel} has daily rotating advice`);
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

test('Payment Counter panel has 3D hero cards and horizontal toggle action cards across all 5 views', () => {
  const payHtml = read('payment.html');
  assert.match(payHtml, /<body class="pay-body payment-reference">/, 'payment body carries .payment-reference');
  for (const panel of ['home', 'students', 'payment', 'reports', 'more']) {
    const start = payHtml.indexOf(`data-pay-panel="${panel}"`);
    const next = payHtml.indexOf('data-pay-panel="', start + 15);
    const chunk = payHtml.slice(start, next === -1 ? undefined : next);
    assert.match(chunk, /teacher-hero-scene/, `payment ${panel} has a 3D hero scene`);
    assert.match(chunk, /data-pay-hero-art/, `payment ${panel} has a 3D hero art image`);
    assert.match(chunk, /teacher-hero-date-pill/, `payment ${panel} has top-right weekday·date pill`);
    assert.match(chunk, /teacher-hero-glint/, `payment ${panel} has top-right sun/moon glint`);
    assert.match(chunk, /data-pay-hero-advice=/, `payment ${panel} has daily rotating advice`);
  }
  for (const toggle of ['today-list', 'student-search', 'payment-entry', 'select-student', 'reports-builder']) {
    assert.match(payHtml, new RegExp(`data-pay-toggle="${toggle}"`), `payment has action card ${toggle}`);
  }
});

test('strict cross-panel isolation: no portal leaks another portal shell, route attribute, or body class', () => {
  const portals = {
    student: { html: read('student.html'), bodyClass: 'student-reference', shell: 'appShell', ownAttr: 'data-view=' },
    teacher: { html: read('teacher.html'), bodyClass: 'teacher-reference', shell: 'teacherShell', ownAttr: 'data-teacher-view=' },
    manager: { html: read('manager.html'), bodyClass: 'manager-reference', shell: 'managerShell', ownAttr: 'data-manager-view=' },
    admin:   { html: read('admin.html'),   bodyClass: 'admin-reference',   shell: 'adminShell',   ownAttr: 'data-admin-view=' },
    payment: { html: read('payment.html'), bodyClass: 'payment-reference', shell: 'payShell', ownAttr: 'data-pay-section=' }
  };
  for (const [role, info] of Object.entries(portals)) {
    assert.ok(info.html.includes(info.bodyClass), `${role}.html carries ${info.bodyClass}`);
    assert.ok(info.html.includes(`id="${info.shell}"`), `${role}.html carries #${info.shell}`);
    assert.ok(info.html.includes(info.ownAttr), `${role}.html carries ${info.ownAttr}`);
    for (const [otherRole, otherInfo] of Object.entries(portals)) {
      if (otherRole === role) continue;
      assert.ok(!info.html.includes(otherInfo.bodyClass), `${role}.html never carries ${otherInfo.bodyClass}`);
      assert.ok(!info.html.includes(`id="${otherInfo.shell}"`), `${role}.html never carries #${otherInfo.shell}`);
      assert.ok(!info.html.includes(otherInfo.ownAttr), `${role}.html never carries ${otherInfo.ownAttr}`);
    }
  }
  const walletCss = read('css/ui-wallet.css');
  const teacherCss = read('css/teacher-panel.css');
  assert.ok(walletCss.includes('body.manager-reference .manager-student-scopes [data-student-scope="all"] { order: 10; }'), 'manager multi-card views open directly below clicked card');
  assert.ok(walletCss.includes('body.admin-reference .admin-view[data-view-panel="academics"] .admin-action-stack'), 'admin multi-card views open directly below clicked card');
  assert.ok(walletCss.includes('body.payment-reference #payHomeCard [data-pay-toggle="today-list"] { order: 20; }'), 'payment views open directly below clicked card');
  assert.ok(teacherCss.includes('#teacherOnlineExams[data-exam-tile-open=new-mcq] #teacherExamWorkspace') && teacherCss.includes('display:contents'), 'teacher exam doors open directly below clicked card');
});


