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
 *
 * BEST-EFFORT IS NOT THE SAME AS INVISIBLE, and this class used to conflate
 * them. Returning `[]` when `resolveParentDevices` threw made "the resolver is
 * down" BYTE-IDENTICAL to "this family has no parent devices": the audit event
 * reached nobody and nothing anywhere recorded why. The per-device `FAILED`
 * outcome had the same problem from the other end -- `FamilyAuditService.record`
 * discards the returned array, so a compose/ledger failure for every device was
 * equally silent. Both now emit a bounded structured warning, following the
 * FABLE-A013 precedent in alerts/AlertComposeFailureLogger.ts (a bounded event
 * name plus structured identifiers and `error.message`, never a raw error object
 * or any record content -- notably NOT the audit record itself, whose free text
 * doc 18 Section 5 requires to stay E2EE-only and out of infrastructure logs).
 *
 * Both logs are emitted ONCE PER INSTANCE rather than once per record: a
 * resolver or ledger outage would otherwise produce one line per audit event for
 * the duration of the outage, turning a diagnosable fault into a log flood. The
 * return contract is unchanged -- still `[]`/`FAILED`, still never throwing --
 * so no caller's behaviour depends on the log.
 */
export class FamilyAuditEventProducer {
  /** Bounded, once-per-instance logging -- see this class's doc comment. */
  private recipientResolutionFailureLogged = false;
  private deviceDeliveryFailureLogged = false;

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
    } catch (error) {
      if (!this.recipientResolutionFailureLogged) {
        this.recipientResolutionFailureLogged = true;
        console.warn(
          JSON.stringify({
            event: 'family_audit_event_recipient_resolution_failed',
            familyId: record.familyId,
            message: error instanceof Error ? error.message : String(error),
            note: 'audit events are NOT reaching this family; this is a resolution failure, not an empty recipient list. Logged once per producer instance.',
          }),
        );
      }
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
      } catch (error) {
        outcomes.push({ parentDeviceId: parentDevice.deviceId, outcome: 'FAILED' });
        // The returned array is discarded by FamilyAuditService.record, so
        // without this the failure existed only in a value nobody reads.
        if (!this.deviceDeliveryFailureLogged) {
          this.deviceDeliveryFailureLogged = true;
          console.warn(
            JSON.stringify({
              event: 'family_audit_event_device_delivery_failed',
              familyId: record.familyId,
              parentDeviceId: parentDevice.deviceId,
              message: error instanceof Error ? error.message : String(error),
              note: 'this audit event did not reach this parent device. Logged once per producer instance; further per-device failures are suppressed.',
            }),
          );
        }
      }
    }
    return outcomes;
  }
}
