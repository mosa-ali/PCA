# 18 — Parent Control Panel and Family RBAC

## 1. Security model

This document designs `PCA-FR-090`–`PCA-FR-094` and the role-management surface required by `PCA-FR-095`; it consumes the family trust set/key epochs in docs 08–09. Role-based access control is enforced on the local parent endpoint and by every receiving child/parent endpoint that verifies a signed control envelope; UI hiding is never authorization. A role grant/revoke is a signed trust-set change, audited, versioned, and subject to offline convergence—not an atomic distributed promise.

**PCA-FR-090.** Provide a family dashboard with available child status, screen time, battery/last-seen, and alerts.
**PCA-FR-091.** Provide per-child policy pages for the documented control areas.
**PCA-FR-092.** Provide an activity timeline from locally held/E2EE family data, never a readable PCA-server copy.
**PCA-FR-093.** Provide privacy/data-retention settings directly in the panel.
**PCA-FR-094.** Provide alert/notification preferences including email destination.
**PCA-FR-095.** Provide a role-management screen for Administrator/Viewer invitation/removal and ownership-transfer initiation.

## 2. Roles and authority

Exactly one Family Owner exists. Ownership transfer is a two-party, audited, step-up flow defined by doc 21; it creates a new trust-set epoch and cannot be emulated by changing a role label. Administrators are trusted parents with day-to-day policy authority. Viewers can see family data the Owner has granted them but cannot alter policy or retrieve secrets. A child has no parent role and cannot self-elevate.

| Operation | Owner | Administrator | Viewer | Child |
|---|---:|---:|---:|---:|
| View permitted family/child dashboard | yes | yes | read-only | own transparency only |
| Edit limits, schedules, filters, prayer/location policy | yes | yes | no | request only |
| Approve bonus/unblock/exception | yes | yes | no | request only |
| Add Viewer / remove non-owner parent | yes | configurable policy + step-up | no | no |
| Add Administrator / change any role | yes + step-up | no | no | no |
| Create / list child profiles (opaque central registry; the readable label stays parent-local) | yes | yes | read-only | no |
| Change retention / delete history / export | yes + step-up | no by default | no | no |
| Remove/revoke device or disable protection policy | yes + step-up | configurable + step-up | no | no |
| Transfer ownership / reveal or regenerate recovery material | yes + step-up | no | no | no |

An Owner may choose whether an Administrator can add/remove a Viewer or revoke a child device; the safe default is off. Policy configuration is itself E2EE, signed, and auditable. No ordinary role can disclose a recovery secret or bypass recovery controls.

## 3. Control-plane sequence and offline state

Before a parent action, the panel verifies authenticated device state, selected child scope, role, current trust-set epoch, and step-up freshness. It creates a signed, expiry-bounded operation with unique action ID and idempotency key. Receiving devices reject unauthorised signers, expired/replayed envelopes, and unacceptable older epochs as docs 05/09 require. The family audit event is encrypted to authorized devices.

`PENDING_DELIVERY` means an authorized request exists but has not been acknowledged by a target. `APPLIED` means a target acknowledged the exact action/epoch. `PARTIALLY_APPLIED`, `DEVICE_OFFLINE`, `EPOCH_STALE`, `REVOKED`, and `FAILED` are user-visible. A revoke/rotation protects future authority once a device learns the epoch; it cannot remove historical data from a stolen offline device. The panel must not show success for every target merely because the initiator accepted the request.

## 4. Step-up and safety

Step-up uses platform-supported parent authentication (biometric/device credential and, where configured, an additional family-authentication factor). It is required for the sensitive table entries, re-authenticated after a short session, and binds the confirmation screen to the action, targets, and reason. It does not reveal secrets in notifications or diagnostics. Emergency calling/SOS is a safety floor and no panel action removes it.

## 5. Audit contract

Every relevant action creates an immutable-in-practice append-only family audit record: opaque event ID; action type; actor member/device ID; target scope; authorization role; trust-set/policy revision; UTC timestamp; client monotonic sequence where available; result/status; target acknowledgements; optional reason category; and correlation/action ID. Free text is minimized, length-limited, sanitized, E2EE only, and excluded from push/email/logging. Required examples: role invitation/accept/revoke, Owner transfer started/confirmed/cancelled, step-up failure/success, policy/retention/location change, export/delete, device lifecycle transition, recovery, and denied authorization attempt.

Audit records follow family retention unless their security minimum is separately defined in doc 11; deletion/retention changes themselves are auditable. They are not PCA server audit logs and do not carry activity plaintext. Clock anomalies are marked rather than silently trusted.

## 6. Panel information architecture and verification

Navigation: Family dashboard; child overview; screen/app/web/YouTube controls; activity; location; prayer; schedules; alerts; requests; parent members; privacy/data; security/recovery; subscription; settings. Each card shows capability state, last acknowledged policy revision, and relevant `pending/offline` status.

- Test every role/action pair, direct deep link, stale UI cache, modified envelope, replay, revoke while offline, and ownership-transfer interruption.
- Assert a Viewer cannot obtain an export URL/key through UI, API envelope, notification, or cached screen.
- Assert audit records contain action metadata but no URLs, locations, activity detail, recovery secret, or family plaintext in infrastructure logs.
- Test child request metadata and approval notifications with language independence/RTL labels (doc 20).

## 7. Official-source handoff for doc 33 (verified 2026-08-10)

| Proposed source ID | Official source | Claim/capability label | Affected requirements |
|---|---|---|---|
| SRC-E-RBAC-001 | [NIST IR 6192: Revised Model for RBAC](https://csrc.nist.gov/pubs/ir/6192/final) | RBAC mediates resource access through organisational roles; PCA applies least privilege with endpoint cryptographic enforcement. | PCA-FR-090–094 |
