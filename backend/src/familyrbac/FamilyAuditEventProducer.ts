import { randomUUID } from 'node:crypto';
import { isPlausibleOpaqueId } from '../alerts/policy.js';
import { isFamilyEpochNumber } from '../familyepoch/bounds.js';
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
 * name plus structured identifiers and a bounded failure stage, never exception text
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
    const familyId = record.familyId;
    // The resolver is family-scoped; reject malformed scope before asking it
    // for recipients so invalid input cannot trigger cross-scope work.
    if (!isPlausibleOpaqueId(familyId)) return [];
    const generatedAtMillis = record.occurredAtUtc.getTime();
    const capturedRecord = Object.freeze({ ...record,
      targetScope: Object.freeze({ ...record.targetScope }),
      occurredAtUtc: new Date(generatedAtMillis),
    });
    let parentDevices: Array<{ deviceId: string; keyEpoch: number }>;
    try {
      parentDevices = (await this.resolveParentDevices(familyId)).map(device =>
        Object.freeze({ deviceId: device.deviceId, keyEpoch: device.keyEpoch }));
    } catch {
      this.recipientResolutionFailureCount += 1;
      if (shouldLogFailure(this.recipientResolutionFailureCount)) {
        console.warn(
          JSON.stringify({
            event: 'family_audit_event_recipient_resolution_failed',
            familyId,
            occurrences: this.recipientResolutionFailureCount,
            failureStage: 'RECIPIENT_RESOLUTION',
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
      let failureStage: 'RECIPIENT_VALIDATION' | 'OPAQUE_COMPOSITION' | 'LEDGER_RECORD' = 'RECIPIENT_VALIDATION';
      try {
        if (!isPlausibleOpaqueId(parentDevice.deviceId) || !Number.isFinite(generatedAtMillis) ||
          !isFamilyEpochNumber(parentDevice.keyEpoch)) {
          throw new Error('resolved parent recipient or key epoch is invalid');
        }
        failureStage = 'OPAQUE_COMPOSITION';
        // Each recipient gets its own Date copy; no composer can mutate the
        // original record or alter a later recipient's routing or timestamp.
        const compositionRecord = Object.freeze({ ...capturedRecord, occurredAtUtc: new Date(generatedAtMillis) });
        const opaquePayload = await this.composeOpaquePayload(Object.freeze({
          record: compositionRecord,
          parentDeviceId: parentDevice.deviceId,
          keyEpoch: parentDevice.keyEpoch,
        }));
        if (compositionRecord.occurredAtUtc.getTime() !== generatedAtMillis) {
          throw new Error('audit composition timestamp changed');
        }
        if (opaquePayload === null || typeof opaquePayload !== 'object' || Array.isArray(opaquePayload) ||
          Object.keys(opaquePayload).length !== 2 || !Object.hasOwn(opaquePayload, 'encryptedPayloadB64') ||
          !Object.hasOwn(opaquePayload, 'nonceB64')) throw new Error('invalid opaque audit payload');
        const encryptedPayloadB64 = opaquePayload.encryptedPayloadB64;
        const nonceB64 = opaquePayload.nonceB64;
        // Existing migration 0028 bounds, without inventing a crypto encoding
        // or suite. Its ASCII columns are part of the persisted contract.
        // Never spread a composer object into authoritative metadata.
        if (typeof encryptedPayloadB64 !== 'string' || encryptedPayloadB64.length < 1 || encryptedPayloadB64.length > 4194304 ||
          !isAscii(encryptedPayloadB64) || typeof nonceB64 !== 'string' || nonceB64.length < 1 || nonceB64.length > 64 ||
          !isAscii(nonceB64)) {
          throw new Error('invalid opaque audit payload');
        }
        failureStage = 'LEDGER_RECORD';
        const recordResult = await this.ledger.record({
          envelopeId: this.nextEnvelopeId(),
          familyId,
          parentDeviceId: parentDevice.deviceId,
          keyEpoch: parentDevice.keyEpoch,
          generatedAtUtc: new Date(generatedAtMillis),
          encryptedPayloadB64,
          nonceB64,
        });
        if (recordResult.outcome === 'CONFLICT') {
          throw new Error('family audit envelope id conflicts with existing content');
        }
        if (recordResult.outcome !== 'RECORDED' && recordResult.outcome !== 'IDEMPOTENT_MATCH') {
          throw new Error('family audit ledger returned an unsupported record outcome');
        }
        outcomes.push({ parentDeviceId: parentDevice.deviceId, outcome: 'DELIVERED' });
      } catch {
        outcomes.push({ parentDeviceId: parentDevice.deviceId, outcome: 'FAILED' });
        // The returned array is discarded by FamilyAuditService.record, so
        // without this the failure existed only in a value nobody reads.
        this.deviceDeliveryFailureCount += 1;
        if (shouldLogFailure(this.deviceDeliveryFailureCount)) {
          console.warn(
            JSON.stringify({
              event: 'family_audit_event_device_delivery_failed',
              familyId,
              parentDeviceId: parentDevice.deviceId,
              occurrences: this.deviceDeliveryFailureCount,
              failureStage,
              note: 'this audit event did not reach this parent device. Logged on the first failure and every Nth thereafter.',
            }),
          );
        }
      }
    }
    return outcomes;
  }
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}
