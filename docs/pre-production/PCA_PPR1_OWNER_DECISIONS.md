# PCA PPR-1 — OWNER DECISIONS

**Baseline:** `fa6dee2bbce1b86008aa7397133f8dc90395e6d6` (origin/pca-dev)
**Protected main:** `f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd` (unchanged by this mission)
**Produced by:** PCA-PPR-1 reconciliation mission, 20 audit agents + 2 focused writers.

This document asks for decisions. It does not make them. Every option below records what is
**already built** versus what is **still missing**, so a non-engineer can decide from this text alone.

---

## 0. READ THIS FIRST — THE DECISION-ID NAMESPACE IS AMBIGUOUS

**Do not sign off any decision by number until this is fixed.**

`docs/architecture/31_RISK_DECISION_REGISTER.md:17-24` labels `PCA-DEC-001`..`PCA-DEC-008`
differently from the canonical per-document definitions, and the whole block is shifted:

| ID | Meaning in doc 31 | Meaning in the source-of-truth doc |
|---|---|---|
| `PCA-DEC-001` | Android Protected provisioning | Legal data-controller role (`01:143`) |
| `PCA-DEC-002` | Family Controls entitlement | Android Protected Mode provisioning (`01:144`) |
| `PCA-DEC-004` | Device-class battery budget | Adult-authentication strength for a parent invite (`02:136`) |
| `PCA-DEC-006` | Recovery material custody UX | YouTube account-history surface (`03:302`) |

**The source code follows both schemes simultaneously.**
`android/.../ProtectedModeProvisioningGate.kt:9` uses doc-01's `PCA-DEC-002`;
`backend/src/recovery/types.ts:3` uses doc-31's `PCA-DEC-006`.

An owner writing "PCA-DEC-002 approved" today has said something genuinely ambiguous.
**This document uses the doc-01/06 numbering**, which is what the source code, the capability matrix,
and the gate register all use. Reconciling the two namespaces is a prerequisite governance task.

---

## THE FIVE MANDATORY DECISIONS

### D1 — ANDROID PROVISIONING (`PCA-DEC-002` / `-014` / `-015`)

**DECISION_REQUIRED:** For Android "Protected Mode" — the strong mode where PCA becomes device owner
and can genuinely block uninstall — do we ship a QR factory-reset setup flow for all customers, keep
ADB as a pilot-only path, or ship Standard Mode only in V1?

**OPTIONS**

| | Already built | Still missing |
|---|---|---|
| **(a) QR managed-device** | Live device-owner detection with revocation tracking; the read-only authority gate; the package-suspension adapter; authority-gated schedule enforcement; install quarantine; the `PCA-AND-003` emergency-dialer safety floor; a tamper row on device-owner loss. The gate has a reserved `AVAILABLE` state waiting for this answer. | **A `DeviceAdminReceiver` class and its `res/xml` policy file — neither exists anywhere in the repo.** The QR provisioning payload generator. An enterprise-signed distribution channel. Google Play policy + legal clearance for consumer DPC distribution. |
| **(b) ADB pilot-only** | Identical to (a) on the app side. | **The same missing `DeviceAdminReceiver`** — `dpm set-device-owner` requires a receiver component name, so this path cannot be attempted either. A support runbook. |
| **(c) Standard Mode only** | Everything that ships today. Capability reporting already downgrades honestly; the child-facing disclosure card already renders the current mode. | Nothing for provisioning. |

**SECURITY_IMPACT:** (a)/(b) are the only options giving real tamper resistance — uninstall
protection and true app blocking. Under (c) a child can uninstall PCA from Settings or Force-Stop it,
and app blocking is impossible. The architecture already forbids calling Standard Mode
"unbreakable" (`doc 06:73`).

**UX_IMPACT:** (a) requires the parent to **factory-reset the child's phone** — an in-use device
cannot be upgraded without a wipe (`doc 06:119`). (b) additionally requires a computer and `adb`.
(c) is an ordinary Play install.

**V1_IMPACT:** Under (a)/(b), V1 waits on Play/legal clearance *and* new code. Under (c), V1 is
unaffected — the gate keeps returning `PENDING_OWNER_DECISION` and the UI keeps its honest labels.

**RECOMMENDATION: (c) Standard Mode only for V1; QR as the first post-V1 track.**
The decisive fact is that **(a) and (b) are both hard-blocked by the same missing artifact** — there
is no `DeviceAdminReceiver`, so neither path can be attempted against this APK at all. This is not a
decision that unblocks finished code; it is new code plus an external clearance. Every
Protected-Mode-dependent capability is already correctly fail-closed and honestly disclosed, so
shipping Standard Mode costs no rework and makes no false claim.

Sub-decisions, needed only under (a)/(b): **`PCA-DEC-014`** multi-user/work-profile devices —
recommend *(a) unsupported, detect and disclose*; **`PCA-DEC-015`** root-detection alert threshold —
recommend *(b) combined-signal threshold*, matching the existing debounced monitor design.

**BLOCKS_WHAT — the exact requirements this decision releases:**
`PCA-ADD-ENR-009` (managed enrollment) · `PCA-FR-082` (Protected-Mode uninstall/app controls) ·
`PCA-FR-145` and `PCA-FR-084` (removal-decision platform-authority release — only the local
audit-record half exists in source today) · `PCA-ADD-ENR-019`.
Tracked under gate token `PENDING_OWNER_DECISION`, and as `DEVICE_OWNER_DPC_MODE` in the recovery
gate register. **All four trace to the same single root cause — the absent `DeviceAdminReceiver` —
so they are one blocker, not four independent gaps.** Prior audit lanes recorded this in their own
registers as *"unreachable by design pending unresolved product decisions. Correctly self-gated, not
a silent gap"*, which is why it is classified an owner decision here and not a defect.

**REVERSIBILITY:** High. (c)→(a) later is a contained change plus a clearance; no data migration and
no re-enrolment. The painful direction is (a)→(c) after launch, which withdraws a protection claim
customers paid for.

---

### D2 — iOS V1 SCOPE

**DECISION_REQUIRED:** Does V1 ship an iPhone/iPad app, or is V1 Android-only with iOS first
post-launch?

**THE FACT THAT CHANGES THIS DECISION:** every prior assessment framed iOS as source-complete behind
external gates. **That framing does not survive contact with the source.** The iOS tree is a
high-quality component library plus three correct extension entry points, with **no application
layer wiring them together**:

- `DeviceActivityCenter().startMonitoring(...)` is called **nowhere** in `ios/` (verified: zero hits).
  The monitor extension's callbacks can therefore never fire.
- **No code writes** the App Group keys the monitor extension reads.
- **No networking of any kind exists** — zero `URLSession`/`URLRequest` in production iOS source.
  The child device cannot pair, fetch a policy, or report status.
- `FamilyActivityPicker` is never presented, so no app tokens can ever be produced.

Even with the Apple entitlement granted, a Mac purchased and a device in hand, **a signed build of
this source would never shield a single app.**

*Correction applied during the adversarial pass:* an earlier draft said "no Swift line in this repo
has ever been compiled." That is **false** — `.github/workflows/quality-gates.yml` runs `xcodebuild
test` on a `macos-14` runner. The accurate statement is that **no result artifact from that job is
committed anywhere**, so its pass/fail history is unknown here. This is materially good news: build
and simulator-unit-test evidence is obtainable today at zero hardware cost, and running it would
immediately settle whether the hand-generated `project.pbxproj` and the SDK-recollection-written call
sites actually compile.

**REAL-WORLD COST OF (a) iOS in V1:** a Mac, ≥1 physical iPhone/iPad (the Simulator cannot exercise
Family Controls), an Apple Developer Program membership, an entitlement application Apple may take
weeks-to-months to answer or may deny — **and, before any of that pays off, the engineering to build
the missing composition layer.** That last item is the largest and is gated on nothing external.

**RECOMMENDATION: DEFER_POST_V1 — but file the Family Controls entitlement application today.**
The entitlement is the single longest-lead item in the programme and is a queue PCA does not control.
Filing now costs almost nothing and starts the clock. Buy the Mac and one device during V1 so iOS can
be compiled the moment the entitlement lands.

**HONESTY REQUIREMENT IF iOS IS DEFERRED — this one must be actioned in source:**
`parent-web/src/pages/family/DeviceEnrollmentPanel.tsx:277` renders an **iOS** platform option, and
`backend/src/http/routes/invitationRoutes.ts:66-67` accepts `platform=IOS` and mints a real
enrollment token. **A parent can today complete "Add a child device → iOS" and receive an enrollment
token for an app that does not exist on the App Store.** That is the one place the shipping product
makes an iOS promise it cannot keep. The UI option must be removed or disabled before an Android-only
V1 ships. No iOS claim may appear in store listing or marketing while no iOS app ships.

---

### D3 — AI V1 SCOPE

**MANDATORY CHECK PERFORMED — does any controlled requirement make AI mandatory for V1? NO.**
All nine requirements that mention classification are conditional or explicitly optional:
`FR-WEB-01` ("*before optional AI*"), doc 14 §4 ("***Optional*** on-device AI … supplements rather
than replaces rules"), `PCA-FR-035` ("*only for* uncertain content"), `PCA-AI-001` ("***If*** any
on-device classification is applied…"), `PCA-NFR-032` (requires a deterministic fallback — i.e. the
system is specified to work without it), `PCA-NFR-053` (governs models *if* they exist), `ADR-006`
("*optional* on-device AI"), doc 23 §2 ("cloud inference … ***not part of initial release***").

**No trained model exists anywhere in the repository** — verified across `.tflite/.mlmodel/.mlpackage/
.onnx/.pt/.pb/.safetensors`, zero results, and not gitignore-hidden. The shipped eye-distance feature
uses Android's platform `FaceDetector` with a deliberately coarse near/far heuristic, not a model.

**RECOMMENDATION: DEFER_POST_V1, and reject cloud AI outright as a V1 option.**
The governance scaffolding that exists (precedence policy, kill-switch, model-package verification,
the typed iOS fail-safe boundary) is correct and keeps its value for a later model.
Cloud AI is the **least reversible** choice in this document: once children's content has been sent
to a third party, that cannot be un-disclosed, and PCA's entire market differentiation is
*"we cannot read your child's data."*

---

### D4 — YOUTUBE MODE B

**What the two modes actually are** (`docs/architecture/15_APP_USAGE_YOUTUBE_VISIBILITY.md:29-45`):

- **Mode A — the normal YouTube app.** PCA reports **how long** the child spent in YouTube, labelled
  *"app usage only"*. It **cannot** show which videos were watched, and `PCA-FR-051` makes never
  claiming a watch history a **product boundary**, not a technical limitation.
- **Mode B — a PCA-controlled player inside PCA.** Because PCA renders the surface, it can honestly
  log video ID, title/channel and player state — for videos played *inside PCA only*.

**RECOMMENDATION: Mode A is sufficient for V1. Commission the YouTube terms review now, in parallel.**
Mode A is complete, shipping and honestly labelled. Mode B's source is deliberately built so it
**cannot be switched on without a recorded terms review** — activation requires *both* an owner enable
*and* a recorded `termsReviewedAt`, and the Android flag store has no mutator anywhere in the
codebase. That safety property already exists; the right move is to start the external review's clock
rather than let it block launch.

**Do not let marketing describe Mode A as showing what the child watched** — that violates
`PCA-FR-051`. This recommendation does not weaken the `YOUTUBE_MODE_B_POLICY_REVIEW` or
`YOUTUBE_PLATFORM_API_PARTNERSHIP` gates, which remain closed.

**Expectation gap to accept consciously:** under Mode A, a parent asking *"what did my child watch on
YouTube?"* gets a duration and nothing more. That is honest, and it is also the answer most likely to
be perceived as a missing feature.

---

### D5 — RECOVERY

**THE CRITICAL FACT: deferring recovery does NOT let V1 ship sooner.** There are two separate crypto
decisions and conflating them has distorted this question before:

- **`PCA-DEC-020` — the signature suite.** Gates **everything**: device sessions, policy delivery to
  child devices, all family sync. 20 requirements sit on `CRYPTO_ACTIVATION` and 15 on
  `PRODUCTION_CRYPTO_SUITE`. The release gate makes any release **NOT RELEASABLE** while the
  rejecting verifiers are wired.
- **`PCA-DEC-021` — the recovery scheme.** Gates recovery only.

**The security review must be commissioned for V1 regardless.** The recovery question is only whether
`PCA-DEC-021` joins the same reviewer's scope — a marginal addition to an already-mandatory
engagement, and the cheapest it will ever be.

**Can a parent who loses their device recover family data today? No — at none of nine stations.**
RS generation, offline RS presentation, envelope sealing, store/relay (no HTTP route exists), client
fetch, KDF, cipher, trust-set epoch acceptance, and the transaction ledger. **Six of those nine need
no reviewer input at all** and can be built in parallel with the review.

**RECOMMENDATION: RECOVERY_V1 = V1_REQUIRED. Commission one review covering `PCA-DEC-020` and
`PCA-DEC-021` together.**
Reasoning: today nothing is encrypted end-to-end, so recovery's absence costs nothing. **The instant a
reviewed suite is wired, FDEK-protected family data begins to exist and the Owner's device becomes a
single point of permanent, irreversible data loss** — with no bypass, by design. Shipping crypto
activation without recovery converts today's honest "nothing works yet" into a dishonest "your family
data is protected **and** recoverable" — a claim the UI already makes and no code can honour.

**REVERSIBILITY: the least reversible decision in this document.** Data encrypted under V1's scheme
without a recovery envelope stays unrecoverable — no later release can rescue it.

**ACTION REQUIRED UNDER EITHER OUTCOME — the recovery copy is wrong today.**
`recovery.secretDisclosureTitle` ("*Before you create your Recovery Secret*") and
`recovery.secretDisclosureBody` ("*PCA infrastructure never receives or stores this secret. Keep it
offline and available to the family owner*") are shown **unconditionally, before any click**, for a
secret the system never issues and instruct the owner to safeguard something they were never given.
This is a live honesty problem now, not a consequence of the decision: if recovery is `V1_REQUIRED`
the copy stays wrong until recovery actually ships, and if it is deferred the copy is wrong
indefinitely. It is a one-line change either way.

*Classification note:* this was recorded as an owner decision rather than a defect because the page's
only action returns a fully honest "not available yet" message. A stricter reviewer could reasonably
call it a defect — the misleading text is displayed unconditionally, while the honest text appears
only after the user acts.

**If the owner additionally overrides RECOVERY_V1 to POST_V1**, the product must also state plainly at
onboarding that device loss in V1 means starting a new family enrollment.

---

## THE COMMERCIAL CHAIN — D6 → D7 → D8 (STRICT ORDER)

**D6 PAYMENT_PROVIDER_SELECTION → D7 MERCHANT_ACCOUNT_APPROVAL → D8 SETTLEMENT_BANK_CONFIGURATION.**
Merchant underwriting cannot begin before a provider is chosen; bank configuration cannot begin
before merchant approval.

**Correction to a claim that has appeared in prior documents:** billing was described as
"not applicable yet, no billing implementation exists." **That is false.** The billing implementation
exists and is tested: money as exact integer minor units end-to-end with no float in any persisted or
arithmetic path, a DB-arbitrated idempotency key on every payment-mutating path, verified webhook
signatures with `timingSafeEqual` over preserved raw bytes, and a complete RBAC-gated operator
console. All 98 Addendum-002 requirements are `SOURCE_COMPLETE` or `SOURCE_COMPLETE_EXTERNAL_GATE`.

**What is missing is entirely external:** a signed provider agreement, merchant/card-network approval
per region, and a verified settlement account.

**RECOMMENDATION: free-tier-only V1, with provider selection started in parallel.**
Entitlement enforcement is **real and works with no provider at all** — device-capacity reservation
takes a `FOR UPDATE` lock and returns a genuine 403, and FREE_ACCESS expiry is wired into production.
Merchant underwriting across USD/SAR/YER is a multi-week external process that would otherwise sit on
the launch date. **This single answer removes six external gates from V1's critical path.**

**REVERSIBILITY:** turning billing on later is configuration, not code. Switching provider *after*
taking real payments is expensive. Choose D6 carefully — it is the stickiest commercial decision here.

---

## D16 — SPLIT-ORIGIN COOKIE / DOMAIN TOPOLOGY

**DECISION_REQUIRED:** Does Parent Web reach the API **same-origin behind a reverse proxy**
(`app.pcasafe.com` proxying `/api/*` and `/v1/*`), or as a **true split** (`app.pcasafe.com` calling
`api.pcasafe.com` cross-origin)?

**WHY_IT_CANNOT_BE_DECIDED_BY_ENGINEERING:** both are implementable. The choice is a hosting and
security-posture decision — whether to widen session-cookie scope across every `*.pcasafe.com` host.

**THE FINDING THAT MAKES THIS URGENT.** A true split **breaks every Parent Web mutation**, and it
would not be discovered until DNS cutover. The session cookie survives (same registrable domain,
`SameSite=Strict`), but the CSRF cookie is **host-only** and is read via `document.cookie` by
**13 client modules**. From `app.` they structurally cannot read a cookie scoped to `api.`, so every
mutating request would omit the CSRF header and the backend would return `403 csrf_mismatch`.
**Login would succeed and every write would fail** — a failure that presents as a permissions bug,
not a domain bug, and would be extremely expensive to diagnose live.

**This is an unconsidered design gap, not a violated requirement.** `PCA-ADD-IDENT-012` specifies the
transport as *"HttpOnly, Secure-in-production, SameSite=Strict cookie … double-submit CSRF"* and says
nothing about cookie `Domain` or cross-subdomain use. The case was never in scope, which is why the
source is not wrong today and why this is a decision rather than a defect.

**OPTIONS**

| | Already built | Still missing |
|---|---|---|
| **(a) Single-origin behind a proxy** *(recommended)* | Everything. **Zero source change.** Matches the posture Platform Admin already assumes (`VITE_PCA_PLATFORM_ADMIN_API_BASE_URL` defaults to same-origin). | A reverse-proxy config, which does not exist in the repo — no nginx/Caddy/IaC of any kind. |
| **(b) True `app.` / `api.` split** | The session-cookie half works unchanged. | A `Domain=pcasafe.com` change to `serializeCookie` plus both call sites, **and a security review of widening cookie scope to every `*.pcasafe.com` host**. CORS also accepts exactly one origin today, so Platform Admin must stay proxied regardless. |

**SECURITY_IMPACT:** (b) widens cookie scope to every present and future subdomain — any XSS on any
`*.pcasafe.com` host gains reach it does not have under (a).
**UX_IMPACT:** none visible to families either way. **COST:** (a) is cheaper and lower-risk.
**V1_IMPACT:** (a) needs no source change and no security review; (b) adds both to the critical path.

**BLOCKS_WHAT:** every DNS/domain step. Gate `DOMAIN_DNS_HOSTING` (newly proposed — see below),
`DEPLOYED_TLS_TERMINATION_CONFIG`, `ANDROID_APP_LINK_ASSETLINKS_HOSTING`, and `PCA-NFR-001`.
Five mobile hostname literals additionally have **no configuration seam at all** (hardcoded in Kotlin,
the Android manifest, Swift and an entitlements plist), and the enrollment link uses a **fifth
hostname** not in the four-name model — both must be settled in the same pass.

**RECOMMENDATION: (a) single-origin behind a reverse proxy.** Zero source change, no cookie-scope
review, consistent with Platform Admin, and it removes the entire class of failure above.
`api.pcasafe.com` can still exist for mobile clients, which do not use cookies.

**REVERSIBILITY:** Deciding (a) now is cheap to revisit. Discovering the (b) problem *after* DNS is
live is the expensive path — the symptom looks like broken permissions, not broken topology.

---

## NEWLY PROPOSED EXTERNAL GATES

Three real external dependencies are referenced in source but tracked in **no register** — verified
absent from `external_gate_matrix.json` (33 gates) **and** the `.agent-runtime` R3 register (same 33).
They are invisible to `Invoke-ReleaseGateCheck.ps1` today. All three are carried in
`PCA_PPR1_EXTERNAL_GATE_MATRIX.csv` with status `PROPOSED_NOT_REGISTERED` and need owner approval to
be registered:

| Gate | Why it is V1-blocking |
|---|---|
| **`DOMAIN_DNS_HOSTING`** | Without DNS and a served hostname no family can reach the service at all. Follows D16. |
| **`DATABASE_BACKUP_RESTORE`** | There is no backup tooling, no restore runbook and no restore test anywhere in the repo. An untested restore is not a backup — here there is neither. Largest untracked production risk. |
| **`EMAIL_PROVIDER_SELECTION`** | Production wires `RejectingEmailSender`, so verify-email, forgot-password and reset-password are dead end-to-end. |

---

## REMAINING DECISIONS

| ID | Question | Recommendation | Blocks |
|---|---|---|---|
| D9 | `RETENTION_OWNER_RBAC` — Owner-only server enforcement for retention/delete/export, or today's family-scope + full audit? | **Accept for V1**, tighten after D5. Blast radius is bounded: family plane only, no lesser admin role can reach it, and the reachable actions produce an audit echo and a ledger entry with **no server-side data destruction**. Building server-side Owner authority is `NEW_FEATURE_ARCHITECTURE_REQUIRED`, and the codebase actively defends against it. | matrix `RETENTION_OWNER_RBAC` |
| D10 | `AUDIT_DURABILITY` — device-local only, or the opaque server ledger? | **Use the ledger.** It already exists, is wired, and costs nothing extra; it makes accountability survive device loss without PCA ever reading a record. A plaintext server audit log is forbidden by `PCA-SEC-023`. | matrix `AUDIT_DURABILITY` |
| D11 | `RELAY_METADATA_PRIVACY` — three separable choices: delete envelopes on ack vs TTL-only; bound `family_audit_events` retention; whether a relay diagnostic may carry `familyId`. | **PCA-operated relay, keep existing bounds, and publish the 7-day ceiling** in the privacy policy so it becomes a promise. Drop `familyId` from diagnostics. | matrix `RELAY_METADATA_PRIVACY` |
| D12 | Deployment topology — **one instance or many?** | Answer explicitly. Single-instance makes the in-memory rate limiter, device sessions, idempotency ledger and audit store **correct as written**. Multi-instance requires new durable source in seven places. Nothing in the repo records which was chosen. The background scheduler is *already* multi-instance-safe. | 7 source locations |
| D13 | Legal data-controller role (`PCA-DEC-001`, doc 01) | **PCA joint controller for enrollment metadata, family sole controller for activity** — matches the technical E2EE boundary. Privacy policy cannot be written without this. | D11, privacy policy |
| D14 · D15 | Register the three missing external gates | **Yes — see NEWLY PROPOSED EXTERNAL GATES above.** `DATABASE_BACKUP_RESTORE`, `DOMAIN_DNS_HOSTING`, `EMAIL_PROVIDER_SELECTION`. All three are real dependencies tracked in no register and invisible to the release gate. | untracked risk |
| D16 | Parent-Web ⇄ API origin model | **Single-origin behind a proxy — see the full D16 section above.** | all DNS work |
| D17 | `EXTERNAL_GATE_MATRIX.md` scope | Regenerate for all 37 gates (33 registered + 1 matrix-only + 3 newly proposed), or demote it to "the original seven, for narrative context" with the JSON declared authoritative. It currently claims to be generated and no generator exists. | doc trust |
| D18 | `PCA-DEC-009` battery-impact disclosure wording | **Qualitative statement** until real-device benchmarking exists. Trivially closable. | `PCA-NFR-034` |
| D19 | Telemetry activation | **Leave off for V1** — already default-off, no ingestion route exists, and building ingestion ahead of sign-off would itself violate the requirement. | none |
| D20 | Parental consent, privacy policy, account deletion | **All three are V1 blockers and none exists.** Registration collects email+password only — no guardianship attestation, no policy acceptance, no consent artifact. No privacy policy document or URL exists anywhere. No account-deletion path exists. Play Families requires a policy link in the listing *and* in the app. | store submission |

---

## URGENCY AND DEPENDENCY ORDER

**Tier 1 — this week. Everything else waits on these.**
1. **D5 — commission the crypto review** (scope: `PCA-DEC-020` + `PCA-DEC-021`). On the critical path
   for ~44 requirements and the release gate itself. Longest lead, least reversible.
2. **D2 — file the Apple Family Controls entitlement application**, whichever way iOS scope goes.
3. **D6 — payment provider**, head of the D6→D7→D8 chain.

**Tier 2 — this month.**
4. D1 Android provisioning · 5. D4 commission the YouTube terms review · 6. D13 data-controller role
· 7. D3 AI scope (cheap to answer; answering "defer" closes several downstream questions)
· 8. D20 consent/privacy-policy/account-deletion (long legal lead time — start now).

**Tier 3 — before launch.** D9, D10, D11, D12, D16, D14, D15, D17, D18, D19.

**Hard dependency edges:** `D6→D7→D8` · `D5` gates all delivery-side work · `D16` gates every DNS
step · `D13→D11` · `D1→(PCA-DEC-014, PCA-DEC-015)` · `D18` is gated behind `ANDROID_REAL_DEVICE_UAT`.

**Prerequisite before any sign-off: resolve §0, the decision-ID namespace collision.**
