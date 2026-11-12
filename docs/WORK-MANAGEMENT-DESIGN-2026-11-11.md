# Universal Teacher Work Management System — Design & Implementation Plan

Branch: `arena/3bad369c-apc` · Date: 2026-11-11
Companion audit: `docs/WORK-MANAGEMENT-AUDIT-2026-11-11.md`

> Phase 4 (the additive workspace) is implemented on this branch and passing.
> Merge, deployment, data migration and rules changes are **not** performed and
> await the approvals listed in §9 of the audit.

---

## 1. The one principle

**একটি প্রবেশপথ → কাজের ধরন → প্রয়োজনীয় তথ্য → Preview → Draft/Publish/Approval
→ Student Panel-এর সঠিক জায়গা।**

The central layer owns *navigation, scope selection, policy display and
hand-off*. It does **not** own a second copy of any form or any record.

---

## 2. Where it lives

The bottom navigation already has a "কাজ" seat whose route is `classes`. That
route is now the central work workspace (no new bottom-nav seat, no orphan
route, no broken deep link):

```
Teacher Panel
│
├── হোম            → কাজ-কেন্দ্রিক লঞ্চার                 ← redesigned 2026-11-11
│     ├── নতুন কাজ তৈরি করুন        (#work-new)            one primary entry
│     ├── আমার প্রকাশিত কাজ         (#work-published)
│     ├── শিক্ষার্থীদের কার্যক্রম     (#work-activity)
│     ├── আজকের ক্লাস ও রুটিন        (#routine-view, read-only)
│     └── আজকের ক্লাসের সারাংশ (আগের মতোই)
├── কাজ (#classes) → কেন্দ্রীয় Work Management            ← the centre
│     ├── নতুন কাজ                 (#work-new)
│     ├── আমার প্রকাশিত কাজ        (#work-published)
│     ├── শিক্ষার্থীদের কার্যক্রম    (#work-activity)
│     └── আমার ক্লাস               (default, existing class list + routine door)
├── একাডেমিক       → resource hub only (no creation doors)
│     └── কাজ প্যানেলে যান · প্রশ্নব্যাংক/পরীক্ষা · লেকচার শিট · রিপোর্ট · রুটিন
└── আরও            → একাডেমিক ও শ্রেণি (একাডেমিক হাব · শ্রেণি চ্যাট)
                      + রিপোর্ট, প্রোফাইল, সেটিংস
```

**Navigation decision (owner, 2026-11-11).** Both duplicates were removed:
* Home's two feature-hub cards and three old shortcuts are replaced by one
  primary work entry plus three work cards; the old five-door launcher is gone.
* The Academic hub no longer creates anything — its seven creation doors were
  removed. It keeps one door to the work panel and four resource doors.
* The Academic hub and class chat moved into **আরও**, so Home is the single
  work entry point and no case has two creation paths.
* Every legacy route stays alive (`#homework`, `#suggestion`, `#notice`,
  `#online-exams`, `#courses`, …): old bookmarks, deep links and the Manager's
  cross-links keep working; only the *buttons* moved.

Why not a new tab/route name: `staff-navigation.js` maps the five staff seats to
existing panel routes, and `teacher.html`'s nav contract, deep links and tests
all name `classes`. Reusing the seat keeps every inbound link working while
giving the feature its own three deep links (`#work-new`,
`#work-published`, `#work-activity`).

### Files

| File | Role |
|---|---|
| `js/work-registry.js` (new) | the Feature Registry + policy helpers; pure data, no DOM, no writes |
| `js/work-management.js` (new) | the workspace UI: four parts, wizard, lists, hand-off events |
| `css/work-management.css` (new) | panel-scoped styles (loaded before the Tailwind build) |
| `teacher.html` | one mount point + the class pane wrapper + one stylesheet link |
| `js/teacher.js` | mounts the workspace, supplies data + hand-offs, adds 3 routes |
| `sw.js` | precaches the two new modules (offline-first contract) |
| `tests/work-registry.test.mjs` | registry contract |
| `tests/work-management.test.mjs` | workspace behaviour on the real page |

---

## 3. UI specification

### 3.1 The work screen (default = আমার ক্লাস)

```
┌──────────────────────────────────────────────────────────┐
│  ক্লাস ও পাঠদান                                          │
│  (existing compact hero + daily advice)                  │
├──────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────┐  │
│  │  ＋  নতুন কাজ তৈরি করুন                            │  │  ← one primary entry
│  │     বিভাগ → ফিচার → শ্রেণি/বিষয় → প্রিভিউ → প্রকাশ │  │
│  └────────────────────────────────────────────────────┘  │
│  [১৪ ধরনের কাজ]  [পরীক্ষা: অনুমোদন লাগবে]                 │
├──────────────────────────────────────────────────────────┤
│ নতুন কাজ │ আমার প্রকাশিত কাজ │ শিক্ষার্থীদের কার্যক্রম │ আমার ক্লাস │
├──────────────────────────────────────────────────────────┤
│  (active pane)                                           │
└──────────────────────────────────────────────────────────┘
```

* Default pane = **আমার ক্লাস**, so the existing class list and the
  routine door keep their original position and the panel's documented
  behaviour is unchanged on arrival.
* Arriving from Home's "নতুন কাজ তৈরি করুন" opens the **নতুন কাজ** pane
  (`#work-new`); Home's other two cards open their own panes. A data refresh
  never moves the teacher to another pane.
* The create entry is a full-width card, always first, always visible.
* Tabs are real `role="tablist"` / `role="tabpanel"` pairs, each with a count.
* Panes are removed from the focus order when hidden (`[hidden]`
  + `display:none`).
* Mobile: tab labels shrink, counts hide under 420px, all targets ≥ 44px.
* Every action has a Bengali accessible name; icons are decorative.
* No gradients/glass outside the existing token vocabulary; reduced-motion
  honoured.

### 3.2 The create wizard (new pane)

Four steps, never more, and a step is skipped when the feature does not need it:

1. **কাজের বিভাগ** — five cards (পড়াশোনা, পরীক্ষা, ফলাফল ও অগ্রগতি, যোগাযোগ,
   ক্লাস ও উপস্থিতি) with the number of creatable features.
2. **ফিচার** — every feature in that category, each card showing
   “সরাসরি প্রকাশ” or “অনুমোদন লাগবে”; Manager-owned features are visibly
   read-only.
3. **শ্রেণি ও বিষয়** — class/group/subject selects built only from the
   teacher's assignments; audience = whole class/group or specific students.
   Fields the feature does not require are not rendered.
4. **প্রিভিউ ও প্রকাশ** — a summary (feature, scope, audience, Student Panel
   destination, approval policy, repository to be written), an optional
   read-only student-view preview, blocking reasons, and the separated actions:
   * **খসড়া হিসেবে সংরক্ষণ**
   * **প্রকাশ করুন** (direct-policy features only)
   * **অনুমোদনের জন্য পাঠান** (approval-policy features)
   * **প্রিভিউ দেখুন**

The wizard never writes. Tests assert `localStorage` is byte-identical after
category → feature → scope → preview.

### 3.3 আমার প্রকাশিত কাজ

* Summary strip: প্রকাশিত / খসড়া ও ফেরত / অনুমোদনের অপেক্ষায়.
* Filters: সব · খসড়া · অনুমোদনের অপেক্ষায় · প্রকাশিত · ফিরিয়ে দেওয়া · আর্কাইভ.
* Cards come from the real stores: teaching activities, exams (7 statuses),
  own notices, published course content. Each card names its Student Panel
  destination and opens its owning screen — editing a record opens the same
  id, never a copy.
* Status vocabulary is the union of what the stores already use; nothing is
  rewritten, nothing is migrated.

### 3.4 শিক্ষার্থীদের কার্যক্রম

* Homework submissions (student name, activity, done/reviewed) derived from
  `teaching.progress`.
* Attendance totals (present/absent/late) derived from `routine` activities.
* Exam participation and status from `examRepository` + attempts.
* Practice: an explicit, honest note that practice attempts live on the
  student device and are not visible to staff (audit M3) — no fake panel.

### 3.5 হোম, একাডেমিক ও আরও (2026-11-11 পুনর্বিন্যাস)

| Screen | Now | Rules |
|---|---|---|
| **হোম** | এক প্রধান দরজা “নতুন কাজ তৈরি করুন” (`#work-new`) + তিনটি সংক্ষিপ্ত কার্ড (প্রকাশিত কাজ, শিক্ষার্থী কার্যক্রম, আজকের ক্লাস/রুটিন) + আজকের ক্লাসের সারাংশ | কোনো তৈরি-ফর্ম হোমে খোলে না; একাডেমিক হাব ও শ্রেণি চ্যাট হোমে নেই; তিনটি কার্ডেই **বাস্তব কাউন্ট** — সংখ্যা `workUi.counts()`-এর একই সূত্র থেকে, শূন্য হলে চিপ লুকানো |
| **একাডেমিক** | “কাজ প্যানেলে যান” + চারটি রিসোর্স দরজা (প্রশ্নব্যাংক/পরীক্ষা, লেকচার শিট ও উপকরণ, ফলাফল ও রিপোর্ট, রুটিন) | কাজ তৈরির দরজা শূন্য; আগের সাতটি দরজা বাদ |
| **আরও** | নতুন গ্রুপ **একাডেমিক ও শ্রেণি**: একাডেমিক কার্যক্রম · শ্রেণি চ্যাট · নোটিশ বোর্ড — তারপর রিপোর্ট, প্রোফাইল, সেটিংস | নোটিশ বোর্ড এখানে *দেখার/সম্পাদনার* দরজা; নতুন নোটিশ কেন্দ্রীয় কাজ-প্যানেল থেকেও তৈরি হয় |

* সব দরজা আসল `<button>` + `data-panel-view`; রুট বদলায় `setView`, তাই hash,
  Back এবং deep link আগের মতোই কাজ করে।
* `data-panel-entry` (`notice` · `lecture` · `chat` · `report`) চার-প্যানেল
  এন্ট্রি-চুক্তি ধরে রাখে; লেকচার দরজায় `data-cap="content.lecture-sheets"`
  থাকায় capability gate আগের মতোই লুকায় **এবং** নিষ্ক্রিয় করে।
* রিমুভ করা শুধু *বাটন* — রুট নয়। `#homework`, `#suggestion`, `#notice`,
  `#courses`, `#online-exams` সবই প্রথম শ্রেণির ভিউ হিসেবে আছে
  (`tests/semantic-icons.test.mjs` রুট-টেবিলে তা যাচাই করে)।

### 3.6 আমার ক্লাস

The existing markup is preserved verbatim inside
`<div id="teacherClassPane" data-work-pane="classes">`: the class list
renderer (`renderTeacherClasses`), the "আমার ক্লাস ও বিষয়" and
"রুটিন ও সময়সূচি" doors, and the class panel. No second renderer, no copied
data.

---

## 4. Workflow

```
                     ┌──────────────────────────────┐
                     │  নতুন কাজ তৈরি করুন           │
                     └───────────────┬──────────────┘
                                     ▼
                     ┌──────────────────────────────┐
                     │ ১. বিভাগ (Study/Exam/...)     │  registry: category
                     └───────────────┬──────────────┘
                                     ▼
                     ┌──────────────────────────────┐
                     │ ২. ফিচার                      │  registry: feature
                     └───────────────┬──────────────┘
                                     ▼
             ┌───────────────────────────────────────────┐
             │ ৩. শ্রেণি → বিষয় → বিভাগ → কারা পাবে     │  assignment-scoped
             └───────────────────────┬───────────────────┘
                                     ▼
                     ┌──────────────────────────────┐
                     │ ৪. Preview + Policy          │  planWork()
                     └───────┬──────────────┬───────┘
                             │              │
              DIRECT policy  │              │  ADMIN/MANAGER policy
                             ▼              ▼
                    ┌──────────────┐  ┌───────────────────────┐
                    │ Draft/Publish│  │ Draft → অনুমোদনের জন্য │
                    └──────┬───────┘  │ পাঠান                  │
                           │          └───────────┬───────────┘
                           │                      ▼
                           │          ┌───────────────────────┐
                           │          │ Admin/Manager review  │
                           │          │ approve → publish     │
                           │          │ reject  → teacher edit│
                           │          └───────────┬───────────┘
                           ▼                      ▼
        ┌─────────────────────────────────────────────────────┐
        │ হ্যান্ডঅফ → বিদ্যমান এডিটর (একই রেকর্ড, একই স্টোর)   │
        └──────────────────────────┬──────────────────────────┘
                                   ▼
        ┌─────────────────────────────────────────────────────┐
        │ Student Panel destination (নিচের ম্যাপিং)            │
        └─────────────────────────────────────────────────────┘
```

Hand-off map (all real, all pre-existing):

| Hand-off | Opens | Pre-filled |
|---|---|---|
| `activity-create` (homework/suggestion) | `#homework` / `#suggestion` routed editor | class, group, subject, status |
| `notice` | `#notice` notice composer | class, group, status |
| `online-exams` | exam workspace (builder, bank, approval) | scope guidance |
| `exam` | marks lane of the exam seat | scope guidance |
| `lecture-sheets` | lecture-sheet studio | teacher scope |
| `courses` | course content editor | class/subject context |
| `routine-view` | routine + attendance sessions | — |
| `class-chat` | chat room | — |

---

## 5. Permission matrix

Legend: ✅ = allowed in the current code · ⛔ = refused · 👁 = read-only.

### 5.1 Teacher, by feature

| Feature | Create | Edit | Publish | Approval | Enforced where |
|---|---|---|---|---|---|
| Homework / Suggestion | ✅ assigned class+subject | ✅ own record | ✅ | — | `teaching-data.js` |
| Lecture sheet / Note / Material / Important / Model test / Assignment | ✅ assigned | ✅ own | ✅ | — | `course-content.js` |
| Question bank | ✅ assigned subject | ✅ | ✅ (active) | — | `question-bank.js` |
| Online exam | ✅ draft | ✅ draft/pending/rejected | ⛔ | Admin/Manager | `exam-data.js` |
| Exam marks / results | ✅ entry | ✅ with audit | ⛔ | Admin/Manager | `exam-data.js` |
| Notice | ✅ assigned class | ✅ own | ✅ | direct (policy tbd) | `office-data.js` + `teacher.js` |
| Class chat message | ✅ assigned room | ⛔ | ✅ send | — | `class-chat.js` |
| Attendance | ✅ assigned class | ✅ ≤ 7 days | ✅ | — | `teaching-data.js` |
| Class routine | ⛔ | ⛔ | ⛔ | Manager | `office-data.js` |
| Course / chapter | ⛔ | ⛔ | ⛔ | Manager | `course-content.js` |
| Student password / settings / profile / fees | ⛔ | ⛔ | ⛔ | Student / Payment | their own modules |

### 5.2 Role × capability

| Capability | Admin | Manager | Teacher | Payment | Student |
|---|---|---|---|---|---|
| Academic content (homework/suggestion/notes/sheet/material) | ✅ | ✅ | ✅ assigned | ⛔ | 👁 published |
| Question bank | ✅ | ✅ | ✅ assigned | ⛔ | 👁 active, class/batch |
| Exam draft | ✅ | ✅ | ✅ assigned | ⛔ | 👁 published |
| Exam approve / publish | ✅ | ✅ | ⛔ | ⛔ | 👁 |
| Marks entry | ✅ | ✅ | ✅ assigned | ⛔ | 👁 own result |
| Notice | ✅ | ✅ | ✅ assigned | ⛔ | 👁 own class |
| Class chat | ✅ | ✅ | ✅ assigned | ⛔ | ✅ own class |
| Attendance | ✅ | ✅ correct old | ✅ own, ≤7 days | ⛔ | 👁 own |
| Official routine | ✅ | ✅ | 👁 | ⛔ | 👁 |
| Staff & permissions | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| Fees / payments | ✅ | ✅ | ⛔ | ✅ | 👁 own |
| Own profile & settings | — | — | ✅ own | ✅ own | ✅ own |

The registry can only narrow this matrix, never widen it: `teacherCan()` reads
the same flags, and the repository gates above remain the actual enforcement
points. The audit's H1/H2 finding (rules do not enforce it yet) is unchanged by
this design and is called out for approval.

---

## 6. Feature Registry contract

Each entry carries the sixteen fields the brief requires:

`id · category · name · requiredFields · optionalFields · classRequirement ·
subjectRequirement · groupRequirement · audience · form.component/handoff ·
store.key/path/repository · permission{create,edit,publish,requiresAssignment} ·
approval · publishAction · student.view/panel · validation · tests`.

`validateWorkRegistry()` fails the build if any is missing, if the category or
owner is unknown, if a field id is undeclared, if the publish status is not a
real store status, if the Student view is not declared, or if a read-only
feature claims direct publishing. The registry currently declares **16
features across 5 categories** (14 teacher-creatable, 2 Manager-owned
read-only).

---

## 7. Implementation plan and status

| Phase | Deliverable | Status |
|---|---|---|
| 1 — Audit | inventory, data flow, permission, rules, tests | **done** (audit doc) |
| 2 — Design | this spec: UI, workflow, matrix, registry | **done** |
| 3 — Plan | reuse / adapter / incomplete classification | **done** (audit §7) |
| 4 — Implementation | registry + workspace + hand-offs + deep links | **done, additive** |
| 5 — Testing | unit, DOM, permission, offline/cascade, full regression | **done** for the new surface; security-rule simulation pending approval |
| 6 — Review | feature-by-feature Student Panel check | checklist below; owner sign-off pending |
| 7 — Deployment | merge/deploy | **not started — approval required** |

### Implementation steps that were executed

1. Declared the registry with real paths and policies (`work-registry.js`).
2. Built the four-part workspace and the four-step wizard with no writes
   (`work-management.js`).
3. Wrapped the existing class screen content in `#teacherClassPane` and added
   the mount point (`teacher.html`) — no markup deleted.
4. Mounted the workspace, added the three deep-link routes, fed it the real
   repositories, and implemented the hand-off + pre-fill + item-open handlers
   (`teacher.js`).
5. Added the scoped stylesheet and registered it in the page's scoped-sheet
   allowlist (`tools/css-order-check.mjs`, `tests/color-icons.test.mjs`).
6. Added the two modules to the offline precache (`sw.js`).
7. Added the registry and DOM test suites.

### Not touched (deliberately)

* `database.rules.json`, `firestore.rules`, `database.rules.v2.draft.json`.
* Every repository and every stored schema/status.
* Session, panel lockdown, capability gate, staff navigation, sync engine.
* Student markup, routes or data access.
* Existing home/nav doors and their tests (except the scoped-sheet allowlist).

---

## 8. Acceptance criteria → evidence

| Brief's criterion | Evidence |
|---|---|
| Teacher works only within assigned class/subject | `planWork` refusals + `scopeWithinAssignment` tests; repository gates unchanged |
| Other class's data cannot be changed | same + existing `tests/teaching.test.mjs`, `teacher-identity-scope.test.mjs` |
| Student sees only own class's approved data | existing `student-*` suites; registry maps destinations only |
| Draft never reaches the Student Panel | status flags untouched; workspace lists but never publishes drafts |
| Approval-gated work cannot publish early | exam UI offers no publish action; `tests/exam-approval-flow.test.mjs` |
| Publish lands in the right Student Panel section | registry destination + `work-registry.test.mjs` view existence check |
| Edit updates the same record, no duplicate | `work-management.test.mjs` “same record” test (count unchanged) |
| Delete/Archive stays safe | untouched owner workflows (`deleteActivity`, `archiveCourseRecord`, exam archive) |
| Offline and sync behave | no new storage; existing sync suites; precache updated |
| Old data and old Student activity survive | no migration, no rewrite |
| Mobile and desktop | CSS breakpoints at 380/420px, targets ≥44px, no horizontal overflow (same shell); the new home/academic markup reuses the compiled card classes, so no new CSS path is introduced |
| Security rules block unauthorised writes | **not yet true on the live v1 path** — the strict v2 rule set exists and is emulator-tested but not activated (audit H1/H2, §5.3) |

---

## 9. Review checklist (Phase 6, for owner sign-off)

For each row, create from the workspace and confirm the Student Panel:

- [ ] Homework → পড়াশোনা → বাড়ির কাজ → appears, deadline, details.
- [ ] Suggestion → পড়াশোনা → সাজেশন → appears with subject filter.
- [ ] Lecture sheet → পড়াশোনা → উপকরণ → PDF opens.
- [ ] Class note → ক্লাস → ক্লাস নোট → appears.
- [ ] Material/PDF → পড়াশোনা → উপকরণ → appears.
- [ ] Important question → পড়াশোনা → সাজেশন (গুরুত্বপূর্ণ) → appears.
- [ ] Model test → পড়াশোনা → মডেল টেস্ট → appears.
- [ ] Assignment → পড়াশোনা → আমার কোর্স → appears.
- [ ] Question bank → পড়াশোনা → প্রশ্নব্যাংক → active question appears.
- [ ] Online exam → draft → submit → Manager approves → publish → পরীক্ষা.
- [ ] Marks → result published after approval → পরীক্ষা → ফলাফল.
- [ ] Notice → যোগাযোগ → নোটিশ বোর্ড → appears; draft does not.
- [ ] Attendance → ক্লাস → উপস্থিতি + dashboard rate.
- [ ] Class chat → যোগাযোগ → শ্রেণি চ্যাট → message appears.
- [ ] Draft of every direct feature stays invisible to students.
- [ ] A class outside the assignment is not selectable.
- [ ] Editing a published item opens the same record (id unchanged).
- [ ] Offline: create draft → reconnect → exactly one record.

---

## 10. Rollback

No data migration means rollback is purely code:

1. Remove `js/work-registry.js`, `js/work-management.js`,
   `css/work-management.css` and the two new test files.
2. Revert the mount/wrapper and stylesheet link in `teacher.html`.
3. Revert the imports, mount, hand-off functions, route additions and
   `render()` hooks in `js/teacher.js`.
4. Revert the `sw.js` precache entries and the scoped-sheet allowlist entries
   (`tools/css-order-check.mjs`, `tests/color-icons.test.mjs`).

No stored record, status or path changes, so no user data is at risk either way.

---

## 11. Verification record

Commands run on `arena/3bad369c-apc`:

```
node tools/css-order-check.mjs          → ok — 5 pages × 15 canonical sheets
npm test                                → see the final full-suite result below
```

Full-suite result after the change (Node 22, jsdom, `--test-concurrency=1`,
2026-11-11): **1,646 tests · 1,642 pass · 0 fail · 4 skipped** (includes the 19
new tests; the suite was 1,627 tests before this change).

Related suites run individually and green: teacher panel, teacher navigation,
teacher Tailwind contract, app architecture, color icons, CSS order, minimal UI,
receipt/offline precache, work registry, work management.

---

## 12. Next approved step

The safest next increment is **not** more UI. It is the security/behaviour
foundation the audit flagged:

1. Finish the already-designed staged v1→v2 rule activation (§5.3 of the
   audit): project live data into `activePlusV2`, provision the same claims the
   rules read, then cut over — emulator tests already exist
   (`functions/test/rtdb-rules.test.js`).
2. Notification approval decision (keep direct or add a queue).
3. Practice-visibility decision (device-local or a new store).
4. Only then consider retiring the legacy duplicate doors.

Each of those is a separate, reviewable change with its own tests — exactly as
the brief requires.
