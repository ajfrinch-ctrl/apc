# Active Plus Coaching — ফেসবুক-স্টাইল নোটিফিকেশন আপগ্রেড (Plan & Design)

> তারিখ: 2026-10-28 | ব্রাঞ্চ: arena/ea1402e9-apc | ভিত্তি: বিদ্যমান `js/notifications.js` + `js/notification-store.js` + `js/notice-center.js` + `css/notifications.css`

---

## 1. বর্তমান সিস্টেমের সংক্ষিপ্ত বিশ্লেষণ

### কী আছে (Strengths)
- **Bell + badge**: `#notificationButton` + `.notification-dot` সব প্যানেলে (student/admin/manager/teacher/payment) — topbar এ আছে, badge `10+` পর্যন্ত Bengali digit এ দেখায়, 0 হলে hidden।
- **Record store**: `js/notification-store.js` — `{id: NOTIF-YYYYMMDD-0001, userId, type, title, message, targetType, targetId, createdAt, read, delivered, key, section, at}` — per-user, 600 limit, cross-device sync via `KEYS.settings` shared receipts।
- **Feed engine**: `js/notification-rules.js` — 15+ kind (notice, broadcast, exam, homework, birthday, registration, payment-review, etc.) — `notificationFeed()` pure function, `planDeliveries()` দিয়ে first-run এ পুরোনো নোটিশ replay হয় না।
- **Center modal**: `js/notice-center.js` — `buildModal()` দিয়ে `#apcNoticeModal` বা `#noticeModal` (student) — filter `অপঠিত`/`সব`, `সব পড়া করুন`, card `unread` বর্ডার + dot, click → `openNotificationTarget` → navigate + mark read, Esc + outside click close, `apc-notifications-updated` এ badge repaint।
- **Real-time**: `WATCHED_KEYS` (notices, exams, teaching, students, transactions) → `storage` + `apc-sync-updated` → `scheduleRefresh()` → badge + list live update; FCM push via `firebase-messaging-sw.js` + `push-notifications.js`।
- **Settings**: `js/notification-settings.js` — per-user `enabled/sound/background/inApp` toggles, Settings → Notification Settings UI।

### কী নেই (Gaps vs Facebook spec)
1. **Badge**: 99+ পর্যন্ত নয়, 10+ এ থামে; লাল Facebook blue নয়, `var(--color-danger)` তবু ঠিক আছে — কিন্তু animation/pulse নেই।
2. **Panel**: generic centered modal, Facebook-এর মতো bell-anchored dropdown (desktop) / bottom-sheet (mobile) নয়; header এ `নোটিফিকেশন + সব পঠিত করুন + ফিল্টার` Facebook layout নেই।
3. **Card**: বামে avatar নয় (ছোট 36px icon), preview + relative time (“২ ঘন্টা আগে”) নেই — এখন `toLocaleString('bn-BD')` absolute date।
4. **Type**: 8 requested type এর সব icon/color আছে কিন্তু `fee reminder / বকেয়া`, `class chat`, `system alert` এর আলাদা রঙ/আইকন নেই।
5. **Interaction**: “সব পঠিত” আছে, কিন্তু focus-trap, card hover, unread filter pill এর Facebook UX নেই।
6. **Performance**: 600 record limit আছে, কিন্তু virtual scroll/pagination নেই — 100+ হলে 65vh scroll ঠিক আছে।
7. **Settings link**: panel header এ Settings shortcut নেই।

---

## 2. নতুন UI/UX ডিজাইন (Facebook-style)

### Desktop (≥601px)
```
Topbar bell (🔔) → click → dropdown (360-420px wide, max-height 85vh)
┌─────────────────────────────────────┐
│ নোটিফিকেশন              সব পঠিত করুন │ ← header: flex justify-between, 16px bold + 14px link
│ [ সব 18 ] [ অপঠিত 5 ]               │ ← filter pills (active: blue bg)
│ ──────────────────────────────────  │
│ ○ [🔴] নতুন নোটিশ এসেছে - কাল…      │ ← card: 56px avatar circle (type color) + 3 lines
│   পরীক্ষা · ২ ঘন্টা আগে    ●       │   + time + unread blue bg + left 3px border
│ ● [📝] পরীক্ষা শীঘ্রই …              │
│   ফলাফল · গতকাল            ...      │
│ ... scrollable 60vh                 │
│ ──────────────────────────────────  │
│ [⚙️ সেটিংস দেখুন]                   │ ← footer link
└─────────────────────────────────────┘
         ▲ arrow pointing to bell
Overlay: semi-transparent backdrop (click outside closes)
```

### Mobile (≤600px)
- Bottom sheet: `position:fixed; bottom:0; left:0; right:0; height:85vh; border-radius:16px 16px 0 0;` + drag handle `─`
- Full-screen fallback if height > 85vh → `height:100dvh`
- Backdrop `rgba(0,0,0,0.4)` + slide-up animation `300ms cubic-bezier`

### Card anatomy (per spec)
- **Left**: 40-48px avatar circle — type অনুযায়ী bg + icon: `notice=🔔 blue`, `exam/result=📝 green`, `fee=💰 orange`, `homework=📚 violet`, `registration=👥 teal`, `chat=💬 cyan`, `system=⚠️ amber`, `other=🔔 grey`
- **Main**: title (14px semibold, 2 lines clamp), body preview (13px muted, 1 line clamp), meta row (type chip + “·” + relative time)
- **Right**: unread blue dot (8px), `⋯` menu (optional)
- **Unread state**: `background: var(--color-surface-muted)` → Facebook blue wash `rgba(46,136,255,0.08)`, `border-left:3px solid var(--color-primary)`, dot visible
- **Hover**: `background: var(--color-surface-muted)` lighten, `cursor:pointer`

### Badge
- 1–9: exact Bengali digit (`১`..`৯`)
- 10–99: Bengali two digits (`১২`)
- 99+: `৯৯+`
- 0: hidden
- Pulse animation on new: `scale(1.1) 300ms`

---

## 3. HTML Structure (Facebook Panel)

Generated dynamically by `buildModal()` — no static HTML change needed. New markup:

```html
<div class="modal-backdrop apc-fb-backdrop" id="apcNoticeModal" hidden>
  <section class="modal apc-fb-panel" role="dialog" aria-modal="true" aria-labelledby="apcNoticeTitle">
    <!-- drag handle (mobile only) -->
    <div class="apc-fb-handle" aria-hidden="true"></div>
    
    <!-- Header -->
    <header class="apc-fb-header">
      <h2 id="apcNoticeTitle" class="apc-fb-title">নোটিফিকেশন</h2>
      <div class="apc-fb-header-actions">
        <button type="button" class="apc-fb-mark-all" data-apc-notice-read-all>সব পঠিত করুন</button>
        <button type="button" class="modal-close apc-fb-close" data-apc-notice-close aria-label="বন্ধ করুন">×</button>
      </div>
    </header>

    <!-- Filters -->
    <div class="notice-filters apc-fb-filters" role="tablist">
      <button type="button" class="chip apc-fb-chip active" role="tab" aria-selected="true" data-apc-notice-filter="all">সব</button>
      <button type="button" class="chip apc-fb-chip" role="tab" aria-selected="false" data-apc-notice-filter="unread">অপঠিত<span data-apc-notice-unread-chip></span></button>
    </div>

    <!-- Pending registrations (admin/manager) -->
    <div data-apc-pending-host class="apc-pending-host"></div>

    <!-- List -->
    <div class="apc-fb-list" data-apc-notice-list role="feed" aria-label="নোটিফিকেশন তালিকা"></div>

    <!-- Status / push row -->
    <p class="notice-read-status apc-fb-status" data-apc-notice-status role="status"></p>
    <p class="form-note" data-apc-notice-push role="status"></p>

    <!-- Footer -->
    <footer class="apc-fb-footer">
      <button type="button" class="apc-fb-settings-link" data-apc-notice-settings>⚙️ নোটিফিকেশন সেটিংস</button>
    </footer>
  </section>
</div>
```

Reuse existing `[data-apc-notice-list]`, `[data-apc-notice-filter]` IDs for backward compat with tests (they query these).

---

## 4. CSS Updates (facebook panel + cards)

Add to `css/notifications.css` — extends existing, không ভাঙে:

- **Backdrop**: `.apc-fb-backdrop` — desktop transparent, mobile dim; `backdrop-filter: blur(2px)` optional
- **Panel**: `.apc-fb-panel` — desktop anchored, mobile sheet (media queries)
- **Header**: `.apc-fb-header` — sticky top, border-bottom, 16px padding
- **Chips**: `.apc-fb-chip` — pill, active blue
- **List**: `.apc-fb-list` — `max-height: min(65vh, 560px)` → `max-height: 60vh` desktop, `flex:1` mobile, `overflow-y:auto`, `scrollbar-width: thin`
- **Cards**: `.fb-notif-card` — Facebook layout (avatar + content + dot) — keep `.notice-detail` for compat but add new classes
- **Empty**: `.notice-empty` keep but update art
- **Badge**: `.notification-dot.is-count` → pulse keyframes

Performance: list capped at 50 visible, “আরও দেখুন” pagination if >50.

---

## 5. JavaScript Logic

### File: `js/notice-center.js` changes
- **`unreadBadgeText(count)`**: `>99 ? '৯৯+' : >9 ? bn(count) : bn(count)` — 99+ support
- **`timeAgoBn(at)`**: new helper — `ms → “এইমাত্র” / “৩ মিনিট আগে” / “২ ঘন্টা আগে” / “গতকাল” / “৩ দিন আগে” / date`
- **`buildModal()`**: emit Facebook HTML above
- **`positionPanel()`**: desktop — `getBoundingClientRect()` of `#notificationButton` → set `top: rect.bottom+8`, `right: window.innerWidth - rect.right`, with arrow; mobile — bottom sheet fixed
- **`paintBadge(unread)`**: add `is-count` + `data-count` attr, pulse animation trigger on increase
- **`paintCard(item, unread)`**: Facebook card — avatar with type bg, title, preview (80 chars), meta `section · timeAgo`, unread dot, left border via class, `data-apc-notice-open`
- **`wire interactions`**: keep existing delegated click for bell, filter, read-all, openItem, expand, clear, close; add outside click on backdrop, Esc, focus trap (Tab cycle within panel), `aria-expanded` on bell
- **Real-time**: already via `apc-notifications-updated` → `repaint()` → badge + list; add badge pulse when `unread` increases
- **Settings link**: `data-apc-notice-settings` → `document.querySelector('[data-view=\"settings\"], #notificationSettings')?.scrollIntoView()`

### File: `js/notification-store.js` / `js/notification-rules.js`
- No structural change — data model already supports 8 types via `SECTION_LABEL`, `SECTION_TARGET`. Add explicit `payment/due`, `chat`, `system` labels if missing.
- Ensure `recordFromFeedItem` carries `createdBy` actor for “কে করেছে” text.

---

## 6. Data Model Proposal

```js
{
  id: 'NOTIF-20261028-0001',        // running per day
  key: 'notice:N-123:2026-10-28',  // stable engine identity
  userId: 'student:AP-1024',       // viewerKeyOf(viewer)
  type: 'notice',                  // enum: notice | broadcast | exam | exam-soon | exam-live | result | homework | birthday | registration | approved | rejected | payment | payment-review | payment-rejected | exam-review | chat | system | other
  title: 'নতুন নোটিশ এসেছে - কাল ক্লাস বন্ধ',
  message: 'আগামীকাল ... বিস্তারিত', // body
  preview: 'আগামীকাল ক্লাস বন্ধ থাকবে…', // 80 char
  actor: 'অফিস',                   // who did it (createdBy)
  targetType: 'notice-board',      // SECTION_TARGET[type]
  targetId: 'N-123',
  relatedId: '',
  createdAt: '2026-10-28T10:00:00.000Z',
  createdBy: 'office',
  read: false,
  readAt: '',
  delivered: false,
  deliveredAt: '',
  at: 1729992000000,                // epoch for sort + timeAgo
  section: 'নোটিশ'                 // SECTION_LABEL[type] for chip
}
```

Storage: `KEYS.notifications → {version: 1, records: [...]}` (600 max, unread never pruned) + `KEYS.settings → shared receipts` for cross-device.

---

## 7. Implementation Steps

1. **Badge 99+** — edit `unreadBadgeText()` in `notice-center.js` (5 lines)
2. **Relative time** — add `timeAgoBn()` helper (30 lines)
3. **Types** — extend `KIND_ICON` + `SECTION_LABEL` for fee/chat/system (10 lines)
4. **HTML** — rewrite `buildModal()` innerHTML to Facebook panel (40 lines)
5. **CSS** — add Facebook panel/cards/badge/pulse/bottom-sheet styles to `notifications.css` (200 lines, media queries)
6. **JS interactions** — `positionPanel()`, outside click, Esc, focus trap, badge pulse, card render (150 lines)
7. **Testing** — `node --test tests/notification-*.test.mjs` + manual bell click → dropdown on desktop (360px) + sheet on mobile (85vh) + badge 0/1/99+ + mark read + mark all + filter + Esc + outside click
8. **Docs** — this plan + `NOTIFICATION-FACEBOOK-UPGRADE.md` summary

All changes backward compatible: existing `#apcNoticeModal`, `[data-apc-notice-list]`, `.notification-dot` selectors preserved for tests.

