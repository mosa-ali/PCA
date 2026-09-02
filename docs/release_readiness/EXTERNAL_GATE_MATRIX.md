# External Gate Matrix (PCA-18/19)

These are gates this repository-editing lane cannot close by writing code
or docs — each requires a real human decision, real hardware, or a real
external review outside the source tree. Machine-readable state lives in
[`external_gate_matrix.json`](./external_gate_matrix.json); this file is
a hand-maintained human-readable summary of the ORIGINAL SEVEN gates only.
It is NOT generated and NOT exhaustive: the JSON now holds 33 gates and no
generator for this file exists. Read the JSON for the authoritative list --
`tooling/release/Invoke-ReleaseGateCheck.ps1` evaluates that JSON, not this
table, and treats any status other than `CLOSED` as blocking for every gate
in it with no release-scope filter.

| Gate ID | Status | What closes it |
|---|---|---|
| `CRYPTO_SECURITY_REVIEW` | BLOCKED | An external, qualified security reviewer signs off on a concrete `DeviceSignatureVerifier`/`EnvelopeSignatureVerifier` implementation per `docs/security/production-crypto-review/PCA_CRYPTO_REVIEWER_CHECKLIST.md`, and the reviewed implementation replaces `RejectingDeviceSignatureVerifier`/`RejectingEnvelopeSignatureVerifier` in `backend/src/main.ts`. |
| `ANDROID_REAL_DEVICE_UAT` | BLOCKED | The full case catalogue in `UAT_TEST_PLAN.md` §4 is executed on real hardware from the device matrix in §3, logged in `uat_execution_log.json`, with a go/no-go decision recorded. |
| `IOS_MAC_XCODE` | EXTERNAL | A macOS machine with Xcode is provisioned for iOS build/signing/test. Not available in this Windows environment. |
| `IOS_FAMILY_CONTROLS_ENTITLEMENT` | EXTERNAL | Apple grants the Family Controls entitlement to the PCA Apple Developer account. |
| `IOS_PHYSICAL_DEVICE` | EXTERNAL | A physical iPhone/iPad is available; Family Controls/Screen Time APIs cannot be exercised on the iOS Simulator. |
| `YOUTUBE_MODE_B_POLICY_REVIEW` | BLOCKED | Compliance/legal review of YouTube API Terms of Service confirms Mode B (PCA-controlled playback) is compliant, and the reviewed decision is recorded. Backend `ModeBFeatureFlagStore` default stays disabled until then. |
| `CLOUD_AI_OWNER_DECISION` | BLOCKED | Product/privacy owner decides on-device-only vs. cloud AI classifier usage; recorded decision drives whether any cloud AI code path is ever built. |

## Rule

No agent, script, or lane may set any of these to CLOSED/GREEN. They are
closed only by the accountable human owner named in
`external_gate_matrix.json`, with an evidence reference filled into that
file's `evidence` field. `tooling/release/Invoke-ReleaseGateCheck.ps1`
treats any status other than `CLOSED` as blocking for gates the current
release targets.
