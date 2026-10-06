/* Reproduce the static fallback SVGs from the shared icon family. Keeping the
   actual artwork in HTML avoids an icon flash and works before modules boot.
   It never changes a control, event/route attribute, label or permission. */
import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { iconMarkup } from '../js/icons.js';

const pages = ['index', 'admin', 'manager', 'teacher', 'payment', 'offline-roles'];
const illustrated = '.pay-tile-icon,.admin-feature-icon,.admin-more-icon,.dashboard-routine-icon,.dashboard-empty-icon,.challenge-icon,.dashboard-feature-icon,.study-progress-icon,.learning-home-icon,.settings-icon,.help-card-icon,.pay-pulse-icon';
const routeIcons = {
  student: { routine:'calendar', courses:'book', exams:'exam', results:'result', profile:'user' },
  admin: { staff:'staff', students:'students', dashboard:'dashboard', roles:'roles', data:'data', backup:'backup', security:'shield', settings:'settings', reports:'reports', profile:'user' },
  manager: { dashboard:'home', students:'students', approvals:'approval', classes:'classes', teachers:'teacher', finance:'wallet', 'cash-counter':'wallet', routine:'calendar', exams:'exam', results:'result', reports:'reports', notices:'notice', profile:'user', more:'more' },
  teacher: { home:'home', classes:'classes', students:'students', 'routine-view':'calendar', routine:'attendance', homework:'assignment', 'online-exams':'exam', exam:'result', suggestion:'notice', reports:'reports', profile:'user', more:'more' },
  payment: { home:'home', students:'students', payment:'wallet', reports:'reports', more:'more' }
};

for (const page of pages) {
  const file = new URL('../' + page + '.html', import.meta.url);
  const html = readFileSync(file, 'utf8');
  const dom = new JSDOM(html);
  const nodes = [...dom.window.document.querySelectorAll('svg[data-icon]')];
  const matches = [...html.matchAll(/<svg\b[^>]*\bdata-icon="[^"]+"[^>]*>[\s\S]*?<\/svg>/g)];
  if (nodes.length !== matches.length) throw new Error(page + ': static SVG/source mismatch');
  let index = 0;
  const result = html.replace(/<svg\b[^>]*\bdata-icon="[^"]+"[^>]*>[\s\S]*?<\/svg>/g, () => {
    const svg = nodes[index++];
    const nav = svg.closest('.nav-chip');
    const large = svg.closest(illustrated);
    const variant = large && !nav ? 'color' : 'glyph';
    let name = svg.getAttribute('data-icon');
    const control = svg.closest('button,a');
    // Use distinct artwork for staff, students, teachers and classes rather
    // than the former aliases that gave several services the same person/book.
    if (large || nav) {
      for (const role of ['student','admin','manager','teacher','payment']) {
        const attr = role === 'student' ? 'data-view' : role === 'payment' ? 'data-pay-section' : `data-${role}-view`;
        const route = control?.getAttribute(attr);
        if (route && routeIcons[role][route]) name = routeIcons[role][route];
      }
    }
    let markup = iconMarkup(name, (svg.getAttribute('class') || '').replace(/\bapc-(color|glyph)-icon\b/g, '').trim(), { variant });
    const extra = [...svg.attributes].filter(attr => !['class','data-icon','data-icon-set','data-icon-version','data-icon-style','viewBox','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','aria-hidden','focusable'].includes(attr.name));
    if (extra.length) {
      const escape = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      markup = markup.replace('<svg ', '<svg ' + extra.map(attr => `${attr.name}="${escape(attr.value)}"`).join(' ') + ' ');
    }
    return markup;
  });
  writeFileSync(file, result);
  console.log(page + ': ' + index + ' named SVGs replaced');
  dom.window.close();
}
