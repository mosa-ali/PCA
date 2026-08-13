# Release Rollback Checklist (operational companion to doc 29 §6-7)

This is the executable checklist form of
`docs/architecture/29_RELEASE_DEPLOYMENT_ROLLBACK.md` §6 (Incident stop and
rollback runbook) and §7 (Operational readiness and exit criteria). Use it
during an actual incident or during a scheduled rollback drill. It does not
replace that document — it operationalizes it into check-off form.

## Before promoting any release candidate to production

- [ ] Immutable release record captured (git SHA, artifact hash, signing
      identity, SBOM/dependency scan result — see `RELEASE_EVIDENCE.md`).
- [ ] Last-known-safe (LKS) artifact and package versions identified and
      recorded (binary, rule/model/config packages, each independently).
- [ ] `Invoke-ReleaseGateCheck.ps1` reports READY (see `RELEASE_GATE.md`).
- [ ] Rollback drill executed and passed for: binary rollback, service
      metadata change rollback, rule/model package rollback, configuration
      flag rollback (doc 29 §7). Record drill date, artifacts used, and
      outcome below.
- [ ] Incident contacts, store escalation paths, and support scripts are
      current and reachable.

## Drill / incident record

| Field | Value |
|---|---|
| Date | *(fill in)* |
| Drill or real incident | *(fill in)* |
| Severity (if incident) | *(fill in)* |
| LKS artifact/package identified | *(fill in)* |
| Rollback type exercised | binary / service metadata / rule-model package / config flag *(circle)* |
| Verified on representative device | yes/no — device ID from `UAT_TEST_PLAN.md` §3 |
| Emergency floor intact after rollback | yes/no |
| No plaintext observability introduced | yes/no |
| No revoked-device reactivation | yes/no |
| No deleted-data resurrection | yes/no |
| Protocol interoperability confirmed | yes/no |
| Outcome | pass / fail |

## Incident stop sequence (doc 29 §6, checklist form)

1. [ ] Declare severity; freeze promotion.
2. [ ] Preserve emergency access; do not collect extra family data for
       diagnosis.
3. [ ] Stop affected cohort; prefer disabling the unsafe optional feature
       via the signed, audited configuration path over a full binary
       rollback when that is safer.
4. [ ] Select recorded LKS artifact/package; verify signature, hash,
       compatibility, key-epoch/revocation safety, deletion semantics
       *before* activation.
5. [ ] Roll back rules/models/configuration first where sufficient; use
       platform store rollback/forward-fix paths. Never distribute a
       hidden/off-store build to evade review.
6. [ ] Verify on representative devices: emergency floor, correct
       transparency status, no plaintext observability, no reactivated
       revoked access, no resurrected deleted data, protocol
       interoperability.
7. [ ] Communicate a truthful, minimized incident notice where required;
       retain only necessary redacted operational evidence.
8. [ ] Complete root cause, privacy/security assessment, corrective test,
       documentation update, and explicit approval before renewed rollout.

## Reminder

Rollback's only acceptable failure mode is safe degradation: a feature
that cannot be safely restored stays marked unavailable/limited. It must
never cause lockout, remove emergency calling, force additional data
collection, or weaken the trust-set/key-epoch model (docs 09-11).
