# 31 — Risk and Decision Register

## Decision classification rule

Open decisions are visible and classified: **PRE-IMPLEMENTATION BLOCKER** must be approved before its named phase; **PRODUCT DEFAULT DECISION** may remain proposed at A-100 when alternatives, recommendation and phase are specified; **EXTERNAL DEPENDENCY** has a fallback; **A-100 BLOCKER** means architecture cannot be safely specified without a ruling.

| ID | Decision / risk | Classification | Status, recommendation and consequence |
|---|---|---|---|
| ADR-001 | Native Kotlin Android and Swift iOS | ACCEPTED BASELINE | Native OS controls; PCA-0 establishes workspaces after authorization. |
| ADR-002 | Parent/child roles and local, E2EE family store | ACCEPTED BASELINE | No readable activity service. |
| ADR-003 | Separate signing, key-agreement and FDEK roles; recovery envelope and trust epochs | ACCEPTED BASELINE | PCA-1 must implement docs 08–11 as one protocol. |
| ADR-004 | Android Standard and Protected modes | ACCEPTED BASELINE | Controls disclose availability; Protected assertions require managed authority. |
| ADR-005 | iOS Family Controls / Managed Settings / Device Activity | ACCEPTED BASELINE | Opaque tokens and entitlement constraints remain visible. |
| ADR-006 | Deterministic filtering before optional on-device AI; no covert TLS interception | ACCEPTED BASELINE | PCA-5/PCA-14 only process legitimately visible data. |
| ADR-007 | Arabic and English, full RTL at launch | ACCEPTED BASELINE | PCA-16 acceptance requires both independently selectable. |
| ADR-008 | Retention windows: 14d, 1m, 3m, 6m, 9m | ACCEPTED BASELINE | UTC events; calendar-month policy context; monotonic durations. |
| PCA-DEC-001 | Android Protected provisioning/distribution approach | PRE-IMPLEMENTATION BLOCKER | Approve before PCA-2 Protected Mode work; fallback is honest Standard Mode. |
| PCA-DEC-002 | Family Controls entitlement | EXTERNAL DEPENDENCY | Apply before PCA-15; fallback is no iOS restriction claim beyond public available capability. |
| PCA-DEC-003 | First-enrollment retention default | PRODUCT DEFAULT DECISION | Proposed 1 month; alternatives are the five windows; configure in PCA-1/12. |
| PCA-DEC-004 | Device-class battery budget | PRODUCT DEFAULT DECISION | Benchmark in PCA-2/15; disclose measured tiered budget, never invent a number. |
| PCA-DEC-005 | Controlled YouTube Mode B launch | PRE-IMPLEMENTATION BLOCKER | Decide before PCA-6; fallback is Mode A duration-only visibility. |
| PCA-DEC-006 | Recovery material custody UX | PRE-IMPLEMENTATION BLOCKER | Approve before PCA-1; no support master key; lost sole recovery secret means new family. |
| PCA-DEC-007 | Adult/child legal and regional onboarding disclosures | PRODUCT DEFAULT DECISION | Legal copy review before PCA-17; no hidden monitoring regardless. |
| PCA-DEC-008 | Any safety/security ambiguity in recovery or trust model | A-100 BLOCKER | None currently recorded as unresolved: docs 08–11 specify the protocol. |

## Residual risks

| Risk | Impact | Mitigation / gate |
|---|---|---|
| Android authority, OEM background limits, VPN disable | High | capability matrix, health/degraded state, Standard fallback; validate PCA-2/17. |
| Apple entitlement / opaque activity model | High | entitlement application, explicit fallback and capability labels; validate PCA-15/17. |
| Stolen/offline device or recovery-code theft | High | signed epoch rotation, recovery authentication, stale/revoked state; no retroactive wipe claim. |
| E2EE support/recovery complexity | High | recovery envelope, replacement-device procedure, no support decryption; test PCA-1/17. |
| Classifier error or malicious rules/models | Medium | deterministic precedence, signing, rollback and appeal path. |
| Platform/policy/source changes | High | doc 33 180-day source revalidation before each affected phase. |
