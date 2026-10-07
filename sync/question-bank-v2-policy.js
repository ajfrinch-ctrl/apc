/* Client-side selector for the Question Bank v2 paths. This is defense in
 * depth only: database.rules.v2.draft.json remains the authorization boundary. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const safeId = value => typeof value === 'string' && SAFE_ID.test(value);

export function questionBankSyncPlan(claims = {}, signInProvider = '') {
  if (!claims || typeof claims !== 'object' || !claims.role || signInProvider === 'anonymous' || claims.mustChangePassword === true) {
    return { ok: false, reason: 'authenticated-claims-required' };
  }
  if (['admin', 'manager'].includes(claims.role) && claims.status === 'active') {
    return {
      ok: true, role: claims.role, mode: 'canonical', canWrite: true,
      readPath: 'activePlusV2/questionBank', writePath: 'activePlusV2/questionBank'
    };
  }
  if (claims.role === 'teacher' && claims.status === 'active' && safeId(claims.teacherId)) {
    return {
      ok: true, role: 'teacher', mode: 'teacher', canWrite: true,
      teacherId: claims.teacherId,
      readPaths: [
        `activePlusV2/teacherQuestionBank/${claims.teacherId}`,
        `activePlusV2/questionBankDraftsByTeacher/${claims.teacherId}`,
        'activePlusV2/teacherAssignments'
      ],
      draftPath: `activePlusV2/questionBankDraftsByTeacher/${claims.teacherId}`
    };
  }
  if (claims.role === 'student' && claims.status === 'approved' && safeId(claims.studentId)) {
    return {
      ok: true, role: 'student', mode: 'student', canWrite: false,
      studentId: claims.studentId,
      readPath: `activePlusV2/studentQuestionBank/${claims.studentId}`
    };
  }
  return { ok: false, reason: 'role-not-authorized' };
}
