# Universal Staff Panel — রিপোর্ট (২০২৬-১১-০২)

**শাখা:** `arena/fabc17fa-apc` · **ক্যাশ ভার্সন:** ৪৫৭ → **৪৫৮** · **স্ট্যাটাস:** A ও B সম্পূর্ণ, C ও D বাকি (§৫)

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
 CSS: css/foundation.css (টোকেন) · css/ui-wallet.css (হিরো tokenised) · css/teacher-panel.css (rebuild)
```

কমিট: `4d5185a` (মূল কাজ) · `cda0dc1` (মৃত CSS বাদ + rebuild) · `baca490` (Manager-এ এক পরিচয় কার্ড)

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
- পূর্ণ স্যুট: `1450+ pass`, ব্যর্থতাগুলো **প্রিস্টিন HEAD-এর সাথে `diff` করে** যাচাই করা হচ্ছে (নিচে হালনাগাদ)

---

## ৫। যা এখনো বাকি (স্পষ্ট করে)

- **C — এন্ট্রি-প্যাটার্ন + capability gate:** নোটিশ/লেকচার/চ্যাট/রিপোর্টের কার্ড এখন একই
  `.teacher-action-card` প্যাটার্নে, কিন্তু role-capability গেট (`data-cap`) এখনো শুধু Admin-এ।
  Teacher/Manager-এর বাটন এখনো role-ভিত্তিক প্যানেল-বাউন্ডারিতে চলে, capability ম্যাপে নয়।
- **D — হোম টাইল রুল-ভিত্তিক:** অনুমতি নেই এমন টাইল DOM থেকে সরানো হয়নি; এখনো প্যানেলভেদে
  স্ট্যাটিক।
