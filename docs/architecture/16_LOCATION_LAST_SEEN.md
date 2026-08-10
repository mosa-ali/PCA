# 16 — Location and Last-Seen Architecture

## 1. Scope and authoritative terms

This document designs `PCA-FR-060` through `PCA-FR-065`. Location is an opt-in family-safety feature, not a covert tracking feature and not a promise of continuous real-time tracking. Coordinates are family activity data: encrypted before relay, readable only on authorized family endpoints, and inventoried in doc 10. The relay may see only the bounded routing metadata defined in docs 09–10.

| Term | Precise meaning |
|---|---|
| Location sample | A device-measured latitude/longitude plus measured-at UTC instant, accuracy, source class, and consent/capability state. |
| Current | A sample younger than the family freshness threshold; default 15 minutes. It is a display state, not proof of physical presence. |
| Last known | The most recent usable sample, always labelled with its measured time and accuracy. |
| Last seen | Last authenticated PCA connection/relay receipt time; it is not a location measurement and must never be rendered as one. |
| Offline/stale | No authenticated connection or no fresh sample. The UI shows both facts separately. |

**PCA-FR-060.** Show latest child-device location only when permission, OS state, and connectivity allow.
**PCA-FR-061.** Show the location timestamp and accuracy class, never presenting a stale/coarse fix as fresh/precise.
**PCA-FR-062.** Show last successful PCA connection independently of location permission.
**PCA-FR-063.** Support optional platform-constrained entry/exit geofences; they are alerts, not a continuous-stream promise.
**PCA-FR-064.** Never use location for advertising, analytics profiling, or non-family safety purposes.
**PCA-FR-065.** Support a separate location-history period no longer than general activity retention.

## 2. Collection and local-first flow

1. The child-facing consent/transparency page explains the purpose, collection modes, retention, safe zones, recipient roles, and how to stop sharing.
2. The child device requests the least privilege needed at the moment the feature is enabled. It records only samples necessary for the selected mode; it does not collect for advertising, analytics, or behavioural profiling.
3. A sample is locally encrypted and added to the family activity vault. It is sent as E2EE ciphertext to authorized parent devices; relay delivery is best effort. No server-readable location history exists.
4. Parent UI verifies sender identity, trust-set epoch, ciphertext authentication, and expiry before display. It stores a local encrypted copy only while retention permits.
5. A location display changes to `STALE` at the freshness threshold and `OFFLINE` on lost authenticated presence. It retains the measured time and never extrapolates movement.

Minimum sample fields: opaque device ID, sample ID, measured-at UTC, received-at UTC, coordinate, horizontal accuracy, source (`precise`, `approximate`, `manual-city`, `unknown`), battery/network status when separately authorized/available, trust epoch, and expiry. Coordinates, labels, and geofence names are plaintext only inside the family vault. Location precision must be rendered honestly: approximate permission produces approximate location; missing accuracy produces `accuracy unavailable`.

## 3. Platform authority and limits

| Platform/mode | Architecture baseline | Limit and fallback |
|---|---|---|
| Android Standard | Foreground one-time/current location; background sharing or geofences only after explicit location/background grant and Play-policy review. | Android permits approximate location and limits background updates. Android 11+ requires the user to grant background access in Settings. If absent, show manual refresh/last-known only. |
| Android Protected/DPC | DPC status does not remove location consent, disclosure, battery, or Play-policy obligations. | It is not authority to claim uninterrupted tracking; use the same stale/offline semantics. |
| iOS | Request When In Use for foreground refresh. Request Always only when the owner enables a justified background/safe-zone feature and the OS authorization flow permits it. | System delivery/launch behaviour and authorization can change; denied/reduced access falls back to last-known/manual city. |
| Both | Geofence entry/exit is an OS-delivered signal, not proof of continuous residence. | Geofence delay, power-saving, reboot, disabled Location Services, and OS quotas can delay or suppress events. Never use an absent event as evidence that a child is safe or unsafe. |

Android background access is a separately controlled privilege; the official Android guidance requires a user-facing rationale and notes approximate foreground permission also constrains background precision. iOS requires authorization and usage descriptions, and system delivery is not guaranteed. See source handoff at the end of this document.

## 4. Safe zones and alerts

Safe zones are encrypted policy objects containing a user-supplied label, centre, radius, transition type, schedule, alert recipient roles, and policy revision. Default: off. The parent chooses a conservative radius; PCA does not infer home, school, religion, or routines.

An alert is created only from an OS transition or validated locally available sample. The family event records `ENTER`, `EXIT`, `DWELL`, `UNKNOWN`, or `NOT_MONITORED`; it never manufactures an exit from a stale sample. A notification says, for example, “PCA location update needs attention; open PCA,” and fetches the detailed E2EE event after unlock (doc 19). Geofence changes, alert acknowledgements, and location-policy changes are audit events (doc 18/PCA-FR-124).

## 5. Privacy, retention, and deletion

Location uses doc 11’s authoritative UTC/calendar-month retention and deletion states. Its default is **current/last only** unless the Family Owner deliberately selects history; this is a recommended product default pending owner confirmation. Reducing any period deletes over-age local copies and queued ciphertext according to doc 11; raising it does not recreate past samples. Export is an explicit parent action and produces an encrypted family export; an exported copy is outside app-managed deletion and is disclosed as such.

Removal/revocation stops future authority after trust-epoch convergence; it cannot erase samples already held on an offline or stolen endpoint. Family/child/device removal follows docs 08, 09, and 11. No forensic flash-erasure claim is made.

## 6. Capability state and acceptance checks

The UI exposes `NOT_CONFIGURED`, `PERMISSION_DENIED`, `APPROXIMATE`, `BACKGROUND_NOT_GRANTED`, `LOCATION_SERVICES_OFF`, `BATTERY_RESTRICTED`, `OS_LIMITED`, `STALE`, `OFFLINE`, and `ACTIVE`; no state silently appears healthy. Child transparency uses the same selected language as the child device, independent of the parent language (doc 20).

- Test precise, approximate, foreground-only, denied, revoked, disabled-services, stale, offline, reboot, clock change, and delayed geofence cases on physical devices.
- Assert that parent cards distinguish last seen from measured location and show UTC-derived displayed time/accuracy.
- Assert relay, push, analytics, diagnostics, and email contain no coordinates, labels, or movement detail.
- Assert current/last-only retains one latest point and all retention reductions converge when offline devices reconnect.

## 7. Official-source handoff for doc 33 (verified 2026-08-10)

| Proposed source ID | Official source | Claim/capability label | Affected requirements |
|---|---|---|---|
| SRC-E-LOC-001 | [Android: request background location](https://developer.android.com/develop/sensors-and-location/location/permissions/background) | Background location is separately granted; Android 11+ directs users to Settings; approximate constrains background precision. | PCA-FR-060–065 |
| SRC-E-LOC-002 | [Android: geofencing](https://developer.android.com/develop/sensors-and-location/location/geofencing) | Geofences need location permissions and Android documents per-user limits. | PCA-FR-062 |
| SRC-E-LOC-003 | [Apple: requesting location authorization](https://developer.apple.com/documentation/corelocation/requesting-authorization-to-use-location-services) | Authorization, use descriptions, and differing background delivery behaviour are OS controlled. | PCA-FR-060–065 |
| SRC-E-LOC-004 | [Apple: region monitoring](https://developer.apple.com/documentation/corelocation/monitoring-the-user-s-proximity-to-geographic-regions) | Region monitoring produces system-managed condition transitions. | PCA-FR-062 |
