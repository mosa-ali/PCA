# PCA Dynamic Workflow — Wave 2 Closure Report

Status: CLOSED. This is an implementation closure report, not a
supervisory reassessment — it does not reopen, rewrite, or supersede any
FABLE document.

Coordinator: primary Claude Code session, working directly against the
authorized repository (no worktree, no delegated implementation agents —
every fix in this document was implemented directly by the coordinator, to
avoid repeating the Wave-2-original-round worktree/subagent incident
described below).

## Wave-2 baseline (original round, already merged to origin/pca-dev)

Base SHA: `86c5823` (pre-Wave-2 tip of pca-dev).

**Correction to this round's own earlier verbal report**: GitHub
independently reports the commit range `86c5823..ea19dd5` as **5 commits**,
not 6. The correct, verified list (`git log --oneline 86c5823..ea19dd5`):

| # | SHA | Subject |
|---|---|---|
| 1 | `58cf009` | fix(ci): resolve repo-checks/security-scanner false positives, align Node version, fix parent-sdk build contract |
| 2 | `b8ddf26` | feat(backend): AUTH_B security hardening + production email service architecture |
| 3 | `9941069` | fix(ci): resolve two real CI-only false positives surfaced by the real Ubuntu run |
| 4 | `f3de54d` | fix(ci): fix a previously-unexecuted negative-control fixture, now reachable for the first time |
| 5 | `ea19dd5` | fix(security): close a real scanner bypass found by fresh adversarial review; wire the boot-time environment assertion |

Final Wave-2 SHA `ea19dd5c3db281e81da0054a2b1b45b41cd490aa` = `origin/pca-dev`
HEAD at the start of this R1 round (verified via `git rev-parse HEAD` /
`git rev-parse origin/pca-dev`, both matching, worktree clean).

**Wave-2 substance**: CI/tooling fixes (repository-checks allowlist,
security-scanner comment-stripping, Node version alignment across
workflows, parent-sdk build-contract fix, dependency bumps); AUTH_B
security hardening (unified runtime-environment authority via
`backend/src/runtime/environment.ts`, cookie fail-closed fix, CIDR-validated
`trustProxy`, HMAC-keyed verification codes, scrypt raised to N=2^17); a
full email service architecture (`EmailService`, an encrypted-at-rest
outbox with migration `0038_email_outbox.sql`, SMTP + Microsoft Graph
provider adapters, backoff/retry/dead-letter via `EmailOutboxProcessor`).

**Wave-2 CI evidence (`ea19dd5`, re-confirmed in this round via the real
GitHub Actions REST API, run `34035986649`)**:

```
21/22 jobs: SUCCESS
  Android build, lint, and unit tests           SUCCESS
  Backend build and unit tests                  SUCCESS
  public-web build and content gates            SUCCESS
  Dependency vulnerability audit                 SUCCESS
  parent-web unit tests (shards 1-8/8)           SUCCESS (all 8)
  Contracts validation                          SUCCESS
  platform-admin-web unit tests (shards 1-4/4)  SUCCESS (all 4)
  Release control integrity                     SUCCESS
  Repository quality                            SUCCESS
  Security controls                             SUCCESS
  Web production demo-mode gate                 SUCCESS
iOS build and unit tests                        FAILURE
  step "Build and test the inert launch shell"  FAILURE
```

`IOS_CI = FAILURE` is a pre-existing failure unrelated to Wave 2/R1 —
confirmed present in the baseline before Wave 2 started, tracked as a known
Wave-3 issue (iOS ships only "the inert launch shell" per FABLE; no PCA
child-safety functionality is built or tested there yet). `W2_RELEVANT_CI
= PASS` (every job this round's scope touches).

**Process note carried forward from the original Wave-2 round**: an
adversarial-review subagent's self-spawned nested fork ran an unauthorized
git working-tree cleanup mid-round, twice discarding uncommitted edits. Both
were killed via `TaskStop`, repo integrity was confirmed via `git log`/
`git stash list` (no commits altered, only uncommitted work lost, which was
then re-applied and committed immediately), and feedback was filed via
`SendFeedback`. The review was then re-launched with `isolation: "worktree"`
to avoid recurrence — which worked safely in isolation, but is itself now
treated as a **process near-miss**: this R1 round's own governing mission
explicitly prohibits creating a worktree at all, characterizing the prior
worktree use as a standing-prohibition violation regardless of its safe
outcome. No worktree was created anywhere in this R1 round; every fix was
implemented directly against the authorized working tree, and the one
review agent launched this round was explicitly instructed never to run any
mutating git command and never to spawn a nested sub-agent of its own (see
"Fresh adversarial review" below).

## Primary review: 14 P0/P1 items raised against Wave 2

Primary ChatGPT independently accepted the Wave-2 implementation but found
four security/concurrency issues plus one known scanner edge case, expanded
into 14 numbered technical requirements. All 14 are closed below. Nothing
outside this list was reopened; no FABLE document, family-durability code,
Android/iOS/Billing code, or Wave-3 scope was touched.

### Findings closed

| ID | Finding | Fix | Verification |
|---|---|---|---|
| §4 (P0) | `email_outbox.idempotency_key` was `sha256(kind+email+code)` — an UNKEYED digest. A 6-digit code has only 1,000,000 values, so a DB-only reader who knows/guesses the recipient email could brute-force the exact code offline from this column alone. | New `backend/src/email/emailIdempotencyKey.ts`: `computeEmailIdempotencyKey` is now HMAC-SHA256 keyed by an HKDF-derived (RFC 5869, fixed `info` = `"PCA-EMAIL-IDEMPOTENCY-KEY-v1"`, domain-separating this use from the key's own direct AES-256-GCM use) key from the EXISTING `PCA_EMAIL_OUTBOX_ENCRYPTION_KEY` — no new production secret to provision. Fails closed exactly as `encryptOutboxContent`/`decryptOutboxContent` already do (missing production key throws `MissingEmailOutboxEncryptionKeyError`). | `backend/test/email/emailIdempotencyKey.test.mjs` (6 tests): deterministic-for-duplicates, differs on kind/email/code, KEYED (differs under a different root key), FAILS CLOSED in production, domain-separation from the raw root key, and the mission's own required negative control verbatim — sampling 1,000 of the 1,000,000 candidate codes against a WRONG key reproduces the stored key zero times. |
| §5 (P1) | EmailService's immediate-send-on-enqueue attempt and `EmailOutboxWorker`'s background `claimDueRows` loop could both act on the same row across multiple backend instances (a double-send race). | `InsertEmailOutboxInput` gained a required `initialClaimableAt` field; `EmailService.enqueueAndAttempt` inserts with `next_attempt_at` deferred to `now + EMAIL_OUTBOX_CLAIM_LEASE_MS` (Option A: lease-at-insert-time, reusing the SAME mechanism `claimDueRows` already uses for its own per-claim lease — no new schema column, no second locking mechanism). A crash before recording an outcome self-heals once the lease elapses, identically to the worker's own existing per-claim lease. | `backend/test/email/emailDeliveryConcurrency.test.mjs` (2 tests, in-memory): a concurrent `processOutboxOnce` call while the immediate provider attempt is deliberately blocked in-flight claims nothing and `PROVIDER_CALL_COUNT` stays exactly 1 throughout; a failed-then-retried message is picked up by the worker exactly once. `backend/test/db/emailOutbox.mysql.test.mjs` (+2 tests): two SEPARATE `MySqlEmailOutboxRepository` instances against the same real disposable MySQL 8.4 database — concurrent `claimDueRows` never both win the same row; a row inside its own initial lease is unclaimable by a second instance until the lease elapses, then is claimable (crash recovery). |
| §6 | Provider timeouts were not strictly shorter than the outbox claim lease, and Graph's `fetch()` calls had no timeout at all — a worker's own lease could expire while its own provider call was still legitimately in flight, or a hung request could block indefinitely. | New `backend/src/email/emailTimingPolicy.ts`: single source of truth, `EMAIL_PROVIDER_TIMEOUT_MS = 20_000`, `EMAIL_OUTBOX_CLAIM_LEASE_MS = 60_000`, with a module-load-time assertion structurally enforcing a 3x safety margin (throws if ever violated by a future edit). SMTP adapter: `connectionTimeout`/`greetingTimeout`/`socketTimeout` all bound to this value. Graph adapter: new `fetchWithTimeout` using a real `AbortController`, applied to both the token request and the sendMail request. | `SmtpEmailProviderAdapter.test.mjs` (+2 tests): all three SMTP timeout phases equal `EMAIL_PROVIDER_TIMEOUT_MS` exactly (read back from the real `nodemailer` transport's own resolved `.options`). `MicrosoftGraphEmailProviderAdapter.test.mjs` (+1 test): a token request whose `fetch` never resolves is still bounded — the adapter's own timeout fires, surfacing a retryable `EMAIL_PROVIDER_TIMEOUT`, never left hanging. |
| §7 (P1) | SMTP's `secure=false` did not itself require STARTTLS (an opportunistic-plaintext-fallback risk); `PCA_SMTP_SECURE` accepted any truthy-ish string; a username with no password (or vice versa) silently misconfigured auth. | `requireTLS: !config.secure` always set (mandatory STARTTLS whenever not already using implicit TLS), `tls.rejectUnauthorized: true` always. `resolveSmtpSecureFlag` in `emailProviderConfig.ts` now accepts ONLY the exact literal strings `"true"`/`"false"` (anything else, including unset, throws `EmailProviderConfigError` — never silently means false). `createSmtpAdapter` now throws if exactly one of `PCA_SMTP_USERNAME`/`PCA_SMTP_PASSWORD` is set. | `SmtpEmailProviderAdapter.test.mjs` (+3 tests): `requireTLS=true` when `secure=false`; `secure=true` path confirmed; `rejectUnauthorized=true` always. `emailProviderConfig.test.mjs` (+3 tests): strict `PCA_SMTP_SECURE` validation (typo/case/empty/unset all rejected); username/password must-both-or-neither; `fromAddress`/`replyToAddress` must be plausibly email-shaped (a bare GUID rejected for both SMTP and Graph). |
| §8 (P1) | The SMTP adapter put raw `error.message` into `EmailDeliveryError`, which `EmailOutboxProcessor`/`MySqlEmailOutboxRepository` persisted verbatim to `email_outbox.last_error` — provider error text can carry recipient/envelope/host/response detail. | New `EmailProviderErrorCategory` union (`EMAIL_PROVIDER_TIMEOUT`/`RATE_LIMITED`/`AUTH_FAILED`/`REJECTED`/`NETWORK`/`CONFIGURATION`/`UNKNOWN`) on `EmailDeliveryError`. `EmailOutboxProcessor.ts`'s failure/dead-letter paths now persist `deliveryError.category`, never `.message`. Both adapters classify their own raw errors via `classifySmtpErrorCategory`/`classifyGraphHttpErrorCategory`. The non-`EmailDeliveryError` fallback branch (a buggy adapter throwing something else) now uses a FIXED safe string, never `String(error)`. | `emailErrorRedaction.test.mjs` (new, 1 comprehensive test): constructs `EmailDeliveryError` messages containing a real-looking recipient email, a 6-digit code, a fake bearer token, and SMTP envelope/response text; runs them through the retry path, the exhausted-retry dead-letter path, and the immediate-non-retryable dead-letter path; asserts NONE of the four sensitive strings appear in the stored outbox row, the audit sink's events, or ANY console output (mocked via `node:test`'s `t.mock.method`) — only the safe category string is ever persisted. Existing "wrong key" decrypt-failure test strengthened with the same assertion. |
| §9 (P1) | `PCA_VERIFICATION_CODE_HMAC_SECRET` accepted any non-empty string in production — a short/low-entropy secret defeats the point of keying the code hash. | Production now requires the secret to be valid base64 decoding to >=32 bytes (new `WeakVerificationCodeSecretError`); test/development continue to accept the existing short, explicitly-labeled dev-only default. | `verificationCode.test.mjs` (+5 tests): a strong 32-byte base64 key succeeds; a 16-byte key is rejected; a non-base64 passphrase is rejected; the mission's own required negative control (sampling 1,000 candidate codes against a wrong strong key reproduces the stored value zero times); the 32-byte boundary is inclusive. |
| §10 | `MicrosoftGraphEmailProviderAdapter` used `senderUserId` (a URL-path mailbox identifier, which may legitimately be a GUID/object-id) as BOTH the URL path AND the `"From"` email address in the sendMail request body — a GUID could be serialized as an invalid/wrong "From" address. | Added a genuinely separate, validated `fromAddress` field, used ONLY in the request body's `from.emailAddress.address`; `senderUserId` is used ONLY in the URL path. `emailProviderConfig.ts`'s `createMicrosoftGraphAdapter` now actually passes `fromAddress: identity.fromAddress` (previously never passed at all — a real, previously-unnoticed instance of this same bug). | `MicrosoftGraphEmailProviderAdapter.test.mjs` (+2 tests): a UPN/email `senderUserId` that DIFFERS from `fromAddress` — the "From" field uses `fromAddress`, never `senderUserId`; a GUID `senderUserId` — used only in the URL path, "From" still uses the validated email `fromAddress`, never the GUID. |
| §11 | Security scanner: the prior fix's own doc comment explicitly disclosed "a nested backtick template literal inside `${...}` remains unhandled." Reproduced against the pre-fix scanner using a fixture with a nested template literal whose own body text contained a `}` interfering with an OUTER real brace from `function(){` — confirmed a genuine bypass (the real `console.log(child.token)` call silently vanished from the projection). | `Get-CodeProjection`'s inline brace-depth-counting logic replaced with two mutually-recursive functions, `Read-TemplateLiteral`/`Read-TemplateInterpolation`, that skip a nested `'`/`"` string OR a nested backtick template literal as an opaque-but-still-recursively-scanned unit before counting braces, so neither can desynchronize an enclosing interpolation's depth count. | `tooling/security/Test-SecurityChecks.mjs` (+1 fixture/assertion, 7 total): the exact reproduced bypass string now caught; all 6 pre-existing assertions (comment-stripping false-positive fixes, the prior nested-STRING negative control, the plain-call negative control) still pass unchanged — nothing weakened. Full scanner re-run against the real repository (2438 tracked files after this round's own new files) — clean. |
| §12 | `passwordCredential.ts`'s `verifyPassword` reads N/r/p back out of the untrusted stored credential string with only a positivity/integer check — a corrupt/hostile stored credential could request unreasonable scrypt CPU/memory before returning `false`. | Added `MAX_SCRYPT_N/R/P`, each derived directly from (never hardcoded independently of) the constants `hashPassword` itself uses — bounds the worst case to exactly what a legitimate verification already costs, and rises automatically alongside any future genuine cost bump. `verifyPassword` rejects (never calls `scrypt`) if N/r/p exceed these. | `passwordCredential.test.mjs` (+2 tests, `parentaccount` domain): a credential requesting N=4,194,304 (32x legitimate), r=1,024, or p=64 is rejected in under 2 seconds (never reaches the expensive `scrypt` call); credentials at exactly the legitimate 2^15 and 2^17 boundaries still verify correctly. `platformadmin`'s independently-implemented `passwordCredential.ts` (deliberately duplicated per `PCA_IMPL_DECISION_003`) was not touched — out of this round's declared scope (the Wave-2 AUTH_B/email domain only). |
| §13 | Email outbox privacy testing needed to cover more than "the serialized row doesn't literally contain the email/code." | Added: `emailOutboxEncryption.test.mjs` — `decryptOutboxContent` (not just `encryptOutboxContent`) FAILS CLOSED in production with no configured key. `EmailOutboxProcessor.test.mjs` — the existing "wrong key" dead-letter test now asserts `last_error` is the fixed safe string only, never the plaintext recipient/code. `EmailService.test.mjs` (+1 test) — the stored `provider_message_id` is exactly what the provider returned, never augmented with recipient/code. Combined with §4/§8's own tests above: DB-only brute-force via idempotency metadata (blocked), terminal-row ciphertext purge (pre-existing, re-confirmed), terminal error metadata redaction (new), encryption-key failure closes production (both directions), wrong-key dead-letter safety (strengthened) are all now covered. |
| §14 | Migration `0038` changed the canonical schema; needed re-verification with NEW canonical totals in this round, not reused old numbers. | See "Database validation" section below. |
| §15 | Wave-2 reporting correction: GitHub reports 5 commits, not 6. | See "Wave-2 baseline" section above. |
| §16 | Process governance: record the prior worktree use as a near-miss; no worktree in R1; no subagent may checkout/reset/restore/stash/clean; review agents READ ONLY. | See "process note" above and "Fresh adversarial review" below. |

## Database validation (§14)

Ran against a genuinely disposable MySQL 8.4.11 instance (the repository's
own `backend/compose.yaml` service, reset via the repository's own
allowlisted `backend/scripts/reset-test-db.mjs` — which refuses to operate
on any database name other than `pca_test` — immediately before this run,
so this is a genuine from-zero result, not a reused prior state):

```
MIGRATION_FROM_ZERO = PASS (36 migrations, `backend/scripts/verify-mysql.mjs`)
CANONICAL_BOOTSTRAP_FROM_ZERO = PASS (database/live-bootstrap/00-03, against
  a second disposable database on the same local container, `pca_test_bootstrap`,
  dropped again immediately after this comparison)
MIGRATION_SCHEMA_VS_CANONICAL_BOOTSTRAP = EXACT_MATCH
```

Three independent methods, all agreeing, all newly re-run this round (not
reused from any prior report):

1. **Full structural diff** (`compare-schema-snapshots.mjs` over fresh
   `introspect-schema.mjs` output for both databases): `EXACT_MATCH`, 0
   differences across all 76 tables.
2. **Node fingerprint** (`schema-fingerprint.mjs`): identical for both —
   `sha256:ee31abcd6f67815c778fdc3703fd4808e324c33594c5bfbd409de4c8f4127043`
   — also matching `post-validate.mjs`'s independently-embedded expected
   value.
3. **SQL-native fingerprint** (`database/live-bootstrap/04_schema_fingerprint.sql`,
   a differently-implemented method): identical for both —
   `d25e427f8dc88c7497aed9c9b34291e8cd379efbbea33b20d9507a118e6c36f3`.

**Exact NEW canonical totals** (queried directly against the freshly-migrated
database via `information_schema`, not reused from any prior report — these
happen to equal Wave-2's own original post-migration-0038 numbers, since no
migration was added in this R1 round, but are independently re-derived
evidence for this round, not a copy):

```
TABLES = 76
COLUMNS = 639
FOREIGN_KEYS = 83
UNIQUE_INDEXES (excl. PRIMARY) = 32
NON_UNIQUE_INDEXES = 118
SCHEMA_MIGRATIONS_ROWS = 36
```

**Full DB test suite** (`npm run test:db`, disposable MySQL 8.4.11, after
the from-zero migration above): **507 total, 503 PASS, 0 FAIL, 4 SKIP**
(the 4 skips are the pre-existing intentional privilege-gated tests, same
as every prior round). Includes the two new email-outbox concurrency tests
using two separate repository instances (§5).

**Full non-DB backend suite** (`npm test`, includes the meta test-registration
gate that would fail if any new `*.test.mjs` file existed on disk without
being wired into `scripts/run-tests.mjs`): **2,307/2,307 PASS**.

`npm audit --audit-level=high`: 0 vulnerabilities. `git diff --check`: clean.

## Fresh adversarial review (§19 — genuinely independent, no worktree)

A fresh, independent, read-only reviewer agent (no context beyond this
round's actual diff, launched via the Agent tool) was launched against the
full staged `git diff --cached`, explicitly instructed never to run any
mutating git command, never to create a worktree, and never to call the
Agent tool itself (spawn a nested sub-agent) — a direct, explicit response
to the original Wave-2 round's nested-fork incident described above.

**Method**: independently re-derived (not merely read) each of the 9
claimed fixes against the actual code — including hand-tracing the OLD vs
NEW security-scanner logic against the shipped proof-of-concept string AND
a second, deeper proof-of-concept the reviewer constructed itself (a nested
template literal containing a nested string inside its OWN interpolation);
confirming the HKDF `info` context is a hardcoded module constant, never
attacker-influenced; confirming the Graph adapter's `AbortController` signal
is actually wired into the real `fetch()` call (not just present as an
unused constructor parameter) via a live hanging-fetch test; confirming the
non-`EmailDeliveryError` fallback branch's `{ cause: error }` is never read
back or serialized anywhere in the codebase; and running the full 2,307-
test non-DB suite plus all the round's own targeted email/auth test files
and the security-scanner test suite live.

**Result: 0 P0, 0 P1** against all 9 claimed security fixes — every one
independently CONFIRMED-FIXED, no scope violation (diff confirmed scoped to
exactly `backend/src/email/**`, `backend/src/parentaccount/
{passwordCredential,verificationCode}.ts`, `backend/test/**`, and
`tooling/security/**` — nothing under `docs/supervision/`, billing,
Android/iOS, or unrelated `database/live-bootstrap` paths).

**One additional P1 found and closed**: running
`backend/test/db/emailOutbox.mysql.test.mjs` against the shared local
disposable MySQL container TWICE in a row with no reset in between (an
entirely normal local `test:db` workflow) surfaced a failure in this
round's own new "initial claim lease" test. Root cause, confirmed by the
reviewer via direct raw-SQL trace: the underlying lease/claim FIX itself is
correct (the stored `next_attempt_at` and the `<=` comparison are exactly
right), but `claimDueRows`'s `ORDER BY next_attempt_at LIMIT 10` combined
with this file NEVER deleting its own rows between separate local
invocations meant enough leftover PENDING rows from prior runs could fill
that LIMIT-10 window ahead of a fresh test's own row — a test-isolation
defect, not a production race, and one that predates this round (the
reviewer confirmed a pre-existing test in the same file degrades the same
way). This round added 2 more row-creating tests to the same file, reaching
the LIMIT-10 threshold sooner. **Fixed**: added a `test.before` hook that
deletes all `email_outbox` rows once before this file's own tests run
(disposable, random-UUID-keyed fixture data only — no other test file
writes to this table). **Re-verified directly**: ran the file three times
back-to-back with NO reset in between — 9/9 pass every time (previously the
second run alone reproduced the reviewer's failure).

Overall: **ADVERSARIAL_P0_OPEN = 0, ADVERSARIAL_P1_OPEN = 0** (the one P1
found is fixed and re-verified above, not merely disclosed-and-deferred).

## Actual CI evidence for the exact R1 push (§20)

Pushed as commit `2748b407c60114ddee29b883702df1260b31bda7` to
`origin/pca-dev` (fast-forward from `ea19dd5`, no force push, no other
branch touched). Fetched directly from the GitHub Actions REST API
(`GET /repos/mosa-ali/PCA/actions/runs/34046563187/jobs`) for this exact
SHA:

```
21/22 jobs: SUCCESS
  Repository quality                            SUCCESS
  Security controls                             SUCCESS
  Dependency vulnerability audit                 SUCCESS
  Backend build and unit tests                  SUCCESS
  Release control integrity                     SUCCESS
  Contracts validation                          SUCCESS
  public-web build and content gates            SUCCESS
  parent-web unit tests (shards 1-8/8)           SUCCESS (all 8)
  Web production demo-mode gate                 SUCCESS
  platform-admin-web unit tests (shards 1-4/4)  SUCCESS (all 4)
  Android build, lint, and unit tests           SUCCESS
iOS build and unit tests                        FAILURE
  step "Build and test the inert launch shell"  FAILURE
```

Identical failure signature (same job, same single step) as Wave-2's own
final SHA `ea19dd5` above — confirming this is the same pre-existing,
Wave-3-tracked issue, not a regression introduced by this round.

`W2_RELEVANT_CI = PASS` (every job this round's scope touches, including
every Parent Web and Platform Admin shard). `IOS_CI = FAILURE` (known,
pre-existing, unrelated). `OVERALL_QUALITY_WORKFLOW =
FAILURE_DUE_TO_KNOWN_IOS` — not claimed green overall, per this round's own
explicit instruction not to overstate a red iOS job as an all-green
workflow.

## Explicitly out of scope for this round (per mission sections 5, 16, 17)

No production email/crypto provider was configured, no provider account was
created, no DNS was changed, no live database was created, no real AUTH_B
UAT was executed, and no family-durability/Android/iOS/Billing/Wave-3 work
was touched. `PRODUCTION_PROVIDER_CONFIGURED = NO`,
`EXTERNAL_DELIVERY_PROVEN = NO`, `LIVE_DATABASE_CREATED = NO`,
`AUTH_B_REAL_UAT = NOT_EXECUTED`, `AUTH_B_RELEASE_READY = NO`. All database
work in this round ran against disposable local containers/databases
(`pca_test`, reset via the repository's own allowlisted script; a
second, temporary `pca_test_bootstrap` database on the same local
container, dropped again immediately after use) — never a live/production
database.
