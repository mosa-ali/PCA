# PCA-DEC-020-R2 production bootstrap boundary

The legacy `FamilyOwnerAttestationChainEngine.bootstrapFamilyAuthority` method
remains available only for deterministic chain-engine tests and historical
fixtures. It is not a production request path. A repository-wide call-site
review found its callers under `backend/test/**` only; `backend/src/main.ts`
does not invoke it.

The production parent genesis composition is:

`parentAccountRoutes` → `ParentAccountService` → exact-session
`FAMILY_GENESIS` step-up → `ParentGenesisService` →
`MySqlGenesisTransactionRepository`.

The production composition currently injects `RejectingDeviceSignatureVerifier`
for both the challenge and transaction proof boundaries. Therefore no real
family genesis or P-256 authority activation is reachable in production until
the independent cryptographic review and the remaining native interop gates
are complete.

The R2 composition regression is executable at
`backend/test/security/pcaDec020R2Composition.test.mjs`. Migration 0045 is
source-only in this lane and has not been executed against production.
