export const PARENT_IDENTITY_NAME_MAX_LENGTH = 128;

export interface ParentIdentityNameValues {
  firstName: string;
  lastName: string;
}

export type ParentIdentityNameValidation =
  | { valid: true; value: ParentIdentityNameValues }
  | { valid: false; field: 'firstName' | 'lastName'; reason: 'required' | 'too_long' | 'control_character' };

/** Mirrors the backend's Unicode-friendly rules for new and updated names. */
export function validateParentIdentityNames(firstName: unknown, lastName: unknown): ParentIdentityNameValidation {
  for (const [field, candidate] of [['firstName', firstName], ['lastName', lastName]] as const) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      return { valid: false, field, reason: 'required' };
    }
    const value = candidate.trim();
    if ([...value].length > PARENT_IDENTITY_NAME_MAX_LENGTH) {
      return { valid: false, field, reason: 'too_long' };
    }
    if (/\p{Cc}/u.test(value)) {
      return { valid: false, field, reason: 'control_character' };
    }
  }

  return {
    valid: true,
    value: { firstName: (firstName as string).trim(), lastName: (lastName as string).trim() },
  };
}
