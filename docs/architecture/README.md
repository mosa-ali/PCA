# PCA Architecture Documentation Index

**Version:** 1.0  
**Date:** 2026-08-10  
**Status:** Documentation complete and published; the final verified remote SHA is recorded by the closeout report/commit after checksum verification. Pending independent review and owner acceptance.
**Implementation:** Prohibited until Gate A-100 is accepted.

This package is the controlled architecture baseline for PCA before implementation. `A_100 = PENDING_INDEPENDENT_REVIEW`; it is not owner-accepted and independent review has not passed.

| # | Document | Purpose |
|---|---|---|
| 00 | `00_DOCUMENT_CONTROL.md` | Governance, versioning and architecture-first rule |
| 01 | `01_PRODUCT_VISION_SCOPE.md` | Product vision, scope, principles and non-goals |
| 02 | `02_STAKEHOLDERS_PERSONAS_ROLES.md` | Parent, child and operator roles |
| 03 | `03_FUNCTIONAL_REQUIREMENTS.md` | Complete functional requirement baseline |
| 04 | `04_NON_FUNCTIONAL_REQUIREMENTS.md` | Security, privacy, reliability, performance and quality |
| 05 | `05_SYSTEM_CONTEXT_ARCHITECTURE.md` | System boundaries, components and data-flow principles |
| 06 | `06_ANDROID_ARCHITECTURE.md` | Android Standard/Protected capability design |
| 07 | `07_IOS_ARCHITECTURE.md` | Family Controls/Managed Settings/Device Activity design |
| 08 | `08_ENROLLMENT_DEVICE_LIFECYCLE.md` | Enrollment, pairing, replacement, revocation and removal |
| 09 | `09_SECURITY_PRIVACY_E2EE.md` | Encryption, keys, zero-knowledge relay and privacy model |
| 10 | `10_DATA_MODEL_LOCAL_STORAGE.md` | Logical local data model and storage boundaries |
| 11 | `11_DATA_RETENTION_DELETION.md` | 14d/1m/3m/6m/9m deletion architecture |
| 12 | `12_SCREEN_TIME_BREAK_ENGINE.md` | Continuous-use timer and break enforcement |
| 13 | `13_EYE_DISTANCE_PROTECTION.md` | Proximity and eye-distance design and limitations |
| 14 | `14_WEB_CONTENT_FILTERING.md` | DNS/VPN/browser filtering and content taxonomy |
| 15 | `15_APP_USAGE_YOUTUBE_VISIBILITY.md` | App usage, browser and YouTube visibility boundaries |
| 16 | `16_LOCATION_LAST_SEEN.md` | Location, last seen, geofences and offline behavior |
| 17 | `17_PRAYER_TIMES.md` | Prayer calculations, reminders and offline behavior |
| 18 | `18_PARENT_CONTROL_PANEL_RBAC.md` | Parent dashboard and family role permissions |
| 19 | `19_NOTIFICATIONS_EMAIL.md` | Push, local and privacy-preserving email notifications |
| 20 | `20_I18N_ARABIC_RTL.md` | Arabic/English localization and RTL quality rules |
| 21 | `21_TAMPER_PROTECTION_RECOVERY.md` | Anti-tamper, uninstall controls and recovery |
| 22 | `22_API_PROTOCOL_CONTRACTS.md` | Logical APIs, message envelopes and synchronization |
| 23 | `23_AI_ARCHITECTURE.md` | On-device AI, model governance and development agents |
| 24 | `24_THREAT_MODEL_ABUSE_CASES.md` | Threats, misuse prevention and security controls |
| 25 | `25_COMPLIANCE_STORE_POLICY.md` | Google Play/Apple compliance and disclosure controls |
| 26 | `26_ACCESSIBILITY_CHILD_UX.md` | Accessibility, child transparency and emergency UX |
| 27 | `27_OBSERVABILITY_SUPPORT.md` | Diagnostics without central child-activity collection |
| 28 | `28_TEST_QA_SECURITY_VALIDATION.md` | Test pyramid, device matrix, privacy/security validation |
| 29 | `29_RELEASE_DEPLOYMENT_ROLLBACK.md` | Release channels, model/rule updates and rollback |
| 30 | `30_IMPLEMENTATION_PROGRAMME.md` | Future implementation phases after architecture approval |
| 31 | `31_RISK_DECISION_REGISTER.md` | Architecture decisions, constraints and residual risks |
| 32 | `32_TRACEABILITY_ACCEPTANCE_MATRIX.md` | Requirements-to-acceptance traceability |
| 33 | `33_REFERENCE_SOURCES.md` | Official primary-source register |
| 34 | `34_ARCHITECTURE_COMPLETION_GATE.md` | Definition of “documentation 100% complete” |

## Architecture baseline statement

The architecture is intentionally **platform-honest**. PCA must never promise capabilities that Android or iOS public APIs do not reliably provide. Where strong enforcement requires device-owner/managed provisioning or Apple Family Controls authorization, the product must say so clearly.

## Gate rule

`A-100 DOCUMENTATION ACCEPTED` must be recorded before creation of production source trees. Current state: `A_100 = PENDING_INDEPENDENT_REVIEW`, `IMPLEMENTATION_STATUS = NOT_STARTED`, `IMPLEMENTATION_AUTHORIZATION = NOT_GRANTED`.
