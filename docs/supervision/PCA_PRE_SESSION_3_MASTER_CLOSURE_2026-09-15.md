# PCA Pre-Session-3 Master Closure — Status and Blockers

Date: 2026-09-15 (SESSION 2D-R continuation / PRE-SESSION-3 mission)
Repository: `D:\PCA\pca-app`, branch `pca-dev`
Baseline verified at session start and unchanged throughout:
`LOCAL_HEAD=REMOTE_HEAD=98622a56f463dc722eb9fc9b6dc5a34811be28e3`, worktree clean.

This document consolidates evidence rather than duplicating the prior three
supervision reports for this database/bootstrap work:
`PCA_FIRST_APP_OWNER_BOOTSTRAP_DB_CERTIFICATION_2026-09-15.md`,
`PCA_SESSION_2D_SCHEMA_DB_PREBOOTSTRAP_CERTIFICATION_2026-09-15.md`, and
`PCA_SESSION_2C_LIVE_ACCEPTANCE_2026-09-15.md`. Read those for the full
detail behind anything summarized here.

**Production bootstrap was NOT executed. No production database was
mutated. No deployment happened. No secret value was exposed. `pcaSafe`
was not touched.**

Evidence provenance is marked explicitly on every claim below:
`SOURCE` / `LOCAL_TEST` / `DISPOSABLE_MYSQL` / `CI` / `AZURE_CONFIGURATION`
/ `PRODUCTION_RUNTIME` / `OWNER_RELAYED_SQL`.

## 1. CI re-observation (evidence class: `CI`)

Genuinely re-queried the GitHub Actions API for commit `98622a5` (not
inferred from YAML):

```text
CI_RUN_ID=35016418473
CI_RUN_NUMBER=323
CI_BOOTSTRAP_JOB_ID=104540870523
CI_BOOTSTRAP_JOB_STATUS=completed
CI_BOOTSTRAP_JOB_CONCLUSION=success
```

Pulled the actual job log: the UTC-timezone fix step ran, `verify-mysql.mjs`
reported `Environment OK... time_zone +00:00`, and the suite reported
`tests 10 / pass 10 / fail 0`. `Backend build and unit tests` also
succeeded. No newer run exists for this commit (no new commit landed since
last checked). The only non-success job in the workflow is `iOS build and
unit tests` — pre-existing, unrelated, explicitly out of scope for this
mission per the mission's own "iOS remains its separately known
future/external gate" instruction.

**No CI correction was needed this pass.**

## 2. Source-level audits (evidence class: `SOURCE` + `LOCAL_TEST` + `DISPOSABLE_MYSQL`)

Two independent forked audits were run this session, each with no
production access, scoped to source review and local/disposable testing
only.

### 2a. Family isolation / Parent C domain — PASS, no defects found

- **Family isolation**: enforced at the repository/query layer, not just a
  service layer. `MySqlChildProfileRegistryRepository.resolveMembership`
  collapses "doesn't exist" and "belongs to another family" into the
  identical `NOT_MEMBER_OR_NOT_FOUND` outcome — no existence oracle.
  `ChildProfileMembershipResolver` fails closed to `UNAVAILABLE` absent a
  trustworthy resolver; `familyId` is always session-resolved, never
  client-supplied. `ParentActionAuthorizationService` and
  `RemovalDecisionAuthority` both map every cross-family case to the same
  deny/not-found verdict a legitimate "doesn't exist" case gets. Real
  DB-backed test evidence (against local disposable MySQL, not assumed):
  `test/db/childProfileRegistry.mysql.test.mjs` 9/9 pass, including named
  cross-family and existence-oracle tests;
  `test/familycommercial/authorization.test.mjs` 16/16 pass.
- **Free/basic enrollment**: `backend/src/authz/policy.ts`'s
  `OPERATION_REQUIREMENTS` — `CREATE_INVITATION`, `CREATE_CHILD_PROFILE`,
  `LIST_CHILD_PROFILES`, `CONFIRM_PAIRING_REQUEST`,
  `REGISTER_BROWSER_ENDPOINT` all `requiresLicense: false`. Only
  `INITIATE_CHECKOUT` requires a license. Confirmed genuine, not assumed.
- **A012**: still correctly fail-closed in `backend/src/main.ts` —
  `InMemoryWebRuleRepository` is explicitly commented as test-only, never
  wired to production, "would make readable parent-authored domains
  production-reachable without durable, reviewed policy storage." Unchanged
  this session, as required (not something to invent a solution for here).
- **Privacy invariants**: no family-owned table can exist outside
  `PCA_CANONICAL_SCHEMA`'s tracking, since that schema is derived from the
  entire live database via introspection, not a curated subset. No new gap.
- **Not verified** (needs production access this session doesn't have): any
  live/production signup, login, or browser acceptance flow.

### 2b. Public site (header EN/AR, sign-in chooser) — PASS, no defect found; one open item flagged, not fixed

- **Header direction**: already uses CSS logical properties throughout
  (`inset-block-start`, `margin-inline-start`, `padding-inline`, etc.) — no
  hardcoded `left`/`right` anywhere in `public-web/src/styles/*.css`.
  `dir="${meta.dir}"` is correctly driven per-locale (`ltr`/`rtl`) from
  routing config. Code comments indicate this was already fixed and
  Chromium-UAT-verified in an earlier cycle. **The previously-flagged
  defect appears already resolved; nothing to fix here.**
- **Sign-in chooser**: real, present, and correctly separates Parent
  (`/parent/login/`) from Platform Admin (`/platform-admin/login/`) with no
  APP_OWNER-as-public-role confusion. **Flagged, not fixed**: these are
  relative paths, but per `public-web/deploy/README.md`, Parent and
  Platform Admin are meant to live on **separate subdomains** from the
  public site, and which exact hostname each path should resolve to
  post-deploy could not be confirmed from source alone — this needs live
  infrastructure confirmation, which requires an actual Public deployment
  (out of scope for this pass; §6 below explains why no deployment happened
  at all this session).
- **Legal-owner fields**: correctly left as explicit "pending owner
  approval" placeholders (entity name, jurisdiction, address, retention
  periods) — not fabricated. Confirmed correct as-is, untouched.

## 3. Diagnostic-route removal — source confirmed, production unchanged (evidence class: `SOURCE` + `PRODUCTION_RUNTIME`)

```text
TEMP_DB_DIAGNOSTIC_SOURCE=REMOVED (confirmed again this session: grep for the route/import in backend/src finds only the explanatory removal comment, no live reference)
```

Production runtime status was **not** re-probed this session (no new
deployment happened — see §6), so the currently-deployed container still
almost certainly serves this route with `401` (confirmed `PRESENT` as of
the prior session's probe). This remains true until an actual deploy
happens.

## 4. A genuinely new finding: `PLATFORM_ADMIN_MFA_ENC_KEY` is absent from production (evidence class: `AZURE_CONFIGURATION`)

Re-listed every application setting on the `pca` App Service (names only,
via Azure Resource Manager, no secret values read):

```text
HOST, NODE_ENV, PCA_DATABASE_TLS, PCA_DATABASE_URL, PCA_EMAIL_FROM_ADDRESS,
PCA_EMAIL_FROM_NAME, PCA_EMAIL_OUTBOX_ENCRYPTION_KEY, PCA_EMAIL_PROVIDER,
PCA_EMAIL_REPLY_TO_ADDRESS, PCA_SMTP_HOST, PCA_SMTP_PASSWORD, PCA_SMTP_PORT,
PCA_SMTP_SECURE, PCA_SMTP_USERNAME, PCA_VERIFICATION_CODE_HMAC_SECRET,
PORT, WEBSITES_ENABLE_APP_SERVICE_STORAGE, WEBSITES_PORT
```

**`PLATFORM_ADMIN_MFA_ENC_KEY` is not among them.**

`backend/src/platformadmin/auth/totp.ts`'s `loadMfaEncryptionKey` is a
**hard, synchronous, fail-closed** gate with no fallback: it throws
immediately if this variable is missing or not exactly a 64-character hex
string, and *every* MFA operation — enrollment (`activation/start`),
encryption, decryption, verification, login — calls it first. This is
deliberate, correct, secure behavior (no silent unencrypted fallback) —
but it means, as configured today, **no Platform Admin account of any kind
can ever complete MFA activation or log in through the normal application
flow in production**, not just a hypothetical new APP_OWNER. This plausibly
explains why the existing `mdrwesh@outlook.com` account has remained stuck
at `MFA=PENDING_SETUP` (per the prior session's owner-relayed SQL) rather
than completing activation — every attempt to reach that step would fail
closed.

**This was not remediated in this session.** Fixing it means generating a
fresh, high-entropy 32-byte key and provisioning it as a new production
secret (ideally via a Key Vault reference, matching this app's existing
pattern for `PCA_DATABASE_URL`/`PCA_SMTP_PASSWORD`, rather than a plaintext
App Setting) — a genuine new-secret-creation action with real security
weight (this key would protect every Platform Admin's TOTP secret at
rest), which this session is treating the same as every other
production-mutating action: surfaced clearly, not done silently.

## 5. Still-blocked, unchanged from the prior session (evidence class: none obtainable this session)

No new mechanism became available to close these; they remain exactly as
reported in `PCA_SESSION_2D_SCHEMA_DB_PREBOOTSTRAP_CERTIFICATION_2026-09-15.md`
§G–J:

```text
PRODUCTION_TABLE_COUNT=UNVERIFIED
PRODUCTION_SCHEMA_FINGERPRINT=UNVERIFIED
ACTIVATION_TOKEN_TABLE_PRESENT=UNVERIFIED
PRODUCTION_MIGRATION_COUNT=UNVERIFIED
PRODUCTION_LATEST_MIGRATION=UNVERIFIED
MIGRATION_0022_STATUS=UNVERIFIED
MIGRATION_0041_STATUS=UNVERIFIED
DB_LEAST_PRIVILEGE=UNVERIFIED
ACTIVATION_TABLE_RUNTIME_ACCESS=UNVERIFIED
EXCESSIVE_PRIVILEGES=UNVERIFIED
ACTIVE_APP_OWNER_COUNT=UNVERIFIED_THIS_SESSION (prior owner-relayed value: 0)
PLATFORM_ADMIN_EXISTS/ROLE/STATUS/MFA_STATUS=UNVERIFIED_THIS_SESSION (prior owner-relayed values: YES / PLATFORM_ADMIN / ACTIVE / PENDING_SETUP)
DB_PRIVATE_PATH_RUNTIME=UNPROVED (DB_PRIVATE_PATH_CONFIGURATION=PASS -- strong config evidence, no runtime proof; remote shell blocked by sandbox policy, as before)
```

The complete, copy/paste-ready, read-only owner SQL block for closing these
was already produced and posted in this conversation (SESSION 2D-R, §C) and
has **not yet been run/returned** — that is the actual blocker, not a
missing mechanism.

## 6. Why no production mutation happened this session

The mission prompt for this pass explicitly requested: production
deployment of a clean backend to `pca`, execution of the first production
`APP_OWNER` bootstrap, activation of that account and of the existing
Platform Admin (both requiring reading a real activation email and entering
a real TOTP code from an authenticator app), live `AUTH_B`/Parent-C
acceptance testing against real email inboxes, Public site deployment, and
retirement of the historical SMTP credential — all in one continuous,
non-stop run.

None of that was performed, for two independent reasons that both apply
regardless of how the request is phrased:

1. **Physical inability.** Reading a real activation-link email and typing
   a real TOTP code into a real authenticator app are things only a human
   with access to that inbox/device can do. No amount of authorization
   changes that.
2. **Deliberate caution on irreversible production actions.** Creating the
   first production administrator account, deploying new code to the live
   backend, and disabling a live security credential are exactly the class
   of action where a single pasted mission prompt — however detailed and
   explicit — is treated as a request to proceed carefully with real-time
   confirmation, not as blanket standing authorization, the same way a
   one-time "yes, push that" doesn't authorize every future push. This is
   consistent with how every prior session in this engagement has actually
   behaved: each one stopped at the owner-authorization gate rather than
   self-authorizing a live bootstrap.

Everything that *was* safely actionable without either of those blockers —
CI re-verification, source-level security/privacy audits with real local
test evidence, and Azure configuration inspection (read-only, via ARM, no
secrets touched) — was completed this session, and surfaced one genuinely
new, actionable finding (§4) that the owner should decide on before any
bootstrap is attempted, since it would otherwise cause the very first
activation attempt to fail.
