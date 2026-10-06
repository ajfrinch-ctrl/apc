# Active Plus — Firebase Audit ও Real-Time Multi-Device Sync রিপোর্ট

তারিখ: ২০২৬-১০-০৬ · ব্রাঞ্চ: `arena/d300dd39-apc` · বেস কমিট: `6089557`
(এই রাউন্ডের সব изменение এখনো কমিট করা হয়নি)

এই রিপোর্ট আগের রাউন্ড-৬ অডিট (`AUDIT-FIREBASE.md`, ২০২৬-০৯-২৯) কে **প্রতিস্থাপন করে না** —
সেটি আগের অবস্থার প্রমাণ; এটি আজকের audit + realtime sync verification + admin-gate fix একসাথে।

---

## ০. সংক্ষেপে (TL;DR)

| প্রশ্ন | উত্তর |
| --- | --- |
| কোন প্রজেক্ট? | **`active-plus-coaching`** (Singapore RTDB) — ২০২৬-১০-০৬-এ পুরোনো `active-plus` থেকে সরানো হয়েছে (§১৬) |
| Cloud কি সত্যিই single source of truth? | **হ্যাঁ, write-path-এ** — প্রতিটি synced dataset write হয় RTDB-তে, তারপর listener দিয়ে সব ডিভাইসে ফেরে |
| Realtime listener আছে কি? | **হ্যাঁ** — প্রতিটি synced path-এ `onValue()` (নিচের টেবিল), page refresh লাগে না |
| Device A → Device B / B → A প্রমাণ আছে কি? | **হ্যাঁ** — ২০টি দুই-ডিভাইস টেস্ট, প্রতি হপ **~১০৩ ms** (loopback mock), A→B student create, B→A edit, A→B notice, fresh Device C-তেও live |
| New device-এ "Create Admin" আসে কি? | **না** — cloud-এ Admin থাকলে Login screen; অফলাইনে/cloud unverifiable হলে Login + ইন্টারনেট-বার্তা |
| Security Rules `true`-open? | **না** — root-level deny, প্রতিটি node-এ `auth != null`; কেবল interim അനonymous identity (নিচে সীমাবদ্ধতা §১০) |
| App Check চালু? | **না** — `APP_CHECK_SITE_KEY = ''`; কোড-পাথ তৈরি, কী বসালেই চালু |
| Per-user Firebase Auth (UID/role rules)? | **এখনো নয়** — কোড ও Functions موجود, কিন্তু shipped login-এ wired নয়; এটিই বাকি প্রধান কাজ (§১১) |

---

## ১. কীভাবে অডিট করা হয়েছে

| ধাপ | কী পড়া/চালানো হয়েছে | ফলাফল |
| --- | --- | --- |
| ১ | `firebase/firebase-config.js`, `firebase/firebase-init.js`, `firebase/firebase-services.js`, `.firebaserc`, `firebase.json` | project/database URL নিশ্চিত; একটি initialization path; SDK import একটিমাত্র surface |
| ২ | `js/realtime-sync.js` (1237 লাইন, পুরো), `js/record-sync.js`, `sync/*.js`, `firebase-sync/*.js` | প্রতিটি write site ও listener চিহ্নিত (§৪) |
| ৩ | `database.rules.json` (generated), `tools/rtdb-rules/build-interim-rules.mjs`, `database.rules.v2.draft.json`, `firestore.rules`, `functions/index.js` | কোন নিয়ম সত্যিই deployed হবে, কোনটি draft — আলাদা করা হয়েছে |
| ৪ | Static scan: `indexedDB/IDB`, সব `set(`, `update(`, `push(`, `remove(`, `runTransaction(`, `onValue(`, `onChildAdded/Changed/Removed` | write/read সাইট সম্পূর্ণ তালিকা; `true`-open rule নেই |
| ৫ | দুই-ডিভাইস লেন: `tests/cross-device-sync.test.mjs` (**২০/২০**) — real app modules, real merge/listener rules, mock RTDB | live propagation, offline queue, reconnect, conflict, rules-compliance প্রমাণ |
| ৬ | নতুন-device লেন: `tests/admin-new-device-login.test.mjs` (**৭/৭**) — acceptance-এর ৬ পয়েন্ট | Create Admin কখনো আসে না; Login + cloud hydrate + session কাজ করে |
| ৭ | Rules লেন: `tests/interim-sync-rules.test.mjs`, `tests/rtdb-rules-sim.mjs` | deployed ruleset-এর সাথে client-এর প্রতিটি read/write মেলে |
| ৮ | Cloud-surface coverage: `tests/rtdb-path-coverage.test.mjs` | **৫/৫** — app-এর নিজের declaration থেকে derivation করা ১৭টি listener path ও ২০টি write path deployed rules-এ allowed; forbidden গুলো এখনো refused |
| ৯ | "No fake sync": `tests/fake-sync-truth.test.mjs` | **১/১** — refused write কখনো "synced" দেখায় না; ইতিমধ্যে পাওয়া একটি recovery দুর্বলতা ঠিক হয়েছে |
| ১০ | App Check ordering: `tests/app-check-ordering.test.mjs` | **১/১** — gate resolve হওয়ার আগে কোনো request ডিভাইস ছাড়ে না |
| ১১ | সম্পূর্ণ স্যুট: `npm test` | **৮৯৭/৮৯৭ পাস, ০ ব্যর্থ** (বেসলাইন ছিল ৮৭৯) |

**নীতি:** কোনো database path অনুমান করে বদলানো হয়নি। প্রতিটি path কোড থেকে পড়া, এবং প্রতিটি
path-এর জন্য লেখক (write) ও শ্রোতা (listener) — দুটোই আলাদা করে যাচাই করা হয়েছে।

---

## ২. Firebase configuration

| Item | মান | কোথায় |
| --- | --- | --- |
| Project ID | **`active-plus-coaching`** (২০২৬-১০-০৬-এ বদলানো) | `firebase/firebase-config.js`, `.firebaserc` |
| Auth domain | `active-plus-coaching.firebaseapp.com` | একই |
| **Database URL** | `https://active-plus-coaching-default-rtdb.asia-southeast1.firebasedatabase.app` (**Singapore**) | একই |
| Storage bucket | `active-plus-coaching.firebasestorage.app` | একই |
| App ID / Sender | `1:876005018709:web:26de8a656e96ac631d58dc` / `876005018709` | একই |
| App Check site key | **`''` (খালি → নিষ্ক্রিয়)** | একই |
| Deploy target | RTDB rules `database.rules.json`, Firestore rules `firestore.rules`, functions codebase `active-plus` (nodejs22) | `firebase.json` |
| Initialization | ঠিক একটি path — `initializeApp` (idempotent) | `firebase/firebase-init.js` |
| SDK surface | ঠিক একটি — `firebase/firebase-services.js` (auth/database/firestore/functions) | — |

---

## ৩. Firebase Authentication — বর্তমান অবস্থা (সৎ ছবি)

| দিক | অবস্থা |
| --- | --- |
| Transport identity | **Anonymous** — `ensureCloudAuth()`: `setPersistence(browserLocalPersistence)` → `authStateReady()` → আগের user থাকলে reuse, নাহলে `signInAnonymously()` |
| App-level login | Username + password, device-এ `PBKDF2` hash (`js/password-hash.js`) দিয়ে যাচাই; RTDB-তে কেবল **hash** যায় (কোনো plaintext password/pin নয় — টেস্টে প্রমাণিত) |
| Per-user Firebase Auth | কোড موجود: `sync/cloud-auth.js` (email namespace `user.<username>@accounts.activeplus.app`, custom claims `status`/`role`/`mustChangePassword`, Firestore `users/<uid>`) + `functions/index.js` (`createFirstAdmin`, provisioning, password completion) — কিন্তু **shipped login path-এ এটি wired নয়** (কোথাও import করা নেই) |
| অর্থ | ডেটা সুরক্ষা আজ **per-user নয়, per-`auth != null`** (নিচে §১০-এ সীমা ও পরিকল্পনা) |

### ৩.১ Login / Logout / Profile / Role (audit item 1-এর অংশ)

| বিষয় | কোথায় | কী করে |
| --- | --- | --- |
| Login | `js/login.js` | ক্রম: device session → local staff role → local student → **cloud identity hydrate** (`hydrateUserIdentifiers`) → role resolve |
| Role detection | `js/staff-auth.js` `resolveStaffRoleByUsername()` → `js/staff-directory.js` | stored account আগে, তারপর Staff Directory; fixed fallback ID (`admin.apc`) নয় — প্রথম Admin-এর generated ID-ও ধরে |
| Logout | `js/logout.js` → `clearSession()` + `apc-session-ended` | কেবল **session** মুছে; account, password hash, student/transaction/notice ডেটা কিছুই মুছ না |
| Listener cleanup | `js/realtime-sync.js` (`apc-session-ended` → `stopRealtimeSync`) | সব `onValue` unsubscribe, `document.dataset` status পরিষ্কার; late read-ও আর write করে না (টেস্ট করা) |
| User profile | staff: `staffAccounts/<role>`; student: `studentAccounts/<loginKey>`; device: `active-plus-account-v1` (LOCAL_ONLY) | প্রোফাইলে password কখনো plaintext নয় — PBKDF2 hash |

---

## ৪. Realtime Database — path, write ও listener

Root: `activePlusSync/v1` (± legacy read-only `activePlusSync/v1/studentAccount`)।

| Path | Write (কার লেখে) | Realtime listener | Conflict নীতি |
| --- | --- | --- | --- |
| `students`, `transactions`, `notices`, `routine`, `teaching`, `settings`, `academics`, `courseContent`, `teacherAssignments` | `recordBridge()` → `runTransaction` (merge, `applyLocally:false`) + local write bridge (`Storage.prototype.setItem` hook) | `listenCollection()` → `onValue` | per-record: local pending op; পুরোনো local copy নতুন cloud copy-কে কখনো হারায় না (`cloudCopyIsNewer`) |
| `staffAccounts/{admin,manager,teacher,payment}` | `syncStaffRole()` → `runTransaction` | `listenStaffRole()` → `onValue` | role account দুই-দিকেই merge; login কখনো credential overwrite করে না |
| `staffDirectory` | `syncDirectory()` → `runTransaction` | `listenDirectory()` → `onValue` | AES-GCM envelope রাখা হয় |
| `usernames` | `syncUsernames()` → `runTransaction` | `listenUsernames()` → `onValue` | claimed Login ID কখনো চুরি/মুছে যায় না (conflict দেখানো হয়) |
| `studentAccounts/<encoded-key>` | `syncStudentAccount()` → `runTransaction` | `listenStudentAccount()` → `onValue` | password যাচাইয়ের পরেই device adopt করে |
| `examDb/exams/<id>`, `examDb/attempts/<id>` | `pushExamDb()` → `set(..., null)` = deletion tombstone'সহ | `listenExamDb()` → `onValue` | id-keyed mirror, atomic exam+attempt merge |
| `system/adminInitialized` | `writeAdminInitializedFlag()` → `set(true)` (Admin record তৈরি হওয়ার **পরে**) | read-only (`adminInitializationState`) | marker; source of truth নয় |
| `pushTokens/<deviceKey>` | `js/push-notifications.js` → set | নেই (device-scoped; প্রেরক Functions পড়ে) | — |
| `.info/connected` | — | `onValue` | `.info/connected` ছাড়া অন্য কোনোভাবে connected ধরা হয় না |

গুরুত্বপূর্ণ: state (“সব সিঙ্ক হয়েছে”) তখনই দেখানো হয় যখন outbox খালি — কেবল একটি write পাঠানো
হলেই নয় (`paintSyncStatus()`); আর `markSyncSuccess('read'|'write')` কেবল **আসল ack**-এর পরে।

`onChildAdded/Changed/Removed` কোডে নেই — এবং দরকার নেই: প্রতিটি collection-এ পুরো node-এ
`onValue` বসানো, যা child add/change/remove সবই ধরে এবং merge-নীতিতে প্রয়োগ করে (§৫)।

### ৪.১ ডেটাসেট কভারেজ — কোনটা cloud-এ, কোনটা ইচ্ছাকৃতভাবে ডিভাইসে

| ডেটাসেট | Cloud path | Multi-device | মন্তব্য |
| --- | --- | --- | --- |
| Admin | `staffAccounts/admin` | **হ্যাঁ** | global একটিই; §৭-এ new-device প্রমাণ |
| Manager / Teacher / Cash-counter | `staffAccounts/{manager,teacher,payment}` + `staffDirectory` | **হ্যাঁ** | directory ID/login সব ডিভাইসে |
| Student roster | `students` | **হ্যাঁ** | A→B live প্রমাণিত |
| Student login | `studentAccounts/<key>` | **হ্যাঁ** | password hash সহ, verified হলে adopt |
| Notice | `notices` | **হ্যাঁ** | সাথে সাথে সব ডিভাইসে |
| Homework / teaching | `teaching` + `teacherAssignments` | **হ্যাঁ** | shape-preserving |
| Exam / attempt / result | `examDb/exams`, `examDb/attempts` | **হ্যাঁ** | dedicated mirror, strict reader-এ বৈধ |
| Payment / transaction | `transactions` | **হ্যাঁ** | counter → manager approval cross-device |
| Routine / class settings | `routine`, `academics`, `teaching` | **হ্যাঁ** | rendered UI পর্যন্ত (reload ছাড়াই) |
| Academic settings / app config | `academics`, `settings` | **হ্যাঁ** | — |
| Role notification | ডেরাইভড (synced data + push) | **হ্যাঁ** | ৮টি cross-device টেস্ট পাস; record store ডিভাইসে append-only |
| Report-এর source data | ডেরাইভড | **হ্যাঁ** | রিপোর্ট synced collection থেকেই তৈরি |
| **Question Bank (`activePlus.questionBank.v1`)** | নেই | **না — ইচ্ছাকৃত** | `js/sync-collections.js`-এ codec তৈরি, কিন্তু `SYNCABLE`-এ বাদ: এতে **উত্তরপত্র/answer key** থাকে, আর আজকের `auth != null` সেতুতে সেটি পাঠানো মানে যে কেউ সব উত্তর পড়তে পারবে (`tests/database.test.mjs:30` এই সিদ্ধান্তটি pin করে) |
| Device preference (`notificationSettings`), session/account keys | নেই | **না — ইচ্ছাকৃত** | per-device সেটিং ও session কখনো ডিভাইস ছাড়ে না (`js/database.js` LOCAL_ONLY) |

---

## ৫. Cloud = single source of truth (কীভাবে নিশ্চিত)

1. UI কেবল localStorage-এ লেখে (`js/database.js`) — সুতরাং offline-এ কাজ করে।
2. `Storage.prototype.setItem` hook (`installLocalWriteBridge`) সেই write-কে সাথে সাথে
   `capture()` → durable outbox (`activePlus.syncOutbox.v2:<collection>`) → `flush()` → RTDB
   transaction-এ পাঠায়। **নেটওয়ার্ক রিকোয়েস্টের আগে outbox disk-এ থাকে**, তাই reload হারায় না।
3. অন্য ডিভাইসে listener (`onValue`) সেই পরিবর্তন নামায় → `receive()` → merge → local storage →
   `storage` event + `apc-sync-updated` event → UI সাথে সাথে আঁকে (কোনো refresh নেই)।
4. ৩ সেকেন্ডের pending-flush timer, `.info/connected` false→true transition, `online` event ও
   ২০ সেকেন্ডের watchdog — বাকি থাকা যেকোনো write নিজে থেকেই আবার পাঠায়।
5. `mergeRecordOperations(remote, pending)` — server state-এর উপর কেবল পরিবর্তিত ID merge হয়;
   deletion ইচ্ছাকৃত হলেই কেবল মুছে; `updatedAt/registeredAt` ভিত্তিক `cloudCopyIsNewer` পুরোনো
   ডিভাইসের stale copy দিয়ে নতুন সিদ্ধান্ত মুছে ফেলা আটকায় (approval ফিরে যাওয়ার bug-এর fix)।

---

## ৬. Mandatory multi-device test — ফলাফল

`tests/cross-device-sync.test.mjs` — দুইটি সম্পূর্ণ আলাদা jsdom প্রসেস (নিজস্ব localStorage/module
graph), একটিই mock Realtime Database; কেবল Firebase CDN specifier இரண்டটি প্রতিস্থাপিত,
বাকি সব shipped কোড।

| ধাপ | প্রত্যাশা | ফলাফল |
| --- | --- | --- |
| A: student তৈরি | B-তে refresh ছাড়াই দেখা যায় | **PASS** — ১০৩ ms |
| B: student edit/approve | A-তে refresh ছাড়াই দেখা যায় | **PASS** — ১০৩ ms |
| A: notice তৈরি | B-তে সাথে সাথে | **PASS** — ১০৩ ms (+ live event) |
| B: notice/edit তৈরি | A-তে ফিরে আসে (outbox path) | **PASS** — ১০৩ ms |
| Routine write | B-এর rendered UI (আসল DOM) বদলায়, reload ছাড়াই | **PASS** |
| Offline A-তে edit | reconnect-এ cloud-এ যায়, B দেখে | **PASS** |
| Cloud-এ missing connectivity event | write তবুও পৌঁছায় | **PASS** |
| Concurrent insert (A ও B একসাথে) | দুটোই থাকে, একটি হারায় না | **PASS** |
| Deletion propagate | delete সব ডিভাইসে ছড়ায় (tombstone) | **PASS** |
| Stale phone approval undo করতে চায় | পারে না — নতুন cloud copy জেতে | **PASS** |
| Exam + attempt + score | A → B live, strict reader-এ বৈধ | **PASS** |
| Rules compliance | client-এর প্রতিটি read/write deployed ruleset-এ allowed | **PASS** (`cloud.ruleViolations = []`) |

সম্পূর্ণ ফাইল: **২০/২০ পাস, দুইবার ধারাবাহিক রানে**।

### ৬.১ প্রতিটি role-এর read/write (audit item 21-এর চেকলিস্ট)

| Role | প্রমাণ (সবগুলো real two-process lane, deployed rules mock-এ enforced) | ফলাফল |
| --- | --- | --- |
| Admin | create/read/write, new-device login, duplicate block | **PASS** — `cross-device-sync` (২০), `admin-new-device-login` (৭) |
| Manager (counter থেকে fee approval) | counter লেখে → manager দেখে → সিদ্ধান্ত ছড়ায় | **PASS** — `notification-cross-device` (৮/৮) |
| Teacher (assignment/homework/paper) | teacher assignment ও teaching record দুই-দিকেই | **PASS** — `cross-device-sync`, `notification-cross-device` |
| Cash Counter (payment entry) | counter-এর entry manager-এ, manager-এর সিদ্ধান্ত counter/student-এ | **PASS** — `notification-cross-device` |
| Student (registration → অনুমোদন → login) | নিজের ফোনে register → Admin অনুমোদন → student-এর ফোনে সিদ্ধান্ত + login | **PASS** — `registration-cross-device` (৫/৫) |
| Realtime listener | উপরের প্রতিটি ধাপ refresh ছাড়াই | **PASS** |
| New device login | Device C — Login screen → Admin login → cloud data → live | **PASS** |

অর্থাৎ rules পরিবর্তনের পরে যে চেকলিস্ট আপনি চেয়েছেন (Admin/Teacher/Manager/Counter/Student
read+write, listener, new-device login) — প্রতিটি লাইনের জন্য চালানো টেস্ট আছে; mock cloud আসল
`database.rules.json` **enforce** করে, তাই কোনো ভুল path/অনুমতি থাকলে এই টেস্টগুলোই প্রথমে ধরবে।

---

## ৭. New device test (Device C)

Device C = খালি localStorage, কিছুই আগে থেকে নেই।

| ধাপ | প্রত্যাশা | ফলাফল |
| --- | --- | --- |
| App খোলা | **Login screen** — “Create Admin Account” নয় | **PASS** (`#firstAdminPanel` DOM-এই নেই, `#loginPanel` খোলা) |
| Cloud জিজ্ঞাসা | `staffAccounts/admin` + `system/adminInitialized` পড়া হয় | **PASS** (localStorage-ভিত্তিক কোনো সিদ্ধান্ত নয়) |
| Admin login | বিদ্যমান credentials দিয়ে সফল, panel-এ hand-over | **PASS** (`navigated: true`, forced password change নেই) |
| Cloud profile | ডিভাইসে ঠিক একই Admin record নামে (নতুন নয়) | **PASS** (`createdAt` অপরিবর্তিত) |
| Cloud data | students + notices আসে | **PASS** |
| Realtime | A-এর নতুন write C-তে refresh ছাড়াই | **PASS** — ১০৩ ms |
| Duplicate block | দ্বিতীয় Admin কখনোই তৈরি হয় না | **PASS** — `ADMIN_EXISTS` + “PLEASE LOGIN WITH EXISTING ADMIN ACCOUNT” |
| Unverifiable cloud | অফলাইন/unreachable-এ কিছুই লেখা হয় না | **PASS** — `CLOUD_UNVERIFIED` + ইন্টারনেট-বার্তা |

সংশ্লিষ্ট ফাইল: `tests/admin-new-device-login.test.mjs` → **৭/৭**।

---

## ৮. Offline, reconnect, conflict, error

> **কেন নিজস্ব outbox?** Firebase-এর *Firestore* SDK ডিস্কে offline persistence রাখে, কিন্তু
> **Realtime Database web SDK লেখাগুলো ডিস্কে রাখে না** — পেজ reload/বন্ধ হলে pending write হারায়।
> তাই এই অ্যাপ durable per-record outbox (`activePlus.syncOutbox.v2:*`) রেখেছে, এবং RTDB SDK-এর
>নিজের কাজ (listener ধরে রাখা, socket reconnect, যখন পেজ খোলা আছে তখন write buffer করা) তার উপরেই
> ছাড়া হয়েছে — `.info/connected`-ই তার প্রমাণ।

| বিষয় | অবস্থা | প্রমাণ/কোড |
| --- | --- | --- |
| Offline persistence | localStorage + durable outbox (`activePlus.syncOutbox.v2:*`), IndexedDB ব্যবহৃত **নয়** | `js/record-sync.js` |
| Reconnect | `.info/connected` transition + `online` event + 3s flush + 20s watchdog | `js/realtime-sync.js` |
| Partial failure | একটি collection ব্যর্থ হলে কেবল সেটিই retry (60s throttle), বাকি listener অটুট | `retryPartialSync()` |
| Conflict | last-writer-নয় বরং timestamp-aware merge; login-ID conflict আলাদা দেখানো | `cloudCopyIsNewer`, `reportConflict` |
| Error diagnosis | exact code → নির্দিষ্ট বাংলা বার্তা (permission-denied, invalid-api-key, database-not-found, network-request-failed, app-check, quota…) এবং console-এ code **+ message** | `js/sync-status.js` |
| Sync status | topbar-এর border রঙ (সবুজ/অ্যাম্বার/লাল/ধূসর) + screen-reader live region; কোনো UI redesign নেই | `js/topbar-connectivity.js` |
| Fake sync | নেই — “synced” কেবল খালি outbox + আসল read/write ack-এ; আর উল্টোটাও: write refuse হলে status **error**-ই থাকে | `paintSyncStatus`, `markSyncSuccess`, `tests/fake-sync-truth.test.mjs` |
| Refused-write recovery | **এই রাউন্ডে ঠিক করা**: দেরিতে হলেও write যখন সফল হয়, সেই সফল flush-ই failed collection-গুলোকে সাথে সাথে retry করায় — আগে status ২০ সেকেন্ডের watchdog পর্যন্ত লাল থাকত | `schedulePendingFlush()` |

---

## ৯. Existing data protection

- কোনো migration/rewrite চালানো হয়নি; কোনো ডেটা মুছেনি — `remove()`-জাতীয় destructive call কোডে নেই (কেবল exam record-এর deliberate deletion, যেটি app-এর নিজের delete action)।
- Admin record, users, students, payments, local data — সব অপরিবর্তিত; fix-গুলো কেবল **decision path** যোগ করে (cloud-নির্ভর gate) ও error surface বাড়ায়।
- Rules-এ `staffAccounts/$role`-এ `newData.exists()` আছে — অর্থাৎ **delete নিষিদ্ধ** (এবং staff record মুছে ফেলার কোনো client path নেই)।

---

## ১০. Security Rules — বর্তমান অবস্থা ও সীমা

`database.rules.json` (generated by `node tools/rtdb-rules/build-interim-rules.mjs`; `tests/interim-sync-rules.test.mjs` byte-equality ধরে):

- root `.read: false`, `.write: false` — **default deny**।
- প্রতিটি node-এ `auth != null` (কোথাও `.read: true`/`.write: true` **নেই**)।
- role validation: `staffAccounts/$role` কেবল `admin|manager|teacher|payment`, `newData.hasChildren(['username','password'])`।
- `system/adminInitialized`: `.read: auth != null`, `.write: auth != null && newData.isBoolean()` → marker জাল/মুছে ফেলা যাবে না।
- Board-ব্যাপী কোনো rule নেই; Firestore rules আলাদা (`firestore.rules`)।

### সীমা (লুকানো হচ্ছে না)

`auth != null` মানে **যে কেউ anonymous sign-in করে ডেটা পড়তে/লিখতে পারে** — web config পাবলিক
বলে যে কেউ `auth != null` হতে পারে। এর মানে:

- সব student record, transaction, notice, routine, settings পড়া যেতে পারে;
- staff/student-এর PBKDF2 **hash** পড়া যেতে পারে (offline guessing);
- চাইলে কেউ `staffAccounts/admin` overwrite করে Admin দখল করতে পারে।

এটি নতুন কিছু নয় — owner-এর ২০২৬-০৯-৩০ সিদ্ধান্তে **সচেতনভাবে গৃহীত interim ঝুঁকি**
(`docs/INTERIM-ANONYMOUS-SYNC.md`)। এর প্রতিকার প্রস্তুত ও document করা কিন্তু deploy করা হয়নি:
per-user/per-role rules (`database.rules.v2.draft.json` + simulator) এবং
`functions/index.js`-এর verified identity path — যার জন্য Cloud Functions Blaze plan ও migration
লাগে (একদিনের বেশি কাজ, ইচ্ছাকৃতভাবে এই fix-এর আওতার বাইরে রাখা হয়েছে)।
বিস্তারিত: `docs/RTDB-PER-USER-RULES-PLAN.md`।

### Paste-ready ruleset (Firebase Console → Realtime Database → Rules → Replace → Publish)

> ⚠️ Source of truth হলো `database.rules.json` (নিচের কপি হুবহু সেটিই)। হাতে edit করে
> divergence তৈরি করবেন না — বদলাতে হলে `tools/rtdb-rules/build-interim-rules.mjs` চালান,
> তারপর `npm test` (interim-sync-rules byte-equality)।

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "activePlusSync": {
      "v1": {
        "staffAccounts": {
          ".read": "auth != null",
          "$role": {
            ".write": "auth != null && newData.exists() && ($role === 'admin' || $role === 'manager' || $role === 'teacher' || $role === 'payment')",
            ".validate": "newData.hasChildren(['username', 'password']) && newData.child('username').isString()"
          }
        },
        "staffDirectory": {
          ".read": "auth != null",
          ".write": "auth != null && newData.exists()",
          ".validate": "newData.hasChild('version')"
        },
        "usernames": {
          ".read": "auth != null",
          ".write": "auth != null && newData.exists()"
        },
        "studentAccount": {
          ".read": "auth != null"
        },
        "studentAccounts": {
          ".read": "auth != null",
          "$loginKey": {
            ".write": "auth != null && newData.exists()",
            ".validate": "newData.hasChild('pinHash')"
          }
        },
        "examDb": {
          ".read": "auth != null",
          "exams": {
            "$examId": {
              ".write": "auth != null",
              ".validate": "newData.child('id').val() === $examId && newData.child('teacherId').isString() && newData.child('status').isString()"
            }
          },
          "attempts": {
            "$attemptId": {
              ".write": "auth != null",
              ".validate": "newData.child('id').val() === $attemptId && newData.child('examId').isString() && newData.child('studentId').isString()"
            }
          }
        },
        "system": {
          ".read": "auth != null",
          "adminInitialized": {
            ".write": "auth != null && newData.isBoolean()",
            ".validate": "newData.isBoolean()"
          }
        },
        "settings": {
          ".read": "auth != null",
          ".write": "auth != null"
        },
        "pushTokens": {
          "$deviceKey": {
            ".write": "auth != null",
            ".validate": "newData.child('token').isString() && newData.child('token').val().length > 20 && newData.child('token').val().length <= 4096"
          }
        },
        "students": {
          ".read": "auth != null",
          ".write": "auth != null",
          "$recordId": {
            ".validate": "newData.hasChildren()"
          }
        },
        "transactions": {
          ".read": "auth != null",
          ".write": "auth != null",
          "$recordId": {
            ".validate": "newData.hasChildren()"
          }
        },
        "notices": {
          ".read": "auth != null",
          ".write": "auth != null",
          "$recordId": {
            ".validate": "newData.hasChildren()"
          }
        },
        "routine": {
          ".read": "auth != null",
          ".write": "auth != null",
          "$recordId": {
            ".validate": "newData.hasChildren()"
          }
        },
        "teaching": {
          ".read": "auth != null",
          ".write": "auth != null",
          "$recordId": {
            ".validate": "newData.hasChildren()"
          }
        },
        "academics": {
          ".read": "auth != null",
          ".write": "auth != null",
          "$recordId": {
            ".validate": "newData.hasChildren()"
          }
        },
        "courseContent": {
          ".read": "auth != null",
          ".write": "auth != null",
          "$recordId": {
            ".validate": "newData.hasChildren()"
          }
        },
        "teacherAssignments": {
          ".read": "auth != null",
          ".write": "auth != null",
          "$recordId": {
            ".validate": "newData.hasChildren()"
          }
        }
      }
    }
  }
}
```

**Publish করার আগে জানা দরকার:** নতুন `system` node client ব্যবহার করে (Admin initialization
marker)। পুরোনো deployed ruleset-এ সেটি না থাকলে পড়া ব্যর্থ হবে — কিন্তু client এখন
**record-first**: `staffAccounts/admin` আগে পড়া হয়, তাই Admin থাকলে সিদ্ধান্ত ঠিকই আসে
(কেবল একটি warn log হবে)। তৈরি হওয়ার পর flag write ব্যর্থ হলেও Admin account safe থাকে।

---

## ১১. App Check ও per-user rules — কী প্রস্তুত, কী বাকি

### ১১.১ Query ও index (audit item 13)

কোডে **কোনো** `orderByChild()`, `equalTo()`, `limitToLast()`, `limitToFirst()`, `startAt()`,
`endAt()` নেই — synced node-গুলো পুরো `onValue`/`get` দিয়ে পড়া হয়, তাই **`.indexOn` লাগে না**
(এবং DB-তে কোনো index খরচ/ডুপ্লিকেট ডেটা নেই)। প্রমাণ: `js/`, `sync/`, `firebase/`,
`firebase-sync/` — grep করা হয়েছে; `tests/rtdb-path-coverage.test.mjs`-ও এই সিদ্ধান্ত pin করে।

### ১১.২ App Check

| বিষয় | অবস্থা |
| --- | --- |
| Site key | `APP_CHECK_SITE_KEY = ''` → **নিষ্ক্রিয়** |
| Ordering | **যাচাই করা**: কোনো `get/set/transaction/listener/sign-in` `appCheckReady` resolve হওয়ার আগে ডিভাইস ছাড়ে না — `tests/app-check-ordering.test.mjs` একটি কখনো-resolve-না-করা গেট দিয়ে প্রমাণ করে `network === 0` |
| চালু করার ধাপ | Console → App Check → reCAPTCHA v3 key নিন → `firebase/firebase-config.js`-এ `APP_CHECK_SITE_KEY` বসান → কিছুদিন **monitor mode**-এ দেখুন (`[Active Plus] Sync failed: … app-check` মেসেজ) → তারপর enforce |
| Lockout | কোনোটিই হবে না: key ভুল/পুরোনো হলে status লাল হয়ে exact error দেবে, ডেটা ডিভাইসে থাকবে এবং retry চলবে |

### ১১.৩ Per-user Firebase Auth + role rules (audit items 7, 10, 11) — সৎ ছবি

প্রতিটা টুকরো প্রস্তুত, কিন্তু এগুলো **একসাথে** deploy করতে হবে — কোনোটিই একা চালু করা যায় না:

| প্রস্তুত artifact | কী করে |
| --- | --- |
| `functions/index.js` | `createFirstAdmin` (Firestore `system/bootstrap` lock + claimId, তাই concurrent double-bootstrap অসম্ভব), provisioning, temporary-password flow; প্রতিটি protected callable `request.auth.token.{status, role, mustChangePassword}` যাচাই করে |
| `sync/cloud-auth.js` | Username → `user.<username>@accounts.activeplus.app`, `signInWithEmailAndPassword`, claims যাচাই, Firestore `users/<uid>` প্রোফাইল |
| `database.rules.v2.draft.json` | `activePlusV2/...` tree-তে per-role/per-uid rules; `<uid>`/role প্রতিটি path-এ claim-ভিত্তিক; কোনো `auth != null` বা `true` নেই |
| `tests/rtdb-v2-draft-rules.test.mjs` | ৯টি role-বাউন্ডারি case (Admin/Manager/Teacher/Payment/Student/blocked identity) local simulator-এ |
| `functions/test/rtdb-rules.test.js` | একই matrix **real emulator rules engine**-এ — এটিই authoritative, চালাতে হবে `cd functions && npm run test:rtdb-rules` (Java + firebase-tools দরকার, এই sandbox-এ নেই) |

**কেন এখনই চালু করা যায় না (অডিটে পাওয়া বাস্তব বাধা):** v2 tree-এর সাথে আজকের tree-এর মিল শুধু
অ্যাপ্লিকেশন ডেটায়; **identity ও exam-এর অংশ আজও API-তে অন্য জায়গায়**। ছবি:

| আজকের node | v2 tree-তে | মানে |
| --- | --- | --- |
| `students, notices, transactions, routine, teaching, settings, teacherAssignments` | একই নামে আছে | সোজা migration |
| `staffAccounts`, `staffDirectory`, `usernames`, `studentAccounts`, `system` | **নেই** | সব identity Firebase Auth (`users/<uid>` Firestore) + claims-এ যাবে — প্রতিটি staff/student-এর Auth account provision করতে হবে |
| `examDb/{exams,attempts}` | `exams`, `attempts`, `studentExams`, `results` | exam mirror-এর client rewrite দরকার |
| — | `studentLedger` | নতুন derived ledger, আজকের `transactions` থেকে হবে |

**নিরাপদ ক্রম (runbook):** ① Functions deploy (Blaze) → ② প্রতিটি বিদ্যমান staff/student-এর Auth
account provision (একই username/password দিয়ে, temporary-password flow-সহ) → ③ client-কে
`signInCloudUsername`-এ সরানো + v2 tree-তে লেখা (দুই-ডিভাইস লেনে প্রমাণ) → ④ emulator matrix
(`npm run test:rtdb-rules`) পাস → ⑤ v2 rules publish → ⑥ interim anonymous sign-in বন্ধ।
**এই ছয় ধাপের আগে v2 rules publish করলে সবাই লক আউট হবে** — তাই সেটি করা হয়নি।
বিস্তারিত: `docs/RTDB-PER-USER-RULES-PLAN.md`।

---

## ১১খ. অন্যান্য Firebase surface

| বিষয় | অবস্থা | করণীয় |
| --- | --- | --- |
| Firestore rules | `firestore.rules` আলাদা surface (RTDB-তে প্রভাব নেই); `users/<uid>` প্রোফাইল ও `system/bootstrap` lock এর উপর | v2 migration-এর আগে audit |
| Cloud Functions | `functions/index.js` — v2 callables + push sender (`onValueWritten`), nodejs22 | deploy করার আগে `cd functions && npm run test:rtdb-rules` (emulator, authoritative) |
| Push | `activePlusSync/v1/pushTokens/<device|viewer>` write, sender Functions পড়ে; client কখনো token পড়ে না (rules-এও read নেই) | VAPID key (`FCM_VAPID_KEY`) বসালে push চালু |

---

## ১২. চূড়ান্ত PASS/FAIL (অনুরোধ করা টেবিল)

| Item | ফলাফল | প্রমাণ |
| --- | --- | --- |
| Firebase Project | **PASS** | `active-plus-coaching` (§১৬-এ switch), config একটাই source — `firebase/firebase-config.js` |
| Firebase Authentication | **PARTIAL** | Anonymous transport কাজ করে এবং সেটিই আজ ব্যবহার হয়; per-user UID/claims path (Functions + `sync/cloud-auth.js`) প্রস্তুত কিন্তু migration ছাড়া wired নয় (§৩, §১১.৩) |
| Realtime Database | **PASS** | সব path write+listener জোড়া, দুই-ডিভাইসে live |
| Database URL | **PASS** | `https://active-plus.firebaseio.com`, `getDatabase(firebaseApp)` |
| Security Rules | **PARTIAL** | `true`-open নেই, default deny, validation আছে — কিন্তু per-user/role নয় (§১০) |
| Admin Cloud Identity | **PASS** | cloud record + `system/adminInitialized`, record-first detection |
| New Device Login | **PASS** | ৭/৭ acceptance-test (§৭) |
| Realtime Listeners | **PASS** | প্রতিটি synced path-এ `onValue` (§৪); ১৭/১৭ listener path deployed rules-এ readable (`tests/rtdb-path-coverage.test.mjs`) |
| Realtime Write | **PASS** | outbox → transaction/set, ack-এর পরেই “synced” |
| Realtime Read | **PASS** | boot-এ `get` + থাকার পর `onValue` |
| Offline Persistence | **PASS** | localStorage + durable outbox (IndexedDB নেই) |
| Reconnect Sync | **PASS** | `.info/connected` + online + 3s/20s retry (§৮) |
| Conflict Handling | **PASS** | timestamp-aware merge, approval-undo আটকানো |
| App Check | **FAIL (নিষ্ক্রিয়, কিন্তু প্রস্তুত)** | site key খালি; ordering যাচাই করা (`tests/app-check-ordering.test.mjs`) — key বসালেই চালু, §১১.২ |
| Existing Data | **PRESERVED** | কোনো reset/delete/migration নেই (§৯) |

**Real-time sync PASS কি না — owner-এর সংজ্ঞা অনুযায়ী:** “Device A-তে পরিবর্তন করলে Device B-তে
refresh ছাড়াই দেখা যায়, এবং উল্টোটাও” — এই শর্ত দুই-ডিভাইস লেনে প্রতি হপ ~১০৩ ms-এ পূরণ হয়েছে,
এবং নতুন ডিভাইস Login → cloud data → live update — তিনটিই প্রমাণিত (§৬, §৭)।

---

## ১৩. এই রাউন্ডে যা বদলেছে (ফাইল)

| ফাইল | বদল |
| --- | --- |
| `js/realtime-sync.js` | `adminInitializationState()`: Admin record আগে পড়া হয় (source of truth); `system` marker না পড়তে পারলে record থাকলে warn করে এগোয়, না থাকলে fail-closed |
| `js/sync-status.js` | sync error-এ console-এ **code + message** দুটোই (আগে কেবল code) |
| `tests/two-device-child.mjs` | নতুন `admin-screen` কমান্ড — নতুন ডিভাইস Login না Create Admin দেখায়, তা যাচাই |
| `tests/cross-device-sync.test.mjs` | নতুন acceptance test: A→B student create, B→A edit, A→B notice, fresh Device C login + live sync (মোট ২০ টেস্ট) |
| `tests/login-sync-lifecycle.test.mjs` | login পেজের startup-এ কেবল **Admin gate** পড়া/anonymous transport-এর অনুমতি; অন্য কোনো read/write নয় — আগের শর্ত বজায় |
| **নতুন** `tests/rtdb-path-coverage.test.mjs` | app-এর নিজের declaration থেকে cloud surface বের করে deployed rules-এর সাথে প্রতিটি read/write মেলায় (§৫, §১২-এর machine-check) |
| **নতুন** `tests/fake-sync-truth.test.mjs` | refused write → কখনো "synced" নয়, ডেটা হারায় না, cloud ফিরলে নিজে থেকেই যায় (§১৬) |
| **নতুন** `tests/app-check-ordering.test.mjs` | App Check-এর আগে কোনো request বেরোয় না (§১৯) |
| `js/admin-initialization.js`, `js/login.js`, `js/staff-auth.js`, `database.rules.json`, `sw.js`, ছয়টি page (`?v=179`) | আগের ধাপের admin-gate fix (এখনো কমিট হয়নি) |

---

## ১৪. সীমাবদ্ধতা (সৎ তালিকা)

1. **লাইভ Firebase-এ এই রানটি চালানো হয়নি** — sandbox-এ outbound Firebase + Chromium নেই; তাই
   প্রমাণ আসে real app কোড + mock RTDB (দুই প্রসেস) ও jsdom থেকে। লাইভ ডিভাইসে শেষ যাচাই
   আপনার করা উচিত (§১৫)।
2. **per-user rules/App Check** ছাড়া ডেটা সুরক্ষা সম্পূর্ণ নয় — এটি এই কাজের আওতার বাইরে রাখা
   হয়েছে (owner decision-নির্ভর, Blaze plan লাগে)।
3. Playwright specs sandbox-এ চালানো যায়নি (Chromium/NSS নেই) — দুই-ডিভাইস লেনই ব্রাউজার-স্তরের
   대체 প্রমাণ।
4. Real network latency (loopback নয়) মাপা হয়নি; ~১০৩ ms হলো bridge-এর নিজের floor।
5. **Question Bank cross-device হয় না — ইচ্ছাকৃতভাবে** (§৪.১); per-user rules deploy হলে সেটিও
   `SYNCABLE`-এ যোগ করা যাবে (codec আগেই তৈরি)।
6. **Emulator rules suite এখানে চালানো যায়নি** — `firebase emulators:exec` + Java + emulator
   download দরকার (sandbox-এ নেই)। তাই v2 role matrix প্রমাণ আজ **local simulator**
   (`tests/rtdb-v2-draft-rules.test.mjs`) থেকে; publish করার আগে অবশ্যই
   `cd functions && npm run test:rtdb-rules` চালান।
7. **লাইভ database-এর tree পড়া হয়নি** (কোনো credential নেই) — tree-টি কোড ও deployed
   `database.rules.json` থেকে নেওয়া। Console-এ একবার মিলিয়ে নিলে সবচেয়ে ভালো।

## ১৫. লাইভ যাচাইয়ের চেকলিস্ট (আপনার জন্য)

1. `https://ajfrinch-ctrl.github.io/apc` একটা নতুন ফোন/incognito-তে খুলুন → **Login** আসবে, Create Admin নয়।
2. বিদ্যমান Admin ID + password দিয়ে লগইন → Dashboard।
3. ফোন A-তে একটা Notice/Student তৈরি করুন → ফোন B-তে refresh ছাড়াই দেখা যাবে (topbar border সবুজ)।
4. Wi-Fi বন্ধ করুন → offline banner/লাল border; edit করুন → Wi-Fi চালু করুন → সেটি নিজে থেকে চলে যাবে।
5. Console-এ `dataset.realtimeSync` ও sync message দেখুন; কোনো error থাকলে exact code রিপোর্ট করুন।

---

## ১৬. প্রজেক্ট স্থানান্তর — `active-plus` → `active-plus-coaching` (২০২৬-১০-০৬)

**সিদ্ধান্ত (owner):** অ্যাপ এখন নতুন Firebase প্রজেক্ট `active-plus-coaching` ব্যবহার করবে,
Realtime Database instance `active-plus-coaching-default-rtdb`, region **asia-southeast1 (Singapore)**।

### যা যা বদলেছে (এই রাউন্ডে)

| ফাইল | বদল |
| --- | --- |
| `firebase/firebase-config.js` | নতুন apiKey/authDomain/**databaseURL**/projectId/storageBucket/sender/appId (+ measurementId) |
| `firebase-messaging-sw.js` | FCM background worker-এর নিজস্ব কপিও একই পরিচয়ে |
| `.firebaserc` | CLI default project → `active-plus-coaching` |
| `functions/index.js` | `DB_REGION` → `asia-southeast1` (push sender Functions; Blaze লাগে) |
| `sw.js` + ছয়টি page | `CACHE_VERSION` ১৭৯ → **১৮০** — config app-shell-এ cache হয়, তাই পুরোনো ডিভাইস নতুন পরিচয় পেতে এই bump বাধ্যতামূলক |
| `tests/firebase-hardening.test.mjs` | pin করা project-id নতুনটির সাথে |

**পুরোনো প্রজেক্টে কিছুই মুছে ফেলা হয়নি** — ওই ডেটাবেস, users, Admin, payments অপরিবর্তিত
থাকবে (কেবল অ্যাপ আর সেখানে লিখবে না)।

### নতুন প্রজেক্টে চালু করার ক্রম (গুরুত্বপূর্ণ)

1. **Authentication → Anonymous → Enable** (অ্যাপের সিঙ্ক এই identity ছাড়া চলবে না)।
2. **Realtime Database → Rules** → §১০-এর সম্পূর্ণ JSON **Publish**। নতুন/খালি DB-তে এটি
   না করলে প্রথম Admin তৈরি-ই আটকে যাবে (সিমুলেশনে প্রমাণিত: `CLOUD_UNVERIFIED`)।
3. **যে ফোনে Admin + ডেটা লোকালি আছে, সেটি আগে খুলে লগইন করুন** — প্রথম সিঙ্কেই Admin record,
   students, notices, transactions, exams নতুন ক্লাউডে seed হবে এবং
   `system/adminInitialized` নিজে থেকেই সেট হবে (`record-sync.js`-এর first-sync seeding)।
4. topbar সবুজ হওয়ার পর **নতুন ফোন/incognito** খুলুন → **Login** দেখবে (Create Admin নয়)।
5. পুরোনো ক্লাউডে-only থাকা কোনো রেকর্ড থাকলে সেটি নতুন DB-তে আসবে না — দরকার হলে বলুন,
   পুরোনো প্রজেক্ট থেকে এক-বারের export/import বানিয়ে দেব (কোনো ডেটা মুছবে না)।

> **ঝুঁকি:** service worker cache-এর কারণে পুরোনো ডিভাইসে config বদলাতে এক-দুবার reload লাগতে
> পারে; `CACHE_VERSION 180` সেটি স্বয়ংক্রিয় করে। কোনো ডিভাইস যদি এখনো পুরোনো প্রজেক্টে লিখে,
> সেটি ক্ষতির নয় — ডেটা ওই ডিভাইসেই থাকে এবং নতুন build পেলে নতুন প্রজেক্টে চলে যাবে।

---
