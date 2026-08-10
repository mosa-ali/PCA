import type { FamilyTrustSetEntry, FamilyTrustSetEpoch } from './types.js';

/**
 * Same netstring-style length-prefixed scheme as
 * src/familyenvelope/canonicalize.ts, for the same reason: no field value
 * (however encoded) can be crafted to make two structurally different
 * epochs canonicalize to the same byte string, and it sidesteps any
 * JSON-key-ordering portability question entirely.
 *
 * The `Omit<FamilyTrustSetEpoch, 'signature'>` parameter type is a
 * readability aid, not an enforcement mechanism (TypeScript's excess-
 * property check only applies to object literals) -- the actual guarantee
 * that `signature` never enters the canonical bytes is this function's
 * explicit field list, which must never be rewritten to spread or iterate
 * the input object's own keys.
 */
export function canonicalizeTrustSetEpoch(epoch: Omit<FamilyTrustSetEpoch, 'signature'>): string {
  const fields = [
    epoch.familyId,
    String(epoch.trustSetEpoch),
    String(epoch.keyEpoch),
    String(epoch.entries.length),
    ...epoch.entries.flatMap(canonicalizeEntryFields),
    epoch.issuedAt.toISOString(),
    epoch.supersedesEpoch === null ? 'null' : String(epoch.supersedesEpoch),
  ];
  return fields.map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`).join('');
}

function canonicalizeEntryFields(entry: FamilyTrustSetEntry): string[] {
  return [
    entry.deviceId,
    entry.role,
    entry.dskKeyId,
    entry.dskPublicKey,
    entry.dekKeyId,
    entry.dekPublicKey,
    entry.status,
  ];
}
