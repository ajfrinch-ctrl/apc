/* Auth sky: the login backdrop is driven by সময় · ঋতু · আবহাওয়া.

   The sun/moon must MOVE — riding an arc from the clock and the sunrise/
   sunset window — and the scene must follow the six Bengali seasons and the
   day's weather. Locked down here on the pure state function and on the real
   index.html auth screen. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import {
  seasonFromDate, daypartFromClock, skyConditionFromWeather,
  orbFromClock, authSkyState, paintAuthSky
} from '../js/login.js';

const nfc = value => String(value).normalize('NFC');

test('the six Bengali seasons own fixed windows across the year', () => {
  const month = (iso) => seasonFromDate(new Date(iso)).key;
  assert.equal(month('2026-01-10T12:00:00'), 'sheet');
  assert.equal(month('2026-02-14T12:00:00'), 'sheet', 'শীত runs to Feb 14');
  assert.equal(month('2026-02-15T12:00:00'), 'basant');
  assert.equal(month('2026-04-14T12:00:00'), 'basant');
  assert.equal(month('2026-04-15T12:00:00'), 'grishmo');
  assert.equal(month('2026-05-20T12:00:00'), 'grishmo');
  assert.equal(month('2026-07-01T12:00:00'), 'borsha');
  assert.equal(month('2026-09-01T12:00:00'), 'shorot');
  assert.equal(month('2026-11-01T12:00:00'), 'hemonto');
  assert.equal(month('2026-12-20T12:00:00'), 'sheet', 'the Dec–Feb season wraps the year');
  assert.equal(nfc(seasonFromDate(new Date('2026-07-01T12:00:00')).label), nfc('বর্ষা'));
});

test('the daypart follows the seasonal sunrise/sunset, not frozen clock hours', () => {
  // শীত: sunrise 6:15, sunset 17:05 → dawn/day/dusk/night sit accordingly.
  const winter = iso => daypartFromClock(new Date(iso)).daypart;
  assert.equal(winter('2026-01-10T02:00:00'), 'night');
  assert.equal(winter('2026-01-10T06:20:00'), 'dawn');
  assert.equal(winter('2026-01-10T12:00:00'), 'day');
  assert.equal(winter('2026-01-10T17:30:00'), 'dusk');
  assert.equal(winter('2026-01-10T21:00:00'), 'night');
  // গ্রীষ্ম: sunrise 5:15 — the same 5:30 clock is already dawn in May but
  // still night in January. The seasons are really being read.
  assert.equal(daypartFromClock(new Date('2026-05-20T05:30:00')).daypart, 'dawn');
  assert.equal(daypartFromClock(new Date('2026-01-10T05:30:00')).daypart, 'night');
});

test('the day weather picks the scene; a full cloud deck hides the orb', () => {
  const noon = new Date('2026-01-10T12:00:00');
  assert.equal(skyConditionFromWeather(0, 25, 'day'), 'clear');
  assert.equal(skyConditionFromWeather(3, 25, 'day'), 'cloudy');
  assert.equal(skyConditionFromWeather(61, 22, 'day'), 'rain');
  assert.equal(skyConditionFromWeather(95, 24, 'day'), 'storm');
  assert.equal(skyConditionFromWeather(45, 18, 'day'), 'fog');
  assert.equal(skyConditionFromWeather(0, 35, 'day'), 'heat', 'প্রচণ্ড গরম যোগ হয়');
  assert.equal(authSkyState(noon, { code: 95, tempC: 24 }).sky, 'storm');
  assert.equal(authSkyState(noon, { code: 61, tempC: 22 }).sky, 'rain');
  assert.equal(authSkyState(noon, { code: 0, tempC: 35 }).sky, 'heat');
  assert.equal(authSkyState(noon, { code: 2, tempC: 22 }).sky, 'cloudy');
  const cloudy = authSkyState(noon, { code: 3, tempC: 22 });
  assert.equal(cloudy.celestial, '', 'no sun behind a full cloud deck');
});

test('the sun walks its arc through the day; the moon owns the night', () => {
  const morning = orbFromClock(new Date('2026-01-10T10:00:00'), null, 'sun');
  const noon = orbFromClock(new Date('2026-01-10T12:00:00'), null, 'sun');
  const afternoon = orbFromClock(new Date('2026-01-10T15:00:00'), null, 'sun');
  assert.ok(morning.x < noon.x && noon.x < afternoon.x, 'the sun moves west over the hours');
  assert.ok(noon.y < morning.y, 'the sun is highest around noon');
  assert.equal(morning.warmLevel, 'low');
  const dawn = orbFromClock(new Date('2026-01-10T06:20:00'), null, 'sun');
  assert.equal(dawn.warmLevel, 'high', 'a low sun glows warm');
  assert.ok(dawn.size > noon.size, 'a horizon sun swells');

  const state = authSkyState(new Date('2026-01-10T21:00:00'));
  assert.equal(state.sky, 'clear-night');
  assert.equal(state.celestial, 'moon');
  assert.ok(state.orb.x >= 16 && state.orb.x <= 84, 'the moon is on its own arc');
});

let ctx;
before(async () => {
  ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
});
after(() => ctx?.window.close());

test('the login screen repaints as time passes — sun, season line and all', async () => {
  await paintAuthSky(new Date('2026-01-10T12:00:00'));
  const screen = ctx.$('#authScreen');
  assert.equal(screen.dataset.sky, 'clear-day');
  assert.equal(screen.dataset.season, 'sheet');
  assert.equal(screen.dataset.celestial, 'sun');
  assert.equal(screen.dataset.orbWarm, 'low');
  const noonX = screen.style.getPropertyValue('--orb-x');
  const noonY = screen.style.getPropertyValue('--orb-y');
  assert.ok(noonX && noonY, 'the orb is positioned');


  // Hours later, same open tab: the scene must have moved on by itself.
  await paintAuthSky(new Date('2026-01-10T21:00:00'));
  assert.equal(screen.dataset.sky, 'clear-night');
  assert.equal(screen.dataset.celestial, 'moon');
  const nightX = screen.style.getPropertyValue('--orb-x');
  const nightY = screen.style.getPropertyValue('--orb-y');
  assert.notEqual(noonX, nightX, 'the sun/moon has travelled');
  assert.notEqual(noonY, nightY);
});

test('cached weather of the day overrides the clock sky on repaint', async () => {
  /* The snapshot carries the campus point it was taken for; the cache key is
     the shared one (activePlus.authWeather.v3), and a mismatch means "ignore". */
  const { campusPoint } = await import('../js/login.js');
  const point = campusPoint();
  ctx.window.sessionStorage.setItem('activePlus.authWeather.v3', JSON.stringify({
    code: 61, tempC: 22, sunrise: 375, sunset: 1025, lat: point.lat, lon: point.lon, at: Date.now()
  }));
  await paintAuthSky(new Date('2026-01-10T12:00:00'));
  const screen = ctx.$('#authScreen');
  assert.equal(screen.dataset.sky, 'rain', 'the day weather paints the sky');
  assert.equal(screen.dataset.celestial, '', 'rain hides the sun');
  // Dawn the same day: rain still owns the photograph, but the line knows.
  await paintAuthSky(new Date('2026-01-10T06:20:00'));
  assert.equal(screen.dataset.sky, 'rain');
  ctx.window.sessionStorage.removeItem('activePlus.authWeather.v3');
});

/* ---------------------------------------------------------------------------
   The sky belongs to the campus (owner report 2026-10-29: "ওয়েদার লোকেশন ভুল
   দেখাচ্ছে"). The login screen used to ask for one hard-coded village, so the
   temperature, the rain and the sunrise/sunset described another district no
   matter what Admin → Settings said the address was.
   ------------------------------------------------------------------------- */

test('the campus point comes from the shared record, never from a constant', async () => {
  const { campusPoint } = await import('../js/login.js');
  const { DEFAULT_APP_SETTINGS } = await import('../js/config.js');
  const { loadAppConfig, saveAppConfig } = await import('../js/storage.js');

  const saved = loadAppConfig();

  /* Nothing stored: the defaults are the campus address's own district. */
  saveAppConfig({ ...saved, campusLat: undefined, campusLon: undefined });
  assert.equal(DEFAULT_APP_SETTINGS.campusAddress, 'দিনাজপুর সদর, দিনাজপুর');
  assert.deepEqual(campusPoint(), {
    lat: DEFAULT_APP_SETTINGS.campusLat, lon: DEFAULT_APP_SETTINGS.campusLon
  });

  /* Move the campus the way the Settings form does — the point follows. */
  saveAppConfig({ ...saved, campusLat: 23.4607, campusLon: 91.1809 });
  assert.deepEqual(campusPoint(), { lat: 23.4607, lon: 91.1809 });

  /* Junk in storage falls back to the default instead of pointing at 0,0. */
  saveAppConfig({ ...saved, campusLat: 'north', campusLon: NaN });
  assert.deepEqual(campusPoint(), {
    lat: DEFAULT_APP_SETTINGS.campusLat, lon: DEFAULT_APP_SETTINGS.campusLon
  });
  saveAppConfig(saved);
});

test('the weather request names the saved campus point and no other place', async () => {
  const { paintAuthSky } = await import('../js/login.js');
  const { loadAppConfig, saveAppConfig } = await import('../js/storage.js');
  const asked = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    asked.push(String(url));
    return {
      ok: true,
      async json() {
        return {
          current: { weather_code: 3, is_day: 1, temperature_2m: 24 },
          daily: { sunrise: ['2026-10-29T06:12'], sunset: ['2026-10-29T17:25'] }
        };
      }
    };
  };
  try {
    saveAppConfig({ ...loadAppConfig(), campusLat: 23.4607, campusLon: 91.1809 });
    ctx.window.sessionStorage.removeItem('activePlus.authWeather.v3');
    await paintAuthSky(new Date('2026-10-29T12:00:00'));
    const url = new URL(asked.at(-1));
    assert.equal(url.host, 'api.open-meteo.com');
    assert.equal(url.searchParams.get('latitude'), '23.4607');
    assert.equal(url.searchParams.get('longitude'), '91.1809');
    assert.equal(url.searchParams.get('timezone'), 'Asia/Dhaka');

    /* A snapshot taken for the previous point is not reused: the next paint
       asks again for the campus the app now describes. */
    ctx.window.sessionStorage.setItem('activePlus.authWeather.v3', JSON.stringify({
      code: 61, tempC: 22, sunrise: 375, sunset: 1025, lat: 25.6217, lon: 88.6354, at: Date.now()
    }));
    const before = asked.length;
    await paintAuthSky(new Date('2026-10-29T12:00:00'));
    assert.equal(asked.length, before + 1, 'a snapshot for another point is ignored');
  } finally {
    globalThis.fetch = originalFetch;
    ctx.window.sessionStorage.removeItem('activePlus.authWeather.v3');
  }
});

test('no module hard-codes a campus location any more', () => {
  const files = ['js/login.js', 'js/main.js', 'js/config.js', 'js/org-info.js', 'js/admin.js'];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /22\.35803|92\.1238/, `${file} still names the old village`);
    assert.doesNotMatch(source, /kanungopara/i, `${file} still names the old cache/area`);
  }
  /* The Admin Settings form edits the point next to the address it belongs to. */
  const adminHtml = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
  for (const id of ['cfgAddress', 'cfgLatitude', 'cfgLongitude']) {
    assert.ok(adminHtml.includes(`id="${id}"`), `${id} is part of the branding card`);
  }
  const adminJs = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(adminJs, /campusLat:/, 'the saver writes the latitude');
  assert.match(adminJs, /campusLon:/, 'the saver writes the longitude');
  assert.match(adminJs, /function clampCoordinate/, 'a typed coordinate is validated before it is stored');
});
