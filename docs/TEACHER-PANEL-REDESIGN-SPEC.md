# Teacher Panel — Redesign Specification and Implementation Report

**Status:** UI interaction pass implemented after the user directed completion; local verification is green.
**Scope:** Teacher UX, navigation, workflows, data access/save behavior, permission presentation, notifications, settings, integrations and responsive behavior.
**Hard constraints:** Preserve every current feature and stored record; preserve existing role boundaries and workflow outcomes; no automatic deletion, schema rewrite, data migration, sync-mode switch or provider-rule deployment as part of this UI release.

This spec is the approved interaction contract for the delivered UI pass. Most feature surfaces and design-system work were already present; this implementation closed route/form, live-refresh, confirmation and stale-test gaps. Current implementation details and outstanding security boundary are recorded below and in `docs/TEACHER-PANEL-NAVIGATION-AUDIT.md`.

## 1. Goals and invariants

1. Replace the panel’s fragmented/legacy visual and interaction patterns with one coherent, mobile-first Teacher workspace.
2. Keep all current Teacher feature families and their records: home and shortcuts; classes and student context; routine and attendance; homework, suggestions and legacy marks view; examinations/question bank; courses/chapters/materials; lecture-sheet studio; notices; reports; notifications/history/settings; profile/password/logout; class chat.
3. Keep stable IDs, ownership, timestamps, status, content, progress, participant/attempt data, audit history, question keys, document JSON, attachments, drafts, local recovery state and unread/read receipts.
4. Enforce access in repositories/server workflows, not only by hiding buttons. Keep existing Teacher identity, Manager assignment, class/group/subject, ownership, roster and report scope checks.
5. Preserve offline/local-first behavior and show local save separately from cloud acknowledgement. Do not overwrite an in-progress form when live data refreshes.
6. Keep the current panel isolation/session gates, deep links, browser Back/Forward and aliases. No cross-panel navigation is introduced.
7. Treat destructive deletion as an explicit Teacher action on one record only. Confirm the exact object and consequences; never delete or migrate records implicitly.
8. Keep the existing Student reader/PDF behavior: published lecture-sheet reader uses the exact generated PDF artifact used for download; linked/uploaded PDFs open their original source; no HTML re-layout of a PDF.

## 2. Proposed design and interaction model

### Shell and navigation

- One shared Teacher shell: compact brand/header actions, responsive content frame, persistent bottom navigation on phone and equivalent accessible navigation on wider screens.
- Preserve current primary destinations and all existing feature doors, including the current compact Home launcher and four-seat navigation model; no standalone student roster seat is assumed because that list was deliberately removed while student data remains used in class/detail, attendance and review workflows.
- Home remains a launcher/status overview, not a recent-work feed. Keep all current shortcuts and counts but remove duplicated doors; all features remain reachable from their owning hub/list.
- Use one heading hierarchy, one spacing/type/color system, consistent status badges and action priority. Long forms/tables become full-page surfaces on mobile; compact confirmations use accessible dialogs.
- Keep Bangla-first labels, local Dhaka dates/digits as currently required, familiar technical terms where appropriate, and clear role/status copy.

### Routes, details and forms (proposed contract)

- Feature entry opens the owning screen and URL hash. Direct hash/refresh reopens it; old `#exam`/`#routine` inbound aliases continue to work. Unknown routes safely fall back to Home without exposing data.
- Feature tabs/filters/modes remain local controls, not unnecessary history entries: routine category filters, exam hub modes, report/course modes and list filters.
- Activity, class, student-in-class, course, notice and attendance session each have a focused detail surface with a correct parent Back destination.
- Proposed default: long create/edit/progress forms live as route-backed page states within the feature/detail flow, not a modal floating over an unrelated hub. Keep short confirmations as dialogs. Cancel returns to the same feature and restores prior filter/page/scroll. This deliberately supersedes old tests that expect legacy modals; confirm this contract before coding.
- Preserve current legacy deep links and fallback parent behavior. Store screen-local search/filter/page/tab state in route history/session state; Back/Forward must restore it. The current code resets scroll on each view and does not guarantee restoration; this is a proposed improvement.

## 3. Screen and workflow specification

| Screen/workspace | Required redesign behavior and retained actions |
|---|---|
| **Home** | Signed-in teacher greeting; today’s assigned classes; pending counts/status; compact launcher. Keep the current five feature doors (two hubs + three shortcuts) or an equivalent non-duplicated layout retaining every destination. No home work feed. Show honest loading/error/empty and retry states. |
| **Academic hub** | One door each for homework, suggestion, exam/question-bank workspace, materials/courses, lecture sheets and notices as currently routed. Badges derive from canonical stores; async counts must not flash false zero or leak out-of-scope totals. |
| **Records** | Separate lanes for homework, suggestion, attendance sessions and legacy marks (read-only/redirect to exam workflow). Search, class/status filters, counts, stable paging, detail cards, create/edit, progress/review and explicit delete. Preserve due ordering and draft/published visibility. |
| **Activity detail / form** | Keep title, subject, class, group, date/time/duration, room, marks, details/resource URL and publish/draft fields as type-appropriate. Preserve current length/date/time/status validation, collision checks, stable record identity and progress-preserving class/group restrictions. Form errors keep entered values. |
| **Homework review** | Per-student status/comment/attachment/answer visibility; search, only-pending, bulk-fill and mark-reviewed. Validate selected students against the assigned approved roster. A save updates the same activity/progress record and student-facing view without losing comments or attachments. |
| **Classes and student detail** | Assignment-scoped classes/groups and subject chips; class detail routes to class work/routine and contains assigned student context; student detail reveals only approved fields currently displayed. No reintroduction of the removed standalone roster/list/nav seat without separate approval. Do not expose unrelated student fields. |
| **Routine and attendance** | Manager remains owner/editor of weekly schedule; Teacher schedule stays read-only. Preserve Today, Tomorrow, Week, Class, Exam, Changed, Holiday, Important and Other filters. Session detail/create captures date/time/room/note and attendance for only assigned approved students; existing-session edit, collision, late edit policy and grade-audit history remain intact. |
| **Exams and question bank** | One exam hub with home/create/upcoming/archive/question-bank/results paths. Preserve exam and question filters, paging, templates, paste/bank/single-entry methods, question edits, paper ordering, grading, attendance, reports/CSV/PDF and status transitions. Teacher can author assigned papers and request review; only Admin/Manager review/approve/publish. Keep attempts, participants, answers/private keys, result data and review notes intact. Explicitly confirm irreversible exam delete. |
| **Courses/materials** | Distinguish course list/detail, chapter progress, create/edit and content/material editor. Preserve class/subject/group assignment filters, chapter order/status/date, course draft/published state, rich text, attachments, content search and status actions. Keep permanent delete as an explicit confirmed action; archive remains recoverable. |
| **Lecture-sheet manager/studio** | Preserve assigned class/subject filters, create/edit/publish/draft/archive/restore/delete, version history and recovery/conflict states. Keep all rich editor commands (formatting, lists, alignment, tables, images, equations, page breaks, page settings, page navigation/zoom), preview/print/download/fullscreen/exit. Enforce owner/scope/version and content-size checks. Never discard local recovery or conflict copies without an explicit choice. |
| **Notices** | List filters by class; own-notice detail; create/edit title/body/category/class/group/draft/published; publish/unpublish/delete. Preserve existing audience semantics and own-author behavior. Add record-specific confirmation to delete. Current local handler checks assigned class but not a dedicated repository session/subject gate; proposed implementation must use the approved authorization service and preserve group targeting. Do not confuse a notice record with the per-viewer notification store. |
| **Reports** | Teacher catalog only; assignment-filtered classes/students/sessions/exams; declared filters only; periods/custom dates validated; role gate before document generation; accurate scope lines, honest empty/error state, paged preview and same-document PDF download. Preserve report/summary local mode behavior unless the approved route contract changes it. |
| **Notifications and history** | Bell/unread badge routes to Teacher history as currently intercepted. Preserve search, category/priority/read filters, item detail, mark-read/read-all/open-target, active vs archived semantics, retention/device limits and per-viewer read state. Settings shows browser permission, master/background/in-app controls, type preferences, preview, recent records and full history. Disabled/unsupported/denied permission states remain understandable; a disabled setting must not look interactive. |
| **Profile, Settings, password and logout** | One account group with editable full name/mobile/email; login ID/staff ID remain immutable; current/new/confirm password; errors and success; logout terminates the device session. Preserve five settings groups, theme, install, notification, session/device, offline data and storage info. Read-only info remains read-only; do not display secrets. |
| **Class chat** | Preserve per-class rooms, unread counts, membership/access gate, search/jump, reply/quote, reactions, emoji, send states, draft-preserving live updates, message ownership/soft delete, scroll restoration and full-screen mobile keyboard behavior. Keep plaintext off cloud relay, AES-GCM failure-closed, 7-day relay expiry while local history remains. |

## 4. Permission and data contract

| Operation | Required authorization / data contract |
|---|---|
| Open Teacher shell | Active device-bound Teacher session/profile; panel entry switch; capability/route gate; cross-panel guard. Re-check session when it changes. |
| Read teaching/course/exam/content | Current Teacher identity + own record + Manager-assigned class/group/subject; approved roster scope. Do not trust URL IDs, local filters or visible controls. |
| Write activity/progress/attendance | Active Teacher session and profile; own assigned record; matching assigned approved students; current validation, schedule conflict and attendance edit policy/audit. |
| Write course/lecture content | Active role/session; class/subject/group assignment and record author; stable ID and optimistic version. Preserve inactive/archived records; hard deletion only from explicit confirmed action. |
| Exams | Teacher edits own assigned papers; immutable status/attempt constraints; Manager/Admin review/publish; students only get eligible participant copies and no answer key. |
| Reports | Role catalog + `enforceAccess` scope is authoritative; UI filters cannot broaden assigned scope. |
| Notices | Preserve class/group audience; only own Teacher notice actions in UI. Current v1 notice path is weaker than teaching/course repository gates. Prefer the existing V2 claim-scoped draft/publish design only after migration readiness and test gates; no V2 rules deploy as a cosmetic change. |
| Chat | Same-class/approved student restrictions; staff roles’ existing participation rights; staff moderation limits and delete ownership. Preserve local archive and per-class unread state. |

### Data-preservation rules

- Keep all keys and stable IDs by default. Preserve unknown/legacy optional fields when editing. No bulk rewrite, import/export, schema normalization, deduplication, orphan cleanup or data deletion without a separately reviewed, backed-up migration.
- Archive/unpublish must not erase the underlying record, student responses, history or results. Keep explicit hard-delete affordances only where they currently exist, with an exact record name, effect summary and confirmation.
- Preserve local drafts and recovery stores during offline sessions, refresh, update and conflict. Display truthful save/sync state.
- Existing user-visible features remain; this spec does not restore already-retired surfaces (e.g. standalone Teacher student roster or Home recent-work feed).

## 5. Integrations and security boundary

- Preserve current localStorage-backed repositories, realtime listeners/events, storage bridge, record sync, Supabase/Firebase provider selection, offline queue/retry/conflict behavior, notification delivery, push permission and chat relay. UI must distinguish local save, queued, synced, offline and failed.
- **Known high-risk current state:** README documents legacy anonymous `activePlusSync/v1` sync active in default local mode and current broad `auth != null` RTDB rules; Supabase RLS also allows `anon/authenticated` on that sync path. These are not per-Teacher server authorization. Do not claim the Teacher UI gate secures the backend.
- Reuse existing staged V2 work only through an explicit backend project: draft rules are not deployed; `firebase.json` targets the current rules; V2 sync requires real claims and currently does not replace the v1 bridge. Before any cutover: inspect `docs/RTDB-PER-USER-RULES-PLAN.md`, `docs/FIREBASE-SYNC-AUDIT.md`, run generated-rule equality + Firebase Emulator tests, rehearse migration on backup/staging, verify data counts/ownership/projections, exercise rollback, and obtain separate approval. Do not disable legacy sync or deploy draft rules in this UI implementation without that approval.

## 6. Accessibility, responsive behavior and visual QA

- Phone-first layouts at 320/360/375/390px; tablet 600/743/844px; desktop 1024/1280px. No horizontal overflow, keyboard-overlay-hidden submit, clipped Bangla text or invisible fixed navigation.
- Touch targets at least 44px for primary interactive controls; logical focus order; visible focus; proper labels, field errors, status announcements, dialog focus trap/restore; semantic tabs with selected state; reduced-motion and high contrast/readability.
- Loading, empty, permission-denied, offline, retry, stale/conflict, save-success and destructive confirmation states are designed for every feature family. Preserve draft content on all recoverable errors.
- Use accessible contrast, consistent status color + text (never color only), icon labels and stable visual hierarchy across modules. Chat may retain its distinct full-screen conversation presentation while sharing tokens and accessibility contract.

## 7. Test and acceptance plan

### First repair the baseline contract

Existing tests disagree with the current routed-detail forms: `teacher-panel.test.mjs`, `teacher-navigation-2026-11-01.test.mjs`, `workflows-e2e.test.mjs` and `teacher.spec.cjs` assert legacy modal/list-card controls. Update those tests only after this spec is approved; separate stale selector updates from actual behavior changes. Keep the current failing baseline recorded until green.

### Required coverage before release

1. Teacher route/deep-link/refresh/Back/Forward and parent-state restoration for every screen/detail.
2. Repository negative tests for wrong Teacher, wrong class/group/subject, stale session, disabled staff, unapproved student, and crafted direct action IDs.
3. CRUD preservation by record type: create/edit/publish/draft/archive/restore/delete; stable IDs, unknown fields, progress, attempts, keys, version history and recovery.
4. End-to-end Teacher → student workflows: homework, suggestion, attendance/routine, exam submit/review/publish/results, course/chapter/lecture sheet, notice audience, notification targets and report output.
5. Failure tests: local quota/write error, corrupt store fail closed without data loss, offline queued save, interrupted sync/retry/conflict, live update during form, push denied/unsupported, recovery after reload.
6. Notification tests for Teacher-specific source eligibility, no self-notification, per-viewer read/clear state, cross-device sync, retention, open-target and history.
7. Chat same-class/cross-class/ownership, encrypted relay, expiry/local history, 320–390px keyboard/scroll and full-screen exit.
8. Desktop/mobile keyboard and screen-reader semantics for every modal/page form and nav state; run relevant Playwright specs at all target widths.
9. Current baseline suites plus full unit suite, security rule generator equality, V2 emulator/cutover rehearsal if backend work is separately approved. No release based only on JSDOM or mocked transport.

### Acceptance gates

- Every current feature and record remains reachable or is explicitly called out as an existing removed feature; no unapproved deletion.
- All Teacher reads/writes remain correctly scoped and server/backend limitations are not hidden.
- No accidental key/schema/provider/rules migration; user-entered form data survives failure.
- Test suite green under the approved interaction contract, including desktop/mobile E2E and role/security negatives.
- Rollback path, data backup verification and draft PR review completed before deployment.

## 8. Delivered implementation and release status

### Implemented

- Long activity create/edit/progress/review/delete forms use routed detail pages instead of overlays. Detail routes keep record context; create cancellation returns to the owning list and removes the transient route from history.
- Class cards open scoped class details before entering class work. Existing route aliases, session gates and four-seat navigation remain.
- Detail and notification screens meet the compact date/advice header contract; detail has a dedicated daily-advice bank entry.
- Realtime/storage refresh is deferred while an inline editor is active and applied after it closes; failed reads can be retried/recovered without resetting the form.
- Activity, notice, course and chapter hard deletes have record-specific confirmation. Notice actions re-check Teacher ownership before mutation; cancelled confirmation leaves the stored record unchanged.
- Stale modal/list-card test expectations were updated to exercise the routed-page interaction contract. Release/cache pin was advanced to 482 across pages, static assets, the service worker and cache identity.
- No stored record, schema, stable ID, role grant, provider, notice audience, Firebase/Supabase rule or production dataset was migrated or changed.

### Validation completed

- Full Node suite: `npm test` — **1,623 passed, 0 failed, 4 skipped (1,627 total)**.
- Teacher browser suite: `npm run test:e2e:local -- tests/teacher.spec.cjs` — **17/17 passed**, including phone breakpoints 320/390, tablet/desktop, offline behavior, class progress, Student reflection and Manager exam approval separation.
- Focused Teacher → Student notice workflow: **1/1 passed**. Relevant assignment/routing, advice, notification, class, deletion and release-pin suites also passed in focused runs.
- Last `git diff --check` must be rerun after the final documentation update.

### Explicitly not part of this UI delivery

The app-wide backend cutover is not complete. Default local mode’s documented anonymous legacy `activePlusSync/v1` risk remains. Staged V2 rules are not deployed; simulator coverage is not Firebase Emulator/live-project validation. No Supabase/Firebase project or Vercel deployment was changed. Before production deployment, separately complete generated-rule parity, Firebase Emulator tests, backup/staging migration rehearsal, ownership/count verification, rollback exercise and security review. Do not present current cloud authorization as per-Teacher server enforcement.

PR #125 remains open/draft. No commit, push, PR promotion or production deploy was performed in this pass.
