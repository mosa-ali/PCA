# PCA Wave 02C-R2 — browser HPKE external review package

**Disposition requested:** independent review of the exact `@hpke/core@1.9.0` package and the PCA adapter/profile in this isolated candidate. This is not an internal approval and does not authorize install into authoritative `pca-dev`, production wiring, or gate activation.

## A. Threat model

Assume an attacker can alter, replay, truncate, reorder, downgrade, or route an encrypted FamilyEnvelope; substitute family/device/recipient/epoch metadata; cause concurrent seal requests; and observe service-visible envelope metadata and failures. The service must remain unable to decrypt family content or inspect the E2EE `POLICY_RECEIPT`. The device/application layer must authenticate the existing sender DSK and scope/epoch/replay/expiry before exposing plaintext. HPKE Base authenticates the recipient key and ciphertext, not the sender; sender authenticity remains the existing DSK signature check. The browser runtime, WebCrypto provider, operating system, and browser process are trusted computing base. XSS, malicious extensions, compromised browser/runtime, and endpoint compromise are out of cryptographic scope but must be considered in production custody review.

## B. Exact suite/profile

The wire profile, frame layouts, byte encodings, AAD, key derivation, lifecycle, downgrade rejection, and candidate rotation rules are specified in [PROFILE.md](PROFILE.md). RFC 9180 Base mode is used only to wrap a device-addressed FDEK. PCA content uses the separately specified FDEK-derived HKDF-SHA256/AES-128-GCM one-use-key profile. The reviewer must expressly assess this separation and whether it meets DEC-020 and cross-platform requirements. This candidate does not claim that the content profile is RFC 9180 HPKE.

## C. Library/version/hash provenance

| Item | Value |
|---|---|
| Package | `@hpke/core` |
| Version | `1.9.0` exact, no semver range |
| Registry tarball | `https://registry.npmjs.org/@hpke/core/-/core-1.9.0.tgz` |
| SHA-256 | `E594D5B2EC00A124078717B43967C0075E5E1947A9C16AF719CEE0516E250EEC` |
| npm shasum | `4eced0597787f51fdb53ad515c3d47a3abc9fe3a` |
| npm SRI | `sha512-pFxWl1nNJeQCSUFs7+GAblHvXBCjn9EPN65vdKlYQil2aURaRxfGMO6vBKGqm1YHTKwiAxJQNEI70PbSowMP9Q==` |
| Repository | `https://github.com/dajiaji/hpke-js.git` |
| npm `gitHead` source commit | `f9fbe3d5a6404f516df859e472c078c0d08e8057` |
| License | MIT |
| Runtime transitive dependency | `@hpke/common@1.10.1`, integrity pinned in `parent-sdk/browser-runtime/package-lock.json` |
| Independent audit for exact package version | NONE established |

Candidate qualification record:

```text
PACKAGE = @hpke/core
VERSION = 1.9.0
STANDARD = RFC 9180, candidate profile DHKEM(P-256,HKDF-SHA256) / HKDF-SHA256 / AES-128-GCM / Base
INDEPENDENT_AUDIT = NONE ESTABLISHED
AUDIT_DATE = N/A
AUDIT_SCOPE = N/A
AUDIT_VERSION_MATCH = NO
KNOWN_SECURITY_ADVISORIES = GHSA-73g8-5h73-26h4 / CVE-2025-64767; <=1.7.4 affected, >=1.7.5 patched per advisory
WEBCRYPTO_BACKEND = YES, package native implementation uses WebCrypto
DEPENDENCIES = @hpke/common 1.10.1 (integrity pinned)
LICENSE = MIT
MAINTENANCE = package release notes identify 1.9.0 release on 2026-03-08; source commit recorded above
SUPPLY_CHAIN = npm registry tarball with recorded SHA-256/SRI and npm gitHead; independent provenance attestation not established
DECISION = NEEDS_EXTERNAL_AUDIT
```

Current package source release notes list 1.9.0 dated 2026-03-08; that is maintenance evidence, not an audit. The upstream README's general claim of no external module dependencies conflicts with the published package manifest/lock, which includes `@hpke/common`; this candidate treats the published manifest and lock as authoritative and requires reviewer confirmation.

The candidate lockfile pins both package resolutions and integrity values. The tarball is retained as `parent-sdk/browser-runtime/hpke-core-1.9.0.tgz` for reviewer reproduction. Npm package metadata identifies the repository and `gitHead`; the versioned source mapping must be re-confirmed by the external reviewer before acceptance. No package is installed in the authoritative `pca-dev` worktree.

## D. Historical advisory

Review [GHSA-73g8-5h73-26h4 / CVE-2025-64767](https://github.com/dajiaji/hpke-js/security/advisories/GHSA-73g8-5h73-26h4). The advisory states affected versions `<=1.7.4`, patched versions `^1.7.5`, and describes concurrent `SenderContext.seal()` calls racing the sequence number. The 1.9.0 package source contains a per-context mutex around seal/open and increments sequence after the operation. Candidate tests exercise concurrent calls on one sender context and concurrent independent one-shot PCA seals. This is evidence that the candidate version contains a mitigation and that current adapter calls do not reuse a context; it is **not** an independent audit and does not prove absence of other nonce/context issues.

PCA adapter calls the package one-shot `CipherSuite.seal()` per new FDEK wrap; that creates a new context and performs one seal. A retry layer is not implemented here. The production integration must persist and retransmit byte-identical sealed payload for exact retry, and must never reuse a context or retry different plaintext under a prior message's AEAD key/nonce. Concurrent contexts are tested but do not establish random-number generator quality or the uniqueness guarantee beyond the reviewed WebCrypto provider.

## E. PCA browser adapter source

Candidate source: `parent-sdk/browser-runtime/src/familyEnvelopeCryptoProfileV1.ts`.

It imports only public `@hpke/core` API classes, uses WebCrypto, consumes caller-held recipient public `CryptoKey`, requires a non-extractable private key for open, and passes the `CryptoKeyPair` so the package does not need to derive/export a public key from the private key. It does not export private keys, add logging, or expose lower-level secrets. It normalizes crypto errors to `PCA_ENVELOPE_CRYPTO_FAILED`. The source file is not exported by `src/index.ts` and is not wired into production composition.

## F. Key custody design

No approved browser DEK/FDEK custody or lifecycle exists in this candidate. The adapter accepts a public recipient key for wrapping and provides an open function only as a vector/reference seam. It does not generate/register DEKs, persist private keys, obtain FDEKs, or keep FDEKs across reloads. A non-extractable WebCrypto `CryptoKey` is necessary but is not itself a complete PCA browser key-custody approval. Browser production remains closed until enrollment, origin/session binding, key persistence/recovery, and lifecycle are independently reviewed.

Android API 31+ remains the authorized production scope for mobile ECDH custody; Android API 26–30 remains fail-closed for activation. iOS remains native Secure Enclave/Keychain custody. This package introduces no mobile code and no mobile suite change.

## G. Nonce/context lifecycle

HPKE uses one context per one-shot `seal`; adapter does not expose/reuse a sender context. A new seal creates a fresh HPKE encapsulation. The package's public reusable context API is separately exercised under concurrency for the historical advisory. Content encryption uses one fresh HKDF salt, one fresh 96-bit WebCrypto nonce, one derived key, one AES-GCM invocation. Production retry behavior is a required integration invariant: persist ciphertext once and resend it byte-for-byte; a conflict/new plaintext uses a new message identity and fresh derivation. Candidate tests verify independent HPKE encapsulations are distinct in 16 concurrent operations, but do not claim a deterministic proof of entropy quality.

## H. Info/AAD construction

Exact byte rules are in PROFILE.md. `info` is fixed ASCII `PCA_FDEK_HPKE_INFO_V1`. HPKE AAD is the fixed ordered netstring transcript of signed metadata, payload kind and profile. Content AAD additionally binds base64url-no-padding salt and nonce. The existing outer DSK signature still covers canonical envelope metadata and the complete payload. No policy plaintext or family receipt text is added to service-visible metadata.

## I. Error/failure model

Malformed version/frame/suite, invalid metadata, scope mismatch, wrong recipient key, AAD/info mismatch, truncated/oversized data, or AEAD failure is rejected and normalized to one generic PCA error. Caller must verify DSK/signature, Trust Set, family/recipient scope, epochs, replay and expiry before decryption. The adapter does not perform those checks itself. Failure paths do not return plaintext. No fallback suite, plaintext mode, or downgrade is available.

## J. Cross-platform vectors

The fixed synthetic vector file is `parent-sdk/browser-runtime/test/vectors/pca-family-envelope-v1.json`. It contains a test-only recipient JWK/private scalar, synthetic FDEK, exact `enc`, ciphertext, frame, `info`, AAD and content plaintext. Those values are intentionally public test fixtures; they are not user/family keys. Browser candidate vector tests pass. Android and iOS have not consumed these vectors in this branch, and their interoperability is **NOT RUN**. Native/reference vector consumption remains an external-review qualification item; do not report cross-platform vector pass.

## K. Mutation/negative tests

`parent-sdk/browser-runtime/test/familyEnvelopeCryptoProfileV1.test.mjs` covers valid wrap/content open, round trips, wrong HPKE info, wrong family/device/recipient/key epoch/Trust Set epoch, wrong recipient key, AAD/ciphertext/tag/enc/nonce mutations, truncation, oversize, version downgrade, epoch N to N+1 separation, independent concurrent seals, and same-context concurrent `seal()` calls. Revocation denial is explicitly outside this primitive adapter and is **not tested here**; production Trust Set authorization must deny revoked devices before a key wrap/open path is reached. Full Android/iOS mutation execution is not run.

## L. Integration points

This is a standalone qualification adapter. Existing outer FamilyEnvelope canonicalization/DSK signature verification remains in place. Production composition currently remains `NOT_READY_CRYPTO_REVIEW`. There is no change to `cryptoGate.ts`, `src/index.ts`, Android receiver wiring, iOS receiver wiring, backend relay behavior, migration 0066, or server knowledge boundaries. If accepted, later implementation must connect only after DSK/Trust Set/scope/epoch/replay/expiry verification and before policy schema validation/persistence/enforcement.

## M. Privacy and server-knowledge boundary

Backend receives opaque encrypted envelope bytes and already permitted routing/epoch metadata; it has no DEK private key, FDEK, or content decryption operation. `POLICY_RECEIPT` remains Family E2EE and unreadable to the service. No policy plaintext, coordinates, activity, URLs/domains, human rejection reason, or family receipt contents are added. The backend may validate canonical/public metadata only.

## N. Known limitations / review questions

1. No independent audit for exact `@hpke/core@1.9.0` has been established. Maintainer statements and RFC/Wycheproof vectors are not an independent audit.
2. Versioned source mapping comes from npm `gitHead`; reviewer should confirm registry provenance and source equivalence.
3. `@hpke/core` contains a fallback path that derives a public key from a private key when no public key is supplied. The PCA candidate passes an explicit key pair and tests a non-extractable private key; reviewer must inspect provider/browser behavior and verify this path is not reached.
4. Browser production key custody, enrollment and FDEK lifecycle do not exist.
5. Native Android/iOS implementations have not consumed the candidate vectors.
6. Rotation and revocation rules are profile proposals, not production code or approved native integration behavior.
7. The candidate content layer composes standard WebCrypto HKDF and AES-GCM outside HPKE; reviewer must assess cryptographic composition and key/nonce lifecycle.
8. Project TypeScript 5.8.3 typecheck passed. An in-worktree `npm ci` failed with `ENOSPC` on D:, so the exact candidate lockfile was installed in task-owned temporary storage and linked as this worktree's `node_modules`; `npm run typecheck` then passed from the isolated worktree. Direct Node 22 candidate tests passed. Exact-head CI was not run.

## O. Exact production-gate criteria

Production approval requires external disposition `APPROVE` or closure of every required fix followed by reviewer acceptance; source/hash/lock reproducibility; exact version/profile acceptance; browser key custody and enrollment approval; mobile/reference vector execution; security review of all PCA metadata/key/nonce/retry/rotation semantics; production wiring with no fixture decryptor; all negative/security tests; and a separate owner-reviewed gate activation commit. This candidate alone changes no production gate.

## P. Diff from current fail-closed composition

Candidate-only changes are limited to:

- exact `@hpke/core@1.9.0` dependency and lock resolution in this isolated worktree;
- unexported profile adapter source;
- synthetic vector fixture and candidate tests;
- this bounded profile and review package;
- retained exact npm package tarball for reviewer reproduction.

There is no change to the authoritative worktree, `cryptoGate.ts`, package entry point, production dependency set, production application wiring, backend, mobile source, database, Azure, or production environment. `CRYPTO_SUITE_APPROVED_FOR_PRODUCTION` remains false and the gate remains CLOSED.

## External reviewer disposition

Reviewer identity/organization: **PENDING**

Review date: **PENDING**

Disposition: **PENDING** (`APPROVE` / `APPROVE_WITH_REQUIRED_FIXES` / `REJECT`)
Report/reference: **PENDING**
