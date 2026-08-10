import { randomUUID } from 'node:crypto';

// Deterministic in-memory AuthRepository for tests only.
// Never used as a production substitute for the PostgreSQL implementation.
export function createInMemoryAuthRepository() {
  const accountsByReferenceHash = new Map(); // hex(hash) -> account
  const sessionsByTokenHash = new Map(); // tokenHash -> session

  function hashKey(buf) {
    return buf.toString('hex');
  }

  return {
    // No `await` before any mutation below, so each call runs to
    // completion synchronously once invoked.
    async findOrCreateAccount(accountReferenceHash, now) {
      const key = hashKey(accountReferenceHash);
      const existing = accountsByReferenceHash.get(key);
      if (existing) return { accountId: existing.accountId, disabledAt: existing.disabledAt };
      const account = { accountId: randomUUID(), accountReferenceHash, createdAt: now, disabledAt: null };
      accountsByReferenceHash.set(key, account);
      return { accountId: account.accountId, disabledAt: null };
    },

    async createSession(record) {
      sessionsByTokenHash.set(record.tokenHash, { ...record });
    },

    async validateSession(tokenHash, now) {
      const session = sessionsByTokenHash.get(tokenHash);
      if (!session) return { outcome: 'NOT_FOUND' };
      if (session.revokedAt) return { outcome: 'REVOKED' };
      if (session.expiresAt.getTime() <= now.getTime()) return { outcome: 'EXPIRED' };
      const account = [...accountsByReferenceHash.values()].find((a) => a.accountId === session.accountId);
      if (account?.disabledAt) return { outcome: 'ACCOUNT_DISABLED' };
      return { outcome: 'VALID', session: { ...session } };
    },

    async revokeSession(tokenHash, revokedAt) {
      const session = sessionsByTokenHash.get(tokenHash);
      if (session && !session.revokedAt) session.revokedAt = revokedAt;
    },

    // Test-only helper, not part of the AuthRepository interface: lets
    // tests disable an account to exercise the disabled-account path.
    _disableAccountForTest(accountId, disabledAt) {
      for (const account of accountsByReferenceHash.values()) {
        if (account.accountId === accountId) account.disabledAt = disabledAt;
      }
    },
  };
}
