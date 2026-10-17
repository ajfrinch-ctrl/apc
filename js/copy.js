/* Tap-to-copy ID chips — every unique ID (student ID, username, receipt
   number …) copies with one tap on its chip. Mark the chip with
   data-copy-target="<id of the element holding the text>"; the text is read at
   click time so live-updated values always copy the current one. */
import { showFeedback } from './ui.js';

export async function copyText(text) {
  const value = String(text ?? '').trim();
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch { /* fall through to the legacy path */ }
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

export function initCopyChips() {
  const copyFrom = async chip => {
    const target = document.getElementById(chip.dataset.copyTarget);
    const text = (target?.textContent || chip.dataset.copy || '').trim();
    if (!text || text === '—') return;
    const copied = await copyText(text);
    showFeedback(copied ? 'কপি হয়েছে' : 'কপি করা যায়নি — লেখা নির্বাচন করে কপি করুন');
  };
  document.addEventListener('click', async event => {
    const chip = event.target.closest('[data-copy-target]');
    if (!chip) return;
    event.preventDefault();
    await copyFrom(chip);
  });
  document.addEventListener('keydown', async event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const chip = event.target.closest?.('[data-copy-target]');
    if (!chip) return;
    /* Buttons also need the explicit key path in the in-app WebView: prevent
       the native synthetic click so Enter/Space can never copy twice. */
    event.preventDefault();
    await copyFrom(chip);
  });
}
