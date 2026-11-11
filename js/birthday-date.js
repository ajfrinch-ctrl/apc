/* Compatibility entry for existing call sites; shared date logic lives in the
   lightweight birthday helper so the student boot graph does not load notices. */
export { birthMonthDay, isStudentBirthday } from './birthday.js';
