import { iconMarkup } from './icons.js';
/* Shared staff password dialog: first-use setup and forced password change.
   Rendered by JS so all four entry screens (index, admin, teacher, payment)
   get the same secure flow without duplicating markup. The plaintext password
   lives only in the input element and in the hashing call — never in storage. */

import { provisionStaffAccount, setStaffPassword } from './staff-auth.js';

let openDialog = null;

const COPY = {
  setup: {
    title: 'পাসওয়ার্ড নির্ধারণ করুন',
    lead: 'এই ডিভাইসে এই ইউজারনেম দিয়ে প্রথমবার প্রবেশ করা হচ্ছে। একবার একটি পাসওয়ার্ড নির্ধারণ করুন — এটি শুধু এই ব্রাউজারে জমা থাকবে এবং হ্যাশ আকারে সংরক্ষিত হবে।',
    submit: 'পাসওয়ার্ড নির্ধারণ করে প্রবেশ করুন'
  },
  change: {
    title: 'নতুন পাসওয়ার্ড নির্ধারণ করুন',
    lead: 'নিরাপত্তার জন্য এই অ্যাকাউন্টের পাসওয়ার্ড বদলানো বাধ্যতামূলক। একটি নতুন পাসওয়ার্ড দিন — প্যানেলে প্রবেশের আগেই এটি সক্রিয় হয়ে যাবে।',
    submit: 'নতুন পাসওয়ার্ড সংরক্ষণ করে প্রবেশ করুন'
  }
};

function buildDom(role, mode) {
  const copy = COPY[mode] || COPY.change;
  const overlay = document.createElement('div');
  overlay.className = 'staff-pw-backdrop';
  overlay.dataset.staffPw = role;
  overlay.innerHTML = `
    <div class="staff-pw-card" role="dialog" aria-modal="true" aria-labelledby="staffPwTitle">
      <p class="eyebrow">${mode === 'setup' ? 'প্রথমবার সেটআপ' : 'নিরাপত্তা আপডেট'}</p>
      <h2 id="staffPwTitle">${copy.title}</h2>
      <p class="staff-pw-lead">${copy.lead}</p>
      <form class="staff-pw-form" novalidate>
        <label for="staffPwNew">নতুন পাসওয়ার্ড</label>
        <div class="input-wrap">
          ${iconMarkup("lock")}
          <input id="staffPwNew" name="newPassword" type="password" minlength="6" maxlength="32" autocomplete="new-password" placeholder="কমপক্ষে ৬ অক্ষর" required>
          <button class="show-pin" type="button" data-staff-pw-toggle="staffPwNew" aria-label="পাসওয়ার্ড দেখুন">${iconMarkup("eye")}</button>
        </div>
        <label for="staffPwConfirm">নতুন পাসওয়ার্ড আবার লিখুন</label>
        <div class="input-wrap">
          ${iconMarkup("lock")}
          <input id="staffPwConfirm" name="confirmPassword" type="password" minlength="6" maxlength="32" autocomplete="new-password" placeholder="একই পাসওয়ার্ড আবার" required>
        </div>
        <p class="staff-pw-error" role="alert" hidden></p>
        <div class="staff-pw-actions">
          <button class="auth-submit" type="submit">${copy.submit}</button>
          <button class="step-back" type="button" data-staff-pw-cancel>বাতিল</button>
        </div>
      </form>
    </div>`;
  return overlay;
}

function trapTab(overlay, event) {
  if (event.key !== 'Tab') return;
  const focusable = [...overlay.querySelectorAll('button, input')].filter(el => !el.disabled);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Open the dialog. `mode` is 'setup' (no password exists yet) or 'change'
 * (a new password is mandatory before the panel opens). `onDone` runs after
 * the password is stored; the caller then saves the session and enters.
 */
export function openStaffPasswordDialog({ role, mode = 'change', onDone, onCancel, onSubmit, container = null }) {
  closeStaffPasswordDialog();
  const overlay = buildDom(role, mode);
  const pageMount = typeof container === 'string' ? document.querySelector(container) : container;
  const pageMode = Boolean(pageMount);
  if (pageMode) {
    overlay.classList.add('staff-pw-page');
    const card = overlay.querySelector('.staff-pw-card');
    card?.removeAttribute('role');
    card?.removeAttribute('aria-modal');
    pageMount.append(overlay);
  } else {
    document.body.append(overlay);
    document.body.classList.add('modal-open');
  }
  const state = { role, mode, onDone, onCancel, onSubmit, overlay, pageMode };
  openDialog = state;

  const form = overlay.querySelector('.staff-pw-form');
  const error = overlay.querySelector('.staff-pw-error');
  const submit = overlay.querySelector('[type=submit]');
  const newInput = overlay.querySelector('#staffPwNew');
  const confirmInput = overlay.querySelector('#staffPwConfirm');

  const showError = message => {
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
  };

  overlay.querySelector('[data-staff-pw-toggle]')?.addEventListener('click', () => {
    newInput.type = newInput.type === 'password' ? 'text' : 'password';
  });
  overlay.querySelector('[data-staff-pw-cancel]')?.addEventListener('click', () => {
    closeStaffPasswordDialog();
    onCancel?.();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeStaffPasswordDialog();
      onCancel?.();
    }
    trapTab(overlay, event);
  });

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    showError('');
    const next = newInput?.value || '';
    const confirm = confirmInput?.value || '';
    if (!next || !confirm) return showError('দুইবার পাসওয়ার্ড লিখুন।');
    if (submit) {
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
    }
    try {
      // `onSubmit` lets a caller store the password somewhere else — a Staff
      // Management identity keeps its hash on its own directory record.
      const result = onSubmit
        ? await onSubmit(next, confirm)
        : mode === 'setup'
          ? await provisionStaffAccount(role, next, confirm)
          : await setStaffPassword(role, next, confirm);
      if (!result.ok) {
        showError(result.error || 'পাসওয়ার্ড সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।');
        return;
      }
      closeStaffPasswordDialog();
      onDone?.();
    } catch {
      showError('পাসওয়ার্ড সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
      }
    }
  });

  window.setTimeout(() => newInput?.focus(), 30);
  return state;
}

export function closeStaffPasswordDialog() {
  if (!openDialog) return;
  openDialog.overlay.remove();
  if (!openDialog.pageMode) document.body.classList.remove('modal-open');
  openDialog = null;
}
