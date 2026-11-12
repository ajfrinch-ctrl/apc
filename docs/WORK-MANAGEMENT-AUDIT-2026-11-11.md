# Universal Teacher Work Management System — Phase 1 Audit & Feature Mapping

Branch: `arena/3bad369c-apc` (base `eaa9a99` on `main`)
Date: 2026-11-11
Scope: Teacher Panel reorganisation, Student Panel feature mapping, Firebase data
paths, permissions, approval, offline-first sync, tests.

> **Status: audit + design + an additive Phase-4 increment.** No branch merge,
> no database migration and no production deployment has been performed. Every
> item marked **needs approval** is awaiting the owner's decision (§9).

---

## 1. Method

* Static reading of every Teacher-Panel module (`js/teacher.js`, 1,807 lines,
  plus `teacher.html`, 16 `.teacher-view` screens and 40+ supporting modules).
* Static reading of the Student Panel surface: `student.html` (51
  `data-view-panel` screens), `js/main.js` (composition root) and the lazy
  signed-in chunk `js/student-features.js` (15 namespaces over ~47 modules).
* Repository-by-repository trace of writes, validation, scope gates and
  approval states: `teaching-data.js`, `exam-data.js`, `office-data.js`,
  `course-content.js`, `question-bank.js`, `class-chat.js`, `course-data.js`,
  `teacher-assignments.js`, `storage.js`, `database.js`.
* Sync trace: `js/realtime-sync.js` (DB root `activePlusSync/v1`),
  `js/sync-collections.js`, `js/sync-merge.js`, `sw.js` precache.
* Rule trace: `database.rules.json`, `firestore.rules`,
  `database.rules.v2.draft.json`.
* Test inventory: 354 test files (`tests/*.test.mjs`, `*.spec.cjs`). The
  relevant existing suites were run before the change (teacher, navigation,
  architecture, CSS contracts, offline precache).
* New work is verified by `tests/work-registry.test.mjs` (10 tests) and
  `tests/work-management.test.mjs` (7 DOM tests) plus the full suite.

---

## 2. Current Teacher Panel — inventory

### 2.1 Screens (`TEACHER_VIEWS` in `js/teacher.js`)

| Route | Screen | Purpose | Writes |
|---|---|---|---|
| `#home` | `teacherHome` | কাজ-কেন্দ্রিক লঞ্চার: ১ প্রধান দরজা + ৩ কাজের কার্ড (২০২৬-১১-১১) | none |
| `#academic` | `teacherAcademic` | রিসোর্স হাব: কাজ প্যানেলের সূত্র + ৪টি দেখার দরজা (তৈরি-দরজা নেই) | none |
| `#classes` | `teacherClasses` | Assigned classes + routine door | none |
| `#homework` | `teacherRecords` | Homework list + create card | `teachingRepository.saveActivity` |
| `#suggestion` | `teacherRecords` | Suggestion list + create card | `teachingRepository.saveActivity` |
| `#attendance` (`#routine` alias) | `teacherRecords` | Attendance class records | `saveActivity`/`saveProgress` |
| `#marks` (`#exam` alias) | `teacherRecords` | Legacy marks lane, points at the exam seat | read-only for new work |
| `#online-exams` | `teacherOnlineExams` | Exam builder, question bank, approval, results | `examRepository` |
| `#routine-view` | `teacherRoutine` | Read-only weekly routine + attendance sessions | `saveActivity`/`saveProgress` |
| `#notice` | `teacherNotice` | Own notices (draft/published) | `loadNotices`/`saveNotices` |
| `#courses` | `teacherCourses` | Course content editor (notes/PDF/material) | `course-content.js` |
| `#courses-progress` / `#course-new` | `teacherCourses` | Course structure / new course | `course-data.js` |
| `#lecture-sheets` | `teacherLectureSheets` | A4 lecture-sheet studio | `course-content.js` + `lecture-sheet-store.js` |
| `#class-chat` | `teacherClassChat` | Class chat rooms | `class-chat.js` |
| `#reports` / `#reports-summary` | `teacherAcademicReports` | Generated reports (no data write) | none |
| `#notifications` | `teacherNotifications` | Notification history page | read/mark-read |
| `#profile` | `teacherProfile` | Own staff profile | `staff-auth` self-edit |
| `#settings` | `teacherSettings` | Shared five-group settings hub | local settings |
| `#detail` | `teacherDetailView` | Routed detail/editor host | per feature |
| 9 × `#routine-*` | `teacherRoutine` | Routine category filters | none |
| `#class-chat` | fullscreen chat | chat | chat |

### 2.2 Existing create/edit paths (the ones the new workspace must reuse)

| Content | Create | Edit | Publish / unpublish | Delete/Archive | Approval |
|---|---|---|---|---|---|
| Homework | `saveActivity` (status draft/published) | `saveActivity` (same id) | status flag | `deleteActivity` (blocked if exam / attendance-bearing routine) | none |
| Suggestion | `saveActivity` | `saveActivity` | status flag | `deleteActivity` | none |
| Attendance class | `saveActivity` type `routine` or routine-session sheet | `saveProgress` | created published | blocked once progress exists (Manager correction only) | none |
| Notice | `saveNoticeRecord` | `saveNoticeRecord` | `status: published/draft` + toggle | own notice delete | none |
| Course note / PDF / material / important question / model test / assignment | `saveCourseRecord` | `saveCourseRecord` | `setContentPublished` | `archiveCourseRecord` / `deleteCourseRecord` | none |
| Lecture sheet | lecture studio → `saveCourseRecord` | studio | `setContentPublished` | archive/delete | none |
| Question bank | `questionBank.save` | same id | `active` flag | soft delete | none |
| Online exam | `examRepository.create` (`draft`) | editable while `draft/pending/rejected` | `submit` → `pending`; `approve`/`reject`; `publish` (Admin/Manager) | `archive`/`restore` | **yes** (existing 7-state workflow) |
| Exam marks/results | exam attempt scoring + `publishResults` | `gradeEditPolicy` audit | results publication | archive | **yes** |
| Class chat | send message | not editable | immediate | delete own | none |

### 2.3 What was duplicated today

* Homework/suggestion/notice creation was reachable from the Home launcher,
  the Academic hub, and each records screen's own create card. **Resolved
  2026-11-11:** the Home shortcuts and the Academic hub's creation doors were
  removed (owner decision); the central work panel is the only creation entry,
  while each records screen keeps its own create card for its own content.
* Marks entry is reachable from the exam seat and from the records `exam` lane.
* Routine is reachable from Home, Classes and the bottom "কাজ" seat.
* The new workspace removed the *conceptual* duplication, and on 2026-11-11 the
  owner approved the visual consolidation: Home lost its second/third doors and
  the Academic hub lost all seven creation doors. **Routes** were not removed —
  old deep links still resolve — so no bookmark, Manager cross-link or test
  fixture breaks at the URL level.

---

## 3. Student Panel — 51 screens, grouped

Source: every `data-view-panel` in `student.html`; all 51 are declared and
reachable. The rail below is the classification used by the registry.

### Study (9 views + course-hub sections)

`courses` (hub) · `my-courses` · `homework` · `suggestion` · `question-bank` ·
`materials` · `model-test` · `study-practice` · `study-results` · `study-other`.
The course hub itself renders chapters/lessons/notes/important
questions/MCQ/assignments/previous questions/PDF/video from
`course-content.js` (`COURSE_TYPES` + `COURSE_SECTIONS`).

### Exam & Results (11 views)

`exams` (hub) · `exam-upcoming` · `exam-live` · `exam-done` · `exam-results` ·
`exam-bank` · `exam-practice` · `exam-instant` · `exam-papers` · `exam-recent` ·
`exam-other`.

### Routine & Schedule (11 views)

`routine` (hub) · `routine-day` · `routine-today` · `routine-tomorrow` ·
`routine-weekly` · `routine-class` · `routine-exam` · `routine-changed` ·
`routine-holiday` · `routine-important` · `routine-other`.

### Class information (10 views)

`classes` · `class-today` · `class-upcoming` · `class-record` ·
`class-subjects` · `class-teachers` · `class-notes` · `class-materials` ·
`class-attendance` · `class-other`.

### Communication (2 views)

`notice-board` · `class-chat`. Notification preferences live at
`notification-settings`; the bell/history is a modal + page, not a panel.

### Profile & Student services (5 views)

`profile` · `my-profile` · `student-id-card` · `student-fee` · `reports`.

### Home dashboard (1 view)

`home`: greeting, daily advice/quote, today's routine, study-progress ring,
attendance rate, average result, homework/exam summary, due-fee card, exam
card, class-chat shortcut, notice shortcut.

---

## 4. Data stores and database paths

| Store | Local key | RTDB path (root `activePlusSync/v1`) | Repository | Sync |
|---|---|---|---|---|
| Teaching activities (homework/suggestion/attendance/legacy marks) | `activePlus.teaching.v1` | `collections/teaching/<activityId>` | `teachingRepository` | id-keyed mirror |
| Exams + attempts | `activePlus.exams.v1` | `examDb/exams/<id>`, `examDb/attempts/<id>` | `examRepository` | dedicated bridge |
| Notices | `activePlus.admin.notices.v1` | `collections/notices/<id>` | `office-data.js` | collection mirror |
| Routine | `activePlus.admin.routine.v1` | `collections/routine/<day>/<slot>` | `office-data.js` | collection mirror |
| Course content (notes/PDF/sheets/questions/important/model test/assignment) | `activePlus.courseContent.v1` | `collections/courseContent/<id>` | `course-content.js` | id-keyed + encryption envelope |
| Courses / chapters structure | `activePlus.courses.v1` | `collections/courses/<id>` | `course-data.js` | collection mirror |
| Question bank | `activePlus.questionBank.v1` | `collections/questionBank/<id>` | `question-bank.js` | id-keyed |
| Class chat | `activePlus.classChat.v1` | `collections/classChat/room-*`, `msg-*` | `class-chat.js` | id-keyed + reactions |
| Academics (classes/subjects/mappings/chapters) | `activePlus.academics.v1` | `collections/academics/*` | `academics.js` | collection mirror |
| Students roster | `activePlus.admin.students.v1` | `collections/students/<id>` + `students/<id>` | `office-data.js`/`admin-data.js` | collection + per-student node |
| Transactions / fees | `activePlus.admin.transactions.v1` | `collections/transactions/<id>` | finance modules | collection mirror |
| Teacher assignments | `activePlus.manager.teacherAssignments.v1` (+ master-list mirror) | `collections/teacherAssignments/<id>` | `teacher-assignments.js` | collection mirror |
| Staff accounts (4 roles) | `activePlus.<role>Account.v1` | `staffAccounts/<role>` | `staff-auth.js` | raw node |
| Student login/accounts | `active-plus-account-v1`, `activePlus.db.accounts.v1` | `studentAccounts/<login>`, `students/<id>` | `storage.js`/`registration-*` | raw node |

No new store was introduced by this change; the new UI reads these stores and
hands off to the writers above.

---

## 5. Permission audit (actual behaviour)

### 5.1 Client-side gates (what exists today)

* `teaching-data.js`: `requireRoleSession('teacher')`, `isTeacherAssigned(...)`,
  `isTeacherAllowedSubject(...)`; teacher writes are refused outside the
  assigned class/group/subject; attendance older than 7 days is Manager-only.
* `exam-data.js`: role sessions for read/write; teacher may create draft,
  submit, and edit only `draft/pending/rejected`; `approve`, `publish`,
  `unpublish`, `archive` require Admin/Manager.
* `course-content.js`: `requireCourseWriter(role, classId, subjectId, group)`
  is the single writer gate; teacher drafts are visible only to their author.
* `question-bank.js`: `listQuestionsForStaff(role)` requires an active staff
  session and, for a Teacher, subject assignment.
* UI: `js/panel-capabilities.js` hides/disables `[data-cap]` entries. This is
  presentation only — as the brief says, hiding a button is not security.

### 5.2 Firebase Realtime Database rules (audit result)

| Node | Read | Write | Role/assignment enforced? |
|---|---|---|---|
| `collections/teaching` | `auth != null` | `auth != null` | **No** |
| `collections/notices` | `auth != null` | `auth != null` | **No** |
| `collections/routine` | `auth != null` | `auth != null` | **No** |
| `collections/academics` | `auth != null` | `auth != null` | **No** |
| `collections/courses` | `auth != null` | `auth != null` | **No** |
| `collections/teacherAssignments` | `auth != null` | `auth != null` | **No** |
| `collections/classChat` | `auth != null` | `auth != null` | **No** |
| `collections/courseContent` | `auth != null` | role ∈ {admin, manager, teacher} (null-role tolerated) | partial |
| `examDb/exams` | `auth != null` | `auth != null` (id/teacherId/status shape only) | **No** |
| `examDb/attempts` | `auth != null` | `auth != null` | **No** |
| `studentAccounts/<login>` | `auth != null` | pending→active/rejected restricted to admin/manager tokens, but `role === null` is tolerated | partial |

`database.rules.v2.draft.json` exists as a stricter draft (33 KB) but is not
deployed. `firestore.rules` is role-aware but the app's live backend is RTDB.

**Consequence:** any authenticated account (including a student session) can,
with a crafted client, write homework, notices, exams or change an exam's
`status` to `published`. Teacher assignment scope and exam approval are
enforced in application code only. This is the highest-severity gap found and
it predates this work; **this change neither weakens nor silently "fixes" the
rules** — a rules migration needs its own approval and simulation suite.

### 5.3 The strict model already exists — it is staged, not live

**Correction to the first revision of this audit**, which implied no strict
model existed. In fact the repository already contains a complete role-scoped
data model:

* `database.rules.v2.draft.json` — a separate `activePlusV2` namespace with
  **27 collections** (`notices`, `noticeDraftsByAuthor`, `studentNotices`,
  `teachingByTeacher`, `teachingDraftsByTeacher`, `studentTeaching`,
  `questionBank`, `questionBankDraftsByTeacher`, `courseContentByAuthor`,
  `courseContentDraftsByAuthor`, `exams`, `studentExams`, `attempts`,
  `results`, `students`, `transactions`, `teacherAssignments`, `routine`,
  `academics`, `pushTokens`, …). Every read/write rule requires a non-anonymous
  provider, `mustChangePassword !== true`, `status === 'active'` (staff) or
  `'approved'` (student), an explicit `role`, and for a teacher
  `auth.token.teacherId != null`; students are bound to
  `auth.token.studentId`.
* Writes are split into **per-author draft nodes** and publishable projections,
  so "draft" is a server-side visibility boundary, not a client flag.
* `functions/test/rtdb-rules.test.js` — 297 lines, 123 `assertSucceeds`/
  `assertFails` assertions on the emulator — already exercises it.
* `functions/notice-projection.js`, `functions/question-bank-projection.js`,
  `sync/notices-v2-sync.js`, `sync/question-bank-v2-sync.js` are the staged
  writers; `js/realtime-sync-entry.js` boots exactly those two v2 controllers
  **next to** the v1 bridge, and only for a signed-in user whose claims already
  satisfy the same selector the rules enforce.

Two consequences that matter for planning:

1. The draft closes `activePlusSync` entirely (`".read": false,
   ".write": false` at the root). Deploying it is a **hard cutover**, not a
   tightening: every module still reading `activePlusSync/v1` would break the
   same minute.
2. The live data therefore has to be **projected into `activePlusV2`** before
   or during that cutover — which is a genuine data migration (copy + dual-read
   + freeze), even though no record is edited or deleted.

---

## 6. Feature → Student Panel mapping (registry)

The central registry is now `js/work-registry.js`; every entry declares
category, required/optional fields, class/subject/group requirements, form
component, repository, database path, permission, approval, publish action,
Student Panel destination, validation and related tests.

| Feature | Form / hand-off | Store | Teacher publish | Approval | Student destination |
|---|---|---|---|---|---|
| Homework | `activity-editor` → `#homework` create | teaching | ✅ direct | — | পড়াশোনা → বাড়ির কাজ |
| Suggestion | `activity-editor` → `#suggestion` | teaching | ✅ direct | — | পড়াশোনা → সাজেশন |
| Lecture sheet | lecture studio | courseContent | ✅ | — | পড়াশোনা → উপকরণ |
| Class note | course content editor | courseContent | ✅ | — | ক্লাস → ক্লাস নোট |
| Study material / PDF | course content editor | courseContent | ✅ | — | পড়াশোনা → উপকরণ |
| Important question | course content editor | courseContent | ✅ | — | পড়াশোনা → সাজেশন/গুরুত্বপূর্ণ |
| Model test | course content editor | courseContent | ✅ | — | পড়াশোনা → মডেল টেস্ট |
| Assignment | course content editor | courseContent | ✅ | — | পড়াশোনা → আমার কোর্স |
| Question bank | question editor in exam seat | questionBank | ✅ (active) | — | পড়াশোনা → প্রশ্নব্যাংক |
| Online exam | exam builder | exams | ❌ | **Admin/Manager** | পরীক্ষা → আসন্ন/চলমান |
| Exam marks / results | marks lane | exams | ❌ | **Admin/Manager** | পরীক্ষা → ফলাফল |
| Notice | notice composer | notices | ✅ direct | — | যোগাযোগ → নোটিশ বোর্ড |
| Class chat | chat room | classChat | ✅ (send) | — | যোগাযোগ → শ্রেণি চ্যাট |
| Attendance | attendance sheet | teaching | ✅ | — | ক্লাস → উপস্থিতি |
| Class routine | Manager-owned | routine | ❌ read-only | Manager | রুটিন → আজকের রুটিন |
| Course / chapter | Manager-owned | courseContent | ❌ read-only | Manager | পড়াশোনা → আমার কোর্স |

`tests/work-registry.test.mjs` asserts that every `student.view` exists in
`student.html`, that every store key is a real `KEYS` entry, that every
repository file exists, and that exam publishing is not offered to a Teacher.

### 6.1 Student-owned surfaces (explicitly out of Teacher creation)

Password/PIN, personal settings, profile sensitive fields, notification
preferences, device binding, digital ID, fees and reports are **not** in the
teacher registry. They stay student-owned or Admin/Manager/Payment-owned, per
the brief's warning not to merge personal student data with teacher content.

---

## 7. Reuse classification

### Direct reuse (no adapter)

Homework, suggestion, notice, lecture sheet, class note, material, important
question, model test, assignment, question bank, class chat, exam builder,
marks lane, attendance sheet. Each has one writer and one validation source;
the new workspace only navigates to it and pre-fills scope.

### Adapter added (thin, no data change)

| Adapter | Why |
|---|---|
| Scope → activity form pre-fill | carries class/subject/group + draft/published intent into the existing editor |
| Scope → notice composer pre-fill | same, for audience class/group |
| Status normaliser (`work-registry.js`) | teaching has 2 statuses, notices 2, exams 7, course content boolean — one read-only vocabulary, **no migration** |
| "My published work" aggregator | reads 4 existing stores; one card per real record, link back to its owner screen |
| Student-activity summariser | derives counts from `progress` + exam attempts; writes nothing |

### Backend incomplete (reported, not invented)

| Gap | Impact | Recommendation |
|---|---|---|
| Practice answers live only on the student device | Teacher cannot see practice participation | Needs an approved, privacy-reviewed synced store — not created here |
| No staff-wide "my drafts" reader for course content | Workspace lists published materials + own teaching/exam/notice items; content drafts stay in the content editor | Add an exported staff-scoped reader in a separate change |
| RTDB rules do not enforce role/assignment/approval | Client gates can be bypassed | Rules v3 migration with emulator tests (§9) |
| No server-side teacher assignment | Scope is device-local + directory mirror | Same rules migration, plus server projection |
| Notices have no pending/approval state | Direct publish is the only policy | Decide whether approval is required (§9) |

---

## 8. Findings

### High

**H1 — The live (v1) rules do not enforce the business model.** See §5.2.
Any authenticated token can write teaching/notices/routine/exams; exam approval
can be bypassed by writing `status: "published"` directly. The UI gates are not
a substitute. A strict v2 rule set covering the same 27 collections already
exists and is tested (§5.3), but it is a hard cutover that closes the v1
namespace, so it cannot be switched on before the projections and claim
provisioning are ready. **Needs an activation decision, not new rule design.**

**H2 — Teacher scope is enforced client-side on the live path.**
`isTeacherAssigned` / `isTeacherAllowedSubject` run in the browser against local
storage. A modified client can write another class's records. The v2 model does
bind this server-side (`auth.token.teacherId` plus per-teacher draft nodes), so
the fix is activation, not invention.

### Medium

**M1 — Notice approval policy undefined.** Exams are approval-gated; notices
are direct. The brief allows either but requires an explicit policy. Current
code = direct publish by the owning teacher. Changing it requires a new
`pending` state, an Admin/Manager queue, and migration rules for old notices.

**M2 — Course-content draft aggregation gap.** The staff reader is scoped to
one class+subject; there is no exported "all my drafts" reader. The new "My
work" tab therefore shows published materials and own drafts for
teaching/exams/notices, and links materials to their editor.

**M3 — Practice visibility absent.** Student practice attempts are local-only.
A teacher-facing practice view cannot be honest without a new synced store.

**M4 — Historical duplicate doors — addressed (2026-11-11).** Home, the
Academic hub, the records screens and the bottom nav each opened some of the
same work. The owner approved the consolidation: Home is work-centric, the
Academic hub is read-only resources, and both old doors moved to **আরও**.
Routes remain, so links survive; only buttons changed. Records screens keep
their own create card (they own the content, not a second entry point).

### Low

**L1 — No registry before this change.** Feature knowledge was spread across
`ACTIVITY_TYPES`, `COURSE_TYPES`, `EXAM_STATUSES`, panel capabilities and test
files. The registry now names the contract; the old modules remain the writers.

**L2 — Status vocabulary is heterogeneous by design.** Normalising it in
storage would be a migration; the UI normalises on read instead.

**L3 — Several offline/precache/cascade contracts are enforced by tests.** New
assets must be added to `sw.js` and to the scoped-sheet allowlist. Done in this
change; full suite run confirms no drift.

---

## 9. Decisions requested from the owner

1. **Rules activation (H1/H2).** The strict rule set already exists
   (`database.rules.v2.draft.json`, 27 collections, emulator-tested). Choose:
   **(A) leave v1 as-is for now** — no risk, no migration, gap remains;
   **(B) tighten the v1 rules in place** — no data movement, but only safe if
   every live staff/student account already carries `role`/`status`/
   `teacherId`/`studentId` claims, otherwise accounts are locked out mid-day;
   **(C) finish the staged v1→v2 cutover** — project live data into
   `activePlusV2`, provision claims, then deploy (this is the only route that
   also fixes assignment scope and exam-status forgery, and it *is* a data
   migration, so it needs explicit approval).
2. **Notice approval (M1).** Keep direct publish (current), or introduce
   Admin/Manager approval for notices? *Impact of change:* new status,
   new queue, migration of existing notices, new tests.
3. **Practice visibility (M3).** Leave device-local, or approve a new
   privacy-reviewed `practiceAttempts` store? *Impact:* new schema + rules +
   student consent copy.
4. **Navigation consolidation (M4). — approved and implemented
   (2026-11-11).** Home is work-centric; the Academic hub has no creation door;
   the hub and class chat live in **আরও**; legacy routes are preserved and the
   navigation contract tests were updated.
5. **Merge/deploy.** Phase 4 is on the branch and fully tested; merge and
   production deployment await explicit approval.

---

## 10. Test evidence

| Suite | Covers |
|---|---|
| `tests/work-registry.test.mjs` (new, 10) | registry completeness, real student views, real stores, approval policy, scope refusals, status mapping |
| `tests/work-management.test.mjs` (new, 9) | one screen/four parts, wizard writes nothing, scope pre-fill into the canonical editor, exam has no publish action, real statuses listed, edit opens the same record, student activity summarises real submissions, a sync refresh keeps the active part |
| `tests/teacher-panel.test.mjs` | teacher CRUD, attendance, paging, settings, notices |
| `tests/teacher-navigation-2026-11-01.test.mjs` | route contracts, home doors, deep links |
| `tests/teacher-panel-tailwind.test.mjs` | scoped sheet ordering and panel styles |
| `tests/app-architecture.test.mjs` | panel isolation, nav seats, view counts |
| `tests/exam-approval-flow.test.mjs` | draft → pending → approve → publish → archive |
| `tests/sync-*.test.mjs`, `tests/offline-persistence.test.mjs` | merge, reconnection, duplicate protection |
| `tests/receipt-statement.test.mjs` | offline precache graph completeness (now includes the two new modules) |

Full-suite result for this branch is recorded in §11 of the design document.

---

## 11. Conclusion

All of the brief's Phase-1 obligations are satisfied: the Student Panel has a
complete feature inventory, every Teacher CRUD path is identified, database
paths and permissions are mapped, security rules are assessed honestly, and
each feature is classified as direct-reuse / adapter / backend-incomplete.

Nothing was deleted, migrated, merged or deployed. The only storage change is
**none**: the new layer is read-only plus navigation, and every write still
goes through the repository that already owned it.
