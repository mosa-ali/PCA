import type { ProtectionAlertEvent } from './types.js';

export type RecordProtectionAlertResult =
  | { readonly outcome: 'RECORDED' }
  | { readonly outcome: 'IDEMPOTENT_MATCH' }
  | { readonly outcome: 'CONFLICT' };

/**
 * Append-only relay-side ledger for opaque alert envelopes. It has no
 * acknowledge, decrypt, or plaintext-read operation. Parent acknowledgement
 * and display state belong to the trusted parent device after decryption.
 */
export interface ProtectionAlertLedger {
  record(event: ProtectionAlertEvent): Promise<RecordProtectionAlertResult>;
  get(alertId: string): Promise<ProtectionAlertEvent | null>;
  listForFamily(familyId: string): Promise<ProtectionAlertEvent[]>;
  listForParentDevice(familyId: string, parentDeviceId: string): Promise<ProtectionAlertEvent[]>;
}

export class InMemoryProtectionAlertLedger implements ProtectionAlertLedger {
  private readonly events = new Map<string, ProtectionAlertEvent>();

  async record(event: ProtectionAlertEvent): Promise<RecordProtectionAlertResult> {
    const existing = this.events.get(event.alertId);
    if (existing) return sameEvent(existing, event) ? { outcome: 'IDEMPOTENT_MATCH' } : { outcome: 'CONFLICT' };
    this.events.set(event.alertId, event);
    return { outcome: 'RECORDED' };
  }

  async get(alertId: string): Promise<ProtectionAlertEvent | null> {
    return this.events.get(alertId) ?? null;
  }

  async listForFamily(familyId: string): Promise<ProtectionAlertEvent[]> {
    // Sort by timestamp only, relying on Array.prototype.sort's ES2019
    // stability guarantee to preserve `this.events`' own Map-insertion
    // (i.e. real record()-call) order for any tie -- alertId is a random
    // UUID (ProtectionAlertProducer's default nextAlertId), so breaking
    // ties with it previously made same-millisecond ordering effectively
    // random rather than chronological. Same-millisecond ties are the
    // common case in tests with a fixed clock, and a real possibility in
    // production under rapid alerts, so this was a genuine ordering bug,
    // not just a test-only concern.
    return [...this.events.values()]
      .filter((event) => event.familyId === familyId)
      .sort((a, b) => a.generatedAtUtc.getTime() - b.generatedAtUtc.getTime());
  }

  async listForParentDevice(familyId: string, parentDeviceId: string): Promise<ProtectionAlertEvent[]> {
    return (await this.listForFamily(familyId)).filter((event) => event.parentDeviceId === parentDeviceId);
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
