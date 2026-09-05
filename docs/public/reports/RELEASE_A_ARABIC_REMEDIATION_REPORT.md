# Release A — Arabic Remediation Report

**Independent native review received, validated, and selectively applied.**

```
SUPPORTER_ARABIC_REVIEW           = COMPLETE
ARABIC_REVIEW_ROWS                = 189
ARABIC_REVIEW_PACKAGE_STALE_ROWS  = 0
ARABIC_CORRECTIONS_VALIDATED      = 62
ARABIC_CORRECTIONS_APPLIED        = 40
ARABIC_CORRECTIONS_DEFERRED_LEGAL = 20
ARABIC_CORRECTIONS_REJECTED       = 2
NATIVE_ARABIC_REMEDIATION         = COMPLETE (for the non-legal set)
OD_12                             = AWAITING_OWNER_SIGNOFF
```

| Reviewer baseline | `pca-dev = 2b73808244361c1fb4a2aefd2ac2bed6a081d27b` |
|---|---|
| Rows reviewed | 189 / 189, no sampling |
| Reviewer package | `PCA_Release_A_Arabic_Native_Review_Package/` — preserved verbatim |

---

## 1. The package was validated before anything was trusted

The reviewer's four files arrived from outside this repository. They are review
*input*, not source, and the failure mode that matters is not a bad translation —
it is a **stale** one. A correction proposed against an English sentence that has
since changed would be applied on top of different content and silently alter
meaning.

So `scripts/arabic-review-intake.mjs` re-anchors every returned row to the live
corpus: the key still exists, and `ENGLISH_SOURCE`, `CURRENT_ARABIC`, `ROUTE`,
`CLAIM_ID` and `CLAIM_STATUS` all match what the corpus holds today. Any mismatch
is reported as stale and never silently reconciled.

It also checks the package against itself and against the reviewer's own report:

| Check | Result |
|---|---|
| Rows in `ALL_189.csv`, all unique | 189 / 189 |
| Every corpus key reviewed, no unknown keys | pass |
| Decision counts match the reviewer's stated totals | 127 PASS / 31 LOW / 21 MEDIUM / 5 HIGH / 5 LEGAL |
| `CORRECTIONS.csv` is exactly the non-PASS rows, no more, no fewer | 62 / 62 |
| Decisions and proposals agree between the two files | pass |
| Every non-PASS row proposes something different from the current text | pass |
| No row lost the `LEGAL_REVIEW_REQUIRED` flag on the way back | pass |
| **`ARABIC_REVIEW_PACKAGE_STALE_ROWS`** | **0** |

Independently, the review pack was regenerated from source before intake and came
back **byte-identical** to the committed copy, which is what establishes that the
reviewer worked from the current corpus rather than an older snapshot.

---

## 2. No bulk replacement — 62 individual decisions

Every correction was checked against the exact English source, the claim register
status, the privacy hedge, feature availability, child/family terminology and the
legal flag. The full ledger with a per-key reason is in
`public-web/reports/arabic-corrections-ledger.json`.

### Applied — 40

The corrections worth naming are the ones that fixed a **meaning**, not a phrasing:

| Key | What the Arabic had done |
|---|---|
| `status.platform` | `Requires platform support` had become «يعتمد على دعم المنصة» — *depends on* platform support. This one label renders for **nine** `REQUIRES_PLATFORM_SUPPORT` claims, so the weaker Arabic understated the condition on all nine at once. |
| `home.protects.items` | Three separate drifts on a card set carrying eight claims: "help **apply approved** web-safety decisions" had become "help **make** web protection decisions"; "whether protections are **active**" had become "whether protection is **working**" (a stronger assertion than the English); and "**receive** relevant protection notices" had become "**send** useful alerts" — the wrong direction entirely. |
| `home.availability.items` | "Account **access** is not open yet" had been narrowed to account **creation** only, which understated what is unavailable. |
| `howItWorks.steps.items` | "Depending on **verified** platform capabilities" had lost *verified*, becoming "actual capabilities". |
| `contact.seo.title` | The Arabic page title had dropped "Channels Opening Before Launch" entirely, leaving a title that implies contact channels already exist. |
| `home.faq.title` | "Quick **answers**" was rendered as "quick **questions**". |
| `home.why.title` | The Arabic specified «أب» — *a father* — where the English says "a parent". (The video transcript correctly keeps «أب», because *its* English does say "a father's concern".) |
| `accessibility.hero.title` | «يجب» (*must*) where the English says *should*. |
| `nav.download`, `footer.group.trust` | Both had added words the English does not contain. |
| `footer.legalNote` | "availability" had been narrowed to «المزايا» (*features*), letting non-feature items described as coming later escape the disclaimer. |

The remaining applied corrections are fluency, register and terminology, with no
change to any claim, hedge or release state.

### Rejected — 2

Neither rejection is a criticism of the reviewer's Arabic. Both are cases where a
better sentence would say something the approved English does not.

| Key | Reviewer proposal | Why refused |
|---|---|---|
| `home.faq.items` | rewrites "arbitrary files" as «أي ملفات أخرى غير لازمة للحماية» — *any other files not necessary for protection* | The qualifier implicitly concedes that files which *are* necessary for protection get collected. The English says no such thing, and it contradicts the locked invariant `CHILD_FILES_CENTRAL = 0`. The reviewer is right that «الملفات العشوائية» reads badly; the replacement has to keep the unconditional scope. |
| `video.enroll.title` | «كيفية التسجيل **وإعداد الحماية** باستخدام PCA» | Broader than the English title "How to Enroll with PCA". The reviewer's observation is sound — the video does cover more than signup — but the remedy is to change the **English**, which is owner-approved copy and reopens claim review. Widening only the Arabic would break EN/AR parity on a video that does not exist yet. |

Both are carried into the owner sign-off sheet with the full reviewer proposal, so
the point is not lost — it is escalated rather than discarded.

### Deferred to legal — 20

Every non-PASS row carrying `LEGAL_REVIEW_REQUIRED = YES` was deferred, per the
owner's instruction. That is all 20 legal-flagged corrections: 13 on
`/ar/privacy-policy/` and `/ar/terms/`, and 7 on `/ar/privacy/`.

**`LEGAL_PUBLICATION_STATUS` remains `NOT_AUTHORIZED`. `OD_13` remains open.**

---

## 3. One thing the owner should decide, not me

Deferring the legal-flagged set is the conservative call and it is what was
instructed. It has a consequence worth stating plainly rather than burying in a
count.

**Two of the deferred rows are cases where the Arabic currently promises *more*
than the English, on `/ar/privacy/` — a page that is indexable and will be
published.**

| Key | The drift |
|---|---|
| `privacy.topics.items` | Two clauses dropped the qualifier **readable** from centrally held app-usage and precise-location wording. Without it, the Arabic can be read as "PCA holds no such data centrally at all", which is a stronger privacy promise than PCA makes. The same row also renders camera `active` as «فعّالة». |
| `privacyPolicy.childDevice.body` | `should remain` became the stronger «يجب أن تبقى» (*must remain*), and the transit/relay encryption context disappeared. |

These are not legal *wording* questions. They are accuracy defects in a privacy
claim, and they sit in the deferred pile only because my own pack classifier marks
every `PRIVACY_ASSERTION` row as legal-sensitive — a deliberately cautious rule,
not a legal determination about these particular sentences.

**Recommendation:** authorise `privacy.topics.items` and `privacy.principles.items`
as *safety* corrections ahead of the wider legal review, since leaving them
in place means shipping Arabic that overstates PCA's privacy position. The two
`/ar/privacy-policy/` rows can reasonably wait for OD-13, because that page is
`noindex`, excluded from the sitemap, and blocked from publication anyway.

This is the owner's call. Nothing has been applied to any of them.

---

## 4. Open findings after remediation

```
REVISE_HIGH_OPEN          = 4   (all deferred to legal; status.platform was the one applied)
PRIVACY_HEDGE_DRIFT_OPEN  = 3   (all deferred: privacy.principles.items,
                                 privacy.topics.items, privacyPolicy.childDevice.body)
FEATURE_STATUS_DRIFT_OPEN = 1   (the camera wording inside privacy.topics.items;
                                 the other two — home.availability.items and
                                 status.platform — are applied)
ENGLISH_LEAKAGE_OPEN      = 0   (accessibility.goals.items applied; LTR/RTL now
                                 explained in Arabic before the abbreviations)
GENDER_AGREEMENT_OPEN     = 0   (reviewer found none; PCA is consistently feminine)
```

Every open finding is in the deferred-to-legal set. None is an unresolved
engineering defect.

---

## 5. How the corrections were written

Not by regenerating the Arabic modules — three of them do not round-trip through
`JSON.stringify`, so a regenerate would have reformatted hundreds of unrelated
lines and buried the actual change. Instead each **changed leaf string** was
replaced individually, in JSON-escaped form, required to match exactly once in
exactly one file: **60 leaf strings across 7 modules, 60 insertions and 60
deletions, no line added or removed.**

The applier refuses a proposal it cannot parse back into the value's own shape,
refuses one that does not re-serialise to the reviewer's exact text, refuses a
shape change, and refuses to re-apply onto already-corrected text. It never
invents Arabic and never part-edits a proposal to make it acceptable — a
half-applied proposal is nobody's reviewed text.

**A verification defect was found and fixed here.** The first run wrote all 40
corrections correctly and then reported all 40 as mismatched. The cause was the
ES module cache: re-importing `index.mjs` with a cache-busting query re-reads the
index while its page modules stay cached at their pre-edit values. A verification
step that fails on correct output is worse than none, because the next run's
failure gets assumed spurious and ignored. The post-condition now runs in a child
process with a clean module registry, and was proven by reverting the corrections
and re-applying them: byte-identical result, post-condition passing.

---

## 6. Full regression after remediation

| Check | Result |
|---|---|
| EN / AR key parity | **189 / 189** — no key added, removed or renamed |
| Build gates (claim register, 20 self-tested forbidden patterns, contrast, duplication, internal-metadata sweep, CSP derivation) | all green |
| Content duplication | 0 findings |
| Internal claim metadata in shipped files | 0 |
| Browser UAT — real Chromium, EN + AR, 8 widths, every route | **112 / 112** |
| axe (WCAG 2.1 A + AA) across 14 page runs | **0 violations** |
| Focus indicators / reduced motion / 320px reflow | clean |
| SEO — canonical, hreflang, x-default, sitemap, robots | pass, 10 indexable entries |
| Performance | 8,387 B gz first load, CLS 0, 0 external requests |
| Container rebuild + verification | **271 / 271**, `LOCAL_RELEASE_A_CONTAINER = PASS` |
| New artifact | 26 files, 196,815 B, `artifact-sha256 848394cd4f83d6c115fe73709fb0ad44517aea5b1c336d94637c6942965555fc` |

The living review pack was regenerated against the corrected corpus and still
passes its own faithfulness gate, including the byte-for-byte match against the
built artifact. The reviewer's original 189-row export is preserved unmodified in
the package directory as the as-reviewed snapshot.

---

## 7. What happens next

1. **Owner reviews `RELEASE_A_ARABIC_OWNER_SIGNOFF.csv`** — 120 rows, every one
   `OWNER_DECISION = PENDING`, showing `BEFORE_ARABIC` (from the reviewer's own
   export) beside `FINAL_PROPOSED_ARABIC` (read live from source), so a
   remediation error would show rather than hide.
2. **Owner decides on §3** — whether the two `/ar/privacy/` hedge-drift rows are
   authorised as safety corrections now, or wait for legal.
3. **OD-13 legal facts** unblock the 13 deferred `/ar/privacy-policy/` and
   `/ar/terms/` rows. See `RELEASE_A_LEGAL_OWNER_INPUT.md`.
4. **OD-12 sign-off** after 1–3. It is the owner's, and was never delegated to the
   independent reviewer, who explicitly declined to grant it.

```
OD_12                            = AWAITING_OWNER_SIGNOFF
LEGAL_PUBLICATION_STATUS         = NOT_AUTHORIZED
PCA_PUBLIC_RELEASE_A_DEPLOYED    = NO
RELEASE_A_PUBLICATION_AUTHORIZED = NO
```
