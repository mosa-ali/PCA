# PCA Addendum 001 — Secure Invite, Protected Enrollment, and Parent Administration PIN

## Control

| Field | Value |
|---|---|
| Addendum ID | PCA-ADDENDUM-001 |
| Authority | `PCA-DEC-009 = OWNER_APPROVED` |
| Status | APPROVED FOR IMPLEMENTATION; NOT YET IMPLEMENTED |
| Baseline | A-100 Architecture v1.0; its 199 normative requirements remain immutable |
| Scope | Secure child-device invitation, capability-honest enrollment, parent Administration PIN, and authorized disable/removal decisions |
| Out of scope | Hidden installation, installation-security bypass, plaintext family activity storage, server-held family decryption keys, or a staff recovery bypass |

This controlled implementation addendum is additional authority only. It does not amend, renumber, reinterpret, or count as part of the accepted A-100 199-requirement inventory. Its exact normative inventory is `PCA-ADD-ENR-001` through `PCA-ADD-ENR-025`; implementation mapping is maintained in [PCA implementation traceability](../PCA_IMPLEMENTATION_TRACEABILITY.md).

## Product and platform boundary

An authorized parent creates an enrollment invitation for one selected child, target platform, desired protection mode, and initial policy profile. PCA produces a one-time enrollment link, QR code, and short fallback code. The link is an invitation handoff, not a covert installer: an installed app resumes through verified App/Universal Link handling; an uninstalled device uses the supported store/distribution flow and then resumes enrollment. Android managed provisioning is only a Protected Mode capability when actual management authority has been established. iOS remains limited to Apple-supported enrollment, authorization, and Family Controls capabilities.

Child-facing flows disclose that parental-control management is active, the applicable protection state, available request paths, and the permanent emergency safety floor. They never impersonate a system app or conceal monitoring.

## Exact addendum requirements

| ID | Normative requirement |
|---|---|
| PCA-ADD-ENR-001 | The parent administration experience SHALL require selection of a child, Android or iOS target, requested protection mode, and initial policy profile before invitation creation. |
| PCA-ADD-ENR-002 | A created invitation SHALL provide a one-time enrollment link, QR representation of that link, and a short fallback code that identifies only an opaque invitation. |
| PCA-ADD-ENR-003 | An invitation URL, QR code, and fallback code SHALL NOT contain a parent password, Administration PIN, family encryption key, recovery secret, FDEK, readable child information, or policy plaintext. |
| PCA-ADD-ENR-004 | Invitation tokens SHALL be cryptographically random, short-lived, single-use, revocable, bound to the intended enrollment flow, and stored server-side only as an appropriate opaque verifier or hash. |
| PCA-ADD-ENR-005 | Invitation lifecycle SHALL support exactly the states `CREATED`, `OPENED`, `INSTALL_REQUIRED`, `APP_INSTALLED`, `AUTHORIZATION_REQUIRED`, `REDEEMED`, `EXPIRED`, and `REVOKED`, with validated transitions and immutable transition audit evidence. |
| PCA-ADD-ENR-006 | A redeemed, expired, or revoked invitation SHALL fail closed and SHALL NOT enroll another device; redemption SHALL be idempotent only for the same accepted device-flow result. |
| PCA-ADD-ENR-007 | The parent administration experience SHALL expose invitation status and permit revocation without exposing a reusable token or protected family data. |
| PCA-ADD-ENR-008 | Standard Android enrollment SHALL use supported installation and verified App Link continuation only; it SHALL NOT claim or attempt silent installation or unmanaged Device Owner authority. |
| PCA-ADD-ENR-009 | Android Protected enrollment SHALL enable managed provisioning, management authority, uninstall blocking, or managed policy enforcement only after documented OS authority has been proven for that device. |
| PCA-ADD-ENR-010 | iOS enrollment SHALL use Apple-supported distribution and Universal Link continuation, and SHALL invoke FamilyControls, ManagedSettings, or DeviceActivity only after required authorization and entitlement are present. |
| PCA-ADD-ENR-011 | Child enrollment and protection views SHALL plainly disclose active parental-control management, parent-visible categories, current restrictions, request-more-time, request-policy-change, removal-request, and emergency-access paths; they SHALL NOT conceal PCA or simulate a system identity. |
| PCA-ADD-ENR-012 | The parent panel SHALL offer Administration PIN configuration with a minimum recommendation of six digits or stronger and a user-visible explanation of its offline-fallback role. |
| PCA-ADD-ENR-013 | Sensitive parent actions SHALL prefer signed authorization from an approved parent device and MAY use device biometric authentication; Administration PIN is an offline fallback and approved recovery remains a distinct authorized path. |
| PCA-ADD-ENR-014 | Administration PIN verification SHALL use a unique salt and a security-reviewed memory-hard or deliberately slow verifier, rate limiting, and progressive failure delay; the raw PIN SHALL NOT be stored. |
| PCA-ADD-ENR-015 | The Administration PIN SHALL NOT appear in invitations, QR codes, URLs, logs, analytics, support bundles, push payloads, API responses, or reusable central records. |
| PCA-ADD-ENR-016 | A child disable or removal attempt SHALL enter `PARENT_APPROVAL_REQUIRED` where a protective authority applies and SHALL offer parent request, authenticated remote parent decision, local Administration PIN authorization, and authorized recovery as applicable. |
| PCA-ADD-ENR-017 | A parent removal/disable decision SHALL support `KEEP_ACTIVE`, `TEMPORARILY_DISABLE`, and `ALLOW_REMOVAL`, and SHALL show the parent the child, device, time, protection level, and supplied reason when present. |
| PCA-ADD-ENR-018 | A remote disable/removal decision SHALL be authenticated, role-authorized, signed, anti-replay protected, time-bounded, and bound to the exact child, device, request, and action. |
| PCA-ADD-ENR-019 | Device UI and parent UI SHALL report the actual protection state using `STANDARD`, `PROTECTED`, `DEGRADED`, `AUTHORIZATION_REQUIRED`, or `NOT_SUPPORTED`, and SHALL NOT promise absolute anti-uninstall where platform authority does not provide it. |
| PCA-ADD-ENR-020 | PCA SHALL generate metadata-minimized E2EE family alerts, when configured and applicable, for disable/removal requests, repeated invalid PIN, authorization or management-authority change, listed critical permission/VPN loss, unexpected offline state, time tampering, protection degradation, reinstallation, invitation redemption, and unenrollment. |
| PCA-ADD-ENR-021 | Invitation, enrollment, protection, removal, and break flows SHALL preserve emergency calling, critical OS safety functions, and approved emergency contacts where applicable. |
| PCA-ADD-ENR-022 | The service SHALL retain only the invitation verifier/opaque identifier, lifecycle and minimal delivery/audit metadata, and enrollment public-material records required for the flow; it SHALL NOT retain readable family policy, activity, location, PIN, private key, FDEK, or recovery secret. |
| PCA-ADD-ENR-023 | Persistence SHALL model invitation creation, transition, revocation, redemption, and associated device-enrollment records with expiry enforcement, atomic single-redemption protection, and auditable correlation identifiers that are opaque and bounded. |
| PCA-ADD-ENR-024 | Enrollment and removal APIs SHALL reject token reuse, token/request substitution, expired authorization, wrong-parent authorization, revoked authority, replayed signed decisions, and malformed state transitions without leaking protected details. |
| PCA-ADD-ENR-025 | This addendum SHALL be implemented across PCA-1, PCA-2, PCA-10, PCA-11, PCA-13, and PCA-15, with backend, database, security, and test evidence recorded per requirement before a requirement is marked implemented. |

## Required evidence and gates

Implementation must prove token entropy/verifier handling; no-secret URL/QR/log/push/API absence; lifecycle and concurrent redemption behavior; Standard/Protected/iOS capability truthfulness; PIN KDF, throttling, delay and recovery behavior; signed decision binding, expiry, and replay rejection; emergency-floor reachability; and the central-service plaintext absence boundary. Android Protected and iOS claims remain platform-validation dependent; this document authorizes no unsupported OS behavior.

## Related accepted architecture

- [Enrollment lifecycle](../../architecture/08_ENROLLMENT_DEVICE_LIFECYCLE.md)
- [Security, privacy, and E2EE](../../architecture/09_SECURITY_PRIVACY_E2EE.md)
- [Android architecture](../../architecture/06_ANDROID_ARCHITECTURE.md)
- [iOS architecture](../../architecture/07_IOS_ARCHITECTURE.md)
- [Tamper protection and recovery](../../architecture/21_TAMPER_PROTECTION_RECOVERY.md)
- [API protocol contracts](../../architecture/22_API_PROTOCOL_CONTRACTS.md)
