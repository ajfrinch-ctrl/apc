// v432: Passphrase-protected new backups and isolated preview cloud access; production sync configuration unchanged.
// v431: Admin More and System primary actions open routed full-screen details with browser Back/Forward.
// v430: Privacy-mask primary lists + isolate More view keeps welcome/date/advice, registration review and staff-portal doors; retires redundant tiles, stats, warnings and artwork.
// v428: Full-Screen Word-Style Lecture Sheet Editor & PDF Studio across Admin, Teacher, Manager & Student panels with A4 pagination, Bangla typography, equations, offline recovery & E2EE sync.
// v427: Yellow Pages Phonebook (ফোনবুক · ইয়েলো পেইজ) in Admin & Manager panels with class-grouped student/guardian contacts, staff directory, direct calling & Bengali WhatsApp templates.
// v426: mobile 4G First-Admin verification resiliency, lazy Firebase Secondary SDK import, and authoritative Supabase Primary admin gate.
// v425: defer cache-refresh SW registration until after load and throttle precache concurrency so mobile links paint immediately.
// v424: auto-reload open tabs migrating from legacy pre-minimal-education Service Workers (e.g. v53).
// v397: Teacher — একাডেমিক কার্যক্রম moved out of the ক্লাস screen into its own Home feature card
// (accent rail, artwork disc, what-is-inside line); ক্লাস now has two tabs (ক্লাস ও বিষয়,
// রুটিন ও সময়সূচি) and the academic screen names itself after the feature; pin refresh.
// v396: Teacher ক্লাস — 'ক্লাস ও বিষয়', 'রুটিন ও সময়সূচি' and 'একাডেমিক কার্যক্রম' are now three
// separate tabs (the two doors that shared one grid are gone), with the class list in the first
// tab panel; pin refresh.
// v395: Teacher ক্লাস — every class is one collapsed disclosure row (name, group, subject and
// student counts); subjects and the class-work action open only on tap, and the two class doors
// shrink to compact rows so no primary information lies open; pin refresh.
// v394: Teacher ক্লাস / পরীক্ষা / আরও seats redesigned in the scoped Tailwind sheet — door cards for
// the class menu and class rows, one primary + one quiet action and 2×2 exam doors, and a single
// grouped settings list in আরও; same routes, ids and classes; pin refresh.
// v393: Teacher hero artwork redesigned as a matched day/night pair with no sun or moon in the
// scene — the card's day/night chip is now the single celestial marker (two suns showed before);
// the picture card's scrim is lighter so the brighter scene still reads; pin refresh.
// v392: Teacher panel rewritten on Tailwind — the compiled, .teacher-reference-scoped sheet
// (css/teacher-panel.css) replaces the 1,300-line inline block, and the Home hero is now the
// day/night classroom picture itself with the greeting and daily line laid over it (no card
// behind the image); pin refresh for the rebuilt teacher assets.
// v391: Teacher hero — the warm line is now a daily rotating piece of Bangla teaching advice
// (new offline teacher-daily-advice module, deterministic per Dhaka day, no storage/network); pin refresh.
// v390: Teacher hero — remove the time-of-day greeting ("শুভ অপরাহ্ন!") and the "শিক্ষক প্যানেল"
// subline from the home identity strip; avatar initial and day/night glint stay; pin refresh.
// v389: Teacher panel — remove the student list screen and its bottom-nav seat entirely (surface
// removal only; student data still drives attendance, homework review and class cards); pin refresh.
// v388: Teacher home — replace the 3×2 pay-tile grid with mobile-first full-width hero action
// cards (homework, suggestion, one-tap quick MCQ, read-only routine) plus secondary chips; pin refresh.
// v387: Teacher home — remove the non-actionable daily-work prompt card ("আপনার আজকের কাজগুলো…")
// entirely from Home (markup, styles and tests); pin refresh for the rebuilt teacher assets.
// v386: Teacher hero — fold greeting and welcome into one tidy text stack by dropping the hard
// divider (uniform flex spacing), keeping the clean flat gradient and clear page background; pin refresh.
// v385: Teacher hero — clear the background behind the card (remove the panel ambient wash and the
// in-card glow blobs) for a clean flat gradient surface, and tighten the on-card text rhythm; pin refresh.
// v384: Teacher hero — move the daily-work prompt ("আপনার আজকের কাজগুলো…") out of the gradient
// welcome card into its own standalone glass card directly below it; pin refresh for teacher assets.
// v383: Teacher hero — remove the role/teacher-id identity sub-card from the welcome card (the
// role and id stay on the "আমার প্রোফাইল" screen); pin refresh for the rebuilt teacher assets.
// v382: Teacher panel visual refresh — AI day/night hero artwork with gentle motion inside the
// welcome card, panel-wide ambient atmosphere and cohesive hover/entrance elevation; pin refresh.
// v381: Teacher Home hero redesign — organised zones (greeting strip with day/night glint,
// divider, welcome title, and the daily-task prompt); cache pin refresh.
// v380: Teacher panel door consolidation — creation centred in the কাজ দিন hub, Home tiles open screens only,
// আরও reduced to reports/settings, and homework uses the shared standard modal; cache pin refresh for the rebuilt teacher assets.
// v379: cross-device notification read receipts; preserve them in the synced settings collection.
// v378: Student Home reference-match shortcut sizing, violet active tab, and Dhaka-clock greeting/art.
// v376: staggered Student icon motion, time-of-day greetings, and eased truthful progress.
// v373: motion-aware, offline hero-card illustrations for the current Student Home layout.
// v372: Student Home daily advice, focused progress metrics, and scannable routine status.
// v370: less empty Student mobile hero cards with more room for local artwork.
// v368: resilient early login password visibility toggle and accessible state feedback.
// v363: shared Dhaka-time advice bank, accessible home carousel, semantic skin, and role navigation polish.
// v356: dashboard heroes use a colorful, high-contrast gradient and distinct readable metric cards.
// v352: Admin Staff Management adds sorting, secure card details and a three-step create flow.
// v350: Manager student cards are compact disclosures; pending applications live only in the review queue.
// v349: Admin Dashboard Quick Access spans the grid at every viewport, with its icon above the label.
// v348: Staff cards start compact; the inline disclosure opens one selected person's extra details on demand.
// v347: Staff Management action menus reset on navigation/filters; the Profile hero no longer repeats name, login, role or the full staff directory.
// v251: the home homework tile opens the existing assignment form in one tap;
//       its class/subject/status fields, store and save path remain unchanged.
// v250: the Teacher name is also visible in the responsive topbar identity slot;
//       the hero still greets the same profile name, and the other panel headers stay unchanged.
// v178: the teacher's ফলাফল seat is alive again — Phase 2 added the seat with the value
//       'exam' but never registered that view, so both the seat and the home "নম্বর" tile did
//       nothing in a real browser. The seat now opens the documented marks screen (with its
//       online-exam hint), the academic hub card remains the door to the exam workspace, and
//       the browser suite can run in this offline sandbox via `npm run test:e2e:local`.
// v177: the dead-reference cleanup finished — the unused named imports the redesign left behind
//       (retired finance tiles, the old manager/teacher helpers) are gone too, so no module holds
//       a reference to something it never used. v176: the last two dead calls the static scanner found in the Admin panel (the retired
//       finance renderer on the student-edit path and the transaction reload after a data
//       wipe) are gone, and `tools/undefined-call-check.mjs` now guards every module in
//       js/ against calling a name it never imported or declared.
// v175: retired-markup cleanup — every module that still wrote to a control the redesign
//       had removed (Admin's old finance tiles, ledger and receipt viewer; the student topbar
//       clock/date strip and daily-advice line; the dead staff stat tiles, manager short name,
//       teacher records back bar and the text-based connection pill with its own module) is
//       pruned. Nothing that renders changed: the app shell just stopped shipping code that
//       could never find its element, so no page can grow a second interface again.
// v174: Report Center final sweep — one empty-state wording for every role ("কোনো তথ্য পাওয়া যায়নি।",
//       defined once in js/report-catalog.js and used by the preview, the PDF and the counter), the
//       empty message now stands above the page instead of leaving a blank sheet, and the Academic
//       family gained the Suggestion Report (সাজেশন — learning, status, chapter, class) beside the
//       assignment/attendance reports.
// v173: one Settings structure for every role — অ্যাকাউন্ট · নোটিফিকেশন · অ্যাপ · নিরাপত্তা · ডেটা.
//       The Student আরও→সেটিংস, the Teacher/Manager profile page, the Admin অ্যাকাউন্ট seat and the
//       Cash Counter's আরও all render the same five groups (js/settings-hub.js); a group's internals
//       stay with the module that owns that work, an existing control is never duplicated, and the
//       counter's theme switch is the same one switch the other panels already had.
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
// v179: the Admin Account is a GLOBAL, one-time account — a new device asks the cloud
//       before it offers anything. The startup gate now reads the cloud's Admin state
//       (staffAccounts/admin plus the system/adminInitialized marker), so a phone with
//       an empty localStorage sees the Login screen instead of "Create Admin Account";
//       creation is a single atomic claim that a second device can only lose, and a
//       device that cannot verify the cloud never creates an Admin at all.
// v181: precache the Admin-only Staff Management stylesheet.
// v182: precache the authenticated Question Bank V2 sync modules.
// v183: precache the Admin V2 staged-cutover migration console.
// v271: one-time password dialogs survive their async save (captured button);
//       profile edits accept an empty group; teacher exams hub opens the
//       workspace home; footer labels fit 320px phones.
// v270: docs pass — README rebuilt to the real file tree; payment-auth header
//       comment now matches the shared-login truth.
// v269: PWA manifest — white canvas + green primary theme color, unlocked
//       orientation; theme-color meta follows the manifest on every page.
// v268: security review — password reset policy module + off-main-thread PBKDF2 core
//       (demo/ offline-role workspace moved out of the production shell).
// v267: pin the practice timer bar like the official MCQ exam — the clock stays fixed at the top in every timed sheet.
// v255: extend the Teacher home's blue hero to match the other portal homes.
// v254: refresh the Teacher hero's complete greeting and note colour.
// v253: keep the Teacher home greeting on its hero band when account names wrap.
// v252: refresh the official MCQ exam screen's pinned timer-bar styles.
// v296: staged Firestore role/financial rules; local shell remains unchanged.
// v313: login missing account says only «account not found» — no cloud narration.
// v312: Admin panel-wide design — subtitled heroes, chevron hub rows, styled audit/roles surfaces.
// v311: Admin data design — count pills, quiet storage footer, one marked danger zone.
// v310: Admin staff design — Bengali card actions, role-toned tags, protected/inactive card states.
// v309: Admin dashboard design — token backup banner, toned snapshot tiles, wide quick-access row.
// v308: Admin profile design — identity hero, styled detail grid, aligned account forms.
// v307: Dhaka-midnight notification regression coverage; no runtime sync cutover.
// v306: dev-only preview RTDB guard; never fall back to production on preview.
// v305: read-only multi-backup ledger comparison; no browser cutover.
// v304: offline ledger migration preflight only; no browser cutover.
// v303: bounded Admin-only reconciliation read staging; no browser cutover.
// v302: two-role accounting correction staging; no browser cutover.
// v301: server-owned fee projection and pending Counter receipts; no browser cutover.
// v300: verified Student enrollment + Manager review staging; no browser cutover.
// v299: staged Student exam attempt + release lock; no browser cutover.
// v298: server-only MCQ submission staging; browser cache keeps local mode intact.
// v297: opt-in, emulator-only Firestore read gateway (no local data cutover).
// v295: Firebase opt-in panel gate and trusted first-Admin bootstrap staging.
// v294: Firebase backend selector and pure Auth role-claim policy offline.
// v293: same-origin Firebase SDK bundle, dev/prod config and Firebase API cache bypass.
const CACHE_VERSION = 432;
const CACHE_NAME = `active-plus-student-v${CACHE_VERSION}-minimal-education`;
const APP_SHELL = [
  './assets/icons/ai-3d/class-materials.svg',
  './assets/icons/ai-3d/class-notes.svg',
  './assets/icons/ai-3d/class-other.svg',
  './assets/icons/ai-3d/class-record.svg',
  './assets/icons/ai-3d/class-subjects.svg',
  './assets/icons/ai-3d/class-today.svg',
  './assets/icons/ai-3d/class-upcoming.svg',
  './assets/icons/ai-3d/contact-office.svg',
  './assets/icons/ai-3d/exam-bank.svg',
  './assets/icons/ai-3d/exam-create.svg',
  './assets/icons/ai-3d/exam-done.svg',
  './assets/icons/ai-3d/exam-instant.svg',
  './assets/icons/ai-3d/exam-live.svg',
  './assets/icons/ai-3d/exam-other.svg',
  './assets/icons/ai-3d/exam-practice.svg',
  './assets/icons/ai-3d/exam-recent.svg',
  './assets/icons/ai-3d/exam-upcoming.svg',
  './assets/icons/ai-3d/inactive-user.svg',
  './assets/icons/ai-3d/marks-entry.svg',
  './assets/icons/ai-3d/materials.svg',
  './assets/icons/ai-3d/model-test.svg',
  './assets/icons/ai-3d/notification-settings.svg',
  './assets/icons/ai-3d/offline-data.svg',
  './assets/icons/ai-3d/pending-user.svg',
  './assets/icons/ai-3d/practice.svg',
  './assets/icons/ai-3d/profile-edit.svg',
  './assets/icons/ai-3d/rejected-user.svg',
  './assets/icons/ai-3d/routine-changed.svg',
  './assets/icons/ai-3d/routine-exam.svg',
  './assets/icons/ai-3d/routine-holiday.svg',
  './assets/icons/ai-3d/routine-important.svg',
  './assets/icons/ai-3d/routine-other.svg',
  './assets/icons/ai-3d/routine-today.svg',
  './assets/icons/ai-3d/routine-tomorrow.svg',
  './assets/icons/ai-3d/routine-weekly.svg',
  './assets/icons/ai-3d/study-other.svg',
  './assets/icons/ai-3d/suggestion.svg',

  './assets/icons/ai-3d/camera.svg',
  './assets/icons/ai-3d/add.svg',
  './assets/icons/ai-3d/approval.svg',
  './assets/icons/ai-3d/assignment.svg',
  './assets/icons/ai-3d/attendance.svg',
  './assets/icons/ai-3d/back.svg',
  './assets/icons/ai-3d/backup.svg',
  './assets/icons/ai-3d/bell.svg',
  './assets/icons/ai-3d/bolt.svg',
  './assets/icons/ai-3d/book.svg',
  './assets/icons/ai-3d/calendar.svg',
  './assets/icons/ai-3d/chat.svg',
  './assets/icons/ai-3d/check.svg',
  './assets/icons/ai-3d/chevron-down.svg',
  './assets/icons/ai-3d/classes.svg',
  './assets/icons/ai-3d/clock.svg',
  './assets/icons/ai-3d/close.svg',
  './assets/icons/ai-3d/copy.svg',
  './assets/icons/ai-3d/dashboard.svg',
  './assets/icons/ai-3d/data.svg',
  './assets/icons/ai-3d/delete.svg',
  './assets/icons/ai-3d/download.svg',
  './assets/icons/ai-3d/edit.svg',
  './assets/icons/ai-3d/exam.svg',
  './assets/icons/ai-3d/exam.png',
  './assets/icons/ai-3d/book.png',
  './assets/icons/ai-3d/calendar.png',
  './assets/icons/ai-3d/wallet.png',
  './assets/icons/ai-3d/approvals.svg',
  './assets/icons/ai-3d/verified.svg',
  './assets/icons/ai-3d/courses.svg',
  './assets/icons/ai-3d/homework.svg',
  './assets/icons/ai-3d/question-bank.svg',
  './assets/icons/ai-3d/eye.svg',
  './assets/icons/ai-3d/filter.svg',
  './assets/icons/ai-3d/fingerprint.svg',
  './assets/icons/ai-3d/help.svg',
  './assets/icons/ai-3d/home.svg',
  './assets/icons/ai-3d/info.svg',
  './assets/icons/ai-3d/key.svg',
  './assets/icons/ai-3d/lock.svg',
  './assets/icons/ai-3d/logout.svg',
  './assets/icons/ai-3d/mail.svg',
  './assets/icons/ai-3d/mcq.svg',
  './assets/icons/ai-3d/menu.svg',
  './assets/icons/ai-3d/moon.svg',
  './assets/icons/ai-3d/more.svg',
  './assets/icons/ai-3d/next.svg',
  './assets/icons/ai-3d/notice.svg',
  './assets/icons/ai-3d/offline.svg',
  './assets/icons/ai-3d/online.svg',
  './assets/icons/ai-3d/pause.svg',
  './assets/icons/ai-3d/phone.svg',
  './assets/icons/ai-3d/play.svg',
  './assets/icons/ai-3d/print.svg',
  './assets/icons/ai-3d/receipt.svg',
  './assets/icons/ai-3d/reports.svg',
  './assets/icons/ai-3d/result.svg',
  './assets/icons/ai-3d/roles.svg',
  './assets/icons/ai-3d/save.svg',
  './assets/icons/ai-3d/search.svg',
  './assets/icons/ai-3d/settings.svg',
  './assets/icons/ai-3d/shield.svg',
  './assets/icons/ai-3d/smartphone.svg',
  './assets/icons/ai-3d/staff.svg',
  './assets/icons/ai-3d/students.svg',
  './assets/icons/ai-3d/sun.svg',
  './assets/icons/ai-3d/sync.svg',
  './assets/icons/ai-3d/teacher.svg',
  './assets/icons/ai-3d/upload.svg',
  './assets/icons/ai-3d/user.svg',
  './assets/icons/ai-3d/users.svg',
  './assets/icons/ai-3d/wallet.svg',
  './assets/icons/ai-3d/warning.svg',
  './assets/icons/ai-3d/whatsapp.svg',

  './js/money.js',
  './js/time.js',
  './js/storage-safety.js',
  './js/idGenerator.js',
  './js/guardian-message.js',
  './js/grade-audit.js',
  './js/admin-boot-guard.js',
  './privacy.html',
  './css/notifications.css',
  './css/academics.css',
  './css/course-hub.css',
  './css/exam-archive.css',
  './css/app-polish.css',
  './css/student-record.css',
  './css/ui-wallet.css',
  './css/teacher-panel.css',
  './css/hero-cards.css' + '?v=379',
  './css/student-home-design.css',
  './js/student-record.js',
  './sync/cloud-access.js',
  './sync/backend-selection.js',
  './sync/cloud-identity-policy.js',
  './sync/cloud-read-gateway.js',
  './sync/cloud-read.js',
  './js/app-entry.js',
  './js/cache-refresh.js',
  './js/student-features.js',
  './js/class-chat.js',
  './js/class-chat-relay.js',
  './js/student-hubs.js',
  './js/local-write-mark.js',
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
  './firebase/firebase-config.dev.js',
  './firebase/firebase-init.js',
  './firebase/firebase-services.js',
  './vendor/firebase/sdk.js',
  './vendor/firebase/messaging-compat.js',
  './vendor/supabase/sdk.js',
  './firebase-messaging-sw.js',
  './sync/sync-core.js',
  './sync/supabase-config.js',
  './sync/cloud-payload-crypto.js',
  './sync/supabase-transport.js',
  './sync/dual-cloud-failover.js',
  './sync/realtime-transport.js',
  './sync/sync-config.js',
  './sync/sync-auth.js',
  './sync/cloud-auth.js',
  './js/registration-review.js',
  './sync/sync-queue.js',
  './sync/sync-retry.js',
  './sync/sync-status.js',
  './sync/sync-guard.js',
  './sync/question-bank-v2-policy.js',
  './sync/question-bank-v2-sync.js',
  './sync/notices-v2-policy.js',
  './sync/notices-v2-sync.js',
  './js/firebase-config.js',
  './js/firebase-online-test.js',
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
  './',
  './index.html',
  './student.html',
  './admin.html',
  './manager.html',
  './teacher.html',
  './payment.html',
  './js/pull-to-refresh.js',
  './js/class-chat-head.js',
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
  './assets/teacher-hero/teacher-hero-day.webp',
  './assets/teacher-hero/teacher-hero-night.webp',
  './assets/images/teacher-hero/welcome-day.webp',
  './assets/images/teacher-hero/welcome-night.webp',
  './assets/images/teacher-hero/classroom-day.webp',
  './assets/images/teacher-hero/classroom-night.webp',
  './assets/images/teacher-hero/attendance-day.webp',
  './assets/images/teacher-hero/attendance-night.webp',
  './assets/images/teacher-hero/exam-day.webp',
  './assets/images/teacher-hero/exam-night.webp',
  './assets/images/teacher-hero/homework-day.webp',
  './assets/images/teacher-hero/homework-night.webp',
  './assets/images/teacher-hero/notice-day.webp',
  './assets/images/teacher-hero/notice-night.webp',
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
  './assets/fonts/NotoSansBengali-Variable.woff2',
  './js/class-key.js',
  './js/config.js',
  './js/student-access.js',
  './js/password-hash.js',
  './js/password-hash-worker.js',
  './js/password-policy.js',
  './js/secure-store.js',
  './js/session.js',
  './js/sanitize.js',
  './js/sanitize-url.js',
  './js/staff-password-dialog.js',
  './js/notification-store.js',
  './js/notification-settings.js',
  './js/settings-hub.js',
  './js/academics.js',
  './js/brand.js',
  './js/admin-academics.js',
  './js/admin-migration.js',
  './js/exam-data.js',
  './js/exam-ui.js',
  './js/exam-core.js',
  './js/question-bank.js',
  './js/course-content.js',
  './js/course-data.js',
  './js/course-hub.js',
  './js/student-study-sections.js',
  './js/student-more.js',
  './js/course-editor.js',
  './js/rich-sanitize.js',
  './js/daily-quote.js',
  './js/hero-cards.js' + '?v=379',
  './assets/daily-quotes.json',
  './js/daily-advice.js',
  './assets/daily-advice.json',
  './js/home-hero.js',
  './js/home-hero.js' + '?v=379',
  './js/home-hero-entry.js',
  './js/student-home-hero-entry.js' + '?v=379',
  './js/student-home-daily-hero.js' + '?v=379',
  './js/advice-admin.js',
  './js/advice-admin-entry.js',
  './assets/home-hero/hero-own-pace.webp',
  './assets/home-hero/hero-daily-goal.webp',
  './assets/home-hero/hero-joy-of-learning.webp',
  './assets/home-hero/hero-daily-tip.webp',
  './assets/student-home-hero/hero-own-pace.webp' + '?v=379',
  './assets/student-home-hero/hero-daily-goal.webp' + '?v=379',
  './assets/student-home-hero/hero-joy-of-learning.webp' + '?v=379',
  './assets/student-home-hero/hero-daily-tip.webp' + '?v=379',
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
  './js/student-profile-card.js',
  './vendor/qrcode/encoder.js',
  './js/login.js',
  './js/staff-auth.js',
  './js/admin-initialization.js',
  './js/database.js',
  './js/register.js',
  './js/recovery.js',
  './js/logout.js',
  './js/navigation.js',
  './js/notice-center.js',
  './js/install.js',
  './js/service-worker.js',
  './js/theme.js',
  './js/fixed-shell.js',
  './js/main.js',
  './js/panel-route.js',
  './js/admin.js',
  './js/backup-crypto.js',
  './js/backup-restore.js',
  './js/admin-detail-views.js',
  './js/admin-content.js',
  './js/staff-self-edit.js',
  './js/staff-role-names.js',
  './js/factory-reset.js',
  './js/manager.js',
  './js/payment.js',
  './js/teacher.js',
  './js/teacher-daily-advice.js',
  './js/teaching-data.js',
  './js/teacher-assignments.js',
  './js/student-teaching.js',
  './js/student-notice-board.js',
  './js/admin-data.js',
  './js/office-data.js',
  './js/registration-service.js',
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
  './js/staff-overview.js',
  './js/phonebook.js',
  './js/lecture-sheet-store.js',
  './js/lecture-sheet-pdf.js',
  './js/lecture-sheet-studio.js',
  './vendor/lecture-studio/sdk.js',
  './js/user-id.js',
  './js/storage/migration.js',
  './js/device-fingerprint.js',
  './js/admin-device-approvals.js',
  './sync/device-key-enrollment.js',
  './sync/device-key-store.js'
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
  const cache = await caches.open(CACHE_NAME);
  const exact = (await cache.match(request)) || (await caches.match(request));
  if (exact) return exact;
  try {
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return null;
    const requestedVersion = Number(url.searchParams.get('v'));
    if (Number.isSafeInteger(requestedVersion) && requestedVersion > CACHE_VERSION) return null;
    return (await cache.match(url.pathname)) || (await caches.match(url.pathname)) || null;   // ignore a ?v= cache-buster
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

/* Precache fill: bounded concurrency, per-item failure isolation.
   cache.addAll() is atomic — one 404 or one flaky-mobile-network timeout on any
   of the ~170 URLs aborted the WHOLE precache, leaving a freshly installed app
   with no offline shell at all. Each URL is now added on its own, six at a time
   so the fill never starves the page's own requests, and whatever a bad
   connection drops is retried once from activate(). */
const PRECACHE_CONCURRENCY = 4;

async function fillCache(cache, urls) {
  const queue = [...urls];
  const failed = [];
  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (cacheable(res)) await cache.put(url, res);
        else await cache.add(url);
      } catch {
        try { await cache.add(url); } catch { failed.push(url); }
      }
    }
  }
  await Promise.all(Array.from({ length: PRECACHE_CONCURRENCY }, worker));
  return failed;
}

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING' || event.data === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Activate immediately: a ~3 MB precache must not stand between a slow
    // link and the app's first paint. The fill runs in the background while
    // the visitor is still on the login screen, and the cache-first fetches
    // below top up anything not yet stored.
    await self.skipWaiting();
    const cache = await caches.open(CACHE_NAME);
    await fillCache(cache, APP_SHELL);
  })());
});

function queryClientVersion(client, timeoutMs = 300) {
  return new Promise(resolve => {
    if (typeof MessageChannel === 'undefined' || typeof client?.postMessage !== 'function') {
      resolve(0);
      return;
    }
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      try { channel.port1.close(); } catch { /* ignore */ }
      resolve(0);
    }, timeoutMs);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      try { channel.port1.close(); } catch { /* ignore */ }
      resolve(Number(event.data?.version) || 0);
    };
    try {
      client.postMessage({ type: 'APC_CLIENT_VERSION_CHECK' }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(0);
    }
  });
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const hadLegacySilentCache = keys.some(key => {
      if (!key.startsWith('active-plus-student-v') || key === CACHE_NAME) return false;
      return !/^active-plus-student-v(\d+)-minimal-education$/.test(key);
    });
    await Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    );
    await self.clients.claim();
    if (hadLegacySilentCache) {
      // Legacy pre-minimal-education workers (e.g. v53) served navigations
      // cache-first and had no controllerchange listener, leaving open tabs
      // stuck on the old DOM after claim(). Navigate ONLY windows that do not
      // already report a modern SW_VERSION so a fresh ?v= tab is never interrupted.
      const windows = await self.clients.matchAll({ type: 'window' });
      await Promise.all(windows.map(async client => {
        if (typeof client.navigate !== 'function') return null;
        const reportedVersion = await queryClientVersion(client);
        if (reportedVersion >= CACHE_VERSION) return null;
        return client.navigate(client.url).catch(() => {});
      }));
    }
    // Second chance for anything the install-time fill could not reach.
    const cache = await caches.open(CACHE_NAME);
    const missing = [];
    for (const url of APP_SHELL) if (!(await cache.match(url))) missing.push(url);
    if (missing.length) await fillCache(cache, missing);
  })());
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
//   • URLs WITH a ?v= query — cache-first too, matching on the pathname when
//     the exact URL is not stored (cachedResponse ignores the cache-buster).
//     This used to be network-first, which meant EVERY version-pinned script
//     and stylesheet re-downloaded on every single visit: the precache held
//     './js/main.js' while the page asked for './js/main.js?v=240' and the two
//     never met. Serving these from cache is safe because invalidation is per
//     build, not per URL: CACHE_VERSION (and therefore CACHE_NAME) bumps with
//     every change set and activate() deletes every other cache, so a new
//     build always starts from an empty cache and fetches its own files.
//   • cross-origin public GETs may still cache, but Firebase service endpoints
//     are ALWAYS left to the SDK/network (Auth, Firestore, RTDB, App Check,
//     Functions). The Firebase SDK itself is now a same-origin static bundle.
const NAV_TIMEOUT_MS = 2500;

function timedFetch(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('nav-timeout')), NAV_TIMEOUT_MS);
    // The real fetch keeps running past the ceiling; its result simply lands
    // too late to be used, so nothing half-written is ever cached here.
    fetch(request, { cache: 'no-cache' }).then(
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

function isFirebaseServiceRequest(request) {
  const url = new URL(request.url);
  // Firebase Auth uses reserved same-origin Hosting endpoints too.
  if (url.origin === self.location.origin) return /^\/__\/(auth|firebase|messaging)(\/|$)/.test(url.pathname);
  return /(^|\.)(googleapis\.com|firebaseio\.com|firebasedatabase\.app|cloudfunctions\.net|firebaseapp\.com|supabase\.co)$/.test(url.hostname);
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || isFirebaseServiceRequest(event.request)) return;

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

  /* One cache-first path for every static GET, query string or not. */
  event.respondWith((async () => {
    const cached = await cachedResponse(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (cacheable(response)) remember(event.request, response);
      return response;
    } catch (error) {
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
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
