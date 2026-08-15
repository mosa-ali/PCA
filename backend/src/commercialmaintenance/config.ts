/**
 * PCA-COMMERCIAL-RUNTIME-1 -- bounds-validated, fail-safe configuration for
 * `CommercialMaintenanceRunner`. Every knob the frozen contract calls out
 * (maintenance interval, quote-expiry batch size, notification-retention
 * duration, notification-prune batch size) is read from environment
 * variables, defaulted when absent, but NEVER silently clamped or coerced
 * when present-and-invalid -- an out-of-bounds or malformed value throws
 * `CommercialMaintenanceConfigError`, so a misconfigured production
 * deployment refuses to start (Coordinator-owned `main.ts` wiring is
 * expected to let this throw propagate at boot) rather than running with a
 * nonsensical value.
 */

export class CommercialMaintenanceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommercialMaintenanceConfigError';
  }
}

export interface CommercialMaintenanceConfig {
  /** How often the Coordinator-owned interval timer should invoke `runOnce()`. */
  readonly intervalMs: number;
  /** Per-pass cap on how many `commercial_notifications`-missing EXPIRED
   * quotes are looked up and notified in a single pass (see
   * CommercialMaintenanceRunner.ts's header for why this governs
   * notification catch-up rather than the underlying `expireDueQuotes`
   * transition, which has no batching primitive of its own). */
  readonly quoteExpiryBatchSize: number;
  /** How many days a commercial notification is retained before it becomes
   * eligible for pruning, regardless of read/unread state. */
  readonly notificationRetentionDays: number;
  /** Per-call cap passed to `CommercialNotificationRepository.pruneOlderThan`. */
  readonly notificationPruneBatchSize: number;
}

interface Bound {
  readonly min: number;
  readonly max: number;
}

const INTERVAL_MS_BOUNDS: Bound = { min: 1_000, max: 24 * 60 * 60 * 1000 };
const QUOTE_EXPIRY_BATCH_SIZE_BOUNDS: Bound = { min: 1, max: 10_000 };
const NOTIFICATION_RETENTION_DAYS_BOUNDS: Bound = { min: 1, max: 3_650 };
const NOTIFICATION_PRUNE_BATCH_SIZE_BOUNDS: Bound = { min: 1, max: 10_000 };

export const COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS: CommercialMaintenanceConfig = {
  intervalMs: 5 * 60 * 1000, // 5 minutes
  quoteExpiryBatchSize: 500,
  notificationRetentionDays: 180,
  notificationPruneBatchSize: 1_000,
};

export const COMMERCIAL_MAINTENANCE_ENV_KEYS = {
  intervalMs: 'COMMERCIAL_MAINTENANCE_INTERVAL_MS',
  quoteExpiryBatchSize: 'COMMERCIAL_MAINTENANCE_QUOTE_EXPIRY_BATCH_SIZE',
  notificationRetentionDays: 'COMMERCIAL_MAINTENANCE_NOTIFICATION_RETENTION_DAYS',
  notificationPruneBatchSize: 'COMMERCIAL_MAINTENANCE_NOTIFICATION_PRUNE_BATCH_SIZE',
} as const;

function readBoundedInt(env: NodeJS.ProcessEnv, key: string, bounds: Bound, defaultValue: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new CommercialMaintenanceConfigError(`${key} must be an integer, received: ${JSON.stringify(raw)}`);
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    throw new CommercialMaintenanceConfigError(`${key} must be a safe integer, received: ${JSON.stringify(raw)}`);
  }
  if (value < bounds.min || value > bounds.max) {
    throw new CommercialMaintenanceConfigError(`${key} must be between ${bounds.min} and ${bounds.max} (inclusive), received: ${value}`);
  }
  return value;
}

/**
 * Loads and bounds-validates `CommercialMaintenanceRunner`'s configuration
 * from `env` (defaults to `process.env`). Absent variables fall back to the
 * documented, in-bounds defaults above; a PRESENT-but-invalid value always
 * throws rather than falling back, per this lane's fail-safe requirement.
 */
export function loadCommercialMaintenanceConfig(env: NodeJS.ProcessEnv = process.env): CommercialMaintenanceConfig {
  return {
    intervalMs: readBoundedInt(env, COMMERCIAL_MAINTENANCE_ENV_KEYS.intervalMs, INTERVAL_MS_BOUNDS, COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS.intervalMs),
    quoteExpiryBatchSize: readBoundedInt(
      env,
      COMMERCIAL_MAINTENANCE_ENV_KEYS.quoteExpiryBatchSize,
      QUOTE_EXPIRY_BATCH_SIZE_BOUNDS,
      COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS.quoteExpiryBatchSize,
    ),
    notificationRetentionDays: readBoundedInt(
      env,
      COMMERCIAL_MAINTENANCE_ENV_KEYS.notificationRetentionDays,
      NOTIFICATION_RETENTION_DAYS_BOUNDS,
      COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS.notificationRetentionDays,
    ),
    notificationPruneBatchSize: readBoundedInt(
      env,
      COMMERCIAL_MAINTENANCE_ENV_KEYS.notificationPruneBatchSize,
      NOTIFICATION_PRUNE_BATCH_SIZE_BOUNDS,
      COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS.notificationPruneBatchSize,
    ),
  };
}
