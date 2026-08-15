import type { FreeAccessSnapshot } from '../types.js';
import { MS_PER_DAY } from './deriveFreeAccessStatus.js';

export type FreeAccessAdjustmentAction =
  | { kind: 'EXTEND'; additionalDays: number }
  | { kind: 'REDUCE'; reduceDays: number }
  | { kind: 'CONVERT_TO_PERPETUAL' }
  | { kind: 'CONVERT_TO_TIME_LIMITED'; durationDays: number };

export type FreeAccessAdjustmentErrorCode = 'INVALID_ACTION_FOR_MODE' | 'INVALID_INPUT';

export class FreeAccessAdjustmentError extends Error {
  readonly code: FreeAccessAdjustmentErrorCode;
  constructor(code: FreeAccessAdjustmentErrorCode) {
    super(`FREE_ACCESS admin adjustment rejected: ${code}`);
    this.name = 'FreeAccessAdjustmentError';
    this.code = code;
  }
}

const MAX_ADJUSTMENT_DAYS = 3650; // ~10 years -- a sane upper bound so a fat-fingered admin value can never produce a runaway/overflowing Date.

function isPositiveIntWithinBound(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_ADJUSTMENT_DAYS;
}

/**
 * Pure computation of an existing-account FREE_ACCESS adjustment's "after"
 * snapshot -- no I/O, independently unit-testable. The caller
 * (FreeAccessAdminService, via MySqlFreeAccessAccountRepository) is
 * responsible for persisting the result and writing the paired audit
 * event; this function never mutates `current` and never touches
 * `defaultParentMemberLimit`/`defaultManagedDeviceLimit` (existing-account
 * FREE_ACCESS adjustment is scoped to mode/duration/expiry only, per the
 * frozen contract's "extend / reduce / convert TIME_LIMITED<->PERPETUAL").
 */
export function computeAdjustedSnapshot(current: FreeAccessSnapshot, action: FreeAccessAdjustmentAction, now: Date): FreeAccessSnapshot {
  switch (action.kind) {
    case 'EXTEND': {
      if (current.mode !== 'TIME_LIMITED' || current.expiresAt === null) throw new FreeAccessAdjustmentError('INVALID_ACTION_FOR_MODE');
      if (!isPositiveIntWithinBound(action.additionalDays)) throw new FreeAccessAdjustmentError('INVALID_INPUT');
      // Extends from the LATER of "now" and the current expiry -- an
      // already-expired account's extension starts counting from today,
      // never silently backdated to add days onto a long-past expiry date.
      const base = Math.max(current.expiresAt.getTime(), now.getTime());
      const expiresAt = new Date(base + action.additionalDays * MS_PER_DAY);
      const durationDays = Math.round((expiresAt.getTime() - current.startedAt.getTime()) / MS_PER_DAY);
      return { ...current, durationDays, expiresAt };
    }
    case 'REDUCE': {
      if (current.mode !== 'TIME_LIMITED' || current.expiresAt === null) throw new FreeAccessAdjustmentError('INVALID_ACTION_FOR_MODE');
      if (!isPositiveIntWithinBound(action.reduceDays)) throw new FreeAccessAdjustmentError('INVALID_INPUT');
      const expiresAt = new Date(current.expiresAt.getTime() - action.reduceDays * MS_PER_DAY);
      const durationDays = Math.round((expiresAt.getTime() - current.startedAt.getTime()) / MS_PER_DAY);
      return { ...current, durationDays, expiresAt };
    }
    case 'CONVERT_TO_PERPETUAL':
      return { ...current, mode: 'PERPETUAL', durationDays: null, expiresAt: null };
    case 'CONVERT_TO_TIME_LIMITED': {
      if (!isPositiveIntWithinBound(action.durationDays)) throw new FreeAccessAdjustmentError('INVALID_INPUT');
      // Restarts the clock from "now" -- converting a PERPETUAL account
      // into a bounded one has no prior expiry to anchor to.
      const expiresAt = new Date(now.getTime() + action.durationDays * MS_PER_DAY);
      return { ...current, mode: 'TIME_LIMITED', durationDays: action.durationDays, expiresAt };
    }
  }
}
