# 21 — Tamper Protection and Recovery

## 1. Tamper principles

PCA detects and reports supported protection loss; it does not use exploit-like persistence.

## 2. Monitored conditions

- required permission revoked;
- VPN/filtering stopped;
- usage access lost;
- location access lost when configured;
- Family Controls authorization lost;
- DPC/managed authority lost;
- app signature/version mismatch;
- device clock anomaly;
- repeated failed parent-auth attempts;
- rooted/jailbroken/compromised indicators as risk signals.

## 3. Anti-uninstall

### Android
Strong uninstall blocking is restricted to appropriate DevicePolicyManager authority such as device/profile owner or delegated permission. Standard consumer installation does not advertise guaranteed uninstall prevention.

### iOS
Parent/guardian-authorized Family Controls on a child device can prevent the child from deleting the parental-control app according to Apple documentation.

## 4. Parent-authorized removal

The product always supports legitimate parent/guardian removal using strong authentication/recovery. There is no company “secret bypass password.”

## 5. Recovery key

During family creation, generate an offline recovery credential and require confirmation that the parent saved it. Recovery rotates compromised device keys.

## 6. Lost parent phone

1. install PCA Parent on replacement device;
2. authenticate account/license;
3. enter/scan recovery material;
4. optionally require approval by another parent administrator;
5. rotate keys;
6. revoke lost parent device;
7. confirm child devices have new trust state.
