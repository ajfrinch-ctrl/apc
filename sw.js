// v172: Admin app architecture — the bottom bar is হোম/স্টাফ/রিপোর্ট/সিস্টেম/ডেটা/অ্যাকাউন্ট and the old More
//       menu became two hubs (সিস্টেম → roles/security/settings/academics; ডেটা → data management +
//       backup). Student registration review moved to a হোম tile: Admin decides on a registration,
//       never creates a student account.
// v171: Cash Counter app architecture — the bottom bar is হোম/শিক্ষার্থী/পেমেন্ট/রিপোর্ট/আরও and each seat owns
//       one step of the counter's job (search → entry → verify → receipt → daily collection → history).
//       The narrowed counter stays narrow: identity-only search, no roster/dues/profile, no dashboard
//       tiles; every figure still comes from the one ledger.
// v170: Manager app architecture — the bottom bar is হোম/শিক্ষার্থী/একাডেমিক/হিসাব/রিপোর্ট/আরও; শিক্ষার্থী owns the
//       whole lifecycle (নিবন্ধন অপেক্ষমাণ · সক্রিয় · নিষ্ক্রিয় + approve/reject/edit/activate/deactivate/password
//       reset), একাডেমিক is one hub over the eight academic sections + teacher management, হিসাব owns
//       collection/approval/due/history over the same ledger, and a Manager notice is class/batch-scoped.
// v169: Teacher app architecture — the bottom bar is হোম/একাডেমিক/রুটিন/ফলাফল/আরও; একাডেমিক is one hub
//       (বাড়ির কাজ / সাজেশন / প্রশ্নব্যাংক / উপকরণ / পরীক্ষা / নোটিশ) over the existing screens, Home carries
//       the four create actions, and a Teacher notice is class/batch-scoped while Notice stays a notice.
// v168: Student app architecture — the bottom bar is হোম/পড়াশোনা/রুটিন/পরীক্ষা/আরও, পড়াশোনা owns five
//       sections (আমার কোর্স / বাড়ির কাজ / সাজেশন / প্রশ্নব্যাংক / উপকরণ), ফলাফল is a tab of পরীক্ষা,
//       আরও owns প্রোফাইল/রিপোর্ট/নোটিফিকেশন/ফি(read-only)/সেটিংস/সহায়তা, and Home previews the latest notices.
// v167: sync status is colour only — the topbar's own top border (green/amber/red/grey); the standing chip and retry banner are gone.
// v166: treat an absent cloud collection as empty only after a device has a durable record view.
// v165: keep the cohort retry average as a privacy-safe aggregate in the Student exam snapshot.
// v164: cache the authenticated Student access gate so exam, finance and teaching reads still work offline.
// v163: MCQ answer PDFs download only after an explicit student click; exam completion no longer triggers extra background downloads.
// v162: Course Hub adds nine chapter-specific study actions with chapter-filtered MCQ practice, written drills, model tests and chapter results.
// v161: student notices get a separate categorized Notice Board with explicit Read ✓ receipts.
// v159: student topbar brand now stacks the institute name and slogan; the Home exam banner spans both desktop columns; acknowledged notices no longer replay as login popups.
// v156: practice sheets now run under a live timer like the real sitting — the past paper keeps its original window, a random drill gets two minutes a question; at zero the paper submits itself and the result appears.
// v155: instant MCQ practice — নিজে নিজে যেকোনো মুহূর্তে MCQ অনুশীলন (সময়সীমা/সময়সূচি ছাড়া, তাৎক্ষণিক ফলাফল); প্রতিটি নেওয়া MCQ পরীক্ষা এখন নিজে থেকে প্রশ্নব্যাংকে সংরক্ষিত হয় যাতে ভবিষ্যতে পরীক্ষার্থীগুলো অনুশীলন করতে পারে।
// v154: topbar প্যানেল-নাম সব ৫ পোর্টালেই বাদ (লোগো + স্লোগান মাত্র); app-brand-name CSS নিষ্ক্রিয় হওয়ায় মুছেছে।
// v153: student/admin/teacher topbar — panel name removed (logo + slogan only; manager ও payment-এ name থাকছে)।
// v152: row/line spacing fixes — hero band now covers the full hero (white text safe in light mode) and the summary card straddles its edge; exam workspace rows keep one even grid gap (no dead space); chip rows stop double-spacing.
// v151: notification settings fixed to live inside the profile view of the
// Manager and Teacher panels (they previously rendered outside every view,
// visible at the bottom of all pages). v150: student home — আজকের অনুপ্রেরণা (a deterministic daily quote card
// between today's classes and the quick menu) with its offline feed cached in
// the shell. v149: examination identity + question bank — permanent Exam Codes
// (M2608BN01), seeded paper order, প্রণ্ন সংরক্ষণ করুন shelf, per-student and
// answer-key PDFs, the student Learning Hub (class → subject → chapter) and the
// shared brand module. v148: date-wise examination workspace — question
// archive, review workflow and question-level editing for the Manager.
const CACHE_VERSION = 172;
const CACHE_NAME = `active-plus-student-v${CACHE_VERSION}-minimal-education`;
const APP_SHELL = [
  './css/notifications.css',
  './css/academics.css',
  './css/course-hub.css',
  './css/exam-archive.css',
  './css/app-polish.css',
  './css/student-record.css',
  './css/ui-wallet.css',
  './js/student-record.js',
  './sync/cloud-access.js',
  './js/app-entry.js',
  './css/ui-auth.css',
  './js/launch-screen.js',
  './js/topbar-connectivity.js',
  './js/status-surface.js',
  './js/ui-accessibility.js',
  './js/print-tokens.js',
  './css/ui-status.css',
  './js/icons.js',
  './js/icon-set.js',
  './css/design-system.css',
  './css/foundation.css',
  './css/ui-layout.css',
  './css/ui-components.css',
  './css/ui-forms.css',
  './css/ui-features.css',
  './css/notice-board.css',

  './js/panel-lockdown.js',
  './firebase/firebase-config.js',
  './firebase/firebase-init.js',
  './firebase/firebase-services.js',
  './sync/sync-core.js',
  './sync/sync-config.js',
  './sync/sync-auth.js',
  './sync/cloud-auth.js',
  './js/registration-review.js',
  './sync/sync-queue.js',
  './sync/sync-retry.js',
  './sync/sync-status.js',
  './sync/sync-guard.js',
  './js/firebase-config.js',
  './js/firebase-online-test.js',
  './js/firebase-diagnostic-ui.js',
  './js/firebase-diagnostics.js',
  './js/realtime-sync-entry.js',
  './js/realtime-sync.js',
  './js/sync-session.js',
  './js/sync-status.js',
  './js/record-sync.js',
  './js/sync-merge.js',
  './js/sync-collections.js',
  './js/realtime-value-codec.js',
  './js/student-search.js',
  './js/rtdb-keys.js',
  './js/username-sync-codec.js',
  './js/notification-rules.js',
  './js/notifications.js',
  './js/push-notifications.js',
  './offline-roles.html',
  './js/offline-role-store.js',
  './js/offline-role-demo.js',
  './js/offline-role-ui.js',
  './',
  './index.html',
  './admin.html',
  './manager.html',
  './teacher.html',
  './payment.html',
  './js/pull-to-refresh.js',
  './manifest.json',
  './favicon.ico',
  './assets/icons/logo-128.png',
  './assets/icons/logo-128-dark.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-192.png',
  './assets/icons/maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/app-logo.png',
  './js/appearance.js',
  './js/appearance-boot.js',
  './js/theme-logos.js',
  './js/copy.js',
  './js/payment-auth.js',
  './js/counter-data.js',
  './js/counter-privacy.js',
  './js/counter-report-data.js',
  './js/counter-reports.js',
  './js/theme-entry.js',
  './assets/fonts/NotoSansBengali-Variable.ttf',
  './js/config.js',
  './js/student-access.js',
  './js/password-hash.js',
  './js/secure-store.js',
  './js/session.js',
  './js/sanitize.js',
  './js/sanitize-url.js',
  './js/staff-password-dialog.js',
  './js/notification-store.js',
  './js/notification-settings.js',
  './js/academics.js',
  './js/brand.js',
  './js/admin-academics.js',
  './js/exam-data.js',
  './js/exam-ui.js',
  './js/exam-core.js',
  './js/question-bank.js',
  './js/course-content.js',
  './js/course-hub.js',
  './js/student-study-sections.js',
  './js/student-more.js',
  './js/course-editor.js',
  './js/daily-quote.js',
  './assets/daily-quotes.json',
  './js/exam-manager.js',
  './js/exam-archive.js',
  './js/exam-pdf.js',
  './js/material-pdf.js',
  './js/student-exams.js',
  './js/student-practice.js',
  './js/student-dashboard.js',
  './js/account-policy.js',
  './js/storage.js',
  './js/ui.js',
  './js/shell.js',
  './js/routine.js',
  './js/profile.js',
  './js/login.js',
  './js/staff-auth.js',
  './js/database.js',
  './js/register.js',
  './js/recovery.js',
  './js/logout.js',
  './js/navigation.js',
  './js/notice-center.js',
  './js/install.js',
  './js/connectivity.js',
  './js/service-worker.js',
  './js/theme.js',
  './js/fixed-shell.js',
  './js/main.js',
  './js/panel-route.js',
  './js/admin.js',
  './js/manager.js',
  './js/payment.js',
  './js/teacher.js',
  './js/teaching-data.js',
  './js/teacher-assignments.js',
  './js/student-teaching.js',
  './js/student-notice-board.js',
  './js/admin-data.js',
  './js/office-data.js',
  './js/finance-data.js',
  './js/finance-receipt.js',
  './js/reports.js',
  './js/report-layout.js',
  './js/report-catalog.js',
  './js/report-access.js',
  './js/report-builders.js',
  './js/report-sources.js',
  './js/admin-permissions.js',
  './js/admin-icons.js',
  './js/admin-panel-ui.js',
  './js/staff-directory.js',
  './js/staff-management.js',
  './js/user-id.js',
  './js/storage/migration.js'
];

/* Panel lockdown (js/panel-lockdown.js). This device's own panel is the only
   page a tapped notification may open: with no window in sight the worker reads
   the hint the panel left here. Never a hard-coded page, never another panel. */
const PANEL_HINT_CACHE = 'apc-panel-hint';
const PANEL_HINT_PATH = './__apc-last-panel';
const PANEL_PAGES = ['admin.html', 'manager.html', 'teacher.html', 'payment.html'];
const APP_ENTRY = './index.html';

/* Served when an offline navigation is not in the cache. It stays on the page
   the person asked for — the old fallback handed an offline Admin the student
   app, which is exactly the cross-panel jump the panels now close. */
const OFFLINE_DOCUMENT = `<!DOCTYPE html>
<html lang="bn"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>অফলাইন — Active Plus</title>
<style>body{margin:0;padding:24px;font:14px/1.8 'Noto Sans Bengali',system-ui,sans-serif;background:#f4f6fb;color:#14203c}
.card{max-width:420px;margin:10vh auto 0;padding:20px;border:1px solid #dbe2ec;border-radius:18px;background:#fff;box-shadow:0 10px 30px rgba(9,22,51,.08)}
h1{font-size:17px;margin:6px 0 8px}p{margin:0 0 12px}.eyebrow{margin:0;font-size:11px;letter-spacing:.04em;color:#7a869c}
button{padding:11px 14px;border:1px solid #315efb;border-radius:12px;background:#315efb;color:#fff;font:inherit;font-size:13px}</style>
</head><body><section class="card">
<p class="eyebrow">সংযোগ নেই</p>
<h1>এই পাতাটি এখন ক্যাশে নেই</h1>
<p>ইন্টারনেট সংযোগ ফিরে এলে আবার চেষ্টা করুন। এই ডিভাইসের নিজের ডেটা নিরাপদে আছে।</p>
<button onclick="location.reload()">আবার চেষ্টা করুন</button>
</section></body></html>`;

async function cachedResponse(request) {
  const exact = await caches.match(request);
  if (exact) return exact;
  try {
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return null;
    return (await caches.match(url.pathname)) || null;   // ignore a ?v= cache-buster
  } catch { return null; }
}

async function panelHintTarget() {
  try {
    const cache = await caches.open(PANEL_HINT_CACHE);
    const response = await cache.match(PANEL_HINT_PATH);
    if (!response) return '';
    const file = (await response.text()).trim().toLowerCase();
    return PANEL_PAGES.includes(file) ? `./${file}` : '';
  } catch { return ''; }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Load-speed strategy (the old network-first for EVERYTHING meant a slow
// network throttled even a fully cached app):
//   • navigations — network-first with a hard ceiling: fresh HTML when the
//     network answers quickly, the cached page instead of a hanging white
//     screen when it crawls, the offline card only when neither exists.
//   • static assets WITHOUT a query string — cache-first. One CACHE_NAME is
//     always one consistent file set (the name bumps with every change set
//     and activate() deletes the rest), so the cached copy is instant AND
//     coherent — no mixed old/new modules.
//   • URLs WITH a ?v= query (version-pinned module imports) — network-first
//     as before: a new build must never receive last build's file under a
//     new name.
//   • cross-origin CORS GETs (the immutable Firebase SDK on gstatic) — also
//     cache-first, so repeat visits skip that download entirely.
const NAV_TIMEOUT_MS = 2500;

function timedFetch(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('nav-timeout')), NAV_TIMEOUT_MS);
    // The real fetch keeps running past the ceiling; its result simply lands
    // too late to be used, so nothing half-written is ever cached here.
    fetch(request).then(
      response => { clearTimeout(timer); resolve(response); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

function cacheable(response) {
  return response && response.status === 200
    && (response.type === 'basic' || response.type === 'cors');
}

function remember(request, response) {
  const copy = response.clone();
  caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await timedFetch(event.request);
        if (cacheable(response)) remember(event.request, response);
        return response;
      } catch (error) {
        const cached = await cachedResponse(event.request);
        if (cached) return cached;
        return new Response(OFFLINE_DOCUMENT, {
          status: 503, statusText: 'Offline',
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      }
    })());
    return;
  }

  let hasQuery = false;
  try { hasQuery = new URL(event.request.url).search.length > 0; } catch { /* treat as plain */ }

  if (!hasQuery) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (cacheable(response)) remember(event.request, response);
        return response;
      } catch (error) {
        return (await cachedResponse(event.request))
          || new Response('', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  event.respondWith(
    fetch(event.request).then(response => {
      if (cacheable(response)) remember(event.request, response);
      return response;
    }).catch(async () =>
      (await cachedResponse(event.request))
      || new Response('', { status: 503, statusText: 'Offline' }))
  );
});

/* A tapped notification brings the app forward (notifications raised by the
   page itself, e.g. a notice that arrived while a tab stayed open). With no
   window open it opens the device's own panel — the hint a panel left here —
   and only falls back to the app door, never to a hard-coded page. */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if ('focus' in client) {
        client.postMessage({ type: 'apc-notification-click', data: event.notification?.data || {} });
        return client.focus();
      }
    }
    // No window yet: leave the tapped payload for the page (js/notifications.js
    // picks it up once), so e.g. a registration opens straight into review.
    try {
      const cache = await caches.open(PANEL_HINT_CACHE);
      await cache.put('./__apc-pending-click', new Response(JSON.stringify({
        at: Date.now(), data: event.notification?.data || {}
      }), { headers: { 'content-type': 'application/json' } }));
    } catch { /* the app still opens */ }
    const target = (await panelHintTarget()) || APP_ENTRY;
    return self.clients.openWindow(target);
  })());
});
