/* Student-facing notices have their own categories and explicit Read ✓ receipts. */
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';
import { NOTICE_CATEGORIES, noticeCategory, noticeItem } from '../js/notification-rules.js';

const student = { id: 'NB-STUDENT-1', name: 'রাইসা', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ' };
const notice = (id, category, createdAt, extra = {}) => ({
  id, category, title: `Notice ${id}`, body: `বিস্তারিত ${id}`, audience: 'সকল শিক্ষার্থী',
  status: 'published', createdAt, ...extra
});

test('notice categories normalize known labels and safely default legacy notices to Academic', () => {
  assert.deepEqual(NOTICE_CATEGORIES.map(item => item.id), ['urgent', 'academic', 'class', 'fee', 'exam']);
  assert.equal(noticeCategory({ category: '🔴 জরুরি' }), 'urgent');
  assert.equal(noticeCategory({ category: 'Class' }), 'class');
  assert.equal(noticeCategory({ category: 'ফি' }), 'fee');
  assert.equal(noticeCategory({ urgent: true }), 'urgent');
  assert.equal(noticeCategory({ title: 'পুরোনো notice' }), 'academic');
});

test('the Notice Board filters and opens notices separately from the bell, then saves Read ✓ per student', async t => {
  const ctx = await loadPage('student.html', { seed: {
    [KEYS.account]: JSON.stringify({ username: 'raisa', status: 'active', student }),
    [KEYS.notices]: JSON.stringify([
      notice('NB-U', 'urgent', new Date(Date.now() - 60 * 60 * 1000).toISOString(), { title: 'জরুরি ঘোষণা', body: '<img src=x onerror=alert(1)> আজই দেখে নাও।' }),
      notice('NB-A', 'academic', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()),
      notice('NB-C', 'class', new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()),
      notice('NB-F', 'fee', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()),
      notice('NB-E', 'exam', new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()),
      notice('NB-PRIVATE', 'fee', new Date(Date.now() - 30 * 60 * 1000).toISOString(), { audience: 'শুধু শিক্ষক' })
    ]),
    [KEYS.settings]: JSON.stringify({ broadcastAlert: true, broadcastMessage: '<svg onload=alert(1)> জরুরি সার্ভার ঘোষণা' })
  } });
  t.after(() => ctx.window.close());
  ctx.$('#appShell').hidden = false;
  let currentStudent = student;
  const { initStudentNoticeBoard } = await import('../js/student-notice-board.js?notice-board-test');
  const board = initStudentNoticeBoard({ getStudent: () => currentStudent });
  const { initNotifications } = await import('../js/notifications.js?notice-board-separation-test');
  const inbox = initNotifications();
  await ctx.waitFor(() => Boolean(ctx.window.apcNoticeCenter), 3000);
  await ctx.flush();

  assert.deepEqual(board.refresh(), { total: 6, unread: 6 }, 'five audience-matched notices plus the urgent broadcast');
  assert.deepEqual(
    ctx.$$('#noticeBoardCategories [data-notice-board-category]').map(tab => tab.dataset.noticeBoardCategory),
    ['all', 'urgent', 'academic', 'class', 'fee', 'exam']
  );
  assert.equal(ctx.$('#notificationButton .notification-dot').hidden, false, 'unread notices show count badge on the bell icon');
  assert.equal(ctx.$('#notificationButton .notification-dot').textContent, '৬');
  assert.equal(inbox.unread(), 6);
  assert.ok(inbox.feed().some(item => item.kind === 'notice') && inbox.feed().some(item => item.kind === 'broadcast'));

  ctx.click(ctx.$('#notificationButton'));
  assert.match(ctx.$('#noticeModal').textContent, /নতুন নোটিশ এসেছে - জরুরি ঘোষণা/);
  assert.match(ctx.$('#noticeModal').textContent, /জরুরি সার্ভার ঘোষণা/);
  ctx.click(ctx.$('#noticeModal .modal-close'));

  const tapped = inbox.feed().find(item => item.kind === 'notice' && item.sourceId === 'NB-U');
  assert.equal(await inbox.openItem({ kind: 'notice', sourceId: 'NB-U', key: tapped.key }), true, 'a push tap opens the Notice Board detail');
  assert.equal(ctx.$('#noticeBoardDetail').hidden, false);
  assert.equal(ctx.$('#noticeBoardReadButton').disabled, false, 'direct tray/programmatic open keeps explicit Read ✓ button available');
  assert.equal(board.refresh().unread, 6);
  ctx.click(ctx.$('#noticeBoardDetail [data-notice-board-close]'));

  ctx.click(ctx.$('#noticeBoardCategories [data-notice-board-category="fee"]'));
  assert.equal(ctx.$$('#noticeBoardList .notice-board-card').length, 1);
  assert.match(ctx.$('#noticeBoardList').textContent, /Notice NB-F/);
  assert.doesNotMatch(ctx.$('#noticeBoardList').textContent, /NB-PRIVATE/);

  ctx.click(ctx.$('#noticeBoardCategories [data-notice-board-category="all"]'));
  const urgentCard = [...ctx.$$('#noticeBoardList .notice-board-card')].find(card => card.textContent.includes('জরুরি ঘোষণা'));
  assert.ok(urgentCard, 'the urgent notice has its own category card');
  ctx.click(urgentCard.querySelector('[data-notice-board-open]'));
  assert.equal(ctx.$('#noticeBoardDetail').hidden, false);
  assert.equal(ctx.$('#noticeBoardDetailTitle').textContent, 'জরুরি ঘোষণা');
  assert.equal(ctx.$('#noticeBoardDetailBody').textContent, '<img src=x onerror=alert(1)> আজই দেখে নাও।');
  assert.equal(ctx.$$('#noticeBoardDetail img').length, 0, 'notice content is rendered as text, not markup');
  const readButton = ctx.$('#noticeBoardReadButton');
  assert.equal(readButton.textContent, 'পড়া হয়েছে ✓');
  ctx.click(readButton);
  assert.equal(ctx.$('#noticeBoardReadButton').textContent, 'পড়া হয়েছে ✓');
  assert.equal(ctx.$('#noticeBoardReadButton').disabled, true);
  assert.equal(board.refresh().unread, 5);
  assert.equal(inbox.unread(), 5, 'reading a notice on the Board decrements the bell unread count');
  assert.equal(ctx.$('#notificationButton .notification-dot').textContent, '৫');
  const receiptKey = 'activePlus.noticeBoard.read.v1:NB-STUDENT-1';
  const saved = JSON.parse(ctx.window.localStorage.getItem(receiptKey));
  assert.ok(saved.keys.some(key => key.startsWith('notice:NB-U:')));

  currentStudent = { ...student, id: 'NB-OTHER-STUDENT' };
  assert.equal(board.refresh().unread, 6, 'Read ✓ belongs to this student, not another account on the device');
});

test('notice detail is a single view and one notice id never paints twice', async t => {
  const ctx = await loadPage('student.html', { seed: {
    [KEYS.account]: JSON.stringify({ username: 'raisa', status: 'active', student }),
    [KEYS.notices]: JSON.stringify([
      notice('NB-1', 'academic', '2026-10-04T10:00:00.000Z', { title: 'প্রথম নোটিশ', body: 'পূর্ণ বিস্তারিত বডি।' }),
      notice('NB-1', 'academic', '2026-10-04T09:00:00.000Z', { title: 'পুরনো কপি', body: 'ডুপ্লিকেট সোর্স।' }),
      notice('NB-2', 'exam', '2026-10-03T10:00:00.000Z', { title: 'আরেকটি নোটিশ', body: 'বডি দুই।' })
    ])
  } });
  t.after(() => ctx.window.close());
  ctx.$('#appShell').hidden = false;
  const { initStudentNoticeBoard } = await import('../js/student-notice-board.js?notice-board-single-view-test');
  const board = initStudentNoticeBoard({ getStudent: () => student });
  await ctx.flush();

  /* 5) one board row per notice id — the newer source row wins */
  assert.deepEqual(board.refresh(), { total: 2, unread: 2 }, 'a duplicated notice id collapses into one row');
  assert.equal(ctx.$$('#noticeBoardList .notice-board-card').length, 2);
  assert.match(ctx.$('#noticeBoardList').textContent, /প্রথম নোটিশ/);
  assert.doesNotMatch(ctx.$('#noticeBoardList').textContent, /পুরনো কপি/);

  /* 1) tapping the card body opens only the full notice */
  ctx.click(ctx.$$('#noticeBoardList .notice-board-card')[0]);
  assert.equal(ctx.$('#noticeBoardDetail').hidden, false);
  assert.match(ctx.$('#noticeBoardDetail').textContent, /পূর্ণ বিস্তারিত বডি।/);
  assert.equal(ctx.$('#noticeBoardList').hidden, true, 'the list leaves the screen while the detail is open');
  assert.equal(ctx.window.document.body.classList.contains('notice-board-detail-open'), true);
  const css = readFileSync(new URL('../css/notice-board.css', import.meta.url), 'utf8');
  assert.match(css, /\.notice-board-detail:not\(\[hidden\]\)\{[^}]*position:fixed/, 'the open detail is a fixed modal sheet');
  assert.match(css, /\.notice-board-list\[hidden\]\{display:none/, 'a hidden list can never show through');

  /* 2) backdrop click closes back to the plain list */
  ctx.click(ctx.window.document.body);
  assert.equal(ctx.$('#noticeBoardDetail').hidden, true);
  assert.equal(ctx.$('#noticeBoardList').hidden, false);
  assert.equal(ctx.window.document.body.classList.contains('notice-board-detail-open'), false);

  /* 2b) × closes too */
  ctx.click(ctx.$$('#noticeBoardList .notice-board-card')[0]);
  assert.equal(ctx.$('#noticeBoardDetail').hidden, false);
  ctx.click(ctx.$('#noticeBoardDetail [data-notice-board-close]'));
  assert.equal(ctx.$('#noticeBoardDetail').hidden, true);
  assert.equal(ctx.$('#noticeBoardList').hidden, false);

  /* 3) «পড়া হয়েছে ✓» marks read and drops the unread count */
  ctx.click(ctx.$$('#noticeBoardList .notice-board-card')[0]);
  assert.equal(board.refresh().unread, 2);
  assert.equal(ctx.$('#noticeBoardReadButton').disabled, false);
  ctx.click(ctx.$('#noticeBoardReadButton'));
  assert.equal(board.refresh().unread, 1);
  assert.equal(ctx.$('#noticeBoardReadButton').disabled, true);
  assert.equal(ctx.$('#noticeBoardReadButton').textContent, 'পড়া হয়েছে ✓');

  /* 4) no English board labels anywhere */
  const boardText = ctx.$('#notice-boardView').textContent;
  assert.doesNotMatch(boardText, /Notice Board|Notice খুলুন|Read ✓|Academic|Class|Fee|Exam/);
  const source = readFileSync(new URL('../js/student-notice-board.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /'Notice Board'|'Notice খুলুন'|'Read ✓'|'Academic'|'Class'|'Fee'|'Exam'/);
});

test('Notice Board opens from the Home services tile and the More menu, with unread badges, alert and direct open', async t => {
  const student = { id: 'NB-UX-1', name: 'রাইসা ইসলাম', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ' };
  const viewerKey = `student:${student.id}`;
  const { hashPassword } = await import('../js/password-hash.js');
  const pinHash = await hashPassword('246810');
  const ctx = await loadPage('student.html', { seed: {
    'activePlus.demo.autofill.v1': 'off',
    [KEYS.account]: JSON.stringify({
      mobile: '01700000000', registrationMobile: '01700000000',
      username: 'raisa.ux', pinHash, status: 'active', student
    }),
    [KEYS.notices]: JSON.stringify([]),
    [`activePlus.notifications.boot.v1:${viewerKey}`]: JSON.stringify({ version: 1, at: Date.now() - 60000 }),
    [`activePlus.notifications.rules.v1:${viewerKey}`]: JSON.stringify({ version: 3, at: Date.now() - 60000 })
  } });
  t.after(() => ctx.window.close());

  const { buildSessionRecord } = await import('../js/session.js');
  ctx.window.localStorage.setItem('active-plus-session-v1', JSON.stringify(buildSessionRecord({ owner: 'raisa.ux' })));
  await import(`../js/main.js?notice-ux=${Math.random()}`);
  await ctx.waitFor(() => ctx.$('#appShell') && ctx.$('#appShell').hidden === false, 4000);
  const { initNotifications } = await import(`../js/notifications.js?notice-ux-bell=${Math.random()}`);
  const inbox = initNotifications();
  await ctx.waitFor(() => Boolean(ctx.window.apcNoticeCenter && ctx.window.apcStudentNoticeBoard), 4000);
  await ctx.flush(6);

  /* 1) More menu ("আরও") has "নোটিশ বোর্ড" prioritized as the very first option */
  const moreButtons = ctx.$$('#profileView > nav.more-menu > button');
  assert.equal(moreButtons[0].dataset.view, 'notice-board');
  assert.match(moreButtons[0].textContent, /নোটিশ বোর্ড/);

  /* 2) Home keeps no notice card above the hero: the strip was removed on the
     owner's review, and the services tile is the one-click way in. */
  assert.equal(ctx.$('#homeView #homeNoticeButton'), null, 'no notice card above the hero');
  assert.equal(ctx.$('#homeView .home-notice-banner'), null, 'the banner section is gone from Home');
  const homeTile = ctx.$('#homeView .notice-board-shortcut');
  assert.ok(homeTile, 'the services tile still opens the Notice Board');
  assert.equal(homeTile.dataset.view, 'notice-board');
  assert.equal(ctx.$('#notificationButton .notification-dot').hidden, true, 'no unread notices initially');

  /* Clicking the Home services tile goes straight to Notice Board in 1 click, and Back returns to Home */
  ctx.click(homeTile);
  await ctx.flush(4);
  assert.equal(ctx.$('#notice-boardView').hidden, false);
  assert.equal(ctx.$('#notice-boardView .pay-back').dataset.view, 'home');
  ctx.click(ctx.$('#notice-boardView .pay-back'));
  await ctx.flush(4);
  assert.equal(ctx.$('#homeView').hidden, false);

  /* Clicking More -> "নোটিশ বোর্ড" goes straight to Notice Board, and Back returns to More ("profile") */
  ctx.click(ctx.$('.bottom-link[data-view="profile"]'));
  await ctx.flush(4);
  assert.equal(ctx.$('#profileView').hidden, false);
  ctx.click(moreButtons[0]);
  await ctx.flush(4);
  assert.equal(ctx.$('#notice-boardView').hidden, false);
  assert.equal(ctx.$('#notice-boardView .pay-back').dataset.view, 'profile');
  ctx.click(ctx.$('#notice-boardView .pay-back'));
  await ctx.flush(4);
  assert.equal(ctx.$('#profileView').hidden, false);

  /* Return to Home, then publish a new notice from Admin/Office store */
  ctx.click(ctx.$('.bottom-link[data-view="home"]'));
  await ctx.flush(4);
  const weeklyHoliday = {
    id: 'NB-HOLIDAY-1',
    title: 'সাপ্তাহিক বন্ধের নোটিশ',
    body: 'আগামী শুক্রবার কোচিংয়ের সকল ক্লাস বন্ধ থাকবে।',
    category: 'urgent',
    audience: 'সকল শিক্ষার্থী',
    status: 'published',
    createdAt: '2026-10-22T09:00:00.000Z'
  };
  ctx.window.localStorage.setItem(KEYS.notices, JSON.stringify([weeklyHoliday]));
  ctx.window.dispatchEvent(new ctx.window.StorageEvent('storage', {
    key: KEYS.notices,
    newValue: ctx.window.localStorage.getItem(KEYS.notices),
    storageArea: ctx.window.localStorage,
    url: 'http://localhost/'
  }));
  inbox.refresh();
  ctx.window.apcStudentNoticeBoard.refresh();
  await ctx.flush(6);

  /* 3 & 5) Unread badge shows "১" on Bell icon, Home card, Services tile & More menu, and alert text matches */
  const dot = ctx.$('#notificationButton .notification-dot');
  assert.equal(dot.hidden, false, 'bell badge appears when unread notice exists');
  assert.equal(dot.textContent, '১');
  assert.equal(ctx.$('#noticeBoardUnreadBadge').hidden, false, 'the services tile carries the unread count');
  assert.equal(ctx.$('#noticeBoardUnreadBadge').textContent, '১');
  assert.equal(moreButtons[0].querySelector('[data-notice-unread-badge]').textContent, '১');

  /* Dismiss live in-app alert if open so we test clicking from Notification Center (#noticeModal) */
  if (ctx.$('#apcInAppAlert') && !ctx.$('#apcInAppAlert').hidden) {
    assert.match(ctx.$('#apcInAppAlert').textContent, /নতুন নোটিশ এসেছে - সাপ্তাহিক বন্ধের নোটিশ/);
    ctx.click(ctx.$('#apcInAppAlert [data-apc-alert-close]'));
  }

  ctx.click(ctx.$('#notificationButton'));
  await ctx.flush(4);
  assert.equal(ctx.$('#noticeModal').hidden, false);
  assert.match(ctx.$('#noticeListStudent').textContent, /নতুন নোটিশ এসেছে - সাপ্তাহিক বন্ধের নোটিশ/);

  /* 4) A notice opens its context detail first; its explicit action opens the Notice Board item. */
  const notifCard = ctx.$('#noticeListStudent .notice-detail[data-apc-notice-open^="notice:NB-HOLIDAY-1"]');
  assert.ok(notifCard, 'the notice card inside Notification Center is clickable');
  ctx.click(notifCard);
  await ctx.flush(3);
  const contextDetail = ctx.$('#noticeModal [data-apc-notice-detail-sheet^="notice:NB-HOLIDAY-1"]');
  assert.ok(contextDetail, 'notification opens its detail before navigation');
  ctx.click(contextDetail.querySelector('[data-apc-notice-detail-action]'));
  await ctx.flush(6);

  assert.equal(ctx.$('#noticeModal').hidden, true, 'Notification Center modal closes');
  assert.equal(ctx.$('#notice-boardView').hidden, false, 'Notice Board view opens');
  assert.equal(ctx.$('#noticeBoardDetail').hidden, false, 'the specific notice detail opens directly');
  assert.equal(ctx.$('#noticeBoardDetailTitle').textContent, 'সাপ্তাহিক বন্ধের নোটিশ');
  assert.match(ctx.$('#noticeBoardDetailBody').textContent, /আগামী শুক্রবার কোচিংয়ের সকল ক্লাস বন্ধ থাকবে/);

  /* Unread badges clear across Bell, Home card, More menu and Services tile once opened from Notification Center */
  assert.equal(dot.hidden, true, 'bell badge clears once read');
  assert.equal(ctx.$('#noticeBoardUnreadBadge').hidden, true);
});

test('mobile notice board & detail sheet preserve fixed modal scrolling, full-width padding, and pre-wrap Bengali wrapping', async t => {
  const notifCss = readFileSync(new URL('../css/notifications.css', import.meta.url), 'utf8');
  const boardCss = readFileSync(new URL('../css/notice-board.css', import.meta.url), 'utf8');
  const heroCss = readFileSync(new URL('../css/hero-cards.css', import.meta.url), 'utf8');
  const walletCss = readFileSync(new URL('../css/ui-wallet.css', import.meta.url), 'utf8');

  // Verify .notification-body & .notice-content have pre-wrap, word-break, overflow-wrap, max-height: 60vh, and overflow-y: auto
  assert.match(notifCss, /\.notification-body,\.notice-content\{[^}]*white-space:pre-wrap/);
  assert.match(notifCss, /\.notification-body,\.notice-content\{[^}]*word-break:break-word/);
  assert.match(notifCss, /\.notification-body,\.notice-content\{[^}]*overflow-wrap:anywhere/);
  assert.match(notifCss, /\.notification-body,\.notice-content\{[^}]*max-height:60vh/);
  assert.match(notifCss, /\.notification-body,\.notice-content\{[^}]*overflow-y:auto/);
  assert.match(boardCss, /\.notice-board-detail \.notice-content\{[^}]*max-height:60vh;overflow-y:auto/);

  // Verify hero-cards.css never overrides #noticeBoardDetail to position: relative or squeezes mobile width with padding-right: 94px/78px/70px
  assert.doesNotMatch(heroCss, /#noticeBoardDetail:has\(>\s*\.hc-art--megaphone\)\s*\{\s*padding-right/);
  assert.match(heroCss, /body\.student-reference #noticeBoardDetail:not\(\[hidden\]\):has\(> \.hc-art\)\s*\{\s*position:\s*fixed/);

  // Verify ui-wallet.css does not clip expanded .notice-detail content with overflow: hidden
  assert.match(walletCss, /:is\(#noticeModal, #apcNoticeModal\) \.notice-detail \{[\s\S]*?overflow: visible;/);

  // Verify Student Notice Board card inline «আরও দেখুন» toggle and full untruncated #noticeBoardDetailBody
  const longNotice = {
    id: 'NB-MOBILE-LONG',
    title: 'বার্ষিক পরীক্ষার বিস্তারিত নির্দেশনাবলি ও সময়সূচি ২০২৬',
    body: [
      'প্রিয় শিক্ষার্থীবৃন্দ, আগামী সপ্তাহ থেকে বার্ষিক প্রস্তুতিমূলক পরীক্ষা শুরু হচ্ছে।',
      'প্রতিটি বিষয়ের উত্তরপত্রে রোল নম্বর ও শাখা স্পষ্টভাবে লিখতে হবে।',
      'দীর্ঘ লিংক যাচাই: https://activepluscoaching.example/student-portal/notices/annual-exam-guidelines-2026-full-pdf',
      'সর্বশেষ অনুচ্ছেদ: পরীক্ষার ফলাফল প্রকাশের তারিখ পরবর্তীতে নোটিশ বোর্ডে জানানো হবে।'
    ].join('\n'),
    category: 'exam',
    audience: 'সকল শিক্ষার্থী',
    status: 'published',
    createdAt: '2026-10-22T10:00:00.000Z'
  };
  const ctx = await loadPage('student.html', { seed: {
    [KEYS.account]: JSON.stringify({ username: 'raisa', status: 'active', student }),
    [KEYS.notices]: JSON.stringify([longNotice])
  } });
  t.after(() => ctx.window.close());
  const { initStudentNoticeBoard } = await import(`../js/student-notice-board.js?mobile-long=${Math.random()}`);
  const board = initStudentNoticeBoard({ getStudent: () => student });
  board.refresh();

  const card = ctx.$('#noticeBoardList [data-notice-card^="notice:NB-MOBILE-LONG"]');
  assert.ok(card, 'long notice card rendered');
  const expandBtn = card.querySelector('[data-notice-board-expand]');
  const openBtn = card.querySelector('[data-notice-board-open]');
  assert.equal(expandBtn?.textContent.trim(), 'আরও দেখুন');
  assert.equal(openBtn?.textContent.trim(), 'নোটিশ খুলুন');

  // Toggle inline «আরও দেখুন» without opening detail modal yet
  ctx.click(expandBtn);
  await ctx.flush(2);
  assert.equal(ctx.$('#noticeBoardDetail').hidden, true, 'inline expand keeps card list visible');
  const inlineFull = ctx.$('#noticeBoardList [data-notice-card^="notice:NB-MOBILE-LONG"] .notice-content.notification-body');
  assert.ok(inlineFull, 'inline expanded body uses .notice-content.notification-body');
  assert.match(inlineFull.textContent, /সর্বশেষ অনুচ্ছেদ: পরীক্ষার ফলাফল প্রকাশের তারিখ/);

  // Clicking «নোটিশ খুলুন» opens fixed modal detail with full body on #noticeBoardDetailBody.notice-content.notification-body
  ctx.click(ctx.$('#noticeBoardList [data-notice-card^="notice:NB-MOBILE-LONG"] [data-notice-board-open]'));
  await ctx.flush(4);
  const detailBody = ctx.$('#noticeBoardDetailBody');
  assert.equal(ctx.$('#noticeBoardDetail').hidden, false);
  assert.equal(detailBody.classList.contains('notice-content'), true);
  assert.equal(detailBody.classList.contains('notification-body'), true);
  assert.equal(detailBody.textContent, longNotice.body);
});


