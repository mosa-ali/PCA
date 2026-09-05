# PCA Public — Release A Arabic Review Guide

**For the independent native-Arabic reviewer.**

| | |
|---|---|
| Pack | `docs/public/reports/RELEASE_A_ARABIC_REVIEW_PACK.csv` |
| Owner sign-off template | `docs/public/reports/RELEASE_A_ARABIC_OWNER_SIGNOFF.csv` |
| Generated from | `pca-dev` @ `1fd9bd48ed2b9dfe07ec0768986cd6634dbdf756` + the working tree at generation time |
| Generator | `public-web/scripts/arabic-review-pack.mjs` |
| Rows | 189 (one per Arabic content key) covering 338 individual Arabic strings |
| Status of every row on delivery | `REVIEW_DECISION = PENDING_REVIEW`, `PROPOSED_ARABIC` empty |

---

## 1. What you are reviewing, and what you are not

You are reviewing **the entire Arabic public corpus of the PCA Public website**, before it is
published. Nothing has been deployed: all five `pcasafe.com` hostnames currently serve placeholder
containers, so no member of the public has read one word of this text. Corrections made now cost
nothing.

The pack is generated, not curated. Every Arabic string that the site renders is in it. This matters
because the previous, hand-maintained review list was found to have quietly omitted the `/ar/privacy/`
page heading and lede — the two highest-risk strings on the whole site. The list is now derived from
the content modules, and the generator refuses to write a pack it cannot prove matches the built
artifact byte for byte.

**You are not the final approver.** Owner Decision **OD-12** — native Arabic sign-off — is the
owner's, and is not delegated to this review. Your output is a set of *proposals*. Each one is then
checked against the English source, the claim register and the privacy hedges before anything is
changed. A proposal that reads better but asserts more will be rejected, and that is the system
working, not a slight on the proposal.

---

## 2. How to fill the pack

Edit only these four columns. Leave every other column exactly as delivered.

| Column | What to put in it |
|---|---|
| `REVIEW_DECISION` | one of the values in the table below |
| `PROPOSED_ARABIC` | your replacement text, in the same structure as `CURRENT_ARABIC` (see §3) |
| `REVIEWER_NOTE` | why. One or two sentences is enough, in English or Arabic |
| `LEGAL_REVIEW_REQUIRED` | change `NO` to `YES` if you think a string carries legal weight the generator did not detect |

### `REVIEW_DECISION` values

| Value | Meaning |
|---|---|
| `PASS` | natural, accurate, and asserts exactly what the English asserts |
| `REVISE_LOW` | wording could be better; meaning is not at risk |
| `REVISE_MEDIUM` | awkward, unidiomatic, or inconsistent with terminology used elsewhere |
| `REVISE_HIGH` | the Arabic **misstates** something: a capability, a limit, a privacy guarantee, a legal term |
| `OWNER_DECISION_REQUIRED` | a judgement call about product voice or product truth, not language |
| `LEGAL_REVIEW_REQUIRED` | wording with legal consequence that a lawyer should settle |

`REVISE_HIGH`, `OWNER_DECISION_REQUIRED` and `LEGAL_REVIEW_REQUIRED` are the ones that block
publication. Please use them freely — an over-flagged row costs a conversation, an under-flagged row
ships a false claim to parents.

---

## 3. Reading a row

`ENGLISH_SOURCE` and `CURRENT_ARABIC` are the *same* content in two languages, always in the same
shape. Where a key holds a list, both cells use the same numbering, so `[2]` in the Arabic cell is
`[2]` in the English cell:

```
[1] title: وقت الشاشة
[1] body: المساعدة في وضع حدود وروتين أكثر توازنًا لاستخدام الأجهزة.
[2] title: ...
```

Keep that structure in `PROPOSED_ARABIC`. If you want to change only sub-item 2's body, still return
the whole cell with the other items unchanged, so the mapping is unambiguous.

`ROUTE` is the Arabic URL where the string appears — open the page and read the string **in place**
before judging it. Several rows are site-wide chrome and list every route.

The file is UTF-8 with a byte-order mark, which is what makes Excel and Google Sheets render Arabic
correctly instead of as mojibake. Please keep the encoding when you save.

---

## 4. What to check

### 4.1 Natural Modern Standard Arabic
Fluent MSA that a Gulf parent reads without friction. Not translationese, not a literal word-for-word
mapping of the English clause order, not dialect. If a sentence is only comprehensible because you
can guess the English behind it, that is `REVISE_MEDIUM` at least.

### 4.2 PCA takes feminine agreement
`PCA` is treated as feminine throughout this corpus (تتيح، تجمع، تخزّن). This is a settled decision,
already relied on by the build's forbidden-phrase gates, which are written for feminine agreement.
Flag any masculine agreement as `REVISE_MEDIUM`, and flag inconsistency within a single page as
`REVISE_HIGH` — mixed agreement reads as machine translation and undermines trust on a page about
trust.

### 4.3 Child and family terminology
The English deliberately says *child* and *parent*, never *user*, *subject*, *target* or *device
owner*. Arabic should match that warmth: الطفل / الأهل / الأسرة. Watch for surveillance vocabulary
creeping in — مراقبة (surveillance/monitoring) carries a harder edge than the English *protection*
framing and should be flagged wherever it does not correspond to an English word of equal weight.

### 4.4 Privacy and security hedges — the highest-risk category
PCA's privacy claims are deliberately **narrow and hedged**. The English says what is *not centrally
readable*; it does not say PCA collects nothing. Arabic must not round that up.

Reject any Arabic that:
- turns a hedge into an absolute (e.g. "لا نجمع أي بيانات" — PCA does hold accounts and enrolment data);
- promises encryption, deletion, retention limits or third-party audits that the English does not promise;
- states or implies that PCA *cannot* technically see something, where the English says PCA *does not*
  centrally store it in readable form;
- promises a control the parent does not yet have (there is no self-service deletion path today).

Every row with `CONTENT_CATEGORY = PRIVACY_ASSERTION` is `RISK_LEVEL = CRITICAL` for this reason.

### 4.5 Feature availability strength
`CLAIM_ID` and `CLAIM_STATUS` tell you how strong a claim the row is *permitted* to make:

| `CLAIM_STATUS` | The Arabic may say, at most |
|---|---|
| `VERIFIED_AVAILABLE` | it works today |
| `LIMITED` | it works with stated limits |
| `REQUIRES_PLATFORM_SUPPORT` | it depends on what the phone platform allows |
| `COMING_LATER` | it is planned — never present tense availability |
| `EXTERNAL_SECURITY_REVIEW` / `NOT_APPROVED_FOR_PUBLIC_CLAIM` | it must not be asserted at all |

If the Arabic asserts more than its status permits, that is `REVISE_HIGH` even when the English is
identical in meaning — because the Arabic is what an Arabic-speaking parent will hold PCA to.

### 4.6 Release-state honesty
Several strings exist specifically to say PCA is **not live yet**: account creation is not open,
the parent app is not usable in a browser, PCA cannot receive email replies yet. These are
`CONTENT_CATEGORY = RELEASE_STATE_NOTICE`. Arabic that softens them into "coming soon" marketing, or
that reads as though the feature already works, is `REVISE_HIGH`. Bluntness is the intent.

### 4.7 Calls to action
CTAs must be natural imperatives that set a truthful expectation of what happens on click. A CTA that
implies signing up when the click only opens an explanatory page is a defect, not a style choice.
Check verb form, and check that the same action uses the same verb site-wide.

### 4.8 English leakage
Flag untranslated English left in Arabic text, English punctuation conventions, English number
formatting where Arabic-Indic or a different separator is expected, and calques that are literally
Arabic words in English syntax. `PCA` itself stays Latin — that is intended, it is the product name.

### 4.9 RTL, punctuation and mixed script
The pages render with `dir="rtl"` and `lang="ar"` in the served HTML. Please check:
- Arabic comma `،` and question mark `؟` rather than the Latin forms;
- parentheses, brackets and quotation marks that read correctly in RTL;
- Latin runs (`PCA`, `Android`, URLs, email addresses) sitting correctly inside Arabic sentences;
- digits and any measurement or time expression reading naturally right-to-left;
- no stray LTR/RTL control characters.

### 4.10 Technical terminology
Consistency matters more than elegance: pick one Arabic rendering per concept (device, app,
notification, account, enrolment, permission, screen time) and use it everywhere. If the corpus is
inconsistent, flag every instance so the whole set can be normalised at once rather than drifting.

### 4.11 Legal wording
Rows with `LEGAL_REVIEW_REQUIRED = YES` are the Privacy Policy, the Terms, and the privacy assertions.
These are **provisional drafts**: the operating legal entity and jurisdiction are unresolved
(**OD-13**), and both pages are currently `noindex` and excluded from the sitemap. Review them for
language quality, and flag anything that reads as a binding commitment, but expect the final legal
text to change after the entity is settled.

---

## 5. The owner sign-off template

`RELEASE_A_ARABIC_OWNER_SIGNOFF.csv` holds the 87 rows that will need the owner's own decision:
every privacy assertion, every legal string, every feature-status label, every release-state notice,
every CTA, and every claim-bearing HIGH/CRITICAL string.

It ships with `OWNER_DECISION = PENDING` on every row. **It is a template, not evidence.** Nobody has
approved anything. Please leave it alone — the owner fills it in after your proposals arrive, and
rows will be added for anything you mark `REVISE_MEDIUM`, `REVISE_HIGH`, `OWNER_DECISION_REQUIRED` or
`LEGAL_REVIEW_REQUIRED`.

---

## 6. What happens to your proposals

1. Every proposed correction is checked against the English source, the claim register status, the
   privacy hedge, the feature-availability rule and the approved terminology.
2. Nothing is bulk-replaced. Each accepted correction is applied individually and must preserve EN/AR
   semantic parity — the build enforces exact key parity, so a change cannot quietly drop a key.
3. The build re-runs its Arabic forbidden-phrase gates, which are self-tested each build against the
   claim register's own prohibited text.
4. Accepted changes are re-rendered and re-verified in a real browser, in RTL, at eight viewports.
5. Only then does the owner make the OD-12 call.

A rejected proposal is recorded with its reason. If a rejection looks wrong to you, say so — a
disagreement about what PCA is allowed to claim is exactly the kind of thing this review exists to
surface.

---

## 7. Scope boundaries

Please do **not**:

- edit any column other than the four named in §2;
- change `KEY`, `ROUTE`, `ENGLISH_SOURCE` or `CURRENT_ARABIC`;
- propose changes to the English (raise them in `REVIEWER_NOTE` instead — the English is owner-approved
  copy and changing it re-opens claim review);
- reorder, add or delete rows — the pack must stay at exactly 189 rows so it can be validated on return.

Return the same file with the four columns filled in.

---

## 8. Status at the time of generation

```
NATIVE_ARABIC_REVIEW            = AWAITING_EXTERNAL_REVIEW
OD_12                           = NOT_APPROVED
LEGAL_PUBLICATION_STATUS        = NOT_AUTHORIZED
RELEASE_A_PUBLICATION_AUTHORIZED = NO
PCA_PUBLIC_RELEASE_A_DEPLOYED   = NO
```

Nothing in this review pack authorises publication, and no part of the site has been deployed.
