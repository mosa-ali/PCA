# Ordinary Family Trust Set transport v1

Coordinator integration contract for the owner-authorized mobile completion wave, based on the existing canonical codec, ordinary single-owner acceptance engine and transactional epoch store. This document does not constitute independent human crypto approval or production activation. First-device bootstrap and all-device-loss recovery are separate protocols.

## Scope and endpoints

Base path: `/api/device/families/:familyId/trust-set/epochs`.

Every operation requires a verified device session bound to the requested family and device. Parent/browser sessions and caller-supplied device identifiers confer no authority. Submission and exact-request status require the current accepted ACTIVE OWNER; head reads require current ACTIVE accepted membership. Authentication or membership lookup failures fail closed.

| Method/path | Meaning |
| --- | --- |
| POST base | Submit an ordinary signed successor, never establish epoch 1 |
| POST base + `/status` | Inspect the exact immutable submission without writing |
| GET base + `/head` | Read the consistent signed accepted head |
| GET base + `/records/:trustSetEpoch` | Read one indexed signed accepted record for verified predecessor-chain catch-up |

POST bodies contain exactly `canonicalEpochBase64` and `signatureBase64`: standard padded canonical base64, with bounded decoding and decode/re-encode identity checks. Signature bytes are the existing 64-byte P-256 P1363 representation; the backend converts to its existing internal unpadded base64url signature representation. No caller timestamps, signer identifiers, role declarations or receipt claims are accepted as authoritative metadata. Epoch timestamps reside in the signed canonical bytes; server receive time is server-owned.

## Records and results

A signed record DTO contains exactly `canonicalEpochBase64`, `signatureBase64`, `signerDeviceId`, `signerKeyId`, `trustSetEpoch`, `keyEpoch`. Projected metadata must agree with strictly decoded stored bytes and the accepted signer. Stored corruption, missing durable floors or inconsistent head/key-epoch state yields unavailability, never a fabricated empty head.

Submission success: `{ outcome: "ACCEPTED" | "IDEMPOTENT_MATCH", acceptedEpoch: record, acceptedHead: record }`.

Exact-request status: `{ outcome: "ACCEPTED" | "NOT_ACCEPTED" | "CONFLICT", acceptedEpoch: record | null, acceptedHead: record }`. ACCEPTED requires identical immutable canonical bytes and signature in the requested family/epoch. CONFLICT identifies different content at that epoch. NOT_ACCEPTED is a read-only observation, not permission to discard or re-sign a durable pending request. Accepted-head reads return `{ acceptedHead: record }`.

Reuse the existing acceptance engine's signer, structural, epoch/keyEpoch and FDEK requirements. Signer authority comes from the prior accepted ACTIVE OWNER. The existing ordinary engine also requires the candidate's ACTIVE OWNER to match that prior owner; ordinary owner transfer is not introduced by this transport. Recheck expected head and durable floors atomically at append. Exact historical replay may acknowledge the immutable original record after current authenticated-owner scope validation without appending or regressing the current head. Conflicting or stale candidates never overwrite accepted records. There is no second genesis, parent-signed epoch, plaintext key delivery or client self-activation.

## Durable mobile behavior

Validate the next canonical epoch against locally trusted accepted state, sign once with the authorized hardware DSK, and atomically persist the exact bytes/signature before any send. Preserve exact pending custody through network errors, lost responses, restart and ambiguous status. Retry those same bytes; never re-sign a pending candidate. Serialize concurrent attempts and use exact-record comparisons when clearing pending custody.

An HTTP response or server projection alone is not cryptographic authority. Validate canonical bytes, family, signer signature against the prior trusted owner, supported epoch bounds, predecessor linkage and monotonic local floors before persisting a new trusted head. A client lacking the required predecessor/validated chain must retain pending state and report unavailable reconciliation; it must not jump to a server head. Indexed history reads require current ACTIVE accepted membership and return `{ acceptedEpoch: record }`; absent records return 404, while corruption/read failures remain unavailable. For catch-up, walk signed `supersedesEpoch` links backwards with a bounded budget, reject cycles or non-decreasing predecessors, then verify/apply the resulting chain forwards from locally trusted state. Do not assume contiguous epoch numbers: the existing ordinary engine permits monotonic skipped epochs. Separate acknowledgement of an exact historical request from application of a later accepted head. A terminal rejection may be surfaced without erasing independently required keys or accepting an unverified head.

Required tests cover shared canonical vectors, exact replay, conflict, rollback, cross-family/device scope, current-owner revocation, consistent stored-state checks, CAS races, response loss, restart, persistence failure, malformed status and signature/base64 encoding. Production composition, device ACTIVE receipts and physical-device evidence remain separately reviewed integration gates.
