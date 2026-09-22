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
 * Log the first failure, then every Nth. Bounded at 1/N of the event volume,
 * never fully silent -- see this file's class doc comment for why a
 * once-per-instance flag was wrong.
 */
const LOG_EVERY_NTH_FAILURE = 100;
function shouldLogFailure(occurrences: number): boolean {
  return occurrences === 1 || occurrences % LOG_EVERY_NTH_FAILURE === 0;
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
 * Both logs are BOUNDED but never one-shot: the first failure is logged and
 * then every Nth, with a running count, and the count RESETS on the next success.
 * An earlier version logged once per instance, which independent review showed
 * traded a log flood for something worse -- "once per instance" is "once per
 * PROCESS" here (main.ts constructs exactly one producer for the process
 * lifetime), and because the production composer currently rejects every call,
 * the FIRST audit event after startup would have consumed the budget and left
 * every later failure, including a completely different one such as a real
 * ledger outage, silent forever. Rate-limiting keeps the log bounded at 1/N of
 * the event volume without ever going fully silent, and resetting on success
 * means a recovered-and-failed-again dependency reports immediately rather than
 * waiting out the interval. The return contract is unchanged -- still
 * `[]`/`FAILED`, still never throwing -- so no caller depends on the logging.
 */
export class FamilyAuditEventProducer {
  /** Counted, rate-limited logging -- see this class's doc comment. */
  private recipientResolutionFailureCount = 0;
  private deviceDeliveryFailureCount = 0;

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
      this.recipientResolutionFailureCount += 1;
      if (shouldLogFailure(this.recipientResolutionFailureCount)) {
        console.warn(
          JSON.stringify({
            event: 'family_audit_event_recipient_resolution_failed',
            familyId: record.familyId,
            occurrences: this.recipientResolutionFailureCount,
            message: error instanceof Error ? error.message : String(error),
            note: 'audit events are NOT reaching this family; this is a resolution failure, not an empty recipient list. Logged on the first failure and every Nth thereafter.',
          }),
        );
      }
      return [];
    }
    // Recovered: reset so the next outage reports at occurrence 1 rather than
    // waiting out the interval.
    this.recipientResolutionFailureCount = 0;

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
        this.deviceDeliveryFailureCount += 1;
        if (shouldLogFailure(this.deviceDeliveryFailureCount)) {
          console.warn(
            JSON.stringify({
              event: 'family_audit_event_device_delivery_failed',
              familyId: record.familyId,
              parentDeviceId: parentDevice.deviceId,
              occurrences: this.deviceDeliveryFailureCount,
              message: error instanceof Error ? error.message : String(error),
              note: 'this audit event did not reach this parent device. Logged on the first failure and every Nth thereafter.',
            }),
          );
        }
      }
    }
    return outcomes;
  }
}
