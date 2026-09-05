# PCA FABLE — COORDINATOR-EXECUTED EVIDENCE LOG

Every result below was executed by the FABLE coordinator on this host during the
audit, against `pca-dev @ 5dc1fc0ee7078fa50fed6e277f0be702231512f3`. This file
is evidence level 1–2 (current source / tests executed now). Where it disagrees
with an agent report or a historical status document, **this file wins**.

`SOURCE_SHA_TESTED = 5dc1fc0` for every row.

---

## 1. GIT / GOVERNANCE (executed)

| Fact | Value | Command |
|---|---|---|
| HEAD | `5dc1fc0ee7078fa50fed6e277f0be702231512f3` | `git rev-parse HEAD` |
| origin/pca-dev | `5dc1fc0…` (identical to HEAD) | `git rev-parse origin/pca-dev` |
| origin/main | `f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd` | `git rev-parse origin/main` |
| Working tree | **CLEAN** at start and at end of audit | `git status --short` → empty |
| **main is an ancestor of pca-dev?** | **NO — the branches have DIVERGED** | `git merge-base --is-ancestor` → false |
| pca-dev ahead of main | **603 commits** | `git rev-list --count origin/main..origin/pca-dev` |
| main ahead of pca-dev | **1 commit** (`f8d5a6f` "revert(pca0): restore main to accepted architecture baseline") | `git rev-list --count origin/pca-dev..origin/main` |
| Merge base | `c458439` "ci(pca0): add least-privilege quality gates" | `git merge-base` |
| Local branches | **91** total — 32 merged into pca-dev, **59 NOT merged** | `git branch --merged/--no-merged` |
| Git worktrees registered | **121** | `git worktree list` |
| Files on disk under `.agent-runtime/` | **1,089,727** | `find .agent-runtime -type f \| wc -l` |
| Tracked files > 1 MB | **none** | `git ls-files -z \| xargs -0 ls -l` |
| Stashes | 1 (`stash@{0}`, 48 files, "DO NOT DROP") | `git stash list` |

**Governance consequence.** `origin/main`'s tip is a *revert* that deletes the
early scaffolding to leave main as an architecture-only baseline. A future
release merge of pca-dev into main is therefore **not a fast-forward**, and
`f8d5a6f` deletes files that pca-dev has since evolved. This needs a deliberate
merge strategy; it is not a defect, but it must not be discovered on release day.

**Stash disposition — DO NOT DROP still stands, but it is NOT a pending fix.**
`stash@{0}` is an **older** state, not newer work. Proven: the stashed
`backend/test/support/inMemoryFamilyMemberInvitationRepository.mjs` has only
`create()`, while HEAD's has **both** `create()` and `createAtomically()`; and
the stashed `parentAccount.mysql.test.mjs` calls `repository.create(...)`
exactly as HEAD does. The stash therefore predates the `createAtomically()`
migration and contains no repair for the 4 failing DB tests.

---

## 2. BACKEND TEST TRUTH (executed, both suites)

### 2.1 Non-DB suite — `npm run build && node test/schema-privacy.test.mjs && node test/server.test.mjs && node scripts/run-tests.mjs`

| Suite | tests | pass | fail | skip |
|---|---|---|---|---|
| `test/schema-privacy.test.mjs` | 26 | 26 | 0 | 0 |
| `test/server.test.mjs` | 1 | 1 | 0 | 0 |
| `scripts/run-tests.mjs` | 2187 | 2187 | 0 | 0 |
| **TOTAL** | **2214** | **2214** | **0** | **0** |

`tsc` build exit 0. Working tree stayed clean.

### 2.2 DB suite — `npm run test:db` against a **disposable local MySQL 9.7** (127.0.0.1:33061)

No live infrastructure was contacted. No live database was created.

**Authoritative run (MySQL server `time_zone = '+00:00'`):**

| tests | pass | **fail** | skip |
|---|---|---|---|
| 485 | 477 | **4** | 4 |

**The 4 failures — all one root cause, all in `backend/test/db/parentAccount.mysql.test.mjs`:**

| # | Test | Error | Classification |
|---|---|---|---|
| 311 | `MySQL SECURITY: a family-member invitation can only be accepted by the account whose OWN registered email it was addressed to — a stranger with a valid session gets NOT_FOUND and the invitation stays PENDING` | `repository.create is not a function` (`:386`) | **TEST_DEFECT** |
| 312 | `accepting a family-member invitation consumes exactly one parent-member seat, in the SAME transaction…` | same (`:448`) | **TEST_DEFECT** |
| 313 | `removeMember clears the target account's family_id and releases exactly one parent-member seat…` | same (`:533`) | **TEST_DEFECT** |
| 315 | `CONCURRENCY: two concurrent removals of different members in the SAME family both durably release their seat…` | same (`:670,672`) | **TEST_DEFECT** |

**Root cause, proven:** production exposes only `createAtomically()`
(`backend/src/familymembers/FamilyMemberInvitationRepository.ts:105`,
`MySqlFamilyMemberInvitationRepository.ts:72`). `create()` no longer exists on
the real repository. The DB test still calls `repository.create(...)`. The
in-memory double at `backend/test/support/inMemoryFamilyMemberInvitationRepository.mjs`
retains **both** `create()` (`:57`) and `createAtomically()` (`:81`) — which is
precisely why **2214 non-DB tests stay green** while the four tests that use the
*real* repository die. This is the repo's documented silent-drift failure class,
live right now.

**Release impact.** #311 is an **IDOR / cross-account defence test by name**. The
security property "a stranger with a valid session cannot accept another
family's invitation" is currently **asserted by no executing test**. The product
code may well be correct — but there is no execution evidence, and this is
exactly the class of test that has silently died in this repo before.

**The 4 skips** are all `platformAdminAuditPrivileges.mysql.test.mjs` privilege-boundary
tests: `# SKIP privileged audit-grant verification requires PCA_MIGRATION_DATABASE_URL;
run npm run test:db:platform-admin-privileges for the mandatory privilege gate.`
The mandatory privilege gate was **NOT_RUN** in this audit (no privileged DB URL).

### 2.3 A trap this audit fell into and corrected — record it

A first DB run reported **6** failures. The two extra were:
`#162 deviceauth "expiry is enforced against the real persisted expires_at"` and
`#227 "MySQL HTTP: expired bearer is 401"` (got 403).

Both force `expires_at = NOW(3) - INTERVAL 1 SECOND`. The MySQL server was
running in `Arab Standard Time`; `NOW(3)` was **+10,800 s** ahead of
`UTC_TIMESTAMP(3)`, while the app pool pins `timezone: 'Z'`
(`backend/src/db/pool.ts:26`). The rows were therefore written **three hours in
the future** and were correctly not expired.

**Proof:** with `SET GLOBAL time_zone='+00:00'`, re-running
`deviceauth.mysql.test.mjs` + `http.mysql.test.mjs` gave **63 tests / 63 pass /
0 fail**. Classification: **HARNESS_DEFECT (environment)**, not a product defect.

**But this is itself a finding.** The DB suite has an **undocumented, unenforced
environment precondition** (server must be UTC). `PCA_LIVE_DATABASE_SETTINGS.md`
mandates UTC but nothing verifies it, and `scripts/verify-mysql.mjs` does not
check it. Any future engineer on a non-UTC host will see two phantom failures.

---

## 3. CANONICAL DATABASE — VERIFIED AT THE DATABASE LEVEL

Built from an **empty datadir** on disposable MySQL 9.7. Both paths executed.

### 3.1 Claims vs my derivation

| Claim | Claimed | Derived by me | Verdict |
|---|---|---|---|
| Migrations | 35 | **35** (`Applied 35 migration(s).`) | CONFIRMED |
| Tables | 75 | **75** | CONFIRMED |
| Columns | 626 | **626** | CONFIRMED |
| Foreign keys | 83 | **83** | CONFIRMED |
| Non-unique indexes | 117 | **117** | CONFIRMED |
| Non-PK unique indexes | 31 | **31** | CONFIRMED |
| CHECK constraints | 228 | **228** | CONFIRMED |
| Tables with a PK | — | **75 / 75** | CONFIRMED |
| `MIGRATION_FROM_ZERO` | PASS | **PASS** — ran on an empty database | **CONFIRMED (was NOT_VERIFIABLE for the agent)** |
| `CANONICAL_BOOTSTRAP_FROM_ZERO` | PASS | **PASS** — `00_preflight`, `01_create_database_schema`, `02_reference_data`, `03_post_validation` all exit 0, including the fail-closed SIGNAL gates | **CONFIRMED (was NOT_VERIFIABLE for the agent)** |
| `5dc1fc0` FK `enrollment_bootstrap_attempts.invitation_id` | present | **present** in the migrated DB, referencing `enrollment_invitations.invitation_id` | CONFIRMED |
| `OWNER_DECISION_REQUIRED` relations | 0 | 0 | CONFIRMED |
| `CENTRAL_READABLE_CHILD_FIELDS` | 0 | **0** | CONFIRMED (two ways — see §5) |

Bootstrap-built database independently returned the identical
75 / 626 / 83 / 117 / 31 / 228, plus 35 `schema_migrations` rows.

### 3.2 **NEW P1 FINDING — `MIGRATION_SCHEMA_VS_CANONICAL_BOOTSTRAP` is NOT an exact match at the database level**

I built two databases on the same server — `pca_migr_check` (migrations) and
`pca_bootstrap_check` (bootstrap package) — and diffed them through
`information_schema`.

| Dimension | Result |
|---|---|
| Indexes (275 rows) | **IDENTICAL** |
| Foreign keys (84 rows) | **IDENTICAL** |
| CHECK constraints (228) | **IDENTICAL** |
| Column signatures (626) | **147 COLUMNS DIFFER** |

**Every one of the 147 differences is collation, and only collation:**

* migration path → `utf8mb4_0900_ai_ci` (case-**insensitive**, accent-**insensitive**)
* bootstrap path → `utf8mb4_bin` (exact byte-for-byte)

Affected columns include **7 × `family_id`** (`safe_zones`, `account_entitlements`,
`complimentary_entitlement_grants`, `entitlement_activation_idempotency`,
`entitlement_change_requests`, `eye_protection_settings`,
`managed_device_slot_reservations`), **2 × `child_profile_id`**, 2 × `password_hash`,
2 × `idempotency_key`, 6 × `account_ref`, 24 × `status`.

This directly contradicts the schema's own stated design intent, quoted from
`backend/migrations/0001_mysql_baseline.sql`:

> `utf8mb4_bin` gives exact byte-for-byte matching … **never a case- or
> accent-folded match on an opaque reference.**

**Empirically demonstrated**, not inferred. A row stored with
`family_id = 'FamilyAlpha'`:

| Database | column collation | query `'familyalpha'` | query `'FamilyAlpha'` | query `'FàmilyAlpha'` |
|---|---|---|---|---|
| `pca_migr_check` | `utf8mb4_0900_ai_ci` | **1 row** | 1 row | **1 row** |
| `pca_bootstrap_check` | `utf8mb4_bin` | 0 rows | 1 row | 0 rows |

**Mechanism.** Only **11 of 35** migrations mention `utf8mb4_bin` at all; the
other 24 declare bare `VARCHAR(n)`, which inherits the table default, which
inherits the **database** default. The bootstrap file pins the collation
explicitly on every column (272 occurrences). So the two paths agree **only if
the database itself was created with `COLLATE utf8mb4_bin`** — and nothing
enforces that:

* `00_preflight.sql` checks that utf8mb4 is *available* (`:86`) but **never
  asserts the target database's default collation**.
* `03_post_validation.sql:83` **does** assert `table_collation = 'utf8mb4_bin'` —
  but it runs only in the bootstrap path, once.
* `backend/scripts/verify-mysql.mjs` — the migration path's gate — asserts
  **nothing** about collation, ever.

**Forward risk for production (the part that actually matters).** Production is
created by the bootstrap, so it starts correct. But future migrations run against
it via `migrate.mjs`. I simulated that on the bootstrap-built database:

| Future migration action | Resulting collation | Safe? |
|---|---|---|
| `ADD COLUMN … VARCHAR` to an **existing** table | `utf8mb4_bin` (inherits table default) | safe |
| `CREATE TABLE` with a bare `VARCHAR family_id` | **`utf8mb4_0900_ai_ci`** (inherits DB default) | **UNSAFE** |

Since bare `VARCHAR` is the established house style in 24 of 35 migrations, the
next new table is likely to inherit case- and accent-insensitive collation on
the one column that carries **100% of PCA's family isolation** — which,
independently established, has **zero foreign keys to `families`** and is
enforced solely by application-layer `WHERE family_id = ?`.

**Honest severity: P1, not P0.** Family IDs are server-minted UUIDs, so a
case-folded collision between two real families is not a realistic live exploit
today. This is a **schema-integrity and production-correctness defect with
latent security relevance**, and it falsifies the `EXACT_MATCH` claim at the
database level.

**Why no agent caught it:** the static differ used by the database agent
explicitly *normalised charset/collation inheritance* before comparing, which is
exactly the dimension that diverges. An artifact-level diff structurally cannot
see this; only building both databases can.

**Cheapest complete fix:** assert the target database's
`schemata.default_collation_name = 'utf8mb4_bin'` in `00_preflight.sql`, and
re-assert per-table collation in the migration gate.

---

## 4. GREEN SIGNALS RE-VERIFIED BY THE COORDINATOR

| Signal | Verified state |
|---|---|
| CI Playwright / e2e | **Zero.** `.github/workflows/` contains exactly one file, `quality-gates.yml`; `grep -rniE "playwright\|e2e"` over it returns **nothing**. 6 playwright configs and 39 e2e/spec files exist in the repo and **never run in CI**. |
| `tooling/mutation/run-mutation.mjs` | `EQUIVALENT` is read from `mutant.expectedClassification` (`:181,194,206`) — **manifest-asserted, never derived**. Confirmed. Never cite its verdicts. |
| Family-isolation counters | `PARENT_CROSS_FAMILY_READS`, `PARENT_CROSS_FAMILY_WRITES`, `CHILD_CROSS_FAMILY_ACCESS`, `DEVICE_CROSS_FAMILY_ACCESS`, `CROSS_FAMILY_EXISTENCE_ORACLES` each appear in **exactly 1 doc file and 0 code/test files**. **Nothing can ever make them fail.** |
| `CENTRAL_READABLE_CHILD_FIELDS = 0` | **Genuinely backed.** `backend/test/canonicalSchemaChildFieldsRegression.test.mjs:102` ("zero columns are classified READABLE_CHILD_DATA") executed green inside my 2214-pass run, and I independently confirmed 0 readable child columns against the live migrated schema. This is the one counter with real assurance. |
| `public-web` gate scripts | **All 48 `.mjs` scripts pass `node --check`.** The historical SyntaxError-disables-gates trap is closed. |
| `public-web` SVG assets | 6 SVGs, **0** with illegal `--` inside XML comments. That historical trap is closed. |
| `public-web` contrast gate | **Real and correctly tiered** — 4.5:1 for text (WCAG 1.4.3 AA), 3.0:1 for UI component boundaries (`build.mjs:201-209`); 30 pairs checked, all pass. Unlike parent-web's jsdom axe, this one genuinely asserts. |
| **A `lint` script that runs no linter** | Three packages — `parent-sdk/browser-runtime`, `parent-sdk/runtime-sync`, `parent-sdk/wellbeing-control` — declare `"lint": "tsc --noEmit"`. That is typechecking wearing a linter's name. `backend` and `public-web` have **no lint script at all**. Only `parent-web` and `platform-admin-web` run a real linter (`eslint . --max-warnings=0`), and there are exactly **two** ESLint configs in the whole repository — **neither of which declares `no-console`**. Yet **six** `// eslint-disable-next-line no-console` comments sit in production code suppressing a rule no tool enforces anywhere, and **four of the six are in `backend`, which ESLint never runs against**. So 5 of 7 production trees have no lint enforcement whatsoever. All verified by enumerating every package's `lint` script and `git ls-files`. |

---

## 5. PUBLIC RELEASE A — BUILD EXECUTED AT HEAD

`node build.mjs` → **exit 0**, no `node_modules` required, working tree stayed clean.

```
content keys        EN 193 / AR 193 (exact parity)
contrast pairs      30 checked, min 3.25:1, all pass
pages emitted       16 (8 route(s) x 2 locales)
primary public      4 (home, howItWorks, privacy, download)
utility routes      4 (contact, accessibility, privacyPolicy, terms)
duplicate content   0 finding(s)
internal metadata   0 in HTML attributes, 0 governance vocabulary
claim register      57 rows (53 inherited from frozen v0.2), 2 proposed
videos              intro:placeholder, enroll:placeholder
AR native review    193 key(s) = the whole Arabic corpus, pending OD-12 sign-off
new copy to review  37 key(s)
```

**Confirmed Release-A content gap: the videos do not exist.** A repo-wide search
for `*.mp4` / `*.webm` / `*.mov` returns **zero files**. Both public videos are
placeholders; only their scripts (`src/content/pages/video.{en,ar}.mjs`) exist.

**OD-12 — independently confirmed P0.** The build itself correctly reports that
all **193** Arabic keys are pending OD-12 and that **37** are new copy. But the
exported artifact the reviewer and owner actually sign against —
`docs/public/reports/RELEASE_A_ARABIC_REVIEW_PACK.csv` — was generated for the
older 189-key corpus. Set arithmetic against the live corpus gives:

**≥ 19 live Arabic keys have never been in the review pack**, including **every
string on the `/download/` page** — the Release-A conversion page:

```
cta.getTheApp                  home.protects.body
howItWorks.protects.{label,title,items}
howItWorks.faq.{label,title,items}
download.seo.{title,description}
download.hero.{title,body}      download.child.lead
download.platforms.{label,title,items}
download.affordability.{label,title,body}
```

Caveat, stated honestly: the reverse count (pack keys no longer live) is
unreliable from my parser because Arabic values contain embedded newlines that a
line-oriented reader miscounts. **The 19 is a lower bound and is solid**; the
reverse figure should be re-derived with a proper CSV reader before quoting.

**Consequence:** OD-12 must not be signed against the current pack. Regenerate
the pack from the live 193-key corpus first, and add a gate asserting
`pack keys ≡ AR_REVIEW_PENDING` — the existing check guards the in-memory derived
list, not the exported artifact, which is why this drifted unnoticed.

---

## 6. TEST-DOUBLE DRIFT — CONFIRMED BUT CORRECTLY SCOPED

`backend/test/support/inMemoryEntitlementRepository.mjs` implements **8 of 10**
`EntitlementRepository` methods. Missing: `getEffectiveSnapshotForFamily`
(`EntitlementRepository.ts:59`) and `getEffectiveSnapshotForFamilyOnConnection`
(`:74`). `EntitlementService.getEffectiveSnapshot` calls the first of these
**unguarded**.

Two agents independently reported this as an active breakage. **It is not.** My
executed run is 2214/2214 green, so no currently-executing test reaches that
path. Correct classification: **LATENT coverage blind spot (P2)** — the
complimentary-aware effective-entitlement view is untested by the four suites
that use this double, and the drift will surface as a `TypeError` the day a test
exercises it. Production is unaffected (`MySqlEntitlementRepository.ts:260,270`
implements both).

---

## 7. TWO LATE FINDINGS THE COORDINATOR VERIFIED FIRST-HAND

### 7.1 `PARENT_CROSS_FAMILY_READS = 0` is not merely unasserted — it is **wrong**

A concrete, live counterexample, verified end to end by reading all three layers:

* **Route** `backend/src/http/routes/eyeProtectionRoutes.ts:118-126` correctly uses
  `session.familyId` (so a forged `:familyId` fails) — **but never checks that
  `childProfileId` belongs to that family.**
* **Service** `backend/src/eyeprotection/EyeProtectionSettingsService.ts:48-50` is a
  **pure pass-through with no authorization at all**:
  `async get(familyId, childProfileId) { return this.repository.get(familyId, childProfileId); }`
  Contrast `updateReminders()` at `:61-72`, which **does** call
  `this.authorization.authorize({ … targetScope: { kind: 'CHILD_PROFILE', id: childProfileId } })`
  and throws `NOT_AUTHORIZED` on anything but ALLOW.
* **Repository** `backend/src/eyeprotection/MySqlEyeProtectionSettingsRepository.ts:29-38`
  accepts `familyId` and **ignores it**:
  `SELECT … FROM eye_protection_settings WHERE child_profile_id = ?`.
  `familyId` is used only to synthesise the not-found default.

**Result:** the write path is authorized; the read path is not. A parent
authenticated in family A who supplies a `childProfileId` belonging to family B
receives **family B's stored row — including B's `family_id`**.

It is also an **existence oracle**, which is the sharper problem: a real
`childProfileId` returns the stored row carrying *another* family's `family_id`,
while an unknown one returns a synthesised default carrying *the caller's own*
`familyId`. The two are trivially distinguishable.

**Honest severity: P2.** `childProfileId` is a server-minted opaque UUID and is
not enumerable, and the leaked payload is small (a boolean, a timestamp, a family
id). But it is a genuine cross-family read and it falsifies two headline
invariants at once — `PARENT_CROSS_FAMILY_READS = 0` **and**
`CROSS_FAMILY_EXISTENCE_ORACLES = 0`.

**Why this matters more than its own severity:** §4 established that those five
counters are asserted by **no code and no test anywhere**. This is the proof that
the gap is not theoretical. An unasserted invariant did not merely go unverified;
it went silently false.

### 7.2 Correction — the backend env surface is larger than "four variables"

An earlier agent reported that `backend/src` reads only four environment
variables (`PORT`, `HOST`, `PCA_DATABASE_URL`, `PCA_SANDBOX_WEBHOOK_SECRET`).
**That figure is an artifact of the grep pattern and should not be used.**
`grep -rhoE "process\.env\.[A-Z_]+"` does return exactly 4 — but variables read
by *computed index* are invisible to it:

* `backend/src/platformadmin/auth/totp.ts:34` — `const hex = env[MFA_ENC_KEY_ENV_VAR];`
  where `:27` defines `MFA_ENC_KEY_ENV_VAR = 'PLATFORM_ADMIN_MFA_ENC_KEY'`
* `backend/src/commercialmaintenance/config.ts:62` — `const raw = env[key];` (loop)

**Operational consequence:** a deployment checklist derived from "four env vars"
omits `PLATFORM_ADMIN_MFA_ENC_KEY`. That key is required to decrypt every
platform-admin TOTP secret, and its loader fails closed — so the entire
platform-admin console would be unable to authenticate on a deploy that followed
such a checklist. (It is present in `backend/.env` today.)

I am recording this because I propagated the "four env vars" figure to two agents
before it was corrected; it does not change any release verdict, but it must not
reach the owner's deployment runbook.

### 7.3 Release B is dead one step earlier than the crypto gate — verified

I verified this chain myself because it is the most consequential Release B fact
in the audit, and it is sharper than the framing I first wrote.

1. **No real email provider exists.** `RejectingEmailSender` is production's
   default (`backend/src/main.ts:246`, selected at `:255-260`, wired at `:468`).
   A grep for `nodemailer|sendgrid|SES|SMTP|mailgun|postmark|resend|@azure/communication|createTransport`
   across `backend/src` returns **one** hit — the word "resend" inside a prose
   comment. `backend/package.json` has **zero** mail dependencies.
2. **The send failure is deliberately swallowed**
   (`backend/src/parentaccount/ParentAccountService.ts:173-177`):
   ```ts
   try { await this.emailSender.sendVerificationCode(email, code); }
   catch { /* deliberately swallowed */ }
   ```
   The intent is enumeration-safety (every branch must return an identical 202),
   which is legitimate. The production effect is that the parent receives a
   success response and waits forever for an email that was never delivered, with
   no operator-visible signal.
3. **`markVerified` has exactly one caller in the entire backend** — I confirmed
   it: `grep -rn "markVerified" src/` returns only the repository's own definition
   (`MySqlParentAccountRepository.ts:154`) and `ParentAccountService.ts:235`,
   inside `verifyEmail`. There is no admin override, seed, or platform-admin path
   to VERIFIED.
4. **Login hard-requires VERIFIED** (`ParentAccountService.ts:343`:
   `if (!account || account.status !== 'VERIFIED' || …) throw UNAUTHORIZED`).

**Conclusion: in production, no parent account can ever reach `VERIFIED`, so no
parent can ever log in.** The `familyId = null` consequence of the rejecting
signature verifier is real but **unreachable** — it sits behind a wall nobody can
pass. Fixing crypto alone changes nothing for Release B; fixing email alone
yields a parent with `familyId = null` and ~16 crypto-gated dead operations.
Email is the *outer* blocker, and it is **NOT_STARTED**, not "unwired".

**Documentation defect this exposes.** `backend/src/main.ts:242-244` calls this
"An explicit, honest gap, not a silent failure mode", and
`EmailSenderPort.ts:8-13` asserts "registration/verification/session issuance are
otherwise fully functional; only actual mailbox delivery is EXTERNAL_GATE'd".
**Both are false at the API boundary.** Verification and session issuance are not
functional — they are unreachable — and because of the swallow, the failure is
precisely a silent one.

### 7.4 Correction — parent-web i18n is 1079/1079, not 1190/1190

I derived this directly:

```
EN leaf keys: 1079 | AR leaf keys: 1079 | only in EN: 0 | only in AR: 0
```

**The parity claim is genuinely true and clean** — zero drift in either
direction. Only the *number* is wrong. I had propagated "1190/1190" from an
earlier survey into an agent brief; the figure appears nowhere in `docs/` or
`parent-web/` and should not be quoted. Other counts from the same source
deserve the same scrutiny.

### 7.5 Android and retention — evidence arrived late, and it is decisive

The Android/privacy lane reported after my first draft. I verified its four
highest-impact claims directly; all four hold.

**Android builds and tests cleanly.** `:app:compileDebugKotlin` PASS,
`:app:assembleDebug` PASS (14.4 MB APK), `:app:testDebugUnitTest --rerun`
**1,345 run / 1,344 passed / 0 failed / 1 skipped**, `:app:lintDebug` **0 errors,
95 warnings** offline (~149 online — the delta is 51 `GradleDependency` + 3
`AndroidGradlePluginVersion` checks that need network). So both circulating
figures are explicable, and the documented claim of **"0 lint issues"**
(`PCA_PPR2_OWNER_DECISIONS.md:662`, `PCA_PPR2_STEP5…:194`) is **false** — it was
read off a green exit code, since `abortOnError` fails on errors only and
warnings never fail a build.

The skipped test matters: `PcaAppGraphTest` "getInstance is a true singleton" is
skipped because the JVM has no `AndroidKeyStore`. **Consequently the real
production composition path — `getInstance` with `EncryptedSharedPreferencesStateStore`
— is exercised by zero tests.** All 1,344 passing tests use `createForTest` with
in-memory stores.

**THE RETENTION PROMISE IS NOT KEPT — I verified every link.** This is, in my
judgement, the most serious *product* finding in the audit, because it is a false
assurance to a parent about data retention:

* The parent chooses a window. The API validates it, writes an audit row, and
  returns `reply.code(200).send({ policy, accepted: true })`
  (`backend/src/http/routes/retentionRoutes.ts:203`). **It persists nothing.**
  There is no repository call on that path at all.
* The device does not read a policy either. `RetentionMaintenanceCycle` takes
  `generalRetentionPolicy: RetentionPolicy = RetentionPolicy.FOURTEEN_DAYS` and
  `locationRetentionPolicy` likewise as **hardcoded default parameters**
  (`RetentionMaintenanceCycle.kt:64-65`).
* And it never runs regardless: `if (familyId.isNullOrBlank() || deviceId.isNullOrBlank()) return`
  (`:67`), and enrollment can never populate either.

So a parent who selects "1 month" is told `accepted: true`, while the device — if
it ran at all — would enforce 14 days. **Nothing stores the choice, nothing
delivers it, and nothing enforces it.**

**Enrollment is the product's kill switch, and crypto activation alone will not
clear it.** `EnrollmentCoordinator.kt:145-151` catches
`CryptoSuiteNotApprovedException`, sets `EnrollmentState.CryptoReviewRequired`
and returns — no network call, nothing persisted. That single line disables
retention, location, geofencing, prayer reminders, YouTube Mode A, Delete-Now and
audit export, and strips the device id from every persisted tamper event.
**Second-order finding:** even after the crypto review clears, `:387` persists
`familyId = ""` because the bootstrap DTO never returns one — so retention still
returns early at `RetentionMaintenanceCycle.kt:67`, and Delete-Now and export
still throw `require(familyId.isNotBlank())`. **Any plan treating
`PRODUCTION_CRYPTO_SUITE` as the last Android blocker is wrong by one full step.**

**A placeholder domain sits in shipping production wiring.**
`PcaAppGraph.kt:352` constructs the real bootstrap client with
`baseUrl = "https://api.pca.app"` — and the adjacent comment admits it is "a
placeholder pending real deployment configuration". The product's actual domain
is `pcasafe.com`. It is unreachable today only because key generation fails
first; **if the key generator is swapped without fixing this, enrollment would
POST invitation tokens and device public keys to a domain the project does not
own.** The same applies to `enroll.pca.app` in the App Link config and the iOS
`applinks:` entitlement — which iOS *will* fetch at install time.

**Clean negatives worth recording** (each verified at file level, repo-wide):
zero logging sinks in Android (`366 main/ .kt` files) and iOS (57 `.swift`) production
code, enforced by real static-scan tests; **no analytics/telemetry SDK anywhere** —
no `google-services.json`, no Firebase/Crashlytics/Sentry/Amplitude/Segment in any
manifest or the Xcode project; **no model of any kind ships and there is no model
update path at all**, so the remote-code-execution-on-a-child's-device risk does
not exist today; and **YouTube Mode B is provably inert** — its Android flag store
has *no mutator method in the class or anywhere in the module*, so it cannot be
enabled by configuration.

*Correction to an agent claim:* `.env.azure` is **not** committed. `git ls-files`
returns only three `.env.example` files, and `.gitignore:26` excludes `.env.*`.

---

### 7.6 Worktree disk footprint and off-repo credential scan

My earlier secrets scan covered **tracked** files only, so I closed the gap:

| Tree | Entries | Files |
|---|---|---|
| `.agent-runtime/worktrees/` | 88 | 1,089,727 (whole `.agent-runtime`) |
| `.claude/worktrees/` | 20 | 361,624 (whole `.claude`) |

**253 `.env*` files** exist across the two trees. Scanning files named `.env`
for `PCA_DB_PASSWORD`, `PLATFORM_ADMIN_MFA_ENC_KEY` and `PCA_DATABASE_URL`
returned **no matches** — consistent with these being the three tracked
`.env.example` templates replicated per worktree rather than populated
credentials. Both trees are gitignored, so nothing is committed, and the root
`.dockerignore` is an **allowlist** (`*` then `!public-web` plus two CSVs), so
neither tree can enter any build context regardless.

*Limits of this negative:* I sampled the first 200 files named exactly `.env` and
looked for three specific keys. It is strong evidence, not exhaustive proof. The
combined ~1.45 million files across two worktree trees remains a real disk and
housekeeping problem (`FABLE-A041`), just not a credential-exposure one.

---

## 8. WHAT I DID NOT DO

* No live database created. No Azure, DNS, ACR, provider, store or DNS contact.
* No deployment of any kind.
* No source file modified. The only files I created are the reports in
  `docs/supervision/`.
* No `az` command run; every Azure statement in these reports is either
  repo-derived or explicitly marked as externally verified in a prior session.
* The mandatory platform-admin **privilege gate** (`npm run test:db:platform-admin-privileges`)
  was **NOT_RUN** — it requires `PCA_MIGRATION_DATABASE_URL` with elevated grants.
* No real-device, Xcode/macOS, provider, store, TLS, email or Azure evidence was
  produced or simulated.
