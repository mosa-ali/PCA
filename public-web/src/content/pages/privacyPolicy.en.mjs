/**
 * PUBLIC-3 — Privacy Policy content (English). PROVISIONAL LEGAL DRAFT.
 *
 * SOURCE OF TRUTH: docs/public/PCA_Public_Programme_Documentation_Package_v0.2/
 * PCA_PUBLIC_CONTENT_EN.md section 15 (lines 663-701). Transcribed, never
 * rewritten.
 *
 * BLOCK-3: PPR1R-D035 (no privacy policy artifact) and OD-13 (legal entity /
 * jurisdiction) are both OPEN, so this page is a reviewable draft only. The
 * renderer prints the global `legal.provisionalNotice` banner above the page
 * title and routes.mjs keeps the route non-indexable.
 *
 * NOT TRANSCRIBED (instructions to the implementer, not sentences for a
 * reader — see the writer brief):
 *   - the "**Publication warning:** ..." blockquote (line 668);
 *   - "Exact fields must be confirmed from production runtime." (line 674);
 *   - "Feature-specific disclosures must match deployed behavior." (line 683).
 * No legal entity name, jurisdiction, address or company number is invented
 * here; where the document carries only the ledger token
 * "OWNER_APPROVAL_PENDING — OD-13" (line 701) the page states plainly that the
 * detail is pending owner approval. That one string is NEW COPY.
 *
 * FILE OWNERSHIP: exactly one writer owns this file. Do NOT edit
 * src/content/index.mjs, routes.mjs, claims.mjs, build.mjs or any shared
 * component from here -- the coordinator registers pages and owns those.
 */

export default {
  "privacyPolicy.seo.title": "PCA Privacy Policy",
  "privacyPolicy.seo.description": "Detailed information about how PCA processes account, technical and child-protection information. Final legal text requires runtime and legal review.",
  "privacyPolicy.hero.title": "Privacy Policy",
  "privacyPolicy.summary.title": "Summary",
  "privacyPolicy.summary.body": "PCA is designed to minimize centrally readable child information. Some protection functions process information locally on trusted devices. Sensitive synchronization, where required, is designed for end-to-end encrypted delivery. Central services keep minimum account and technical data needed to operate the service.",
  "privacyPolicy.account.title": "Information we need for the parent account",
  "privacyPolicy.account.body": "PCA may process parent email, authentication records and other minimum information required for account access, security and service administration.",
  "privacyPolicy.childDevice.title": "Child/device information",
  "privacyPolicy.childDevice.body": "PCA may use opaque child/device identifiers and enrollment state centrally. Sensitive child protection information should remain family-side or encrypted in transit/relay according to the approved architecture.",
  "privacyPolicy.notCollected.title": "Information not intended for readable central collection",
  "privacyPolicy.notCollected.body": "PCA central systems must not store readable child photos, videos, arbitrary files, messages, app-usage history, browsing history, precise-location history, microphone recordings, screenshots/background recordings, passwords or credentials.",
  "privacyPolicy.processing.title": "Protection processing",
  "privacyPolicy.processing.body": "Protection features may process relevant information locally on the child or trusted parent device.",
  "privacyPolicy.retention.title": "Retention",
  "privacyPolicy.retention.body": "Specific periods are pending runtime/legal review. Central information should be retained only as long as needed for service, security, legal or approved support purposes.",
  "privacyPolicy.deletion.title": "Deletion",
  "privacyPolicy.deletion.body": "Exact account/child deletion behavior is pending runtime verification and must account for primary stores, delivery queues, backups and legal/security retention.",
  "privacyPolicy.feedback.title": "Feedback/support",
  "privacyPolicy.feedback.body": "Feedback should include only information intentionally provided by the parent and approved minimal case metadata. Sensitive child activity is not automatically attached.",
  "privacyPolicy.providers.title": "Providers/subprocessors",
  "privacyPolicy.providers.body": "Final provider list is pending deployment/runtime inventory.",
  "privacyPolicy.cookies.title": "Cookies/analytics",
  "privacyPolicy.cookies.body": "Final disclosure is pending runtime inspection. PCA's recommended posture is to minimize tracking and avoid advertising/session-replay technologies on sensitive authenticated surfaces.",
  "privacyPolicy.contact.title": "Contact",
  "privacyPolicy.contact.body": "Final privacy contact and legal entity details are pending owner approval."
};
