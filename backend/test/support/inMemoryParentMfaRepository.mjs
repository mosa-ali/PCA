// Deterministic in-memory ParentMfaRepository for tests only. Mirrors the
// guarded-statement semantics of MySqlParentMfaRepository (grace inserted
// once, CAS activation on the exact pending ciphertext, forward-only counter,
// single-use tickets/codes/step-up grants). Concurrency is proven against
// real MySQL in test/db/parentMfa.mysql.test.mjs, not here.
export function createInMemoryParentMfaRepository() {
  const states = new Map();
  const tickets = new Map();
  const recoveryCodes = [];
  const stepUps = new Map();
  const events = [];

  const copy = (state) => (state ? { ...state } : null);

  return {
    async findState(accountId) {
      return copy(states.get(accountId));
    },
    async startGraceIfAbsent(accountId, startedAt, expiresAt) {
      if (states.has(accountId)) return false;
      states.set(accountId, {
        accountId,
        status: 'NOT_ENROLLED',
        totpSecretCiphertext: null,
        totpSecretNonce: null,
        pendingSecretCiphertext: null,
        pendingSecretNonce: null,
        pendingCreatedAt: null,
        lastAcceptedTotpCounter: null,
        graceStartedAt: startedAt,
        graceExpiresAt: expiresAt,
        enrolledAt: null,
        failedAttemptCount: 0,
        failureWindowStartedAt: null,
        lockedUntil: null,
        resetCount: 0,
        recoveryHoldStartedAt: null,
        recoveryHoldExpiresAt: null,
      });
      return true;
    },
    async savePendingSecret(accountId, ciphertext, nonce, now) {
      const state = states.get(accountId);
      if (!state || state.status !== 'NOT_ENROLLED') return;
      Object.assign(state, { pendingSecretCiphertext: Buffer.from(ciphertext), pendingSecretNonce: Buffer.from(nonce), pendingCreatedAt: now });
    },
    async activatePendingSecret(accountId, expectedPendingCiphertext, counter, now) {
      const state = states.get(accountId);
      if (!state || state.status !== 'NOT_ENROLLED' || !state.pendingSecretCiphertext || !state.pendingSecretCiphertext.equals(expectedPendingCiphertext)) return false;
      Object.assign(state, {
        status: 'ACTIVE',
        totpSecretCiphertext: state.pendingSecretCiphertext,
        totpSecretNonce: state.pendingSecretNonce,
        pendingSecretCiphertext: null,
        pendingSecretNonce: null,
        pendingCreatedAt: null,
        lastAcceptedTotpCounter: counter,
        enrolledAt: now,
        failedAttemptCount: 0,
        failureWindowStartedAt: null,
        lockedUntil: null,
      });
      return true;
    },
    async claimTotpCounter(accountId, counter) {
      const state = states.get(accountId);
      if (!state || state.status !== 'ACTIVE') return false;
      if (state.lastAcceptedTotpCounter !== null && state.lastAcceptedTotpCounter >= counter) return false;
      state.lastAcceptedTotpCounter = counter;
      return true;
    },
    async recordFailure(accountId, now, policy) {
      const state = states.get(accountId);
      if (!state) return { locked: false };
      const fresh = state.failureWindowStartedAt !== null && now.getTime() - state.failureWindowStartedAt.getTime() < policy.windowMs;
      const count = fresh ? state.failedAttemptCount + 1 : 1;
      const locked = count >= policy.threshold;
      Object.assign(state, {
        failedAttemptCount: locked ? 0 : count,
        failureWindowStartedAt: locked ? null : fresh ? state.failureWindowStartedAt : now,
        lockedUntil: locked ? new Date(now.getTime() + policy.lockMs) : state.lockedUntil,
      });
      return { locked };
    },
    async clearFailures(accountId) {
      const state = states.get(accountId);
      if (state) Object.assign(state, { failedAttemptCount: 0, failureWindowStartedAt: null });
    },
    async resetEnrollment(accountId, now) {
      const state = states.get(accountId);
      if (!state || state.status !== 'ACTIVE') return false;
      const shortened = Math.min(state.graceExpiresAt.getTime(), now.getTime());
      Object.assign(state, {
        status: 'NOT_ENROLLED',
        totpSecretCiphertext: null,
        totpSecretNonce: null,
        pendingSecretCiphertext: null,
        pendingSecretNonce: null,
        pendingCreatedAt: null,
        enrolledAt: null,
        graceExpiresAt: new Date(Math.max(state.graceStartedAt.getTime(), shortened)),
        failedAttemptCount: 0,
        failureWindowStartedAt: null,
        lockedUntil: null,
        resetCount: state.resetCount + 1,
      });
      return true;
    },
    async insertTicket(record) {
      tickets.set(record.tokenHash, { ...record, consumedAt: null });
    },
    async findLiveTicket(tokenHash, now) {
      const ticket = tickets.get(tokenHash);
      if (!ticket || ticket.consumedAt !== null || ticket.expiresAt.getTime() <= now.getTime()) return null;
      return { ticketId: ticket.ticketId, accountId: ticket.accountId, purpose: ticket.purpose };
    },
    async consumeTicket(ticketId, now) {
      for (const ticket of tickets.values()) {
        if (ticket.ticketId === ticketId) {
          if (ticket.consumedAt !== null || ticket.expiresAt.getTime() <= now.getTime()) return false;
          ticket.consumedAt = now;
          return true;
        }
      }
      return false;
    },
    async insertRecoveryCode(record) {
      recoveryCodes.push({ ...record, consumedAt: null, attemptCount: 0 });
    },
    async findLatestRecoveryCode(accountId) {
      for (let i = recoveryCodes.length - 1; i >= 0; i -= 1) {
        if (recoveryCodes[i].accountId === accountId) return { ...recoveryCodes[i] };
      }
      return null;
    },
    async incrementRecoveryAttempt(codeId) {
      const code = recoveryCodes.find((entry) => entry.codeId === codeId);
      if (code && code.attemptCount < 8) code.attemptCount += 1;
    },
    async consumeRecoveryCode(codeId, now) {
      const code = recoveryCodes.find((entry) => entry.codeId === codeId);
      if (!code || code.consumedAt !== null) return false;
      code.consumedAt = now;
      return true;
    },
    async applyRecoveryCode({ codeId, accountId, serviceAccountId: _serviceAccountId, now, holdExpiresAt }) {
      const state = states.get(accountId);
      const code = recoveryCodes.find((entry) => entry.codeId === codeId && entry.accountId === accountId);
      if (!state || !code || code.consumedAt !== null || code.expiresAt.getTime() <= now.getTime() || code.attemptCount >= 8) throw new Error('MFA recovery code unavailable');
      code.consumedAt = now;
      const activeHold = state.recoveryHoldExpiresAt && state.recoveryHoldExpiresAt.getTime() > now.getTime();
      let started = false;
      if (!activeHold && state.recoveryHoldExpiresAt === null) {
        state.recoveryHoldStartedAt = now;
        state.recoveryHoldExpiresAt = holdExpiresAt;
        started = true;
        events.push({ accountId, eventType: 'MFA_RECOVERY_PENDING', detail: null, occurredAt: now });
      } else if (!activeHold) {
        Object.assign(state, {
          status: 'NOT_ENROLLED', totpSecretCiphertext: null, totpSecretNonce: null,
          pendingSecretCiphertext: null, pendingSecretNonce: null, pendingCreatedAt: null,
          enrolledAt: null, recoveryHoldStartedAt: null, recoveryHoldExpiresAt: null,
          graceExpiresAt: new Date(Math.max(state.graceStartedAt.getTime(), Math.min(state.graceExpiresAt.getTime(), now.getTime()))),
          failedAttemptCount: 0, failureWindowStartedAt: null, lockedUntil: null, resetCount: state.resetCount + 1,
        });
        events.push({ accountId, eventType: 'MFA_RESET', detail: null, occurredAt: now });
        events.push({ accountId, eventType: 'MFA_RECOVERY_COMPLETED', detail: null, occurredAt: now });
      }
      for (const item of recoveryCodes) if (item.accountId === accountId && item.consumedAt === null) item.consumedAt = now;
      for (const grant of stepUps.values()) if (grant.accountId === accountId && grant.consumedAt === null) grant.consumedAt = now;
      return activeHold || started
        ? { status: 'PENDING', recoveryAvailableAt: activeHold ? state.recoveryHoldExpiresAt : holdExpiresAt, started }
        : { status: 'READY' };
    },
    async insertStepUpGrant(record) {
      stepUps.set(record.tokenHash, { ...record, consumedAt: null });
    },
    async consumeStepUpGrant({ tokenHash, accountId, familyId, operation, now }) {
      const grant = stepUps.get(tokenHash);
      if (!grant || grant.accountId !== accountId || grant.familyId !== familyId || grant.operation !== operation) return false;
      if (grant.consumedAt !== null || grant.expiresAt.getTime() <= now.getTime()) return false;
      grant.consumedAt = now;
      return true;
    },
    async recordSecurityEvent(accountId, eventType, detail, occurredAt) {
      events.push({ accountId, eventType, detail, occurredAt });
    },

    // Test-only accessors, not part of the ParentMfaRepository interface.
    _events: events,
    _stateForTest(accountId) {
      return states.get(accountId) ?? null;
    },
  };
}
