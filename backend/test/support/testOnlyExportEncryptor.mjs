// TEST-ONLY ExportEncryptor. Lives entirely under backend/test/ -- excluded
// from the TypeScript build and unreachable from backend/dist/. NOT a real
// AEAD construction -- proves nothing about confidentiality. Exists only to
// exercise the export pipeline's encrypt-then-write control flow
// deterministically before a reviewed production ExportEncryptor is
// selected (CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW).
export function createTestOnlyExportEncryptor() {
  return {
    async encrypt(manifestBytes, dataBytes) {
      return {
        ciphertext: Buffer.concat([Buffer.from('TEST-ONLY-CIPHERTEXT:'), dataBytes]),
        encryptionMetadata: manifestBytes,
      };
    },
  };
}

export function createFailingExportEncryptor(message = 'provider unavailable') {
  return {
    async encrypt() {
      throw new Error(message);
    },
  };
}
