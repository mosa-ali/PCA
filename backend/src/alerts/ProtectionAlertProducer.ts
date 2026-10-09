import { randomUUID } from 'node:crypto';
import { isFamilyEpochNumber } from '../familyepoch/bounds.js';
import { generateProtectionAlert, InvalidProtectionAlertInputError } from './ProtectionAlertGenerator.js';
import {
  isPlausibleEncryptedPayload,
  isPlausibleNonce,
  isPlausibleOpaqueId,
  MAX_ENCRYPTED_PAYLOAD_BYTES,
  MAX_NONCE_BYTES,
  PROTECTION_ALERT_POLICY,
} from './policy.js';
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
    if (!isFamilyEpochNumber(input.keyEpoch)) {
      throw new Error('Protection alert key epoch is outside the supported family epoch range.');
    }

    const alertId = input.alertId ?? this.nextAlertId();
    if (!isPlausibleOpaqueId(alertId)) throw new InvalidProtectionAlertInputError('invalid alertId');
    if (!isPlausibleOpaqueId(input.familyId)) throw new InvalidProtectionAlertInputError('invalid familyId');
    if (input.deviceId !== null && !isPlausibleOpaqueId(input.deviceId)) {
      throw new InvalidProtectionAlertInputError('invalid deviceId');
    }
    if (!isPlausibleOpaqueId(input.parentDeviceId)) throw new InvalidProtectionAlertInputError('invalid parentDeviceId');
    const triggerPolicy = typeof input.trigger === 'string' && Object.hasOwn(PROTECTION_ALERT_POLICY, input.trigger)
      ? PROTECTION_ALERT_POLICY[input.trigger]
      : undefined;
    if (!triggerPolicy) throw new InvalidProtectionAlertInputError('invalid trigger');
    if (triggerPolicy.requiresDeviceId && input.deviceId === null) {
      throw new InvalidProtectionAlertInputError(`trigger ${input.trigger} requires a deviceId`);
    }
    const suppliedTime = input.generatedAtUtc ?? this.now();
    if (!(suppliedTime instanceof Date) || !Number.isFinite(suppliedTime.getTime())) {
      throw new InvalidProtectionAlertInputError('invalid generatedAtUtc');
    }
    const generatedAtMillis = suppliedTime.getTime();
    // Capture primitive routing metadata before any await. Neither caller
    // mutation nor a mutable Date shared with the composer may change storage.
    const routing = Object.freeze({
      alertId,
      familyId: input.familyId,
      deviceId: input.deviceId,
      parentDeviceId: input.parentDeviceId,
      trigger: input.trigger,
      keyEpoch: input.keyEpoch,
    });
    const compositionInput: ProtectionAlertCompositionInput = Object.freeze({
      ...routing, generatedAtUtc: new Date(generatedAtMillis),
    });
    const opaquePayload = await this.composeOpaquePayload(compositionInput);
    if (compositionInput.generatedAtUtc.getTime() !== generatedAtMillis) {
      throw new InvalidProtectionAlertInputError('alert composition timestamp changed');
    }
    if (opaquePayload === null || typeof opaquePayload !== 'object' || Array.isArray(opaquePayload) ||
      Object.keys(opaquePayload).length !== 2 ||
      !Object.hasOwn(opaquePayload, 'encryptedPayloadB64') || !Object.hasOwn(opaquePayload, 'nonceB64')) {
      throw new InvalidProtectionAlertInputError('invalid opaque alert payload');
    }
    const encryptedPayloadB64 = opaquePayload.encryptedPayloadB64;
    const nonceB64 = opaquePayload.nonceB64;
    if (typeof encryptedPayloadB64 !== 'string' || encryptedPayloadB64.length > Math.ceil(MAX_ENCRYPTED_PAYLOAD_BYTES / 3) * 4 ||
      typeof nonceB64 !== 'string' || nonceB64.length > Math.ceil(MAX_NONCE_BYTES / 3) * 4 ||
      !isPlausibleEncryptedPayload(encryptedPayloadB64) || !isPlausibleNonce(nonceB64)) {
      throw new InvalidProtectionAlertInputError('invalid opaque alert payload');
    }
    const event = generateProtectionAlert({
      ...routing,
      generatedAtUtc: new Date(generatedAtMillis),
      encryptedPayloadB64,
      nonceB64,
      alertsEnabled: true,
    });
    // `alertsEnabled` was checked above; this guard keeps the result total if
    // the generator's conditional policy changes in a future revision.
    if (!event) return { outcome: 'DISABLED', event: null };

    const recorded = await this.ledger.record(event);
    return { outcome: recorded.outcome, event };
  }
}
