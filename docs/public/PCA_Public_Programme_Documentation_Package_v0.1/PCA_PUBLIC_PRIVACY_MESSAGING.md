# PCA Public Privacy Messaging

**Status:** Critical first substantive privacy-communication draft  
**Implementation:** NOT AUTHORIZED  
**Legal status:** This is a public messaging framework, not a substitute for final legal privacy counsel or runtime verification.

## 1. Core public privacy promise

### Short preferred statement
**Your child's activity belongs to you, not to us.**

### Strong technically bounded statement
**PCA does not build a readable central profile of your child.**

### Supporting statement
PCA is designed so sensitive child activity is processed on trusted family-side devices or shared end-to-end encrypted where synchronization is required. PCA central services retain only the minimum operational and technical information needed to run accounts, enrollment, licensing/entitlement and secure delivery.

## 2. The essential distinction: processing vs central readable collection

PCA may need to process information to perform protection functions. For example, a child device may need to understand app use or a schedule to enforce a rule. That processing does not mean PCA's central servers should receive a readable copy of the child's activity.

Public copy must preserve this distinction:

**Local/family-side processing** = information handled on trusted child/parent devices for protection.  
**Central operational data** = minimum technical records needed to operate the service.  
**Readable central child profile** = prohibited product outcome.

## 3. Locked central privacy invariants

The product documentation is built around these owner rules:

- `READABLE_CHILD_PERSONAL_DATA_CENTRAL = 0`
- `READABLE_FAMILY_ACTIVITY_CENTRAL = 0`
- `CHILD_PHOTOS_CENTRAL = 0`
- `CHILD_VIDEOS_CENTRAL = 0`
- `CHILD_FILES_CENTRAL = 0`
- `CHILD_MESSAGES_CENTRAL = 0`
- `READABLE_APP_USAGE_HISTORY_CENTRAL = 0`
- `READABLE_BROWSING_HISTORY_CENTRAL = 0`
- `READABLE_PRECISE_LOCATION_HISTORY_CENTRAL = 0`

If runtime discovery contradicts an invariant, the implementation must be treated as a privacy defect or unresolved architectural conflict—not as permission to weaken the public doctrine silently.

## 4. Public term: LOCAL PROCESSING

### Definition
Information is handled on the child device or another trusted family-side device to make a protection decision or present information to the authorized parent, without sending a centrally readable copy of that personal activity to PCA.

### Public wording
> Some protection functions work directly on your child's device. This allows PCA to make protection decisions without turning the underlying activity into a readable central history.

### Publication gate
Exact feature-by-feature local processing must be confirmed in PUBLIC-0/14.

## 5. Public term: FAMILY-SIDE DATA

### Definition
Protection information that belongs within the trusted parent/child environment rather than a PCA-readable central database.

### Public wording
> Sensitive protection information is designed to stay within trusted family-side systems.

Avoid broad Arabic phrases equivalent to “all family data” when the concept is specifically child protection activity.

## 6. Public term: E2EE SYNCHRONIZATION

### Definition
Where information must move between trusted parent and child endpoints, PCA's approved architecture requires end-to-end encrypted delivery so intermediary central services do not receive readable personal content.

### Public wording before final crypto proof
> Where sensitive family-side information needs to synchronize between trusted devices, PCA is designed to use end-to-end encrypted delivery.

### Stronger wording after proof
> Sensitive synchronized protection information is end-to-end encrypted between trusted family devices, so PCA's relay services cannot read the content.

**Current publication status:** strong production claim requires runtime/crypto evidence and final security review.

## 7. Public term: MINIMUM CENTRAL TECHNICAL DATA

PCA central services may retain only minimum records necessary for service operation, such as:
- parent account/authentication information;
- opaque child/device identifiers;
- enrollment state;
- licensing/entitlement;
- encrypted relay/delivery records;
- delivery state;
- timestamps;
- minimum operational/security metadata.

Public wording:
> PCA's central services keep the minimum technical information needed to operate accounts, connect devices, manage access and securely deliver the service.

Exact fields and retention require runtime inventory.

## 8. Public term: NO READABLE CENTRAL CHILD PROFILE

Meaning:
PCA central services must not become a place where an operator can open a child's profile and read their browsing history, app-use history, precise-location history, messages, photo library or arbitrary files.

Public wording:
> PCA does not build a readable central profile of your child's sensitive activity.

## 9. What PCA may process locally

Subject to runtime verification, protection functions may require local processing of:
- screen-time information;
- app usage needed to enforce/apply controls;
- schedules;
- protection decisions/status;
- Safe Browser/web filtering decisions;
- location where the parent enables an approved location feature;
- parent/child requests;
- device protection state.

The public page should not imply every listed capability is already production-available on every platform.

## 10. What PCA may synchronize E2EE

Where required for Parent/Child coordination, family-owned protection information may need to move between trusted endpoints. Possible categories include:
- protection settings;
- approved status summaries;
- child requests;
- location/status information where the feature is enabled;
- protection decisions or schedule-related data needed by the parent experience.

Exact synchronized fields must be documented from runtime evidence. The server-side relay must not require plaintext access to sensitive content.

## 11. What PCA stores centrally

The intended central category is minimum service data, not child activity content.

Examples:
- parent account identifier/contact data required for authentication;
- opaque device/child identifiers;
- enrollment and pairing state;
- entitlement/licensing state;
- encrypted payloads/relay material where architecture requires temporary delivery;
- delivery timestamps/status;
- minimum security/operational logs.

The exact production field list must be published internally during PUBLIC-0/14 and reflected in the legal privacy policy.

## 12. What PCA does not collect centrally as readable child content

PCA central systems must not retain readable:
- child/family personal content;
- app usage history;
- browsing history;
- precise location history;
- child messages;
- photo/video libraries;
- arbitrary documents/files;
- screenshots/background recordings;
- microphone recordings;
- passwords/credentials.

## 13. Photos, videos and files

### Public message
> PCA does not need your child's photo library, videos or arbitrary files to provide routine protection. These are not collected into a readable PCA central database.

A future user-selected attachment feature is a separate consented action and must not be confused with background collection.

## 14. Messages

### Public message
> PCA is not designed to capture or centrally read your child's personal messages.

Do not imply message monitoring is a hidden feature.

## 15. App usage

PCA may need local app-usage information to support controls such as screen time, app rules or status. The privacy doctrine requires that readable app-usage history not be stored centrally.

### Public message
> App-use information needed for protection can be processed on the child device. PCA's central service is not intended to hold a readable history of the apps your child used.

Feature availability still requires platform/runtime proof.

## 16. Browsing information

PCA may make local Safe Browser or web-filtering decisions. The central privacy invariant prohibits readable browsing history from being collected centrally.

### Public message
> Web protection can make safety decisions without creating a readable PCA database of your child's browsing history.

Exact Safe Browser architecture must be verified before a stronger production statement is used.

## 17. Location

Location is sensitive and must be feature-gated and parent-controlled.

### Public message before runtime proof
> If an approved location feature is enabled, location information is intended to remain within trusted family-side systems and must not become a readable central location history.

Do not claim continuous tracking, geofencing or background location availability unless verified.

## 18. Camera/proximity

Potential eye-distance/proximity protection may use the camera only if/when the feature is active.

Required architecture:
- frames processed ephemerally on-device;
- no retained camera frame;
- no upload;
- no child photo storage.

### Public copy after runtime proof
> If proximity protection uses the camera, frames are processed temporarily on the device to make the proximity decision. PCA does not keep or upload those frames.

**Current status:** do not publish this as an active feature until verified.

## 19. Parent account data

PCA necessarily requires some parent account information for authentication and service operation, such as email and authentication-related records.

The public site must not hide this fact behind “zero data” messaging.

### Public message
> We keep the account information needed to let you sign in and operate PCA. We separate that service information from readable child activity content.

Exact fields/retention require runtime/legal review.

## 20. Child profile information

Public signup should not request child information. Child setup belongs in the Parent onboarding/private environment.

Any child profile fields used operationally should be minimized and, where sensitive, kept family-side or represented centrally through opaque identifiers.

Before publication, PUBLIC-14 must inventory whether names, nicknames, age bands or other fields ever reach central services and how they are protected.

## 21. Opaque identifiers

PCA may use non-human-readable identifiers to connect account, child and device records operationally without storing a centrally readable child profile.

Public advanced wording:
> PCA can use technical identifiers to operate device enrollment and delivery without requiring central services to store readable child activity.

## 22. Enrollment and technical metadata

Enrollment may require records such as:
- device association state;
- timestamps;
- delivery acknowledgements;
- application/build/platform information where operationally necessary;
- minimum security event metadata.

The runtime inventory must confirm necessity and retention.

## 23. Retention

No blanket retention period should be invented before runtime/legal review.

Public interim wording:
> PCA is designed to keep central operational information only as long as needed for the service, security, legal obligations or approved support purposes. Specific retention periods will be documented in the final Privacy Policy.

**OWNER_APPROVAL_PENDING — OD-13/14.**

## 24. Delete Now / deletion

If the product includes Delete Now or account/child deletion controls, the public site must not promise instant deletion of every technical artifact until behavior is tested across primary stores, relay queues, backups and legally required records.

Safe pre-proof wording:
> PCA is designed to give parents control over their account and protection information. Exact deletion behavior will be documented after runtime verification.

Strong deletion claims remain `NOT_APPROVED_FOR_PUBLIC_CLAIM` until evidence exists.

## 25. Feedback data

Feedback should contain only what the parent intentionally submits plus approved minimal case metadata. No automatic child activity, browsing history, location, messages, screenshots or files.

Recommended retention default is 180 days after closure, subject to owner/legal approval.

## 26. Logs and diagnostics

PCA may require minimum logs for security and service reliability. These logs must not become a secondary readable child activity database.

Before publication, document:
- log fields;
- retention;
- access control;
- redaction;
- crash-reporting provider if any;
- whether payloads can contain sensitive values.

Public claim should remain conservative until this inventory is complete.

## 27. Analytics and cookies

No analytics/cookie claim should be finalized until PUBLIC-0 inspects the actual public and Parent applications.

Recommended privacy posture:
- minimize third-party analytics;
- avoid session replay on authenticated Parent/Child-sensitive surfaces;
- avoid advertising trackers;
- use a `/cookies` page only if actual technologies justify it.

## 28. Subprocessors/providers

The final Privacy Policy should identify material subprocessors/providers where legally required and explain their role.

Do not invent provider lists from architecture assumptions. PUBLIC-14 must obtain them from deployment/runtime evidence.

## 29. Claims not yet safe to publish as strong facts

Until evidence is complete, do not publish strong claims that:
- all synchronized data is production E2EE;
- PCA servers can never decrypt any payload under any path;
- Delete Now is immediate/irreversible across all storage;
- no logs contain any personal information;
- no analytics/cookies are used;
- location is fully local/E2EE in production;
- camera proximity is active and never uploads frames;
- trusted-browser authorization persists safely across restart;
- account security includes specific MFA/anti-phishing controls unless verified;
- production AI is active;
- store apps are published.

## 30. Homepage privacy version

### Heading
**Protection without building a central child profile**

### Copy
PCA is designed to keep sensitive child activity within trusted family-side systems. Protection can happen on the child's device, and information that needs to move between trusted family devices is designed for end-to-end encrypted delivery. PCA central services keep only the minimum technical information needed to operate accounts, enrollment, access and secure delivery.

**Your child's activity belongs to you, not to us.**

CTA: **See how PCA handles privacy**

## 31. Medium FAQ privacy version

**Does PCA collect my child's data?**

PCA needs to process some information to provide protection—for example, a child device may need app-use or schedule information to apply a rule. PCA is designed so sensitive activity stays on trusted family-side devices or is synchronized end-to-end encrypted where required, instead of becoming a readable central PCA profile. Central services still keep the minimum account and technical records needed to operate the service.

## 32. Detailed privacy-page version

### Heading
**Privacy by design, explained clearly**

PCA's goal is not to know more about your child. Its goal is to help your family apply protection while exposing as little sensitive information as possible to central services.

Some protection functions need information on the child's device. Screen-time rules, app controls, schedules or web-safety decisions cannot work without processing relevant information somewhere. PCA's privacy approach is to keep that processing on trusted family-side devices wherever possible and to use end-to-end encrypted delivery where sensitive information must synchronize between trusted family endpoints.

PCA central systems are designed for the minimum technical role: parent account and authentication, opaque device/child identifiers, enrollment, entitlement/licensing, encrypted delivery, delivery state, timestamps and minimum operational/security metadata.

They must not become a readable central database of your child's app-use history, browsing history, precise-location history, messages, photos, videos, documents or arbitrary files.

This is why we do not use the misleading promise “we collect zero data.” An online service needs some account and technical information to operate. The more meaningful promise is that PCA does not build a readable central profile of your child's sensitive activity.

Detailed production field lists, retention periods, deletion behavior, providers and security controls must be verified before final publication of the legal Privacy Policy.

## 33. Arabic conceptual equivalents — first draft

**Short promise:**  
“نشاط طفلك يخصك أنت، وليس PCA.” — `NATIVE_REVIEW_REQUIRED`

**No readable central profile:**  
“صُممت PCA بحيث لا تنشئ ملفًا مركزيًا مقروءًا عن نشاط طفلك.” — `NATIVE_REVIEW_REQUIRED`

**Local processing:**  
“تتم معالجة بعض معلومات الحماية محليًا على جهاز الطفل أو على جهاز موثوق لدى الوالدين، بحسب وظيفة الحماية.” — `NATIVE_REVIEW_REQUIRED`

**E2EE:**  
“عندما يلزم مزامنة معلومات حساسة بين أجهزة موثوقة، تُصمم PCA لاستخدام نقل مشفّر من طرف إلى طرف.” — `NATIVE_REVIEW_REQUIRED`

## 34. Final privacy publication gate

Before final approval:
1. inventory actual central database fields;
2. inventory relay payload visibility;
3. validate encryption boundaries;
4. inspect logs and crash reporting;
5. verify analytics/cookies;
6. verify location paths;
7. verify camera behavior if enabled;
8. verify deletion and retention;
9. list subprocessors/providers;
10. cross-check every privacy/security claim against `PCA_PUBLIC_CLAIM_REGISTER.csv`.

Any mismatch between runtime and this doctrine must be fixed or clearly disclosed before public release.
