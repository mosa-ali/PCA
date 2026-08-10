export const MAX_OPAQUE_ID_LENGTH = 128;
export const MAX_SIGNATURE_LENGTH = 512;
export const MIN_TRUST_SET_EPOCH = 1;
/** A family of any real size stays well under this; bounds a malformed/abusive epoch cheaply before any signature check. */
export const MAX_ENTRIES_PER_EPOCH = 64;

const FAMILY_ROLES = new Set(['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD']);
const ENTRY_STATUSES = new Set([
  'ACTIVE',
  'ROTATION_PENDING',
  'DEVICE_OFFLINE',
  'REVOKED',
  'EPOCH_STALE',
  'RECOVERY_REQUIRED',
]);

export function isPlausibleOpaqueId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_OPAQUE_ID_LENGTH;
}

export function isPlausibleSignature(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_SIGNATURE_LENGTH;
}

export function isPlausibleEpochNumber(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= MIN_TRUST_SET_EPOCH;
}

export function isPlausibleKeyEpoch(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0;
}

export function isPlausibleFamilyRole(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && FAMILY_ROLES.has(candidate);
}

export function isPlausibleEntryStatus(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && ENTRY_STATUSES.has(candidate);
}

/** DSK and DEK are distinct roles (doc 09 Section 3.1) -- never the same key material for one entry. */
export function isDistinctKeyPair(dskPublicKey: string, dekPublicKey: string): boolean {
  return dskPublicKey !== dekPublicKey;
}
