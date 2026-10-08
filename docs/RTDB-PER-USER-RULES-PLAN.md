# Realtime Database: per-user / per-role rules — design plan

Status: **STAGED MIGRATION; proposal only. No production cutover authorized.**
The owner selected preparation and testing of Firebase Auth/custom-claims access
and a new data layout while the existing sync stays on. `firebase.json` still
points to `database.rules.json`, the interim anonymous-bridge policy
(`auth != null`) for `activePlusSync/v1`; the live Console policy has not been
verified from this workspace. The expanded v2 draft is still incompatible with
the current client and is not approved to replace the interim file. Keep current
sync, deployed rules and live data unchanged until migration tests pass and a
separate cutover is approved. Interim exposure risk remains during preparation.
The old deny-all policy in `docs/CLOUD-CONTAINMENT-114.md` is historical/emergency
containment, not the current repository configuration.

| Artifact | Purpose |
| --- | --- |
| `tools/rtdb-rules/build-v2-draft.mjs` | Generator (role predicates are written once, then inlined) |
| `database.rules.v2.draft.json` | Generated draft rules. **Not referenced by `firebase.json`** |
| `tests/rtdb-v2-draft-rules.test.mjs` | Access matrix run with a local simulator (`npm test`); also asserts the draft is not deployed |
| `tests/rtdb-rules-sim.mjs` | Small RTDB rules simulator. Not the Firebase engine |
| `functions/test/rtdb-rules.test.js` | Authoritative emulator suite (`cd functions && npm run test:rtdb-rules`) |

---

## 1. Why not `auth != null` on `activePlusSync`

`auth != null` only proves that a caller has *some* Firebase identity.
Anonymous sign-in is enabled and the web config is public, so anyone can get an
identity. Under that rule every caller could:

* read `staffAccounts`, `studentAccounts`, `usernames` and `staffDirectory`,
  which hold PBKDF2 hashes that can be attacked offline, plus the whole roster,
  all transactions and every exam answer key;
* overwrite `staffAccounts/admin` with their own hash and log in as Admin on
  any device that syncs.

The client-side login cannot fix this. The rules are the only security
boundary.

## 2. Identity model

Use the Firebase Auth accounts that `functions/index.js` already provisions
(email/password on `user.<username>@accounts.activeplus.app`, created by
`createFirstAdmin` / `adminCreateAccount`). Only Cloud Functions set custom
claims:

| Claim | Values | Status |
| --- | --- | --- |
| `role` | `admin` `manager` `teacher` `payment` `student` | exists |
| `status` | staff `active` / `suspended`; student `pending` / `approved` / `rejected` | exists |
| `mustChangePassword` | `true` blocks all data access | exists |
| `studentId` | the app's roster id (`students/<id>`, `tx.studentId`, `attempt.studentId`) | **new** |
| `teacherId` | the app's teacher id (`exam.teacherId`) | **new** |

The draft rules require, on every grant:

* `auth.token.firebase.sign_in_provider !== 'anonymous'`, as defence in depth;
* `mustChangePassword !== true`;
* staff: `status === 'active'`. Students: `status === 'approved'`;
* teachers must have `teacherId`, and students must have `studentId`.
  Otherwise the account is locked out until it is linked.

## 3. Data layout (`activePlusV2/…`)

After a verified migration, the legacy `activePlusSync` tree should become
`false/false` permanently. Until then, it remains the current client's interim
bridge and must keep its existing policy if that stop-gap is still authorized.
The proposed new root avoids mixing old, credential-bearing data with the new
data. Two Realtime Database rules drive the layout:

* **Rules are not filters.** A listener on `students` needs read access to the
  *whole* node. Data that a student may see only partly is therefore split into
  per-student subtrees (`attempts/<studentId>`, `studentLedger/<studentId>`, …).
* **Grants cascade and cannot be revoked lower down.** Grants therefore sit at
  the lowest level that works, and writes happen **one record at a time**.

| Path | Read | Write |
| --- | --- | --- |
| `settings` | any active account | Admin |
| `notices/{id}` | active staff only | Admin, Manager; published records only; Teacher publication uses an assignment-checking callable |
| `noticeDraftsByAuthor/{authUid}/{id}` | Admin, Manager, author Teacher | Admin, Manager, author Teacher; drafts cannot be directly published |
| `studentNotices/{sid}/{id}` | owning student only | *server only*; class/group-scoped fan-out so students cannot read other classes’ notices |
| `routine/{id}` | any active account | Admin, Manager, Teacher (matches the tested Manager routine workflow) |
| `academics/{syncKey}` | any active account | Admin; wrapper keys must match `_syncKind` + record ID (`class-…`, `subject-…`, `mapping-…`, `chapter-…`); metadata is `__metadata` |
| `teacherAssignments/{id}` | Admin, Manager, Teacher | Admin, Manager |
| `teachingDraftsByTeacher/{teacherId}/{activityId}` | Admin, Manager, owning Teacher | Admin, Manager, owning Teacher; only `draft`, no `progress` |
| `teachingByTeacher/{teacherId}/{activityId}` | Admin, Manager, owning Teacher | Admin direct; Teacher publish/update through an assignment-checking callable; published records contain no `progress` map |
| `studentTeaching/{sid}/{activityId}` | owning student only | *server only*; Function fan-out of published metadata with no progress |
| `studentTeachingProgress/{sid}/{activityId}` | owning student only | owning student may report `done` for their own published homework; Function mirrors progress to staff view |
| `teachingProgressByTeacher/{teacherId}/{sid}/{activityId}` | Admin, Manager, owning Teacher | *server only*; Function checks roster/activity scope before mirroring staff updates |
| `courseContentDraftsByAuthor/{authUid}/{recordId}` | Admin, Manager, owning Teacher | Admin, Manager, owning Teacher; Teacher draft only, never published directly |
| `courseContentByAuthor/{authUid}/{recordId}` | Admin, Manager, owning Teacher | Admin, Manager direct; Teacher publishes through an assignment-checking callable; unpublished drafts never student-readable |
| `studentCourseContent/{sid}/{recordId}` | owning student only | *server only*; Function fans out published and active content for that student’s class/group |
| `questionBank/{questionId}` | Admin, Manager only; contains answer keys | Admin, Manager; Teacher promotion goes through an assignment-checking callable |
| `questionBankDraftsByTeacher/{teacherId}/{questionId}` | Admin, Manager, owning Teacher | Admin, Manager, owning Teacher; draft only, never directly student-readable |
| `teacherQuestionBank/{teacherId}/{questionId}` | Admin, Manager, owning Teacher | *server only*; assignment-scoped projection for Teacher workspaces |
| `studentQuestionBank/{sid}/{questionId}` | owning student only | *server only*; active, class/group-scoped practice copy; exam-sourced questions only after the official `endAt` |
| `students` / `students/{sid}` | staff: whole node. Student: own record only | Admin, Manager |
| `transactions/{id}` | Admin, Payment | Payment: **create only**. Admin: any |
| `studentLedger/{sid}` | Admin, Payment, owning student | *server only* (trigger copy) |
| `exams/{id}` (includes answer keys) | Admin, Manager, Teacher | Teacher: own, status draft/pending, never after publish. Admin: draft/pending or delete. **Publish/reject only via the `managerReviewExam` callable** |
| `studentExams/{sid}/{examId}` (no answers) | staff, owning student | *server only* (fan-out on publish) |
| `attempts/{sid}/{attemptId}` | staff, owning student | owning student, only for an exam in their `studentExams`, not once `submitted`, `startedAt <= now`. Admin: delete |
| `results/{sid}/{examId}` | staff, owning student | *server only* (scored from the answer key) |
| `pushTokens/{uid}/{deviceId}` | **nobody** (Functions only) | owner uid. `role` must equal the claim. `studentId` must equal the claim, or be empty for staff |
| `staffAccounts`, `studentAccounts`, `usernames`, `staffDirectory` | **removed** | **removed** |

### Question Bank answer-key boundary

The existing local Question Bank has a `sync-collections.js` adapter but is
intentionally **not** in the anonymous v1 `SYNCABLE` list. Its records include
`answer` / `answerText`; adding it to `activePlusSync/v1` would expose answer
keys to every anonymous client. Keep that exclusion unchanged.

In v2, Admin/Manager use the canonical bank. A Teacher edits only a private
`questionBankDraftsByTeacher/<teacherId>` draft and receives only their
assignment-scoped `teacherQuestionBank/<teacherId>` copy. Promotion is a
server-side callable that checks the live teacher assignment; client/UI checks
are not sufficient. Students listen only to
`studentQuestionBank/<studentId>`. That own-student projection may contain the
answer needed by the practice feature, but a Function must fan out only active
questions matching the student's class/group. If a question has `source.examId`,
it must not be copied to a student until its official `endAt` has passed; a
server-side scheduled release/backfill is required. Students must never
subscribe to the canonical bank and filter answer keys locally. Preserve
unassigned/orphan questions in the staff-only canonical bank for reconciliation,
not by dropping them during migration.

### Where credentials go

No password hash, username registry or staff directory lives in RTDB any more:

* **Login:** `signInWithEmailAndPassword`, so Firebase Auth checks the password
  on its servers. A new device gets nothing until the password is correct.
* **Username availability:** a rate-limited callable backed by Firestore
  `usernameIndex`, which is already server-only.
* **Staff directory:** Firestore `users`, where rules already allow Admin/owner
  reads, managed through callables.
* The local PBKDF2 records can stay as an **offline unlock** for a device that
  has already logged in online. They never sync.

## 4. Decisions for the owner (the draft's defaults are in brackets)

1. May teachers read **all** exams, including colleagues' answer keys?
   [yes, for simplicity]. Stricter option: `examsByTeacher/{teacherId}`.
2. May teachers and Payment read the **full roster**, including guardian
   mobiles? [yes]. Stricter option: a trimmed `rosterPublic` mirror.
3. Who edits the roster? [Admin + Manager]. Student self-registration goes
   through a callable.
4. Suspension takes effect when the ID token refreshes (≤ 1 h), and open RTDB
   connections keep their auth until then. If that is too slow, also call
   `revokeRefreshTokens` and add a server-written `revoked/{uid}` check to every
   grant.
5. Notice/routine authoring: the repository E2E workflows confirm Teachers and Managers author notices and Managers author routines. The draft preserves those writers; no product workflow change is assumed.

## 5. Required code changes

### Cloud Functions (`functions/index.js`)
* `adminCreateAccount` / `managerReviewStudent`: set a `studentId` claim linked
  to the roster record. Add a `linkTeacher` step that sets `teacherId`.
* `adminSetAccountStatus`: also `revokeRefreshTokens(uid)`.
* New triggers / callables:
  * on `notices/{id}` being published/updated, resolve the target class/group
    server-side and fan out only to `studentNotices/{sid}/{id}` for matching
    students; provide a Teacher publish callable which verifies the teacher's
    assignment before copying their private draft into the canonical notice;
  * on `exams/{id}` becoming published, fan out a copy **without `answer`
    fields** to `studentExams/{sid}/{id}` for each participant;
  * on `attempts/{sid}/{aid}` becoming `submitted`, score it against the key
    and write `results/{sid}/{examId}`;
  * on `transactions/{id}`, mirror to `studentLedger/{studentId}/{id}`;
  * on `teachingByTeacher/{teacherId}/{activityId}` being published, resolve
    the approved class/group roster server-side and fan out activity metadata
    without progress to `studentTeaching/{sid}/{activityId}`; unpublish/delete
    must retract or mark each student copy inactive;
  * student `studentTeachingProgress` writes must be validated as own, published
    homework completion, then mirrored to the staff-only
    `teachingProgressByTeacher` path;
  * Teachers submit review/attendance updates via a callable which verifies the
    teacher claim, activity owner, student roster membership and allowed value,
    then updates staff progress and the student's own view atomically;
  * on `courseContentByAuthor/{authUid}/{id}` publish/archive, resolve class and
    group scope server-side and fan out/retract `studentCourseContent` copies.
    Never copy unpublished drafts to a student subtree;
  * add `publishQuestionBankDraft`: require the authenticated active Teacher,
    load the draft under the claim's `teacherId`, verify the current
    class/group/subject assignment, validate and write the canonical question;
    never trust a client-supplied role or assignment;
  * on canonical Question Bank create/update/delete, maintain assignment-scoped
    `teacherQuestionBank/<teacherId>` and active class/group-scoped
    `studentQuestionBank/<studentId>` projections, retracting stale copies when
    scope changes. Recompute affected copies when a student's class/group or a
    Teacher assignment changes. Exam-sourced questions stay staff-only until
    `endAt`; a server scheduled task releases them only after the end time.
    Preserve answer fields only in staff projections and the student's own
    eligible practice copy; students never read the canonical bank;
  * `publishNotice`, `publishTeachingActivity` and `publishCourseContent` must
    verify the authenticated Teacher's server-side assignment before promoting
    their author-scoped draft. UI checks alone are not authorization.
* `managerReviewExam`: work on the RTDB `exams/{id}` (it currently updates
  Firestore `exams`).
* Callables `usernameAvailable`, `listStaff` / `updateStaff`.
* Move the push triggers' `BRIDGE_ROOT` to `activePlusV2`. `tokenEntries()`
  must read `pushTokens/{uid}/{deviceId}`, one level deeper than now.

### Client
* `js/realtime-sync.js`
  * `DB_ROOT` becomes `activePlusV2`. Delete `syncStaffRole`, `syncDirectory`,
    `syncUsernames`, `syncStudentAccount`, `hydrateStudent`,
    `hydrateStaffAccounts`, `firstAdminExistsOnline`, `usernameTakenOnline`
    and all their listeners.
  * Subscribe by role. A student listens to `students/<studentId>`,
    `studentExams/<sid>`, `attempts/<sid>`, `results/<sid>` and
    `studentLedger/<sid>`, never to whole collections they cannot read. Skip
    collections the role cannot read, so it doesn't get endless
    `permission_denied` retries.
  * Replace the examDb mirror with `exams/{id}` (staff) and
    `attempts/{sid}/{id}`.
* `js/record-sync.js`
  * `commit` currently runs **one transaction on the whole collection node**.
    Change it to per-record `runTransaction(collection/{id})` or a multi-path
    `update`, because the rules grant writes only at record level.
* `js/login.js` / `js/staff-auth.js`
  * Online login uses `signInWithEmailAndPassword`. Handle
    `mustChangePassword` with `updatePassword` →
    `completeTemporaryPasswordChange` → `getIdToken(true)`.
  * Drop the "upgrade local Admin by sending the typed password to
    `createFirstAdmin`" path in favour of an explicit, one-time bootstrap
    screen.
* Exams (`js/exam-data.js`, `js/student-dashboard.js`)
  * Students render from `studentExams` (no answer keys). Scores come from
    `results`. Client-side scoring stays for staff preview only.
* `js/push-notifications.js`
  * Write to `pushTokens/<auth.uid>/<deviceId>`. Set `role` from the ID-token
    claim (not `cash-counter`/`staff`), and `studentId` from the claim or `''`.
* Notices (`js/notice-center.js`, `js/teacher.js`, `js/manager.js`)
  * Students listen only to `studentNotices/<studentId>`. Staff may use the
    canonical staff collection. Teacher saves/publishes through the private
    author draft plus assignment-checking callable; Manager/Admin writes the
    canonical notice and a Function creates the student-specific copies.
* Teaching (`js/teaching-data.js`)
  * Migrate each activity from the current flat list to an author-scoped path:
    unpublished rows to `teachingDraftsByTeacher/<teacherId>/<activityId>`,
    published rows to `teachingByTeacher/<teacherId>/<activityId>`. Strip the
    shared `progress` map and preserve all IDs/statuses. Split every progress
    row into the student's own subtree and the staff-only
    `teachingProgressByTeacher` index.
  * Student listeners use only `studentTeaching/<studentId>` and
    `studentTeachingProgress/<studentId>`. Teacher listeners use only their
    draft/canonical subtree and `teachingProgressByTeacher/<teacherId>`. Do not
    download the whole roster to a student browser and filter it there.
* Course content (`js/course-content.js`, `js/course-hub.js`)
  * Move unpublished records into `courseContentDraftsByAuthor/<auth.uid>/<id>`
    and published/archive records into `courseContentByAuthor/<auth.uid>/<id>`;
    map legacy `createdBy` names to Firebase UIDs without changing record IDs.
    A Teacher may not directly set a draft's `published` flag.
  * Publish only server-generated, class/group-scoped copies to
    `studentCourseContent/<studentId>`. Students must not subscribe to the
    canonical author tree and UI filters are not an access-control boundary.
* Question Bank (`js/question-bank.js`, `js/sync-collections.js`)
  * Keep `questionBank` out of v1 `SYNCABLE`. On v2, map Admin/Manager to the
    canonical question map; Teacher sessions listen to their assigned
    `teacherQuestionBank/<teacherId>` and their own drafts; students listen only
    to `studentQuestionBank/<studentId>`.
  * Preserve stable question IDs and offline local copies. Teacher changes go
    to private drafts and are promoted only by the assignment-checking callable.
    Do not solve sync by downloading global answer keys and filtering in
    JavaScript. Student projections may include practice answers only for the
    student's own class/group, and exam-sourced questions only after `endAt`.
* Academics (`js/sync-collections.js`)
  * The existing v1 adapter stores `class-<id>`, `subject-<id>`,
    `mapping-<id>` and `chapter-<id>` wrappers plus `__metadata`; retain that
    shape or explicitly migrate it with the same stable record IDs.
* `sync/cloud-access.js`
  * Currently `LEGACY_CLOUD_ENABLED = true` and `assertCloudAccess()` always
    returns `true`. This **contradicts** `CLOUD-CONTAINMENT-114.md`. It is
    harmless only because the rules deny everything and `ensureCloudAuth` never
    creates anonymous users. Replace it with a gate that is true only for a
    signed-in, claim-bearing Firebase user, and update the containment doc.

## 6. Migration

1. Export `activePlusSync/v1` with the Admin SDK on a trusted machine. Keep the
   export offline and encrypted.
2. Provision staff Firebase Auth accounts through the Admin-controlled
   provisioning flow with temporary passwords and `mustChangePassword: true`.
   Provision student Auth identities through the registration/approval flow;
   keep them pending until Manager review. **Do not import PBKDF2 hashes.**
3. Set the `studentId` / `teacherId` claims from verified roster/staff mappings
   before granting the corresponding approved/active data-access claims.
4. Use an Admin SDK script to copy the non-credential collections into
   `activePlusV2`, keeping stable IDs and preserving every existing record.
   Reshape `examDb/attempts` into `attempts/{sid}`; split shared teaching
   `progress` by student and Teacher; move unpublished teaching/course/notice
   records into author-scoped draft paths and published records into canonical
   paths. Move every Question Bank row into the staff-only canonical bank,
   preserving unresolved authors for Manager review; build assignment-scoped
   Teacher copies and only active, class/group-scoped student copies. Do not
   backfill an exam-sourced student question before its `endAt`; schedule its
   release after the official window. Run the fan-out triggers/backfill and
   reconcile record counts and checksums, including drafts and archived items.
5. Test on staging with real role-bearing accounts and each role's actual
   screens, including a second student/Teacher to verify cross-user denials.
   Keep legacy sync enabled while the v2 client and migration are validated.
6. After explicit cutover approval, switch app and rules together. Do not delete
   or overwrite `activePlusSync` as part of preparation; preserve an encrypted
   export and only remove legacy data in a separately approved retention step.

## 7. Testing

* `npm test` includes `tests/rtdb-v2-draft-rules.test.mjs`. It checks the full
  matrix for 7 active identities and 9 blocked ones: signed-out, anonymous,
  anonymous with a forged role claim, no claims, `mustChangePassword`,
  suspended, pending student, unlinked student, unlinked teacher. Question
  Bank checks cover canonical/draft/teacher/student path separation and key
  binding. It also asserts that the draft is not wired to `firebase.json` and
  that the committed JSON matches its generator. **It uses a simulator. It is
  not evidence about production or Functions' fan-out behavior.**
* `functions/test/rtdb-rules.test.js` runs the same boundary on the real
  emulator. It was **not run in the sandbox where it was written**: Java and the
  emulator download were unavailable. It must pass in CI or locally first.

## 8. Gates before `firebase.json` may point at these rules

- [ ] Owner decisions in §4 recorded and reflected in the generator.
- [ ] All §5 function and client changes merged. The app works using only
      per-record writes and role-scoped listeners.
- [ ] `npm run test:rtdb-rules` (emulator) and `npm test` are green.
- [ ] Migration §6 steps 1–5 complete on a **staging** project and verified
      with real accounts/devices for every role, including negative cross-user
      access tests and reconciliation of preserved data.
- [ ] Emulator tests, full repo tests, and staging workflow checks pass for all
      migrated paths and Functions; App Check is configured and enforced for
      Realtime Database.
- [ ] Rules Playground spot-check: anonymous and signed-out are denied
      everywhere, and each role matches the table in §3.
- [ ] The owner separately approves production cutover after reviewing the
      interim risk and rollback/export plan.
- [ ] Only then switch `firebase.json` to the migrated rules in the same change
      that updates the interim-policy tests (`tests/interim-sync-rules.test.mjs`,
      `tests/rtdb-path-coverage.test.mjs`) and this document; do not leave the
      v2 draft accidentally deployable before the client migration.

## 9. Implementation status (staged; no production cutover)

Question Bank v2 code is merged but **claims-gated and rules-gated**: nothing
below changes live behavior until claims are provisioned AND the v2 rules are
deployed. The legacy anonymous bridge stays untouched throughout.

Done (client + functions, tested by `npm test`):
- [x] Client path selector: `sync/question-bank-v2-policy.js` (+ retry decision).
- [x] Authenticated Question Bank client: `sync/question-bank-v2-sync.js`
      (canonical/Teacher-draft/Student modes; offline outbox; soft-archive on
      removal; owned-id bookkeeping). Wired into `js/realtime-sync-entry.js`.
- [x] Projection + fan-out helpers: `functions/question-bank-projection.js`,
      incl. the draft-publish race guard `advanceDraftAfterPublish`.
- [x] Question Bank callables/triggers in `functions/index.js`:
      `publishQuestionBankDraft`, `projectQuestionBankRecord`,
      `rebuildStudentQuestionBank`, `rebuildTeacherQuestionBank`,
      `releaseQuestionBankExamQuestions` (1-minute release job, Asia/Dhaka).
- [x] V2 identity claims provisioned server-side at account lifecycle events
      (`teacherId`/`studentId` === Auth uid): `adminCreateAccount`,
      `managerReviewStudent`, `adminSetAccountStatus` (backfill),
      via `v2IdentityClaims` in `functions/teacher-assignment-migration.js`.
- [x] Legacy username→uid assignment migration helper
      (`buildTeacherAssignmentMigration`, `migrationForTeacher`) and the
      Admin-only retro-link callable `adminProvisionV2Identities`
      (dry-run preview by default; never modifies legacy bridge rows).
- [x] Legacy roster → uid migration helper (`functions/v2-roster-migration.js`)
      and the Admin-only callable `adminMigrateStudentToV2` (mobile-based
      PROPOSALS only; applying a match is always an explicit decision; the
      re-keyed row preserves the legacy record id as provenance and never
      overwrites a row the new account flow created).
- [x] Admin panel console for both migration callables
      (সিস্টেম → ভি-টু সিংক মাইগ্রেশন, `security.manage`-gated): teacher
      dry-run → verify → apply and roster proposals → select → validate →
      apply, every write behind an explicit confirmation.

### Retro-link runbook (`adminProvisionV2Identities`)

The Admin panel ships a console for this (সিস্টেম → ভি-টু সিংক মাইগ্রেশন):
dry-run → verify a single teacher → apply, with unresolved rows labelled and
nothing applied without an explicit click. It calls the same callable below,
so the CLI steps remain the fallback for scripted runs.

Run from an Admin session. From a Firebase CLI checkout:

    firebase functions:shell
    > adminProvisionV2Identities({})
    // → { preview: true, usernames: [...], totalRows }

For each active Teacher username in the preview:

    > adminProvisionV2Identities({ username: 'rafiq' })
    // → linkedClaims { role, status, teacherId }, assignments, unresolved

Review `unresolved` (reasons: teacher-identity-not-found, username-mismatch,
teacher-not-active, teacher-auth-disabled, unsafe/duplicate ids, missing
class/subjects). Fix the source of the problem in Staff Management or the
legacy assignments, then re-run — the callable is idempotent per assignment id
and never modifies legacy `activePlusSync/v1` rows. When the report is clean:

    > adminProvisionV2Identities({ username: 'rafiq', applyAssignments: true })

The Admin SDK bypasses RTDB rules, so `applyAssignments` is safe before the v2
rules deploy; the written rows are simply unreadable until cutover. Claims take
effect on the account's next ID-token refresh (≤ 1 h).

### Roster-migration runbook (`adminMigrateStudentToV2`)

A wrong student↔account match is a privacy breach, so this callable only
*proposes* matches by normalized mobile; the Admin confirms each one.
The Admin console (সিস্টেম → ভি-টু সিংক মাইগ্রেশন) enforces the same
sequence in the UI: preview proposals → pick exactly one candidate per
student → validate → apply. The CLI steps below are the scripted fallback.

    firebase functions:shell
    > adminMigrateStudentToV2({ preview: true })
    // → proposals: [{ studentId, name, className, mobile, candidates: [{ uid, username, status }] }]

For each legacy row, pick the correct candidate account (create the account
first via Staff Management if it does not exist), then validate and apply:

    > adminMigrateStudentToV2({ studentId: 'STU-1', uid: 'uid-rahim' })
    // → { proposed: {...} }   (validates both sides, writes nothing)
    > adminMigrateStudentToV2({ studentId: 'STU-1', uid: 'uid-rahim', apply: true })

On `apply` the callable writes `activePlusV2/students/{uid}` additively (the
row's `id` becomes the uid; `legacyStudentId` keeps the old record id) and
backfills the `studentId` claim. It refuses to overwrite a row created by the
new account flow, and it never modifies the legacy `activePlusSync/v1/students`
row. Rows whose account is still `pending` migrate as `pending` and stay out of
the practice lane until the Manager approves them.

Still required before cutover (owner-gated, in order):
- [ ] Run `adminProvisionV2Identities` dry-run, review unresolved rows, then
      link each active Teacher (`applyAssignments: true`).
- [ ] Run `adminMigrateStudentToV2` preview, confirm each student↔account match,
      then apply.
- [ ] Deploy Functions (`cd functions && npm run deploy`) after emulator tests.
- [ ] Pass the emulator gate `npm run test:rtdb-rules` (needs Java + emulator).
- [ ] Staging rehearsal with real accounts for every role, including negative
      cross-user tests and legacy-data reconciliation.
- [ ] Owner approval, then point `firebase.json` at the v2 rules together with
      the interim-policy test updates (§8).
