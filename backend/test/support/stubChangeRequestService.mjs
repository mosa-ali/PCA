// PCA-MYKIDS-BILL-2 -- a DB-free stand-in for the real (accepted, DB-bound)
// ChangeRequestService, used by familycommercial/** unit + HTTP-level
// tests. The real ChangeRequestService.createRequest/cancel always wrap
// their own repository calls in db/pool.js's REAL runInTransaction (no
// injectable seam), and this codebase's own convention is to test that
// class only against a real MySQL connection (test/db/*.mysql.test.mjs).
// This stub records every call it received so a test can assert on exactly
// what FamilyCommercialService delegated, and applies the SAME target
// validation rule (targetLimit must be a non-negative integer) the real
// class enforces, without needing a DB.
import { ChangeRequestError } from '../../dist/entitlements/requests/ChangeRequestService.js';

export function createStubChangeRequestService(changeRequestRepository, now = () => new Date()) {
  const calls = { createRequest: [], cancel: [] };
  return {
    calls,
    async createRequest(familyId, limitType, targetLimit, market, currencyCode) {
      calls.createRequest.push({ familyId, limitType, targetLimit, market, currencyCode });
      if (!Number.isInteger(targetLimit) || targetLimit < 0) {
        throw new ChangeRequestError('INVALID_TARGET');
      }
      return changeRequestRepository.create(undefined, {
        requestId: `req-${calls.createRequest.length}-${Math.random().toString(36).slice(2)}`,
        familyId,
        limitType,
        currentLimitAtRequest: 1,
        targetLimit,
        now: now(),
      });
    },
    async cancel(requestId) {
      calls.cancel.push(requestId);
      const cancelled = await changeRequestRepository.markCancelled(undefined, requestId, ['PENDING', 'QUOTED'], now());
      if (!cancelled) {
        throw new ChangeRequestError('INVALID_STATE');
      }
      return cancelled;
    },
  };
}
