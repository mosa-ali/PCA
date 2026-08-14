import { randomUUID } from 'node:crypto';

// Deterministic in-memory ChangeRequestRepository for tests only
// (PCA-MYKIDS-BILL-2). Implements
// backend/src/entitlements/requests/ChangeRequestRepository.ts's interface
// shape, including its guarded "WHERE state = <expected>" transition
// semantics (a stale-state caller gets null, never a corrupted write).
// Never used as a production substitute for MySqlChangeRequestRepository.
export function createInMemoryChangeRequestRepository() {
  const byId = new Map();

  function clone(record) {
    return record ? { ...record, quote: record.quote ? { ...record.quote } : null } : null;
  }

  return {
    async getById(requestId) {
      return clone(byId.get(requestId) ?? null);
    },

    async lockById(_conn, requestId) {
      return clone(byId.get(requestId) ?? null);
    },

    async listForFamily(familyId) {
      return [...byId.values()].filter((r) => r.familyId === familyId).map(clone);
    },

    async listOpenForFamily(familyId) {
      const open = new Set(['PENDING', 'QUOTED', 'PAYMENT_PENDING']);
      return [...byId.values()].filter((r) => r.familyId === familyId && open.has(r.state)).map(clone);
    },

    async create(_conn, input) {
      const record = {
        requestId: input.requestId,
        familyId: input.familyId,
        limitType: input.limitType,
        currentLimitAtRequest: input.currentLimitAtRequest,
        targetLimit: input.targetLimit,
        state: 'PENDING',
        awaitingAdminQuote: false,
        noChargeOverride: false,
        quote: null,
        decidedByAdminId: null,
        decisionReason: null,
        createdAt: input.now,
        updatedAt: input.now,
      };
      byId.set(record.requestId, record);
      return clone(record);
    },

    async recordTransition() {
      // Transition history is not modeled by this in-memory fake -- no test
      // in this lane asserts on it.
    },

    async attachQuote(_conn, requestId, quote, now) {
      const record = byId.get(requestId);
      if (!record || record.state !== 'PENDING') return null;
      record.state = 'QUOTED';
      record.quote = { ...quote };
      record.updatedAt = now;
      return clone(record);
    },

    async markAwaitingAdminQuote(_conn, requestId, now) {
      const record = byId.get(requestId);
      if (!record || record.state !== 'PENDING') return null;
      record.awaitingAdminQuote = true;
      record.updatedAt = now;
      return clone(record);
    },

    async moveToPaymentPending(_conn, requestId, now) {
      const record = byId.get(requestId);
      if (!record || record.state !== 'QUOTED') return null;
      record.state = 'PAYMENT_PENDING';
      record.updatedAt = now;
      return clone(record);
    },

    async markApproved(_conn, requestId, fromStates, decidedByAdminId, noChargeOverride, now) {
      const record = byId.get(requestId);
      if (!record || !fromStates.includes(record.state)) return null;
      record.state = 'APPROVED';
      record.decidedByAdminId = decidedByAdminId;
      record.noChargeOverride = noChargeOverride;
      record.updatedAt = now;
      return clone(record);
    },

    async markDenied(_conn, requestId, fromStates, decidedByAdminId, reason, now) {
      const record = byId.get(requestId);
      if (!record || !fromStates.includes(record.state)) return null;
      record.state = 'DENIED';
      record.decidedByAdminId = decidedByAdminId;
      record.decisionReason = reason;
      record.updatedAt = now;
      return clone(record);
    },

    async markCancelled(_conn, requestId, fromStates, now) {
      const record = byId.get(requestId);
      if (!record || !fromStates.includes(record.state)) return null;
      record.state = 'CANCELLED';
      record.updatedAt = now;
      return clone(record);
    },

    // Test-only helper, not part of the ChangeRequestRepository interface.
    _seed(record) {
      byId.set(record.requestId, { ...record });
    },
    _newId() {
      return randomUUID();
    },
  };
}
