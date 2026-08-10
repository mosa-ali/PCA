# 25 — Compliance, Store Policy and Release Evidence

## 1. Scope and control state

This document turns product capabilities into submission constraints. It is architecture, not a claim that PCA has been approved by any store, regulator, entitlement programme, or local authority. Compliance is assessed per release, country, audience, store listing, and enabled capability. Legal review remains required before launch.

PCA is a transparent parent-to-child protection product. It must never be positioned, configured, or supported as covert surveillance of a spouse, peer, employee, or any other non-child. Capability gates in documents 06, 07, 16, 19 and 21 take precedence over marketing promises.

## 2. Google Play monitoring-tool control

An Android release that monitors a child device is treated as a monitoring application. For every version code on every Play track, the release build must declare the Play `isMonitoringTool` metadata with the parental-control value `child_monitoring`. The declaration, Play listing, onboarding, in-app disclosure, and actual behavior must agree.

Release evidence must demonstrate all of the following:

- PCA is exclusively designed and marketed for parents/guardians to protect children in their care; it offers no adult-partner or covert-monitoring use case.
- The child device has a persistent, clearly identifiable notification while the monitoring function runs, and PCA has a unique, recognizable icon.
- Tracking is never hidden, cloaked, impersonated as a system component, or activated through an off-store/non-compliant build.
- The store listing plainly identifies the monitored categories, platform limits, child transparency screen, emergency safety floor, and support contact.
- Prominent disclosure and any required consent occur before collection/use of sensitive data; permission prompts alone are not treated as sufficient disclosure.
- The policy declaration and every permission/SDK/data-safety answer are checked again for each release candidate.

This is a release gate, not a substitute for Android permission or Device Owner policy. Protected/DPC mode is optional, visibly identified, and never used to conceal monitoring.

## 3. Child-directed and privacy controls

For audiences including children, release review must accurately complete target-audience, content-rating, Data Safety, privacy-policy, and access-instructions declarations. Child data practices include data obtained by SDKs. PCA does not use behavioral advertising, remarketing, sale of child data, or advertising identifiers for child/unknown-age users. If monetization is ever proposed, it needs a separate legal/store-policy review and cannot weaken this rule.

Permission minimization is mandatory. Each requested permission requires a documented feature purpose, platform fallback, disclosure text, withdrawal effect, and deletion/data-flow reference. Precise location, camera-derived information, installed-app inventory, notifications, VPN, accessibility-related facilities, and background operation receive a dedicated policy review. `QUERY_ALL_PACKAGES` is not assumed permissible: a narrower query is preferred and any broad visibility request requires an evidence-backed core-function justification.

PCA's privacy materials must distinguish local/E2EE family data from service-readable infrastructure metadata. “Encrypted” and “zero plaintext activity” do not mean that IP addresses, push tokens, delivery timestamps, subscription/license records, or service audit events are invisible to their providers. The canonical inventory in document 10 is the authoritative disclosure input.

## 4. Apple distribution controls

Apple capability statements remain conditional. Family Controls, Managed Settings and Device Activity behavior is subject to Apple entitlement approval, family/guardian authorization, OS support, and Apple’s privacy/token model. PCA must not claim it can stop app removal, reveal app/video history, read message content, or continuously operate a camera merely because a comparable Android capability exists.

The App Store submission pack includes entitlement request/approval evidence, purpose strings, privacy nutrition-label answers, child transparency screenshots, review account/instructions where appropriate, and tested fallback behavior when authorization or entitlement is unavailable. An Apple denial or later revocation disables only the affected capability and communicates the limitation accurately; it does not trigger a hidden alternative collection path.

## 5. Child transparency, consent and safety

Before protected features activate, the child-facing experience explains in age-appropriate language what is active, what categories a parent may see, what cannot be seen, how to find privacy information, and how to get help. The parent sees the same capability-specific disclosure plus legal/household responsibility prompts. Re-consent/re-disclosure is required when a later release materially broadens a data category or purpose.

Emergency calling and the safety floor in document 12 are not removed by policy, billing state, break experience, store experiment, or rollback. Child-facing notices must not shame, trick, or make a parent policy appear to be an OS failure.

## 6. Deletion, support and geographic launch

Where PCA has an account, account deletion is independently discoverable and does not require an active subscription. Family activity deletion and device/family removal follow document 11’s state model; export copies and physical-backup limitations are disclosed rather than silently represented as erased. Support staff never receive a recovery secret, FDEK, or family activity plaintext.

Country launch requires documented legal/privacy review for child age/parental authority, geolocation, monitoring, consumer, export-control, and breach-notification obligations. Store acceptance does not equal legal approval. A country/capability may be disabled until this review completes.

## 7. Submission evidence pack and sign-off

The release manager keeps a versioned evidence pack containing:

- store listing, target-audience/content rating, Data Safety/App Privacy, monitoring-tool declaration, and track/version-code checks;
- permission and SDK inventory with purposes and prominent-disclosure screenshots;
- child/parent transparency, emergency, deletion, and capability-degraded-state recordings in English and Arabic;
- policy/privacy notices mapped to document 10 data classes and document 11 deletion semantics;
- Family Controls entitlement evidence or the tested no-entitlement fallback;
- background location/camera/VPN/package-visibility declarations where requested by the store;
- accessibility sign-off, security/privacy test results, incident/support contacts, and jurisdiction review record.

The release is blocked when an enabled capability lacks evidence, a declaration conflicts with actual behavior, disclosure is missing, or any safety/privacy test in document 28 fails.

## 8. Verification handoff

Document 33 records official-source URLs, verification date, affected requirements, and any policy change. At the time of this reconciliation, the mandatory Google verification points are the Play `isMonitoringTool` guidance, Monitoring Applications/Stalkerware policy, Families requirements, sensitive-permission policy, and target-audience guidance. Policy text changes frequently; the evidence pack must revalidate them immediately before submission.
