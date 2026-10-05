/** Shared upper bound for family protocol epoch fields across backend surfaces. */
export const MAX_FAMILY_EPOCH = 2_147_483_647;

const MAX_FAMILY_EPOCH_BIGINT = BigInt(MAX_FAMILY_EPOCH);

/**
 * Checks a parsed protocol value without coercion. Lower-bound rules remain
 * field-specific; callers pass the existing minimum for their field.
 */
export function isFamilyEpochNumber(candidate: unknown, minimum = 0): candidate is number {
  return (
    typeof candidate === 'number' &&
    Number.isSafeInteger(candidate) &&
    candidate >= minimum &&
    candidate <= MAX_FAMILY_EPOCH
  );
}

/**
 * Converts a MySQL epoch value only after checking its exact integer form and
 * shared protocol range. Decimal strings, floats, and unsafe numbers fail
 * closed rather than being rounded by Number().
 */
export function familyEpochFromStorage(candidate: unknown): number {
  let exact: bigint;

  if (typeof candidate === 'bigint') {
    exact = candidate;
  } else if (typeof candidate === 'number' && Number.isSafeInteger(candidate)) {
    exact = BigInt(candidate);
  } else if (typeof candidate === 'string' && /^(0|[1-9][0-9]*)$/.test(candidate)) {
    exact = BigInt(candidate);
  } else {
    throw new Error('Stored family epoch is not an exact non-negative integer.');
  }

  if (exact < 0n || exact > MAX_FAMILY_EPOCH_BIGINT) {
    throw new Error('Stored family epoch is outside the supported protocol range.');
  }

  return Number(exact);
}
