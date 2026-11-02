
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

পেমেন্ট শেলের মার্কআপ (`pay-*`) আলাদাই থাকে — কিন্তু হিরোর উচ্চতা ও ব্যাসার্ধ
এখন এই টোকেন থেকেই আসে (`var(--t-hero-min-h)`, `var(--t-radius-hero)`), আলাদা
সংখ্যা নেই।

### ১০.৫ যা এখনো বাকি (পরবর্তী ধাপ)

- **C** — নোটিশ/লেকচার/চ্যাট/রিপোর্টের এন্ট্রি-কার্ড এক প্যাটার্নে ও capability gate
  (`data-cap`) দিয়ে বাঁধা: কাঠামো এক, কিন্তু গেট এখনো Admin-এর `data-admin-cap`-এ সীমিত।
- **D** — হোম টাইলের রুল-ভিত্তিক লুকানো (অনুমতি নেই এমন টাইল DOM-এ না রাখা)।
