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
    return [...this.events.values()]
      .filter((event) => event.familyId === familyId)
      .sort((a, b) => a.generatedAtUtc.getTime() - b.generatedAtUtc.getTime() || a.alertId.localeCompare(b.alertId));
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
