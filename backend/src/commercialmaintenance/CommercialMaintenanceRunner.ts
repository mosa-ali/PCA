/**
 * PCA-COMMERCIAL-RUNTIME-1 -- `CommercialMaintenanceRunner` (Round5 Section
 * AK-AS, `COMMERCIAL_MAINTENANCE_V1` frozen contract). See types.ts's header
 * for the two Round4-deferred gaps this closes.
 *
 * DESIGN NOTE ON QUOTE-EXPIRY BATCHING (read before changing anything here):
 * `billing/quote.ts`'s `QuoteRepository.expireDueQuotes(conn, now)` is an
 * existing, frozen, unmodified primitive: a single atomic
 * `UPDATE billing_quotes SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND
 * expires_at <= ?` with NO `LIMIT` and no returned row identities. This
 * lane is explicitly forbidden from modifying `quote.ts` or building a
 * second expiry-transition mechanism, so the transition step itself cannot
 * be bounded by `quoteExpiryBatchSize` -- one call always reconciles the
 * ENTIRE currently-due backlog in one atomic step (matching its existing
 * lazy-sweep semantics elsewhere in the codebase; not a regression).
 *
 * Notification emission is deliberately decoupled from "what did THIS
 * call's transition touch": instead, every `runOnce()` also scans for
 * `billing_quotes` rows that are already `status = 'EXPIRED'` but have no
 * corresponding `commercial_notifications` row yet (a `LEFT JOIN` on the
 * documented `QUOTE_EXPIRED:<quote_id>` dedupe-key convention), and
 * publishes for those, bounded by `quoteExpiryBatchSize` per pass, looping
 * (bounded by MAX_PASSES_PER_RUN) until the backlog is drained or the pass
 * limit is hit. This is deliberately MORE robust than trying to thread
 * batch-size-bounded row identities through the single unbounded UPDATE:
 *   - It is trivially exactly-once: eligibility is `status = 'EXPIRED' AND
 *     no notification row yet`, which can only ever be true because
 *     `expireDueQuotes` (the ONLY writer of `status = 'EXPIRED'` anywhere in
 *     this codebase) already, durably, transitioned the row -- never merely
 *     because a read/page-open observed `expiresAt` had passed.
 *   - It is self-healing across a crash between "transition committed" and
 *     "notification published" (this lane's required restart-safety test):
 *     the NEXT `runOnce()` call's scan will simply find the row still
 *     missing its notification and publish it then, with no double-expiry
 *     and no double-notification risk.
 *   - It is safe under concurrent runner instances without any in-memory
 *     lock: two instances racing the same "missing notification" row both
 *     call `CommercialNotificationPublisher.publish`, and
 *     `CommercialNotificationRepository.recordIfNew`'s
 *     `UNIQUE(dedupe_key)` constraint (not a lock this code takes or
 *     manages) guarantees exactly one is ever actually `RECORDED`/
 *     `PUBLISHED` -- the other observes `ALREADY_PUBLISHED`, a safe no-op.
 *
 * DESIGN NOTE ON THE UPCOMING-RENEWAL REMINDER SWEEP: every `runOnce()` also
 * scans `billing_subscriptions` (billing/subscription.ts) for rows that are
 * not `CANCELED` and whose `current_period_end` falls within
 * `RENEWAL_UPCOMING_WINDOW_DAYS` of `now`, and publishes a `RENEWAL_UPCOMING`
 * notification (types.ts) for each -- a purely internal, provider-neutral
 * heads-up ahead of an actual renewal charge/cycle. This is deliberately
 * NOT the same as the `auto_renew` flag (migration 0031): that is a stated
 * preference with no job that ever re-charges anyone; this sweep never
 * charges anyone either -- it only ever calls the SAME
 * `CommercialNotificationPublisher.publish` every other event in this
 * module uses, and never touches `billing/providerRegistry.ts` or any
 * payment-provider integration.
 *
 * IDEMPOTENCY (mirrors the quote-expiry design above, adapted for a
 * recurring subject): the sweep's dedupe key is
 * `RENEWAL_UPCOMING:<subscription_id>:<current_period_end's UTC calendar
 * date>` (see `renewalUpcomingDedupeKey` below) -- NOT just the subscription
 * id -- so a backlog scan (a `LEFT JOIN` on this exact dedupe-key
 * convention, exactly like the quote-expiry scan's `QUOTE_EXPIRED:<quote_id>`
 * join) can correctly recognize "already reminded for THIS renewal cycle"
 * and skip it on every subsequent pass/run, while still being able to remind
 * again for a genuinely later cycle once a future `current_period_end`
 * value exists for that subscription (this codebase has no code path that
 * advances `current_period_end` today, so in practice this distinction is
 * dormant, but it is the correct, forward-compatible primitive rather than
 * a subscription-id-only key that could never re-fire once a real
 * recurring-renewal job exists). The calendar-date (not exact-timestamp)
 * granularity is deliberate: both the SQL-side `DATE_FORMAT(...,
 * '%Y-%m-%d')` and the JS-side `toISOString().slice(0, 10)` are pure,
 * timezone-agnostic truncations of the SAME underlying UTC instant (this
 * codebase's DB pool is configured `timezone: 'Z'`, see db/pool.ts), so the
 * two are guaranteed to agree byte-for-byte -- unlike matching MySQL's
 * fractional-second formatting against `Date.prototype.toISOString()`,
 * which is unnecessary fragility this sweep does not need (a renewal cycle
 * reminder is inherently a day-granularity concern, not a millisecond one).
 */

import { execute, runInTransaction } from '../db/pool.js';
import type { QuoteRepository } from '../billing/quote.js';
import type { ChangeRequestRepository } from '../entitlements/requests/ChangeRequestRepository.js';
import { DEFAULT_MESSAGE_KEYS } from '../commercialnotifications/CommercialNotificationPublisher.js';
import type { CommercialNotificationPublisher } from '../commercialnotifications/CommercialNotificationPublisher.js';
import type { CommercialNotificationRepository } from '../commercialnotifications/CommercialNotificationRepository.js';
import type { CommercialMaintenanceConfig } from './config.js';
import { CONSOLE_COMMERCIAL_MAINTENANCE_LOGGER } from './types.js';
import type { CommercialMaintenanceLogger, CommercialMaintenanceResult, CommercialMaintenanceRunner } from './types.js';

/** Internal runaway-loop guard for the bounded-pass drain loops below -- NOT
 * an exposed config knob (the frozen contract lists exactly four:
 * interval, quote-expiry batch size, notification-retention duration,
 * prune batch size). Each pass is itself already bounded by the configured
 * batch size; this only stops a single `runOnce()` call from looping
 * forever under a pathological, continuously-regenerating backlog. */
const MAX_PASSES_PER_RUN = 1_000;

/**
 * Internal, fixed lookahead window (and per-pass batch size) for the
 * upcoming-renewal reminder sweep -- deliberately NOT one of the frozen
 * `COMMERCIAL_MAINTENANCE_V1` contract's four exposed knobs (interval,
 * quote-expiry batch size, notification-retention duration, prune batch
 * size; see config.ts's header), same reasoning as `MAX_PASSES_PER_RUN`
 * above. No existing "how far ahead to remind" constant exists elsewhere in
 * this codebase (checked `WEBHOOK_FRESHNESS_WINDOW_MS` in
 * billing/webhook/WebhookService.ts and `PLATFORM_ADMIN_LOCKOUT_WINDOW_MS`
 * in platformadmin/auth/policy.ts -- both unrelated time-window concepts),
 * so this picks a standard, conservative advance-notice period: enough
 * runway for a parent to see and react to (or cancel) an upcoming renewal
 * charge before it happens, without the reminder firing so early that the
 * charge is still weeks away. The batch size mirrors
 * `quoteExpiryBatchSize`'s own default (500) for consistency.
 */
const RENEWAL_UPCOMING_WINDOW_DAYS = 7;
const RENEWAL_UPCOMING_BATCH_SIZE = 500;

interface PendingQuoteExpiryNotificationRow {
  quote_id: string;
  increase_request_ref: string | null;
  expires_at: Date;
}

interface PendingRenewalUpcomingNotificationRow {
  subscription_id: string;
  account_ref: string;
  current_period_end: Date;
}

/** The sole idempotency identity for this sweep -- see the class header's
 * "DESIGN NOTE ON THE UPCOMING-RENEWAL REMINDER SWEEP" for why this is keyed
 * on the UTC calendar date of `currentPeriodEnd`, not just `subscriptionId`. */
function renewalUpcomingDedupeKey(subscriptionId: string, currentPeriodEnd: Date): string {
  return `RENEWAL_UPCOMING:${subscriptionId}:${currentPeriodEnd.toISOString().slice(0, 10)}`;
}

export class MySqlCommercialMaintenanceRunner implements CommercialMaintenanceRunner {
  constructor(
    private readonly quoteRepository: QuoteRepository,
    private readonly changeRequestRepository: ChangeRequestRepository,
    private readonly notificationPublisher: CommercialNotificationPublisher,
    private readonly notificationRepository: CommercialNotificationRepository,
    private readonly config: CommercialMaintenanceConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly logger: CommercialMaintenanceLogger = CONSOLE_COMMERCIAL_MAINTENANCE_LOGGER,
  ) {}

  async runOnce(): Promise<CommercialMaintenanceResult> {
    const now = this.now();
    const quotesExpired = await this.reconcileQuoteExpiry(now);
    const quoteExpiryNotificationsPublished = await this.publishPendingQuoteExpiryNotifications();
    const renewalUpcomingNotificationsPublished = await this.publishPendingRenewalUpcomingNotifications(now);
    // notificationsPublished is the frozen CommercialMaintenanceResult contract's single
    // aggregate counter (COMMERCIAL_MAINTENANCE_V1) -- it sums every kind of commercial
    // notification this runner publishes this call, not just quote-expiry ones.
    const notificationsPublished = quoteExpiryNotificationsPublished + renewalUpcomingNotificationsPublished;
    const notificationsPruned = await this.pruneNotifications(now);
    return { quotesExpired, notificationsPublished, notificationsPruned };
  }

  /** Calls the EXISTING, unmodified conditional UPDATE exactly once. Its
   * `rowCount` is the authoritative count of quotes THIS call transitioned
   * `ACTIVE -> EXPIRED` -- across concurrent runner instances, each due
   * quote is counted by exactly one caller's `rowCount`, guaranteed by the
   * UPDATE's own `WHERE status = 'ACTIVE'` guard (no additional locking
   * needed or added here). */
  private async reconcileQuoteExpiry(now: Date): Promise<number> {
    return runInTransaction((conn) => this.quoteRepository.expireDueQuotes(conn, now));
  }

  private async publishPendingQuoteExpiryNotifications(): Promise<number> {
    let published = 0;
    for (let pass = 0; pass < MAX_PASSES_PER_RUN; pass++) {
      const rows = await this.findExpiredQuotesMissingNotification(this.config.quoteExpiryBatchSize);
      if (rows.length === 0) break;
      for (const row of rows) {
        published += await this.publishOne(row);
      }
      if (rows.length < this.config.quoteExpiryBatchSize) break; // backlog drained
    }
    return published;
  }

  private async findExpiredQuotesMissingNotification(limit: number): Promise<PendingQuoteExpiryNotificationRow[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<PendingQuoteExpiryNotificationRow>(
        conn,
        `SELECT bq.quote_id, bq.increase_request_ref, bq.expires_at
           FROM billing_quotes bq
           LEFT JOIN commercial_notifications cn
             ON cn.dedupe_key = CONCAT('QUOTE_EXPIRED:', bq.quote_id)
          WHERE bq.status = 'EXPIRED' AND cn.notification_id IS NULL
          ORDER BY bq.expires_at ASC, bq.quote_id ASC
          LIMIT ?`,
        [limit],
      ),
    );
    return rows;
  }

  private async publishOne(row: PendingQuoteExpiryNotificationRow): Promise<0 | 1> {
    const accountRef = await this.resolveAccountRef(row.increase_request_ref);
    if (accountRef === null) {
      // No attributable family/account -- e.g. a Quote with no
      // increase_request_ref, or whose request no longer resolves. Never
      // guess/substitute an account: skip, counted toward quotesExpired
      // (it DID transition) but never toward notificationsPublished. This
      // row will keep appearing in the backlog scan every future run (it
      // can never gain a notification), which is intentional -- a cheap,
      // bounded, self-documenting signal rather than a silent drop.
      this.logger.warn('commercial_maintenance.quote_expired_unattributed', {
        quoteId: row.quote_id,
        increaseRequestRef: row.increase_request_ref,
      });
      return 0;
    }
    try {
      const outcome = await this.notificationPublisher.publish(
        {
          accountRef,
          eventType: 'QUOTE_EXPIRED',
          dedupeKey: `QUOTE_EXPIRED:${row.quote_id}`,
          resourceRef: row.quote_id,
          messageKey: DEFAULT_MESSAGE_KEYS.QUOTE_EXPIRED,
          params: { expiresAt: row.expires_at.toISOString() },
        },
        this.now(),
      );
      return outcome.outcome === 'PUBLISHED' ? 1 : 0;
    } catch (error) {
      // A transient failure here (e.g. a dropped connection) must not crash
      // the whole maintenance pass -- log (no message content) and let the
      // NEXT runOnce() pick this row back up via the same missing-notification
      // scan (it never gains a notification until publish genuinely succeeds).
      this.logger.warn('commercial_maintenance.quote_expired_publish_failed', {
        quoteId: row.quote_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /** Same bounded-drain-loop shape as `publishPendingQuoteExpiryNotifications`
   * above, over the upcoming-renewal backlog instead -- see the class
   * header's "DESIGN NOTE ON THE UPCOMING-RENEWAL REMINDER SWEEP". */
  private async publishPendingRenewalUpcomingNotifications(now: Date): Promise<number> {
    const windowEnd = new Date(now.getTime() + RENEWAL_UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    let published = 0;
    for (let pass = 0; pass < MAX_PASSES_PER_RUN; pass++) {
      const rows = await this.findUpcomingRenewalsMissingNotification(now, windowEnd, RENEWAL_UPCOMING_BATCH_SIZE);
      if (rows.length === 0) break;
      for (const row of rows) {
        published += await this.publishRenewalUpcoming(row);
      }
      if (rows.length < RENEWAL_UPCOMING_BATCH_SIZE) break; // backlog drained
    }
    return published;
  }

  /**
   * Eligible: not `CANCELED` (task requirement -- an EXPIRED subscription's
   * `current_period_end` is necessarily already in the past, so it is
   * already excluded by the date-range filter below without needing a
   * separate status check), `current_period_end` within
   * `[now, windowEnd]`, and no `commercial_notifications` row yet for THIS
   * exact renewal cycle (the `LEFT JOIN` on `renewalUpcomingDedupeKey`'s
   * exact convention, mirroring `findExpiredQuotesMissingNotification`'s own
   * `LEFT JOIN` above).
   */
  private async findUpcomingRenewalsMissingNotification(now: Date, windowEnd: Date, limit: number): Promise<PendingRenewalUpcomingNotificationRow[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<PendingRenewalUpcomingNotificationRow>(
        conn,
        `SELECT bs.subscription_id, bs.account_ref, bs.current_period_end
           FROM billing_subscriptions bs
           LEFT JOIN commercial_notifications cn
             ON cn.dedupe_key = CONCAT('RENEWAL_UPCOMING:', bs.subscription_id, ':', DATE_FORMAT(bs.current_period_end, '%Y-%m-%d'))
          WHERE bs.status <> 'CANCELED'
            AND bs.current_period_end BETWEEN ? AND ?
            AND cn.notification_id IS NULL
          ORDER BY bs.current_period_end ASC, bs.subscription_id ASC
          LIMIT ?`,
        [now, windowEnd, limit],
      ),
    );
    return rows;
  }

  private async publishRenewalUpcoming(row: PendingRenewalUpcomingNotificationRow): Promise<0 | 1> {
    try {
      const outcome = await this.notificationPublisher.publish(
        {
          accountRef: row.account_ref,
          eventType: 'RENEWAL_UPCOMING',
          dedupeKey: renewalUpcomingDedupeKey(row.subscription_id, row.current_period_end),
          resourceRef: row.subscription_id,
          messageKey: DEFAULT_MESSAGE_KEYS.RENEWAL_UPCOMING,
          params: { currentPeriodEnd: row.current_period_end.toISOString() },
        },
        this.now(),
      );
      return outcome.outcome === 'PUBLISHED' ? 1 : 0;
    } catch (error) {
      // Same never-crash-the-batch discipline as publishOne above: log (no
      // message content) and let the next runOnce()'s scan pick this row
      // back up -- it never gains a notification until publish genuinely succeeds.
      this.logger.warn('commercial_maintenance.renewal_upcoming_publish_failed', {
        subscriptionId: row.subscription_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Resolves the family/account a QUOTE_EXPIRED notification is attributed
   * to via the quote's `increase_request_ref` -- a bounded opaque VARCHAR,
   * never a foreign key (migration 0007), but the SAME identifier space as
   * `entitlements/requests`'s own `EntitlementChangeRequestRecord.requestId`
   * (matching `billing/checkout/CheckoutService.ts`'s own
   * `increaseRequestRef: input.requestId` convention). A quote issued with
   * no increase-request reference, or whose referenced request cannot be
   * found, has no attributable account and is intentionally skipped --
   * never published under a guessed or wrong account.
   */
  private async resolveAccountRef(increaseRequestRef: string | null): Promise<string | null> {
    if (increaseRequestRef === null) return null;
    const request = await this.changeRequestRepository.getById(increaseRequestRef);
    return request?.familyId ?? null;
  }

  /** Section 13 bounded retention: drains the prune backlog for this run,
   * bounded per pass by `notificationPruneBatchSize` and in total by
   * MAX_PASSES_PER_RUN. `pruneOlderThan` is already idempotent under
   * concurrent/repeated execution (a plain `DELETE ... WHERE created_at < ?
   * LIMIT ?`, safe to re-run against rows another instance already
   * deleted -- see `CommercialNotificationRepository.ts`). */
  private async pruneNotifications(now: Date): Promise<number> {
    const retentionCutoffMs = now.getTime() - this.config.notificationRetentionDays * 24 * 60 * 60 * 1000;
    const retentionCutoff = new Date(retentionCutoffMs);
    let pruned = 0;
    for (let pass = 0; pass < MAX_PASSES_PER_RUN; pass++) {
      const deleted = await this.notificationRepository.pruneOlderThan(retentionCutoff, this.config.notificationPruneBatchSize);
      pruned += deleted;
      if (deleted < this.config.notificationPruneBatchSize) break; // backlog drained
    }
    return pruned;
  }
}
