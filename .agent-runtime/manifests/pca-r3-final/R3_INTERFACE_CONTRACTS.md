# PCA R3 Interface Contracts

Generated 2026-08-17 from the live source tree and accepted handoff.

## Protection capability

- Android exposes STANDARD, PROTECTED, AUTHORIZATION_REQUIRED, and NOT_SUPPORTED.
- DEVICE_OWNER maps to PROTECTED; PROFILE_OWNER and NONE remain STANDARD under the current capability policy.
- Runtime capability failures fail closed to NOT_SUPPORTED.
- Parent Web renders the same four-state display contract.
- No AUTHORIZATION_REQUIRED runtime transition is claimed yet; ENR-019 remains partial.

## Enrollment and invitation lifecycle

- Invitation lifecycle includes implemented backend states and persists transitions through the repository and migration.
- Invitation authorization must have explicit server state and audited transition evidence.
- Device enrollment and managed authority are separate from invitation creation.

## Identity, authority, and privacy

- Session identity is not equivalent to Family Owner authority.
- Family and child authority remains an explicit local/E2EE contract; the server is not a readable child-activity database.
- Trust-set/key-epoch convergence, removal, recovery, and encrypted export require their own evidence.
- Crypto and key-management failures are fail-closed and must not silently become plaintext or false protection.

## Contract gaps

- ENR-019 authorization transition is not yet bound to an actual enrollment/authority transition.
- Backend database, mutation, security, iOS, physical-device, and independent-review gates remain open where not evidenced.
