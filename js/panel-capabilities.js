/* একটাই permission gate, একটাই entry contract
   (মালিক-নির্দেশ ২০২৬-১১-০২ — ধাপ C ও D)

   চারটি স্টাফ প্যানেল আগে permission নিয়ে দুই রকম আচরণ করত:

     • Admin  — `data-admin-cap` সহ এলিমেন্ট DOM থেকে **মুছে** ফেলা হত
                (`js/admin-permissions.js` → enforceCapabilities)।
     • Teacher / Manager / Payment — কোনো gate-ই ছিল না; "অনুমতি" মানে শুধু
                "এই পেজটাই খোলা আছে", আর ভুল বাটন থাকলে সেটাও কাজ করত।

   এখন একটাই নিয়ম, সব প্যানেলে:

     `data-cap="capability"`  — এই এলিমেন্ট দেখাতে ওই capability লাগবে।
                                স্পেস দিয়ে একাধিক দিলে যেকোনো একটি হলেই হবে।
     `data-panel-entry="কোন ধরনের এন্ট্রি"` — notice · lecture · chat · report;
                                চারটি ফিচারের এন্ট্রি-কার্ডের এক রকম চুক্তি:
                                একটি বাটন + `.teacher-action-title` +
                                `.teacher-action-sub` + `.teacher-action-art`।

   Gate কখনোই নতুন capability বানায় না: সব কিছু `js/admin-permissions.js`-এর
   ইতিমধ্যে-ঘোষিত `ROLE_CAPABILITIES` থেকেই আসে। যা বদলায় তা হলো — অনুমতি না
   থাকলে এলিমেন্ট **লুকানো + নিষ্ক্রিয়** হয় (DOM-এ থেকে যায়, তাই হঠাৎ অনুমতি
   পেলে আবার দেখানো যায়), অথচ কোনো ক্লিক, কিবোর্ড-ফোকাস বা স্ক্রিন-রিডার তাকে
   ব্যবহার করতে পারে না। */

import { CAPABILITIES, ROLE_CAPABILITIES } from './admin-permissions.js';

export const PANEL_ROLES = Object.freeze(['admin', 'teacher', 'manager', 'payment']);
export const ENTRY_KINDS = Object.freeze(['notice', 'lecture', 'chat', 'report']);

/* Which capability — if any — owns each of the four feature entries.
   `null` means "the panel's own route table decides": today no role is granted
   NOTICES_MANAGE, and chat/report are panel surfaces rather than capabilities,
   so inventing a capability here would be a new rule (forbidden). Lecture
   sheets already have a real, role-agnostic capability, so that entry is
   gated for real — the Cash Counter never carries it. */
export const ENTRY_CAPABILITIES = Object.freeze({
  notice: null,
  lecture: CAPABILITIES.CONTENT_LECTURE_SHEETS,
  chat: null,
  report: null
});

/** Capabilities one role holds. Never throws: an unknown role holds none. */
export function panelCapabilities(role) {
  return new Set(ROLE_CAPABILITIES[String(role || '').trim().toLowerCase()] || []);
}

/** `data-cap="a b"` → ['a','b'] (empty when the element carries no gate). */
export function capabilityList(element) {
  return String(element?.getAttribute?.('data-cap') || '')
    .split(/[\s,]+/)
    .map(value => value.trim())
    .filter(Boolean);
}

/** True when the element's gate is satisfied for this role. */
export function allowsElement(element, role) {
  const needed = capabilityList(element);
  if (!needed.length) return true;
  const held = panelCapabilities(role);
  return needed.some(capability => held.has(capability));
}

/* Keep the pre-gate state so re-allowing an entry never enables a control
   that was already disabled or exposes an element that was already hidden. */
const originalGateState = new WeakMap();

/* Hiding is reversible on purpose: the element keeps its place in the markup,
   but it can no longer be seen, clicked, focused or announced. */
function setBlocked(element, blocked) {
  if (blocked) {
    if (element.dataset.gateBlocked === '1') return;
    originalGateState.set(element, {
      hidden: Boolean(element.hidden),
      disabled: 'disabled' in element ? Boolean(element.disabled) : null,
      ariaHidden: element.getAttribute('aria-hidden'),
      tabindex: element.getAttribute('tabindex')
    });
    element.dataset.gateBlocked = '1';
    element.hidden = true;
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('tabindex', '-1');
    if ('disabled' in element) element.disabled = true;
    return;
  }
  if (element.dataset.gateBlocked !== '1') return;
  const previous = originalGateState.get(element);
  delete element.dataset.gateBlocked;
  element.hidden = previous?.hidden ?? false;
  if ('disabled' in element) element.disabled = previous?.disabled ?? false;
  if (previous?.ariaHidden == null) element.removeAttribute('aria-hidden');
  else element.setAttribute('aria-hidden', previous.ariaHidden);
  if (previous?.tabindex == null) element.removeAttribute('tabindex');
  else element.setAttribute('tabindex', previous.tabindex);
  originalGateState.delete(element);
}

/**
 * The one permission gate.
 * @param {object} options
 * @param {Element|Document} [options.root] scope (a panel document or element)
 * @param {string} options.role              admin | teacher | manager | payment
 * @returns {{blocked: string[], allowed: number}}
 */
export function applyCapabilityGate({ root, role } = {}) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || !role) return { blocked: [], allowed: 0 };
  const blocked = [];
  let allowed = 0;
  scope.querySelectorAll('[data-cap]').forEach(element => {
    const ok = allowsElement(element, role);
    setBlocked(element, !ok);
    if (ok) allowed += 1;
    else blocked.push(element.dataset.cap || '');
  });
  return { blocked, allowed };
}

/**
 * Home doors are rule-based (ধাপ D): a home screen may only show a door whose
 * route the role can actually open. The panel's own route table is the rule —
 * nothing is hard-coded here, and no new route appears.
 * @param {object} options
 * @param {Element} options.root   the home/dashboard section
 * @param {string}  options.role
 * @param {Iterable<string>} options.routes  the panel's own view list
 */
const originalHomeDoorState = new WeakMap();

export function applyHomeDoorRules({ root, role, routes = [] } = {}) {
  if (!root) return { blocked: [], allowed: 0 };
  const allowed = new Set([...routes].map(route => String(route)));
  const blocked = [];
  let shown = 0;
  root.querySelectorAll('[data-panel-view]').forEach(door => {
    const route = door.dataset.panelView;
    /* The capability gate owns this element until it is re-allowed. Do not
       snapshot its temporary hidden state as the home door's original state. */
    if (door.dataset.gateBlocked === '1') {
      blocked.push(route);
      return;
    }
    const permitted = allowed.has(route) && allowsElement(door, role);
    if (permitted) {
      if (door.dataset.homeBlocked === '1') {
        const previous = originalHomeDoorState.get(door);
        door.hidden = previous?.hidden ?? false;
        if (previous?.ariaHidden == null) door.removeAttribute('aria-hidden');
        else door.setAttribute('aria-hidden', previous.ariaHidden);
        delete door.dataset.homeBlocked;
        originalHomeDoorState.delete(door);
      }
      shown += 1;
      return;
    }
    blocked.push(route);
    if (door.dataset.homeBlocked !== '1') {
      originalHomeDoorState.set(door, {
        hidden: Boolean(door.hidden),
        ariaHidden: door.getAttribute('aria-hidden')
      });
      door.dataset.homeBlocked = '1';
    }
    door.hidden = true;
    door.setAttribute('aria-hidden', 'true');
  });
  return { blocked, allowed: shown };
}

/**
 * Boot hook used by every staff panel: one gate, one home rule, one marker on
 * the document so a test (or a future screen) can read which role painted it.
 */
export function applyPanelCapabilities({ role, root, homeRoot, routes = [] } = {}) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  const gate = applyCapabilityGate({ root: scope, role });
  const home = homeRoot ? applyHomeDoorRules({ root: homeRoot, role, routes }) : null;
  try {
    if (scope?.documentElement) scope.documentElement.dataset.panelRole = String(role || '');
  } catch { /* a detached document in a test needs no marker */ }
  return { role, gate, home };
}

/**
 * The one entry pattern, as data: every `[data-panel-entry]` card with the route it
 * opens, the capability it needs and whether its inner shape is the shared one.
 * Used by the panels' tests so a new entry cannot drift into its own layout.
 */
export function entryReport(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope) return [];
  return [...scope.querySelectorAll('[data-panel-entry]')].map(element => {
    const classes = element.classList;
    const icon = Boolean(element.querySelector('.teacher-action-art, .pay-tile-icon, svg, .nav-chip'));
    const name = Boolean(element.querySelector('.teacher-action-title, .pay-tile-label, .teacher-academic-hub-title'))
      || Boolean((element.getAttribute('aria-label') || '').trim());
    /* The one pattern has two presentations of the same contract:
         • a card door — title + one-line subtitle + icon;
         • a shortcut   — icon + accessible name (the topbar chat button).
       The subtitle travels in `.teacher-action-sub` (Teacher · Cash Counter),
       `.teacher-academic-hub-sub` (a home hub card) or
       in `[data-action-sub]` painted by CSS `content: attr(…)` (Admin ·
       Manager) — same semantics, one pattern. */
    return {
      kind: element.dataset.panelEntry || '',
      route: element.dataset.panelView || element.getAttribute('href') || '',
      capability: element.dataset.cap || '',
      blocked: element.dataset.gateBlocked === '1',
      card: classes.contains('teacher-action-card') || classes.contains('panel-hub-card') || classes.contains('pay-tile'),
      shape: icon && name,
      subtitle: Boolean(element.querySelector('.teacher-action-sub, .teacher-academic-hub-sub, [data-action-sub]'))
    };
  });
}
