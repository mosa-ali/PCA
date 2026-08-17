# 06 — Android Architecture

Owning agent: **PCA-DOC-B**. Governed by doc 00 (Document Control).

## 1. Purpose

Define the Android-specific technical architecture of the PCA Child Agent (and the Android-facing parts of PCA Parent), the precise capability boundary between Android Standard Mode and Protected/Managed Mode, and which Android APIs each product claim actually rests on. Every capability claim in this document carries a label per doc 00 Section 8 (`VERIFIED` / `VERIFIED_WITH_LIMITATION` / `UNSUPPORTED` / `REQUIRES_ENTITLEMENT` / `REQUIRES_MANAGED_DEVICE` / `REQUIRES_USER_PERMISSION` / `REQUIRES_FURTHER_OWNER_DECISION`).

## 2. Scope

In scope: native technology choice, `DevicePolicyManager`/Device Owner provisioning, usage measurement, `VpnService`-based filtering, Android Keystore usage, on-device inference runtime placement, anti-tamper signals, and Google Play distribution constraints for a monitoring app. Out of scope: iOS (07), enrollment token protocol (08 — this document only covers the Android-side provisioning mechanics for Protected Mode), cryptographic primitive selection (09), and per-feature behavior detail owned by docs 12–17 (this document describes only the Android platform mechanism each feature rests on).

## 3. Native technology

Recommended client: **Kotlin + Jetpack Compose**, with a modular policy domain layer (platform-agnostic policy/state model) and thin Android-specific adapters for each OS integration point in Section 5–9. Rationale: Kotlin/Compose is the current Android-recommended stack (reduces long-term maintenance risk versus a cross-platform framework attempting to abstract DPC/VPN/UsageStats, which are inherently platform-specific and do not benefit from cross-platform abstraction). Alternative considered: a shared cross-platform business-logic layer (e.g. Kotlin Multiplatform) sharing policy-evaluation logic with iOS — plausible for the policy-domain layer (Section 3's "modular policy domain") but not for the OS-adapter layer, which is why the two are kept architecturally separate here.

## 4. Two capability modes

| Capability | Standard Mode | Protected/Managed Mode |
|---|---|---|
| App usage stats | `VERIFIED_WITH_LIMITATION` (REQUIRES_USER_PERMISSION — Usage Access grant) | `VERIFIED_WITH_LIMITATION` (same API, plus managed-state visibility) |
| Screen interactive events | `VERIFIED_WITH_LIMITATION` (within UsageStats availability, REQUIRES_USER_PERMISSION) | `VERIFIED_WITH_LIMITATION` |
| Local VPN filtering | `VERIFIED_WITH_LIMITATION` (REQUIRES_USER_PERMISSION — one-time VPN consent dialog) | `VERIFIED_WITH_LIMITATION`; a device/profile owner can configure supported always-on VPN and lockdown, but this remains deployment- and device-dependent |
| Hard device-wide break across apps | `UNSUPPORTED` as an absolute claim (best-effort UI only) | `VERIFIED_WITH_LIMITATION` **only for a fully managed device-owner deployment** — stronger via `setPackagesSuspended`/lock task, still not literally unbypassable against an authorized adult or a factory reset |
| Suspend selected packages | `UNSUPPORTED` (no ordinary-app authority for `setPackagesSuspended`) | `VERIFIED_WITH_LIMITATION` (REQUIRES_MANAGED_DEVICE — device/profile owner authority, limited to the owner's managed user/profile) |
| Block uninstall | `UNSUPPORTED` | `VERIFIED_WITH_LIMITATION` (REQUIRES_MANAGED_DEVICE — `setUninstallBlocked` for packages in the managed user's scope; a full-device child-protection claim requires device-owner scope) |
| Lock-task/kiosk-style break | `UNSUPPORTED` (no general consumer-app guarantee) | `VERIFIED_WITH_LIMITATION` (REQUIRES_MANAGED_DEVICE — a device owner can allowlist packages with `setLockTaskPackages`; profile-owner scope is not a substitute for full-device control) |
| Silent permission capture | `UNSUPPORTED` | `UNSUPPORTED` — no mode grants silent/covert permission acquisition; every Protected Mode capability still requires an explicit, disclosed provisioning step performed by an authenticated adult (doc 01 Section 5, doc 08 Section 2) |

**PCA-AND-001** The Child Agent MUST determine its active mode at runtime by querying actual `DevicePolicyManager` owner state (`isDeviceOwnerApp`/`isProfileOwnerApp`), not by a locally-stored flag the app sets for itself, so that a mode claim cannot desynchronize from actual OS authority (e.g. after the user manually removes device-owner status via factory reset or ADB).

## 5. Usage measurement

Use `UsageStatsManager` (`queryEvents`/`queryUsageStats`) for application activity and screen-interactive state (`UsageEvents.Event` types including `MOVE_TO_FOREGROUND`/`MOVE_TO_BACKGROUND`/`SCREEN_INTERACTIVE`/`SCREEN_NON_INTERACTIVE`). Label: `VERIFIED_WITH_LIMITATION` (REQUIRES_USER_PERMISSION — Usage Access special app access, granted via Settings, not a runtime permission dialog).

The design must account for:
- **User permission/usage-access state** — the grant can be revoked at any time from Settings; the Child Agent MUST detect revocation (poll or `AppOpsManager` callback where available) and treat it as a tamper/degraded signal (doc 21), not fail silently.
- **Device reboot** — UsageStats event availability across reboot boundaries is vendor-dependent; the agent MUST NOT assume a gapless event stream and MUST reconcile using its own periodically-persisted last-known-state rather than trusting the OS to backfill.
- **Locked-user / multi-user state** — Android's user-profile model (secondary users, work profile) affects which UsageStats data is visible to which app instance; PCA's supported deployment target is a single-user or one-profile-per-family-member device, and multi-profile edge cases are `REQUIRES_FURTHER_OWNER_DECISION` (PCA-DEC-014 below) rather than silently assumed to work.
- **Event gaps / vendor (OEM) behavior** — some OEM battery-optimization layers throttle background usage-event delivery; the agent's tamper/health model (doc 21) must treat an implausible flat gap as a degraded-signal event, not silently show "0 usage."
- **Clock changes** — wall-clock manipulation is a known bypass vector; see Section 8 (anti-tamper).

Monotonic elapsed time (`SystemClock.elapsedRealtime()`) MUST be used for active-session/break-timer timing; wall-clock (`System.currentTimeMillis()`) is for reporting/timestamping only, never for computing an elapsed duration, so that a child changing the wall clock cannot manipulate a running break timer.

**PCA-AND-002** Usage-event ingestion MUST run as a resilient background component (e.g. a scheduled/foreground-service-backed collector appropriate to the current Android background-execution model for the target API level) rather than only-on-foreground collection, so that usage during periods the Child Agent UI is not open is still captured; the specific background-execution mechanism (`WorkManager` periodic work vs. foreground service) is an implementation detail selected during build against the then-current Android background-execution restrictions (doc 33 citation required before implementation, since these restrictions change across Android versions).

## 6. Web filtering

Use Android `VpnService` for a local traffic-control layer when the user/managed policy grants VPN consent. Label: `VERIFIED_WITH_LIMITATION` (REQUIRES_USER_PERMISSION — the one-time system VPN consent dialog cannot be silently bypassed even in Protected Mode, though Protected Mode can pre-approve it via `DevicePolicyManager` VPN-lockdown APIs where the DPC holds that authority).

Preferred filtering path, in order of preference:
1. Local DNS/domain classification against the on-device category/deny/allow list (doc 14) — no traffic content is inspected, only destination.
2. IP/network-level risk controls where appropriate (e.g. blocking known-bad resolver/IP ranges) — same no-content-inspection property.
3. PCA Safe Browser (an in-house browser component) for full URL/page-title visibility, used only when the family has opted into browser-level reporting — this is the only place PCA reads actual page content, and only inside PCA's own browser surface, never system-wide.
4. **No covert TLS man-in-the-middle certificate is installed at any point.** This is a permanent architectural boundary restated from doc 01 Section 5; Section 6's entire filtering design is built around domain/metadata-level control specifically so a device-wide TLS-intercepting root CA is never required.

A `VpnService`-based implementation MUST run as a foreground service with a persistent, user-visible notification, per current Android platform behavior for foreground services generally and per Google Play's monitoring-app transparency requirement (Section 10) specifically — this is a disclosure requirement, not only a platform mechanical requirement, and the notification MUST NOT be hidden, minimized, or worded to obscure that filtering is active.

**PCA-SEC-002** The local VPN interface MUST NOT route traffic to any third-party endpoint for classification (no traffic egress to a PCA server or a third-party classification API for filtering decisions) — classification is on-device only (doc 14, PCA-PRIV-002), so that the "no covert interception" claim in Section 6 also implies "no covert exfiltration of browsing metadata via the filtering path."

## 7. Protected Mode provisioning

Android DPC (Device Policy Controller) APIs can apply policies only within the authority and user/profile scope Android grants. PCA calls a device **Protected Mode** only when the Child Agent is the **device owner on a fully managed device**; that is the only supported architecture for the device-wide break, kiosk, uninstall, and VPN-lockdown claims in Section 4. A profile owner can apply some policies inside its managed profile, but it MUST be presented as a separate, profile-scoped deployment and MUST NOT be marketed or reported as full child-device protection. PCA MUST NOT assume every consumer-installed device can enter device-owner state — Android's documented dedicated-device setup begins from a factory-reset device and provisioning flow, a materially different, higher-friction setup than Standard Mode's ordinary app install. This is why Protected Mode provisioning is an explicit, separate step in doc 08, not an automatic upgrade from Standard Mode.

Provisioning mechanism candidates (see PCA-DEC-002 in doc 01, restated here for the Android-specific decision):
- QR-code-based device-owner provisioning at factory-reset/first-boot time (`android.app.action.PROVISION_MANAGED_DEVICE` via the documented provisioning QR flow). Label: `REQUIRES_FURTHER_OWNER_DECISION`: technical availability does not establish that PCA's intended consumer distribution, support, and Google Play posture are acceptable; that commercial/policy gate remains open until independently approved and recorded.
- ADB-based `dpm set-device-owner` provisioning — viable for pilot/manual setup, not viable as a mass-market consumer flow (requires a computer and developer-adjacent steps); excluded from the primary product flow, may remain as a documented support/pilot path only.

Provisioning/distribution legality and Google Play policy compatibility (Section 10) are a **pre-implementation gate** for Protected Mode: PCA MUST NOT ship Protected Mode UI/marketing claims until this gate is explicitly cleared and PCA-DEC-002 (doc 01) is resolved.

## 8. Break enforcement

- **Standard Mode**: reliable alerts (full-screen notification/overlay at the platform's actual permission boundary) and an optional, explicitly disclosed best-effort break UI. Product UI MUST NOT call this "unbreakable": the UI/alert capability is `VERIFIED_WITH_LIMITATION`, while device-wide enforcement is `UNSUPPORTED`. Accessibility Services MUST NOT be used to read third-party on-screen content; any future use for app-switch assistance requires a separate Google Play policy review and owner decision before it is designed as a product control.
- **Protected Mode**: use the signed policy (doc 05 Section 6) to suspend configured entertainment-app packages (`setPackagesSuspended`) and present the PCA Break UI via lock-task allowlisting, while explicitly retaining emergency/system functions (dialer, emergency SOS, accessibility services required for the child's own accessibility needs) in the lock-task/suspension allowlist — cross-referenced from PCA-FR-132 (doc 03).

**PCA-AND-003** The break-enforcement suspension/allowlist set MUST always include the platform emergency-dialer package and any OS-designated emergency/SOS surface; a policy envelope that would remove emergency access from the allowlist MUST be rejected client-side regardless of parent signature validity (a local, non-overridable safety floor, distinct from and in addition to the signature/version checks in doc 05 Section 6).

**PCA-AND-003A** The Android enforcement layer MUST also preserve the telephony infrastructure and SMS transport required for incoming-call delivery and the OS-native incoming/in-call surface required to answer/end a call. Resolution MUST use documented platform roles/capabilities supplied by the device, not an OEM-specific hardcoded dialer package name. The resolved communication surfaces are local, non-overridable protected tokens; bedtime, school mode, block periods, daily limits, Break Shield, and parent restrictive scopes cannot intentionally remove them. No Accessibility abuse, hidden system manipulation, or undocumented package-control trick is permitted. This source contract does not by itself prove real-device telephony/SMS behavior.

## 9. Anti-tamper

Monitor (values reported to doc 21's tamper-event model, not decided/owned here):
- Usage Access grant state;
- VPN connection/consent state;
- Location permission/state;
- Notification permission state where needed for alerting;
- Device-owner/profile-owner state (Section 7), including unexpected loss of that state;
- App signature/package-integrity and installed-version state;
- Automatic time/time-zone setting state where available via `Settings.Global.AUTO_TIME`/`AUTO_TIME_ZONE` (detects a plausible clock-rollback attempt per Section 5's monotonic-timer mitigation);
- Root/compromise indicators (e.g. presence of common root-management binaries, unexpected `SafetyNet`/Play Integrity verdict) used only as a **risk signal contributing to a tamper-confidence score**, never as standalone, unappealable proof — false positives are possible (e.g. legitimate custom ROMs), so this signal MUST NOT alone trigger an irreversible action.

## 10. Google Play distribution compliance

Because PCA is a child-monitoring product, distribution MUST satisfy Google Play's monitoring-app requirements: transparent in-app behavior and store-listing disclosure, a persistent notification while active monitoring/filtering runs (Section 6), and the `isMonitoringTool` declaration where Google Play's current policy requires it for this app category (doc 33 citation; policy text changes over time and MUST be revalidated before each store submission per doc 00 Section 2). Distribution of Protected Mode's device-owner provisioning flow is a distinct compliance question from the base app listing and is gated separately (Section 7).

## 11. On-device inference runtime

Where on-device content classification (doc 14) or other ML-assisted features require a local inference runtime, the Android implementation MUST run inference on-device (no image/text payload leaves the device for classification, per PCA-PRIV-002) using a platform-supported runtime (e.g. TensorFlow Lite / Play services ML Kit / Android Neural Networks API-backed runtime — exact runtime selection deferred to doc 23, AI Architecture, which owns model/runtime choice). This document's only claim is the placement constraint (on-device, no network egress for the classification path itself, Section 6's PCA-SEC-002 applies identically here) — model architecture, accuracy targets, and runtime library selection belong to doc 23.

## 12. Failure modes

| Failure | Detection | Behavior |
|---|---|---|
| Usage Access revoked mid-operation | Permission-state poll/callback | Tamper/degraded event (doc 21); parent notified; agent does not fabricate usage data |
| VPN killed by OEM battery optimization or user | VPN connectivity/state check | Filtering degrades to last-known state; parent notified per doc 21; agent attempts reconnect |
| Device-owner status removed (factory reset bypass attempt, ADB) | `DevicePolicyManager` owner-state query (PCA-AND-001) | Mode downgrades to Standard Mode claims only; tamper event raised; Protected-Mode-only enforcement (Section 4 rows) silently stops being claimed, not silently kept as a false claim |
| OEM background-execution throttling drops usage events | Implausible flat-usage gap heuristic | Flagged as degraded signal, not reported as "0 usage" to parent |
| Root/compromise indicator present | Local risk-signal check (Section 9) | Contributes to tamper-confidence score; does not unilaterally lock the device or notify law enforcement; parent is notified per doc 21's threshold |

## 13. Security/privacy implications

- No classification or filtering traffic leaves the device for a third-party service (PCA-SEC-002); this closes the "browsing metadata reaches PCA servers" concern raised generically in doc 09 Section 4 at the Android-specific mechanism level.
- Root/compromise detection is explicitly a soft signal (Section 9) to avoid both false-positive family harm and to avoid this document overclaiming a security property Android does not actually guarantee against a determined, technically capable child.
- Accessibility-Service usage (Section 8, Standard Mode break enforcement) is a sensitive Android permission category; scope MUST be limited to the documented break-enforcement/app-switch-detection purpose only — no reading of other apps' on-screen content — consistent with doc 01 Section 5's prohibition on accessibility-service abuse to read third-party app content.

## 14. Assumptions

- Target Android API level range and minimum supported OS version are set during doc 30's implementation programme, not this document; capability rows in Section 4 assume a currently-supported Android version and will need revalidation if the minimum supported OS changes materially.
- Families attempting Protected Mode provisioning have a device that can be placed into an out-of-box/factory-reset state at setup time (Section 7); a device already in daily use by the family typically cannot be upgraded into device-owner Protected Mode without a reset, which is a real UX cost this document surfaces but does not resolve (see PCA-DEC-002).

## 15. Unresolved owner decisions

| Decision ID | Topic | Options | Recommendation | Status |
|---|---|---|---|---|
| PCA-DEC-014 | Multi-user/work-profile Android devices (Section 5) | (a) Unsupported, detect and show a clear "unsupported device configuration" state; (b) Support single-profile-only enforcement, document the gap; (c) Full multi-profile support | (a) for initial launch — matches the target consumer single-child-device use case and avoids a false-security claim on unsupported configurations | PROPOSED |
| PCA-DEC-015 | Root/compromise-indicator threshold for triggering a parent notification vs. only silently raising the tamper-confidence score (Section 9) | (a) Any single indicator notifies; (b) Notify only above a combined-signal threshold to reduce false-positive alert fatigue | (b) | PROPOSED |

## 16. Dependencies

- Doc 01 Sections 6.1/6.2 for the Standard/Protected Mode product-level definitions this document implements technically.
- Doc 05 Section 6 for the signed-policy-envelope model that Section 8's break enforcement consumes.
- Doc 08 for the Protected Mode provisioning step's place in the overall enrollment flow.
- Doc 09 for cryptographic primitives behind signature verification referenced in Section 8.
- Doc 14 for filtering-category/classification logic that Section 6/11 provide the platform mechanism for.
- Doc 21 for the tamper-event model that Sections 9/12 feed.
- Doc 23 for on-device inference model/runtime selection referenced in Section 11.
- Doc 33 for pending citations (Android Enterprise distribution terms, Google Play monitoring-app policy text, current background-execution restrictions).

## 17. Acceptance criteria

- [ ] Every capability row in Section 4's table carries a label from doc 00 Section 8's approved label set and matches doc 01 Section 10's cross-reference table.
- [ ] No UI string in the Android client claims an `UNSUPPORTED`-labeled capability as working.
- [ ] PCA-AND-001 is implemented and covered by a test (doc 28) that forces device-owner removal and confirms the app correctly downgrades its own capability claims.
- [ ] PCA-SEC-002 is covered by a static/dynamic network-egress check (doc 28) confirming no classification-path network calls exist.
- [ ] PCA-AND-003's emergency-allowlist floor is covered by a test asserting a malicious/malformed policy envelope removing emergency access is rejected.
- [ ] PCA-DEC-002 (doc 01) and PCA-DEC-014/015 (this document) are resolved before doc 30's Protected Mode implementation phase begins.
