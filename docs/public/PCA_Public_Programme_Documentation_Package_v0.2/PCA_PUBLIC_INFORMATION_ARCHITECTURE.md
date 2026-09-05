# PCA Public Information Architecture

**Status:** v0.2 authoritative architecture draft — staged release model incorporated  
**Implementation:** NOT AUTHORIZED  
**Route model:** Proposed V1 public information architecture; runtime discovery in PUBLIC-0 may require route-level adjustment without changing the approved product doctrine.

## 1. IA objectives

The PCA public architecture must help a parent answer five questions quickly:

1. What is PCA?
2. How can it help my child?
3. What does PCA do with sensitive information?
4. Can I use it on my devices?
5. How do I start or get help?

It must also maintain a clear boundary between public information, Parent authentication, Parent administration and Platform Admin.

## 2. Recommended canonical navigation model

### Desktop primary navigation
**PCA logo → Home** | Why PCA | How It Works | Features | Privacy & Security | For Parents | Access | Help

Right-side actions:
**EN / العربية** | **Login** | **Get Started**

A contextual **Install PCA Parent** action may appear on `/download`, `/parents`, or authenticated Parent surfaces when installation is relevant. It should not crowd the global public header.

### Mobile navigation
Header:
**PCA logo** | **EN / العربية** | menu button

Expanded menu order:
1. Why PCA
2. How It Works
3. Features
4. Privacy & Security
5. For Parents
6. Access
7. Help / FAQ
8. About
9. Contact
10. Login
11. Get Started

Language switching must remain reachable without opening an account.

## 3. Canonical sitemap

### Core public routes
- `/` — Home
- `/why-pca` — Why PCA
- `/how-it-works` — How It Works
- `/features` — Features
- `/privacy` — Privacy overview
- `/security` — Security overview
- `/parents` — For Parents
- `/access` — Access and affordability
- `/faq` — Help / Frequently Asked Questions
- `/about` — About PCA
- `/child-safety` — Child Safety Principles
- `/download` — Install/download guidance
- `/contact` — Contact and public support
- `/accessibility` — Accessibility commitment

### Legal routes
- `/privacy-policy` — detailed privacy policy; legal review required before production
- `/terms` — terms of service; legal review required before production
- `/cookies` — conditional; create/publish only if actual runtime use justifies it

### Authentication routes
- `/login`
- `/signup`
- `/forgot-password`
- `/reset-password`
- `/verify-email`

### Authenticated Parent destinations
Exact internal routes are discovered in PUBLIC-0. Public pages may transition to the existing Parent Web only through approved auth/onboarding entry points.

### Internal operator route family
Platform Admin remains outside public/Parent navigation and has a separate security realm. No public page should expose an admin shortcut.

## 4. Staged release architecture

The public IA must support independent release stages rather than assuming every surface is live at once.

### Release A — Informational Public Site
Routes intended for Release A are the core public information pages, trust pages, FAQ, Contact, Accessibility and legally sufficient Privacy Policy/Terms. `/access` is informational. If Release B is not ready, **Login**, **Create Account** and **Get Started** must not route users into broken or non-production auth. They may be hidden, marked as coming later, or route to an informational start page according to the approved release configuration.

### Release B — Auth / Account Entry
Activates `/login`, `/signup`, `/forgot-password`, `/reset-password` and `/verify-email` only after the auth/email acceptance gate passes. Public navigation may then expose Login and Get Started as real account actions.

### Release C — PCA Parent Entry
Activates real Parent Web transition to `app.pcasafe.com` and supported PWA installation. Informational Parent pages may exist earlier, but **Open PCA Parent** / **Install PCA Parent** are active only when Release C passes.

### Release D — PCA Child
Activates Android distribution/download calls to action only after Android runtime + physical-device + approved release/distribution gates pass. Before Release D, Android is shown as the planned primary platform for the first PCA Child release with **Coming later** status. iOS remains later/gated.

A blocked B, C or D does not automatically block Release A.

## 5. Route matrix

| Route | Purpose | Primary audience | Primary CTA | Secondary CTA | Dependencies | Planned availability |
|---|---|---|---|---|---|---|
| `/` | Explain PCA and establish trust | New parents | Get Started | See How PCA Works | product claims, EN/AR copy | V1 PUBLIC TARGET |
| `/why-pca` | Explain motivation and problem | New/privacy-conscious parents | See How PCA Works | Read Our Principles | origin copy | V1 PUBLIC TARGET |
| `/how-it-works` | Explain onboarding and protection flow | Evaluating parents | Get Started | Explore Features | verified onboarding flow | V1 PUBLIC TARGET |
| `/features` | Explain capabilities and status honestly | Evaluating parents | Get Started | How It Works | claim register/runtime proof | V1 PUBLIC TARGET |
| `/privacy` | Simple privacy explanation | Privacy-conscious parents | Read Privacy Policy | Security | privacy evidence | V1 PUBLIC TARGET |
| `/security` | Explain security approach without oversharing | Privacy/security-conscious parents | Read Privacy | Contact Security | security review | V1 PUBLIC TARGET |
| `/parents` | Explain Parent Web/PWA experience | Parents | Open PCA Parent | Install Guidance | Parent routes/PWA status | V1 PUBLIC TARGET |
| `/access` | Explain access philosophy and approved plans | Cost-conscious parents | Get Started | FAQ | commercial model | V1 PUBLIC TARGET; wording provisional |
| `/faq` | Answer common questions | All | Get Started | Contact | validated answers | V1 PUBLIC TARGET |
| `/about` | Explain mission/origin/values | All/external reviewers | Why PCA | Contact | owner brand decisions | V1 PUBLIC TARGET |
| `/child-safety` | Publish PCA child-safety principles | Parents/external reviewers | Get Started | Privacy | approved doctrine | V1 PUBLIC TARGET |
| `/download` | Explain Parent install and Child platform status | Ready-to-start parents | Install/Open PCA Parent | Setup Help | runtime/store/PWA evidence | V1 PUBLIC TARGET |
| `/contact` | General/support/privacy/partnership inquiries | All | Submit Inquiry | FAQ | support workflow | V1 PUBLIC TARGET |
| `/accessibility` | Explain accessibility commitment | Accessibility users | Contact Accessibility | Home | accessibility implementation | V1 PUBLIC TARGET |
| `/privacy-policy` | Detailed privacy/legal disclosure | All | Contact Privacy | Privacy Overview | legal entity, runtime evidence | V1 REQUIRED; LEGAL GATE |
| `/terms` | Service terms | Account users | Create Account | Contact | legal entity/jurisdiction | V1 REQUIRED; LEGAL GATE |
| `/cookies` | Cookie/analytics disclosure if needed | All | Manage/understand cookies | Privacy | actual runtime analytics/cookies | CONDITIONAL |
| `/login` | Parent sign-in | Existing parents | Sign In | Create Account | auth runtime | V1 AUTH TARGET |
| `/signup` | Parent account creation | New parents | Create Account | Sign In | auth/legal consent | V1 AUTH TARGET |
| `/forgot-password` | Start password recovery | Existing parents | Send Reset Link | Return to Login | auth runtime | V1 AUTH TARGET |
| `/reset-password` | Set new password securely | Recovery users | Save New Password | Return to Login | token handling | V1 AUTH TARGET |
| `/verify-email` | Email verification states | New/re-verifying parents | Continue to PCA Parent | Resend if permitted | verification policy | V1 AUTH TARGET |

## 6. Public-to-authenticated transitions

### Journey A — new parent
`/` → `/how-it-works` or `/features` → `/signup` → verification if required → existing Parent onboarding.

### Journey B — returning parent
Any public page → `/login` → existing Parent Web.

### Journey C — install Parent PWA
`/parents` or `/download` → authenticate/open Parent → eligible install promotion → install or continue in browser.

### Journey D — privacy-first evaluator
`/privacy` → `/privacy-policy` and `/security` → `/signup` when ready.

### Journey E — support
`/faq` → `/contact` for unresolved public issues; authenticated Parent support should route to the Parent Help & Feedback area when available.

No public route should bypass Parent authentication or create a shortcut to Platform Admin.

## 7. Homepage architecture

1. **Hero** — purpose + primary CTA.
2. **Why PCA exists** — short parent-origin statement.
3. **The digital-safety challenge** — calm, non-alarmist explanation.
4. **How PCA helps** — feature categories with real status.
5. **Privacy by design** — local-first / no readable central child profile.
6. **How it works** — account → child → child device → protections → status.
7. **PCA Parent** — responsive web + PWA direction.
8. **PCA Child** — Android planned primary first-release platform; currently `COMING_LATER`; iOS later/gated.
9. **Child Safety Principles** — short values summary.
10. **Access and affordability** — values, not unapproved prices.
11. **FAQ preview**.
12. **Final CTA**.

## 8. Page hierarchy and cross-linking

### Why PCA cluster
`/why-pca` ↔ `/about` ↔ `/child-safety`

### Product understanding cluster
`/how-it-works` ↔ `/features` ↔ `/parents` ↔ `/download`

### Trust cluster
`/privacy` ↔ `/security` ↔ `/privacy-policy` ↔ `/child-safety`

### Help cluster
`/faq` ↔ `/contact` ↔ authenticated Help & Feedback

### Conversion cluster
Every appropriate public page may expose **Get Started** and/or **Login**, but sensitive/legal pages should avoid aggressive marketing treatment.

## 9. Language architecture

Visible switcher label: **EN / العربية**.

Requirements:
- available globally on public and auth pages;
- persists preference where technically appropriate without creating unnecessary tracking;
- preserves equivalent route where possible when switching language;
- changes document direction (`ltr`/`rtl`) and language metadata;
- no login required;
- Arabic content is independently authored/reviewed, not raw machine translation.

## 10. CTA hierarchy

### Primary CTAs
- Get Started
- Create Account
- Sign In (task-primary on Login)
- Install PCA Parent (only when relevant and supported)

### Secondary CTAs
- See How PCA Works
- Explore Features
- Read About Privacy
- Continue in Browser
- Contact Support

### Tertiary text actions
- Learn more
- Read our principles
- Forgot password?
- Return to login

## 11. Access route decision

**OWNER_APPROVED — OD-03:** Use `/access` and navigation label **Access** until commercial pricing is finalized. The page may explain affordability principles and state that plan details will be published when approved. A future `/pricing` route may replace or redirect from `/access` only after a later commercial decision.

## 12. Privacy and security route decision

Recommended default: keep `/privacy` and `/security` separate because parents ask two different questions:

- Privacy: “What information does PCA process/store/read?”
- Security: “How does PCA protect accounts, devices and encrypted delivery?”

Both should cross-link prominently.

## 13. Cookies route rule

`/cookies` is not automatically published. It becomes required only if runtime discovery confirms cookies/analytics or similar technologies needing dedicated disclosure or preference management.

## 14. Authentication shell architecture

All auth routes use a common branded shell containing:
- PCA logo;
- short purpose statement;
- EN / العربية;
- task content;
- privacy reassurance;
- Privacy Policy and Terms links;
- responsive/accessible layout.

The auth shell must not resemble Platform Admin and must not overload the user with marketing.

The auth routes belong to **PUBLIC RELEASE B** and remain inactive as production account entry until transactional email/security acceptance passes. Required evidence includes signup, real email delivery, verification, resend, expiry/replay denial, forgot/reset flow, anti-enumeration, rate limiting, EN/AR email content and real-domain email-link validation.

**OD-05 APPROVED:** do not request Country/Region at signup unless PUBLIC-0/legal review proves a real requirement.  
**OD-06 APPROVED_PROVISIONALLY:** use simple wording confirming that the user is the parent/guardian or otherwise authorized to manage the child/device; final legal wording remains a legal-review gate.  
**OD-07 APPROVED:** verified email should precede sensitive Parent onboarding where PUBLIC-0 confirms the existing auth architecture supports it.

## 15. Parent PWA entry architecture

The public site may explain PCA Parent installability, but actual install promotion belongs primarily in the Parent experience because eligibility depends on browser/platform state.

Public copy must state:
- installation is optional;
- Parent remains usable in the browser;
- install support varies by browser/platform;
- PWA installation does not make the device a Trusted Browser.

## 16. Feedback architecture placement

### Public Contact
General inquiry, technical support routing, privacy question, partnership, accessibility and security concern.

### Authenticated Parent Help & Feedback
Provide Feedback, Report a Problem, Suggest a Feature, Rate PCA.

Do not expose internal operator/admin contact details or automatic sensitive diagnostics.

## 17. SEO and discovery architecture

Every indexable public page should receive:
- unique EN/AR title and description;
- canonical URL;
- `hreflang` or equivalent language alternates;
- semantic heading hierarchy;
- Open Graph metadata;
- inclusion in sitemap where appropriate.

Auth, reset and verification routes generally should not be indexed. Final robots behavior is confirmed during PUBLIC-12.

## 18. Route governance

PUBLIC-0 must inspect the existing repository before routes are created or changed. If current routing conflicts with this proposal, Claude must document the conflict and recommend the least disruptive compliant mapping. Do not rewrite routing architecture simply to match this document cosmetically.

Exact file ownership is unknown until discovery. No implementation agent may claim a route family until the coordinator publishes a non-overlapping ownership map.
