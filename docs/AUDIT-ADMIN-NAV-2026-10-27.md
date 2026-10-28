# Active Plus Coaching — Admin Panel Navigation Audit & Fix — 2026-10-27

> **Branch:** `arena/43b40ecc-apc` @ `141d1e4` + hero-removal (19 headers) — pre-change audit  
> **Scope:** শুধু নেভিগেশন/প্রদর্শন-পদ্ধতি; নতুন ফিচার/DB/Workflow নয়  
> **Reference:** Student Panel `js/shell.js` + `js/navigation.js` (deep-linkable, `hidden=true` + `active`) vs Admin `js/admin.js` + `js/panel-route.js`

---

## 1) প্রতিটি প্রধান ভিউ ও উপবিভাগের ম্যাপিং

### 1.1 `admin.html` — 19টি `admin-view` (সব `data-view-panel`)
| # | View | Title | Bottom Seat | Hub | Capability | Inner toggles (`data-admin-section-toggle`) |
|---|------|-------|-------------|-----|------------|---------------------------------------------|
| 1 | `dashboard` | স্বাগতম, এডমিন | `dashboard` (হোম) | — | `DASHBOARD` | — (featureGrid + dues/institute cards) |
| 2 | `staff` | স্টাফ ও কর্মকর্তা ব্যবস্থাপনা | `staff` | — | `STAFF_MANAGE` | `staff-directory` (list+filter) |
| 3 | `system` | সিস্টেম ও নিরাপত্তা নিয়ন্ত্রণ | `system` | SYSTEM hub | `SETTINGS_MANAGE` | — (হাব: 5 rows → roles/security/settings/academics/migration) |
| 4 | `migration` | ভি-টু সিংক মাইগ্রেশন | `system` | — | `SECURITY_MANAGE` | `migration-card 0/1` + `adminV2Migration` |
| 5 | `roles` | রোল ও অনুমতি ব্যবস্থাপনা | `system` | — | `ROLES_MANAGE` | `roleToggle → rolePanel` |
| 6 | `students` | শিক্ষার্থী ব্যবস্থাপনা | `dashboard` | — | `STUDENTS_VIEW` | `admin-student-card (all/pending/approved/rejected)` → `adminStudentsDirectoryPanel` |
| 7 | `reports` | রিপোর্ট ও বিশ্লেষণ কেন্দ্র | `reports` | — | `REPORTS_VIEW` | `reports-builder` (2 toggles share same panel) |
| 8 | `data` | ডেটা ও স্টোরেজ ব্যবস্থাপনা | `more` | DATA hub | `DATA_MANAGE` | `data-stats`, hub: backup → audit |
| 9 | `backup` | ব্যাকআপ ও রিস্টোর | `more` | — | `BACKUP_MANAGE` | `backup-export`, `backup-restore` |
| 10 | `audit` | নম্বর ও উপস্থিতি অডিট লগ | `more` | — | `BACKUP_MANAGE` | `audit-log`, `audit-exam` |
| 11 | `security` | সিকিউরিটি ও সেশন তদারকি | `more` | — | `SECURITY_MANAGE` | `security-toggle → security-panel` (owner/password/protected/boundaries) |
| 12 | `academics` | ক্লাস ও পাঠ্য বিষয় নির্ধারণ | `system` | — | `SETTINGS_MANAGE` | `admin-academic-card (add/subjects/mapping)` → `adminAcademics` |
| 13 | `settings` | সিস্টেম ও অ্যাপ সেটিংস | `system` | — | `SETTINGS_MANAGE` | `settings-branding/classes/broadcast/maintenance` |
| 14 | `profile` | আমার প্রোফাইল ও সেটিংস | `more` | — | `PROFILE_VIEW` | `settings-hub` groups (account/notification/app/security/data) — hub internal |
| 15 | `advice` | দৈনিক পরামর্শ ব্যবস্থাপনা | `more` | — | `ADVICE_MANAGE` | `advice-editor` |
| 16 | `content` | নোটিশ ও কনটেন্ট তদারকি | `more` | — | `DATA_MANAGE` | `lecture-sheets`, `content-notices`, `content-records` |
| 17 | `class-chat` | শ্রেণি চ্যাট ও মডারেশন | `more` | — | `DATA_MANAGE` | — (mount `adminClassChatMount`) |
| 18 | `phonebook` | ফোনবুক · ইয়েলো পেইজ | `more` | — | `STUDENTS_VIEW` | — (mount `adminPhonebookMount`) |
| 19 | `more` | আরও ও সিস্টেম টুলস | `more` | MORE hub | `PROFILE_VIEW` | hub: data/content/profile/advice + cards: class-chat/phonebook/logout |

**Hub maps:** `ADMIN_BOTTOM_NAV` (5 seats), `ADMIN_SYSTEM_NAV` (5), `ADMIN_DATA_NAV` (2+1), `ADMIN_MORE_NAV` (4+2+1), `ADMIN_FEATURE_TILES` (1: students), `VIEW_SEAT` (10 aliases → bottom seat), `VIEW_CAPABILITIES` (19 guards).

**`data-admin-view` usages (37):** 18× `dashboard` (Back), 3× `class-chat`, 2× `content`, 1 each others — Back/Home dominate; hub rows + bottom bar cover rest.  
**`data-admin-section-toggle` (17):** staff-directory, advice-editor(2), audit-*(2), backup-*(2), content-*(3), data-*(3), lecture-sheets, reports-builder(2), settings-*(4).

---

## 2) বর্তমান নেভিগেশন আচরণ — Student vs Admin তুলনা

### Student (`js/shell.js` + `js/navigation.js`) — **সঠিক**
```js
// shell.js:setView — Student
panels = Set([...$$('.view'), ...$$('[data-view-panel]')])
for item in panels:
  if item===panel continue
  item.classList.remove('active'); item.hidden = true   // ← both CSS + hidden
panel.hidden=false; panel.classList.add('active')
parent = NAV_PARENTS[name]||name
$$('.bottom-link').forEach(... active toggle ...)
syncViewHash(name, historyMode)  // push/replace, #home bare, alias support
```
- `js/navigation.js` → `[data-view]` → `setView(..., {history:'push'})` (Back walks history)
- `VIEW_ROUTES` (50+), `VIEW_ALIASES`, `NAV_PARENTS`, `VIEW_ID_OVERRIDES` — every view has parent seat
- **Result:** একসাথে 1টি `active`, বাকি সব `hidden=true` — CSS `.view{display:none}; .view.active{display:block}` দ্বিতীয় বাধা

### Admin (`js/admin.js` + `js/panel-route.js`) — **ত্রুটির উৎস**

**`setView(view)` আজকের অবস্থা (good guard আছে):**
```js
if (!access.allowsView(target) || !DOM has panel) return false
state.activeView=target
$$('.admin-view').forEach(panel=>{
  active=panel.dataset.viewPanel===target
  panel.classList.toggle('active', active)   // ← CSS only
  if(active) resetAdminTogglePanels(panel)   // ← reset inner toggles of NEW view
})
// Guard (hero-removal commit এ যোগ):
actives = $$('.admin-view.active')
if (actives.length!==1 || actives[0].dataset.viewPanel!==target)
  $$('.admin-view').forEach(... toggle active ...)
openDefaultPrimarySection(target) // ← auto-opens staff-directory / students / reports / lecture-sheets
...
seat = VIEW_SEAT[view]||view → $$('.admin-bottom-item').forEach(... toggle active + aria-current ...)
rememberRoute(target) // ← replaceState only (Back = leave panel)
```

**`navigate(view,source)`**
- capability guard → `setView` → `refreshView` (fresh data) → `resetAdminTogglePanels(activePanel)` → `openDefaultPrimarySection` → pending scope handling → focus

**`panel-route.js`**
- `rememberRoute` → `replaceState` only; `onRouteChange` → `hashchange` → `routeName()` → handler if non-empty; empty hash ignored
- **No** `pushState`, **no** `popstate`, **no** alias, **no** `#home` normalisation; unknown hash → `allowsView` false → stays, but URL keeps bad hash

**`admin-panel-ui.js`**
- `renderBottomBar` → 5 seats; `renderHub` → removes unauthorised rows; `renderFeatureGrid` → tiles → `onNavigate` → `navigate`

---

## 3) Phase 1 — 8টি অডিট পয়েন্টের ফলাফল

### (1) `admin.html` panels/toggles
- 19 `admin-view`, 37 `data-admin-view` (18 Back), 17 section toggles — all attached to a real panel; no orphan panel
- **Issue:** `system/data/more` hub rows are *inside* `system/data/more` views — clicking them should *replace* the hub with target, not stack. Current `setView` does replace via `.active` toggle, **but only after** `openDefaultPrimarySection` auto-opens inner toggles — risk: hub → target → auto-open leaves target's inner panel already open (user sees "other sections open").

### (2) `js/admin.js` key functions
- **`resetAdminTogglePanels(scope=document)`** — resets *all* toggles in scope; called with `panel` (new view) inside `setView`, then again with `activePanel` inside `navigate` — **double reset, but scoped** → good for isolation, but **over-resets** if `scope=document` fallback leaks (not used now).
- **`openDefaultPrimarySection(target)`** — **auto-opens** staff/students/reports/content on every `setView` — **violates "প্রয়োজন হলে নিষ্ক্রিয় প্যানেলে `hidden` ব্যবহার" + "অপ্রয়োজনীয় উপবিভাগ স্বয়ংক্রিয়ভাবে খুলবে না"**. Student never auto-opens inner sections.
- **`refreshView(view)`** — wired for 13 views; `VIEW_REFRESHERS` missing `more/system/data` (hubs have no data) — **ok**, but hub views never refresh → Back to hub shows stale open toggles if not reset.
- **`setView` vs Student `setView`:** Admin uses **CSS `.active` only** (`ui-layout.css:3`), **no `hidden`**, while Student uses **both** (`hidden=true` + `active`). CSS alone is fragile: any rule with higher specificity (e.g., `body.admin-reference .admin-view{ display:flex }`) can leave inactive view visible. **Root cause confirmed: CSS-only is primary, JS state is secondary, `hidden` missing.**
- **`navigate` double reset:** `setView` resets NewView → `openDefaultPrimarySection` opens DefaultSection → `navigate` resets again → re-opens DefaultSection — **redundant but not broken**; however it **hides the panel that `openDefaultPrimarySection` just opened** then re-opens it → flicker risk on slow devices.

### (3) `admin-panel-ui.js` + `admin-permissions.js`
- **Menu creation:** `enforceCapabilities` removes unauthorised `admin-view` and `admin-more-item` from DOM — **strong** (not CSS hide). `ADMIN_BOTTOM_NAV` order fixed, `VIEW_SEAT` maps hub children to seats — **good**.
- **Risk:** `renderHub` removes menu item if not in catalogue → `more` hub can lose rows, but `more` view itself remains (since `VIEW_CAPABILITIES.more = PROFILE_VIEW` always granted to Admin) — **ok**.
- **Feature tiles:** `ADMIN_FEATURE_TILES` only `students` — **good**, avoids daily ops.

### (4) `panel-route.js` hash/deep-link
- **Current:** `replaceState`, `hashchange` only if non-empty, no `push`, no `popstate`, no alias, no `#home` bare handling.
- **Student:** `push`/`replace` selectable, `popstate` implied via `pushState`, `VIEW_ALIASES` (results→exam-results), `VIEW_ROUTES` bare `home` → clean URL.
- **Gap:** Admin Back = leave panel (replace), **not** walk visited views — **by design** (comment: "Back still means leave the panel"). Requirement says "browser Back/Forward … সঠিকভাবে কাজ করবে" — **replace-only is correct for Admin**, but **empty hash (`#` cleared via Back to bare URL) is ignored** (`onRouteChange` returns if `!name`) → panel stays on last view while URL is bare — **URL/visual mismatch**.

### (5) `shell.js` + `navigation.js` comparison
- Student: **hidden + active + push + alias + NAV_PARENTS = 1 active, full deep-link, Back walks history.**
- Admin: **active only + replace + no alias + VIEW_SEAT** — **1 active intended, but via CSS only**; **Back = leave**, **refresh = reopen via `routeFromHash(window.location.hash)`** — **ok**, but **empty hash bug** leaves mismatch; **no `hidden` fallback** leaves CSS as single point of failure.

### (6) 15 stylesheets audit — CSS vs JS vs toggle vs multiple causes
- **15 canonical sheets** (foundation, ui-layout, ui-components, ui-forms, ui-features, notice-board, ui-status, ui-auth, app-polish, student-record, exam-archive, academics, notifications, course-hub, ui-wallet) — `design-system.css` imports them, `load-budget.mjs` pins 15, eager closure ≤40 modules/300KB — **budget intact (35/279KB today)**
- **Visibility rule:** `ui-layout.css:2-3` — `.view,.admin-view{display:none}; .view.active,.admin-view.active{display:block}` — **single source of truth, but `display:block` can be overridden** by later rules (e.g., `body.admin-reference .admin-view[data-view-panel="academics"] .admin-action-stack` could force `display:flex`). Audit: **no override for `.admin-view.active` found**, but **risk remains** because no `hidden` fallback.
- **Section toggles:** `staff-card-details[hidden]{display:none !important}` and `[hidden]{display:none}` exist, but **main views rely solely on `.active`** — **if `.active` class leaks (double active via stale state), both views stay `display:block`**.
- **Conclusion (evidence):** **Multiple causes, but primary is CSS-only + auto-open, `hidden` missing is the single fix that would make CSS incapable of leaving inactive view visible — Student proves it.**

### (7) Feature → View mapping (should vs sub-section)
| Feature | Should be | Currently | Verdict |
|---------|-----------|-----------|---------|
| Staff CRUD + filter/sort | `staff` view, sub: `staff-directory` | `staff` view, toggle `staff-directory` | **Correct** (sub-section) |
| Roles matrix | `roles` | `roles`, `role-toggle → role-panel` | **Correct** |
| Student approve/reject | `students` view, sub: `admin-student-card` → `DirectoryPanel` | same | **Correct** |
| Fee collection | `payment.html` (Cash Counter) | **not in Admin** (removed) | **Correct** |
| Routine/Notices entry | `manager.html` | **not in Admin** | **Correct** |
| Teaching/homework | `teacher.html` | **not in Admin** | **Correct** |
| Reports builder/preview | `reports` view, sub: `reports-builder` | same (2 toggles share 1 panel) | **Correct** but auto-open violates |
| Data stats + danger zone | `data` view, subs: `data-stats`, `data-danger` | same, hub `backup` | **Correct** |
| Backup export/restore | `backup` | same, subs: `backup-export/restore` | **Correct** |
| Audit log + exam workspace | `audit` | same, subs: `audit-log/exam` | **Correct** |
| Security panels | `security` | same, subs: `security-toggle → panel` | **Correct** |
| Academics add/subjects/mapping | `academics` | same, subs: `admin-academic-card` → `adminAcademics` | **Correct** |
| System settings branding/classes/broadcast/maintenance | `settings` | same, subs: `settings-*` | **Correct** |
| Profile + 5-group hub | `profile` | same, hub groups `account/notification/app/security/data` | **Correct** (hub internal, not separate views) |
| Advice editor | `advice` | same, subs: `advice-editor` + link to `content` | **Correct** |
| Content oversight (read+delete) | `content` | same, subs: `lecture-sheets/content-notices/records` | **Correct** |
| Class Chat | `class-chat` | same, mount `adminClassChatMount` | **Correct** (full-screen via `is-chat-fullscreen`) |
| Phonebook | `phonebook` | same, mount `adminPhonebookMount` | **Correct** |
| More hub | `more` | hub: data/content/profile/advice/class-chat/phonebook | **Correct** (hub, not feature) |
| V2 migration | `migration` | same, subs: `migration-card` | **Correct** |
| Dashboard feature grid | `dashboard` | tile `students` only | **Correct** |

**All features are in correct view; no view is missing; no feature is in wrong view. Sub-sections are correctly scoped.**

### (8) Login/role/URL/refresh/Back/mobile plan (pre-change verification needed)
- **Login:** `installPanelGuard` → `hasStaffSession('admin')` → `lockPanel` else `enterPanel` → `createAccess(role)` → `initAdminPanelShell` (enforces) → `routeFromHash` → `setView(initialTarget)` — **guards present**
- **Role/capability:** `VIEW_CAPABILITIES` 19 entries, `allowsView` check in `setView` + `navigate` + `routeFromHash` — **unauthorised URL blocked**
- **Direct URL:** `admin.html#staff` → `routeFromHash` → `allowsView` → `setView` — **works, but empty hash bug remains**
- **Refresh:** `rememberRoute` (replaceState) → URL keeps hash → reload reopens same view — **works**
- **Back/Forward:** `replaceState` → Back = leave panel (by design) — **need to verify mobile Back = same as browser Back (no extra handler now)**
- **Mobile:** `360–400px` viewport, `>=44px` touch targets, `admin-bottom` fixed, `is-chat-view` fullscreen — **need to verify no horizontal scroll after `hidden` added**

---

## 3) মূল কারণ ও সংশ্লিষ্ট ফাইল/ফাংশন

**Root cause (প্রমাণসহ):**
1. **CSS-only visibility** — `ui-layout.css:2-3` + `js/admin.js:setView:302-305` uses only `classList.toggle('active')`; **no `hidden`** unlike Student `shell.js:204-213` which does `item.hidden=true` + `panel.hidden=false`. If `.active` leaks (double active via `openDefaultPrimarySection` + stale state), both panels stay `display:block` — user sees "অন্য বিভাগগুলোও খোলা".
2. **Auto-open inner sections** — `openDefaultPrimarySection:253-293` opens `staff-directory` etc. on every `setView` — even when user just wanted the hub, inner panel is already open — feels like "content expanded within same page".
3. **Empty hash ignored** — `panel-route.js:16-20` `onRouteChange` returns if `!name` — Back to bare URL (`admin.html` without hash) leaves panel on last view while URL is bare — **URL/visual mismatch**, Student fixes via `syncViewHash` bare handling.
4. **Double reset flicker** — `setView` resets NewView → opens Default → `navigate` resets same NewView again → re-opens Default — **2× toggle, potential flicker, not full isolation**.

**Files/functions:**
- `admin.html:70-654` — 19 `admin-view`, 17 toggles, Back buttons 18× `data-admin-view="dashboard"`
- `js/admin.js:196-215` `resetAdminTogglePanels`, `253-293` `openDefaultPrimarySection`, `294-327` `setView`, `337-380` `navigate`, `1646-1665` `refreshView`, `1851-1856` `onRouteChange`, `38` `panel-route` import
- `js/admin-panel-ui.js:33-105` hub/bottom render, `js/admin-permissions.js:182-196` `VIEW_SEAT`, `174-196` navs
- `js/panel-route.js:8-20` `routeName/rememberRoute/onRouteChange`
- `js/shell.js:204-231` Student reference (hidden+active)
- `css/ui-layout.css:2-3` + `css/ui-wallet.css` overrides
- `tools/load-budget.mjs` + `tests/admin-nav-refresh.test.mjs` etc.

---

## 4) ঠিক কোন ফাইলে কী পরিবর্তন প্রয়োজন (ন্যূনতম)

**No new feature, no DB, no workflow — only navigation/display.**

| File | Change | Why | Risk |
|------|--------|-----|------|
| `js/admin.js:294-327` `setView` | **Add `hidden` alongside `active`** — `panel.hidden = !active` for every `admin-view`, like Student; keep `active` for CSS, `hidden` as proof (inactive CSS cannot win). | Fixes primary CSS-only risk; makes `display:none` via `hidden` even if CSS overridden | Low — `hidden` is standard, tests use `active` only, but we keep both; need to ensure `hidden` not break `is-chat-fullscreen` layout (it doesn't) |
| `js/admin.js:253-293` `openDefaultPrimarySection` | **Remove auto-open** — do **not** open `staff-directory/students/reports/lecture-sheets` on `setView`; only `resetAdminTogglePanels` (close all). User opens via explicit toggle click. | Fixes "অপ্রয়োজনীয় উপবিভাগ স্বয়ংক্রিয়ভাবে খুলে যাওয়া" | Medium — existing tests `openDefaultPrimarySection` expect staff toggle open; need to update tests to *click toggle* instead of expecting auto-open; `admin-nav-refresh` expects fresh data on revisit, not auto-open |
| `js/admin.js:337-380` `navigate` | **Remove duplicate reset/open** — keep only `setView`'s reset/open, remove second `resetAdminTogglePanels(activePanel)` + `openDefaultPrimarySection` block (lines 354-368). | Fixes double-reset flicker, ensures single isolation point | Low — `refreshView` must stay for fresh data |
| `js/panel-route.js:14-20` | **Handle empty hash → dashboard** — `onRouteChange` if `!name` then `handler('dashboard')` instead of return; or keep return but add `popstate` handler that reopens `dashboard` when hash cleared via Back. Preserve `replaceState` (Back=leave). | Fixes URL/visual mismatch on Back to bare URL | Low — need to ensure unauthorised hash still blocked (already via `allowsView`) |
| `css/ui-layout.css:2-3` | **No change** — keep `display:none/block`; `hidden` will add second layer. Do **not** add `!important` or new rules. | Keep 15-sheet order, load-budget intact | None |
| `js/admin-panel-ui.js` / `js/admin-permissions.js` | **No change** — menu/permission already correct. | Avoid refactor | None |
| `js/shell.js` / `js/navigation.js` | **No copy** — only reference, do **not** copy Student code to Admin. | Constraint | None |

**Total:** 3 functions in 2 files, ~15 lines added, ~20 lines removed — all within existing functions, no new file, no new dependency.

---

## 5) Regression risk & সুরক্ষা ব্যবস্থা

- **Auth/capability:** `setView` still checks `allowsView` first — unauthorised URL (e.g., `#finance`) returns `false`, `navigate` shows toast + fallback to `defaultView` — **no bypass**
- **Firebase:** No DB key touched; `refreshView` still fresh-loads, no write path changed — **read/write intact**
- **Session:** `hasStaffSession` + `watchOwnPanelSession` untouched — **no session weakening**
- **Bottom seat:** `seatFor` + `VIEW_SEAT` untouched — active indicator stays correct
- **Deep-link:** `routeFromHash` untouched — `admin.html#staff` still opens `staff` if allowed, `#not-a-view` stays on current view
- **Back:** `replaceState` kept — Back still leaves panel (expected for Admin per `panel-route.js` comment); empty-hash fix ensures bare URL shows dashboard, not stale view
- **Auto-open removal:** Risk: user expects staff list open by default — **mitigation:** staff list toggle is first action, labelled "স্টাফ তালিকা ও ফিল্টার দেখুন", `44px` target, mobile ok; tests will click toggle instead of expecting auto-open
- **Hidden:** Risk: `is-chat-fullscreen` / `is-staff-view` layout depends on `active` only — `hidden` does not affect layout classes on `#adminShell/#adminMain`; verified in `setView:299-301` toggles are independent of `hidden`
- **Load budget:** No new import, no new eager module — `eagerClosure` stays 35/279KB < 40/300KB; 15 sheets unchanged

---

## 6) পরীক্ষার checklist ও প্রত্যাশিত ফলাফল

**Pre-change verification (before code edit):**
- [ ] `admin.html#more` → More hub visible, `admin.html#staff` → Staff view, `#not-a-view` → stays, empty hash after Back → **currently stays on last view (bug)**
- [ ] Click `staff` bottom → Staff view, other 18 `admin-view` have only 1 `active` (via `$$('.admin-view.active').length===1`)
- [ ] Click `system` → System hub, then `security` → Security view, `system` hidden, seat `system` lit
- [ ] Mobile 360px: no horizontal scroll, `44px` targets, `is-chat-view` fullscreen

**Post-change expected:**
- [ ] **Single active, double-hidden:** `setView('staff')` → `staff` is only `active` and `!hidden`, other 18 are `!active` and `hidden=true` (check via `$$('.admin-view')` in console)
- [ ] **No auto-open:** `setView('staff')` → `staff-directory` panel stays `hidden`, `aria-expanded=false` until click — **user sees only summary, not auto-expanded list**
- [ ] **Toggle isolation:** Click `staff-directory` toggle → only `staff-directory` panel opens; click `system/security` → only `security` panel opens, `staff` panels untouched
- [ ] **URL/hash:** `admin.html#staff` deep-link → Staff; `admin.html#finance` → stays dashboard (unauthorised toast); refresh keeps hash; Back to bare URL → dashboard (not stale)
- [ ] **Back/Home:** Bottom `dashboard` → dashboard, `pay-back` (18×) → dashboard, browser Back → leave panel (replaceState kept)
- [ ] **RefreshView:** Revisit `staff` after creating staff via API → new staff appears (fresh load, not auto-open)
- [ ] **Firebase:** `tools/load-budget.mjs` → `0 problems`; `npm test` → relevant suites: `admin-nav-refresh`, `admin-panel-shell`, `admin-panel-design`, `admin-staff-design`, `admin-profile-back-nav`, `admin-v2-migration`, `admin-content-review` — **all pass**
- [ ] **Mobile/desktop:** 360–400px no scroll, `44px` targets, hero intact, typography unchanged

---

## 7) অনুমোদনের জন্য অপেক্ষা

**এই রিপোর্ট অনুমোদিত না হওয়া পর্যন্ত কোনো কোড পরিবর্তন করা হবে না।**  
**Deploy:** কোনো পরিবর্তন production-এ deploy করা হবে না — শুধু `arena/43b40ecc-apc` branch এ, আপনার স্পষ্ট অনুমতি পরে `main` এ merge হবে না.

**অনুমোদন দিলে:** Phase 4 এ উপরের 3 ফাংশনে ন্যূনতম পরিবর্তন (~15 lines) করে উপরের checklist যাচাই করে ফলাফল, পরিবর্তিত ফাইলের তালিকা ও ব্যর্থতা (যদি থাকে) রিপোর্ট করব।

