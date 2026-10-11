# Login Sky Theme — সময় · ঋতু · আবহাওয়া (2026-10-11)

Report for the login-page theme fix: the sky must follow the clock, the six
Bengali seasons and the day's weather — and the sun/moon must never stand
frozen in one place.

## Root cause

1. **The sun and moon were baked into the sky photographs**
   (`assets/sky/clear-day.jpg` had a sun disc + rays at the top-right,
   `assets/sky/clear-night.jpg` had a moon at top-centre). A photograph cannot
   move, so the celestial body stayed glued to one spot at every hour.
   The CSS `.auth-orb` glow was `top: -46px; right: 8%` — also fixed — and it
   was `display: none` for every sky except `dusk`.
2. **The theme barely knew time.** `paintAuthWeather()` ran ONCE at login
   boot. A tab left open never crossed dawn → day → dusk → night. The clock
   sky had only three coarse bands (day 5–16:59, dusk 17–18:59, night
   19–4:59), and a 30-minute sessionStorage cache could pin a stale sky past
   sunset.
3. **Seasons did not exist in the code at all.** No ঋতু logic, no seasonal
   light, no seasonal sunrise/sunset.
4. Weather was fetched once from open-meteo (condition mapping already
   existed) but never refreshed while the page was open.

## Fixes (files)

- **`assets/sky/clear-day.jpg`, `assets/sky/clear-night.jpg`** — the baked-in
  sun disc/rays and moon were removed (soft, feathered sky/nebula patches
  matched to the surrounding light); the photographs are now pure atmosphere.
  `dusk.jpg` was already clean.
- **`js/login.js`** — new auth-sky engine (pure, testable):
  - `seasonFromDate()` — the six Bengali seasons (শীত ১৫ ডিসে–১৪ ফেব,
    বসন্ত ১৫ ফেব–১৪ এপ্রিল, গ্রীষ্ম ১৫ এপ্রিল–১৪ জুন, বর্ষা ১৫ জুন–১৪ আগ,
    শরৎ ১৫ আগ–১৪ অক্টো, হেমন্ত ১৫ অক্টো–১৪ ডিসে), each carrying its own
    sunrise/sunset fallback — so even fully offline a December dawn differs
    from a June one.
  - `daypartFromClock()` — dawn/day/dusk/night windows computed around the
    real (or seasonal) sunrise/sunset, not frozen clock hours.
  - `skyConditionFromWeather()` / `skyFromWeather()` — WMO codes →
    clear/cloudy/rain/storm/fog/heat (≥34°C day), overriding the daypart sky;
    a full cloud deck hides the orb.
  - `orbFromClock()` — the sun/moon **position**: an east→west arc
    (x 14%→86%), height peaking at noon, horizon swell + warm tint at
    sunrise/sunset; the moon rides its own arc across the night hours.
  - `authSkyState()` — one pure function decides the whole scene.
  - `applyAuthState()` — writes `data-sky/daypart/season/celestial/orb-warm`
    + `--orb-x/--orb-y/--orb-size` on `#authScreen` and the status line; the
    orb glides between minute paints but lands instantly on the first paint
    and on a sun↔moon swap.
  - `paintAuthSky()` + `startAuthSkyClock()` — recomputed **every minute** and
    on tab return; weather re-fetched every 30 min (open-meteo now also
    returns `daily=sunrise,sunset` for the arc); fully offline the clock +
    season still drive everything.
- **`index.html`** — `#authSkyNote` status line under the tagline
  (`শুভ দুপুর · ঋতু: শরৎ · আবহাওয়া: পরিষ্কার আকাশ`).
- **`css/foundation.css`** — palette only (repo rule: no raw colours in
  ui-wallet.css): `--sky-orb-sun/-sun-warm/-moon`, `--sky-glow-dawn`,
  `--sky-scrim-dawn`, `--sky-fall-dawn`, six `--sky-wash-*` season tints,
  `--sky-note-bg/-ink`, `--orb-*` defaults.
- **`css/ui-wallet.css`** — the orb is positioned by the JS arc vars (no more
  fixed corner), sun/moon/warm looks per `data-celestial`/`data-orb-warm`,
  hidden behind cloud decks, `dawn` sky state, per-season washes
  (`data-season`), status-line pill.
- **`sw.js`** — `CACHE_VERSION` 257 + `?v=257` everywhere (photos/JS/CSS
  changed → no stale clients).

## Test results (this machine)

- **New:** `tests/auth-sky-theme.test.mjs` — **6/6 pass**:
  6-season year mapping (incl. Dec–Feb wrap), seasonal dayparts (5:30 is dawn
  in May but night in January), weather overrides (storm/rain/fog/heat/
  cloudy + orb hidden), sun arc monotonic + horizon warmth/swell + moon arc,
  live DOM repaint across hours (sun → moon, orb vars move, status line
  follows), cached rain of the day overriding the clock sky.
- **Playwright visual probe** (throwaway spec, since removed): noon/dusk/
  night/monsoon-dawn screenshots of the real login page — orb cores land
  exactly on the computed arc positions (pixel-probed), season+greeting chip
  correct per scene.
- **Regression:** full jsdom suite green — see below; `wallet-design` token
  guard satisfied (all new colours live in foundation.css).

## Remaining issues

- The sky photographs are atmosphere only now; if new weather photos are
  added later, they should be kept free of baked sun/moon discs.
- Open-meteo is queried for the school's coordinates (Kanungopara). If the
  school moves, `KANUNGOPARA` in `js/login.js` needs the new lat/lon.
