# PCA Public Product Guideline

**Document status:** v0.2 revised authoritative planning input — primary review decisions incorporated; not production approval  
**Programme status:** PUBLIC PRODUCT DOCUMENTATION DEVELOPMENT  
**Implementation status:** NOT AUTHORIZED  
**Applies to:** PCA Public, PCA Parent, PCA Child, PCA Platform Admin, public/auth entry experiences, Parent PWA, public support/feedback and all EN/AR public messaging.

## 1. Purpose of this guideline

This document is the master public-product doctrine for PCA. It defines what PCA is, why it exists, how it should be presented, the boundaries that must not be crossed, and the language future designers, writers and implementation agents must use when they describe the product.

When another document or implementation choice conflicts with this guideline, the conflict must be raised for owner review rather than silently resolved in code or copy.

## 2. Purpose of PCA

PCA exists to help parents protect children in digital spaces in a practical, understandable and privacy-minimizing way. The platform should help families establish appropriate digital boundaries and protection without turning a child's life into a centrally readable surveillance record.

PCA recognizes a simple reality: families, schools and communities invest effort in protecting children in physical spaces. Digital spaces deserve the same seriousness, but the protection method must still respect the child's dignity and the family's control of sensitive information.

## 3. Origin story

PCA began from a father's concern about protecting his own children online. The origin story must remain simple and sincere. PCA should not be described as a company that discovered a commercial opportunity in children's data, nor should the founder story be exaggerated into claims that cannot be verified.

Recommended public concept:

> PCA began with a parent's concern: if we work hard to protect children at home, at school and in public spaces, why should their digital spaces be treated differently?

**OWNER_APPROVED — OD-04:** V1 uses the parent-origin story without the founder's name, photograph or detailed biography. This keeps attention on PCA's purpose rather than personal branding.

## 4. Product mission

**Mission:** Help families create safer digital spaces for children through practical protection, clear parental control, privacy-minimizing architecture and honest product communication.

The mission has four operational verbs:

1. **Protect** — provide useful digital safeguards and family controls.
2. **Respect** — preserve child dignity and minimize exposure of personal information.
3. **Explain** — make product behavior understandable to non-technical parents.
4. **Include** — design access and pricing so meaningful protection can reach ordinary and lower-income families.

## 5. Vision

**Vision:** Contribute to a digital world in which children can benefit from technology while families have practical tools to support safety, healthy boundaries and responsible use without surrendering children's sensitive activity to a readable central database.

## 6. Values

### 6.1 Child protection
Protection is the primary product purpose. Product decisions should be evaluated by whether they improve meaningful child safety rather than whether they create more monitoring data.

### 6.2 Privacy by design
PCA must remain privacy-minimizing. Central systems must not become a readable child or family activity database.

### 6.3 Child dignity
Children are people, not datasets. The product should avoid humiliating, coercive or unnecessarily intrusive experiences.

### 6.4 Family control
Sensitive protection information should remain under trusted family control wherever technically possible.

### 6.5 Transparency
PCA must explain what it does, what it does not do, what is available now and what is planned later.

### 6.6 Accessibility
The public experience must be usable across devices, accessible to users with disabilities, and fully available in English and Arabic from first public release.

### 6.7 Affordability
Meaningful digital child protection should not be positioned as a luxury product available only to high-income families.

### 6.8 Security
Security controls must support privacy and child protection. Convenience must not silently weaken authentication, encryption, authorization or separation between product realms.

## 7. Target audiences

### Primary audience — parents and guardians
People trying to understand, adopt and use PCA to support a child's digital safety.

### Secondary audiences
- privacy-conscious parents assessing how PCA handles information;
- existing PCA Parent users returning to login, install or obtain help;
- external child-protection, education or technology stakeholders reviewing PCA's approach;
- accessibility users who require keyboard, screen-reader, contrast or reduced-motion support;
- Arabic-speaking users who require a first-class RTL experience rather than a secondary translation.

**OWNER_APPROVED — OD-15:** V1 remains parent-first. Institutional, school, NGO and partner inquiries may use Contact initially; they do not receive a separate primary journey in V1.

## 8. Product surfaces

### 8.1 PCA Public
**Purpose:** public information, trust-building, feature explanation, privacy/security explanation, FAQ, support, account entry and install/download guidance.  
**Intended future primary domain:** `pcasafe.com`.

### 8.2 PCA Parent
**Purpose:** parent administration and protection-management experience.  
**Current direction:** responsive Parent Web, with owner-approved evolution into an installable PWA using the same codebase where practical.  
**Intended future domain:** `app.pcasafe.com`.

### 8.3 PCA Child
**Purpose:** child-device protection and enforcement application.  
**First PCA Child release direction:** Android is the planned primary platform. **Availability status: COMING_LATER** until Android runtime/emulator acceptance, owner physical-device UAT and the approved distribution/release gate pass.  
**iOS child application:** later/gated; it must not be advertised as available until its technical, entitlement, security and store-readiness gates are complete.

### 8.4 PCA Platform Admin
**Purpose:** internal PCA operator/administration console.  
**Intended future domain:** `admin.pcasafe.com`.

PCA Platform Admin is not a parent shortcut. Parent and Platform Admin must remain separate security, session and RBAC realms. No public redesign may blur this boundary.

## 9. Brand positioning

PCA should be positioned as **digital child protection for families**, not as a surveillance product, enterprise cybersecurity suite or behavioral analytics company.

**OWNER_APPROVED — OD-02:** Lead public positioning with **“digital child protection”**. Use **“digital child protection and parental-control platform”** only where descriptive/category context helps. The more technical “parental control” label must not define the whole brand.

### Desired brand qualities
Human, calm, family-friendly, trustworthy, modern, accessible, privacy-first, child-protection focused and affordable.

### Brand qualities to avoid
Fear-driven, punitive, covert, alarmist, militarized, enterprise-only, data-extractive, cyberpunk or “spy on your child” language.

## 10. Child-protection philosophy

PCA protects without assuming that maximum observation equals maximum safety. Appropriate protection may include screen-time rules, app/web controls, schedules, protection status, child requests and alerts, but each capability must be designed around necessity, proportionality, transparency and parent responsibility.

The public site must not depict children as helpless victims. It should show balanced technology use, positive parent-child interaction and responsible digital habits.

## 11. Privacy philosophy — non-negotiable owner rule

PCA is local-first and privacy-minimizing.

### Locked invariants
- `READABLE_CHILD_PERSONAL_CONTENT_CENTRAL = 0`
- `READABLE_FAMILY_ACTIVITY_CONTENT_CENTRAL = 0`
- `CHILD_PHOTOS_CENTRAL = 0`
- `CHILD_VIDEOS_CENTRAL = 0`
- `CHILD_FILES_CENTRAL = 0`
- `CHILD_MESSAGES_CENTRAL = 0`
- `READABLE_APP_USAGE_HISTORY_CENTRAL = 0`
- `READABLE_BROWSING_HISTORY_CENTRAL = 0`
- `READABLE_PRECISE_LOCATION_HISTORY_CENTRAL = 0`

PCA may process protection information locally on the child device or trusted parent device. Family-owned protection information may be synchronized between authorized trusted endpoints using end-to-end encrypted delivery where required. **PCA central relay services must not receive readable family-side protection payload content.** PCA central services may retain only minimum operational and technical records necessary for account/authentication, opaque identifiers, enrollment, entitlement/licensing, encrypted relay or delivery, delivery state, timestamps and minimum operational/security metadata. Parent account/technical service data is not the same thing as readable child/family activity content.

PCA does **not** collect or synchronize readable photo galleries, videos, documents, arbitrary phone files, personal messages, passwords, credentials, microphone recordings, screenshots or background screen recordings.

Public wording must distinguish **processing** from **central readable collection**. PCA can process information for protection functions without central servers being able to read that personal content.

## 12. Affordability and access philosophy

Preferred public principle:

> A safer digital world should not depend on income.

Until the commercial model is approved, use:

> Designed with affordability and broad access in mind.

**OWNER_APPROVED — OD-03:** Use **Access**, not **Pricing**, until the commercial model is approved. The site may discuss affordability and broad access without implying finalized commercial tiers.

No copy may promise a free plan, fixed price, discount or subsidy until approved.

## 13. Product terminology

### Preferred product names
- **PCA Public** — public website and information surface.
- **PCA Parent** — parent administration experience.
- **PCA Parent PWA** — installable form of PCA Parent; not a separate product codebase unless architecture review proves otherwise.
- **PCA Child** — child-device protection application.
- **PCA Platform Admin** — internal operator/admin console.
- **Trusted Browser** — security/decryption authorization concept; never synonymous with PWA installation.

### Preferred conceptual terms
- digital spaces;
- child protection;
- safer digital habits;
- local processing;
- family-side data;
- end-to-end encrypted synchronization where required;
- minimum central technical data;
- no readable central child profile;
- parent control;
- child dignity;
- privacy by design.

## 14. Words and claims to prefer

Preferred short privacy claim:

> Your child's activity belongs to you, not to us.

Preferred strong technical/public claim:

> PCA does not build a readable central profile of your child.

Also acceptable:

> Your child's sensitive activity remains under your control rather than becoming a readable PCA database.

Preferred availability language:
- Available
- Limited
- Coming later
- Requires platform support
- Under verification

Preferred affordability language:
- Designed with affordability and broad access in mind.
- We believe meaningful child protection should be accessible to more families.

## 15. Words and claims to avoid

Do not publish:
- “PCA collects zero data.”
- “We never process child data.”
- “100% private” or “unhackable.”
- “Military-grade security.”
- “Complete anonymity.”
- “Install PCA Parent to trust this device.”
- “Available on iPhone” for PCA Child before verified release.
- “Download from Google Play/App Store” before verified store publication.
- “AI protection” as a production feature before verified production activation.
- claims implying PCA reads messages, records screens, scans galleries or captures passwords.
- fear-based copy such as “Your child is never safe online without PCA.”

## 16. Feature-honesty rule

A UI component, route, feature flag or prototype is not proof that a public feature is available. Every material public claim must be registered in `PCA_PUBLIC_CLAIM_REGISTER.csv` and linked to appropriate technical evidence before publication.

No page, metadata tag, illustration caption or CTA may imply a later/gated feature is active.

## 17. Available vs Limited vs Coming Later

### VERIFIED_AVAILABLE
Use only when implementation and runtime evidence support the claim.

### LIMITED
Use when the feature exists but has meaningful platform, scope, security or behavioral limitations that the public user should understand.

### COMING_LATER
Use for approved product direction that is not yet release-ready.

### REQUIRES_PLATFORM_SUPPORT
Use where capability depends on operating system, browser, entitlement, store, provider or external platform behavior.

### EXTERNAL_SECURITY_REVIEW
Use when the architecture exists but a production security/crypto claim requires independent or final security verification.

### NOT_APPROVED_FOR_PUBLIC_CLAIM
Use when wording would be misleading, unsupported or legally/commercially unresolved.

## 18. Public trust principles

1. State limitations before users discover them themselves.
2. Never use fear to manufacture urgency.
3. Do not hide post-V1 status behind vague wording.
4. Separate technical facts from values statements.
5. Make privacy explanations understandable without pretending the system processes nothing.
6. Do not use store logos, certification badges or security seals without evidence/permission.
7. Make support and privacy-contact paths visible.
8. Ensure auth pages look like PCA, but keep marketing secondary to the task.

## 19. Public accessibility principles

The public experience must support keyboard navigation, visible focus states, semantic headings, screen readers, adequate contrast, reduced-motion preferences, suitable touch targets, responsive layout and full LTR/RTL behavior.

Required viewport validation includes 320px, 375px, 390px, tablet, desktop and wide desktop.

## 20. English and Arabic requirement

English and Arabic are first-release languages. The language switcher must be globally available and never require login. Arabic must be written naturally and validated as RTL throughout layout, icons, form alignment, navigation, spacing and component order.

**OWNER_APPROVED — OD-12:** Arabic requires a two-stage gate: (1) implementation/content QA by an Arabic-capable reviewer; (2) final native linguistic sign-off by an owner-designated reviewer before public publication. Machine-generated Arabic, including this first draft, is never “final approved.”

## 21. Owner-approved statements and principles

The following are approved planning statements unless later runtime verification reveals a technical mismatch:

- PCA exists to protect children in digital spaces.
- PCA began from a parent's concern.
- PCA must remain privacy-minimizing.
- PCA central systems must not store readable child/family personal content.
- Local processing is permitted where required for protection.
- Family-side E2EE synchronization is the required pattern where synchronization is needed.
- PCA Parent PWA is approved as a product direction.
- PWA installation is optional.
- PWA installation is not Trusted Browser authorization.
- Android is the planned primary platform for the first PCA Child release; public availability remains `COMING_LATER` until runtime, physical-device and release/distribution gates pass.
- iOS PCA Child is later/gated.
- Public release is bilingual EN/AR.
- Affordability and broad access are core principles.

## 22. Claims requiring later evidence

Before publication, runtime or external evidence is still required for claims about:

- exact E2EE coverage and production cryptography;
- precise local-vs-central fields in deployed runtime;
- account deletion and Delete Now behavior;
- retention periods;
- crash logs/diagnostics;
- analytics/cookies;
- subprocessors/providers;
- location behavior;
- camera/proximity behavior if enabled;
- final screen-time/app-usage/web-filtering capability by platform;
- Parent PWA install behavior on supported browsers;
- persistent Trusted Browser behavior;
- production AI activation;
- store availability;
- commercial plans/pricing;
- account security controls that would be presented publicly.

## 23. Owner decision register — current authoritative status

| ID | Decision | Recommended default | Status |
|---|---|---|---|
| OD-01 | Master tagline | “Protecting children in digital spaces.” | APPROVED |
| OD-02 | Category terminology | Lead with “digital child protection”; use “digital child protection and parental-control platform” descriptively | APPROVED |
| OD-03 | Pricing/access terminology | Use “Access” until commercial model is final | APPROVED |
| OD-04 | Founder identity/photo | Parent-origin story without founder name/photo in V1 | APPROVED |
| OD-05 | Country/region at signup | Do not request unless legal/product need is proven | APPROVED |
| OD-06 | Parent/guardian eligibility | Use simple parent/guardian authorization wording; final legal wording later | APPROVED_PROVISIONALLY — LEGAL_REVIEW_REQUIRED |
| OD-07 | Email verification | Require verified email before sensitive Parent onboarding if PUBLIC-0 confirms architecture support | APPROVED |
| OD-08 | PWA re-prompt | Respect dismissal; no prominent re-prompt for 30 days; keep passive install action | APPROVED |
| OD-09 | PWA offline scope | Safe static shell/public/help only; no intentional sensitive Parent/child data cache | APPROVED |
| OD-10 | Screenshot feedback attachment | No screenshot/file attachment in V1 | APPROVED |
| OD-11 | Feedback retention/support | Recommend 90 days after case closure for identifiable feedback, then delete/de-identify; open cases retained while active; legal/security exceptions separately controlled | OWNER_APPROVAL_PENDING |
| OD-12 | Arabic final reviewer | Owner-designated native reviewer mandatory before public publication | APPROVED |
| OD-13 | Legal entity/jurisdiction | Provisional legal drafts only; publication blocked until supplied/reviewed | OWNER_APPROVAL_PENDING — LEGAL_INPUT |
| OD-14 | Production privacy/runtime verification | Mandatory final runtime + privacy + security evidence gate | APPROVED |
| OD-15 | Institutional audience in V1 | Parent-first; institutional inquiries through Contact | APPROVED |

## 24. Staged public release model — owner approved

PCA Public is allowed to go live before the whole PCA application is production-ready. Release readiness must therefore be evaluated by surface, not by one all-or-nothing programme gate.

### PUBLIC RELEASE A — Informational Public Site
**Primary domain:** `pcasafe.com`.

May be published after the public pages, EN/AR parity, native Arabic sign-off, sufficient legal pages, responsive/accessibility/security/performance checks and public-claim audit pass. Privacy claims must remain bounded to evidence and unfinished capabilities must be labelled truthfully.

Release A does **not** depend on Android release, iOS release, production AI, Parent PWA readiness or advanced protection functionality. Auth CTAs must not pretend account entry is live if Release B is not ready.

### PUBLIC RELEASE B — Auth / Account Entry
Adds production-capable public account entry: Sign Up, Login, Verify Email, Forgot Password and Reset Password.

Release B requires the real backend, production-style database/configuration, transactional email provider delivery, rate limits, anti-enumeration behavior, token expiry/replay protection, and real-domain TLS/cookie/CSRF validation. EN and AR email content must both pass. No provider-delivery evidence may be fabricated.

### PUBLIC RELEASE C — PCA Parent Entry
**Primary domain:** `app.pcasafe.com`.

Adds Parent Web entry and Parent PWA installation only after Parent readiness, security/session boundaries, browser UAT and PWA cache/install gates pass. PWA installation remains optional and is never Trusted Browser authorization.

### PUBLIC RELEASE D — PCA Child
Adds Android child-device release only after Android runtime/emulator acceptance, owner physical-device UAT, distribution/release preparation and all relevant privacy/security/device gates pass. Until then, Android remains **COMING_LATER** and no Google Play badge, “Available now” badge or download link is allowed.

The four release stages do not need to launch together. A later stage being blocked must not automatically block an earlier stage that independently meets its gates.

## 25. Non-negotiable public-product rules

1. Do not turn PCA into a readable central surveillance database.
2. Do not collect child photos, videos, arbitrary files, messages, passwords, credentials, microphone recordings, screenshots or background recordings as routine product data.
3. Do not claim “zero data” when operational data is necessary.
4. Do not advertise a feature because UI exists.
5. Do not present iOS Child, production AI, persistent Trusted Browser state, advanced YouTube modes or production crypto closure as complete without evidence.
6. Do not equate PWA installation with Trusted Browser authorization.
7. Do not merge Parent and Platform Admin authority models.
8. Do not make installation mandatory.
9. Do not make English the privileged language experience.
10. Do not use dark cyberpunk, hacker, surveillance or fear-driven imagery as the default brand language.
11. Do not publish commercial, legal or certification claims without approval.
12. Every material public claim must remain traceable to the claim register and evidence.
