# PCA-DEC-020-R1 — Recovery Policy Gate

Status: SOURCE-ONLY POLICY — NOT PRODUCTION ACTIVATION

## Policy

`ZERO_TRUSTED_DEVICE_RECOVERY=MANUAL_HIGH_ASSURANCE_SUPPORT_PROCESS`

The zero-trusted-device path is not an email/password reset and is not an
automatic account repair. A support operator may only start the separately
approved high-assurance process after out-of-band identity review, owner
authorization, and an auditable case record. The process creates no root key,
does not receive or display a password, OTP, token, cookie, or MFA secret, and
does not mark an account cryptographically trusted by itself.

The owner must complete a fresh GENESIS_V1 ceremony from a newly generated
non-extractable endpoint key. Until that ceremony commits atomically, the
account remains without a family root and sensitive authority operations stay
fail-closed.

## Prohibited fallbacks

- Email verification plus password is not cryptographic root proof.
- A support operator must not export, escrow, or type a private key.
- A guessed device ID, session alone, or account-level role cannot replace a
  device proof.
- No production migration, account update, or verifier activation is implied
  by this source policy.

## Test contract

Source tests must cover the zero-trusted-device decision as an explicit policy
state and must prove that the ordinary password-reset path does not create a
family, device, DSK, membership, scope, anchor, attestation, or chain head.
