# Teacher panel navigation audit

**Date:** 2026-11-10  
**Scope:** Every Teacher-shell destination, feature tile, icon/shortcut, record list, modal/detail surface, and navigation control. This is a behavioral audit, not a visual-only pass.

## Agreed navigation contract

- A destination opens a full Teacher-shell screen, updates the hash, survives refresh/deep link, and participates in browser Back/Forward.
- The shared five-seat bottom bar remains visible. A fixed bottom Back control is available on non-Home screens.
- List/detail flows are separate screens. Full descriptions and record actions do not expand in the list row.
- Clicking a feature card/row opens its destination; internal filters, search, tabs, and simple status controls remain controls on the current screen.
- Home shortcuts open their feature directly. The Exams feature remains a single hub. Academic tools, class/routine/attendance/student work, Profile, Settings, and notifications have distinct destinations.
- Returning preserves the prior filter, scroll, and unsaved draft state where applicable. Unauthorized feature entry points are not exposed.
- Desktop and mobile share the same route model.

## Current Teacher navigation inventory and findings

| Surface / visible control | Current destination or behavior | Audit result / required contract |
|---|---|---|
| Topbar chat icon and Home chat card | `#class-chat`, dedicated Teacher view | Correct destination; keep as a full screen and retain fixed bottom navigation. |
| Topbar bell | Opens the shared notification inbox overlay; notification history opens a separate fixed overlay | Not a routed page. Add a Teacher notifications page; history/detail should remain within that page. |
| Topbar logout | Ends the device-bound Teacher session and returns to login | Correct non-navigation action. |
| Home Academic hub card | `#academic` | Correct full-screen destination. |
| Home Today's class rows | Render as non-interactive rows | Defect: class rows should open a class detail screen. |
| Home Homework / Exams / Routine cards | `#homework`, `#online-exams`, `#routine-view` | Direct routes already exist; preserve direct entry. |
| Bottom seats: Home, Work, Academic, More | `#home`, `#classes`, `#academic`, `#more` | Route to screens; browser history currently is replaced rather than pushed. |
| Bottom Finance seat | Visible but disabled for Teacher | Deliberate shared five-seat role gate; do not expose a financial destination. |
| Work → My Classes card / class card | Card currently leads to the homework list and filters by class; class-subject chips are hidden | Defect: expose the class list as the Work screen, and open each class/section on its own detail screen (including assigned subjects/students). |
| Work → Routine card | `#routine-view` | Dedicated screen exists. Routine day/category tabs are same-screen filters. |
| Routine slot → Attendance & session notes | Opens the progress form in a modal | Defect: session/attendance entry should be a routed detail screen, not an overlay. |
| Academic → Homework / Suggestion / Notice | Dedicated `#homework`, `#suggestion`, `#notice` screens | Routes exist; list-row details/actions currently use modals or inline previews and need detail screens. |
| Academic → Question bank / Exams | Opens an exam-workspace mode inside `#online-exams` | Keep one Exams hub per owner decision; workspace mode controls are same-page tabs, not separate route entries. |
| Academic → Lecture Sheets | Dedicated `#lecture-sheets` screen with the A4 authoring studio | Correct feature destination; retain the studio as its own full-screen workflow. |
| Academic → Materials | Opens `#courses` | Destination exists, but materials/progress/new-material tiles currently switch modes in the same screen. Make feature entry points explicit routed screens. |
| Records list (Homework, Suggestion, Attendance, Marks) | Four route-backed lanes; search/status/class filters and type tabs | Filters stay on-page. Record cards currently show a text preview and Details/Edit/Progress/Delete actions open overlays. Move full text and record actions to the record detail screen; list cards should navigate as a whole. |
| Exams hub tiles (Create, Upcoming, Archive, Question Bank, Results) | `state.examScreen` changes inside the same workspace, but hash remains `#online-exams` | One hub is approved; retain hub modes as same-screen controls and preserve selected mode through refresh/back within the hub if it is actual navigation. |
| Notice list | Body preview and edit/publish/delete actions are all on the list card | Defect: compact list row opens a separate notice detail screen; actions live on that detail screen. |
| More → Reports | `#reports` | Destination exists, but generator/summary feature cards only change an in-page mode. Give each feature its own route-backed screen. |
| More → Profile / Settings | `#profile` / `#settings` | Dedicated views exist. Profile edit/password entry currently opens a modal; convert the relevant feature form to a page surface. Settings accordions and toggles remain same-page controls. |
| More → Change password | Shared modal | Feature entry should be a dedicated Teacher page; submit/cancel remain page actions. |
| More → Theme | Toggles theme in place | Correct same-page control; not a destination. |
| More → Logout | Ends session | Correct non-navigation action. |
| Profile, class, notice, course, activity records | Several rows show details inline or open generic modal; some class rows route to homework | Defect: each selected record/class opens a named detail page, with a clear fixed Back control and the correct parent list. |
| Course/progress tools | Course rows render all chapters and change/delete controls in the same list surface; create/edit dialogs are overlays | Separate course detail page; chapter progress controls stay in that detail page. Creation/edit is a page-mode action, not an expanded list detail. |
| Disabled/gated feature entry points | `panel-capabilities.js` hides or gates configured routes; Finance seat is visibly disabled | Keep unsupported feature cards hidden; preserve role check on every route/deep link. |
| Existing `pay-back` controls | Present in markup but hidden by Teacher skin; no consistent route-history integration | Defect: add one visible fixed bottom Back control and use history with a safe parent fallback for direct links. |

## Acceptance checks

1. Every visible Teacher feature card, header icon, class/record row, and enabled bottom seat has an explicit destination or is documented as a same-screen control/action.
2. Feature entry changes the Teacher screen and hash; refresh opens the same destination.
3. Browser Back/Forward returns to the exact prior screen; Back control uses the same route stack and falls back to the proper parent when a page was opened directly.
4. No full activity, notice, class, student, course, or attendance-session details are expanded in a list/dashboard row.
5. Search, filter, routine tabs, exam-hub mode tabs, theme switches, and chapter status controls do not create unnecessary route entries.
6. Home shortcuts deep-link directly; all list/detail pages preserve the parent list's filter/scroll on return.
7. Direct routes remain role-gated, and unavailable features do not reveal protected data.
8. The same behavior passes at mobile and desktop viewports, and the persistent bottom navigation remains available.
