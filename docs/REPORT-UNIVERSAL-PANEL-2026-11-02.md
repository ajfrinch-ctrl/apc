# Universal Staff Panel — রিপোর্ট (২০২৬-১১-০২)

**শাখা:** `arena/fabc17fa-apc` · **ক্যাশ ভার্সন:** ৪৫৭ → **৪৫৯** · **স্ট্যাটাস:** A · B · C · D — চারটিই সম্পূর্ণ

---

## ১। কী বদলাল, এক নজরে

| # | আগে | এখন |
| --- | --- | --- |
| ১ | Teacher-এ এক স্ক্রিনে প্রোফাইল + সেটিংস (`data-profile-mode`) আর `সব বিভাগ` চিপ-সারি (`data-settings-tab="all"`) | **দুই স্ক্রিন**: প্রোফাইল = পরিচয় কার্ড + এডিট; সেটিংস = পাঁচ গ্রুপের মেনু, এক ক্লিকে **একটাই** গ্রুপ |
| ২ | Admin-এ ইনলাইন প্রোফাইল/পাসওয়ার্ড ফর্ম, বাকি তিনটায় শুধু রো-লিংক | **Admin-এর ফর্মটাই সবার**: `js/staff-account-forms.js` একই মার্কআপ, একই `data-settings-row` কী, একই ভ্যালিডেশন |
| ৩ | Cash Counter-এর `আরও`-তে প্রোফাইল-তথ্য + লগআউট, আলাদা প্রোফাইল স্ক্রিন নেই | Counter-এর নিজের **প্রোফাইল স্ক্রিন** (পরিচয় কার্ড + এডিট) — চার প্যানেলে এক |
| ৪ | `data-teacher-view` · `data-manager-view` · `data-admin-view` · `data-pay-section` | এক রুট-অ্যাট্রিবিউট: **`data-panel-view`** (`dataset.panelView`) |
| ৫ | পেমেন্ট হিরো হার্ডকোডেড `212px` / `26px`; বাকি প্যানেল আলাদা | এক শেল-টোকেন: `--t-hero-min-h` (236px, ≤380px 220px), `--t-radius-hero` |

### ডিফ

```
১০৫ ফাইল পরিবর্তিত · +১৩৫৫ / −১০০১
 নতুন: js/staff-account-forms.js (+২০৩), docs/UNIVERSAL-STAFF-PANEL-2026-11-02.md
 বড়: teacher.html · manager.html · payment.html · js/{teacher,manager,payment,settings-hub}.js
 নতুন২: js/panel-capabilities.js (+১৮০), tests/panel-capabilities-2026-11-02.test.mjs (৮টি পরীক্ষা)
 CSS: css/foundation.css (টোকেন) · css/ui-wallet.css (tokenised) · css/teacher-panel.css (rebuild)
```

কমিট: `4d5185a` (মূল কাজ) · `cda0dc1` (মৃত CSS বাদ + rebuild) · `baca490` (Manager-এ এক পরিচয় কার্ড)
· `d50cca1` (ধাপ C ও D — gate + entry contract) · `f3765eb` (শেল টোকেন সম্পূর্ণ) · `7198c8a` (যাচাইয়ের সংখ্যা)

---

## ২। Universal স্ক্রিন-তালিকা

| স্ক্রিন | Admin | Teacher | Manager | Payment |
| --- | --- | --- | --- | --- |
| প্রোফাইল (পরিচয় কার্ড + নিজের তথ্য সম্পাদনা) | `profile` (`#adminProfileCard`) | `profile` (`#teacherProfileCard`) | `profile` (`#managerProfileCard`) | `profile` (`#payOwnProfileCard`) |
| সেটিংস হাব (৫ গ্রুপ) | `settings` subgroup `data-settings-hub="admin"` | `settings` (`#teacherSettingsHub`) | `settings` (`data-settings-hub="manager"`) | `more` (`data-settings-hub="payment"`) |
| অ্যাকাউন্ট গ্রুপ | ইনলাইন: `#adminProfileForm` · `#adminPasswordForm` · `#adminAccountLogout` | `#teacherProfileForm` · `#teacherPasswordForm` · `#teacherAccountLogout` | `#managerProfileForm` · `#managerPasswordForm` · `#managerAccountLogout` | `#paymentProfileForm` · `#paymentPasswordForm` · `#payMoreLogout` |
| নোটিফিকেশন গ্রুপ | `js/notification-settings.js` (একই মাউন্ট) | একই | একই | একই |
| অ্যাপ · নিরাপত্তা · ডেটা | হাব-জেনারেটেড রো | একই | একই | একই |

সেটিংস গ্রুপের ক্রম চার প্যানেলে **হুবহু এক**: অ্যাকাউন্ট → নোটিফিকেশন → অ্যাপ → নিরাপত্তা → ডেটা
(`SETTINGS_GROUPS` — `js/settings-hub.js`)।

---

## ৩। Role visibility matrix (উদাহরণসহ)

| কাজ | Admin | Teacher | Manager | Payment | উদাহরণ |
| --- | --- | --- | --- | --- | --- |
| নিজের প্রোফাইল দেখা/বদলানো | ✅ | ✅ | ✅ | ✅ | `#paymentProfileForm` = `#adminProfileForm` |
| নিজের পাসওয়ার্ড | ✅ | ✅ | ✅ | ✅ | ইনলাইন ফর্ম (আগের ডায়ালগ নয়) |
| নোটিফিকেশনের ধরন/শব্দ/ইতিহাস | ✅ | ✅ | ✅ | ✅ | `noticeType_*` টগল |
| স্টাফ ব্যবস্থাপনা | ✅ `staff.manage` | ❌ | ❌ | ❌ | `admin.html`-এর `[data-admin-cap]` |
| রোল/পারমিশন | ✅ `roles.manage` | ❌ | ❌ | ❌ | শুধু Admin |
| ব্যাকআপ/মাইগ্রেশন/ডেটা | ✅ `backup.manage`, `data.manage` | ❌ | ❌ | ❌ | শুধু Admin |
| শিক্ষার্থী অনুমোদন | ✅ | ❌ | ✅ | ❌ | `registration-review.js` |
| একাডেমিক কাজ (হোমওয়ার্ক/উপস্থিতি/রুটিন) | ❌ | ✅ (নিজের স্কোপ) | ✅ | ❌ | `class-chat` তিন জনের, কাউন্টারের নয় |
| লেকচার শিট স্টুডিও | ✅ | ✅ | ✅ | ❌ | `content.lecture-sheets` |
| ফি আদায়/রিপোর্ট | ❌ | ❌ | আংশিক (approval) | ✅ `finance.collect` | `#payCollectionForm` শুধু Payment |

গেট এখন **দুই স্তরে** যাচাই হয়: (ক) DOM-এ সেই স্ক্রিন/বাটন নেই, (খ) থাকলেও কাজ করে না —
`tests/admin-panel-design.test.mjs` (রুট-নাম আইসোলেশন) + `tests/app-architecture.test.mjs` (প্যানেল-ভিত্তিক সারফেস)।

---

## ৪। যাচাই

- `tests/teacher-panel.test.mjs` — ১৮/১৮ (দুই স্ক্রিন, গ্রুপ-মেনু re-entry, ৫ কার্ড)
- `tests/settings-structure.test.mjs` · `payment-desk` · `more-reports` · `app-architecture` · `admin-panel-design` · `semantic-icons` — সব সবুজ
- পূর্ণ স্যুট (শাখা): **1492 টেস্ট — 1464 pass / 25 fail / 3 skipped**;
  প্রিস্টিন `d13dec8` worktree-এ একই স্যুট: **1484 — 1456 / 25**।
  ব্যর্থতার নামের সেট **হুবহু এক** (`comm` ⇒ নতুন ০, ঠিক হওয়া ০) — সবই আগের
  ২৫টি ব্যর্থতা (manager 360px, ID reveal, wallet skin palette, boot/precache budget, sync)।
- নতুন স্যুট: `tests/panel-capabilities-2026-11-02.test.mjs` — ৮/৮

---

## ৫। ধাপ C ও D (এখন সম্পূর্ণ)

### C — এক এন্ট্রি-চুক্তি, এক permission gate

নতুন `js/panel-capabilities.js`, চার প্যানেলে একই কোড:

- `data-panel-entry="notice|lecture|chat|report"` — নোটিশ, লেকচার শিট, চ্যাট ও রিপোর্টের
  এন্ট্রি এখন একই চুক্তি (কার্ড: শিরোনাম + এক-লাইন সাবটাইটেল + আইকন; শর্টকাট: আইকন + নাম)।
- `data-cap="capability"` — অনুমতি না থাকলে এলিমেন্ট **লুকানো + নিষ্ক্রিয়** (DOM-এ থাকে,
  ক্লিক/ফোকাস/স্ক্রিন-রিডার কোনোটাতেই নাগাল নেই), অনুমতি ফিরলে হুবহু আগের অবস্থায়।
- নতুন capability নেই: শুধু `ROLE_CAPABILITIES`। বাস্তবে গেট করা এন্ট্রি = **লেকচার শিট**
  (`content.lecture-sheets` → Admin · Teacher · Manager; ক্যাশ কাউন্টারে নেই)।
- চার প্যানেলের ক্লিক-হ্যান্ডলার নিজেও blocked দরজা এড়ায় (`data-gate-blocked`)।

### D — হোমের দরজা রুল-ভিত্তিক

`applyHomeDoorRules()` হোম স্ক্রিনের প্রতিটি দরজা প্যানেলের **নিজের রুট-তালিকা** দিয়ে যাচাই
করে (`TEACHER_VIEWS` · `MANAGER_VIEWS` · `COUNTER_VIEWS` · `VIEW_CAPABILITIES`) — তালিকার
বাইরের দরজা লুকানো, ফিরে এলে আবার দেখানো। Admin-এর নিজের `data-admin-cap` ব্যবস্থা অপরিবর্তিত।

**যাচাই:** `tests/panel-capabilities-2026-11-02.test.mjs` — **৮/৮ সবুজ**।

### এখনো বাকি (ইচ্ছাকৃত, কারণ এগুলো নতুন capability দাবি করে)

- নোটিশ/চ্যাট/রিপোর্টের জন্য capability **বানানো হয়নি** (মালিকের শর্ত: নতুন capability নয়) —
  তাই ওই এন্ট্রিগুলো প্যানেলের রুট-টেবিলে চলে, এবং ক্যাশ কাউন্টারের DOM-এ সেগুলোই নেই।
- **(সম্পন্ন) B — শেল টোকেন:** `--t-hero-min-h`, `--t-radius-hero`, `--t-radius-tile`,
  `--t-back-size`, `--t-gap-card` — পেমেন্ট হিরো/কার্ড/ব্যাক-চিপ/স্ট্যাক আর
  হার্ডকোডেড সংখ্যা ব্যবহার করে না।
- ফন্ট-স্কেল (font-size clamp) এখনো প্যানেলভেদে আলাদা লেখা — এটা পরের ধাপের কাজ।

## 2026-11-03 owner-policy and verification addendum

- চারটি staff role-এ একই Active Plus light/dark palette প্রযোজ্য; role marker কেবল layout/navigation scope নির্ধারণ করে, আলাদা role-colour নয়।
- ভর্তি অনুমোদন Admin ও Manager—দুই ভূমিকাই করতে পারে। পরীক্ষার ক্ষেত্রে Admin-এর পূর্ণ authoring/question-bank/review/approval/publish/result/lifecycle control এবং Manager-এর বিদ্যমান management control রাখা হয়েছে; Teacher নিজের scope-এ পরীক্ষা তৈরি/সম্পাদনা করতে পারে।
- Admin-এর Academic section-এ exam-management entry যুক্ত হয়েছে। `audit-exam` route এখন Academic seat-এর সঙ্গে যুক্ত এবং direct deep-link-ও `exams.publish` capability দিয়ে gate হয়।
- Student enrollment ও exam review-এর server-side callable-এ Admin/Manager role যাচাই করা হয়; Firestore/Realtime Database schema বা Cloud Storage যোগ করা হয়নি।
- Capability gate unblock হলে আগের `hidden`, `disabled`, `aria-hidden` ও `tabindex` state পুনরুদ্ধার করে; আগে থেকে disabled/hidden control ভুল করে সক্রিয় বা প্রকাশ পাবে না।
- Test coverage বাড়ানো হয়েছে: Admin exam workflow, question-bank access, staged Student approval, four-role keyboard navigation, shared palette, capability-state restoration, Admin Academic exam entry এবং Admin home shortcut priority।
- Shared notification center এখন Student, Admin, Manager, Teacher ও Payment—সব panel-এ session-ready হওয়ার পর lazy-load হয়; প্রথম পেইন্টে বড় notification bundle যোগ হয় না। Admin/Manager inbox-এ pending exam review, published exam ও result updates সঠিক panel route-সহ আসে; Admin-এর notification shortcut home থেকেই খোলে।
- CI workflow এখন `npm test`, `npm run test:e2e:local`, তারপর `node tools/load-budget.mjs` চালায়। সর্বশেষ সম্পন্ন CI run-এ 1510 tests-এর মধ্যে 1501 pass, 5 fail, 4 skipped ছিল; ওই পাঁচটি assertion সংশোধন করা হয়েছে। নতুন GitHub Actions run #617 বর্তমানে `npm test` ধাপে চলছে; ফল না আসা পর্যন্ত সব পরীক্ষা সফল বলা হচ্ছে না। Load-budget ওই পুরোনো run-এ skip হয়েছিল।
- Branch `main` থেকে 174 commits ahead (57 files changed); full diff scope review না হওয়া পর্যন্ত PR Draft থাকবে এবং production deploy/merge করা হবে না।