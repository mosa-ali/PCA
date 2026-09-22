import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';
import { FamilyMemberInvitationError } from '../../src/api/interfaces';
import { invitationErrorKey } from '../../src/pages/family/familyMemberInvitationErrorKey';

/**
 * PCA-DEC-036 at the Parent Web boundary.
 *
 * The server now refuses an acceptance with a DISTINGUISHABLE `family_conflict`
 * (HTTP 409, same status as already_accepted/revoked/expired). The whole point of
 * making it distinguishable server-side is lost if the client collapses it back
 * into a generic conflict message, so these tests pin the mapping AND check that
 * the key it maps to actually exists, is non-empty, and is DIFFERENT from the
 * generic copy, in BOTH locales.
 *
 * The difference assertion is the load-bearing one. A mapping that produced
 * `family.invitations.errors.conflict` would satisfy "some translated message is
 * shown" while telling the person nothing they can act on -- and the invitation
 * really is still usable, which the generic copy does not convey.
 */
function invitationError(serverCode: string): FamilyMemberInvitationError {
  return new FamilyMemberInvitationError('CONFLICT', `raw diagnostic for ${serverCode}`, 409, serverCode);
}

function lookup(locale: unknown, key: string): string | undefined {
  const path = key.split('.');
  let node: unknown = locale;
  for (const segment of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

describe('family-member invitation error messages', () => {
  it('maps the PCA-DEC-036 family conflict to its own message key, not the generic 409 conflict copy', () => {
    const key = invitationErrorKey(invitationError('family_conflict'));
    expect(key).toBe('family.invitations.errors.familyConflict');
    expect(key).not.toBe('family.invitations.errors.conflict');
  });

  it('does not let the new conflict code disturb the existing 409 mappings it shares a status with', () => {
    expect(invitationErrorKey(invitationError('already_accepted'))).toBe('family.invitations.errors.alreadyAccepted');
    expect(invitationErrorKey(invitationError('revoked'))).toBe('family.invitations.errors.revoked');
    expect(invitationErrorKey(invitationError('expired'))).toBe('family.invitations.errors.expired');
  });

  it('resolves the family-conflict key to real, distinct, user-facing copy in BOTH locales', () => {
    const key = 'family.invitations.errors.familyConflict';
    const enCopy = lookup(en, key);
    const arCopy = lookup(ar, key);
    expect(enCopy, `en.json is missing ${key}`).toBeTruthy();
    expect(arCopy, `ar.json is missing ${key}`).toBeTruthy();
    expect(enCopy).not.toBe(lookup(en, 'family.invitations.errors.conflict'));
    expect(arCopy).not.toBe(lookup(ar, 'family.invitations.errors.conflict'));
    // Never a leaked translation-key path rendered as the message itself.
    expect(enCopy).not.toContain('family.invitations');
    expect(arCopy).not.toContain('family.invitations');
  });

  it('never surfaces the raw client diagnostic string, which would name the family conflict as an internal code', () => {
    const mapped = invitationErrorKey(invitationError('family_conflict'));
    expect(mapped).not.toContain('raw diagnostic');
    expect(mapped).not.toContain('family_conflict');
  });
});
