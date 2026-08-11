import { createHash } from 'node:crypto';

// TEST-ONLY RecoveryKdf + RecoveryEnvelopeCipher. Lives entirely under
// backend/test/ -- excluded from the TypeScript build, nothing under
// backend/src/ imports from backend/test/. NOT a real KDF or AEAD
// construction -- proves nothing about key derivation or authenticated
// encryption. Exists only to exercise RecoveryEnvelopeOpener's
// orchestration logic deterministically before a reviewed production
// suite is selected (CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW, doc 09
// PCA-DEC-020/PCA-DEC-021).

export function createTestOnlyRecoveryKdf() {
  return {
    async derive(recoverySecret, salt, suite) {
      return createHash('sha256').update(Buffer.concat([recoverySecret, salt, Buffer.from(suite.suiteId, 'utf8')])).digest();
    },
  };
}

/**
 * "Encrypts" by recording exactly what a real AEAD open would need to
 * check: the ciphertext is a JSON envelope embedding the RWK's digest (so
 * `open` can verify "the right key was used") plus the plaintext fields.
 * Associated data is checked byte-for-byte, exactly like a real AEAD
 * would authenticate it.
 */
export function sealTestOnlyRecoveryEnvelope(rwk, opened, associatedData) {
  const payload = {
    rwkDigest: createHash('sha256').update(rwk).digest('hex'),
    associatedDataDigest: createHash('sha256').update(associatedData).digest('hex'),
    opened,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

export function createTestOnlyRecoveryEnvelopeCipher() {
  return {
    async open(rwk, ciphertext, associatedData) {
      let payload;
      try {
        payload = JSON.parse(ciphertext.toString('utf8'));
      } catch {
        return null;
      }
      const rwkDigest = createHash('sha256').update(rwk).digest('hex');
      const associatedDataDigest = createHash('sha256').update(associatedData).digest('hex');
      if (payload.rwkDigest !== rwkDigest) return null; // wrong RS/RWK
      if (payload.associatedDataDigest !== associatedDataDigest) return null; // tampered/mismatched binding
      return {
        ...payload.opened,
        boundTrustSetEpoch: payload.opened.boundTrustSetEpoch,
        boundKeyEpoch: payload.opened.boundKeyEpoch,
      };
    },
  };
}
