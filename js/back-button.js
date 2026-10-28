/* Hardware back button for Android WebView / Capacitor wrapper.
   Admin, Manager, Teacher and Payment panels share this helper.
   - If a modal is open, close it
   - Else if inside a detail view (data-parent-view), go back to hub
   - Else let the system handle it (minimize app / exit)
*/
import { routeName } from './panel-route.js';

function isModalOpen() {
  const adminModal = document.getElementById('adminModalBackdrop');
  if (adminModal && !adminModal.hidden) return adminModal;
  const genericModal = document.querySelector('.modal-backdrop:not([hidden]), .admin-modal-backdrop:not([hidden])');
  return genericModal || null;
}

function handleBackButton(event) {
  const modal = isModalOpen();
  if (modal) {
    event?.preventDefault?.();
    modal.hidden = true;
    document.body.classList.remove('admin-modal-open');
    return;
  }
  // Detail view → hub back is handled by [data-admin-back] click handler in admin.js
  // which already pushes history. Here we just ensure hardware back triggers same.
  const backBtn = document.querySelector('.admin-view.active [data-admin-back], .view.active [data-view]');
  if (backBtn) {
    event?.preventDefault?.();
    backBtn.click();
    return;
  }
  // No in-app back — let OS handle (e.g. exit prompt)
}

document.addEventListener('backbutton', handleBackButton, false);
// Also hook for browsers where hardware back is just history back — hashchange is already handled by panel-route.js
window.addEventListener('popstate', () => {
  // hashchange listener in panel-route.js will restore correct view; no extra work here
});

export { handleBackButton };
