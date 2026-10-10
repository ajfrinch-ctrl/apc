/* The signed-in surface of the student app, fetched as ONE lazy chunk.

   main.js is the composition root of the student panel. Everything a visitor
   needs before signing in — the auth screen, the session gate, the shell —
   lives in ~25 small modules; everything a signed-in student needs (exams,
   practice, the Learning Hub, reports, notices, fees, settings, the daily
   quote) lives behind this chunk, ~47 modules and roughly 700 KB of source.

   Importing those 47 statically made them part of the parser-blocking boot:
   the login screen could not paint until the report builders and the exam
   engine had been downloaded and evaluated. They are now one dynamic-import
   graph that main.js starts as soon as the auth screen is on screen, so the
   chunk downloads in parallel with the visitor reading/typing the login form
   and is always resolved long before a session exists. The service worker
   precaches every member, so an installed app resolves the chunk from
   CacheStorage with no network at all.

   Nothing here initialises: main.js keeps every init call and its wiring, and
   only takes the module namespaces from this promise. */
export function loadStudentFeatures() {
  return Promise.all([
    import('./student-notice-board.js'),
    import('./student-exams.js'),
    import('./student-practice.js'),
    import('./student-teaching.js'),
    import('./student-study-sections.js'),
    import('./student-more.js'),
    import('./student-dashboard.js'),
    import('./course-hub.js'),
    import('./daily-quote.js'),
    import('./routine.js'),
    import('./student-hubs.js'),
    import('./profile.js'),
    import('./settings-hub.js'),
    import('./notification-settings.js'),
    import('./reports.js')
  ]).then(([
    noticeBoard, exams, practice, teaching, studySections, fee, dashboard,
    courseHub, dailyQuote, routine, hubs, profile, settingsHub,
    notificationSettings, reports
  ]) => ({
    noticeBoard, exams, practice, teaching, studySections, fee, dashboard,
    courseHub, dailyQuote, routine, hubs, profile, settingsHub,
    notificationSettings, reports
  }));
}
