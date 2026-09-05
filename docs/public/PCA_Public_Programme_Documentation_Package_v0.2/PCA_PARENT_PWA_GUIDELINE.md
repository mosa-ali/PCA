# PCA Parent PWA Guideline

**Status:** v0.2 substantive PWA architecture — owner decisions OD-08/09 incorporated  
**Owner direction:** PCA_PARENT_PWA = YES  
**Implementation:** NOT AUTHORIZED

## 1. Purpose

The PCA Parent PWA makes the existing Parent Web experience installable where supported, giving parents convenient app-like access without creating an unnecessary second Parent codebase.

The PWA is a delivery/access form of PCA Parent, not a new authority model and not a replacement for browser/device trust controls.

## 2. Relationship to Parent Web

The existing responsive Parent Web remains the source product experience. PWA work should add installability, manifest/service-worker behavior and platform-aware install guidance around that experience.

### No duplicate codebase principle
Do not create a separate “PWA app” that duplicates Parent pages, business logic or translations unless PUBLIC-0 proves the current architecture cannot support a safe shared implementation and the owner explicitly approves an exception.

## 3. Security distinction — non-negotiable

**PWA INSTALLATION != TRUSTED BROWSER AUTHORIZATION**

PWA installation means:
- convenient launcher/home-screen access;
- app-like window/display where supported;
- reuse of the Parent Web product.

Trusted Browser means:
- security/decryption authorization defined by PCA's trust architecture.

Installing PCA Parent must never automatically grant Trusted Browser privileges, persist decryption authority, weaken session rules or imply that the device is safe simply because an icon was installed.

Prohibited copy:
- “Install this device as trusted.”
- “Installing PCA Parent secures this browser.”
- “Install to remember your encryption key.”

## 4. Owner-approved first eligible visit experience

### Heading
**Welcome to PCA Parent**

### Message
**For the best experience, install PCA Parent on this device.**

### Benefits
- Quick access
- App-like experience
- Designed for phone, tablet and computer

### Actions
- **Install PCA Parent**
- **Continue in Browser**

Installation is never mandatory. Continue in Browser is always available.

## 5. Eligibility logic

The install promotion should be shown only when useful. The implementation must evaluate at least:
- whether the app is already running in standalone/installed display mode;
- whether the browser exposes a native install opportunity;
- whether the platform requires manual Add to Home Screen guidance;
- whether the user recently dismissed the promotion;
- whether installation is unsupported or indeterminate.

No unsupported environment should receive a fake install button.

## 6. Chromium/Android behavior

Where a compatible browser exposes a native install prompt, PCA should:
1. avoid firing the native prompt automatically on page load;
2. present the PCA install UX first;
3. invoke the platform prompt after the user's explicit Install action;
4. handle acceptance/dismissal gracefully;
5. continue normal Parent Web use if installation is unavailable or rejected.

Exact browser support must be verified during PUBLIC-11/13 rather than assumed from user-agent strings alone.

## 7. iPhone/iPad behavior

Where direct programmatic prompting is unavailable, PCA should provide concise platform-specific Add to Home Screen guidance.

The guidance must:
- be shown only on relevant devices/browsers;
- avoid claiming a native install prompt exists when it does not;
- use text and simple icons/illustrations rather than fake screenshots if browser UI varies;
- state that Parent can still be used normally in the browser.

Final instructions require real-device/browser verification because platform UI changes over time.

## 8. Desktop behavior

On supported desktop browsers, offer install through the native browser capability after an explicit user gesture. If unsupported, do not nag; keep the browser experience fully functional.

## 9. Unsupported-browser behavior

Fallback message:

> PCA Parent works in your browser. Installation is not available in this browser right now.

Do not imply that the user's device is insecure or incompatible with PCA Parent solely because PWA installation is unavailable.

## 10. Manifest requirements

PUBLIC-11 should define and verify at minimum:
- application name: **PCA Parent** (recommended default);
- short name suitable for launcher labels;
- start URL that preserves safe auth routing;
- standalone display mode where appropriate;
- theme/background values consistent with the light design system;
- supported icon sizes, including maskable icon where appropriate;
- language-neutral product identity;
- scope limited to the Parent application realm.

**OWNER_APPROVAL_PENDING:** final icon, theme color and splash treatment follow the approved brand system.

## 11. Icons and splash

Use PCA-owned artwork only. Icons must remain recognizable at small sizes and should not contain tiny text.

Splash/loading experience should be calm and minimal. It must not display child names, locations, recent activity or other sensitive information before authentication/trust state is established.

## 12. Display mode

Recommended default is standalone where supported. The application must still behave correctly when opened as a normal browser tab.

No security decision may depend solely on display mode.

## 13. Service-worker principles

The service worker should exist only to support safe PWA behavior. It must not become a hidden data store for sensitive Parent/Child information.

Principles:
- cache static assets deliberately;
- prefer network for authenticated/sensitive API requests;
- never indiscriminately cache all responses;
- do not persist decrypted child/family payloads in service-worker caches;
- do not cache auth tokens, encryption keys, readable location history, browsing history, app-usage history or child requests as generic offline data;
- version caches and remove obsolete assets safely;
- document every runtime caching rule.

## 14. Sensitive-data caching restrictions

**OWNER_APPROVED — OD-09:** V1 offline scope is limited to safe static application shell assets and non-sensitive public/help content. Authenticated Parent/child information must not be intentionally cached for offline availability unless a separate later security/privacy design is approved.

The PWA must not claim “works offline” as a broad feature.

## 15. Offline behavior

Recommended V1 states:

### Public/static asset unavailable
Show a minimal offline fallback where safe.

### Authenticated Parent data unavailable
Show:
> You're offline. PCA Parent needs a connection to load current protection information.

Do not display stale sensitive content from an uncontrolled cache merely to make the PWA look functional offline.

## 16. Update behavior

When a new version is ready:
- avoid silently reloading while a parent is typing or completing a critical action;
- present a non-alarming update notice when a reload is required;
- allow the user to apply the update at a safe moment;
- force immediate reload only for explicitly security-critical cases defined by policy.

Suggested copy:
> A new version of PCA Parent is ready. Update when convenient to get the latest improvements.

## 17. Install state detection

Implementation should distinguish:
- browser tab;
- installed standalone PWA;
- native prompt available;
- manual-install guidance environment;
- unsupported/unknown.

State detection is convenience logic only. It is not proof of Trusted Browser status.

## 18. Dismissal behavior

A dismissed modal/prompt should not reappear every visit.

**OWNER_APPROVED — OD-08:** record a local, non-sensitive dismissal timestamp and do not show the prominent first-visit install prompt again for 30 days. Keep a passive **Install PCA Parent** action available in Parent navigation/settings. If installation becomes available after previously being unsupported, the passive action may update, but the product should remain non-aggressive.

Do not send dismissal state to central analytics unless separately approved.

## 19. Re-prompt policy

Prominent re-prompt may occur only when:
- the 30-day recommended interval has elapsed; and
- the user has not installed; and
- installation is genuinely supported; and
- no active task would be interrupted.

A future owner decision may choose “never re-show automatically.” The architecture should make this policy configurable without changing trust logic.

## 20. Authentication and session behavior

PWA launch follows the same Parent authentication/session policies as Parent Web. Installation must not:
- bypass login;
- extend session lifetime by itself;
- store passwords;
- persist secret material in insecure caches;
- create new Parent/Admin authority bridges.

## 21. Privacy

PWA telemetry should be minimal. Do not introduce new analytics solely to measure install conversion without privacy approval.

Install status, dismissal and platform capability should remain local where practical unless there is a justified operational need to send them centrally.

## 22. Staged-release relationship

PCA Parent PWA belongs to **PUBLIC RELEASE C**, not Release A or Release B. The public informational site may explain that PCA Parent is planned to be installable, but it must not present installation as active until Parent readiness, manifest/service-worker behavior, supported-browser install flow, cache restrictions and security/session checks pass.

A Release A public site being ready does not require this PWA to be ready.

## 23. Accessibility

Install UX must support:
- keyboard activation;
- screen-reader labels;
- visible focus;
- clear close/dismiss controls;
- readable iOS/manual instructions;
- RTL presentation;
- no motion dependence.

## 24. Arabic/RTL

Arabic install copy must be natural and mirrored appropriately. Platform terms such as “Add to Home Screen” may need product-specific Arabic wording and device validation.

Arabic draft status remains `NATIVE_REVIEW_REQUIRED` until owner-designated linguistic review.

## 25. Testing matrix

PUBLIC-11/13 should cover, where available:
- Android + Chromium-family browser;
- desktop Chromium-family browser;
- iPhone/iPad manual install flow;
- unsupported browser fallback;
- installed standalone mode;
- dismissed prompt state;
- re-prompt interval;
- update-ready behavior;
- offline fallback;
- login/logout after install;
- EN and AR/RTL.

Evidence must include functional checks, not screenshots alone.

## 26. Acceptance criteria

PWA is accepted only when:
1. Parent Web remains fully usable without installation.
2. Eligible install flows work using real browser capability.
3. Unsupported flows do not fabricate installation.
4. Installed mode is detected correctly.
5. Sensitive authenticated data is not indiscriminately cached.
6. Install state never changes Trusted Browser authorization.
7. EN/AR parity passes.
8. Accessibility checks pass.
9. No major console/service-worker errors remain.
10. Claim register is updated with verified platform status.
