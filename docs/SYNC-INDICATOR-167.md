# সিঙ্ক স্ট্যাটাস — টপবারের উপরের বর্ডার (v167)

সিঙ্কের অবস্থা এখন **শুধু রঙ** — টপবারের একদম উপরের সরু বর্ডারটাই একমাত্র স্থায়ী
সিঙ্ক ইন্ডিকেটর। Topbar-এ (বা তার পাশে) আর কোনো চিপ, লেবেল, টোস্ট বা স্থায়ী
সিঙ্ক-বার্তা নেই।

## রঙের অর্থ

| রঙ | অবস্থা | কখন |
| --- | --- | --- |
| 🟢 Green | সিঙ্ক সম্পন্ন | সর্বশেষ Firebase read/write নিশ্চিত (`realtimeSync=online` **এবং** `firebaseLastSync` আছে) এবং ডিভাইস অনলাইন |
| 🟡 Amber | সিঙ্ক চলছে / pending | `pending`, `connecting`, অথবা `online` কিন্তু প্রথম সফল transfer এখনো নিশ্চিত নয় |
| 🔴 Red | সমস্যা / অফলাইন | `error`, `offline`, `conflict`, `storage`, অথবা ডিভাইস অফলাইন |
| ⚪ Neutral grey | শুরু হয়নি / অনির্ধারিত | `paused`, সেশন নেই, বা কোনো verdict আসেনি |

- সফল সিঙ্কের পর রঙ **সবুজই থাকে** — শেষ ফলাফলটি ব্যবহারকারীর কাছে পড়ার যোগ্য থাকে।
- সিঙ্ক চলার সময় হলুদ রঙে একটি ধীর, খুব হালকা breathing animation চলে
  (`prefers-reduced-motion` থাকলে foundation.css-এর global নিয়মে সেটি বন্ধ)।
- লাইনটি সব অবস্থায় একই (৩px, solid, শুধু `border-top-color` বদলায়), তাই কোনো
  bar লাফায় না বা সরে না।

## কীভাবে কাজ করে

| বিষয় | সিদ্ধান্ত |
| --- | --- |
| অবস্থার সূত্র | `js/sync-status.js` যে `data-realtime-sync`, `data-firebase-last-sync` আগেই লেখে — ইন্ডিকেটর শুধু তাই পড়ে |
| সিদ্ধান্ত | `js/topbar-connectivity.js` → `<html data-sync-visual="synced\|syncing\|error\|idle">` (একটি attribute, তাই পরে তৈরি হওয়া topbar-ও সঙ্গে সঙ্গে সঠিক রঙ পায়) |
| রঙ | `css/ui-status.css` → `html[data-sync-visual="…"] .app-topbar { border-top-color: … }`; রঙগুলো foundation.css-এর প্যালেট থেকেই (`--tone-mint`, `--tone-amber`, `--color-danger`, `--color-text-muted`) |
| স্ক্রিন-রিডার | দৃশ্যমান নয়, টপবারের বাইরে একটি `role="status"` live region (`#apcSyncAnnounce`) — রঙের অন্ধ-ব্যবহারকারীর বিকল্প |
| লগইন স্ক্রিন | সেখানে কোনো topbar নেই, তাই কোনো সিঙ্ক লেবেলও নেই (`paused`/শুরু হয়নি → neutral) |

## যা বদলায়নি

- Firebase/Cloud Sync-এর মূল logic, `js/realtime-sync.js`, outbox, retry/backoff,
  LocalStorage/IndexedDB ডেটা, authentication ও offline-first workflow — অপরিবর্তিত।
- Topbar-এর ডিজাইন, লোগো, নেভিগেশন, ঘণ্টা ও লগআউট বাটন — হাতে দেওয়া হয়নি।
- ব্যবহারকারীর চাপার মতো কোনো নতুন কন্ট্রোল নেই; একমাত্র আচরণ-পরিবর্তন হলো
  পুরোনো `#cloudSyncStatus` retry বার্তাটি আর আঁকা হয় না (sync নিজের backoff-এ
  স্বয়ংক্রিয়ভাবে retry করে, `online` event-এও আবার শুরু হয়)।

## যাচাই (headless Chromium — আসল HTML/CSS/JS, নমুনা ডেটা)

আসল `js/sync-status.js` চালিয়ে পাঁচটি প্যানেলে computed style পড়া হয়েছে:

| sync-status state | verdict | border-top colour (light) | AMOLED |
| --- | --- | --- | --- |
| `paused` | `idle` | `rgb(101,116,138)` | `rgb(142,150,163)` |
| `connecting` / `pending` | `syncing` | amber (breathing) | lifted amber |
| `online` + `firebaseLastSync` | `synced` | `rgb(14,159,110)` | `rgb(84,224,164)` |
| `error` / `offline` | `error` | `rgb(184,50,57)` | `rgb(255,141,146)` |

- সব অবস্থায় `3px solid`; topbar-এর উচ্চতা ৬৩px — কিছুই নড়ে না।
- সফল সিঙ্কের পর অপেক্ষা করলেও লাইন সবুজ থাকে।
- topbar-এ কখনো সিঙ্ক লেখা নেই; লগইন স্ক্রিনে দৃশ্যমান কোনো text-এ
  `সিঙ্ক / Sync / Syncing / Offline` নেই; `pageerror` শূন্য।

## ফাইল

| ফাইল | পরিবর্তন |
| --- | --- |
| `js/topbar-connectivity.js` | চিপ তৈরি বন্ধ; `<html data-sync-visual>` verdict + SR-only live region |
| `css/ui-status.css` | ইন্ডিকেটরের চার রঙ, subtle animation, `.apc-sync-announce` |
| `js/realtime-sync-entry.js` | `#cloudSyncStatus` ব্যানার সরানো (schedule/notifications অপরিবর্তিত) |
| `css/app-polish.css`, `css/ui-wallet.css` | `topbar-sync-chip` ও `#cloudSyncStatus`-এর মৃত স্টাইল মুছে ফেলা |
| `sw.js` | `CACHE_VERSION 167`, অফলাইন শেলে নতুন ফাইল-সেট |
| `*.html` | `css/design-system.css?v=167`, `js/topbar-connectivity.js?v=20261005-syncborder` |
| `tests/sync-border-indicator.test.mjs` | রঙ-মানচিত্র, topbar-এ টেক্সট নিষিদ্ধ, প্যালেট-টোকেন ও cascade রক্ষা |
| `tests/preview-sync-indicator.test.mjs` | গ্যালারিটি আসল ফাইল ব্যবহার করে কি না, উদ্ধৃত রঙ প্যালেটের সাথে মেলে কি না, ছবি আছে কি না |
| `preview/sync-indicator-167/` | চার অবস্থার ছবি (লাইট + AMOLED), প্যানেল-ছবি, নিষ্ক্রিয় লগইন ছবি, লাইভ ডেমো (আসল topbar + আসল `setSyncStatus`) |

## সিঙ্ক চেক (E2E) — `tests/sync-e2e.spec.cjs`

আসল অ্যাপ, আসল sync engine (`js/realtime-sync.js`), আসল durable outbox ও
localStorage — কেবল Firebase SDK (ক্লাউড সীমানা) স্টাব করা
(`tests/sync-cloud-stub.cjs`)। ফলে নেটওয়ার্ক ছাড়াই পুরো সাইকেল চলে এবং লিংক
ইচ্ছেমতো কাটা/জোড়া লাগানো যায়। এটি যা রক্ষা করে:

1. সাইন-ইন করা ডিভাইস নিশ্চিত সিঙ্কে পৌঁছায় → সবুজ রেখা
2. ডিভাইসের পরিবর্তন সত্যিই ক্লাউডে যায় (outbox → commit)
3. ক্লাউডের পরিবর্তন সত্যিই ডিভাইসে নামে (listener → localStorage)
4. লিংক কাটলে লাল — অথচ পর্দায় সিঙ্ক-সংক্রান্ত একটিও শব্দ/চিপ/টোস্ট নেই
5. পুনরুদ্ধারে **ব্যবহারকারীর কোনো কাজ ছাড়াই** অফলাইন-সম্পাদনা ক্লাউডে পৌঁছায়
   (পুরোনো ব্যানারটিই ছিল হাতে-চাপা retry বাটন — তাই এই পয়েন্টটিই সবচেয়ে জরুরি)
6. সবকিছুর পরও লোকাল ডেটা অটুট (offline-first অপরিবর্তিত)

চালান: `npm run test:e2e -- tests/sync-e2e.spec.cjs`
