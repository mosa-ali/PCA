import { PROTECTION_ALERT_POLICY, isPlausibleEncryptedPayload, isPlausibleNonce, isPlausibleOpaqueId } from './policy.js';
import type { ProtectionAlertEvent, ProtectionAlertTrigger } from './types.js';

export class InvalidProtectionAlertInputError extends Error {}

export interface GenerateProtectionAlertInput {
  readonly alertId: string;
  readonly familyId: string;
  readonly deviceId: string | null;
  readonly parentDeviceId: string;
  readonly trigger: ProtectionAlertTrigger;
  readonly keyEpoch: number;
  readonly generatedAtUtc: Date;
  /** Must already be encrypted for the parent device. Plaintext is not accepted. */
  readonly encryptedPayloadB64: string;
  readonly nonceB64: string;
  /** PCA-ADD-ENR-020 is conditional on alerting being configured/applicable. */
  readonly alertsEnabled: boolean;
}

/**
 * Creates the metadata-minimized event that a family-device crypto layer can
 * put into an E2EE alert envelope. This module deliberately has no plaintext
 * detail parameter and never decrypts or interprets `encryptedPayloadB64`.
 * PCA infrastructure therefore sees only the typed event metadata plus opaque
 * ciphertext, never the reason, PIN context, location, URL, or activity data.
 */
export function generateProtectionAlert(input: GenerateProtectionAlertInput): ProtectionAlertEvent | null {
  if (!input.alertsEnabled) return null;
  if (!isPlausibleOpaqueId(input.alertId)) throw new InvalidProtectionAlertInputError('invalid alertId');
  if (!isPlausibleOpaqueId(input.familyId)) throw new InvalidProtectionAlertInputError('invalid familyId');
  if (!isPlausibleOpaqueId(input.parentDeviceId)) throw new InvalidProtectionAlertInputError('invalid parentDeviceId');
  if (input.deviceId !== null && !isPlausibleOpaqueId(input.deviceId)) {
    throw new InvalidProtectionAlertInputError('invalid deviceId');
  }
  if (!Number.isInteger(input.keyEpoch) || input.keyEpoch < 0) {
    throw new InvalidProtectionAlertInputError('invalid keyEpoch');
  }
  if (!(input.generatedAtUtc instanceof Date) || Number.isNaN(input.generatedAtUtc.getTime())) {
    throw new InvalidProtectionAlertInputError('invalid generatedAtUtc');
  }
  if (!isPlausibleEncryptedPayload(input.encryptedPayloadB64)) {
    throw new InvalidProtectionAlertInputError('invalid encryptedPayloadB64');
  }
  if (!isPlausibleNonce(input.nonceB64)) throw new InvalidProtectionAlertInputError('invalid nonceB64');

  const policy = PROTECTION_ALERT_POLICY[input.trigger];
  if (!policy) throw new InvalidProtectionAlertInputError(`unknown trigger: ${String(input.trigger)}`);
  if (policy.requiresDeviceId && input.deviceId === null) {
    throw new InvalidProtectionAlertInputError(`trigger ${input.trigger} requires a deviceId`);
  }

  return {
    alertId: input.alertId,
    familyId: input.familyId,
    deviceId: input.deviceId,
    parentDeviceId: input.parentDeviceId,
    trigger: input.trigger,
    keyEpoch: input.keyEpoch,
    generatedAtUtc: input.generatedAtUtc,
    encryptedPayloadB64: input.encryptedPayloadB64,
    nonceB64: input.nonceB64,
  };
}
