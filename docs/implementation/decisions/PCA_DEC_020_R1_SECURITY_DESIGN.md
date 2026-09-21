# PCA-DEC-020-R1 — Family Trust / First-Device Security Design

Status: SOURCE-ONLY DESIGN BASELINE — NOT PRODUCTION APPROVED

This document replaces the rejected server-generated first-device bootstrap
design. It is an implementation contract for source and non-production tests;
it does not authorize production migration, deployment, account remediation,
or verifier activation.

## A. Security goals

1. A family trust root is created only after a real Parent-controlled client
   proves possession of the private key corresponding to the proposed DSK.
2. Email/password, verified email, a service session, and a device identifier
   are never sufficient by themselves for cryptographic authority.
3. Every sensitive device-authority operation is account-, family-, device-,
   key-, protocol-, and challenge-bound and fails closed on uncertainty.
4. Revoked devices/keys, stale revisions, stale epochs, replayed challenges,
   and forked heads are rejected transactionally.
5. Normal Parent RBAC remains separate from the internal cryptographic trust
   root. A new family creator receives `ADMINISTRATOR`, never a user-facing
   cryptographic `OWNER` role.

## B. Threat model

The design defends against an attacker who has a password, verified mailbox,
stolen session, guessed `actorDeviceId`, copied public metadata, replayed
proof, revoked key, stale attestation, or a concurrent competing writer. It
does not treat a compromised endpoint that still holds a live private key as
safe; revocation and recovery are required responses to that event.

## C. Client key model

The selected wire model is a client-held ECDSA P-256 signing key:

- Web Parent reuses the existing Web Crypto `ECDSA/P-256` trusted-endpoint
  implementation with a non-extractable private `CryptoKey`. The current
  source path keeps that handle in memory only; any structured-clone/IndexedDB
  persistence must be a separately reviewed follow-up.
- Android and iOS use their platform secure-key facilities behind the same
  protocol adapter. The private key never enters PCA JavaScript, the backend,
  logs, or a database.
- Public-key representation is the existing SEC1 uncompressed P-256 point
  (`0x04 || x || y`) encoded as unpadded base64url. The backend strictly
  parses exactly 65 bytes. Private-key export is forbidden.
- A browser that cannot provide the required non-extractable signing
  capability cannot complete genesis; there is no insecure fallback.

WebAuthn/passkeys remain a high-assurance step-up and recovery option, but are
not silently substituted for PCA DSK signatures: WebAuthn signs the WebAuthn
client-data/authenticator-data structure, not an arbitrary PCA authority
payload. A future WebAuthn-backed profile must define a separate verifier and
wire contract.

## D. Genesis challenge protocol

The backend issues a `GENESIS_V1` challenge only to a verified Parent session
with no family scope. The challenge stores:

- challenge ID and 32-byte random nonce;
- account ID and service-account ID;
- candidate device ID and candidate DSK key ID;
- canonical SEC1 public key;
- operation and protocol version;
- created/expiry timestamps and consumed timestamp.

The candidate device and key IDs are server-generated identifiers only. The
public key is supplied by the client and is never replaced by a backend key.

The client signs the canonical `GENESIS_PROOF_V1` payload and submits the
challenge ID, candidate IDs, SEC1 public key, and signature. The backend checks
exact challenge equality, expiry, account/session ownership, operation,
protocol, key format, and P-256 proof before atomically consuming the
challenge and persisting the genesis anchor, revision-1 attestation, family
scope, and Administrator membership.

Challenge consumption and genesis persistence must be one transaction or a
transactionally equivalent idempotent protocol. A consumed challenge can
never be used again.

## E. Canonical signed payload

`GENESIS_SIGNED_PAYLOAD_V1` is a UTF-8 byte string made from fixed-order
length-prefixed fields. For each field `f`, append `${byteLengthUtf8(f)}:${f}`
with no separators or JSON serialization.

Field order:

1. `PCA_FAMILY_GENESIS_PROOF_V1`
2. `protocolVersion` as an ASCII unsigned decimal integer
3. `operation` as ASCII `GENESIS`
4. `accountId`
5. `serviceAccountId`
6. `familyId`
7. `deviceId`
8. `dskKeyId`
9. canonical SEC1 public key
10. challenge ID
11. nonce as unpadded base64url
12. created-at as UTC `Date.toISOString()`
13. expires-at as UTC `Date.toISOString()`

The signature algorithm is ECDSA P-256 with SHA-256 and the Web Crypto
IEEE-P1363 `r || s` signature encoding. DER signatures, Ed25519 signatures,
and algorithm fallbacks are rejected.

No optional fields exist in V1. Future versions require a new domain
separator. The payload binds account, family, device, key, protocol, and
challenge context, preventing cross-account, cross-family, cross-device,
cross-key, cross-protocol, and challenge replay.

Browser, Android, iOS, and backend implementations must pass the same
published non-production vector in
`PCA_DEC_020_R1_CANONICAL_VECTOR_V1.json`. No production key material is used
in vectors; the fixture publishes only a test public key and signature.

Request proofs use a separate `PCA_FAMILY_AUTHORITY_REQUEST_PROOF_V1` domain
and fixed fields: protocol version, operation, service-account ID, family ID,
device ID, key ID, public key, challenge ID, nonce, request-body digest, and
issued/expiry timestamps. The server challenge record must match every field
and be atomically consumed before the operation is authorized.

## F. Request-level proof of possession

Ordinary authenticated reads require the Parent service session and family
scope. Sensitive trust operations require a fresh, operation- and request-
bound device challenge-response. The server derives the actor device from the
verified proof; `actorDeviceId` is never accepted as an authority claim from
request data. R1's engine rejects legacy identifier-only calls and also
rejects a signed proof unless an explicit server-side challenge-consumption
verifier is supplied.

| Operation | Required assurance |
|---|---|
| Normal Parent read | Parent session + family scope |
| Ordinary Parent mutation | Parent session + RBAC + CSRF |
| Genesis | Verified Parent session + GENESIS_V1 proof |
| Owner transfer/revocation | Active trusted-device proof + current Owner attestation + step-up where policy requires |
| Recovery/root replacement | Approved recovery ceremony + fresh device proof + step-up |

## G. Active key registry and epochs

Authority verification resolves the signer through the authoritative device
directory. It requires an existing device in the intended family/account,
permitted device status, an ACTIVE DSK key, matching key ID, matching public
key, and DSK purpose. A DEK, revoked device, revoked key, unknown key, or
public-key substitution fails closed.

The durable current head stores the required trust-set and key epochs. A
transition must be at least the current required epoch and must follow the
protocol's exact progression rule. A downgrade or stale epoch is rejected in
the same CAS transaction as the head update.

## H. Recovery

The default recovery model is not silent password/email replacement. Recovery
requires either another active trusted device or a separately generated,
offline recovery envelope/key held by the account owner, plus a fresh,
high-assurance account step-up. A mailbox+password alone cannot replace the
root. Zero-trusted-device recovery is explicitly policy-gated as
`ZERO_TRUSTED_DEVICE_RECOVERY=MANUAL_HIGH_ASSURANCE_SUPPORT_PROCESS` for this
source lane. It is a support-controlled, out-of-band identity ceremony that
does not issue a root key, accept email/password as root proof, or bypass a
new genesis ceremony. The support process must be separately approved and
logged before use; it is not an automatic production capability.

Lost or compromised devices are revoked; their keys cannot authorize new
attestations. Browser storage loss is treated as device loss, not as permission
to recreate a root automatically.

## I. Failure modes

Malformed key/signature, missing challenge, expired challenge, consumed
challenge, wrong account/family/device/key, revoked key/device, wrong DSK
purpose, altered payload, stale revision/epoch, forked head, failed CAS, or
any verifier exception returns a safe denial. No fallback generates a key or
upgrades a session.

## J. Migration and compatibility

Migration 0043 remains separate and is not executed by R1. R1 includes source
migration 0044 for genesis challenges, operation/request challenge
consumption, and durable epoch floors. It is additive-only source material;
production migration is a later owner-gated operation. Existing null-family
accounts are not repaired by this lane.

The existing server-generated `generateEphemeralGenesisDeviceKeyPair()` path
is test/reference-only and must be removed from the production registration
path before any reviewed verifier can be activated.

## Internal review outcome

The design is internally coherent for source implementation. The following
items remain external gates before production approval: independent human
cryptographic review, cross-client vectors on supported browser/mobile
implementations, recovery assurance review, production schema migration,
account remediation, and reviewed production verifier selection.

## R1 implementation gate

Source primitives and negative tests are present, but R1 is **NOT READY** for
external activation or production approval. The family-genesis ceremony is
now composed through one atomic repository boundary, and sensitive HTTP
routes require a session-bound, request-bound proof. Recovery ceremonies,
native client adapters, disposable-MySQL execution, independent human
cryptographic review, production migration, account remediation, and reviewed
production verifier selection remain open.
