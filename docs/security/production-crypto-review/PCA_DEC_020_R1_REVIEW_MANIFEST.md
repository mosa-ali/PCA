# PCA-DEC-020-R1 External Review Manifest

Status: READY FOR INDEPENDENT HUMAN CRYPTOGRAPHIC REVIEW

This manifest identifies the source candidate and evidence package for review.
It does not approve production activation, migration, deployment, account
remediation, or replacement of the fail-closed production verifier.

## Candidate

- `REVIEW_CANDIDATE_SHA = 8ed90d38` (`test(parent): reconcile final editorial browser assertions`)
- `REVIEW_CANDIDATE_SCOPE = assertion-only Parent Web E2E reconciliation`
- `PRODUCT_COPY_UPDATED = NO`
- `BUSINESS_LOGIC_CHANGED = NO`
- `PRODUCTION_CHANGED = NO`
- `AZURE_CHANGED = NO`
- `DATABASE_CHANGED = NO`

The candidate is based on `21532e5df8758b98bf09d46d4ebbaac5b9346ecf`.
This manifest is a documentation-only descendant that records the evidence
for that source candidate.

## Verification evidence

- `FULL_BROWSER = 92/92 PASS` with Chromium, including English/Arabic,
  responsive, RTL, route, device-enrollment, trusted-browser, and
  accessibility coverage.
- `PARENT_VITEST = 143 files / 1031 tests PASS`.
- `PARENT_TARGETED_EDITORIAL_ARABIC_RTL_ACCESSIBILITY = 22 files / 256 tests PASS`.
- `GENESIS_PROOF = 4/4 PASS`.
- `PARENT_TYPECHECK = PASS`.
- `PARENT_LINT = PASS`.
- `PARENT_BUILD = PASS`.
- `BACKEND = 2383/2383 PASS`.
- `DB_SECURITY_EVIDENCE = PASS` on disposable MySQL: migration safety 2/2,
  Parent account 16/16, family authority 4/4, and MySQL schema verification
  with 42 migrations.
- `CRYPTO_SOURCE_SECURITY_EVIDENCE = PASS`: genesis transaction 3/3,
  PCA-DEC-020-R1 5/5, family authority engine 26/26, signer import boundary
  4/4, and artifact gates 8/8.

## Review references

- Security design: `docs/implementation/decisions/PCA_DEC_020_R1_SECURITY_DESIGN.md`
- Recovery policy: `docs/implementation/decisions/PCA_DEC_020_R1_RECOVERY_POLICY.md`
- Canonical vector: `docs/implementation/decisions/PCA_DEC_020_R1_CANONICAL_VECTOR_V1.json`
- Migration 0043: `backend/migrations/0043_parent_family_memberships_and_profile.sql`
- Migration 0044: `backend/migrations/0044_pca_dec_020_r1_genesis_challenges_and_epoch_floors.sql`
- Production verifier wiring: `backend/src/runtime-sync/RejectingCryptoVerifiers.ts`
- Genesis challenge service: `backend/src/parentaccount/GenesisChallengeService.ts`
- Atomic genesis transaction: `backend/src/parentaccount/MySqlGenesisTransactionRepository.ts`
- Request proof protocol: `backend/src/familycommercial/authority/requestProofProtocol.ts`
- Active DSK resolution: `backend/src/familycommercial/authority/FamilyAuthorityKeyResolver.ts`
- Epoch and attestation enforcement: `backend/src/familycommercial/authority/FamilyOwnerAttestationChainEngine.ts`
- Recovery implementation boundary: `backend/src/recovery/RecoveryKdf.ts`,
  `backend/src/recovery/RecoveryEnvelopeCipher.ts`
- Existing review evidence: `docs/security/production-crypto-review/PCA_CRYPTO_TEST_EVIDENCE.md`,
  `docs/security/production-crypto-review/PCA_CRYPTO_SOURCE_MAP.md`

## Production gate state

- `REJECTING_VERIFIER_ACTIVE = YES`
- `P256_PRODUCTION_ACTIVE = NO`
- `MIGRATION_0043_PRODUCTION_EXECUTED = NO`
- `MIGRATION_0044_PRODUCTION_EXECUTED = NO`
- `ACCOUNT_REMEDIATION_PRODUCTION_EXECUTED = NO`
- `HUMAN_REVIEW_DECISION = PENDING_EXTERNAL_REVIEW`

The external reviewer must independently decide `APPROVE`,
`APPROVE_WITH_CONDITIONS`, or `REJECT`. Any later production activation is a
separate owner-authorized gate.
