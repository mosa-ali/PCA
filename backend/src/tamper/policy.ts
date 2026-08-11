import type { TamperCondition, TamperSeverity, TamperState } from './types.js';

export const MAX_OPAQUE_ID_LENGTH = 128;
/** Bounds an opaque encrypted detail payload -- a tamper event carries a detail reference, not bulk data (mirrors src/recovery/policy.ts's MAX_ENVELOPE_BYTES rationale). */
export const MAX_DETAIL_CIPHERTEXT_BYTES = 8 * 1024;
export const MIN_TRUST_SET_EPOCH = 1;
export const MIN_LOCAL_SEQUENCE = 0;

/**
 * Doc 21 Section 3's condition/response table, made exhaustive and
 * machine-checked (TypeScript's `Record<TamperCondition, ...>` forces
 * every condition in types.ts to have an entry here -- a condition added
 * to the union without a policy row fails to compile, not silently falls
 * through to a default). Each row cites the doc 21 Section 3 table row it
 * implements.
 *
 * `state` is this condition's OWN contribution when it is the most severe
 * currently-open condition for a device -- TamperStateEngine.computeOverallState
 * resolves the actual precedence when multiple conditions are open
 * simultaneously (e.g. a device that is both DEGRADED and
 * SUSPECTED_TAMPER shows SUSPECTED_TAMPER, never silently the milder
 * one).
 */
export const CONDITION_POLICY: Record<TamperCondition, { state: TamperState; severity: TamperSeverity }> = {
  // "Usage, notification, location, VPN/filter, DPC, or Family Controls
  // authorization lost | ... | Enter DEGRADED; show precise unavailable
  // feature and remediation; send TAMPER_ALERT when connected."
  USAGE_PERMISSION_LOST: { state: 'DEGRADED', severity: 'ACTION_REQUIRED' },
  NOTIFICATION_CAPABILITY_LOST: { state: 'DEGRADED', severity: 'ACTION_REQUIRED' },
  LOCATION_CAPABILITY_LOST: { state: 'DEGRADED', severity: 'ACTION_REQUIRED' },
  VPN_FILTER_CAPABILITY_LOST: { state: 'DEGRADED', severity: 'ACTION_REQUIRED' },
  DPC_AUTHORITY_LOST: { state: 'DEGRADED', severity: 'ACTION_REQUIRED' },

  // "Signed envelope invalid, replayed, expired, wrong epoch, or
  // unauthorized sender | Doc 09 Section 4 independent verification |
  // Reject it, retain last-valid policy, create SECURITY_CRITICAL
  // anomaly." All five share one table row and therefore one
  // state/severity -- they differ only in `condition`/`evidenceClass` for
  // audit detail, not in required response.
  INVALID_ENVELOPE: { state: 'SUSPECTED_TAMPER', severity: 'SECURITY_CRITICAL' },
  REPLAYED_ENVELOPE: { state: 'SUSPECTED_TAMPER', severity: 'SECURITY_CRITICAL' },
  EXPIRED_ENVELOPE: { state: 'SUSPECTED_TAMPER', severity: 'SECURITY_CRITICAL' },
  WRONG_TRUST_OR_KEY_EPOCH: { state: 'SUSPECTED_TAMPER', severity: 'SECURITY_CRITICAL' },
  UNAUTHORIZED_SENDER: { state: 'SUSPECTED_TAMPER', severity: 'SECURITY_CRITICAL' },

  // "Device clock rollback beyond tolerance | Persisted trusted-time
  // high-water mark | Do not extend policy/retention expiry; use the
  // greater trusted bound; request time correction." Flagged for parent
  // attention but, unlike a forged/replayed envelope, a clock issue alone
  // is common and often benign (travel, drift, a dead RTC battery) -- so
  // this condition is SUSPECTED_TAMPER (never silently ignored) at
  // ACTION_REQUIRED rather than SECURITY_CRITICAL, distinguishing "needs
  // a look" from "reject outright," while still never resurrecting
  // expired data/envelopes regardless of severity label.
  CLOCK_ROLLBACK: { state: 'SUSPECTED_TAMPER', severity: 'ACTION_REQUIRED' },

  // "Repeated failed parent step-up authentication | Local rate-limit/
  // audit | Rate-limit and alert authorized parents; never disclose
  // recovery-secret validity." Treated as SECURITY_CRITICAL once the
  // local rate-limit threshold is reached (repeated failures are the
  // caller's concern to count; this module only maps the resulting
  // condition to state/severity).
  REPEATED_FAILED_PARENT_STEP_UP: { state: 'SUSPECTED_TAMPER', severity: 'SECURITY_CRITICAL' },

  // "App signature/package/resource integrity mismatch or unsupported
  // build | Store/platform identity and release metadata verification |
  // Refuse untrusted update/content; retain installed last-valid policy;
  // require supported reinstall/update."
  PACKAGE_RELEASE_INTEGRITY_MISMATCH: { state: 'SUSPECTED_TAMPER', severity: 'SECURITY_CRITICAL' },

  // "Root/jailbreak/debug/hook/virtualization indicator | Defence-in-depth
  // checks | SUSPECTED_TAMPER; retain data and explain reduced assurance.
  // No claim of comprehensive detection." Lower-confidence signal than a
  // cryptographic verification failure, so ACTION_REQUIRED rather than
  // SECURITY_CRITICAL -- still surfaced, never silently dropped, but the
  // severity label itself does not overclaim certainty the underlying
  // heuristic doesn't have (doc 21 Section 1's honesty requirement).
  HARDWARE_KEY_ASSURANCE_LOST: { state: 'SUSPECTED_TAMPER', severity: 'ACTION_REQUIRED' },

  // "Recovery material/device suspected stolen | Parent declaration or
  // recovery event | Revoke affected DSK/DEK, rotate FTS/FDEK and
  // recovery material as applicable." This is the one condition whose
  // required response is itself a recovery transaction, not merely a
  // display state.
  RECOVERY_MATERIAL_OR_DEVICE_SUSPECTED_STOLEN: { state: 'RECOVERY_REQUIRED', severity: 'SECURITY_CRITICAL' },
};

export function isPlausibleOpaqueId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_OPAQUE_ID_LENGTH;
}

export function isPlausibleEpochNumber(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= MIN_TRUST_SET_EPOCH;
}

export function isPlausibleKeyEpoch(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0;
}

export function isPlausibleLocalSequence(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= MIN_LOCAL_SEQUENCE;
}

export function isPlausibleDetailCiphertext(candidate: unknown): candidate is Buffer | null {
  if (candidate === null) return true;
  return Buffer.isBuffer(candidate) && candidate.length > 0 && candidate.length <= MAX_DETAIL_CIPHERTEXT_BYTES;
}
