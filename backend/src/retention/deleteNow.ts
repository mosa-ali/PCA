import { planDeleteNow, type PurgePlan } from './engine.js';
import type { DeleteNowLedger } from './DeleteNowLedger.js';
import type { RetentionRecord } from './types.js';

export interface DeleteNowResult {
  plan: PurgePlan;
  idempotent: boolean;
}

/**
 * Applies "Delete now" idempotently, keyed by a caller-supplied one-time
 * `actionId` (doc 11 Section 6 + PCA-11 brief Section 23 "explicit,
 * idempotent, scoped"). `records` must be the scope-limited working set
 * (e.g. one family, or one device's local vault) -- scoping itself is the
 * caller's responsibility, this function only decides eligibility within
 * whatever set it is given.
 *
 * Idempotency contract: the FIRST call for a given `actionId` computes and
 * records the plan; every subsequent call with the same `actionId` returns
 * that exact same stored plan (`idempotent: true`) without recomputing --
 * even if `records` differs on a later call (e.g. new data arrived since),
 * so a duplicated instruction can never delete newer, unrelated data that
 * arrived after the original action completed.
 */
export function applyDeleteNow(actionId: string, records: RetentionRecord[], ledger: DeleteNowLedger, nowUtc: Date): DeleteNowResult {
  const existing = ledger.get(actionId);
  if (existing) {
    return { plan: existing.plan, idempotent: true };
  }
  const plan = planDeleteNow(records);
  ledger.record(actionId, plan, nowUtc);
  return { plan, idempotent: false };
}
