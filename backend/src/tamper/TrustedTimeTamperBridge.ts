import { evaluateDeviceClock, advanceHighWaterMark, type ClockEvaluation } from './TrustedTimeHighWaterMark.js';
import { detectTamperCondition } from './TamperStateEngine.js';
import type { TamperEventLedger, RecordEventResult } from './TamperEventLedger.js';
import type { OpaqueDeviceId, OpaqueFamilyId, TamperEvent } from './types.js';

export interface TrustedTimeTamperBridgeInput {
  persistedHighWaterMarkUtc: Date | null;
  observedNowUtc: Date;
  eventId: string;
  familyId: OpaqueFamilyId;
  deviceId: OpaqueDeviceId;
  trustSetEpoch: number;
  keyEpoch: number;
  localSequence: number;
  /** Already encrypted detail, if the caller has one; this bridge never creates plaintext detail. */
  detailCiphertext?: Buffer | null;
}

export interface TrustedTimeTamperBridgeResult {
  clockEvaluation: ClockEvaluation;
  nextHighWaterMarkUtc: Date;
  event: TamperEvent | null;
  recordResult: RecordEventResult | null;
}

/**
 * Connects the pure trusted-time check to the append-only tamper ledger.
 * Rollback is a risk signal: this records only the typed CLOCK_ROLLBACK
 * condition and never changes family policy, deletes data, or grants an
 * enforcement decision. The event timestamp uses pinned trusted time so a
 * rolled-back device clock cannot make the audit record regress.
 */
export async function evaluateTrustedTimeAndRecordTamper(
  input: TrustedTimeTamperBridgeInput,
  ledger: TamperEventLedger,
): Promise<TrustedTimeTamperBridgeResult> {
  const clockEvaluation = evaluateDeviceClock(input.persistedHighWaterMarkUtc, input.observedNowUtc);
  const nextHighWaterMarkUtc = advanceHighWaterMark(input.persistedHighWaterMarkUtc, clockEvaluation);
  if (!clockEvaluation.isRollbackDetected) {
    return { clockEvaluation, nextHighWaterMarkUtc, event: null, recordResult: null };
  }

  const recorded = await detectTamperCondition({
    eventId: input.eventId,
    familyId: input.familyId,
    deviceId: input.deviceId,
    trustSetEpoch: input.trustSetEpoch,
    keyEpoch: input.keyEpoch,
    detectedAtUtc: clockEvaluation.trustedNowUtc,
    condition: 'CLOCK_ROLLBACK',
    evidenceClass: 'TRUSTED_TIME_HIGH_WATER_MARK',
    localSequence: input.localSequence,
    detailCiphertext: input.detailCiphertext ?? null,
  }, ledger);

  return {
    clockEvaluation,
    nextHighWaterMarkUtc,
    event: recorded.event,
    recordResult: recorded.recordResult,
  };
}
