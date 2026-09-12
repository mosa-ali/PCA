# PCA FABLE Re-review Request

This is a request for independent review of the engineering acceptance corrections. It does not self-certify closure and does not authorize deployment, Azure changes, or Prompt 2.

## Required review points

1. Verify the A012 construction/bootstrap trace and the new fail-closed production boundary.
2. Run the documented mutation command at the final pushed HEAD with no baseline flag.
3. Confirm that mutation evidence is labelled by surface: backend real execution; parent-web static classification; Android static classification; aggregate totals separately.
4. Keep G41 `UNRESOLVED` unless a trace-bearing reproduction directly proves a causal mechanism.
5. Verify the focused backend tests, repository validators, CI result, and final remote HEAD.

## Evidence fields

```text
IMPLEMENTATION_CORRECTION_SHA=15baf12ffb49c79e449f59578d6549e2fa0e7d8c
PRIOR_EVIDENCE_HEAD=0631b2f49fc814855054070630e86067a1d7e3b8
FINAL_EVIDENCE_HEAD=4cd262f342c5a6c321253d37d1faf0247dac1d60 (source/evidence commit containing the regenerated report)
WORKTREE=CLEAN_AT_SOURCE_EVIDENCE_COMMIT; metadata follow-up remains documentation-only

A012_BEFORE=PRODUCTION_REACHABLE
A012_AFTER=NON_PRODUCTION_SCAFFOLDING_OR_TEST_ONLY
A012_SOURCE_CHANGE_REQUIRED=YES
A012_PRODUCTION_READABLE_STORE=0 central backend store; Android local durable working set separate
A012_FAIL_CLOSED=YES; 503 not_configured without approved service/repository
A012_PRIVACY_RESULT=FAIL_CLOSED_COMPLIANT_WITH_PCA-SEC-023_PENDING_REVIEWED_ENCRYPTED_IMPLEMENTATION

MUTATION_PROVENANCE_MODEL=SOURCE_FINGERPRINT_V1_WITH_SEPARATE_EVIDENCE_HEAD
MUTATION_SOURCE_SHA=c301900f6988f1b20044d3dd1b1c3613bfa346ad
MUTATION_SOURCE_FINGERPRINT=bb354a8f52079094da6d8e79dbfa0e17a807a5d658ee6b0c95c8c21375fa26e3
MUTATION_SCOPE_FINGERPRINT=0c7c00d6e81b6e25253801932c27e4c9389d01d536113baaf06fe74a823930a1
MUTATION_SOURCE_INPUT_FILES=2329
MUTATION_REPORT_GENERATED_AT_HEAD=c301900f6988f1b20044d3dd1b1c3613bfa346ad
MUTATION_DEFAULT_POST_COMMIT=PASS; no-argument run at 4cd262f retained report; REPORT_WRITTEN=false
MUTATION_BASELINE_MODEL=current HEAD (default); manifest entry SHA informational only
MUTATION_ARTIFACT_HEAD=c301900f6988f1b20044d3dd1b1c3613bfa346ad (sourceHead/mutationHead in report)
MUTATION_EVIDENCE_HEAD=4cd262f342c5a6c321253d37d1faf0247dac1d60
MUTATION_COUNTS=aggregate KILLED:22,EQUIVALENT:3,INVALID:3,SURVIVED:0; backend real 8/1/1/0; parent-web static 8/1/1/0; Android static 6/1/1/0
MUTATION_SURVIVED=0; valid survivors 0; ENVIRONMENT_BLOCK=null; manifest anomalies []

PCA15=EXTERNALLY_BLOCKED_XCODE_MACOS_DEVICE
ALERT_LOGGER=BOUNDED_OBSERVABLE_NO_RAW_PAYLOAD
A031=EXISTING_OWNER_DECISION_RETENTION_OWNER_RBAC_D9
G41=UNRESOLVED
PRODUCT_DEFECT_REPRODUCED=NO
ROOT_CAUSE_PROVEN=NO

WEB_RULE_TESTS=26/26 PASS focused WebRuleStore/routes/production-wiring tests; backend build PASS
PRIVACY_SENTINELS=PASS synthetic A012 domain not persisted/logged/audited/telemetered/echoed; repository/security/quality sentinels PASS
FULL_TEST_RESULTS=backend npm test PASS (run-tests 2349/2349, 0 failed, 0 skipped); parent-web 138 files/999 tests PASS; platform-admin-web 32 files/155 tests PASS; public-web 6/6 PASS; Android testDebugUnitTest BUILD SUCCESSFUL; MySQL BLOCKED ECONNREFUSED 127.0.0.1:33061; validators/contracts/release controls PASS
CI_RESULTS=run 34723720821 / 283 for head 4cd262f: 23 jobs, 21 green, 2 red, 0 skipped/cancelled; red jobs iOS build and unit tests plus dependency vulnerability audit; Android completed green; the audit was not reproducible locally across all six workspaces and has no dependency-file delta in this correction; follow-up CI observation pending

P0_OPEN=0
P1_OPEN=0 engineering correction items; external gates remain separately unresolved
P2_OPEN=1 pending fresh CI confirmation of the non-reproducible dependency-audit failure
UNEXPLAINED_ENGINEERING_ITEMS=0; G41 is explicitly explained as unresolved/no proven cause

READY_FOR_FABLE_REREVIEW=NO_PENDING_FOLLOW_UP_CI
```

The final report must also state exact `KILLED`, `EQUIVALENT`, `INVALID`,
`SURVIVED`, and `ENVIRONMENT_BLOCK` mutation counts, and must keep the
mutation surfaces separate: backend real execution; parent-web static
classification; Android static classification; aggregate totals.

## Known boundaries

`mutation-scope.json.entrySha` is informational manifest provenance. The default mutation runner uses the current `HEAD`, so a later commit cannot make the normal no-argument command stale merely by moving `HEAD`. Pinned baselines remain explicit inputs.

The backend mutation count is 10. Parent Web has 10 static-only mutants and Android has 8 static-only mutants. The aggregate total is 28 and must never be labelled as backend real execution.

PCA-15 remains externally unvalidated without macOS/Xcode and device evidence. G41 remains unresolved. Release targets remain subject to their existing external gates. No deployment or Azure work was performed.
