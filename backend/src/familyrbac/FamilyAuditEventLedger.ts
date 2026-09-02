import {
  applyServerCiphertextFeedWindow,
  isServerCiphertextExpired,
} from '../retention/serverCiphertextTtl.js';

export interface FamilyAuditEventEnvelope {
  readonly envelopeId: string;
  readonly familyId: string;
  readonly parentDeviceId: string;
  readonly keyEpoch: number;
  readonly generatedAtUtc: Date;
  /** Opaque bytes produced by FamilyAuditEventProducer's crypto-boundary composer. */
  readonly encryptedPayloadB64: string;
  readonly nonceB64: string;
}

export type RecordFamilyAuditEventResult =
  | { readonly outcome: 'RECORDED' }
  | { readonly outcome: 'IDEMPOTENT_MATCH' }
  | { readonly outcome: 'CONFLICT' };

/** Same shape as ProtectionAlertListOptions -- see that file's doc comment. */
export interface FamilyAuditEventListOptions {
  readonly now?: Date;
  readonly limit?: number;
}

/**
 * Append-only relay-side ledger for opaque family-audit-event envelopes.
 * Mirrors alerts/ProtectionAlertLedger.ts's contract exactly: no
 * acknowledge, decrypt, or plaintext-read operation. Decryption and display
 * state belong to the trusted parent browser after local decryption -- see
 * this session's PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md
 * AUDIT_EVENT_MODEL section for why this table exists instead of a
 * plaintext read endpoint over FamilyAuditRepository.
 *
 * SERVER-CIPHERTEXT TTL: like relay_envelopes and protection_alerts, rows
 * here expire after SERVER_CIPHERTEXT_TTL_MS from generatedAtUtc -- they
 * become invisible to the feed reads and are deleted by purgeExpired. See
 * retention/serverCiphertextTtl.ts.
 */
export interface FamilyAuditEventLedger {
  record(envelope: FamilyAuditEventEnvelope): Promise<RecordFamilyAuditEventResult>;
  /** By id, WITHOUT the expiry filter -- the idempotency/conflict lookup. */
  get(envelopeId: string): Promise<FamilyAuditEventEnvelope | null>;
  /** Non-expired envelopes for the family, oldest-first, bounded. */
  listForFamily(familyId: string, options?: FamilyAuditEventListOptions): Promise<FamilyAuditEventEnvelope[]>;
  /** Non-expired envelopes queued for one parent device, oldest-first, bounded. */
  listForParentDevice(
    familyId: string,
    parentDeviceId: string,
    options?: FamilyAuditEventListOptions,
  ): Promise<FamilyAuditEventEnvelope[]>;
  /** Best-effort cleanup; optional exactly like RelayRepository.purgeExpired. */
  purgeExpired?(now: Date): Promise<number>;
}

export class InMemoryFamilyAuditEventLedger implements FamilyAuditEventLedger {
  private readonly envelopes = new Map<string, FamilyAuditEventEnvelope>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  async record(envelope: FamilyAuditEventEnvelope): Promise<RecordFamilyAuditEventResult> {
    await this.purgeExpired(this.now());
    const existing = this.envelopes.get(envelope.envelopeId);
    if (existing) return sameEnvelope(existing, envelope) ? { outcome: 'IDEMPOTENT_MATCH' } : { outcome: 'CONFLICT' };
    this.envelopes.set(envelope.envelopeId, envelope);
    return { outcome: 'RECORDED' };
  }

  async get(envelopeId: string): Promise<FamilyAuditEventEnvelope | null> {
    return this.envelopes.get(envelopeId) ?? null;
  }

  async listForFamily(familyId: string, options: FamilyAuditEventListOptions = {}): Promise<FamilyAuditEventEnvelope[]> {
    const ascending = [...this.envelopes.values()]
      .filter((envelope) => envelope.familyId === familyId)
      .sort((a, b) => a.generatedAtUtc.getTime() - b.generatedAtUtc.getTime());
    return applyServerCiphertextFeedWindow(ascending, options.now ?? this.now(), options.limit);
  }

  async listForParentDevice(
    familyId: string,
    parentDeviceId: string,
    options: FamilyAuditEventListOptions = {},
  ): Promise<FamilyAuditEventEnvelope[]> {
    const ascending = [...this.envelopes.values()]
      .filter((envelope) => envelope.familyId === familyId && envelope.parentDeviceId === parentDeviceId)
      .sort((a, b) => a.generatedAtUtc.getTime() - b.generatedAtUtc.getTime());
    return applyServerCiphertextFeedWindow(ascending, options.now ?? this.now(), options.limit);
  }

  async purgeExpired(now: Date): Promise<number> {
    let purged = 0;
    for (const [envelopeId, envelope] of this.envelopes) {
      if (isServerCiphertextExpired(envelope.generatedAtUtc, now)) {
        this.envelopes.delete(envelopeId);
        purged++;
      }
    }
    return purged;
  }
}

function sameEnvelope(a: FamilyAuditEventEnvelope, b: FamilyAuditEventEnvelope): boolean {
  return (
    a.familyId === b.familyId &&
    a.parentDeviceId === b.parentDeviceId &&
    a.keyEpoch === b.keyEpoch &&
    a.generatedAtUtc.getTime() === b.generatedAtUtc.getTime() &&
    a.encryptedPayloadB64 === b.encryptedPayloadB64 &&
    a.nonceB64 === b.nonceB64
  );
}
