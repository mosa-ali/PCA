/**
 * PUBLIC-2r2 — HOME content (English). THE consolidated main page.
 *
 * OWNER IA RULING, 2026-09-05: three public pages, not fourteen. Home absorbs
 * the useful content of the former /why-pca, /about, /features, /parents,
 * /access, /child-safety and /faq pages. This table is EDITORIAL SELECTION AND
 * CONDENSATION of strings that were already transcribed from
 * docs/public/PCA_Public_Programme_Documentation_Package_v0.2/
 * PCA_PUBLIC_CONTENT_EN.md -- nothing here is re-transcribed from the source
 * document and no new marketing prose is invented. Where a sentence had to get
 * shorter, a whole trailing clause or a whole sentence was DROPPED rather than
 * reworded, so the surviving words remain the approved words.
 *
 * ANTI-DUPLICATION. Home summarises and links; it never restates. The long-form
 * privacy explanation lives on /privacy/ and the full enrollment journey lives
 * on /how-it-works/. Card bodies are kept to one short line partly for the
 * "fast, scannable, low-text" ruling and partly so Home cannot collide with
 * those two pages in build.mjs's cross-route duplicate-sentence gate.
 *
 * DEF-1 IS RESOLVED HERE. The approved v0.2 documents embedded internal
 * implementation directives inside body copy ("Production AI must not be
 * advertised until formally activated...", "Do not show App Store badges...",
 * "...is not an active public feature until runtime evidence confirms..."). No
 * such sentence appears in this table. The owner-approved public replacements
 * are used instead:
 *   AI          -> home.faq.items[3].a          (CLM-057)
 *   YouTube     -> home.faq.items[4].a          (CLM-058)
 *   iPhone/iPad -> home.availability.items[2].b (CLM-026)
 * None of them asserts the capability exists, and none exposes a claim id, a
 * review workflow or the words "claim register" to a parent.
 *
 * CLAIM DISCIPLINE.
 *   - home.protects.items carry CLM-028..CLM-035, all REQUIRES_PLATFORM_SUPPORT,
 *     so each renders the registered "Requires platform support" label.
 *   - home.different.items carry NO claimId. Their claims (CLM-003, CLM-005..007,
 *     CLM-008, CLM-015, CLM-040) are EXTERNAL_SECURITY_REVIEW or values-level, so
 *     they must render no pill and stay in design language ("is designed to").
 *     E2EE production status is not asserted anywhere on this page.
 *   - home.availability.items[1]/[2] carry CLM-024/CLM-026 (COMING_LATER). No
 *     store name, badge, link or download action appears anywhere on Home.
 *   - home.affordability.* is the CLM-040 VALUES claim only, rendered as prose
 *     with NO status pill: an "Available" badge beside an affordability
 *     statement would read as a pricing promise. No price, no plan, no
 *     free-tier statement of any kind.
 *
 * FILE OWNERSHIP: exactly one writer owns this file. Do NOT edit
 * src/content/index.mjs, routes.mjs, claims.mjs, videos.mjs, global.*.mjs,
 * build.mjs or any shared component from here.
 */

export default {
  "home.seo.title": "PCA — Protecting Children in Digital Spaces",
  "home.seo.description": "PCA helps families create safer digital spaces for children with practical protection, privacy-minimizing design and clear parental control.",

  // --- A. Hero ------------------------------------------------------------
  "home.hero.title": "Protecting children in digital spaces.",
  "home.hero.body": "Children deserve care and protection wherever they spend time—including online.",
  "home.hero.reassure": "PCA is designed not to build a readable central profile of your child's sensitive activity.",

  // --- C. Why PCA exists --------------------------------------------------
  "home.why.label": "Why PCA exists",
  "home.why.title": "Built from a parent's concern",
  "home.why.body": [
    "PCA began with a simple question: if we work hard to protect children at home, at school and in public spaces, why should their digital spaces be treated differently?",
    "We believe families should have useful tools for digital protection without needing to trade away a child’s privacy."
  ],

  // --- D. What PCA protects ----------------------------------------------
  "home.protects.label": "What PCA protects",
  "home.protects.title": "Practical protection families can understand",
  "home.protects.items": [
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

  // --- E. Why PCA is different (prose cards, no claimId, no pill) ---------
  "home.different.label": "Why PCA is different",
  "home.different.title": "Technology should protect without taking away dignity",
  "home.different.items": [
    {
      "title": "No readable central child profile",
      "body": "Protection does not require a readable central copy."
    },
    {
      "title": "No child photos, videos, files or messages",
      "body": "Routine protection does not need them."
    },
    {
      "title": "Local-first protection",
      "body": "Sensitive information is designed to stay family-side."
    },
    {
      "title": "Affordable, broad access",
      "body": "Affordability and broad access shape the design."
    }
  ],

  // --- F. How it works summary (the journey itself lives on /how-it-works/) -
  "home.steps.label": "How it works",
  "home.steps.title": "Five simple steps",
  "home.steps.items": [
    {
      "title": "Create your parent account",
      "body": "Set up access to PCA Parent."
    },
    {
      "title": "Add your child in PCA Parent",
      "body": "Child setup belongs inside the protected Parent experience."
    },
    {
      "claimId": "CLM-024",
      "title": "Install PCA Child on a supported device",
      "body": "Android is the planned primary platform."
    },
    {
      "title": "Connect the device and choose protections",
      "body": "Set the rules and schedules appropriate for your family."
    },
    {
      "title": "Review protection status",
      "body": "Check protection status and respond to supported requests."
    }
  ],

  // --- G. Access / availability (no store name, badge, link or download) --
  "home.availability.label": "Availability",
  "home.availability.title": "PCA Parent and PCA Child",
  "home.availability.items": [
    {
      "title": "PCA Parent",
      "body": "A responsive experience for phone, tablet and computer."
    },
    {
      "claimId": "CLM-024",
      "title": "PCA Child on Android",
      "body": "The planned primary platform for the first release."
    },
    {
      "claimId": "CLM-026",
      "title": "PCA Child on iPhone and iPad",
      "body": "iPhone and iPad child protection is planned for a later release."
    }
  ],

  // --- H. Affordability — CLM-040 VALUES statement only, no pill ----------
  "home.affordability.label": "Access",
  "home.affordability.title": "A safer digital world should not depend on income",
  "home.affordability.body": "PCA is being designed with affordability and broad access in mind.",

  // --- I. FAQ -------------------------------------------------------------
  "home.faq.label": "Common questions",
  "home.faq.title": "Quick answers",
  "home.faq.items": [
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
  ],

  // --- J. Final CTA -------------------------------------------------------
  "home.final.title": "Start building safer digital habits with your family",
  "home.final.body": "Understand the tools, choose the protections that fit your family, and stay in control of sensitive information."
};
