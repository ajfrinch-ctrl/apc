/* Device-local student identity gate for repositories. This is useful for
   preventing accidental cross-student reads/actions in the app; it is not a
   substitute for server authorization (the current Firebase bridge is shared). */
import { hasSession, loadAccount } from './storage.js';

export const ACCESS_DENIED = 'ACCESS_DENIED';

function denied(message = 'শিক্ষার্থী অ্যাকাউন্ট যাচাই করা যায়নি। আবার লগইন করুন।') {
  return Object.assign(new Error(message), { code: ACCESS_DENIED });
}

/** Resolve the active student from the device-bound session, never from a
 * caller-supplied profile object alone. */
export async function authenticatedStudent(expectedId = '') {
  if (!(await hasSession())) throw denied();
  const account = loadAccount();
  const student = account?.student;
  const id = String(student?.id || account?.studentId || '');
  if (account?.status !== 'active' || !id || (expectedId && id !== String(expectedId))) throw denied();
  return {
    ...student,
    id,
    studentMobile: account.registrationMobile || account.mobile || student.studentMobile || ''
  };
}

