import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadPage } from './jsdom-harness.mjs';

const read = rel => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

test('CSS cascade keeps #apcRegistrationReview .apc-review-details single-column and horizontal on mobile', () => {
  for (const portal of ['admin.html', 'manager.html']) {
    const html = read(portal);
    const hrefs = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"?]+)(?:\?[^"]*)?"/g)].map(m => m[1]);
    assert.ok(hrefs.includes('css/ui-components.css'), `${portal} loads ui-components.css`);
    assert.ok(hrefs.includes('css/ui-features.css'), `${portal} loads ui-features.css`);
    assert.ok(hrefs.includes('css/ui-wallet.css'), `${portal} loads ui-wallet.css`);
    assert.ok(hrefs.indexOf('css/ui-features.css') > hrefs.indexOf('css/ui-components.css'));
    assert.ok(hrefs.indexOf('css/ui-wallet.css') > hrefs.indexOf('css/ui-features.css'));
  }

  const featuresCss = read('css/ui-features.css');
  const walletCss = read('css/ui-wallet.css');

  assert.match(
    featuresCss,
    /\.apc-review-details\{[^}]*grid-template-columns:minmax\(0,1fr\)/,
    'ui-features.css overrides global dl 2-column grid with a single column'
  );
  assert.doesNotMatch(
    featuresCss,
    /\.apc-review-row dd\{[^}]*overflow-wrap:anywhere/,
    'ui-features.css must not force character-by-character overflow-wrap:anywhere on dd'
  );
  assert.match(
    walletCss,
    /#apcRegistrationReview \.apc-review-details\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    'ui-wallet.css locks #apcRegistrationReview .apc-review-details to 1 column'
  );
  assert.match(
    walletCss,
    /#apcRegistrationReview \.apc-review-row dd\s*\{[^}]*word-break:\s*normal;[^}]*overflow-wrap:\s*break-word;[^}]*writing-mode:\s*horizontal-tb/s,
    'review field values always render horizontally without vertical character stacking'
  );
  assert.match(
    walletCss,
    /#apcRegistrationReview \.modal-close\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s,
    'review modal close button meets >=44px touch target'
  );
});

test('Action Center CSS Grid orders pending approvals above filters/empty state and structures push footer', () => {
  const walletCss = read('css/ui-wallet.css');
  assert.match(
    walletCss,
    /:is\(#noticeModal, #apcNoticeModal\) \.apc-pending-host\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*grid-row:\s*3;/s,
    '.apc-pending-host spans full sheet width in row 3 above filters'
  );
  assert.match(
    walletCss,
    /:is\(#noticeModal, #apcNoticeModal\):not\(\[hidden\]\) \.modal:has\(\.apc-pending-host:not\(\.is-empty\)\)\s*\{[^}]*grid-template-rows:\s*auto auto auto auto auto auto;[^}]*overflow-y:\s*auto;/s,
    'Action Center switches to a 6-row scrollable sheet when pending registrations are present'
  );
  assert.match(
    walletCss,
    /:is\(#noticeModal, #apcNoticeModal\) \.modal:has\(\.apc-pending-host:not\(\.is-empty\)\) \.notice-filters\s*\{[^}]*grid-row:\s*4;/s
  );
  assert.match(
    walletCss,
    /:is\(#noticeModal, #apcNoticeModal\) \.modal:has\(\.apc-pending-host:not\(\.is-empty\)\) :is\(#noticeListStudent, \[data-apc-notice-list\]\)\s*\{[^}]*grid-row:\s*5;/s
  );
  assert.match(
    walletCss,
    /:is\(#noticeModal, #apcNoticeModal\) \.modal:has\(\.apc-pending-host:not\(\.is-empty\)\) \[data-apc-notice-push\]\s*\{[^}]*grid-row:\s*6;/s
  );
  assert.match(
    walletCss,
    /:is\(#noticeModal, #apcNoticeModal\) \[data-apc-notice-push\]\s*\{[^}]*display:\s*flex;/s,
    'device notification toggle row uses flex layout so button never wraps mid-sentence'
  );
  assert.match(
    walletCss,
    /\.student-search-clear,\s*\.staff-search-clear,\s*\.manager-search-clear\s*\{[^}]*position:\s*absolute;/s,
    'search clear controls stay out of flex flow so typing never causes layout shift'
  );
});

test('360px Action Center + Student Registration Detail Modal render clean DOM hierarchy, LTR fields, and toggle empty pending host', async () => {
  const dom = new JSDOM('<!doctype html><html lang="bn"><body><button id="notificationButton" type="button">Bell</button></body></html>', {
    url: 'https://apc.example/admin.html',
    pretendToBeVisual: true
  });
  Object.defineProperty(dom.window, 'innerWidth', { value: 360, configurable: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.HTMLElement = dom.window.HTMLElement;

  const { ROSTER_KEY } = await import('../js/office-data.js');
  const { provisionStaff, seedStaffSession } = await import('./staff-harness.mjs');
  await provisionStaff('admin');
  seedStaffSession(dom.window, 'admin');

  dom.window.localStorage.setItem(ROSTER_KEY, JSON.stringify([
    {
      id: '261023001',
      name: 'মোহাম্মদ সাইফ',
      status: 'pending',
      accountStatus: 'pending',
      className: 'দশম শ্রেণি',
      group: 'বিজ্ঞান',
      fatherName: 'আবদুল করিম',
      mobile: '01811980540',
      email: 'saif@example.com',
      guardianMobile: '01711223344',
      address: 'চট্টগ্রাম',
      registeredAt: '2026-10-23T06:00:00.000Z'
    }
  ]));

  const { mountNoticeCenter } = await import('../js/notice-center.js');
  const { openRegistrationReview } = await import('../js/registration-review.js');

  const center = mountNoticeCenter({
    viewer: () => ({ kind: 'staff', role: 'admin' }),
    feed: () => [],
    unreadKeys: () => [],
    records: () => [],
    markRead: () => true,
    clear: () => {},
    pushSupport: async () => ({ supported: true, permission: 'granted', hasVapidKey: false }),
    disable: async () => {},
    enable: async () => {}
  });

  center.open();
  await new Promise(resolve => setTimeout(resolve, 40));

  const modal = dom.window.document.querySelector('#apcNoticeModal .modal');
  assert.ok(modal, 'Action Center modal exists');

  const children = [...modal.children];
  /* The sheet's sticky header is .apc-fb-header (a themed variant of the old
     .modal-header); accept either so the ordering contract stays the point. */
  const idxHeader = children.findIndex(el => el.classList.contains('apc-fb-header') || el.classList.contains('modal-header'));
  const idxStatus = children.findIndex(el => el.hasAttribute('data-apc-notice-status'));
  const idxPending = children.findIndex(el => el.hasAttribute('data-apc-pending-host'));
  const idxFilters = children.findIndex(el => el.classList.contains('notice-filters'));
  const idxList = children.findIndex(el => el.hasAttribute('data-apc-notice-list'));
  const idxPush = children.findIndex(el => el.hasAttribute('data-apc-notice-push'));

  assert.ok(idxHeader >= 0 && idxStatus > idxHeader, 'header precedes read status');
  assert.ok(idxPending > idxStatus && idxPending < idxFilters, 'pending host sits above filter tabs');
  assert.ok(idxFilters < idxList && idxList < idxPush, 'filters precede list and push toggle footer');

  const pendingHost = modal.querySelector('[data-apc-pending-host]');
  assert.equal(pendingHost.classList.contains('is-empty'), false, 'pending host is visible when pending items exist');
  assert.match(pendingHost.textContent, /অনুমোদনের অপেক্ষায়/);
  assert.match(pendingHost.textContent, /গোপন তথ্য/);
  assert.doesNotMatch(pendingHost.textContent, /মোহাম্মদ সাইফ|01811980540|261023001/,
    'the queue masks identity until the review modal is opened');

  const pushCopy = modal.querySelector('[data-apc-notice-push] .notice-push-copy');
  const pushBtn = modal.querySelector('[data-apc-notice-push] .notice-push-btn');
  assert.ok(pushCopy && pushBtn, 'push footer separates copy and button into dedicated flex children');
  assert.equal(pushBtn.textContent.trim(), 'বন্ধ করুন');

  // Open pending student detail modal and verify horizontal definition rows
  const opened = await openRegistrationReview('261023001', { role: 'admin' });
  assert.equal(opened, true);
  const reviewDialog = dom.window.document.getElementById('apcRegistrationReview');
  assert.ok(reviewDialog, 'Registration review dialog opens');

  const rows = [...reviewDialog.querySelectorAll('.apc-review-details > .apc-review-row')];
  assert.ok(rows.length >= 9, 'all populated student fields render as direct .apc-review-row children');
  const map = new Map(rows.map(r => [r.querySelector('dt')?.textContent.trim(), r.querySelector('dd')]));

  assert.equal(map.get('Student ID')?.textContent.trim(), '261023001');
  assert.equal(map.get('Student ID')?.getAttribute('dir'), 'ltr');
  assert.equal(map.get('অবস্থা')?.textContent.trim(), 'অপেক্ষমাণ');
  assert.ok(map.get('অবস্থা')?.querySelector('.apc-review-status-pill.is-pending'));
  assert.equal(map.get('শ্রেণি')?.textContent.trim(), 'দশম শ্রেণি');
  assert.equal(map.get('বিভাগ / গ্রুপ')?.textContent.trim(), 'বিজ্ঞান');
  assert.equal(map.get('পিতার নাম')?.textContent.trim(), 'আবদুল করিম');
  assert.equal(map.get('মোবাইল')?.textContent.trim(), '01811980540');
  assert.equal(map.get('মোবাইল')?.getAttribute('dir'), 'ltr');
  assert.equal(map.get('অভিভাবকের মোবাইল')?.textContent.trim(), '01711223344');
  assert.equal(map.get('অভিভাবকের মোবাইল')?.getAttribute('dir'), 'ltr');

  // Approve from detail modal -> pending host becomes .is-empty automatically on repaint
  reviewDialog.querySelector('[data-review-decision="approved"]').click();
  await new Promise(resolve => setTimeout(resolve, 60));
  center.refresh();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(pendingHost.classList.contains('is-empty'), true, 'pending host marks is-empty once queue reaches zero');

  dom.window.close();
});

test('Admin UX: Home keeps only approval; staff, backup and reports remain reachable in their own screens', async () => {
  const { ROSTER_KEY } = await import('../js/office-data.js');
  const { provisionStaff, seedStaffSession } = await import('./staff-harness.mjs');
  const ctx = await loadPage('admin.html', {
    viewport: { width: 360, height: 740 },
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [ROSTER_KEY]: JSON.stringify([
        { id: '261023009', name: 'সাদিয়া ইসলাম', status: 'pending', className: 'নবম শ্রেণি', group: 'বিজ্ঞান', mobile: '01711223344' }
      ])
    }
  });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);
  await ctx.waitFor(() => ctx.$$('#staffList .staff-card').length >= 4);

  // Five-item bottom nav with standardised "স্টাফ" spelling
  const navLabels = ctx.$$('.admin-bottom .nav-label').map(n => n.textContent.trim());
  assert.deepEqual(navLabels, ['হোম', 'স্টাফ', 'রিপোর্ট', 'সিস্টেম', 'আরও']);

  // The sole Home work tile opens registration approval; the five duplicate
  // shortcuts are gone, not the workflows or their own navigation routes.
  const regTile = ctx.$('#adminFeatureGrid [data-admin-view="students"]');
  assert.ok(regTile);
  assert.match(regTile.textContent, /নিবন্ধন অনুমোদন/);
  assert.match(regTile.querySelector('.admin-feature-pending-pill')?.textContent || '', /১ জন অপেক্ষমাণ/);
  assert.equal(ctx.$('#adminQuickShortcuts'), null);
  assert.equal(ctx.$('.admin-view[data-view-panel="dashboard"] .teacher-chat-hub'), null);
  assert.ok(ctx.$('.admin-view[data-view-panel="more"] [data-admin-view="phonebook"]'));

  // The Staff tab opens the directory immediately, with search clear + empty CTA.
  ctx.click(ctx.$('.admin-bottom [data-admin-view="staff"]'));
  await ctx.flush();
  assert.equal(ctx.$('.admin-view[data-view-panel="staff"]').classList.contains('active'), true);
  assert.equal(ctx.$('[data-admin-section-panel="staff-directory"]').hidden, false, 'staff directory opens from its tab');
  assert.equal(ctx.$('#staffSearchClear').hidden, true);
  ctx.type(ctx.$('#staffSearch'), 'nonexistent-xyz');
  assert.equal(ctx.$('#staffSearchClear').hidden, false, 'typing in staff search reveals clear button');
  assert.ok(ctx.$('#staffList .apc-empty-state [data-staff-action="reset-filters"]'), 'empty staff search offers reset CTA');
  ctx.click(ctx.$('#staffList [data-staff-action="reset-filters"]'));
  assert.equal(ctx.$('#staffSearch').value, '');
  assert.equal(ctx.$('#staffSearchClear').hidden, true);

  // Backup remains available from More → Data → Backup, not duplicated on Home.
  ctx.click(ctx.$('.admin-bottom [data-admin-view="more"]'));
  await ctx.flush();
  ctx.click(ctx.$('#adminMoreMenu [data-admin-view="data"]'));
  await ctx.flush();
  ctx.click(ctx.$('#adminDataMenu [data-admin-view="backup"]'));
  await ctx.flush();
  assert.equal(ctx.$('.admin-view[data-view-panel="backup"]').classList.contains('active'), true);
  assert.ok(ctx.$('#backupExportButton'));

  // Reports tab still opens its builder immediately.
  ctx.click(ctx.$('.admin-bottom [data-admin-view="reports"]'));
  await ctx.flush();
  assert.equal(ctx.$('.admin-view[data-view-panel="reports"]').classList.contains('active'), true);
  assert.equal(ctx.$('[data-admin-section-panel="reports-builder"]').hidden, false, 'report builder opens from its tab');

  // One-tap Registration Approval tile opens Students view with directory & pending queue visible + student empty reset CTA
  ctx.click(ctx.$('.admin-bottom [data-admin-view="dashboard"]'));
  await ctx.flush();
  ctx.click(regTile);
  await ctx.flush();
  assert.equal(ctx.$('#adminPendingRegistrations').hidden, false);
  assert.equal(ctx.$('#adminStudentsDirectoryPanel').hidden, false);
  ctx.type(ctx.$('#studentSearch'), 'nobody-999999');
  assert.equal(ctx.$('#studentSearchClear').hidden, false);
  assert.ok(ctx.$('#studentList .apc-empty-state [data-action="reset-student-filters"]'));
  ctx.click(ctx.$('#studentList [data-action="reset-student-filters"]'));
  assert.equal(ctx.$('#studentSearch').value, '');
  assert.equal(ctx.$('#studentSearchClear').hidden, true);

  ctx.window.close();
});
