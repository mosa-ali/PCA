// Deterministic in-memory ParentAccountRepository for tests only. Never
// used as a production substitute for MySqlParentAccountRepository. Lives
// entirely under backend/test/ -- not part of the TypeScript build.
export function createInMemoryParentAccountRepository({ revokeAllSessionsForAccount, grantFamilyScope, familyStatusById } = {}) {
  const grantedScopes = new Set(); // `${serviceAccountId}:${familyId}`
  const createdFamilies = new Set(); // familyId
  // familyId -> 'ACTIVE' | 'SUSPENDED'. Defaults to ACTIVE for any familyId
  // never explicitly set, mirroring migration 0017's DEFAULT 'ACTIVE'.
  const familyStatuses = familyStatusById instanceof Map ? familyStatusById : new Map();
  const accountsById = new Map();
  const accountsByEmailHashHex = new Map(); // emailHashHex -> accountId
  const accountsByServiceAccountId = new Map(); // serviceAccountId -> accountId
  const codesById = new Map();
  const codesByAccount = new Map(); // accountId -> [codeId,...] insertion order
  const resetCodesById = new Map();
  const resetCodesByAccount = new Map(); // accountId -> [codeId,...] insertion order
  const stepUpCodesById = new Map();
  const stepUpCodesByAccount = new Map(); // accountId -> [codeId,...] insertion order
  const dailyLoginGrantsById = new Map();
  const membershipsByAccountFamily = new Map();

  function hexOf(buf) {
    return buf.toString('hex');
  }

  function clone(account) {
    return { ...account, freeAccess: account.freeAccess ? { ...account.freeAccess } : null };
  }

  return {
    async createPendingAccount(record) {
      const key = hexOf(record.emailHash);
      if (accountsByEmailHashHex.has(key)) {
        const err = new Error('duplicate email_hash');
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      const account = {
        accountId: record.accountId,
        emailHash: record.emailHash,
        passwordHash: record.passwordHash,
        status: 'PENDING_VERIFICATION',
        familyId: null,
        serviceAccountId: null,
        freeAccess: null,
        createdAt: record.createdAt,
        verifiedAt: null,
        disabledAt: null,
        firstLoginCompletedAt: null,
        accountType: record.accountType ?? null,
        estimatedChildCount: record.estimatedChildCount ?? null,
      };
      accountsById.set(account.accountId, account);
      accountsByEmailHashHex.set(key, account.accountId);
    },

    async findByEmailHash(emailHash) {
      const accountId = accountsByEmailHashHex.get(hexOf(emailHash));
      if (!accountId) return null;
      return clone(accountsById.get(accountId));
    },

    async findById(accountId) {
      const account = accountsById.get(accountId);
      return account ? clone(account) : null;
    },

    async findByServiceAccountId(serviceAccountId) {
      const accountId = accountsByServiceAccountId.get(serviceAccountId);
      if (!accountId) return null;
      return clone(accountsById.get(accountId));
    },

    async insertVerificationCode(record) {
      const code = { ...record, passwordHash: record.passwordHash ?? null, consumedAt: null, attemptCount: 0 };
      codesById.set(record.codeId, code);
      const list = codesByAccount.get(record.accountId) ?? [];
      list.push(record.codeId);
      codesByAccount.set(record.accountId, list);
    },

    // Newest-first, bounded by `limit` -- mirrors the MySQL implementation's
    // `ORDER BY created_at DESC, code_id DESC LIMIT ?` exactly.
    async findRecentVerificationCodes(accountId, limit) {
      const list = codesByAccount.get(accountId) ?? [];
      return list
        .slice()
        .reverse()
        .slice(0, limit)
        .map((codeId) => ({ ...codesById.get(codeId) }));
    },

    async incrementVerificationAttempt(codeId) {
      const code = codesById.get(codeId);
      if (code) code.attemptCount += 1;
    },

    async consumeVerificationCodeIfUnconsumed(codeId, consumedAt) {
      const code = codesById.get(codeId);
      if (!code || code.consumedAt !== null) return false;
      code.consumedAt = consumedAt;
      return true;
    },

    async markVerified(transition) {
      const account = accountsById.get(transition.accountId);
      if (!account || account.status !== 'PENDING_VERIFICATION') return;
      account.status = 'VERIFIED';
      account.verifiedAt = transition.verifiedAt;
      account.familyId = transition.familyId;
      // COALESCE(?, password_hash) in the MySQL implementation: the redeemed
      // code's own bound credential, or the existing one for a legacy
      // (pre-migration-0030) code row.
      if (transition.passwordHash !== null && transition.passwordHash !== undefined) {
        account.passwordHash = transition.passwordHash;
      }
      account.freeAccess = { ...transition.freeAccess };
      // See MySqlParentAccountRepository.markVerified's own comment: the
      // auto-session this transition leads to is itself an authentication
      // event, satisfying the login-step-up requirement immediately.
      account.firstLoginCompletedAt = transition.verifiedAt;
    },

    async insertPasswordResetCode(record) {
      const code = { ...record, consumedAt: null, attemptCount: 0 };
      resetCodesById.set(record.codeId, code);
      const list = resetCodesByAccount.get(record.accountId) ?? [];
      list.push(record.codeId);
      resetCodesByAccount.set(record.accountId, list);
    },

    async findLatestPasswordResetCode(accountId) {
      const list = resetCodesByAccount.get(accountId) ?? [];
      if (list.length === 0) return null;
      const code = resetCodesById.get(list[list.length - 1]);
      return { ...code };
    },

    async incrementPasswordResetAttempt(codeId) {
      const code = resetCodesById.get(codeId);
      if (code) code.attemptCount += 1;
    },

    async consumePasswordResetCodeIfUnconsumed(codeId, consumedAt) {
      const code = resetCodesById.get(codeId);
      if (!code || code.consumedAt !== null) return false;
      code.consumedAt = consumedAt;
      return true;
    },

    async insertLoginStepUpCode(record) {
      const code = { ...record, consumedAt: null, attemptCount: 0 };
      stepUpCodesById.set(record.codeId, code);
      const list = stepUpCodesByAccount.get(record.accountId) ?? [];
      list.push(record.codeId);
      stepUpCodesByAccount.set(record.accountId, list);
    },

    async findLatestLoginStepUpCode(accountId) {
      const list = stepUpCodesByAccount.get(accountId) ?? [];
      if (list.length === 0) return null;
      const code = stepUpCodesById.get(list[list.length - 1]);
      return { ...code };
    },

    async incrementLoginStepUpAttempt(codeId) {
      const code = stepUpCodesById.get(codeId);
      if (code) code.attemptCount += 1;
    },

    async consumeLoginStepUpCodeIfUnconsumed(codeId, consumedAt) {
      const code = stepUpCodesById.get(codeId);
      if (!code || code.consumedAt !== null) return false;
      code.consumedAt = consumedAt;
      return true;
    },

    async markFirstLoginCompletedIfAbsent(accountId, completedAt) {
      const account = accountsById.get(accountId);
      if (account && account.firstLoginCompletedAt === null) account.firstLoginCompletedAt = completedAt;
    },

    async insertDailyLoginGrant(record) {
      dailyLoginGrantsById.set(record.grantId, { ...record, lastUsedAt: null, revokedAt: null });
    },

    async validateAndTouchDailyLoginGrant(accountId, tokenHash, now) {
      for (const grant of dailyLoginGrantsById.values()) {
        if (
          grant.accountId === accountId &&
          grant.tokenHash === tokenHash &&
          grant.purpose === 'PARENT_DAILY_LOGIN' &&
          grant.revokedAt === null &&
          grant.expiresAt.getTime() > now.getTime()
        ) {
          grant.lastUsedAt = now;
          return true;
        }
      }
      return false;
    },

    async revokeDailyLoginGrant(accountId, tokenHash, revokedAt) {
      for (const grant of dailyLoginGrantsById.values()) {
        if (grant.accountId === accountId && grant.tokenHash === tokenHash && grant.revokedAt === null) grant.revokedAt = revokedAt;
      }
    },

    async revokeAllDailyLoginGrants(accountId, revokedAt) {
      let count = 0;
      for (const grant of dailyLoginGrantsById.values()) {
        if (grant.accountId === accountId && grant.revokedAt === null) {
          grant.revokedAt = revokedAt;
          count += 1;
        }
      }
      return count;
    },

    async updatePasswordHash(accountId, passwordHash) {
      const account = accountsById.get(accountId);
      if (account && account.status === 'VERIFIED') account.passwordHash = passwordHash;
    },

    async setServiceAccountIdIfAbsent(accountId, serviceAccountId) {
      const account = accountsById.get(accountId);
      if (!account || account.serviceAccountId !== null) return;
      account.serviceAccountId = serviceAccountId;
      accountsByServiceAccountId.set(serviceAccountId, accountId);
    },

    async revokeAllServiceSessionsFor(serviceAccountId, revokedAt) {
      if (!revokeAllSessionsForAccount) return 0;
      return revokeAllSessionsForAccount(serviceAccountId, revokedAt);
    },

    async grantFamilyScopeIfAbsent(serviceAccountId, familyId, now) {
      grantedScopes.add(`${serviceAccountId}:${familyId}`);
      if (grantFamilyScope) await grantFamilyScope(serviceAccountId, familyId, now);
    },

    async findFamilyStatus(familyId) {
      if (!familyStatuses.has(familyId)) return familyId ? 'ACTIVE' : null;
      return familyStatuses.get(familyId);
    },

    async createFamilyIfAbsent(familyId) {
      createdFamilies.add(familyId);
    },

    // The membership WRITER the production port declares is
    // applyAcceptedInvitationRoleOnConnection(conn, ...), which this double
    // cannot model -- it has no transaction connection, the same limitation its
    // own header notes for every other connection-scoped hook. The two
    // non-connection writers that used to live here (createGenesisAdministrator,
    // applyAcceptedInvitationRole) were DELETED with them under owner ruling
    // FAMILY_MEMBERSHIP_REPOSITORY_OWNER_DECISION = DELETE_DEAD_WRAPPERS, because
    // they had no production caller AND opened their own transactions.
    //
    // Seeding therefore goes through the test-only mutator below, following this
    // file's existing `_set...ForTest` convention (familyStatuses, accountsById),
    // rather than through any production-shaped API.
    async findActiveRole(accountId, familyId) {
      const membership = membershipsByAccountFamily.get(`${accountId}:${familyId}`);
      return membership?.status === 'ACTIVE' ? membership.role : null;
    },

    // Test-only mutator, not part of the ParentAccountRepository interface.
    _setMembershipForTest(accountId, familyId, role, status = 'ACTIVE') {
      membershipsByAccountFamily.set(`${accountId}:${familyId}`, { role, status, serviceAccountId: null });
    },

    // Test-only accessor, not part of the ParentAccountRepository interface.
    _hasGrantedScopeForTest(serviceAccountId, familyId) {
      return grantedScopes.has(`${serviceAccountId}:${familyId}`);
    },

    // Test-only mutator, not part of the ParentAccountRepository interface.
    _setFamilyStatusForTest(familyId, status) {
      familyStatuses.set(familyId, status);
    },

    // Test-only mutator, not part of the ParentAccountRepository interface.
    _setFamilyForTest(accountId, familyId) {
      const account = accountsById.get(accountId);
      if (account) account.familyId = familyId;
    },

    // Test-only mutator, not part of the ParentAccountRepository interface.
    _disableAccountForTest(accountId, disabledAt) {
      const account = accountsById.get(accountId);
      if (account) account.disabledAt = disabledAt;
    },

    // Test-only accessor, not part of the ParentAccountRepository interface.
    _hasCreatedFamilyForTest(familyId) {
      return createdFamilies.has(familyId);
    },
  };
}
