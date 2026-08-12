# PCA Crypto Review Findings Log — Template

This is a blank template. Copy the row format below for each finding the reviewer records against `PCA_CRYPTO_REVIEWER_CHECKLIST.md`, `PCA_CRYPTO_THREAT_MODEL.md`, or any independent observation made during review. Do not pre-fill severities or statuses — every field below is a placeholder for the reviewer to complete.

## Finding log

| ID | Severity | Area | Checklist/Threat-Model Ref | Description | Recommendation | Status | Owner | Date |
|---|---|---|---|---|---|---|---|---|
| F-001 | | | | | | | | |
| F-002 | | | | | | | | |
| F-003 | | | | | | | | |

### Field definitions

- **ID**: Sequential, e.g. `F-001`, `F-002`. Never reused, even if a finding is later withdrawn — withdrawn findings keep their ID with `Status = WITHDRAWN` and a note explaining why, so the ID sequence itself is an audit trail.
- **Severity**: One of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFORMATIONAL`. Define your own severity rubric explicitly before using this table (e.g. does `CRITICAL` mean "blocks any production activation" or "exploitable today"?) and record that rubric once, above the table, rather than re-deriving it per finding.
- **Area**: One of the source-map categories from `PCA_CRYPTO_SOURCE_MAP.md` (e.g. `Envelope signature verification`, `Recovery KDF`, `FTS acceptance`, `Sender-role authorization`, `Nonce discipline`) or `Cross-cutting` if it spans more than one.
- **Checklist/Threat-Model Ref**: The specific item this finding responds to, e.g. `Checklist A3`, `Threat Model #8 (rollback attacker)`, or `Independent` if it was not anticipated by either document.
- **Description**: What was found. State the concrete fact, not just a conclusion — cite the exact file/line/commit if applicable, mirroring the citation discipline used throughout this review package.
- **Recommendation**: What should change. Specific enough that a future implementer knows exactly what to do, not "improve X."
- **Status**: One of `OPEN`, `IN_PROGRESS`, `RESOLVED`, `ACCEPTED_RISK`, `WITHDRAWN`, `DEFERRED`. `ACCEPTED_RISK` and `DEFERRED` both require a one-line justification recorded in the Description or a linked note — an empty justification is not an acceptable use of either status.
- **Owner**: Who is responsible for acting on this finding (a person or role, not a team name alone).
- **Date**: Date the finding was recorded (`YYYY-MM-DD`). Add a `Resolved Date` column if your process needs one.

## Sign-off block (fill in only once every OPEN/IN_PROGRESS finding is resolved or explicitly accepted)

- **Reviewer name:**
- **Reviewer role/credential:**
- **Review completion date:**
- **Total findings recorded:**
- **Findings by final status:** CRITICAL open: ___ / HIGH open: ___ / MEDIUM open: ___ / LOW open: ___
- **Overall verdict:** ☐ APPROVE FOR PRODUCTION ACTIVATION ☐ APPROVE WITH CONDITIONS (list below) ☐ REJECT — DO NOT ACTIVATE
- **Conditions (if any):**
- **Signature/attestation:**

## Notes for use

- This log is additive — never delete a row once recorded, even if superseded; use `Status = WITHDRAWN` instead, per the ID rule above.
- This template intentionally ships empty. Any filled-in example content in a future revision of this file should be clearly marked `EXAMPLE — DELETE BEFORE USE` and kept out of the real log's table.
