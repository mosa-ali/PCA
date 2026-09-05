/**
 * PUBLIC-2r2 — PRIVACY & SAFETY, the consolidated trust page (English).
 *
 * OWNER IA RULING 2026-09-05: three public pages. This one absorbs the former
 * /privacy, /security and /child-safety pages. Every string below is SELECTED
 * from copy already transcribed from
 * docs/public/PCA_Public_Programme_Documentation_Package_v0.2/
 * PCA_PUBLIC_CONTENT_EN.md into privacy.en.mjs, security.en.mjs,
 * childSafety.en.mjs, features.en.mjs, faq.en.mjs and privacyPolicy.en.mjs.
 * Nothing here is re-transcribed from the source document and no marketing
 * prose is invented. Where a passage had to be shortened, a WHOLE SENTENCE was
 * dropped rather than a sentence rewritten.
 *
 * WHAT WAS ABSORBED, AND FROM WHERE
 *   privacy.where.items[0..2]      privacy.local/sync/central (this page, v1)
 *   privacy.notStored.*            privacy.notStored (this page, v1)
 *   privacy.honesty.*              privacy.honesty (this page, v1)
 *   privacy.topics.items[0..3]     faq.items answers on files, messages,
 *                                  app usage and browsing
 *   privacy.topics.items[4]        features.location
 *   privacy.principles.*           childSafety.hero + childSafety.principles
 *   privacy.faq.items[0]           faq.items[0]
 *   privacy.faq.items[2].a         security.concerns.body
 *   privacy.advanced.items[0..1]   security.realms, security.surveillance
 *
 * DEF-1 RESOLUTION — internal implementation directives removed from body copy:
 *   - features.location.body ended "Availability remains evidence-gated."
 *     DROPPED. The gating is now carried by the CLM-036 status label, which the
 *     register renders as "Requires platform support".
 *   - features.camera.body was "...is not an active public feature until runtime
 *     evidence confirms on-device ephemeral processing with no retained/uploaded
 *     frames." DROPPED. privacy.topics.items[5].body states plainly that the
 *     feature is planned for a later release and that, if it ships, frames are
 *     designed to be processed on the device; the CLM-037 label says
 *     "Coming later".
 *   - faq "Does PCA use AI?" answered with the review-workflow directive.
 *     DROPPED. privacy.faq.items[1].a carries the owner-approved replacement
 *     (CLM-057): AI-supported features are planned for a later release.
 * No claim id, security-review workflow, activation instruction or the phrase
 * "claim register" appears in any string in this table.
 *
 * CLAIM DISCIPLINE. A claimId is attached ONLY where a visible status label is
 * wanted, and only where the register permits one:
 *   CLM-015 LIMITED                   -> "Limited"    on local processing
 *   CLM-036 REQUIRES_PLATFORM_SUPPORT -> "Requires platform support" on Location
 *   CLM-037 COMING_LATER              -> "Coming later" on Camera/eye distance
 *   CLM-046 VERIFIED_AVAILABLE        -> "Available"  on realm separation, and
 *           worded as session/authority separation only. PUBLIC-1-C1: never
 *           claim separate hosting or network isolation.
 * Everything else on this page is EXTERNAL_SECURITY_REVIEW or NOT_APPROVED and
 * therefore carries NO claimId and NO pill — design language only: CLM-003,
 * CLM-004, CLM-005, CLM-006, CLM-007, CLM-008, CLM-009, CLM-010, CLM-011,
 * CLM-012, CLM-013, CLM-014, CLM-016, CLM-017, CLM-049, CLM-053. CLM-043
 * (deletion controls) is NOT_APPROVED — PPR1R-D036 records that no
 * account-deletion path exists — so privacy.retention.body promises no deletion
 * control and states that exact behaviour will be documented after verification.
 * "cannot read" / "never sees" / "zero data" appear nowhere.
 *
 * NEW COPY (authored, not transcribed) — connective headings and the three
 * DEF-1 replacements. Each is listed for review:
 *   privacy.seo.title / privacy.seo.description  (adapted: page renamed, and the
 *       old description's "claims that still require runtime proof" is internal)
 *   privacy.where.title, privacy.topics.title, privacy.retention.title,
 *   privacy.faq.title, privacy.advanced.title, privacy.advanced.lead
 *       — grouping headings; the v1 pages had one heading per page, and the
 *         consolidated page needs a heading per group.
 *   privacy.topics.items[5].body  — DEF-1 camera replacement.
 *   privacy.faq.items[1].a        — DEF-1 AI replacement (CLM-057 wording).
 *   privacy.faq.items[2].q        — question label for an approved answer.
 *   privacy.retention.body        — CLM-043 pre-proof wording, adapted from the
 *         approved FAQ deletion answer, which ended in the implementer-facing
 *         "must be runtime-verified before a strong deletion promise is
 *         published".
 *
 * FILE OWNERSHIP: exactly one writer owns this file. Do NOT edit
 * src/content/index.mjs, routes.mjs, claims.mjs, build.mjs or any shared
 * component from here -- the coordinator registers pages and owns those.
 */

export default {
  "privacy.seo.title": "PCA Privacy & Safety — Protection Without a Readable Central Child Profile",
  "privacy.seo.description": "Understand PCA's local-first privacy approach, family-side data, minimum central technical records and the child safety principles behind them.",

  // A — the simple promise.
  "privacy.hero.title": "Your child's activity belongs to you, not to us",
  "privacy.hero.body": "PCA is designed to provide protection without building a readable central profile of your child's sensitive activity.",

  // B, C, D — where information lives. Only B carries a status label.
  "privacy.where.title": "Where your child's information lives",
  "privacy.where.items": [
    {
      "claimId": "CLM-015",
      "title": "What PCA processes locally",
      "body": "Some protection functions need information on the child device. PCA's approach is to process that information locally wherever possible."
    },
    {
      "title": "What may synchronize between trusted family devices",
      "body": "When sensitive protection information needs to move between trusted parent and child endpoints, PCA is designed to use end-to-end encrypted delivery where required. Production scope remains subject to security verification."
    },
    {
      "title": "What PCA central services need",
      "body": "Central services may keep minimum technical records for parent accounts/authentication, opaque device/child identifiers, enrollment, entitlement/licensing, encrypted delivery, delivery state, timestamps and minimum operational/security metadata."
    }
  ],

  // E — the exclusion list.
  "privacy.notStored.title": "What PCA must not store centrally as readable child content",
  "privacy.notStored.items": [
    "photos and videos;",
    "arbitrary files/documents;",
    "messages;",
    "readable app-usage history;",
    "readable browsing history;",
    "readable precise-location history;",
    "microphone recordings;",
    "screenshots/background screen recordings;",
    "passwords or credentials."
  ],

  // Why the absolute slogan is refused.
  "privacy.honesty.title": "Why we avoid absolute privacy slogans",
  "privacy.honesty.body": "An online account service needs some technical and account information to operate. A slogan promising otherwise would hide that reality. The meaningful privacy promise is that PCA must not turn sensitive child activity into a readable central database.",

  // F, G, H, I, J — one short answer per sensitive topic.
  "privacy.topics.title": "What this means, topic by topic",
  "privacy.topics.items": [
    {
      "title": "Photos, videos and files",
      "body": "PCA does not need routine access to a child's photo library, videos or arbitrary files. These must not be collected into a readable central PCA database."
    },
    {
      "title": "Messages",
      "body": "No routine PCA protection feature is designed to capture or centrally read personal messages."
    },
    {
      "title": "App use and screen time",
      "body": "Readable app-usage history must not become centrally readable PCA data. App use may be processed locally where needed for protection."
    },
    {
      "title": "Browsing protection",
      "body": "PCA's privacy rule is that readable browsing history must not be stored centrally. Web-safety functions may still need local processing to make protection decisions."
    },
    {
      "claimId": "CLM-036",
      "title": "Location",
      "body": "Location is sensitive. Any approved location feature must be parent-controlled and designed so readable precise-location history does not become central PCA data."
    },
    {
      "claimId": "CLM-037",
      "title": "Camera and eye distance",
      "body": "Eye-distance protection using the camera is planned for a later release. It is not an active feature today, and how any future version would handle camera frames will be described here once it has been verified."
    }
  ],

  // K — retention and deletion. CLM-043 is NOT_APPROVED: no deletion control is
  // promised here, and no pill is rendered.
  "privacy.retention.title": "Keeping and deleting information",
  "privacy.retention.body": [
    "Parent control over account and protection information is part of PCA's design intent, but the controls are not built yet.",
    "Central information should be kept only as long as it is needed to run the service, keep it secure and meet legal obligations. Exact deletion and retention behaviour will be documented once it has been verified."
  ],

  // L — the child safety principles.
  "privacy.principles.title": "Protect children. Respect childhood.",
  "privacy.principles.lead": "Digital protection should help families reduce risk without teaching children that constant surveillance is normal.",
  "privacy.principles.items": [
    {
      "title": "Protection without surveillance",
      "body": "Use the minimum information needed for useful protection."
    },
    {
      "title": "Privacy by design",
      "body": "Keep sensitive child activity within trusted family-side systems wherever possible."
    },
    {
      "title": "Transparency",
      "body": "Parents should understand what a feature does and what information it needs."
    },
    {
      "title": "Child dignity",
      "body": "Protection should not humiliate children or treat them as suspects."
    },
    {
      "title": "Age-appropriate protection",
      "body": "Different ages and family situations need different boundaries."
    },
    {
      "title": "Parent responsibility",
      "body": "PCA supports parents; it does not replace communication, judgment or care."
    },
    {
      "title": "No hidden monitoring",
      "body": "PCA should not depend on covert message capture, password capture, hidden screen recording or background gallery collection."
    },
    {
      "title": "Accessible safety",
      "body": "Meaningful protection should be designed for broad family access."
    },
    {
      "title": "No false capability claims",
      "body": "Trust requires honesty about what is available, limited or coming later."
    }
  ],

  // M — the few questions parents ask most about privacy.
  "privacy.faq.title": "Common privacy questions",
  "privacy.faq.items": [
    {
      "q": "Does PCA collect my child's data?",
      "a": "PCA needs to process some information to provide protection. The design goal is to keep sensitive activity on trusted family-side devices or synchronize it end-to-end encrypted where required, instead of creating a readable central PCA profile. Central services still need minimum account and technical data to operate."
    },
    {
      "q": "How do I report a privacy or security concern?",
      "a": "If you believe you have found a security issue, please hold it until PCA publishes its reporting channels — see Contact. Do not include child-sensitive content unless the support team explicitly and safely requests specific information."
    }
  ],

  // Clearly-marked advanced section — the only place technical vocabulary is
  // used. CLM-046 renders "Available"; CLM-049 renders nothing.
  "privacy.advanced.title": "More technical detail",
  "privacy.advanced.lead": "This part is for parents who want the technical picture. You do not need it to use PCA.",
  "privacy.advanced.items": [
    {
      "claimId": "CLM-046",
      "title": "Separate Parent and Platform Admin authority",
      "body": "PCA Parent and PCA Platform Admin are separate security/session/RBAC realms. An internal operator interface must not become a shortcut into a parent's protected experience."
    },
    {
      "title": "No hidden surveillance controls",
      "body": "PCA is not designed around password capture, message capture, covert TLS interception, background gallery scanning or hidden screen recording."
    }
  ],

  "privacy.cta.policy": "Read the Detailed Privacy Policy"
};
