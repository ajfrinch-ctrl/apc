# ActivePlus Coaching — Master Plan delivery (28 Oct 2026)

Owner/stakeholder feedback: **Rashid Nipu**, 28 October 2026.
Branch: `arena/bcfc7502-apc`. Base: `d81fcbd` on `main`.

This note records what shipped, the assumption behind each ambiguous item, and
the test that proves it. Every phase was verified before the next one started.

---

## Phase 1 — critical fixes

### (a) Institute address now propagates everywhere

**Root cause.** The address was typed straight into `admin.html`'s dashboard
card; the Settings form wrote `DEFAULT_APP_SETTINGS.campusAddress` into
`KEYS.settings`, and only the Admin app-management card was repainted after a
save. Every other surface (login card, receipts, ID cards, letterheads, the
student Help sheet) waited for a *cross-tab* `storage` event, so a same-tab save
never reached them.

**Fix — one record, one painter.** `js/org-info.js` is now the only module that
knows where institute details live. It reads the saved config, exposes a hook
per field, and repaints synchronously:

| Hook | Field |
| --- | --- |
| `[data-org-name]`, `[data-institute-name]` | institute name |
| `[data-org-tagline]`, `[data-fixed-tagline]` | tagline |
| `[data-org-address]`, `[data-institute-addr]`, `[data-org-address-line]` | campus address |
| `[data-org-helpline]`, `[data-org-tel]`, `[data-org-whatsapp]` | contact numbers (+ `tel:`/`wa.me` hrefs) |
| `[data-org-email]`, `[data-org-email-mail]` | e-mail (+ `mailto:` href) |
| `[data-org-contact]`, `[data-org-live]` | the combined line, and its "is there anything to show" flag |

`saveAppConfig()` (`js/storage.js`) now dispatches `apc-app-config-saved` on the
same tick, and `initOrgInfo()` repaints, so **no manual reload and no controlled
refresh is needed**: the Admin dashboard, the payment dashboard, the login card,
the student Help sheet, receipts and report letterheads all read from the one
record.

**Visual save confirmation.** The Settings save toast now repeats the saved
address: `ব্র্যান্ডিং ও যোগাযোগের তথ্য সংরক্ষিত হয়েছে — <address>`.

**Verified.** `tests/plan-2026-10-28.test.mjs` (no literal address in any panel,
hooks present, same-tab repaint, document builders read the config) and a live
jsdom walk-through: saving `হাউজ ১২, রোড ৩, বাসুদেবপুর, দিনাজপুর` in Admin →
Settings changes the dashboard card, its contact line and the toast in the same
tick.

### (b) «শ্রেণি চ্যাট ও মডারেশন» removed from Admin and Manager

Removed end to end: the view, the top-bar shortcut, the hub cards, the mount
points, the routes, the permission entries and the router branches in
`js/admin.js` / `js/manager.js` / `js/admin-permissions.js`, the CSS blocks in
`css/ui-wallet.css`, the moderation primitives in `js/class-chat.js` (pin,
unpin, remove, chat lock, the lock badge and `room.locked`), the TTL pin state
in `js/class-chat-relay.js`, and the references in
`docs/AUDIT-ADMIN-NAV-2026-10-27.md`.

**Assumption (stated, not blocking).** The Student and Teacher class chat pages
are *not* the moderation console: they are the messaging surfaces the owner uses
to talk to students. They stay, intact, with full-screen layout. Only the
moderation/monitoring console and every Admin/Manager trace were removed. Data
already on a device is untouched — backups still export `KEYS.classChat`
(`js/admin.js`), because the students' and teachers' messages still live there.

**Verified.** `tests/plan-2026-10-28.test.mjs` asserts both panels carry no chat
markup, no route and no mount; `tests/class-chat.test.mjs` (14/14) proves the
Student/Teacher chat still mounts and sends; `tests/admin-panel-shell.test.mjs`
and `tests/manager-panel-shell.test.mjs` prove neither shell has a chat page.

---

## Phase 2 — lecture sheets for Teachers and Managers

* New capability `content.lecture-sheets` (`CAPABILITIES.CONTENT_LECTURE_SHEETS`)
  granted to **Admin**, **Manager** and **Teacher** — never to the Payment
  counter, never to students.
* Label in the Admin matrix: `লেকচার শিট তৈরি ও প্রকাশ`.
* Teacher: a dedicated page (`#teacherLectureSheets`) behind the
  একাডেমিক hub card, seat `classes`, a visible Back to `academic`.
* Manager: a dedicated page (`#managerLectureSheets`) behind the
  পাঠ্য উপকরণ (`courses`) screen, seat `academic`, Back to `courses`.
* Admin: unchanged — `content-lecture-sheets` still inherits the `data.manage`
  capability of its hub, so the detail-page invariant in
  `tests/admin-detail-routes.test.mjs` still holds.
* All three mount `mountLectureSheetManager({ mount, role, toast })`; writes stay
  gated by `requireCourseWriter` (`admin` / `teacher` / `manager` + staff
  session), so the capability and the write guard agree.

**Verified.** `tests/plan-2026-10-28.test.mjs` (capability grant + three studio
pages + routes), `tests/admin-detail-routes.test.mjs` 44/44, and a live mount in
both panels: each shows the create tool, filters and the sheet list with no
Admin session and no page errors.

---

## Phase 3 — one navigation language

* **Same bar everywhere.** On phones the Student bar and every staff bar are the
  same component: `.bottom-nav` / `.admin-bottom` share one rule for height,
  padding and safe area, and every seat is one `.nav-chip` (3D `ai-3d` glyph) +
  one `.nav-label`, exactly like the Student panel.
* **Same bar sideways on desktop.** A single rail inside the shared shell grid
  (`@media (min-width: 1024px)` → `grid-template-columns: 248px minmax(0, 1fr)`)
  turns the bottom list into a sidebar for `.app-shell` (Student, Teacher),
  `.admin-shell` (Admin, Manager) and `.pay-shell` (Payment). No second sidebar
  exists anywhere.
* **No heroes outside Student Home.** Every staff page now opens on a compact
  head (title, one line of advice, date) — the hero scenes, glints, artwork
  images and their painters are gone from Teacher, Manager, Payment and Admin.
  The Student Home keeps its carousel: it is the one surface allowed a hero.
* **One page per icon.** Each bottom seat opens a single-purpose page; a hub card
  or a sub-page opens a dedicated page with its own Back to the hub that opened
  it (the new lecture studio is the model).
* **Back and deep links.** Teacher and Manager keep one hash route per page
  (`js/panel-route.js`): a shared link reopens the page, Back leaves the panel
  instead of walking every page, and the URL always names what is on screen.
* **Chat is full screen** on every panel that still owns one (Student, Teacher):
  `is-chat-fullscreen` on the shell + `is-chat-view` on `main` hide the topbar,
  the bottom bar and the desktop rail for the duration of the conversation.

**Verified.** `tests/cross-panel-2026-10-28.test.mjs` (nav contract for all four
staff panels, one rail, chat only where it belongs, studio only where it
belongs), `tests/panel-deeplink-2026-10-28.test.mjs` (deep link → studio → Back →
hub → chat full screen → chrome restored), plus the per-panel design suites.

---

## Phase 4 — cross-panel and regression testing

* Full suite: **1450 tests, 1446 pass, 0 fail, 4 skipped** (`npm test`).
  The four skips are the pre-existing build-only checks that need a tool binary
  or a browser download.
* Baseline comparison: `main` at `d81fcbd` ran 1429 / 1410 / 15 / 4. **All 15
  baseline failures are fixed**, not just tolerated:
  * the jsdom harness had no `window.matchMedia`, so every notification test
    crashed before asserting anything — it now answers "no" for every query, the
    same answer a browser gives for a query the viewport does not satisfy;
  * `css/notifications.css` had put a decorative glass blur on the notification
    backdrop outside the wallet skin — it now paints the themed
    `var(--modal-backdrop)` scrim instead;
  * the bell sheet is titled **অ্যাকশন সেন্টার** and shows the read status above
    the approval strip and the filter tabs, which is the order the Action Centre
    test describes.
* Housekeeping: `node tools/css-order-check.mjs` → 5 pages / 15 stylesheets in
  canonical order; `node tools/load-budget.mjs` → 33 modules / 295.7 KB
  (budget 40 / 300 KB); release pins are `?v=434`, `SW_VERSION = 434`,
  `CACHE_VERSION = 434`, `DEFAULT_VERSION = 434`.

### Assumptions recorded

1. **Chat scope** — see Phase 1(b). Student/Teacher messaging stays; the Admin
   and Manager moderation console is gone.
2. **Hero removal** does not apply to the Student Home carousel, which the brief
   explicitly exempts. Staff "page heads" keep the title, advice line and date,
   because a page without any heading is not usable.
3. **"Full screen" chat** means the conversation covers the app chrome (topbar,
   bottom bar, desktop rail) while keeping the panel's own Back control visible —
   a route you cannot leave is not a route.
4. **Layout testing** is done at the CSS-rule level (jsdom has no layout
   engine); each rule asserted is a shared selector, so one assertion covers all
   four panels. Real-device checking stays a manual step in the release
   checklist.
5. **Institute details are never hard-coded**: every surface reads
   `loadAppConfig()` (documents) or is painted by `js/org-info.js` (markup).

---

## Follow-up — 29 Oct 2026: the login sky followed the wrong district

**Report.** "ওয়েদার লোকেশন ভুল দেখাচ্ছে."

**Why.** `js/login.js` asked the weather service for a literal point:

```js
const KANUNGOPARA = Object.freeze({ lat: 22.35803, lon: 92.12380 });
```

That is Kanungopara in the Chittagong Hill Tracts — roughly 430 km from the
campus described by the single institute record (`দিনাজপুর সদর, দিনাজপুর`,
25.6217 N / 88.6354 E). Temperature, rain, and sunrise/sunset all came from
there, so the login backdrop could show a hill-district sky and a sunset twenty
minutes off. It is the same class of bug as the address report in Phase 1: a
fact about the institute typed into code instead of read from the record — and
Admin → Settings had no way to move it.

**Fix — the campus point joins the record.**

* `DEFAULT_APP_SETTINGS` (`js/config.js`) now carries `campusLat` / `campusLon`
  (Dinajpur town, matching `campusAddress`).
* `js/login.js` exposes `campusPoint()`, which reads those numbers from
  `loadAppConfig()` and falls back to the defaults for missing, empty,
  non-numeric or out-of-range values (never silently 0,0).
* The weather snapshot is keyed to the point it was taken for
  (`activePlus.authWeather.v3`, with `lat`/`lon` stored inside): a snapshot for
  the previous campus is ignored and refetched, so a move never shows the old
  district's weather.
* Admin → Settings → ব্র্যান্ডিং ও যোগাযোগ তথ্য gains **ক্যাম্পাসের অক্ষাংশ**
  and **ক্যাম্পাসের দ্রাঘিমাংশ** right under the address, with a one-line hint
  that these numbers drive the login sky. `clampCoordinate()` keeps a stored
  value when the box is emptied, unparseable or out of range.

**Verified.** `tests/auth-sky-theme.test.mjs` (9/9): the point comes from the
record, the request URL names the saved latitude/longitude and `Asia/Dhaka`, a
snapshot for another point is refetched, and no module keeps the old
coordinates. Live walk-through: saving 23.4607 / 91.1809 in Admin → Settings
changed the request from `latitude=25.6217&longitude=88.6354` to
`latitude=23.4607&longitude=91.1809`, and junk input kept the previous values.

**Release.** Pin 436 (`?v=436`, `SW_VERSION`, `CACHE_VERSION`,
`DEFAULT_VERSION`) so devices receive the new login module.

---

## Follow-up — campus address changed (owner decision, 29 Oct 2026)

The institute is in **কানুনগোপাড়া, বোয়ালখালী, চট্টগ্রাম**, not Dinajpur. Because
every surface reads the one record, the change is:

| Where | Change |
| --- | --- |
| `js/config.js` | `campusAddress: 'কানুনগোপাড়া, বোয়ালখালী, চট্টগ্রাম'`, `campusLat: 22.4075`, `campusLon: 91.9783` (Kanungopara 4363, Boalkhali, Chattogram) |
| Dashboard, login card, Help sheet, receipts, letterheads | no edit — they paint from the record |
| Admin → Settings | fallback now `DEFAULT_APP_SETTINGS.campusAddress` instead of the old literal |
| `js/report-layout.js` | the report letterhead's default slogan lost its baked-in `• দিনাজপুর`; the campus is drawn on its own line from the record |
| `js/admin-data.js` | the demo roster's sample addresses follow the campus (demo data only) |

**Coordinates.** 22.4075 N / 91.9783 E is the postcode-4363 centroid for
Kanungopara, Boalkhali. Note that the *old* hard-coded pair (22.35803 / 92.1238)
belonged to Kanungopara in **Rangunia** — a bad auto-geocode from a postal-code
dataset, roughly 40 km east of the real village. That is why the weather never
matched the campus even before the address changed. Admin → Settings lets the
office fine-tune the point by a few hundred metres if needed.

**Release.** Pin 437 (`?v=437`, `SW_VERSION`, `CACHE_VERSION`,
`DEFAULT_VERSION`).
