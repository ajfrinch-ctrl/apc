import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';
import { classByName, subjectsForClass } from '../js/academics.js';
import { saveTeacherAssignment } from '../js/teacher-assignments.js';
import { sanitizeLectureHtml, isSafeLectureImageSrc } from '../js/rich-sanitize.js';
import { contentById, listCourseContent } from '../js/course-content.js';
import {
  resolveLectureScope,
  listLectureSheets,
  saveLectureSheet,
  duplicateLectureSheet,
  setLectureSheetLifecycle,
  restoreLectureSheetVersion,
  docJsonToHtml,
  docJsonToPlainText,
  buildLecturePdfFilename,
  saveLectureRecovery,
  loadLectureRecovery,
  clearLectureRecovery
} from '../js/lecture-sheet-store.js';
import {
  A4_DIMENSIONS,
  paginateLectureDocument,
  renderLecturePreviewPagesHtml,
  assembleLecturePDF
} from '../js/lecture-sheet-pdf.js';
import { renderLatexMathML } from '../vendor/lecture-studio/sdk.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';

let ctx;
before(async () => {
  ctx = await loadPage('admin.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
});

function wipeStorage() {
  ctx.window.localStorage.clear();
  ctx.window.sessionStorage.clear();
}

test('Tiptap + KaTeX SDK renders MathML equations and sanitizeLectureHtml preserves formatting while blocking XSS/SVG', () => {
  const mathml = renderLatexMathML('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', true);
  assert.match(mathml, /<math[\s>]/, 'KaTeX renders standards-compliant MathML');

  const safeDataImg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal(isSafeLectureImageSrc(safeDataImg), true);
  assert.equal(isSafeLectureImageSrc('data:image/svg+xml;base64,PHN2Zz4='), false, 'SVG data URLs are blocked against script injection');
  assert.equal(isSafeLectureImageSrc('javascript:alert(1)'), false);

  const dirty = `
    <h1 style="text-align: center; color: #0e7a55; position: fixed">অ্যাক্টিভ প্লাস কোচিং — যুক্তাক্ষর: বিজ্ঞান, ক্ষ, জ্ঞ</h1>
    <p style="line-height: 1.8; padding-left: 48px"><span style="background-color: #fef08a; font-size: 16pt">গুরুত্বপূর্ণ সূত্র: H<sub>2</sub>O এবং E = mc<sup>2</sup></span></p>
    <div data-page-break="true"></div>
    <img src="${safeDataImg}" data-width-pct="50" data-align="center" onerror="alert(1)">
    <script>window.__xss = true;</script>
  `;
  const clean = sanitizeLectureHtml(dirty);
  assert.match(clean, /অ্যাক্টিভ প্লাস কোচিং — যুক্তাক্ষর: বিজ্ঞান, ক্ষ, জ্ঞ/);
  assert.match(clean, /text-align:\s*center/);
  assert.match(clean, /background-color:\s*#fef08a/);
  assert.match(clean, /<sub>2<\/sub>/);
  assert.match(clean, /<sup>2<\/sup>/);
  assert.match(clean, /data-page-break="true"/);
  assert.match(clean, /data-width-pct="50"/);
  assert.doesNotMatch(clean, /position:\s*fixed/i);
  assert.doesNotMatch(clean, /onerror|<script/i);
});

test('meaningful PDF filenames handle English and Unicode Bangla metadata safely', () => {
  const enName = buildLecturePdfFilename({
    subjectName: 'English',
    className: 'HSC',
    topic: 'Articles',
    updatedAt: '2026-10-25T08:00:00.000Z'
  });
  assert.equal(enName, 'English_HSC_Articles_2026-10-25.pdf');

  const bnName = buildLecturePdfFilename({
    subjectName: 'পদার্থবিজ্ঞান',
    className: 'দশম শ্রেণি',
    topic: 'গতি ও বল',
    updatedAt: '2026-10-25T08:00:00.000Z'
  });
  assert.match(bnName, /^Physics_Class10_[A-Za-z0-9_]+_2026-10-25\.pdf$/);
  assert.equal(/[^\x20-\x7E]/.test(bnName), false, 'PDF download filename must be pure ASCII for cross-browser/Chromium safety');
});

test('Admin, Manager & Teacher role-scoped Lecture Sheet CRUD, version history, conflict detection, recovery & student visibility', async () => {
  wipeStorage();
  ctx.window.localStorage.setItem('activePlus.admin.students.v1', JSON.stringify([
    { id: 'AP-101', name: 'রাইসা ইসলাম', className: 'দশম শ্রেণি', group: 'বিজ্ঞান', status: 'approved' }
  ]));
  await provisionStaff('admin');
  await provisionStaff('manager');
  await provisionStaff('teacher');

  const c10 = classByName('দশম শ্রেণি');
  const c8 = classByName('অষ্টম শ্রেণি');
  const math10 = subjectsForClass('দশম শ্রেণি')[0];
  const sub8 = subjectsForClass('অষ্টম শ্রেণি')[0];

  // Assign teacher ONLY to দশম শ্রেণি -> math10 (বিজ্ঞান group) via Manager session
  seedStaffSession(window, 'manager');
  await saveTeacherAssignment({
    teacherUsername: STAFF_ACCOUNTS.teacher.username,
    className: 'দশম শ্রেণি',
    group: 'বিজ্ঞান',
    subjects: [math10.name]
  });

  // 1. Teacher scope is strictly restricted to assigned class & subject
  seedStaffSession(window, 'teacher');
  const teacherScope = await resolveLectureScope('teacher');
  assert.deepEqual(teacherScope.classes.map(c => c.name), ['দশম শ্রেণি']);
  assert.deepEqual(teacherScope.subjectsByClass[c10.id].map(s => s.name), [math10.name]);

  // Unauthorized class/subject write by Teacher is rejected
  await assert.rejects(
    () => saveLectureSheet({
      classId: c8.id,
      subjectId: sub8.id,
      title: 'অননুমোদিত শিট',
      docJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'নিষিদ্ধ' }] }] }
    }, { role: 'teacher', actor: 'শিক্ষক তানভীর' }),
    /অ্যাসাইনমেন্টে নেই|বরাদ্দ নয়/
  );

  // 2. Teacher creates valid Lecture Sheet with auto-created chapter, Bangla যুক্তাক্ষর, table, math & pageSettings
  const richDoc = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1, textAlign: 'center' },
        content: [{ type: 'text', text: 'ত্রিকোণমিতিক অনুপাত ও অভেদাবলি' }]
      },
      {
        type: 'paragraph',
        attrs: { lineHeight: '1.8', indent: 1 },
        content: [
          { type: 'text', marks: [{ type: 'bold' }], text: 'সংজ্ঞা: ' },
          { type: 'text', text: 'সমকোণী ত্রিভুজের বাহুগুলোর অনুপাতকে ত্রিকোণমিতিক অনুপাত বলে।' }
        ]
      },
      {
        type: 'mathEquation',
        attrs: { latex: '\\sin^2\\theta + \\cos^2\\theta = 1', display: true }
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'কোণ' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'sin θ' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '৩০°' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '১/২' }] }] }
            ]
          }
        ]
      }
    ]
  };

  const created = await saveLectureSheet({
    classId: c10.id,
    subjectId: math10.id,
    group: 'বিজ্ঞান',
    chapterName: 'নবম অধ্যায়: ত্রিকোণমিতি',
    topic: 'মৌলিক অভেদাবলি',
    title: 'লেকচার শিট ০১ — ত্রিকোণমিতি',
    subtitle: 'এসএসসি বোর্ড প্রস্তুতি',
    pageSettings: {
      orientation: 'landscape',
      margins: 'wide',
      headerText: 'গণিত বিভাগ',
      footerText: 'সর্বস্বত্ব সংরক্ষিত',
      showLogo: true,
      showHeader: true,
      showFooter: true,
      showPageNumbers: true
    },
    docJson: richDoc,
    status: 'draft'
  }, { role: 'teacher', actor: 'শিক্ষক তানভীর', renderMath: renderLatexMathML });

  assert.equal(created.isLectureSheet, true);
  assert.equal(created.docVersion, 1);
  assert.equal(created.published, false);
  assert.ok(created.chapterId, 'chapter record was automatically created and linked');
  assert.equal(created.pageSettings.orientation, 'landscape');
  assert.equal(created.pageSettings.margins, 'wide');
  assert.match(created.richContent, /<math[\s>]/, 'stored richContent includes rendered MathML');

  // Verify NO Base64 PDF blob is ever persisted in localStorage / cloud sync store
  const rawStored = window.localStorage.getItem(KEYS.courseContent) || '';
  assert.doesNotMatch(rawStored, /%PDF-1\.|application\/pdf/, 'no heavy PDF binary or base64 PDF is stored in DB');

  // Draft is NOT visible to students yet
  const studentBeforePublish = listCourseContent({
    classId: c10.id,
    subjectId: math10.id,
    group: 'বিজ্ঞান',
    groupScoped: true,
    publishedOnly: true
  });
  assert.equal(studentBeforePublish.some(r => r.id === created.id), false, 'draft lecture sheet stays hidden from students');

  // 3. Edit & save v2 (records v1 in bounded version history) + optimistic concurrency check
  const updatedDoc = {
    ...richDoc,
    content: [
      ...richDoc.content,
      { type: 'paragraph', content: [{ type: 'text', text: 'নতুন উদাহরণ সংযোজন করা হলো।' }] }
    ]
  };
  const v2 = await saveLectureSheet({
    ...created,
    title: 'লেকচার শিট ০১ — ত্রিকোণমিতি (সংস্করণ ২)',
    docJson: updatedDoc
  }, {
    role: 'teacher',
    actor: 'শিক্ষক তানভীর',
    expectedVersion: 1,
    recordHistory: true,
    renderMath: renderLatexMathML
  });
  assert.equal(v2.docVersion, 2);
  assert.equal(v2.history.length, 1);
  assert.equal(v2.history[0].version, 1);

  // Stale expectedVersion triggers VERSION_CONFLICT instead of silent overwrite
  await assert.rejects(
    () => saveLectureSheet({
      ...v2,
      title: 'পুরাতন ট্যাবের লেখা'
    }, { role: 'teacher', actor: 'শিক্ষক তানভীর', expectedVersion: 1 }),
    err => err?.code === 'VERSION_CONFLICT'
  );

  // 4. Publish -> visible ONLY to matching class + group students; hidden from other class/group
  await setLectureSheetLifecycle(v2.id, 'publish', { role: 'teacher', actor: 'শিক্ষক তানভীর' });

  const sciStudentList = listCourseContent({
    classId: c10.id,
    subjectId: math10.id,
    group: 'বিজ্ঞান',
    groupScoped: true,
    publishedOnly: true
  });
  assert.equal(sciStudentList.some(r => r.id === v2.id), true, 'matching class + group student sees published sheet');

  const humStudentList = listCourseContent({
    classId: c10.id,
    subjectId: math10.id,
    group: 'মানবিক',
    groupScoped: true,
    publishedOnly: true
  });
  assert.equal(humStudentList.some(r => r.id === v2.id), false, 'other batch/group student does not see विज्ञान-scoped sheet');

  const class8StudentList = listCourseContent({
    classId: c8.id,
    subjectId: sub8.id,
    groupScoped: true,
    publishedOnly: true
  });
  assert.equal(class8StudentList.some(r => r.id === v2.id), false, 'other class student never sees দশম শ্রেণি sheet');

  // 5. Duplicate, Unpublish, Archive, Unarchive & Version Restore across Manager & Admin
  seedStaffSession(window, 'manager');
  const duplicated = await duplicateLectureSheet(v2.id, { role: 'manager', actor: 'ম্যানেজার রফিক' });
  assert.notEqual(duplicated.id, v2.id);
  assert.equal(duplicated.published, false, 'duplicate starts safely as draft');
  assert.match(duplicated.title, /\(কপি\)/);

  seedStaffSession(window, 'admin');
  const adminSheets = await listLectureSheets({ status: 'all' }, { role: 'admin' });
  assert.equal(adminSheets.length, 2, 'Admin sees all lecture sheets across Academic Setup');

  await setLectureSheetLifecycle(v2.id, 'archive', { role: 'admin', actor: 'প্রধান অ্যাডমিন' });
  assert.equal(contentById(v2.id).active, false);
  assert.equal(
    listCourseContent({ classId: c10.id, subjectId: math10.id, group: 'বিজ্ঞান', groupScoped: true, publishedOnly: true }).some(r => r.id === v2.id),
    false,
    'archived sheet disappears immediately from student view'
  );

  await setLectureSheetLifecycle(v2.id, 'unarchive', { role: 'admin', actor: 'প্রধান অ্যাডমিন' });
  assert.equal(contentById(v2.id).active, true);

  const restored = await restoreLectureSheetVersion(v2.id, 1, {
    role: 'admin',
    actor: 'প্রধান অ্যাডমিন',
    renderMath: renderLatexMathML
  });
  assert.equal(restored.title, 'লেকচার শিট ০১ — ত্রিকোণমিতি');
  assert.ok(!docJsonToPlainText(restored.docJson).includes('নতুন উদাহরণ সংযোজন করা হলো'));

  // 6. Local offline crash recovery round-trip
  saveLectureRecovery({ role: 'teacher', staffId: 'phyteacher' }, v2.id, {
    title: 'অফলাইন ক্র্যাশ রিকভারি শিরোনাম',
    docJson: richDoc
  });
  const recovered = loadLectureRecovery({ role: 'teacher', staffId: 'phyteacher' }, v2.id);
  assert.equal(recovered?.draft?.title, 'অফলাইন ক্র্যাশ রিকভারি শিরোনাম');
  clearLectureRecovery({ role: 'teacher', staffId: 'phyteacher' }, v2.id);
  assert.equal(loadLectureRecovery({ role: 'teacher', staffId: 'phyteacher' }, v2.id), null);
});

test('A4 paginator handles multi-page overflow, explicit page breaks, repeated table headers, Portrait/Landscape & valid %PDF-1.4 export', async () => {
  // Build a large multi-page document with 35 paragraphs + manual pageBreak + 28-row table + math equation
  const manyParagraphs = Array.from({ length: 35 }, (_, idx) => ({
    type: 'paragraph',
    content: [{
      type: 'text',
      text: `অনুচ্ছেদ ${idx + 1}: নিউটনের গতিসূত্র ও মহাকর্ষ বলের গাণিতিক বিশ্লেষণ এবং সৃজনশীল প্রশ্নের পূর্ণাঙ্গ সমাধান কৌশল বিস্তারিতভাবে আলোচনা করা হলো।`
    }]
  }));

  const bigTableRows = [
    {
      type: 'tableRow',
      content: [
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ক্রমিক' }] }] },
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ভৌত রাশি ও একক' }] }] },
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'মাত্রা সমীকরণ' }] }] }
      ]
    },
    ...Array.from({ length: 28 }, (_, idx) => ({
      type: 'tableRow',
      content: [
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${idx + 1}` }] }] },
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: `বল, কাজ ও ক্ষমতা বিশ্লেষণ সারি ${idx + 1}` }] }] },
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: `[ML^2T^{-2}]` }] }] }
      ]
    }))
  ];

  const docJson = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'পদার্থবিজ্ঞান পূর্ণাঙ্গ লেকচার শিট' }] },
      ...manyParagraphs,
      { type: 'pageBreak' },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'ভৌত রাশির তালিকা (বড় টেবিল)' }] },
      { type: 'table', content: bigTableRows },
      { type: 'mathEquation', attrs: { latex: 'F = G\\frac{m_1 m_2}{r^2}', display: true } }
    ]
  };

  const portraitLayout = await paginateLectureDocument({
    title: 'পদার্থবিজ্ঞান — বল ও গতি',
    className: 'একাদশ-দ্বাদশ',
    subjectName: 'পদার্থবিজ্ঞান ১ম পত্র',
    chapterName: 'নিউটনিয়ান বলবিদ্যা',
    topic: 'বল ও ভরবেগ',
    teacherName: 'প্রফেসর কামরুল',
    pageSettings: { orientation: 'portrait', margins: 'normal', showHeader: true, showFooter: true, showPageNumbers: true },
    docJson
  }, { preloadImages: false });

  assert.equal(portraitLayout.dimensions.width, A4_DIMENSIONS.portrait.width);
  assert.equal(portraitLayout.dimensions.height, A4_DIMENSIONS.portrait.height);
  assert.ok(portraitLayout.totalPages >= 3, `expected >= 3 pages, got ${portraitLayout.totalPages}`);

  // Verify table split across pages repeats header row on continuation slice
  const tableBlocks = portraitLayout.pages.flatMap(p => p.items.filter(b => b.kind === 'table'));
  assert.ok(tableBlocks.length >= 2, '28-row table splits cleanly across page boundary');
  for (const tb of tableBlocks) {
    assert.equal(tb.rows[0].isHeaderRow, true, 'every split table slice repeats the header row cleanly');
  }

  // Verify preview HTML includes exact page numbering & running headers and omits teacher name
  const previewHtml = renderLecturePreviewPagesHtml(portraitLayout, { renderMath: renderLatexMathML });
  assert.match(previewHtml, new RegExp(`পৃষ্ঠা ১ / [০-৯]+`));
  assert.match(previewHtml, /নিউটনিয়ান বলবিদ্যা/);
  assert.match(previewHtml, /<math[\s>]/);
  assert.doesNotMatch(previewHtml, /প্রফেসর কামরুল|শিক্ষক:/);

  // Verify Landscape geometry & valid %PDF-1.4 binary output
  const landscapeLayout = await paginateLectureDocument({
    title: 'Landscape Sheet',
    pageSettings: { orientation: 'landscape', margins: 'narrow' },
    docJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Landscape test' }] }] }
  }, { preloadImages: false });
  assert.equal(landscapeLayout.dimensions.width, A4_DIMENSIONS.landscape.width);
  assert.equal(landscapeLayout.dimensions.height, A4_DIMENSIONS.landscape.height);

  // Assemble a 2-page PDF binary with Portrait and Landscape dimensions
  const tinyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const portraitPdfBlob = assembleLecturePDF([
    { jpeg: tinyJpeg, width: 1270, height: 1797 },
    { jpeg: tinyJpeg, width: 1270, height: 1797 }
  ], { orientation: 'portrait' });
  const pdfText = new TextDecoder('latin1').decode(new Uint8Array(await portraitPdfBlob.arrayBuffer()));
  assert.match(pdfText, /^%PDF-1\.4/);
  assert.match(pdfText, /\/Count 2\b/);
  assert.match(pdfText, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(pdfText, /%%EOF\s*$/);

  const landscapePdfBlob = assembleLecturePDF([
    { jpeg: tinyJpeg, width: 1797, height: 1270 }
  ], { orientation: 'landscape' });
  const landPdfText = new TextDecoder('latin1').decode(new Uint8Array(await landscapePdfBlob.arrayBuffer()));
  assert.match(landPdfText, /\/MediaBox \[0 0 841\.89 595\.28\]/);

  // Verify HTML generated from docJson preserves tables, math & headings
  const htmlOut = docJsonToHtml(docJson, { renderMath: renderLatexMathML });
  assert.match(htmlOut, /<table[\s>][\s\S]*<th>[\s\S]*ক্রমিক/);
  assert.match(htmlOut, /data-page-break="true"/);
});

test('Firebase Realtime Database rules protect courseContent against unauthorized roles while allowing E2EE & staff records', () => {
  const rules = JSON.parse(readFileSync('database.rules.json', 'utf8'));
  const courseRule = rules.rules.activePlusSync.v1.courseContent;
  assert.ok(courseRule, 'courseContent rule node exists in database.rules.json');
  assert.match(courseRule['.write'], /auth\.token\.role === 'admin' \|\| auth\.token\.role === 'manager' \|\| auth\.token\.role === 'teacher'/,
    'only admin, manager, and teacher roles (plus un-claimed bridge) are allow-listed to write courseContent');
  assert.doesNotMatch(courseRule['.write'], /'student'|'payment'/,
    'student and payment roles are never granted courseContent write access');
  assert.match(courseRule.$recordId['.validate'], /_apcEnc/,
    'AES-256-GCM encrypted E2EE envelopes are validated cleanly');
  assert.match(courseRule.$recordId['.validate'], /_syncKind/,
    'plain sync record wrappers validate record.id === $recordId');
});

test('Full-Screen Studio & Staff Manager Hub mount in JSDOM, execute rich formatting commands, switch to Live PDF Preview, save & exit cleanly', async () => {
  wipeStorage();
  await provisionStaff('admin');
  seedStaffSession(window, 'admin');

  const { mountLectureSheetManager, openLectureSheetStudio } = await import('../js/lecture-sheet-studio.js');

  const mountEl = document.createElement('div');
  document.body.appendChild(mountEl);

  const mgr = await mountLectureSheetManager({ mount: mountEl, role: 'admin' });
  assert.ok(mountEl.querySelector('[data-ls-mgr-action="open-create"]'), 'Create Lecture Sheet button renders');

  const c10 = classByName('দশম শ্রেণি');
  const sub10 = subjectsForClass('দশম শ্রেণি')[0];

  const studio = await openLectureSheetStudio({
    role: 'admin',
    initialMeta: {
      classId: c10.id,
      subjectId: sub10.id,
      chapterName: 'প্রথম অধ্যায়',
      topic: 'বাস্তব সংখ্যা',
      title: 'ফুল-স্ক্রিন স্টুডিও টেস্ট শিট'
    }
  });

  assert.ok(studio, 'Studio instance opened');
  assert.equal(document.documentElement.classList.contains('apc-lecture-studio-open'), true, 'html.apc-lecture-studio-open hides portal chrome');
  assert.ok(document.getElementById('apcLectureStudioOverlay'), 'overlay mounted directly on document.body');

  // Execute real Tiptap Word-style commands (Heading, Bold, Italic, Underline, Superscript, Table, Math, PageBreak)
  studio.editor.chain().focus()
    .setContent('<p>বাংলা যুক্তাক্ষর: বিজ্ঞান, ক্ষ, জ্ঞ, ত্রিকোণমিতি — ১২৩৪৫</p>')
    .selectAll()
    .toggleBold()
    .toggleUnderline()
    .setTextAlign('center')
    .run();

  const docEnd = studio.editor.state.doc.content.size;
  studio.editor.chain().focus(docEnd)
    .insertContent({ type: 'paragraph', content: [{ type: 'text', text: 'নিচের সমীকরণ ও টেবিল লক্ষ্য করো:' }] })
    .insertMathEquation({ latex: 'E = mc^2', display: true })
    .insertPageBreak()
    .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    .run();

  // Save draft & verify structured JSON + HTML persistence
  const saved = await studio.saveDraft();
  assert.ok(saved?.id, 'saved draft returned permanent record id');
  assert.equal(saved.isLectureSheet, true);
  assert.match(saved.richContent, /বাংলা যুক্তাক্ষর: বিজ্ঞান/);
  assert.match(saved.richContent, /<math[\s>]/);
  assert.match(saved.richContent, /<table[\s>]/);

  // Switch to Read-Only Live PDF Preview mode
  studio.switchMode('preview');
  await new Promise(r => setTimeout(r, 80));
  const previewStage = studio.overlay.querySelector('[data-ls-preview-stage]');
  assert.equal(previewStage.hidden, false, 'Live PDF Preview stage is visible');
  assert.ok(studio.overlay.querySelectorAll('.ls-preview-page').length >= 2, 'PageBreak produced multi-page A4 preview');

  // Exit Studio cleanly
  await studio.close();
  assert.equal(document.documentElement.classList.contains('apc-lecture-studio-open'), false, 'html class removed on exit');
  assert.equal(document.getElementById('apcLectureStudioOverlay'), null, 'overlay cleaned up from DOM');

  await mgr.refresh();
  assert.equal(mountEl.querySelectorAll('[data-ls-card]').length, 1, 'Manager list shows the newly created lecture sheet');
  mountEl.remove();
});

test('the subject is typed by hand — no dropdown — and a known name still maps to its catalogue subject', async () => {
  /* Owner request (2026-11-01): the subject dropdown is removed from the
     Lecture Sheet manager and the editor's info panel; the author types the
     subject name. A typed name that matches the catalogue keeps the real
     subject id (so sheets keep grouping correctly), anything else becomes a
     custom subject. */
  wipeStorage();
  await provisionStaff('admin');
  seedStaffSession(window, 'admin');

  const { mountLectureSheetManager, resolveTypedSubject } = await import('../js/lecture-sheet-studio.js');
  const subs = subjectsForClass('দশম শ্রেণি');
  const known = subs[0];

  const byName = resolveTypedSubject(` ${known.name} `, subs);
  assert.equal(byName.id, known.id, 'a typed catalogue name reuses the real subject id');
  assert.equal(byName.customName, '', 'a known subject is not duplicated as custom');

  const fresh = resolveTypedSubject('কৃষি শিক্ষা', subs);
  assert.match(fresh.id, /^custom-/, 'an unknown typed name becomes a custom subject');
  assert.equal(fresh.name, 'কৃষি শিক্ষা');
  assert.equal(fresh.customName, 'কৃষি শিক্ষা');

  assert.deepEqual(resolveTypedSubject('   ', subs), { id: '', name: '', customName: '' }, 'blank input resolves to nothing');

  const mountEl = document.createElement('div');
  document.body.appendChild(mountEl);
  const mgr = await mountLectureSheetManager({ mount: mountEl, role: 'admin' });
  await new Promise(r => setTimeout(r, 60));

  assert.ok(mountEl.querySelector('[data-ls-filter="subjectText"]'), 'the list filter types the subject too');
  assert.equal(mountEl.querySelector('[data-ls-filter="subjectId"]'), null, 'the list filter has no subject dropdown');

  mountEl.querySelector('[data-ls-mgr-action="open-create"]').click();
  await new Promise(r => setTimeout(r, 30));
  const form = mountEl.querySelector('[data-ls-quick-create-form]');
  assert.ok(form.querySelector('[data-ls-qc-subject-name]'), 'the quick-create form types the subject');
  assert.equal(form.querySelector('select[name="lsSubjectId"]'), null, 'no subject dropdown in quick create');
  assert.equal(form.querySelector('[name="lsCustomSubject"]'), null, 'the separate custom-subject field is merged away');
  assert.ok(form.querySelector('#lsQcSubjects option'), 'existing subjects are offered as type-ahead suggestions');
  assert.ok(form.querySelector('[data-ls-qc-subject-name]').value.length > 0, 'the field starts from the current subject');

  await mgr.refresh();
  mountEl.remove();
});
