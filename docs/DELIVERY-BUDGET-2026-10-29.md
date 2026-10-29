# Delivery budget — what each role actually downloads (29 Oct 2026)

Owner question: *"CDN কি ব্যবহার হচ্ছে? ইউস করা কি সুবিধাজনক?"*

## The answer: no third-party CDN, and it should stay that way

| Surface | What serves it |
| --- | --- |
| CSS, JS, images, fonts | Same origin, `?v=<build>` pins |
| Firebase SDK | `vendor/firebase/sdk.js` (808 KB, local) |
| Supabase SDK | `vendor/supabase/sdk.js` (218 KB, local) |
| Bengali font | `assets/fonts/NotoSansBengali-Variable.woff2` (self-hosted, 238 KB) |
| Analytics / tag managers | none |
| Service worker precache | 365 local URLs, no external host |

A third-party CDN (jsDelivr, unpkg, cdnjs) would cost more than it saves here:

* **CSP** — every page, `vercel.json` and `firebase.json` run
  `default-src 'self'`. A CDN means opening `script-src`/`font-src` to a third
  party in an app that holds staff passwords (PBKDF2), student records and the
  payment ledger. That is supply-chain surface for no gain.
* **Offline** — the PWA is cache-first with a 365-URL precache. External
  origins either break offline or force opaque responses.
* **Release pinning** — one build number (`?v=435` + `CACHE_VERSION`) is the
  whole invalidation contract; a CDN adds a second version axis — the same class
  of bug as the stale-address report fixed in Phase 1.
* **The edge is already there** — Vercel and Firebase Hosting both serve from
  their own edge; Bangladesh latency is comparable to or better than a public
  CDN.
* **Nothing is heavy at first paint** — Firebase, Supabase and the Tiptap studio
  are all `import()`-ed lazily.

So the work went into the two real wins instead.

## Win 1 — role-split precache (student devices stop paying for staff tools)

`sw.js` now keeps **two lists over one cache and one release pin**:

| Set | Files | Raw | ≈ gzip |
| --- | --- | --- | --- |
| `APP_SHELL` — student app, login door, icons, fonts, both cloud SDKs, the shared report chain | 322 | 5.08 MB | ~1.68 MB |
| `STAFF_SHELL` — 4 panel pages, panel roots, exam manager, phonebook, staff directory, admin modules, lecture studio + its 598 KB Tiptap SDK | 43 | 2.00 MB | ~0.66 MB |

`const PRECACHE = [...APP_SHELL, ...STAFF_SHELL]` is still what a staff device
installs, so staff offline behaviour is unchanged. The page names the shell it
needs at registration:

```js
// js/service-worker.js and js/cache-refresh.js
navigator.serviceWorker.register(`./sw.js?v=${SW_VERSION}&shell=${shellHint()}`)
```

and the worker reads it back from its own URL:

```js
function requestedShell() {
  return new URL(self.location.href).searchParams.get('shell') === 'staff' ? 'staff' : 'student';
}
```

**Result: a student device installs ~1.68 MB gzip instead of ~2.34 MB — a 28 %
cut (≈0.66 MB gzip, 2.00 MB of raw transfer) on every fresh install.** No hint
is treated as `student`: the smaller set is always the safe default, and a staff
device that somehow registers without the hint still fetches the staff half on
first panel use (the fetch handler is cache-first and remembers every static
GET).

The staff-only classification was verified twice, per file, and the second check
is automated: `tests/receipt-statement.test.mjs` walks the real import graph and
demands that the student half is closed under imports (`verify(app, app)`) while
the staff half may reach both (`verify(staff, all)`). That walk is what caught
the two shared chains — `sync/device-key-*` and the report builder
(`js/student-features.js` → `js/reports.js` → `js/report-catalog.js` →
`js/report-builders.js`) — and put them back in the student half.
`tests/delivery-budget-2026-10-29.test.mjs` re-proves it textually over the pages
the Student app loads. Anything a student page reaches (notably
`js/panel-lockdown.js`, which `js/notifications.js` imports) stayed in
`APP_SHELL`.

## Win 2 — immutable caching for versioned assets

`vercel.json` gains a rule scoped to `?v=` URLs:

```json
{ "source": "/(js|css|assets|vendor|sync|firebase)/(.*)",
  "has": [{ "type": "query", "key": "v" }],
  "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
```

Unversioned fetches keep the default so nothing can be pinned by accident, and
`sw.js` plus `*.html` remain `no-cache` — an update must always be able to land.
Firebase Hosting cannot match on a query string, so there the rule is scoped to
the one family whose filename *is* the version: `assets/fonts/**.woff2`.

## Release

`CACHE_VERSION` / `SW_VERSION` / `DEFAULT_VERSION` and every page pin move to
**435** together (the Student Home hero keeps its documented `?v=379` staging
build). Service-worker changes without a bump would never reach a device.

## Verification

* `tests/delivery-budget-2026-10-29.test.mjs` — sets are disjoint and complete,
  a student set names no staff page or studio, both registrars name the shell,
  no student-facing module imports a staff-only file, the cache headers are
  scoped correctly, and the release pin is one number.
* `tests/minimal-ui.test.mjs` — precache uniqueness/existence now covers both
  lists.
* `tests/sw-update-delivery.test.mjs` — the build-pinned registration URL keeps
  its guarantee with the added shell parameter.
