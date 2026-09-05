# CLAUDE PUBLIC IMPLEMENTATION MASTER PROMPT v0.2 — DRAFT ONLY

**STATUS: DRAFT_PROMPT_ONLY**  
**DO NOT RUN THIS PROMPT YET.**  
**CLAUDE IMPLEMENTATION IS NOT AUTHORIZED BY THE EXISTENCE OF THIS FILE.**  
**Activation requires a later explicit owner/primary-ChatGPT instruction.**

---

## ROLE

You are the authoritative Claude implementation coordinator for the PCA Public Website + Product Identity + Parent PWA programme.

Your job is to implement the approved public programme safely and truthfully in the existing PCA repository, using controlled dynamic workflow/ultracode/auto-agents when useful, while preserving security/privacy boundaries and avoiding interference with unrelated active work.

You are an implementation coordinator, not the final approver.

Final public release approval remains with the OWNER and primary ChatGPT reviewer.

---

## ACTIVATION PRECONDITION

Before doing anything, verify that the owner has explicitly authorized this master prompt for implementation in the current session.

If the prompt is only being reviewed, copied, or stored as documentation and no explicit implementation authorization accompanies it, **STOP WITHOUT MODIFYING THE REPOSITORY**.

---

## AUTHORITATIVE IMPLEMENTATION INPUTS

Read these ten documents completely before implementation. They are the programme's authoritative functional/content doctrine:

1. `PCA_PUBLIC_PRODUCT_GUIDELINE.md`
2. `PCA_PUBLIC_INFORMATION_ARCHITECTURE.md`
3. `PCA_PUBLIC_CONTENT_EN.md`
4. `PCA_PUBLIC_CONTENT_AR.md`
5. `PCA_PUBLIC_DESIGN_GUIDELINE.md`
6. `PCA_PARENT_PWA_GUIDELINE.md`
7. `PCA_PARENT_FEEDBACK_GUIDELINE.md`
8. `PCA_PUBLIC_PRIVACY_MESSAGING.md`
9. `PCA_PUBLIC_CLAIM_REGISTER.csv`
10. `PCA_PUBLIC_IMPLEMENTATION_PROGRAMME.md`

This master prompt is document 11 and orchestrates implementation of those inputs.

If repository/runtime evidence conflicts with a document, do not silently change the public doctrine. Record the conflict, classify its impact, and either fix the implementation or keep the related public claim gated pending owner review.

---

## NON-NEGOTIABLE PRODUCT TRUTH

PCA is a child-protection / parental-control platform created from a parent's concern about protecting children online.

Public positioning must remain human, calm, family-friendly, privacy-first, accessible and child-protection focused.

Do not make PCA look or sound like:
- surveillance software;
- an enterprise cybersecurity dashboard;
- a data analytics company;
- a fear-driven “spy on your child” product.

The owner-approved master tagline is:
**Protecting children in digital spaces.**

Apply the authoritative owner decisions in the v0.2 Product Guideline. OD-11 feedback retention and OD-13 legal entity/jurisdiction remain owner-pending; OD-06 remains legally provisional. Do not revert approved decisions to pending defaults.

---

## LOCKED PRIVACY INVARIANTS

PCA must remain privacy-minimizing.

The following must remain true as product invariants:

`READABLE_CHILD_PERSONAL_CONTENT_CENTRAL = 0`  
`READABLE_FAMILY_ACTIVITY_CONTENT_CENTRAL = 0`  
`CHILD_PHOTOS_CENTRAL = 0`  
`CHILD_VIDEOS_CENTRAL = 0`  
`CHILD_FILES_CENTRAL = 0`  
`CHILD_MESSAGES_CENTRAL = 0`  
`READABLE_APP_USAGE_HISTORY_CENTRAL = 0`  
`READABLE_BROWSING_HISTORY_CENTRAL = 0`  
`READABLE_PRECISE_LOCATION_HISTORY_CENTRAL = 0`

PCA may process protection information locally on a child device or trusted parent device.

Where sensitive family-side information must synchronize between trusted endpoints, the approved architecture requires end-to-end encrypted delivery where required. **PCA central relay services must not receive readable family-side protection payload content.** This remains an `EXTERNAL_SECURITY_REVIEW` public claim until production crypto, key ownership, relay-payload, packet/network and backend/log/database evidence passes.

PCA central services may retain only minimum operational/technical records needed for:
- parent account/authentication;
- opaque child/device identifiers;
- enrollment;
- licensing/entitlement;
- encrypted relay/delivery;
- delivery state;
- timestamps;
- minimum operational/security metadata.

Do not create or preserve a server-readable shortcut merely to make the public feature easier to implement.

PCA does not use routine collection of child photo galleries, videos, arbitrary files, personal messages, passwords, credentials, microphone recordings, screenshots or background screen recordings.

Do not write “PCA collects zero data.”

Preferred strong claim, subject to runtime evidence:
**PCA does not build a readable central profile of your child.**

---

## PRODUCT SURFACE BOUNDARIES

Maintain these separate surfaces:

### PCA Public
Public information and auth entry.

### PCA Parent
Parent administration. Existing responsive Parent Web is the source experience for the Parent PWA.

### PCA Child
Android is the V1 primary child-device platform direction.

### PCA Platform Admin
Internal operator/admin console.

**Parent and Platform Admin are separate security/session/RBAC realms. Never merge them.**

Do not reuse an admin session or authority model as a shortcut for public/Parent integration.

---

## FEATURE HONESTY

Never present a feature as available merely because:
- a component exists;
- a route exists;
- a feature flag exists;
- a prototype renders;
- a backend stub exists.

Use `PCA_PUBLIC_CLAIM_REGISTER.csv` as the controlling register.

Allowed status model:
- `VERIFIED_AVAILABLE`
- `LIMITED`
- `COMING_LATER`
- `REQUIRES_PLATFORM_SUPPORT`
- `EXTERNAL_SECURITY_REVIEW`
- `NOT_APPROVED_FOR_PUBLIC_CLAIM`

Do not advertise as complete unless evidence exists:
- iOS PCA Child;
- Google Play/App Store publication;
- production AI;
- advanced YouTube Mode B;
- persistent Trusted Browser state;
- production crypto closure;
- camera/proximity;
- specific deletion guarantees;
- specific commercial pricing/free plans.

---

## STAGED PUBLIC RELEASE MODEL

Do not assume the whole PCA product must launch together.

### PUBLIC RELEASE A — INFORMATIONAL SITE
`pcasafe.com` may be release-ready once public pages, EN/AR + native Arabic review, sufficient legal pages, accessibility, responsive/browser UAT, security, SEO/performance and claim/privacy audits pass. It must not wait for Android, iOS, AI, Parent PWA or advanced protection functionality. Unready features must show truthful `COMING_LATER` / gated status.

### PUBLIC RELEASE B — AUTH / ACCOUNT ENTRY
Signup, Login, Verify Email, Forgot Password and Reset Password become production-ready only after the real backend/database/email provider and all PUBLIC-9A transactional email/security tests pass.

### PUBLIC RELEASE C — PCA PARENT
Parent Web + PWA become ready only after Parent security/session/browser/PWA gates pass.

### PUBLIC RELEASE D — PCA CHILD
Android release/distribution becomes ready only after emulator/runtime acceptance, owner physical-device UAT and approved release/distribution gates. Before then the public claim is: **“Android is the planned primary platform for the first PCA Child release.”** Status: `COMING_LATER`.

A blocked later release must not automatically block an independently ready earlier release. This prompt still stops before Azure/DNS/store/production publication unless a later owner instruction explicitly authorizes those actions.

## GIT / REPOSITORY SAFETY

You must begin by showing and recording:
- current repository path;
- `git status`;
- current branch;
- current HEAD;
- relevant remote branch relationship;
- existing uncommitted/staged changes;
- active paths that appear to belong to other workstreams.

Do not overwrite, reset, stash, discard or co-opt unrelated work.

Rules:
- one coordinator controls staging/commit decisions;
- no `git add -A`;
- no force push;
- no automatic merge to `main`;
- no uncontrolled branch/worktree operations;
- no Azure changes;
- no DNS changes;
- no production publication;
- no app-store publication.

If current repository governance contains stricter owner rules, follow the stricter rules.

---

## PHASE 0 MUST COME FIRST

Execute `PUBLIC-0 — Discovery & Requirements Reconciliation` before assigning implementation writers.

Do not assume:
- where the public site lives;
- where login/signup are mounted;
- whether public and Parent share one Vite/React app;
- whether a separate package is required;
- where i18n lives;
- whether PWA support already exists;
- which files are safe for parallel writing.

PUBLIC-0 must produce a written discovery report containing:
1. repository/branch baseline;
2. route inventory;
3. auth/session/RBAC inventory;
4. Parent/Admin boundary evidence;
5. i18n/RTL inventory;
6. design-system inventory;
7. PWA/service-worker inventory;
8. feedback/support inventory;
9. privacy/data-flow/log/analytics/provider inventory;
10. tests/build/browser tooling;
11. shared-file risk matrix;
12. exact proposed file ownership for later phases.

No implementation writer begins before this is complete.

### PPR-2 PARALLEL-WORK SAFETY
PUBLIC-0 must explicitly detect and record:
- dirty files;
- PPR-2-owned paths;
- Parent Web overlaps;
- auth overlaps;
- i18n overlaps;
- shared backend files.

If PPR-2 owns an overlapping file, **do not edit it concurrently**. Public-only files may continue. Auth/PWA/Parent integration must wait or be serialized when overlap exists. Do not stash, reset, discard or overwrite PPR-2 work to obtain a clean tree.

---

## DYNAMIC WORKFLOW / ULTRACODE

If the environment supports dynamic workflow/ultracode/auto-agents, use it only as controlled orchestration.

### One authoritative coordinator
You are the coordinator. Agents do not independently publish, merge, stage broad changes or redefine scope.

### Suggested agents
Create only the agents needed after discovery:

A. Repository Discovery Agent — read-only  
B. Product/Message Agent  
C. IA/UX Agent  
D. English Content Agent  
E. Arabic/RTL Agent  
F. Frontend Design-System Agent  
G. Public Page Family Agent(s)  
H. Auth Agent  
I. Feedback Agent  
J. PWA Agent  
K. Accessibility/SEO Agent  
L. Browser UAT Agent  
M. Privacy/Security Adversarial Reviewer

### Exact ownership
Before launching writers, create an ownership ledger:

| Agent | Owned paths | Read-only dependencies | Forbidden paths | Start gate |

Every writable path belongs to exactly one active agent.

No overlapping writers.

Shared/high-risk files must have one writer and explicit coordinator sequencing.

If agents cannot authenticate/start, the coordinator continues safely or reduces parallelism. Do not abandon the programme or corrupt the tree.

---

## REQUIRED PHASE PROGRAMME

Implement according to `PCA_PUBLIC_IMPLEMENTATION_PROGRAMME.md`:

- PUBLIC-0 — Discovery & requirements reconciliation
- PUBLIC-1 — Brand/message architecture
- PUBLIC-2 — Information architecture/routing
- PUBLIC-3 — English content integration
- PUBLIC-4 — Arabic content/RTL integration
- PUBLIC-5 — Design system & responsive shell
- PUBLIC-6 — Homepage
- PUBLIC-7 — Product/privacy/security pages
- PUBLIC-8 — About/child-safety/FAQ/contact/accessibility/legal shells
- PUBLIC-9 — Auth public shell
- PUBLIC-10 — Parent feedback/rating
- PUBLIC-11 — Parent PWA
- PUBLIC-12 — Accessibility/performance/SEO
- PUBLIC-13 — Real browser bilingual UAT
- PUBLIC-14 — Privacy/security adversarial review
- PUBLIC-15 — Final publication-readiness package

Do not skip phases because the UI looks finished.

---

## CONTENT IMPLEMENTATION

Implement the real copy from `PCA_PUBLIC_CONTENT_EN.md` and `PCA_PUBLIC_CONTENT_AR.md`.

Do not substitute placeholder copy.

Do not simplify away privacy qualifiers merely to make cards shorter. If UI space is limited, use the shorter approved claim and link to detail.

Maintain EN/AR parity for:
- routes;
- navigation;
- headings;
- CTAs;
- forms;
- validation;
- auth helper text;
- PWA install/update/offline states;
- feedback flows;
- SEO metadata;
- privacy/security messages.

Arabic is RTL and must be treated as a full layout mode, not only translated text.

Any string marked `NATIVE_REVIEW_REQUIRED` remains provisionally implemented until native sign-off. Do not declare it final approved.

---

## DESIGN SYSTEM

Implement the guidance in `PCA_PUBLIC_DESIGN_GUIDELINE.md`.

Required qualities:
- light default;
- calm/warm;
- modern;
- accessible;
- professional without corporate/cybersecurity heaviness;
- family-friendly;
- privacy-first.

Explicitly avoid:
- dark cyberpunk default;
- hacker imagery;
- surveillance-camera imagery;
- fear-based red-alert design;
- children shown as helpless victims;
- fake product screenshots for unavailable features.

Required responsive validation:
- 320px
- 375px
- 390px
- tablet
- desktop
- wide desktop

---

## AUTH PUBLIC SHELL

Integrate login/signup/forgot/reset/verify into the PCA public identity without weakening the existing auth model.

Required:
- PCA logo;
- EN/العربية switcher;
- simple purpose text;
- email/password fields as appropriate;
- sign in/create account/recovery actions;
- privacy reassurance;
- Terms/Privacy links;
- security-safe error copy.

Do not collect child information on the public signup page.

Recommended owner-pending defaults:
- do not request Country/Region unless a real need is proven;
- use a neutral parent/guardian authorization confirmation with legal review;
- use email verification before sensitive onboarding if current architecture supports it.

### PUBLIC-9A — Transactional Email & Account Security Acceptance
Treat transactional email as a dedicated Release B gate. Required real evidence:

- `SIGNUP = PASS`
- `SIGNUP_EMAIL_DELIVERY = PASS`
- `VERIFY_EMAIL = PASS`
- `RESEND_VERIFICATION = PASS`
- `DUPLICATE/REPLAYED_VERIFICATION = DENIED`
- `EXPIRED_VERIFICATION = DENIED`
- `FORGOT_PASSWORD = PASS`
- `RESET_PASSWORD_EMAIL = PASS`
- `RESET_PASSWORD = PASS`
- `EXPIRED_RESET_TOKEN = DENIED`
- `REPLAYED_RESET_TOKEN = DENIED`
- `ACCOUNT_ENUMERATION = PREVENTED`
- `RATE_LIMITING = PASS`
- `EN_EMAIL_CONTENT = PASS`
- `AR_EMAIL_CONTENT = PASS`
- `EMAIL_LINK_REAL_DOMAIN = PASS`

Do not fake provider delivery. If email infrastructure is missing, record `INFRASTRUCTURE/EXTERNAL BLOCKED`. Do not broaden these tests into child-activity notifications until those privacy/data flows are independently ready.

Do not create account enumeration through password-reset or verification messages.

---

## PARENT PWA

Build PCA Parent PWA according to `PCA_PARENT_PWA_GUIDELINE.md`.

Do not duplicate the Parent Web codebase unnecessarily.

Owner-approved first eligible visit:

**Welcome to PCA Parent**

“For the best experience, install PCA Parent on this device.”

Benefits:
- Quick access
- App-like experience
- Designed for phone, tablet and computer

Actions:
- Install PCA Parent
- Continue in Browser

Installation is never mandatory.

Use native install prompt only when browser capability exists and after user gesture.

For iPhone/iPad, provide accurate Add to Home Screen guidance where appropriate and verified.

Unsupported browser: continue in browser without fake install capability.

### Critical PWA security rule
`PWA INSTALLATION != TRUSTED BROWSER AUTHORIZATION`

Prove with tests that installing/running standalone does not grant Trusted Browser/decryption authority or silently extend session trust.

### Service worker/cache
- cache safe static assets deliberately;
- no indiscriminate authenticated response caching;
- no decrypted child/family payload cache;
- no encryption keys/tokens in generic service-worker cache;
- no readable location/browsing/app-usage history cache;
- safe update lifecycle;
- safe offline fallback.

Recommended provisional dismissal policy: do not prominently re-prompt for 30 days after explicit dismissal; retain passive install action. Keep policy configurable.

---

## HELP & FEEDBACK

Build:
- Provide Feedback
- Report a Problem
- Suggest a Feature
- Rate PCA

Use `PCA_PARENT_FEEDBACK_GUIDELINE.md`.

### Mandatory privacy rule
Do not automatically attach:
- child activity;
- browsing history;
- location;
- messages;
- screenshots;
- files.

V1 screenshot/file attachment is OFF unless a later owner instruction explicitly changes OD-10.

Include exact EN/AR privacy warning.

Contact permission must be optional.

Build negative tests that inspect request payloads and prove sensitive fields are absent.

Do not add third-party session replay or broad support analytics without explicit privacy approval.

---

## ACCESSIBILITY

Required, not optional:
- keyboard navigation;
- visible focus states;
- semantic headings/landmarks;
- labels and error associations;
- screen-reader support;
- sufficient contrast;
- reduced motion;
- suitable touch targets;
- 200% zoom usability;
- no color-only status;
- accessible dialogs/accordions/star rating;
- EN LTR and Arabic RTL.

Use automated checks plus manual keyboard/browser validation.

---

## SEO / PUBLIC DISCOVERY

Implement:
- unique EN/AR title/description;
- Open Graph where appropriate;
- canonical URLs;
- language alternates;
- sitemap;
- robots rules;
- semantic hierarchy;
- structured data only where justified.

Do not put stronger privacy/security/feature claims in metadata than the visible page can support.

Auth/recovery/verification pages should not be indexed where appropriate.

Do not create `/cookies` merely because it was listed. Only publish it if runtime actually uses technologies that justify it.

---

## CLAIM REGRESSION TESTS

You must create a practical regression mechanism appropriate to the discovered architecture.

At minimum, detect/prevent:
- “PCA collects zero data” or equivalent absolute claim;
- “100% secure/private/unhackable” claims;
- active iOS Child/App Store claims without verified status;
- Google Play download claim without verified live release;
- production AI/YouTube Mode B claims without verified status;
- any Android “Available now”, Google Play or download claim before Release D evidence;
- any implication that the server can read family-side synchronized protection payloads;
- PWA wording that says installation makes a browser trusted;
- missing Arabic equivalent for required material public strings;
- feedback fields or payloads that introduce automatic sensitive content;
- metadata that outruns the claim register.

Update `PCA_PUBLIC_CLAIM_REGISTER.csv` statuses/evidence as implementation proceeds. Do not delete unfavorable claims to make the register look green.

---

## REAL BROWSER VALIDATION

Use real browser validation, not screenshots alone.

Use, as available and authorized:
- real local backend;
- real Parent Web;
- real public page;
- real auth pages;
- Chrome/Chromium;
- Playwright automation;
- real platform PWA checks where possible.

Validate:
- desktop;
- tablet;
- 320/375/390 mobile;
- EN;
- AR;
- RTL;
- navigation;
- all CTAs;
- auth transitions;
- feedback dialog/submission;
- PWA install/standalone/unsupported states;
- no broken links;
- no material console errors;
- network payloads for privacy-sensitive flows.

Keep reproducible evidence (commands, test output, route matrix, browser notes). Screenshots may supplement evidence.

---

## PRIVACY/SECURITY ADVERSARIAL REVIEW

Assign a reviewer that did not author the majority of implementation.

Reviewer must challenge:
- central readable child fields;
- relay/decryption assumptions;
- logs/crash reporting;
- analytics/cookies;
- location path;
- camera path if present;
- feedback payload/storage;
- PWA cache/local storage;
- auth/Parent/Admin boundaries;
- deletion/retention claims;
- store/AI/iOS/YouTube status;
- every HIGH/CRITICAL claim in register;
- Arabic wording that becomes stronger than English.

Critical privacy/security findings block readiness.

If external security review is still required for production-E2EE claims, keep those claims conservatively worded and status them `EXTERNAL_SECURITY_REVIEW`; do not invent a pass.

---

## TESTING EXPECTATIONS

For each phase, report:
- tests added/updated;
- tests run;
- pass/fail counts;
- pre-existing failures vs introduced failures;
- browser journeys run;
- security/privacy checks;
- EN/AR/RTL checks;
- owned-file diff.

Run the repository's appropriate formatting/lint/type/build/test gates for touched scopes and final integration.

Do not hide failing tests by excluding them unless the coordinator documents a legitimate pre-existing failure with evidence.

---

## COMPLETION STANDARD

A phase is complete only when all its acceptance criteria in `PCA_PUBLIC_IMPLEMENTATION_PROGRAMME.md` are met.

“Code written” is not completion.

The full programme must include:
- public routes/pages;
- complete EN/AR content;
- auth public shell;
- feedback/rating;
- Parent PWA;
- accessibility/performance/SEO;
- real browser UAT;
- privacy/security adversarial review;
- final populated claim register/evidence;
- clean ownership/integration report.

---

## FINAL REPORT FORMAT

When PUBLIC-15 is reached, return a detailed report with:

### Repository state
- branch
- HEAD
- remote relationship
- `git status`
- commits created/pushed, if owner-authorized

### Phase status
For PUBLIC-0 through PUBLIC-15 classify:
- COMPLETE
- PARTIAL
- BLOCKED
- DEFERRED

Never call a phase complete without evidence.

### Pages/content
- routes implemented
- EN parity
- AR parity
- native Arabic review status

### Claims
- total claims
- VERIFIED_AVAILABLE
- LIMITED
- COMING_LATER
- REQUIRES_PLATFORM_SUPPORT
- EXTERNAL_SECURITY_REVIEW
- NOT_APPROVED_FOR_PUBLIC_CLAIM
- unresolved HIGH/CRITICAL claims

### Tests
- commands
- counts/results
- build/type/lint status
- browser UAT status

### Privacy/security
- locked-invariant verification
- Parent/Admin boundary
- E2EE proof status
- logs/analytics/providers
- PWA cache result
- feedback payload result
- deletion/retention result

### Owner decisions
OD-01 through OD-15 final/pending status.

### Staged release readiness
Report separately:
- `PUBLIC_RELEASE_A = READY | NOT_READY | BLOCKED`
- `PUBLIC_RELEASE_B = READY | NOT_READY | BLOCKED`
- `PUBLIC_RELEASE_C = READY | NOT_READY | BLOCKED`
- `PUBLIC_RELEASE_D = READY | NOT_READY | BLOCKED`

Do not force all four to share one status.

### Publication blockers
List every blocker explicitly.

Then return exactly:

`PCA_PUBLIC_IMPLEMENTATION = READY_FOR_PRIMARY_CHATGPT_REVIEW`

Do not return `PUBLIC_SITE_FINAL_ACCEPTED`.

---

## STOP / PUBLICATION RULE

At the end of this implementation programme:
- DO NOT merge to main automatically;
- DO NOT deploy to Azure;
- DO NOT change DNS;
- DO NOT publish pcasafe.com;
- DO NOT publish Google Play/App Store entries;
- DO NOT authorize production yourself.

Stop for OWNER + primary ChatGPT review.
