# Release tooling (PCA-18/19)

Scripts supporting `docs/release_readiness/`. See that directory's
`README.md` for the full picture.

- `Invoke-ReleaseGateCheck.ps1` — binding release gate; REQUIRES
  `-ReleaseTarget` (`PUBLIC_A`/`AUTH_B`/`PARENT_C`/`ANDROID_D`/`IOS_FUTURE`/
  `BILLING_FUTURE` — no default, fails closed fast on a missing/invalid
  value, never prompts). Derives `PRODUCTION_CRYPTO_SUITE` from
  `backend/src/main.ts` source, reads `REAL_UAT` from
  `docs/release_readiness/uat_execution_log.json` scoped to the cases
  relevant to that target, and checks
  `docs/release_readiness/external_gate_matrix.json`'s gates whose
  `releaseScope` includes that target (a `conditionalReleaseScope` entry is
  a non-hard, feature-scoped dependency, surfaced separately). Exits `0`
  only when every condition is satisfied for that target; `1` for a real
  NOT READY; `2` if `-IgnoreExternalGates` was passed (informational-only —
  never a release verdict, never exit `0`, regardless of how the technical
  signals came out).

  ```
  pwsh tooling/release/Invoke-ReleaseGateCheck.ps1 -ReleaseTarget PUBLIC_A
  ```

  `tooling/release/Test-ReleaseGateScoping.mjs` and
  `tooling/release/ValidateFableScopeParity.mjs` are this script's own test
  suites (hard invariants + negative controls, and a full reconciliation of
  every gate x target cell against
  `docs/supervision/PCA_FABLE_EXTERNAL_GATE_RELEASE_SCOPE.csv`
  respectively) -- both run in CI and can be re-run locally with plain
  `node`.

- `Invoke-ReleaseEvidenceCollection.ps1` — reproducible evidence collector
  (git state, `npm audit` across backend/parent-web/parent-sdk packages,
  backend unit + optional DB clean-room test counts, optional Android JVM
  unit test counts, release gate state). REQUIRES the same `-ReleaseTarget`
  as the release gate above (no default, fails closed fast if missing/
  invalid) and passes it straight through. Writes a timestamped JSON pack
  to `docs/release_readiness/evidence/`.

  ```
  pwsh tooling/release/Invoke-ReleaseEvidenceCollection.ps1 -ReleaseTarget PUBLIC_A [-RunDbTests] [-RunAndroid]
  ```

  `-RunDbTests` requires `PCA_DATABASE_URL` pointing at a disposable MySQL
  8.4 instance (destructively reset). `-RunAndroid` requires
  `ANDROID_HOME`/`ANDROID_SDK_ROOT` and runs JVM unit tests only (not
  instrumented tests, not real-device UAT).

Neither script modifies application source. Both are read-only with
respect to product code; the evidence collector only writes JSON evidence
files under `docs/release_readiness/evidence/`.
