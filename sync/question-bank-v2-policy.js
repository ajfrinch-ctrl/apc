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

/* Startup retry decision for the Question Bank v2 controller. A signed-out
 * device or a signed-in device whose token claims do not authorize Question
 * Bank paths is a persistent "no work" state — the session events restart the
 * controller, so a blind retry loop would only hammer Auth. Every other
 * failure is transient and backs off through the protected retry table. */
const NO_RETRY_REASONS = new Set(['authentication-required', 'role-not-authorized']);
export function questionBankV2RetryDecision(result) {
  if (result?.ok) return { retry: false, started: true, reason: '' };
  const reason = String(result?.reason || 'unknown');
  if (NO_RETRY_REASONS.has(reason)) return { retry: false, started: false, reason };
  return { retry: true, started: false, reason };
}
