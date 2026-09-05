/**
 * PUBLIC-3 — Contact page content (English).
 *
 * SOURCE OF TRUTH: docs/public/PCA_Public_Programme_Documentation_Package_v0.2/
 * PCA_PUBLIC_CONTENT_EN.md section 13 (`/contact`). Transcribed, never
 * rewritten and never machine-translated at this stage.
 *
 * RELEASE A SUBMITS NO FORMS. The approved document's "Suggested form" block
 * (field list, "Send Message" button, success and error strings) is a
 * specification for a later release, not copy a parent reads today: the CSP
 * sets form-action 'none' and the build fails on any external reference, so no
 * form exists to label. Those strings are therefore deliberately NOT in this
 * table. The categories are rendered as descriptive content only.
 *
 * The approved document names NO contact address, mailbox or channel for this
 * page, and none is invented here. That gap is reported to the coordinator.
 *
 * FILE OWNERSHIP: exactly one writer owns this file. Do NOT edit
 * src/content/index.mjs, routes.mjs, claims.mjs, build.mjs or any shared
 * component from here -- the coordinator registers pages and owns those.
 */

export default {
  "contact.seo.title": "Contact PCA — Channels Opening Before Launch",
  "contact.seo.description": "PCA is not able to receive messages yet. Support, privacy, accessibility and security contact channels will be published before PCA opens to families.",
  "contact.hero.title": "How can we help?",
  "contact.hero.body": "Choose the topic that best matches your question. Please do not include private information about your child unless PCA has specifically requested a safe, necessary detail.",
  "contact.categories.title": "Categories",
  "contact.categories.items": [
    "General inquiry",
    "Technical support",
    "Privacy question",
    "Partnership",
    "Accessibility",
    "Report security concern"
  ],
  "contact.privacyNote.title": "Privacy note",
  "contact.privacyNote.body": "Please do not include child messages, browsing history, precise location, photos, videos or other sensitive child content."
};
