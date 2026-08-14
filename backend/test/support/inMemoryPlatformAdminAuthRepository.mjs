import { randomUUID } from 'node:crypto';

// Deterministic in-memory PlatformAdminAuthRepository for unit tests only.
// Never used as a production substitute for MySqlPlatformAdminAuthRepository.
// Mirrors the DB-enforced invariants that matter for these tests:
//   - unique email_hash (ER_DUP_ENTRY-shaped throw)
//   - at most one ACTIVE role assignment per (admin, role) (ER_DUP_ENTRY-shaped throw)
//   - every audit event insert is recorded, in call order, for test inspection
export function createInMemoryPlatformAdminAuthRepository() {
  const accountsById = new Map();
  const accountIdByEmailHashHex = new Map();
  const roleAssignments = []; // { assignmentId, adminId, role, grantedAt, revokedAt, grantedByAdminId }
  const mfaStateByAdminId = new Map();
  const sessionsByTokenHash = new Map();
  const loginAttempts = []; // { attemptId, emailHash, outcome, occurredAt }
  const stepUps = new Map(); // stepUpId -> record
  const auditEvents = [];

  function hex(buf) {
    return buf.toString('hex');
  }

  function dupError() {
    const error = new Error('duplicate entry');
    error.code = 'ER_DUP_ENTRY';
    error.errno = 1062;
    return error;
  }

  function activeRolesFor(adminId) {
    return roleAssignments.filter((r) => r.adminId === adminId && !r.revokedAt).map((r) => r.role);
  }

  function recordAudit(event) {
    auditEvents.push({ ...event });
  }

  return {
    // Exposed for test assertions only, not part of the production interface.
    _auditEvents: auditEvents,
    _loginAttempts: loginAttempts,

    async createAccount(input) {
      if (accountIdByEmailHashHex.has(hex(input.emailHash))) throw dupError();
      const account = {
        adminId: input.adminId,
        emailHash: input.emailHash,
        displayName: input.displayName,
        passwordCredential: input.passwordCredential,
        status: 'ACTIVE',
        createdAt: input.createdAt,
        disabledAt: null,
      };
      accountsById.set(input.adminId, account);
      accountIdByEmailHashHex.set(hex(input.emailHash), input.adminId);
      roleAssignments.push({
        assignmentId: input.assignmentId,
        adminId: input.adminId,
        role: input.role,
        grantedAt: input.grantedAt,
        revokedAt: null,
        grantedByAdminId: input.grantedByAdminId,
      });
      mfaStateByAdminId.set(input.adminId, { adminId: input.adminId, ...input.initialMfa });
      for (const event of input.auditEvents) recordAudit(event);
      return { ...account };
    },

    async findAccountByEmailHash(emailHash) {
      const adminId = accountIdByEmailHashHex.get(hex(emailHash));
      if (!adminId) return null;
      const account = accountsById.get(adminId);
      return account ? { ...account } : null;
    },

    async findAccountById(adminId) {
      const account = accountsById.get(adminId);
      return account ? { ...account } : null;
    },

    async findActiveRoles(adminId) {
      return activeRolesFor(adminId);
    },

    async findActiveRoleAssignments(adminId) {
      return roleAssignments.filter((r) => r.adminId === adminId && !r.revokedAt).map((r) => ({ ...r }));
    },

    async assignRole(input) {
      const alreadyActive = roleAssignments.some((r) => r.adminId === input.adminId && r.role === input.role && !r.revokedAt);
      if (alreadyActive) throw dupError();
      roleAssignments.push({
        assignmentId: input.assignmentId,
        adminId: input.adminId,
        role: input.role,
        grantedAt: input.grantedAt,
        revokedAt: null,
        grantedByAdminId: input.grantedByAdminId,
      });
      recordAudit(input.auditEvent);
    },

    async revokeRole(input) {
      for (const r of roleAssignments) {
        if (r.adminId === input.adminId && r.role === input.role && !r.revokedAt) r.revokedAt = input.revokedAt;
      }
      recordAudit(input.auditEvent);
      const revokedSessionIds = [];
      for (const session of sessionsByTokenHash.values()) {
        if (session.adminId === input.adminId && !session.revokedAt) {
          session.revokedAt = input.revokedAt;
          revokedSessionIds.push(session.sessionId);
        }
      }
      return { revokedSessionIds };
    },

    async disableAccount(input) {
      const account = accountsById.get(input.adminId);
      if (account) {
        account.status = 'DISABLED';
        account.disabledAt = input.disabledAt;
      }
      recordAudit(input.auditEvent);
      const revokedSessionIds = [];
      for (const session of sessionsByTokenHash.values()) {
        if (session.adminId === input.adminId && !session.revokedAt) {
          session.revokedAt = input.disabledAt;
          revokedSessionIds.push(session.sessionId);
        }
      }
      return { revokedSessionIds };
    },

    async reactivateAccount(input) {
      const account = accountsById.get(input.adminId);
      if (account) {
        account.status = 'ACTIVE';
        account.disabledAt = null;
      }
      recordAudit(input.auditEvent);
    },

    async getMfaState(adminId) {
      const state = mfaStateByAdminId.get(adminId);
      return state ? { ...state } : null;
    },

    async createSession(record) {
      sessionsByTokenHash.set(record.tokenHash, { ...record });
    },

    async findSessionForValidation(tokenHash) {
      const session = sessionsByTokenHash.get(tokenHash);
      if (!session) return null;
      const account = accountsById.get(session.adminId);
      return { session: { ...session }, accountStatus: account ? account.status : 'DISABLED', activeRoles: activeRolesFor(session.adminId) };
    },

    async revokeSessionByTokenHash(tokenHash, revokedAt, auditEvent) {
      const session = sessionsByTokenHash.get(tokenHash);
      if (!session || session.revokedAt) return false;
      session.revokedAt = revokedAt;
      if (auditEvent) recordAudit(auditEvent);
      return true;
    },

    async revokeAllActiveSessions(adminId, revokedAt, buildAuditEvent) {
      const revokedSessionIds = [];
      for (const session of sessionsByTokenHash.values()) {
        if (session.adminId === adminId && !session.revokedAt) {
          session.revokedAt = revokedAt;
          revokedSessionIds.push(session.sessionId);
        }
      }
      for (const sessionId of revokedSessionIds) recordAudit(buildAuditEvent(sessionId));
      return { revokedSessionIds };
    },

    async recentFailedLoginTimestampsDescending(emailHash, limit) {
      return loginAttempts
        .filter((a) => hex(a.emailHash) === hex(emailHash) && (a.outcome === 'FAILED_CREDENTIALS' || a.outcome === 'FAILED_MFA'))
        .map((a) => a.occurredAt)
        .sort((a, b) => b.getTime() - a.getTime())
        .slice(0, limit);
    },

    async recordLoginAttempt(input) {
      loginAttempts.push({ attemptId: input.attemptId, emailHash: input.emailHash, outcome: input.outcome, occurredAt: input.occurredAt });
      recordAudit(input.auditEvent);
      if (input.session) sessionsByTokenHash.set(input.session.tokenHash, { ...input.session });
    },

    async createStepUp(input) {
      const record = {
        stepUpId: input.stepUpId,
        adminId: input.adminId,
        sessionId: input.sessionId,
        scope: input.scope,
        assertedAt: input.assertedAt,
        expiresAt: input.expiresAt,
        consumedAt: null,
      };
      stepUps.set(input.stepUpId, record);
      recordAudit(input.auditEvent);
      return { ...record };
    },

    async recordDeniedStepUp(auditEvent) {
      recordAudit(auditEvent);
    },

    async consumeStepUp(input) {
      const record = stepUps.get(input.stepUpId);
      if (!record) return false;
      if (record.adminId !== input.adminId || record.sessionId !== input.sessionId || record.scope !== input.scope) return false;
      if (record.consumedAt) return false;
      if (record.expiresAt.getTime() <= input.consumedAt.getTime()) return false;
      record.consumedAt = input.consumedAt;
      return true;
    },

    // TOTP-REPLAY-1: mirrors MySqlPlatformAdminAuthRepository.claimTotpCounter's
    // guarded-UPDATE semantics -- exactly one caller "wins" a given
    // (adminId, counter) claim; a stale/replayed/older-or-equal counter, or
    // an admin with no MFA state row at all, returns false.
    async claimTotpCounter(adminId, counter) {
      const state = mfaStateByAdminId.get(adminId);
      if (!state) return false;
      if (state.lastAcceptedTotpCounter != null && state.lastAcceptedTotpCounter >= counter) return false;
      state.lastAcceptedTotpCounter = counter;
      return true;
    },

    // Test-only helper: lets a test directly manufacture a session (bypassing login) to exercise validateSession/step-up in isolation.
    _createSessionForTest(record) {
      sessionsByTokenHash.set(record.tokenHash, { ...record });
    },

    // Test-only helper: directly force an MFA state row (e.g. simulate PENDING_SETUP or a real ACTIVE secret).
    _setMfaStateForTest(adminId, state) {
      mfaStateByAdminId.set(adminId, { adminId, ...state });
    },
    randomAssignmentId: () => randomUUID(),
  };
}
