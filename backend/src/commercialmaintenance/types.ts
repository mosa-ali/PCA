/**
 * PCA-COMMERCIAL-RUNTIME-1 -- shared types for the commercial maintenance
 * runner (Round5 Section AK-AS, `COMMERCIAL_MAINTENANCE_V1` frozen
 * contract). Closes two Round4-deferred `SOURCE_RUNTIME_GAP`s:
 *
 *   - `QUOTE_EXPIRED_NOTIFICATION`: `QUOTE_EXPIRED` was already a legal
 *     `CommercialNotificationEventType` (commercialnotifications/types.ts)
 *     with a documented dedupe-key convention (`QUOTE_EXPIRED:<quote_id>`),
 *     but nothing ever proactively reconciled `billing_quotes` expiry --
 *     `QuoteRepository.expireDueQuotes` was only ever invoked lazily, on a
 *     read/consume call (billing/quote.ts's QuoteService), so the event was
 *     never actually published by any code path.
 *   - `COMMERCIAL_NOTIFICATION_RETENTION_SCHEDULER`: no runtime ever invoked
 *     `CommercialNotificationRepository.pruneOlderThan` (verified present as
 *     of ROUND5_BASE -- see this lane's final report -- but orphaned/unused).
 */

/** The exact shape frozen by `ROUND5_INTERFACE_CONTRACTS.md`'s
 * `COMMERCIAL_MAINTENANCE_V1` section. */
export interface CommercialMaintenanceResult {
  readonly quotesExpired: number;
  readonly notificationsPublished: number;
  readonly notificationsPruned: number;
}

export interface CommercialMaintenanceRunner {
  runOnce(): Promise<CommercialMaintenanceResult>;
}

/** Narrow, privacy-safe structured-warning seam: implementations must never
 * receive notification message content (messageKey/params) through this --
 * only bounded identifiers/error text, matching this lane's privacy
 * requirement (pruned/retained notification content is never logged in
 * plaintext beyond what already exists elsewhere in the codebase). */
export interface CommercialMaintenanceLogger {
  warn(event: string, detail: Readonly<Record<string, unknown>>): void;
}

export const CONSOLE_COMMERCIAL_MAINTENANCE_LOGGER: CommercialMaintenanceLogger = {
  warn(event, detail) {
    // eslint-disable-next-line no-console -- intentional structured operational log, no message content.
    console.warn(JSON.stringify({ event, ...detail }));
  },
};
