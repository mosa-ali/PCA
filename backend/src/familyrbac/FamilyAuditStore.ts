import { randomUUID } from 'node:crypto';
import type { ActionId, CorrelationId, FamilyRole, OpaqueMemberId, ParentOperation, ReasonCategory, TargetScope } from './types.js';

export type AuditResultStatus = 'SUCCESS' | 'DENIED' | 'FAILED' | 'PENDING';

/**
 * doc 18 Section 5's exact field list. `freeTextNote` is deliberately
 * bounded/optional and this store's InMemory implementation never
 * transmits it anywhere -- Section 5: "Free text is minimized,
 * length-limited, sanitized, E2EE only, and excluded from push/email/
 * logging." No URL, location, activity detail, or recovery secret field
 * exists on this type at all (Section 6's audit assertion), so a caller
 * cannot smuggle one in even by mistake.
 */
export interface FamilyAuditRecord {
  eventId: string;
  familyId: string;
  actionType: ParentOperation | 'ROLE_INVITATION' | 'ROLE_ACCEPT' | 'ROLE_REVOKE' | 'STEP_UP_SUCCESS' | 'STEP_UP_FAILURE' | 'DEVICE_LIFECYCLE_TRANSITION' | 'RECOVERY_EVENT' | 'DENIED_AUTHORIZATION_ATTEMPT';
  actorDeviceId: string;
  actorMemberId: OpaqueMemberId | null;
  targetScope: TargetScope;
  authorizationRole: FamilyRole | null;
  trustSetEpoch: number;
  policyRevision: number | null;
  occurredAtUtc: Date;
  clientMonotonicSequence: number | null;
  resultStatus: AuditResultStatus;
  targetAcknowledgementCount: number;
  reasonCategory: ReasonCategory | null;
  correlationId: CorrelationId | null;
  actionId: ActionId | null;
  /** Bounded, sanitized free text only -- see MAX_AUDIT_NOTE_LENGTH in policy.ts. Never rendered in push/email/plaintext logs by this module. */
  freeTextNote: string | null;
}

export const MAX_AUDIT_NOTE_LENGTH = 280;

/** Append-only, family-local/E2EE store -- never a PCA server audit log, never activity plaintext (doc 18 Section 5/6). Only an in-memory reference implementation exists here; real persistence is family-device-local storage outside this module's scope. */
export interface FamilyAuditRepository {
  append(record: FamilyAuditRecord): Promise<void>;
  listForFamily(familyId: string): Promise<FamilyAuditRecord[]>;
}

export class InMemoryFamilyAuditRepository implements FamilyAuditRepository {
  private readonly records: FamilyAuditRecord[] = [];

  async append(record: FamilyAuditRecord): Promise<void> {
    this.records.push(record);
  }

  async listForFamily(familyId: string): Promise<FamilyAuditRecord[]> {
    return this.records.filter((r) => r.familyId === familyId);
  }
}

/** Minimal shape FamilyAuditService needs from FamilyAuditEventProducer -- avoids this file importing familyrbac/FamilyAuditEventProducer.ts's concrete class or its ledger/composer dependencies directly. */
export interface FamilyAuditEventDelivery {
  deliver(record: FamilyAuditRecord): Promise<unknown>;
}

export class FamilyAuditService {
  private readonly repository: FamilyAuditRepository;
  private readonly now: () => Date;
  /**
   * PCA product-completion programme, Writer P0-D: late-bound, optional
   * delivery hook (see AUDIT_EVENT_MODEL in
   * docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md).
   * Deliberately settable AFTER construction via configureDelivery(),
   * rather than a constructor parameter, because main.ts constructs the
   * single SHARED FamilyAuditService instance (used by every family-rbac
   * event source: invitation/enrollment/pairing/device/recovery/parent
   * authorization/retention/family-members/child-policy) before the
   * family-trust-set-attestation-backed parent-device resolver its
   * delivery producer depends on exists. Every existing holder of this
   * shared instance sees delivery start working the moment
   * configureDelivery() is called once, with no other code path changed.
   * Never required: when unset, record() behaves exactly as it always has
   * (append-only in-memory/durable audit record, no delivery attempt) --
   * this matches how every other test/caller of this class that doesn't
   * care about delivery continues to work unchanged.
   */
  private delivery: FamilyAuditEventDelivery | null = null;

  constructor(repository: FamilyAuditRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  configureDelivery(delivery: FamilyAuditEventDelivery): void {
    this.delivery = delivery;
  }

  async record(input: Omit<FamilyAuditRecord, 'eventId' | 'occurredAtUtc' | 'freeTextNote'> & { freeTextNote?: string | null }): Promise<FamilyAuditRecord> {
    const freeTextNote =
      input.freeTextNote != null && input.freeTextNote.length > 0
        ? input.freeTextNote.slice(0, MAX_AUDIT_NOTE_LENGTH)
        : null;
    const record: FamilyAuditRecord = {
      ...input,
      freeTextNote,
      eventId: randomUUID(),
      occurredAtUtc: this.now(),
    };
    await this.repository.append(record);
    // Best-effort/non-blocking, matching runtimeSyncRoutes.ts's
    // emitProtectionDegradedAlert precedent exactly: a delivery failure
    // must never affect (or be affected by) the audit record itself, which
    // has already durably committed above.
    if (this.delivery) {
      try {
        await this.delivery.deliver(record);
      } catch {
        // Delivery is deliberately non-blocking -- see this field's own doc comment.
      }
    }
    return record;
  }
}
