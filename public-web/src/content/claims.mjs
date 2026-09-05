/**
 * PUBLIC-3 claim gate — the runtime half of the claim-regression mechanism
 * required by PCA_PUBLIC_IMPLEMENTATION_PROGRAMME.md section 7.
 *
 * This mirrors PCA_PUBLIC_CLAIM_REGISTER.csv v0.2 (53 claims) for every claim
 * a rendered page actually asserts. build.mjs FAILS if a page attaches a
 * status label stronger than the register permits, or references a claim id
 * that is not registered here.
 *
 * The point is that a writer cannot quietly upgrade a feature from "Requires
 * platform support" to "Available" -- the build stops. PUBLIC-0 recorded that
 * this repository has repeatedly shipped gates that report green while
 * asserting nothing; this one is executed on every build.
 *
 * KEEPING THIS IN SYNC IS ENFORCED, NOT REQUESTED. The register CSV remains
 * authoritative, and assertClaimsMatchRegister() in build.mjs parses
 * PCA_PUBLIC_CLAIM_REGISTER.csv on every build and fails if any status here
 * disagrees with it.
 *
 * That gate exists because the label check alone is tautological: statusPill()
 * and assertClaimLabels() both read this table, so flipping a status here
 * changes the rendered label AND the expectation together and nothing catches
 * it. Only the CSV is an independent source of truth.
 */

/** Register statuses, ordered weakest -> strongest public assertion. */
export const STATUS = {
  NOT_APPROVED: 'NOT_APPROVED_FOR_PUBLIC_CLAIM',
  EXTERNAL_SECURITY_REVIEW: 'EXTERNAL_SECURITY_REVIEW',
  COMING_LATER: 'COMING_LATER',
  REQUIRES_PLATFORM_SUPPORT: 'REQUIRES_PLATFORM_SUPPORT',
  LIMITED: 'LIMITED',
  VERIFIED_AVAILABLE: 'VERIFIED_AVAILABLE',
};

/** Which visible status label each register status is allowed to render. */
export const STATUS_LABEL_KEY = {
  [STATUS.VERIFIED_AVAILABLE]: 'status.available',
  [STATUS.LIMITED]: 'status.limited',
  [STATUS.REQUIRES_PLATFORM_SUPPORT]: 'status.platform',
  [STATUS.COMING_LATER]: 'status.later',
  // A claim under external security review or not approved never renders a
  // status pill at all -- it either uses the design-language wording from
  // PCA_PUBLIC_PRIVACY_MESSAGING.md, or it does not appear.
  [STATUS.EXTERNAL_SECURITY_REVIEW]: null,
  [STATUS.NOT_APPROVED]: null,
};

export const STATUS_CSS = {
  'status.available': 'pw-status--available',
  'status.limited': 'pw-status--limited',
  'status.platform': 'pw-status--platform',
  'status.later': 'pw-status--later',
};

/**
 * Claims this site may reference, with their v0.2 register status.
 * Reconciled against PUBLIC_1_CLAIM_RECONCILIATION.md.
 */
export const CLAIMS = {
  // Doctrine / values — publishable in Release A
  'CLM-001': { status: STATUS.VERIFIED_AVAILABLE, note: 'Master tagline, OD-01.' },
  'CLM-002': { status: STATUS.VERIFIED_AVAILABLE, note: 'Parent-origin story, OD-04. No founder biography.' },
  /**
   * BLOCK-1 IS CLOSED. PPR-2 Part M is published (pca-dev 74e5ad5) and PPR-2 is
   * closed, so "Part M has not landed" is no longer a blocker on this page.
   *
   * The STATUS is unchanged, because Part M does not support a broader claim:
   * it rules only that basic V1 child-device enrollment needs no paid license,
   * and says in terms that this "is not a statement that every future PCA
   * feature is free". CLM-041 (permanent free plan) and CLM-042 (pricing
   * finalized) therefore remain NOT_APPROVED_FOR_PUBLIC_CLAIM on the evidence,
   * not on the blocker. /access content stays values-level -- which is what the
   * approved copy says regardless. See CLM-056 for what Part M does support.
   */
  'CLM-040': { status: STATUS.VERIFIED_AVAILABLE, note: 'Affordability VALUES claim only. No plan, price or free-tier statement.' },

  // Privacy — design language only, all pending external security review
  'CLM-003': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'No readable central child profile.' },
  'CLM-004': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: "Your child's activity belongs to you." },
  'CLM-008': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'Messages not centrally read.' },
  'CLM-010': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'No readable central browsing history.' },
  'CLM-015': { status: STATUS.LIMITED, note: 'Local processing. Must not imply every feature is implemented.' },
  'CLM-016': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'E2EE synchronization — design language until crypto proof.' },
  'CLM-017': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'Minimum central technical data. See PUBLIC-1-C4: do not describe parent identity as unrecoverable.' },
  'CLM-053': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'CRITICAL. Relay must not receive readable payload content.' },

  // Features — all require platform support
  'CLM-028': { status: STATUS.REQUIRES_PLATFORM_SUPPORT, note: 'Screen time.' },
  'CLM-029': { status: STATUS.REQUIRES_PLATFORM_SUPPORT, note: 'App controls. No universal blocking claim.' },
  'CLM-030': { status: STATUS.REQUIRES_PLATFORM_SUPPORT, note: 'Web filtering.' },
  'CLM-031': { status: STATUS.REQUIRES_PLATFORM_SUPPORT, note: 'Schedules.' },
  'CLM-032': { status: STATUS.REQUIRES_PLATFORM_SUPPORT, note: 'Protection status.' },
  'CLM-033': { status: STATUS.REQUIRES_PLATFORM_SUPPORT, note: 'Parent/child requests.' },
  'CLM-034': { status: STATUS.REQUIRES_PLATFORM_SUPPORT, note: 'Protection alerts.' },
  'CLM-035': { status: STATUS.REQUIRES_PLATFORM_SUPPORT, note: 'Device protection integrity.' },

  // Parent / PWA
  'CLM-018': { status: STATUS.VERIFIED_AVAILABLE, note: 'PUBLIC-1-C2: describe the experience; do not imply it is reachable today. app.pcasafe.com serves a placeholder.' },
  'CLM-019': { status: STATUS.COMING_LATER, note: 'PWA installability — Release C.' },
  'CLM-020': { status: STATUS.COMING_LATER, note: 'Installation optional.' },
  'CLM-021': { status: STATUS.VERIFIED_AVAILABLE, note: 'Browser use without installing.' },
  'CLM-022': { status: STATUS.VERIFIED_AVAILABLE, note: 'PWA install is NOT Trusted Browser authorization. Confirmed structurally in PUBLIC-0.' },

  // Child platforms
  'CLM-024': { status: STATUS.COMING_LATER, note: 'Android planned primary. NO store badge, NO download action.' },
  'CLM-026': { status: STATUS.COMING_LATER, note: 'iOS later/gated.' },

  // Security
  'CLM-046': { status: STATUS.VERIFIED_AVAILABLE, note: 'Parent/Admin realm separation. Confirmed in PUBLIC-0. PUBLIC-1-C1: do not claim separate hosting or network isolation.' },
  'CLM-049': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'No hidden surveillance model.' },

  // Privacy invariants surfaced by the consolidated Privacy & Safety page.
  // All EXTERNAL_SECURITY_REVIEW: prose in design language, never a status pill.
  'CLM-005': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'No readable central child photos. Invariant CHILD_PHOTOS_CENTRAL=0.' },
  'CLM-006': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'No readable central child videos.' },
  'CLM-007': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'No readable central arbitrary child files.' },
  'CLM-009': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'No readable central app-usage history.' },
  'CLM-011': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'No readable central precise-location history.' },
  'CLM-012': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'No child passwords or credentials collected.' },
  'CLM-013': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'No microphone recordings for routine protection.' },
  'CLM-014': { status: STATUS.EXTERNAL_SECURITY_REVIEW, note: 'No automatic screenshots or background screen recording.' },

  // Sensitive feature-gated capabilities
  'CLM-036': { status: STATUS.REQUIRES_PLATFORM_SUPPORT, note: 'Parent-controlled location feature. RISK=CRITICAL. Availability evidence-gated; no continuous tracking or geofencing claim.' },
  'CLM-037': { status: STATUS.COMING_LATER, note: 'Camera/proximity. RISK=CRITICAL. Not an active public feature; publish the on-device-ephemeral wording only after runtime proof.' },
  /**
   * REQUIRES_PLATFORM_SUPPORT, matching the authoritative register.
   *
   * PUBLIC-1 PROPOSED downgrading this to NOT_APPROVED_FOR_PUBLIC_CLAIM,
   * because PPR1R-D036 ("No account-deletion path exists") is an OPEN V1
   * blocker. That proposal was never approved, and this table had applied it
   * anyway -- caught by assertClaimsMatchRegister() on its first run. Applying
   * an unapproved downgrade is still drift, even in the safe direction.
   *
   * Aligned back to the CSV. Nothing rendered changes: no page attaches
   * CLM-043, so no status pill exists for it, and the retention copy on
   * /privacy/ already promises no deletion control and uses the approved
   * pre-proof wording. See PROPOSED_STATUS_CHANGES below.
   */
  'CLM-043': { status: STATUS.REQUIRES_PLATFORM_SUPPORT, note: 'Account/information deletion controls. Not attached to any page; /privacy/ promises no deletion control. See PROPOSED_STATUS_CHANGES.' },

  // Bilingual / accessibility
  'CLM-050': { status: STATUS.COMING_LATER, note: 'EN/AR from first release. Gate: native Arabic sign-off (OD-12).' },
  'CLM-051': { status: STATUS.COMING_LATER, note: 'RTL support. Gate: real-browser RTL UAT across required viewports.' },
  'CLM-054': { status: STATUS.NOT_APPROVED, note: 'Proposed. Accessibility conformance — unverified until real-browser evidence exists. Owner ruling: keep unverified.' },
  'CLM-055': { status: STATUS.REQUIRES_PLATFORM_SUPPORT, note: 'Proposed. No analytics/trackers. Provable once Release A is built and inspected.' },

  // --- Proposed by PUBLIC-2r2, pending owner claim-register approval -------

  /**
   * PPR-2 Part M (published, pca-dev 74e5ad5) rules that basic/free V1
   * child-device enrollment must not require an active paid license row:
   * CREATE_INVITATION.requiresLicense = false, proven end to end against real
   * MySQL on a genuinely fresh family (M3: 2184/2184 non-DB, focused
   * authz/invitation/slot suite 89/89).
   *
   * Part M scopes itself explicitly and narrowly: "this is not a statement that
   * every future PCA feature is free, only that the BASIC V1 protection tier
   * must let a parent enroll a child device before any paid/premium entitlement
   * exists." So it supports THIS claim and does NOT support CLM-041.
   *
   * LIMITED, not VERIFIED_AVAILABLE: the behaviour is proven in the codebase,
   * but no parent can reach it yet -- Release B is blocked with no email
   * provider, so account creation itself does not complete. Not used in any
   * Release A copy until the owner approves exact wording.
   */
  'CLM-056': {
    status: STATUS.LIMITED,
    note: 'PROPOSED. "Basic child-device enrollment does not require a paid license." Evidence: PPR-2 Part M + M3 test results. Not rendered in Release A pending owner approval of exact wording.',
  },

  /**
   * DEF-1 resolution. The approved v0.2 content document supplied internal
   * implementation directives as public body copy -- e.g. "Production AI must
   * not be advertised until formally activated, security/privacy reviewed and
   * included in the claim register as verified." The owner ruled that such
   * directives must never be parent-facing and approved short status language
   * instead. These two claims register that replacement language.
   *
   * Neither asserts the capability exists. CLM-038 (production AI enabled) and
   * CLM-039 (YouTube Mode B production-ready) remain NOT_APPROVED and are in
   * FORBIDDEN_CLAIMS below -- these are the COMING_LATER counterparts.
   */
  'CLM-057': { status: STATUS.COMING_LATER, note: 'DEF-1. "AI-supported features are planned for a later release." Replaces the leaked directive. Does not assert AI is active.' },
  'CLM-058': { status: STATUS.COMING_LATER, note: 'DEF-1. "Advanced YouTube protection is planned for a later release." Replaces the leaked directive. Does not assert Mode B readiness.' },

  /**
   * The two public videos. COMING_LATER is the honest status while
   * VIDEOS[].available is false: the scripts, storyboards and transcripts are
   * authored and rendered as text, but no recording exists. The placeholder
   * card carries this label so a parent is told plainly that the video is not
   * yet available, rather than meeting a player that does nothing.
   *
   * Flip to VERIFIED_AVAILABLE only when both recordings and their caption
   * files ship. assertVideoAssets() in build.mjs blocks available:true without
   * the files, so this status and the rendered state cannot drift apart.
   */
  'CLM-059': { status: STATUS.COMING_LATER, note: 'Public introduction/enrollment videos. Scripts and transcripts exist; recordings do not.' },
};

/**
 * Claims that must NEVER be asserted. build.mjs scans rendered output for the
 * forbidden phrase patterns associated with each of these.
 */
export const FORBIDDEN_CLAIMS = [
  'CLM-025', // Google Play availability
  'CLM-027', // App Store availability
  'CLM-038', // production AI enabled
  'CLM-039', // YouTube Mode B production-ready
  'CLM-041', // permanent free plan
  'CLM-042', // pricing finalized
  'CLM-044', // Delete Now immediate/irreversible
  'CLM-045', // Parent MFA
  'CLM-048', // V1 screenshot attachment
  'CLM-052', // unhackable / 100% secure / 100% private
];


/**
 * Claims this implementation has PROPOSED but which are not yet rows in the
 * authoritative PCA_PUBLIC_CLAIM_REGISTER.csv.
 *
 * assertClaimsMatchRegister() in build.mjs enforces both directions: a claim
 * listed here must NOT be in the CSV, and a claim NOT listed here MUST be in
 * the CSV with exactly the status recorded above. So when the owner adds one of
 * these rows, the build fails until it is removed from this list -- the two
 * cannot drift apart silently.
 *
 * All are documented in docs/public/PCA_PUBLIC_CONTENT_CORRECTIONS_v0.2.1.md.
 */
/**
 * Status changes this programme has PROPOSED for existing register rows, and
 * which the owner has NOT approved. They are recorded, not applied: CLAIMS
 * above mirrors the CSV exactly, and assertClaimsMatchRegister() enforces that.
 *
 * A proposal is honoured through CONTENT restraint rather than by editing the
 * register -- the pages simply do not make the claim.
 */
export const PROPOSED_STATUS_CHANGES = [
  {
    claimId: 'CLM-043',
    registerStatus: 'REQUIRES_PLATFORM_SUPPORT',
    proposedStatus: 'NOT_APPROVED_FOR_PUBLIC_CLAIM',
    reason:
      'PPR1R-D036 records that no account-deletion path exists, and it is an OPEN V1 blocker. ' +
      'Until it closes, no Release A page should state that PCA provides deletion controls. ' +
      'Honoured in content: /privacy/ uses the approved pre-proof wording and attaches no claimId.',
  },
];

export const PROPOSED_CLAIMS = new Set([
  'CLM-054', // accessibility conformance — NOT_APPROVED per owner ruling
  'CLM-055', // no analytics/trackers
  'CLM-056', // basic enrollment needs no paid license (PPR-2 Part M)
  'CLM-057', // AI planned for a later release (DEF-1)
  'CLM-058', // advanced YouTube protection planned for a later release (DEF-1)
  'CLM-059', // public videos
]);

export function claimStatus(claimId) {
  const claim = CLAIMS[claimId];
  if (!claim) {
    throw new Error(
      `Unregistered claim id "${claimId}". Add it to PCA_PUBLIC_CLAIM_REGISTER.csv first, then mirror it in src/content/claims.mjs.`
    );
  }
  return claim.status;
}

/** The status label key a claim may render, or null if it may render none. */
export function labelKeyForClaim(claimId) {
  return STATUS_LABEL_KEY[claimStatus(claimId)];
}
