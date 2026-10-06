/** Active Plus Color, v1 — original SVG artwork for this app (not the old
 * line-path set recoloured). Layered, rounded illustrations for services and
 * purpose-drawn, simplified silhouettes for navigation/controls. No fonts,
 * sprites, raster images, CDN, animation, storage or application behavior.
 * All paint comes from the shared foundation palette and follows AMOLED. */
export const ICON_SET = 'active-plus-color';
export const ICON_SET_VERSION = 1;

const ink = 'var(--icon-outline, currentColor)';
const color = name => `var(--icon-${name}, currentColor)`;
const path = (d, fill = 'none', extra = '') => `<path d="${d}" fill="${fill === 'none' ? fill : color(fill)}" ${extra}/>`;
const rect = (x, y, width, height, fill, radius = 2, extra = '') => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${color(fill)}" ${extra}/>`;
const circle = (x, y, radius, fill, extra = '') => `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color(fill)}" ${extra}/>`;
const stroke = (d, paint = 'outline', width = 1.25) => `<path d="${d}" fill="none" stroke="${color(paint)}" stroke-width="${width}"/>`;
const art = content => `<g stroke="${ink}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${content}</g>`;
const check = (d = 'm15 17 1.7 1.7 3.5-3.7') => stroke(d, 'on-color', 1.6);
const person = (x, y, shirt = 'blue') => circle(x, y, 2.8, 'paper') + path(`M${x-4.6} ${y+8.3}v-1.3a4.6 4.6 0 0 1 9.2 0v1.3Z`, shirt);

export const ILLUSTRATIONS = Object.freeze({
  home: art(path('m2 11 10-8.4L22 11', 'blue') + path('M4.4 10.7v9.6q0 1.2 1.2 1.2h12.8q1.2 0 1.2-1.2v-9.6', 'paper') + rect(9.3, 14, 5.4, 7.5, 'mint', 1.4) + rect(6.2, 11.7, 3.2, 2.9, 'blue-back', .8) + circle(13, 17.6, .35, 'paper', 'stroke="none"')),
  dashboard: art(rect(2.8, 3.2, 7.5, 7.5, 'blue', 2.1) + rect(13.3, 3.2, 7.5, 7.5, 'mint', 2.1) + rect(2.8, 13.5, 7.5, 7.5, 'gold', 2.1) + rect(13.3, 13.5, 7.5, 7.5, 'paper', 2.1) + stroke('M5.2 7h2.7M17 5.6v2.7M15.6 7h2.8', 'on-color') + path('m5.2 17.3 1.2 1.2 1.7-2', 'none') + stroke('M15.5 18.5v-2M17.8 18.5v-3', 'blue')),
  book: art(path('M3.2 5.4h7.9l2.2 2v13.2H5.2a2 2 0 0 1-2-2Z', 'blue-back') + rect(6, 3.3, 14.8, 17.6, 'blue', 2) + path('M6 17.6h13.4v3.3H7.8a1.7 1.7 0 0 1 0-3.3', 'paper') + path('M14.8 3.3h3.1v7l-1.55-1.5-1.55 1.5Z', 'mint', 'stroke="none"') + stroke('M9.2 7.5h3M9.2 10.2h3', 'on-color', 1.4)),
  classes: art(rect(2.5, 3.5, 19, 13.7, 'blue', 2.2) + rect(4.7, 5.7, 14.6, 8.7, 'mint-back', 1) + stroke('M7.2 9h4.5M7.2 11.8h7.8', 'outline') + path('M8.2 17.2 6.7 21M15.8 17.2l1.5 3.8', 'none') + stroke('M10.2 19.4h3.6') + rect(15.8, 12.8, 4.4, 2.1, 'gold', .7)),
  teacher: art(rect(8.8, 3.4, 12.5, 12.5, 'mint', 1.9) + stroke('M12 7h6M12 10h3', 'on-color', 1.4) + stroke('M14.8 15.9V20M11.3 20h7') + person(5.9, 10.9, 'blue') + stroke('m9.9 15 2.5-2.8', 'outline', 1.4)),
  users: art(person(6.8, 8.3, 'mint') + person(17.2, 8.3, 'blue') + circle(12, 10, 3, 'paper') + path('M7 21v-1.5a5 5 0 0 1 10 0V21Z', 'blue-back')),
  students: art(person(11.2, 11.4, 'blue') + path('m4 6.5 7.2-3.2 7.2 3.2-7.2 3.2Z', 'mint') + path('M7.2 8v2.2q4 2.7 8 0V8', 'mint-back') + stroke('M18.4 6.5v4.8', 'outline') + circle(18.4, 12.1, .75, 'gold') + rect(15.7, 16.6, 5.7, 4.9, 'gold', .8) + stroke('M17.4 18.7h2.3', 'outline', 1)),
  staff: art(path('M9 4.5V2.8h6v1.7', 'none') + rect(2.8, 4.5, 18.4, 16.5, 'paper', 2.5) + rect(2.8, 4.5, 18.4, 4.3, 'blue', 2.1) + rect(9.2, 3.2, 5.6, 3.4, 'mint', 1) + circle(7.7, 12.9, 2, 'blue-back') + path('M4.8 18v-.8a2.9 2.9 0 0 1 5.8 0v.8Z', 'mint') + stroke('M13 12.5h5.3M13 15.2h3.7', 'blue')),
  user: art(circle(12, 12, 9.1, 'blue-back') + circle(12, 9.1, 3.2, 'paper') + path('M5.2 18.4a6.8 6.8 0 0 1 13.6 0q-6.8 5.5-13.6 0', 'blue') + circle(19, 18.7, 3.2, 'mint') + check('m17.5 18.7 1 1 1.9-2')),
  calendar: art(rect(3, 4.7, 18, 16.3, 'paper', 2.5) + path('M3 9V7.2a2.5 2.5 0 0 1 2.5-2.5h13A2.5 2.5 0 0 1 21 7.2V9Z', 'blue') + stroke('M7.2 2.8v4.3M16.8 2.8v4.3', 'outline', 1.7) + rect(6.1, 11.8, 3.4, 3.4, 'gold', .8, 'stroke="none"') + stroke('M12.2 12.3h4.6M6.5 17.8h3.4', 'blue', 1.4) + circle(18, 18.4, 4.1, 'mint') + check('m15.9 18.4 1.4 1.5 2.8-3')),
  clock: art(circle(12, 12.3, 8.9, 'paper') + path('M12 3.4a8.9 8.9 0 0 1 8.9 8.9H12Z', 'blue-back', 'stroke="none"') + '<circle cx="12" cy="12.3" r="6.8" fill="none"/>' + stroke('M12 7.6v4.7l3.4 2', 'blue', 1.8) + circle(12, 12.3, .8, 'mint') + path('m4.2 5-1.5-1.5M19.8 5l1.5-1.5', 'none')),
  exam: art(rect(3.4, 3.9, 14.5, 17.4, 'violet', 2) + rect(5.5, 6, 10.3, 13.2, 'paper', .9) + rect(7.3, 2.5, 6.7, 4.5, 'blue-back', 1.4) + stroke('m7.8 10.3 1 1 1.6-1.9M12.2 10.4h1.6M7.8 14h5.6M7.8 16.7h3.6', 'blue', 1.1) + path('m17.6 11.1 3.2 1.8-5.1 8.5-3.6 1.1-.1-3.6Z', 'gold') + path('m17.6 11.1 1-1.6a1 1 0 0 1 1.4-.3l1.5.8a1 1 0 0 1 .3 1.4l-1 1.5Z', 'coral') + stroke('m12.1 18.9 3.6 2.5', 'outline', 1)),
  mcq: art(rect(3.4, 2.8, 17.2, 18.5, 'paper', 2.3) + path('M3.4 7.2V5.1a2.3 2.3 0 0 1 2.3-2.3h12.6a2.3 2.3 0 0 1 2.3 2.3v2.1Z', 'blue') + circle(7.5, 11, 1.6, 'mint') + circle(7.5, 16.8, 1.6, 'blue-back') + stroke('m6.7 11 .6.6 1.2-1.3', 'on-color', 1) + stroke('M11.3 11h5.5M11.3 16.8h5.5', 'blue')),
  result: art(path('M6.8 6.2H3.2v3a4.7 4.7 0 0 0 4.7 4.7M17.2 6.2h3.6v3a4.7 4.7 0 0 1-4.7 4.7', 'gold') + path('M6.2 3.4h11.6v6.2a5.8 5.8 0 0 1-11.6 0Z', 'gold') + stroke('M12 15.4v3.3', 'outline', 1.8) + rect(7.3, 18.7, 9.4, 3, 'blue', 1) + path('m12 5.9 1.1 2.2 2.5.4-1.8 1.7.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.7 2.5-.4Z', 'paper', 'stroke="none"')),
  attendance: art(person(8.2, 7.3, 'blue') + path('M3.5 20.7v-4.1a4.7 4.7 0 0 1 9.4 0v4.1Z', 'blue-back') + rect(13.7, 6.4, 7.6, 13.9, 'paper', 1.5) + path('M13.7 10h7.6V8a1.5 1.5 0 0 0-1.5-1.6h-4.6A1.5 1.5 0 0 0 13.7 8Z', 'mint') + circle(17.5, 15.5, 2.5, 'mint') + check('m16 15.5 1 1.1 2-2.3')),
  notice: art(path('M4.3 8.1h4.8L18.8 4v14l-9.7-4.1H4.3Z', 'mint') + rect(2.4, 8.3, 4.3, 5.4, 'blue', 1.2) + path('M8.7 13.8 11 21h-4L5 13.8Z', 'blue') + path('M9.1 8.1v5.8L18.8 18V4Z', 'paper') + stroke('M21 7.2 22.3 6M21.4 11h1.5M21 14.8l1.3 1.2', 'gold', 1.5)),
  wallet: art(path('M3.1 8V5.4a2 2 0 0 1 2-2h13.4v6.3', 'blue-back') + rect(7.6, 2.5, 12.3, 9.7, 'mint', 1.2) + circle(13.8, 6.9, 2, 'paper') + stroke('M10 5.1v3.6M17.6 5.1v3.6', 'on-color', 1) + rect(2.8, 8, 18.4, 13.5, 'blue', 2.5) + rect(14.7, 12.4, 7, 5.2, 'paper', 1.5) + circle(17.3, 15, .9, 'mint', 'stroke="none"') + stroke('M5.7 11h4.5', 'on-color', 1.3)),
  receipt: art(path('M5.1 2.6h13.8v19.1l-2.3-1.5-2.3 1.5-2.3-1.5-2.3 1.5-2.3-1.5-2.3 1.5Z', 'paper') + rect(7.5, 5.1, 9, 4.3, 'blue', .9) + stroke('M10.1 7.2h3.8', 'on-color') + stroke('M7.7 12.2h3.8M7.7 15.1h5.7', 'blue') + circle(17.7, 16.5, 3.9, 'mint') + check('m15.8 16.5 1.3 1.4 2.6-2.9')),
  reports: art(rect(3, 3, 16, 18.5, 'paper', 2) + rect(6, 13, 2.8, 5.5, 'blue', .8, 'stroke="none"') + rect(10.5, 10, 2.8, 8.5, 'mint', .8, 'stroke="none"') + rect(15, 7, 2.8, 11.5, 'gold', .8, 'stroke="none"') + stroke('m5.7 9 4.8-2.5 4.7.4 6-4', 'blue', 1.5) + stroke('m18.2 2.9 3 .1-.6 3', 'blue', 1.5)),
  data: art(path('M3.5 6.4v12.3c0 3.5 17 3.5 17 0V6.4Z', 'blue') + path('M3.5 12.1c0 3.5 17 3.5 17 0v3.4c0 3.5-17 3.5-17 0Z', 'mint') + '<ellipse cx="12" cy="6.4" rx="8.5" ry="3.5" fill="var(--icon-paper)"/>' + path('M6.2 6.4c2.2-1.3 9.4-1.3 11.6 0', 'none') + circle(17.3, 18.1, .55, 'paper', 'stroke="none"')),
  backup: art(path('M6.1 17.8a4.7 4.7 0 0 1-.9-9.3 6.8 6.8 0 0 1 13.1-1.7 5.6 5.6 0 0 1 .4 11Z', 'blue-back') + circle(12.2, 16.7, 5.2, 'mint') + stroke('M12.2 19.4v-5.6m-2.1 2.1 2.1-2.1 2.1 2.1', 'on-color', 1.6)),
  settings: art(rect(3, 3, 18, 18, 'paper', 3) + stroke('M6.2 7.5h11.6M6.2 12h11.6M6.2 16.5h11.6', 'blue-back', 1.6) + circle(9, 7.5, 2, 'blue') + circle(15, 12, 2, 'mint') + circle(10.5, 16.5, 2, 'gold')),
  roles: art(path('m12 2.7 8.3 3.1v6.5c0 5.2-8.3 9.5-8.3 9.5s-8.3-4.3-8.3-9.5V5.8Z', 'violet') + person(11.2, 9.3, 'paper') + circle(17.4, 16.6, 2.7, 'gold') + stroke('m17.4 16.6 3.8 4.1M19.4 18.8l1.3-1.2', 'outline', 1.4)),
  shield: art(path('m12 2.7 8.3 3.1v6.5c0 5.2-8.3 9.5-8.3 9.5s-8.3-4.3-8.3-9.5V5.8Z', 'mint') + path('M12 5.7v12.7c2.6-1.6 5.5-4.3 5.5-6.3V7.7Z', 'mint-back', 'stroke="none"') + stroke('m7.8 11.5 2.6 2.7 5.8-6', 'on-color', 2)),
  assignment: art(path('M2.7 9.3V7a2 2 0 0 1 2-2h5.1l2.1 2.1H20v12.7H4.7a2 2 0 0 1-2-2Z', 'blue') + rect(7.3, 2.7, 12.3, 15.7, 'paper', 1.7) + stroke('M10 7.2h6.8M10 10.2h6.8M10 13.2h3.6', 'blue') + path('M2.7 11.7h18.6l-2 8.9H5.1a2 2 0 0 1-2-1.6Z', 'gold') + circle(18.6, 17.9, 3.4, 'mint') + check('m17 17.9 1.1 1.1 2.1-2.3')),
  approval: art(rect(3.2, 3, 13.7, 18.3, 'paper', 2) + path('M3.2 7.4V5a2 2 0 0 1 2-2h9.7a2 2 0 0 1 2 2v2.4Z', 'blue') + stroke('M6.3 11h5.5M6.3 14.2h3.8', 'blue') + circle(17.3, 17.6, 4.8, 'mint') + check('m14.8 17.6 1.7 1.8 3.4-3.7')),
  lock: art(path('M7 10V7.2a5 5 0 0 1 10 0V10', 'none', 'stroke-width="2"') + rect(4.3, 9.3, 15.4, 12, 'blue', 2.8) + circle(12, 13.7, 1.6, 'gold') + stroke('M12 15.3v2.6', 'gold', 1.8)),
  key: art(circle(7.6, 8.3, 5, 'gold') + circle(6.5, 7.2, 1.5, 'paper') + path('m10.7 11.8 7.6 9.5 3.1-2.5-1.9-2.3-1.8 1.3-1.6-2 1.8-1.3-4.3-5.1Z', 'blue')),
  smartphone: art(rect(5.3, 2.5, 13.4, 19.1, 'blue', 2.6) + rect(7.3, 5.3, 9.4, 12.6, 'paper', .9) + stroke('M10.2 4h3.6', 'on-color', .8) + circle(12, 19.7, .6, 'paper', 'stroke="none"') + circle(12, 11.4, 3, 'mint') + check('m10.4 11.4 1.1 1.2 2.2-2.4')),
  help: art(path('M3 12.8V6.2A3.2 3.2 0 0 1 6.2 3h11.6A3.2 3.2 0 0 1 21 6.2v9.2a3.2 3.2 0 0 1-3.2 3.2H9l-4.8 3v-4', 'blue-back') + circle(12, 10.6, 6, 'paper') + stroke('M10.1 8.8a2 2 0 0 1 4 0c0 1.8-2 1.6-2 3.3', 'blue', 1.5) + circle(12.1, 13.8, .55, 'blue', 'stroke="none"')),
  bell: art(path('M5.2 14.8V9.4a6.8 6.8 0 0 1 13.6 0v5.4l2 3H3.2Z', 'gold') + stroke('M9.3 20.2a3 3 0 0 0 5.4 0', 'outline', 1.6) + circle(18.8, 5, 3, 'mint') + circle(18.8, 5, .5, 'paper', 'stroke="none"')),
  mail: art(rect(2.7, 5, 18.6, 15.5, 'paper', 2.5) + path('m3.4 6.2 8.6 6.7 8.6-6.7', 'blue-back') + stroke('m3.7 19.4 5.8-5.1m10.8 5.1-5.8-5.1', 'blue') + circle(19.3, 5.1, 3.1, 'mint') + check('m17.9 5.1 1 1 1.9-2')),
  phone: art(rect(4.8, 2.5, 14.4, 19.1, 'mint', 2.7) + rect(6.8, 5.1, 10.4, 12.9, 'paper', 1) + stroke('M10.3 4h3.4', 'on-color', .8) + path('M9.2 8h2l.7 1.8-1.3.9q.9 2 2.5 2.7l1-1.2 1.8.8v1.9c-4.4.5-7.8-3.3-6.7-6.9', 'blue') + circle(12, 19.8, .6, 'paper', 'stroke="none"'))
});

/* Same rounded objects, with details reduced for 20–27px utility/navigation
 * use. They inherit currentColor: selected states and the raised action stay
 * high-contrast, rather than squeezing a multi-colour miniature into a tab. */
const line = d => `<path d="${d}"/>`;
export const GLYPHS = Object.freeze({
  home: line('m3 10.5 9-7.7 9 7.7M5.2 9.3v10a1.7 1.7 0 0 0 1.7 1.7h10.2a1.7 1.7 0 0 0 1.7-1.7v-10M9.5 21v-6.5h5V21'),
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.8"/><rect x="14" y="3" width="7" height="7" rx="1.8"/><rect x="3" y="14" width="7" height="7" rx="1.8"/><rect x="14" y="14" width="7" height="7" rx="1.8"/>',
  book: line('M12 5q-4-2.5-8-1.2v15.9q4-1.3 8 1.2 4-2.5 8-1.2V3.8Q16 2.5 12 5Zm0 0v15.9M7 7.8l2 .5M15 8.3l2-.5'),
  classes: '<rect x="3" y="3.5" width="18" height="13" rx="2.2"/>' + line('M6 7h6M6 10.5h10M8.5 16.5 7 21M15.5 16.5 17 21'),
  teacher: '<rect x="9" y="3" width="12" height="13" rx="2"/>' + line('M12 7h6M12 10h4M15 16v5M12 21h6') + '<circle cx="5.5" cy="11" r="2.5"/>' + line('M2 21v-2a3.5 3.5 0 0 1 7 0v2'),
  users: '<circle cx="9" cy="7.3" r="3.4"/>' + line('M2.5 21v-3a6.5 6.5 0 0 1 13 0v3M16 4.5a3.3 3.3 0 0 1 0 6.4M18 14a5.4 5.4 0 0 1 3.5 5v2'),
  students: line('m3 6.2 9-3.5 9 3.5-9 3.5ZM6 7.5v3q6 3.5 12 0v-3M21 6.2v6') + '<circle cx="12" cy="13.5" r="2.4"/>' + line('M6.5 21v-.5a5.5 5.5 0 0 1 11 0v.5'),
  staff: '<rect x="3" y="5" width="18" height="16" rx="2.3"/><rect x="9" y="2.5" width="6" height="4" rx="1"/><circle cx="8" cy="12.5" r="2"/>' + line('M5 18a3 3 0 0 1 6 0M14 11.5h4M14 15.5h4'),
  user: '<circle cx="12" cy="7.5" r="4"/>' + line('M4 21v-1.5a8 8 0 0 1 16 0V21'),
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/>' + line('M7.5 2.5v5M16.5 2.5v5M3 10h18M7 14h2M14.5 14h2M7 18h2'),
  clock: '<circle cx="12" cy="12" r="9"/>' + line('M12 7v5l3.5 2.2'),
  exam: '<rect x="4" y="4.5" width="16" height="17" rx="2"/><rect x="8" y="2.5" width="8" height="4" rx="1.2"/>' + line('M8 11h8M8 15h5M8 18h5'),
  mcq: '<rect x="3" y="3" width="18" height="18" rx="2.2"/>' + line('m6.2 7.5.9.9 1.5-1.8M12 7.5h5M6.2 12.3h2.5M12 12.3h5M6.2 17.3h2.5M12 17.3h5'),
  result: line('M7 4h10v6a5 5 0 0 1-10 0Zm0 2H3.5v3a4 4 0 0 0 4.3 4M17 6h3.5v3a4 4 0 0 1-4.3 4M12 15v4M7 21h10M9 19h6'),
  attendance: '<circle cx="8.5" cy="7" r="3.5"/>' + line('M2.5 21v-2.5a6 6 0 0 1 12 0V21m1.3-9 2 2 4-4'),
  notice: line('M3.5 9h5l11-5v15l-11-5h-5Zm5 0v5M6 14l2.2 7H12l-2.2-6.5M22 9v5'),
  wallet: '<rect x="3" y="7" width="18" height="14" rx="2.5"/>' + line('M3 8V5.5A2.5 2.5 0 0 1 5.5 3H18v4M21 12.5h-5a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h5') + '<circle cx="17.7" cy="15" r=".6" fill="currentColor" stroke="none"/>',
  receipt: line('M5 3h14v18l-3.5-1.7L12 21l-3.5-1.7L5 21ZM8.5 7h7M8.5 11h7M8.5 15h4'),
  reports: '<rect x="3" y="3" width="18" height="18" rx="2.2"/>' + line('M7.5 16.5v-4M12 16.5v-9M16.5 16.5V10'),
  data: '<ellipse cx="12" cy="5.5" rx="8.5" ry="3"/>' + line('M3.5 5.5v13c0 4 17 4 17 0v-13M3.5 12c0 4 17 4 17 0'),
  backup: line('M6 17.5a4.5 4.5 0 0 1-.9-8.9 6.8 6.8 0 0 1 13.1-1.4 5.3 5.3 0 0 1 .6 10.3M12 21V12m-3.5 3.5 3.5-3.5 3.5 3.5'),
  settings: line('M3.5 6h5m4 0h8M3.5 12h10m4 0h3.5M3.5 18h3m4 0h10') + '<circle cx="10.5" cy="6" r="2"/><circle cx="15.5" cy="12" r="2"/><circle cx="8.5" cy="18" r="2"/>',
  roles: line('m12 3 8 3v6c0 4.8-8 9-8 9s-8-4.2-8-9V6Z') + '<circle cx="12" cy="10" r="2.2"/>' + line('M8 17a4 4 0 0 1 8 0'),
  shield: line('m12 3 8 3v6c0 4.8-8 9-8 9s-8-4.2-8-9V6Zm-4 9 2.5 2.6 5.5-5.7'),
  assignment: line('M4 3h10l6 6v12H4Zm10 0v6h6M8 13h8M8 17h5'),
  approval: '<circle cx="12" cy="12" r="9"/>' + line('m7.5 12 3.1 3.2L17 8.5'),
  lock: '<rect x="5" y="10" width="14" height="11" rx="2.4"/>' + line('M8 10V7a4 4 0 0 1 8 0v3M12 14.5v2.5'),
  key: '<circle cx="7.5" cy="8" r="4.5"/>' + line('m10.5 11.5 9 9m-3.8-3.8 2.3-2.3m.5 5.1 2.3-2.3'),
  smartphone: '<rect x="6" y="2" width="12" height="20" rx="2.3"/>' + line('M10 4.5h4M10.5 19.5h3'),
  help: '<circle cx="12" cy="12" r="9"/>' + line('M9.2 9.2a2.8 2.8 0 1 1 5 1.7c-1.2 1.1-2.2 1-2.2 3.1') + '<circle cx="12" cy="17.3" r=".6" fill="currentColor" stroke="none"/>',
  bell: line('M5.5 16V9a6.5 6.5 0 0 1 13 0v7l2 2h-17Zm4 5a3 3 0 0 0 5 0'),
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/>' + line('M16 5V3H3v13h2'),
  chat: '<rect x="3" y="3.5" width="18" height="13.5" rx="2.5"/>' + line('M5.5 17v4l5.3-4M7 8.5h10M7 12h6'),
  search: '<circle cx="10.5" cy="10.5" r="7"/>' + line('m16 16 5 5'),
  whatsapp: line('M12 3.2a8.8 8.8 0 0 0-7.6 13.2L3.2 20.8l4.5-1.2A8.8 8.8 0 1 0 12 3.2Z') + line('M9 8.6c.3-.6.7-.6 1-.6h.6c.2 0 .4.1.5.5l.6 1.5c.1.2 0 .4-.1.6l-.5.5c-.1.2-.2.3 0 .6.3.6.9 1.2 1.5 1.6.6.3.9.4 1.2.3l.5-.5c.2-.2.4-.2.6-.1l1.4.7c.3.2.4.3.4.6 0 .5-.3 1.1-.7 1.4-.5.3-1.2.3-2 0-.9-.4-1.8-1-2.5-1.7-.7-.7-1.2-1.6-1.5-2.3-.3-.8-.3-1.4 0-1.8Z'),
  add: line('M12 4v16M4 12h16'),
  edit: line('m4 16.5 12-12 3.5 3.5-12 12-4.5 1Zm9.5-9.5 3.5 3.5'),
  delete: line('M3.5 6h17M9 6V3.5h6V6M5.5 6l1 14.5h11l1-14.5M10 10v6.5M14 10v6.5'),
  save: '<rect x="3" y="3" width="18" height="18" rx="2"/>' + line('M7 3v6h10V3M7 21v-8h10v8'),
  download: line('M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'),
  upload: line('M12 16V3m-4 4 4-4 4 4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'),
  print: line('M7 8V3h10v5M7 17H3V8h18v9h-4M7 14h10v7H7ZM17 11h1'),
  logout: line('M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5M8 12h13m-5-5 5 5-5 5'),
  back: line('M20 12H4m6-6-6 6 6 6'),
  next: line('M4 12h16m-6-6 6 6-6 6'),
  close: line('m6 6 12 12M18 6 6 18'),
  filter: line('M3 4h18l-7 8v8l-4-2v-6Z'),
  check: line('m4.5 12 5 5L20 6.5'),
  warning: line('m12 3 10 18H2ZM12 9v5') + '<circle cx="12" cy="17.5" r=".5" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="9"/>' + line('M12 11v6') + '<circle cx="12" cy="7.3" r=".6" fill="currentColor" stroke="none"/>',
  more: '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
  menu: line('M3.5 5h17M3.5 12h17M3.5 19h17'),
  sync: line('M20.5 8.5a8.5 8.5 0 0 0-14.7-3L3 8.5M3 3v5.5h5.5M3.5 15.5a8.5 8.5 0 0 0 14.7 3l2.8-3M21 21v-5.5h-5.5'),
  online: line('M2.5 8a15 15 0 0 1 19 0M6 12a9.5 9.5 0 0 1 12 0M9.5 16a4 4 0 0 1 5 0') + '<circle cx="12" cy="20" r=".6" fill="currentColor"/>',
  offline: line('M3 3l18 18M2.5 8A15 15 0 0 1 6 6M11 4.8A15 15 0 0 1 21.5 8M6 12l2-1.3M16 11l2 1M9.5 16l1-.6') + '<circle cx="12" cy="20" r=".6" fill="currentColor"/>',
  eye: line('M2.5 12q9.5-12.5 19 0-9.5 12.5-19 0Z') + '<circle cx="12" cy="12" r="3"/>',
  phone: line('M7 3H4q-1 0-1 2c0 8.9 6.1 15 15 15q2 0 2-1v-3l-4-2-2 2a14 14 0 0 1-6-6l2-2Z'),
  mail: '<rect x="3" y="5" width="18" height="15" rx="2.3"/>' + line('m3.5 6 8.5 6.5L20.5 6'),
  sun: '<circle cx="12" cy="12" r="4"/>' + line('M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5'),
  moon: line('M20.5 14.6a9 9 0 0 1-11.1-11A9 9 0 1 0 20.5 14.6Z'),
  play: line('m8 4.5 11 7.5L8 19.5Z'),
  pause: line('M8 4.5v15M16 4.5v15'),
  fingerprint: line('M4 13V9a8 8 0 0 1 16 0v4M8 19V9a4 4 0 0 1 8 0v8M12 9v12'),
  bolt: line('m13.5 2.5-9 11h6l-1 8 10-12h-6Z')
});

const aliases = Object.freeze({
  courses: 'book', routine: 'calendar', results: 'result', notices: 'notice', profile: 'user',
  teachers: 'teacher', managers: 'staff', payments: 'wallet', payment: 'wallet', finance: 'wallet', money: 'wallet',
  database: 'data', cloud: 'backup', security: 'shield', homework: 'assignment', exams: 'exam',
  trash: 'delete', forward: 'next', refresh: 'sync', error: 'warning', notification: 'bell', class: 'classes',
  sliders: 'settings', summary: 'reports', grid: 'dashboard', clipboard: 'exam', trending: 'reports', award: 'result',
  success: 'approval', checkCircle: 'approval', 'check-circle': 'approval', 'arrow-right': 'next',
  'arrow-left': 'back', 'chevron-right': 'next', plus: 'add', megaphone: 'notice', support: 'help', app: 'smartphone', card: 'receipt'
});
export function resolveIcon(name) {
  const key = String(name).replace(/^icon-/, '');
  return Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key] : key;
}
export function iconArtwork(name, variant = 'color') {
  const key = resolveIcon(name);
  if (variant === 'color' && Object.prototype.hasOwnProperty.call(ILLUSTRATIONS, key)) return { markup: ILLUSTRATIONS[key], style: 'color', canonical: key };
  if (key === 'chevron-down') return { markup: line('m6 9 6 6 6-6'), style: 'glyph', canonical: key };
  const known = Object.prototype.hasOwnProperty.call(GLYPHS, key);
  return { markup: known ? GLYPHS[key] : GLYPHS.help, style: 'glyph', canonical: known ? key : 'help' };
}
