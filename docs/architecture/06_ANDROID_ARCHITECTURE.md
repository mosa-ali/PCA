# 06 — Android Architecture

## 1. Native technology

Recommended client: **Kotlin + Jetpack Compose** with a modular policy domain and Android-specific adapters.

## 2. Two capability modes

| Capability | Standard Mode | Protected/Managed Mode |
|---|---|---|
| App usage stats | Yes, with usage-access grant | Yes |
| Screen interactive events | Yes, within UsageStats availability | Yes |
| Local VPN filtering | Yes, user-authorized | Yes; stronger policy persistence may be possible |
| Hard non-bypassable break across apps | Limited | Stronger using supported DPC controls |
| Suspend selected packages | Not ordinary-app authority | Device/profile owner authority |
| Block uninstall | Not guaranteed | Supported via DevicePolicyManager when caller has required authority |
| Lock-task/kiosk-style break | Not general consumer guarantee | Supported for allowlisted packages on managed devices |
| Silent permission capture | No | No; only platform-supported policy authority |

## 3. Usage measurement

Use `UsageStatsManager` / usage events for application activity and screen-interactive state. The design must account for:
- user permission/usage-access state;
- device reboot;
- locked-user state;
- event gaps/vendor behavior;
- clock changes.

Monotonic elapsed time should be used for active-session timing where possible; wall-clock is for reporting only.

## 4. Web filtering

Use Android `VpnService` for a local traffic-control layer when the user/managed policy grants it. Preferred filtering path:

1. local DNS/domain classification;
2. IP/network risk controls where appropriate;
3. PCA Safe Browser for full URL/title visibility;
4. no covert TLS man-in-the-middle certificate.

A VPN service must be a foreground service as required by current Android behavior and clearly disclosed.

## 5. Protected Mode

Android DPC APIs can, with proper device/profile-owner authority, suspend packages, set lock-task allowlists and block uninstall. PCA must not assume that every consumer-installed device can enter this authority state. Provisioning/distribution legality and Google Play compatibility are a pre-implementation gate.

## 6. Break enforcement

- Standard Mode: reliable alerts plus best-supported local restrictions; product UI must not call this “unbreakable” if OS authority is absent.
- Protected Mode: use signed policy to suspend configured entertainment apps and present PCA Break UI while retaining emergency/system functions.

## 7. Anti-tamper

Monitor:
- usage-access state;
- VPN state;
- location permission/state;
- notification permission where needed;
- device-owner/admin state if applicable;
- app signature/version;
- automatic time/time-zone state signals where available;
- root/compromise indicators only as risk signals, not foolproof proof.

## 8. Android Play compliance

Because PCA is a child-monitoring product, distribution must satisfy Google's monitoring-app requirements, including transparent behavior, store disclosure, persistent notification when required and `isMonitoringTool` declaration where applicable.
