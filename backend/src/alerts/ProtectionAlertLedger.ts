import type { ProtectionAlertEvent } from './types.js';
import {
  applyServerCiphertextFeedWindow,
  isServerCiphertextExpired,
} from '../retention/serverCiphertextTtl.js';

export type RecordProtectionAlertResult =
  | { readonly outcome: 'RECORDED' }
  | { readonly outcome: 'IDEMPOTENT_MATCH' }
  | { readonly outcome: 'CONFLICT' };

/**
 * Read options shared by both feed queries.
 *
 * `now` exists so expiry is evaluated against an injectable clock (every
 * other time-sensitive service in this codebase does the same); `limit` is
 * clamped by resolveServerCiphertextFeedLimit -- a caller may lower the
 * bound but never raise it above the server's own maximum.
 */
export interface ProtectionAlertListOptions {
  readonly now?: Date;
  readonly limit?: number;
}

/**
 * Append-only relay-side ledger for opaque alert envelopes. It has no
 * acknowledge, decrypt, or plaintext-read operation. Parent acknowledgement
 * and display state belong to the trusted parent device after decryption.
 *
 * SERVER-CIPHERTEXT TTL: like relay_envelopes, rows here expire. A row past
 * SERVER_CIPHERTEXT_TTL_MS from its generatedAtUtc is invisible to both
 * feed reads and is eventually deleted by purgeExpired. See
 * retention/serverCiphertextTtl.ts for why this is the relay's existing
 * precedent applied to the same class of store, not a new policy.
 */
export interface ProtectionAlertLedger {
  record(event: ProtectionAlertEvent): Promise<RecordProtectionAlertResult>;
  /**
   * By alert id, WITHOUT the expiry filter: this is the idempotency /
   * conflict-detection lookup, and the primary key still exists until the
   * row is actually purged. Mirrors MySqlRelayRepository.findForRecipient,
   * which likewise leaves expiry judgement to the layer above.
   */
  get(alertId: string): Promise<ProtectionAlertEvent | null>;
  /** Non-expired alerts for the family, oldest-first, bounded. */
  listForFamily(familyId: string, options?: ProtectionAlertListOptions): Promise<ProtectionAlertEvent[]>;
  /** Non-expired alerts queued for one parent device, oldest-first, bounded. */
  listForParentDevice(
    familyId: string,
    parentDeviceId: string,
    options?: ProtectionAlertListOptions,
  ): Promise<ProtectionAlertEvent[]>;
  /**
   * Best-effort operational cleanup; expired ciphertext must not accumulate
   * in server storage. Optional exactly like RelayRepository.purgeExpired,
   * so a narrower test double need not implement it.
   */
  purgeExpired?(now: Date): Promise<number>;
}

export class InMemoryProtectionAlertLedger implements ProtectionAlertLedger {
  private readonly events = new Map<string, ProtectionAlertEvent>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  async record(event: ProtectionAlertEvent): Promise<RecordProtectionAlertResult> {
    // Best-effort housekeeping on the write path, mirroring
    // RelayService's own purge-on-operation discipline.
    await this.purgeExpired(this.now());
    const existing = this.events.get(event.alertId);
    if (existing) return sameEvent(existing, event) ? { outcome: 'IDEMPOTENT_MATCH' } : { outcome: 'CONFLICT' };
    this.events.set(event.alertId, event);
    return { outcome: 'RECORDED' };
  }

  async get(alertId: string): Promise<ProtectionAlertEvent | null> {
    return this.events.get(alertId) ?? null;
  }

  async listForFamily(familyId: string, options: ProtectionAlertListOptions = {}): Promise<ProtectionAlertEvent[]> {
    // Sort by timestamp only, relying on Array.prototype.sort's ES2019
    // stability guarantee to preserve `this.events`' own Map-insertion
    // (i.e. real record()-call) order for any tie -- alertId is a random
    // UUID (ProtectionAlertProducer's default nextAlertId), so breaking
    // ties with it previously made same-millisecond ordering effectively
    // random rather than chronological. Same-millisecond ties are the
    // common case in tests with a fixed clock, and a real possibility in
    // production under rapid alerts, so this was a genuine ordering bug,
    // not just a test-only concern.
    const ascending = [...this.events.values()]
      .filter((event) => event.familyId === familyId)
      .sort((a, b) => a.generatedAtUtc.getTime() - b.generatedAtUtc.getTime());
    return applyServerCiphertextFeedWindow(ascending, options.now ?? this.now(), options.limit);
  }

  async listForParentDevice(
    familyId: string,
    parentDeviceId: string,
    options: ProtectionAlertListOptions = {},
  ): Promise<ProtectionAlertEvent[]> {
    const ascending = [...this.events.values()]
      .filter((event) => event.familyId === familyId && event.parentDeviceId === parentDeviceId)
      .sort((a, b) => a.generatedAtUtc.getTime() - b.generatedAtUtc.getTime());
    return applyServerCiphertextFeedWindow(ascending, options.now ?? this.now(), options.limit);
  }

  async purgeExpired(now: Date): Promise<number> {
    let purged = 0;
    for (const [alertId, event] of this.events) {
      if (isServerCiphertextExpired(event.generatedAtUtc, now)) {
        this.events.delete(alertId);
        purged++;
      }
    }
    return purged;
  }
}

function sameEvent(a: ProtectionAlertEvent, b: ProtectionAlertEvent): boolean {
  return (
    a.familyId === b.familyId &&
    a.deviceId === b.deviceId &&
    a.parentDeviceId === b.parentDeviceId &&
    a.trigger === b.trigger &&
    a.keyEpoch === b.keyEpoch &&
    a.generatedAtUtc.getTime() === b.generatedAtUtc.getTime() &&
    a.encryptedPayloadB64 === b.encryptedPayloadB64 &&
    a.nonceB64 === b.nonceB64
  );
}
