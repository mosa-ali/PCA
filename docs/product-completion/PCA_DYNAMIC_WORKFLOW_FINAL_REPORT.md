# PCA Dynamic Workflow — Final Report

Master Coordinator + specialised agent squads, run as Claude Code dynamic
workflows. This document reconciles the **current controlled evidence** against
the **real source** as of this run. It deliberately does not overwrite any
historical Stage‑0 finding; earlier documents remain the record of what was
believed then, and this document records what was independently re‑derived now.

---

## 1. Run identity

| Field | Value |
| --- | --- |
| `WORKFLOW_ENTRY_SHA` | `601690ad010db01c6a879d25108c1e03f449a18f` |
| Prompt-declared entry SHA | `025a684a54121fb3e52684ce5f77626624671e02` |
| Entry reconciliation | `origin/pca-dev` had legitimately advanced by two commits (`a5073df`, `601690a`). Both were read and reviewed before any work began; neither was reverted. |
| `REMOTE_MAIN` | `f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd` — **unchanged**, never checked out, never merged into. |
| Branch | `pca-dev` only. No force push, no rebase of published history, no destructive reset, nothing deleted. |

---

## 2. The single most important result

**The programme was not where its own ledgers said it was.**

Twenty-five independent read-only auditors re-derived every control fact from
source. Across their work **308 explicit ledger/programme claims were checked
against the real files**:

| Verdict | Count |
| --- | ---: |
| CONFIRMED | 225 |
| **REFUTED** | **75** |
| UNVERIFIABLE | 8 |

Roughly **one in four recorded claims did not survive contact with the source.**
That is the headline finding of this run, and it is why the verdict in §10 is
`NOT_COMPLETE` rather than a metrics-driven pass.

Three refutations mattered more than the rest:

1. **The real-MySQL test suite had been unrunnable since migration 0027.**
   `backend/scripts/verify-mysql.mjs` asserts the post-migration table set with
   *strict equality* against a hardcoded allowlist. Migrations 0027, 0028 and
   0029 each added a table without extending it, so the gate threw
   `Unexpected schema:` on its first check and took **50+ real-MySQL test files**
   down with it. Independently reproduced: migrations create **73** tables, the
   allowlist named **69**. Every "backend suite 1725/1725 / 1741/1741 /
   1756/1756" claim in the P0 ledger therefore refers to the *non-DB* suite only.

2. **The route universe was wrong.** `/forgot-password` and `/reset-password` are
   real, routed, user-facing parent-web pages — shipped by `05b144e` *to close
   the `/login` P1* — that were never added to `PCA_PAGE_AUDIT.csv` or
   `PCA_PAGE_QA_LEDGER.csv`. The universe is **62 routes, not 60**, and those two
   have never been browser-verified.

3. **The 60-route "QA closure" is thinner than it reads.** Of 69 QA-ledger rows,
   **9** are AR/RTL and **1** is a non-desktop viewport. The AR/RTL and
   RESPONSIVE exit gates were never actually met by evidence. Worse, two defects
   found this run — an SPA-crashing `Set limit` and an always-400 `Approve` —
   sit on routes the ledger records as `VERIFIED_BROWSER_PASS`. That sweep loaded
   pages but did not exercise their mutations.

---

## 3. Agent accounting

The prompt specified 1 coordinator + 40 specialised agents in 8 squads. The run
was executed as five dynamic workflows plus coordinator-serialized work.

| Metric | Value |
| --- | ---: |
| `AGENTS_PLANNED` | 40 |
| `AGENTS_LAUNCHED` | 47 |
| `AGENTS_COMPLETED` | 37 |
| `AGENTS_FAILED` | 10 |
| `AGENTS_RETRIED` | 8 |
| `SOURCE_WRITER_MAX_CONCURRENCY` | **4** (cap respected; 2–3 preferred whenever shared i18n/CSS/backend files were in play) |

All 10 failures were the **same external cause**: the Claude session usage limit
was reached twice mid-run. Nine Wave‑1 auditors plus one Wave‑4 verifier died on
it. The nine auditors were re-launched in Wave 2 and all eight in-scope slices
completed; the lost verifier lens (`regression`) was **not** re-run and is
recorded here as a coverage gap, not as a pass.

| Wave | Agents | Outcome |
| --- | --- | --- |
| 1 — control + slice audit | 26 | 17 done, 9 lost to session limit |
| 2 — re-run of lost auditors | 8 | 8 done |
| 3 — backend security writer + 3 adversarial verifiers | 4 | 4 done |
| 4 — two parent-web writers + 3 verifiers | 5 | 4 done, 1 lost to session limit |
| 5 — platform-admin writer + 3 verifiers | 4 | 4 done |

Squad coverage: Agents 01–25 (control, parent-web, platform-admin slices) all
reported. Squad 6 (Docker/migrations/seed/runtime) and the integration half of
Squad 8 were executed by the coordinator directly because they are inherently
serialized on one MySQL container and one git index. **Squad 7 (real-browser
route sweeps) did not run — see §7.**

---

## 4. What the audit found

| Classification | Count |
| --- | ---: |
| REPO_SOLVABLE_OPEN | 201 |
| STALE_DOC | 69 |
| OWNER_DECISION | 12 |
| FUTURE_PRODUCT_DECISION | 6 |
| NOT_DEFECT | 6 |
| EXTERNAL | 5 |
| **Total findings** | **299** |

Repo-solvable open, by severity: **P0 2 · P1 35 · P2 93 · P3 71**.

This is the honest denominator. The prompt's exit gate asks for
`P0/P1/P2_REPO_SOLVABLE_OPEN = 0`; the true starting number for this run was
**130** (P0+P1+P2), not 0.

### Key adjudications settled with quoted evidence

| Question | Verdict |
| --- | --- |
| `/subscription` auto-renew | **FUTURE_PRODUCT_DECISION.** No auto-renew concept exists in `backend/src/billing/subscription.ts`, in `billing_subscriptions` (migration 0007) or in `SubscriptionRow`. The ledger's PARTIAL is correct. |
| `/children/:childId/eye-protection` toggle | **FUTURE_PRODUCT_DECISION.** No write method on `ParentFamilyDataGateway`, and zero `EYE_PROTECTION` references in `backend/`, `contracts/`, `android/` or `ios/`. A toggle would require a new device wire contract. |
| `/billing/plans` browse-all | **REPO_SOLVABLE_OPEN — the ledger's "not repo-solvable" wording is wrong.** Two auditors disputed this; the tie-break agent read `planRoutes.ts`, `billing/plan.ts` and `BillingReadModel.ts` in full and confirmed no list capability exists *today*, but `BillingReadModel` already composes exactly this kind of listing six times over the same tables, `api/pagination.ts` already serves eight such clients, and `settlementRoutes.ts` ships a list-all precedent. It is real work, but it is repo work. |

---

## 5. What was fixed and published

Five commits, all on `pca-dev`, each with fails-before/passes-after evidence.

### `079f9a7` — restore the disposable-MySQL privacy gate
Added the four missing tables to `verify-mysql.mjs`'s allowlist. Because that
allowlist is a **privacy control**, each addition was schema-reviewed first:
`family_audit_events` (opaque envelope + ciphertext + nonce, no plaintext
column), `family_member_invitations` (`invited_email_hash BINARY(32)`, not an
address), `family_rbac_policy_config` (two booleans), `parent_password_reset_codes`
(`code_hash`, never the code). Verified on a genuinely fresh database.

### `3761e10` — review `family_rbac_policy_config` against the schema-privacy scan
With the gate restored, the schema-wide privacy scan ran for the first time
since 0027 and failed: `table family_rbac_policy_config matches prohibited term
"policy"`. Reviewed and recorded as a documented, exact, single-entry allowlist
exception mirroring the existing `enrollment_invitations.initial_policy_profile`
precedent — the table holds RBAC authority booleans, not a monitoring policy.
Preferred over renaming a shipped table. 4/4 privacy tests pass.

### `cdd7316` — platform-admin-web (8 defects)
Includes the **P0**: a *successful* `Set limit` crashed the entire admin SPA and
forced a re-login, because the mutation response was cast through an unchecked
`post<FamilyEntitlement>` generic while the route replies with a flat usage
record lacking `pendingRequestSummary`. Also: `Approve` on `/entitlement-requests`
could never succeed (bodyless POST + JSON content-type → Fastify
`FST_ERR_CTP_EMPTY_JSON_BODY` → 400 before RBAC ever ran); dashboard settlement
money printed as raw minor units; `/settings` never called the category-settings
backend that ships; the `until` audit filter excluded its own end date.
**23 files / 112 tests, all passing.**

### `de32179` — parent-web (Arabic, honesty, accessibility)
Includes a genuine **Arabic correctness defect**: under UAX#9 the night-protection
window `"{{start}} - {{end}}"` renders a 21:30–07:00 bedtime to an Arabic parent
as **"07:00 - 21:30"** — backwards. Also: the production step-up modal's primary
button read *"Re-authenticate (dev stub)"* in both locales; raw developer error
prose including the internal path `src/cryptoGate.ts` reached users through
`ErrorState`; a parent's Arabic choice was lost on every reload; breadcrumbs were
English on every route in every locale; the collapsed sidebar gave 10 of 18
Arabic nav links the identical accessible name. typecheck + lint clean, EN/AR key
parity exact at 878/878.

### Backend security + correctness (this run's final code commit)
Four audited defects plus two the adversarial verifiers surfaced:

- **Pre-verification account takeover.** `register()` overwrote a still-`PENDING_VERIFICATION`
  account's password hash with any caller's password, and `verifyEmail()` never
  touched it — so the real mailbox owner's verification activated the *attacker's*
  credential. Fixed by binding the credential to the code that authorises it
  (migration 0030) and resolving against all live codes, so a hostile
  re-registration can no longer silently invalidate the real owner's code.
- **Invitation acceptance was bound to no identity.** Any authenticated parent
  holding an `invitationId` could accept an invitation addressed to someone else.
  Now a single atomic `JOIN`ed `UPDATE` requiring
  `invited_email_hash = accepting_account.email_hash` — unraceable by construction.
- **Capacity read the base entitlement**, ignoring ACTIVE complimentary grants its
  own doc comment promised to include.
- **Seats were never consumed**, making the limit unenforceable.
- **`over_limit_*` was computed with the delta applied twice** — coordinator fix.
  MySQL evaluates single-table `SET` assignments left to right and a later
  expression reads the value an earlier assignment already wrote, so the
  `over_limit` CASE re-added the delta. Reproduced directly against MySQL 8.4:
  `(limit 2, reserved 1, +1)` yielded `over_limit_managed_device = 1` for a family
  exactly *at* its limit. **`adjustManagedDeviceCounts` has four live callers in
  device-slot reservation, so this was a pre-existing production defect**, not one
  introduced by this run.
- **Settings privilege escalation** — coordinator fix. `PlatformAdminSettingsService.put`
  chose its RBAC gate from the **client-supplied body category** and never read the
  stored row, while the upsert rewrites `category` and `is_sensitive` from those
  same values. A `PLATFORM_ADMIN` (denied the sensitive gate) could overwrite an
  APP_OWNER-only `PAYMENT_PROVIDER` key by declaring `category: 'BRANDING'` — and
  permanently flip `is_sensitive` to 0 so every later read returned it **unmasked**.
  Authorization now follows the stored row and an existing key's category is
  immutable.

---

## 6. Governance incident (disclosed in full)

At 17:14 a concurrent agent ran `git stash -u` + `git reset` against the shared
worktree, labelling the result *"PRE-EXISTING uncommitted work found in main
worktree at session start, unrelated to Session A writers"*. That label was
wrong: the stash swallowed **all four live writers' uncommitted work**, including
migration 0030.

- Detected by three independent Wave‑3 verifiers, all of which correctly refused
  to sign off and reported `BLOCKER: there is nothing left to verify`.
- Recovered **path-scoped** (`git checkout stash@{0} -- <paths>`), never by
  `stash pop`, because the stash also held *stale* copies of files a still-running
  writer had since re-applied. A naive `pop` would have silently reverted them.
- Writer D never noticed it had been wiped and reported `CONFIRMED_AND_FIXED`
  for work that was no longer on disk. Its ownership-honesty verifier caught this
  precisely (`grep b00020` → 5 matches remaining, contradicting the report). D's
  work was recovered and is present in `de32179`.

Two process lessons, recorded rather than smoothed over: a shared working tree is
the wrong isolation model for concurrent writers, and **a writer's self-report is
not evidence** — every claim in this run that mattered was re-derived by an
adversarial reader against the real diff, and several did not survive.

---

## 7. Exit gates — measured, not asserted

| Gate | Required | Actual | Met? |
| --- | --- | --- | :--: |
| `P0_REPO_SOLVABLE_OPEN` | 0 | 2 found, 2 fixed → **0** | ✅ |
| `P1_REPO_SOLVABLE_OPEN` | 0 | 35 found, 12 fixed → **23** | ❌ |
| `P2_REPO_SOLVABLE_OPEN` | 0 | 93 found, 6 fixed → **87** | ❌ |
| `TOTAL_ACTIVE_ROUTES` | 60 | **62** (universe corrected) | ⚠️ corrected |
| `VERIFIED_BROWSER_PASS` | all | 47 claimed, **none re-verified this run** | ❌ |
| `NOT_TESTED` routes | 0 | **2** (`/forgot-password`, `/reset-password`) | ❌ |
| AR / RTL browser proof | PASS | 9 of 71 ledger rows | ❌ |
| RESPONSIVE browser proof | 6 viewports | 1 row, 1 viewport | ❌ |
| `CLEAN_BOOTSTRAP_1` | PASS | **PASS** — fresh DB, 28 migrations, gate green | ✅ |
| `CLEAN_BOOTSTRAP_2` | PASS | not run | ❌ |
| Mutation survivors | 0 | mutation pass not run | ❌ |
| Security findings open | 0 | 2 found and fixed this run; no full red-team run | ⚠️ partial |
| `main` unchanged | yes | **yes** | ✅ |

### What did not run, and why

**Squad 7 (real-browser route sweeps), Squad 8's red teams, and the mutation
pass did not execute.** This is a scope shortfall, stated plainly rather than
papered over. The cause is the session usage limit, which was reached twice and
terminated ten agents outright. The repository *does* carry the sanctioned
harness for this work — `playwright.real.config.ts` and `e2e-real/` in both web
apps, and `tooling/mutation/run-mutation.mjs` — so the gap is execution time, not
missing capability.

Because those sweeps did not run, **no route's `VERIFIED_BROWSER_PASS` status was
re-confirmed this run**, and the 47 existing claims should be treated as
unverified until a sweep is executed against the current head — particularly
given that two mutation-path defects were found on routes carrying that status.

### Environment notes

- `parent-web`'s vitest suite is **timing-flaky under CPU contention** in this
  sandbox. A loaded full run showed 595/603; all 8 failures were investigated
  individually and 7 pass in isolation (the same class `601690a` already
  documented). The eighth — `LocationPage` safe-zone empty state — fails
  deterministically **and still fails with parent-web reverted to `601690a`**, so
  it is **pre-existing at the entry SHA** and is recorded as an open defect. It
  also refutes the prior commits' "parent-web vitest all clean" claim.
- Docker on this host intermittently reports a healthy container as unhealthy
  after a rapid `down -v` / `up` cycle, and once left a zombie container that had
  to be force-removed. Every database result quoted here was taken against a
  connection-probed, genuinely healthy container.

---

## 8. Remaining work, honestly classified

Every remaining P1/P2 falls into one of these buckets. The full per-finding detail
lives in this run's agent transcripts; the classification is what matters here.

- **REPO_SOLVABLE_OPEN (110)** — real work, in this repository, not done.
  Largest clusters: raw enum values still rendered in several surfaces;
  `CheckoutReturn` telling a parent a *failed* payment is still being confirmed
  while polling forever; settlement lists with no pagination at all; `/billing/plans`
  browse-all; assorted accessibility gaps.
- **EXTERNAL (5)** — `PRODUCTION_CRYPTO_SUITE`, crypto security review,
  trusted-browser/actor ceremony, payment-provider selection, production email
  provider. Independently re-confirmed as real gates, not cover:
  `cryptoGate.ts` hardcodes `CRYPTO_SUITE_APPROVED_FOR_PRODUCTION = false`,
  `main.ts` wires `UnavailableTrustSetRoleResolver`, and `RejectingEmailSender`
  is the production default. **A route final-stating as `BLOCKED_EXTERNAL` here is
  product-correct.**
- **FUTURE_PRODUCT_DECISION (6)** — subscription auto-renew, eye-protection
  toggle, and four others. Each would require a new domain concept or device wire
  contract that accepted requirements do not currently support.
- **OWNER_DECISION (12)** — awaiting a call from the product owner.
- **STALE_DOC (69)** — ledger cells the current source no longer supports.
  Corrected this run: the route universe (60 → 62), and the two P2 rows claiming
  `action`/`operation` are unrendered on `/not-permitted` (both *are* rendered, by
  `a5073df` and `601690a`).

One disclosed constraint on the seat-consumption fix: there is **no member-removal
path in the product today** (`revokeForFamily` excludes `ACCEPTED`), so the
parent-member counter can only ever increment. A per-member guard was added so a
re-invited existing member cannot be charged twice, but **a decrement must land in
the same change that ships member removal**, or families will accumulate phantom
seat usage.

---

## 9. Final metrics

| Metric | Value |
| --- | --- |
| `COMMITS_CREATED` | 6 (`079f9a7`, `3761e10`, `cdd7316`, `de32179`, `23ab179`, + this document) |
| Backend non-DB suite | **1787 / 1787 pass, 0 fail** (baseline 1772) |
| Backend fresh-DB suite | **440 tests, 436 pass, 0 fail, 4 skipped** (baseline 428 pass / **1 fail**) |
| platform-admin-web | typecheck + lint clean, **112 / 112 tests pass** |
| parent-web | typecheck + lint clean, 595/603 under load — 7 flakes, 1 pre-existing (§7) |
| `QA_DEFECTS_FOUND` / `FIXED` / `OPEN` | 299 / 20 / 279 |
| `SECURITY_FINDINGS_FOUND` / `FIXED` / `OPEN` | 4 / 4 / 0 *(from source audit; no red-team sweep ran)* |
| `MUTANTS_TOTAL` / `KILLED` / `VALID_SURVIVORS` | 0 / 0 / n/a — **not run** |
| `DOCKER` / `MYSQL` / `MIGRATIONS` | PASS / PASS / PASS (28 migrations, fresh DB) |
| `SEED` | not exercised this run |
| `PARENT_REAL_E2E` / `PLATFORM_ADMIN_REAL_E2E` | not run |
| `KNOWN_LOCAL_SOURCE_DEFECTS` | 110 repo-solvable open + 1 pre-existing failing parent-web test |

---

## 10. Verdict

```
PCA_DYNAMIC_PRODUCT_COMPLETION = NOT_COMPLETE
```

**Exact blockers:**

1. `P1_REPO_SOLVABLE_OPEN = 23` and `P2_REPO_SOLVABLE_OPEN = 87` (gate requires 0).
2. Real-browser QA did not run. No route's `VERIFIED_BROWSER_PASS` was
   re-confirmed against the current head, and the two routes newly added to the
   universe are `NOT_TESTED` — a state the gate explicitly forbids.
3. AR/RTL and RESPONSIVE gates are unmet by evidence: 9 of 71 rows carry AR/RTL,
   1 row covers a single non-desktop viewport, against a required six.
4. `CLEAN_BOOTSTRAP_2` not run.
5. Mutation pass not run; `VALID_MUTATION_SURVIVORS` therefore unknown, not zero.
6. Squad 8's parent and platform-admin red teams did not run.
7. One pre-existing deterministic parent-web test failure at the entry SHA.

**This verdict is deliberately not `READY_FOR_INDEPENDENT_REVIEW`.** The work that
did land is real, evidenced and adversarially reviewed — two P0s, four security
defects, and a broken privacy gate that had silently disabled 50+ real-MySQL test
files. But the gates this programme set for itself are not met, and the gap
between the ledgers' prior claims and the source is large enough that asserting
completion would repeat exactly the failure this run exists to correct.

No status in this document was self-declared `VERIFIED_ACCEPTED`. `main` was never
touched.
