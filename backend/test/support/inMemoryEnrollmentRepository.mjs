// Deterministic in-memory EnrollmentRepository for tests only.
// Never used as a production substitute for the MySQL implementation.
export function createInMemoryEnrollmentRepository() {
  const invitationsByTokenHash = new Map();
  const everRegisteredPublicKeys = new Set(); // permanent, matches the MySQL tombstone invariant
  const attemptsByAttemptId = new Map(); // mirrors enrollment_bootstrap_attempts: write-once, keyed by attempt_id
  const attemptsByTokenHash = new Map(); // one prepared/completed reservation per invitation hash

  return {
    // Test-only seam: not part of the EnrollmentRepository interface.
    _seedInvitation(invitation) {
      invitationsByTokenHash.set(invitation.tokenHash, { ...invitation });
    },

    async prepareAttempt(tokenHash, platform, signingPublicKey, encryptionPublicKey, now, attemptId, attemptRecoveryTokenHash) {
      const invitation = invitationsByTokenHash.get(tokenHash);
      if (!invitation) return { outcome: 'NOT_FOUND' };
      if (invitation.status === 'REVOKED') return { outcome: 'REVOKED' };
      const existing = attemptsByTokenHash.get(tokenHash);
      const usedId = attemptsByAttemptId.get(attemptId);
      const exact = (attempt) => attempt.attemptId === attemptId &&
        attempt.recoveryTokenHash === attemptRecoveryTokenHash && attempt.platform === platform &&
        attempt.signingPublicKey === signingPublicKey && attempt.encryptionPublicKey === encryptionPublicKey;
      if (invitation.status === 'REDEEMED') {
        if (existing?.status === 'COMPLETED') {
          if (exact(existing)) return { outcome: 'COMPLETED' };
          if (existing.attemptId === attemptId) return { outcome: 'ATTEMPT_CONFLICT' };
        }
        return { outcome: 'ALREADY_REDEEMED' };
      }
      if (now.getTime() >= invitation.expiresAt.getTime()) return { outcome: 'EXPIRED' };
      if (invitation.platform !== platform) return { outcome: 'PLATFORM_MISMATCH' };
      if (usedId && usedId !== existing) return { outcome: 'ATTEMPT_CONFLICT' };
      if (existing?.status === 'PREPARED') return exact(existing) ? { outcome: 'READY' } : { outcome: 'ATTEMPT_CONFLICT' };
      if (existing?.status === 'COMPLETED') return exact(existing) ? { outcome: 'COMPLETED' } : { outcome: 'ALREADY_REDEEMED' };
      if (existing?.status === 'ABANDONED') {
        if (existing.attemptId === attemptId) return { outcome: 'ATTEMPT_CONFLICT' };
        attemptsByAttemptId.delete(existing.attemptId);
      }
      const attempt = {
        attemptId, tokenHash, recoveryTokenHash: attemptRecoveryTokenHash, platform,
        signingPublicKey, encryptionPublicKey, deviceId: null, signingKeyId: null,
        encryptionKeyId: null, invitationId: invitation.invitationId, familyId: invitation.familyId,
        childProfileId: invitation.childProfileId ?? null,
        ageUxTier: invitation.ageUxTier ?? 'YOUNG_CHILD',
        initialPolicyProfile: invitation.initialPolicyProfile ?? 'BALANCED', status: 'PREPARED',
      };
      attemptsByAttemptId.set(attemptId, attempt);
      attemptsByTokenHash.set(tokenHash, attempt);
      return { outcome: 'READY' };
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
        if (attempt?.status === 'COMPLETED') {
          const isExactReplay =
            attempt.tokenHash === tokenHash &&
            attempt.recoveryTokenHash === attemptRecoveryTokenHash &&
            attempt.platform === platform &&
            attempt.signingPublicKey === signingPublicKey &&
            attempt.encryptionPublicKey === encryptionPublicKey;
          if (!isExactReplay) return { outcome: 'ATTEMPT_CONFLICT' };
          return {
            outcome: 'PAIRING_REQUEST_CREATED',
            replayed: true,
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
      const claim = attemptsByTokenHash.get(tokenHash);
      if (!claim || !(claim.status === 'PREPARED' && claim.attemptId === attemptId &&
        claim.recoveryTokenHash === attemptRecoveryTokenHash && claim.platform === platform &&
        claim.signingPublicKey === signingPublicKey && claim.encryptionPublicKey === encryptionPublicKey)) {
        return { outcome: 'ATTEMPT_CONFLICT' };
      }
      everRegisteredPublicKeys.add(signingPublicKey);
      everRegisteredPublicKeys.add(encryptionPublicKey);
      invitation.status = 'REDEEMED';
      invitation.redeemedAt = now;

      const record = {
        attemptId,
        deviceId,
        signingKeyId,
        encryptionKeyId,
        familyId: invitation.familyId,
        invitationId: invitation.invitationId,
        childProfileId: invitation.childProfileId ?? null,
        ageUxTier: invitation.ageUxTier ?? 'YOUNG_CHILD',
        initialPolicyProfile: invitation.initialPolicyProfile ?? 'BALANCED',
        tokenHash,
        platform,
        signingPublicKey,
        encryptionPublicKey,
        recoveryTokenHash: attemptRecoveryTokenHash,
        status: 'COMPLETED',
      };
      attemptsByAttemptId.set(attemptId, record);
      attemptsByTokenHash.set(tokenHash, record);

      return {
        outcome: 'PAIRING_REQUEST_CREATED',
        replayed: false,
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

    async resolveAttemptForRecovery(attemptId, verifyRecoveryTokenHash) {
      const attempt = attemptsByAttemptId.get(attemptId);
      if (!attempt || !verifyRecoveryTokenHash(attempt.recoveryTokenHash)) return { outcome: 'NOT_FOUND' };
      if (attempt.status === 'ABANDONED') return { outcome: 'ABANDONED' };
      if (attempt.status === 'PREPARED') {
        attempt.status = 'ABANDONED';
        return { outcome: 'ABANDONED' };
      }
      return {
        outcome: 'COMPLETED',
        result: {
          deviceId: attempt.deviceId,
          signingKeyId: attempt.signingKeyId,
          encryptionKeyId: attempt.encryptionKeyId,
          childProfileId: attempt.childProfileId ?? null,
          ageUxTier: attempt.ageUxTier ?? 'YOUNG_CHILD',
          initialPolicyProfile: attempt.initialPolicyProfile ?? 'BALANCED',
        },
      };
    },
  };
}
