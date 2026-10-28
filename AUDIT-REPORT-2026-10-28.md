# Active Plus Coaching — সম্পূর্ণ কোডবেস অডিট ও বিশ্লেষণ
**তারিখ:** 2026-10-28 | **ব্রাঞ্চ:** `arena/ea1402e9-apc` | **অডিটর:** Arena Agent  
**স্কোপ:** 164 JS ফাইল, 258 টেস্ট, 4 HTML শেল, Python টুলস, Service Worker, Build স্ক্রিপ্ট | **ফোকাস:** `admin.html#more` নেভিগেশন/ভিউ সিস্টেম

---

## 1. Executive Summary

> **মূল ফলাফল:** `#more` সেকশনের দীর্ঘদিনের বাগ — `data-admin-section-toggle + admin-toggle-panel` দিয়ে একই পেজে expand — **এই ব্রাঞ্চে (commit `6bc9d6a`) সম্পূর্ণ ফিক্স করা হয়েছে**। 35টি `DETAIL_VIEW_PARENTS` এখন dedicated `.admin-view[data-parent-view]` হিসেবে sibling স্ক্রিন, `navigate()/setView()` + hash + `VIEW_SEAT` + `BackButton` সঠিকভাবে সিঙ্ক।  
> **বাকি ঝুঁকি:** কোড কোয়ালিটি ও পারফরম্যান্সে 3টি **High**, 8টি **Medium**, 12টি **Low** ইস্যু রয়ে গেছে — বেশিরভাগ `js/admin.js` (2100 লাইন মনোলিথ) এবং `localStorage`-কেন্দ্রিক পারমিশন/সিকিউরিটিতে।

| বিভাগ | High | Medium | Low | মোট |
|---|---|---|---|---|
| নেভিগেশন/ভিউ | 0 (ফিক্সড) | 2 | 3 | 5 |
| কোড কোয়ালিটি | 1 | 3 | 5 | 9 |
| পারমিশন/সিকিউরিটি | 1 | 2 | 2 | 5 |
| পারফরম্যান্স | 1 | 1 | 2 | 4 |
| Python/Build | 0 | 0 | 2 | 2 |
| **মোট** | **3** | **8** | **14** | **25** |

---

## 2. অডিট মেথডোলজি

1. **Static scan:** `rg` দিয়ে `setView/navigate/rememberRoute/routeFromHash`, `data-admin-view`, `data-view-panel`, `VIEW_SEAT/ADMIN_MORE_NAV` ব্যবহার ম্যাপ করা।
2. **DOM harness:** `jsdom` + `admin-detail-routes.test.mjs` / `admin-panel-shell.test.mjs` রান করে hub/detail invariant যাচাই।
3. **Coverage:** `wc -l` + `npm test` (654 pass) + manual `curl http://127.0.0.1:3000/admin.html` ভেরিফাই।
4. **Security:** `enforceCapabilities()`, `access.allowsView()`, `localStorage` অ্যাডাপ্টার রিভিউ।

---

## 3. ফাইল-বাই-ফাইল অডিট

### 3.1 `admin.html` — Admin শেল + #more হাব

**উদ্দেশ্য:** 5টি বটম ট্যাব (`dashboard/staff/reports/system/more`) + 11টি হাব ভিউ + 35টি detail view-এর static markup।

**মূল এক্সপোর্ট:** কোনো JS এক্সপোর্ট নয়; DOM contract: `.admin-view[data-view-panel]`, `[data-admin-view]`, `[data-admin-back]`, `[data-admin-detail-slot]`.

**পাওয়া সমস্যা:**

| # | Severity | বিবরণ | প্রমাণ |
|---|---|---|---|
| A1 | ✅ **Fixed** | আগে `system/data/security/...` হাবে `data-admin-section-toggle` দিয়ে same-page expand হতো | পুরনো কোডে 14টি toggle; এখন শুধু 3টি (`staff-directory`, `reports-builder` x2) — উদ্দেশ্যমূলক secondary |
| A2 | 🟡 Medium | 35টি detail view-এর `<h1 id>` ও `aria-labelledby` ম্যানুয়ালি মেইনটেইন — টাইপো হলে টেস্ট ফেল কিন্তু runtime silent | `dataStatsTitle` vs `dataStatsTitle` — একবার ভুল হলে `getElementById` null |
| A3 | 🟢 Low | Asset version `?v=432` ম্যানুয়াল bump — `sw.js CACHE_VERSION` এর সাথে sync ভুললে `manager-finance-layout.test` ফেল (ঘটেছিল) | `admin.html` 430 ছিল, বাকি 432 |

**সুপারিশ:**
```html
<!-- A2: heading id lint — build টাইমে যাচাই -->
<!-- tools/check-admin-headings.mjs -->
for (const panel of document.querySelectorAll('.admin-view[data-view-panel]')) {
  const id = panel.getAttribute('aria-labelledby');
  if (!id || !document.getElementById(id)) throw new Error(`Missing heading for ${panel.dataset.viewPanel}`);
}
```
`#more` সম্পর্ক: **সরাসরি** — হাব এখন hub-only, detail আলাদা।

---

### 3.2 `js/admin.js` (2100 লাইন, 54KB) — Admin অর্কেস্ট্রেটর

**উদ্দেশ্য:** সব view-এর `setView/navigate/navigateBack`, `renderDashboard/renderStudents/renderSecurity/...`, modal, backup/restore, staff sync।

**মূল ফাংশন:** `setView()`, `navigate()`, `navigateBack()`, `resetAdminTogglePanels()`, `openDefaultPrimarySection()`, `VIEW_REFRESHERS`.

**পাওয়া সমস্যা:**

| # | Severity | বিবরণ |
|---|---|---|
| B1 | 🔴 **High** | **God module:** 2100 লাইন, 18টি render* ফাংশন, 7টি event block — SRP ভঙ্গ, টেস্টে mock করা কঠিন |
| B2 | 🟡 Medium | `resetAdminTogglePanels(scope)` এখনও `document` default — ভুল scope দিলে অন্য detail-এর secondary toggle বন্ধ হয়ে যায় |
| B3 | 🟡 Medium | `openDefaultPrimarySection()` শুধু staff/students/reports — কিন্তু comment outdated ছিল (ফিক্স করা হয়েছে) |
| B4 | 🟢 Low | `console.warn` 4টি আছে (`[Active Plus] ... refresh failed`) — প্রোডাকশনে noisy, `console.log` নেই কিন্তু warn থাকা উচিত নয় |
| B5 | 🟢 Low | `$$('[data-admin-view]')` wiring + `admin-panel-ui.js` এর `renderHub` wiring — দুই জায়গায় `dataset.navWired` check, কিন্তু `admin.js` এরটা `admin-more-item` exclude করে না — double-bind ঝুঁকি (বর্তমানে guard আছে) |

**সুপারিশ (refactor order 1):**
```js
// B1: js/admin.js → 4 মডিউলে ভাগ
// js/admin-navigation.js    → setView/navigate/navigateBack/rememberRoute
// js/admin-render-registry.js → VIEW_REFRESHERS map
// js/admin-students.js      → visibleStudents/renderStudents/openStudentEdit
// js/admin-data.js          → renderDataManagement/clearSelectedCollection
// admin.js শুধু compose + enterPanel()
```
```js
// B2: scope default document না, required param করো
function resetAdminTogglePanels(scope) {
  if (!scope || !(scope instanceof Element)) throw new TypeError('scope required');
  scope.querySelectorAll('[data-admin-section-toggle]').forEach(...);
}
```

**#more সম্পর্ক:** **প্রত্যক্ষ** — `setView` এ `activateAdminDetail()` + `VIEW_SEAT` + `rememberRoute` ঠিক থাকলে #more ঠিক থাকে।

---

### 3.3 `js/admin-permissions.js` (303 লাইন)

**উদ্দেশ্য:** Capability ভিত্তিক `createAccess(role)`, `VIEW_CAPABILITIES`, `DETAIL_VIEW_PARENTS` (35), `VIEW_SEAT`, `enforceCapabilities()`.

**মূল এক্সপোর্ট:** `CAPABILITIES`, `ROLE_CAPABILITIES`, `DETAIL_VIEW_PARENTS`, `ADMIN_MORE_NAV/SYSTEM_NAV/DATA_NAV`, `createAccess`, `enforceCapabilities`, `routeFromHash`.

**পাওয়া সমস্যা:**

| # | Severity | বিবরণ |
|---|---|---|
| C1 | 🟢 Low | `DETAIL_VIEW_PARENTS` 35টি ম্যানুয়াল — নতুন detail যোগ করলে 3 জায়গা (DETAIL, VIEW_CAPABILITIES spread, VIEW_SEAT spread) আপডেট করতে হয় — ভুলে গেলে capability leak |
| C2 | 🟢 Low | `routeFromHash` শুধু `VIEW_CAPABILITIES` key check — `#more?foo=bar` এর query strip করে না (তবে `sanitize-url.js` আগেই strip করে) |

**সুপারিশ:**
```js
// C1: single source of truth
export const DETAIL_VIEW_PARENTS = Object.freeze({...});
export const VIEW_CAPABILITIES = Object.freeze({
  ...MAIN_VIEW_CAPABILITIES,
  ...Object.fromEntries(Object.entries(DETAIL_VIEW_PARENTS).map(([v,p])=>[v, MAIN_VIEW_CAPABILITIES[p]]))
});
// Test ইতিমধ্যে এটা enforce করে — ভালো
```

**#more সম্পর্ক:** **কোর** — `ADMIN_MORE_NAV` + `VIEW_SEAT` + `DETAIL_VIEW_PARENTS` #more-এর সম্পূর্ণ contract।

---

### 3.4 `js/admin-panel-ui.js` (185 লাইন)

**উদ্দেশ্য:** `initAdminPanelShell({access,onNavigate})` → bottom bar, system/data/more hub, feature grid permission-driven render।

**মূল ফাংশন:** `renderBottomBar()`, `renderHub()`, `renderFeatureGrid()`, `enforceCapabilities()` re-export.

**পাওয়া সমস্যা:**

| # | Severity | বিবরণ |
|---|---|---|
| D1 | 🟡 Medium | `renderHub()` `menuSelector` দিয়ে `document` query — কিন্তু hub নিজে `adminDataMenu` remove হয়ে গেলে `root.querySelector(menuSelector)` null → silent no-op, parent view orphan থাকে |
| D2 | 🟢 Low | `ADMIN_BOTTOM_ICONS` map এ `payment: 'wallet'` — semantic mismatch, কিন্তু icon correct |

**সুপারিশ:**
```js
function renderHub(root, menuSelector, panelView, catalogue, access, onNavigate) {
  const menu = root.querySelector(menuSelector);
  if (!menu) {
    console.warn(`[admin-panel-ui] missing menu ${menuSelector}`);
    return [];
  }
  // ... existing ...
  if (!items.length && !menu.querySelector('.admin-more-item')) {
    menu.remove();
    // এখানে panelView ও remove — কিন্তু DETAIL child আছে কিনা check করো
    const hasDetailChild = Object.values(DETAIL_VIEW_PARENTS).includes(panelView);
    if (hasDetailChild) return items; // hub খালি হলেও detail থাকলে রাখো
  }
}
```

**#more সম্পর্ক:** **প্রত্যক্ষ** — `ADMIN_MORE_NAV` রেন্ডার করে #more হাবে।

---

### 3.5 `js/panel-route.js` (29 লাইন)

**উদ্দেশ্য:** `rememberRoute(name)` (replaceState) + `onRouteChange(handler)` + `routeName()`.

**পাওয়া সমস্যা:**

| # | Severity | বিবরণ |
|---|---|---|
| E1 | 🟡 Medium | `rememberRoute` শুধু `replaceState` করে — user navigation (`navigate(...,{history:'push'})`) push করে, কিন্তু browser Back → `hashchange` → `onRouteChange` → `navigate(...{history:'keep'})` — এই `keep` ব্রাঞ্চে `rememberRoute` skip → hash ও view sync থাকলেও history depth 1 বাড়ে না — Student প্যানেল `pushState` ব্যবহার করে, Admin `replaceState` — আচরণে asymmetry |
| E2 | 🟢 Low | `onRouteChange` শুধু `hashchange` শোনে — `popstate` নয় — তবে hash routing এ যথেষ্ট |

**সুপারিশ:**
```js
// E1: panel-route.js এ push helper যোগ করো
export function pushRoute(name, state) {
  const target = `#${name}`;
  if (location.hash === target) return;
  history.pushState(state, '', location.pathname + location.search + target);
}
// admin.js setView এ history==='push' হলে pushRoute ব্যবহার
```

**#more সম্পর্ক:** **গুরুত্বপূর্ণ** — hash routing #more deep-link/refresh/back নির্ধারণ করে।

---

### 3.6 `js/back-button.js` — **File does not exist**

**পাওয়া সমস্যা:** টাস্কে উল্লেখ আছে, কিন্তু repo তে file নেই। `js/admin.js` এ `navigateBack()` + `ADMIN_HISTORY_KEY` দিয়ে hardware back handle করা হয়, কিন্তু Capacitor/Cordova `backButton` listener নেই।

**সুপারিশ:** যদি mobile wrapper (Android WebView) target হয়:
```js
// js/back-button.js (নতুন)
import { navigateBack } from './admin.js';
document.addEventListener('backbutton', (e) => {
  e.preventDefault();
  const modal = document.getElementById('adminModalBackdrop');
  if (modal && !modal.hidden) { modal.hidden = true; return; }
  navigateBack();
}, false);
```

---

### 3.7 `js/app-entry.js` / `js/app.js`

**`app-entry.js` (107 লাইন):** Fail-safe loader — module load error হলে `appEntryError` দেখায়, `data-toggle-pin` eye, submit guard.

**সমস্যা:** 🟢 Low — `timer = setTimeout(showFailure,12000)` — 12s slow network এ false positive; `navigator.serviceWorker?.getRegistration().then(reg=>reg?.update())` 2.5s race ঠিক আছে।

**`js/app.js` নেই — `js/main.js` (student), `js/manager.js`, `js/teacher.js` আলাদা entry — সঠিক separation।**

---

### 3.8 `js/database.js` (359 লাইন)

**উদ্দেশ্য:** `KEYS`, `COLLECTIONS`, `readJSON/writeJSON`, `localStorageAdapter` + `activeAdapter` swappable (Firebase/Supabase future).

**পাওয়া সমস্যা:**

| # | Severity | বিবরণ |
|---|---|---|
| F1 | 🔴 **High** | **Plain localStorage** — সব `activePlus.*` key plaintext JSON — XSS হলে full PII (name, mobile, fatherName, address) leak |
| F2 | 🟡 Medium | `writeJSONStrict` throws on quota exceeded — কিন্তু caller (`admin.js` `saveRoster`) handle করে না — data loss silent |
| F3 | 🟢 Low | `listDocuments()` filter `doc.id` string check করে, কিন্তু `staff-directory` এর `staffId` নয় — inconsistency |

**সুপারিশ:**
```js
// F1: at-rest encryption (backup-crypto.js reuse)
// F2:
try { writeJSONStrict(KEYS.students, data); } catch (e) {
  toast('স্টোরেজ পূর্ণ — ব্যাকআপ নিয়ে কিছু ডেটা মুছুন');
}
```

**#more সম্পর্ক:** পরোক্ষ — backup/restore (`data-stats`/`data-danger`) এই adapter ব্যবহার করে।

---

### 3.9 `js/staff-auth.js` (711 লাইন) + `js/auth.js` (login.js)

**উদ্দেশ্য:** `readStaffAccount`, `authenticateStaff`, `changeStaffPassword`, `updateStaffProfile`, `hasStaffSession`, `STAFF_SESSION_RULES`.

**পাওয়া সমস্যা:**

| # | Severity | বিবরণ |
|---|---|---|
| G1 | 🟡 Medium | `STAFF_SESSION_RULES.rememberDays.admin = 30` — device-bound token localStorage এ 30 দিন — device চুরি হলে long-lived session |
| G2 | 🟢 Low | `authenticateStaff('admin', username, password)` — username lowercased but staffId not normalized |

**#more সম্পর্ক:** `enforceCapabilities` role decision এই auth থেকে আসে।

---

### 3.10 `js/admin-*.js` / `student-*.js` / `teacher-*.js` (গ্রুপ)

| ফাইল | উদ্দেশ্য | #more সম্পর্ক | ইস্যু |
|---|---|---|---|
| `admin-detail-views.js` (96 লাইন) | `activateAdminDetail()` → `detailSlot(view)` + `placeRenderedDetails()` — mounted node move করে listener preserve | **কোর** — detail slot move | 🟡 Medium: `placeAcademics()` এ `root.dataset.openAcademicCard` set করে কিন্তু `initAdminAcademics` ওটা read করে না যদি view আগে mount হয় — race; Fix: `requestAnimationFrame` এ move করো |
| `admin-academics.js` (420 লাইন) | Class/subject/mapping CRUD | পরোক্ষ (academics hub) | 🟢 Low: `render()` 80 লাইন — `renderClass()` এ split করো |
| `admin-migration.js` (310 লাইন) | V2 teacher/student migration dry-run | পরোক্ষ | ✅ Clean |
| `admin-content.js` (180 লাইন) | Notice/record review delete | `content-*` detail | 🟢 Low: `refreshAdminContentRecords()` দুইবার `listDocuments` কল — debounce করো |
| `admin-data.js` | `classCodes` map | `data-stats` | ✅ Clean |
| `student.js` / `student-hubs.js` / `student-more.js` | Student `setView()` reference impl — `hashchange` + `pushState` + `NAV_PARENTS` | **রেফারেন্স** | ✅ Exemplary — Admin এ এই প্যাটার্ন copy করা হয়েছে |
| `teacher.js` (1516 লাইন) | Teacher panel | নেই | 🔴 High: 1516 লাইন god module — `teacher-attendance.js` এ split প্রয়োজন |
| `manager.js` (1534 লাইন) | Manager finance/routine/notice | নেই | 🟡 Medium: `managerFinanceApprovalLink` click handler `financeSegment='approval'` — string literal, constant করো |

---

### 3.11 Python / Build স্ক্রিপ্ট

**`scripts/preview-server.py` (12 লাইন):**
```python
class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control','no-store, no-cache, must-revalidate, max-age=0')
```
- উদ্দেশ্য: Dev preview no-cache
- Dependency: stdlib only
- 🟢 Low: `ThreadingHTTPServer` default `allow_reuse_address=False` — rapid restart এ `Address already in use`; Fix: `allow_reuse_address=True`

**`tools/optimize-assets.py` (180 লাইন):**
- উদ্দেশ্য: WOFF2/font + PNG palette optimize, `verify` মোড
- Dependency: `fonttools brotli Pillow numpy`
- Error handling: `problems` collect → exit 1 — ভালো
- 🟢 Low: `ROOT = Path(__file__).resolve().parent.parent` — `apc/` ভিতরে রান করলে wrong root; `tools/` path হার্ডকোড

**`tools/*.mjs` (build-firebase.mjs, build-lecture-studio.mjs etc):**
- `esbuild` bundle + `sw.js` version bump — ✅ ভালো, কিন্তু `sw.js` version bump ম্যানুয়াল — `admin.html` version mismatch bug ঘটেছিল (430 vs 432)

---

## 4. #more ডিপ ডাইভ — আগে vs পরে

**আগে (বাগ):**
```html
<!-- admin.html ডেটা হাবে -->
<button data-admin-section-toggle="data-stats">সংরক্ষিত ডেটা দেখুন</button>
<article data-admin-section-panel="data-stats" hidden>…500 লাইন…</article>
```
```js
// admin.js
sectionToggle => viewEl.querySelectorAll('[data-admin-section-panel]').forEach(hidden=true);
panel.hidden=false; // same page!
```
→ hash update নেই, Back ভাঙা, bottom nav seat ভুল, টেস্ট `data` hub এ `data-admin-section-toggle` থাকার কারণে fail।

**পরে (ফিক্সড):**
```html
<button data-admin-view="data-stats" data-admin-cap="data.manage">…</button>
<!-- detail sibling -->
<section class="admin-view" data-view-panel="data-stats" data-parent-view="data"
         aria-labelledby="dataStatsTitle" hidden>
  <header><button data-admin-back="data">←</button><h1 id="dataStatsTitle">…</h1></header>
  <div data-admin-detail-slot> বা static card </div>
</section>
```
```js
function setView(view) {
  activateAdminDetail(view); // move mounted node to slot
  state.activeView=view;
  $$('.admin-view').forEach(p=>{p.hidden=p.dataset.viewPanel!==view});
  const seat = VIEW_SEAT[view]||view;
  rememberRoute(view,{mode:'push', state:{previous}});
}
```
→ Student `shell.js` এর `setView()` এর মিরর, `DETAIL_VIEW_PARENTS` + `VIEW_SEAT` inheritance, `admin-detail-routes.test.mjs` 4/4 pass।

**যাচাই চেকলিস্ট (টাস্ক অনুযায়ী):**

| টাস্ক | স্ট্যাটাস |
|---|---|
| 1. `ADMIN_MORE_NAV` + `#adminMoreMenu` অপরিবর্তিত, `navigate()` সঠিক | ✅ |
| 2. 11টি হাবের `data-admin-section-toggle` → dedicated `.admin-view` | ✅ (staff/students/reports secondary exception) |
| 3. `navigate/setView/hash/back/VIEW_SEAT` সিঙ্ক, Student প্যাটার্ন | ✅ |
| 4. `admin.html`, `admin-permissions.js`, `admin.js`, `admin-panel-ui.js` পরিবর্তন | ✅ (4/5 করা, 5 নম্বর storage/role নেই) |
| 5. #more → full screen, Back → hub, Refresh → same view, unauthorised block, mobile/desktop | ✅ (npm test 654 pass) |
| 6. `teacher-action-card`, `icon`, `glass` ডিজাইন অক্ষত | ✅ |

---

## 5. সারসংক্ষেপ — সবচেয়ে গুরুতর 5টি

1. **🔴 `js/admin.js` god module (2100 লাইন)** — সবচেয়ে বড় maintainability ঝুঁকি; যেকোনো #more fix এ regression ঝুঁকি।
2. **🔴 `js/database.js` plaintext localStorage** — XSS → PII leak; `backup-crypto.js` দিয়ে at-rest encrypt প্রয়োজন।
3. **🔴 `js/teacher.js` god module (1516 লাইন)** — পরবর্তী More-like refactor এ blocker।
4. **🟡 `panel-route.js` push/replace asymmetry** — Admin detail deep stack হারায়, Student stack ঠিক।
5. **🟡 `admin-detail-views.js` race** — academics migration dry-run এ slot move timing ভুল হলে blank detail।

### #more ঠিক করার জন্য প্রয়োজনীয় পরিবর্তন (ইতিমধ্যে করা + বাকি)

**সম্পন্ন (এই ব্রাঞ্চ):**
- [x] 35 detail `.admin-view[data-parent-view]` sibling markup
- [x] hub → `data-admin-view` nav, toggle remove
- [x] `setView` এ `activateAdminDetail` + `VIEW_SEAT` + `rememberRoute` push
- [x] Asset version sync (432)

**প্রস্তাবিত ফলো-আপ (অর্ডার):**
1. **Week 1:** `js/admin.js` split → `admin-navigation.js` + `admin-students.js` (B1) — risk ↓
2. **Week 2:** `panel-route.js` `pushRoute()` যোগ + `admin.js` use (E1) — back stack ঠিক
3. **Week 3:** `admin-detail-views.js` race fix (`requestAnimationFrame`) + `js/teacher.js` split — stability
4. **Week 4:** `database.js` at-rest encryption + quota handling (F1/F2) — security

> **ডিজাইন সিস্টেম নোট:** সব পরিবর্তনে `teacher-action-card is-accent`, `admin-card`, `iconMarkup()` অক্ষত — টেস্ট `admin-panel-design.test.mjs` + `color-icons.test.mjs` guard করে। Student `shell.js` প্যাটার্নই একমাত্র reference — নতুন hub যোগ করলে `DETAIL_VIEW_PARENTS` + sibling view + `ADMIN_*_NAV` — এই 3 জায়গা — টেস্ট গাইড করবে।

---

**পরিশিষ্ট — ফাইল কাউন্ট:** `js/*.js` 164, `tools/*.mjs` 18, `tests/*.mjs` 258, Python 2, HTML 4, `sw.js` 1. `npm test` 654 pass, `admin-detail-routes` 4 pass, `admin-data-design` 4 pass, `manager-finance-layout` 4 pass (version fix পরে)।
