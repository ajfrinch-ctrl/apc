# Desktop Full-Screen Layout Bug — Inventory (Step 1)

> Mobile-first preserved. Only `@media (min-width:768px)` and `@media (min-width:1024px)` are edited. `≤767px` is untouched. Theme `#0e7a55`.

## 0. Summary — Root Cause

* **Auth** (`css/ui-auth.css`): `.auth-screen{position:fixed;inset:0;height:100dvh}` + `.auth-card{max-width:480px;margin:auto}` — no desktop grid, so huge side gaps appear at ≥1024px.
* **App** (`css/ui-layout.css` + `css/ui-wallet.css`): `.app-main/.admin-main/.pay-main{max-width:1160px;margin:auto}` locked centre; `.bottom-nav/.admin-bottom{position:fixed;bottom:0;left:0;right:0}` — no sidebar, no `grid-template-columns` at desktop.
* **JS** (`js/fixed-shell.js`): measures only `--shell-header-height`/`--shell-footer-height` via `ResizeObserver`; no `--sidebar-width`, no debounce/orientation handling. On desktop footer height becomes sidebar height → `--student-home-height` miscalculated.
* Specificity is **not** blocking — blocking factor is *missing* `min-width` overrides + stale `1160px`/`fixed` rules winning on desktop because `ui-wallet.css` loads last without desktop counter-rules.

---

## A. Selectors setting `max-width` / `width` / `position:fixed` / `inset` / `height:100dvh`

### `css/foundation.css`
| Selector | Rule | Effect |
|---|---|---|
| `:root` | `--shell-header-height:60px; --shell-footer-height:66px; --shell-top-offset:0px; --student-home-height:calc(100dvh - var(--shell-top-offset) - var(--shell-header-height) - var(--shell-footer-height))` | Header/footer deduction for student home; consumed by JS |
| `:root` | `--safe-top/bottom:env(safe-area-inset-*)` | Safe area |
| `html{scroll-padding-block:90px}` | layout scroll offset | prevents anchor jump behind sticky bar |

### `css/ui-auth.css` (auth entry = `index.html`)
| Selector | Rule | Note |
|---|---|---|
| `.auth-screen` | `min-height:100dvh; padding:var(--space-6) var(--space-4) var(--space-7)` | Mobile baseline |
| `.auth-screen` (bottom block) | `position:fixed; inset:0; height:100dvh; min-height:0; overflow-y:auto` | **Root cause (a)** — full-viewport fixed sheet |
| `.auth-card` | `width:100%; max-width:480px; margin:0 auto; padding:var(--space-6)` | **Root cause (b)** — narrow centred card |
| `.auth-brand img` | `width:88px;height:88px` (76px at ≤480px, 60px mobile) | Brand |
| `#appStatusSurface` | `max-width:480px; margin:auto` | Status surface |
| `.launch-screen` | `position:fixed; inset:0; z-index:2000; display:flex; ...` | Splash (intentional fixed) |

### `css/ui-layout.css` (app shell)
| Selector | Rule | Note |
|---|---|---|
| `.app-shell,.admin-shell,.pay-shell` | `min-height:100dvh` | Shell |
| `.app-topbar` | `position:sticky;top:0;z-index:30` | Sticky header |
| `.app-topbar-inner` | `max-width:1160px;margin:auto;min-height:76px` | **Blocking** — limits header to 1160 |
| `.app-main,.admin-main,.pay-main,body>main` | `max-width:1160px;margin:auto;padding:var(--space-6) var(--space-5) calc(110px+var(--safe-bottom))` | **Blocking** — centre-stripe |
| `.bottom-nav,.admin-bottom` | `position:fixed;bottom:0;left:0;right:0;z-index:40;display:flex;min-height:76px` | **Blocking** — bottom rail |
| `.bottom-link,.admin-bottom-item` | `flex:1 1 0;flex-direction:column` | Nav items |
| `.app-shell,.admin-shell{height:100dvh;display:flex;flex-direction:column;overflow:hidden}` | Fixed viewport, main scrolls | JS measures heights |
| `.pull-refresh-indicator` | `position:fixed;top:80px;left:50%` | Pull refresh |

### `css/ui-modern.css` (visual layer)
| Selector | Rule |
|---|---|
| `.app-shell,.admin-shell,.pay-shell{background:transparent}` |
| `.app-topbar-inner{min-height:68px;padding-inline:clamp(14px,3vw,28px)}` |
| `.app-main,.admin-main,.pay-main{padding-top:clamp(18px,3vw,30px);padding-inline:clamp(14px,3vw,28px)}` |
| `.auth-card{max-width:460px}` |
| `.bottom-nav,.admin-bottom{min-height:72px}` |

### `css/ui-wallet.css` (skin — loads **last**, wins on desktop)
| Selector | Rule | Note |
|---|---|---|
| `.auth-screen,.auth-screen[data-sky]{display:flex;flex-direction:column;background:var(--auth-glass-canvas);padding:max(14px,env(safe-area-inset-top)) 14px max(16px,calc(12px+var(--safe-bottom)))` | Duplicate flex baseline (overrides ui-auth) |
| `.auth-sky,.auth-orb,.auth-cloud{display:none}` | Sky hidden → minimal card |
| `.auth-card{max-width:396px;margin:auto;padding:24px 20px;border-radius:20px}` | **Overrides ui-auth 480→396** — tighter |
| `.bottom-nav,.admin-bottom` | `position:fixed;bottom:0;... min-height:calc(66px+var(--safe-bottom))` | Duplicate fixed nav (wins over ui-layout) |
| `@media screen { @media (min-width:1024px){ :is(.app-shell,.admin-shell){grid-template-columns:248px 1fr ...} ... .pay-shell> .admin-bottom{position:fixed ... width:248px} .pay-shell> .pay-main{margin-left:248px} } }` | **Only existing desktop rule** — but inside single `@media screen` wrapper; pay-shell used fixed+margin, not grid |

### `css/ui-interior.css`, `css/app-polish.css`, `css/student-home-design.css` etc.
* No `max-width:1160` — scoped to cards/heroes. `student-home-design.css` loads only on `student.html`.

---

## B. Shell Class / ID Comparison — Every HTML Entry

| Entry | HTML Shell Element | Topbar | Main | Bottom/Nav | CSS Order (15) | Extra |
|---|---|---|---|---|---|---|
| `index.html` (login + student) | `<section #authScreen.auth-screen>` (login) + `<div #appShell.app-shell hidden>` | `.app-topbar>.app-topbar-inner` (≤1160px) | `#appMain.app-main` (1160px) + `.view` panels (home/courses/routine/exams/profile) | `.bottom-nav` (fixed) | foundation→…→ui-wallet (v=443) | `#studentHeader` inside appShell |
| `student.html` | `<div #appShell.app-shell hidden>` | same | same | same | same 15 | `student-home-design.css` + hero-cards |
| `admin.html` | `<div #adminShell.admin-shell hidden>` | `.app-topbar>.app-topbar-inner` (≤1160px) | `#adminMain.admin-main` (1160px) | `.admin-bottom` (fixed 5 seats) | same 15 | — |
| `manager.html` | `<div #managerShell.manager-shell.admin-shell hidden>` | same | `#managerMain.admin-main` | `.admin-bottom` (fixed) | same 15 | — |
| `teacher.html` | `<div #teacherShell.teacher-shell.admin-shell hidden>` | same | `#teacherMain.admin-main` | `.admin-bottom` (fixed, chat kept) | same 15 + `teacher-panel.css` | chat shortcut |
| `payment.html` | `<div #payShell.pay-shell hidden>` | same | `.pay-main` (+ `.counter-*` panels) | `.admin-bottom` (5 seats: home/students/payment/reports/more) | same 15 | `.pay-stickybar` |

*All entries link the 15 stylesheets in **design-system.css** order — validated by `tools/css-order-check.mjs` + `tests/css-order.test.mjs`.*

*Student vs Staff split via `?shell=student|staff` in `sw.js` precache (`APP_SHELL` vs `STAFF_SHELL`, `PRECACHE_CONCURRENCY=4`).*

---

## C. Specificity / Blocking Rules Preventing Desktop Override

1. **No `min-width` overrides existed** (except `ui-wallet`’s one `min-width:1024` inside `@media screen`). Therefore `max-width:1160px;margin:auto` and `position:fixed bottom:0` from mobile cascade won on desktop.
2. **`ui-wallet.css` loads last** — its `max-width:396px` for `.auth-card` and `position:fixed` for nav overrode `ui-auth.css`/`ui-layout.css`. Without a desktop counter-rule *in `ui-wallet`* (or later), desktop grids could not win.
3. **`1160px` content lock** — `ui-layout`’s `.app-topbar-inner` + `.app-main` + `admin-main` + `pay-main` all `max-width:1160px;margin:auto`. Desktop needs `max-width:none` (header) + `max-width:var(--content-max)` centred inside main (1280–1400).
4. **`fixed` bottom nav** — wallet + ui-layout both set `position:fixed`. Desktop needs `position:static; grid-area:sidebar; border-right:...` with `flex-direction:column` + `min-height:0;height:calc(100dvh - var(--shell-header-height))`.
5. **Pay shell special-case** — wallet used `position:fixed + margin-left:248px` for `.pay-shell`; unifying to `display:grid` (like app/admin) avoids double offset on desktop.

---

## D. Files to Change (Step 2 — Implemented 2026-10-31)

| File | Change |
|---|---|
| `css/foundation.css` | Add `--sidebar-width:0px; --content-max:1280px; --auth-hero-gradient:linear-gradient(135deg,#0e7a55 0%,#0b6548 55%,#083d2b 100%)` + dark variant |
| `css/ui-auth.css` | Keep `position:fixed inset:0 height:100dvh`; add `@media (min-width:768px)` refinements; add `@media (min-width:1024px)` two-col grid: left `.auth-hero` (gradient + logo/name/sentence/points) + right `.auth-card max-width 440-480px`; compact 1024-1280, wide 1600, centred 1920 |
| `css/ui-layout.css` | Tablet `768px` 2-col hints; desktop `1024px` grid `var(--sidebar-width) 1fr` (`sidebar 240-260`), header spans full width, main scrolls with `max-width:var(--content-max)`, sidebar rail vertical, hover/focus, 2-3 col cards, chat fills content; 1024-1280 compact, 1280/1600/1920 breakpoints |
| `css/ui-wallet.css` | Pay shell unified to grid (`var(--sidebar-width)`), app/admin rail to `var(--sidebar-width)`, auth parity inside single `screen` wrapper (`display:grid` override) |
| `css/ui-interior.css` / `app-polish.css` | No layout width edits — visual only |
| `js/fixed-shell.js` | Measure header always; on desktop set `--shell-footer-height:0px` + `--sidebar-width` from nav width; debounce 60ms via `setTimeout+rAF`, `ResizeObserver` on nav/body/main, `resize`/`orientationchange` passive, `matchMedia` change listener |
| `sw.js` / `js/service-worker.js` / `js/cache-refresh.js` | Bump `CACHE_VERSION`/`SW_VERSION`/`DEFAULT_VERSION` 442→443 (versioned `?v=` + `&shell=` precache) |
| `index.html` ( + `admin/manager/teacher/payment/student.html` pins) | Add `<div class="auth-hero">` (hidden <1024, gradient + brand + Bengali copy) to two-col layout; bump all `?v=442` → `?v=443` |

*Preserved: `≤767px` unchanged, dark/light via `data-theme`, safe-area/ PWA, no new libs, tokens only, CLS-safe (`contain:layout`, measured heights), focus/hover.*

