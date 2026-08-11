// Deterministic in-memory EnrollmentRepository for tests only.
// Never used as a production substitute for the MySQL implementation.
export function createInMemoryEnrollmentRepository() {
  const invitationsByTokenHash = new Map();
  const everRegisteredPublicKeys = new Set(); // permanent, matches the MySQL tombstone invariant

  return {
    // Test-only seam: not part of the EnrollmentRepository interface.
    _seedInvitation(invitation) {
      invitationsByTokenHash.set(invitation.tokenHash, { ...invitation });
    },

    // No `await` before any mutation below, so each call runs to
    // completion synchronously once invoked -- concurrent enrollment
    // attempts against the same invitation cannot interleave.
    async enrollDevice(tokenHash, platform, signingPublicKey, encryptionPublicKey, deviceId, signingKeyId, encryptionKeyId, now) {
      const invitation = invitationsByTokenHash.get(tokenHash);
      if (!invitation) return { outcome: 'NOT_FOUND' };
      if (invitation.status === 'REVOKED') return { outcome: 'REVOKED' };
      if (invitation.status === 'REDEEMED') return { outcome: 'ALREADY_REDEEMED' };
      if (now.getTime() >= invitation.expiresAt.getTime()) return { outcome: 'EXPIRED' };
      if (invitation.platform !== platform) return { outcome: 'PLATFORM_MISMATCH' };
      if (everRegisteredPublicKeys.has(signingPublicKey) || everRegisteredPublicKeys.has(encryptionPublicKey)) {
        return { outcome: 'DUPLICATE_KEY' };
      }

      everRegisteredPublicKeys.add(signingPublicKey);
      everRegisteredPublicKeys.add(encryptionPublicKey);
      invitation.status = 'REDEEMED';
      invitation.redeemedAt = now;

      return {
        outcome: 'PAIRING_REQUEST_CREATED',
        deviceId,
        signingKeyId,
        encryptionKeyId,
        familyId: invitation.familyId,
        invitationId: invitation.invitationId,
      };
    },
  };
}
