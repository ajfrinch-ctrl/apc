# Firebase Realtime Sync — পূর্ণাঙ্গ ডাটাবেস + Rules অডিট (লাইন-বাই-লাইন)

তারিখ: ২০২৬-১০-০৮ · ব্রাঞ্চ: `arena/e70893d5-apc` · বেস: `e62c68f (main @ PR #52)`

সমস্যা-বিবৃতি: «রিয়েলটাইম সিঙ্ক হচ্ছে না।» এই অডিটে ডাটাবেসের **প্রতিটি পাথ**, ক্লায়েন্টের
**প্রতিটি read/write/listen সাইট**, **দুটি rules ফাইল**, **Cloud Functions** ও **service worker**
পর্যন্ত ধরা হয়েছে — এবং এই রাউন্ডে যে পাঁচটি বাস্তব সমস্যা পাওয়া গেছে তার সবগুলোই ঠিক করে
টেস্ট-প্রমাণ দেওয়া হয়েছে।

---

## ০. সংক্ষেপ (TL;DR)

| # | যা পাওয়া গেছে | ধরন | অবস্থা |
| --- | --- | --- | --- |
| F1 | সিঙ্ক-ব্যর্থতার মূল কারণ সেটি **ডিপ্লয়-সাইড**: কোড ও rules-এর মিল সম্পূর্ণ — নতুন প্রজেক্টে (অক্টোবর ৬-এর মাইগ্রেশন) rules deploy নয় / locked ডিফল্ট / v2 খসড়ার ভুল deploy / Anonymous auth বন্ধ / instance নেই / App Check enforced — যেকোনো একটিই ব্রিজ মেরে ফেলে | ডিপ্লয়মেন্ট | **রানবুক** `docs/RTDB-REBUILD-RUNBOOK.md` — ধাপে ধাপে নতুন DB + rules deploy + যাচাই |
| F2 | **`sw.js`-এর precache তালিকায় অবিদ্যমান `css/staff-management.css`** — এক ফাইল 404 হলেই পুরো install ব্যর্থ → ডিভাইসে পুরনো service worker আটকে থাকে, নতুন ফিক্স/কনফিড কোনো ডিভাইসেই পৌঁছায় না | প্রোডাকশন বাগ | **ঠিক** — এন্ট্রি সরানো + `CACHE_VERSION 183→184` |
| F3 | লগইন পেজের **«সিঙ্ক সংযোগ পরীক্ষা» টুল session-গেটের ভুলে** ঠিক সেই ডিভাইসে অকেজো ছিল যেখানে সবচেয়ে দরকার (কোনো অ্যাকাউন্ট নেই এমন নতুন ডিভাইস): `hasSyncSession` false মানে তৎক্ষণাৎ `authentication-required` | ডায়াগনোস্টিক বাগ | **ঠিক** — গেট সরানো; ধাপভিত্তিক প্রতিবেদন + write probe + নির্দিষ্ট সমাধান |
| F4 | rules-এ **write-যাচাইয়ের কোনো নিরাপদ পাথ ছিল না** — ডিপ্লয় ঠিকমতো হয়েছে কিনা ক্লায়েন্ট থেকে জানার উপায় ছিল না | rules গ্যাপ | **ঠিক** — `system/connectivityProbe/$probeKey` (শুধু `{at:number}`, extra child/৬৪+ অক্ষরের key নিষিদ্ধ) |
| F4b | **`firebase-diagnostic-ui.js` কোনো পেজেই লোড হচ্ছিল না** — ডায়াগনোস্টিক বাটনটি precache তালিকায় রেখে বাস্তবে dead-code ছিল | ডেড কোড | **ঠিক** — `index.html`-এ লোডার যুক্ত (version-stamped) |
| F5 | **`FIREBASE_SETUP.md` পুরনো প্রজেক্ট** (`active-plus`, us-central1 URL) দেখিয়ে বিভ্রান্তি সৃষ্টি করছিল | ডকুমেন্টেশন | **ঠিক** — নতুন প্রজেক্ট/URL অনুযায়ী + «v2 খসড়া deploy নিষেধ» সতর্কতা |
| — | কোড ↔ `database.rules.json` পাথ-কভারেজ: ১১টি listener পাথ-ই পঠনযোগ্য, ২২টি write পাথ-ই (ডিলিটসহ) অনুমোদিত — জেনারেটর-আউটপুটের সাথে বাইট-মিল | যাচাই | **PASS** (`tests/rtdb-path-coverage.test.mjs`, `tests/interim-sync-rules.test.mjs`) |
| — | **শিক্ষা:** কোনো পাথের নাম/গঠন বদলানো যাবে না — ডেটা-শেইপ পুরো অ্যাপের স্কিমা। তাই «পুরনো রুল ডিলিট» = ভুল rules সরিয়ে যাচাইকৃত rules deploy করাই; ডেটা মোছা ঐচ্ছিক ও আলাদা সিদ্ধান্ত (রানবুক ধাপ ১) | স্থাপত্য সিদ্ধান্ত | — |

> **আমার পক্ষে যাচাই সম্ভব নয় যেটি:** এই স্যান্ডবক্স থেকে প্রোডাকশন Firebase প্রজেক্টে পৌঁছানো যায় না —
> কনসোলের প্রকৃত অবস্থা (rules কি আসলে deploy আছে, Anonymous auth চালু কিনা, instance আছে কিনা)
> অবশ্যই রানবুকের ধাপ ০–৫ দিয়ে যাচাই করতে হবে। লগইন পেজের ডায়াগনোস্টিক এখন প্রতিটির
> ইংরেজি-কোডসহ বাংলা সমাধান দেখায়।

---

## ১. স্তর-বাই-স্তর অডিট

### ১.১ কনফিগরেশন স্তর

| ফাইল:লাইন | কী আছে | রায় |
| --- | --- | --- |
| `firebase/firebase-config.js:1-21` | একমাত্র config source; `databaseURL = https://active-plus-coaching-default-rtdb.asia-southeast1.firebasedatabase.app` | ✅ নতুন প্রজেক্টের সাথে সামঞ্জস্যপূর্ণ |
| `firebase/firebase-init.js:8` | একটিমাত্র `initializeApp` (idempotent); App Check কী খালি হলে স্কিপ | ✅ |
| `firebase/firebase-services.js:1-8` | SDK import একটিমাত্র surface (auth/database/firestore/functions) | ✅ |
| `firebase-messaging-sw.js` | FCM worker-এর নিজস্ব config কপি — মাইগ্রেশনের সময় একই পরিচয়ে বদলানো | ✅ |
| `.firebaserc` | `projects.default = active-plus-coaching` | ✅ deploy গন্তব্য সঠিক |
| `firebase.json` | `database.rules.json` deploy হয়; ভি-টু খসড়া নয়; emulator কনফিগ আছে | ✅ প্রতিরোধ গার্ড টেস্টেও পিন করা |
| `js/firebase-config.js` | শুধু re-export (ড্রিফট-রোধী মন্তব্যসহ) | ✅ |
| `sync/cloud-access.js:11` | `LEGACY_CLOUD_ENABLED = true` — ব্রিজ সচেতনভাবে চালু | ✅ এর ফলে সিঙ্ক বন্ধ নয় |

### ১.২ Auth প্রবাহ

| সাইট | ক্যll | রায় |
| --- | --- | --- |
| `js/realtime-sync.js:150-169` (`ensureCloudAuth`) | `setPersistence → authStateReady → currentUser ?: signInAnonymously()` | ✅ এক device-এক persisted identity; ব্যর্থ হলে ব্রিজ বন্ধ নয়, retry থাকে |
| রুল-দিক | সব পাথে `auth != null` | ⚠️ **Anonymous provider বন্ধ থাকলে সবকিছু বন্ধ** — ডিপ্লয়-চেকলিস্ট ধাপ ২ |
| `sync/sync-session.js:6` (`hasSyncSession`) | অ্যাপ-সেশন: `loadAccount()+hasSession()` বা স্টাফ রোল | ✅ সিঙ্ক-ইঞ্জিনের গেট; ডায়াগনোস্টিকে ভুলভাবে পুনর্ব্যবহার ছিল → F3 |
| `sync/cloud-access.js:13-16` | `assertCloudAccess` | ✅ |

### ১.৩ ক্লায়েন্ট RTDB পৃষ্ঠা — প্রতিটি পাথ, দিক, রুল (মূল সারণি)

Root: `activePlusSync/v1`। উৎস: `js/realtime-sync.js` (র‍্যান্টাইম ব্রিজ), `js/push-notifications.js` (পুশ রেজিস্ট্রেশন),
`js/firebase-diagnostics.js` (ডায়াগনোস্টিক)।

| # | পাথ | ক্লায়েন্ট অপারেশন (সাইট) | সংশ্লিষ্ট রুল | রায় |
| --- | --- | --- | --- | --- |
| 1 | `staffAccounts/{admin\|manager\|teacher\|payment}` | `get` (L251), `set` (L283), `runTransaction` (L985 claim), `onValue` (`listenStaffRole` L840) | parent: `.read auth`; `$role: .write auth && newData.exists() && role∈শ্বেততালিকা` + validate `username/password` | ✅ ডিলিট অসম্ভব; ভুয়া রোল নিষিদ্ধ |
| 2 | `staffDirectory` | `get`, `runTransaction` (`syncDirectory` L316), `onValue` (L868) | `.read auth`; `.write auth && newData.exists()` + validate `hasChild('version')` | ✅ AES envelope লোকালে, ক্লাউডে plaintext রেকর্ড নয় |
| 3 | `usernames` | `get` (L452), merge `runTransaction` (L363), `onValue` (L873) | `.read auth`; `.write auth && newData.exists()` | ✅ খালি রেজিস্ট্রি overwrite কোডেই abort |
| 4 | `studentAccount` (লিগ্যাসি) | শুধু `get` (L488) | `.read auth`; লেখার রুল নেই | ✅ read-only migration — intentional |
| 5 | `studentAccounts/<encodedLoginId>` | `get` (L397/471/478), `runTransaction` (L397), `onValue` (L883) | parent `.read auth`; `$loginKey .write auth && newData.exists()` + validate `pinHash` | ✅ key percent-encoded (`username-sync-codec.js`) |
| 6 | `examDb/exams/<id>`, `examDb/attempts/<id>` | `get` রুট (L715), `set` প্রতি-আইডি (L601), **ডিলিট** `set(…, null)` (L609), `onValue` (L728) | `examDb .read auth`; আইডি-লেভেল `.write auth` + validate id/teacherId/status (exams), id/examId/studentId (attempts) | ✅ ডিলিটে validate স্কিপ — প্রকৃত ইঞ্জিন-সামঞ্জস্যপূর্ণ |
| 7 | `system/adminInitialized` | `get` (L927/952), `set(true)` (L954) | `system .read auth`; `.write auth && isBoolean` | ✅ মার্কার, সত্যের উৎস Admin রেকর্ড — দুটোই পড়া হয় (L920-949) |
| 8 | `system/connectivityProbe/<key>` | `set {at}`, তারপর `set null` (ডায়াগনোস্টিক) | **নতুন: F4** | ✅ 추가 — নিচে §৩.২ |
| 9 | `settings` | whole-node `get`/`runTransaction`/listener (`recordBridge` L747, `syncCollection` L774, `listenCollection` L1042) | `.read/.write auth`; per-child validate নেই | ✅ scalar ভ্যালু — validate ছাড়াটাই সঠিক |
| 10 | `students`, `transactions`, `notices`, `routine`, `teaching`, `academics`, `courseContent`, `teacherAssignments` | উপরের একই ব্রিজ (ট্রানজ্যাকশন-মার্জ, `applyLocally:false`) + `onValue` | প্রতিটিতে `.read/.write auth`; `$recordId` validate `hasChildren()` | ✅ রেকর্ড-সবসময়-অবজেক্ট চুক্তি: `sync-collections.js` উৎপাদনে বাধ্যতামূলক |
| 11 | `pushTokens/<deviceKey>` | `set` (প্রকাশ L144-148), `remove` (বন্ধ L161) — FCM বন্ধ অবস্থায় কোনো রাইট নেই | `$deviceKey .write auth`; validate token ২১–৪০৯৬ অক্ষর | ✅ read নেই (শুধু Functions পড়ে); কী `~`-এনকোডেড (`tokenPathKey`) |
| 12 | `.info/connected` | `onValue` (ব্রিজ + ডায়াগনোস্টিক) | built-in | ✅ |

**নোট:** `notifications`-স্টোর, সেশন, আউটবক্স, PBKDF2 আনসল্টেড সিক্রেট — ইচ্ছাকৃতভাবে
ডিভাইস-লোকাল (`js/database.js` `LOCAL_ONLY`); পরীক্ষা: `tests/rtdb-path-coverage.test.mjs`।
`questionBank` ভি-১ ব্রিজে নেই — এটি ভি-২-এর।

### ১.৪ অফলাইন/মার্জ ইঞ্জিন (রিয়েলটাইম সংগ্রহ)

| মডিউল | কাজ | রায় |
| --- | --- | --- |
| `js/record-sync.js` | durable outbox v2 — fingerprint view + pending ops; seed-প্রথম-সিঙ্ক ক্লাউড ভাঙে না; `cloudCopyIsNewer` স্ট্যাল-গার্ড | ✅ টেস্ট `tests/record-sync.test.mjs` |
| `js/sync-merge.js` | staff/student copy নির্বাচন নীতি | ✅ |
| `js/realtime-value-codec.js` | empty array/object/null ও key-এনকোড সংরক্ষণ | ✅ |
| `js/rtdb-keys.js` | নিষিদ্ধ-অক্ষরযুক্ত রেকর্ড আলাদা করে রিপোর্ট, পুরো ব্রিজ আটকায় না | ✅ |
| `js/realtime-sync-entry.js` | `_SYNC_` বুট: সেশন গেট → guard → core; ছয়-চ্যানেল retry/online/Linux | ✅ bfs |
| `js/realtime-sync.js:1110+` (`startRealtimeSync`) | allSettled বুট — একটি নোড ব্যর্থ হলেও listener বেঁচে থাকে; partial-retry, watchdog, reconnect-flush | ✅ |

### ১.৫ ভি-২ (staged) সীমানা

| আইটেম | অবস্থা |
| --- | --- |
| `sync/question-bank-v2-sync.js`, `question-bank-v2-policy.js` (`activePlusV2/*`) | কেবল non-anonymous + custom-claims (`role/status/teacherId/studentId`) থাকলে সক্রিয় — আজকের anonymous লগইনে **সম্পূর্ণ নিষ্ক্রিয়**; নিষ্ক্রিয় রাখার সিদ্ধান্ত `questionBankV2RetryDecision`-এ টেস্ট করা |
| `database.rules.v2.draft.json` | খসড়া; `firebase.json` এটা deploy করে না (গার্ড: `tests/rtdb-path-coverage.test.mjs` শেষ টেস্ট) — **`activePlusSync` গোটাটাই এতে বন্ধ**, তাই ভুলভাবে deploy করলে সিঙ্ক মরে যায় → F1-এর অন্যতম সম্ভাবনা, রানবুকে নিষেধাজ্ঞা |
| `tools/rtdb-rules/build-v2-draft.mjs` + `tests/rtdb-v2-draft-rules.test.mjs` (২৪ টেস্ট) + `functions/test/rtdb-rules.test.js` (emulator, খসড়ার জন্য authoritative) | সব পাস |

### ১.৬ Cloud Functions (`functions/index.js`)

| অংশ | RTDB-তে যা করে | রুল-সম্পর্ক |
| --- | --- | --- |
| push triggers (`pushNotice`, `pushBroadcast`, `pushExam`; L746-768) | `activePlusSync/v1`-এর `notices/{id}`, `settings`, `examDb/exams/{id}` watch | Admin SDK — rules-এর **বাইরে** (অগ্রাহ্য নয়) |
| `tokenEntries`/prune (L706-735) | `pushTokens` পড়ে/মুছে | Admin SDK — তাই ক্লায়েন্ট read-নেই রক্ষিত |
| v2 মাইগ্রেশন/প্রজেকশন (`adminProvisionV2Identities`, `adminMigrateStudentToV2`, `projectQuestionBankRecord` ইত্যাদি) | `activePlusV2/*` লেখে/পড়ে | Admin SDK — কাটওভার না হওয়া পর্যন্ত অকার্যকর |
| `DB_REGION = 'asia-southeast1'` | DB-অঞ্চলের সাথে মিল | ✅ |

### ১.৭ Firestore

`firestore.rules` ভবিষ্যৎ server-authorized ব্যাকএন্ডের; চালু অ্যাপে Firestore পড়ে শুধু
`sync/cloud-auth.js` (এখনো shipped login-এ wired নয়); Functions-এর লেখা Admin SDK দিয়ে।
**সিঙ্ক-প্রবাহে নেই — এ রাউন্ডে স্পর্শ করা হয়নি।**

### ১.৮ Service worker (বিতরণকারী স্তর)

`sw.js:106`-এ precache তালিকায় **ছিল না এমন** `./css/staff-management.css` —
`cache.addAll()` একটি 404-তেই সম্পূর্ণ install ব্যর্থ করে; install ব্যর্থ ⇒ নতুন SW কখনোই
activate হয় না ⇒ ডিভাইস পুরনো কোডেই থেকে যায় ⇒ সদ্য ঠিক হওয়া সিঙ্ক-ফিক্স ও কনফিগ-মাইগ্রেশন
ডিভাইসে পৌঁছায় না। **এটিই «কিছুতেই ঠিক হচ্ছে না»-এর অন্যতম যান্ত্রিক কারণ।**
ঠিক: এন্ট্রি মুছুন + `CACHE_VERSION 184`। টেস্ট `tests/minimal-ui.test.mjs:36` (precache ⇔
ফাইল অস্তিত্ব) এখন সবুজ।

---

## ২. রুল ফাইল — পুরনো বনাম নতুন

| দিক | পুরনো (`main`) | নতুন (এই ব্রাঞ্চ) |
| --- | --- | --- |
| গঠন | একই: root deny, v1 নোড-তালিকা, `auth != null` | অপরিবর্তিত + **`system/connectivityProbe`** |
| জেনারেটর-সামঞ্জস্য | বাইট-মিল ছিল | টেস্টে বাইট-মিল (`interim-sync-rules` টেস্ট ১) |
| ব্যর্থ হওয়া মোড | ডায়াগনোস্টিক: read-ই একমাত্র যাচাই; write অজানা থাকত | read + write দুই-ই যাচাই, প্রতি ধাপে সমাধান |
| ডিপ্লয়-লক্ষ্য | `firebase deploy --only database` | একই |

`system/connectivityProbe/$probeKey` রুলের নিরাপত্তা বৈশিষ্ট্য:

- শুধু `{at:number}` — `at` ছাড়া আর মাত্র একটাও child এলে `$other: {.validate:false}` বাতিল করে;
- key ৬৪ অক্ষরের মধ্যে — ইচ্ছাকৃত সীমা;
- ডিলিট অনুমোদিত (পরিষ্কার-কাজ), কিন্তু সমস্যা নেই: সমগ্র probe নোড একসাথে প্রতিস্থাপন নিষিদ্ধ;
- anonymous স্বাক্ষরিত ক্লায়েন্ট প্রায়-কিছুই দুর্ব্যবহার করতে পারে না (সংরক্ষিত-আকার গাড়্ড)।

---

## ৩. টেস্ট প্রমাণ

| স্যুট | ফলাফল |
| --- | --- |
| `tests/rtdb-path-coverage.test.mjs` (deployed rules ⇔ অ্যাপ-সার্ফেস) | **১১/১১ PASS** (probe-সহ ২২ write, ১১ listener + refuse-তালিকা) |
| `tests/interim-sync-rules.test.mjs` (জেনারেটর-মিল, allow/refuse, probe-গার্ড, ক্লাউড-মরা অ্যাপ-লগইন) | **৬/৬ PASS** |
| `tests/firebase-diagnostics.test.mjs` (**নতুন**) — লোডিং-wire, session-গেট-মুক্তি, error-ম্যাপিং, probe/রুল মিল, legacy result-shape | **৬/৬ PASS** |
| `tests/rtdb-v2-draft-rules.test.mjs` (v2 খসড়া) | **২৪/২৪ PASS** |
| `tests/cross-device-sync.test.mjs` (দুই-ডিভাইস রিয়েলটাইম: A→B/B→A + নতুন ডিভাইস) | **২০/২০ PASS** |
| পূর্ণ স্যুট (`npm test`) | **962/962 PASS** — দেখুন §৪ |

## ৪. পূর্ণ-স্যুট এগজিকিউশন লগ

| রান | মোট | পাস | ব্যর্থ | মন্তব্য |
| --- | --- | --- | --- | --- |
| বেসলাইন (`main` @ e62c68f) | 955 | 954 | **1** | `minimal-ui.test.mjs:36` — precache-এর ভাঙা `css/staff-management.css` (F2) |
| এই ব্রাঞ্চ (চূড়ান্ত) | **962** | **962** | **0** | +৭ নতুন টেস্ট (probe rules + diagnostics), সব সবুজ |

দুই-ডিভাইস cross-device স্যুট (২০টি), rules-কভারেজ (১১টি), v2 খসড়া (২৪টি) — সব
একই রানে সবুজ। সমান্তরালে দুইটি স্যুট চালালে two-device harness-এর কপি-ডিরেক্টরি
(`tests/.two-device-run`, git-ignored) দৌড়ায় — একটি-একটি করে চালালে কোনো সমস্যা নেই;
এমন স্থিতি পরীক্ষণের সময়ই ছিল, প্রোডাকশন-কোডে নয়।

## ৫. এই ব্রাঞ্চের চূড়ান্ত ফাইল-তালিকা

1. `database.rules.json` — রিজেনারেটেড (+ probe node)।
2. `tools/rtdb-rules/build-interim-rules.mjs` — জেনারেটরে probe।
3. `js/firebase-diagnostics.js` — session-গেট অপসারণ, ধাপ+guidance, write probe।
4. `js/firebase-online-test.js` — session-গেট অপসারণ।
5. `js/firebase-diagnostic-ui.js` — ধাপ/সমাধান রেন্ডার + version stamp।
6. `js/main.js` — smoke-test version stamp।
7. `sw.js` — ভাঙা precache এন্ট্রি অপসারণ, CACHE_VERSION 184।
8. `index.html` — ডায়াগনোস্টিক-বাটন লোডার (আগে dead code ছিল)।
9. `tests/firebase-diagnostics.test.mjs` — **নতুন** (৬ টেস্ট): লোডিং/গেট/ম্যাপিং/প্রোব।
10. `tests/interim-sync-rules.test.mjs`, `tests/rtdb-path-coverage.test.mjs` — probe কভারেজ।
11. `FIREBASE_SETUP.md` — নতুন প্রজেক্ট/URL/সতর্কতা।
12. `docs/RTDB-REBUILD-RUNBOOK.md` — **নতুন**: নতুন DB + rules deploy + যাচাই রানবুক।
13. এই রিপোর্ট।

## ৬. অবশিষ্ট সীমা ও পরবর্তী পদক্ষেপ

- **Interim anonymous মডেল** (`auth != null`) পরিচিত ও স্বীকৃত গৃহীত ঝুঁকি — প্রতিস্থাপন
  `docs/RTDB-PER-USER-RULES-PLAN.md` (v2, staged); এ রাউন্ডে সেটি এগিয়ে নেই, কেবল
  ভুল deploy-এর বিপদ দলিলবদ্ধ।
- প্রোডাকশনে যাচাইয়ের একমাত্র উপায় কনসোল/CLI — রানবুক ধাপ ০–৫ অনুসরণ করুন; সবুজ হলে
  ডায়াগনোস্টিকের সব ধাপ ✓ আসা মানেই রিয়েলটাইম সিঙ্ক চালু।
