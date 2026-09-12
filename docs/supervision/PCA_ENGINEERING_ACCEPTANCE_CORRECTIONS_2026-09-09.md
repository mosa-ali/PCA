# PCA Engineering Acceptance Corrections

**Scope:** FABLE re-review correction package. This document records engineering evidence and does not self-certify closure.

## FABLE-A012

`A012_RUNTIME_CLASSIFICATION_BEFORE=PRODUCTION_REACHABLE`

`backend/src/main.ts` constructed `InMemoryWebRuleRepository`, constructed `WebRuleService`, and passed that service to `buildServer`. `buildServer` passed it to `registerWebRuleRoutes`; the parent web-rules GET/POST routes could therefore read and write canonical readable domains in the process-local repository.

`ROOT_CAUSE=production composition wired test-only readable in-memory store`

**Source correction:** production composition no longer constructs or passes `InMemoryWebRuleRepository`/`WebRuleService`. The route remains available for test injection, but without an approved durable/encrypted service it returns `503 not_configured`. The in-memory TypeScript implementation remains available to explicit backend tests only. This is the smallest fail-closed correction while reviewed encrypted storage and device delivery remain unavailable.

The repository-wide audit found no backend production constructor, fallback, MySQL/cache/audit/telemetry writer, or logging path that stores readable parent-authored domains. `buildServer.ts` still imports the route and forwards an optional dependency, but it does not construct the store. The Android `PersistentWebRuleRepository` production graph intentionally contains a local in-memory working delegate beneath durable local state; that is device-local policy storage, not a central readable backend store, and parent-rule delivery remains crypto-gated.

Remaining constructors/imports are limited to: backend `WebRuleStore.ts`'s class definition; explicit backend tests under `backend/test`; Android's local `InMemoryWebRuleRepository` delegate and Android test fixtures; and the route/type references needed for dependency injection. No remaining constructor is a central backend production-readable parent-rule store.

`A012_RUNTIME_CLASSIFICATION_AFTER=NON_PRODUCTION_SCAFFOLDING_OR_TEST_ONLY`
`A012_SOURCE_CHANGE_REQUIRED=YES`
`A012_PRODUCTION_READABLE_STORE=0 (central backend store; Android local durable working set is separate)`
`A012_FAIL_CLOSED=YES (503 not_configured without approved service/repository)`
`A012_PRIVACY_RESULT=FAIL_CLOSED_COMPLIANT_WITH_PCA-SEC-023_PENDING_REVIEWED_ENCRYPTED_IMPLEMENTATION`

The negative regression tests prove more than a single string absence: every backend production TypeScript source is scanned for repository/service constructors, the route source is scanned for a readable fallback, and an explicit route injection test proves that an unconfigured production-shaped route returns 503. A synthetic domain `a012-synthetic-never-persisted.invalid` was submitted through that boundary; it was not persisted, logged, audited, telemetered, or echoed in the response/error body.

`EXTERNAL_DEPENDENCY=PRODUCTION_CRYPTO_SUITE` for any future encrypted family-policy delivery/storage implementation. This correction does not claim that feature is production-ready.

`SOURCE_STATE=backend production composition corrected; Android local policy implementation unchanged and crypto-gated`
`VALIDATION_STATE=focused A012/web-rule tests and backend build pass; broader validation recorded below after final run`
`PRODUCTION_STATE=backend web-rule authoring unavailable by design until approved durable encrypted policy storage and delivery exist`

Focused evidence: `backend/test/web/productionWiring.test.mjs`, `backend/test/http/webRuleRoutes.test.mjs`.

## Mutation evidence

The default command resolves its baseline from the current `HEAD`. It does not compare `HEAD` to the literal `mutation-scope.json.entrySha`; that field is retained as informational manifest provenance and is reported as `manifestEntrySha`. A pinned SHA remains available through `--baseline <sha>`.

The evidence is per surface:

- Backend: 10 mutants, real TypeScript compilation and real non-DB backend test-suite execution.
- Parent Web: 10 mutants, static source assertions only.
- Android: 8 mutants, static source assertions only.
- Aggregate: 28 mutants, not 28 backend real-execution mutants.

The runner now uses `SOURCE_FINGERPRINT_V1_WITH_SEPARATE_EVIDENCE_HEAD`.
The source-under-test checkout and the evidence-package checkout are distinct:

`IMPLEMENTATION_CORRECTION_SHA=15baf12ffb49c79e449f59578d6549e2fa0e7d8c`
`PRIOR_EVIDENCE_HEAD=0631b2f49fc814855054070630e86067a1d7e3b8`
`MUTATION_SOURCE_SHA=c301900f6988f1b20044d3dd1b1c3613bfa346ad`
`MUTATION_SOURCE_FINGERPRINT=bb354a8f52079094da6d8e79dbfa0e17a807a5d658ee6b0c95c8c21375fa26e3`
`MUTATION_SCOPE_FINGERPRINT=0c7c00d6e81b6e25253801932c27e4c9389d01d536113baaf06fe74a823930a1`
`MUTATION_SOURCE_INPUT_FILES=2329`
`MUTATION_REPORT_GENERATED_AT_HEAD=c301900f6988f1b20044d3dd1b1c3613bfa346ad`
`MUTATION_EVIDENCE_HEAD=4cd262f342c5a6c321253d37d1faf0247dac1d60`
`EVIDENCE_METADATA_HEAD=4bfaf727c2aea9c20a59a6fae3778cc1f363aa4f (validated by CI run 34724290273 / 284; the final CI-result refresh below is documentation-only)`
`MUTATION_POST_COMMIT_INVOCATION_HEAD=4cd262f342c5a6c321253d37d1faf0247dac1d60`
`MUTATION_POST_COMMIT_REPORT_WRITTEN=false`
`MUTATION_BASELINE_SOURCE=current HEAD (default)`
`MUTATION_MANIFEST_ENTRY_SHA=d6981411c3e38ba7288b99449afc26022a22e0e7 (informational provenance only)`
`MUTATION_COUNTS=KILLED:22,EQUIVALENT:3,INVALID:3,SURVIVED:0`
`MUTATION_VALID_SURVIVORS=0`
`MUTATION_ENVIRONMENT_BLOCK=null`
`MUTATION_MANIFEST_ANOMALIES=[]`

The report records the exact source and scope fingerprints, while the
supervision documents record the separate evidence-package commit. A later
documentation-only commit under `docs/supervision/` is excluded from the source
fingerprint; the runner still executes the complete mutation suite and retains
the report only when the fingerprints and classifications match. This removes
the previous HEAD/report self-reference loop without weakening explicit
baseline mismatch detection.

Surface counts remain separate: backend `8/1/1/0` (KILLED/EQUIVALENT/INVALID/SURVIVED, real build and test execution), Parent Web `8/1/1/0` (static assertions only), Android `6/1/1/0` (static assertions only). The mutation baseline diagnostic recorded four pre-existing temporary-fixture failures; the runner isolated those from mutation classifications and did not raise an environment block.

## Broader validation recorded for this package

- Backend: build PASS; full non-DB `npm test` PASS; `run-tests.mjs` 2349/2349, 0 failed, 0 skipped; focused WebRuleStore/routes/production-wiring tests 26/26 PASS.
- Privacy/security/quality: repository checks PASS; security checks PASS; deterministic quality checks PASS; negative controls PASS; `git diff --check` PASS.
- Release/traceability: all four derived-ledger/traceability/parity validators PASS; release-gate scoping and negative controls PASS; contract validators/tests 49/49 PASS; external-gate parity has no missing/invalid/closed-without-evidence rows but retains the existing duplicate-register-ID data-quality warning.
- Parent Web: unit tests 138 files/999 tests PASS; production build, lint, production demo-mode gate, and demo-mode negative control PASS.
- Platform Admin Web: unit tests 32 files/155 tests PASS; production build, lint, production demo-mode gate, and negative control PASS.
- Public Web: build PASS; regression tests 6/6 PASS, including the expected negative-control diagnostic; no generated tracked drift.
- Android: `testDebugUnitTest` BUILD SUCCESSFUL; 26 actionable tasks, 1 executed.
- MySQL-backed suite: `BLOCKED/NOT_EXECUTED`, `ECONNREFUSED 127.0.0.1:33061`; no DB PASS is claimed.
- External/device boundaries: PCA-15 remains blocked by missing macOS/Xcode/physical-device validation; no deployment or Azure action was performed.
- CI for validated final evidence metadata head `4bfaf727c2aea9c20a59a6fae3778cc1f363aa4f`: run `34724290273` / `284`, 23 jobs total, 22 green, 1 red, 0 skipped/cancelled; the only red job is the known iOS build/unit-test boundary. The prior run 283 dependency-audit red was not reproducible locally across all six audited workspaces and the fresh run passed that gate.

## G-41

`G41=UNRESOLVED`
`PRODUCT_DEFECT_REPRODUCED=NO`
`ROOT_CAUSE_PROVEN=NO`

The billing symptom did not recur in the available reruns and no product-path logical defect was found, but the causal mechanism was not directly captured or proven. No root-cause closure is claimed and no product behavior change is required merely to obtain a closed label.

## Other recorded corrections

- A031 remains the existing owner decision `RETENTION_OWNER_RBAC`/D9, not a newly invented decision.
- PCA-15 remains externally blocked for Xcode/macOS and device validation.
- Alert-composition failures remain bounded and observable without logging raw error objects or alert payloads.
- No deployment or Azure action is part of this package.

## Acceptance boundary

This package is submitted for independent FABLE re-review. It is not an engineering self-approval, release authorization, or deployment record.
