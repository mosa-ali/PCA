# PCA-DEC-020-R2 Security Review Remediation Manifest

Status: READY FOR INDEPENDENT HUMAN CRYPTOGRAPHIC / APPLICATION-SECURITY REVIEW

This manifest records the source-only R2 remediation candidate. It does not
approve production activation, production migration, deployment, account
remediation, or replacement of the fail-closed verifier.

## Candidate

- `R1_REJECTED_SOURCE_SHA = 8ed90d38178c919e29bfd60ed2a3e8368843956f`
- `R2_SOURCE_SHA = 54680a0d8ffaef1eaf425b5ba727e64fb987e328`
- `R2_SOURCE_SCOPE = PCA-DEC-020-R2 remediation, regression coverage, and review evidence`
- `PRODUCTION_CHANGED = NO`
- `AZURE_CHANGED = NO`
- `PRODUCTION_DATABASE_CHANGED = NO`
- `PRODUCTION_CRYPTO_VERIFIER_ACTIVATED = NO`

## Finding disposition

- `C-001 = REMEDIATED_SOURCE_TESTED`: dedicated exact-session password plus
  one-time mailbox step-up, bound to account/service/session/operation and
  consumed atomically with genesis.
- `H-002 = REMEDIATED_SOURCE_TESTED`: server-time skew, freshness, bounded
  TTL, and expiry-before-persistence policy is shared by genesis attestation.
- `M-003 = REMEDIATED_SOURCE_TESTED`: only explicitly `ACTIVE` devices and
  keys can resolve as family authorities.
- `M-004 = REMEDIATED_SOURCE_TESTED`: fixed-width 64-byte P1363 `r || s`,
  scalar bounds, and low-S enforcement are applied at verification; browser
  output is canonicalized before transport.
- `M-005 = REMEDIATED_SOURCE_TESTED`: strict canonical base64url validation
  rejects alternate encodings and invalid trailing bits.
- `M-006 = CLOSED_WITH_COMPOSITION_GATE`: the legacy non-atomic bootstrap is
  test/fixture-only; production composition uses ParentGenesisService and the
  MySQL atomic transaction repository.
- `L-007 = REMEDIATED_SOURCE_ONLY`: membership/profile foreign keys are in the
  migration and schema source; production migration 0043 was not executed.
- `L-008 = DOCUMENTED_RESIDUAL`: browser key material remains in-memory and
  non-extractable; reload requires re-pairing. No key-export weakening was
  introduced.
- `R2-9 = NATIVE_CROSS_CLIENT_BLOCKER`: approved Android/iOS production
  adapters and physical-device vectors are not present; Node/browser evidence
  is not treated as native certification.
- `R2-10 = COMPLETE`: adversary model is recorded in
  `PCA_DEC_020_R2_ADVERSARY_MODEL.md`.
- `R2-11 = COMPLETE_SOURCE_ONLY`: disposable bootstrap artifacts are generated
  and checked; no production database was touched.
- `R2-12 = COMPLETE`: regression suites and targeted R1/R2 security tests pass.
- `R2-13 = COMPLETE_SOURCE_ONLY`: production composition remains fail-closed.
- `R2-14 = COMPLETE`: this manifest and the closure matrix record evidence and
  open gates.
- `R2-15 = COMPLETE`: source candidate is committed on `pca-dev`; remote
  publication is recorded after the push gate.

## Evidence

- `BACKEND_BUILD = PASS`
- `BACKEND_FULL_TESTS = 2391/2391 PASS`
- `PARENT_WEB_VITEST = 143 files / 1031 tests PASS`
- `PARENT_WEB_BUILD = PASS`
- `PARENT_WEB_LINT = PASS`
- `R1_TARGETED_SECURITY = 5/5 PASS`
- `GENESIS_TRANSACTION = 3/3 PASS`
- `R2_TARGETED_SECURITY = 6/6 PASS`
- `R2_COMPOSITION = 2/2 PASS`
- `DISPOSABLE_BOOTSTRAP_ARTIFACT = 8/8 PASS`
- `TEST_SUITE_REGISTRATION = 6/6 PASS`
- `DISPOSABLE_BOOTSTRAP_DRIFT = NONE`

## Production gate state

- `REJECTING_VERIFIER_ACTIVE = YES`
- `P256_PRODUCTION_ACTIVE = NO`
- `MIGRATION_0043_PRODUCTION_EXECUTED = NO`
- `MIGRATION_0044_PRODUCTION_EXECUTED = NO`
- `MIGRATION_0045_PRODUCTION_EXECUTED = NO`
- `ACCOUNT_REMEDIATION_PRODUCTION_EXECUTED = NO`
- `AZURE_MUTATION = NO`
- `HUMAN_REVIEW_DECISION = PENDING_EXTERNAL_REVIEW`
- `NATIVE_CROSS_CLIENT_RELEASE_BLOCKER = YES`
- `READY_FOR_PRODUCTION = NO`

The independent reviewer must decide whether the source candidate is safe for
any later owner-authorized activation lane. Native adapter implementation,
physical-device proof, production migration, and verifier activation remain
separate gates.
