import { randomUUID } from 'node:crypto';
import { generateProtectionAlert } from './ProtectionAlertGenerator.js';
import type { ProtectionAlertLedger, RecordProtectionAlertResult } from './ProtectionAlertLedger.js';
import type { ProtectionAlertEvent, ProtectionAlertTrigger } from './types.js';

/**
 * The only payload a runtime producer may receive from the trusted device /
 * crypto boundary. There is intentionally no plaintext detail parameter.
 */
export interface OpaqueProtectionAlertPayload {
  readonly encryptedPayloadB64: string;
  readonly nonceB64: string;
}

/**
 * Associated data available to the local crypto composer. This is limited to
 * typed routing/security metadata; family detail is never passed to PCA
 * infrastructure or this producer.
 */
export interface ProtectionAlertCompositionInput {
  readonly alertId: string;
  readonly familyId: string;
  readonly deviceId: string | null;
  readonly parentDeviceId: string;
  readonly trigger: ProtectionAlertTrigger;
  readonly keyEpoch: number;
  readonly generatedAtUtc: Date;
}

export type OpaqueProtectionAlertComposer = (
  input: ProtectionAlertCompositionInput,
) => Promise<OpaqueProtectionAlertPayload>;

export interface ProduceProtectionAlertInput {
  readonly alertId?: string;
  readonly familyId: string;
  readonly deviceId: string | null;
  readonly parentDeviceId: string;
  readonly trigger: ProtectionAlertTrigger;
  readonly keyEpoch: number;
  readonly generatedAtUtc?: Date;
  /** PCA-ADD-ENR-020's "when configured and applicable" switch. */
  readonly alertsEnabled: boolean;
}

export type ProduceProtectionAlertResult =
  | { readonly outcome: 'DISABLED'; readonly event: null }
  | ({ readonly outcome: RecordProtectionAlertResult['outcome']; readonly event: ProtectionAlertEvent });

/**
 * Runtime composition for PCA-ADD-ENR-020:
 *
 *   device/security signal -> opaque local composer -> typed alert generator
 *   -> append-only relay ledger
 *
 * The producer is deliberately injectable at the opaque-composer boundary.
 * PCA infrastructure can route the resulting ciphertext, but cannot create,
 * inspect, or log readable event detail. Disabled alerting short-circuits
 * before the composer is called and produces no empty event.
 */
export class ProtectionAlertProducer {
  private readonly now: () => Date;
  private readonly nextAlertId: () => string;

  constructor(
    private readonly ledger: ProtectionAlertLedger,
    private readonly composeOpaquePayload: OpaqueProtectionAlertComposer,
    now: () => Date = () => new Date(),
    nextAlertId: () => string = () => randomUUID(),
  ) {
    this.now = now;
    this.nextAlertId = nextAlertId;
  }

  async produce(input: ProduceProtectionAlertInput): Promise<ProduceProtectionAlertResult> {
    if (!input.alertsEnabled) return { outcome: 'DISABLED', event: null };

    const alertId = input.alertId ?? this.nextAlertId();
    const generatedAtUtc = input.generatedAtUtc ?? this.now();
    const compositionInput: ProtectionAlertCompositionInput = {
      alertId,
      familyId: input.familyId,
      deviceId: input.deviceId,
      parentDeviceId: input.parentDeviceId,
      trigger: input.trigger,
      keyEpoch: input.keyEpoch,
      generatedAtUtc,
    };
    const opaquePayload = await this.composeOpaquePayload(compositionInput);
    const event = generateProtectionAlert({
      ...compositionInput,
      ...opaquePayload,
      alertsEnabled: true,
    });
    // `alertsEnabled` was checked above; this guard keeps the result total if
    // the generator's conditional policy changes in a future revision.
    if (!event) return { outcome: 'DISABLED', event: null };

    const recorded = await this.ledger.record(event);
    return { outcome: recorded.outcome, event };
  }
}
