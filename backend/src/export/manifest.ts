import { createHash } from 'node:crypto';
import { EXPORT_MANIFEST_FORMAT_VERSION, type ExportManifest } from './types.js';
import { validateRetentionPolicy } from '../retention/engine.js';
import type { RetentionEntityClass, RetentionPolicySettings, RetentionRecord } from '../retention/types.js';

export interface BuildManifestInput {
  exportId: string;
  createdAtUtc: Date;
  records: RetentionRecord[];
  /** The plaintext export payload bytes the manifest's integrity digest is computed over -- never itself stored in the manifest, never sent anywhere unencrypted (see pipeline.ts). */
  dataBytes: Buffer;
  /** The exact family retention policy used to select the records. This metadata is included in the encrypted manifest, never interpreted by the relay. */
  retentionScope: RetentionPolicySettings;
  retentionCutoffUtc: Date | null;
  schemaVersions: Record<string, string>;
}

/**
 * Deterministic, pure manifest construction (doc 11 Section 10 + PCA-12
 * brief Section 26). `recordCounts`/`includedCategories` are derived from
 * `records`, never independently supplied, so the manifest cannot claim a
 * category or count that doesn't match what was actually included.
 */
export function buildExportManifest(input: BuildManifestInput): ExportManifest {
  const policyViolations = validateRetentionPolicy(input.retentionScope);
  if (policyViolations.length > 0) {
    throw new RangeError(`Invalid export retention scope: ${policyViolations.join(', ')}`);
  }
  const recordCounts: Record<string, number> = {};
  for (const record of input.records) {
    recordCounts[record.entityClass] = (recordCounts[record.entityClass] ?? 0) + 1;
  }
  const includedCategories = [...new Set(input.records.map((record) => record.entityClass))].sort() as RetentionEntityClass[];

  return {
    formatVersion: EXPORT_MANIFEST_FORMAT_VERSION,
    exportId: input.exportId,
    createdAtUtc: input.createdAtUtc,
    includedCategories,
    recordCounts,
    retentionScope: {
      generalWindow: input.retentionScope.generalWindow,
      locationMode:
        input.retentionScope.locationMode === 'CURRENT_LAST_ONLY'
          ? 'CURRENT_LAST_ONLY'
          : { window: input.retentionScope.locationMode.window },
      timezone: input.retentionScope.timezone,
    },
    retentionCutoffUtc: input.retentionCutoffUtc,
    schemaVersions: input.schemaVersions,
    integrityDigestAlgorithm: 'sha256',
    integrityDigest: createHash('sha256').update(input.dataBytes).digest('hex'),
  };
}
