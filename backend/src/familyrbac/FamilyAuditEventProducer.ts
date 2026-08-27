import { randomUUID } from 'node:crypto';
import type { FamilyAuditEventLedger } from './FamilyAuditEventLedger.js';
import type { OpaqueFamilyAuditEventComposer } from './FamilyAuditEventComposer.js';
import type { FamilyAuditRecord } from './FamilyAuditStore.js';

export interface ResolveFamilyParentDevices {
  (familyId: string): Promise<Array<{ deviceId: string; keyEpoch: number }>>;
}

export interface FamilyAuditEventDeliveryOutcome {
  readonly parentDeviceId: string;
  readonly outcome: 'DELIVERED' | 'FAILED';
}

/**
 * Best-effort delivery of one already-recorded FamilyAuditRecord to every
 * one of the family's registered parent devices, as an opaque encrypted
 * envelope. Mirrors alerts/ProtectionAlertProducer.ts's composition chain
 * exactly (device/security signal -> opaque composer -> append-only
 * ledger), applied to a family-wide audit event instead of a per-device
 * protection alert -- see
 * docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md's
 * AUDIT_EVENT_MODEL section for why this reuses that precedent rather than
 * the device-to-device OutboundRelayService path (which requires a real,
 * verified SENDING device session -- there is none here, since the SERVER
 * itself is the event source, not a device forwarding its own message).
 *
 * Never throws: a composition or ledger failure for one parent device must
 * not affect delivery to another, and must never affect (or be affected
 * by) the FamilyAuditRecord this envelope describes, which
 * FamilyAuditService has already durably recorded before calling this.
 */
export class FamilyAuditEventProducer {
  constructor(
    private readonly ledger: FamilyAuditEventLedger,
    private readonly composeOpaquePayload: OpaqueFamilyAuditEventComposer,
    private readonly resolveParentDevices: ResolveFamilyParentDevices,
    private readonly nextEnvelopeId: () => string = () => randomUUID(),
  ) {}

  async deliver(record: FamilyAuditRecord): Promise<FamilyAuditEventDeliveryOutcome[]> {
    let parentDevices: Array<{ deviceId: string; keyEpoch: number }>;
    try {
      parentDevices = await this.resolveParentDevices(record.familyId);
    } catch {
      return [];
    }

    const outcomes: FamilyAuditEventDeliveryOutcome[] = [];
    for (const parentDevice of parentDevices) {
      try {
        const opaquePayload = await this.composeOpaquePayload({
          record,
          parentDeviceId: parentDevice.deviceId,
          keyEpoch: parentDevice.keyEpoch,
        });
        await this.ledger.record({
          envelopeId: this.nextEnvelopeId(),
          familyId: record.familyId,
          parentDeviceId: parentDevice.deviceId,
          keyEpoch: parentDevice.keyEpoch,
          generatedAtUtc: record.occurredAtUtc,
          ...opaquePayload,
        });
        outcomes.push({ parentDeviceId: parentDevice.deviceId, outcome: 'DELIVERED' });
      } catch {
        outcomes.push({ parentDeviceId: parentDevice.deviceId, outcome: 'FAILED' });
      }
    }
    return outcomes;
  }
}
