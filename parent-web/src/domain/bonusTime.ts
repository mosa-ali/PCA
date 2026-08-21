// PCA-FR-130 ("Bonus Time"): the single source of truth for the bonus-grant
// minute bound on the parent-web side -- every input's min/max attribute
// AND the real submission-path validation import from here, exactly like
// `screenTimePolicy.ts`'s own "declare the bound once" convention (see that
// file's header comment). Mirrors
// `backend/src/childrequests/policy.ts`'s MAX_BONUS_GRANT_MINUTES/
// MIN_BONUS_GRANT_MINUTES verbatim -- the backend is the actual enforcement
// authority; this is the UI's own copy so a parent never even sees a
// control that would be rejected server-side, not a competing source of
// truth.
export const MIN_BONUS_GRANT_MINUTES = 1;
export const MAX_BONUS_GRANT_MINUTES = 120;

export type BonusMinutesValidationError = 'NOT_A_NUMBER' | 'TOO_LOW' | 'TOO_HIGH' | 'NOT_AN_INTEGER';

export function validateBonusMinutes(candidate: number): BonusMinutesValidationError | null {
  if (!Number.isFinite(candidate)) return 'NOT_A_NUMBER';
  if (!Number.isInteger(candidate)) return 'NOT_AN_INTEGER';
  if (candidate < MIN_BONUS_GRANT_MINUTES) return 'TOO_LOW';
  if (candidate > MAX_BONUS_GRANT_MINUTES) return 'TOO_HIGH';
  return null;
}

/** A counter-offer must be a plausible amount AND strictly shorter than what the child asked for (doc text: "counter-offer a shorter duration") -- never equal, never longer. */
export function validateCounterOffer(candidate: number, requestedExtraMinutes: number): BonusMinutesValidationError | 'NOT_SHORTER' | null {
  const base = validateBonusMinutes(candidate);
  if (base) return base;
  if (candidate >= requestedExtraMinutes) return 'NOT_SHORTER';
  return null;
}
