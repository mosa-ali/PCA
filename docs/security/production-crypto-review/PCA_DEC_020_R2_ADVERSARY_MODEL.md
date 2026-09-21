# PCA-DEC-020-R2 adversary model

| Adversary action | R2 control | Evidence/status |
| --- | --- | --- |
| Reuse a normal authenticated session for family genesis | Dedicated `FAMILY_GENESIS` record bound to the opaque AuthService session ID hash | Covered by `pcaDec020R2.test.mjs`; no step-up means `UNAUTHORIZED` |
| Use password alone, mailbox code alone, or a different session | Password re-auth and one-time mailbox code are required in addition to the exact current session | Covered by `pcaDec020R2.test.mjs` |
| Replay a verified genesis authorization | Durable `verified_at`/`consumed_at` state and atomic consumption inside the genesis transaction | MySQL transaction path implemented; disposable/in-memory replay coverage present |
| Submit an expired, stale, future-dated, or overlong attestation | Server-time skew, freshness, minimum TTL, maximum TTL, and `expiresAt > now` checks | Shared temporal policy tests pass |
| Use a PAIRED/PENDING/REVOKED device with an ACTIVE key row | Authority resolver requires `devices.status = ACTIVE` and an exact ACTIVE DSK | Resolver matrix test passes |
| Malleate ECDSA `s` or alter base64url unused bits | Low-S scalar validation, fixed 64-byte P1363, strict canonical base64url round-trip | R2 signature/wire-format tests pass |
| Reach the old non-atomic bootstrap path in production | No production call site; main composition uses ParentGenesisService and MySQL atomic repository | Composition test passes |
| Recover a browser private key from storage or logs | Non-extractable in-memory WebCrypto handle; no browser storage/export path | Browser key policy documented; reload requires re-pairing |
| Claim native interoperability from Node-only evidence | Android/iOS production adapters remain fail-closed | Native blocker remains open |

Production activation remains blocked pending independent review, native
interop, controlled disposable-DB migration proof, and owner-authorized
production gates.
