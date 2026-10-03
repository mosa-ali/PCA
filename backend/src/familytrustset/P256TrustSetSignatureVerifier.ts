import { verify as cryptoVerify } from 'node:crypto';
import {
  createP256PublicKey,
  isCanonicalP256PublicKey,
  isCanonicalP256Signature,
  strictBase64Url,
} from '../deviceauth/P256DeviceSignatureVerifier.js';
import type { TrustSetSignatureVerifier } from './TrustSetSignatureVerifier.js';

/**
 * R1 concrete TrustSetSignatureVerifier for the PCA-DEC-020-R1 suite: ECDSA
 * over P-256 with SHA-256, IEEE-P1363 fixed-width 64-byte signatures
 * (`r || s`), LOW-S canonical form only, and SEC1 UNCOMPRESSED public
 * points (`0x04 || x || y`, exactly 65 bytes). Both wire values are
 * unpadded base64url in their canonical re-encoding.
 *
 * The strictness surface is the same acceptance surface as
 * src/deviceauth/P256DeviceSignatureVerifier.ts (the established
 * PCA-DEC-020-R1 pattern): strict base64url decode with re-encode
 * equality, exact key/signature lengths, scalar bounds r, s in [1, n-1],
 * and s <= n/2. Those helpers are IMPORTED from the deviceauth module --
 * not restated here -- so there is exactly one implementation of the
 * primitive and the two verifiers cannot drift apart. The deviceauth file
 * is not modified by this module.
 *
 * The signed message is the canonical epoch byte string produced by
 * canonicalize.ts, UTF-8 encoded: its length prefixes are UTF-8 BYTE
 * lengths, so the verifier must hash exactly those bytes
 * (Buffer.from(canonicalBytes, 'utf8')). `publicKey` is always a DSK; a DEK
 * must never be accepted here (see TrustSetSignatureVerifier.ts).
 *
 * WIRING STATUS (corrected 2026-10-02, Wave 6C): this class IS constructed
 * in production -- the Wave-6B first-device trust-root bootstrap service
 * constructs it internally as its epoch-1 (statement B) verifier, and the
 * Wave-6C platform attestation router terminates that same ceremony lane.
 * What remains owner-gated is the GENERAL production ingestion path: the
 * ordinary TrustSetEpochAcceptanceService still has no production caller,
 * and no other production composition constructs this verifier; the
 * ceremony's own reachability additionally requires configured pinned
 * attestation roots plus genuine hardware-backed Android evidence.
 */
export class P256TrustSetSignatureVerifier implements TrustSetSignatureVerifier {
  async verify(publicKey: string, canonicalBytes: string, signature: string): Promise<boolean> {
    try {
      if (!isCanonicalP256PublicKey(publicKey)) return false;
      if (!isCanonicalP256Signature(signature)) return false;

      const keyObject = createP256PublicKey(strictBase64Url(publicKey));
      return cryptoVerify(
        'sha256',
        Buffer.from(canonicalBytes, 'utf8'),
        { key: keyObject, dsaEncoding: 'ieee-p1363' },
        strictBase64Url(signature),
      );
    } catch {
      return false;
    }
  }
}
