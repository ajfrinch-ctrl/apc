/* Routine feature: day tabs and the office weekly schedule. */
import { $, $$, toBanglaNumber } from './ui.js';
import { setView } from './shell.js';
import { subjectInitials } from './config.js';
import { loadRoutine, WEEK_DAYS, ROUTINE_KEY } from './office-data.js';

const DAY_LABELS = { sat: 'শনিবার', sun: 'রবিবার', mon: 'সোমবার', tue: 'মঙ্গলবার', wed: 'বুধবার', thu: 'বৃহস্পতিবার' };

function weekDates() {
  const now = new Date();
  const sinceSat = (now.getDay() + 1) % 7;
  const saturday = new Date(now);
  saturday.setDate(now.getDate() - sinceSat);
  return Object.fromEntries(WEEK_DAYS.map((day, index) => {
    const date = new Date(saturday);
    date.setDate(saturday.getDate() + index);
    return [day, {
      dayNumber: String(date.getDate()),
      label: `${DAY_LABELS[day]}, ${date.toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' })}`
    }];
  }));
}

export function renderRoutine(day = 'sat', student = null) {
  const routine = loadRoutine();
  const dates = weekDates();
  $$('.day-tab').forEach(tab => {
    const info = dates[tab.dataset.day];
    const strong = tab.querySelector('strong');
    if (info && strong) strong.textContent = toBanglaNumber(info.dayNumber);
  });
  const allDayData = routine[day] || { classes: [] };
  const dayData = student?.className
    ? { ...allDayData, classes: (allDayData.classes || []).filter(item => !item.className || item.className === student.className) }
    : allDayData;
  const list = $('#routineList');
  if (!list) return;

  // Null-guarded on purpose: this render runs inside the shared chunk-init
  // chain — a throw here must never strand the hubs that initialise after it.
  const dateEl = $('#routineDate');
  if (dateEl) dateEl.textContent = dates[day]?.label || '';
  const countEl = $('#classCount');
  if (countEl) countEl.textContent = `${toBanglaNumber(dayData.classes.length)}টি ক্লাস`;
  list.innerHTML = dayData.classes.map(item => `
    <article class="routine-item">
      <div class="routine-time"><strong>${item.time}</strong><small>${item.period}</small></div>
      <div class="routine-body">
        <span class="subject-block ${item.tone || 'green'}">${subjectInitials[item.subject] || 'ক'}</span>
        <span><strong>${item.subject}</strong><small>${item.teacher} · ${item.room}</small></span>
        <span class="routine-tag${item.tag === 'টেস্ট' ? ' test' : ''}">${item.tag || 'ক্লাস'}</span>
      </div>
    </article>
  `).join('');
  const emptyEl = $('#emptyRoutine');
  if (emptyEl) emptyEl.hidden = dayData.classes.length !== 0;
  list.hidden = dayData.classes.length === 0;
}

export function initRoutine({ getStudent } = {}) {
  const renderCurrent = day => renderRoutine(day, getStudent?.() || null);
  $$('.day-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.day-tab').forEach(item => item.classList.remove('active'));
      tab.classList.add('active');
      renderCurrent(tab.dataset.day);
      const title = document.querySelector('#routineDayTitle');
      if (title) title.textContent = DAY_LABELS[tab.dataset.day] || 'ক্লাস রুটিন';
      setView('routine-day');
    });
  });
  window.addEventListener('storage', event => {
    if (!event.key || event.key === ROUTINE_KEY) {
      renderCurrent(document.querySelector('.day-tab.active')?.dataset.day || 'sat');
    }
  });
  renderCurrent('sat');
  return () => renderCurrent(document.querySelector('.day-tab.active')?.dataset.day || 'sat');
}
