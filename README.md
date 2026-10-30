# Active Plus Coaching — শিক্ষার্থী, শিক্ষক ও Admin

**Fixed tagline:** “শিখতে থাকো, এগিয়ে যাও”

Active Plus Coaching-এর মোবাইল-ফার্স্ট Progressive Web App (PWA)। Chrome থেকে ইনস্টল করে অ্যাপের মতো ব্যবহার করা যায়। শিক্ষার্থী অ্যাপ এবং আলাদা শিক্ষক/ম্যানেজার/এডমিন/ক্যাশ প্যানেল রয়েছে। ডেটার মূল adapter এখনও localStorage; পূর্বের anonymous RTDB compatibility bridge সক্রিয়, কিন্তু তার role-level security নেই। Firebase Auth + Firestore production cutover এখনও হয়নি।

### Firebase migration — ধাপ ১ (infrastructure; deploy করা হয়নি)

- `.firebaserc`-এ বিদ্যমান project-এর `prod` alias; প্রকৃত **dev** project ID/সংশ্লিষ্ট public Web config মালিককে দিয়ে পূরণ করতে হবে। Dev Hosting host বা loopback `?firebaseProject=dev`-এ ভুলবশত prod config ব্যবহৃত হয় না; অসম্পূর্ণ dev config fail-closed।
- Node.js 24.12+ এ `npm ci && npm run build:firebase` SDK ও FCM worker-এর same-origin bundles তৈরি করে (`vendor/firebase/`); UI/layout/data schema অপরিবর্তিত। Cloud Functions-এর production runtime nodejs22-ই আছে (শুধু development tooling-এর Node 24 দরকার)। Firestore index file এখন ফাঁকা; Hosting emulator যোগ হয়েছে; callables-এর region `asia-south1`, পূর্বের RTDB triggers `asia-southeast1`।
- CSP meta ও Hosting header-এ localhost emulator connect origins আছে; `sw.js` v304-এ bundles, Auth-policy ও staged read-only gateway modules precache এবং Firebase API traffic cache bypass। App Check-এর per-project site key এখনও ফাঁকা—Console registration ও নিরাপদ enforcement পরে করতে হবে।
- **নতুন Firestore sync চালু নয়।** `js/database.js` localStorage adapter-ই ব্যবহার করে; Auth/Firestore UI integration, কঠোর rules, offline persistence ও data migration বাকি। বর্তমান anonymous RTDB bridge-কে নিরাপদ Firestore sync ভাববেন না। ধাপে ধাপে setup ও non-deploy নির্দেশ: [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md)।

### Firebase migration — ধাপ ২ (identity foundation; deploy করা হয়নি)

- `sync/backend-selection.js`-এ `?backend=local|firebase` tab-scoped selector, default **local**; `sanitize-url.js` শুধু স্বীকৃত public selector ধরে রেখে URL-এর সব query মুছে ফেলে, credentials সংরক্ষণ করে না। এখনও UI/Firestore cutover নয়। পুরোনো anonymous RTDB bridge **local mode-এ সক্রিয়**, কিন্তু `firebase` opt-in-এ বন্ধ থাকে যাতে email Auth session shared bridge-এ ব্যবহৃত না হয়। Local mode থেকে bridge পুরোপুরি সরানোর migration বাকি।
- Staged `signInCloudEmail` কেবল বাস্তব Email/Password Auth ও server-issued role/status claims গ্রহণ করে; UID/email/role/status-এর সঙ্গে `users/{uid}` (Student হলে `students/{uid}`-ও) মিলতে হবে। Local account, username থেকে বানানো email বা anonymous Auth থেকে Firebase role পাওয়া যায় না। বর্তমান login UI এখনও local; `?backend=firebase` opt-in-এ local login/registration submit এবং পুরোনো student/staff local session দিয়ে panel entry নিষিদ্ধ, কিন্তু `?backend=local`-এ সংরক্ষিত session/data অক্ষত থাকে। নতুন Auth দিয়ে panel unlock হয় না।
- Source code-এ পুরোনো `us-central1`-এর public `createFirstAdmin` callable deny-all stub; **deploy হয়নি**, তাই live পুরোনো URL বন্ধ হয়েছে ধরে নেওয়া যাবে না। প্রথম Admin কেবল operator-এর interactive, ADC/emulator-ভিত্তিক Admin SDK CLI দিয়ে bootstrap করতে হবে। `adminCreateAccount` এখন real-email staff provisioning; Student-এর যাচাইকৃত email registration ধাপ ৭-এ server-side staged হলেও UI cutover ও পুরোনো Admin migration এখনও বাকি। আগে dev project-এ rehearsal, prod deploy নয়।

### Firebase migration — ধাপ ৩ (Firestore authorization staging; deploy করা হয়নি)

- `firestore.rules`-এ `users/{uid}` profile ও approval/status, private student তথ্য, summary projection, টাকা/receipt ledger, exam/answer key/result এবং submission-এর **client mutation বন্ধ**। Admin SDK-র server workflow ছাড়া Browser-নির্ভর role/score/পেমেন্ট সিদ্ধান্ত গ্রহণ করা হয় না। Teacher ও payment counter পূর্ণ legacy Student document পড়তে পারে না—শুধু সীমিত approved summary। Student নিজের রেকর্ড পড়তে পারে; payment counter অন্য counter-এর ledger পড়তে পারে না। Question bank/notice/routine-এর Student read scope যাচাই না হওয়া পর্যন্ত বন্ধ।
- `releaseExamResults` এখন কেবল সক্রিয় claim ও প্রকাশিত/শেষ হওয়া পরীক্ষায় কাজ করার কথা এবং বৈধ Firestore document path `exams/{examId}/releasedKey/answers` ব্যবহার করে। Firestore rules-এর পরীক্ষায় emulator-ভিত্তিক বিরূপ role/forgery cases যোগ হয়েছে, **কিন্তু এই পরিবেশে Java/Firestore emulator নেই বলে সেগুলো চালানো যায়নি**। Static tests rules engine-এর বিকল্প নয়।
- এটি **production-ready backend নয়**: staged registration/attempt/Teacher/payment/reversal ও Admin হিসাব-পাঠ এখনও emulator-এ প্রমাণিত নয়; প্রকৃত refund/settlement verification এবং student-scoped notices-এর নিরাপদ server workflow, migration/index inventory, App Check configuration ও staging pilot বাকি। `?backend=firebase`-এ panel access আগের মতোই বন্ধ; localStorage adapter, `?backend=local` fallback, schema ও পুরোনো ডেটা অপরিবর্তিত। কোনো Firebase deploy করবেন না। বিস্তারিত [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md)।

### Firebase migration — ধাপ ৪ (read-only adapter staging; deploy করা হয়নি)

- নতুন `sync/cloud-read-gateway.js` কেবল server-issued email Auth claims + মেলা `users/{uid}`/Student `students/{uid}` যাচাই করে **নিজের সংক্ষিপ্ত profile** এবং অনুমোদিত staff role-এর **সীমিত student summary** ফেরায়। প্রতিটি read-এর আগে নতুন ID token পরীক্ষা, Firebase mode ও legacy RTDB listener gate, strict document ID এবং role/status/class যাচাই হয়। Password hash বা private fields response-এ নেই; কোনো client write/merge/outbox নেই। এটি Firestore Security Rules-এর **বিকল্প নয়**।
- `sync/cloud-read.js` lazy browser wrapper শুধু **পৃথক dev project-এর Auth + Firestore emulator** চালু থাকলে পড়তে পারে; production config, default local mode বা unreloaded legacy bridge-এ fail-closed। এটি `js/database.js`-এর active adapter বা কোনো panel-এ ইনস্টল করা হয়নি—পুরোনো unsafe `createFirestoreAdapter().flush()`-এর পরিবর্তেও নয়। Dev project Web config এখনও অজানা, তাই live data পড়া/মাইগ্রেট করা হয়নি। Local session/data/UI অপরিবর্তিত।
- প্রদত্ত production Firebase config আগে থেকেই আছে; **Analytics স্বয়ংক্রিয়ভাবে চালু করা হয়নি**—consent/privacy সিদ্ধান্ত আলাদা প্রয়োজন। বাকি কাজ: staged registration/attempt/payment/reversal/হিসাব-পাঠের বাস্তব dev emulator integration, settlement/refund flows, verified role-scoped adapter ও rules পরীক্ষা। বিস্তারিত [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md)।

### Firebase migration — ধাপ ৫ (Teacher MCQ submission staging; deploy করা হয়নি)

- `functions/staged-exam-core.cjs`-এ Teacher-এর ভবিষ্যৎ **pending** MCQ ও `exams/{id}/private/key` এক Admin SDK transaction-এ create-only হয়। প্রশ্ন/option/answer, সময়সীমা, unique IDs, class claim এবং সক্রিয় email Auth-এর সঙ্গে `users/{uid}` profile যাচাই; client-এর অজানা field মূল exam-এ যায় না। Retry-এ একই private request hash মিললে idempotent ফল, ভিন্ন payload/owner বা key-only collision হলে প্রত্যাখ্যান। Hash-ও private key document-এ, public paper-এ নয়।
- নতুন `teacherSubmitExamForReview` callable-এ **App Check enforcement**; `managerReviewExam` এখন শুধু যাচাইকৃত staged paper+private key ও ভবিষ্যৎ start time থাকলে publish করে। অনিরাপদ পুরোনো Firestore draft (বা nested answer leak) publish হয় না; এটি চলতি local পরীক্ষার flow-তে যুক্ত হয়নি। বাস্তব dev project, App Check key, Functions/Firestore emulator integration এবং পুরোনো data migration **বাকি**। Default local UI/ডেটা অপরিবর্তিত; production-এ deploy করবেন না।

### Firebase migration — ধাপ ৬ (Student MCQ attempt ও release lock staging; deploy করা হয়নি)

- `studentSubmitExamAttempt` callable-এ App Check + approved Student-এর real email Auth, `studentId === Auth UID` claim, মিলতে থাকা `users/{uid}` ও `students/{uid}`, নিজ ক্লাস/গ্রুপ, প্রকাশিত MCQ, window এবং প্রতিটি প্রশ্নে A–D/ফাঁকা উত্তর যাচাই হয়। Server transaction exam-সহ পড়ে **একটি** `attempts/att_<hash>` রেকর্ড create করে—Student/browser Firestore-এ সরাসরি লিখতে পারে না; duplicate retry একই উত্তর হলে read-only success, ভিন্ন উত্তর/late নতুন submit নিষিদ্ধ। Scoring key ছাত্র-পথে পড়া হয় না।
- `releaseExamResults` প্রথমে exam document-এ durable `closing` lock দেয়; সেই doc পড়া কোনো in-flight attempt transaction তখন retry করে lock দেখে থামে। সব জমা attempt যাচাই ছাড়া একটিও score বা released answer লেখা হয় না; Firestore rules final `resultsReleased` marker না আসা পর্যন্ত Student-এর আংশিক score/answer read বন্ধ রাখে এবং অন্য group-এর answer-ও আটকায়। ব্যর্থ release-এ lock রক্ষিত থাকে, বৈধ retry ফল সম্পূর্ণ করে; result ID `res_<hash>` deterministic এবং exam/student ID-র ambiguous concatenation নয়। **এটি এখনও UI/panel cutover বা emulator-proven integration নয়।** Local data, default mode ও পুরোনো exam schema অপরিবর্তিত; বাস্তব dev project, App Check ও emulator matrix ছাড়া deploy নয়।

### Firebase migration — ধাপ ৭ (verified Student enrollment ও Manager review staging; deploy করা হয়নি)

- পৃথক dev Firebase project-এ **আলাদা** Email/Password Auth account তৈরি ও email verify করার পরে, App Check-সহ `studentRegisterForReview` callable শুধু নিজের Auth UID/email গ্রহণ করে। Password/PIN/UID/role/status/fee client payload হিসেবে নেওয়া হয় না। নির্ধারিত ক্লাস, মোবাইল, স্থায়ী username ও সম্মতির সত্যতা-ঘোষণা যাচাই করে এক transaction-এ `usernameIndex/{username}`, `users/{uid}`, `students/{uid}` pending create হয়; তারপর server-issued pending claim দেওয়া হয়। একই payload retry claim-update ব্যর্থতাও সারায়; ভিন্ন data বা অন্য UID একই username নিতে পারে না। Pending/Rejected Student কোনো Firebase panel বা পরীক্ষায় ঢোকে না।
- App Check-সহ `managerReviewStudent` এখন Auth verified email, profile/username UID link এবং pending status যাচাই করে Manager-এর অনুমোদন/কারণসহ প্রত্যাখ্যান transaction-এ audit করে; Auth claim update ব্যর্থ হলে **একই** সিদ্ধান্ত retry করা যায়, উল্টো সিদ্ধান্তে state বদলানো যায় না। Reject-এর পরে username স্বয়ংক্রিয়ভাবে মুক্ত হয় না। Approved Student summary/fee এখনও **তৈরি হয় না**—payment flow ও প্রকৃত Student ID মাইগ্রেশন আলাদা কাজ। Browser registration/login অপরিবর্তিত; dev config ও App Check key ফাঁকা, Java emulator নেই, তাই **এখনও deploy/UI cutover নয়**।

### Firebase migration — ধাপ ৮ (Counter pending receipt ও Manager review staging; deploy করা হয়নি)

- `adminConfigureStudentFee`: active Admin প্রকৃত approved Auth/Student/profile মিলিয়ে **একবার** সীমিত `studentSummaries/{uid}` projection-এ যাচাইকৃত পূর্ণ টাকায় monthly fee সেট করে; অননুমোদিত field বা বদলানো fee/classে retry প্রত্যাখ্যাত। ধাপ ৭-এর approved Student-দের জন্য summary নিজে থেকে তৈরি হয় না; এই explicit ধাপ ও প্রকৃত ফি সিদ্ধান্ত জরুরি।
- `counterSubmitPayment`: active Cash Counter-এর verified profile, approved Student ও বর্তমান summary মিললে এক transaction-এ pending `transactions/pay_<hash>`, counter sequence, globally reserved receipt number এবং non-cash transaction reference create করে। একই counter+`requestId`+payload retry নতুন রসিদ/ক্রমিক নম্বর খরচ করে না; অন্য amount/reference দিয়ে retry প্রত্যাখ্যাত। Client role/status, receipt number, reviewed state বা fractional/negative amount দিতে পারে না। Local ledger বা পুরোনো রসিদ বদলায় না।
- `managerInspectPayment` শুধু **পরিচিত** receipt ID-র review-প্রয়োজনীয় সীমিত projection দেখায়; Manager-এর সরাসরি Firestore finance-ledger read বন্ধ। `managerReviewPayment` pending receipt-কে একবার approve/reject করে, rejection-এ কারণ বাধ্যতামূলক; উল্টো সিদ্ধান্ত/Browser write নিষিদ্ধ। চার callable-এ App Check বাধ্যতামূলক। এটি **payment gateway settlement-এর প্রমাণ নয়**: non-cash `trxRef`-ও শুধু counter-দেওয়া তথ্য, cash শারীরিকভাবে যাচাই করতে হবে। Reversal ধাপ ৯-এ কেবল হিসাব-সংশোধনের staging; reconciled billing, migration, Firebase UI cutover ও emulator পরীক্ষা বাকি। Default local mode অপরিবর্তিত; production deploy নয়।

### Firebase migration — ধাপ ৯ (দুই ভূমিকায় হিসাব-সংশোধন staging; deploy করা হয়নি)

- Manager `managerRequestPaymentReversal`-এ **শুধু অনুমোদিত, server-number-যাচাইকৃত** রসিদের ID+নম্বর ও কারণ (৮–৫০০ অক্ষর) দিয়ে একটি `paymentReversals/{receiptId}` pending অনুরোধ তৈরি করেন। মূল `transactions/{receiptId}` বা receipt number/reference reservation **বদলায় না**। একই Manager-এর একই কারণের retry read-only; অন্য বা দ্বিতীয় অনুরোধ নিষিদ্ধ।
- পৃথক Admin `adminDecidePaymentReversal` দিয়ে কারণসহ একবার অনুমোদন/প্রত্যাখ্যান করেন। অনুমোদিত সংশোধনই ভবিষ্যতের **যাচাইকৃত হিসাব-পাঠে** ওই রসিদের net contribution শূন্য করবে; pending বা rejected correction মূল approved অঙ্ক অক্ষত রাখবে। `netApprovedAmount()`-এর pure contract ও unit tests আছে; ধাপ ১০-এ শুধু Admin-এর bounded server-side read-এ ব্যবহার হয়েছে, **live local হিসাব বা Firebase UI-তে wired নয়**—reversal document না পড়ে পুরোনো raw ledger sum দিয়ে বকেয়া গণনা করা যাবে না। Reject হলে একই রসিদের আবেদন স্বয়ংক্রিয়ভাবে আবার খোলে না। Browser-এ reversal write বন্ধ; Admin-only read, Manager direct ledger read এখনও নিষিদ্ধ; উভয় callable-এ App Check বাধ্যতামূলক।
- এটি **নগদ টাকা ফেরত, বিকাশ/ব্যাংক refund, processor settlement বা পুরোনো ledger migration নয়**। মানুষের evidence/financial reconciliation, নিরাপদ per-student totals, index/backup, dev Auth/Rules/Functions emulator test, বাস্তব App Check key ও UI migration ছাড়া deploy নয়; default local adapter ও data অপরিবর্তিত।

### Firebase migration — ধাপ ১০ (Admin-এর read-only verified payment position staging; deploy করা হয়নি)

- `adminReadStudentPaymentPosition` App Check-সহ active Admin-এর নিজের profile ও approved Student-এর fee summary মিলিয়ে **একটি read-only Firestore transaction**-এ ওই Student-এর সব staged receipt ও correction query করে। প্রত্যেক receipt-এর server-issued নম্বর, digital reference ও correction document যাচাই হয়; ওই UID-র orphan correction, queried Student-এর legacy/forged/ভিন্ন-মালিক row বা ১০০টির বেশি receipt/correction থাকলে আংশিক মোট না দেখিয়ে fail-closed। UID-বিহীন পুরোনো row স্বয়ংক্রিয়ভাবে আবিষ্কৃত হয় না—migration inventory জরুরি। শুধু একটি মাসের সারাংশ ফেরালেও যাচাইয়ে অন্য মাসের row-ও বাদ যায় না। Query-দুটি `transactions.studentId == uid` ও `paymentReversals.studentId == uid`—default single-field index; composite index যোগ করা হয়নি।
- অনুমোদিত gross থেকে শুধু **Admin-approved** correction বাদ দিয়ে net amount; pending/rejected receipt বা pending/rejected correction বকেয়া কমায় না। মাসিক tuition-এর net amount-ই configured monthlyFee থেকে due কমায়—অন্য fee type নয়। Server fee configuration-এর **Dhaka মাসের আগে** বা চলতি মাসের পরে ঐতিহাসিক/ভবিষ্যৎ fee schedule অনুমান করে due দেখায় না। Response-এ aggregate অঙ্ক/সংখ্যা ও Student UID থাকে, private profile বা raw ledger থাকে না।
- এটি **live Student/Counter balance, money settlement, billing history বা UI adapter নয়**। পুরোনো local হিসাব অপরিবর্তিত; report snapshot-এর পরে নতুন receipt/decision এলে পরের read-এ পরিবর্তন দেখা যেতে পারে। সম্পূর্ণ emulator role/query/transaction পরীক্ষা, প্রকৃত dev config/App Check, historical fee schedule, pagination, verified financial evidence ও reconciliation ছাড়া deploy/cutover নয়।

### Firebase migration — ধাপ ১১ (পুরোনো ledger-এর offline preflight; import নয়)

- Admin Backup & Restore-এর `BACKUP_KEYS` allowlist-এ students/transactions-সহ পরিচিত collection আছে; account/session/password-hash keys নয়। নতুন export version 3-এ আলাদা user-chosen passphrase, PBKDF2-SHA256 ও AES-256-GCM ব্যবহার করে; passphrase অ্যাপ সংরক্ষণ বা পাঠায় না। পুরোনো version 1/2 এখনও restore করা যায়, কিন্তু সেগুলো গোপনীয় ধরে নেবেন না। `npm run preflight:ledger -- --backup /private/APC-backup.json --links /private/reviewed-links.json`: ওই Admin export-এর **raw-string** students/transactions collection এবং আলাদাভাবে মানুষ-যাচাইকৃত `{"kind":"apc-reviewed-student-links","version":1,"links":[{"legacyStudentId":"OLD_ID","uid":"REAL_AUTH_UID"}]}` ফাইল **শুধু পড়ে**। নিজে mobile/name দেখে UID অনুমান, localStorage/Firestore/RTDB-তে write, network request বা Firebase Auth account তৈরি করে না। Backup-এ password hash/ব্যক্তিগত তথ্য থাকতে পারে: ফাইল repository-তে রাখবেন বা chat-এ দেবেন না।
- Version 3 ফাইলের passphrase offline preflight-এ interactive terminal-এ echo ছাড়া জিজ্ঞেস করা হয়; argument, environment, log বা chat-এ তা দেবেন না। রিপোর্টে কেবল সংখ্যা ও blocker code—duplicate/orphan ID বা receipt, অনুপস্থিত/দ্ব্যর্থক UID mapping, ভগ্নাংশ/নেতিবাচক টাকা, অনির্দিষ্ট monthlyFee, যাচাইহীন পুরোনো approval status/audit, month/method ও duplicate digital reference। কোনো নাম, মোবাইল, Student ID, UID, receipt/reference বা password hash ফেরায় না। Input সীমা ৩২ MiB/১ লক্ষ row; ভুল input-এ raw parser text দেখায় না। Exit ০ = এই offline inventory-তে blocker নেই, ২ = blocker আছে, ১ = invalid input। **সব সময় `importAllowed:false`:** বাস্তব Firebase Auth ownership, পুরোনো deletion history, cash/processor reconciliation এবং emulator/backups যাচাই ছাড়া import অনুমোদিত নয়। Stage ১০-এর strict report-এ legacy ID row ঢোকানোও হয়নি। Default local UI/data ও Analytics অপরিবর্তিত; কোনো deploy নয়।

### মার্জ-পূর্ব যাচাই — ঢাকা মধ্যরাতের regression (cache 307)

- Notification Action Center-এর homework test এখন পরীক্ষার মেশিনের OS timezone নয়, অ্যাপের Asia/Dhaka দিন ব্যবহার করে। UTC ১৮:০০-র পরে ঢাকা-দিন বদলালেও existing homework-এর read/unread history ঠিক থাকার পরীক্ষা স্থিতিশীল। অ্যাপের নিয়ম/ডেটা, RTDB permissions বা Firebase production deploy এতে বদলায়নি।

### Firebase RTDB sync — পৃথক dev project প্রস্তুতি (preview; production চালু নয়)

- Default `?backend=local`-এ আগের anonymous `activePlusSync/v1` bridge login-এর পর চালুর চেষ্টা করে; `?backend=firebase` হলো staged Firestore/Email-Auth mode, **RTDB sync switch নয়**। বর্তমান `database.rules.json`-এর `auth != null` anonymous caller-কে roster, ledger ও password hash পড়া/বদলানোর সুযোগ দেয়—এটি production-এ নিরাপদ নয়। পুরোনো runbook-এর production rules deploy নির্দেশনা অনুসরণ করবেন না।
- `*.e2b.app` live preview এখন **dev Firebase only**: প্রকৃত পৃথক dev Web config না থাকলে fail-closed, production DB-তে fallback নয়। `firebase/firebase-config.dev.js`-এ বাস্তব dev project's **public** `apiKey`, `authDomain`, `appId`, `projectId`, এবং একই dev project's `databaseURL` বসাতে হবে; এই repo-তে কোনো প্রকৃত dev project-এর তথ্য নেই। Production project ID/DB URL দিয়ে preview চালু করা যায় না। কোনো service-account/private key নয়।
- কেবল ফাঁকা dev project ও নতুন browser profile-এ **কৃত্রিম** account/transaction নিয়ে পরীক্ষা করুন; বাস্তব ডেটা থাকা device/profile দিয়ে dev preview-তে login করবেন না—bridge local records upload করতে পারে। Developer-কে আলাদাভাবে dev Auth Anonymous provider, RTDB rules ও App Check/authorized-domain settings যাচাই করতে হবে; এই পরিবর্তন কোনো Console setting বা deploy করে না। নির্দেশনা: `FIREBASE_SETUP.md`।

### Firebase migration — ধাপ ১২ (দুই–চারটি Admin backup-এর offline তুলনা; merge/import নয়)

- `npm run compare:ledger-backups -- --backup /private/device-A.json --backup /private/device-B.json` (সর্বোচ্চ চারটি `--backup`) **নিজস্ব offline machine-এ** চালান। Version 1/2/3 `active-plus-backup`-এর students/transactions raw-string arrays পড়ে; version 3-এর passphrase interactive terminal-এ echo ছাড়া জিজ্ঞেস করে, কখনো argument বা environment-এ দিতে হয় না। কোনো Firebase/RTDB/localStorage/network access, export, merge বা write করে না। প্রতি ফাইলে সর্বোচ্চ ৩২ MiB, প্রতি collection-এ ১ লক্ষ row। বাস্তব backup repo/chat/CI-তে রাখবেন না; ব্যক্তিগত তথ্য থাকতে পারে।
- একই ID-র ভিন্ন content (property order উপেক্ষা করে), ভিন্ন transaction ID-তে একই receipt বা একই method-এর case-insensitive reference, এক/একাধিক snapshot-এ ID অনুপস্থিত, একই snapshot-এ duplicate/invalid ID, invalid timestamp/method/reference—সবই শুধু **aggregate blocker count**। Missing row মানেই deletion নয়; timestamp দিয়ে newer-wins বেছে নেওয়া বা অনুপস্থিত row auto-union নিরাপদ নয়। পুরোনো `tools/merge-backups.html`-এর downloadable union **financial migration-এর জন্য ব্যবহার করবেন না**। Report-এ raw ID, নাম, মোবাইল, receipt/reference, টাকা, filename/path বা credential নেই।
- Exit `0` = তুলনায় blocker নেই, `2` = blocker আছে, `1` = invalid input (generic error)। `importAllowed:false` ও `sourceCompletenessVerified:false` **সব সময়**; clean comparison-ও পূর্ণ backup, Auth ownership বা টাকা/processor settlement প্রমাণ নয়। প্রতিটি উৎসে পৃথক ধাপ ১১-এর explicit UID-link preflight, missing/changed records-এর source-device ও signed evidence review, deletion history এবং dev emulator rehearsal ছাড়া import/deploy নয়। Default local UI/data ও production অপরিবর্তিত।

## বর্তমান সীমাবদ্ধতা

- **নিরাপদ role-separated Firestore sync চালু নয়** — localStorage মূল store; legacy anonymous RTDB bridge কিছু রেকর্ড mirror করে, কিন্তু Auth claims দিয়ে ব্যক্তি/role আলাদা করে না। একাধিক ডিভাইসে এই bridge-কে নির্ভরযোগ্য বা নিরাপদ backup ধরে নেবেন না।
- **Firebase foundation ≠ production cutover** — Functions/rules-এর পুরোনো খসড়া ও ধাপ ১-এর SDK/emulator/index scaffolding আছে; যথার্থ Auth, Firestore rules, App Check enforcement, migration ও pilot এখনও বাকি।
- **বাস্তব শিক্ষার্থীর তথ্য বা টাকার হিসাব রাখার আগে Firebase sync বাধ্যতামূলকভাবে চালু ও যাচাই করতে হবে** — নাহলে রেকর্ড এক ডিভাইসেই বন্ধ থাকবে এবং একাধিক কাউন্টার/প্যানেল ভাগ করে ব্যবহারে হিসাব অসঙ্গতিপূর্ণ হবে।

## এই ধাপে যা আছে

- অফলাইন লগইন পেজ — **একই ফর্মে সবার প্রবেশ**: শিক্ষার্থী **ইউজারনেম (বা মোবাইল নম্বর)** ও ৪–৬ সংখ্যার পাসওয়ার্ড দিয়ে, আর শিক্ষক/এডমিন/পেমেন্ট কাউন্টার নিজের ইউজারনেম (`teacher.apc` / `admin.apc` / `payment.apc`) ও পাসওয়ার্ড দিয়ে — সেশন আগে জমা হয়, তাই প্যানেল দ্বিতীয় ফর্ম ছাড়াই খোলে
- স্থানীয় Noto Sans Bengali variable font; অ্যাপেই preload ও offline cache করা আছে, ভবিষ্যতের offline PDF export-এর জন্য প্রস্তুত
- ধাপে ধাপে শিক্ষার্থী self-registration; শিক্ষক ও এডমিন account management পরবর্তী Admin Panel-এ থাকবে
- Login-এর মোবাইল নম্বরই যোগাযোগের নম্বর হিসেবে fixed থাকে এবং registration-এর যোগাযোগ ধাপে read-only দেখায়
- **স্থায়ী ইউজারনেম** — নিবন্ধনের প্রথম ধাপে শিক্ষার্থী নিজেই ইউজারনেম বানায় (৪–২০ অক্ষর, ইংরেজি অক্ষর দিয়ে শুরু, ছোট হাতের অক্ষর/সংখ্যা/`.`/`_`); লাইভ যাচাই, ইংরেজি নাম থেকে সাজেশন ও সংরক্ষিত নাম (admin, support, payment ইত্যাদি) ব্লক করা। **একবার নিলে আর বদলানো যায় না** — প্রোফাইলে লক করা ঘরে দেখায়, অ্যাকাউন্ট আবার সেভ করলেও বদলায় না (`js/account-policy.js` → `protectAccountIdentity`)। একই ডিভাইসে দুই অ্যাকাউন্ট এক নাম নিতে পারে না (`active-plus-usernames-v1`); এটি ডেমো, তাই এই দাবি শুধু সেই ব্রাউজারেই খাটে। লগইন, পাসওয়ার্ড রিকভারি ও ডেমো অ্যাকাউন্ট — সব ক্ষেত্রেই **ইউজারনেম** দিয়ে লগইন; সুবিধার জন্য মোবাইল নম্বর ও প্রোফাইলের **Student ID** দিয়েও চেষ্টা করা যায় (তিন ক্ষেত্রেই পাসওয়ার্ড লাগে)। **Student ID ইউনিক ট্র্যাকিং আইডি** — Admin, Manager, Cash Counter ও Teacher প্যানেলের সার্চে নাম, মোবাইল বা Student ID (সংক্ষিপ্ত রূপ ও বাংলা সংখ্যাসহ) দিয়ে শিক্ষার্থী খুঁজে বের করা যায় (`js/student-search.js`)
- বাংলা ও ইংরেজি নাম, অভিভাবক, জন্মতারিখ, লিঙ্গ, মোবাইল, পূর্ণ ঠিকানা, ক্লাস, গ্রুপ ও ঐচ্ছিক শিক্ষা তথ্য
- **আমার কোর্স (শিক্ষার্থী পোর্টাল)** — ক্যাটাগরি টাইল সবসময় সারিতে **দুটি করে অর্ধেক প্রস্থে** (৩টি হলে ২+১ ফুল, ৪টি হলে ২+২); শিক্ষকের দেওয়া কাজের কার্ড ও ডেমো কোর্স তালিকা **চাপলেই তথ্য খোলে** (সংক্ষিপ্ত ভিউতে ধরন/অবস্থা/শেষ সময়, খুললে বিস্তারিত-মেটা, শিক্ষক ও অ্যাকশন); কার্ডের কোণায় ঘোরানো চেভরন খোলা/বন্ধ বোঝায়; **এই টার্মের অগ্রগতি** কার্ডটি এখন তালিকার একদম উপরে
- ফলাফল ভিউ: **সর্বশেষ মডেল টেস্ট** সারাংশ এখন সবার উপরে দেখা যায়; প্রোফাইলের **তথ্য হালনাগাদ**-এ রেজিস্ট্রেশন নম্বর স্থায়ীভাবে লকড (Student ID-র মতো — ফর্মে বদলানো যায় না)।
- নিরাপত্তা প্রশ্নের মাধ্যমে পাসওয়ার্ড পুনরুদ্ধার; ভবিষ্যতে এডমিন পাসওয়ার্ড reset করতে পারবেন
- ৮ম শ্রেণি থেকে অনার্স ৪র্থ বর্ষ পর্যন্ত enabled class তালিকা
- রেজিস্ট্রেশনের পরে স্বয়ংক্রিয় ইউনিক Student ID — বছর, মাস, class code, ডিভাইস-নিরপেক্ষ অংশ ও sequence
- অনুমোদনের আগেও লগইন করা যাবে, কিন্তু pending account-এ শিক্ষার্থী ফিচার ব্যবহার করতে পারবে না
- **AMOLED ডার্ক থিম (Light/AMOLED)** — ডিভাইস-বাউন্ড থিম, অপ্ট-ইন: ডিফল্ট লাইট, প্রোফাইল কার্ডের টগল চালু করলেই গভীর কালো। ক্যানভাস সত্যিকারের `#000` (OLED প্যানেল ওই পিক্সেলগুলোই নেভায়, তাই ব্যাটারি বাঁচে), কার্ড/টাইল ক্যানভাস থেকে মাত্র এক ধাপ উঁচুতে (`#0b0d10` → `#171a20`) আর বর্ডার দিয়ে আলাদা — কালোয় ছায়া দেখা যায় না, শুধু পেইন্ট খরচ হয়, তাই AMOLED-এ `--shadow-sm:none`। টেক্সট, সেকেন্ডারি টেক্সট ও স্ট্যাটাস রঙ সব সারফেসে WCAG AA (৪.৫:১) পাস করে — `tests/amoled-theme.test.mjs` এটা লিখে রাখে। টপবার/বটম নেভিগেশন কালো, মডালের পেছনে প্রায় অস্বচ্ছ কালো পর্দা, টোস্ট সাদা ঝলকানি নয়; PDF/রসিদ প্রিভিউ সাদা কাগজই থাকে (Renderer-এর geometry অপরিবর্তিত)। একটাই প্যালেট — `css/foundation.css`; অন্য কোনো CSS-এ রঙ লেখা নিষিদ্ধ (টেস্টে ধরা পড়ে)। `js/appearance.js` + প্রি-পেইন্ট বুট স্ক্রিপ্টে ফ্ল্যাশ হয় না; সিস্টেম প্রেফারেন্স কখনো নিজে থেকে AMOLED চালু করে না
- **নোটিফিকেশন (ইন-অ্যাপ + ঐচ্ছিক পুশ)** — টপবারের ঘণ্টায় অপঠিত সংখ্যা ও সব নোটিশ/জরুরি ঘোষণা/পরীক্ষা-ফলাফলের তালিকা; চালু করলে অ্যাপ খোলা বা ব্যাকগ্রাউন্ডে থাকলে ফোনের নোটিফিকেশন ট্রেতেও আসে, আর FCM পুশ প্রস্তুত থাকলে অ্যাপ বন্ধ থাকলেও আসে (`NOTIFICATIONS.md`)।
- **ID চিপে ট্যাপ-টু-কপি** — প্রোফাইলে Student ID ও ইউজারনেম চিপে এক ট্যাপে কপি (কীবোর্ড Enter/Space-ও কাজ করে), টোস্ট কনফার্মেশনসহ (`js/copy.js`)
- **ভিউ ডিপ-লিংক ও ব্রাউজার Back** — ছাত্র অ্যাপের প্রতিটি ভিউর নিজস্ব হ্যাশ রুট (`#routine`, `#courses`, `#results`, `#profile`); ট্যাব বদলালে URL আপডেট হয়, ব্রাউজার/অ্যান্ড্রয়েড Back আগের ভিউতে ফেরে, রিফ্রেশ বা শেয়ার করা লিংক ঠিক সেই ভিউই খোলে
- শিক্ষার্থীর অফলাইন হোম ড্যাশবোর্ড — ফ্ল্যাট ব্যাকগ্রাউন্ড, সাদা কার্ড, গ্রিন প্রাইমারির নতুন ডিজাইন, স্বাগত কার্ড, "আজকের পড়াশোনা" স্ট্যাট কার্ড, দ্রুত কাজ গ্রিড ও লিস্ট রো
- **সব প্যানেলে এক টপবার** — শিক্ষার্থী, এডমিন, ম্যানেজার, শিক্ষক ও পেমেন্ট কাউন্টার সব জায়গায় হুবহু এক: বাঁয়ে লোগো + স্লোগানই (প্যানেলের নামের লাইন নেই), ডানে শুধু **নোটিফিকেশনের ঘণ্টা** ও **লগআউট**। পুরোনো তারিখ/ঘড়ি, নাম-চিপ, থিম বাটন, পিন ও শর্টকাট সরানো হয়েছে। টপবারের উপরের বর্ডারই সিঙ্কের রং জানায় — লাল = অফলাইন, সবুজ = অনলাইন, নীল = ক্লাউড সিঙ্ক চালু (`css/ui-status.css`)।
- সাপ্তাহিক অগ্রগতি, উপস্থিতি, গড় ফলাফল ও বাকি কাজ
- ক্লাস রুটিন — দিনভিত্তিক ফিল্টারসহ
- চলমান কোর্স ও অধ্যায়ভিত্তিক অগ্রগতি
- সাম্প্রতিক পরীক্ষার ফলাফল
- হেডারের ঘণ্টায় একটিমাত্র নোটিশ ইনবক্স; খুললে অপঠিত চিহ্ন সরে যায়, আগের নোটিশ ইতিহাসে থাকে। শিক্ষার্থীভিত্তিক পড়ার অবস্থা একই ডিভাইসে অফলাইন/রিলোডেও থাকে; ঘোষণার লেখা বদলালে আবার অপঠিত হয়।
- **রক্ষণাবেক্ষণ মোড (Maintenance)** — Admin → সিস্টেম সেটিংসে একটি সুইচ ও ঐচ্ছিক বার্তা; চালু করলে শিক্ষার্থী অ্যাপের লগইন কার্ড ও হোমের উপরে “সিস্টেম রক্ষণাবেক্ষণ চলছে” সতর্কতা দেখা যায়, বন্ধ করলেই সব ডিভাইস থেকে সাথে সাথে সরে যায় (অ্যাডমিন ড্যাশবোর্ডে চালু থাকার কথা মনে করিয়ে দেয়) — বিস্তারিত `docs/MAINTENANCE-MODE.md`।
- **নোটিফিকেশন সিস্টেম** — ঘণ্টার ইনবক্সের পাশাপাশি নতুন নোটিশ, জরুরি ঘোষণা, পরীক্ষা ও ফলাফলের খবর এখন ফোনের নোটিফিকেশন ট্রেতে আসে (প্রতিটি ডিভাইসে একবার অনুমতি দিলেই); Admin → সেটিংসে মাস্টার সুইচ ও "জরুরি ঘোষণা", আর অ্যাপ সম্পূর্ণ বন্ধ থাকলেও push চালু করার নিয়ম `NOTIFICATIONS.md`-এ।
- শিক্ষকের দেওয়া কাজে মোট/বাকি/সম্পন্ন বাড়ির কাজের সারসংক্ষেপ, সংখ্যাসহ ধরনভিত্তিক ফিল্টার, বিষয়–তারিখ–শিক্ষক–অবস্থাসহ মোবাইল কার্ড ও বড় অ্যাকশন বাটন
- ব্যক্তিগত তথ্য লোকালস্টোরেজে সম্পাদনা ও সংরক্ষণ
- PWA install prompt এবং service worker cache
- local time অনুযায়ী হোমের অভিবাদন, পরামর্শ ও ক্লাসের তারিখ আপডেট হয়
- অষ্টম শ্রেণি থেকে অনার্স ৪র্থ বর্ষ পর্যন্ত ক্লাস কনফিগারেশনের ভিত্তি
- এডমিন প্যানেল — ইউজারনেম `admin.apc` ও নিজের নির্ধারিত পাসওয়ার্ড দিয়ে প্রবেশ (`admin.html`)
- **সম্পূর্ণ ডাটাবেজ রিসেট (ফ্যাক্টরি রিসেট)** — এডমিন প্যানেল → ডেটা → পাসওয়ার্ড-নিশ্চিতকরণসহ রিসেট: ক্লাউড ও লোকাল সব ডেটা মুছে লগইন পেজে নতুন এডমিন অ্যাকাউন্ট তৈরির ফ্লো ফিরিয়ে আনে (`docs/FACTORY-RESET.md`)

## AMOLED থিম — এক প্যালেট, সব প্যানেল

থিম ঠিক করে দুটি ফাইল: **`css/foundation.css`** (প্যালেট) আর **`css/app-polish.css`-এর AMOLED ব্লক**
(শুধু কম্পোনেন্ট-টিউনিং, কোনো রঙের নতুন সংজ্ঞা নয়)। শিক্ষার্থী, এডমিন, ম্যানেজার, শিক্ষক, পেমেন্ট ও
লগইন — সব একই variable পড়ে, তাই এক প্যানেলে রঙ বদলালে বাকিগুলোতেও বদলায়।

| টোকেন | লাইট (ডিফল্ট) | AMOLED |
| --- | --- | --- |
| `--color-bg` | `#f3f6fb` | `#000` (সত্যিকারের কালো) |
| `--color-surface` | `#fff` | `#0b0d10` |
| `--color-surface-muted` | `#edf3fc` | `#171a20` |
| `--color-border` | `#dce5f0` | `#2b303a` |
| `--color-text` | `#213047` | `#f4f6fa` |
| `--color-primary` | `#2864bd` | `#5ea9ff` |
| `--color-success` / `--warning` / `--danger` | `#187346` / `#875b0c` / `#b83239` | `#5cd68f` / `#f2c56d` / `#ff8d92` |
| `--shadow-sm` | নরম ছায়া | `none` (কালোয় ছায়া অদৃশ্য) |
| `--modal-backdrop` | `#17243866` | `#000000d9` |

AMOLED-এ কী আলাদা আচরণ করে:

- টপবার, বটম নেভিগেশন ও অ্যাডমিন বটম-বার **কালোই** থাকে — কার্ডগুলো তখন সত্যিই ভেসে ওঠে।
- টোস্ট (`.feedback-toast`, `.pay-toast`, `.apc-lock-notice`) লাইট মোডে উল্টো (গাঢ়) থাকে; কালোয় সেটাই ফ্ল্যাশলাইট হয়ে যেত, তাই সেগুলো বর্ডার-সহ উঁচু সারফেস।
- ব্র্যান্ড লোগো PNG প্রায় সাদা কাগজের ছবি — AMOLED-এ `brightness(.94)`, নইলে রাতের স্ক্রিনে জ্বলে ওঠে।
- PDF/রসিদ প্রিভিউর সাদা কাগজ ইচ্ছাকৃত: ওটা প্রিন্ট-ডকুমেন্টের হুবহু প্রতিচ্ছবি (`js/print-tokens.js`), তাই থিম বদলালেও সাদাই থাকে।
- পুরনো ছায়া-ভিত্তিক বিচ্ছেদ কালোয় কাজ করে না; বর্ডারই ভাগ করে — তাই কার্ডে `box-shadow` সরানো, মডালে একটাই গভীর ছায়া।

নিয়ম (টেস্টে পাহারা দেওয়া):

- প্যালেট শুধু `css/foundation.css`-এ; বাকি CSS-এ `--color-*` সংজ্ঞা দিলে `tests/amoled-theme.test.mjs` ফেল করে।
- AMOLED ব্লকের selector **সমতল** (`html[data-theme="dark"] .x`) — CSS nesting পুরনো Android WebView-তে ব্লক-ভাঙা বাগ, তাই নিষিদ্ধ।
- AMOLED টেক্সট/-সেকেন্ডারি/-স্ট্যাটাস রঙের কনট্রাস্ট টেস্টেই হিসাব হয়; কেউ "উজ্জ্বল" করতে গিয়ে পড়ার অযোগ্য করলে ধরা পড়বে।
- প্রতিটি পেজের `theme-color` meta আর `js/appearance.js`-এর `THEME_COLOR` এক থাকতে হবে।

প্রথম রান এখনও **লাইট** — AMOLED কেবল ব্যবহারকারীর নিজের টগলে চালু হয় (সেটিং আগের মতোই থাকে)।
কেউ চাইলে ডিফল্ট AMOLED করা যায়: `js/appearance.js`-এর `getTheme()`-এ `getStoredTheme() || 'light'` কে
`|| 'dark'` করা আর `js/appearance-boot.js`-এ একই লাইন — তবে তাতে `tests/appearance.test.mjs`-এর
"first run is always light" নিয়মও বদলাতে হবে (স্কুলের সিদ্ধান্ত হিসেবে ধরুন)।

## গ্লাস ইন্টেরিয়র — ভেতরের পাতাগুলোর উপাদান

ভেতরের সব পর্দা (ড্যাশবোর্ড, তালিকা, ফর্ম, মডাল) এখন একই উপাদানে তৈরি: **ফ্রস্টেড কাচ** —
নরম রঙের আবহের উপর হালকা ট্রান্সপারেন্ট প্যানেল। স্কিনটা আলাদা ফাইলে: `css/ui-interior.css`
(প্যালেট নয়, শুধু উপাদান — তাই `css/foundation.css` অপরিবর্তিত নিয়মেই একমাত্র প্যালেট)।

| স্তর | কী পায় | কেন |
| --- | --- | --- |
| টপবার, বটম নেভিগেশন, স্ট্যাটাস বার | ব্লার + ব্যাকগ্রাউন্ড (sticky/fixed) | কনটেন্ট এর নিচ দিয়ে গড়িয়ে যায়, কাচের ব্যাকড্রপ বাড়তি খরচ ছাড়াই সত্যিকারের গ্লাস |
| কার্ড, টাইল, টুলবার, ফর্ম-কার্ড, ডায়ালগ | ব্লার + রিম + নরম ছায়া | পাতার মূল গঠন — একই প্যানে কাচের অনুভূতি |
| কার্ডের ভেতরের সারি/চিপ/অ্যাভাটার/ব্যাজ | শুধু ট্রান্সলুসেন্সি, ব্লার নেই | লম্বা রোস্টারে প্রতি সারিতে blur ম্যানি-লো-এন্ড ফোনে স্ক্রল আটকে দেয় |
| বাটন, ইনপুট | হালকা কাচ; প্রাইমারি বাটনই একমাত্র সলিড অ্যাকসেন্ট | অ্যাকশনটা স্পষ্ট থাকে, ফর্ম পেছনের আবহ ধরে রাখে |

**বাটন-সারি (স্কুল নিয়ম, সব সারিতে):** এক বাটন = পুরো প্রস্থ, দুই বাটন = অর্ধেক-অর্ধেক, শেষে বিজোড় বাটন (৩য়, ৫ম…) = নিজের পুরো লাইন; চার বাটন = ২×২। নিয়মটা এখন `css/ui-forms.css`-এর একটাই তালিকা — `step/modal/logout/staff-pw/pay-form/row-actions` সহ **exam, teaching, manager, staff-card, staff-form-footer, student, teacher-quick, receipt, learning-card, rc, apc-lock, student-record** সারি। এর আগে ফিচার-সারিগুলো নিজেদের `flex:1` মডেল ব্যবহার করত, তাই ৩টি বাটন তিন সমান কলামে চাপা পড়ত (রিপোর্ট স্ক্রিনে ধরা পড়ে ঠিক করা হয়েছে)। এখন কোনো শিটকে নিজের আলাদা layout ঘোষণা করা নিষিদ্ধ — `tests/mobile-layout-requests.test.mjs` পাহারা দেয়।

নিয়ম (টেস্টে পাহারা দেওয়া — `tests/amoled-theme.test.mjs`, `tests/minimal-ui.test.mjs`):

- **ফ্ল্যাট লেয়ার মাটিতে থাকে**: ব্লার আছে কি না সেটা `@supports` দিয়ে দেখা হয়; না থাকলে
  আগের সলিড রঙই চলে — কোনো পর্দা "গ্লাস নেই" বলে ভাঙে না।
- **print/PDF কিছুই পায় না**: পুরো স্কিন `@media screen`-এর ভেতরে; রসিদ/রিপোর্ট প্রিভিউর
  সাদা কাগজও আগের মতোই (ওটা প্রিন্ট-ডকুমেন্টের প্রতিচ্ছবি)।
- **কম ট্রান্সপারেন্সি চাইলে** (`prefers-reduced-transparency: reduce`): আবহ, ব্লার সব বন্ধ,
  সলিড অ্যাপ ফিরে আসে।
- **AMOLED-এ কালোই কালো থাকে**: ডার্ক গ্লাস মাত্র ৫.৫% সাদা, সাথে Rim-ই কার্ড চেনায় —
  আলো জ্বলে না, পিক্সেলও জাগে না।
- **ব্লার বাজেট**: নেভিগেশন, কার্ড, ডায়ালগ, টোস্ট — বাকি সব translucency-তে চলে।

## লোগো — ব্যাকগ্রাউন্ড থিমের সাথে বদলায়

লোগোটার পেছনের সাদা প্লেট আর ফিক্সড নয়। একই আর্টওয়ার্কের **দুইটি সংস্করণ**:

| ফাইল | কখন | কেমন |
| --- | --- | --- |
| `assets/icons/logo-128.png` | লাইট থিম | আসল আর্টওয়ার্ক (সবুজ রিং, কালো "A", লাল +) — এখন **স্বচ্ছ RGBA**, বেক করা সাদা প্লেট ছাড়া |
| `assets/icons/logo-128-dark.png` | AMOLED | একই ড্রয়িং, কালোর বদলে হালকা স্ট্রোক ও উজ্জ্বল সবুজ/লাল |

- `js/theme-logos.js` (প্রি-পেইন্ট, `js/appearance-boot.js`-এর ঠিক পরে) স্টোর করা থিম পড়ে সঠিক
  ফাইলটা বসায় — ফ্ল্যাশ হয় না, সাদা বর্গা এক পলকও দেখা যায় না।
- লাইভ টগলে `apc:theme` ইভেন্ট ধরে সঙ্গে সঙ্গে বদলায়; `pageshow` ও `window.apcThemeLogos()` hook
  দিয়ে লোডের পরে তৈরি লোগোও (লঞ্চ স্ক্রিন, ইনস্টল টোস্ট) ঢেকে দেওয়া হয়।
- লোগো যেখানে সাদা কাগজের উপর বসে — PDF, রসিদ, `app-logo.png` — সেগুলো ছোঁয়া হয়নি; ওগুলো
  প্রিন্ট-ডকুমেন্টের অংশ, তাই আসল রঙই থাকে।
- গার্ড: `tests/theme-logos.test.mjs` (আচরণ) ও `tests/amoled-theme.test.mjs` (RGBA, প্রিক্যাশ,
  স্ক্রিপ্টের অবস্থান)।

## এডমিন প্যানেল

`admin.html` খুললে এডমিন এন্ট্রি স্ক্রিন দেখা যায়। ইউজারনেম **`admin.apc`** — কোনো বিল্ট-ইন ডিফল্ট পাসওয়ার্ড নেই। এই ডিভাইসে প্রথমবার প্রবেশের সময় একটি পাসওয়ার্ড নির্ধারণ করতে হয় (PBKDF2 হ্যাশ আকারে সংরক্ষিত) — বাধ্যতামূলক প্রথম লগইনে। এক ক্লিকে ঢোকা বা আগে থেকে লেখা পাসওয়ার্ড নেই। “এই ডিভাইসে মনে রাখুন” চেক থাকলে ডিভাইস-বাউন্ড টোকেন থাকে ৭ দিন (Admin/Manager/Payment ৭ দিন, Teacher ৩০ দিন, Student ৯০ দিন — `js/session.js`-এর `SESSION_TTL_DAYS` একমাত্র উৎস)। শিক্ষার্থী লগইন পেজে আলাদা কোনো স্টাফ ট্যাব বা লিঙ্ক নেই, কিন্তু একই লগইন ফরমে `admin.apc` ও পাসওয়ার্ড দিলে সরাসরি এই প্যানেল খুলে যায় (সেশন আগেই জমা হয়); `admin.html` সরাসরি খুলেই লগইন করা যায়। প্যানেল থেকে **লগআউট** করলে সেশন মুছে সোজা ওই একই লগইন পেইজে ফেরে।

প্যানেলে আছে (খালি ব্রাউজারে খালি শুরু হয়):

- **সংক্ষিপ্ত ড্যাশবোর্ড** — স্বাগত বার্তা, বর্তমান তারিখ, দৈনিক পরামর্শ ও `নিবন্ধন অনুমোদন` টাইল; সঙ্গে ম্যানেজার/শিক্ষক/পেমেন্ট প্যানেলে যাওয়ার তিনটি লিংক। হোমে আর 3D ছবি, সংখ্যার সারাংশ, ব্যাকআপ/রক্ষণাবেক্ষণ সতর্কতা বা স্টাফ/ব্যাকআপ/রিপোর্ট/চ্যাট/ফোনবুকের পুনরাবৃত্ত শর্টকাট নেই; সংশ্লিষ্ট ফিচার তাদের নিজস্ব স্ক্রিনে অক্ষত। পরীক্ষা অনুমোদন/প্রকাশ, রুটিন এন্ট্রি বা দৈনন্দিন নোটিশ এডমিন প্যানেলে নেই — পরীক্ষা অনুমোদনের একক ভূমিকা Manager (`manager.html`), আর এডমিন শুধু রিপোর্ট দেখে (`js/admin-permissions.js`)।
- **৫টি মোবাইল নেভিগেশন (`ADMIN_BOTTOM_NAV`)** — হোম, স্টাফ, রিপোর্ট, সিস্টেম ও আরও (`js/admin-permissions.js`)। ডেটা/ব্যাকআপ আরও মেনুতে থাকে। আলাদা desktop sidebar নেই; বড় স্ক্রিনেও একই মোবাইল নেভিগেশন থাকে।
- **ইউনিক আইডি ও অডিট ট্র্যাকিং** — প্রতিটি এন্ট্রি (শিক্ষার্থী ID, ট্রানজেকশন ID, রসিদ ভাউচার, নোটিশ স্মারক, রুটিন ক্লাস কোড, কোর্স কোড ও স্টেটমেন্ট মেমো)-তে স্ট্যান্ডার্ড ইউনিক অডিট কোড সংরক্ষণ
- **শিক্ষার্থী** — নাম/ID/মোবাইল দিয়ে স্মার্ট সার্চ, লাইভ অটো-হাইড, স্ট্যাটাস ফিল্টার, রেকর্ড দেখা, পাসওয়ার্ড রিসেট (নতুন পাসওয়ার্ড ডেমোভাবে দেখায়)। **শ্রেণি ফিল্টার** — সার্চের নিচের ড্রপডাউন থেকে শ্রেণি বেছে নিলে তালিকায় শুধু সেই শ্রেণির শিক্ষার্থীরা থাকে।
- **রিপোর্ট সেন্টার (আরও → রিপোর্ট)** — একটি ফর্মে: **রিপোর্ট বেছে নিন** (শুধু role-এর অনুমোদিত রিপোর্টগুলো) → **শুধু সেই রিপোর্টের filter** (daily / weekly / monthly / custom পিরিয়ডসহ, প্রতিটি ধরন নিজের একটি মাত্র তারিখ ঘর দেখায়; যে রিপোর্ট daily/weekly/monthly/custom-নির্ধারিত সেটি নিজের ধরনেই খোলে) → **Generate Report** → **A4 প্রিভিউ** → **Download PDF**; **← Back** প্রিভিউ থেকে ফিরে এসে নির্বাচিত রিপোর্ট ও তার filter ধরে রাখে। প্রিভিউ ও PDF একই ডকুমেন্ট থেকে তৈরি হয় — একই ডেটা, হিসাব, সারি ও মোট; ফাইলের নাম `ActivePlus_<রিপোর্ট>_YYYY-MM-DD.pdf`। ক্যাটালগ (`js/report-catalog.js` + `js/report-builders.js`) যা ঘোষণা করে তাই দেখানো হয়: শিক্ষার্থী (তালিকা, প্রোফাইল, শ্রেণি/ব্যাচ/স্ট্যাটাস), ফি ও হিসাব (দৈনিক/সাপ্তাহিক/মাসিক/কাস্টম কালেকশন, বকেয়া, লেনদেন, রসিদ, পেমেন্ট স্ট্যাটাস), ক্যাশ কাউন্টার, একাডেমিক (ক্লাস/ব্যাচ, উপস্থিতি, অ্যাসাইনমেন্ট, অগ্রগতি), পরীক্ষা ও ফলাফল (প্রশ্নপত্র, উত্তর, মার্কশিট, কম্বাইন্ড), নোটিশ, স্টাফ, ম্যানেজমেন্ট সারাংশ ও "আমার রিপোর্ট"। যে রিপোর্টে একজন শিক্ষার্থী বা একটি পরীক্ষা নির্দিষ্ট করতে হয়, সেখানে "সব" নেই — না বাছলে সেই ঘর খালি থাকে এবং Generate স্পষ্ট বার্তা দিয়ে থামে। data না পেলে ডকুমেন্টের ভিতরেই "No data found for the selected filters." নোট যায় — কোনো জাল সারি নেই। অনুমতি `js/report-access.js` থেকে নির্ধারিত: অননুমোদিত রিপোর্ট তালিকায় থাকে না, সরাসরি চেষ্টায় ব্লক হয় এবং generate-এর আগেই enforceAccess চলে — অননুমোদিত ডেটা লোডই হয় না। সবকিছু অফলাইন, কোনো API/ক্লাউড ছাড়াই।
- **অর্থব্যবস্থাপনা ও ফি কালেকশন** — মোট ফি আদায়, চলতি মাসের কালেকশন ও বকেয়া হিসাবের ড্যাশবোর্ড; নতুন ফি গ্রহণ (ক্যাশ/বিকাশ/নগদ/রকেট/ব্যাংক), অফিশিয়াল মানি রসিদ তৈরি ও সরাসরি PDF ডাউনলোড; শিক্ষার্থী লেজার ও সাম্প্রতিক লেনদেন—বড় টেবিল বা প্রিন্ট অপশন ছাড়া; বিস্তারিত কালেকশন/বকেয়া/লেনদেন রিপোর্ট এখন রিপোর্ট সেন্টারের ফি ও হিসাব ক্যাটাগরিতে।
- **নোটিশ** — শিরোনাম, বিবরণ ও প্রাপক নির্বাচন করে নতুন নোটিশ প্রকাশ ও পুরনো নোটিশ মুছে ফেলা
- **সাপ্তাহিক ক্লাস রুটিন (`manager.html`)** — সাপ্তাহিক রুটিনের মালিক Manager (`manager.html`)। দিনভিত্তিক রুটিন দেখা, নতুন ক্লাস যোগ ও মুছে ফেলা ম্যানেজার প্যানেলেই হয়; এডমিন প্যানেল থেকে রুটিন এন্ট্রি করা হয় না (এডমিন কেবল রিপোর্ট দেখে)। নতুন ক্লাস যোগ করার সময় **কোন শ্রেণির জন্য** তা ড্রপডাউন থেকে এবং **শিক্ষক** স্টাফ তালিকার ড্রপডাউন থেকে (`teacherId`-সহ) নির্বাচন করা হয়। খালি ব্রাউজারে রুটিন খালি থাকে।
- **শিক্ষক রেজিস্ট্রেশন নিয়ন্ত্রণ** — শিক্ষার্থী অ্যাপ ম্যানেজমেন্টের "শিক্ষক রেজিস্ট্রেশন নিয়ন্ত্রণ" কার্ড থেকে টগল করে শিক্ষক প্যানেলের নতুন রেজিস্ট্রেশন/প্রবেশ খোলা ও বন্ধ করা যায়; সেভ করলে `teacher.html`-এ সঙ্গে সঙ্গে কার্যকর হয় — বন্ধ থাকলে এন্ট্রি স্ক্রিনে ব্যাখ্যাসহ নোটিশ দেখায় ও প্রবেশ বাটন নিষ্ক্রিয় থাকে। কার্ডে বর্তমানে যুক্ত শিক্ষকদের তালিকাও দেখা যায় (রুটিনের শিক্ষক তালিকা থেকে স্বয়ংক্রিয়)।
- **ক্লাস সেটিংস** — `config.js`-এর enabled class তালিকা থেকে ক্লাস চালু/বন্ধ করা

### এডমিন প্যানেলে রোল-ভিত্তিক অ্যাক্সেস

Admin প্যানেল কোনো নতুন রোল বা স্টোরেজ কী তৈরি করে না। এটি রেপোতে আগে থেকে থাকা
রোল-সীমানা (`firestore.rules`, `functions/index.js`, আলাদা `manager.html`) পড়ে
সেটিকেই UI-তে প্রয়োগ করে — `js/admin-permissions.js`:

| উৎস | Admin-এর ক্ষমতা |
| --- | --- |
| `firestore.rules` | রিপোর্ট, সেটিংস, নোটিশ, রুটিন, ট্রানজেকশন, পরীক্ষার রেকর্ড — পড়া/লেখা |
| `functions/index.js` | শিক্ষার্থী approve/reject ও পরীক্ষা publish **শুধু Manager** |
| `manager.html` / `teacher.html` / `payment.html` | ওই রোলগুলোর নিজস্ব প্যানেল |

**Admin-এর কাজ = সিস্টেম কন্ট্রোল + স্টাফ ম্যানেজমেন্ট + অনুমতি + সিকিউরিটি + ডেটা +
রিপোর্ট + সেটিংস।** দৈনন্দিন অপারেশন Admin-এর নয়, তাই সেগুলো এখানে অনুমোদিতই নয়:

| কাজ | মালিক |
| --- | --- |
| ফি গ্রহণ / ক্যাশ কাউন্টার এন্ট্রি | Cash Counter (`payment.html`) |
| শিক্ষার্থী অনুমোদন, নোটিশ প্রকাশ, রুটিন এন্ট্রি, পরীক্ষা প্রকাশ | Manager (`manager.html`) |
| ক্লাস, বাড়ির কাজ, উপস্থিতি | Teacher (`teacher.html`) |

ফলে Admin-এর মেনু: **ড্যাশবোর্ড, স্টাফ ম্যানেজমেন্ট, Roles & Permissions, শিক্ষার্থী
(দেখা/সম্পাদনা), রিপোর্ট, Data Management, Backup & Restore, সিকিউরিটি, সিস্টেম
সেটিংস, Admin Profile, লগআউট**। Role-এর বাইরের সবকিছু UI থেকে সরিয়ে দেওয়া হয় —
শুধু লুকানো নয়, DOM থেকে মুছে ফেলা হয়:

- অনুমোদনের অপেক্ষমাণ শর্টকাট/সারাংশ (Manager), শিক্ষার্থীর approve-reject অ্যাকশন
- ফি-গ্রহণের ফর্ম, ক্যাশ-এন্ট্রি কন্ট্রোল (Cash Counter) — Admin শুধু পর্যবেক্ষণ ও রিপোর্ট
- পরীক্ষা প্রকাশ/প্রত্যাখ্যান কন্ট্রোল (Manager) — Admin রিপোর্টে ফলাফল দেখে
- নোটিশ ও রুটিন এন্ট্রি (Manager) — রেকর্ড শেয়ার্ড কালেকশনে থাকে, তাই রিপোর্ট পড়তে পারে
- শিক্ষক প্যানেল ও পেমেন্ট রিসিভ প্যানেলের লিংক (Teacher / Payment রোল) — এখন **মার্কআপেও নেই**, শুধু বুটের সময় মুছে দেওয়া নয় (`tests/panel-isolation.test.mjs`); রানটাইম গার্ডটিও `js/panel-lockdown.js`-এ আছে

প্রয়োগ দুই স্তরে:

1. **UI visibility** — `data-admin-cap="…"` চিহ্নিত প্রতিটি মেনু, কার্ড, শর্টকাট ও
   `data-view-panel` সেকশন `enforceCapabilities()` মুছে দেয়; বটম বার, আরও-মেনু ও
   ড্যাশবোর্ড গ্রিড `js/admin-panel-ui.js` সরাসরি অনুমোদিত এন্ট্রি থেকে তৈরি করে, তাই
   অননুমোদিত কিছু কখনোই রেন্ডার হয় না।
2. **Access control** — `setView()`/`navigate()` প্রতিবার `Access.allowsView()` যাচাই করে।
   `admin.html#staff`-এর মতো ডিপ-লিংকও শুধু তখনই খোলে যখন Role-এর অনুমতি থাকে; বাকিগুলো
   প্রথম অনুমোদিত ট্যাবে ফেরত যায় (কোনো unauthorized কনটেন্ট লিক হয় না)। স্টাফ
   ম্যানেজমেন্টে এই যাচাই আরও নিচে নেমে যায়: `js/staff-directory.js`-এর প্রতিটি
   create/update/status/password/delete কল `withAdmin()` দিয়ে সক্রিয় Admin সেশন চায় —
   শুধু বাটন লুকানো নয়।

### স্টাফ ম্যানেজমেন্ট (Admin-এর প্রাথমিক মডিউল)

প্রতিজন স্টাফের **Staff ID** (`STF-0001`, `STF-0002`, …) — অনন্য, স্থায়ী, অনুসন্ধানযোগ্য
এবং তৈরির পর **বদলানো যায় না**। Student ID (`AP-…`) কখনো Staff ID-এর সঙ্গে মেশানো হয় না
এবং কোনো শিক্ষার্থী স্টাফ তালিকায় আসে না।

- রোল: **Admin, Manager, Teacher, Cash Counter, অন্যান্য** — সব রোলই তৈরি করা যায়, Admin-ও
  (owner সিদ্ধান্ত, ৩০ অক্টোবর ২০২৬: প্রতিষ্ঠানে একাধিক Admin থাকতে পারে)। শুধু **System
  Owner** — প্রথম এডমিন (STF-0001) — `Protected`: তাকে ডিমোট/নিষ্ক্রিয়/মুছে ফেলা যায় না,
  তাই লক-আউট হয় না। নতুন Admin সাধারণ অ্যাকাউন্ট: সম্পাদনা, ডিমোট, নিষ্ক্রিয় ও (ইতিহাস না
  থাকলে) মুছে ফেলা যায়; সে নিজের প্রোফাইল ও পাসওয়ার্ড নিজেই বদলায় — লগইন আইডি বদলায় না।
  রোল বাছাই করলে সেই রোলের পূর্বনির্ধারিত অনুমতি স্বয়ংক্রিয়ভাবে
  বসে — রোলের বাইরে কোনো অনুমতি দেওয়া হয় না (`js/admin-permissions.js` → `ROLE_CAPABILITIES`)।
- তৈরির ফর্ম: Staff ID (স্বয়ংক্রিয়), পূর্ণ নাম, ইউজারনেম, পাসওয়ার্ড + নিশ্চিতকরণ, রোল,
  মোবাইল, ইমেইল, ঠিকানা, যোগদানের তারিখ, স্ট্যাটাস এবং রোল-ভিত্তিক অ্যাসাইনমেন্ট
  (Teacher → ক্লাস/বিষয়/ব্যাচ, Manager → ব্যাচ, Cash Counter → কাউন্টার, অন্যান্য → পদবি)।
- সম্পাদনা: Staff ID ছাড়া সবকিছু। সক্রিয়/নিষ্ক্রিয়/স্থগিত; নিষ্ক্রিয় স্টাফ লগইন করতে পারে না,
  কিন্তু তার আগের লেনদেন, উপস্থিতি, পরীক্ষা, নোটিশ ও রুটিনের রেকর্ড অক্ষত থাকে।
- পাসওয়ার্ড রিসেট: কখনো প্লেইন-টেক্সট দেখানো হয় না (PBKDF2 হ্যাশ), রিসেটের পর প্রথম
  লগইনে বদল বাধ্যতামূলক।
- মুছে ফেলা: কনফার্মেশন মোডাল (“আপনি কি এই Staff Account স্থায়ীভাবে মুছে ফেলতে চান?” →
  Cancel | Delete Staff)। ইতিহাস থাকলে মোছা বন্ধ এবং **নিষ্ক্রিয় করার** পরামর্শ দেওয়া হয়।
  System Owner (`Current Admin → Protected`) মোছা, নিষ্ক্রিয় বা রোল-পরিবর্তন — কোনোটিই করা
  যায় না, ফলে কখনো লক-আউট হয় না।
- মোবাইল-ফার্স্ট গ্লাস কার্ড: নাম, Staff ID, রোল, মোবাইল, স্ট্যাটাস ও **View | Edit | More**
  (More = Reset Password, Activate/Deactivate, Suspend, Delete)। অনুসন্ধান Staff ID/নাম/
  ইউজারনেম/মোবাইলে; Role ও Status ফিল্টার। পূর্ণ প্রোফাইল ভিউতে ব্যক্তিগত তথ্য ও কার্যক্রমের
  সারাংশ থাকে।
- রিপোর্ট: স্টাফ তালিকা, রোলভিত্তিক, সক্রিয়/নিষ্ক্রিয় ও স্টাফ কার্যক্রম — সব PDF/CSV।
- **লগইন**: স্টাফ ম্যানেজমেন্ট থেকে তৈরি করা যেকোনো স্টাফ শিক্ষার্থী লগইন পেজেই
  (`index.html`) নিজের ইউজারনেম ও পাসওয়ার্ড দিয়ে ঢোকে এবং সে রোলের প্যানেলে পৌঁছায় —
  কোনো আলাদা ফর্ম বা সেশন স্কিম নেই (`js/login.js` → `authenticateDirectoryStaff()`)।
  দেওয়া পাসওয়ার্ডটি সাময়িক হলে প্রবেশের আগেই বদল করতে হয়; নিষ্ক্রিয় অ্যাকাউন্ট কোনো
  পাসওয়ার্ড দিয়েই ঢুকতে পারে না। স্টাফ ম্যানেজমেন্টে তৈরি প্রতিটি শিক্ষক নিজস্ব ইউজারনেম ও `staffId` (`teacherId`) নিয়ে লগইন করে এবং কেবল তার নির্ধারিত শ্রেণি ও বিষয়ের কাজ দেখতে ও তৈরি করতে পারে।

### এডমিন প্যানেলের আইকন সিস্টেম — একটি নির্দিষ্ট কন্টেইনারে একটি আইকন

`js/admin-icons.js` — প্রতিটি প্রতীক একটিই inline SVG, ২৪×২৪ গ্রিডে আঁকা, `currentColor`
স্ট্রোকে (কোনো emoji নয়): `dashboard`, `staff`, `students`, `reports`, `roles`, `security`,
`settings`, `data`, `backup`, `profile`, `app`, `logout`, `more`, `search`, `edit`, `trash`,
`close`, `save`, `add`, `back`, `forward`, `check`, `eye`, `key`, `pause`, `play`, `refresh`,
`download`, `upload`, `phone`, `book`, `shield`, `lock`, `users`, `sliders`, `wallet`,
`receipt`, `calendar`, `bolt`।

`css/admin-icon-system.css` (সবার শেষে load) জ্যামিতি নিয়ন্ত্রণ করে:

- **এক কন্টেইনারে এক আইকন** — আগে একই প্রতীক দুইবার আঁকা হতো (চিপের background-image +
  ভেতরের `<svg>`), যা ওভারল্যাপ তৈরি করত। ব্যাকগ্রাউন্ড বন্ধ, ভেক্টর চালু।
- **কন্টেইনারই মাপ ঠিক করে** — প্রতিটি আইকন-ড্রপ fixed বাক্স, `display:flex`,
  `align-items/justify-content:center`, `overflow:hidden`; ভেতরের SVG-এর নির্দিষ্ট মাপ ও
  `max-width/max-height:100%`, তাই লেবেল, অন্য আইকন, কার্ড-কিনারা বা বটম বারের বাইরে যেতে
  পারে না।
- **transform দিয়ে বড় হয় না** — active/tap অবস্থায় আগে chip ও icon স্কেল হতো; এখন রঙ,
  ব্যাকগ্রাউন্ড ও গ্লো দিয়ে সক্রিয় ট্যাব বোঝানো হয়।
- **একটিই বিন্যাস** — বটম নেভিগেশনে সবসময় **আইকনের নিচে লেবেল**; হেডারে **আইকন + লেবেল
  পাশাপাশি**। লেবেল ১১px-এর নিচে নামে না, লগআউট লেবেল কখনো লুকানো হয় না।
- **৪৩০/৩৮০/৩৪০px ব্রেকপয়েন্ট** — আইকন ও প্যাডিং ছোট হয়, কিন্তু অনুভূমিক স্ক্রল বা ক্লিপিং
  তৈরি হয় না; `prefers-reduced-motion`-এ কোনো অ্যানিমেশন নেই।

স্টাইল ও রঙ লগইন পেজ ও অন্য প্যানেলের সঙ্গে একই (`css/admin-panel-ui.css`): একই
primary/secondary, surface, card, border, radius ও shadow টোকেন — পুরো অ্যাপ একটি
পরিবারের মতো দেখায়। সাজসজ্জার চেয়ে পাঠযোগ্যতা বড়: ছোট আইকন নয়, কম কন্ট্রাস্ট নয়,
লেখার ওপর অতিরিক্ত blur বা স্বচ্ছতা নয়।

### পেমেন্ট রিসিভ প্যানেল (`payment.html`) — শুধু কালেকশন, আর কিছুই নয়

এডমিন প্যানেলের বাইরে আলাদা, খুব হালকা একটি কাউন্টার পেজ — ইউনিক ইউসার আইডি ও পাসওয়ার্ড দিয়ে প্রবেশ; কোনো নেভিগেশন, রিপোর্ট বা ম্যানেজমেন্ট নেই। ধারাবাহিকতা: **লগইন → সার্চ → সংক্ষিপ্ত তথ্য → পেমেন্ট → রসিদ**। পেজটি এখন অ্যাপ-শেল স্টাইলে: স্থির টপবার, একটি স্ক্রল করা কলাম ও নিচে স্থির “টাকা নিন” বার।

- **একই লগইন পেজ থেকেও প্রবেশ** — শিক্ষার্থী লগইন ফর্মে কাউন্টারের ইউজারনেম **`payment.apc`** ও নিজের নির্ধারিত পাসওয়ার্ড দিলে সেশন জমা হয়ে সরাসরি ডেস্ক খোলে (`payment.html` নিজেও এন্ট্রি ফর্ম দেখায়)। ভুল হলে বাংলা ত্রুটি-বার্তা। “এই ডিভাইসে মনে রাখুন” চেক থাকলে সেশন ৭ দিন, না হলে ট্যাব-সেশন। সেশন থাকলে ডেস্ক সরাসরি খোলে। **লগআউট** করলে সেশন মুছে সোজা লগইন পেইজে (`index.html`) ফেরে।
- **প্রবেশাধিকার** — ইউজারনেম ছোট-বড় হরফে লেখা যায়; ফর্মে আগে থেকে লেখা থাকে না। ডেস্ক সেটিংস কার্ডের **পাসওয়ার্ড পরিবর্তন** বাটনে বর্তমান পাসওয়ার্ড যাচাই করে নতুন পাসওয়ার্ড (৬–৩২ অক্ষর) দুইবার লিখে বদলানো যায় — অ্যাকাউন্ট `activePlus.paymentAccount.v1`, সেশন `activePlus.paymentSession.v1`। **প্রস্থান** আইকনে লগআউট।
- **আজকের আদায় এক নজরে** — ডেস্কের উপরেই বড় কার্ডে আজকের আদায় (লেনদেন সংখ্যাসহ), এই মাসের আদায় ও কত জনের বকেয়া; নিচে **আজকের লেনদেন** তালিকা — যেকোনো সারিতে চাপলে সেই রসিদ আবার খোলে, রিফ্রেশ আইকনে অন্য ট্যাবের কালেকশনসহ তালিকা হালনাগাদ হয়।
- **সার্চবার** — শিক্ষার্থীর নাম, মোবাইল নম্বর, Student ID **অথবা অভিভাবকের মোবাইল নম্বর** দিয়ে খোঁজা যায় (বাংলা সংখ্যা ও `+880` ফরম্যাটসহ)। ফলাফলে প্রতিজনের বকেয়াও দেখা যায়; কীবোর্ডে `/` চাপলেই সার্চ ঘরে ফোকাস। এডমিন প্যানেলের ফি-সার্চেও এখন অভিভাবকের নম্বর কাজ করে।
- **টাইপ না করে এক চাপে** — সার্চের নিচে **যাদের বকেয়া আছে** ও **সাম্প্রতিক পেমেন্ট** চিপ; চাপলেই সেই শিক্ষার্থী নির্বাচিত।
- **সংক্ষিপ্ত তথ্য** — নির্বাচন করলেই শ্রেণি-বিভাগ, শিক্ষার্থী ও অভিভাবকের মোবাইল, সর্বশেষ পেমেন্ট, নির্ধারিত মাসিক ফি, চলতি মাসে পরিশোধ ও বকেয়া; বকেয়া বড় করে হিরো ব্লকে দেখায়, সঙ্গে কোন নম্বরে রসিদ যাবে তার হিন্ট। নিচের স্থির বারে শিক্ষার্থীর নাম ও বকেয়া থাকে, তাই যেকোনো জায়গা থেকে এক চাপে পেমেন্ট ফর্ম খোলা/জমা দেওয়া যায়।
- **পেমেন্ট** — ফি ধরন, মাস, দ্রুত পরিমাণ চিপ (পূর্ণ বকেয়া/মাসিক ফি/অর্ধেক), **বড় অঙ্কের ঘর ও থাম্ব-ফ্রেন্ডলি কীপ্যাড** (১–৯, ০, ০০, ⌫), মাধ্যমের জন্য **পিল বাটন** (ক্যাশ/বিকাশ/নগদ/রকেট/ব্যাংক — `paymentMethods` থেকেই তৈরি), Trx ID ও নোট। সেভ বাটনে লাইভ পরিমাণ (“৳৭০০ জমা নিন ও রসিদ দিন”) দেখা যায়; **বাতিল** বাটনে ফর্ম বন্ধ। একই `financeRepository` localStorage contract-এ সংরক্ষণ — এডমিন প্যানেলের হিসাব, লেজার ও রিপোর্টে সঙ্গে সঙ্গে দেখা যায়। সংরক্ষণ ব্যর্থ হলে রসিদ হয় না।
- **হোয়াটসঅ্যাপে রসিদ (সরাসরি শিক্ষার্থীর নম্বরে)** — রসিদ সেভ হলেই সাফল্যের চিহ্নসহ মোডাল খোলে; "হোয়াটসঅ্যাপে পাঠান" বাটনে চাপ দিলে **শিক্ষার্থীর নিজের মোবাইল নম্বরে** হোয়াটসঅ্যাপ চ্যাট খুলে যায় (`https://wa.me/880…`) এবং রসিদের বিবরণ (নাম, ID, শ্রেণি, ফি, রসিদ নং, তারিখ) লেখা থাকে। রসিদের ছবিটি (অফলাইন canvas PNG) তখনই ডাউনলোড হয় — চ্যাটে ছবিটি যুক্ত করে পাঠিয়ে দিলেই হলো, কারণ wa.me লিংকে ছবি সংযুক্ত করা যায় না। শিক্ষার্থীর নম্বর না থাকলে অভিভাবকের নম্বর ব্যবহার হয়; দুটোই না থাকলে স্পষ্ট বার্তা দেখায়। বাটনেই কোন নম্বরে যাবে তা লেখা থাকে, আর প্রোফাইল সারাংশেও নম্বরটি দেখানো হয়। আগে এটি সিস্টেমের শেয়ার মেনু খুলত (তারপর WhatsApp ও কনট্যাক্ট বেছে নিতে হতো) — এখন সরাসরি নির্দিষ্ট নম্বরে যায়।
- সীমাবদ্ধতা: এটি ডেমো — WhatsApp-এ সরাসরি সার্ভার-সাইড পাঠানো নেই; মোবাইলে OS শেয়ার মেনু/চ্যাট খোলে, চূড়ান্ত "Send" চাপা ব্যবহারকারীর হাতে।
- **এক প্যানেল থেকে অন্য প্যানেলে যাওয়া বন্ধ** (`js/panel-lockdown.js`) — এডমিনের হিসাব কার্ড থেকে পেমেন্ট প্যানেলের
  আগের শর্টকাট লিংকটি সরানো হয়েছে, এবং এখন চার প্যানেলের প্রতিটির জন্য নিয়মটি চার স্তরে কার্যকর:
  1. **মার্কআপ** — কোনো প্যানেলে অন্য পোর্টালের `<a href>` নেই (`tests/panel-isolation.test.mjs`),
  2. **রানটাইম গার্ড** — পরে যোগ হওয়া কোনো লিংক, ফর্ম বা `window.open` অন্য প্যানেলের দিকে গেলে ক্লিক আটকে যায় ও
     "এক প্যানেল থেকে অন্য প্যানেলে যাওয়া বন্ধ" বার্তা দেখায়,
  3. **সেশন-বাঁধন** — যে প্যানেলে ঢুকতে হবে তার নিজের সেশন লাগে; অন্য রোলের সেশন থাকলে বা সেশন না থাকলে প্যানেল আর
     নিজে নিজে অন্য পাতায় যায় না, বরং `#apcPanelLock` কার্ডে জায়গাতেই বন্ধ থাকে (শুধু দুইটি বাটন: **লগইন পেজে যান** / **আবার চেষ্টা করুন**),
  4. **এক ডিভাইসে এক প্যানেল** — নতুন রোলে লগইন করলে এই ডিভাইসের অন্য স্টাফ সেশন শেষ হয় (`js/staff-auth.js`), আর
     খোলা প্যানেল সেশন হারা হলে সাথে সাথেই কার্ডে লক হয়।
  নোটিশ পুশ-এও কোনো পাতার লিংক নেই (`functions/notification-payload.js`): ট্যাপ করলে সার্ভিস ওয়ার্কার এই ডিভাইসের
  **নিজের প্যানেল** খোলে (`apc-panel-hint` ক্যাশ), নইলে শুধু মিলিত লগইন পেজ — কোনো পেলোড কাউকে অন্য প্যানেলে পাঠাতে পারে না।
  অফলাইনে ক্যাশে না থাকা কোনো পাতাও আর index.html-এ নয়, নিজের "সংযোগ নেই" কার্ডে যায় (`sw.js`)।

- **একই ডিভাইসে প্যানেল বদল — পাসওয়ার্ড ছাড়া নয়** (`js/login.js`) — লগইন পেজ এখন সম্পূর্ণ মিনিমাল:
  শুধু ব্র্যান্ড, লগইন ফর্ম ও রেজিস্ট্রেশন। প্যানেল বদলাতে **আগে লগআউট করার দরকার নেই** — অন্য প্যানেলের
  ইউজারনেম ও পাসওয়ার্ড একই ফর্মে দিলেই এই ডিভাইসে সেই প্যানেল খুলে যায় (বার্তায় আগের সেশনটি বন্ধ হওয়ার
  কথা বলে; `js/staff-auth.js`-এর "এক ডিভাইসে এক প্যানেল" নিয়ম প্রযোজ্য)।

কোনো সার্ভার বা API নেই। শিক্ষার্থী তালিকা, নোটিশ, রুটিন ও ফি localStorage-এ থাকে এবং খালি ব্রাউজারে খালি শুরু হয়। এটি production authentication বা online payment gateway নয়।

### ফি কালেকশন: সার্চ → প্রোফাইল → পেমেন্ট → রসিদ (Payment ডেস্ক)

ফি গ্রহণ ও ক্যাশ কাউন্টার এন্ট্রি Admin প্যানেলের কাজ নয় — সেটি `payment.html`-এ (Cash Counter)।
Admin শুধু পর্যবেক্ষণ করে: রিপোর্ট সেন্টারে লেনদেন, শিক্ষার্থী ফি লেজার ও সব রিপোর্ট।

- Payment ডেস্ক → নাম (বাংলা/ইংরেজি), মোবাইল, Student ID বা অভিভাবকের মোবাইল দিয়ে সার্চ করুন। বাংলা অঙ্কও ব্যবহার করা যায়। খালি সার্চে কোনো শিক্ষার্থী নেই; অমিল হলে “কোনো শিক্ষার্থী পাওয়া যায়নি” দেখায়।
- নাম চাপলে কুইক প্রোফাইলে শ্রেণি/বিভাগ, মোবাইল, স্ট্যাটাস, মাসিক ফি, চলতি মাসে পরিশোধ, বকেয়া এবং সর্বশেষ পেমেন্ট দেখা যায়। সেখান থেকে **পেমেন্ট গ্রহণ**।
- ফি ধরন, মাস, পরিমাণ, মাধ্যম, ঐচ্ছিক Reference ও Note পূরণ করে সেভ করুন। সফলভাবে সংরক্ষণের পরই totals/profile/ledger আপডেট হয় এবং লোগোসহ রসিদ খোলে। সেভের সময় ডাবল সাবমিট বন্ধ; স্টোরেজ ব্যর্থ হলে ফর্ম অপরিবর্তিত থাকে, রসিদ তৈরি হয় না।
- Recent Collection-এ তারিখ অনুযায়ী সর্বশেষ **৫টি** আদায়; প্রতিটি থেকে রসিদ দেখা ও ডাউনলোড করা যায়। একই দিনের রেকর্ডে নতুন এন্ট্রি আগে থাকে। রিপোর্টে সব রেকর্ড থাকে।
- **রসিদের হেডার** — প্রতিষ্ঠানের নাম, তার নিচে ট্যাগলাইন, তার নিচে আলাদা লাইনে **ঠিকানা**; তিনটিই অ্যাপ সেটিংস (`tagline`, `campusAddress`) থেকে আসে, তাই এডমিন বদলালে রসিদেও বদলায়। একই বিন্যাস অন-স্ক্রিন রসিদ ও ডাউনলোড করা PDF/PNG দুটোতেই (লম্বা ঠিকানা হলে কেটে দুই লাইন হয়, নিচের অংশ স্বয়ংক্রিয়ভাবে নিচে নামে)।
- **রসিদ ডাউনলোড** চাপলেই সরাসরি `.pdf` ফাইল পাওয়া যায়—কোনো print dialog, নতুন window বা HTML ফাইলের মধ্যবর্তী ধাপ নেই। মোবাইলে সহজে পেতে বাটনটি রসিদ preview-এর উপরেই আছে; Recent Collection থেকেও একই PDF ডাউনলোড হয়। লোগো ও স্থানীয় বাংলা ফন্ট দিয়ে Canvas-এ উচ্চ রেজোলিউশনে render করে PDF-এ image হিসেবে সংরক্ষণ হয়, তাই বাংলা যুক্তাক্ষর ঠিক থাকে ও ফাইল offline-এ দেখা যায়; PDF-এর লেখা selectable নয়। কোনো CDN বা নতুন runtime library লাগে না। রসিদ ও রিপোর্টের প্রিন্ট অপশন সরানো হয়েছে; রিপোর্টের প্রতিটি লেনদেন থেকেও রসিদ ডাউনলোড করা যায়।
- বর্তমান মাস/বছর ডিভাইসের তারিখ থেকে নির্ধারিত। `student.monthlyFee` থাকলে তা ব্যবহৃত হয়, না থাকলে আগের **৳১,৫০০** ডিফল্ট। পুরনো Student record বদলানো হয়নি।
- “চলতি মাসে পরিশোধ” নির্বাচিত ফি-মাসের সব ফি যোগ করে। **বকেয়া শুধু বর্তমান মাসের মাসিক বেতন**, আংশিক পেমেন্ট বাদ দিয়ে; ভর্তি/পরীক্ষার ফি মাসিক বেতন কমায় না। আগের মাসের billing/arrears schedule নেই, তাই ঐতিহাসিক বকেয়া অনুমান করা হয় না। সারাংশের বকেয়া শুধু অনুমোদিত শিক্ষার্থীদের, বিদ্যমান নিয়ম অনুযায়ী।

**Persistence / ভবিষ্যৎ API:** `js/finance-data.js`-এর `financeRepository.listTransactions()` এবং `saveTransaction(tx)` asynchronous boundary। প্রথমটি transaction array দেয়; দ্বিতীয়টি durable save শেষে updated array দেয়। API adapter-এ এই contract রাখলে UI workflow অপরিবর্তিত থাকবে। বর্তমান adapter `activePlus.admin.transactions.v1` localStorage key ব্যবহার করে। কী না থাকলে তালিকা খালি থাকে — নমুনা লেনদেন নিজে থেকে যোগ হয় না। Student/Transaction field shape অপরিবর্তিত। একই ID-র save idempotent; Web Locks থাকলে একই origin-এর tab-গুলোর write serialized হয়। সার্ভার সংস্করণে authentication, authoritative validation, unique receipt number, idempotency এবং atomic writes server-side enforce করতে হবে।

ডেটা এই ব্রাউজার/origin-এ থাকে—অন্য ডিভাইসে sync বা backup হয় না এবং browser storage মুছলে হারাবে। নতুন receipt CSS/JS service-worker cache-এ যুক্ত ও cache version আপডেট করা হয়েছে।

### সম্পূর্ণ মোবাইল ইন্টারফেস

শিক্ষার্থী ও Admin—দুই অংশে একটিই ফোন-কেন্দ্রিক UI। `css/mobile.css` দুই entry page-এ শেষে load হয়। Desktop sidebar, বড়-স্ক্রিনের আলাদা layout/media query, desktop login frame এবং report print controls সরানো হয়েছে। সব মূল ফর্ম ও section এক কলামে; ছোট summary tiles পাশাপাশি থাকতে পারে। Admin-এর নিচের ৫টি বাটন সব viewport-এ থাকে। ইনপুট ১৬px, প্রধান touch control কমপক্ষে ৪৪px; safe-area ও mobile viewport-height বিবেচিত। রিপোর্ট এখন readable transaction cards, ফিল্টার ও মোট হিসাবসহ।

বড় স্ক্রিনে খুললেও সর্বোচ্চ ৪৮০px চওড়া একই মোবাইল UI দেখা যাবে—কম্পিউটারের জন্য আলাদা সুবিধা নেই। User-agent/device blocking করা হয়নি, তাই preview, tablet, phone landscape ও accessibility tools চালু থাকে। Student/Transaction data এবং সরাসরি PDF রসিদ ডাউনলোড অপরিবর্তিত।

### স্থির হেডার ও ফুটার

শিক্ষার্থী ও Admin-এর হেডার এবং নিচের ৫টি নেভিগেশন বাটন fixed থাকে। সম্পূর্ণ পেজের বদলে মাঝের `#appMain` / `#adminMain` অংশটি scroll হয়। `js/fixed-shell.js` header/footer-এর প্রকৃত height মেপে জায়গা রাখে—বাংলা font load, safe-area বা screen resize হলেও কনটেন্ট চাপা পড়ে না। পেজ/ট্যাব বদলালে মাঝের অংশ শুরুতে ফিরে আসে; scroll-aware student name আগের মতো কাজ করে। Login form ও pending-account screen নিজস্ব scroll রাখে, modal খোলা থাকলে পেছনের content scroll বন্ধ থাকে।

### Admin workflow পরীক্ষা

Fixed-shell tests-এ scroll-এর সময় header/footer অবস্থান, শেষ কনটেন্ট দেখা, view reset, resize, login ও pending screen যাচাই করা হয়। Mobile-layout tests-এ শিক্ষার্থী/Admin login, পাঁচটি student view, narrow/wide/landscape viewport, এক-কলামের ফর্ম, overflow ও mobile report filters যাচাই করা হয়। Navigation tests-এ ৫টি ফুটার বাটন (প্রতিটিতে একটি আইকন + লেবেল; নির্বাচিত ট্যাব রঙ/ব্যাকগ্রাউন্ডে আলাদা, আইকন তার নির্দিষ্ট কন্টেইনারের বাইরে বাড়ে না), আরও মেনু ও ফেরত আসা, অনুমতি-ভিত্তিক ড্যাশবোর্ড গ্রিড, রোল-বহির্ভূত এলিমেন্ট অনুপস্থিতি, hash route গার্ড, dashboard shortcuts, সিস্টেম সেটিংস ও স্টাফ তৈরি যাচাই করা হয়। `tests/payment-panel.spec.cjs` পেমেন্ট রিসিভ প্যানেল যাচাই করে: ইউনিক আইডি+পাসওয়ার্ড লগইন (ভুল প্রবেশাধিকার বাতিল, সেশন মনে রাখা, লগআউট), পাসওয়ার্ড পরিবর্তন (পুরনো পাসওয়ার্ড যাচাই, নতুন পাসওয়ার্ড-এ প্রবেশ), খালি কাউন্টার লেআউট, নাম/মোবাইল/ID/অভিভাবকের মোবাইল-সার্চ (বাংলা সংখ্যাসহ), সংক্ষিপ্ত প্রোফাইল, financeRepository-তে পেমেন্ট সংরক্ষণ, রসিদ PDF ডাউনলোড এবং হোয়াটসঅ্যাপ শেয়ার (Web Share ফাইল-শেয়ার ও wa.me fallback দুই পথেই)। `tests/payment-entry.spec.cjs` লগইন পেজ থেকে সরাসরি প্রবেশ (কাউন্টার আইডি+পাসওয়ার্ড শিক্ষার্থীদের একই লগইন ঘরেই দিলে অটো-লগিন — লগইন পেজে আলাদা কোনো স্টাফ ট্যাব বা “পেমেন্ট কাউন্টার ট্যাব” নেই), কীপ্যাড, মাধ্যমের পিল, স্থির “টাকা নিন” বার ও আজকের তালিকা যাচাই করে।

`tests/admin-panel-shell.test.mjs` আসল `admin.html` + `js/admin.js` jsdom-এ চালিয়ে যাচাই করে: Admin-এর ক্ষমতার সেট (সিস্টেম কন্ট্রোল আছে, দৈনন্দিন অপারেশন নেই), প্রতিটি ফুটার ট্যাবে একটি করে আইকন + লেবেল, অনুমতি-ভিত্তিক ড্যাশবোর্ড গ্রিড, রোল-বহির্ভূত সব এলিমেন্টের অনুপস্থিতি (অনুমোদন শর্টকাট, ফি-গ্রহণের ফর্ম, নোটিশ/রুটিন এন্ট্রি, শিক্ষক/পেমেন্ট প্যানেল লিংক), কোনো publish কন্ট্রোল নেই, hash route গার্ড, এবং ক্ষমতাহীন রোলে প্যানেল সম্পূর্ণ ফাঁকা।

`tests/admin-staff-management.test.mjs` স্টাফ ম্যানেজমেন্ট যাচাই করে — আসল `admin.html`-এ: প্রতি সিস্টেম রোলের জন্য স্থায়ী Staff ID, তৈরি/সম্পাদনা/নিষ্ক্রিয়/রিসেট/মুছে ফেলা, Staff ID লক, ইতিহাস থাকলে মোছা বন্ধ (নিষ্ক্রিয় করার পরামর্শ), System Owner সুরক্ষিত, পাসওয়ার্ড কখনো প্লেইন-টেক্সট নয়, অনুসন্ধান ও ফিল্টার, এবং Admin সেশন ছাড়া প্রতিটি পরিবর্তন `FORBIDDEN`।

ব্রাউজার ছাড়াও একই ফ্লো ইউনিট টেস্টে ঢাকা আছে (`npm test`): `tests/payment-auth.test.mjs` শেয়ারড কাউন্টার ক্রেডেনশিয়াল/সেশন/পাসওয়ার্ড নিয়ম, `tests/payment-desk.test.mjs` আসল `payment.html` + `js/payment.js` jsdom-এ চালিয়ে এন্ট্রি গার্ড, সার্চ, কীপ্যাড-কালেকশন, durable সেভ, রসিদ মোডাল, আজকের সারাংশ ও লগআউট, `tests/login-payment-entry.test.mjs` আসল `index.html` + `js/login.js` চালিয়ে এক-ফর্মে-সবার-প্রবেশ (ভূমিকা অনুযায়ী সেশন জমা ও প্যানেলে হ্যান্ডঅফ, শিক্ষক প্রবেশ বন্ধের নিয়ম, remember-me) এবং `tests/payment-autologin.test.mjs` সেশন থাকলে এন্ট্রি ফর্ম ছাড়াই ডেস্ক খোলা যাচাই করে।

Runtime আগের মতো static HTML/CSS/JS; npm শুধু development tests-এর জন্য (Node 22+, Python 3):

```sh
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:e2e
```

Unit tests: search normalization, মাস/বছর, partial/overpayment, fee defaults, sorting, persistence/error ও receipt escaping। Browser tests: 320/390/1280px workflow, direct PDF download/validation, refresh persistence, double-submit, no print popup, download failure/retry, long Bengali text, keyboard focus, storage failure, status, ledger shortcut এবং offline PWA। আগে থেকে Chromium থাকলে `CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:e2e` ব্যবহার করা যায়।

## অফলাইন নকশা ও মডিউল কাঠামো

কোনো external font, CDN বা remote API ব্যবহার করা হয়নি। HTML শুধু page structure রাখে; feature logic ও style আলাদা module-এ ভাগ করা হয়েছে।

```text
index.html              student portal — page structure and SVG icon sprite
manager.html            Manager Panel — review queue, student approvals, notices, routine
admin.html              Admin Panel — entry screen + panel
teacher.html            Teacher Panel — class work, grading, attendance
payment.html            Payment Receive desk (session-guarded; sign-in is on index.html)
manifest.json           PWA manifest — #f7f8fc canvas, #0e7a55 theme color, orientation any
sw.js                   service worker — APP_SHELL precache + CACHE_VERSION
firebase-messaging-sw.js  optional FCM push receiver
firebase.json           Firebase Hosting + functions config
firestore.rules         Cloud Firestore security rules (prepared, not yet enabled)
database.rules.json     Realtime Database rules
database.rules.v2.draft.json  RTDB v2 rules draft
package.json            npm scripts (test, test:e2e)
playwright.config.cjs   Playwright config
demo/
  offline-roles.html    offline role-explainer (demo only — production pages do not link it)
  js/offline-role-store.js, offline-role-demo.js, offline-role-ui.js
css/                    (design-system.css লোড ক্রমে)
  design-system.css     CSS entry — @import cascade in load order
  foundation.css        design tokens and reset (single palette + AMOLED dark)
  ui-layout.css         app shell: topbar and page frame
  ui-components.css     buttons, chips, cards
  ui-forms.css          form controls
  ui-features.css       modals, alert backdrop (glass blur), toasts
  notice-board.css      notice board
  ui-status.css         status surfaces + sync-colored topbar border
  ui-auth.css           login, registration and recovery
  app-polish.css        final polish layer
  student-record.css    student record panels
  exam-archive.css      exam archive
  academics.css         class routines and teaching
  notifications.css     notifications
  course-hub.css        course hub
  ui-wallet.css         wallet/payment skin (loaded last on student pages)
  ui-interior.css       interior glass skins
  ui-modern.css         modern surfaces
  student-notebook.css  notebook features
assets/fonts/           NotoSansBengali-Variable.ttf/.woff2 (OFL.txt) — offline UI/PDF font
assets/icons/           app-logo.png, icon-192/512.png, maskable-192/512.png, logo-128.png +
                        logo-128-dark.png, apple-touch-icon.png, favicon-32/16.png, favicon.ico
js/                     (১২৭টি ES module; নিচে প্রধানগুলো মন্তব্যসহ)
  academics.js                — class routines and teaching
  account-policy.js           — username protection (protectAccountIdentity)
  admin-academics.js         
  admin-data.js               — sample dataset + feeCategories/paymentMethods
  admin-icons.js             
  admin-initialization.js    
  admin-migration.js         
  admin-panel-ui.js          
  admin-permissions.js        — Admin capability catalog + route guards
  admin.js                    — Admin Panel UI: views, actions, modals
  app-entry.js                — shared entry bootstrap
  appearance-boot.js          — pre-paint theme boot (no flash)
  appearance.js               — THEME_COLOR + applyTheme (Light/AMOLED)
  backup-merge.js            
  brand.js                   
  config.js                   — classes, schedule and local defaults
  copy.js                     — tap-to-copy chips
  counter-data.js             — counter payment save/validate
  counter-privacy.js          — privacy-first student search keys
  counter-report-data.js     
  counter-reports.js         
  course-content.js          
  course-editor.js           
  course-hub.js              
  daily-quote.js             
  database.js                 — local database adapter
  demo-data.js               
  exam-archive.js             — exam archive
  exam-core.js               
  exam-data.js               
  exam-manager.js            
  exam-pdf.js                
  exam-ui.js                 
  factory-reset.js            — factory reset
  finance-data.js            
  finance-receipt.js          — receipts and PDF
  firebase-config.js          — Firebase web config (public client identifier)
  firebase-diagnostic-ui.js  
  firebase-diagnostics.js    
  firebase-online-test.js    
  fixed-shell.js              — fixed header/footer measurement
  icon-set.js                
  icons.js                   
  install.js                  — PWA install prompt
  launch-screen.js           
  local-write-mark.js        
  login.js                    — one login form: student + staff (admin/manager/teacher/payment) handoff
  logout.js                   — logout confirmation modal and session clearing
  main.js                     — application composition root
  manager.js                  — Manager Panel UI
  material-pdf.js            
  navigation.js               — page/action routing
  notice-center.js            — notice center
  notification-rules.js      
  notification-settings.js   
  notification-store.js      
  notifications.js            — notifications
  office-data.js             
  panel-lockdown.js          
  panel-route.js             
  password-hash-worker.js     — module worker — hashing off the main thread
  password-hash.js            — PBKDF2 hashing (Web Crypto + pure-JS fallback)
  password-policy.js          — empty-password error, reset policy, random 6-digit passwords
  payment-auth.js             — payment-counter credentials and session
  payment.js                  — Payment Receive desk: search, entry, receipt, share
  print-tokens.js            
  profile.js                  — profile editing
  pull-to-refresh.js         
  push-notifications.js      
  question-bank.js            — question bank
  realtime-sync-entry.js      — RTDB sync entry (prepared)
  realtime-sync.js           
  realtime-value-codec.js    
  record-sync.js              — record sync (prepared)
  recovery.js                 — password recovery via security question
  register.js                 — step-by-step registration and Student ID
  registration-review.js     
  report-access.js           
  report-builders.js         
  report-catalog.js          
  report-layout.js           
  report-sources.js          
  reports.js                 
  routine.js                  — routine rendering and day tabs
  rtdb-keys.js               
  sanitize-url.js             — safe URL/phone-link handling
  sanitize.js                 — output escaping (escapeHtml)
  secure-store.js             — device-bound secret storage
  service-worker.js           — service worker registration
  session.js                  — SESSION_TTL_DAYS — remember-device TTLs (single source)
  settings-hub.js            
  shell.js                    — view aliases + panel shell
  staff-auth.js               — staff accounts, PBKDF2 verify, device-bound session tokens
  staff-directory.js         
  staff-management.js        
  staff-overview.js          
  staff-password-dialog.js    — one-time reveal dialog for generated reset passwords
  status-surface.js          
  storage.js                  — localStorage/sessionStorage adapter
  student-access.js          
  student-dashboard.js        — student home dashboard
  student-exams.js           
  student-features.js        
  student-hubs.js            
  student-more.js            
  student-notice-board.js    
  student-practice.js        
  student-record.js           — student record panel
  student-search.js           — student search (name/ID/mobile)
  student-study-sections.js  
  student-teaching.js        
  sync-collections.js        
  sync-merge.js              
  sync-session.js            
  sync-status.js              — sync status
  teacher-assignments.js     
  teacher.js                  — Teacher Panel UI
  teaching-data.js           
  theme-entry.js             
  theme-logos.js             
  theme.js                    — time and weather visual states
  topbar-connectivity.js      — sync-colored topbar border
  ui-accessibility.js        
  ui.js                       — shared DOM and feedback helpers
  user-id.js                 
  username-sync-codec.js     
  storage/migration.js  localStorage schema migration
firebase/               firebase-config.js, firebase-init.js, firebase-services.js
sync/                   cloud-sync modules (prepared, not yet enabled): sync-core, sync-auth,
                        sync-guard, sync-queue, sync-retry, sync-config, sync-status,
                        cloud-access, cloud-auth, question-bank-v2-sync/policy (+ docs)
functions/              Cloud Functions (prepared): index.js (revokeRefreshTokens,
                        releaseExamResults), exam-scoring.js, notification-payload.js,
                        question-bank-projection.js, migrations + test/firestore-rules.test.js
tests/                  unit tests (tests/*.test.mjs) + browser tests (tests/*.spec.cjs)
tools/                  spec-selector-audit.mjs, security/scan-secrets.mjs
scripts/preview-server.py  static preview server
```

ভবিষ্যতে Admin Panel-এর **শিক্ষার্থী অ্যাপ ম্যানেজমেন্ট** অংশ থেকে enabled class, routine, course, notice ও result data নিয়ন্ত্রণ করার জন্য config ও storage adapter আলাদা রাখা হয়েছে। API যুক্ত করার সময় মূল UI feature files বদলানোর প্রয়োজন হবে না।

## Glass Design System

পাঁচটি portal — শিক্ষার্থী (`index.html`), ম্যানেজার (`manager.html`), শিক্ষক (`teacher.html`), এডমিন (`admin.html`)
ও পেমেন্ট (`payment.html`) — একই visual language ব্যবহার করে। Design tokens (`css/foundation.css`) ও glass skin (`css/ui-features.css`, `css/ui-interior.css`) একই জায়গায় থাকে
এবং প্রতিটি পেজে একই ক্রমে load হয়, তাই এক জায়গায় পরিবর্তন করলেই সব
portal-এ একই সঙ্গে প্রয়োগ হয়।

এটি **presentation layer only** — কোনো markup hook, script, data key, route বা
business logic এখানে নেই। শুধু existing element-গুলোর চেহারা বদলায়।

| অংশ | কী করে |
| --- | --- |
| 01 Tokens | glass material, depth, blur budget, radius ও motion-এর CSS variable |
| 02 Ambient background | soft gradient + তিনটি low-contrast blurred blob (transform-only animation) |
| 03 Surfaces | দুই স্তরের glass — tier 1 (backdrop-blur card) ও tier 2 (translucent tile, blur ছাড়া) |
| 04 Top bars | চারটি portal-এর header-এ একই frosted material |
| 05 Bottom navigation | floating, rounded, safe-area-aware glass bar; active icon বড় + glow |
| 06 Water-drop icons | icon chip-এ highlight, inner shadow ও subtle idle float |
| 07 Tiles / rows / More | feature grid, list row ও "আরও" menu-র glass row |
| 08 Buttons | primary liquid-green ও secondary clear-glass, tap-এ scale feedback |
| 09 Forms | translucent input, পরিষ্কার focus glow (validation অপরিবর্তিত) |
| 10 Modal / toast | backdrop blur, glass dialog, glass notification |
| 11 Loading | `aria-busy` / `.is-loading` / `.glass-shimmer`-এ হালকা shimmer |
| 12 Guards | contrast, focus ring, 44px touch target, 320–430px overflow, reduced-motion, print |
| 13 Dark glass | `html[data-theme="dark"]`-এ একই language, শুধু inverted (opt-in) |

নিয়ম:

- Animation শুধু `transform`, `opacity` ও `filter` ব্যবহার করে — low-end Android-এ smooth।
- `backdrop-filter` শুধু navigation, modal ও প্রধান card-এ; nested tile-এ শুধু translucency।
- `prefers-reduced-motion` ও print/PDF path-এ সব animation ও blur বন্ধ।
- যে browser `backdrop-filter` সমর্থন করে না, সেখানে solid fallback background।
- Content-Security-Policy মেনে external stylesheet `'self'` থেকেই আসে; কোনো CDN নেই।
- Manifest, service worker ও offline architecture অপরিবর্তিত; শুধু নতুন CSS ফাইলটি
  `sw.js`-এর precache তালিকায় যোগ করা হয়েছে (cache name bump করে)।

## নোটিফিকেশন পপ-আপ — ব্লার করা ব্যাকগ্রাউন্ড, ক্যান্সেল ও বুঝেছি

নতুন নোটিশ এলে (বা সিস্টেম নোটিফিকেশন বন্ধ থাকলে) নিচ থেকে একটা **পপ-আপ শিট** ওঠে।
পেছনের পর্দা ব্লার হয়ে যায়, তাই পপ-আপটা স্পষ্ট আলাদা দেখায় — টপবার, কার্ড, বটম-নেভ
সবই কাচের মতো ঝাপসা থাকে (`css/ui-features.css`-এর গ্লাস স্কিন `.apc-alert-backdrop`-কে
`--glass-blur-thin` — লাইটে ৬px, AMOLED-এ ৮px — দিয়ে ব্লার করে; কেউ
"কম স্বচ্ছতা" চাইলে শুধু ম্লান (dim) টোন থাকবে, ব্লার নয়)।

| অংশ | কী থাকে |
| --- | --- |
| হেডার | আইকন + `Active Plus আপডেট` + শিরোনাম (`নতুন নোটিফিকেশন · ২টি`) + × |
| তালিকা | সর্বোচ্চ ৩টি নতুন খবর; প্রতি সারিতে আইকন, শিরোনাম ও সংক্ষিপ্ত বর্ণনা; `আরও Nটি নোটিফিকেশন অপেক্ষা করছে` |
| অ্যাকশন | **সব দেখুন** (পুরো ইনবক্স), তার নিচে **ক্যান্সেল** ও **বুঝেছি** — দুই অর্ধেক সারি |

- **ক্যান্সেল** ও **বুঝেছি** — দুটোই পপ-আপ বন্ধ করে; খবরটা ঘণ্টার তালিকায় (ইনবক্সে) থেকে যায়,
  তাই এক ক্লিকে কিছু হারায় না। **×**, ব্যাকড্রপে ট্যাপ, বা **Escape**-ও একই কাজ করে।
- সারিতে ট্যাপ করলে সেই নোটিশ/পরীক্ষা/ফলাফল খুলে যায়, পপ-আপ নিজে থেকে বন্ধ হয়।
- **সিস্টেম নোটিফিকেশন বন্ধ থাকলে** একই পপ-আপটাই ব্যাখ্যা দেয় ("ব্রাউজার সেটিংসে ব্লক করা আছে"
  বা "ডিভাইসে বন্ধ করা হয়েছে") — একই ব্লার করা ব্যাকড্রপ, একই ক্যান্সেল/বুঝেছি। মেসেজটা এখন
  ব্যারে নয়, পপ-আপেই দেখা যায়।
- বাটনের মাপ অ্যাপের বাকি ডিজাইনের সাথে এক (`mini-btn`, ৪৪px, দুই-কলাম অর্ধেক সারি;
  `সব দেখুন` পুরো সারি) — ৩২০px পর্দাতেও কিছু চাপাচাপি করে না।

## শিক্ষার্থীর সেকশনগুলো — গুছানো, বাকি অ্যাপের সাথে মিলিয়ে

শিক্ষার্থীর "আরও" (প্রোফাইল) আর "পড়াশোনা" স্ক্রিনের অনেক টুকরো মার্কআপে ছিল কিন্তু
**CSS-এ কোনো বিন্যাসই দেওয়া হয়নি** — তাই স্টাফ প্যানেলের পাশে এলোমেলো স্তূপ লাগত।
এখন একই কার্ড-ভাষা সব জায়গায়:

| জায়গা | কী ঠিক হলো |
| --- | --- |
| প্রোফাইল কার্ড | আইকন-অ্যাভাটার + নাম/শ্রেণি + আইডি/ইউজারনেম চিপ + এডিট বাটন — এক লাইনে সাজানো |
| যোগাযোগ কার্ড | বৃত্তাকার আইকন, মোবাইল/অভিভাবকের নম্বর এক জায়গায়, পাশে সবুজ WhatsApp পিল |
| সেটিংস কার্ড | এক সারি = এক কাজ; সারিগুলো এখন পৃথককারী রেখা দিয়ে (বক্স-ইন-বক্স নয়), আইকনে টোন রং |
| সহায়তা কার্ড | আইকন + লেখা + তীর বাটন এক সারিতে; "নিরাপত্তা" কার্ডে লগআউট লাল |
| পড়াশোনার কার্ড | ধরন-চিপ, অবস্থা-পিল (কাজ বাকি/সম্পন্ন), শিরোনাম, বিষয় • শ্রেণি • বিভাগ, তারিখের লাইন, বাঁয়ে ঘোরানো শেভরন |
| খোলা কার্ডের বিস্তারিত | তারিখ/স্থান/পূর্ণমানের গ্রিড, শিক্ষকের নাম, উপকরণ ও "কাজ সম্পন্ন" বাটন |
| সারসংক্ষেপ | তিনটি ছোট স্ট্যাট টাইল (মোট কাজ / বাড়ির কাজ বাকি / সম্পন্ন) |
| ফিল্টার | গোল চিপ, নির্বাচিতটি টোন রঙে; প্রতিটিতে গণনা |
| রুটিন | তারিখের স্ট্রিপ + আইকন, ডানদিকে ক্লাস-সংখ্যার চিপ, "ক্লাস নেই" দিনের জন্য ড্যাশড খালি অবস্থা |
| ছোট টুকরো | পরীক্ষা/ফি কার্ডের আইকন বর্গা, চ্যালেঞ্জ প্রগ্রেস বার, অগ্রগতির চিহ্ন |

- **লেবেল বাংলায়:** `Marks/Results → নম্বর ও ফলাফল`, `Academic notice → একাডেমিক নোটিশ`,
  `Attendance session → উপস্থিতি ক্লাস` (`js/teaching-data.js`)।
- রঙ, ব্লার আর টোন আসে আগের স্তর থেকেই — এই কাজটা বিন্যাসের, তাই ফ্ল্যাট fallback-এও কাজ করে।
- খালি রিপোর্ট কার্ড নিজে থেকেই লুকিয়ে যায় (`:has(.rp-mount:empty)`)। ৩২০px পর্দায়
  বাটন/চিপ নিচে নেমে যায়, কিছু চাপাচাপি করে না।

## আধুনিক রং — ব্র্যান্ড গ্রেডিয়েন্ট, পাঁচটি টোন, রিং গেজ

ফ্ল্যাট বেসলাইনটা ইচ্ছাকৃতভাবে ধূসর ছিল, তাই অ্যাপটা পুরোনো দেখাত। এখন **রঙের স্তরটা যোগ হয়েছে**
(`css/ui-interior.css` § 3), যা একই পেজকে আধুনিক দেখায় — আর ওটা **লেয়ার হিসেবে বসে**, তাই গ্লাসের
কার্ড বা ফ্ল্যাট fallback কোনোটাই ভাঙে না (`background-image` দিয়ে ফুটিয়ে দেওয়া হয়,
`background-color` কখনো ছোঁয়া হয় না)।

| উপাদান | রং |
| --- | --- |
| প্যালেট (দুই থিমে) | `--brand-2` (নীল-বেগুনি) + `--tone-blue / -mint / -amber / -violet / -rose` ও তাদের `-soft` ওয়াশ |
| সেকশন শিরোনাম | শিরোনামের বাঁয়ে ৪px **ব্র্যান্ড বার** (নীল → বেগুনি) |
| প্রধান কার্ড | হিরো কার্ডে ব্র্যান্ড ওয়াশ (ছাত্র ড্যাশবোর্ড, অ্যাডমিন হিরো, টিচার সামারি, সার্চ কার্ড) |
| স্ট্যাট/ফিচার টাইল | প্রতিটি টাইলে কোণা থেকে **টোন ওয়াশ** + আইকনে টোন রং; ফিচার গ্রিডে ৫ রঙের সাইকেল |
| অগ্রগতি | বৃত্তাকার **রিং গেজ** (conic arc + ট্র্যাক), `js/student-dashboard.js`-এর `--progress` ধরে |
| নেভিগেশন | অ্যাক্টিভ ট্যাবে ব্র্যান্ড গ্রেডিয়েন্ট চিপ + গ্লো; চিপ/ব্যাজে টোন ওয়াশ |
| প্রাইমারি বাটন | `linear-gradient(135deg, primary → brand-2)` + রঙিন গ্লো (একবার, পুরো অ্যাপে) |

- দুই থিমেই একই টোকেন; AMOLED-এ টোনগুলো উজ্জ্বল (true-black-এ রং পড়া যায়), লাইটে গাঢ়।
- "কম স্বচ্ছতা" সেটিং **শুধু ট্রান্সপারেন্সি** সরায় — রং থেকে যায়, তাই কেউ ফ্ল্যাট চাইলে
  অ্যাপ আধুনিকই দেখায়।
- গার্ড: `tests/modern-color.test.mjs` (৪টি) — দুই থিমে টোকেন, background-color নিষিদ্ধ,
  nested CSS নিষিদ্ধ, একটাই গ্রেডিয়েন্ট প্রাইমারি, রিং-কনট্র্যাক্ট, বাটন-সারির লেআউট
  রঙের স্তরে নেই।

## লোকালি চালানো

Service worker চালানোর জন্য একটি static server ব্যবহার করুন:

```bash
python3 -m http.server 4173
```

তারপর Chrome-এ `http://localhost:4173` খুলুন। PWA install এবং offline cache দেখতে প্রথমে একবার পেজ লোড করে Chrome DevTools-এর Application → Service Workers থেকে পরীক্ষা করা যায়।

এডমিন প্যানেল: `http://localhost:4173/admin.html` — ইউজারনেম `admin.apc` — প্রথমবার প্রবেশে নিজের পাসওয়ার্ড নির্ধারণ করতে হয়। শিক্ষক: `teacher.apc`। পেমেন্ট ডেস্ক: `payment.apc`। তিনটিতেই কোনো বিল্ট-ইন ডিফল্ট পাসওয়ার্ড নেই।

GitHub Pages-এ প্রকাশ করলেও relative asset path ব্যবহার করা হয়েছে, তাই repository subpath থেকেও অ্যাপটি চলবে।

## ব্যবহার

1. Chrome-এ পেজটি খুলুন।
2. Chrome-এর install icon বা অ্যাপের install prompt চাপুন।
3. ইনস্টল হওয়ার পর হোম স্ক্রিন থেকে **Active Plus** খুলুন।
4. প্রোফাইল থেকে নাম, শ্রেণি ও বিভাগ বদলালে তথ্য এই ডিভাইসেই সংরক্ষিত থাকবে।

পরবর্তী ধাপে authenticated API ও অনলাইন ডেটাবেস দিয়ে প্রকৃত শিক্ষক অ্যাকাউন্ট, অনুমোদন ও একাধিক ডিভাইসে সমন্বয় যোগ করতে হবে।


## আলাদা শিক্ষক প্যানেল

`teacher.html` খুলুন, অথবা শিক্ষার্থী লগইন পেজেই `teacher.apc` ও পাসওয়ার্ড দিয়ে ঢুকুন (`admin.apc` দিলে এডমিন প্যানেল, `payment.apc` দিলে পেমেন্ট ডেস্ক)। এডমিন প্যানেল → আরও → শিক্ষক প্যানেল পথও আছে। ইউজারনেম **`teacher.apc`** — প্রথমবার প্রবেশে নিজের পাসওয়ার্ড নির্ধারণ করতে হয়। এক ক্লিকে প্রবেশ নেই। ডেটা এই ব্রাউজারে থাকে; এটি সার্ভার-ভিত্তিক শিক্ষক অ্যাকাউন্ট নয়।

- পাঁচটি ফুটার: **হোম / পরীক্ষা / বাড়ির কাজ / রুটিন / আরও**। আরও-তে সাজেশন ও অনুমোদিত শিক্ষার্থী খোঁজা যায়। খালি সার্চে শিক্ষার্থী তালিকা আসে না।
- **হোম = কাজের কিউ** — চারটি কাউন্ট (প্রকাশিত, খসড়া, **মূল্যায়ন বাকি**, আজকের ক্লাস), তারপর **“মনোযোগ দরকার”** তালিকা: কোন কাজে কী বাকি সেটি এক লাইনে লেখা (যেমন “২ জনের নম্বর বাকি”, “১ জনের খাতা দেখা বাকি”, “৩ জনের উপস্থিতি বাকি”, “খসড়া — শিক্ষার্থী এখনও দেখবে না”) আর এক চাপেই সেই কাজের ঘর খুলে যায়। নিচে **আজকের ক্লাস** (সময় অনুযায়ী) ও সাম্প্রতিক ৫টি কাজ। ক্লাসের তারিখ না এলে নম্বর/উপস্থিতি “বাকি” ধরা হয় না, তবে শিক্ষার্থী খাতা জমা দিলে তা সঙ্গে সঙ্গে কিউ-তে আসে। হোমের উপরেই **“কোন শ্রেণির কাজ দেখবেন”** ছাঁকনি: একটি শ্রেণি বাছাই করলে চারটি কাউন্ট, “মনোযোগ দরকার”, “আজকের ক্লাস” ও “সাম্প্রতিক কাজ” সবই শুধু সেই শ্রেণির জন্য দেখায় (হেডলাইনে শ্রেণির নামসহ), আবার “সব শ্রেণি”-তে ফিরলে আগের মতো সব একসাথে।
- **নেভিগেশনে বাকি কাজের ব্যাজ** — ফুটারের পরীক্ষা/বাড়ির কাজ/রুটিন ট্যাবে কতগুলো কাজ বাকি তার সংখ্যা, তাই অন্য পেজে থাকলেও খেয়াল রাখা যায়।
- **তালিকা গোছানো** — প্রতিটি রেকর্ড পেজে ধরনের ট্যাব (সংখ্যাসহ), ফিল্টারের সাথে প্রকাশিত/খসড়া ভাগ, **দিনভিত্তিক গ্রুপ** (আজ/আগামীকাল/গতকাল/তারিখ) এবং **ডেডলাইন ক্রম** (আজ → সামনের তারিখ → আগের তারিখ)। ১৫টির বেশি হলে “আরও … দেখুন”। প্রতিটি কার্ডে অগ্রগতি লাইন: `অগ্রগতি ৩/৮ জন • ৫ জনের নম্বর বাকি`।
- **দ্রুত নম্বর/উপস্থিতি** — মার্কিং শিটে উপরেই সারাংশ (“৮ জনের ৩ জন নথিভুক্ত • বাকি ৫ জন”), **এক চাপে সবার জন্য** প্রয়োগ (সবাই উপস্থিত / দেরিতে / অনুপস্থিত, সবাই জমা দিয়েছে / দেখা হয়েছে, নম্বরের ক্ষেত্রে সব ঘর খালি), **শুধু বাকিরা** ফিল্টার ও বড় শ্রেণির জন্য শিক্ষার্থী সার্চ। দ্রুত প্রয়োগ শুধু তখনই দেখা সারিগুলোতে বসে, তাই ফিল্টার করে আলাদা করেও দেওয়া যায়।
- পরীক্ষা: বিষয়, শ্রেণি/বিভাগ, তারিখ, সময়, সময়কাল, পূর্ণমান, স্থান এবং সিলেবাস/প্রশ্নের নির্দেশনা। প্রকাশের পরে প্রত্যেক অনুমোদিত শিক্ষার্থীর নম্বর (শূন্যসহ, ০.৫ ধাপে) দেওয়া যায়। এটি স্বয়ংক্রিয় অনলাইন পরীক্ষা/কুইজ ইঞ্জিন নয়।
- পরীক্ষার PDF বাস্তব প্রশ্নপত্রের মতো: হেডারে লোগো ও 'প্রশ্নপত্র' শিরোনাম, প্রশ্নের নিচে MCQ অপশন **দুই কলামে (ক খ / গ ঘ)**, আর পেজ নম্বর হেডারে না দেখিয়ে **ফুটারে** 'পৃষ্ঠা ১ / ২'। পরীক্ষা শেষ হলে শিক্ষার্থী/শিক্ষক **সঠিক উত্তরপত্র** আলাদা পেজে ডাউনলোড করতে পারেন — উপরে ৬-কলামের উত্তর-গ্রিড, এরপর প্রতিটি প্রশ্নে সঠিক অপশন সবুজ হাইলাইট ও শিক্ষার্থীর উত্তর সঠিক/ভুল মন্তব্য। দুই-পাস রেন্ডারে প্রতিটি অংশের সঠিক মোট পেজ গোনা হয়; সব PDF অফলাইন canvas render, print dialog নেই।
- বাড়ির কাজ: নির্দেশনা, জমার শেষ তারিখ/সময়, সহায়ক লিংক; শিক্ষার্থী **কাজ সম্পন্ন হয়েছে জানাও** দিয়ে নিজের সম্পন্ন হওয়ার খবর দিতে পারে। শিক্ষক বাকি/সম্পন্ন/দেখা হয়েছে অবস্থা রাখেন। এটি খাতা বা ফাইল আপলোড নয়।
- সাজেশন: পাঠ্য নোট ও HTTP(S) উপকরণের লিংক।
- **সহায়ক উপকরণ (শিক্ষার্থী কোর্স কার্ড)** — পপ-আপে **পুরো কাজটি দেখা যায়** (তারিখ/স্থান/পূর্ণমান, নির্দেশনা, শিক্ষক), নিচের **ডাউনলোড করুন** চাপলেই অটো ডাউনলোড: (১) শিক্ষক বাইরের লিংক দিলে **ডাউনলোড করুন** ফাইলটি সরাসরি ডাউনলোড করে (fetch + অ্যাপের নিজস্ব downloadBlob, অফলাইনেও; ব্লক থাকলে নতুন ট্যাবে); (২) লিংক না থাকলে **উপকরণ PDF ডাউনলোড করুন** — কাজের শিরোনাম, তারিখ, নির্দেশনা দিয়ে `js/material-pdf.js` বান্ডেলড বাংলা ফন্ট থেকে ব্র্যান্ডেড PDF **অ্যাপের ভেতরেই অফলাইনে তৈরি** করে (`ActivePlus-material-<ধরন>-<তারিখ>.pdf`)। ইমেজ জেনারেট শুধু পেমেন্ট পোর্টালের রসিদে; আগের ডেমো ডেটার পুরনো ফাইল-লিংক প্রথম লোডেই মুছে ফেলা হয়। ফন্টে না থাকা ↗ তীর-চিহ্নের বদলে ইনলাইন SVG।
- রুটিন: নির্দিষ্ট তারিখের ক্লাস, সময়, রুম ও উপস্থিতি (উপস্থিত/অনুপস্থিত/দেরিতে)। একই শিক্ষকের প্রকাশিত ক্লাস/পরীক্ষার সময় মিলে গেলে সংরক্ষণ বাধা দেয়; এটি পুনরাবৃত্ত সাপ্তাহিক সময়সূচি নয়।
- প্রতিটি কাজ খসড়া বা প্রকাশিত রাখা, সম্পাদনা ও নিশ্চিত করে মুছে ফেলা যায়। অগ্রগতি থাকলে শ্রেণি/বিভাগ পরিবর্তন অথবা সংরক্ষিত নম্বরের নিচে পূর্ণমান নামানো যাবে না। মুছে ফেললে সংশ্লিষ্ট নম্বর/অগ্রগতিও মুছবে।
- শিক্ষার্থীর **কোর্স** অংশে শুধু তার শ্রেণি/বিভাগের প্রকাশিত কাজ; **রুটিন**-এ ক্লাস/উপস্থিতি; **ফলাফল**-এ তার নিজের নম্বর দেখা যায়। পুরোনো স্থির সারাংশ/কোর্সগুলোকে ডেমো তথ্য হিসেবে আলাদা চিহ্নিত করা হয়েছে।
- মোবাইলের fixed header/footer, স্বাধীন মাঝের স্ক্রল, এক-কলামের ফর্ম ও টাচ-উপযোগী মডাল বজায় আছে। প্রথমবার cache পূর্ণ হলে শিক্ষক প্যানেলও অফলাইনে চলে।

### ডেটা ও ভবিষ্যৎ API

`js/teaching-data.js`-এর async `teachingRepository` পদ্ধতি (`list`, `listStudents`, `saveActivity`, `deleteActivity`, `saveProgress`, `markHomeworkDone`) API adapter দিয়ে প্রতিস্থাপনযোগ্য। শিক্ষক UI `js/teacher.js`; শিক্ষার্থী feed `js/student-teaching.js`; shared style `css/teaching.css`।

একাডেমিক ডেটার পৃথক versioned localStorage key **`activePlus.teaching.v1`**; বিদ্যমান Student ও Transaction গঠন বদলানো হয়নি। অনুমোদিত ডামি roster-এর সঙ্গে বর্তমানে সংরক্ষিত active student account ID দিয়ে deduplicate করা হয়। Admin-এর সাময়িক demo approval এখানে স্বয়ংক্রিয় স্থায়ী approval হিসেবে গণ্য হয় না।

লেখার আগে সর্বশেষ snapshot পড়া হয়; সমর্থিত ব্রাউজারে Web Locks ব্যবহার হয়। স্টোরেজ লেখা সফল হওয়ার পরেই UI সফলতা দেখায়। ফর্ম ব্যর্থ হলে ইনপুট থাকে; ক্ষতিগ্রস্ত একাডেমিক ডেটা স্বয়ংক্রিয়ভাবে reset/overwrite হয় না। একই origin/browser-এর অন্য ট্যাব storage event দিয়ে কাজ ও অগ্রগতি পায়।

**সীমা:** এটি local-only demo; যে কেউ শিক্ষক পেজ খুলতে পারে। এটি সার্ভার-ভিত্তিক role authorization, ব্যক্তিগত ফলাফলের নিরাপত্তা, cloud backup বা এক মোবাইল থেকে অন্য মোবাইলে বিতরণ দেয় না। ব্রাউজারের site data মুছলে লোকাল কাজ হারাবে। বাস্তবে চালুর আগে শিক্ষক authentication, assignment-based permissions, server-side student/grade access checks, স্থায়ী database ও backup দরকার।

### যাচাই

```bash
npm install
npm test
npm run test:e2e
```

Browser suite চালাতে Playwright Chromium বা `CHROMIUM_EXECUTABLE` দিয়ে compatible Chromium লাগবে। Teacher tests-এ CRUD, scope/draft isolation, নম্বর, homework self-report/review, উপস্থিতি, সময়ের সংঘর্ষ, সংরক্ষণ ব্যর্থতা, corrupt storage, offline cache, roster search ও mobile fixed-shell layout যাচাই করা হয়। Finance ও আগের navigation/mobile regression tests-ও রাখা হয়েছে।


## স্থায়ী নিবন্ধন নম্বর ও ডিফল্ট পাসওয়ার্ড

- প্রথম নিবন্ধনের মোবাইলই স্থায়ী login ID। প্রোফাইলের মূল নম্বর readonly; পরিবর্তিত form payload-ও সেটি বদলায় না। অতিরিক্ত নম্বর **প্রোফাইল সম্পাদনা → নতুন মোবাইল নম্বর যোগ করুন** থেকে append করা যায়। আগের নম্বর বাদ দেওয়া/প্রতিস্থাপন করার UI নেই; অতিরিক্ত নম্বর login/recovery ID নয়।
- `js/account-policy.js` শিক্ষার্থী ও ভবিষ্যৎ শিক্ষক অ্যাকাউন্টের একই policy: `registrationMobile`, append-only `additionalMobiles`, বাংলা/ইংরেজি/local/+880 normalization, duplicate validation। এই দুই additive field Account-এ রাখা হয়েছে; Student/Transaction-এর গঠন বদলানো হয়নি।
- `config.js`-এ শিক্ষার্থীর `DEFAULT_PIN = '123123'` (কোডের ভেতরের নাম; UI-তে সব জায়গায় এখন “পাসওয়ার্ড”)। এটি শুধু নতুন নিবন্ধন ও পাসওয়ার্ড-reset-এর খালি ঘরের fallback — ৪–৬ সংখ্যার। এডমিন, শিক্ষক ও পেমেন্ট ডেস্ক এই মানটি ব্যবহার করে না — তাদের ইউজারনেম `admin.apc` / `teacher.apc` / `payment.apc`, এবং প্রত্যেকের পাসওয়ার্ড প্রথম লগইনে নিজে নির্ধারিত হয় (কোনো বিল্ট-ইন ডিফল্ট নেই)। নিবন্ধনে নিজের ৪–৬ সংখ্যার পাসওয়ার্ড বেছে নেওয়া যায়। পুরোনো custom পাসওয়ার্ড স্বয়ংক্রিয়ভাবে reset করা হয় না।
- পুরোনো অ্যাকাউন্টের বর্তমান সংরক্ষিত login mobile স্থায়ী নম্বর হিসেবে নেওয়া হয়। পূর্বে বদলে যাওয়া আসল নম্বরের history এই অ্যাপে নেই; সেটি পুনরুদ্ধার করা যায় না। আলাদা legacy profile contact থাকলে সেটিকে অতিরিক্ত নম্বর হিসেবে রাখা হয়।
- `persistAccount` সর্বশেষ saved account থেকে মূল নম্বর/আগের অতিরিক্ত নম্বর ধরে রাখে এবং লিখে সফল snapshot ফেরত দেয়। ব্যর্থ সংরক্ষণে নতুন contact/পাসওয়ার্ড সফল হয়েছে দেখায় না।
- শিক্ষক প্যানেলে এখন ইউজারনেম `teacher.apc` ও পাসওয়ার্ড লাগে। এটি এখনও লোকাল credential, সার্ভার-ভিত্তিক শিক্ষক অ্যাকাউন্ট নয়।
- ডিফল্ট স্টাফ পাসওয়ার্ড সম্পূর্ণভাবে সরানো হয়েছে — বিস্তারিত নিয়মে ডেটাবেস সেকশনে দেখানো হয়। বর্তমানে যুক্ত থাকা প্লেইনটেক্সট অ্যাকাউন্ট প্রথম লগইনে হ্যাশ করা হয় এবং পাসওয়ার্ড বদলাতে বাধ্য হয়। বাকী প্লেইনটেক্সট অ্যাকাউন্ট একবার হ্যাশ করে আপগ্রেড করা হয়।

## নিরাপত্তা — ধাপ ১ (হ্যাশড পাসওয়ার্ড, শক্তিশালী সেশন)

এই ধাপে ডিভাইস-স্থানীয় নিরাপত্তা পুরোপুরি কাজ করে। সার্ভার-ভিত্তিক প্রমাণীকরণ ধাপ ৩-এ (Firebase) যোগ হবে।

**পাসওয়ার্ড কখনো প্লেইনটেক্সটে থাকে না**

- `js/password-hash.js` — PBKDF2-HMAC-SHA256, প্রতি পাসওয়ার্ডে আলাদা random salt, ওয়ার্ক-ফ্যাক্টর রেকর্ডে জমা থাকে। Web Crypto (`crypto.subtle`) থাকলে ৬,০০,০০০ iteration; প্লেইন `http` (LAN) বা পুরোনো ব্রাউজারে একই PBKDF2-এর pure-JS fallback চলে, তাই হ্যাশিং সবখানে ঘটে।
- শিক্ষার্থীর পাসওয়ার্ড ও রিকভারি-উত্তর — দুইটিই `pinHash` / `securityAnswerHash` রেকর্ড আকারে সংরক্ষিত (`js/storage.js`)। স্টাফ পাসওয়ার্ড `js/staff-auth.js`-এ একই নিয়মে।
- পুরোনো প্লেইনটেক্সট রেকর্ড স্বয়ংক্রিয়ভাবে আপগ্রেড হয়: সফল লগইন/রিকভারির সময়ই মানটি হ্যাশ করা হয় এবং প্লেইনটেক্সট মুছে যায়।

**কোনো বিল্ট-ইন ডিফল্ট পাসওয়ার্ড নেই**

- পূর্বের স্টাফ ডিফল্ট পুরনো বিল্ট-ইন ডিফল্ট পাসওয়ার্ড কোড ও ডকুমেন্টেশন থেকে সম্পূর্ণ সরানো হয়েছে।
- একটি ভূমিকার (এডমিন/শিক্ষক/পেমেন্ট) প্রথম লগইনে `js/staff-password-dialog.js` নিজের পাসওয়ার্ড নির্ধারণ করে; সেটি না হলে প্যানেল খোলে না।
- পুরোনো ডিফল্ট দিয়ে তৈরি অ্যাকাউন্ট প্রথম সফল লগইনের পরপরই নতুন পাসওয়ার্ড বদলানো বাধ্যতামূলক (`mustChangePassword`)।

**সেশন — টোকেন + এক্সপায়ারি + ডিভাইস বাইন্ডিং** (`js/session.js`)

- প্রতিটি সেশন একটি random টোকেন, ডিভাইস ID, ইস্যু-সময় ও এক্সপায়ারি নিয়ে গঠিত।
- “এই ডিভাইসে মনে রাখুন” = ৯০ দিনের টোকেন (localStorage); না হলে শুধু ট্যাব-সেশন (sessionStorage)।
- অন্য ডিভাইসে কপি করা রেকর্ড ডিভাইস-চেকে ব্যর্থ; মেয়াদোত্তীর্ণ রেকর্ড auto-delete।
- শিক্ষার্থী অ্যাপ আর শুধু অ্যাকাউন্ট থাকলেই auto-login করে না — বৈধ সেশনের টোকেন প্রয়োজন (শুধু “পাসওয়ার্ড চাইবে না” পছন্দটি ব্যতিক্রম)।

**সংবেদনশীল ডেটা এনক্রিপশন** (`js/secure-store.js`)

- প্ল্যাটফর্ম অনুমতি দিলে স্টাফ অ্যাকাউন্ট ও সেশন রেকর্ড AES-GCM envelope-এ লেখা হয়; কী ডিভাইসেই থাকে (`activePlus.deviceKey.v1`)।
- Web Crypto না থাকলে রেকর্ডে শুধু PBKDF2 হ্যাশ থাকে — প্লেইনটেক্স্ট কখনো নয়।

**XSS প্রতিরোধ ও CSP**

- `js/sanitize.js` এক জায়গায় `escapeHtml` / `safeUrl` / `cleanText` — admin, payment, teacher, receipt, exam ও teaching মডিউলগুলি সবাই একই হেল্পার ব্যবহার করে।
- অ্যাডমিন-লেখা রক্ষণাবেক্ষণ বার্তা innerHTML-এ বসার আগে escape হয়।
- চারটি পেজেই Content-Security-Policy মেটা ট্যাগ: শুধু own-origin স্ক্রিপ্ট/স্টাইল/ফন্ট, `object-src 'none'`, `base-uri 'self'`।

**শেষ হওয়ার আগে যা বাকি (ধাপ ৩)**

Firebase Authentication + role-based security rules, সার্ভার-অথরিটেটিভ এক্সাম/গ্রেডিং লজিক, idempotent sync ও সার্ভার-সাইড immutable-number enforcement। শিক্ষার্থীর ৪–৬ সংখ্যার পাসওয়ার্ড low-entropy; সার্ভার অথ আসার পর rate-limit ও শক্তিশালী নীতি বসবে।

## “পরীক্ষা নিন” — অনুমোদনসহ পরীক্ষার লোকাল কর্মপ্রবাহ

### কোথায় পাবেন

- **শিক্ষক → আরও → পরীক্ষা নিন:** MCQ / লিখিত / সংক্ষিপ্ত উত্তর আলাদা তৈরি, **কোন শ্রেণির জন্য সেই শ্রেণি নির্বাচন (আবশ্যক)**, প্রশ্ন পেস্ট, preview, খসড়া, অনুমোদনের আবেদন, ক্লাস পরীক্ষার নম্বর ও উপস্থিতি। পরীক্ষার কার্ডে শ্রেণির নাম দেখা যায়। আগের শিক্ষক footer-এর “পরীক্ষা” অংশ শুধু পুরোনো class assessment records; নতুন অনুমোদিত online workflow আলাদা। তালিকার উপরে ধরনের ট্যাবের নিচে **শ্রেণির ছাঁকনি**ও আছে — একটি শ্রেণি বাছাই করলে শুধু সেই শ্রেণির পরীক্ষা দেখায়।
- **Manager → পরীক্ষা:** তারিখ অনুযায়ী ইতিহাস, আসন্ন পরীক্ষা ও প্রশ্নের আর্কাইভ। ছাঁকনি: নাম/ID/প্রশ্ন, নির্দিষ্ট তারিখ, তারিখ-পরিসর, শ্রেণি, বিষয়, অবস্থা, ধরন। Manager নতুন পরীক্ষা তৈরি, প্রশ্ন যোগ/সম্পাদনা/মুছে ফেলা, অপশন ও সঠিক উত্তর বদল, তারিখ/শ্রেণি/নম্বর/সময়কাল নির্ধারণ, খসড়া সংরক্ষণ, পর্যালোচনা, অনুমোদন, প্রকাশ, Unpublish, সম্পন্ন/আর্কাইভ, ফিরিয়ে আনা, ডুপ্লিকেট এবং পুরোনো প্রশ্ন দিয়ে নতুন পরীক্ষা — সব করতে পারেন। প্রকাশিত পরীক্ষা সরাসরি মুছে যায় না (আগে Unpublish/আর্কাইভ), আর উত্তর/ফলাফল থাকা পরীক্ষা কখনোই মুছে যায় না।
- **প্রশ্ন কখনো খোলা থাকে না:** ড্যাশবোর্ড/ইতিহাসে শুধু পরীক্ষার তালিকা — প্রতিটি সারিতে “প্রশ্ন দেখুন” চাপলে কেবল সেই এক পরীক্ষার প্রশ্ন খোলে।
- **শিক্ষার্থী → হোম/কোর্স → পরীক্ষা দাও:** **নিজের শ্রেণির জন্য** প্রকাশিত পরীক্ষা (অন্য শ্রেণির পরীক্ষা তালিকায় আসে না এবং শুরুও করা যায় না), MCQ-তে অংশগ্রহণ, লিখিত/সংক্ষিপ্ত প্রশ্নপত্র ডাউনলোড, নিজের ও সবার ফলাফল। ফলাফল পাতাতেও প্রবেশের বাটন আছে। Footer আগের পাঁচটিই। শ্রেণি নির্বাচন চালুর আগে সংরক্ষিত পরীক্ষাগুলোর শ্রেণি নেই, তাই সেগুলো আগের মতোই সব শ্রেণিকে দেখানো হয়।

প্রতি পরীক্ষায় একটি বিষয়; একই দিনে একাধিক পরীক্ষা আলাদা Examination ID নিয়ে আলাদা রেকর্ড হিসেবে থাকে; একই দিনের পরীক্ষাগুলো একই তারিখের গ্রুপে দেখায় — পুরোনো ও নতুন প্রশ্ন কখনো মেশে না। Status: খসড়া → অনুমোদনের অপেক্ষায় → অনুমোদিত → প্রকাশিত → সম্পন্ন → আর্কাইভ (ফেরত = সংশোধনের শাখা)। Draft/pending/approved/rejected/archived কিছুই শিক্ষার্থীর UI-তে আসে না; শুধু নিজের শ্রেণির প্রকাশিত/সম্পন্ন পরীক্ষা নির্ধারিত সময়ে দেখা যায়। প্রতিটি প্রশ্নের নিজস্ব unique ID থাকে এবং তারিখ বদলালে রেকর্ড নতুন তারিখে সাজে। সব অনুমোদিত শ্রেণি/বর্ষ একসঙ্গে অংশ নিতে পারে।

### আজকের অনুপ্রেরণা — শিক্ষার্থীর হোমে ডেইলি কোট (v150)

- **কার্ডটি কোথায়:** শিক্ষার্থীর হোমে **আজকের ক্লাস** আর **দ্রুত সেবা (Quick Menu)**-এর ঠিক মাঝখানে একটি ছোট এক-লাইন কার্ড — `#dailyQuoteCard`। ক্রম: প্রোফাইল ও অগ্রগতি → আজকের ক্লাস → আজকের অনুপ্রেরণা → দ্রুত সেবা → পরীক্ষা/ফি/আজকের পড়াশোনা কার্ড।
- **নিজে থেকেই বদলায়:** সূচক = ঢাকা সময়ের দিন-সংখ্যা % বাঁধাই তালিকা দৈর্ঘ্য, তাই একই দিনে বারবার খুললেও একই বাক্য, পরদিন নতুন বাক্য; কোনো বাটন বা ব্যবহারকারীর কাজ লাগে না।
- **অফলাইন-ফার্স্ট:** কার্ড প্রথম রেন্ডারেই ভরা থাকে (ক্যাশে থাকলে ক্যাশের ফিড, নাহলে অ্যাপের ভেতরের ৩০টি বাঁধাই বাক্য); পরে `assets/daily-quotes.json` একবার চুপচাপ পড়া হয় এবং ক্যাশে জমা হয়। নেট নেই / ৪০৪ / ভাঙা JSON / খালি ফিড / ঝুলে থাকা অনুরোধ — কোনোটিতেই এরর, স্পিনার, রিট্রাই বাটন বা খালি বাক্স আসে না।
- **ডেটা সুরক্ষা:** একটিমাত্র ব্যক্তিগত কী `activePlus.dailyQuote.v1`; অন্য কোনো রেকর্ড পড়া, বদলানো বা মোছা হয় না, কোনো `localStorage.clear()` নেই, সিঙ্ক কালেকশনে কিছু যোগ হয় না।
- **অফলাইন শেল:** `CACHE_VERSION 150` — `js/daily-quote.js` ও `assets/daily-quotes.json` শেলে যোগ হয়েছে; PWA, ইনস্টল ও ক্যাশ আগের মতোই।
- বিস্তারিত: `docs/DAILY-QUOTE-150.md`; টেস্ট: `tests/daily-quote.test.mjs` (১০টি)।

### Exam Code, প্রশ্ন ব্যাংক ও কোর্স হাব (v149)

- **পরীক্ষার কোড:** প্রতিটি পরীক্ষা সংরক্ষণ করলেই একটি স্থায়ী কোড পায় — `M2608BN01` = ধরন (M = MCQ, S = সংক্ষিপ্ত, R = লিখিত) + বছর + শ্রেণির কোড + বিষয়ের কোড + ক্রমিক নম্বর। কোড একবার লেখা হয়, তারপর কখনো বদলায় না: তারিখ বদলালে রেকর্ড নতুন তারিখে সাজে, ক্লাস/বিষয়ের নাম বদলালেও পুরোনো কাগজের কোড অটুট থাকে। পুরোনো রেকর্ড প্রথম লেখার সময়েই কোড পেয়ে যায় (`examRepository.ensureCodes()`), তাই কোথাও ডেটা হারায় না।
- **প্রশ্নের ক্রম:** প্রতিটি শিক্ষার্থীর প্রশ্ন ও অপশনের ক্রম `examCode + studentId + attemptId` থেকে তৈরি হয় (fixed/suffle দুটোই পরীক্ষার সেটিংসে আছে)। ফলাফল হিসেবে উত্তর সবসময় **অপশনের ID** ধরে সংরক্ষিত থাকে, তাই ক্রম বদলালেও নম্বর মেলে; একই প্রচেষ্টা আবার খুললে হুবহু একই প্রশ্নপত্র ফিরে আসে।
- **প্রশ্ন সংরক্ষণ করুন (প্রশ্ন ব্যাংক):** `QUESTION-0001` ধারায় স্থায়ী আইডি, চার ধরনের প্রশ্ন (MCQ, সত্য/মিথ্যা, সংক্ষিপ্ত উত্তর, লিখিত), অধ্যায়/টপিক/কঠিনতার ট্যাগ এবং কোড/শ্রেণি/বিষয়/অধ্যায়/টপিক/ধরন/তারিখ ধরে সার্বজনীন অনুসন্ধান ও পাতা-ভাগ (এক পাতায় ২০টি, তাই কখনো হাজার প্রশ্ন একসঙ্গে রেন্ডার হয় না)। পরীক্ষা থেকে প্রশ্ন সংরক্ষণ করলে ব্যাংকে **কপি** জমা হয় — পরীক্ষা বদলায় না, ব্যাংক থেকে মুছলেও কোনো পরীক্ষার প্রশ্ন মুছে যায় না। ব্যাংক থেকে সরাসরি খোলা পরীক্ষায় প্রশ্ন যোগ করা যায়।
- **PDF:** প্রতিটি পাতা একই ব্র্যান্ড মডিউল (`js/brand.js`) থেকে নাম, স্লোগান ও লোগো নেয় (অ্যাপের বিদ্যমান লোগো ফাইল, আলাদা কপি নেই)। প্রশ্নপত্রের মাথায় পূর্ণ পরিচয়পত্র — পরীক্ষার কোড, শ্রেণি, বিষয় (কোডসহ), ধরন, অধ্যায়, Batch, তারিখ, সময়, সময়কাল, মোট প্রশ্ন, পূর্ণমান, পাস নম্বর। শিক্ষার্থীর PDF তার নিজের ক্রমে ছাপে; উত্তরপত্রে প্রতিটি প্রশ্ন নম্বর ও স্থায়ী আইডি ধরে সঠিক অপশনের আইডি ও লেখা থাকে।
- **কোর্স হাব (শিক্ষার্থী → কোর্স):** শ্রেণি → বিষয় → চ্যাপ্টার → কনটেন্ট; বিভাগগুলো — পড়ুন, নোট, গুরুত্বপূর্ণ, সাজেশন, প্রশ্ন, MCQ, পূর্বের প্রশ্ন, মডেল টেস্ট, পরীক্ষা, আমার ফলাফল। বিষয় তালিকা Academic Setup থেকে আসে, শিক্ষার্থী শুধু নিজের শ্রেণির **প্রকাশিত** কনটেন্ট দেখে, আর “পরীক্ষা” ও “আমার ফলাফল” বিভাগ দুটি আলাদা ব্যবস্থা নয় — হুবহু বিদ্যমান Examination ও Result ডেটা পড়ে। শিক্ষক/Manager “পড়াশোনা পরিচালনা করুন” পাতা থেকে শুধু নিজের assigned ক্লাস ও বিষয়ের কনটেন্ট লেখেন।

### প্রশ্নের টেমপ্লেট

সম্পাদক থেকে **টেমপ্লেট কপি করুন**, নিজের প্রশ্ন লিখে **প্রশ্ন পেস্ট করুন** ঘরে বসান। সঙ্গে সঙ্গে প্রশ্ন ও মোট নম্বরের preview তৈরি হবে। Copy permission না পেলে template text নির্বাচন করে মোবাইলের Copy ব্যবহার করুন।

```text
প্রশ্ন: বাংলাদেশের রাজধানী কোনটি?
A: ঢাকা
B: চট্টগ্রাম
C: খুলনা
D: রাজশাহী
উত্তর: A
---
প্রশ্ন: ৫ + ৩ = কত?
A: ৬
B: ৭
C: ৮
D: ৯
উত্তর: C
```

লিখিত/সংক্ষিপ্ত প্রশ্নে শুধু `প্রশ্ন:` ও `নম্বর:` থাকবে। প্রতিটি field এক লাইনে; প্রশ্নের মাঝে `---`। ১–১০০ প্রশ্ন; প্রশ্নে ০.০১–১০০০ নম্বর, মোট সর্বোচ্চ ১০,০০০। বাংলা/ইংরেজি সংখ্যা গ্রহণ করে। প্রশ্ন/অপশন শুধু লেখা—HTML execute হয় না। অসম্পূর্ণ প্রশ্ন, duplicate field/option, invalid answer key ও invalid marks প্রত্যাখ্যাত হয়; ইনপুট থাকে।

### নির্ধারিত নিয়ম

- MCQ: সবার একই start/end timestamp; প্রথমবার ঢোকার grace window শিক্ষক নির্ধারণ করেন (কমপক্ষে ১ মিনিট)। Question এবং option order প্রতিটি attempt-এ shuffle হয় ও persist হয়; reload-এ বদলায় না। সব প্রশ্ন এক স্ক্রিনে; আগের উত্তর বদলানো যায়।
- **MCQ-তে প্রতি প্রশ্নের নম্বর ১ নির্ধারিত** (`MCQ_MARKS`) — টেমপ্লেটে “নম্বর:” লাইন লিখতে হয় না, মোট নম্বর = প্রশ্ন সংখ্যা; “নম্বর: ১” লিখলে চলবে, অন্য মান দিলে স্পষ্ট বাংলা ত্রুটি দেখাবে। লিখিত ও সংক্ষিপ্ত প্রশ্নে আগের মতো প্রশ্নভেদে আলাদা নম্বর লেখা যায়।
- প্রতি ভুল উত্তরে নির্ধারিত points কাটা হয়, অনুত্তরিতে ০। মোট নম্বরের সর্বনিম্ন ০। MCQ-তে প্রতি প্রশ্ন ১ নম্বর; লিখিত/সংক্ষিপ্তে প্রশ্নভেদে আলাদা নম্বর। জমা হলেই score, সঠিক/ভুল/অনুত্তরিত সংখ্যা ও grade; সঠিক উত্তর তখন দেখানো হয় না।
- **Running-average retake:** ওই মুহূর্তে জমা হওয়া প্রথম প্রচেষ্টাগুলোর গড়ের নিচে প্রথম score হলে দ্বিতীয়বার শুরু করা যায়। মোট দুইবার; প্রথম entry grace window দ্বিতীয়বারে প্রযোজ্য নয়, কিন্তু একই end time কঠোরভাবে থাকে। গড় পরে কমলেও শুরু করা দ্বিতীয় attempt বাতিল হয় না। দ্বিতীয় score গড় নির্ধারণে ব্যবহার হয় না। Rank/grade-এ দুই প্রচেষ্টার সেরা score; সমান score-এ সমান competition rank।
- Grades: configurable pass percentage (default 33); তার নিচে F। বাকি ক্ষেত্রে 80+ A+, 70+ A, 60+ A−, 50+ B, 40+ C, অন্যথায় D। Retake eligibility এই pass percentage নয়, চলমান গড় দিয়ে ঠিক হয়।
- লিখিত ও সংক্ষিপ্ত: release time থেকে প্রশ্নপত্রের PDF পাওয়া যায়, পরে আবারও ডাউনলোড করা যায়। বাংলাদেশ সময় release date-এর পরের দিন ক্লাসে খাতায় পরীক্ষা। কোনো answer-upload বা automatic written grading নেই। শিক্ষক প্রতিটি প্রশ্নের নম্বর দেন অথবা অনুপস্থিত হিসেবে রাখেন; নম্বর থাকলে সরাসরি absent করা যায় না।
- Public result cards: নাম, শ্রেণি, score, grade, rank এবং MCQ question counts; মোবাইল/অভিভাবকের নম্বর নয়। Teacher/Admin report-এ অংশগ্রহণ, queued/active submission count এবং অনুপস্থিত/নম্বর বাকি তালিকা; CSV সরাসরি ডাউনলোড (spreadsheet formula escaping-সহ)।

### অফলাইন ও PDF

`activePlus.exams.v1`-এ exam ও attempts আলাদা domain হিসেবে থাকে; Student/Transaction schema বদলায়নি। প্রতিটি answer save durable হওয়ার পরেই saved count বদলায়। প্রশ্ন প্রথম load-এ local থাকে। Offline finish/deadline-এ attempt **queued**, উত্তর লক; browser online হলে submission/score sync হয়। App বন্ধ/স্থগিত থাকলে পুনরায় খুললেই expired attempt lock/sync হয়। একই exam/student-এর duplicate start/resubmit নতুন attempt বা duplicate score তৈরি করে না। Web Locks দিয়ে একই browser-এর concurrent writes serialize হয়।

সবার end time-এর আগে answer-key PDF নিষিদ্ধ। End time এলে অংশগ্রহণকারীর খোলা/দৃশ্যমান app স্বয়ংক্রিয় direct download শুরু করার চেষ্টা করে; browser বাধা দিলে বা asset failure হলে manual PDF button থাকে। App বন্ধ অবস্থায় download চলবে না। Browser download initiation মানেই ফাইল সত্যিই ফোনে save হয়েছে—এমন দাবি করা হয় না। পরে আবার download করা যায়।

`js/exam-pdf.js` bundled Bengali font ও logo দিয়ে canvas-rendered, paginated A4 PDF বানায় (প্রশ্ন, আলাদা marks, correct answers এবং নিজের নির্বাচিত উত্তর); external CDN/PDF service, print dialog নেই। PDF-টি image-based; selectable text PDF নয়।

### বাস্তব বহু-মোবাইল পরীক্ষা চালুর আগে

**এটি এখন ক্রস-ডিভাইসে চলে, তবু production online exam service নয়।** `examRepository` (`js/exam-data.js`) async API seam; authoring `js/exam-manager.js`, student runtime `js/student-exams.js`, shared reports `js/exam-ui.js`। পরীক্ষার ডেটা (`exams` + `attempts`) এখন Firebase ব্রিজের নিবেদিত `examDb` মিররে (per-exam/per-attempt id-keyed, `realtime-sync.js`) অন্য ফোনেও পৌঁছায়: শিক্ষকের পরীক্ষা, Manager-এর অনুমোদন/প্রকাশ, শিক্ষার্থীর উত্তর ও score, ফলাফল/র‍্যাঙ্ক আর deletion—সবই live sync হয়। মার্জ নিয়ম per-id last-write-wins; যে লেখা এখনো push হয়নি (অফলাইন উত্তর-সেভ) সেটি stale remote কপিতে চাপা পড়ে না। এখানেও “online sync” মানে client-side bridge—কোনো remote server acknowledgement বা server-authoritative grading নেই।

বর্তমান demo teacher/admin role client-side, প্রশ্নের answer key client storage-এই থাকে এবং device clock/client data বদলানো যায়; exam timing প্রতিটি ডিভাইসের ঘড়িতেই চলে, তাই পরীক্ষার আগে সব ফোনের সময় ঠিক আছে কি না মিলিয়ে নিন। UI-তে answer key withheld থাকলেও এটি পরীক্ষার গোপনীয়তা বা cheating prevention নয়। বাস্তব high-stakes চালুর জন্য authenticated teacher/student/admin accounts, server-side permissions, server-authoritative clock/eligibility/grading, answer-key isolation until global end, durable server-side exam/attempt database, idempotent sync endpoint, conflict policy এবং offline answer timing গ্রহণের স্পষ্ট server policy আবশ্যক। ছাত্রের ফোনের timestamp একা বিশ্বাস করা যাবে না। Teacher registration/provisioning আগের মতো এখনও পৃথক pending কাজ।

Tests: date-wise archive grouping/filters, question-level edit/add/delete with unique ids, workflow transitions and permissions, student visibility, template parser/validation, approval transitions/ownership, timing/grace, all-class eligibility, shuffle/resume, negative/weighted grading, running-average retry, best-score rank, offline locking/idempotent sync, written marks/absence, failed/corrupt writes, multi-page PDF structure, end-time auto PDF, direct CSV, and mobile 320/390/landscape/wide layout—সঙ্গে আগের সব regression tests।

### ইনস্ট্যান্ট MCQ অনুশীলন ও স্বয়ংক্রিয় প্রশ্ন-শেলফ (v155–v157)

- **প্রকাশের সঙ্গে প্রশ্ন ব্যাংকে:** একটি MCQ পরীক্ষা Manager approve+publish করলে তার প্রশ্নগুলো প্রশ্ন ব্যাংকে `exam-` আইডি ও **উৎস-পরীক্ষার ট্যাগসহ** নিজে থেকেই জমা হয় (নতুন যোগ হয়, আগের থাকে)। পরীক্ষা বদলে গেলে ব্যাংকের কপি অচল থাকে; ব্যাংকে মুছলে পরীক্ষা অক্ষত।
- **শিক্ষার্থী → পরীক্ষা → অনুশীলন:** নিজের শ্রেণির শেষ হওয়া MCQ পরীক্ষা থেকে দুই ধরনের টাইমার-সহ অনুশীলন — (১) **বোর্ডপত্র অনুশীলন**: পুরো প্রশ্নপত্র, (২) **র‍্যান্ডম অনুশীলন**: ব্যাংক থেকে ২০টি MCQ (প্যাকেজ/অধ্যায়/ট্যাগ ফিল্টারসহ)। সময়সীমা **প্রতি প্রশ্নে ১ মিনিট** (`js/student-practice.js`)।
- **শিট চালু থাকলে** ফোন বন্ধ রাখলেও পরে ফিরে এলে সময় বেঁচে থাকে (ডিভাইস-লোকাল); সময় শেষ হলে **নিজে থেকেই জমা** হয়ে রেজাল্ট পাতায় স্কোর ও **সঠিক-ভুল চেক** (উত্তরগুলো সবসময় সাজানো, ক্লিক করলেই চেক)। সময়-বাজির বাকি-সময় ৩০ সেকেন্ড কমলে সতর্কবার্তা।
- **ইতিহাস:** শেষ ২০টি অনুশীলনের স্কোর তালিকায় থাকে (সর্বশেষ আগে), আলাদা স্টোরে — অফিসিয়াল পরীক্ষার attempts বা রেজাল্টে কিছুই লেখা হয় না, তাই এখানকার স্কোর রেটিং/অ্যাডমিন রেপোর্টে আসে না।
- **ব্যাকফিল:** পুরোনো প্রকাশিত MCQ পরীক্ষার প্রশ্ন প্রথমবার ম্যানেজার/শিক্ষক প্যানেল খোলার সময় ব্যাংকে যোগ হয়ে যায় (idempotent)।
- **শেলফ পড়া ডিভাইস-লোকাল** (সিঙ্ক কালেকশনে যায় না); অন্য ডিভাইসে সেই ডিভাইসের নিজের ব্যাকফিল চলে।
- টেস্ট: `tests/mcq-instant-practice.test.mjs` (৮টি), ব্যাংক/ব্যাকফিল-রেগ্রেসন আগের ফাইলে।

### ছোট UI/নিরাপত্তা ধাপ (v151–v154)

- **নোটিফিকেশন সেটিংস খোলা যাচ্ছে না এমন ডিভাইসেও** — ডিজিটাল ভিউতে “নোটিফিকেশন ও সিঙ্ক” তালিকায় চ্যাপ্টারের পাশে পূর্ণ-প্রস্থ সেটিংস কার্ড; ভিউ বদলালে স্ক্রল রিসেট, মোবাইলে কার্ডের উপরে স্ক্রল (v151)।
- **খালি জায়গা-ব্যবহার** — সব ডিজিটাল টেমপ্লেটে কার্ড/রো-মাঝের ফাঁক ও প্যাডিং সামান্য বাড়ানো, বড় ফন্টের ভিউতেও টেক্সট কখনো কাটা যায় না (v152)।
- **সব পাঁচ প্যানেলের হেডার** — লোগো + স্লোগানই থাকে, প্যানেলের নামের লাইন আর নাই (v153/154)।

## খালি শুরু

খালি ব্রাউজারে শিক্ষার্থী তালিকা, নোটিশ, রুটিন, ফি, পরীক্ষা ও শিক্ষকের কাজ খালি থাকে। লগইন পেজে এক-ক্লিক ডেমো, আগে থেকে লেখা পাসওয়ার্ড বা নমুনা শিক্ষার্থী কার্ড নেই।

- শিক্ষার্থী নিজে রেজিস্ট্রেশন করে। স্টাফ লগইন এই তিনটি: এডমিন `admin.apc`, শিক্ষক `teacher.apc`, পেমেন্ট `payment.apc`। তিনটিতেই প্রথম পাসওয়ার্ড নিজে নির্ধারণ করতে হয় — কোনো বিল্ট-ইন ডিফল্ট পাসওয়ার্ড নেই।
- চার ধরনের ব্যবহারকারীই লগইন করেন `index.html`-এর একই ফর্ম দিয়ে: শিক্ষার্থী (ইউজারনেম/মোবাইল + পাসওয়ার্ড), শিক্ষক, এডমিন ও পেমেন্ট কাউন্টার (নিজের ইউজারনেম + পাসওয়ার্ড)। ট্যাব, শর্টকাট লিংক বা আগে থেকে লেখা পাসওয়ার্ড কিছুই নেই।
- `js/admin-data.js`-এর পুরোনো নমুনা তালিকা শুধু টেস্ট ফিক্সচার। চলমান অ্যাপ খালি স্টোরেজে সেগুলো লোড করে না।
- `js/demo-data.js` এখনও ফিক্সচার বানাতে পারে, কিন্তু `activePlus.demo.autofill.v1` `'on'` না থাকলে কিছু যোগ করে না। লগইন পেজে সেই সুইচ আর নেই।

### ডেটাবেস — Firebase পরে বসবে

Firebase SDK এই ধাপে যোগ করা হয়নি। কালেকশনের নাম ও স্টোরেজ কী `js/database.js`-এ। এখনকার অ্যাডাপ্টার এই ব্রাউজারের `localStorage`। পরে Firestore বসাতে এই ফাইলের পড়া/লেখার ফাংশন বদলালেই হবে; পেজগুলো কালেকশনের নামই ব্যবহার করে।

সিঙ্ক করা যাবে: `students`, `transactions`, `notices`, `routine`, `teaching`, `exams`, `settings`।

ডিভাইসেই থাকবে: শিক্ষার্থীর পাসওয়ার্ড, স্টাফ পাসওয়ার্ড, সেশন ও ইউজারনেম ইনডেক্স। এগুলো `LOCAL_ONLY` — Firebase-এ তোলা যাবে না। নতুন নোটিশ, রুটিন ক্লাস ও Student ID এখন মুছে-আবার-যোগ করলেও একই আইডিতে ধাক্কা খায় না। নতুন ফি রেকর্ডে `recordedAt` থাকে, তাই একই দিনের আদায় সময় অনুযায়ী সাজানো যায়।

### নোটিশ

শিক্ষার্থীর নোটিশ ইনবক্স অফিসের নোটিশ তালিকা ও অ্যাপ সেটিংসের ঘোষণা থেকে আসে। খালি অবস্থায় “এখনও কোনো নোটিশ নেই” দেখায়। পড়ার রেকর্ড `activePlus.notices.read.v1:<student-id>`-এ এই ডিভাইসেই থাকে।

## Offline role workspace v2 — নতুন নীতির পরীক্ষার সংস্করণ

`demo/offline-roles.html` খুলুন। **ডেমো ডেটাবেজ তৈরি** একবার চাপুন।
Login: `admin.demo`, `manager.demo`, `teacher.demo`, `payment.demo`, `student.demo`।
শুধু ডেমোর পাসওয়ার্ড: `Demo12345`। বাস্তব তথ্যের জন্য এই credentials ব্যবহার করবেন না।

সব রোল একই `activePlus.roleWorkspace.v2` localStorage document ব্যবহার করে।
`payment` internal ID-এর UI নাম **Cash Counter**। পুরোনো v1 database, accounts,
transactions বা মূল প্যানেলগুলো স্বয়ংক্রিয়ভাবে migrate করা হয়নি। এই workspace-এর
নিয়ম পুরোনো `admin.html`/`manager.html`/`payment.html`-এর ওপর প্রয়োগ হয়েছে ধরে নেবেন না।

- Admin: non-student staff create/edit/activate/deactivate/reset, assigned classes,
  অনুমোদিত staff role পরিবর্তন, system settings, সব রিপোর্ট, backup/restore।
- Manager: student approve/reject/edit/reset, payment approval, operational reports,
  notices/routines/classes, academic app settings, exam/result approval ও publication।
- Teacher: assigned-class roster, attendance/remarks, assignments ও grading,
  academic notices, exam/result preparation (প্রকাশের আগে Manager review)।
- Cash Counter: সীমিত student lookup, payment entry, নিজের counter history/receipt।
- Student: registration (Manager approval required), নিজের profile/payment/academic
  তথ্য, নিজের class-এর প্রকাশিত তথ্য, assignment submission।

`js/offline-role-store.js` প্রতিটি action-এ database থেকে বর্তমান actor পুনরায় যাচাই
করে; callers-এর পাঠানো role/status দিয়ে অনুমতি নির্ধারণ করে না। Reads scoped,
role grants explicit (Admin auto-superuser নয়), password PBKDF2 hashed। Staff
reset/deactivation/role change পুরোনো session invalid করে। Pending payment মোট
আদায়ে গণনা হয় না; duplicate approval প্রত্যাখ্যাত হয়। Receipt-এ provisional status থাকে।
Report/receipt বর্তমানে JSON download; polished PDF/print এবং legacy panel migration
এই পরীক্ষার workspace-এর অংশ নয়। Demo data ইচ্ছাকৃত ও পুনরায় seed করে পুরোনো data মুছে না।

অফলাইনে DevTools/localStorage পরিবর্তন ঠেকানো সম্ভব নয়; এটি online backend security
নয়। আলাদা ডিভাইস বা origin-এ sync নেই। প্রথমবার online/local server দিয়ে page/assets
load হওয়ার পর service-worker cache দিয়ে offline ব্যবহার করা যায়। Online migration-এ
একই policy server-side identity, authorization, transactions এবং Firestore rules-এ
প্রয়োগ করতে হবে। পুরোনো Firebase rules এই নতুন policy অনুযায়ী deploy করা হয়নি।

যাচাই:
- `node --test tests/offline-role-store.test.mjs`
- `npx playwright test tests/offline-roles.spec.cjs`

Browser tests: Cash Counter entry → Manager approval → Admin report → Student own
history, forbidden menus, reload persistence এবং 320/390px layout। Domain tests:
forbidden direct actions, scoped data, pending totals, assignments/results, staff
session invalidation, registration, storage failure এবং safe backup restore।

### পূর্ণ কোচিং ডেমো

নতুন workspace-এ UI দিয়ে seed করলে ষষ্ঠ–দ্বাদশ শ্রেণির A/B মিলিয়ে ১৪টি সেকশন,
১১৪ জন শিক্ষার্থী, ২৫৭ payment, ৩০ notice, ৫৭ routine, ৬০ assignment,
৩৪০ submission, ৫৭ exam, ৩৪১ result, ৪২৫ attendance ও ৮৫ feedback তৈরি হয়।
প্রতি সেকশনে approved/pending/rejected student এবং published/pending academic
records আছে। এগুলো কৃত্রিম তথ্য, কোনো বাস্তব ব্যক্তির রেকর্ড নয়।

আগে seed করা থাকলে `admin.demo` দিয়ে ঢুকে **সব ক্লাসে আরও ডেমো যোগ করুন** চাপুন।
এটি additive/idempotent: একই ID দ্বিতীয়বার তৈরি করে না; সম্পাদনা বা approval ফিরিয়ে
নেয় না। মূল Teacher-এর assigned class বদলায় না। অতিরিক্ত class teacher:
`teacher6a.demo` … `teacher12b.demo`; approved student:
`student6a1.demo` … `student12b6.demo` (grade 6–12, section a/b, roll 1–6)।
নতুন নমুনায় সবার password `Demo12345`। Teacher ও Student তাদের নির্ধারিত scope-ই দেখেন।
ক্লাস/সেকশন dropdown ও search ব্যবহার করে বড় তালিকা ফিল্টার করুন।


## শিক্ষার্থী প্যানেল ডেটা কাভারেজ ম্যাট্রিক্স (v272)

শিক্ষার্থী প্যানেলের প্রতিটি অংশে কোনো স্ট্যাটিক ডেমো ডেটা নেই; সব তথ্য সরাসরি শিক্ষক বা ম্যানেজার প্যানেলের কাজ থেকে আসে এবং একক শ্রেণি-বিভাগ কী (`classId` + `sectionId`, `js/class-key.js`) দিয়ে ফিল্টার হয়:

| শিক্ষার্থী প্যানেল অংশ | ডেটার উৎস (ফাইল / স্টোরেজ কী) | কোন ভূমিকা ও ফিচার থেকে আসে |
| --- | --- | --- |
| হোম স্ট্যাটস, সাপ্তাহিক অগ্রগতি, উপস্থিতি %, গড় ফলাফল, এই টার্মের অগ্রগতি, বাকি কাজ ও আজকের পড়াশোনা | `js/student-dashboard.js` (`calculateStudentHomeStats`) → `KEYS.teaching`, `KEYS.exams`, `KEYS.routine`, `KEYS.courses` | **Teacher** (উপস্থিতি, বাড়ির কাজ, কোর্স/অধ্যায়, নম্বর) + **Manager** (রুটিন, পরীক্ষা প্রকাশ) |
| রুটিন (হোম ও সাপ্তাহিক রুটিন) | `js/routine.js`, `js/student-dashboard.js`, `js/student-hubs.js` → `KEYS.routine` (`activePlus.admin.routine.v1`) ও `KEYS.teaching` (`routine` সেশন) | **Manager** (`manager.html` সাপ্তাহিক রুটিন, `teacherId` ড্রপডাউনসহ) + **Teacher** (`teacher.html` তারিখভিত্তিক উপস্থিতি, রুম/নোট ও একদিনের অতিরিক্ত ক্লাস) |
| আমার কোর্স ও অধ্যায়ভিত্তিক অগ্রগতি | `js/course-data.js` (`courseRepository`, `activePlus.courses.v1`) ও `js/student-study-sections.js` | **Teacher** (`teacher.html` → আরও → কোর্স ও অধ্যায়: কোর্স তৈরি/সম্পাদনা, অধ্যায় যোগ, এক ট্যাপে `শুরু হয়নি` → `চলছে` → `শেষ`, খসড়া/প্রকাশিত) |
| বাড়ির কাজ, সংক্ষিপ্ত লিখিত উত্তর ও শিক্ষকের মন্তব্য | `js/teaching-data.js` (`KEYS.teaching` = `activePlus.teaching.v1`) ও `js/student-teaching.js` | **Teacher** (`teacher.html` বাড়ির কাজ প্রকাশ, শিক্ষার্থীর উত্তর পড়ে `"দেখা হয়েছে"` চিহ্ন ও ≤২০০ অক্ষরের মন্তব্য) + **Student** (≤৫০০ অক্ষরের লিখিত উত্তর জমা) |
| সাজেশন ও সহায়ক উপকরণ | `js/teaching-data.js` (`KEYS.teaching`) ও `js/course-content.js` (`KEYS.courseContent`) | **Teacher** (`teacher.html` সাজেশন ও উপকরণ প্রকাশ) + **Manager** (`manager.html` পড়াশোনা পরিচালনা) |
| পরীক্ষা (চলমান / আসন্ন) | `js/exam-data.js` (`KEYS.exams` = `activePlus.exams.v1`) ও `js/student-exams.js` | **Teacher** (`teacher.html` প্রশ্ন তৈরি ও অনুমোদনের আবেদন) → **Manager** (`manager.html` `"পরীক্ষা অনুমোদন"` তালিকা থেকে প্রশ্ন/উত্তর/নম্বর যাচাই করে প্রকাশ বা কারণসহ ফেরত; **Admin** শুধু রিপোর্ট দেখে) |
| ফলাফল ও শ্রেণি ফলাফল বোর্ড | `js/exam-data.js` (`classResultRows`), `js/student-exams.js`, `js/student-teaching.js` | **Teacher** (লিখিত পরীক্ষার নম্বর ও ≤২০০ অক্ষরের মন্তব্য) + **Manager** (ফলাফল প্রকাশ; ফলাফল কার্ডে নাম/শ্রেণি/নম্বর শুধুমাত্র একই শ্রেণি-বিভাগের শিক্ষার্থীরা দেখে) |
| নোটিশ ইনবক্স ও বেল ব্যাজ | `js/office-data.js` (`KEYS.notices` = `activePlus.admin.notices.v1`), `js/notification-rules.js`, `js/student-notice-board.js` | **Teacher** (`teacher.html` নিজ শ্রেণি-বিভাগে নোটিশ প্রকাশ) + **Manager** (`manager.html` সাধারণ ও শ্রেণিভিত্তিক নোটিশ প্রকাশ) |


### ২০২৬-১০-১৩: টাকা (ধাপ ১)
নতুন লেনদেন ও স্থানীয় পুরোনো ভগ্নাংশযুক্ত লেনদেন সম্পূর্ণ টাকায় (নিকটতম পূর্ণ টাকা, অর্ধেক হলে ওপরের দিকে) রূপান্তরিত হয়; অপরিবর্তনীয় পুরোনো রসিদ/ID অক্ষত থাকে। কোটা শেষ হলে পুরোনো ledger অপরিবর্তিত থাকে। `js/money.js`-এ নিরাপদ পূর্ণসংখ্যা যাচাই ও যোগ।

### ২০২৬-১০-১৩: ঢাকা সময় (ধাপ ২)
ফি-র মাস/তারিখ, Counter-এর আজ এবং পরীক্ষার স্থানীয় সময়ের জন্য `js/time.js` (Asia/Dhaka) ব্যবহৃত। `setTimeProvider`-এ পরবর্তী সময়ে সার্ভারের যাচাইকৃত সময় বসাতে হবে; এখন ঘড়ি পিছোলে সেশনে বাংলা সতর্কবার্তা দেখায়। ডিভাইসের ঘড়ি নিরাপদ সার্ভার-টাইমের বিকল্প নয়।

### ২০২৬-১০-১৩: অফলাইন ডেটা (ধাপ ৩)
অ্যাপ চালুতে `navigator.storage.persist()` অনুরোধ; localStorage কোটা শেষ হলে পুরোনো ডেটা না মুছে সতর্কতা ও Admin-এর ব্যাকআপ লিংক। Admin হোমে শেষ সফল ব্যাকআপের সাত দিন পর রিমাইন্ডার। অন্য ডিভাইসে ডেটা থাকবেই এমন নিশ্চয়তা নেই; নিয়মিত ব্যাকআপ নিন।

### ২০২৬-১০-১৩: ID (ধাপ ৪)
নতুন শিক্ষার্থী ID `S<ডিভাইস-চিহ্ন>-000001`, নতুন রসিদ `C<ডিভাইস-চিহ্ন>-000001`; পুরোনো ID/রসিদ অপরিবর্তিত, transaction `.id` সিঙ্ক কী হিসেবে অপরিবর্তিত। `createIdGenerator({allocateOrdinal, prefix})`-এ পরবর্তীতে সার্ভারের atomic counter বসাতে হবে—ডিভাইস-লোকাল ক্রমিক ক্লাউডের uniqueness-এর বিকল্প নয়।

### ২০২৬-১০-১৩: ফি, অভিভাবক ও সম্মতি (ধাপ ৫–৭)
শিক্ষার্থীর “আমার ফি” শুধু নিজের লেনদেন দেখায়; প্রতিবার রসিদ ডাউনলোড/শেয়ারের আগে নিজের সেশন দিয়ে পুনরায় যাচাই হয়। Teacher ও Manager অভিভাবকের কাছে অনুপস্থিতি/ফলাফল/বকেয়া বিষয়ে WhatsApp খসড়া খুলতে পারেন; অ্যাপ কোনো বার্তা নিজে পাঠায় না। রেজিস্ট্রেশনে অভিভাবকের সম্মতি বাধ্যতামূলক; privacy.html দেখুন।

### ২০২৬-১০-১৩: নম্বর অডিট (ধাপ ৮)
লিখিত পরীক্ষার নম্বর ও উপস্থিতির পরিবর্তন পরীক্ষার মূল রেকর্ডের `auditLog`-এ একই atomic write-এ কে/কখন/আগে/পরে/কারণসহ থাকে। শিক্ষক ৭ দিনের পর সংশোধন করতে পারেন না; Manager-এর ৭ দিন পর কারণ লাগে। Admin হোমে লগ দেখা যায়; শিক্ষার্থীর snapshot বা শিক্ষকের snapshot-এ অডিট পাঠানো হয় না। সার্ভার-রুলস ছাড়া স্থানীয় অডিট tamper-proof নয়।

### ২০২৬-১০-১৩: MCQ চেষ্টা (ধাপ ৯)
নতুন পরীক্ষায় প্রতি শিক্ষার্থী একবারই চেষ্টা করতে পারবেন। আগে সংরক্ষিত দ্বিতীয় প্রচেষ্টা ইতিহাসে থাকবে। নির্ধারিত প্রশ্ন/অপশন seed-ক্রম, `endAt`-ভিত্তিক টাইমার, saved answers এবং সময় শেষে auto-submit বিদ্যমান; পরীক্ষার সেশন রিফ্রেশেও ফিরে আসে। অফলাইন ডিভাইসের ঘড়ি অনির্ভরযোগ্য—সার্ভার সময় ছাড়া cheating প্রতিরোধ নিশ্চিত নয়।

### ২০২৬-১০-১৩: আপডেট ও রক্ষণাবেক্ষণ (ধাপ ১০–১২)
নতুন service worker সক্রিয় হলে “নতুন সংস্করণ আছে” ব্যানার; রিফ্রেশের সিদ্ধান্ত ব্যবহারকারীর। GitHub Actions-এ push/PR-এ `npm ci && npm test`, Dependabot সাপ্তাহিক। লাইসেন্স: মালিকের পছন্দ অনুযায়ী সর্বস্বত্ব সংরক্ষিত (MIT নয়)। Firebase Hosting headers-এ CSP ও নিরাপত্তা হেডার; self-hosted Bengali WOFF2 ইতিমধ্যে precache-এ আছে।

### ২০২৬-১০-১৩: ক্লাস উপস্থিতি (ধাপ ৮-এর পরিপূরক)
শিক্ষকের ক্লাস উপস্থিতির প্রতিটি নতুন/বদল/মুছে দেওয়া মানের কে/কখন/আগে/পরে একই teaching record-এর `auditLog`-এ সংরক্ষিত হয়। পুরোনো উপস্থিতি ৭ দিনের পর শিক্ষক বদলাতে বা ক্লাস মুছতে পারেন না; Manager একাডেমিক রেকর্ড থেকে কারণ লিখে সংশোধন করতে পারেন। Admin-এ পরীক্ষা ও ক্লাসের লগ একসাথে দেখা যায়।

### ২০২৬-১০-১৩: ঢাকা তারিখ ও পূর্ণ টাকার সংহতি
হোমে আজকের ক্লাস/সাপ্তাহিক অগ্রগতি, শিক্ষক ক্লাস ও রিপোর্টের ফি হিসাব ঢাকা তারিখ ও পূর্ণ টাকায় গণনা করা হয়। রসিদের নতুন নম্বর এক জায়গায় `idGenerator` বরাদ্দ করে; legacy daily format কেবল পড়া হয়।

### ২০২৬-১০-১৩: শিক্ষার্থী ফি মাইগ্রেশন
পুরোনো roster-এর `monthlyFee` ভগ্নাংশ হলে পাঠের সময় পূর্ণ টাকায় রূপান্তর ও atomic write; নতুন roster/account/studentProfile সংরক্ষণেও একই নিয়ম। খালি ফি null-ই থাকে; অকারণে default ফি লেখা হয় না।

### ২০২৬-১০-১৩: স্বতন্ত্র Admin অডিট পাতা
Admin → ডেটা → নম্বর/উপস্থিতি অডিট লগ (`#audit`)। এই পাতার access guard Admin-only backup capability-এর সমান; শিক্ষক/শিক্ষার্থীর snapshot-এ লগ যায় না।

### ২০২৬-১০-১৩: Admin নম্বর সংশোধন
Admin-এর অডিট পাতায় লিখিত পরীক্ষা বেছে নম্বর সংশোধনের ফর্ম আছে। Manager-ও একই গ্রেডিং ফর্ম পান; ৭ দিন পেরোলে দুজনকেই কারণ দিতে হয়। প্রকাশ/অনুমোদন Admin-এর জন্য খোলা হয়নি।

### ২০২৬-১০-১৩: ঘড়ি পেছানো সনাক্ত
একই ট্যাব সেশনে সর্বশেষ জানা wall time `sessionStorage`-এ থাকে; ঘড়ি দুই সেকেন্ডের বেশি পিছোলে সতর্কবার্তা (রিফ্রেশের পরেও)। এটি সতর্কতা মাত্র—পরীক্ষার বিশ্বস্ত deadline enforcement-এর জন্য Firebase server time দরকার।

### ২০২৬-১০-১৩: পরীক্ষার schedule ইনপুট
`datetime-local`-এর পাঠ/লেখা এখন সর্বত্র Asia/Dhaka নির্দিষ্ট (+06:00), ডিভাইসের সিস্টেম-জোনের উপর নির্ভর করে না। পরীক্ষার শেষ/শুরু দেখানো ও deadline স্টেজে একই ঘড়ির abstraction।

### ২০২৬-১০-১৩: নোটিফিকেশন সময়
জন্মদিন, আগামীকালের কাজ ও পরীক্ষার নোটিফিকেশনের আজ/আগামীকাল ও সীমা ঢাকা মধ্যরাতে বদলায়; স্থানীয় OS timezone বদলালেও ছাত্রের day key স্থিতিশীল।

### ২০২৬-১০-১৩: WhatsApp খসড়ার পরিমার্জন
Teacher/Manager তিন ধরনের খসড়া বেছে নিতে পারেন। শিক্ষক বকেয়া টাকার গোপন লেজার পড়তে পারেন না, তাই তাঁর খসড়ায় ভুল ৳০ দেখানো হয় না; Manager কেবল অনুমোদিত লেনদেনের ভিত্তিতে সঠিক বকেয়া লেখেন।

### Lighthouse যাচাই (১৩ অক্টোবর ২০২৬)
লোকাল স্ট্যাটিক সার্ভারে Chromium 153 ও Lighthouse 11.7.1-এ `--only-categories=pwa,accessibility,best-practices` চালিয়ে ফল: **PWA 100, Accessibility 100, Best Practices 96**। Maskable icon এবং রঙের contrast অডিট পাস করেছে; ফি/অভিভাবক/অডিটের নতুন টাচ টার্গেট ন্যূনতম ৪৮px। ৯০-এর নিচে কোনো স্কোর নেই। Best Practices-এর ৪ পয়েন্ট কমার কারণ restricted পরীক্ষার পরিবেশ থেকে Firebase/CDN-এ `ERR_CONNECTION_CLOSED` কনসোল ত্রুটি; প্রোডাকশন নেটওয়ার্কে পুনরায় যাচাই করতে হবে। লোকাল HTTP সার্ভারে Firebase Hosting response headers প্রয়োগ হয় না—ডিপ্লয়ের পর headers আলাদাভাবে পরীক্ষা করতে হবে। Lighthouse 13-এ PWA category নেই বলে 11.7.1 ব্যবহার করা হয়েছে।

### ২০২৬-১০-১৩: লোড বাজেট
`js/main.js` এখন service worker registration ডাইনামিকভাবে লোড করে; ঢাকা clock ও integer finance helpers যোগের পরও প্রথম-পেইন্ট মডিউল-সংখ্যা/বাইট বাজেট বজায় থাকে।

### ২০২৬-১০-১৩: পরীক্ষার UI স্পষ্টীকরণ
নতুন পরীক্ষার ফর্মে প্রশ্ন ও অপশন বাধ্যতামূলক shuffle; পুরোনো fixed খসড়া/রেকর্ডের তথ্য অক্ষত। পরীক্ষার নির্দেশনায় একবারের চেষ্টার নিয়ম ও Asia/Dhaka সময় দেখানো হয়।
