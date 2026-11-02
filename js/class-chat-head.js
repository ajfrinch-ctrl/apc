/* Topbar Chat Icon badge + Always-Floating In-App Class Chat Head bubble.
 *
 * Works across Student, Teacher, Manager, and Admin portals without touching
 * `js/main.js` static boot closure:
 *   1. Tracks per-user, per-room read receipts locally (`activePlus.classChatRead.v1`).
 *   2. Enforces strict RBAC on unread counts & message previews (approved students
 *      only ever see/count their own normalized class room; staff see all rooms).
 *   3. Updates `#classChatTopbarButton` unread badge + active route state.
 *   4. Renders `#apcClassChatHead` floating bubble inside the signed-in shell:
 *      - Stays floating across app screens with live unread count badge.
 *      - Shows a brief XSS-safe preview pill when a new unread message arrives.
 *      - Supports smooth touch/pointer vertical drag + left/right edge snap.
 *      - Auto-hides while inside the `class-chat` view (or live exam / pending gate)
 *        and reappears automatically when navigating to other screens.
 */
import { KEYS, readRaw, writeJSON } from './database.js';
import { normalizeClassId } from './class-key.js';
import { loadRoster } from './office-data.js';
import { authenticatedStudent } from './student-access.js';
import { hasStaffSession, readStaffAccount, readActiveStaffIdentity } from './staff-auth.js';

export const CLASS_CHAT_READ_KEY = 'activePlus.classChatRead.v1';
export const CLASS_CHAT_HEAD_POS_KEY = 'activePlus.classChatHeadPos.v1';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const toBnChatDigits = value => String(value ?? '').replace(/\d/g, d => BN_DIGITS[Number(d)]);

const STAFF_LABELS = Object.freeze({
  teacher: 'শিক্ষক',
  manager: 'ম্যানেজার',
  admin: 'এডমিন'
});

const SHORT_CLASS_NAMES = Object.freeze({
  'অষ্টম শ্রেণি': 'অষ্টম',
  'নবম শ্রেণি': 'নবম',
  'দশম শ্রেণি': 'দশম',
  'একাদশ শ্রেণি': 'একাদশ',
  'দ্বাদশ শ্রেণি': 'দ্বাদশ'
});

const ROOM_SLUGS = Object.freeze({
  'অষ্টম শ্রেণি': 'class_8',
  'নবম শ্রেণি': 'class_9',
  'দশম শ্রেণি': 'class_10',
  'একাদশ শ্রেণি': 'class_11',
  'দ্বাদশ শ্রেণি': 'class_12'
});

function roomKeyFor(className) {
  const classId = normalizeClassId(className);
  if (!classId) return '';
  if (ROOM_SLUGS[classId]) return ROOM_SLUGS[classId];
  let hash = 2166136261;
  for (let i = 0; i < classId.length; i += 1) {
    hash ^= classId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `class_c${hash.toString(36)}`;
}

function shortClassLabel(className) {
  const classId = normalizeClassId(className);
  return SHORT_CLASS_NAMES[classId] || classId.replace(/\s*শ্রেণি$/, '') || classId;
}

export function formatUnreadCountBn(count) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  if (!n) return '';
  return n > 99 ? '৯৯+' : toBnChatDigits(n);
}

export function isChatContainerVisible(node) {
  if (!node || !node.isConnected) return false;
  if (node.closest('[hidden]')) return false;
  const viewPanel = node.closest('.view, .manager-view, .admin-view');
  if (viewPanel && !viewPanel.classList.contains('active')) return false;
  const teacherPanel = node.closest('.teacher-view');
  if (teacherPanel && teacherPanel.hidden) return false;
  return true;
}

export function actorReadKey(actor) {
  if (!actor || typeof actor !== 'object') return '';
  const role = String(actor.role || (actor.kind === 'staff' ? 'teacher' : 'student')).trim().toLowerCase();
  const id = String(actor.id || actor.staffId || actor.studentId || actor.username || '').trim();
  if (!id) return '';
  if (['teacher', 'manager', 'admin'].includes(role)) {
    return `staff:${role}:${id}`;
  }
  return `student:${id}`;
}

function readAllReceiptsMap() {
  try {
    const raw = readRaw(CLASS_CHAT_READ_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readChatReceipts(actor) {
  const key = actorReadKey(actor);
  if (!key) return {};
  const map = readAllReceiptsMap();
  const bucket = map[key];
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return {};
  const out = {};
  for (const [roomKey, ts] of Object.entries(bucket)) {
    const num = Number(ts);
    if (roomKey && Number.isFinite(num) && num > 0) out[roomKey] = num;
  }
  return out;
}

function readMessagesSnapshot() {
  try {
    const raw = readRaw(KEYS.classChat);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.messages) ? parsed.messages : [];
    return list;
  } catch {
    return [];
  }
}

function messageTimestamp(msg) {
  const created = Date.parse(String(msg?.createdAt || ''));
  if (Number.isFinite(created) && created > 0) return created;
  const updated = Number(msg?.updatedAt);
  return Number.isFinite(updated) && updated > 0 ? updated : 1;
}

export function markClassRoomRead(actorInput, className, timestampMs = 0) {
  const key = actorReadKey(actorInput);
  const classId = normalizeClassId(className);
  const roomKey = roomKeyFor(classId);
  if (!key || !roomKey) return { saved: false, roomKey: '', timestamp: 0 };

  let maxMsgTs = 0;
  for (const msg of readMessagesSnapshot()) {
    if (!msg || msg.deleted === true) continue;
    const msgRoom = String(msg.roomKey || roomKeyFor(msg.classId || msg.className || '')).trim();
    if (msgRoom === roomKey) {
      const ts = messageTimestamp(msg);
      if (ts > maxMsgTs) maxMsgTs = ts;
    }
  }
  const explicitTs = Number(timestampMs) || 0;
  const all = readAllReceiptsMap();
  const prevBucket = (all[key] && typeof all[key] === 'object' && !Array.isArray(all[key])) ? all[key] : {};
  const prevTs = Number(prevBucket[roomKey]) || 0;
  if (prevTs > 0 && prevTs >= maxMsgTs && prevTs >= explicitTs) {
    return { saved: true, roomKey, timestamp: prevTs };
  }
  const targetTs = Math.max(explicitTs, maxMsgTs, Date.now());
  const nextAll = {
    ...all,
    [key]: {
      ...prevBucket,
      [roomKey]: targetTs
    }
  };
  const saved = writeJSON(CLASS_CHAT_READ_KEY, nextAll);
  if (saved && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('apc-class-chat-read-updated', {
      detail: { actorKey: key, roomKey, classId, timestamp: targetTs }
    }));
  }
  return { saved: Boolean(saved), roomKey, timestamp: targetTs };
}

function normalizeSummaryActor(actorInput) {
  if (!actorInput || typeof actorInput !== 'object') return null;
  const role = String(actorInput.role || (actorInput.kind === 'staff' ? 'teacher' : 'student')).trim().toLowerCase();
  if (['teacher', 'manager', 'admin'].includes(role)) {
    const status = String(actorInput.status || actorInput.accountStatus || 'active').trim().toLowerCase();
    if (['inactive', 'suspended', 'rejected'].includes(status)) return null;
    const id = String(actorInput.id || actorInput.staffId || actorInput.username || `${role}.apc`).trim();
    if (!id) return null;
    return { kind: 'staff', role, id, classId: '' };
  }
  const id = String(actorInput.id || actorInput.studentId || '').trim();
  if (!id) return null;
  const roster = loadRoster();
  const rosterMatch = Array.isArray(roster) ? roster.find(r => String(r?.id || '') === id) : null;
  const status = String(actorInput.status || rosterMatch?.status || '').trim().toLowerCase();
  if (status !== 'approved') return null;
  if (rosterMatch && String(rosterMatch.status || '').trim().toLowerCase() !== 'approved') return null;
  const classId = normalizeClassId(actorInput.classId || actorInput.className || rosterMatch?.className || '');
  if (!classId) return null;
  return { kind: 'student', role: 'student', id, classId };
}

export function getUnreadClassChatSummary(actorInput) {
  const actor = normalizeSummaryActor(actorInput);
  if (!actor) {
    return { totalUnread: 0, byClass: {}, byRoom: {}, latestUnread: null };
  }
  const receipts = readChatReceipts(actor);
  const studentRoomKey = actor.kind === 'student' ? roomKeyFor(actor.classId) : '';
  const messages = readMessagesSnapshot();

  let totalUnread = 0;
  const byClass = {};
  const byRoom = {};
  let latestUnread = null;

  for (const raw of messages) {
    if (!raw || typeof raw !== 'object' || raw.deleted === true) continue;
    const classId = normalizeClassId(raw.classId || raw.className || '');
    const roomKey = String(raw.roomKey || roomKeyFor(classId)).trim();
    if (!classId || !roomKey) continue;
    if (actor.kind === 'student' && roomKey !== studentRoomKey) continue;
    const senderId = String(raw.senderId || '').trim();
    if (senderId && senderId === actor.id) continue;

    const ts = messageTimestamp(raw);
    const seenTs = Number(receipts[roomKey]) || 0;
    if (ts <= seenTs) continue;

    totalUnread += 1;
    byClass[classId] = (byClass[classId] || 0) + 1;
    byRoom[roomKey] = (byRoom[roomKey] || 0) + 1;

    if (!latestUnread || ts >= latestUnread.ts) {
      const senderRole = ['teacher', 'manager', 'admin'].includes(raw.senderRole) ? raw.senderRole : 'student';
      latestUnread = {
        id: String(raw.id || ''),
        classId,
        roomKey,
        senderId,
        senderName: String(raw.senderName || 'সদস্য').slice(0, 80),
        senderRole,
        senderBadge: senderRole === 'student' ? '' : (STAFF_LABELS[senderRole] || ''),
        text: String(raw.text || '').slice(0, 140),
        createdAt: String(raw.createdAt || ''),
        ts
      };
    }
  }

  return { totalUnread, byClass, byRoom, latestUnread };
}

async function resolveCurrentPortalActor(portal) {
  try {
    if (['teacher', 'manager', 'admin'].includes(portal)) {
      const allowed = await hasStaffSession(portal);
      if (!allowed) return null;
      const activeId = readActiveStaffIdentity();
      const account = await readStaffAccount(portal);
      const matches = activeId && (activeId.role === portal || activeId.role === 'admin');
      const username = (matches && activeId?.username) || account?.username || `${portal}.apc`;
      const id = (matches && activeId?.staffId) || account?.staffId || username;
      const name = (matches && activeId?.fullName) || account?.fullName || STAFF_LABELS[portal];
      return normalizeSummaryActor({
        kind: 'staff',
        role: portal,
        id,
        name,
        status: account?.status || 'active'
      });
    }
    const student = await authenticatedStudent();
    if (!student?.id) return null;
    const roster = loadRoster();
    const rosterRow = Array.isArray(roster) ? roster.find(r => String(r?.id || '') === String(student.id)) : null;
    return normalizeSummaryActor({
      ...student,
      ...(rosterRow || {}),
      id: student.id,
      role: 'student',
      status: rosterRow?.status || student.status || 'approved'
    });
  } catch {
    return null;
  }
}

function detectPortalContext(doc = document) {
  const candidates = [
    { portal: 'student', shellId: 'appShell', mountId: 'studentClassChatMount', viewSelector: '#classChatView' },
    { portal: 'teacher', shellId: 'teacherShell', mountId: 'teacherClassChatMount', viewSelector: '#teacherClassChat' },
    { portal: 'manager', shellId: 'managerShell', mountId: 'managerClassChatMount', viewSelector: '.manager-view[data-view-panel="class-chat"]' },
    { portal: 'admin', shellId: 'adminShell', mountId: 'adminClassChatMount', viewSelector: '.admin-view[data-view-panel="class-chat"]' }
  ];
  for (const item of candidates) {
    const shell = doc.getElementById(item.shellId);
    if (shell) return { ...item, shell };
  }
  return null;
}

function readSavedHeadPosition() {
  try {
    const raw = readRaw(CLASS_CHAT_HEAD_POS_KEY);
    if (!raw) return { dock: 'right', topRatio: null };
    const parsed = JSON.parse(raw);
    const dock = parsed?.dock === 'left' ? 'left' : 'right';
    const ratio = Number(parsed?.topRatio);
    return {
      dock,
      topRatio: Number.isFinite(ratio) && ratio >= 0.1 && ratio <= 0.88 ? ratio : null
    };
  } catch {
    return { dock: 'right', topRatio: null };
  }
}

function saveHeadPosition(dock, topRatio) {
  try {
    writeJSON(CLASS_CHAT_HEAD_POS_KEY, {
      dock: dock === 'left' ? 'left' : 'right',
      topRatio: Number.isFinite(topRatio) ? Number(topRatio.toFixed(4)) : null
    });
  } catch { /* ignore storage quota issues for cosmetic position */ }
}

function buildPreviewSnippet(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 54) return clean;
  return `${clean.slice(0, 52).trimEnd()}…`;
}

export function mountClassChatHead(options = {}) {
  if (typeof document === 'undefined') return null;
  const ctx = detectPortalContext(document);
  if (!ctx) return null;

  const existing = document.getElementById('apcClassChatHead');
  if (existing?.__apcChatHeadInstance) {
    void existing.__apcChatHeadInstance.refresh();
    return existing.__apcChatHeadInstance;
  }

  const { portal, shell, mountId, viewSelector } = ctx;
  const headEl = document.createElement('aside');
  headEl.id = 'apcClassChatHead';
  headEl.className = 'class-chat-head';
  headEl.dataset.chatHead = portal;
  headEl.dataset.dock = 'right';
  headEl.hidden = true;
  headEl.setAttribute('aria-label', 'শ্রেণি চ্যাট শর্টকাট');
  headEl.innerHTML = `
    <div class="class-chat-head-preview" data-chat-head-preview hidden>
      <button type="button" class="class-chat-head-preview-body" data-chat-head-open>
        <span class="class-chat-head-preview-meta" data-chat-head-preview-meta></span>
        <span class="class-chat-head-preview-text" data-chat-head-preview-text></span>
      </button>
      <button type="button" class="class-chat-head-preview-close" data-chat-head-preview-dismiss aria-label="প্রিভিউ বন্ধ করুন">×</button>
    </div>
    <button type="button" class="class-chat-head-bubble" id="classChatHeadButton" data-chat-head-open aria-label="শ্রেণি চ্যাট খুলুন">
      <svg class="apc-glyph-icon class-chat-head-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-icon="chat" data-icon-set="active-plus-soft3d" data-icon-version="2" data-icon-style="glyph"><image href="assets/icons/ai-3d/chat.svg" width="24" height="24" preserveAspectRatio="xMidYMid meet"/></svg>
      <span class="class-chat-head-live-dot" aria-hidden="true"></span>
      <span class="class-chat-head-badge" data-chat-head-badge hidden aria-hidden="true"></span>
    </button>
  `;
  shell.append(headEl);

  const previewEl = headEl.querySelector('[data-chat-head-preview]');
  const previewMetaEl = headEl.querySelector('[data-chat-head-preview-meta]');
  const previewTextEl = headEl.querySelector('[data-chat-head-preview-text]');
  const bubbleBtn = headEl.querySelector('#classChatHeadButton');
  const headBadgeEl = headEl.querySelector('[data-chat-head-badge]');

  let previewTimer = null;
  let lastPreviewedMessageId = '';
  let dismissedPreviewId = '';
  let latestTargetClass = '';
  let wasChatViewOpen = false;
  let destroyed = false;
  let refreshTicket = 0;

  function applySavedDockPosition() {
    const saved = readSavedHeadPosition();
    headEl.dataset.dock = saved.dock;
    if (saved.topRatio !== null) {
      const shellHeight = shell.clientHeight || window.innerHeight || 720;
      const clampedTop = Math.min(Math.max(Math.round(shellHeight * saved.topRatio), 68), Math.max(68, shellHeight - 144));
      headEl.style.top = `${clampedTop}px`;
      headEl.style.bottom = 'auto';
    } else {
      headEl.style.top = '';
      headEl.style.bottom = '';
    }
  }
  applySavedDockPosition();

  function hidePreview() {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    if (previewEl) previewEl.hidden = true;
  }

  function showPreview(latest) {
    if (!previewEl || !previewMetaEl || !previewTextEl || !latest) return;
    const roleTag = latest.senderBadge ? `${latest.senderBadge} · ` : '';
    const roomTag = portal === 'student' ? '' : `${shortClassLabel(latest.classId)} · `;
    previewMetaEl.textContent = `${roomTag}${roleTag}${latest.senderName}`;
    previewTextEl.textContent = buildPreviewSnippet(latest.text);
    previewEl.hidden = false;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (previewEl) previewEl.hidden = true;
    }, 6500);
  }

  function isPortalSignedInSurfaceReady() {
    if (!shell || shell.hidden) return false;
    if (portal === 'student' && shell.classList.contains('is-pending')) return false;
    const topbarBtn = document.getElementById('classChatTopbarButton');
    if (portal === 'admin' && topbarBtn && topbarBtn.hidden) return false;
    return true;
  }

  function isClassChatViewOpen() {
    const viewEl = document.querySelector(viewSelector);
    if (!viewEl) return false;
    return isChatContainerVisible(viewEl);
  }

  function isDistractionFreeExamOpen() {
    if (portal !== 'student') return false;
    const liveExam = document.getElementById('examLiveView');
    return Boolean(liveExam && liveExam.classList.contains('active') && !liveExam.hidden);
  }

  function paintTopbarBadge(totalUnread, chatOpen) {
    const topbarBtn = document.getElementById('classChatTopbarButton');
    if (!topbarBtn) return;
    let dot = topbarBtn.querySelector('[data-chat-unread-dot], .class-chat-dot, .notification-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'notification-dot class-chat-dot';
      dot.dataset.chatUnreadDot = '';
      dot.setAttribute('aria-hidden', 'true');
      topbarBtn.append(dot);
    }
    const shownCount = chatOpen && portal === 'student' ? 0 : totalUnread;
    const text = formatUnreadCountBn(shownCount);
    if (dot.textContent !== text) dot.textContent = text;
    const hasCount = text.length > 0;
    if (dot.classList.contains('is-count') !== hasCount) dot.classList.toggle('is-count', hasCount);
    const shouldHideDot = shownCount === 0;
    if (dot.hidden !== shouldHideDot) dot.hidden = shouldHideDot;

    const nextActive = Boolean(chatOpen);
    if (topbarBtn.classList.contains('is-active') !== nextActive) {
      topbarBtn.classList.toggle('is-active', nextActive);
    }
    if (nextActive) {
      if (topbarBtn.getAttribute('aria-current') !== 'page') topbarBtn.setAttribute('aria-current', 'page');
    } else if (topbarBtn.hasAttribute('aria-current')) {
      topbarBtn.removeAttribute('aria-current');
    }

    const nextLabel = shownCount > 0
      ? `শ্রেণি চ্যাট — ${toBnChatDigits(shownCount)}টি অপঠিত বার্তা`
      : 'শ্রেণি চ্যাট খুলুন';
    if (topbarBtn.getAttribute('aria-label') !== nextLabel) {
      topbarBtn.setAttribute('aria-label', nextLabel);
    }
  }

  function paintHeadBubble(summary, surfaceReady, chatOpen) {
    const examBusy = isDistractionFreeExamOpen();
    const shouldShowHead = surfaceReady && !chatOpen && !examBusy;
    headEl.hidden = !shouldShowHead;

    const total = summary.totalUnread;
    const badgeText = formatUnreadCountBn(total);
    if (headBadgeEl) {
      headBadgeEl.textContent = badgeText;
      headBadgeEl.hidden = total === 0;
    }
    headEl.classList.toggle('has-unread', total > 0);
    if (bubbleBtn) {
      bubbleBtn.setAttribute('aria-label', total > 0
        ? `শ্রেণি চ্যাট খুলুন — ${toBnChatDigits(total)}টি অপঠিত বার্তা`
        : 'শ্রেণি চ্যাট খুলুন');
    }

    if (!shouldShowHead || total === 0 || !summary.latestUnread) {
      hidePreview();
      return;
    }

    const latestId = summary.latestUnread.id;
    if (latestId && latestId !== lastPreviewedMessageId && latestId !== dismissedPreviewId) {
      lastPreviewedMessageId = latestId;
      showPreview(summary.latestUnread);
    }
  }

  async function refresh() {
    if (destroyed) return { totalUnread: 0 };
    const ticket = ++refreshTicket;
    const surfaceReady = isPortalSignedInSurfaceReady();
    const chatOpen = surfaceReady && isClassChatViewOpen();

    if (chatOpen && !wasChatViewOpen) {
      const mountEl = document.getElementById(mountId);
      if (mountEl?.__apcClassChatInstance) {
        if (window.__apcPendingChatClass && portal !== 'student') {
          const targetCls = window.__apcPendingChatClass;
          window.__apcPendingChatClass = '';
          try { mountEl.__apcClassChatInstance.selectClass(targetCls); } catch { /* ignore */ }
        } else {
          void mountEl.__apcClassChatInstance.refresh();
        }
      }
    }
    wasChatViewOpen = chatOpen;

    if (!surfaceReady) {
      latestTargetClass = '';
      paintTopbarBadge(0, false);
      paintHeadBubble({ totalUnread: 0, latestUnread: null }, false, false);
      return { totalUnread: 0 };
    }

    const actor = typeof options.getActor === 'function'
      ? normalizeSummaryActor(await options.getActor())
      : await resolveCurrentPortalActor(portal);
    if (destroyed || ticket !== refreshTicket) return { totalUnread: 0 };

    if (!actor) {
      latestTargetClass = '';
      paintTopbarBadge(0, chatOpen);
      paintHeadBubble({ totalUnread: 0, latestUnread: null }, false, chatOpen);
      return { totalUnread: 0 };
    }

    if (chatOpen && actor.kind === 'student' && actor.classId) {
      markClassRoomRead(actor, actor.classId);
    }

    const summary = getUnreadClassChatSummary(actor);
    latestTargetClass = summary.latestUnread?.classId || '';
    paintTopbarBadge(summary.totalUnread, chatOpen);
    paintHeadBubble(summary, true, chatOpen);
    return summary;
  }

  function openClassChatFromShortcut() {
    hidePreview();
    if (latestTargetClass && portal !== 'student') {
      window.__apcPendingChatClass = latestTargetClass;
    }
    const topbarBtn = document.getElementById('classChatTopbarButton');
    if (topbarBtn && !topbarBtn.hidden) {
      topbarBtn.click();
      return;
    }
    const fallbackBtn = document.querySelector(
      portal === 'student' ? '[data-view="class-chat"]'
        : portal === 'teacher' ? '[data-panel-view="class-chat"]'
          : portal === 'manager' ? '[data-panel-view="class-chat"]'
            : '[data-panel-view="class-chat"]'
    );
    fallbackBtn?.click();
  }

  /* Pointer drag + tap disambiguation on the floating bubble */
  let dragState = null;
  let suppressNextClick = false;

  bubbleBtn?.addEventListener('pointerdown', event => {
    if (event.button && event.button !== 0) return;
    const shellRect = shell.getBoundingClientRect();
    const headRect = headEl.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      shellRect,
      offsetX: event.clientX - headRect.left,
      offsetY: event.clientY - headRect.top,
      headWidth: headRect.width || 54,
      headHeight: headRect.height || 54,
      moved: false
    };
    bubbleBtn.setPointerCapture?.(event.pointerId);
  });

  bubbleBtn?.addEventListener('pointermove', event => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < 8) return;
    dragState.moved = true;
    hidePreview();
    headEl.classList.add('is-dragging');

    const { shellRect, offsetX, offsetY, headWidth, headHeight } = dragState;
    const minLeft = 10;
    const maxLeft = Math.max(minLeft, shellRect.width - headWidth - 10);
    const minTop = 68;
    const maxTop = Math.max(minTop, shellRect.height - headHeight - 82);

    const nextLeft = Math.min(Math.max(event.clientX - shellRect.left - offsetX, minLeft), maxLeft);
    const nextTop = Math.min(Math.max(event.clientY - shellRect.top - offsetY, minTop), maxTop);

    headEl.style.left = `${Math.round(nextLeft)}px`;
    headEl.style.right = 'auto';
    headEl.style.top = `${Math.round(nextTop)}px`;
    headEl.style.bottom = 'auto';
  });

  const finishDrag = event => {
    if (!dragState || (event?.pointerId !== undefined && event.pointerId !== dragState.pointerId)) return;
    const finished = dragState;
    dragState = null;
    headEl.classList.remove('is-dragging');
    try { bubbleBtn?.releasePointerCapture?.(finished.pointerId); } catch { /* ignore */ }
    if (!finished.moved) return;

    suppressNextClick = true;
    setTimeout(() => { suppressNextClick = false; }, 220);

    const shellRect = shell.getBoundingClientRect();
    const headRect = headEl.getBoundingClientRect();
    const centerInShell = (headRect.left - shellRect.left) + headRect.width / 2;
    const dock = centerInShell < shellRect.width / 2 ? 'left' : 'right';
    const topPx = Math.min(
      Math.max(headRect.top - shellRect.top, 68),
      Math.max(68, shellRect.height - headRect.height - 82)
    );
    const ratio = shellRect.height > 0 ? topPx / shellRect.height : null;

    headEl.dataset.dock = dock;
    headEl.style.left = '';
    headEl.style.right = '';
    headEl.style.top = `${Math.round(topPx)}px`;
    headEl.style.bottom = 'auto';
    saveHeadPosition(dock, ratio);
  };

  bubbleBtn?.addEventListener('pointerup', finishDrag);
  bubbleBtn?.addEventListener('pointercancel', finishDrag);

  headEl.addEventListener('click', event => {
    const dismissBtn = event.target.closest?.('[data-chat-head-preview-dismiss]');
    if (dismissBtn) {
      event.preventDefault();
      event.stopPropagation();
      dismissedPreviewId = lastPreviewedMessageId;
      hidePreview();
      return;
    }
    const openBtn = event.target.closest?.('[data-chat-head-open]');
    if (!openBtn) return;
    event.preventDefault();
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    openClassChatFromShortcut();
  });

  /* Capture click on topbar chat button so staff jump directly to the unread class tab */
  const onTopbarCaptureClick = event => {
    const btn = event.target?.closest?.('#classChatTopbarButton');
    if (!btn) return;
    hidePreview();
    if (latestTargetClass && portal !== 'student') {
      window.__apcPendingChatClass = latestTargetClass;
    }
  };
  document.addEventListener('click', onTopbarCaptureClick, true);

  const onSyncOrChatEvent = event => {
    if (destroyed) return;
    if (event?.type === 'storage' && event.key && event.key !== KEYS.classChat && event.key !== CLASS_CHAT_READ_KEY && event.key !== KEYS.students) {
      return;
    }
    if (event?.type === 'apc-sync-updated') {
      const col = event.detail?.collection;
      if (col && col !== 'classChat' && col !== 'students') return;
    }
    void refresh();
  };

  window.addEventListener('storage', onSyncOrChatEvent);
  window.addEventListener('apc-sync-updated', onSyncOrChatEvent);
  window.addEventListener('apc-class-chat-updated', onSyncOrChatEvent);
  window.addEventListener('apc-class-chat-read-updated', onSyncOrChatEvent);
  window.addEventListener('apc-view-change', onSyncOrChatEvent);
  window.addEventListener('hashchange', onSyncOrChatEvent);

  let mutationTimer = null;
  const scheduleMutationRefresh = () => {
    if (mutationTimer !== null || destroyed) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      if (!destroyed) void refresh();
    }, 0);
  };

  const observer = new MutationObserver(mutations => {
    const topbarBtn = document.getElementById('classChatTopbarButton');
    for (const m of mutations) {
      if (m.target === headEl || headEl.contains(m.target)) continue;
      if (topbarBtn && (m.target === topbarBtn || topbarBtn.contains(m.target)) && m.attributeName !== 'hidden') continue;
      scheduleMutationRefresh();
      break;
    }
  });
  observer.observe(shell, {
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'class']
  });

  const instance = {
    element: headEl,
    refresh,
    destroy() {
      destroyed = true;
      if (mutationTimer !== null) {
        clearTimeout(mutationTimer);
        mutationTimer = null;
      }
      hidePreview();
      observer.disconnect();
      document.removeEventListener('click', onTopbarCaptureClick, true);
      window.removeEventListener('storage', onSyncOrChatEvent);
      window.removeEventListener('apc-sync-updated', onSyncOrChatEvent);
      window.removeEventListener('apc-class-chat-updated', onSyncOrChatEvent);
      window.removeEventListener('apc-class-chat-read-updated', onSyncOrChatEvent);
      window.removeEventListener('apc-view-change', onSyncOrChatEvent);
      window.removeEventListener('hashchange', onSyncOrChatEvent);
      delete headEl.__apcChatHeadInstance;
      headEl.remove();
    }
  };

  headEl.__apcChatHeadInstance = instance;
  void refresh();
  return instance;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { mountClassChatHead(); }, { once: true });
  } else {
    mountClassChatHead();
  }
}
