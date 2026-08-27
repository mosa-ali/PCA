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

/**
 * Append-only relay-side ledger for opaque family-audit-event envelopes.
 * Mirrors alerts/ProtectionAlertLedger.ts's contract exactly: no
 * acknowledge, decrypt, or plaintext-read operation. Decryption and display
 * state belong to the trusted parent browser after local decryption -- see
 * this session's PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md
 * AUDIT_EVENT_MODEL section for why this table exists instead of a
 * plaintext read endpoint over FamilyAuditRepository.
 */
export interface FamilyAuditEventLedger {
  record(envelope: FamilyAuditEventEnvelope): Promise<RecordFamilyAuditEventResult>;
  get(envelopeId: string): Promise<FamilyAuditEventEnvelope | null>;
  listForFamily(familyId: string): Promise<FamilyAuditEventEnvelope[]>;
  listForParentDevice(familyId: string, parentDeviceId: string): Promise<FamilyAuditEventEnvelope[]>;
}

export class InMemoryFamilyAuditEventLedger implements FamilyAuditEventLedger {
  private readonly envelopes = new Map<string, FamilyAuditEventEnvelope>();

  async record(envelope: FamilyAuditEventEnvelope): Promise<RecordFamilyAuditEventResult> {
    const existing = this.envelopes.get(envelope.envelopeId);
    if (existing) return sameEnvelope(existing, envelope) ? { outcome: 'IDEMPOTENT_MATCH' } : { outcome: 'CONFLICT' };
    this.envelopes.set(envelope.envelopeId, envelope);
    return { outcome: 'RECORDED' };
  }

  async get(envelopeId: string): Promise<FamilyAuditEventEnvelope | null> {
    return this.envelopes.get(envelopeId) ?? null;
  }

  async listForFamily(familyId: string): Promise<FamilyAuditEventEnvelope[]> {
    return [...this.envelopes.values()]
      .filter((envelope) => envelope.familyId === familyId)
      .sort((a, b) => a.generatedAtUtc.getTime() - b.generatedAtUtc.getTime());
  }

  async listForParentDevice(familyId: string, parentDeviceId: string): Promise<FamilyAuditEventEnvelope[]> {
    return (await this.listForFamily(familyId)).filter((envelope) => envelope.parentDeviceId === parentDeviceId);
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
