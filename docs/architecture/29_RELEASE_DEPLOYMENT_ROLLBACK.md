# 29 — Release, Deployment and Safe Rollback

## 1. Release posture

PCA deploys progressively through Development, Internal QA, Family Beta, and Production. Builds, configuration, rule packages, models, and service changes have independent identity, provenance, compatibility declaration, approval, and rollback plan. No production child activity/family plaintext is copied to a lower environment. A beta is not authority to relax privacy, child transparency, emergency access, or support-boundary controls.

## 2. Immutable release record

Each candidate records source revision, build/artifact hash, signing identity, SBOM/dependency scan result, supported protocol/capability range, data/permission changes, store version codes/tracks, configuration/rule/model package hashes, test evidence, rollout cohort, approver, and rollback target. Artifact signatures and hashes are verified before promotion. A release cannot silently substitute a package after approval.

## 3. Compatibility and migrations

Enrollment/relay infrastructure remains minimal and does not become a plaintext family datastore. Changes to service-readable enrollment/license metadata use additive, backward-compatible migration first, explicit read/write compatibility, and a tested reversal. Schema/data removal is deferred until all supported clients no longer depend on it and a recovery plan exists. Ordinary update compatibility supports at least the previous stable mobile protocol minor version; an incompatible security fix uses a documented minimum-version/capability gate and safe degraded experience.

Client upgrades preserve encrypted local data and trust-set/key-epoch semantics. A rollback must never restore a revoked device’s authority, re-enable an old vulnerable key epoch, accept an invalid signature, or resurrect retention-deleted information. If a safe binary downgrade is impossible, the approved response is to stop rollout/disable the optional capability and issue a corrected forward build.

## 4. Progressive rollout and signals

Android uses internal, testing, staged production tracks; Apple uses internal testing, TestFlight, and App Store release controls. Cohorts are held long enough to assess the bounded operational signals permitted by document 27: crash/error rate, capability activation failure, performance/latency buckets, enrollment outcome, support volume category, and privacy-sentinel alarms. No rollout decision uses child activity content.

Go/no-go requires the evidence pack in document 25, all gates in document 28, current store declarations, signed package verification, tested fallback for unavailable Apple/Android capabilities, and an identified incident owner. Feature flags/capability gates are narrow, signed/configuration-controlled, time-bounded where practical, auditable, and cannot bypass a local security check or turn a disabled monitoring feature into concealed monitoring.

## 5. Rules, models and configuration

Web-filter rules, ML/AI models, policy/configuration packages, and capability manifests use signed versioned packages with checksum validation, compatibility range, staged rollout, expiry/revocation behavior, and a last-known-safe package. They are independently rollbackable from the application binary. A package rejected by signature, expiry, schema, or compatibility checks is not applied; PCA enters an accurate limited/unavailable state and informs the appropriate parent/child UI without exposing bypass detail.

## 6. Incident stop and rollback runbook

For a privacy, security, safety, correctness, or store-policy incident:

1. Declare severity and freeze promotion; preserve emergency access and do not collect extra family data for diagnosis.
2. Stop the affected cohort and disable only the unsafe optional feature through the signed, audited configuration path when that is safer than binary rollback.
3. Select the recorded last-known-safe artifact/package and verify signature, hash, compatibility, key-epoch/revocation safety, and deletion semantics before activation.
4. Roll back rules/models/configuration first where sufficient; use store rollback/forward-fix paths according to platform constraints. Never distribute a hidden/off-store build to evade review.
5. Verify the rollback on representative devices: emergency floor, correct transparency status, no plaintext observability, no reactivation of revoked access, no deleted-data resurrection, and protocol interoperability.
6. Communicate a truthful, minimized incident notice to affected parties where required; retain only necessary redacted operational evidence.
7. Complete root cause, privacy/security assessment, corrective test, documentation update, and explicit approval before renewed rollout.

Rollback has a safe-degradation outcome: if a protection feature cannot be safely restored, it remains clearly marked unavailable/limited rather than falsely active. It must not cause lockout, remove emergency calling, force collection of additional data, or weaken the trust-set/key-epoch model defined in documents 09–11.

## 7. Operational readiness and exit criteria

Before Production promotion, conduct a recorded rollback drill for binary, service metadata change, rule/model package, and configuration flag. Confirm incident contacts, store escalation paths, support scripts, privacy response, artifact retention, and regional/capability controls. Production rollout is stopped and remediation reopened upon any release gate failure in document 28. Release completion records the final artifact/package versions and rollout decision; it is not evidence of owner acceptance of the architecture or authorization to implement new capability.
