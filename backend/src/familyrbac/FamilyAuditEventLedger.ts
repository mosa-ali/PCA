import { Buffer } from 'node:buffer';
import {
  applyServerCiphertextFeedWindow,
  isPersistableServerCiphertextWindow,
  isServerCiphertextExpired,
  resolveServerCiphertextFeedLimit,
} from '../retention/serverCiphertextTtl.js';
import { isFamilyEpochNumber } from '../familyepoch/bounds.js';

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
  /** Exclusive continuation tuple for the oldest-first parent-device feed. */
  readonly cursor?: FamilyAuditEventCursor;
}

export interface FamilyAuditEventCursor {
  readonly generatedAtUtc: Date;
  readonly envelopeId: string;
}

const FAMILY_AUDIT_CURSOR_VERSION = 1;

/** Canonical opaque continuation token for the recipient-scoped audit feed. */
export function encodeFamilyAuditEventCursor(cursor: FamilyAuditEventCursor): string {
  const generatedAtUtc = cursor.generatedAtUtc.toISOString();
  return Buffer.from(JSON.stringify({ v: FAMILY_AUDIT_CURSOR_VERSION, generatedAtUtc, envelopeId: cursor.envelopeId }), 'utf8')
    .toString('base64url');
}

/** Strictly accepts only the versioned, canonical token emitted above. */
export function decodeFamilyAuditEventCursor(value: unknown): FamilyAuditEventCursor | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(json, 'utf8').toString('base64url') !== value) return null;
    const decoded: unknown = JSON.parse(json);
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
    const record = decoded as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'envelopeId,generatedAtUtc,v' || record.v !== FAMILY_AUDIT_CURSOR_VERSION) return null;
    if (typeof record.generatedAtUtc !== 'string' || typeof record.envelopeId !== 'string') return null;
    const generatedAtUtc = new Date(record.generatedAtUtc);
    if (!Number.isFinite(generatedAtUtc.getTime()) || generatedAtUtc.toISOString() !== record.generatedAtUtc) return null;
    if (record.envelopeId.length < 1 || Array.from(record.envelopeId).length > 200 || /[\uD800-\uDFFF]/u.test(record.envelopeId)) return null;
    const cursor = { generatedAtUtc, envelopeId: record.envelopeId };
    return encodeFamilyAuditEventCursor(cursor) === value ? cursor : null;
  } catch {
    return null;
  }
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
  /** Newest bounded non-expired family window, returned in ascending order. */
  listForFamily(familyId: string, options?: FamilyAuditEventListOptions): Promise<FamilyAuditEventEnvelope[]>;
  /** Oldest-first, keyset-paged non-expired envelopes queued for one parent device. */
  listForParentDevice(
    familyId: string,
    parentDeviceId: string,
    keyEpoch: number,
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
    if (!isPersistableServerCiphertextWindow(envelope.generatedAtUtc)) {
      throw new RangeError('Family audit generatedAtUtc is outside the persistable MySQL DATETIME(3) retained-window range.');
    }
    if (!isFamilyEpochNumber(envelope.keyEpoch)) {
      throw new Error('Family audit key epoch is outside the supported family epoch range.');
    }
    // Capture all caller-owned values before the first await. The expiry
    // cleanup below yields; retaining the input object would let a caller
    // change the append-only recipient/content while record() is pending.
    const captured = cloneEnvelope(envelope);
    const now = this.now();
    if (isServerCiphertextExpired(captured.generatedAtUtc, now)) {
      throw new RangeError('Family audit event is already outside the server ciphertext retention window.');
    }
    await this.purgeExpired(now);
    // Cleanup yields; recheck after it so an event crossing TTL during the
    // await cannot be inserted after its feed visibility has already ended.
    if (isServerCiphertextExpired(captured.generatedAtUtc, this.now())) {
      throw new RangeError('Family audit event is already outside the server ciphertext retention window.');
    }
    const existing = this.envelopes.get(captured.envelopeId);
    if (existing) return sameEnvelope(existing, captured) ? { outcome: 'IDEMPOTENT_MATCH' } : { outcome: 'CONFLICT' };
    this.envelopes.set(captured.envelopeId, captured);
    return { outcome: 'RECORDED' };
  }

  async get(envelopeId: string): Promise<FamilyAuditEventEnvelope | null> {
    const envelope = this.envelopes.get(envelopeId);
    return envelope ? cloneEnvelope(envelope) : null;
  }

  async listForFamily(familyId: string, options: FamilyAuditEventListOptions = {}): Promise<FamilyAuditEventEnvelope[]> {
    const ascending = [...this.envelopes.values()]
      .filter((envelope) => envelope.familyId === familyId)
      .sort(compareEnvelopeFeedOrder);
    return applyServerCiphertextFeedWindow(ascending, options.now ?? this.now(), options.limit).map(cloneEnvelope);
  }

  async listForParentDevice(
    familyId: string,
    parentDeviceId: string,
    keyEpoch: number,
    options: FamilyAuditEventListOptions = {},
  ): Promise<FamilyAuditEventEnvelope[]> {
    if (!isFamilyEpochNumber(keyEpoch, 1)) {
      throw new Error('Family audit key epoch is outside the supported family epoch range.');
    }
    const cursor = options.cursor;
    const now = options.now ?? this.now();
    const ascending = [...this.envelopes.values()]
      .filter((envelope) => envelope.familyId === familyId && envelope.parentDeviceId === parentDeviceId && envelope.keyEpoch === keyEpoch)
      .filter((envelope) => !cursor || compareEnvelopeFeedOrder(envelope, cursor) > 0)
      .sort(compareEnvelopeFeedOrder);
    const visible = ascending.filter((envelope) => !isServerCiphertextExpired(envelope.generatedAtUtc, now));
    return visible.slice(0, resolveServerCiphertextFeedLimit(options.limit)).map(cloneEnvelope);
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

function cloneEnvelope(envelope: FamilyAuditEventEnvelope): FamilyAuditEventEnvelope {
  return {
    ...envelope,
    generatedAtUtc: new Date(envelope.generatedAtUtc.getTime()),
  };
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

/** Mirrors MySqlFamilyAuditEventLedger's generated_at_utc, envelope_id ordering (binary ID collation). */
function compareEnvelopeFeedOrder(
  a: Pick<FamilyAuditEventEnvelope, 'generatedAtUtc' | 'envelopeId'>,
  b: Pick<FamilyAuditEventEnvelope, 'generatedAtUtc' | 'envelopeId'>,
): number {
  const byGeneratedAt = a.generatedAtUtc.getTime() - b.generatedAtUtc.getTime();
  if (byGeneratedAt !== 0) return byGeneratedAt;
  return Buffer.compare(Buffer.from(a.envelopeId, 'utf8'), Buffer.from(b.envelopeId, 'utf8'));
}
