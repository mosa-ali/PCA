// Deterministic in-memory AuthzRepository for tests only.
// Never used as a production substitute for the PostgreSQL implementation.
export function createInMemoryAuthzRepository() {
  const scopesByKey = new Map(); // `${accountId}:${familyId}` -> status
  const licensesByAccount = new Map(); // accountId -> [{status, expiresAt}]

  return {
    async findFamilyScopeStatus(accountId, familyId) {
      return scopesByKey.get(`${accountId}:${familyId}`) ?? null;
    },

    async hasActiveLicense(accountId, now) {
      const licenses = licensesByAccount.get(accountId) ?? [];
      return licenses.some(
        (license) => license.status === 'ACTIVE' && (!license.expiresAt || license.expiresAt.getTime() > now.getTime()),
      );
    },

    // Test-only helpers, not part of the AuthzRepository interface.
    _grantScope(accountId, familyId, status = 'ACTIVE') {
      scopesByKey.set(`${accountId}:${familyId}`, status);
    },
    _addLicense(accountId, status, expiresAt = null) {
      const licenses = licensesByAccount.get(accountId) ?? [];
      licenses.push({ status, expiresAt });
      licensesByAccount.set(accountId, licenses);
    },
  };
}
