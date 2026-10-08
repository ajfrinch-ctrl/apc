# Realtime Database রিবিল্ড রানবুক — সিঙ্ক চালু করার নিশ্চিত ক্রম (২০২৬-১০-০৮)

সিঙ্ক কাজ করছে না এমন অবস্থা থেকে **নতুন করে Database instance + Rules deploy** করার
সম্পূর্ণ পদ্ধতি। কোড-সাইড অডিট ও এই রাউন্ডের পরিবর্তনগুলোর প্রমাণ:
`FIREBASE-RTDB-AUDIT-2026-10-08.md`।

> **সংক্ষেপে স্থাপত্য:** অ্যাপ (শিক্ষার্থী/শিক্ষক/এডমিন/ম্যানেজার/পেমেন্ট — পাঁচটি প্যানেল)
> Firebase **Anonymous Auth** দিয়ে সাইন-ইন করে `activePlusSync/v1/*`-এ পড়ে-লেখে
> (`auth != null` রুল; পাসওয়ার্ড কখনোই খোলা যায় না — শুধু PBKDF2 hash)। রিয়েলটাইম
> `onValue` listener-ই সিঙ্কের ইঞ্জিন — রিলোড/রিফ্রেশ লাগে না। প্রজেক্ট:
> **`active-plus-coaching`**, instance **`active-plus-coaching-default-rtdb`**,
> অঞ্চল **asia-southeast1 (Singapore)**।

---

## ধাপ ০ — আগে ডায়াগনোস্টিক চালান (১ মিনিট)

লগইন পেজের ডায়াগনোস্টিক বাটন (**«সিঙ্ক সংযোগ পরীক্ষা»**) মালিকের সিদ্ধান্তে ২০২৬-১০-০৮-এ সরানো হয়েছে। এখন লক্ষণ দেখে মিলিয়ে নিন — কোন স্তরে সমস্যা হলে সমাধান পাশে:

| ধাপ যেখানে FAIL | অর্থ | সরাসরি সমাধান |
| --- | --- | --- |
| `config` | `firebase/firebase-config.js` অসম্পূর্ণ | রিপোর্ট করুন — কনফিগ বসাতে হবে |
| `anonymous-auth` | Anonymous sign-in **বন্ধ** | ধাপ ২ |
| `socket` | Database instance-ই নেই / URL-অঞ্চল ভুল / নেটওয়ার্ক ব্লক | ধাপ ১ |
| `rules-read` | Rules deploy হয়নি (ডিফল্ট locked rules) | ধাপ ৩ |
| `rules-write-probe` | পুরনো rules-এ probe path নেই | ধাপ ৩ (নতুন rules deploy) |

লক্ষণ: লগইন পেজের লাল ব্যানার «ইন্টারনেট সংযোগ দরকার» = ক্লাউড যাচাই ব্যর্থ (নেট/rules)।
টপবারের উপরের বর্ডার: লাল = অফলাইন, সবুজ = শুধু নেট, নীল = সিঙ্ক লাইভ।


---

## ধাপ ১ — Database instance যাচাই / তৈরি

1. [Firebase Console](https://console.firebase.google.com) → প্রজেক্ট **`active-plus-coaching`**।
2. **Build → Realtime Database**:
   - instance **আছে** কিনা দেখুন। না থাকলে **Create Database**:
     - Name: `active-plus-coaching-default-rtdb`
     - Location: **asia-southeast1 (Singapore)** ← এটাই গুরুত্বপূর্ণ; ভুল অঞ্চলে বানালে
       অ্যাপের `databaseURL` আর মিলবে না, socket কখনোই connect হবে না।
   - থাকলে ডেটা ট্যাবে গিয়ে URL দেখুন, নিচেরটির সাথে মিলিয়ে নিন:
     ```
     https://active-plus-coaching-default-rtdb.asia-southeast1.firebasedatabase.app
     ```
3. "Locked mode"-এ Create করলেও চলবে — পরের ধাপেই আমরা সঠিক rules বসাচ্ছি।

### পুরোনো ডেটা পুরোপুরি মুছে নতুন শুরু চাইলে (ঐচ্ছিক)

> ⚠️ এটি **অপরিবর্তনীয় (undo নেই)**। আগে **Export JSON** করে ব্যাকআপ নিন।

- Console → Realtime Database → **Data** ট্যাব → ডান-উপরের ⋮ মেনু →
  **Delete data / সব ডেটা মুছুন** অথবা root নোড মুছে দিন।
- CLI দিয়েও মোছা যায়: `firebase database:remove / --project active-plus-coaching`
- **মোছার পরে করণীয় (গুরুত্বপূর্ণ):** ডেটা প্রতিটি ডিভাইসে লোকালি আছে। Rules deploy
  শেষে **প্রতিটি ডিভাইসে (Admin প্রধান ডিভাইস আগে) অ্যাপ একবার খুলে অনলাইনে রাখুন** —
  ব্রিজ নিজে থেকেই সমস্ত রেকর্ড ক্লাউডে আবার seed করবে (seed অপারেশন ক্লাউডে থাকা
  রেকর্ড কখনো ভাঙে না)। নতুন ডিভাইসে হলে: আগে Admin ডিভাইস খুলুন, তারপর নতুনটি।
- **এই সংস্করণে নতুন:** কনসোল থেকে মোছার বদলে এডমিন প্যানেল → ডেটা → **সম্পূর্ণ ডাটাবেজ রিসেট** ব্যবহার করা যায় — ক্লাউড ও লোকাল দুই দিকই মুছে লগইন পেজে নতুন এডমিন তৈরির ফ্লো ফিরিয়ে আনে; বিস্তারিত `docs/FACTORY-RESET.md`।

## ধাপ ২ — Anonymous Authentication চালু

Console → **Build → Authentication → Sign-in method → Anonymous → Enable → Save**।

না করলে `signInAnonymously()` ব্যর্থ হয় (`auth/operation-not-allowed` /
`auth/admin-restricted-operation`) এবং `auth != null` শর্তের কারণে **সব পড়া-লেখা বন্ধ**।

## ধাপ ৩ — Rules deploy (পুরনো rules প্রতিস্থাপন)

রিপোজিটরি রুট থেকে (`.firebaserc` প্রজেক্ট pin করে রেখেছে):

```bash
firebase deploy --only database
```

- এটি **`database.rules.json`** পাঠায় (firebase.json-এ pin করা) — পুরনো/ভুল/Deny-all
  rules এর উপর বসে যাবে, আলাদা করে কিছু «ডিলিট» করার দরকার নেই।
- ⚠️ **কখনোই `database.rules.v2.draft.json` deploy করবেন না** — সেই খসড়ায়
  `activePlusSync` পুরো বন্ধ; এটি ভবিষ্যৎ per-user মাইগ্রেশনের জন্য
  (`docs/RTDB-PER-USER-RULES-PLAN.md`)। ভুল deploying = সিঙ্ক বন্ধ।
- ⚠️ **কখনোই `".read": true, ".write": true` দিয়ে «টেস্ট» করবেন না।**
- যাচাই: Console → Realtime Database → **Rules** ট্যাবে গিয়ে দেখুন সেখানে
  `activePlusSync` ও `system/connectivityProbe` আছে (নতুন rules-এর চিহ্ন), আর Published
  সময় এখনকার।

## ধাপ ৪ — App Check দ্বন্দ্ব নেই কিনা

- `APP_CHECK_SITE_KEY` এখন খালি (`firebase/firebase-config.js`) → তাই Console →
  **App Check → APIs → Realtime Database**-এ **Enforce চালু থাকা যাবে না**।
  চালু থাকলে সব request 401 হয়ে যাবে — হয় enforcement বন্ধ করুন, নয় site key বসিয়ে
  App Check চালু করুন (নির্দেশনা `FIREBASE_SETUP.md`)।

## ধাপ ৫ — যাচাই (২ মিনিট)

1. যেকোনো প্যানেলে **টপবারের উপরের বর্ডার নীল** = সিঙ্ক লাইভ (লাল = অফলাইন, সবুজ = শুধু নেট)।
2. লগইন পেজে ডায়াগনোস্টিক বাটন আর নেই (২০২৬-১০-০৮-এ সরানো) — যাচাইয়ের জন্য কনসোলের Data ট্যাব ও নিচের দুই-ডিভাইস টেস্ট ব্যবহার করুন।
3. **দুই ডিভাইস টেস্ট:** ডিভাইস A-তে একটি Notice/শিক্ষার্থী বদলান → কয়েক সেকেন্ডে
   ডিভাইস B-তে রিলোড ছাড়াই দেখা যাওয়া উচিত।
4. Console → Data ট্যাবে `activePlusSync/v1`-এর নিচে `staffAccounts`, `staffDirectory`,
   `usernames`, `studentAccounts`, `examDb`, `settings`, `students`… দেখা যাবে।

---

## ব্যর্থতা → সমাধান সারণী

| লক্ষণ | সম্ভাব্য কারণ | সমাধান |
| --- | --- | --- |
| সবসময় «connecting»/error, console-এ `permission-denied` | Rules deploy হয়নি / v2 খসড়া deploy হয়ে গেছে | ধাপ ৩ |
| `auth/operation-not-allowed` বা `admin-restricted-operation` | Anonymous auth বন্ধ | ধাপ ২ |
| কিছুতেই socket connect হয় না (`firebaseConnection: disconnected`) | instance নেই / region ভুল / DNS-Ad-blocker | ধাপ ১; Ad-blocker বন্ধ |
| সব request 401 | RTDB-তে App Check enforced, অথচ site key খালি | ধাপ ৪ |
| অ্যাপই পুরনো সংস্করণে আটকে আছে (নতুন কিছুই আসে না) | আগের service worker-এ একটি precache ফাইল 404 ছিল (এবার ঠিক হয়েছে, cache 184) | অ্যাপ দুইবার reload; কঠোর হলে site data clear |
| এক ডিভাইসের ডেটা অন্যটিতে দেখা যায় না | কোনো একটি ডিভাইস অনলাইনে আসেনি / সিঙ্ক ব্যর্থ ছিল | দুটি ডিভাইসই একবার অনলাইনে খুলুন; তারপরও না হলে ধাপ ০ |

---

## এই রাউন্ডে কোডে যা বদলেছে (২০২৬-১০-০৮)

1. **`sw.js`** — precache তালিকায় থাকা অবিদ্যমান `css/staff-management.css` অপসারণ
   (install ব্যর্থ হওয়ার কারণ ছিল) + `CACHE_VERSION` 183→184।
2. **`database.rules.json`** — রিজেনারেটেড; যোগ হয়েছে ডায়াগনোস্টিক probe path
   `system/connectivityProbe/$probeKey` (শুধু `{at:number}`, extra child নিষিদ্ধ,
   ৬৪-অক্ষরের দীর্ঘ key নিষিদ্ধ)। বাকি সব নোড অপরিবর্তিত।
3. **`js/firebase-diagnostics.js`** — লগইন-session-গেট সরানো (নতুন ডিভাইসেও চলে),
   ধাপভিত্তিক প্রতিবেদন + প্রতিটি ব্যর্থতার নির্দিষ্ট বাংলা সমাধান, write probe।
4. **`js/firebase-online-test.js`** — একই গেট সরানো।
5. **`js/firebase-diagnostic-ui.js`** — ধাপ ও সমাধান দেখায়; আর `index.html`
   এখন এটি আসলেই লোড করে (আগে মডিউলটি কোনো পেজে যুক্তই ছিল না — বাটনটি
   ব্যবহারকারীর কাছে পৌঁছাতোই না)।
6. **`FIREBASE_SETUP.md`** — পুরনো প্রজেক্ট `active-plus`-এর রেফারেন্স সারানো,
   v2 খসড়া-নিরাপত্তা সতর্কতা।
7. **টেস্ট** — probe path-কে কভারেজ ও refused-তালিকায় যোগ (`tests/interim-sync-rules.test.mjs`,
   `tests/rtdb-path-coverage.test.mjs`)।

রুল ফাইলটি হাতে সম্পাদনা নয় — জেনারেটর থেকে আসে:
`node tools/rtdb-rules/build-interim-rules.mjs` (টেস্টে বাইট-মিল যাচাই আছে)।
