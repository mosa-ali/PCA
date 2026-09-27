/**
 * Shared Parent identity input rules. Names remain display data: they are
 * trimmed and bounded but are not restricted to a particular alphabet or
 * punctuation style. Existing accounts may have no profile until they update
 * it, so this module deliberately does not impose database-level presence.
 */

export const PARENT_NAME_MAX_LENGTH = 128;

export interface ParentIdentityNameInput {
  firstName: string;
  lastName: string;
}

export type ParentIdentityValidationResult =
  | { valid: true; value: ParentIdentityNameInput }
  | { valid: false; field: 'firstName' | 'lastName'; reason: 'required' | 'too_long' | 'control_character' };

/** Trim surrounding whitespace, preserve internal spelling, and accept Arabic and other scripts. */
export function validateParentIdentityNames(firstName: unknown, lastName: unknown): ParentIdentityValidationResult {
  for (const [field, candidate] of [['firstName', firstName], ['lastName', lastName]] as const) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      return { valid: false, field, reason: 'required' };
    }
    const value = candidate.trim();
    if ([...value].length > PARENT_NAME_MAX_LENGTH) {
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

/** Name shown to an authorized reader is derived; it is never stored separately. */
export function formatParentDisplayName(profile: Pick<ParentIdentityNameInput, 'firstName' | 'lastName'>): string | null {
  const firstName = profile.firstName.trim();
  const lastName = profile.lastName.trim();
  if (!firstName || !lastName) return null;
  return `${firstName} ${lastName}`;
}
