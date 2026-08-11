import type { RetentionEntityClass } from '../retention/types.js';

export const EXPORT_MANIFEST_FORMAT_VERSION = 1;

/**
 * doc 11 Section 10 + PCA-12 brief Section 26: safe METADATA only -- no
 * activity content. `integrityDigest` covers the exported plaintext bytes
 * BEFORE encryption (so a recipient can verify integrity after decrypting)
 * and is computed by the caller's own hashing, not this module (no crypto
 * primitive selection here -- see ExportEncryptor).
 */
export interface ExportManifest {
  formatVersion: number;
  exportId: string;
  createdAtUtc: Date;
  includedCategories: RetentionEntityClass[];
  recordCounts: Record<string, number>;
  retentionCutoffUtc: Date | null;
  schemaVersions: Record<string, string>;
  integrityDigestAlgorithm: string;
  integrityDigest: string;
}

export interface EncryptedExportArtifact {
  ciphertext: Buffer;
  /** Opaque, provider-defined encryption metadata (nonce/KEM output/etc.) -- never inspected by this module. */
  encryptionMetadata: Buffer;
}

/**
 * Protocol-neutral export encryption port. Production implementation is
 * PENDING_HUMAN_SECURITY_REVIEW (no AEAD/KEM/KDF selection happens here or
 * anywhere in this module) -- see test/support for a test-only
 * deterministic provider used exclusively by this module's own tests,
 * structurally unreachable from backend/dist (same posture as
 * EnvelopeSignatureVerifier/TrustSetSignatureVerifier's test doubles).
 */
export interface ExportEncryptor {
  encrypt(manifestBytes: Buffer, dataBytes: Buffer): Promise<EncryptedExportArtifact>;
}

/** Destination abstraction so failure injection (interrupted, invalid destination, insufficient storage, partial write) is testable without a real filesystem. */
export interface ExportSink {
  write(artifact: EncryptedExportArtifact): Promise<void>;
}

export type ExportOutcomeKind = 'COMPLETED' | 'CANCELLED' | 'FAILED';

export interface ExportOutcome {
  kind: ExportOutcomeKind;
  manifest: ExportManifest;
  failureReason?: string;
}
