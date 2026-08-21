import { appScopeIncludes } from '../schedule/policy.js';
import type { AppScope, BonusGrant } from '../schedule/types.js';

/**
 * PCA-FR-130: tracks decided bonus-time grants per child profile so the
 * "overlapping grants" and "revocation" principles have somewhere real to
 * live. Deliberately in-memory only -- see childrequests/ChildRequestRepository.ts's
 * own doc comment: this module's content (which app, how many minutes, for
 * how long) is exactly the kind of family-policy content
 * `contracts/schedule-runtime/SchedulePolicyV1.md` treats as E2EE-only, so
 * this ledger is a same-posture reference/bookkeeping store, never a new
 * central plaintext family-policy shortcut (see this feature's own report
 * for the full "why in-memory" rationale) -- the actual enforcement source
 * of truth is always the device's own persisted SchedulePolicyV1.
 *
 * Overlap policy (PCA-FR-130 "overlapping grants handled sanely"): a NEW
 * grant for a given (childProfileId, appScope) SUPERSEDES -- does not
 * additively stack with -- any still-active prior grant for the SAME
 * appScope for that child. This is a deliberate choice, not an oversight:
 * additive stacking would let repeated approvals silently accumulate into
 * an effectively-unbounded exception, which principle 5 ("amount is
 * bounded") and principle 7 ("cannot become permanent policy silently")
 * both forbid in spirit. Superseding is implemented by capping the prior
 * grant's `expiresAtUtc` to the new grant's `grantedAtUtc` -- never by
 * mutating/deleting the record -- so the prior grant's own history stays
 * intact and its expiry remains a monotonic, absolute-UTC instant exactly
 * like every other BonusGrant (principles 13/14).
 *
 * Revocation (PCA-FR-130 "revocation... implement and test if it's a
 * natural fit") is implemented the SAME way: capping `expiresAtUtc` to the
 * revocation instant (or leaving it alone if it had already expired
 * earlier) -- never deleting the record and never introducing a second
 * "revoked" boolean/field on `BonusGrant` itself (that type is shared,
 * unmodified, verbatim with `schedule/types.ts` and every platform's own
 * port of it; a revoked-and-therefore-already-expired grant is
 * indistinguishable, to `evaluateSchedule`, from a grant that simply ran
 * out -- which is exactly the point: no new state channel, no special case
 * downstream).
 */
export class BonusGrantLedger {
  private readonly grantsByChild = new Map<string, BonusGrant[]>();

  /**
   * Records a newly-decided grant for `childProfileId`, superseding (per
   * this class's own doc comment) any still-active prior grant sharing the
   * same `appScope`. `nowUtc` is the instant the new grant takes effect
   * (ordinarily its own `grantedAtUtc`) -- passed explicitly, never re-read
   * from `Date.now()`, so this stays as deterministic/testable as the rest
   * of this codebase's time-handling.
   *
   * Replay-safe by construction: a grant sharing an already-recorded `id`
   * (e.g. `ChildRequestService.decide()`'s own idempotent-replay path
   * returning the SAME decided request a second time, whose
   * `toBonusGrant()` projection is therefore byte-identical) REPLACES the
   * existing entry in place rather than appending a duplicate -- callers
   * never need to de-duplicate by id themselves, and `listActive` can never
   * return two entries for what is really one decision.
   */
  record(childProfileId: string, grant: BonusGrant, nowUtc: Date): void {
    const existing = this.grantsByChild.get(childProfileId) ?? [];
    const withoutSameId = existing.filter((prior) => prior.id !== grant.id);
    const superseded = withoutSameId.map((prior) => {
      if (prior.expiresAtUtc.getTime() <= nowUtc.getTime()) return prior; // already inactive -- nothing to supersede
      if (!scopesOverlap(prior.appScope, grant.appScope)) return prior;
      return { ...prior, expiresAtUtc: nowUtc };
    });
    this.grantsByChild.set(childProfileId, [...superseded, grant]);
  }

  /** Every grant for `childProfileId` whose window currently covers `nowUtc` -- the exact shape `ScheduleEvaluationInput.bonusGrants` expects, already offline-safe (pure read of already-recorded absolute-UTC instants, no I/O). */
  listActive(childProfileId: string, nowUtc: Date): BonusGrant[] {
    const all = this.grantsByChild.get(childProfileId) ?? [];
    return all.filter((g) => g.grantedAtUtc.getTime() <= nowUtc.getTime() && nowUtc.getTime() < g.expiresAtUtc.getTime());
  }

  /** Every grant ever recorded for `childProfileId`, active or not -- for audit/history views. Returns a defensive copy. */
  listAll(childProfileId: string): BonusGrant[] {
    return [...(this.grantsByChild.get(childProfileId) ?? [])];
  }

  /**
   * Revokes `grantId` for `childProfileId` by capping its `expiresAtUtc` to
   * `nowUtc` (never later, never deleting the record) -- a no-op, returning
   * false, if the grant is unknown OR already inactive (expired or not yet
   * granted-and-superseded away) at `nowUtc`, so a caller cannot use revoke
   * to resurrect or extend a grant that isn't currently active. Returns
   * true only when an actually-active grant was shortened.
   */
  revoke(childProfileId: string, grantId: string, nowUtc: Date): boolean {
    const existing = this.grantsByChild.get(childProfileId);
    if (!existing) return false;
    let revoked = false;
    const next = existing.map((grant) => {
      if (grant.id !== grantId) return grant;
      const isActive = grant.grantedAtUtc.getTime() <= nowUtc.getTime() && nowUtc.getTime() < grant.expiresAtUtc.getTime();
      if (!isActive) return grant;
      revoked = true;
      return { ...grant, expiresAtUtc: nowUtc };
    });
    if (revoked) this.grantsByChild.set(childProfileId, next);
    return revoked;
  }
}

function scopesOverlap(a: AppScope, b: AppScope): boolean {
  if (a === 'ALL' || b === 'ALL') return true;
  return a.apps.some((token) => appScopeIncludes(b, token));
}
