// Pure decision logic for scripts/recover-platform-admin-activation.mjs.
//
// Deliberately its own module, with NO imports of anything under dist/, for
// the same reason scripts/lib/certificationRunVerdict.mjs is: the refusal
// rules are the entire safety surface of that operator script, and a rule
// that can only be exercised by connecting to a real database is a rule that
// will not be exercised. Keeping the decision pure means every hostile case
// (unknown account, ambiguous account, disabled account, wrong role set,
// MFA already enrolled, enrollment material already pending) can be tested
// directly, including the GATE SELF-TEST in
// test/platformadmin/recoverPlatformAdminActivation.test.mjs that feeds this
// function defective input to prove it can actually refuse.
//
// Nothing here reads or writes anything, and nothing here ever receives a
// password, a TOTP secret, an otpauth:// URI, or a 6-digit code.

/** The exact value PLATFORM_ADMIN_RECOVERY_CONFIRM must hold. */
export const RECOVERY_CONFIRMATION_VALUE = 'REISSUE_ACTIVATION';

/** Every refusal reason the recovery script can report, in evaluation order. */
export const RECOVERY_REFUSAL_REASONS = [
  'ACCOUNT_NOT_FOUND',
  'MULTIPLE_ACCOUNTS_MATCHED',
  'ACCOUNT_NOT_ACTIVE',
  'NO_ACTIVE_ROLE',
  'PLATFORM_ADMIN_ROLE_MISSING',
  'APP_OWNER_ROLE_MISSING',
  'MFA_STATE_MISSING',
  'MFA_NOT_PENDING_SETUP',
  'PENDING_TOTP_MATERIAL_PRESENT',
];

export class RecoveryRefusalError extends Error {
  constructor(reason) {
    super(`Platform Admin activation recovery refused: ${reason}`);
    this.name = 'RecoveryRefusalError';
    this.reason = reason;
  }
}

/**
 * Decides whether one exact target account may have its first-time activation
 * reissued. Pure: takes already-read state, returns a verdict, touches nothing.
 *
 * @param {{
 *   accounts?: { adminId: string, status: string }[],
 *   activeRoles?: string[],
 *   mfa?: { status: string, totpMaterialPresent: boolean } | null,
 * }} state
 * @param {{ allowPendingMaterial?: boolean }} [options]
 * @returns {{ allowed: true, adminId: string, roles: string[], clearedPendingTotpMaterial: boolean }
 *         | { allowed: false, reason: string }}
 */
export function evaluateRecoveryTarget(state, options = {}) {
  const allowPendingMaterial = options.allowPendingMaterial === true;
  const accounts = Array.isArray(state?.accounts) ? state.accounts : [];

  // Refuse ambiguity rather than picking one. If two accounts ever shared an
  // email hash, recovering "the first" would reset the wrong operator
  // identity. The unique index should make this unreachable, which is exactly
  // why a violation must stop the run instead of being tolerated.
  if (accounts.length === 0) return { allowed: false, reason: 'ACCOUNT_NOT_FOUND' };
  if (accounts.length > 1) return { allowed: false, reason: 'MULTIPLE_ACCOUNTS_MATCHED' };

  const account = accounts[0];
  if (account.status !== 'ACTIVE') return { allowed: false, reason: 'ACCOUNT_NOT_ACTIVE' };

  const roles = Array.isArray(state.activeRoles) ? [...state.activeRoles] : [];
  if (roles.length === 0) return { allowed: false, reason: 'NO_ACTIVE_ROLE' };
  // PLATFORM_ADMIN is the activation lifecycle's own requirement
  // (PlatformAdminActivationService.issueActivation refuses without it).
  if (!roles.includes('PLATFORM_ADMIN')) return { allowed: false, reason: 'PLATFORM_ADMIN_ROLE_MISSING' };
  // APP_OWNER is this script's additional narrowing: it must not be usable as
  // a generic PLATFORM_ADMIN credential reset. Run
  // promote-first-app-owner.mjs first.
  if (!roles.includes('APP_OWNER')) return { allowed: false, reason: 'APP_OWNER_ROLE_MISSING' };

  if (!state.mfa) return { allowed: false, reason: 'MFA_STATE_MISSING' };
  // Only a never-completed enrollment may be reissued. An already-ACTIVE MFA
  // is a working login path; "recovering" it here would be a credential
  // reset, which this script deliberately is not.
  if (state.mfa.status !== 'PENDING_SETUP') return { allowed: false, reason: 'MFA_NOT_PENDING_SETUP' };
  // A reissue CLEARS pending enrollment material (that is
  // issueActivationTokenOnConnection's documented lost-QR behaviour), so
  // destroying material an operator has not looked at requires the explicit
  // PLATFORM_ADMIN_RECOVERY_ALLOW_PENDING_MATERIAL=YES review.
  if (state.mfa.totpMaterialPresent === true && !allowPendingMaterial) {
    return { allowed: false, reason: 'PENDING_TOTP_MATERIAL_PRESENT' };
  }

  return {
    allowed: true,
    adminId: account.adminId,
    roles,
    clearedPendingTotpMaterial: state.mfa.totpMaterialPresent === true,
  };
}
