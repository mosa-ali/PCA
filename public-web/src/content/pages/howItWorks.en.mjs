/**
 * PUBLIC-7 — HOW PCA WORKS content (English). The consolidated journey page.
 *
 * OWNER IA RULING, 2026-09-05. This route absorbs the useful content of the
 * former /how-it-works, /download and /parents pages. It is EDITORIAL
 * SELECTION, not new authorship: every sentence below is an owner-approved
 * string already transcribed into this package, re-selected and shortened.
 * Provenance for each block is recorded inline.
 *
 * WHAT WAS DROPPED, AND WHY
 *   - /download "Need help?" ("See setup questions in FAQ or Contact support.")
 *     names the FAQ route, which the ruling deletes. Kept out rather than
 *     rewritten; Contact stays reachable from the footer.
 *   - /parents "first-time install message" preview (card + three benefit
 *     bullets) is Release-C interface copy, not journey information.
 *   - The privacy tail of the old Step 4 ("PCA central services may need opaque
 *     identifiers...") and of the old Step 6 ("...without exposing unnecessary
 *     child-sensitive data centrally"). Privacy is explained once, on /privacy/.
 *   - Old Step 1's second sentence ("Public signup should request only
 *     information needed...") is a specification for the implementer, not a
 *     sentence a parent reads.
 *
 * DEF-1 (INTERNAL DIRECTIVES MUST NEVER BE PARENT-FACING). The approved v0.2
 * documents embedded implementer directives in body copy -- the store-badge
 * direction, "Availability must be verified by platform before publication",
 * and the iPhone/iPad status-plus-direction paragraph. None is transcribed
 * anywhere in this file. The owner-approved replacement language is used
 * instead for iPhone/iPad (CLM-026) and the Android release status is carried
 * by CLM-024's registered "Coming later" label rather than by prose.
 *
 * ONE DELIBERATE VARIANT OF THE APPROVED DEF-1 SENTENCE. The owner's iPhone/
 * iPad replacement reads "iPhone and iPad child protection is planned for a
 * later release." The consolidated Home page (home.availability.items[2])
 * already publishes that sentence verbatim, and build.mjs FAILS the build when
 * the same substantive sentence appears on two routes -- which is exactly the
 * duplicate-content rule the IA ruling exists to enforce. So this page states
 * the identical meaning in its own words: "Child protection for iPhone and iPad
 * is planned for a later release." No availability is asserted, the sentence is
 * a pure reordering of the approved one, and CLM-026 supplies the status label.
 * Flagged to the coordinator; if the owner requires the exact string on both
 * pages, the fix is to drop this card, not to weaken the sentence.
 *
 * The AI (CLM-057) and YouTube (CLM-058) DEF-1 replacements are deliberately
 * NOT repeated here: Home absorbs /features and already publishes both.
 *
 * CLAIM DISCIPLINE
 *   - CLM-021 (browser use) is the one VERIFIED_AVAILABLE claim rendered here.
 *   - CLM-019 / CLM-020 (installability, installation optional) and CLM-024 /
 *     CLM-026 (child platforms) are COMING_LATER, so each renders "Coming
 *     later" and NO install action, store badge, store link or download action
 *     appears anywhere on this page.
 *   - CLM-022 (installing is NOT Trusted Browser authorization) is stated as
 *     plain prose in a notice with NO claimId: it is VERIFIED_AVAILABLE, and an
 *     "Available" pill on a security distinction would read as a feature badge.
 *   - The end-to-end encryption sentence keeps design language and carries no
 *     claim label while CLM-016 is under external security review.
 *
 * NEW COPY (authored here because the approved documents supply no equivalent;
 * reported to the coordinator for review and for OD-12 Arabic sign-off):
 *   howItWorks.steps.label, howItWorks.steps.title,
 *   howItWorks.steps.items[1].title/body   (Verify email — no approved source)
 *   howItWorks.steps.items[4].title/body   (enrollment code/link — none)
 *   howItWorks.child.title and the two child card titles (short labels)
 *
 * FILE OWNERSHIP: exactly one writer owns this file. Do NOT edit
 * src/content/index.mjs, routes.mjs, claims.mjs, build.mjs or any shared
 * component from here -- the coordinator registers pages and owns those.
 */

export default {
  "howItWorks.seo.title": "How PCA Works — Parent and Child Protection Flow",
  "howItWorks.seo.description": "See the planned PCA journey from parent account to child-device protection, status and family requests.",
  "howItWorks.hero.title": "From account setup to everyday protection",
  "howItWorks.hero.body": "PCA is designed to make the protection journey understandable: set up the parent account, connect the supported child device, choose appropriate rules, and review protection status from PCA Parent.",
  "howItWorks.steps.label": "The journey",
  "howItWorks.steps.title": "Eight steps",
  "howItWorks.steps.items": [
    {
      "title": "Create your parent account",
      "body": "Use your email and password to create PCA Parent access."
    },
    {
      "title": "Verify your email",
      "body": "Confirm your email address to activate PCA Parent access."
    },
    {
      "title": "Set up your child inside PCA Parent",
      "body": "Child setup belongs within the protected Parent experience."
    },
    {
      "claimId": "CLM-024",
      "title": "Install PCA Child",
      "body": "Follow the guidance for the device you are setting up."
    },
    {
      "title": "Create an enrollment code or link",
      "body": "In PCA Parent, create the enrollment code or link for that child."
    },
    {
      "title": "Connect the child device",
      "body": "Use the approved enrollment/pairing flow."
    },
    {
      "title": "Choose protections",
      "body": "Depending on verified platform capabilities, parents may configure screen-time rules, schedules, app/web controls and other supported protections."
    },
    {
      "title": "Review status and respond",
      "body": "PCA Parent should help the parent understand whether protection is working and respond to supported child requests."
    }
  ],
  "howItWorks.parent.title": "PCA Parent",
  "howItWorks.parent.items": [
    {
      "claimId": "CLM-021",
      "title": "No installation required",
      "body": "PCA Parent is designed to run in a supported browser on phone, tablet or computer, with nothing to install."
    },
    {
      "claimId": "CLM-019",
      "title": "Install PCA Parent",
      "body": "Where installation is supported, you may install it for app-like access."
    },
    {
      "claimId": "CLM-020",
      "title": "Installation remains optional",
      "body": "You never need to install PCA Parent just to use the service."
    }
  ],
  "howItWorks.security.title": "Important security distinction",
  "howItWorks.security.body": "Installing PCA Parent is about convenience. Trusted Browser authorization is a separate PCA security concept and follows separate rules.",
  "howItWorks.sensitive.title": "What happens to sensitive information?",
  "howItWorks.sensitive.body": "Protection settings and status move between your trusted devices. Privacy & Safety explains what is processed where.",
  "howItWorks.protects.label": "What PCA protects",
  "howItWorks.protects.title": "Practical protection families can understand",
  "howItWorks.protects.items": [
    {
      "claimId": "CLM-028",
      "title": "Screen Time",
      "body": "Support healthier device-use limits and routines."
    },
    {
      "claimId": "CLM-030",
      "title": "Safer Browsing",
      "body": "Help apply approved web-safety decisions."
    },
    {
      "claimId": "CLM-029",
      "title": "Apps & Web Controls",
      "body": "Set appropriate boundaries for apps and online access."
    },
    {
      "claimId": "CLM-031",
      "title": "Schedules",
      "body": "Create predictable times for study, rest and sleep."
    },
    {
      "claimId": "CLM-032",
      "title": "Protection Status",
      "body": "See whether protections are active."
    },
    {
      "claimId": "CLM-033",
      "title": "Parent & Child Requests",
      "body": "Support clear family interaction when a child needs more time."
    },
    {
      "claimId": "CLM-034",
      "title": "Alerts",
      "body": "Receive relevant protection notices."
    },
    {
      "claimId": "CLM-035",
      "title": "Device Protection",
      "body": "Help maintain the protection configuration on the child device."
    }
  ],
  "howItWorks.faq.label": "Common questions",
  "howItWorks.faq.title": "Quick answers",
  "howItWorks.faq.items": [
    {
      "q": "Does PCA read my child's messages?",
      "a": "PCA is not designed to capture or centrally read personal messages."
    },
    {
      "q": "Does PCA collect photos or files?",
      "a": "Routine protection does not require a child's photo library, videos or arbitrary files."
    },
    {
      "q": "Can I use PCA Parent without installing it?",
      "a": "Yes. Installation is optional; Parent Web remains available in the browser."
    },
    {
      "q": "Does PCA use AI?",
      "a": "AI-supported features are planned for a later release."
    },
    {
      "q": "Does PCA protect YouTube use?",
      "a": "Advanced YouTube protection is planned for a later release."
    },
    {
      "q": "How much does PCA cost?",
      "a": "Final plans and prices are not published yet."
    }
  ]
};
