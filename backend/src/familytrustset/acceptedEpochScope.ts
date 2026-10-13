import { decodeCanonicalTrustSetEpochBytes } from './decode.js';
import { isFamilyEpochNumber } from '../familyepoch/bounds.js';
import { isPlausibleOpaqueId } from './policy.js';

/**
 * Confirms that a persisted/signed epoch projection is internally consistent
 * with the family-scoped metadata returned alongside its canonical bytes.
 * This is a response-integrity check only; it neither authorizes nor accepts
 * an epoch, which remain responsibilities of OrdinaryTrustSetService.
 */
export function isAcceptedEpochInScope(
  canonicalEpochBytes: Uint8Array,
  familyId: string,
  trustSetEpoch: number,
  keyEpoch: number,
  signerDeviceId: string,
  signerKeyId: string,
): boolean {
  if (!isPlausibleOpaqueId(familyId) || !isFamilyEpochNumber(trustSetEpoch, 1) ||
      !isFamilyEpochNumber(keyEpoch, 1) || !isPlausibleOpaqueId(signerDeviceId) ||
      !isPlausibleOpaqueId(signerKeyId)) return false;
  try {
    const epoch = decodeCanonicalTrustSetEpochBytes(canonicalEpochBytes);
    const activeOwners = epoch.entries.filter((entry) => entry.role === 'OWNER' && entry.status === 'ACTIVE');
    return epoch.familyId === familyId && epoch.trustSetEpoch === trustSetEpoch && epoch.keyEpoch === keyEpoch &&
      activeOwners.length === 1 && activeOwners[0]!.deviceId === signerDeviceId &&
      activeOwners[0]!.dskKeyId === signerKeyId;
  } catch {
    return false;
  }
}

/**
 * Reads only the family and epoch number needed to validate a status receipt.
 * Route code must not import the canonical decoder directly: decoding stays
 * inside the familytrustset boundary alongside acceptance and projection.
 */
export function requestedTrustSetEpochInFamily(
  canonicalEpochBytes: Uint8Array,
  familyId: string,
): number | null {
  if (!isPlausibleOpaqueId(familyId)) return null;
  try {
    const epoch = decodeCanonicalTrustSetEpochBytes(canonicalEpochBytes);
    return epoch.familyId === familyId ? epoch.trustSetEpoch : null;
  } catch {
    return null;
  }
}
