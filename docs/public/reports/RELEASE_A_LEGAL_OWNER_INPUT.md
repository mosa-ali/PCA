# Release A — Legal Owner Input Required

**Status: `LEGAL_PUBLICATION_STATUS = NOT_AUTHORIZED`**

This is a request for facts only the owner can supply. Nothing on this page has been
invented, inferred from the repository, or filled in with a plausible default — a
guessed legal operator name on a published privacy policy is a false statement about
who is responsible for children's data, which is the single worst thing this
programme could ship.

Owner Decision **OD-13** (legal identity and jurisdiction) is unresolved, and
`PPR1R-D035` (no privacy policy artifact exists) remains an OPEN V1 blocker.

---

## 1. What is blocked, concretely

`/privacy-policy/` and `/terms/` are built and bilingual, but they are **provisional
drafts**. Today they:

- carry `noindex, nofollow`;
- are excluded from `sitemap.xml` (10 indexable entries, not 14);
- are reachable only from the footer, so nobody arrives at them from a search engine;
- name no legal entity, no jurisdiction, no controller, and no effective date.

They stay that way until the table in §2 is filled in. `/privacy/` (Privacy & Safety)
is a different page — it explains PCA's data behaviour in plain language and is
indexable — but several of its statements become legal commitments the moment a
policy is published behind them, so it is affected too.

---

## 2. Facts required from the owner

Please supply each value exactly as it should appear in public. Leave a row blank
rather than approximating it; a blank row keeps the blocker open, a wrong row ships a
false claim.

| # | Field | Value | Notes |
|---|---|---|---|
| L-1 | `LEGAL_OPERATOR_NAME` | | The name that appears as "operated by". Trading name and registered name if they differ. |
| L-2 | `LEGAL_ENTITY_TYPE` | | e.g. sole establishment, LLC, FZ-LLC, or "individual, not yet incorporated". "Not yet incorporated" is an acceptable answer and changes the wording, but it must be stated, not left to the reader. |
| L-3 | `REGISTRATION_NUMBER` | | Trade licence / company number, if one exists. Omit the line entirely if not. |
| L-4 | `COUNTRY` | | Country of establishment. |
| L-5 | `JURISDICTION` | | Governing law and the courts that hear a dispute. May differ from L-4 (e.g. a free-zone jurisdiction). |
| L-6 | `PUBLIC_LEGAL_CONTACT` | | The address a legal notice may be sent to. See §3 — an alias that only forwards may not be adequate. |
| L-7 | `PRIVACY_CONTACT` | | Data-protection contact. `privacy@pcasafe.com` is configured; delivery is not yet proven. |
| L-8 | `LEGAL_POSTAL_ADDRESS` | | Required in some jurisdictions and by some app stores. Confirm whether a postal address must be published, and whether the owner is willing to publish a residential one if no commercial address exists. |
| L-9 | `DATA_CONTROLLER_WORDING` | | Who is the controller of the child's and the parent's data, in the exact words to publish. If the answer is "the same entity as L-1", say so explicitly. |
| L-10 | `EFFECTIVE_DATE` | | The date the policy takes effect. Not the date it was drafted. |
| L-11 | `PARENT_GUARDIAN_WORDING` | | Whether the published text says "parent", "parent or guardian", or "parent or legal guardian". This is a legal choice about who may consent, not a style preference. |
| L-12 | `CHILD_AGE_BOUNDARY` | | The age below which a child cannot be enrolled without parental consent, and whether it varies by country. Drives both the policy and the enrolment flow. |
| L-13 | `GOVERNING_REGIMES` | | Which regimes the owner intends to comply with (e.g. UAE PDPL, GDPR, COPPA). This decides what the policy must contain, not merely how it is worded. |

---

## 3. A specific caution on the contact fields (L-6, L-7)

`support@`, `privacy@`, `security@` and `admin@pcasafe.com` are configured as
**forwarding aliases** to an owner-monitored mailbox. That is not the same as a
mailbox, and it matters legally in two ways:

1. **Receipt — now proven.** The owner sent real external messages to all four
   addresses and observed each arriving in the monitored Inbox. Inbound delivery is
   no longer an assumption.
2. **Reply identity — still open.** Forwarding is not send-as. Replies currently
   leave from the owner's private mailbox, so a data-subject request answered today
   would disclose a private address and would not come from the published controller
   contact. `PUBLIC_REPLY_IDENTITY = NOT_READY`; the owner is configuring Send As.
   This matters more for L-6 and L-7 than for ordinary support mail: a published
   controller contact that answers from somewhere else is a defect in the policy, not
   just in the mailbox. See `RELEASE_A_CONTACT_CHANNEL_VERIFICATION.md`.

`admin@pcasafe.com` should stay operational and is deliberately **not** proposed as
public copy.

---

## 4. What is *not* blocked on this

To keep the critical path clear: the three main public pages (Home, How PCA Works,
Privacy & Safety) do not depend on OD-13 and are content-complete. The legal blocker
gates `/privacy-policy/`, `/terms/`, and overall publication authorisation — not the
rest of the site's readiness.

---

## 5. How to return this

Fill in the table in §2 and return it. Each supplied value is then:

1. written into the content modules as owner-approved copy;
2. added to the claim register if it constitutes a public claim;
3. translated and added to the Arabic review pack for the independent reviewer
   (legal strings are already flagged `LEGAL_REVIEW_REQUIRED = YES`);
4. re-verified in a real browser in both locales.

Independent legal review of the final drafted text is strongly recommended before
`LEGAL_PUBLICATION_STATUS` moves to `READY`. Producing a policy is drafting; deciding
it is adequate for children's data in a given jurisdiction is a legal judgement, and
not one to take from this programme or from me.

---

## 6. Arabic legal strings waiting on the same decision

The independent native Arabic review returned 18 corrections that were deferred
because they touch legal-sensitive text. They are held, unapplied, behind this same
OD-13 decision — so the legal review should cover the **English** wording and these
Arabic corrections together, rather than settling the English and then discovering
the Arabic says something else.

Thirteen are on the two provisional legal drafts, five are on the Privacy & Safety
page's own privacy assertions:

| Key | Route | Reviewer decision |
|---|---|---|
| `privacy.advanced.items` | /ar/privacy/ | REVISE_MEDIUM |
| `privacy.faq.items` | /ar/privacy/ | REVISE_MEDIUM |
| `privacy.notStored.items` | /ar/privacy/ | REVISE_MEDIUM |
| `privacy.retention.body` | /ar/privacy/ | REVISE_LOW |
| `privacy.where.items` | /ar/privacy/ | REVISE_MEDIUM |
| `privacyPolicy.childDevice.body` | /ar/privacy-policy/ | **REVISE_HIGH** |
| `privacyPolicy.contact.body` | /ar/privacy-policy/ | LEGAL_REVIEW_REQUIRED |
| `privacyPolicy.cookies.body` | /ar/privacy-policy/ | LEGAL_REVIEW_REQUIRED |
| `privacyPolicy.deletion.body` | /ar/privacy-policy/ | LEGAL_REVIEW_REQUIRED |
| `privacyPolicy.feedback.body` | /ar/privacy-policy/ | REVISE_MEDIUM |
| `privacyPolicy.notCollected.body` | /ar/privacy-policy/ | **REVISE_HIGH** |
| `privacyPolicy.processing.body` | /ar/privacy-policy/ | REVISE_LOW |
| `privacyPolicy.providers.body` | /ar/privacy-policy/ | REVISE_LOW |
| `privacyPolicy.seo.description` | /ar/privacy-policy/ | REVISE_MEDIUM |
| `privacyPolicy.summary.body` | /ar/privacy-policy/ | REVISE_MEDIUM |
| `terms.accountSecurity.body` | /ar/terms/ | REVISE_MEDIUM |
| `terms.availability.body` | /ar/terms/ | LEGAL_REVIEW_REQUIRED |
| `terms.using.body` | /ar/terms/ | LEGAL_REVIEW_REQUIRED |

**The two REVISE_HIGH rows are the ones to look at first.** `privacyPolicy.notCollected.body`
lists the data types but omits the English's core condition — that PCA central systems
must not store them **in readable form** — and `privacyPolicy.childDevice.body` turned
the English "should remain" into the stronger «يجب أن تبقى» (*must* remain) while
dropping the transit/relay encryption context. Both are on a `noindex` page that is
blocked from publication anyway, which is why they were not treated as urgent, but
both will need fixing before that page can ship.

Full text of every proposal is in `RELEASE_A_ARABIC_OWNER_SIGNOFF.csv`, keyed by the
same `KEY` column.

Two directly related corrections on `/ar/privacy/` were **released by owner ruling and
applied**, because they were accuracy defects rather than legal wording: the Arabic had
dropped the "readable" qualifier from central app-usage data, and had rendered
"protection without surveillance" as "without *excessive* surveillance". See
`RELEASE_A_ARABIC_REMEDIATION_REPORT.md`.

---

```
LEGAL_PUBLICATION_STATUS             = NOT_AUTHORIZED
PRIVACY_POLICY_PUBLICATION_READINESS = NOT_READY
TERMS_PUBLICATION_READINESS          = NOT_READY
OD_13                                = UNRESOLVED
PPR1R-D035                           = OPEN
```
