# 33 — Official Reference Source Register

**Last verified:** 2026-08-10. Every entry is an official/primary authority. Revalidate a source older than 180 days at the start of the affected implementation phase (PCA-NFR-000).

| ID | Official source / URL | Verified | Claim and capability label | Affected requirements | Architecture consequence |
|---|---|---|---|---|---|
| SRC-A-001 | [Android DevicePolicyManager](https://developer.android.com/reference/android/app/admin/DevicePolicyManager) | 2026-08-10 | Device owner/profile owner policy APIs; managed-only authority | PCA-FR-082, 084, 145 | Protected Mode only; no universal anti-uninstall claim. |
| SRC-A-002 | [Android DPC device management](https://developer.android.com/work/dpc/device-management) | 2026-08-10 | DPC roles and provisioning | PCA-FR-045, 082 | Managed-device gate and Standard fallback. |
| SRC-A-003 | [Lock task mode](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode) | 2026-08-10 | Lock task is managed-device capability | PCA-FR-013, 084 | Not promised for ordinary consumer installation. |
| SRC-A-004 | [VpnService](https://developer.android.com/reference/android/net/VpnService) | 2026-08-10 | Public VPN API; user authorization | PCA-FR-030–037 | Filtering design is transparent and must handle disable/degrade. |
| SRC-A-005 | [UsageStatsManager](https://developer.android.com/reference/android/app/usage/UsageStatsManager) | 2026-08-10 | Usage/event query APIs require user-granted access | PCA-FR-010, 040, 050 | Android visibility is permission-bound; unavailable is explicit. |
| SRC-A-006 | [Android camera background restrictions](https://developer.android.com/media/camera/camera2/camera-preview) | 2026-08-10 | Camera access has lifecycle/background constraints | PCA-FR-020–024, PCA-NFR-030 | No continuous cross-app/background camera promise. |
| SRC-A-007 | [Android background location](https://developer.android.com/develop/sensors-and-location/location/permissions/background) | 2026-08-10 | Separate background permission and approximate limits | PCA-FR-060–065 | Location is opt-in, stale/accuracy-labelled. |
| SRC-A-008 | [Google Play monitoring policy](https://support.google.com/googleplay/android-developer/answer/9888380) | 2026-08-10 | Monitoring apps require disclosure and policy compliance | PCA-FR-120–127 | No covert/spyware positioning or hidden collection. |
| SRC-I-001 | [Family Controls](https://developer.apple.com/documentation/familycontrols) | 2026-08-10 | Family authorization framework | PCA-FR-040–044, 083 | iOS controls are entitlement/authorization constrained. |
| SRC-I-002 | [Family Controls entitlement](https://developer.apple.com/documentation/FamilyControls/requesting-the-family-controls-entitlement) | 2026-08-10 | Distribution needs entitlement approval | PCA-FR-083, PCA-DEC-002 | External dependency; fallback is disclosed capability reduction. |
| SRC-I-003 | [Managed Settings](https://developer.apple.com/documentation/managedsettings) | 2026-08-10 | Shielding/restriction framework | PCA-FR-013, 041–044 | No claim beyond Apple-exposed controls. |
| SRC-I-004 | [Device Activity](https://developer.apple.com/documentation/deviceactivity) | 2026-08-10 | Opaque activity tokens/monitoring | PCA-FR-010, 040, 050 | UI labels opaque/unavailable mappings honestly. |
| SRC-I-005 | [Apple Screen Distance](https://support.apple.com/105007) | 2026-08-10 | User feature on supported TrueDepth devices, not PCA control API | PCA-FR-020–024 | May be recommended; never represented as PCA-controllable API. |
| SRC-I-006 | [Core Location authorization](https://developer.apple.com/documentation/corelocation/requesting-authorization-to-use-location-services) | 2026-08-10 | OS-governed authorization/delivery | PCA-FR-060–065 | Location is permission/state constrained. |
| SRC-Y-001 | [YouTube Data API](https://developers.google.com/youtube/v3/docs) | 2026-08-10 | Public API surface and quotas | PCA-FR-051–054 | No account watch-history monitoring commitment. |
| SRC-Y-002 | [YouTube sample requests](https://developers.google.com/youtube/v3/sample_requests) | 2026-08-10 | `watchHistory` sample does not establish a family monitoring feed | PCA-FR-051 | Mode A explicitly does not query/retain exact video history. |
| SRC-Y-003 | [YouTube API Services policies](https://developers.google.com/youtube/terms/api-services-terms-of-service) | 2026-08-10 | Controlled integration must comply with API terms | PCA-FR-052, 053 | Mode B is optional and pre-implementation gated. |
| SRC-C-001 | [NIST SP 800-56A Rev. 3](https://csrc.nist.gov/pubs/sp/800/56/a/r3/final) | 2026-08-10 | Key-agreement guidance | PCA-NFR-002–005 | Separate key-agreement/encryption role from signing. |
| SRC-C-002 | [NIST FIPS 186-5](https://csrc.nist.gov/pubs/fips/186-5/final) | 2026-08-10 | Digital signature standard | PCA-NFR-004, PCA-FR-138–143 | Signed policy/trust-set messages and verification. |
| SRC-C-003 | [RFC 5116 AEAD](https://www.rfc-editor.org/rfc/rfc5116) | 2026-08-10 | Authenticated encryption interface | PCA-NFR-001, 002, 011 | E2EE payloads use authenticated encryption; relay handles ciphertext only. |
| SRC-C-004 | [OWASP MASVS](https://mas.owasp.org/MASVS/) | 2026-08-10 | Mobile security verification baseline | PCA-NFR-003–009, 012–015 | Security validation and secure-storage gates. |
| SRC-W-001 | [Unicode UAX #9](https://www.unicode.org/reports/tr9/) | 2026-08-10 | Bidirectional text algorithm | PCA-FR-110–114, PCA-NFR-040–045 | RTL, mixed-direction, numbers and accessibility test matrix. |
| SRC-R-001 | [NIST RBAC model](https://csrc.nist.gov/pubs/ir/6192/final) | 2026-08-10 | Role-based access-control model | PCA-FR-004, 090–096 | Endpoint-enforced least privilege, not UI-only authorization. |

The source IDs embedded in feature documents are handoffs into this canonical register. If a feature-level citation differs, this register must be reconciled before its phase begins; no unsupported platform capability is created by a citation.
