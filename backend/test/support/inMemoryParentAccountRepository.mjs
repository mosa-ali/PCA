// Deterministic in-memory ParentAccountRepository for tests only. Never
// used as a production substitute for MySqlParentAccountRepository. Lives
// entirely under backend/test/ -- not part of the TypeScript build.
export function createInMemoryParentAccountRepository({ revokeAllSessionsForAccount, grantFamilyScope, familyStatusById } = {}) {
  const grantedScopes = new Set(); // `${serviceAccountId}:${familyId}`
  // familyId -> 'ACTIVE' | 'SUSPENDED'. Defaults to ACTIVE for any familyId
  // never explicitly set, mirroring migration 0017's DEFAULT 'ACTIVE'.
  const familyStatuses = familyStatusById instanceof Map ? familyStatusById : new Map();
  const accountsById = new Map();
  const accountsByEmailHashHex = new Map(); // emailHashHex -> accountId
  const accountsByServiceAccountId = new Map(); // serviceAccountId -> accountId
  const codesById = new Map();
  const codesByAccount = new Map(); // accountId -> [codeId,...] insertion order

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

    async updatePendingPasswordHash(accountId, passwordHash) {
      const account = accountsById.get(accountId);
      if (account && account.status === 'PENDING_VERIFICATION') account.passwordHash = passwordHash;
    },

    async insertVerificationCode(record) {
      const code = { ...record, consumedAt: null, attemptCount: 0 };
      codesById.set(record.codeId, code);
      const list = codesByAccount.get(record.accountId) ?? [];
      list.push(record.codeId);
      codesByAccount.set(record.accountId, list);
    },

    async findLatestVerificationCode(accountId) {
      const list = codesByAccount.get(accountId) ?? [];
      if (list.length === 0) return null;
      const code = codesById.get(list[list.length - 1]);
      return { ...code };
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
      account.freeAccess = { ...transition.freeAccess };
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

    // Test-only accessor, not part of the ParentAccountRepository interface.
    _hasGrantedScopeForTest(serviceAccountId, familyId) {
      return grantedScopes.has(`${serviceAccountId}:${familyId}`);
    },

    // Test-only mutator, not part of the ParentAccountRepository interface.
    _setFamilyStatusForTest(familyId, status) {
      familyStatuses.set(familyId, status);
    },
  };
}
