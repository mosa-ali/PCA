# PCA-DEC-020-R1 — Existing Null-Family Account Remediation Runbook

Status: PREPARED SOURCE-ONLY RUNBOOK — NOT EXECUTED

This runbook applies only to the two already identified verified Parent
accounts whose `parent_accounts.family_id` is `NULL`. It is deliberately a
client-mediated remediation plan; it is not raw SQL and it does not authorize
production writes.

## Owner-controlled ceremony

1. The owner signs in through the approved Parent Web application and confirms
   the account identity privately.
2. The approved client generates a fresh non-extractable P-256 DSK in browser
   Web Crypto or the native platform secure-key facility. The private key is
   never sent to PCA, support, logs, or a database.
3. The client requests `/api/parent/genesis/challenge` with only the public
   key and platform. The authenticated, verified session is bound to the
   challenge.
4. The client signs the canonical GENESIS_V1 proof, the family genesis anchor,
   and the revision-1 owner attestation using the same private key.
5. The client submits `/api/parent/genesis/complete` with the signatures,
   epochs, and bounded validity dates. The server verifies every binding and
   commits challenge consumption, family, device, DSK, scope, membership,
   account binding, anchor, attestation, and chain head in one transaction.
6. The owner verifies the authenticated session reports the new family scope
   and `ADMINISTRATOR` membership. A failed or interrupted transaction must
   leave every effect absent and the challenge reusable until expiry.

## Support path

If the owner cannot complete the ceremony because no trusted endpoint remains,
use only the separately approved
`MANUAL_HIGH_ASSURANCE_SUPPORT_PROCESS` policy. Support does not run a direct
`family_id` update, issue a root key, request credentials, or bypass the
GENESIS_V1 ceremony.

## Release gate

No production account remediation occurs until PCA-DEC-020 review,
migration-0044 execution approval, production verifier approval, and owner
authorization are independently recorded. This runbook is evidence of
preparedness only.
