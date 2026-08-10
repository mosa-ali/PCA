# 28 — Test, QA and Security Validation Strategy

## 1. Validation principle

Every release candidate is validated against requirements, capability labels, and safe failure behavior—not only happy paths. Tests are traceable in document 32 and use synthetic/non-production family fixtures. No production child activity is copied to test systems. A test result is meaningful only when its environment, platform/OS, build, test data class, evidence location, and pass/fail disposition are retained.

## 2. Test layers

| Layer | Minimum validation |
|---|---|
| Unit/property | Policy evaluator; screen-time states; UTC/calendar retention boundary; monotonic duration; prayer calculation; RBAC; signed trust-set/protocol parser; package/hash validation; AI threshold mapping. |
| Integration | Encrypted local store and deletion lifecycle; E2EE envelope/epoch handling; offline relay queue expiry; notification/email minimization; web-filter package update; platform capability adapters. |
| Device/E2E | Supported Android OEM/OS and iPhone/iPad versions; enrollment; online/offline; reboot/power loss; time-zone/clock change; process death; permission revocation; Protected-to-Standard downgrade; update/rollback; English/Arabic/RTL/accessibility. |
| Security/privacy | Threat-model abuse cases in document 24, mobile static/dynamic review, dependency/SBOM review, signed artifact verification, penetration test before production. |

## 3. Mandatory safety and state tests

Screen-time tests explicitly cover screen on/off, short/long interruption, incoming/outgoing/emergency call, reboot, power loss, wall-clock rollback, monotonic reset, app switch, split-screen/PiP/multi-window, offline state, killed PCA process, permission loss, mode downgrade, bonus time, parent override, and the non-removable emergency floor. They verify exactly which event pauses, resets, or continues the counter as defined by document 12.

Retention tests cover each 14-day and 1/3/6/9-calendar-month option at just-before/at/after expiry; UTC conversion/time-zone/DST display; rollback non-resurrection; online/offline parent and child; queued ciphertext; local replicas; location-shorter-retention; reduction 9m→14d; increase 14d→9m; export/backup; removed device/child/family; and the documented non-forensic-delete limit. Trust/recovery tests cover role-separated keys, signed trust-set epochs, replay/rollback rejection, online convergence, offline stale/revoked device behavior, recovery-secret loss/theft, replacement parent, and absence of a support-master bypass.

## 4. Privacy absence tests

For every telemetry/log/crash/APM/analytics/support-bundle sink, automated tests inject recognisable synthetic sentinels and assert their absence from captured outbound payloads, stored event records, dashboards, queues, and vendor SDK buffers. The absence corpus includes:

- full URLs/domains, page titles and search queries;
- exact location coordinates, geofences and route/last-seen detail;
- app-usage events/history and screen sessions;
- YouTube IDs, titles and viewing-history markers;
- camera/face-frame bytes, landmarks and eye-distance detail;
- policy/family payload plaintext, parent/child free text and Dhikr activity;
- FDEKs/session/private keys, public-key private material, recovery secrets/codes, and recovery-envelope plaintext.

Tests also assert that free-form exception messages, network request/response bodies, headers, breadcrumbs, view hierarchy, screenshots, session replay, and debug dumps are disabled or scrubbed. Positive tests allow only the documented, bounded operational fields in document 27. A pass means **no observed emission across tested sinks**, not a claim that infrastructure metadata is invisible; IP, push, licensing and delivery metadata are separately tested for minimization and access control.

## 5. Accessibility, localization and transparency tests

Use current Android/iOS accessibility tools plus manual child-journey testing with screen reader, text scaling, contrast/reduced motion, touch accommodations, offline state, and permission denial. Validate Arabic true RTL and English independently, with mixed-direction domains/emails/codes/app names, dates/times/numbers, charts/timelines text equivalents, notification/email/error/break strings, prayer names, reports, transparency explanations, and accessible labels. Parent and child devices are tested in different language combinations. Emergency help must remain discoverable and usable in every tested state.

## 6. Store, release and rollback validation

Pre-submission validation verifies declared monitoring-tool metadata across every Android artifact/track, persistent notice/unique icon, disclosures, target-audience/data-safety answers, permission/SDK inventory, Apple entitlement/fallback, and country gating. Rollback drills prove artifact provenance, signed rule/model rollback, compatibility behavior, kill-switch safety, preservation of emergency access, and no downgrade that reads or exports new activity data. Rollback is tested before production rollout, not improvised during an incident.

## 7. Release gates and independent review

Release is blocked if a requirement has no planned/passing acceptance evidence; a critical/high security issue remains open; a privacy absence test fails; a sensitive field is observed in any telemetry/support sink; retention/deletion fails; platform capability is overstated; Arabic/RTL/accessibility critical flow fails; emergency access is blocked; or a rollback drill fails. Exceptions require documented risk acceptance by the authorized owner and cannot waive the emergency, key/secrets, plaintext-observability, or child-transparency boundaries.
