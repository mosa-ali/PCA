import { exportOutcomeMessage, type EncryptedExportArtifact, type ExportEncryptor, type ExportManifest, type ExportOutcome, type ExportSink } from './types.js';
import type { SupportedLocale } from '../i18n/types.js';

export interface RunExportOptions {
  /** Checked before encryption starts and again after encryption completes (before the write) -- a cooperative cancellation point, not a mid-operation interrupt. */
  isCancelled?: () => boolean;
  /** doc 20 PCA-FR-113: locale for ExportOutcome.outcomeMessage. Defaults to 'en'. */
  locale?: SupportedLocale;
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
  const locale: SupportedLocale = options.locale ?? 'en';

  if (options.isCancelled?.()) {
    return { kind: 'CANCELLED', manifest, outcomeMessage: exportOutcomeMessage('CANCELLED', locale) };
  }

  let artifact: EncryptedExportArtifact;
  try {
    artifact = await encryptor.encrypt(serializeManifest(manifest), dataBytes);
  } catch (error) {
    return { kind: 'FAILED', manifest, failureReason: `ENCRYPTION_FAILED: ${errorMessage(error)}`, outcomeMessage: exportOutcomeMessage('FAILED', locale) };
  }

  // A provider that returns an empty ciphertext has not produced an export
  // artifact. Treat that as encryption failure before any sink is touched;
  // otherwise a caller could incorrectly record COMPLETED for an empty or
  // plaintext-substitute file.
  if (!artifact || !artifact.ciphertext || artifact.ciphertext.length === 0) {
    return { kind: 'FAILED', manifest, failureReason: 'ENCRYPTION_FAILED: EMPTY_CIPHERTEXT', outcomeMessage: exportOutcomeMessage('FAILED', locale) };
  }

  if (options.isCancelled?.()) {
    return { kind: 'CANCELLED', manifest, outcomeMessage: exportOutcomeMessage('CANCELLED', locale) };
  }

  try {
    await sink.write(artifact);
  } catch (error) {
    return { kind: 'FAILED', manifest, failureReason: `WRITE_FAILED: ${errorMessage(error)}`, outcomeMessage: exportOutcomeMessage('FAILED', locale) };
  }

  return { kind: 'COMPLETED', manifest, outcomeMessage: exportOutcomeMessage('COMPLETED', locale) };
}
