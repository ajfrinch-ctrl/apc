/* Small DOM and feedback helpers shared by feature modules. */
export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

export function toBanglaNumber(value) {
  return String(value).replace(/[0-9]/g, digit => '০১২৩৪৫৬৭৮৯'[digit]);
}

export function normalizeMobile(value) {
  return String(value || '')
    .replace(/[০-৯]/g, digit => '০১২৩৪৫৬৭৮৯'.indexOf(digit))
    .replace(/[^0-9]/g, '');
}

export function normalizeAnswer(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function showFeedback(message) {
  $('.feedback-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'feedback-toast';
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

/**
 * Show (or clear) the message line above the auth form. Every message carries a
 * small dismiss control: a status line must never stay
 * fixed on screen after the reader has seen it.
 */
export function setAuthMessage(message, success = false) {
  const element = $('#authMessage');
  if (!element) return;
  const text = String(message || '');
  element.textContent = '';
  element.classList.toggle('success', success);
  if (!text) { element.hidden = true; return; }
  const copy = document.createElement('span');
  copy.className = 'auth-message-text';
  copy.textContent = text;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'auth-message-close';
  dismiss.setAttribute('aria-label', 'বার্তাটি সরান');
  dismiss.title = 'বার্তাটি সরান';
  dismiss.textContent = '✕';
  dismiss.addEventListener('click', () => setAuthMessage(''));
  element.append(copy, dismiss);
  element.hidden = false;
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  window.setTimeout(() => modal.querySelector('button, input, select')?.focus(), 50);
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
}

export function scrollToTop() {
  const auth = $('#authScreen');
  const shell = $('#appShell');
  const container = auth && !auth.hidden ? auth
    : shell?.classList.contains('is-pending') ? $('#pendingScreen') : $('#appMain');
  container?.scrollTo({ top: 0, behavior: 'instant' });
}
