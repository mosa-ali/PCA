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
FINAL_IMPLEMENTATION_SHA=
REMOTE_HEAD=
WORKTREE=

A012_BEFORE=PRODUCTION_REACHABLE
A012_AFTER=NON_PRODUCTION_SCAFFOLDING_OR_TEST_ONLY
A012_SOURCE_CHANGE_REQUIRED=
A012_PRODUCTION_READABLE_STORE=
A012_FAIL_CLOSED=
A012_PRIVACY_RESULT=

MUTATION_DEFAULT_AFTER_FINAL_COMMIT=
MUTATION_BASELINE_MODEL=
MUTATION_ARTIFACT_HEAD=
MUTATION_COUNTS=
MUTATION_SURVIVED=

PCA15=
ALERT_LOGGER=
A031=
G41=
PRODUCT_DEFECT_REPRODUCED=
ROOT_CAUSE_PROVEN=

WEB_RULE_TESTS=
PRIVACY_SENTINELS=
FULL_TEST_RESULTS=
CI_RESULTS=

P0_OPEN=
P1_OPEN=
P2_OPEN=
UNEXPLAINED_ENGINEERING_ITEMS=

READY_FOR_FABLE_REREVIEW=YES
```

The final report must also state exact `KILLED`, `EQUIVALENT`, `INVALID`,
`SURVIVED`, and `ENVIRONMENT_BLOCK` mutation counts, and must keep the
mutation surfaces separate: backend real execution; parent-web static
classification; Android static classification; aggregate totals.

## Known boundaries

`mutation-scope.json.entrySha` is informational manifest provenance. The default mutation runner uses the current `HEAD`, so a later commit cannot make the normal no-argument command stale merely by moving `HEAD`. Pinned baselines remain explicit inputs.

The backend mutation count is 10. Parent Web has 10 static-only mutants and Android has 8 static-only mutants. The aggregate total is 28 and must never be labelled as backend real execution.

PCA-15 remains externally unvalidated without macOS/Xcode and device evidence. G41 remains unresolved. Release targets remain subject to their existing external gates. No deployment or Azure work was performed.
