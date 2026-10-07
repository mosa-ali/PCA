import { isFamilyEpochNumber } from '../familyepoch/bounds.js';
import type { FamilyTrustSetEpoch } from './types.js';

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
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_OPAQUE_ID_LENGTH && isWellFormedUnicode(candidate);
}

export function isPlausibleSignature(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_SIGNATURE_LENGTH && isWellFormedUnicode(candidate);
}

/** Reject unpaired UTF-16 instead of letting UTF-8 encoding replace signed identity bytes. */
export function isWellFormedUnicode(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') return false;
  for (let i = 0; i < candidate.length; i += 1) {
    const unit = candidate.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = candidate.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Direct typed acceptance callers must receive the same Unicode identity guard as wire parsing. */
export function hasWellFormedTrustSetText(epoch: FamilyTrustSetEpoch): boolean {
  if (!isWellFormedUnicode(epoch.familyId) || !isWellFormedUnicode(epoch.signature) || !Array.isArray(epoch.entries)) return false;
  return epoch.entries.every((entry) => entry != null && [entry.deviceId, entry.role,
    entry.dskKeyId, entry.dskPublicKey, entry.dekKeyId, entry.dekPublicKey, entry.status].every(isWellFormedUnicode));
}

export function isPlausibleEpochNumber(candidate: unknown): candidate is number {
  return isFamilyEpochNumber(candidate, MIN_TRUST_SET_EPOCH);
}

export function isPlausibleKeyEpoch(candidate: unknown): candidate is number {
  return isFamilyEpochNumber(candidate, 0);
}

export function isPlausibleFamilyRole(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && FAMILY_ROLES.has(candidate);
}

export function isPlausibleEntryStatus(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && ENTRY_STATUSES.has(candidate);
}

/** DSK and DEK are distinct roles (doc 09 Section 3.1) -- never the same key material for one entry. */
export function isDistinctKeyPair(dskPublicKey: string, dekPublicKey: string): boolean {
  return isWellFormedUnicode(dskPublicKey) && isWellFormedUnicode(dekPublicKey) && dskPublicKey !== dekPublicKey;
}
