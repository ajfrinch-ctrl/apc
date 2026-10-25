const fs = require('node:fs');
const { test, expect } = require('./fixtures.cjs');
const { enterPortal, enterStudentApp } = require('./portal-session.cjs');

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

const ROSTER_SEED = [
  {
    id: 'AP-1024',
    name: 'রাইসা ইসলাম',
    fatherName: 'শফিকুল ইসলাম',
    className: 'দশম শ্রেণি',
    group: 'বিজ্ঞান',
    mobile: '01700000000',
    guardianMobile: '01812345679',
    status: 'approved',
    monthlyFee: 2200
  }
];

test('Desktop Full-Screen Word-Style Lecture Sheet Studio: Bangla যুক্তাক্ষর, equations, tables, page breaks, Live PDF Preview, real %PDF-1.4 download & publish', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => {
    const msg = String(err?.message || err || '');
    if (/auth\/network-request-failed|Supabase endpoint temporarily unreachable|Failed to fetch/i.test(msg)) return;
    errors.push(msg);
  });
  await page.route(/supabase\.co|firebaseio\.com|googleapis\.com/, route => route.abort());
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.addInitScript(roster => {
    localStorage.setItem('activePlus.admin.students.v1', JSON.stringify(roster));
  }, ROSTER_SEED);

  await enterPortal(page, 'admin');
  await expect(page.locator('#adminShell')).toBeVisible();

  // Navigate to নোটিশ ও কনটেন্ট (#content) -> Lecture Sheet Studio Hub
  await page.evaluate(() => { window.location.hash = '#content'; });
  await expect(page.locator('.admin-view[data-view-panel="content"]')).toBeVisible();
  await expect(page.locator('#adminLectureSheetsMount [data-ls-mgr-action="open-create"]')).toBeVisible();

  // Open Quick Create & launch Full-Screen Studio
  await page.locator('#adminLectureSheetsMount [data-ls-mgr-action="open-create"]').click();
  await page.fill('#adminLectureSheetsMount input[name="lsChapterName"]', 'প্রথম অধ্যায়: বাস্তব সংখ্যা');
  await page.fill('#adminLectureSheetsMount input[name="lsTopic"]', 'মূলদ ও অমূলদ সংখ্যা');
  await page.fill('#adminLectureSheetsMount input[name="lsTitle"]', 'গণিত লেকচার শিট ০১ — বাস্তব সংখ্যা');
  await page.locator('#adminLectureSheetsMount [data-ls-quick-create-form] button[type="submit"]').click();

  // Verify Full-Screen Studio hides #adminShell completely and owns 100% viewport
  const overlay = page.locator('#apcLectureStudioOverlay');
  await expect(overlay).toBeVisible();
  await expect(page.locator('#adminShell')).toBeHidden();

  const desktopGeom = await page.evaluate(() => ({
    hasRootClass: document.documentElement.classList.contains('apc-lecture-studio-open'),
    overflowX: document.documentElement.scrollWidth - window.innerWidth
  }));
  expect(desktopGeom.hasRootClass).toBe(true);
  expect(desktopGeom.overflowX).toBeLessThanOrEqual(0);

  // Type Bangla যুক্তাক্ষর + English in ProseMirror A4 canvas & apply toolbar formatting
  const editorBox = overlay.locator('.ProseMirror');
  await editorBox.click();
  await page.keyboard.type('অ্যাক্টিভ প্লাস কোচিং — বিজ্ঞান, যুক্তাক্ষর (ক্ষ, জ্ঞ, ত্রিকোণমিতি) এবং HSC Math Formula ১২৩৪৫।');
  await overlay.locator('[data-ls-cmd="bold"]').click();
  await overlay.locator('[data-ls-align="center"]').click();

  // Insert Equation via ∑ সমীকরণ modal
  await overlay.locator('[data-ls-action="insert-equation"]').click();
  await expect(overlay.locator('[data-ls-eq-form]')).toBeVisible();
  await overlay.locator('[data-ls-eq-preset="0"]').click(); // দ্বিঘাত সূত্র
  await expect(overlay.locator('[data-ls-eq-preview] math')).toBeVisible();
  await overlay.locator('[data-ls-eq-form] button[type="submit"]').click();

  // Insert compressed raster Image (client-side, zero cloud storage cost)
  await overlay.locator('[data-ls-image-file]').setInputFiles('assets/icons/logo-128.png');
  await expect(overlay.locator('.ProseMirror img')).toBeVisible();

  // Insert Table & Manual Page Break
  await overlay.locator('[data-ls-action="insert-table"]').click();
  await overlay.locator('[data-ls-cmd="pageBreak"]').click();

  // Switch to Read-Only Live PDF Preview Mode & verify multi-page A4 output
  await overlay.locator('[data-ls-mode="preview"]').click();
  await expect(overlay.locator('[data-ls-preview-stage]')).toBeVisible();
  const previewPageCount = await overlay.locator('.ls-preview-page').count();
  expect(previewPageCount).toBeGreaterThanOrEqual(2);
  await expect(overlay.locator('[data-ls-preview-page-indicator]')).toContainText('পৃষ্ঠা ১ /');

  // Trigger real Download PDF & inspect the generated %PDF-1.4 file
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    overlay.locator('.ls-topbar-actions [data-ls-action="download-pdf"]').click()
  ]);
  const suggestedName = download.suggestedFilename();
  expect(suggestedName).toMatch(/^[A-Za-z0-9_.-]+\.pdf$/);
  expect(suggestedName).toContain('muld_o_omuld_sngkhja');

  const downloadPath = await download.path();
  const pdfBytes = fs.readFileSync(downloadPath);
  const pdfHeader = pdfBytes.subarray(0, 12).toString('latin1');
  const pdfTail = pdfBytes.subarray(Math.max(0, pdfBytes.length - 64)).toString('latin1');
  expect(pdfHeader.startsWith('%PDF-1.4')).toBe(true);
  expect(pdfTail).toContain('%%EOF');

  // Publish to Student Panel & Exit Studio cleanly
  await overlay.locator('.ls-topbar-actions [data-ls-action="toggle-publish"]').click();
  await expect(overlay.locator('.ls-topbar-actions [data-ls-action="toggle-publish"]')).toContainText('প্রকাশিত');

  await overlay.locator('[data-ls-action="exit"]').click();
  await expect(overlay).toBeHidden();
  await expect(page.locator('#adminShell')).toBeVisible();
  await expect(page.locator('#adminLectureSheetsMount [data-ls-card]')).toHaveCount(1);
  await expect(page.locator('#adminLectureSheetsMount .ls-status-pill.is-published')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Mobile (375x812) Manager Studio zero-overflow + Student Panel online Lecture Sheet reader & on-demand PDF download', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => {
    const msg = String(err?.message || err || '');
    if (/auth\/network-request-failed|Supabase endpoint temporarily unreachable|Failed to fetch/i.test(msg)) return;
    errors.push(msg);
  });
  await page.route(/supabase\.co|firebaseio\.com|googleapis\.com/, route => route.abort());
  await page.setViewportSize({ width: 375, height: 812 });

  await page.addInitScript(roster => {
    localStorage.setItem('activePlus.admin.students.v1', JSON.stringify(roster));
  }, ROSTER_SEED);

  // 1. Manager creates & publishes a Lecture Sheet on 375px Mobile Viewport
  await enterPortal(page, 'manager');
  await expect(page.locator('#managerShell')).toBeVisible();
  const mgrAlert = page.locator('#apcAlertBackdrop');
  if (await mgrAlert.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }

  await page.evaluate(() => { window.location.hash = '#courses'; });
  await expect(page.locator('[data-view-panel="courses"]')).toBeVisible();
  await page.locator('[data-view-panel="courses"] [data-courses-action="editor"]').click();
  await expect(page.locator('#managerCourseEditor [data-ls-mgr-action="open-create"]')).toBeVisible();

  await page.locator('#managerCourseEditor [data-ls-mgr-action="open-create"]').click();
  await page.selectOption('#managerCourseEditor select[name="lsClassId"]', { label: 'দশম শ্রেণি' });
  await page.fill('#managerCourseEditor input[name="lsChapterName"]', 'অধ্যায় ২: সেট ও ফাংশন');
  await page.fill('#managerCourseEditor input[name="lsTopic"]', 'সেটের প্রকারভেদ');
  await page.fill('#managerCourseEditor input[name="lsTitle"]', 'মোবাইল লেকচার শিট — সেট ও ফাংশন');
  await page.locator('#managerCourseEditor [data-ls-quick-create-form] button[type="submit"]').click();

  const overlay = page.locator('#apcLectureStudioOverlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.ls-mobile-dock')).toBeVisible();

  // Verify 0px horizontal overflow & >=44px mobile dock buttons on 375px phone screen
  const mobileAudit = await page.evaluate(() => {
    const docOverflow = document.documentElement.scrollWidth - window.innerWidth;
    const dockBtns = [...document.querySelectorAll('.ls-mobile-dock .ls-dock-btn')].map(el => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return { docOverflow, undersized: dockBtns.filter(b => b.h < 44 || b.w < 44) };
  });
  expect(mobileAudit.docOverflow).toBeLessThanOrEqual(0);
  expect(mobileAudit.undersized).toEqual([]);

  await overlay.locator('.ProseMirror').click();
  await page.keyboard.type('সংযোগ সেট ও ছেদ সেটের বিস্তারিত উদাহরণ এবং বোর্ড প্রশ্ন সমাধান।');

  // Publish using Mobile Bottom Dock & Exit
  await overlay.locator('[data-ls-dock-publish]').click();
  await expect(overlay.locator('[data-ls-dock-publish]')).toContainText('প্রকাশিত');
  await overlay.locator('[data-ls-action="exit"]').click();
  await expect(overlay).toBeHidden();

  // Capture courseContent from Manager storage so we can open Student session in clean student mode
  const savedCourseContent = await page.evaluate(() => localStorage.getItem('activePlus.courseContent.v1'));
  expect(savedCourseContent).toBeTruthy();

  // 2. Student logs in on 375px Mobile & reads the published Lecture Sheet + downloads A4 PDF!
  await page.evaluate(cc => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('activePlus.courseContent.v1', cc);
  }, savedCourseContent);

  await enterStudentApp(page, {
    id: 'AP-1024',
    name: 'রাইসা ইসলাম',
    className: 'দশম শ্রেণি',
    group: 'বিজ্ঞান'
  });

  await page.locator('.bottom-nav [data-view="courses"]').click();
  await page.locator('#studySections [data-study-section="courses"]').click();
  await expect(page.locator('#courseHub')).toBeVisible();

  // Open the auto-created chapter "অধ্যায় ২: সেট ও ফাংশন" -> "📖 অধ্যায় পড়ুন"
  await page.locator('#courseHub [data-course-chapter-toggle]').first().click();
  await page.locator('#courseHub [data-course-chapter-action="read"]').first().click();

  await expect(page.locator('#courseHub .ls-student-sheet-card')).toContainText('মোবাইল লেকচার শিট — সেট ও ফাংশন');
  await expect(page.locator('#courseHub .ls-student-sheet-body')).toContainText('সংযোগ সেট ও ছেদ সেটের বিস্তারিত উদাহরণ');

  // Open Full-Screen A4 Student Reader & close
  await page.locator('#courseHub [data-student-lecture-reader]').first().click();
  await expect(page.locator('#apcStudentLectureReader')).toBeVisible();
  await page.locator('#apcStudentLectureReader [data-slr-close]').click();
  await expect(page.locator('#apcStudentLectureReader')).toBeHidden();

  // Trigger Student On-Demand PDF Download
  const [studentDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#courseHub [data-student-lecture-pdf]').first().click()
  ]);
  expect(studentDownload.suggestedFilename()).toMatch(/^[A-Za-z0-9_.-]+\.pdf$/);
  const stuPdfBytes = fs.readFileSync(await studentDownload.path());
  expect(stuPdfBytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');

  expect(errors).toEqual([]);
});

test('Teacher Panel (#courses) strictly scopes Lecture Sheet Studio to assigned class/subject and persists across page reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => {
    const msg = String(err?.message || err || '');
    if (/auth\/network-request-failed|Supabase endpoint temporarily unreachable|Failed to fetch/i.test(msg)) return;
    errors.push(msg);
  });
  await page.route(/supabase\.co|firebaseio\.com|googleapis\.com/, route => route.abort());
  await page.setViewportSize({ width: 1024, height: 768 });

  await page.addInitScript(roster => {
    localStorage.setItem('activePlus.admin.students.v1', JSON.stringify(roster));
  }, ROSTER_SEED);

  // Assign teacher.apc exclusively to দশম শ্রেণি -> গণিত (বিজ্ঞান) via Manager first
  await enterPortal(page, 'manager');
  await page.evaluate(async () => {
    const auth = await import('/js/staff-auth.js');
    await auth.provisionStaffAccount('teacher', 'Apc-E2E-2026', 'Apc-E2E-2026');
    const { saveTeacherAssignment } = await import('/js/teacher-assignments.js');
    const { subjectsForClass } = await import('/js/academics.js');
    const firstSub = subjectsForClass('দশম শ্রেণি')[0];
    await saveTeacherAssignment({
      teacherUsername: 'teacher.apc',
      className: 'দশম শ্রেণি',
      group: 'বিজ্ঞান',
      subjects: [firstSub.name]
    });
  });

  // Sign in as Teacher and open #courses -> উপকরণ তালিকা ও খসড়া
  await enterPortal(page, 'teacher');
  await expect(page.locator('#teacherShell')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#courses'; });
  await expect(page.locator('#teacherCourses')).toBeVisible();
  await page.locator('#teacherCourses [data-courses-action="materials"]').click();
  await expect(page.locator('#teacherCourseEditor [data-ls-mgr-action="open-create"]')).toBeVisible();

  // Verify Teacher Quick Create class dropdown ONLY lists assigned "দশম শ্রেণি"
  await page.locator('#teacherCourseEditor [data-ls-mgr-action="open-create"]').click();
  const classOptions = await page.locator('#teacherCourseEditor select[name="lsClassId"] option').allTextContents();
  expect(classOptions).toEqual(['দশম শ্রেণি']);

  await page.fill('#teacherCourseEditor input[name="lsChapterName"]', 'অধ্যায় ৩: বীজগাণিতিক রাশি');
  await page.fill('#teacherCourseEditor input[name="lsTopic"]', 'উৎপাদকে বিশ্লেষণ');
  await page.fill('#teacherCourseEditor input[name="lsTitle"]', 'শিক্ষক লেকচার শিট — বীজগণিত');
  await page.locator('#teacherCourseEditor [data-ls-quick-create-form] button[type="submit"]').click();

  const overlay = page.locator('#apcLectureStudioOverlay');
  await expect(overlay).toBeVisible();
  await overlay.locator('.ProseMirror').click();
  await page.keyboard.type('বীজগাণিতিক সূত্রাবলি ও সৃজনশীল অনুশীলনী — সংরক্ষণ পরীক্ষা।');
  await overlay.locator('.ls-topbar-actions [data-ls-action="save-draft"]').click();
  await expect(overlay.locator('[data-ls-save-badge]')).toContainText('সংরক্ষিত');
  await overlay.locator('[data-ls-action="exit"]').click();
  await expect(overlay).toBeHidden();

  // Reload Teacher panel & verify persisted Lecture Sheet reopens intact
  await page.reload();
  await expect(page.locator('#teacherShell')).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#courses'; });
  await page.locator('#teacherCourses [data-courses-action="materials"]').click();
  await expect(page.locator('#teacherCourseEditor [data-ls-card]')).toContainText('শিক্ষক লেকচার শিট — বীজগণিত');

  await page.locator('#teacherCourseEditor [data-ls-mgr-action="edit"]').first().click();
  await expect(page.locator('#apcLectureStudioOverlay .ProseMirror')).toContainText('বীজগাণিতিক সূত্রাবলি ও সৃজনশীল অনুশীলনী');
  await page.locator('#apcLectureStudioOverlay [data-ls-action="exit"]').click();
  expect(errors).toEqual([]);
});
