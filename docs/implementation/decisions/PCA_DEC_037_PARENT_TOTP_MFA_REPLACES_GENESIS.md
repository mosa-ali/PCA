# PCA-DEC-037 — Parent Genesis removed; Parent authority is account + verified email + password + TOTP MFA

- **Status:** ACCEPTED — explicit owner architecture decision, 2026-09-24.
- **Supersedes:** the production requirement of PCA-DEC-020 (R1/R2) that a Parent's
  family and Owner authority be established by a browser-held, non-extractable
  P-256 device key ("Parent Genesis"). PCA-DEC-025's owner-attestation chain is
  **no longer on the Parent login, family or billing path**.
- **Baseline it replaces:** `pca-dev` @ `4446dd6a` (Genesis implementation, never
  activated in production: `PCA_GENESIS_DEVICE_SIGNATURE_VERIFIER` was unset, so
  Genesis was fail-closed 503).

## Decision

```
PARENT_AUTHORITY_MODEL      = ACCOUNT + VERIFIED EMAIL + PASSWORD + TOTP MFA
COMMERCIAL_OWNER_AUTHORITY  = FAMILY ADMINISTRATOR + FRESH TOTP STEP-UP
```

replacing

```
PARENT_AUTHORITY_MODEL      = ACCOUNT + DEVICE-BOUND GENESIS CRYPTOGRAPHIC AUTHORITY
COMMERCIAL_OWNER_AUTHORITY  = OWNER-ATTESTATION CHAIN + DEVICE-SIGNED REQUEST PROOF
```

**These models do not have equivalent security properties** (see "What is weaker"
below). The owner chose the simpler, familiar model knowingly.

## The Parent journey

1. Register → verification code emailed (`VERIFICATION`).
2. Verify email → account `VERIFIED`, **no session**, notice `ACCOUNT_ACTIVATED`
   ("you can sign in; authenticator required within 3 days of first sign-in").
3. First sign-in (password + emailed login code) →
   - the family is **provisioned server-side** (`MySqlParentAccountRepository.ensureProvisionedFamily`):
     one transaction, `SELECT … FOR UPDATE` on the account row, `families` row with
     `provisioned_for_account_id` (UNIQUE — a second initial family for the same
     account is rejected by the database), `ADMINISTRATOR`/`ACTIVE`
     `family_parent_memberships` row, `ACTIVE` `service_account_family_scopes` row.
     Idempotent; never revives a `REVOKED` membership; never touches a family
     joined by invitation. The role is the existing contract (`ADMINISTRATOR`;
     structural owner = the non-invited account, unchanged). No new role.
   - the **3-day MFA grace window starts exactly once** (`parent_mfa_state`,
     INSERT that only one caller can win; never extended; recovery can only
     shorten it).
   - notice `FIRST_LOGIN` ("A first login to your PCA Parent account was completed.").
4. During grace: Parent Console usable; "Set up now" / "Remind me later" (the
   dismissal is per browser session only; the deadline is server-side). Grace
   sessions are **capped at the grace deadline** (session TTL = min(12 h, deadline)).
5. After grace without enrollment: password + emailed code yields only an
   **enrollment ticket** (HttpOnly, SameSite=Strict, 15 min, enrollment endpoints
   only) — never a session. Remembered-browser grants no longer count.
6. Enrollment: re-authenticate with email + password (even on the session path),
   server generates a 160-bit secret (`crypto.randomBytes`), seals it with
   AES-256-GCM under `PCA_PARENT_MFA_ENC_KEY` (separate key realm from Platform
   Admin; decrypt-only `_PREVIOUS_1/_2` rotation slots), returns the otpauth URI
   once (`Cache-Control: no-store`); the browser renders the QR **locally**
   (`qrcode` package). Activation only after one valid 6-digit code, via CAS on
   the exact pending ciphertext, claiming that code's counter. Notice `MFA_ENROLLED`;
   all remembered-browser grants revoked.
7. Every later explicit login: **email + password + 6-digit TOTP**. No emailed
   code and no remembered-browser grant can substitute. Ordinary navigation inside
   a live session needs no further code; logout, expiry, restart or a new browser
   all require TOTP again.

## TOTP implementation (reuse, not a second design)

Primitives are the Platform Admin implementation (`platformadmin/auth/totp.ts`):
RFC 6238 HMAC-SHA1, 30 s, 6 digits, ±1 step, shape check before HMAC,
timing-safe compare, AES-256-GCM, bounded keyring. Parent-specific:
`parentaccount/mfa/parentTotp.ts` (key realm + otpauth label "PCA Parent").
Replay: forward-only `last_accepted_totp_counter` shared by login, step-up and
enrollment. Lockout: 5 failed codes / 15 min → locked 15 min (row-locked
counter), plus per-IP/per-email route rate limits. Secret is never logged,
never persisted in clear, never stored in browser storage.

## Recovery policy (owner decision: 24-hour security hold)

On 2026-09-25 the owner selected a 24-hour hold after password and verified-
email code verification. Recovery codes are 6 digits, account-bound, hash-only,
single-use, expire after 15 minutes, and allow at most 8 attempts; route
rate-limits also apply. The first successful code starts the hold in
`parent_mfa_state`, records `MFA_RECOVERY_PENDING`, revokes all Parent sessions,
remembered-browser grants, login step-up codes and commercial step-up grants,
invalidates outstanding recovery codes, and sends the notice “A request was
made to reset your authenticator.” The old TOTP stays installed, but logins,
password resets, enrollment and commercial mutations are blocked during the
hold. A second request cannot extend or restart the deadline.

At or after the database deadline, the user must re-enter the password and
verify a newly emailed code. Only then is the old factor cleared, `MFA_RESET`
and `MFA_RECOVERY_COMPLETED` audited, and a ticket issued for a newly generated
local-QR enrollment. The new factor becomes active only after a valid 6-digit
TOTP. No recovery cancellation mechanism is available in the existing
architecture; safe cancellation and an owner recovery contact path remain a
follow-up, without an emailed cancellation link.

## Billing / commercial owner authority

Inventory of former owner-attestation call sites and their classification:

| Call site | Class |
|---|---|
| `POST /v1/families/:id/billing/checkout` | SENSITIVE_COMMERCIAL_MUTATION |
| `POST …/commercial/requests` | SENSITIVE_COMMERCIAL_MUTATION |
| `POST …/commercial/requests/:id/cancel` | SENSITIVE_COMMERCIAL_MUTATION |
| `POST …/commercial/subscription/auto-renew/cancel` / `resume` | SENSITIVE_COMMERCIAL_MUTATION |
| `POST …/authority/challenge` (device-proof challenge issuer) | Removed (Genesis/device-proof only) |
| GET entitlement / requests / subscription / invoices / payment-methods / checkout status | READ_ONLY — unchanged (family scope only) |
| Protection-alert recipient resolver (reads the attestation chain store) | Not commercial — unchanged |

Every SENSITIVE mutation now requires `ParentCommercialStepUpAuthority`:
verified, enabled account whose family is the target family → ACTIVE
`ADMINISTRATOR` membership → ACTIVE authenticator → atomic single-use
consumption of a step-up grant minted by `POST /api/parent/mfa/step-up` for that
exact operation and family (5 min). The grant needs a **fresh** TOTP counter,
so the code used to sign in cannot be reused. Denied callers never consume a
grant. Audited (`STEP_UP_GRANTED` / `STEP_UP_FAILED` / `STEP_UP_CONSUMED`).
All pre-existing scope, license, idempotency, CSRF and provider protections are
unchanged. No device-signature requirement remains on this path.

## What is weaker than Genesis (stated honestly)

- **No device binding.** Genesis tied Owner authority to a non-extractable key in
  one browser. Now anyone holding the password **and** the authenticator (or the
  password **and** the mailbox, via recovery) holds full Parent authority from any
  device.
- **Recovery still relies on password and mailbox control.** The selected
  24-hour hold gives the owner time to detect and report an unrequested reset;
  it does not make a compromised mailbox safe by itself. The old authenticator
  remains active during the hold, but session sign-in is blocked.
- **3-day grace.** For up to 3 days after first login an account is protected by
  password + emailed code (+ 24 h remembered browser), not TOTP.
- **Commercial authority is server-asserted**, not cryptographically attested by
  an owner device; the server (and its database) is fully trusted for it.
- **TOTP is phishable** in real time (unlike a device-bound key or WebAuthn).

What is **stronger or simpler**: no browser key custody to lose, no fail-closed
verifier blocking onboarding, a familiar authenticator-app flow, and money
actions now need a fresh second factor on every operation.

## Schema (migrations 0049 and 0050, additive)

New: `parent_mfa_state`, `parent_mfa_enrollment_tickets`, `parent_mfa_recovery_codes`,
`parent_mfa_step_up_grants`, `parent_account_security_events`;
`families.provisioned_for_account_id` (UNIQUE).
**Retired, not dropped:** `parent_genesis_challenges`,
`parent_genesis_step_up_authorizations` (0044/0045). Their production presence
and row counts are **PENDING read-only reconciliation**; source history does
not prove current production state. `family_authority_*` tables are kept (shared
owner-chain engine and protection-alert resolver). Cleanup of the retired tables
is a later, separately authorized migration.

## Gates

The external crypto review gates (`CRYPTO_SECURITY_REVIEW`,
`PRODUCTION_CRYPTO_SECURITY_REVIEW`, `CRYPTO_ACTIVATION`) remain open and
unchanged in scope for **device/envelope signature verification** (child-device
runtime identity, signed policy delivery, pairing). They **no longer gate the
Parent login, family provisioning, MFA or commercial-owner journey**, which uses
no device signature verifier.

## Microsoft sign-in prompt (source and Azure configuration checked 2026-09-25)

Parent Web and Parent API contain no MSAL package or Parent authentication call
to a Microsoft identity endpoint. The only `login.microsoftonline.com` source
path is backend Microsoft Graph email delivery. Azure App Service Authentication
was read-only checked and is disabled on `pcaParent` and `pcaSafe`. A fresh
Parent login page rendered without redirecting to Microsoft, but browser network
request capture was not independently available in this review, and the user
login was not submitted. Record `MICROSOFT_AUTH_DEPENDENCY = NONE` only after the
fresh private-browser network check and owner acceptance confirm no identity
requests or popup. The operator's displayed Microsoft account alone does not
prove the cause of the popup.
