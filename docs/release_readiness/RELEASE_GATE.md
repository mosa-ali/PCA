# PCA Release Gate (PCA-19)

## Rule

`-ReleaseTarget` is REQUIRED (one of `PUBLIC_A`, `AUTH_B`, `PARENT_C`,
`ANDROID_D`, `IOS_FUTURE`, `BILLING_FUTURE`) — there is no default, no
interactive prompt, and a missing or unrecognized value fails the whole
evaluation closed immediately. A release candidate for the given target is
**NOT RELEASABLE** while any of the following, SCOPED TO THAT TARGET, holds:

- `PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW` (i.e.
  `backend/src/main.ts` still wires `RejectingDeviceSignatureVerifier` /
  `RejectingEnvelopeSignatureVerifier` from
  `backend/src/runtime-sync/RejectingCryptoVerifiers.ts`) — only evaluated
  for targets that actually depend on it (currently `PARENT_C`,
  `ANDROID_D`, `IOS_FUTURE`; never `PUBLIC_A` or `AUTH_B`), or
- `REAL_UAT` is not satisfied for the cases actually relevant to that
  target (i.e. `uat_execution_log.json`'s human-logged `cases` don't cover
  every planned case `UAT_TEST_PLAN.md` §4 assigns to that target — a
  target with zero relevant cases is vacuously satisfied), or
- an external gate whose `releaseScope` (a HARD dependency) includes that
  target is not `CLOSED`.

A gate whose `conditionalReleaseScope` (a real but FEATURE-SCOPED
dependency, not a hard one) includes the target is surfaced separately
(`CONDITIONAL_GATES_PENDING`) but never blocks the base release for that
target — see
[`docs/supervision/PCA_FABLE_EXTERNAL_GATE_RELEASE_SCOPE.csv`](../supervision/PCA_FABLE_EXTERNAL_GATE_RELEASE_SCOPE.csv)
(YES → hard, PARTIAL → conditional, NO → neither) for the authoritative
per-gate-per-target answer key, and
[`tooling/release/ValidateFableScopeParity.mjs`](../../tooling/release/ValidateFableScopeParity.mjs)
for the tool that reconciles every cell of it against
`external_gate_matrix.json`.

This is not a bypassable checklist item. It is enforced mechanically by
[`tooling/release/Invoke-ReleaseGateCheck.ps1`](../../tooling/release/Invoke-ReleaseGateCheck.ps1),
which:

1. Scans `backend/src/main.ts` for the Rejecting verifier wiring to derive
   `PRODUCTION_CRYPTO_SUITE` state directly from source — it does not trust
   a hand-edited flag, because that would be trivially gameable.
2. Reads `uat_execution_log.json`'s human-logged `cases` to derive
   `REAL_UAT` state for the selected target. This is a hand-maintained
   file, because "did a human run real-device UAT" cannot be derived from
   source code — it can only be attested by the human who did it, which is
   why advancing it requires the owner discipline described in that file's
   own header. The script never writes to it.
3. Reads `external_gate_matrix.json` and fails the gate for any external
   gate whose `releaseScope` includes the selected target and is not
   `CLOSED`.
4. Exits non-zero (`NOT READY`) unless every condition above is satisfied
   for the selected target.

`-IgnoreExternalGates` is informational-only, and this is enforced in the
script's own output, not just documented here: with it set, `verdict` is
always `INFORMATIONAL_ONLY` (never `READY`) and the exit code is always
non-zero (`2`) — never the release-ready exit code — even when crypto/UAT
happen to pass on their own, so a caller checking only the exit code can
never mistake an `-IgnoreExternalGates` run for a real release verdict.

## Running it

```
pwsh tooling/release/Invoke-ReleaseGateCheck.ps1 -ReleaseTarget PUBLIC_A
```

(substitute the release you're actually evaluating — `AUTH_B`, `PARENT_C`,
`ANDROID_D`, `IOS_FUTURE`, or `BILLING_FUTURE`)

Exit code `0` means READY *for that target*. Exit code `1` means NOT READY.
Exit code `2` means the run was `-IgnoreExternalGates`-only and is
explicitly not a release verdict. The script prints exactly which
condition(s) failed, and which are hard (`OWNER_GATES_PENDING`) vs.
conditional (`CONDITIONAL_GATES_PENDING`). Pass `-JsonOutPath <file>` for a
machine-readable summary.

## Current state (informational — re-run the script for the live answer)

Re-executed on 2026-09-08 for all six targets (`docs/supervision/PCA_FINAL_GAP_ASSESSMENT_2026-09-08.md` §N has the verbatim output):

- `PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW` — derived from
  source; both Rejecting verifiers are wired in `backend/src/main.ts` and
  fail closed. Since 2026-09-08 the envelope-context resolver next to them is
  also fail-closed by construction (`rejectingResolveEnvelopeContext`), so
  activating a reviewed verifier without a real trust-set resolver can no
  longer open an anti-downgrade hole. Only in scope for PARENT_C, ANDROID_D,
  IOS_FUTURE.
- `REAL_UAT = NOT_EXECUTED` — `uat_execution_log.json` has never been
  updated by a human tester; `casesLogged: 0` of `54`. PUBLIC_A, IOS_FUTURE
  and BILLING_FUTURE have zero mapped cases and therefore fail closed as
  `UAT_PLAN_INCOMPLETE_FOR_TARGET` — an acknowledged, owner-decision
  contradiction (see `ValidateFableScopeParity.mjs`), not a satisfied term.
- All **39** registered external gates are `BLOCKED` or `EXTERNAL`; none is
  `CLOSED` and none has evidence populated. `external_gate_matrix.json` is
  authoritative and `EXTERNAL_GATE_MATRIX.md` is now generated from it
  (`tooling/release/GenerateExternalGateMatrixMd.mjs`, checked in CI). Two
  gates were added on 2026-09-08: `ANDROID_RELEASE_SIGNING_CONFIG` (no
  release build type or signing config exists) and
  `PRODUCTION_EMAIL_CREDENTIAL_ROTATION` (owner-reported compromised SMTP
  credential; the repository cannot verify rotation).
- Per target: PUBLIC_A 3 hard gates open + unsatisfiable `REAL_UAT`; AUTH_B
  3 hard; PARENT_C 8 hard; ANDROID_D 17 hard; IOS_FUTURE 9 hard;
  BILLING_FUTURE 7 hard.

**Therefore the release gate correctly reports NOT READY for every target.** This is the
honest, expected state — do not "fix" the gate script to pass; fix the
underlying conditions (get the crypto suite reviewed, run real UAT, close
the external gates) instead.

## What this gate does not cover

Passing this gate is necessary, not sufficient. It does not replace the
full checklist in `docs/architecture/28_TEST_QA_SECURITY_VALIDATION.md` §7
(privacy absence tests, accessibility, rollback drill, store declarations,
etc.) — those remain independent release-readiness inputs tracked in
`RELEASE_EVIDENCE.md`.
