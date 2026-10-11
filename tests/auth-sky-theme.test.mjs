/* Auth sky: the login backdrop is driven by সময় · ঋতু · আবহাওয়া.

   The sun/moon must MOVE — riding an arc from the clock and the sunrise/
   sunset window — and the scene must follow the six Bengali seasons and the
   day's weather. Locked down here on the pure state function and on the real
   index.html auth screen. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
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

  const note = ctx.$('#authSkyNote');
  assert.equal(note.hidden, false, 'the status line shows');
  const noonNote = nfc(note.textContent);
  assert.ok(noonNote.includes(nfc('শীত')), `season is on the line: ${noonNote}`);
  assert.ok(noonNote.includes(nfc('শুভ দুপুর')), `greeting follows the clock: ${noonNote}`);

  // Hours later, same open tab: the scene must have moved on by itself.
  await paintAuthSky(new Date('2026-01-10T21:00:00'));
  assert.equal(screen.dataset.sky, 'clear-night');
  assert.equal(screen.dataset.celestial, 'moon');
  const nightX = screen.style.getPropertyValue('--orb-x');
  const nightY = screen.style.getPropertyValue('--orb-y');
  assert.notEqual(noonX, nightX, 'the sun/moon has travelled');
  assert.notEqual(noonY, nightY);
  assert.ok(nfc(note.textContent).includes(nfc('শুভ রাত্রি')));
});

test('cached weather of the day overrides the clock sky on repaint', async () => {
  ctx.window.sessionStorage.setItem('activePlus.authWeather.kanungopara.v2', JSON.stringify({
    code: 61, tempC: 22, sunrise: 375, sunset: 1025, at: Date.now()
  }));
  await paintAuthSky(new Date('2026-01-10T12:00:00'));
  const screen = ctx.$('#authScreen');
  assert.equal(screen.dataset.sky, 'rain', 'the day weather paints the sky');
  assert.equal(screen.dataset.celestial, '', 'rain hides the sun');
  assert.ok(nfc(ctx.$('#authSkyNote').textContent).includes(nfc('বৃষ্টি')));
  // Dawn the same day: rain still owns the photograph, but the line knows.
  await paintAuthSky(new Date('2026-01-10T06:20:00'));
  assert.equal(screen.dataset.sky, 'rain');
  ctx.window.sessionStorage.removeItem('activePlus.authWeather.kanungopara.v2');
});
