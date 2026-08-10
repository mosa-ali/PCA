import type { FamilyTrustSetEntry, FamilyTrustSetEpoch } from './types.js';
import {
  isDistinctKeyPair,
  isPlausibleEntryStatus,
  isPlausibleEpochNumber,
  isPlausibleFamilyRole,
  isPlausibleKeyEpoch,
  isPlausibleOpaqueId,
  isPlausibleSignature,
  MAX_ENTRIES_PER_EPOCH,
} from './policy.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIsoDate(candidate: unknown): Date | null {
  if (typeof candidate !== 'string') return null;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString() === candidate ? parsed : null;
}

function parseEntry(raw: unknown): FamilyTrustSetEntry | null {
  if (!isPlainObject(raw)) return null;
  const { deviceId, role, dskKeyId, dskPublicKey, dekKeyId, dekPublicKey, status } = raw;
  if (!isPlausibleOpaqueId(deviceId)) return null;
  if (!isPlausibleFamilyRole(role)) return null;
  if (!isPlausibleOpaqueId(dskKeyId)) return null;
  if (!isPlausibleOpaqueId(dskPublicKey)) return null;
  if (!isPlausibleOpaqueId(dekKeyId)) return null;
  if (!isPlausibleOpaqueId(dekPublicKey)) return null;
  if (!isPlausibleEntryStatus(status)) return null;
  if (!isDistinctKeyPair(dskPublicKey, dekPublicKey)) return null;
  return {
    deviceId,
    role: role as FamilyTrustSetEntry['role'],
    dskKeyId,
    dskPublicKey,
    dekKeyId,
    dekPublicKey,
    status: status as FamilyTrustSetEntry['status'],
  };
}

/**
 * Structurally validates and converts untrusted wire input into a typed
 * FamilyTrustSetEpoch. Returns null for ANY structural defect, without
 * distinguishing which field was wrong -- matching
 * src/familyenvelope/parse.ts's anti-oracle rationale.
 *
 * Performs NO semantic acceptance checks (epoch monotonicity, signature,
 * exactly-one-active-owner) -- see FamilyTrustSetEngine.acceptEpoch.
 */
export function parseFamilyTrustSetEpoch(raw: unknown): FamilyTrustSetEpoch | null {
  if (!isPlainObject(raw)) return null;
  const { familyId, trustSetEpoch, keyEpoch, entries, issuedAt, supersedesEpoch, signature } = raw;

  if (!isPlausibleOpaqueId(familyId)) return null;
  if (!isPlausibleEpochNumber(trustSetEpoch)) return null;
  if (!isPlausibleKeyEpoch(keyEpoch)) return null;
  if (!isPlausibleSignature(signature)) return null;

  const parsedIssuedAt = parseIsoDate(issuedAt);
  if (!parsedIssuedAt) return null;

  if (supersedesEpoch !== null && !isPlausibleEpochNumber(supersedesEpoch)) return null;

  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ENTRIES_PER_EPOCH) return null;
  const parsedEntries: FamilyTrustSetEntry[] = [];
  for (const rawEntry of entries) {
    const entry = parseEntry(rawEntry);
    if (!entry) return null;
    parsedEntries.push(entry);
  }

  return {
    familyId,
    trustSetEpoch,
    keyEpoch,
    entries: parsedEntries,
    issuedAt: parsedIssuedAt,
    supersedesEpoch: supersedesEpoch as number | null,
    signature,
  };
}
