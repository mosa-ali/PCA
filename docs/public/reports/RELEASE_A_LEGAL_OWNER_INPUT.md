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

1. **Receipt.** Forwarding has not yet been proven to deliver mail sent from an
   external domain. Until it is, publishing an address as the channel for legal or
   data-subject requests asserts a capability that has not been demonstrated.
2. **Reply identity.** Forwarding is not send-as. If a reply to a privacy request
   leaves from the owner's private personal mailbox, the requester learns a private
   address, and the reply does not come from the published controller contact. See
   `RELEASE_A_CONTACT_CHANNEL_VERIFICATION.md`.

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

```
LEGAL_PUBLICATION_STATUS             = NOT_AUTHORIZED
PRIVACY_POLICY_PUBLICATION_READINESS = NOT_READY
TERMS_PUBLICATION_READINESS          = NOT_READY
OD_13                                = UNRESOLVED
PPR1R-D035                           = OPEN
```
