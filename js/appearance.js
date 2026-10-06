/* Light + dark appearance, stored per device.
   Pattern: html[data-theme] + CSS `color-scheme` + theme-color meta stay in
   sync. Dark is strictly opt-in — the app always starts light and only an
   explicit toggle turns dark on; the choice then survives reloads. The system
   colour preference is never followed automatically. The pre-paint half that
   stops a dark theme from flashing light lives in js/appearance-boot.js and
   must keep using the exact same storage key (guarded by
   tests/appearance.test.mjs). */

export const APPEARANCE_KEY = 'active-plus-appearance-v2';
export const THEME_COLOR = Object.freeze({ light: '#f3f6fb', dark: '#000000' });
export const THEME_LABEL = Object.freeze({ light: 'লাইট থিম', dark: 'AMOLED থিম' });

function normalize(theme) {
  return theme === 'dark' ? 'dark' : 'light';
}

export function getStoredTheme() {
  try {
    const value = window.localStorage.getItem(APPEARANCE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch { /* private mode — stay light until the user toggles */ }
  return null;
}

export function getTheme() {
  // Only an explicit, stored choice turns dark on; the default is light.
  return getStoredTheme() || 'light';
}

export function themeColorFor(theme) {
  return THEME_COLOR[normalize(theme)];
}

function paintThemeColor(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeColorFor(theme));
}

function syncControls(theme) {
  for (const control of document.querySelectorAll('[data-theme-toggle]')) {
    control.setAttribute('aria-pressed', String(theme === 'dark'));
    control.setAttribute('aria-label', theme === 'dark' ? 'লাইট থিম চালু করুন' : 'AMOLED থিম চালু করুন');
  }
  /* One switch per page: the panel's own #darkModeToggle where it exists, and the
     Settings hub's row (data-settings-toggle="theme") where the page has none. */
  for (const checkbox of document.querySelectorAll('#darkModeToggle, [data-settings-toggle="theme"]')) {
    checkbox.checked = theme === 'dark';
  }
}

export function applyTheme(theme) {
  const next = normalize(theme);
  const root = document.documentElement;
  root.dataset.theme = next;
  try { root.style.colorScheme = next; } catch { /* older engines ignore this */ }
  paintThemeColor(next);
  syncControls(next);
  return next;
}

export function setTheme(theme) {
  const next = normalize(theme);
  try { window.localStorage.setItem(APPEARANCE_KEY, next); } catch { /* private mode */ }
  applyTheme(next);
  window.dispatchEvent(new CustomEvent('apc:theme', { detail: next }));
  return next;
}

export function toggleTheme() {
  return setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

export function initAppearance() {
  applyTheme(getTheme());

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-theme-toggle]');
    if (!trigger) return;
    event.preventDefault();
    toggleTheme();
  });

  const checkbox = document.getElementById('darkModeToggle');
  if (checkbox) {
    checkbox.addEventListener('change', () => {
      setTheme(checkbox.checked ? 'dark' : 'light');
    });
  }

  /* Delegated so a toggle that Settings adds later is wired too. */
  document.addEventListener('change', event => {
    const input = event.target.closest('[data-settings-toggle="theme"]');
    if (!input || input === checkbox) return;
    setTheme(input.checked ? 'dark' : 'light');
  });
}
