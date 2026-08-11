import type { PurgePlan } from './engine.js';

export interface DeleteNowRecord {
  actionId: string;
  completedAtUtc: Date;
  plan: PurgePlan;
}

/**
 * doc 11 Section 6 + PCA-11 brief Section 23: "Delete now" must be
 * idempotent -- repeated invocation with the SAME action id produces the
 * SAME final state and never re-runs the destructive side effect. This
 * mirrors familyenvelope/MessageIdempotencyLedger's shape deliberately
 * (same idempotency discipline, applied to a local one-time action rather
 * than a signed envelope).
 */
export interface DeleteNowLedger {
  get(actionId: string): DeleteNowRecord | null;
  record(actionId: string, plan: PurgePlan, completedAtUtc: Date): void;
}
