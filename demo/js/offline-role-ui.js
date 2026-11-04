import { iconElement } from '../../js/icons.js';
// This isolated demo is not in the production precache. Registering the
// production worker here would replace another open panel's staff shell.
import { createRoleStore, ROLE_NAMES } from './offline-role-store.js';
const db = createRoleStore(localStorage);
const $ = s => document.querySelector(s);
const SECTIONS = {
  accounts: ['স্টাফ প্রোফাইল', 'users'], students: ['শিক্ষার্থী', 'users'], payments: ['পেমেন্ট', 'finance'],
  reports: ['রিপোর্ট', 'reports'], settings: ['সিস্টেম সেটিংস', 'app'], backup: ['ব্যাকআপ / রিস্টোর', 'app'],
  notices: ['নোটিশ', 'notices'], routines: ['রুটিন', 'routine'], classes: ['ক্লাস / ব্যাচ', 'classes'],
  assignments: ['অ্যাসাইনমেন্ট', 'classes'], submissions: ['জমা ও মূল্যায়ন', 'reports'], exams: ['পরীক্ষা', 'exams'],
  results: ['ফলাফল', 'reports'], attendance: ['উপস্থিতি', 'users'], feedback: ['একাডেমিক মন্তব্য', 'notices'], academicSettings: ['Academic App Control', 'app']
};
const MENUS = {
  admin: ['accounts', 'reports', 'settings', 'backup'],
  manager: ['students', 'payments', 'reports', 'notices', 'routines', 'classes', 'exams', 'results', 'academicSettings'],
  teacher: ['students', 'classes', 'routines', 'attendance', 'assignments', 'submissions', 'exams', 'results', 'feedback', 'notices'],
  payment: ['students', 'payments'],
  student: ['accounts', 'students', 'classes', 'routines', 'notices', 'assignments', 'submissions', 'exams', 'results', 'payments', 'attendance', 'feedback']
};
let actor, current;
function notify(message, error = false) { $('#message').textContent = message; $('#message').dataset.error = error; }
async function run(action) { try { const result = await action(); notify('সম্পন্ন হয়েছে'); return result; } catch (e) { notify(e.message, true); return null; } }
function button(label, action, parent) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = () => run(action); parent.append(b); return b; }
function download(name, data) { const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function form(fields, submit, label = 'সংরক্ষণ', values = {}) {
  const f = document.createElement('form');
  for (const [name, title, type = 'text', options] of fields) {
    const l = document.createElement('label'); l.textContent = title;
    const el = document.createElement(type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    el.name = name;
    if (el.tagName === 'INPUT') el.type = type;
    if (type === 'select') for (const [value, text] of options) { const opt = document.createElement('option'); opt.value = value; opt.textContent = text; el.append(opt); }
    el.value = values[name] ?? (type === 'select' ? options[0]?.[0] || '' : '');
    el.required = name !== 'password' || !values.id;
    if (name === 'password') { el.minLength = 8; el.autocomplete = 'new-password'; }
    l.append(el); f.append(l);
  }
  const b = document.createElement('button'); b.textContent = label; f.append(b);
  f.onsubmit = async e => { e.preventDefault(); b.disabled = true; try { await submit(Object.fromEntries(new FormData(f))); notify('সংরক্ষিত'); render(current); } catch (error) { notify(error.message, true); } finally { b.disabled = false; } };
  $('#actions').append(f); return f;
}
function card(record) {
  const article = document.createElement('article'), dl = document.createElement('dl');
  for (const [key, value] of Object.entries(record)) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key;
    dd.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value); dl.append(dt, dd);
  }
  article.append(dl); const actions = document.createElement('div'); actions.className = 'row-actions'; article.append(actions);
  article.dataset.classId = record.classId || (current === 'classes' ? record.id : '');
  $('#records').append(article); return actions;
}
function staffForm(record = {}) {
  $('#actions').replaceChildren();
  form([['name', 'নাম'], ['username', 'ইউজারনেম'], ['role', 'রোল', 'select', ['manager', 'teacher', 'payment'].map(r => [r, ROLE_NAMES[r]])], ['password', record.id ? 'নতুন পাসওয়ার্ড (ঐচ্ছিক)' : 'পাসওয়ার্ড', 'password'], ['classIds', 'Assigned class IDs (কমা দিয়ে লিখুন)']], f => db.saveStaff({ ...f, id: record.id, classIds: f.classIds.split(',').map(s => s.trim()).filter(Boolean) }), record.id ? 'প্রোফাইল আপডেট' : 'স্টাফ তৈরি', { ...record, classIds: record.classIds?.join(',') });
  $('#actions [name=classIds]').required = false;
}
function render(section) {
  actor = db.current();
  if (!MENUS[actor.role].includes(section)) { notify('ACCESS_DENIED', true); return; }
  current = section; $('#recordSearch').value = ''; $('#classFilter').replaceChildren(new Option('সব ক্লাস / সেকশন', ''));
  for (const c of db.list('classes')) $('#classFilter').append(new Option(c.title + ' • ' + c.id, c.id));
  $('#sectionTitle').textContent = SECTIONS[section][0]; $('#actions').replaceChildren(); $('#records').replaceChildren();
  $('#menu').querySelectorAll('button').forEach(b => b.setAttribute('aria-current', b.dataset.section === section ? 'page' : 'false'));
  const refresh = action => async () => { await action(); render(section); };
  const classes = () => db.list('classes').map(c => [c.id, c.title]);
  const students = () => db.list('students').map(s => [s.id, s.name]);
  if (section === 'accounts' && actor.role === 'admin') staffForm();
  if (section === 'payments' && actor.role === 'payment') form([['studentId', 'শিক্ষার্থী', 'select', students()], ['amount', 'টাকা', 'number']], f => db.createPayment({ studentId: f.studentId, amount: Number(f.amount) }), 'অস্থায়ী এন্ট্রি তৈরি');
  if (section === 'settings' || section === 'academicSettings') {
    form([[section === 'settings' ? 'appName' : 'academicMessage', section === 'settings' ? 'অ্যাপের নাম' : 'একাডেমিক বার্তা']], f => db.saveSettings(f, section === 'academicSettings')); return;
  }
  if (section === 'backup') {
    const note = document.createElement('p'); note.textContent = 'ব্যাকআপে password hashes-সহ সংবেদনশীল তথ্য থাকে। নিরাপদে রাখুন। Restore সম্পূর্ণ v2 workspace প্রতিস্থাপন করবে; পুরোনো v1 তথ্য নয়।'; $('#actions').append(note);
    button('ব্যাকআপ ডাউনলোড', () => download('active-plus-offline-backup.json', db.backup()), $('#actions'));
    form([['content', 'Backup JSON', 'textarea']], async f => {
      if (!confirm('সম্পূর্ণ v2 workspace প্রতিস্থাপন করবেন? আগে ব্যাকআপ নিন।')) return;
      await db.restore(f.content); location.reload();
    }, 'রিস্টোর'); return;
  }
  if (section === 'reports') {
    const report = db.report(); card(report);
    button('রিপোর্ট Export (JSON)', () => download('active-plus-report.json', JSON.stringify(db.report(), null, 2)), $('#actions')); return;
  }
  const academic = (actor.role === 'manager' && ['classes', 'routines', 'notices'].includes(section)) || (actor.role === 'teacher' && ['assignments', 'exams', 'results', 'attendance', 'feedback', 'notices'].includes(section));
  function academicForm(record = {}) {
    $('#actions').replaceChildren();
    const fields = [['title', 'বিবরণ / শিরোনাম']];
    if (section !== 'classes') fields.push(['classId', 'ক্লাস', 'select', classes()]);
    if (['attendance', 'feedback', 'results'].includes(section)) fields.push(['studentId', 'শিক্ষার্থী', 'select', students()]);
    if (section === 'results') fields.push(['marks', 'নম্বর (০–১০০)', 'number']);
    form(fields, f => db.saveAcademic(section, { ...f, id: record.id, ...(f.marks !== undefined ? { marks: Number(f.marks) } : {}) }), ['exams', 'results'].includes(section) ? 'Manager review-তে জমা' : 'সংরক্ষণ ও প্রকাশ', record);
  }
  if (academic) academicForm();
  const rows = db.list(section);
  if (!rows.length) $('#records').textContent = 'এই রোলের জন্য কোনো তথ্য নেই।';
  for (const row of rows) {
    const actions = card(row);
    if (section === 'accounts' && actor.role === 'admin' && row.role !== 'admin') {
      button('সম্পাদনা / Password reset', () => staffForm(row), actions);
      button(row.active ? 'নিষ্ক্রিয়' : 'সক্রিয়', refresh(() => db.saveStaff({ id: row.id, active: !row.active })), actions);
    }
    if (section === 'students' && actor.role === 'manager') {
      if (row.status === 'pending') for (const status of ['approved', 'rejected']) button(status === 'approved' ? 'অনুমোদন' : 'বাতিল', refresh(() => db.updateStudent(row.id, { status })), actions);
      button('সম্পাদনা / Password reset', () => {
        $('#actions').replaceChildren(); form([['name', 'নাম'], ['classId', 'ক্লাস', 'select', classes()], ['password', 'নতুন পাসওয়ার্ড (ঐচ্ছিক)', 'password']], f => db.updateStudent(row.id, f), 'আপডেট', row);
      }, actions);
    }
    if (section === 'payments') {
      if (actor.role === 'manager' && row.status === 'pending') button('যাচাই করে অনুমোদন', refresh(() => db.approvePayment(row.id)), actions);
      button('রসিদ Download', () => download(`receipt-${row.id}.json`, JSON.stringify(db.receipt(row.id), null, 2)), actions);
    }
    if (['exams', 'results'].includes(section) && actor.role === 'manager' && row.status === 'pending') button('অনুমোদন ও প্রকাশ', refresh(() => db.publish(section, row.id)), actions);
    if (academic && (actor.role === 'manager' || row.authorId === actor.id) && !(['exams', 'results'].includes(section) && row.status === 'published')) button('সম্পাদনা', () => academicForm(row), actions);
    if (section === 'assignments' && actor.role === 'student') button('উত্তর জমা', () => { $('#actions').replaceChildren(); form([['answer', 'উত্তর', 'textarea']], f => db.submit(row.id, f.answer), 'জমা'); }, actions);
    if (section === 'submissions' && actor.role === 'teacher') button('মূল্যায়ন', () => { $('#actions').replaceChildren(); form([['marks', 'নম্বর', 'number']], f => db.grade(row.id, Number(f.marks)), 'মূল্যায়ন সংরক্ষণ'); }, actions);
  }
}
function enter() {
  actor = db.current(); $('#entry').hidden = true; $('#workspace').hidden = false;
  $('#populateDemo').hidden = actor.role !== 'admin';
  $('#identity').textContent = `${ROLE_NAMES[actor.role]} — ${actor.name}`;
  $('#menu').replaceChildren();
  for (const section of MENUS[actor.role]) {
    const b = button(SECTIONS[section][0], () => render(section), $('#menu')); b.dataset.section = section;
    const icon = iconElement(SECTIONS[section][1]);
    const image = icon.querySelector('image');
    if (image) image.setAttribute('href', new URL(`../../${image.getAttribute('href')}`, import.meta.url).href);
    b.prepend(icon);
  }
  render(MENUS[actor.role][0]);
}
function registrationClasses() {
  $('#registrationClasses').replaceChildren();
  if (!db.exists()) return;
  for (const c of db.registrationClasses()) { const option = document.createElement('option'); option.value = c.id; option.textContent = c.title; $('#registrationClasses').append(option); }
}
registrationClasses();
$('#registration').onsubmit = e => { e.preventDefault(); run(async () => { await db.registerStudent(Object.fromEntries(new FormData(e.target))); e.target.reset(); }).then(result => { if ($('#message').dataset.error !== 'true') notify('নিবন্ধিত — Manager অনুমোদনের পর প্রবেশ করতে পারবেন'); }); };
$('#seed').disabled = db.exists();
$('#seed').onclick = () => run(async () => { await db.seedDemo({ populated: true }); $('#seed').disabled = true; registrationClasses(); });
$('#login').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); await run(async () => { await db.login(f.get('username'), f.get('password')); e.target.reset(); enter(); }); };
$('#logout').onclick = () => { db.logout(); $('#workspace').hidden = true; $('#entry').hidden = false; $('#records').replaceChildren(); $('#actions').replaceChildren(); $('#menu').replaceChildren(); notify('লগআউট হয়েছে'); };
// Another tab's approvals are read from the same database, never a stale copy.
window.addEventListener('storage', () => { if (!$('#workspace').hidden) run(() => render(current)); });

$('#populateDemo').onclick = () => run(async () => { const counts = await db.populateDemo(); render(current); registrationClasses(); notify('ডেমো যোগ হয়েছে: ' + Object.entries(counts).map(([k,v]) => `${k}: ${v}`).join(' • ')); });

function filterRecords() {
  const query = $('#recordSearch').value.trim().toLocaleLowerCase();
  const classId = $('#classFilter').value;
  for (const row of $('#records').children) row.hidden = Boolean((query && !row.textContent.toLocaleLowerCase().includes(query)) || (classId && row.dataset.classId !== classId));
}
$('#recordSearch').oninput = filterRecords;
$('#classFilter').onchange = filterRecords;
