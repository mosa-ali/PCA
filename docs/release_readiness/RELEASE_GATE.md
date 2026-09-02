# PCA Release Gate (PCA-19)

## Rule

A release candidate targeting any production capability that depends on
functional device-session issuance or inbound envelope acceptance is
**NOT RELEASABLE** while either of the following holds:

- `PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW` (i.e.
  `backend/src/main.ts` still wires `RejectingDeviceSignatureVerifier` /
  `RejectingEnvelopeSignatureVerifier` from
  `backend/src/runtime-sync/RejectingCryptoVerifiers.ts`), or
- `REAL_UAT = NOT_EXECUTED` (i.e. `uat_execution_log.json` `status` is not
  `COMPLETE` with a recorded go/no-go decision).

This is not a bypassable checklist item. It is enforced mechanically by
[`tooling/release/Invoke-ReleaseGateCheck.ps1`](../../tooling/release/Invoke-ReleaseGateCheck.ps1),
which:

1. Scans `backend/src/main.ts` for the Rejecting verifier wiring to derive
   `PRODUCTION_CRYPTO_SUITE` state directly from source — it does not trust
   a hand-edited flag, because that would be trivially gameable.
2. Reads `uat_execution_log.json`'s `status` field to derive `REAL_UAT`
   state. This one *is* a hand-maintained file, because "did a human run
   real-device UAT" cannot be derived from source code — it can only be
   attested by the human who did it, which is why changing it away from
   `NOT_EXECUTED` requires the owner discipline described in that file's
   own header.
3. Reads `external_gate_matrix.json` and fails the gate for any external
   gate relevant to the targeted release scope that is not `CLOSED`.
4. Exits non-zero (`NOT READY`) unless every condition above is satisfied.

## Running it

```
pwsh tooling/release/Invoke-ReleaseGateCheck.ps1
```

Exit code `0` means READY. Any other exit code means NOT READY, and the
script prints exactly which condition(s) failed.

## Current state (informational — re-run the script for the live answer)

As of this lane's work (git SHA recorded in the evidence pack):

- `PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW` — confirmed by
  source inspection; both Rejecting verifiers are wired in
  `backend/src/main.ts` and both fail closed (`return false`) on every
  call. Device-session issuance and inbound envelope acceptance are
  correctly, completely non-functional in production today.
- `REAL_UAT = NOT_EXECUTED` — `uat_execution_log.json` has never been
  updated by a human tester; `casesLogged: 0` of `50`.
- All 34 registered external gates are `BLOCKED` or `EXTERNAL`; none is
  `CLOSED` and none has evidence populated. `external_gate_matrix.json` is
  authoritative and holds 33; `PAYMENT_PRODUCTION_CERTIFICATION` is
  registered in the completion matrix but not yet in that JSON, so the gate
  script does not currently enforce it. `EXTERNAL_GATE_MATRIX.md` documents
  only the original 7 and is not exhaustive.

**Therefore the release gate correctly reports NOT READY.** This is the
honest, expected state — do not "fix" the gate script to pass; fix the
underlying conditions (get the crypto suite reviewed, run real UAT, close
the external gates) instead.

## What this gate does not cover

Passing this gate is necessary, not sufficient. It does not replace the
full checklist in `docs/architecture/28_TEST_QA_SECURITY_VALIDATION.md` §7
(privacy absence tests, accessibility, rollback drill, store declarations,
etc.) — those remain independent release-readiness inputs tracked in
`RELEASE_EVIDENCE.md`.
