# Protocol vocabulary and compatibility conventions

Authority: architecture document 22, with security properties defined by document 09. This is a representation-neutral foundation; it does not define endpoints, JSON fields, RPC methods, or cryptographic suites.

## Terms

| Term | Meaning in this foundation |
|---|---|
| Family envelope | The signed, authenticated-encrypted logical family message described in document 22. |
| Service control plane | Account, license, enrollment-token, public-key directory, release metadata, and opaque Relay routing functions. It is not family-control authority. |
| Family E2EE plane | Family-authorized messages carried as opaque encrypted payloads. Recipients independently verify authorization and acceptance conditions. |
| Opaque identifier | A routing or correlation value that is not a readable central-schema identifier. |
| FTS | Signed Family Trust Set. It is independently verified by a recipient; Relay delivery is not authorization. |
| Trust/key epoch | The trust-set and data-key version values used to reject stale or revoked authority. |
| Semantic version | The message-specific monotonic version used to prevent an ordinary lower-version policy from applying. |

## Logical family envelope

Every representation must preserve, and signature coverage must cover, the following logical fields exactly:

- protocol major and minor
- globally unique message ID
- opaque family and sender device identifiers
- exactly one recipient target: opaque device identifier or recipient group
- sender key ID and catalogue message type
- trust-set and key epochs
- exactly one anti-replay mechanism: sender sequence or replay nonce
- issued-at and expiry timestamps
- semantic version
- optional correlation ID
- authenticated-encrypted payload
- signature over all preceding logical envelope fields

No field name, serialization grammar, transport, authentication scheme, cipher suite, key material, or payload schema is selected here.

## Compatibility conventions

- A recipient rejects an incompatible protocol major before decrypting or applying content, retains the last-valid policy, and enters upgrade-required/degraded presentation.
- A higher unknown protocol minor is acceptable only when all required fields and message semantics are known, signature coverage remains complete, and unknown fields are explicitly extensible and non-security-semantic.
- Unknown message types and unknown security semantics are rejected.
- New message types require a documented authorization matrix, retention classification, privacy review, negative tests, and source/capability review before use.
- Parsing limits for size, depth, and fields are mandatory at implementation time; malformed or oversized input is rejected without verbose logging.
- Arrival order is not semantic order. A future policy waits for signed predecessors until expiry and never skips an intervening version.
- A signed rollback is its own time-bounded message type and is never inferred from a lower ordinary policy version.

## Explicit non-goals

This foundation does not introduce a central plaintext API, family history endpoint, searchable activity store, diagnostics payload, remote-command surface, crypto implementation, or real test data.
