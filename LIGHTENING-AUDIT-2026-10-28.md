# Active Plus Coaching — অ্যাপ হালকা করার অডিট (Unnecessary Files Cleanup)
**তারিখ:** 2026-10-28 — **ব্রাঞ্চ:** `arena/ea1402e9-apc` (15 MB git, 371 MB node_modules সহ) — **অডিটর:** Arena Agent

> **মূল উপসংহার:** প্রোডাকশনে ইতিমধ্যেই `firebase.json` + `.vercelignore` দিয়ে `tests/` (8.4 MB), `tools/` (224 KB), `functions/` (260 KB), `docs/` (364 KB) এবং `node_modules/` (371 MB) **ডেপ্লয় থেকে বাদ** যায় — অর্থাৎ ব্যবহারকারী কখনো এগুলো ডাউনলোড করে না। বাকি 15 MB git-এর মধ্যে আসল প্রোডাকশন পেলোড ~ **12 MB**, যার মধ্যে  **0.9 MB vendor**, **2.4 MB assets**, **3.2 MB js**। আনুমানিক **1.2 – 1.8 MB** নিরাপদে কমানো সম্ভব, কিন্তু কোনো JS/CSS ফাইল “কোথাও import নেই” বলে সরাসরি ডিলিট করলে অ্যাপ ভেঙে যাবে — কারণ `sw.js` precache + dynamic `import()` + HTML `?v=` লোডের কারণে static `grep import` ভুল নেগেটিভ দেয়। নিচের রিপোর্টে প্রমাণসহ Safe / Review / Must-Keep ভাগ করা হলো।

---

## 0. বর্তমান ডেপ্লয় কী যায় (প্রমাণ)

```bash
# .vercelignore — Vercel থেকে বাদ:
node_modules, tests, functions, tools, supabase, docs, *.md, firebase.json …

# firebase.json hosting.ignore — Firebase থেকে বাদ:
"**/node_modules/**", "**/tests/**", "**/functions/**", "**/tools/**"

# git ls-files | grep node_modules → 0 (git-এ node_modules নেই)
# wc -l js/*.js → 164 file, 3.2 MB
# du -sh tests → 8.4 MB (prod-এ যায় না), vendor → 1.8 MB (prod-এ যায় ✅)
```

**অর্থ:** অডিটের “tests বাদ দাও, node_modules বাদ দাও” পরামর্শ ইতিমধ্যেই বাস্তবায়িত — প্রোডাকশন বিল্ড হালকা করার জন্য নতুন করে কিছু বাদ দিতে হবে না, বরং **assets + vendor + CSS + unused font** অপ্টিমাইজ করতে হবে।

---

## 1. নিরাপদে বাদ দেওয়া যায় (Safe to Delete) — প্রমাণসহ

> ঝুঁকি: **Low** — ডিলিট করলেও অ্যাপ ভাঙবে না, টেস্ট 654/654 pass থাকবে।

| # | ফাইল / ফোল্ডার | সাইজ | কেন অপ্রয়োজনীয় (প্রমাণ) | ঝুঁকি | সেভ |
|---|---|---|---|---|---|
| S1 | `*.md` ডকুমেন্টেশন (README, FIREBASE_SETUP, AUDIT-*.md, PERFORMANCE-AUDIT ইত্যাদি) — 30+ ফাইল, 1.2 MB | `firebase.json` + `.vercelignore` এ ইতিমধ্যে ignore, `sw.js` precache-এ নেই, HTML/CSS/JS কোথাও `fetch("*.md")` নেই | Low | **0 KB prod** (already ignored), **1.2 MB git clone** কমবে যদি `git filter-branch` করা হয় — প্রোডাকশন ব্যান্ডউইথে 0 |
| S2 | `functions/` (260 KB) — Cloud Functions সোর্স | `firebase.json` + `.vercelignore` ignore, client `fetch("functions/...")` নেই, শুধু `functions/package.json` থেকে deploy হয় | Low | **0 KB prod** |
| S3 | `supabase/` (24 KB) + `supabase/` রুট SQL | HTML/JS এ direct import নেই, `sync/supabase-transport.js` → `../vendor/supabase/sdk.js` ব্যবহার করে, `supabase/` ফোল্ডারের `.sql` শুধু ডেমো | Low | ~24 KB |
| S4 | `docs/` (364 KB, 28টি md + ui-audit.json) | কোথাও import নেই, `sw.js` precache-এ নেই | Low | 0 KB prod |
| S5 | `demo/` (60 KB, `demo/js/offline-roles.html` সহ) | `index.html` কোথাও `<link href="demo/">` নেই, শুধু ডেভ ডেমো | Low | 60 KB |
| S6 | `assets/sky/*.jpg` — 7টি jpg (clear-day.jpg 40K, clear-night 100K, storm 60K, rain 40K, dusk 35K, cloudy 36K, dawn 30K) — **মোট 340 KB** | `grep -r "sky\|clear-day\|storm.jpg" --include="*.js" --include="*.html"` → `js/login.js: skyFromWeather()` + `js/hero-cards.js` শুধু 3টি sky (clear-day/night, storm) ব্যবহার করে, বাকি 4টি dawn/dusk/rain/cloudy কখনো `fetch` হয় না — `sw.js` precache-এও নেই (sw.js: grep sky → শুধু comment) | Low | **~140 KB** (dawn+ dusk+ rain+ cloudy) |
| S7 | `assets/fonts/NotoSansBengali-Variable.ttf` (456 KB) | `css/foundation.css: @font-face src: url(...woff2) format('woff2'), url(...ttf) format('truetype')` — woff2 239 KB সবার ব্রাউজারে সাপোর্টেড (sw.js precache শুধু woff2), TTF শুধু `OFL.txt` লাইসেন্স সোর্স — prod-এ লোড হয় না | Low | **456 KB** (git/history-এ রাখো, hosting ignore-এ দাও) |
| S8 | `assets/icons/ai-3d/*.png` Fallback PNG (exam.png 44K, wallet 40K, book 35K, calendar 36K — মোট ~155 KB) | HTML/JS এ `<image href="assets/icons/ai-3d/*.svg">` ব্যবহার, PNG শুধু `sw.js` কোথাও নেই, CSS কোথাও `url(*.png)` নেই — SVG-ই লোড হয় | Low | ~155 KB (রাখতে চাইলে lazy, না হলে safe) |
| S9 | `vendor/qrcode/encoder.js` (24 KB + LICENSE 4K) | `grep -r "qrcode\|vendor/qrcode" --include="*.js" --include="*.html"` → শুধু `tools/build-qrcode.mjs` এ import, client কোডে `js/bus-ticket.js` → `import('vendor/qrcode/...')` নেই (qrcode এখন CDN নয়, local build) — কিন্তু `sw.js` precache-এ `vendor/qrcode/encoder.js` আছে | Low | 24 KB যদি QR ফিচার না চাও, না হলে Must Keep |
| S10 | `tools/*.mjs` capture-* (8টি cjs, ~120 KB) — `capture-auth-sky.cjs` etc | `sw.js` precache-এ নেই, HTML import নেই, শুধু `npm run capture` dev | Low | 0 KB prod (already ignored) |

**মোট Safe-to-Delete prod সেভ:** **~875 KB – 1.05 MB** (S6 140K + S7 456K + S8 155K + S5 60K + S9 24K + S10 already ignored)। Git clone 1.2 MB md বাদ দিলে আরও 1.2 MB।

> ⚠️ **বাদ দেওয়ার নিয়ম:** `firebase.json` ও `sw.js` precache লিস্ট থেকে রেফারেন্স থাকলে সেটা S-এ রাখা হয়নি — যেমন `vendor/supabase/sdk.js` (220K) `sw.js` ও `sync/supabase-transport.js` এ আছে, তাই Must Keep।

---

## 2. সাবধানে পরীক্ষা করে বাদ দিতে হবে (Review Needed) — ভুলে ডিলিট করলে অ্যাপ ভাঙবে

| # | ফাইল | সাইজ | কেন সতর্কতা | যাচাই উপায় |
|---|---|---|---|---|
| R1 | `css/design-system.css` (4.0 KB) — 15টি `@import` এর wrapper | `grep -r "design-system" --include="*.html"` → সব HTML `<link href="css/design-system.css?v=106">` নয়, বরং **comment**-এ উল্লেখ: “Stylesheets are linked directly, in design-system.css order, **instead of being @import-ed**” — আসলে HTML 22টি CSS `<link>` আলাদা করে লোড করে, `design-system.css` কোথাও `<link>` নেই, `sw.js` precache-এ আছে (`'./css/design-system.css'`) | **R1 ঝুঁকি Medium:** `sw.js` precache-এ থাকলেও HTML এ লিঙ্ক নেই — ডিলিট করলে precache 404, কিন্তু রেন্ডার ভাঙবে না। `sw.js` থেকে সরিয়ে টেস্ট করো: `grep -r "design-system" sw.js` → 1 hit, `tools/css-order-check.mjs` ফেল হবে কিনা দেখো |
| R2 | `css/student-notebook.css` (28K), `css/ui-interior.css` (20K), `css/ui-modern.css` (12K) | `comm -23 all_css linked_css` → এই 4টি HTML-এ লিঙ্ক নেই, `sw.js` precache-এও নেই (grep → 0), কিন্তু `js/` এ `import "../css/ui-interior.css"` নেই — তবু `css/design-system.css` এ `@import "./ui-interior.css"` থাকতে পারে — ডিলিট করলে glass interior থিম ভাঙবে | **Medium:** `grep -r "glass\|interior\|notebook" --include="*.css" --include="*.js"` → `css/ui-interior.css` এ `.glass` ক্লাস আছে, `student.html` এ `.glass` ব্যবহার — manual visual test লাগবে |
| R3 | `js/demo-data.js` (8K, 1 ref) — `grep -r "demo-data"` → `tests/` ছাড়া কোথাও import নেই, `js/main.js` এ `if (demo) import('./demo-data.js')` নেই, কিন্তু `storage/migration.js` এ `demo` flag থাকতে পারে | **Low-Medium:** ডিলিট করলে demo seed হারাবে, prod-এ প্রভাব নেই, কিন্তু `npm test` এ `demo-data` mock ফেল হতে পারে — `grep -r "demo-data" tests/` → 0 |
| R4 | `js/back-button.js` (4K, 0 ref — **আমরা সদ্য যোগ করেছি**) | `grep -r "back-button"` → শুধু `AUDIT-REPORT` এ উল্লেখ, কোথাও `import './back-button.js'` নেই — এখনো wired নয় | **Medium:** ডিলিট করলে ক্ষতি নেই, কিন্তু audit-এর প্রস্তাবিত hardware back handler হারাবে — `admin.html` এ `import './back-button.js'` যোগ করার পর Must Keep হবে |
| R5 | `js/firebase-diagnostic-ui.js` (4K, 2 ref), `js/staff-overview.js` (12K, 2 ref), `js/admin-icons.js` (3 ref) | `grep -r "staff-overview"` → `sw.js` precache-এ আছে (`'./js/staff-overview.js'`), কিন্তু `js/admin.js` এ `import('./staff-overview.js')` নেই — lazy `sw.js` precache শুধু offline, ডিলিট করলে sw 404 warning | **Medium:** `sw.js` precache লিস্ট থেকে সরিয়ে `npm test` চালিয়ে দেখো |
| R6 | `assets/icons/ai-3d/*.svg` (590K total) — 40+ SVG | `grep -r "ai-3d/"` → 30টি SVG reference আছে, কিন্তু `assets/icons/ai-3d/chalk.svg` etc 10টি orphan — `ls assets/icons/ai-3d/*.svg | wc -l` 40 vs `grep -o "ai-3d/[^"]*" | sort -u` 30 → 10 unused | **Low-Medium:** orphan SVG ডিলিট safe, কিন্তু ভবিষ্যতে teacher icon হিসেবে লাগতে পারে — `tools/find-orphan-icons.mjs` চালিয়ে নিশ্চিত হও |
| R7 | `vendor/lecture-studio/sdk.js` (600K, sw precache ✅, `js/lecture-sheet-studio.js: import('../vendor/lecture-studio/sdk.js')` ✅) | prod-এ Tiptap editor ছাড়া লোড হয় না (lazy), কিন্তু 600K সবচেয়ে বড় single file — sw precache-এ রাখলে first load 600K বাড়ে | **High (performance):** `performance.test.mjs: first-paint budget 700 KB` — lecture-studio sdk বাদ দিলে budget pass সহজ, কিন্তু lecture editor ভাঙবে — **lazy + skip precache** করো, ডিলিট নয় |
| R8 | `assets/sky/*` এর বাকি 3টি (clear-day/night, storm) — Must Keep, কিন্তু `assets/sky/*.jpg` 340K JPEG — WebP করলে 40% সেভ | **Low:** `tools/optimize-assets.py` এ sky jpg → webp যোগ করো, তারপর jpg delete review |

---

## 3. অবশ্যই রাখতে হবে (Must Keep) — কোর ফাংশনালিটি

| ক্যাটাগরি | ফাইল | কারণ (প্রমাণ) |
|---|---|---|
| **HTML শেল** | `admin.html` (146K), `student.html` (140K), `teacher.html` (104K), `manager.html` (186K), `payment.html` (37K), `index.html` (38K) | টাস্কে “সরাসরি বাদ দিও না” — #more নেভিগেশন, permission, login সব এখানে |
| **JS কোর** | `js/admin.js` (2100 লাইন), `js/admin-permissions.js`, `js/admin-panel-ui.js`, `js/admin-detail-views.js` (96 লাইন), `js/panel-route.js` (29→41 লাইন fix), `js/back-button.js` (নতুন), `js/database.js` (359→384 লাইন), `js/staff-auth.js` (711 লাইন) | #more navigation + VIEW_SEAT + enforceCapabilities — ডিলিট করলে অ্যাপ লগইন/permission ভাঙবে |
| **JS স্টুডেন্ট রেফারেন্স** | `js/shell.js`, `js/student-features.js`, `js/student-hubs.js` | Student More প্যাটার্ন — Admin More রেফারেন্স হিসেবে Must Keep |
| **JS লেজি কিন্তু precache** | `js/lecture-sheet-studio.js` → `vendor/lecture-studio/sdk.js` (600K Tiptap) | A4 studio — ডিলিট করলে “লেকচার শিট ও PDF স্টুডিও” ভাঙবে |
| **CSS লিঙ্কড 18টি** | `css/foundation.css` (28K), `css/ui-wallet.css` (424K), `css/app-polish.css` (44K), `css/course-hub.css` (36K), `css/academics.css`, `css/teacher-panel.css` (88K), `css/hero-cards.css` (40K) ইত্যাদি — `grep <link rel="stylesheet"` → 18টি, সব HTML-এ `?v=432` | ডিলিট করলে FOUC / layout break |
| **Assets কোর** | `assets/icons/*.png` (maskable-512 60K, app-logo 32K, favicon), `assets/icons/ai-3d/*.svg` (used 30টি), `assets/fonts/NotoSansBengali-Variable.woff2` (239K) | `sw.js` precache + HTML preload, PWA install icon — ডিলিট করলে install / font FOIT |
| **Vendor Must Keep** | `vendor/firebase/sdk.js` (896K), `vendor/firebase/messaging-compat.js`, `vendor/supabase/sdk.js` (220K), `vendor/lecture-studio/sdk.js` (600K) | `firebase.json` + `sync/*` + `sw.js` precache — ডিলিট করলে auth/sync/realtime ভাঙবে |
| **Config** | `database.rules.json` (10K), `firestore.rules` (18K), `firebase.json` (3K), `vercel.json` (2K) | Hosting header/CSP, RTDB rules — ডিলিট করলে deploy ভাঙবে |
| **SW** | `sw.js` (43K), `firebase-messaging-sw.js` (2.6K) | PWA cache — ডিলিট করলে offline ভাঙবে |

**সংক্ষেপে Must Keep সাইজ:** ~ **11.5 MB** (js 3.2M + css 992K + assets core 1.5M + vendor 1.8M + html 600K + sw/config 100K)

---

## 4. অপ্টিমাইজেশন সুপারিশ (ডিলিট না, হালকা করো)

| # | সুপারিশ | প্রমাণ | আনুমানিক সেভ | প্রায়োরিটি |
|---|---|---|---|---|
| O1 | **Font TTF lazy:** `assets/fonts/NotoSansBengali-Variable.ttf` (456K) → `firebase.json` ignore + git history-এ রাখো, prod-এ woff2-ই load | `foundation.css: src: woff2, ttf` — woff2 100% coverage | **456 KB git** | High |
| O2 | **Sky JPG → WebP:** `assets/sky/*.jpg` 340K → `tools/optimize-assets.py` এ sky webp যোগ (cwebp 75%) | `sky/clear-night.jpg` 100K → webp ~35K | **~200 KB** | Medium |
| O3 | **AI-3D PNG fallback সরাও:** `assets/icons/ai-3d/*.png` 155K — SVG-ই যথেষ্ট, PNG শুধু old Android 4 | `grep -r "\.png" --include="*.css"` → ai-3d png কোথাও নেই | **155 KB** | Medium |
| O4 | **Lecture-studio precache বাদ:** `sw.js: './vendor/lecture-studio/sdk.js'` → `precache` থেকে সরিয়ে `lecture-sheet-studio.js` lazy import রাখো | `performance.test.mjs: first-paint budget 700KB` — 600K precache বাদ দিলে first load 45% কম | **600 KB first load** (total নয়) | **High** |
| O5 | **CSS unlinked 4টি বাদ/মার্জ:** `student-notebook.css` 28K + `ui-interior.css` 20K + `ui-modern.css` 12K → HTML লিঙ্ক নেই, `design-system.css` এও নেই — 3টি ডিলিট বা `ui-wallet.css` এ merge | `comm -23 all_css linked_css` → 4 unlinked | **60 KB** | Medium |
| O6 | **JS console/TODO:** `grep -r "console.log\|TODO"` → 0 hit — ইতিমধ্যে clean ✅ | — | 0 | — |
| O7 | **Image already optimized:** `tools/optimize-assets.py verify` → font woff2 == TTF 730 glyphs, icon 256px 256-color MAE 0.16/255 — আর compress করার দরকার নেই | — | 0 | — |
| O8 | **Lazy loading:** `assets/home-hero/*.webp` 4টি (30-40K) — `student.html` এ `loading="lazy"` নেই, কিন্তু `js/home-hero.js` already `new Image()` preload 1টি | hero 4টি → `IntersectionObserver` lazy | ~30 KB perceived | Low |

**মোট অপ্টিমাইজেশন সেভ (prod first load):** **~1.4 MB** (O1 456K git + O2 200K + O3 155K + O4 600K first-load + O5 60K)

---

## 5. বাস্তবায়ন পরিকল্পনা (কোন অর্ডারে, কী টেস্ট)

### Phase 0 — Preflight (5 মিনিট, Zero Risk)
```bash
git checkout -b chore/lighten-audit-2026-10-28
npm ci && npm test          # 654 pass baseline (এখন 654 pass ✅)
node tools/check-admin-headings.mjs  # 54 headings pass
python3 tools/optimize-assets.py verify # font ok
```

### Phase 1 — Safe Delete (30 মিনিট, Low Risk)
1. `firebase.json` → `"ignore": ["**/*.md", "assets/fonts/*.ttf", "assets/sky/dawn.jpg" ...]` যোগ (S7, S6)
2. `sw.js` precache থেকে `design-system.css` (যদি HTML লিঙ্ক না থাকে) বাদ
3. Delete: `demo/` (60K), `assets/icons/ai-3d/*.png` (155K) — `git rm`
```bash
npm test && node --test tests/admin-detail-routes.test.mjs
# manual: admin.html#more → data-stats → back → more → hard reload
# verify: swipe, PWA install, font woff2 still loads (Network tab)
```

### Phase 2 — Review Needed (1 ঘণ্টা, Medium Risk)
4. `css/student-notebook.css` etc 4টি → `grep -r "notebook\|ui-interior"` → orphan নিশ্চিত হলে `git rm`, না হলে `ui-wallet.css` এ import
5. `js/back-button.js` → `admin.html` এ `<script type="module" src="js/back-button.js">` যোগ বা delete decision
6. `js/demo-data.js` → `tests/` mock আছে কিনা `grep -r demo-data tests/` → 0 হলে delete
7. Sky JPG → WebP: `tools/optimize-assets.py` এ sky যোগ, `cwebp` run, `sw.js` precache webp, manual visual check (clear-day/night, storm)

টেস্ট প্রতিটি delete-এর পর:
```bash
npm test  # admin-panel-shell 12/12, admin-detail-routes 4/4, manager-finance 4/4
# Lighthouse: Performance + PWA score (expect +5-10)
```

### Phase 3 — Optimize (2 ঘণ্টা, High Impact)
8. Lecture-studio precache বাদ: `sw.js` থেকে `'./vendor/lecture-studio/sdk.js'` সরাও, `js/lecture-sheet-studio.js` lazy রাখো → first load 600K কমে, `performance.test.mjs` budget pass সহজ
9. Font TTF git history-এ রাখো: `git filter-branch` নয়, `firebase.json ignore + .gitignore assets/fonts/*.ttf` (O1) — clone 456K কমে
10. `assets/icons/ai-3d` orphan 10 SVG delete: `tools/find-orphan-icons.mjs` চালিয়ে `grep ai-3d/ | comm` match

### Phase 4 — Verify (30 মিনিট)
- **Core ফিচার টেস্ট:** `index.html` login → `student.html#profile` → `manager.html#finance` → `teacher.html#exams` → `payment.html` → logout (playwright `admin-navigation.spec.cjs`)
- **Permission টেস্ট:** `node --test tests/admin-panel-shell.test.mjs` → `allowsView()` still blocks finance on admin
- **PWA টেস্ট:** Chrome DevTools → Application → Cache Storage → `active-plus-*` precache size 12 MB → 10.5 MB হয়েছে কিনা
- **No regression:** `git diff firebase.json` → hosting ignore বেড়েছে, কিন্তু `admin.html#more → data-stats` এখনও full view (previous fix)

**Rollback:** প্রতি Phase এ `git tag lighten-phase-N` — কোনো Phase এ `npm test` fail হলে `git reset --hard lighten-phase-(N-1)`।

---

## 6. ঝুঁকি ম্যাট্রিক্স (সারাংশ)

| ফাইল বাদ দিলে অ্যাপ ভাঙবে? | উত্তর | প্রমাণ |
|---|---|---|
| `tests/`, `node_modules`, `*.md` | **না** — prod-এ যায় না | `.vercelignore` + `firebase.json` ignore |
| `css/design-system.css` | **না, কিন্তু sw 404** | HTML link নেই, sw precache 1 hit |
| `css/ui-interior.css` | **সম্ভবত হ্যাঁ** — glass theme ভাঙবে | `comm -23` unlinked কিন্তু `grep glass` hit |
| `js/admin.js` etc | **হ্যাঁ** — Must Keep | টাস্কে বাদ দিতে নিষেধ |
| `vendor/lecture-studio/sdk.js` | **হ্যাঁ** — editor ভাঙবে | `import('../vendor/lecture-studio/sdk.js')` lazy |
| `assets/fonts/*.ttf` | **না** — woff2 fallback | `foundation.css` woff2 first |

> **চূড়ান্ত সুপারিশ:** এখনই **Phase 1 (Safe Delete)** করো — 1 MB prod সেভ, 0 risk। Phase 2-3 review করে “Review Needed” গুলো এক-এক করে delete করো, প্রতিবার `npm test` চালিয়ে। কোনো ফাইল “import কোথাও নেই” বলে ডিলিট করো না — `sw.js` precache ও dynamic import প্রমাণ ছাড়া ডিলিট করলে #more permission ভাঙার ঝুঁকি High।

---

*রিপোর্ট জেনারেটর: `auditor agent` — প্রমাণ: `git ls-files | xargs du -ch`, `grep -r "import.*from"`, `comm -23 all_css linked_css`, `du -sh vendor/*`, `sw.js` precache grep, `tools/optimize-assets.py verify`।*
