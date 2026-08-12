// Offline policy authoring gate.
//
// A parent editing a child policy while genuinely offline (or while this
// browser is not yet TRUSTED) can only ever produce a LOCAL_DRAFT
// (see ./policyStatus.ts). Turning that draft into something that can be
// queued/signed for delivery requires a trusted-browser-held signing key
// (see ../security/secureStorage.ts) plus a reviewed production crypto
// suite -- neither of which exists in this repository slice yet.
//
// PRODUCTION_CRYPTO_SUITE and the offline-signing code path this constant
// gates are an EXTERNAL / HUMAN SECURITY REVIEW gate, not something this
// slice implements or claims is done. Do not wire real offline signing
// against this constant without that review happening first.
export const PARENT_OFFLINE_POLICY_SIGNING = 'PENDING_HUMAN_SECURITY_REVIEW' as const;

export type OfflinePolicySigningStatus = typeof PARENT_OFFLINE_POLICY_SIGNING;

/** True while offline policy signing is blocked pending the external security review. */
export function isOfflinePolicySigningBlocked(): boolean {
  return PARENT_OFFLINE_POLICY_SIGNING === 'PENDING_HUMAN_SECURITY_REVIEW';
}
