// Deterministic in-memory EnrollmentRepository for tests only.
// Never used as a production substitute for the MySQL implementation.
export function createInMemoryEnrollmentRepository() {
  const invitationsByTokenHash = new Map();
  const everRegisteredPublicKeys = new Set(); // permanent, matches the MySQL tombstone invariant
  const attemptsByAttemptId = new Map(); // mirrors enrollment_bootstrap_attempts: write-once, keyed by attempt_id

  return {
    // Test-only seam: not part of the EnrollmentRepository interface.
    _seedInvitation(invitation) {
      invitationsByTokenHash.set(invitation.tokenHash, { ...invitation });
    },

    // No `await` before any mutation below, so each call runs to
    // completion synchronously once invoked -- concurrent enrollment
    // attempts against the same invitation cannot interleave.
    async enrollDevice(
      tokenHash,
      platform,
      signingPublicKey,
      encryptionPublicKey,
      deviceId,
      signingKeyId,
      encryptionKeyId,
      now,
      attemptId,
      attemptRecoveryTokenHash,
    ) {
      const invitation = invitationsByTokenHash.get(tokenHash);
      if (!invitation) return { outcome: 'NOT_FOUND' };
      if (invitation.status === 'REVOKED') return { outcome: 'REVOKED' };

      if (invitation.status === 'REDEEMED') {
        const attempt = attemptsByAttemptId.get(attemptId);
        if (attempt) {
          const isExactReplay =
            attempt.tokenHash === tokenHash &&
            attempt.signingPublicKey === signingPublicKey &&
            attempt.encryptionPublicKey === encryptionPublicKey;
          if (!isExactReplay) return { outcome: 'ATTEMPT_CONFLICT' };
          return {
            outcome: 'PAIRING_REQUEST_CREATED',
            deviceId: attempt.deviceId,
            signingKeyId: attempt.signingKeyId,
            encryptionKeyId: attempt.encryptionKeyId,
            familyId: attempt.familyId,
            invitationId: attempt.invitationId,
            childProfileId: attempt.childProfileId,
            ageUxTier: attempt.ageUxTier,
            initialPolicyProfile: attempt.initialPolicyProfile,
          };
        }
        return { outcome: 'ALREADY_REDEEMED' };
      }

      if (now.getTime() >= invitation.expiresAt.getTime()) return { outcome: 'EXPIRED' };
      if (invitation.platform !== platform) return { outcome: 'PLATFORM_MISMATCH' };
      if (everRegisteredPublicKeys.has(signingPublicKey) || everRegisteredPublicKeys.has(encryptionPublicKey)) {
        return { outcome: 'DUPLICATE_KEY' };
      }
      if (attemptsByAttemptId.has(attemptId)) return { outcome: 'ATTEMPT_CONFLICT' };

      everRegisteredPublicKeys.add(signingPublicKey);
      everRegisteredPublicKeys.add(encryptionPublicKey);
      invitation.status = 'REDEEMED';
      invitation.redeemedAt = now;

      const record = {
        deviceId,
        signingKeyId,
        encryptionKeyId,
        familyId: invitation.familyId,
        invitationId: invitation.invitationId,
        childProfileId: invitation.childProfileId ?? null,
        ageUxTier: invitation.ageUxTier ?? 'YOUNG_CHILD',
        initialPolicyProfile: invitation.initialPolicyProfile ?? 'BALANCED',
        tokenHash,
        signingPublicKey,
        encryptionPublicKey,
        recoveryTokenHash: attemptRecoveryTokenHash,
      };
      attemptsByAttemptId.set(attemptId, record);

      return {
        outcome: 'PAIRING_REQUEST_CREATED',
        deviceId,
        signingKeyId,
        encryptionKeyId,
        familyId: invitation.familyId,
        invitationId: invitation.invitationId,
        childProfileId: invitation.childProfileId ?? null,
        ageUxTier: invitation.ageUxTier ?? 'YOUNG_CHILD',
        initialPolicyProfile: invitation.initialPolicyProfile ?? 'BALANCED',
      };
    },

    async findAttemptForRecovery(attemptId) {
      const attempt = attemptsByAttemptId.get(attemptId);
      if (!attempt) return null;
      return {
        deviceId: attempt.deviceId,
        recoveryTokenHash: attempt.recoveryTokenHash,
        childProfileId: attempt.childProfileId ?? null,
        ageUxTier: attempt.ageUxTier ?? 'YOUNG_CHILD',
        initialPolicyProfile: attempt.initialPolicyProfile ?? 'BALANCED',
      };
    },
  };
}
