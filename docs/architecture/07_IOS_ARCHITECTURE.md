# 07 — iOS Architecture

## 1. Native technology

Recommended client: **Swift + SwiftUI** with required Screen Time API extensions.

## 2. Core frameworks

- **Family Controls** — authorization and family activity selection.
- **Managed Settings** — privacy-preserving restrictions/shields.
- **Device Activity** — schedules and threshold callbacks.
- **Managed Settings UI** — customized shield presentation where supported.

Distribution requires the Family Controls entitlement for the app and relevant extensions.

## 3. Privacy boundary

Apple's model intentionally uses opaque tokens and privacy-preserving controls. PCA must not assume unrestricted access to another app's URLs, private content or arbitrary activity history.

## 4. Anti-removal

For a child account authorized by a parent/guardian, Apple documents that Family Controls can prevent the child from deleting the parental-control app. This must be implemented only through Apple-supported authorization; no jailbreak or unsupported device manipulation.

## 5. Screen-time enforcement

Device Activity schedules and thresholds trigger extensions; Managed Settings applies app/category/domain shields selected through Family Controls. The product must remain within Apple's public API and entitlement boundaries.

## 6. App and web visibility

- Selected apps/categories/domains are represented through privacy-preserving tokens where applicable.
- Detailed cross-device reporting must be designed only around data Apple explicitly exposes.
- PCA Safe Browser may maintain its own local history for activity that occurs inside the PCA browser.
- PCA must not promise a general Safari/other-app full URL history unless public APIs expressly support it for the deployment.

## 7. Eye-distance behavior

Apple provides a system Screen Distance feature on supported TrueDepth devices. PCA may explain/recommend enabling the system feature but cannot claim control over a private API.

Within PCA's own foreground experience, public proximity/TrueDepth APIs may be used when justified and permissioned. Cross-app continuous camera monitoring is not part of the architecture.

## 8. Emergency behavior

Managed shields must not intentionally block emergency/SOS or required system functionality.

## 9. Entitlement fallback

If Apple distribution entitlement approval is unavailable:
- no fake/unsupported parental-control implementation;
- iOS release is limited to features supported without that entitlement;
- Android release may proceed only if separately accepted;
- marketing must reflect the reduced iOS capability.
