#!/usr/bin/env node
/* Builds database.rules.v2.draft.json — the PROPOSED per-user/role Realtime
   Database rules described in docs/RTDB-PER-USER-RULES-PLAN.md.

   This is a DRAFT. firebase.json still deploys database.rules.json (the interim
   anonymous bridge). The current client writes activePlusSync/v1 and does not
   sign in with role-bearing Firebase Auth tokens. Deploying this draft before
   the client, Functions and data migration are ready will stop cloud sync and
   lock devices out. Never deploy it merely to troubleshoot a sync failure.

   RTDB rule expressions have no functions, so role predicates are generated
   here and inlined. Run: node tools/rtdb-rules/build-v2-draft.mjs
   tests/rtdb-v2-draft-rules.test.mjs guards the draft and its deploy boundary. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const V2_ROOT = 'activePlusV2';

// ---- identity predicates --------------------------------------------------
// Claims must be set only by Cloud Functions (Admin SDK): role, status,
// mustChangePassword, studentId and teacherId. Anonymous identities are
// rejected explicitly, even if a forged-looking role claim is present.
const signedIn = "auth != null && auth.token.firebase.sign_in_provider !== 'anonymous' && auth.token.mustChangePassword !== true";
const staff = role => `(${signedIn} && auth.token.status === 'active' && auth.token.role === '${role}')`;
const any = (...parts) => parts.length === 1 ? parts[0] : `(${parts.join(' || ')})`;

const ADMIN = staff('admin');
const MANAGER = staff('manager');
const TEACHER = `(${signedIn} && auth.token.status === 'active' && auth.token.role === 'teacher' && auth.token.teacherId != null)`;
const PAYMENT = staff('payment');
const STUDENT = `(${signedIn} && auth.token.status === 'approved' && auth.token.role === 'student' && auth.token.studentId != null)`;
const ANY_STAFF = `(${signedIn} && auth.token.status === 'active' && (auth.token.role === 'admin' || auth.token.role === 'manager' || auth.token.role === 'payment' || (auth.token.role === 'teacher' && auth.token.teacherId != null)))`;
const ANY_ACTIVE = any(ANY_STAFF, STUDENT);
const ownStudent = variable => `(${STUDENT} && ${variable} === auth.token.studentId)`;
const ownTeacher = variable => `(${TEACHER} && ${variable} === auth.token.teacherId)`;
const ownUid = variable => `(${TEACHER} && auth.uid === ${variable})`;

// ---- shared record checks -------------------------------------------------
const idMatches = variable => `newData.child('id').val() === ${variable}`;
const deleting = '!newData.exists()';
const creating = '!data.exists()';
const examStatusEditable = "(newData.child('status').val() === 'draft' || newData.child('status').val() === 'pending')";
const noProgress = '!newData.hasChild(\'progress\')';
const academicRecord = "((newData.child('_syncKind').val() === 'metadata' && $recordId === '__metadata' && newData.child('id').val() === '__metadata' && newData.child('version').val() === 2) || ((newData.child('_syncKind').val() === 'class' && $recordId === 'class-' + newData.child('record').child('id').val()) || (newData.child('_syncKind').val() === 'subject' && $recordId === 'subject-' + newData.child('record').child('id').val()) || (newData.child('_syncKind').val() === 'mapping' && $recordId === 'mapping-' + newData.child('record').child('id').val()) || (newData.child('_syncKind').val() === 'chapter' && $recordId === 'chapter-' + newData.child('record').child('id').val())) && newData.child('record').child('id').isString())";
const progressActivityType = `root.child('${V2_ROOT}/teachingByTeacher').child($teacherId).child($activityId).child('type').val()`;
const teacherProgressValue = `((${progressActivityType} === 'homework' && (newData.child('value').val() === 'pending' || newData.child('value').val() === 'done' || newData.child('value').val() === 'reviewed')) || (${progressActivityType} === 'routine' && (newData.child('value').val() === 'present' || newData.child('value').val() === 'absent' || newData.child('value').val() === 'late'))) `;

/** Collection readable at its root, with record-level writes. */
function collection({ read, write, validate }) {
  const record = { '.write': write };
  if (validate) record['.validate'] = validate;
  return { '.read': read, $recordId: record };
}

export function buildRules() {
  return {
    rules: {
      // Everything not explicitly listed—including the database root—is denied.
      '.read': false,
      '.write': false,

      // Credential-bearing legacy nodes are never reopened after cutover.
      activePlusSync: { '.read': false, '.write': false },

      [V2_ROOT]: {
        settings: { '.read': ANY_ACTIVE, '.write': ADMIN },

        // Canonical notices can contain class/group targets, so students never
        // read this collection. Teachers save drafts in their private author
        // subtree and publish through a callable that verifies assignment scope.
        notices: collection({
          read: ANY_STAFF,
          write: any(ADMIN, MANAGER),
          validate: `${idMatches('$recordId')} && newData.child('published').val() === true`
        }),
        noticeDraftsByAuthor: {
          $authorUid: {
            '.read': any(ADMIN, MANAGER, ownUid('$authorUid')),
            $recordId: {
              '.write': any(ADMIN, MANAGER, ownUid('$authorUid')),
              '.validate': `${idMatches('$recordId')} && newData.child('authorUid').val() === $authorUid && newData.child('classId').isString() && newData.child('group').isString() && newData.child('status').val() === 'draft' && newData.child('published').val() === false`
            }
          }
        },
        studentNotices: {
          $studentId: {
            '.read': ownStudent('$studentId'),
            $recordId: {
              '.write': false,
              '.validate': `${idMatches('$recordId')} && newData.child('published').val() === true`
            }
          }
        },
        // Manager authors the institution routine; Teachers may update theirs.
        routine: collection({ read: ANY_ACTIVE, write: any(ADMIN, MANAGER, TEACHER) }),

        // Class/subject setup is not credential data and is needed by all roles.
        // It is an ID-keyed map with transport wrappers from sync-collections.js.
        academics: collection({
          read: ANY_ACTIVE,
          write: ADMIN,
          validate: academicRecord
        }),

        teacherAssignments: collection({
          read: any(ADMIN, MANAGER, TEACHER),
          write: any(ADMIN, MANAGER),
          validate: idMatches('$recordId')
        }),

        // Teacher drafts are private; moving one into the published canonical
        // tree is a callable operation that verifies the live assignment.
        teachingDraftsByTeacher: {
          $teacherId: {
            '.read': any(ADMIN, MANAGER, ownTeacher('$teacherId')),
            $activityId: {
              '.write': any(ADMIN, MANAGER, ownTeacher('$teacherId')),
              '.validate': `${idMatches('$activityId')} && newData.child('teacherId').val() === $teacherId && newData.child('status').val() === 'draft' && ${noProgress}`
            }
          }
        },
        // Canonical published activities contain no shared progress. Admin can
        // publish directly; Teacher publication/update is server-mediated.
        teachingByTeacher: {
          $teacherId: {
            '.read': any(ADMIN, MANAGER, ownTeacher('$teacherId')),
            $activityId: {
              '.write': ADMIN,
              '.validate': `${idMatches('$activityId')} && newData.child('teacherId').val() === $teacherId && newData.child('status').val() === 'published' && ${noProgress}`
            }
          }
        },
        // A Cloud Function fans out published activity metadata (without the
        // shared progress map) to each participant. Students read only their
        // own copy; clients cannot forge or rewrite fan-out records.
        studentTeaching: {
          $studentId: {
            '.read': ownStudent('$studentId'),
            $activityId: {
              '.write': false,
              '.validate': `${idMatches('$activityId')} && newData.child('status').val() === 'published' && ${noProgress}`
            }
          }
        },
        // A student can report a published homework complete, never set marks,
        // attendance or a Teacher-reviewed value. A Function mirrors it into
        // the staff-only by-teacher progress index.
        studentTeachingProgress: {
          $studentId: {
            '.read': ownStudent('$studentId'),
            $activityId: {
              '.write': `(${ownStudent('$studentId')} && newData.exists() && root.child('${V2_ROOT}/studentTeaching').child($studentId).child($activityId).child('type').val() === 'homework' && root.child('${V2_ROOT}/studentTeaching').child($studentId).child($activityId).child('status').val() === 'published')`,
              '.validate': `newData.numChildren() === 4 && newData.hasChildren(['studentId', 'activityId', 'value', 'updatedAt']) && newData.child('studentId').val() === $studentId && newData.child('activityId').val() === $activityId && newData.child('value').val() === 'done' && newData.child('updatedAt').isNumber() && newData.child('updatedAt').val() <= now`
            }
          }
        },
        // Staff progress is separated by Teacher. Only the owning Teacher,
        // Manager or Admin can read it; writes are server-mediated after the
        // activity/roster scope has been checked.
        teachingProgressByTeacher: {
          $teacherId: {
            '.read': any(ADMIN, MANAGER, ownTeacher('$teacherId')),
            $studentId: {
              $activityId: {
                '.write': false,
                '.validate': `newData.child('teacherId').val() === $teacherId && newData.child('studentId').val() === $studentId && newData.child('activityId').val() === $activityId && ${teacherProgressValue} && newData.child('updatedAt').isNumber() && newData.child('updatedAt').val() <= now`
              }
            }
          }
        },

        // Course drafts stay author-scoped and unpublished. Teacher publication
        // is a callable so class/group assignments are checked server-side.
        courseContentDraftsByAuthor: {
          $authorUid: {
            '.read': any(ADMIN, MANAGER, ownUid('$authorUid')),
            $recordId: {
              '.write': any(ADMIN, MANAGER, ownUid('$authorUid')),
              '.validate': `${idMatches('$recordId')} && newData.child('authorUid').val() === $authorUid && newData.child('classId').isString() && newData.child('subjectId').isString() && newData.child('published').val() === false && newData.child('active').isBoolean()`
            }
          }
        },
        // Canonical published/archive state is changed only by trusted Admin,
        // Manager, or Functions; a Function then creates scoped student copies.
        courseContentByAuthor: {
          $authorUid: {
            '.read': any(ADMIN, MANAGER, ownUid('$authorUid')),
            $recordId: {
              '.write': any(ADMIN, MANAGER),
              '.validate': `${idMatches('$recordId')} && newData.child('authorUid').val() === $authorUid && newData.child('classId').isString() && newData.child('subjectId').isString() && newData.child('published').val() === true && newData.child('active').isBoolean()`
            }
          }
        },
        studentCourseContent: {
          $studentId: {
            '.read': ownStudent('$studentId'),
            $recordId: {
              '.write': false,
              '.validate': `${idMatches('$recordId')} && newData.child('published').val() === true && newData.child('active').val() === true`
            }
          }
        },

        // Roster (PII). Students can read only their own row.
        students: {
          '.read': any(ADMIN, MANAGER, PAYMENT, TEACHER),
          $studentId: {
            '.read': ownStudent('$studentId'),
            '.write': any(ADMIN, MANAGER),
            '.validate': idMatches('$studentId')
          }
        },

        // Money. Payment may create; only Admin may correct or delete.
        transactions: collection({
          read: any(ADMIN, PAYMENT),
          write: any(ADMIN, `(${PAYMENT} && ${creating} && newData.exists())`),
          validate: `${idMatches('$recordId')} && newData.child('studentId').isString() && newData.child('studentId').val().length > 0`
        }),
        studentLedger: {
          '.read': any(ADMIN, PAYMENT),
          $studentId: { '.read': ownStudent('$studentId') }
        },

        // Full exam papers and answer keys are staff-only. Manager reviews via
        // callable; direct client writes cannot publish/reject a paper.
        exams: {
          '.read': any(ADMIN, MANAGER, TEACHER),
          $examId: {
            '.write': any(
              `(${TEACHER} && (${creating} || (data.child('teacherId').val() === auth.token.teacherId && data.child('status').val() !== 'published')) && newData.child('teacherId').val() === auth.token.teacherId && ${examStatusEditable})`,
              `(${ADMIN} && (${deleting} || ((${creating} || data.child('status').val() !== 'published') && ${examStatusEditable})))`
            ),
            '.validate': `${idMatches('$examId')} && newData.child('teacherId').isString()`
          }
        },
        studentExams: {
          '.read': any(ADMIN, MANAGER, TEACHER),
          $studentId: { '.read': ownStudent('$studentId') }
        },
        attempts: {
          '.read': any(ADMIN, MANAGER, TEACHER),
          $studentId: {
            '.read': ownStudent('$studentId'),
            $attemptId: {
              '.write': any(
                `(${ownStudent('$studentId')} && newData.exists() && (${creating} || data.child('status').val() !== 'submitted') && root.child('${V2_ROOT}/studentExams').child($studentId).child(newData.child('examId').val()).exists())`,
                `(${ADMIN} && ${deleting})`
              ),
              '.validate': `${idMatches('$attemptId')} && newData.child('studentId').val() === $studentId && newData.child('examId').isString() && (newData.child('status').val() === 'active' || newData.child('status').val() === 'queued' || newData.child('status').val() === 'submitted') && newData.child('startedAt').isNumber() && newData.child('startedAt').val() <= now`
            }
          }
        },
        results: {
          '.read': any(ADMIN, MANAGER, TEACHER),
          $studentId: { '.read': ownStudent('$studentId') }
        },

        // Owner-only client writes; Cloud Functions alone read tokens.
        pushTokens: {
          $uid: {
            $deviceId: {
              '.write': `${ANY_ACTIVE} && auth.uid === $uid`,
              '.validate': "newData.child('token').isString() && newData.child('token').val().length > 20 && newData.child('token').val().length <= 4096 && newData.child('role').val() === auth.token.role && ((auth.token.role === 'student' && newData.child('studentId').val() === auth.token.studentId) || (auth.token.role !== 'student' && (newData.child('studentId').val() === null || newData.child('studentId').val() === '')))"
            }
          }
        }
      }
    }
  };
}

export const DRAFT_PATH = new URL('../../database.rules.v2.draft.json', import.meta.url);
export const render = () => JSON.stringify(buildRules(), null, 2) + '\n';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(DRAFT_PATH, render());
  console.log('wrote', fileURLToPath(DRAFT_PATH));
}
