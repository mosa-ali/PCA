/**
 * Revision monotonicity and idempotency guard (doc 36 section 10).
 * `policyRevision` is the sole authority on ordering -- localized text is
 * never used as revision identity.
 */

export type RevisionOutcome =
  | { readonly kind: 'ACCEPTED'; readonly newRevision: number }
  | { readonly kind: 'DUPLICATE_NO_OP'; readonly operationId: string }
  | { readonly kind: 'STALE_REJECTED'; readonly expectedRevision: number; readonly currentRevision: number };

export class RevisionGuard {
  private readonly appliedOperationIds = new Set<string>();

  constructor(private currentRevision: number) {}

  evaluate(operationId: string, expectedRevision: number, newRevision: number): RevisionOutcome {
    if (this.appliedOperationIds.has(operationId)) {
      return { kind: 'DUPLICATE_NO_OP', operationId };
    }
    if (expectedRevision !== this.currentRevision) {
      return { kind: 'STALE_REJECTED', expectedRevision, currentRevision: this.currentRevision };
    }
    if (!(newRevision > this.currentRevision)) {
      return { kind: 'STALE_REJECTED', expectedRevision, currentRevision: this.currentRevision };
    }
    return { kind: 'ACCEPTED', newRevision };
  }

  commit(operationId: string, newRevision: number): void {
    this.appliedOperationIds.add(operationId);
    this.currentRevision = newRevision;
  }

  get revision(): number {
    return this.currentRevision;
  }
}
