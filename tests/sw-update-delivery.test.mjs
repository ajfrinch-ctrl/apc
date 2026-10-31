/* Update delivery — a new build must reach an installed app on its own;
   nobody should have to clear the cache by hand (owner report 2026-10-15).
   The worker activates immediately (skipWaiting + clients.claim in sw.js),
   so the fragile link was discovery: a browser may answer an update check
   with its HTTP-cached copy of the worker script. These pins keep the
   discovery path honest:
     • the registration URL carries the build number, so every release asks
       for a script URL that has never been cached;
     • the registered number can never drift from sw.js's CACHE_VERSION
       (which also names the cache and every HTML asset pin);
     • a visible app re-checks instead of waiting for the browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sw = read('sw.js');
const registrar = read('js/service-worker.js');
const cacheVersion = Number(sw.match(/const CACHE_VERSION = (\d+)/)?.[1]);

test('the registered worker URL carries the build number', () => {
  assert.ok(Number.isSafeInteger(cacheVersion) && cacheVersion >= 1, 'CACHE_VERSION is a build number');
  const registered = Number(registrar.match(/export const SW_VERSION = (\d+)/)?.[1]);
  assert.equal(registered, cacheVersion, 'SW_VERSION must equal CACHE_VERSION or updates silently stall');
  /* The URL stays build-specific (the whole point of the pin) and additionally
     names the shell this device needs: staff panels ask for the staff half of
     the precache, every other page for the student half. */
  assert.match(registrar, /register\(`\.\/sw\.js\?v=\$\{SW_VERSION\}&shell=\$\{shellHint\(\)\}`\)/,
    'registration must use the versioned worker URL');
  assert.equal(registrar.includes("register('./sw.js')"), false, 'the unversioned worker URL is gone');

  const cacheRefresh = read('js/cache-refresh.js');
  const defaultRefreshVersion = Number(cacheRefresh.match(/const DEFAULT_VERSION = (\d+)/)?.[1]);
  assert.equal(defaultRefreshVersion, cacheVersion, 'cache-refresh.js DEFAULT_VERSION must equal CACHE_VERSION so it never ping-pongs with SW_VERSION');
  assert.match(cacheRefresh, /searchParams\.get\('v'\)/, 'cache-refresh.js reads the live ?v= pin from its script tag');
});

test('the worker still activates immediately and the app re-checks on return', () => {
  assert.match(sw, /await self\.skipWaiting\(\)/, 'a new worker must not wait for tabs to close');
  assert.match(sw, /await self\.clients\.claim\(\)/, 'open pages come under the new worker at once');
  assert.match(sw, /key !== CACHE_NAME/, 'activate deletes every older cache');
  assert.match(sw, /hadLegacySilentCache/, 'activate detects legacy pre-minimal-education caches (e.g. v53)');
  assert.match(sw, /client\.navigate\(client\.url\)/, 'activate reloads open windows trapped on legacy cache-first workers');
  assert.match(sw, /SKIP_WAITING/, 'worker listens for SKIP_WAITING messages');
  assert.match(sw, /cache:\s*'no-cache'/, 'worker revalidates with the server instead of copying stale HTTP cache entries');
  assert.match(registrar, /registration\.update\(\)/, 'registration forces an update check');
  assert.match(registrar, /visibilitychange/, 'a returning user triggers a fresh check');
  assert.match(registrar, /নতুন সংস্করণ আছে/, 'the update banner still offers the refresh');
  assert.match(registrar, /applyUpdateAndReload/, 'clicking refresh purges stale caches and activates the new worker before reloading');
});

test('every page pin agrees with the build the worker will cache', () => {
  /* Every linked stylesheet/script must carry the release pin (?v=CACHE_VERSION)
     — one shared pin is the app's invalidation contract. Student's isolated
     Home hero is a self-contained, unchanged asset group that stays pinned to
     its staging build (v379); these known CSS/JS paths are exempt even while
     the established page/worker build advances. The cache-first worker may
     resolve an older query by pathname, so the exempted files still resolve. */
  const STUDENT_HERO_STAGING_BUILD = 379;
  const stagedStudentHeroPaths = new Set([
    'css/hero-cards.css',
    'js/hero-cards.js',
    'js/student-home-hero-entry.js',
    'js/student-home-daily-hero.js'
  ]);
  for (const page of ['index.html', 'student.html', 'admin.html', 'manager.html', 'teacher.html', 'payment.html']) {
    const html = read(page);
    let pinned = 0;
    for (const [, path, pin] of html.matchAll(/([^\s"'<>?]+)\?v=(\d+)/g)) {
      if (page === 'student.html' && Number(pin) === STUDENT_HERO_STAGING_BUILD && stagedStudentHeroPaths.has(path)) continue;
      assert.equal(Number(pin), cacheVersion, `${page} pins an asset to another build`);
      pinned += 1;
    }
    assert.ok(pinned >= 10, `${page} really is pinned to this build`);
  }
  /* The demo harness and the stub pages share the same release builds — no
     page may keep its own stale copy of the version. */
  for (const page of ['demo/offline-roles.html', 'privacy.html']) {
    const html = read(page);
    let pinned = 0;
    for (const [, , pin] of html.matchAll(/([^\s"'<>?]+)\?v=(\d+)/g)) {
      assert.equal(Number(pin), cacheVersion, `${page} pins an asset to another build`);
      pinned += 1;
    }
    assert.ok(pinned >= 1, `${page} really is pinned to this build`);
  }
});
