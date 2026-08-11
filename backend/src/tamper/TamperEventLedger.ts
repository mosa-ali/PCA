import type { OpaqueDeviceId, OpaqueFamilyId, TamperEvent } from './types.js';

export type RecordEventResult = { outcome: 'RECORDED' } | { outcome: 'IDEMPOTENT_MATCH' } | { outcome: 'CONFLICT' };

/**
 * Append-only local store for this device's own tamper-event stream (doc
 * 21 Section 2). "Append-only" is enforced by this interface's shape, not
 * merely a convention: there is no update/delete method, mirroring doc 21
 * Section 1's "MUST NOT ... delete data automatically" -- a tamper event,
 * once recorded, can only ever gain an ACKNOWLEDGED/RESOLVED status
 * (recordAcknowledgement/recordResolution below), never be removed.
 *
 * `recordEvent` is idempotent by `eventId`: recording the identical event
 * twice (e.g. a retried local write after a crash) is IDEMPOTENT_MATCH,
 * not a duplicate row -- but recording a DIFFERENT event under an
 * already-used `eventId` is CONFLICT, never a silent overwrite (mirrors
 * src/familyenvelope/MessageIdempotencyLedger.ts's exact discipline).
 */
export interface TamperEventLedger {
  recordEvent(event: TamperEvent): Promise<RecordEventResult>;
  getEvent(eventId: string): Promise<TamperEvent | null>;
  listEventsForDevice(familyId: OpaqueFamilyId, deviceId: OpaqueDeviceId): Promise<TamperEvent[]>;
  /** Marks an existing event ACKNOWLEDGED. Doc 21 Section 2: "A parent can acknowledge an alert but cannot suppress the underlying state" -- callers must never use this as a means to compute a healthier TamperState; TamperStateEngine never reads `status` when deriving state, only `condition`. */
  recordAcknowledgement(eventId: string, acknowledgedByParentId: string): Promise<TamperEvent | null>;
  /** Marks an existing event RESOLVED once its underlying condition has genuinely cleared (e.g. the lost permission was re-granted) -- distinct from acknowledgement, which never claims the condition itself is gone. */
  recordResolution(eventId: string): Promise<TamperEvent | null>;
}

export class InMemoryTamperEventLedger implements TamperEventLedger {
  private readonly events = new Map<string, TamperEvent>();

  async recordEvent(event: TamperEvent): Promise<RecordEventResult> {
    const existing = this.events.get(event.eventId);
    if (existing) {
      return isSameEvent(existing, event) ? { outcome: 'IDEMPOTENT_MATCH' } : { outcome: 'CONFLICT' };
    }
    this.events.set(event.eventId, event);
    return { outcome: 'RECORDED' };
  }

  async getEvent(eventId: string): Promise<TamperEvent | null> {
    return this.events.get(eventId) ?? null;
  }

  async listEventsForDevice(familyId: OpaqueFamilyId, deviceId: OpaqueDeviceId): Promise<TamperEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.familyId === familyId && event.deviceId === deviceId)
      .sort((a, b) => a.localSequence - b.localSequence);
  }

  async recordAcknowledgement(eventId: string, acknowledgedByParentId: string): Promise<TamperEvent | null> {
    const existing = this.events.get(eventId);
    if (!existing) return null;
    if (!acknowledgedByParentId) return existing;
    const updated: TamperEvent = { ...existing, status: 'ACKNOWLEDGED' };
    this.events.set(eventId, updated);
    return updated;
  }

  async recordResolution(eventId: string): Promise<TamperEvent | null> {
    const existing = this.events.get(eventId);
    if (!existing) return null;
    const updated: TamperEvent = { ...existing, status: 'RESOLVED' };
    this.events.set(eventId, updated);
    return updated;
  }
}

function isSameEvent(a: TamperEvent, b: TamperEvent): boolean {
  return (
    a.familyId === b.familyId &&
    a.deviceId === b.deviceId &&
    a.condition === b.condition &&
    a.trustSetEpoch === b.trustSetEpoch &&
    a.keyEpoch === b.keyEpoch &&
    a.detectedAtUtc.getTime() === b.detectedAtUtc.getTime() &&
    a.localSequence === b.localSequence
  );
}
