import type { EncryptedExportArtifact, ExportEncryptor, ExportManifest, ExportOutcome, ExportSink } from './types.js';

export interface RunExportOptions {
  /** Checked before encryption starts and again after encryption completes (before the write) -- a cooperative cancellation point, not a mid-operation interrupt. */
  isCancelled?: () => boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function serializeManifest(manifest: ExportManifest): Buffer {
  return Buffer.from(JSON.stringify(manifest), 'utf8');
}

/**
 * Encrypt-then-write pipeline (PCA-12 brief Sections 27-28). Plaintext
 * `dataBytes` is handed ONLY to `encryptor.encrypt` -- it is never passed
 * to `sink.write` under any code path, so a write-stage failure (invalid
 * destination, insufficient storage, partial write, provider crash) can
 * never leave a plaintext artifact at the destination, because plaintext
 * was never sent there in the first place. `sink.write` only ever
 * receives the completed `EncryptedExportArtifact`.
 *
 * Failure/cancel produce a typed, non-throwing ExportOutcome rather than
 * a thrown exception -- a caller driving an export UI can present
 * FAILED/CANCELLED without a try/catch, and a FAILED outcome never
 * implies partial success (there is no partial-COMPLETED state).
 */
export async function runExport(
  manifest: ExportManifest,
  dataBytes: Buffer,
  encryptor: ExportEncryptor,
  sink: ExportSink,
  options: RunExportOptions = {},
): Promise<ExportOutcome> {
  if (options.isCancelled?.()) {
    return { kind: 'CANCELLED', manifest };
  }

  let artifact: EncryptedExportArtifact;
  try {
    artifact = await encryptor.encrypt(serializeManifest(manifest), dataBytes);
  } catch (error) {
    return { kind: 'FAILED', manifest, failureReason: `ENCRYPTION_FAILED: ${errorMessage(error)}` };
  }

  if (options.isCancelled?.()) {
    return { kind: 'CANCELLED', manifest };
  }

  try {
    await sink.write(artifact);
  } catch (error) {
    return { kind: 'FAILED', manifest, failureReason: `WRITE_FAILED: ${errorMessage(error)}` };
  }

  return { kind: 'COMPLETED', manifest };
}
