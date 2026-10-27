/* Admin Home — direct full-screen navigation, no in-place fold/expand.
 *
 * Requirement:
 * 1. featureFolds() / Summary:-based fold/expand সম্পূর্ণ সরানো।
 *    এই ফাইলটি কখনোই featureFolds() তৈরি করে না; পুরনো ব্রাঞ্চে থাকলেও
 *    এখন এটি no-op হিসাবে রাখা হয়েছে যাতে লিগ্যাসি কল নিরাপদে উপেক্ষিত হয়।
 * 2. প্রতিটি feature group পরিষ্কার section/card হিসাবে দেখায়; গ্রুপ হেডারে
 *    ক্লিক করলে সংশ্লিষ্ট প্রথম section-এর full page (tab-panel) খোলে।
 * 3. প্রতিটি টাইল [data-goto] / [data-admin-view] ক্লিক করলে existing
 *    navigate()/setView() (tabs.activate()/goto() সমতুল্য) দিয়ে full-screen
 *    tab-panel খোলে — কোনো expand নেই।
 * 4. Admin Home শান্ত ও পরিষ্কার: overview, quick actions, dues alert,
 *    institute card এবং feature টাইলের সরল তালিকা।
 * 5. Mobile + Desktop full-screen, BackButtonController সামঞ্জস্য
 *    (history push/replace + hashchange/popstate)।
 * 6. কোনো নতুন modal নয় — শুধু navigation pattern পরিবর্তন।
 */

export function featureFolds() {
  // Intentionally removed: Summary:-based fold/expand is forbidden.
  // Kept as no-op for backward compatibility if old code calls it.
  return { removed: true, reason: 'Summary fold disabled — use direct full-screen navigation' };
}

/**
 * Bind Home groups/tiles to full-screen navigation.
 * @param {Object} opts
 * @param {Function} opts.navigate - existing navigate(view, sourceEl) from admin.js
 * @param {HTMLElement} opts.root - Home root (dashboard view)
 */
export function initAdminHomeNavigation({ navigate, root } = {}) {
  if (typeof navigate !== 'function') return { bound: 0 };
  const scope = root || document.querySelector('.admin-view[data-view-panel="dashboard"]') || document;
  let bound = 0;

  // 1. Feature groups: header click → first section's full page
  //    Any element marked as group header should open its target view directly.
  //    Supported attrs: data-home-group-goto, data-goto, data-admin-view
  const groupHeaders = scope.querySelectorAll('[data-home-group-goto], [data-admin-view][data-home-group]');
  groupHeaders.forEach(el => {
    if (el.dataset.homeNavWired === '1') return;
    el.dataset.homeNavWired = '1';
    el.addEventListener('click', () => {
      const target = el.dataset.homeGroupGoto || el.dataset.goto || el.dataset.adminView;
      if (target) navigate(target, el);
    });
    bound += 1;
  });

  // 2. Tiles: [data-goto] / [data-admin-view] → existing tabs.activate()/goto()
  //    Tiles inside Home (adminFeatureGrid, admin-portal-grid) already use
  //    data-admin-view; also support legacy data-goto for compatibility.
  const tiles = scope.querySelectorAll('[data-goto], .admin-feature-grid [data-admin-view], .admin-portal-grid [data-admin-view]');
  tiles.forEach(tile => {
    if (tile.dataset.homeNavWired === '1') return;
    // Skip external <a href="..."> portal links — they are cross-panel, not tab-panel
    if (tile.tagName === 'A' && tile.getAttribute('href')?.endsWith('.html')) return;
    tile.dataset.homeNavWired = '1';
    tile.addEventListener('click', e => {
      const target = tile.dataset.goto || tile.dataset.adminView;
      if (!target) return;
      // Prevent any legacy fold handler
      e.preventDefault();
      e.stopPropagation();
      navigate(target, tile);
    });
    bound += 1;
  });

  // 3. Ensure no <details><summary> remains interactive on Home
  scope.querySelectorAll('details').forEach(d => {
    // Convert any stray details/summary on Home to plain card — no fold
    const summary = d.querySelector('summary');
    if (summary) {
      const target = d.dataset.goto || d.dataset.adminView || summary.dataset.goto;
      if (target) {
        summary.addEventListener('click', e => {
          e.preventDefault();
          navigate(target, summary);
        });
      }
    }
  });

  return { bound };
}

/**
 * Render clean Home overview helpers.
 * Keeps Home to: overview, quick actions, dues alert, institute card, tile list.
 * These are presentation-only; data comes from existing state/loaders.
 */
export function renderAdminHomeOverview({ duesCount = 0, institute = null } = {}) {
  const duesEl = document.getElementById('adminHomeDuesAlert');
  if (duesEl) {
    const count = Number(duesCount) || 0;
    duesEl.hidden = count === 0;
    const badge = duesEl.querySelector('[data-dues-count]');
    if (badge) badge.textContent = String(count);
  }
  const instEl = document.getElementById('adminHomeInstituteCard');
  if (instEl && institute) {
    const nameEl = instEl.querySelector('[data-institute-name]');
    const addrEl = instEl.querySelector('[data-institute-addr]');
    if (nameEl && institute.name) nameEl.textContent = institute.name;
    if (addrEl && institute.address) addrEl.textContent = institute.address;
  }
}
