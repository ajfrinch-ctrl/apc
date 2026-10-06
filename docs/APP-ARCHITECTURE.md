# APC App Architecture — একক স্থায়ী সোর্স (v172)

> এই নথিটিই APC-এর **একক architecture রেফারেন্স**। এখানে যা লেখা আছে তার বাইরে
> কোনো section-এর ঘর নির্ধারিত নয়। নতুন feature যোগ করার আগে এখানে তার ঘর ঠিক
> করতে হবে; একই feature-এর দ্বিতীয় interface বানানো নিষিদ্ধ।

## ০। নীতি (সব সিদ্ধান্তের ভিত্তি)

1. **যে কাজের যে জায়গা।** প্রতিটি feature-এর ঠিক একটি বাড়ি।
2. **কোনো feature হারায় না।** শুধু menu সরিয়ে feature মরে যেতে পারে না — আগে নতুন ঠিকানা, পরে সরানো।
3. **একই ডেটার একই সোর্স।** UI কেবল বিদ্যমান store পড়ে; সমান্তরাল store বানায় না।
4. **Role-এর কাজ Role-এর প্যানেলে।** অন্য Role-এর panel-এ তার কাজ দেখানো হয় না।
5. **Role-এর দায়িত্ব (চূড়ান্ত):** Teacher `Create → Publish`, Student `Receive → Read/Do → Submit`, Manager `Review → Manage → Approve`, Cash Counter `Collect → Verify → Receipt`, Admin `Control → Monitor → Report`.
6. **ডেটা কখনো মুছি না।** কোনো phase-ই wipe/reset করে না; দরকার হলে migration।

---

## ১। বর্তমান অবস্থার অডিট (v167 কোড অনুযায়ী)

### ১.১ Role ও এন্ট্রি পেজ

| Role | পেজ | সেশন | মন্তব্য |
| --- | --- | --- | --- |
| Student | `index.html` | `active-plus-account-v1` + `js/session.js` | একই পেজে login/registration/recovery |
| Teacher | `teacher.html` | `STAFF_ACCOUNTS.teacher.sessionKey` | আলাদা পোর্টাল |
| Manager | `manager.html` | `STAFF_ACCOUNTS.manager.sessionKey` | আলাদা পোর্টাল |
| Cash Counter | `payment.html` | `STAFF_ACCOUNTS.payment.sessionKey` | আলাদা পোর্টাল |
| Admin | `admin.html` | `STAFF_ACCOUNTS.admin.sessionKey` | আলাদা পোর্টাল |

স্টাফ সাইন-ইন হয় `index.html`-এর শেয়ার্ড কার্ড দিয়ে; প্যানেল শুধু ডিভাইস-বাউন্ড
সেশন পড়ে খোলে (`js/panel-lockdown.js` অন্য প্যানেলের পাতা আটকায়)।

### ১.২ বর্তমান navigation (এটাই যেটা বদলাবে)

| প্যানেল | বর্তমান bottom bar |
| --- | --- |
| Student | হোম · পড়াশোনা · রুটিন · **ফলাফল** · আরও |
| Teacher | হোম · শিক্ষার্থী · উপস্থিতি · পরীক্ষা · আরও |
| Manager | হোম · শিক্ষার্থী · **অনুমোদন** · আরও |
| Cash Counter | (bottom bar নেই) আজকের লেনদেন · রিপোর্ট + sticky টুলবার |
| Admin | ড্যাশবোর্ড · স্টাফ · শিক্ষার্থী · রিপোর্ট · আরও |

### ১.৩ বর্তমান view ও feature-এর বাড়ি

**Student (`index.html`, ৯টি view):** `home`, `courses`, `routine`, `exams`, `results`, `notice-board`, `reports`, `notification-settings`, `profile`
- `courses` = “আমার পড়াশোনা” (chapter hub: read/notes/materials/important/MCQ/short/written/model-test/results) **+** “শিক্ষকের দেওয়া কাজ” (teaching activities, ফিল্টার: সব/পরীক্ষা/বাড়ির কাজ/সাজেশন/রুটিন) — অর্থাৎ পড়াশোনা, বাড়ির কাজ, সাজেশন একই পাতায় মিশে আছে।
- `exams` = অনলাইন পরীক্ষা + অনুশীলন (student-practice) + শিক্ষকের দেওয়া ফলাফল।
- `results` = নিজের ফলাফল (একটি আলাদা nav আইটেম)।
- `notice-board` = Notice Board (বিভাগভিত্তিক), `reports` = নিজের রিপোর্ট PDF, `notification-settings`, `profile` = প্রোফাইল+সেটিংস+লগআউট।

**Teacher (`js/teacher.js` TEACHER_VIEWS):** `home`, `more`, `students`, `online-exams`, `courses`, `classes`, `routine-view`, `reports`, `profile` + activity views (`exam`, `homework`, `suggestion`, `routine`) — বাড়ির কাজ/সাজেশন/নোটিশ আলাদা আলাদা view কিন্তু bottom bar-এ কেবল হোম/শিক্ষার্থী/উপস্থিতি/পরীক্ষা/আরও.

**Manager (`js/manager.js` MANAGER_VIEWS, ১৫টি):** `dashboard`, `students`, `approvals`, `classes`, `teachers`, `finance`, `cash-counter`, `notices`, `routine`, `exams`, `courses`, `results`, `reports`, `profile`, `more`.

**Admin (`admin.html`, ১২টি view):** `dashboard`, `staff`, `students`, `reports`, `more`, `roles`, `data`, `backup`, `security`, `settings`, `academics`, `profile`.

**Cash Counter (`payment.html`):** `data-counter-view="today" | "reports"` + সার্চ/প্রোফাইল/কালেকশন ফর্ম/রসিদ।

### ১.৪ ডেটার বাড়ি (অপরিবর্তিত থাকবে)

| ডেটা | Key / store | সোর্স মডিউল |
| --- | --- | --- |
| শিক্ষার্থী রোস্টার | `keYS.students` → `activePlus.admin.students.v1` | `js/office-data.js` |
| লেনদেন/ফি | `KEYS.transactions` | `js/finance-data.js` |
| নোটিশ | `KEYS.notices` | `js/office-data.js`, `js/notice-center.js` |
| রুটিন | `KEYS.routine` | `js/routine.js` |
| ক্লাস/বিষয়/চ্যাপ্টার | `KEYS.academics` | `js/academics.js` |
| কোর্স কনটেন্ট (পাঠ/নোট/উপকরণ/মডেল টেস্ট) | `KEYS.courseContent` | `js/course-content.js` |
| শিক্ষকের কাজ (বাড়ির কাজ/সাজেশন/নোটিশ/উপস্থিতি) | `key: teaching` | `js/teaching-data.js` |
| প্রশ্নব্যাংক | `QUESTION_BANK_KEY` | `js/question-bank.js` |
| পরীক্ষা + প্রচেষ্টা | `KEYS.exams` (`examDb`) | `js/exam-data.js` |
| MCQ অনুশীলন ইতিহাস | `activePlus.mcqPractice.v1` | `js/course-hub.js` |
| নোটিফিকেশন | `notification-store.js` | `js/notification-store.js` |
| Sync outbox | `activePlus.syncOutbox.v2:*` | `js/record-sync.js` |

### ১.৫ অডিটে ধরা পড়া সমস্যা (এই নথির কারণ)

| # | সমস্যা | প্রমাণ |
| --- | --- | --- |
| P1 | Student-এ ফলাফল একটি আলাদা nav আইটেম — পরীক্ষার সাথে সম্পর্কিত কিন্তু বিচ্ছিন্ন | bottom bar-এ `results` |
| P2 | পড়াশোনা/বাড়ির কাজ/সাজেশন একই পাতায় মিশ্রিত; কোনো section switcher নেই | `coursesView` → `#courseHub` + `#learningFilters` |
| P3 | প্রশ্নব্যাংক Student-এর জন্য কোনো নির্দিষ্ট জায়গা নেই (chapter hub-এর ভিতরে লুকানো) | `course-hub.js` chapter action |
| P4 | উপকরণ (PDF/Image/Doc/Link/Notes) শুধু chapter-ভিত্তিক; এক জায়গায় দেখা যায় না | `course-content.js` sections |
| P5 | Teacher-এর মূল কাজ (বাড়ির কাজ/সাজেশন/প্রশ্ন/উপকরণ) bottom bar-এ নেই; “পরীক্ষা/উপস্থিতি” আছে | teacher bottom bar |
| P6 | Manager-এর bottom bar-এ অনুমোদন আছে, কিন্তু “একাডেমিক”/“হিসাব”/“রিপোর্ট” bar-এ নেই | manager bottom bar |
| P7 | Cash Counter-এর কোনো bottom bar নেই — অন্য প্যানেলের সাথে অসঙ্গত | `payment.html` — ✅ Phase 4-এ সমাধান |
| P8 | Admin-এর bar-এ “শিক্ষার্থী” আছে, যা Admin-এর দায়িত্ব নয় (Student অ্যাকাউন্ট Admin বানাবে না) | admin bottom bar — ✅ Phase 5-এ সমাধান |

---

## ২। চূড়ান্ত Navigation Map (v172 লক্ষ্য)

### Student
`🏠 হোম` · `📚 পড়াশোনা` · `🗓 রুটিন` · `📝 পরীক্ষা` · `👤 আরও`

### Teacher
`🏠 হোম` · `📚 একাডেমিক` · `🗓 রুটিন` · `📊 ফলাফল` · `👤 আরও`

### Manager
`🏠 হোম` · `👨‍🎓 শিক্ষার্থী` · `📚 একাডেমিক` · `💰 হিসাব` · `📊 রিপোর্ট` · `👤 আরও`

### Cash Counter
`🏠 হোম` · `👨‍🎓 শিক্ষার্থী` · `💰 পেমেন্ট` · `📊 রিপোর্ট` · `👤 আরও`

### Admin
`🏠 হোম` · `👥 স্টাফ` · `📊 রিপোর্ট` · `⚙️ সিস্টেম` · `💾 ডেটা` · `👤 অ্যাকাউন্ট`

---

## ৩। Section কম্পোজিশন (প্রতিটি বাড়ির ভিতরের সাজ)

### Student
| Section | ভিতরে কী থাকে | ডেটা সোর্স (নতুন কিছু নয়) |
| --- | --- | --- |
| 🏠 হোম | আজকের ক্লাস · আজকের গুরুত্বপূর্ণ কাজ · আসন্ন পরীক্ষা · নতুন Notice · Study Progress (মোট/সম্পন্ন/বাকি/প্রকাশিত পরীক্ষা) · Quick cards (বাড়ির কাজ · সাজেশন · প্রশ্নব্যাংক · পরীক্ষা · ফলাফল) · সর্বশেষ Notice · দৈনিক Quote | `routine`, `teaching`, `exam-data`, `notice-center`, `daily-quote`, `course-hub` |
| 📚 পড়াশোনা | **আমার কোর্স** (Subject → Chapter → Topic/Notes/Material/Practice/Questions) · **বাড়ির কাজ** (Subject filter, status; date-ভারী নয়) · **সাজেশন** (Subject/Chapter filter; গুরুত্বপূর্ণ প্রশ্ন/Chapter/Exam/Written/MCQ/PDF) · **প্রশ্নব্যাংক** (Subject/Chapter/Type: MCQ/সংক্ষিপ্ত/সৃজনশীল) · **উপকরণ** (PDF/Image/Document/Link/Notes) | `academics`, `course-content`, `teaching`, `question-bank` |
| 🗓 রুটিন | আজকের ক্লাস · সাপ্তাহিক রুটিন · Subject · Teacher · Class Time · Room · Special Class · Cancelled/Rescheduled | `routine`, `teaching(type=routine)` |
| 📝 পরীক্ষা | Tabs: আসন্ন · চলমান · সম্পন্ন · ফলাফল (MCQ/সংক্ষিপ্ত/সৃজনশীল; স্থায়ী Exam ID → Question → Submission → Result) | `exam-data`, `exam-ui` |
| 👤 আরও | প্রোফাইল · আমার রিপোর্ট · নোটিফিকেশন · ফি · সেটিংস · সহায়তা | `profile`, `report-*`, `notification-store`, `finance-data` |

### Teacher
| Section | ভিতরে | 
| --- | --- |
| 🏠 হোম | Quick: +বাড়ির কাজ · +সাজেশন · +প্রশ্ন · +পরীক্ষা; সাম্প্রতিক কাজ: Recent Homework/Suggestion/Exam · Pending approval |
| 📚 একাডেমিক | **বাড়ির কাজ · সাজেশন · প্রশ্নব্যাংক · উপকরণ · পরীক্ষা · নোটিশ** — প্রতিটির workflow: List → + Add → Form → Preview → Publish |
| 🗓 রুটিন | নিজের assigned class/subject/schedule (তৈরি/পরিবর্তন Manager-এর) |
| 📊 ফলাফল | assigned scope-এ Marks Entry → Submit → Correction (Manager approval লাগলে সেখানে যাবে) |
| 👤 আরও | প্রোফাইল · নোটিফিকেশন · শিক্ষার্থী (scope) · সেটিংস · লগআউট |

### Manager
| Section | ভিতরে |
| --- | --- |
| 🏠 হোম | আজকের operational সারসংক্ষেপ + অনুমোদনের অপেক্ষায় |
| 👨‍🎓 শিক্ষার্থী | Pending Registration · Active · Inactive; Profile/Class/Batch/Subject/Contact/Status; Approve · Reject · Edit · Activate · Deactivate · Password Reset |
| 📚 একাডেমিক | বাড়ির কাজ · সাজেশন · প্রশ্নব্যাংক · পরীক্ষা · ফলাফল · রুটিন · নোটিশ · উপকরণ + Teacher management (list/assignment/class/subject/active-inactive) |
| 💰 হিসাব | Fee Collection · Payment Approval · Due · Payment History |
| 📊 রিপোর্ট | Report Center (dropdown → Date/Filter → Generate → Preview → PDF) |
| 👤 আরও | প্রোফাইল · সেটিংস · Session · লগআউট |

### Cash Counter
| Section | ভিতরে |
| --- | --- |
| 🏠 হোম | আজকের কালেকশন সারসংক্ষেপ |
| 👨‍🎓 শিক্ষার্থী | Search → সংক্ষিপ্ত পরিচয় (Academic management নেই) |
| 💰 পেমেন্ট | Payment entry · Verification · Receipt |
| 📊 রিপোর্ট | Daily collection · Payment history |
| 👤 আরও | প্রোফাইল · সেশন · লগআউট |

### Admin
| Section | ভিতরে |
| --- | --- |
| 🏠 হোম | Dashboard (system pulse) |
| 👥 স্টাফ | Manager/Teacher/Cash Counter তৈরি · Edit · Activate · Deactivate · Delete + Role permission matrix |
| 📊 রিপোর্ট | System-wide রিপোর্ট |
| ⚙️ সিস্টেম | System settings · Security (session/password policy) · Sync/Cloud |
| 💾 ডেটা | Backup/Restore · Data management · Storage |
| 👤 অ্যাকাউন্ট | Admin profile · Password · লগআউট |

---

## ৪। Single-source-of-truth ledger (কোন feature কোথায়)

| Feature | একমাত্র বাড়ি | বর্তমান অবস্থা | করণীয় |
| --- | --- | --- | --- |
| অধ্যায়ভিত্তিক পড়া/নোট/উপকরণ/অনুশীলন | Student → পড়াশোনা → আমার কোর্স | `coursesView` (`#courseHub`) | রাখা, section-এর ভিতরে |
| বাড়ির কাজ (Student) | Student → পড়াশোনা → বাড়ির কাজ | `coursesView` ফিল্টার | section-এ উন্নীত |
| সাজেশন (Student) | Student → পড়াশোনা → সাজেশন | `coursesView` ফিল্টার | section-এ উন্নীত |
| প্রশ্নব্যাংক (Student) | Student → পড়াশোনা → প্রশ্নব্যাংক | chapter action-এ লুকানো | নিজস্ব section |
| উপকরণ (Student) | Student → পড়াশোনা → উপকরণ | chapter-ভিত্তিক | section-এ সম сводка |
| অনলাইন পরীক্ষা + ফলাফল | Student → পরীক্ষা (tab) | nav-এ `results` আলাদা | এক জায়গা, ৪ tab |
| Notice Board | Student → হোম (গুরুত্বপূর্ণ) + আরও → নোটিফিকেশন | `notice-board` view | হোমে সারাংশ, পূর্ণ তালিকা One home |
| নিজের রিপোর্ট PDF | Student → আরও → আমার রিপোর্ট | `reportsView` | রাখা |
| ফি (শুধু দেখা) | Student → আরও → ফি | `finance-data` পড়া | নতুন পঠন-পাতা (এন্ট্রি নয়) |
| শিক্ষক: বাড়ির কাজ/সাজেশন/নোটিশ/উপস্থিতি | Teacher → একাডেমিক | `ACTIVITY_TYPES` views | এক ছাতার নিচে |
| শিক্ষক: প্রশ্নব্যাংক | Teacher → একাডেমিক → প্রশ্নব্যাংক | `question-bank.js` staff reader | রাখা |
| শিক্ষক: নম্বর/ফলাফল | Teacher → ফলাফল | `exam` view | nav-এ উন্নীত |
| Manager: অনুমোদন | Manager → শিক্ষার্থী (Pending) | `approvals` view | শিক্ষার্থী section-এ merge |
| Manager: একাডেমিক | Manager → একাডেমিক | `courses`/`exams`/`results`/`routine`/`notices` ছড়ানো | একটি section |
| Manager: হিসাব | Manager → হিসাব | `finance` | rename + রাখা |
| Manager: রিপোর্ট | Manager → রিপোর্ট | `reports` | Report Center |
| Counter: পেমেন্ট | Counter → পেমেন্ট | `today` + ফর্ম | রাখা |
| Counter: রিপোর্ট | Counter → রিপোর্ট | `counter-view="reports"` | রাখা |
| Admin: স্টাফ | Admin → স্টাফ | `staff` view | rename |
| Admin: শিক্ষার্থী | — | `students` view | Admin থেকে সরানো (Manager-এর কাজ) |

---

## ৫। Permission matrix (সংক্ষিপ্ত)

| কাজ | Admin | Manager | Teacher | Counter | Student |
| --- | :-: | :-: | :-: | :-: | :-: |
| স্টাফ তৈরি/নিষ্ক্রিয় | ✅ | — | — | — | — |
| Student অনুমোদন | ✅ | ✅ | — | — | — |
| Student অ্যাকাউন্ট তৈরি | — (নিষিদ্ধ) | ✅ (approve) | — | — | নিজে registration |
| বাড়ির কাজ/সাজেশন/প্রশ্ন তৈরি | — | ✅ (review) | ✅ | — | — |
| পরীক্ষা তৈরি | — | ✅ (approve) | ✅ (draft) | — | — |
| ফলাফল প্রকাশ | — | ✅ | নম্বর দেয় | — | শুধু দেখে |
| Routine তৈরি | ✅ | ✅ | শুধু দেখে | — | শুধু দেখে |
| Payment entry | — | review/approve | — | ✅ | — |
| Fee দেখা | ✅ | ✅ | — | ✅ | শুধু নিজের |
| রিপোর্ট (system) | ✅ | নিজ scope | নিজ scope | নিজ scope | নিজের |

বিস্তারিত রোল-ক্যাপাবিলিটি `js/admin-permissions.js`-এ আছে; এটি সেই সোর্স অপরিবর্তিত রাখে।

---

## ৬। Workflow (চূড়ান্ত)

```
Teacher      : List → + Add → Form → Preview → Publish
Student      : Receive → Read/Do → Submit
Manager      : Review → Manage → Approve/Publish
Cash Counter : Collect → Verify → Receipt
Admin        : Control → Monitor → Report
```

**Notice বনাম Notification** (এক করা নিষিদ্ধ):
- **Notice** = প্রকাশিত ঘোষণা/কনটেন্ট (`KEYS.notices`, বিভাগ: General/Academic/Class/Exam/Fee/Emergency)।
- **Notification** = ঘটনার অ্যালার্ট (`js/notification-store.js`)। Teacher Homework publish করলে → (১) Homework কনটেন্ট তৈরি, (২) Student-এর notification, (৩) notification খুললে সেই content।

---

## ৭। Data relationship (ভাঙা যাবে না)

```
Class → Batch → Subject → Teacher → Content → Student
Exam ID → Questions → Student Submission → Result
```

Student isolation: প্রতিটি Student পাঠ কেবল নিজের `className`/`group` (± login ID) ম্যাচে সীমাবদ্ধ —
`examMatchesStudent`, `publishedForStudent`, `listQuestionsForStudent`, `finance-data`-এর নিজ-সীমা অপরিবর্তিত।

---

## ৮। Sync status

Topbar-এর উপরের বর্ডার রঙই একমাত্র indicator (🟢 synced / 🟡 syncing / 🔴 error / ⚪ idle)।
প্যানেলের সেটিংস → Data → Sync status-এ **কোনো লেখা দেখানো হয় না**, শুধু রঙের ব্যাখ্যা-টেবিল।
বিস্তারিত: `docs/SYNC-INDICATOR-167.md`।

---

### Phase 3 — Manager panel (এই রিলিজে যা হয়েছে)

Manager bottom bar এখন ঠিক **হোম · শিক্ষার্থী · একাডেমিক · হিসাব · রিপোর্ট · আরও** (ছয়টি seat)।
প্রতিটি পুরোনো screen-ই আছে — শুধু তার বাড়ি ঠিক হয়েছে; পুরোনো নাম (`approvals`, `cash-counter`) আগের
bookmark-ও নতুন বাড়িতে নিয়ে যায়:

| Seat | কী থাকে |
| --- | --- |
| 🏠 হোম | আজকের operational সারসংক্ষেপ, অপেক্ষমাণ অনুমোদন, সাম্প্রতিক activity, ৮টি shortcut |
| 👨‍🎓 শিক্ষার্থী | **নিবন্ধন অপেক্ষমাণ · সক্রিয় · নিষ্ক্রিয় · বাতিল** filter + search; Approve · Reject · Edit · Activate · Deactivate · Password Reset — সবই **এক roster record**, অনুমোদন তালিকা এই screen-এরই অংশ |
| 📚 একাডেমিক | এক hub, ৮টি কার্ড: বাড়ির কাজ · সাজেশন · প্রশ্নব্যাংক · উপকরণ · পরীক্ষা · ফলাফল · রুটিন · নোটিশ + **শিক্ষক ব্যবস্থাপনা** |
| 💰 হিসাব | ৪টি বিভাগ: **আদায় · পেমেন্ট অনুমোদন · বকেয়া · পেমেন্ট ইতিহাস** — সবই একই ledger |
| 📊 রিপোর্ট | Report Center (dropdown → Date/Filter → Generate → Preview → PDF) |
| 👤 আরও | ক্লাস ও ব্যাচ · ম্যানেজার প্রোফাইল · লগআউট |

- **এক জায়গা, এক interface:** প্রশ্নব্যাংক/পরীক্ষা সেই একই examination workspace (`js/exam-manager.js`),
  উপকরণ সেই একই course editor — hub-কার্ড শুধু `open(...)` দিয়ে সেখানে নিয়ে যায়।
- **বাড়ির কাজ/সাজেশন পর্যালোচনা:** শিক্ষকের লেখা `teaching` record-ই Manager-এর “একাডেমিক কাজ” screen-এ
  পড়া হয় (ধরন/শ্রেণি filter) — সংশোধন করেন শিক্ষক নিজেই, তাই এক লেখক ও এক রেকর্ড।
- **শিক্ষার্থীর জীবনচক্র:** Deactivate = roster status `inactive` → ওই শিক্ষার্থীর ডিভাইস-অ্যাকাউন্টও
  `inactive` হয় (`syncAccountStatus`), আর `js/main.js`-এর গেট তখন অ্যাপ বন্ধ রাখে। বাতিল (rejected) আর
  নিষ্ক্রিয় (inactive) আলাদা অবস্থা। ফি/ফলাফল/উপস্থিতির কোনো ইতিহাস মুছে যায় না।
- **নোটিশ:** Manager-ও এখন শ্রেণি/ব্যাচ বেছে নোটিশ দেন; রেকর্ড Teacher-এর মতোই একই shape
  (`className`/`group`/`createdBy`/`createdByRole`), তাই `js/notification-rules.js`-এর একই নিয়মে
  শিক্ষার্থীর board-এ পৌঁছায়। শ্রেণি না দিলে আগের মতোই সবার কাছে।

### Phase 4 — Cash Counter panel (এই রিলিজে যা হয়েছে)

কাউন্টারের bottom bar এখন ঠিক **হোম · শিক্ষার্থী · পেমেন্ট · রিপোর্ট · আরও** (পাঁচটি seat; মাঝের
`পেমেন্ট`-ই উঁচু action)। কাউন্টারের কাজ যেমন, seat-ও তেমন — একটি seat, একটি ধাপ, কোনো কাজ দুই জায়গায় নয়:

| Seat | ধাপ | কী থাকে |
| --- | --- | --- |
| 🏠 হোম | daily collection | **আজকের লেনদেন** (নিজের কাউন্টারের আজকের সারি, সারিতে ট্যাপ করলে রসিদ) + `আজকের ক্লোজিং` shortcut + `নতুন পেমেন্ট নিন` |
| 👤 শিক্ষার্থী | search → verify | শুধু পরিচয়-সার্চ (নাম/ID/রোল) → **নির্বাচিত শিক্ষার্থী** brief → `পেমেন্ট নিন` |
| 💳 পেমেন্ট | entry → receipt | একটাই এন্ট্রি ফর্ম (টাকা/ধরন/মাস/মাধ্যম/রেফারেন্স); সংরক্ষণে অস্থায়ী স্লিপ (pending) খোলে |
| 📊 রিপোর্ট | history | কাউন্টারের ২০টি ফি/ক্যাশ রিপোর্ট (দৈনিক, ক্লোজিং, বকেয়া, ইতিহাস…) — আগের মতোই একই report centre |
| ⋯ আরও | session | কাউন্টারের নিজের পরিচয়, ডিভাইস-বাউন্ড সেশন, সংরক্ষণ ও লগআউট |

- **স্লিপ → daily collection:** পেমেন্ট সংরক্ষণের পর রসিদ বন্ধ করলেই কাউন্টার ফিরে আসে **আজকের লেনদেনে**,
  যেখানে নতুন সারিটা সবেমেই দেখা যায়। রসিদ সবসময় একই রেকর্ড থেকেই তৈরি।
- **প্রাইভেসি অপরিবর্তিত:** শিক্ষার্থী সার্চে বকেয়া, শ্রেণি, ঠিকানা বা ফোন দেখানো হয় না; `js/payment.js`
  এখনো কোনো roster/dues/profile পড়ে না, কোনো academic কিছু লেখে না, কোনো অনুমোদনও করে না — অনুমোদন
  কেবল Manager-এর `হিসাব → পেমেন্ট অনুমোদন`-এ।
- **নোটিফিকেশন → কনটেন্ট:** কাউন্টারের `payment-rejected` নোটিফিকেশনে ট্যাপ করলে সেই লেনদেনের নিজের
  স্লিপ খোলে (`apc-notification-action`), তাই কারণ-সহ এন্ট্রিটাই সামনে আসে।
- **কোনো dashboard ফিরছে না:** pulse/keypad/sticky-bar/due-students/আজকের-টাকার tile এখনো নেই —
  দিনের হিসাব আসে রিপোর্ট থেকেই (`দৈনিক কাউন্টার সংগ্রহ`, `কাউন্টার ক্লোজিং`)।

### Phase 5 — Admin panel (এই রিলিজে যা হয়েছে)

Admin-এর bottom bar এখন ঠিক **হোম · স্টাফ · রিপোর্ট · সিস্টেম · ডেটা · অ্যাকাউন্ট** (ছয়টি seat)।
আগের ছড়ানো “আরও” মেনু তুলে দিয়ে কাজ দুটি hub-এ ভাগ করা হয়েছে, আর প্রতিটি hub-কার্ড সেই screen-ই
খোলে যেটি আগে থেকেই ওই কাজের মালিক:

| Seat | ভিতরে |
| --- | --- |
| 🏠 হোম | সিস্টেম ড্যাশবোর্ড (৪ snapshot tile + ৯টি service card, `নিবন্ধন অনুমোদন`-সহ) |
| 👥 স্টাফ | Manager/Teacher/Cash Counter তৈরি · Edit · Activate · Deactivate · Delete + রয়্যালটি-ম্যাট্রিক্স |
| 📊 রিপোর্ট | System-wide Report Center (`#adminReports`) |
| ⚙️ সিস্টেম | hub: Roles & Permissions · সিকিউরিটি · সিস্টেম সেটিংস · ক্লাস ও বিষয় |
| 💾 ডেটা | Data Management + hub-কার্ড **ব্যাকআপ ও রিস্টোর** |
| 👤 অ্যাকাউন্ট | Admin প্রোফাইল · পাসওয়ার্ড · থিম · লগআউট (topbar-এর exit সব সময় উপস্থিত) |

- **Admin শিক্ষার্থী অ্যাকাউন্ট বানায় না:** শিক্ষার্থী নিজে নিবন্ধন করে, আর Admin/Manager কেবল
  `নিবন্ধন অনুমোদন`-এ সিদ্ধান্ত দেয় (owner decision 2026-09-30 অপরিবর্তিত)। সেই review screen হোমের
  tile থেকে খোলে, তাই শিক্ষার্থী আর Admin-এর একটি nav seat নয় — কিন্তু সুবিধা হারায়নি।
- **হিসাব/রুটিন/নোটিশ/পরীক্ষা Admin-এর প্যানেলে নেই:** ফি আদায়, রুটিন, নোটিশ, পরীক্ষা প্রকাশ —
  প্রতিটি সেই রোলের নিজের প্যানেলে (Manager/Teacher/Cash Counter)। এই রিলিজে কোনো প্রতিলিপি তৈরি হয়নি।
- **Seat হাইলাইট:** hub-এর ভিতরের screen খোলা থাকলে hub-এর seat-ই lit থাকে (`VIEW_SEAT`) — যেমন
  সিকিউরিটি খুললে সিস্টেম, ব্যাকআপ খুললে ডেটা, নিবন্ধন অনুমোদন খুললে হোম।
- **একটাই ডেটা পথ:** স্টাফ CRUD `js/staff-auth.js` + `js/staff-directory.js`, ডেটা/ব্যাকআপ
  `js/admin-data.js` + `js/backup-merge.js`; কোনো নতুন store বা দ্বিতীয় তালিকা যোগ হয়নি।

## ৯। Phase পরিকল্পনা (স্ট্যাটাসসহ)

| Phase | কাজ | স্ট্যাটাস |
| --- | --- | --- |
| **1a** | Student nav: `হোম / পড়াশোনা / রুটিন / পরীক্ষা / আরও`; ফলাফল পরীক্ষার ভিতরে, nav থেকে সরানো | ✅ এই রিলিজে |
| **1b** | Student `পড়াশোনা` → ৫টি section (আমার কোর্স / বাড়ির কাজ / সাজেশন / প্রশ্নব্যাংক / উপকরণ) + পরীক্ষা view-তে ৪ tab | ✅ এই রিলিজে |
| 2 | Teacher: `একাডেমিক` ছাতার নিচে বাড়ির কাজ/সাজেশন/প্রশ্নব্যাংক/উপকরণ/পরীক্ষা/নোটিশ + হোম-এ Quick actions, nav-এ ফলাফল | ✅ এই রিলিজে |
| 3 | Manager: `শিক্ষার্থী` (অনুমোদন merge) · `একাডেমিক` · `হিসাব` · `রিপোর্ট` — nav ষষ্ঠ আইটেমসহ | ✅ এই রিলিজে |
| 4 | Cash Counter: ৫-আইটেম bottom bar (হোম/শিক্ষার্থী/পেমেন্ট/রিপোর্ট/আরও) | ✅ এই রিলিজে |
| 5 | Admin: `স্টাফ / রিপোর্ট / সিস্টেম / ডেটা / অ্যাকাউন্ট`; শিক্ষার্থী view সরানো | ✅ এই রিলিজে |
| 6 | সব Role-এর Settings এক কাঠামো (Account/Notification/App/Security/Data) | পরবর্তী |
| 7 | প্রতিটি Role-এ E2E QA (Teacher→Student ৯টি workflow) | ✅ এই রিলিজে — `tests/workflows-e2e.test.mjs` ৭টি + `tests/registration-approval-login.test.mjs` (Manager approval workflow) |

প্রতিটি phase-এ নিয়ম এক: **আগে feature-এর নতুন বাড়ি নিশ্চিত, তারপর পুরোনো menu সরানো** — এবং
`tests/app-architecture.test.mjs` প্রমাণ করে কোনো view/feature হারায়নি।

### Phase 2 — Teacher panel (এই রিলিজে যা হয়েছে)

Teacher panel-এর bottom bar এখন ঠিক **হোম · একাডেমিক · রুটিন · ফলাফল · আরও** — কোনো আইটেম যোগ হয়নি,
শুধু কাজের বাড়ি ঠিক হয়েছে। প্রতিটি পুরোনো screen অপরিবর্তিত, শুধু এক জায়গা থেকে খোলে:

| Seat | কী থাকে | কোথা থেকে খোলে |
| --- | --- | --- |
| 🏠 হোম | ৪টি Quick action (`+ বাড়ির কাজ`, `+ সাজেশন`, `+ প্রশ্ন`, `+ পরীক্ষা`) + সাম্প্রতিক কাজ + pending | `#teacherQuickActions` |
| 📚 একাডেমিক | ৬টি কার্ড: বাড়ির কাজ · সাজেশন · প্রশ্নব্যাংক · উপকরণ · পরীক্ষা · নোটিশ | `#teacherAcademic` → পুরোনো screen-ই |
| 🗓 রুটিন | Manager-এর বানানো রুটিন — **view-only**, সঙ্গে “উপস্থিতি খুলুন →” | `#teacherRoutine` |
| 📊 ফলাফল | ক্লাস টেস্টের নম্বর/ফলাফল নথি + অনলাইন পরীক্ষার workspace-এ deep link | `teacherRecords` (type `exam`) + `#teacherOnlineExams` |
| 👤 আরও | শিক্ষার্থী · আমার ক্লাস · রিপোর্ট · আমার প্রোফাইল — একাডেমিক কিছুই এখানে নেই | `#teacherMore` |

- **এক জায়গা, এক interface:** প্রশ্নব্যাংক/পরীক্ষা `js/exam-manager.js`-এর একই workspace;
  হাব-কার্ড শুধু `open('bank'|'exams'|…)` দিয়ে সেই screen-এ যায় — দ্বিতীয় copy নেই।
- **Nav dot:** pending কাজ যার, dot তার seat-এ — উপস্থিতি → রুটিন, নম্বর → ফলাফল, বাকি academic কাজ → একাডেমিক;
  একাডেমিক হাবের কার্ড বাকি সংখ্যা দেখায় (`[data-academic-count]`)।
- **নোটিশ স্রোত:** Teacher লেখেন একাডেমিক → নোটিশ → `+ নোটিশ`, রেকর্ডটি `js/office-data.js`-এর সেই একই
  store-এ যায় যা Student board পড়ে; শ্রেণি/ব্যাচ নির্বাচন করলে `js/notification-rules.js`-এর
  `noticeScopeMatches` শুধু সেই শ্রেণিকেই দেখায়, আর শ্রেণি না দিলে আগের মতোই সবার কাছে পৌঁছায় (কোনো ডেটা হারায় না)।
- **একই প্রতিরক্ষা:** `js/teacher.js`-এর `renderAcademic()` কখনো session-নির্ভর writer ডাকে না — রঙ/সংখ্যা
  পড়ে শুধু সেই store থেকেই যা section নিজে দেখায়।

### §38 End-to-End প্রমাণ (এই রিলিজে চালানো)

`tests/workflows-e2e.test.mjs` আসল repository আর আসল login দিয়ে দুটি Role-এর হাতবদল চালায় —
স্টাফ panel-এ লেখা হয়, শিক্ষার্থীর ফোনে সেই ডেটাই দেখা যায়:

| # | Workflow | Test |
| --- | --- | --- |
| 1 | Teacher → বাড়ির কাজ → Student | `workflow 1` |
| 2 | Teacher → সাজেশন → Student | `workflow 2` |
| 3 | Question Bank → Student প্রশ্নব্যাংক | `workflow 3` |
| 4 | Exam → Student পরীক্ষা (সিটিং) | `workflow 4 + 5` |
| 5 | Student → ফলাফল (Manager প্রকাশের পর) | `workflow 4 + 5` |
| 6 | Manager → Student অনুমোদন → Student login | `registration-approval-login.test.mjs` |
| 7 | Cash Counter → Payment → Student ফি | `workflow 7` |
| 8 | Teacher/Manager → নোটিশ (শ্রেণি/ব্যাচ) → Student Board/Notification | `workflow 8` |
| 9 | Manager → Routine → Student রুটিন | `workflow 9` |

সঙ্গে দুটি ছোট source সংশোধন এই রিলিজে ধরা পড়েছে: সফল refresh আর stale পরীক্ষা-ত্রুটি বার্তা
ছাড়ে না (`js/student-exams.js`), এবং প্রশ্নব্যাংক sign-in-এর আগে লোড ব্যর্থ হলে section খোলার
সময় আবার চেষ্টা করে (`js/student-study-sections.js`)।
