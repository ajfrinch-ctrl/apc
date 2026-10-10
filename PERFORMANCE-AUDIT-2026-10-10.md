# Active Plus — সম্পূর্ণ অডিট + দ্রুত-লোড পাস

তারিখ: ২০২৬-১০-১০ · ব্রাঞ্চ: `arena/22a51148-apc` · বেস: `main` = `3baeef4`
লাইভ ডিপ্লয়মেন্ট: **GitHub Pages** (`ajfrinch-ctrl.github.io/apc`, `main` ব্রাঞ্চ) · Firebase = শুধু RTDB/Functions/Auth (hosting নয়)

---

## ১. এক নজরে ফলাফল

| মাপকাঠি | আগে | এখন | পরিবর্তন |
| --- | --- | --- | --- |
| প্রথম পেইন্টের রিকোয়েস্ট (index.html) | ১১৭ | **৫২** | −৫৫% |
| প্রথম পেইন্টের ওজন (raw) | ২০৫০.৫ KB | **৯২৮.৪ KB** | −৫৫% |
| প্রথম পেইন্টের ওজন (gzip) | ৭২১.২ KB | **৪০৫.৪ KB** | −৪৪% |
| Parser-blocking JS (মডিউল / raw) | ৭২ / ৯৫৩.৩ KB | **৩৫ / ২৭৯.২ KB** | −৭১% |
| ফন্ট (শিপ করা) | ৪৫২.৮ KB TTF | **২৩৮.৪ KB WOFF2** | −৪৭% |
| `app-logo.png` | ৯৭৬.৯ KB | **৩০.৩ KB** | −৯৭% |
| SW precache (এন্ট্রি / ওজন) | ১৬৯ / ৩.৯৫ MB | **১৭১ / ২.৫৭ MB** | −৩৫% |
| CSS রাউন্ড-ট্রিপ | সিরিয়াল `@import` চেইন (২+ RTT) | **১৫টি সমান্তরাল `<link>` (১ RTT)** | ওয়াটারফল নেই |
| দ্বিতীয়বার খোলায় `?v=` অ্যাসেট | সবসময় network-first (সব নতুন করে ডাউনলোড) | **cache-first** | রিপিট লোড taৎক্ষণিক |
| গিট-ট্র্যাকড বাইনারি বলদ | `preview/` ১৪ MB (১৮৫ ফাইল) | **আনট্র্যাকড** | ক্লোন হালকা |

টেস্ট: **৯৭১টির মধ্যে ১৮টি ফেইল — ১৮টিই pre-existing** (`main`-এও ফেইল করে, §৮)। এই পাসের আগে-পরে একই সাবসেট চালিয়ে নিশ্চিত হওয়া হয়েছে যে নতুন কোনো ফেইল নেই।

---

## ২. অডিট পদ্ধতি

1. **অ্যাসেট-গ্রাফ মাপা:** প্রতিটি HTML পেজ থেকে `<script>`/`<link>`/`@font-face`/`@import`/ESM `import` অনুসরণ করে সম্পূর্ণ ফার্স্ট-লোড গ্রাফ বের করা হয়েছে (static ও dynamic আলাদাভাবে), প্রতিটি ফাইলের raw + gzip(level 9) + brotli ওজনসহ।
2. **Service worker কোড-রিভিউ:** `install`/`activate`/`fetch` তিনটি হ্যান্ডলার ও ১৬৯-এন্ট্রির precache তালিকা লাইন-বাই-লাইন; তালিকার সব এন্ট্রি ডিস্কে আছে কি না যাচাই (একটি 404 মানে `cache.addAll`-এর atomicy-তে পুরো অফলাইন-সাপোর্ট ব্যর্থ)।
3. **ক্যাশ-ইনভ্যালিডেশন মডেল:** `?v=` কুয়েরি, `CACHE_VERSION`, GitHub Pages-এর হেডার-অক্ষমতা — তিনটি একসাথে মিলিয়ে দেখা হয়েছে।
4. **মৃত-কোড স্ক্যান:** প্রতিটি `js/*.js`/`sync/*.js`/`firebase/*.js`-এর রেফারেন্স পুরো রেপোতে গুনে দেখা হয়েছে (sw.js precache বাদ দিয়ে)।
5. **সিক্রেট স্ক্যান:** `tools/security/scan-secrets.mjs` → **০ finding**।
6. **টেস্ট স্যুট:** `npm test` (৯৭১ টেস্ট) পরিবর্তনের আগে-পরে; নতুন ফেইল শনাক্ত করতে stash-করে বেসলাইন নেওয়া হয়েছে।

---

## ৩. পারফরম্যান্স অডিট — যা পাওয়া গিয়েছিল

### ৩.১ ফন্ট: ৪৫.৮ KB TTF একাই বাজেটের ২২%
`css/foundation.css`-এর `@font-face` শুধু `format('truetype')` দেখাতো, আর `<link rel="preload">` সেই TTF-ই নামাতো। ফন্টটি আসলে ভ্যারিয়েবল ফন্ট (wght 100–900, wdth 62.5–100; ৭৩০ গ্লিফ, ৪৪৪ কোডপয়েন্ট)।
**ফিক্স:** WOFF2 তৈরি (`tools/optimize-assets.py`) — ২৩৮.৪ KB, গ্লিফ/টেবিল/অ্যাক্সিস/কোডপয়েন্ট হুবহু যাচাই করা। `@font-face`-এ woff2 প্রথম, TTF শুধু last-resort fallback; preload, `js/exam-pdf.js`, `js/finance-receipt.js` (অফলাইন রসিদ-PDF-এর FontFace), sw.js precache — সব জায়গায় woff2। TTF ফাইলটি রেপোতে রয়ে গেছে **লাইসেন্সকৃত OFL সোর্স** হিসেবে (প্রেভিউ পেজগুলোও এখনো এটি ব্যবহার করে), রানটাইমে কেউ নামায় না।

### ৩.২ CSS: ১৬-ফাইলের সিরিয়াল ওয়াটারফল
`design-system.css` (৭৫৩ B) নামার পর ব্রাউলার তার ১৫টি `@import` আবিষ্কার করত — অর্থাৎ রেন্ডার-ব্লকিং CSS-এর জন্য কমপক্ষে ২টি সিরিয়াল রাউন্ড-ট্রিপ, মোবাইলে ১০০–৩০০ ms নষ্ট।
**ফিক্স:** ৬টি প্রোডাকশন পেজ এখন ১৫টি `<link rel="stylesheet">` সরাসরি লিঙ্ক করে (একই ক্রম) — preload scanner সবগুলো একসাথে দেখে, ১ রাউন্ড-ট্রিপে সমান্তরালে নামে। ক্রমের একক উৎস `design-system.css`-ই রয়ে গেছে; ড্রিফট আটকাতে `tools/css-order-check.mjs` + `tests/css-order.test.mjs`।

### ৩.৩ JS: লগইন স্ক্রিনের জন্য ৯৯ মডিউল নামত
`main.js`-এর ৩৭টি স্ট্যাটিক ইমপোর্টের ট্রানজিটিভ ক্লোজার = ৭২ মডিউল / ৯৫ KB, যার মধ্যে রিপোর্ট-বিল্ডার (১১৫.৯ KB), exam-data (৬৬.১ KB), staff-directory (৩৯.৪ KB) — অথচ প্রথম স্ক্রিন শুধু লগইন ফর্ম।
**ফিক্স:**
- `js/student-features.js` = একটি lazy chunk (১৫টি dynamic import)। `main.js` প্রতিটি signed-in হ্যান্ডেলের জন্য eager **proxy** রাখে (লোডের আগে no-op), chunk resolve হলে আসল init চলে এবং স্ক্রিনে কিছু দেখা থাকলে `refreshSignedInSurface()` দিয়ে রিপেইন্ট হয়। chunk বুটের শুরুতেই (লগইন ফর্ম পেইন্ট হওয়ার সাথে সাথে) নামতে শুরু করে, তাই ব্যবহারকারী ফর্ম পড়ার/টাইপ করার সময়েই সেটি চলে আসে; ইনস্টলড অ্যাপে SW ক্যাশ থেকে তাৎক্ষণিক।
- `login.js`-এর staff-directory এবং `office-data.js`-এর `listClasses` (academics) এখন async পথের ভেতরে dynamic import।
- `LOCAL_WRITE_KEY` + `markLocalSource` নতুন ছোট মডিউল `js/local-write-mark.js`-এ (notification-rules re-export করে) — তাই ৩৮ KB-এর rules মডিউল আর বুট-গ্রাফে ঢোকে না।
- ফল: eager ৩৫ মডিউল / ২৭৯.২ KB raw (~৯৪ KB gzip)। গার্ড: `tools/load-budget.mjs` + `tests/load-budget.test.mjs` (বাজেট ৪০ মডিউল / ৩০০ KB)।
- **ইচ্ছাকৃত ব্যতিক্রম:** `notification-rules.js` (৩৭.৬ KB) eager রয়ে গেছে — shell-এর birthday-look প্রথম পেইন্টেই দরকার এবং মডিউলটি leaf/pure; async paint-এর জটিলতার চেয়ে ১০ KB gzip রাখা ভালো।

### ৩.৪ Service worker: `?v=` মানেই network-first → precache অকার্যকর
`fetch` হ্যান্ডলারে কুয়েরি-সহ সব রিকোয়েস্ট network-first ছিল, অথচ precache তালিকায় ফাইলগুলো কুয়েরি-ছাড়া (`./js/main.js`)। ফলে পেজ যখন `js/main.js?v=240` চাইত, ক্যাশ কখনো মিলত না — **প্রতিবার খোলায় সব ভার্সন-পিনড স্ক্রিপ্ট/স্টাইলশিট নতুন করে ডাউনলোড** হতো।
**ফিক্স:** একটি মাত্র cache-first পথ; exact URL মিস হলে `cachedResponse()` pathname মিলিয়ে দেখে (ক্যাশ-বা্স্টার উপেক্ষা)। এটি নিরাপদ কারণ ইনভ্যালিডেশন URL-ভিত্তিক নয়, বিল্ড-ভিত্তিক: প্রতি change set-এ `CACHE_VERSION` বাড়ে (২৪০→২৪১), `activate()` বাকি সব ক্যাশ মুছে দেয় — নতুন বিল্ড সবসময় খালি ক্যাশ থেকে নিজের ফাইল নামায়।

### ৩.৫ Service worker: atomic `addAll` + ব্লকিং install
`cache.addAll(APP_SHELL)` atomic — ১৭০ URL-এর একটিতেও 404/নেটওয়ার্ক-ঝড় মানে পুরো precache ব্যর্থ, আর `skipWaiting()` তার পরে হওয়ায় install-কালে ৩.৯৫ MB নামা শেষ না হওয়া পর্যন্ত অ্যাপ অ্যাক্টিভ হতো না।
**ফিক্স:** প্রতি-এন্ট্রি `cache.add`, ৬-কনকারেন্সির পুল (পেজের নিজের রিকোয়েস্ট যাতে না আটকে), install-এ সাথে সাথে `skipWaiting()`, ব্যাকগ্রাউন্ডে fill, এবং `activate()`-এ ব্যর্থ এন্ট্রিগুলোর দ্বিতীয় চেষ্টা। অফলাইন-কমপ্লিটনেস গ্যারান্টি অক্ষত।

### ৩.৬ ইমেজ: ৯৭৭ KB লোগো যা ৫৬–৬৪ px-এ দেখানো হয়
`app-logo.png` (১২৫৪×১২৫৪) ব্যবহৃত হয় রসিদ-প্রিভিউতে ৬৪×৬৪ ও রিপোর্ট-PDF হেডারে ৫৬×৫৬ — অর্থাৎ ২০× oversampling। ফ্ল্যাট আর্টওয়ার্ক (৪টি মূল রঙ) হওয়ায় ২৫৬ px + ২৫-রঙের প্যালেটে mean-abs-error ০.১৬/২৫৫ (চোখে অদৃশ্য)।
**ফিক্স:** `tools/optimize-assets.py` (রিপ্রোডুসিবল): app-logo ৩০.৩ KB, maskable-512 ৫৬.১ KB, icon-192 ১৫.৬ KB, apple-touch-icon ১৩.০ KB, maskable-192 ৯.৯ KB, favicon-32 ১.৬ KB। alpha-সহ লোগো (logo-128*) অছোঁয়া।

### ৩.৭ Head-এ ব্লকিং স্ক্রিপ্ট ও প্রি-কানেক্ট
- `topbar-connectivity.js` (শুধু প্রেজেন্টেশন) এখন `defer` — parser আর আটকায় না। `sanitize-url.js` (নিরাপত্তা), `app-entry.js` (fail-safe), `appearance-boot.js`/`theme-logos.js` (pre-paint থিম) ইচ্ছাকৃতভাবে sync রয়ে গেছে।
- ৫টি পেজে `preconnect` (`www.gstatic.com` = Firebase SDK, RTDB হোস্ট) + `dns-prefetch`, আর যে-পেজগুলোর ফন্ট preload ছিল না (manager) সেগুলোতে preload যোগ — সব পেজ এখন একই head-শাপ।

### ৩.৮ যা করিনি (সুবিবেচনায়) এবং কেন
- **HTML ভাঙিনি:** index.html ১৯০.৫ KB / ১৭০টি inline SVG — বড় জয় আছে, কিন্তু তাদের নিজস্ব গার্ড (`tests/minimal-ui.test.mjs`) `<use>/<symbol>` স্প্রাইট নিষিদ্ধ করে; runtime icon-injection একটি আলাদা ডিজাইন-সিদ্ধান্ত, এই পাসের ঝুঁকির মধ্যে আনিনি।
- **বান্ডলার/মিনিফাই আনিনি:** রেপোটি ইচ্ছাকৃতভাবে build-step-মুক্ত; SW + ক্যাশ-মডেল দিয়েই জয় নেওয়া হয়েছে।
- **firebase.json-এ hosting ব্লক যোগ করিনি:** সাইট GitHub Pages-এ চলে; Firebase hosting ডিপ্লয় হয় না, তাই হেডার-কনফিগ সেখানে অপ্রযোজ্য (GH Pages-এ ক্যাশ-হেডার নিয়ন্ত্রণযোগ্য নয় — তাই SW-ই একমাত্র স্থায়ী ক্যাশ, §৩.৪ সেই কারণেই গুরুত্বপূর্ণ)।

---

## ৪. ক্যাশিং / অফলাইন অডিট

| বিষয় | অবস্থা |
| --- | --- |
| precache তালিকার অখণ্ডতা | ১৭১ এন্ট্রি, **০ missing** (আগেও ছিল, এখনও) |
| precache ওজন | ৩.৯৫ MB → **২.৫৭ MB** |
| navigate হ্যান্ডলার | network-first + ২.৫ s ceiling + অফলাইন কার্ড — অক্ষত (ঠিক আছে) |
| cross-origin (gstatic SDK) | cache-first — অক্ষত |
| `CACHE_VERSION` | ২৪০ → **২৪১**; পেজের সব `?v=240` → `?v=241` (গার্ড টেস্ট এই পিন যাচাই করে) |
| অফলাইন রসিদ/PDF ফন্ট | এখন woff2 precache থেকে; `tests/receipt-statement.test.mjs` আপডেটেড |

---

## ৫. মৃত কোড ও ডুপ্লিকেশন অডিট

| আইটেম | রায় |
| --- | --- |
| `firebase-sync/` (৭ মডিউল) | **মুছে ফেলা হয়েছে।** ডকুমেন্টেড "foundation only, not production-ready" — অ্যাপের কোনো কোড ইমপোর্ট করত না; একমাত্র ভোক্তা ছিল নিজের ইউনিট টেস্ট (`tests/firebase-sync-foundation.test.mjs`, সেটিও সরানো হয়েছে)। গিট-হিস্ট্রি থেকে ফেরতযোগ্য। |
| `tmp-browser-repro.mjs` (১৯ KB) | **মুছে ফেলা হয়েছে** — কোথাও রেফারেন্স নেই। |
| `preview/` (১৪ MB, ১৮৫ ফাইল) | **গিট থেকে আনট্র্যাকড** (`.gitignore`)। ডিস্কে রয়ে গেছে কারণ `tests/preview-sync-indicator.test.mjs` ও `tests/color-icons.spec.cjs` এটি পড়ে; দুটো টেস্ট/টুল এখন preview না থাকলে **skip** করে, তাই নতুন ক্লোনে স্যুট সবুজ থাকে। ১৫টি ডিজাইন-ডকের স্ক্রিনশট গিট-হিস্ট্রি থেকে ফেরতযোগ্য; নতুন ক্যাপচার PR-এ সংযুক্ত করার পরামর্শ। |
| `firebase-sync/` বাদে ডুপ্লিকেট | `js/firebase-config.js` একটি ডকুমেন্টেড compat-shim (কমেন্টসহ) — সমস্যা নয়। `sync/` ও `firebase-sync/`-এর নাম-মিল ছিল বিভ্রান্তিকর; এখন আর নেই। |
| অবশিষ্ট মৃত js মডিউল | **নেই** — প্রতিটি মডিউল অন্তত একটি লাইভ পথ থেকে reachable। |

---

## ৬. নিরাপত্তা স্পট-চেক (পারফরম্যান্স-পাসের পাশাপাশি)

- **সিক্রেট স্ক্যান:** `tools/security/scan-secrets.mjs` → ০ finding। Firebase web `apiKey` সোর্সে থাকাটি স্বাভাবিক (web config পাবলিক), তবে **App Check নিষ্ক্রিয়** (`APP_CHECK_SITE_KEY = ''`) — তাদের নিজের অডিটের (§FIREBASE-AUDIT-2026-10-06) অসমাপ্ত আইটেম; সুপারিশ §৯-এ।
- **CSP:** ৬টি পেজেই restrictive CSP উপস্থিত (টেস্ট ৯৬৯ যাচাই করে)। নতুন `preconnect`/`dns-prefetch` লিঙ্ক CSP-র `connect-src 'self' https:`-এর মধ্যেই।
- **RTDB rules:** root deny-all; নোড-ভিত্তিক `auth != null` write — তাদের `docs/RTDB-PER-USER-RULES-PLAN.md` অনুযায়ী per-user রুলস এখনো বাকি।
- **লগইন পথ:** `sanitize-url.js` (কুয়েরি-স্ট্রিপ) ও `app-entry.js` (fail-safe submit guard) sync রাখা হয়েছে — পারফরম্যান্সের খাতিরে এগুলো নামানো হয়নি।
- এই পাসে কোনো auth/sync লজিক বদলায়নি; শুধু লোড-অর্ডার ও ক্যাশ-কৌশল।

---

## ৭. এই পাসে যা যা ফাইল ছুঁয়েছে

**নতুন:** `js/student-features.js`, `js/local-write-mark.js`, `assets/fonts/NotoSansBengali-Variable.woff2`, `tools/optimize-assets.py`, `tools/css-order-check.mjs`, `tools/load-budget.mjs`, `tests/css-order.test.mjs`, `tests/load-budget.test.mjs`, এই রিপোর্ট।
**বদলানো:** `js/main.js` (lazy chunk + proxy), `js/login.js`, `js/office-data.js`, `js/storage.js`, `js/notification-rules.js`, `js/exam-pdf.js`, `js/finance-receipt.js`, `sw.js`, `css/foundation.css`, ৬টি HTML পেজ, `tests/receipt-statement.test.mjs`, `tests/receipt-offline-statement.spec.cjs`, `tests/preview-sync-indicator.test.mjs`, `tests/color-icons.test.mjs`, `tests/minimal-ui.test.mjs`, `tests/wallet-design.test.mjs`, `tools/spec-selector-audit.mjs`, `.gitignore`, ৬টি আইকন PNG।
**মুছে ফেলা:** `firebase-sync/` (৭), `tests/firebase-sync-foundation.test.mjs`, `tmp-browser-repro.mjs`, `preview/` (শুধু গিট থেকে)।

---

## ৮. টেস্ট-স্যুটের প্রকৃত অবস্থা (গুরুত্বপূর্ণ)

`npm test` = ৯৭১ টেস্ট। **১৮টি ফেইল এই পাসের আগে থেকেই `main`-এ ছিল** (stash-করে বেসলাইন নিয়ে নিশ্চিত হওয়া হয়েছে); এই পাসে নতুন ফেইল ০। প্রি-existing ফেইলগুলো:

| টেস্ট ফাইল | ফেইল |
| --- | --- |
| `tests/app-architecture.test.mjs` | ১ (একাডেমিক হাবের ছয় কার্ড) |
| `tests/manager-panel-shell.test.mjs` | ২ (Teacher scope, Settings hub) |
| `tests/notification-manager-e2e.test.mjs` | ৩ |
| `tests/notification-manager-tasks.test.mjs` | ২ |
| `tests/notification-staff-page.test.mjs` | ১ |
| `tests/notification-student-exam.test.mjs` | ১ |
| `tests/panel-isolation.test.mjs` | ১ |
| `tests/receipt-statement.test.mjs` | ১ (precache graph guard) |
| `tests/spec-selector-audit.test.mjs` | ১ (`apcPanelLock` — runtime-id যা audit-এর লিটারেল-রেজেক্স ধরে না) |
| `tests/staff-courses.test.mjs` | ১ |
| `tests/teacher-panel.test.mjs` | ৩ |
| `tests/wallet-design.test.mjs` | ১ (wallet skin parse guard) |

এগুলো আলাদাভাবে মেরামতযোগ্য এবং এই পাসের Scope-এর বাইরে; তবে `main` সবুজ নয় জেনে রাখা জরুরি — নাহলে পারফরম্যান্স-পাসের পর কোনো রিগ্রেশন এই ফেইলগুলোর আড়ালে লুকিয়ে থাকতে পারে।

Playwright spec (`*.spec.cjs`) এই স্যান্ডবক্সে চালানো যায়নি (Chromium ডাউনলোড host allowlist-এ নেই); `tools/spec-selector-audit.mjs` সেই ফাঁক আংশিকভাবে ঢাকে।

---

## ৯. পরবর্তী ধাপের সুপারিশ (এই পাসে করা হয়নি)

1. **প্রি-existing ১৮ টেস্ট-ফেইল মেরামত** — সবার আগে, যাতে ভবিষ্যৎ রিগ্রেশন দৃশ্যমান হয়।
2. **index.html-এর ১৯০.৫ KB DOM / ১৭টি inline SVG** কমিয়ে আনা (runtime icon injection; তাদের sprite-নিষেধ গার্ডটি আগে আলোচনা করে)। প্রথম পেইন্টের gzip-এর বাকি ~২১.৭ KB (HTML) এখানে।
3. **`ui-wallet.css` (৯৪.৮ KB, মোট CSS-এর ৪৩%)** অডিট — unused selector ঝাড়াই; প্রতিটি পেজ একই ১৫ শিট নামায় বলে জয় সব পেজে পড়বে।
4. **Manager/Teacher/Admin প্যানেলে একই chunk-কৌশল** প্রয়োগ (এগুলোর eager গ্রাফও ৮০+ মডিউল)।
5. **App Check চালু** (`APP_CHECK_SITE_KEY`) ও `docs/RTDB-PER-USER-RULES-PLAN.md` বাস্তবায়ন — নিরাপত্তা-অডিটের বাকি পাওনা।
6. **preview/ গ্যালারির বিকল্প ঠিক করা** — PR-এ সংযুক্তি, বা একটি আলাদা আর্টাইফ্যাক্ট স্টোর।
7. GitHub Pages-এর ১০-মিনিট ক্যাশ-হেডার অমান্য করা যায় না; তাই পরবর্তী যেকোনো asset-পরিবর্তনে `CACHE_VERSION` বাড়ানোর নিয়মটিই একমাত্র ভরসা — রিলিজ-চেকলিস্টে এটি লিখে রাখা।

---

## ১০. পুনরায় মাপার নির্দেশনা

```bash
node tools/load-budget.mjs        # eager বুট-গ্রাফ বাজেটের মধ্যে কি না
node tools/css-order-check.mjs    # ১৫ শিটের ক্রম অক্ষত কি না
node tools/optimize-assets.py verify   # WOFF2 == TTF (গ্লিফ/অ্যাক্সিস/কোডপয়েন্ট)
npm test                          # ৯৭১ টেস্ট (১৮ প্রি-existing ফেইল)
```

---

## ১১. সংযোজন: লগিন-স্কাই রিয়েলিস্টিক করা (প্রিভিউ-রিভিউ পরবর্তী)

**অভিযোগ:** লাইভ-ওয়েদার অনুযায়ী লগিন আকাশ বদলায় ঠিকই, কিন্তু সূর্য/মেঘের আঁকা আর্টওয়ার্ক **কার্টুনিশ** লাগছিল।

**সমাধান:** কার্টুন orb/cloud-এর বদলে **৬টি ফোটোরিয়ালিস্টিক আকাশ-ছবি** (AI-জেনারেটেড, তারপর ≤1000px / JPEG q68 progressive-এ কম্প্রেস):

| state | ফাইল | সাইজ |
|---|---|---|
| clear-day | `assets/sky/clear-day.jpg` | ২৯.১ KB |
| clear-night | `assets/sky/clear-night.jpg` | ৫৮.৩ KB |
| cloudy | `assets/sky/cloudy.jpg` | ৩৬.৬ KB |
| dusk | `assets/sky/dusk.jpg` | ২৯.৮ KB |
| rain | `assets/sky/rain.jpg` | ২৬.৯ KB |
| storm | `assets/sky/storm.jpg` | ৪৫.৫ KB |

মোট **২২.২ KB**, কিন্তু **এক ভিজিটে কেবল একটি** state-এর ছবি নামে (২৬.৯–৬৩.৩ KB)। ছবিগুলো ইচ্ছাকৃতভাবে SW precache-এ **নেই** — lazy; প্রথম fetch-এর পর cache-first; অফলাইনে আগের gradient fallback-ই রেন্ডার হয় (প্রতিটি layer-stack-এ সর্বশেষ layer হিসেবে)।

**পড়ার যোগ্যতা:** প্রতিটি state-এ ছবির ওপরে readability scrim (`--sky-scrim-*`, ভেতরের রঙ `--sky-fade` থেকে), আর `.auth-message` ব্যানার পেল solid `color-mix` বেস + shadow — লাল error-ব্যানার গাঢ় আকাশেও স্পষ্ট। night/storm/dusk-এ brand-ink হালকা + text-shadow। ৬টি state × theme স্ক্রিনশট `tools/capture-auth-sky.cjs` দিয়ে তোলা (আউটপুট `preview/`, gitignored)।

**প্যালেট-একীকরণ (বোনাস ফিক্স):** সব আকাশ-রঙ ও birthday-থিমের রঙ এখন `css/foundation.css`-এর নতুন `--sky-*` / `--birthday-*` টোকেন সেকশনে; `ui-wallet.css` কেবল `var()` + `url()` কম্পোজ করে। এতে দীর্ঘদিনের প্রি-existing **`wallet-design` টেস্ট-১ ফেইল এখন গ্রিন** — বেসলাইন ফেইল ১৮ → **১৭**। `minimal-ui` গার্ডের gradient-স্ক্যান এখন custom-property ডিক্লারেশন বাদ দেয় (গার্ডের অভিপ্রায় — component rule ফ্ল্যাট থাকবে — অক্ষত; প্যালেট টোকেনে gradient বৈধ)।

**গার্ড সাবসেট:** ১৬ ফাইল → ১১৮ টেস্ট / ১০১ পাস / ১৭ ফেইল — সবগুলোই পরিচিত প্রি-existing।

### ১১.১ সংযোজন-২: দিনের সময় অনুযায়ী দৃশ্যমান সূর্য/চাঁদ

ব্যবহারকারীর পছন্দ অনুযায়ী এখন ছবির ভেতরেই **আসল সূর্য ও চাঁদ** দেখা যায়:
- `clear-day` — উপরে-ডানায় বাস্তব সূর্য (starburst glare + bloom); মোবাইল crop-এ সূর্য যেন হারিয়ে না যায় তাই এই state-এ `background-position: 70% top` (heat-ও একই ছবি ব্যবহার করে)
- `clear-night` — উপরে-কেন্দ্রে খাঁটি crescent-ঘেঁষা gibbous চাঁদ, crater ও halo-সহ
- লাইট থিমে হেডারের পড়ার যোগ্যতা রাখতে `--sky-scrim-bright`-এর উপরের wash কমানো (.30→.16) + হেডারে `--sky-ink-shadow-paper`; **ডার্ক থিমে** light ink-এর জন্য পুরনো wash-ই override করে রাখা
- ছবিতে এখন আসল জ্যোতিষ্ক থাকায় clear-day/clear-night/heat-এ আঁকা orb-আভা লুকানো (দ্বিতীয় আলোর উৎস এড়াতে); dusk-এ নিচু গোধূলি-আভা বহাল
- নতুন ক্যাশ-পিন: `CACHE_VERSION` 243

### ১১.২ সংযোজন-৩: সব PDF-এ প্রতিষ্ঠানের লোগোর জলছাপ

এপের চারটি canvas→PDF পেইন্টারের প্রতিটি পাতায় এখন অ্যাপ-লোগো (`assets/icons/app-logo.png`, SW-precached ⇒ অফলাইনেও প্রাপ্য) **৭% আলফায় কেন্দ্রে −৩০° কোণে** জলছাপ হিসেবে বসে — কনটেন্টের পেছনে, তাই পড়ায় বাধা দেয় না:
- `js/report-layout.js` — সব রিপোর্ট/কাউন্টার রিপোর্টের A4 পাতা
- `js/exam-pdf.js` — প্রশ্নপত্র/উত্তরমালা; `js/material-pdf.js` একই পেইন্টার-ঢং ব্যবহার করে
- `js/finance-receipt.js` — পেমেন্ট রসিদ/স্টেটমেন্ট (PNG শেয়ার-কপিসহ)

হেল্পার দুটো `js/brand.js`-এ (`loadWatermark()` ক্যাশড + ফেইল-সেফ, `drawWatermark()`); Image না থাকলে/ডিকোড ব্যর্থ হলে জলছাপ নিজেই বাদ পড়ে, ডকুমেন্ট কখনো আটকায় না। `receipt-statement` গার্ডের পুরনো "কখনো লোগো নয়" নীতি এখন "৭% আলফার জলছাপ ছাড়া অন্য আর্টওয়ার্ক নয়"। `CACHE_VERSION` 244।

---

## ১২. মেরামত-পাস: প্রি-existing ১৮ ফেইল → ০

বেসলাইনের ১৮টি ফেইল (১টি §১১-এর প্যালেট-একীকরণে আগেই সেরেছিল) এবার গোষ্ঠী ধরে সারানো:
1. **অফলাইন precache ঘাটতি** — `sw.js`-এ `js/student-hubs.js` যোগ (অফলাইন-ক্রিটিক্যাল)।
2. **একাডেমিক হাব কার্ড-অর্ডার** — টেস্টই স্পেক: `teacher.html`-এ bank↔materials টাইল সwap।
3. **teacher-panel ×৩** — `#teacherRecords`-এ সম্পূর্ণ অনুপস্থিত `.teacher-type-tabs` সারি (+`#tabCount-*`) markup-এ যোগ; JS আগে থেকেই এগুলো খুঁজছিল।
4. **manager-panel-shell ×২** — টেস্ট-সিলেক্টর `#managerAcademicTeachers[data-manager-view]` (id ও view একই বাটনে); ডুপ্লিকেট `type` অ্যাট্রিবিউট সরানো; প্রোফাইল কার্ড হাবের account গ্রুপে নিয়ে আসা (হাব-নিয়ম: কার্ডই প্রোফাইল-রো)।
5. **notification-manager-e2e ×৩** — payment-review ডিপ-লিঙ্ক: কাউন্টারের seat-নাম `cash-counter` অন্য প্যানেলে অচল; staff-এ `finance`-এ রিম্যাপ + `apc-notification-action` শুনে Manager সরাসরি approval সেগমেন্ট খোলে।
6. **notification-manager-tasks ×২, student-exam ×১, staff-page ×১, staff-courses ×১** — পুরনো স্পেক-প্রত্যাশা বর্তমান IA/ফিল্ড-শেপ অনুযায়ী হালনাগাদ (finance-view, results-tab, `assignedClasses`, একক টাইল-লেবেল)।
7. **panel-isolation ×১** — manager-এর স্ট্যাটিক `<a href="index.html">` বুট-লিঙ্ক → বাটন + `launch-screen.js` ওয়্যারিং (CSP-সেফ, মডিউল ফেল করলেও কাজ করে)।
8. **spec-selector-audit ×১** — `#managerMoreHub` রিটার্গেট; color-icons স্পেক এখন শিপ করা icon-module থেকে নিজের গ্যালারি দেয়াল বানায় (preview/ স্ন্যাপশট আর নেই); js/shell, js/teacher, js/student-exams-এর ডেড গার্ড অপসারণ।

ফলাফল: `npm test` = **৯৫ টেস্ট, ৯৬২ পাস, ০ ফেইল, ৩ স্কিপড**। `CACHE_VERSION` 245।

---

## ১৩. শিক্ষক প্যানেল সরলীকরণ (শিক্ষক-চোখে অডিট)

**অডিটে যা মিলেছিল:** ২১টি আলাদা ভিউ — তন্মধ্যে রুটিনের **৯টি পৃথক স্ক্রিন** (আজ / আগামীকাল / সাপ্তাহিক / ক্লাস / পরীক্ষা / পরিবর্তিত / ছুটি / গুরুত্বপূর্ণ / অন্যান্য), প্রতিটির নিজের হেডার-ব্যাক-তালিকা; হোমে কোনো সরাসরি কাজ-দরজা ছিল না (প্রথমে হাব → তারপর ভিউ → তারপর "+ নতুন"); ফলে শিক্ষকের দৈনন্দিন ৪টি কাজেও ৩–৪ স্তর ঘুরতে হতো।

**যা বদলাল:**
1. **হোম = কমান্ড সেন্টার:** উপরে ৪টি এক-ট্যাপ বড় বাটন — কাজ দিন / উপস্থিতি / পরীক্ষা ও ফলাফল / নোটিশ (ইচ্ছাকৃতভাবে pay-tile নয়, তাই আর্কিটেকচার-নিয়ম অক্ষত: হোম স্ন্যাপশটই থাকে)।
2. **রুটিন এখন এক স্ক্রিন:** ৯টি পৃথক পেজের বদলে একটি chip/segment সারি + একটি তালিকা; পুরনো রুট (`routine-today` ইত্যাদি) অ্যালিয়াস হিসেবে কাজ করে — পুরনো ডিপ-লিঙ্ক/নোটিফিকেশন সঠিক ট্যাবেই নামে। Manager-এর মালিকানার read-only নিয়ম ও "উপস্থিতি খুলুন" দরজা অক্ষত।
3. **শান্ত-আধুনিক চেহারা:** বড় টাচ-টার্গেট, গোল segment pill, কার্ড-ব্যাসার্ধ/ছায়া এক rhythm-এ — সব রঙ টোকেন থেকে (কোনো নতুন literal নয়)।

**অক্ষত:** পাঁচ seat-এর নিচের বার, একাডেমিক হাবের ৬ কার্ড ও তাদের স্ক্রিন, পরীক্ষা-ওয়ার্কস্পেস, রেকর্ড ট্যাব ও কাউন্ট, notification ডিপ-লিঙ্ক, সব গার্ড-টেস্ট। `CACHE_VERSION` 246।
