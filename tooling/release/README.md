# Release tooling (PCA-18/19)

Scripts supporting `docs/release_readiness/`. See that directory's
`README.md` for the full picture.

- `Invoke-ReleaseGateCheck.ps1` — binding release gate; derives
  `PRODUCTION_CRYPTO_SUITE` from `backend/src/main.ts` source, reads
  `REAL_UAT` from `docs/release_readiness/uat_execution_log.json`, and
  checks `docs/release_readiness/external_gate_matrix.json`. Exits 0 only
  when every condition is satisfied. Currently exits 1 (NOT READY), which
  is the correct, honest current state.

  ```
  pwsh tooling/release/Invoke-ReleaseGateCheck.ps1
  ```

- `Invoke-ReleaseEvidenceCollection.ps1` — reproducible evidence collector
  (git state, `npm audit` across backend/parent-web/parent-sdk packages,
  backend unit + optional DB clean-room test counts, optional Android JVM
  unit test counts, release gate state). Writes a timestamped JSON pack to
  `docs/release_readiness/evidence/`.

  ```
  pwsh tooling/release/Invoke-ReleaseEvidenceCollection.ps1 [-RunDbTests] [-RunAndroid]
  ```

  `-RunDbTests` requires `PCA_DATABASE_URL` pointing at a disposable MySQL
  8.4 instance (destructively reset). `-RunAndroid` requires
  `ANDROID_HOME`/`ANDROID_SDK_ROOT` and runs JVM unit tests only (not
  instrumented tests, not real-device UAT).

Neither script modifies application source. Both are read-only with
respect to product code; the evidence collector only writes JSON evidence
files under `docs/release_readiness/evidence/`.
