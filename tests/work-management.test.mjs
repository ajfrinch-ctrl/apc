/* কেন্দ্রীয় Work Management — Teacher Panel (২০২৬-১১-১১)।

   চুক্তি:
     1. একটাই প্রবেশপথ, একই স্ক্রিনে চারটি অংশ; ডিফল্ট অংশ "আমার ক্লাস"
        (পুরোনো ক্লাস তালিকা ও রুটিন দরজা অপরিবর্তিত)।
     2. wizard: বিভাগ → ফিচার → শ্রেণি/বিষয় → প্রিভিউ; প্রতিটি ধাপে ডেটা লেখা
        হয় না — শুধু নির্বাচন।
     3. হ্যান্ডঅফ: হোমওয়ার্ক/সাজেশন বিদ্যমান activity editor-এ, notice বিদ্যমান
        composer-এ; scope শুধু ফর্মের প্রাথমিক মান।
     4. অনুমোদন: পরীক্ষার জন্য "অনুমোদনের জন্য পাঠান", "প্রকাশ করুন" নয়।
     5. "আমার প্রকাশিত কাজ" একই store থেকে status দেখায়; সম্পাদনা একই
        রেকর্ড খোলে, নতুন কপি বানায় না। */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { openStaffPanel } from './staff-harness.mjs';
import { teachingRepository } from '../js/teaching-data.js';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { enabledClasses } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';

const nfc = value => String(value ?? '').normalize('NFC');
const settle = () => new Promise(resolve => setTimeout(resolve, 50));
const CLASS = 'দশম শ্রেণি';
const SUBJECT = 'গণিত';

let ctx;
const $ = selector => ctx.$(selector);
const $$ = selector => ctx.$$(selector);
const visibleScreens = () => $$('.teacher-view').filter(el => !el.hidden).map(el => el.id);
const select = (element, value) => {
  element.value = value;
  element.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
};

async function openClasses() {
  ctx.click($('.admin-bottom [data-panel-view="classes"]'));
  await settle();
}
async function startWizard() {
  await openClasses();
  ctx.click($('[data-work-start]'));
  await settle();
}
async function pickFeature(category, feature) {
  ctx.click($(`[data-work-category="${category}"]`));
  await settle();
  ctx.click($(`[data-work-feature="${feature}"]`));
  await settle();
}
async function toReview({ className = CLASS, subject = SUBJECT } = {}) {
  const classSelect = $('[data-work-scope="className"]');
  if (classSelect) { select(classSelect, className); await settle(); }
  const subjectSelect = $('[data-work-scope="subject"]');
  if (subjectSelect) { select(subjectSelect, subject); await settle(); }
  ctx.click($('[data-work-next]'));
  await settle();
}

before(async () => {
  ctx = await loadPage('teacher.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [ROSTER_KEY]: JSON.stringify(adminStudents),
      [TEACHER_ASSIGNMENTS_KEY]: JSON.stringify(enabledClasses.map((className, index) => ({
        id: `TAS-${index}`, teacherUsername: 'teacher.apc', teacherName: 'Test Teacher', className, group: '', subject: SUBJECT
      })))
    }
  });
  await openStaffPanel(ctx, 'teacher', {
    importPanel: () => import('../js/teacher.js'),
    shellId: 'teacherShell',
    ready: () => [...$('#teacherClassFilter').options].some(option => option.textContent === 'সব নির্ধারিত শ্রেণি')
  });
  await settle();
});
after(() => { try { ctx.window.close(); } catch { /* already gone */ } });

test('the work seat is one screen with four parts, and the class list stays the default', () => {
  assert.ok($('#teacherWorkMount'), 'the central workspace is mounted');
  assert.deepEqual($$('#teacherWorkMount [data-work-tab]').map(button => button.dataset.workTab),
    ['new', 'published', 'activity', 'classes']);
  assert.equal($('#teacherWorkMount [data-work-tab="classes"]').getAttribute('aria-selected'), 'true');
  assert.equal($('#teacherClassPane').hidden, false, 'আমার ক্লাস pane is open by default');
  assert.ok($('#teacherClassPane .teacher-submenu [data-panel-view="routine-view"]'), 'the existing routine door is preserved');
  assert.ok($('#teacherClassPane #teacherClassList'), 'the single class-list renderer is preserved');
  assert.equal($('#teacherWorkMount [data-work-pane="new"]').hidden, true, 'only one part is visible');
  assert.ok($('#teacherWorkMount [data-work-start]'), 'one prominent create entry');
});

test('wizard: category → feature → class/subject → preview writes nothing to storage', async () => {
  await startWizard();
  assert.equal($('[data-work-tab="new"]').getAttribute('aria-selected'), 'true');
  assert.equal($('[data-work-pane="new"]').hidden, false);
  assert.equal($('#teacherClassPane').hidden, true, 'the class pane steps aside');

  const before = ctx.window.localStorage.getItem('activePlus.teaching.v1');
  ctx.click($('[data-work-category="study"]'));
  await settle();
  const feature = $('[data-work-feature="homework"]');
  assert.ok(feature, 'homework is reachable from the study category');
  assert.match(feature.textContent, /বাড়ির কাজ/);
  ctx.click(feature);
  await settle();
  assert.ok($('[data-work-scope="className"]'), 'class is asked only where the feature needs it');
  /* Back returns to the feature list and re-entering keeps the same contract. */
  ctx.click($('[data-work-back]'));
  await settle();
  assert.ok($('[data-work-feature="homework"]'));
  ctx.click($('[data-work-feature="homework"]'));
  await settle();
  await toReview();
  assert.equal(ctx.window.localStorage.getItem('activePlus.teaching.v1'), before, 'the wizard never writes');
  assert.match($('#teacherWorkMount').textContent, /প্রিভিউ/);
  assert.match($('#teacherWorkMount').textContent, /শিক্ষক নিজেই প্রকাশ করতে পারেন/);
  assert.match($('#teacherWorkMount').textContent, /বাড়ির কাজ/);
  assert.ok($('[data-work-open="draft"]'), 'draft is a separate action');
  assert.ok($('[data-work-open="publish"]'), 'publish is a separate action');
  /* Preview is read-only and stays on the same screen. */
  ctx.click($('[data-work-preview]'));
  await settle();
  assert.ok($('.work-preview-card'));
  assert.deepEqual(visibleScreens(), ['teacherClasses'], 'preview never leaves the workspace');
  assert.equal(ctx.window.localStorage.getItem('activePlus.teaching.v1'), before, 'preview writes nothing');
});

test('publish hands off to the one real homework editor with the chosen scope pre-filled', async () => {
  ctx.click($('[data-work-open="publish"]'));
  await settle();
  assert.deepEqual(visibleScreens(), ['teacherDetailView'], 'the existing routed editor opens');
  assert.ok($('#teacherActivityForm'), 'the canonical form, not a second one');
  assert.equal($('#activity-className').value, CLASS);
  assert.equal($('#activity-subject').value, SUBJECT);
  assert.equal($('#activity-status').value, 'published', 'the chosen action pre-selects the stored status');
  ctx.click($('#teacherDetailContent [data-close-teacher]'));
  await settle();
  assert.equal($('#teacherActivityForm'), null, 'cancel closes the editor without saving');
});

test('an exam can only be submitted for approval — never published by the teacher', async () => {
  await startWizard();
  await pickFeature('exam', 'online-exam');
  await toReview();
  const text = nfc($('#teacherWorkMount').textContent);
  assert.match(text, /Admin\/Manager অনুমোদনের পরে প্রকাশ/);
  assert.equal($('[data-work-open="publish"]'), null, 'no publish action exists for an exam');
  assert.ok($('[data-work-open="approval"]'), 'the approval submission is the primary action');
  ctx.click($('[data-work-open="approval"]'));
  await settle();
  assert.equal(ctx.window.location.hash, '#online-exams', 'it opens the existing examination workspace');
  assert.deepEqual(visibleScreens(), ['teacherOnlineExams']);
});

test('my published work lists real stored statuses from the existing repository', async () => {
  await teachingRepository.saveActivity({
    type: 'homework', title: 'Articles Practice', subject: SUBJECT, className: CLASS, status: 'published', details: 'আর্টিকেল অনুশীলন'
  });
  await teachingRepository.saveActivity({
    type: 'suggestion', title: 'দশম শ্রেণির সাজেশন', subject: SUBJECT, className: CLASS, status: 'draft', details: 'অধ্যায়ভিত্তিক'
  });
  ctx.window.dispatchEvent(new ctx.window.Event('teaching-data-updated'));
  await ctx.waitFor(() => $$('#teacherWorkMount .work-tab-count').length === 4);
  await settle();
  await openClasses();
  ctx.click($('[data-work-tab="published"]'));
  await settle();
  await ctx.waitFor(() => $$('#workPublished .work-card').length >= 2);
  const cards = $$('#workPublished .work-card');
  const titles = cards.map(card => card.querySelector('h3')?.textContent || '');
  assert.ok(titles.some(title => nfc(title) === nfc('Articles Practice')), 'the published homework is listed');
  assert.ok(titles.some(title => nfc(title) === nfc('দশম শ্রেণির সাজেশন')), 'the draft suggestion is listed too');
  const publishedCard = cards.find(card => nfc(card.querySelector('h3')?.textContent) === nfc('Articles Practice'));
  assert.match(publishedCard.textContent, /প্রকাশিত/);
  const draftCard = cards.find(card => nfc(card.querySelector('h3')?.textContent) === nfc('দশম শ্রেণির সাজেশন'));
  assert.match(draftCard.textContent, /খসড়া/);

  ctx.click($('[data-work-status="draft"]'));
  await settle();
  const filtered = $$('#workPublished .work-card').map(card => card.querySelector('h3')?.textContent || '');
  assert.ok(!filtered.some(title => nfc(title) === nfc('Articles Practice')), 'the published card is filtered out');
  assert.ok(filtered.some(title => nfc(title) === nfc('দশম শ্রেণির সাজেশন')), 'the draft remains in the draft lane');
});

test('opening a published work edits the same record — no duplicate is created', async () => {
  ctx.click($('[data-work-status="all"]'));
  await settle();
  const before = (await teachingRepository.list()).activities.length;
  const card = $$('#workPublished .work-card').find(row => nfc(row.querySelector('h3')?.textContent) === nfc('Articles Practice'));
  ctx.click(card.querySelector('[data-work-open-item]'));
  await settle();
  assert.deepEqual(visibleScreens(), ['teacherDetailView']);
  assert.match(ctx.window.location.hash, /^#activity\//, 'the detail route carries the record id');
  assert.match(nfc($('#teacherDetailContent').textContent), /Articles Practice/);
  assert.equal((await teachingRepository.list()).activities.length, before, 'navigation created no second record');
});

test('student activity summarises real submissions from the same teaching store', async () => {
  const student = adminStudents.find(row => row.className === CLASS && (row.status === 'approved' || row.status === 'active'));
  assert.ok(student, 'a roster student exists for this class');
  const activity = (await teachingRepository.list()).activities.find(row => row.title === 'Articles Practice');
  assert.ok(activity);
  await teachingRepository.saveProgress(activity.id, { [student.id]: 'done' });
  ctx.window.dispatchEvent(new ctx.window.Event('teaching-data-updated'));
  await ctx.waitFor(() => $$('#teacherWorkMount .work-tab-count').length === 4);
  await settle();
  await openClasses();
  ctx.click($('[data-work-tab="activity"]'));
  await settle();
  await ctx.waitFor(() => /বাড়ির কাজ জমা/.test(nfc($('#workActivity')?.textContent || '')));
  const text = nfc($('#workActivity').textContent);
  assert.match(text, /বাড়ির কাজ জমা/);
  assert.match(text, /জমা দিয়েছে|দেখা হয়েছে/);
  assert.match(text, new RegExp(nfc(student.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the submitting student is named');
});

test('a data refresh keeps the teacher on the work part they were using', async () => {
  await openClasses();
  ctx.click($('[data-work-tab="new"]'));
  await settle();
  assert.equal($('#workPane-new').hidden, false, 'the new-work part is open');
  assert.equal($('#teacherClassPane').hasAttribute('hidden'), true, 'the class pane steps aside');
  ctx.window.dispatchEvent(new ctx.window.Event('teaching-data-updated'));
  await settle();
  await ctx.waitFor(() => $('#workPane-new') && !$('#workPane-new').hidden);
  assert.equal($('#workPane-new').hidden, false, 'a sync refresh must not kick the teacher back to another part');
  assert.equal($('#teacherClassPane').hasAttribute('hidden'), true);
});

test('home work cards carry the same live counts as the work panel tabs', async () => {
  const bn = value => String(value).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[digit]);
  await teachingRepository.saveActivity({
    type: 'homework', title: 'কাউন্টার যাচাই', subject: SUBJECT, className: CLASS,
    status: 'published', details: 'হোম-কার্ডের সংখ্যা মিলিয়ে দেখা'
  });
  ctx.window.dispatchEvent(new ctx.window.Event('teaching-data-updated'));
  await ctx.waitFor(() => $$('#teacherWorkMount .work-tab-count').length === 4);
  await settle();
  ctx.click($('.admin-bottom [data-panel-view="home"]'));
  await settle();
  await ctx.waitFor(() => $('#teacherHome [data-work-count="published"]')?.hidden === false);

  const homePublished = $('#teacherHome [data-work-count="published"]');
  const tabPublished = $('[data-work-tab="published"] .work-tab-count');
  assert.equal(nfc(homePublished.textContent).trim(), nfc(tabPublished.textContent).trim(),
    'home and the work panel read the same count');
  assert.match(homePublished.closest('.teacher-action-card').getAttribute('aria-label'), /টি$/,
    'the accessible name carries the number too');

  const homeworkCount = (await teachingRepository.list()).activities
    .filter(row => row.type === 'homework' && row.status === 'published').length;
  const homeActivity = $('#teacherHome [data-work-count="activity"]');
  assert.equal(homeActivity.hidden, false);
  assert.equal(nfc(homeActivity.textContent).trim(), bn(homeworkCount),
    'student-activity count is the published homework the teacher owns');

  const before = nfc(homeActivity.textContent).trim();
  await teachingRepository.saveActivity({
    type: 'homework', title: 'আরও একটি কাজ', subject: SUBJECT, className: CLASS,
    status: 'published', details: 'কাউন্ট বাড়ে কি না'
  });
  ctx.window.dispatchEvent(new ctx.window.Event('teaching-data-updated'));
  await settle();
  await ctx.waitFor(() => nfc($('#teacherHome [data-work-count="activity"]').textContent).trim() !== before);
  assert.equal(nfc($('#teacherHome [data-work-count="activity"]').textContent).trim(),
    bn(homeworkCount + 1), 'a new published homework raises the count without a reload');
});
