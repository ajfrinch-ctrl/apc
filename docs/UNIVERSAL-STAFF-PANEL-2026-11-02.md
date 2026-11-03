
## ১০। Universal staff panel (মালিক-নির্দেশ ২০২৬-১১-০২)

Admin · Teacher · Manager · Payment — চারটি স্টাফ প্যানেল এখন **একই অ্যাপ**:
একই শেল, একই নেভিগেশন-রিদম, একই সেটিংস হাব, একই প্রোফাইল স্ক্রিন, একই এন্ট্রি-কার্ড।
পার্থক্য শুধু **কনটেন্ট ও অনুমতি** — কোন স্ক্রিন দেখা যাবে আর কোন বাটন কাজ করবে।

### ১০.১ এক রুট-নাম, চার প্যানেল

| আগে | এখন |
| --- | --- |
| `data-teacher-view` · `data-manager-view` · `data-admin-view` · `data-pay-section` | `data-panel-view` (সব স্টাফ প্যানেল) |
| Student | `data-view` (অপরিবর্তিত) |

`data-panel-view` এখন একমাত্র স্টাফ route attribute; DOM-এ `dataset.panelView`।
আইসোলেশন এখন শেল/বডি-ক্লাস ও **রুট-নামের** স্তরে যাচাই হয় (কোনো প্যানেল অন্যের স্ক্রিন-নাম
ধারণ করে না), attribute-নামের স্তরে নয় — `tests/admin-panel-design.test.mjs`।

### ১০.২ প্রোফাইল আর সেটিংস — দুই স্ক্রিন, দুই কাজ

| স্ক্রিন | কী থাকে | কী থাকে না |
| --- | --- | --- |
| **প্রোফাইল** (`#teacherProfile`, `#managerProfile`, `#payProfileOwnPanel`, Admin `data-view-panel="profile"`) | পরিচয় কার্ড + “নিজের তথ্য সম্পাদনা” | পাসওয়ার্ড, নোটিফিকেশন, থিম |
| **সেটিংস** (`settings` রুট) | পাঁচ গ্রুপের মেনু, এক ক্লিকে **একটাই** গ্রুপ | `সব বিভাগ` চিপ-সারি (বিলুপ্ত), একই স্ক্রিনে প্রোফাইল এডিটর |

### ১০.৩ অ্যাকাউন্ট গ্রুপের একমাত্র রূপ

`js/staff-account-forms.js` চার প্যানেলের অ্যাকাউন্ট গ্রুপে **হুবহু একই** ফর্ম বসায়
(Admin-এর আগের ইনলাইন রূপটাই ক্যানন):

1. **আমার তথ্য হালনাগাদ** (`#{role}ProfileForm`) — নাম · মোবাইল · ইমেইল · লগইন আইডি (লকড)
2. **নিজের পাসওয়ার্ড বদল** (`#{role}PasswordForm`) — বর্তমান · নতুন · নিশ্চিতকরণ
3. **সেশন + লগআউট** (`#{logoutId}`) — প্যানেলের নিজের id অপরিবর্তিত

`data-settings-row="profile|password|logout"` — row key চার প্যানেলে একই, তাই
`js/settings-hub.js` কখনো দ্বিতীয় কন্ট্রোল বানায় না (idempotent)।

### ১০.৪ শেল টোকেন

`css/ui-wallet.css`-এ এক টোকেন-সেট, চার স্কোপ:

```css
:is(.teacher-reference, .manager-reference, .admin-reference, .payment-reference) {
  --t-radius-tile: 20px; --t-radius-card: 22px; --t-radius-hero: 26px;
  --t-radius-chip: 999px; --t-ease: cubic-bezier(.33,.05,.28,1);
  --t-hero-min-h: 236px;            /* ≤380px: 220px */
}
```

পেমেন্ট শেলের মার্কআপ (`pay-*`) আলাদাই থাকে — কিন্তু মাপ এখন এই টোকেন থেকেই আসে:

| টোকেন | কোথায় | আগে |
| --- | --- | --- |
| `--t-hero-min-h` | চার প্যানেলের হিরো (উচ্চতা) | পেমেন্টে হার্ডকোডেড `212px` |
| `--t-radius-hero` | হিরো কার্ডের ব্যাসার্ধ | হার্ডকোডেড `26px` |
| `--t-radius-tile` | `.admin-view/.manager-view/.pay-panel` কার্ড | হার্ডকোডেড `20px` |
| `--t-back-size` | `.pay-back` ব্যাক-চিপ | হার্ডকোডেড `40px` |
| `--t-gap-card` | `.teacher-home-actions` অ্যাকশন-স্ট্যাক | `gap-3` (১২px) |

কোনো প্যানেলের জন্য আলাদা সংখ্যা লেখা হয় না — শুধু ভূমিকা-ভিত্তিক স্কোপ।

### ১০.৫ ধাপ C — এক এন্ট্রি-চুক্তি, এক permission gate

`js/panel-capabilities.js` চার প্যানেলের একমাত্র gate:

| চিহ্ন | অর্থ |
| --- | --- |
| `data-panel-entry="notice" \| "lecture" \| "chat" \| "report"` | ফিচার-এন্ট্রির এক চুক্তি: কার্ডে শিরোনাম + এক-লাইন সাবটাইটেল + আইকন, শর্টকাটে আইকন + অ্যাক্সেসিবল নাম |
| `data-cap="capability"` | এই এলিমেন্ট দেখাতে capability লাগবে (স্পেস দিলে যেকোনোটি) |

gate অনুমতি না পেলে এলিমেন্ট **লুকায় + নিষ্ক্রিয় করে** (`hidden`, `aria-hidden`,
`tabindex="-1"`, `disabled`) — DOM-এ থাকে, তাই অনুমতি পেলে হুবহু ফিরে আসে; কিন্তু
ক্লিক/কিবোর্ড/স্ক্রিন-রিডার কোনোটাতেই কাজ করে না। চার প্যানেলের ক্লিক-হ্যান্ডলার
নিজেও `data-gate-blocked` দরজা এড়িয়ে যায়, তাই ডিভ-টুলস দিয়ে দেখিয়েও কিছু করা যায় না।

নতুন কোনো capability বানানো হয়নি — সবটাই `js/admin-permissions.js`-এর
`ROLE_CAPABILITIES`। আজ শুধু **লেকচার শিট** এন্ট্রির সত্যিকারের capability আছে
(`content.lecture-sheets`), তাই ক্যাশ কাউন্টারে সেটি নেই; নোটিশ/চ্যাট/রিপোর্টের
এন্ট্রি ওই প্যানেলের রুট-টেবিলই ঠিক করে (নতুন নিয়ম বানানো নিষিদ্ধ)।

### ১০.৬ ধাপ D — হোমের দরজা রুল-ভিত্তিক

`applyHomeDoorRules({root, role, routes})` হোম স্ক্রিনের প্রতিটি `[data-panel-view]`
দরজা যাচাই করে **প্যানেলের নিজের রুট-তালিকা** দিয়ে (`TEACHER_VIEWS` ·
`MANAGER_VIEWS` · `COUNTER_VIEWS` · `Object.keys(VIEW_CAPABILITIES)`):
তালিকার বাইরের বা gate-blocked দরজা লুকানো হয়, ফিরে এলে আবার দেখানো হয়।
Admin-এর পুরোনো `data-admin-cap` (role-এর ভেতরের ভূমিকা-ব্যবস্থা) অপরিবর্তিত;
তার উপরে একই কোড একই আচরণ দেয়।

চুক্তি যাচাই: `tests/panel-capabilities-2026-11-02.test.mjs` (৮টি পরীক্ষা)।

## 2026-11-03 update

চারটি staff role এখন একই Active Plus light/dark palette ব্যবহার করে; role marker শুধু shared layout scope নির্ধারণ করে। Admin-এর Academic tab-এ exam-management workspace রয়েছে এবং Admin ও Manager ভর্তি/পরীক্ষা অনুমোদন করতে পারেন। Admin-এর exam, question-bank ও result controls role capability দিয়ে gate করা।