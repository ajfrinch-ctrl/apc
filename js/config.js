/* Shared application configuration. Document keys come from the database catalog. */
import { KEYS } from './database.js';
export const APP_TAGLINE = 'শিখতে থাকো, এগিয়ে যাও';

export const STORAGE_KEYS = Object.freeze({
  student: KEYS.studentProfile,
  account: KEYS.account,
  session: 'active-plus-session-v1',
  sessionExpiry: 'active-plus-session-expiry-v1',
  trustedDevice: 'active-plus-trusted-v1',
  skipSecurity: 'active-plus-skip-security-v1',
  installDismissed: 'active-plus-install-dismissed',
  idSequence: 'active-plus-id-sequence',
  usernames: KEYS.usernames,
  weather: 'active-plus-weather-v1',
  appConfig: KEYS.settings
});

/* Maintenance mode is one strict boolean flag plus one admin-authored message.
   The flag is read by the student app (js/main.js) and written by the admin
   panel (js/admin.js); both go through this helper so the two ends can never
   drift.

   Why the flag is not a plain truthiness test: the config document travels
   through cloud sync, backup merge and hand edits, so `maintenanceMode` can
   arrive as the string "false" or "0". A loose `if (cfg.maintenanceMode)`
   then shows the maintenance banner to every student — and nothing in the app
   could switch it off again. Only a literal `true` (or the string "true" a
   JSON form can produce) puts the app under maintenance. */
export function maintenanceState(cfg) {
  const raw = cfg?.maintenanceMode;
  const on = raw === true || (typeof raw === 'string' && raw.trim().toLowerCase() === 'true');
  const message = String(cfg?.maintenanceMessage ?? '').trim().slice(0, 500);
  return Object.freeze({ on, message: message || DEFAULT_APP_SETTINGS.maintenanceMessage });
}

export const ADMIN_ID = '01819486966';

export const DEFAULT_APP_SETTINGS = Object.freeze({
  maintenanceMode: false,
  maintenanceMessage: 'সম্মানিত শিক্ষার্থী, অ্যাপটিতে বর্তমানে সিস্টেম আপডেট চলছে। সাময়িক অসুবিধার জন্য আন্তরিকভাবে দুঃখিত।',
  allowRegistration: true,
  allowTeacherRegistration: true,
  skipSecurityCheck: false,
  tagline: 'শিখতে থাকো, এগিয়ে যাও',
  helplineMobile: '01819486966',
  whatsappNumber: '01819486966',
  officialEmail: 'activeplus.coaching@gmail.com',
  campusAddress: 'দিনাজপুর সদর, দিনাজপুর',
  /* Where the campus is on the map. The login sky asks the weather service for
     this point (rain, temperature, sunrise/sunset), so it must travel with the
     address — Admin → Settings edits both. Dinajpur town is the default that
     matches campusAddress above; no other module may name a location. */
  campusLat: 25.6217,
  campusLon: 88.6354,
  broadcastAlert: false,
  broadcastMessage: '',
  broadcastTone: 'green',
  /* Master switch for the notification centre and for push (Admin → Settings).
     Off = no system notifications anywhere; the in-app notice list still works. */
  pushNotifications: true,
  modules: {
    routine: true,
    courses: true,
    results: true,
    installPrompt: true
  },
  themeMode: 'auto'
});

export const enabledClasses = Object.freeze([
  'অষ্টম শ্রেণি', 'নবম শ্রেণি', 'দশম শ্রেণি', 'একাদশ শ্রেণি', 'দ্বাদশ শ্রেণি',
  'ডিগ্রি ১ম বর্ষ', 'ডিগ্রি ২য় বর্ষ', 'ডিগ্রি ৩য় বর্ষ',
  'অনার্স ১ম বর্ষ', 'অনার্স ২য় বর্ষ', 'অনার্স ৩য় বর্ষ', 'অনার্স ৪র্থ বর্ষ'
]);

export const defaultStudent = Object.freeze({
  name: '',
  nameBn: '',
  nameEn: '',
  className: '',
  group: '',
  id: '',
  username: '',
  studentMobile: '',
  guardianMobile: '',
  fatherName: '', motherName: '', guardianName: '',
  birthDate: '', gender: '', address: '',
  major: '', institution: '', roll: '', registrationNo: ''
});

export const subjectInitials = Object.freeze({
  'উচ্চতর গণিত': 'গ', 'পদার্থবিজ্ঞান': 'প', 'বাংলা': 'ব',
  'রসায়ন': 'র', 'ইংরেজি': 'ই', 'মডেল টেস্ট': 'ম'
});

export const schedule = Object.freeze({
  sat: { date: '', classes: [] },
  sun: { date: '', classes: [] },
  mon: { date: '', classes: [] },
  tue: { date: '', classes: [] },
  wed: { date: '', classes: [] },
  thu: { date: '', classes: [] }
});
