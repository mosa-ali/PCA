# PCA Release Readiness (PCA-18/19)

Index for family-beta/UAT and production-release preparation. This
directory implements `docs/architecture/28_TEST_QA_SECURITY_VALIDATION.md`
and `docs/architecture/29_RELEASE_DEPLOYMENT_ROLLBACK.md` as concrete,
runnable checks and real-device test plans for programme phases PCA-18
(`docs/architecture/30_IMPLEMENTATION_PROGRAMME.md`) and PCA-19.

| File | Purpose |
|---|---|
| [`RELEASE_GATE.md`](./RELEASE_GATE.md) | The binding go/no-go rule and how it's enforced (`tooling/release/Invoke-ReleaseGateCheck.ps1`). **Currently reports NOT READY** — this is correct, not a bug. |
| [`UAT_TEST_PLAN.md`](./UAT_TEST_PLAN.md) | Real-device UAT case catalogue (50 cases across enrollment, lifecycle, screen-time, Break Shield, schedules, app usage, location, Safe Browser, eye/prayer/wellbeing, offline/network, dashboard, delete/export/retention, recovery, tamper, Arabic/RTL). Plan only — not yet executed. |
| [`NETWORK_MATRIX.md`](./NETWORK_MATRIX.md) | Network conditions (online/offline/slow/intermittent/handover/backend-down/response-lost/reconnect) crossed against the flows they must be tested under. |
| [`EXTERNAL_GATE_MATRIX.md`](./EXTERNAL_GATE_MATRIX.md) / [`external_gate_matrix.json`](./external_gate_matrix.json) | The 34 registered gates this repo-editing lane cannot close - the original 7 plus production crypto activation, owner decisions, real-device/OEM/telephony/camera validation, deployed TLS, log/metrics and observability pipelines, telemetry and disclosure sign-offs, Apple entitlement, Android App Link hosting, and the six commercial payment/settlement gates. All currently `BLOCKED`/`EXTERNAL`. `external_gate_matrix.json` is authoritative; the `.md` covers only the original 7. |
| [`uat_execution_log.json`](./uat_execution_log.json) | Human-maintained UAT execution state. `status: NOT_EXECUTED`, 0/50 cases logged. Only a real tester/owner may advance this. |
| [`RELEASE_EVIDENCE.md`](./RELEASE_EVIDENCE.md) | How to (re-)run the evidence collector, what it captures vs. doesn't, and the latest real numbers this lane captured. |
| [`evidence/`](./evidence/) | Timestamped JSON evidence packs from actual runs. Exactly one pack exists, generated 2026-08-13 against ancestor `fcf80e6` with a dirty tree - 442 commits behind the current baseline, with zero `platform-admin-web` coverage and Android recorded as skipped. It must be re-collected before any release decision. |
| [`ROLLBACK_CHECKLIST.md`](./ROLLBACK_CHECKLIST.md) | Executable checklist form of doc 29's incident-stop/rollback runbook and drill exit criteria. |

## Scripts

`tooling/release/`:

- `Invoke-ReleaseGateCheck.ps1` — the binding release gate. Exits non-zero
  (NOT READY) unless `PRODUCTION_CRYPTO_SUITE` is reviewed, `REAL_UAT` is
  `COMPLETE`, and every external gate is `CLOSED`.
- `Invoke-ReleaseEvidenceCollection.ps1` — collects reproducible evidence
  (git state, dependency audits, test counts, gate state) into a
  timestamped JSON pack. Never invents numbers; records what it could not
  run as explicitly skipped.

## What "release readiness" means here

This directory prepares the repository so a real UAT/release cycle *can*
be executed reproducibly. It does not itself constitute UAT, does not
grant crypto-review sign-off, and does not close any external gate. Anyone
tempted to mark `uat_execution_log.json` `COMPLETE` or an external gate
`CLOSED` without the real underlying activity having happened is
fabricating release evidence — don't.
