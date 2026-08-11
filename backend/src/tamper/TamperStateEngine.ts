import { CONDITION_POLICY } from './policy.js';
import type { TamperEventLedger, RecordEventResult } from './TamperEventLedger.js';
import type { OpaqueDeviceId, OpaqueFamilyId, TamperCondition, TamperEvent, TamperEvidenceClass, TamperState } from './types.js';

/**
 * Most-severe-first precedence used when several conditions/states could
 * simultaneously apply to one device: REVOKED (trust already excluded)
 * outranks everything, since no lesser state is meaningful once a device
 * is out of the trust set; RECOVERY_REQUIRED outranks an ordinary
 * SUSPECTED_TAMPER because it names a specific required action rather
 * than a general risk signal; a convergence lag (DEVICE_OFFLINE/
 * EPOCH_STALE) outranks a mere capability DEGRADED, since a device that
 * hasn't adopted the current epoch has no new control authority
 * regardless of which capabilities it individually still has. HEALTHY is
 * the floor, never asserted while any other state applies.
 */
const STATE_PRECEDENCE: readonly TamperState[] = [
  'REVOKED',
  'RECOVERY_REQUIRED',
  'SUSPECTED_TAMPER',
  'DEVICE_OFFLINE',
  'EPOCH_STALE',
  'DEGRADED',
  'HEALTHY',
];

export interface EpochConvergenceInput {
  isTransportConnected: boolean;
  localTrustSetEpoch: number;
  localKeyEpoch: number;
  latestKnownTrustSetEpoch: number;
  latestKnownKeyEpoch: number;
  /** Whether this device's own identity is REVOKED in the latest known FTS epoch -- computed by the caller from src/familytrustset, never re-derived here (this module owns no FTS lookup). */
  isDeviceRevokedInLatestKnownEpoch: boolean;
}

/**
 * Pure derivation of a device's epoch-convergence state (doc 21 Section
 * 2's EPOCH_STALE/DEVICE_OFFLINE/REVOKED rows), independent of any
 * detected tamper CONDITION -- a device can be perfectly healthy on every
 * capability check and still be EPOCH_STALE simply because it has not yet
 * reconnected to adopt a newer epoch (doc 09 Section 3.5/PCA-SEC-020: "no
 * atomicity claim"). Deliberately does not reimplement transport/sync
 * state (see src/familysync/connectionState.ts's computeSyncConnectionState,
 * which this function composes with via `isTransportConnected`, not
 * duplicates).
 */
export function computeConvergenceState(input: EpochConvergenceInput): 'HEALTHY' | 'EPOCH_STALE' | 'DEVICE_OFFLINE' | 'REVOKED' {
  if (input.isDeviceRevokedInLatestKnownEpoch) return 'REVOKED';
  const isBehind =
    input.localTrustSetEpoch < input.latestKnownTrustSetEpoch || input.localKeyEpoch < input.latestKnownKeyEpoch;
  if (!isBehind) return 'HEALTHY';
  // Same epoch gap, different label depending on whether the device is
  // actively unable to reach Relay right now (DEVICE_OFFLINE) versus
  // connected but simply hasn't finished/confirmed adopting the newer
  // epoch yet (EPOCH_STALE) -- doc 21 Section 2 groups both under "has no
  // new control authority," but the parent-facing distinction ("pending
  // convergence" vs. "offline") still matters for what remediation makes
  // sense.
  return input.isTransportConnected ? 'EPOCH_STALE' : 'DEVICE_OFFLINE';
}

/**
 * Resolves the single overall TamperState to present for a device, given
 * every currently-OPEN condition (never RESOLVED ones -- see
 * TamperEventLedger) plus its convergence state. Never returns a state
 * milder than the worst individually-true one: this is the mechanism that
 * keeps doc 21 Section 1's "MUST NOT ... silently change policy" promise
 * honest even when multiple signals are in flight -- a DEGRADED
 * capability loss can never mask an open SUSPECTED_TAMPER condition by
 * some form of averaging or last-write-wins.
 */
export function computeOverallState(openConditions: readonly TamperCondition[], convergence: TamperState): TamperState {
  const candidates = [convergence, ...openConditions.map((condition) => CONDITION_POLICY[condition].state)];
  for (const state of STATE_PRECEDENCE) {
    if (candidates.includes(state)) return state;
  }
  return 'HEALTHY';
}

export interface DetectTamperConditionInput {
  eventId: string;
  familyId: OpaqueFamilyId;
  deviceId: OpaqueDeviceId;
  trustSetEpoch: number;
  keyEpoch: number;
  detectedAtUtc: Date;
  condition: TamperCondition;
  evidenceClass: TamperEvidenceClass;
  localSequence: number;
  /** Opaque, already-signed-and-encrypted detail payload (doc 21 Section 2) -- this function never generates or inspects plaintext detail. `null` when the condition needs no detail beyond its typed fields. */
  detailCiphertext: Buffer | null;
}

/**
 * Builds the TamperEvent for a detected condition (severity/state are
 * looked up from CONDITION_POLICY, never passed in by the caller, so a
 * caller cannot accidentally under- or over-state a condition's severity)
 * and records it via the injected ledger. This function NEVER mutates
 * policy, deletes anything, or produces a "blame" field naming the child
 * -- the event records only the condition/device/evidence-class facts
 * doc 21 Section 2 requires.
 */
export async function detectTamperCondition(
  input: DetectTamperConditionInput,
  ledger: TamperEventLedger,
): Promise<{ event: TamperEvent; recordResult: RecordEventResult }> {
  const policy = CONDITION_POLICY[input.condition];
  const event: TamperEvent = {
    eventId: input.eventId,
    familyId: input.familyId,
    deviceId: input.deviceId,
    trustSetEpoch: input.trustSetEpoch,
    keyEpoch: input.keyEpoch,
    detectedAtUtc: input.detectedAtUtc,
    condition: input.condition,
    severity: policy.severity,
    evidenceClass: input.evidenceClass,
    localSequence: input.localSequence,
    status: 'OPEN',
    detailCiphertext: input.detailCiphertext,
  };
  const recordResult = await ledger.recordEvent(event);
  return { event, recordResult };
}

/**
 * The set of conditions currently OPEN for a device, derived from its
 * event history -- a condition counts as open from its most recent
 * OPEN/ACKNOWLEDGED event until a later RESOLVED event for that same
 * condition. Acknowledgement never removes a condition from this set
 * (doc 21 Section 2: "cannot suppress the underlying state") -- only an
 * explicit resolution can.
 */
export function computeOpenConditions(events: readonly TamperEvent[]): TamperCondition[] {
  const latestStatusByCondition = new Map<TamperCondition, TamperEvent>();
  for (const event of [...events].sort((a, b) => a.localSequence - b.localSequence)) {
    latestStatusByCondition.set(event.condition, event);
  }
  return [...latestStatusByCondition.values()].filter((event) => event.status !== 'RESOLVED').map((event) => event.condition);
}
