# Staff Management — Audit & Fixes (2026-10-10)

Scope: four reported problems — (1) a newly created teacher's dashboard shows
no classes, (2) Admin Panel navigation freezes / serves stale tab state,
(3) staff-creation UI must be absent from the Admin Profile view, (4) an
integrated Staff Management Overview for the Admin Profile/Dashboard.

## Root causes

### Issue 1 — new teacher sees no assigned classes

`teacher-assignments.v1` was keyed by `teacherUsername`
(`{name}.teacher.apc`), and the directory projection (`DIR-…` rows) was
written against `buildTeacherUsername(staff.fullName)`, while the Teacher
panel resolved its data through the **singleton device account**:

- `js/teacher.js` called `readStaffAccount('teacher')` → `'teacher.apc'`
  and passed that username to `listTeacherAssignments` / `isTeacherAssigned`.
  A Staff-Directory teacher is `rahim.teacher.apc` — the lookup key never
  matched, so the panel read `[]`.
- `js/staff-auth.js` `saveStaffSession` stored only `username: 'teacher.apc'`
  for the teacher role, so a panel could not learn *which* staff member signed
  in.
- `js/teaching-data.js` hardcoded `teacherId: 'TCH-001'` and
  `teacherUsername: 'teacher.apc'` (`teacher_id` vs `user_id` mismatch).

Stale-session handling was a secondary contributor: the identity key is
versioned and a rebuild of the staff session (or a missing directory record)
reset identity to null, after which every query silently fell back to
`teacher.apc`.

### Issue 2 — Admin Panel freezes / stale tab state

`js/admin.js` `setView()` only toggled `hidden`/`.active`; data loading ran
once (`renderAll()` at `enterPanel`). Revisiting a tab therefore showed the
paint of an earlier visit (or of a failed async read) — and nothing repaired
it. Additionally the hub rows in `js/admin-panel-ui.js` (`renderHub`) and the
static `[data-admin-view]` entries re-bound click handlers without any guard,
so a rebuilt shell could fire `navigate()` twice per click.

### Issue 3 — staff-creation UI in the Admin Profile view

Audit result: in the current codebase there is **no** staff-creation form in
the profile view. `admin.html`'s `#adminProfileView` holds only
`#adminProfileForm` + `#adminPasswordForm`; the single `#staffCreateButton`
lives inside `[data-view-panel="staff"]`, and `createStaff` is reachable only
through `js/staff-management.js` (capability `staff.manage`, API-verified in
`js/staff-directory.js`). Nothing needed deletion; the risk is regression, so
the boundary is now locked by tests (see Test Results).

### Issue 4 — no integrated overview of staff management

Only the full Staff Management screen existed. The dashboard/profile had no
paginated staff list, no search/filter, and no quick actions.

## Fixes (files + where)

**Issue 1 — identity/key mapping**

- `js/staff-auth.js` — `saveStaffSession` records the signed-in staff member's
  real identity (directory record or device account) in
  `activePlus.activeStaffIdentity.v1`; new helpers
  `readActiveStaffIdentity` / `clearActiveStaffIdentity`.
- `js/staff-directory.js` — assignments now carry `classSubjects`
  (`{className: [subjects]}`); `createStaff` / `updateStaff` / `deleteStaff`
  project the teacher's classes/subjects into `teacher-assignments.v1` keyed by
  the record's Login User ID (`…​.teacher.apc`), with old-username rows removed
  on a rename and full cleanup on delete; `findDirectoryStaffByUsername` skips
  system accounts.
- `js/teacher-assignments.js` — accepts the `classSubjects` payload;
  `effectiveTeacherAssignments` merges the Manager-authored store with the
  admin directory projection (store wins); `isTeacherAssigned` /
  `isTeacherAssignedSubject` understand the projected rows.
- `js/teaching-data.js` — scope layer: `setTeachingScope` /
  `teachingScopeUsername` / `currentTeacherProfile` / `roleProfileAccount`;
  resolves the teacher identity from the active session and falls back to the
  singleton device account for legacy sessions.
- `js/teacher.js` — reloads on identity change (`storage` events for
  `activeStaffIdentity` / `staffDirectory` / `teacherAssignments` /
  `activeStaffAccount`), renders only the signed-in teacher's classes/subjects,
  and shows the empty state "এখনো কোনো ক্লাস অ্যাসাইন করা হয়নি…".
- `js/exam-data.js`, `js/exam-manager.js` — the same hardcoded
  `'teacher.apc'` scope gates (`isTeacherAssigned`,
  `isTeacherAssignedSubject`, `subjectsForTeacherClass`, `listTeacherAssignments`,
  `readStaffAccount`) now resolve through `teachingScopeUsername()` /
  `currentTeacherProfile()`.

**Issue 2 — navigation lifecycle**

- `js/admin.js` — `VIEW_REFRESHERS` + `refreshView()`: every successful
  `navigate()` and every capability-denial fallback re-loads the visible
  section's data (dashboard/profile re-mount the overviews, students fetch,
  settings fetch, reports fetch, backup restores). `renderStaff` keeps a
  render generation and an error card with retry (no blank freeze on a failed
  async load). Static `[data-admin-view]` wiring is bound exactly once
  (`navWired` guard); all top-level DOM lookups are optional-chained.
- `js/admin-panel-ui.js` — `renderHub` rows bind once, so rebuilt shells never
  double-fire navigation. Hash routing (including Back/Forward and unknown
  hashes) keeps `location.hash` and the visible section consistent; repeated
  clicks are idempotent.

**Issue 3 — profile view**

- No code change required (audit). Guarded by
  `tests/admin-profile-staff-surface.test.mjs` "the Profile view contains no
  staff-creation surface".

**Issue 4 — Staff Management Overview**

- `js/staff-overview.js` (new) — `mountStaffOverview` / `refreshStaffOverviews`:
  paginated list (Name, `STF-…` id/username, Role, Department/class duty,
  Status), search + role/status filters, compact (4 rows) and full (6 rows)
  modes, quick actions Activate/Deactivate · Edit Details · View Profile — all
  through the existing `js/staff-management.js` dialogs (one management system,
  no duplicate auth), and a "full management" shortcut into the `staff` view.
  Access gate is the existing `staff.manage` capability.
- `admin.html` — two mounts: `#staffOverviewHome` (dashboard) and
  `#staffOverviewProfile` (profile), both `data-admin-cap="staff.manage"`.
- `js/admin.js` — mounts/refreshes both on panel entry and on staff changes.
- `css/ui-components.css` — overview + class/subject matrix styles using the
  existing design tokens.

**Deploy hygiene**

- `sw.js` — `js/staff-overview.js` added to the precache graph;
  `CACHE_VERSION` 255 → 256 and all `?v=` query strings bumped so clients
  never run stale JS.

## Test results (2026-10-10, this machine)

- Full jsdom suite (`npm test`): **988 tests — 985 pass, 0 fail, 3 skipped**.
- New tests (all green):
  - `tests/teacher-identity-scope.test.mjs` — 4/4 (key mapping, identity
    session, role-move/delete cleanup, pre-bridge fallback).
  - `tests/admin-profile-staff-surface.test.mjs` — 5/5 (Issue 3 boundary,
    Issue 4 mounts/capability, list+search+filter, quick actions+paging).
  - `tests/admin-nav-refresh.test.mjs` — 4/4 (fresh data on every
    activation, hash↔section consistency, repeated clicks, no page errors).
  - `tests/admin-nav-binds-once.test.mjs` — 1/1 (handlers bind exactly once).
- Playwright e2e (`npm run test:e2e:local`, bundled Chromium): the relevant
  subset (admin-navigation, admin-upgrades, admin-mobile-acceptance, teacher,
  exams, account-policy) gives **16 passed / 37 failed** — the *byte-identical*
  pass/fail set on the unmodified base commit `c2d0272` (verified in a clean
  worktree). These failures are pre-existing/environmental; this change set
  introduces **zero e2e regressions**.

## Authorization / roles — no regression

- Capability model untouched (`js/admin-permissions.js`): the new overview
  cards carry `data-admin-cap="staff.manage"` and disappear for non-admin
  seats via the existing `enforceCapabilities`.
- `createStaff` remains API-guarded (`withAdmin` + session check); quick
  actions call the same `changeStatus`/`openEdit`/`openProfile` entry points
  as the full screen.
- Student workflows, Firebase rules and role policies were not modified.

## Remaining issues

- The e2e Playwright suite has 37 pre-existing failures on the base commit in
  this sandbox (pixel-exact layout/clock assertions such as
  `#adminShell` width 480 and `#adminTodayDate` text). They are unrelated to
  these fixes and need their own pass.
- Manager-edited assignment rows (`activePlus.manager.teacherAssignments.v1`)
  and admin directory projections merge with "store wins"; an admin re-save
  re-asserts the directory rows. Documented behavior — the authoritative
  assignment data for Staff-Directory teachers is the directory projection.
- Real-device verification of the second-device realtime sync (E2E scenario C)
  is covered by the existing `sync-e2e` specs at parity with base; a manual
  two-device check remains advisable before release.
