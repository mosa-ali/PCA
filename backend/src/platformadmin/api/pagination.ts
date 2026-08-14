/**
 * PCA-PA-3B -- shared bounded-pagination contract for every new Platform
 * Administration list endpoint (accounts, audit, quotes, invoices,
 * payments, entitlement requests, admin users, price-book history).
 *
 * No pagination convention existed anywhere in this backend before this
 * lane (confirmed by repository survey -- the only limit-like parameter
 * anywhere was `PlatformAdminAuditQueryFilter.limit`, a "most recent N"
 * primitive, not true pagination). This module establishes the FIRST one:
 * a plain `limit`/`offset` pair, always clamped server-side (never trusts
 * a client-supplied limit/offset without bounding it), returned alongside
 * a `total` count and stable `ORDER BY <key> DESC` on every list query that
 * uses it -- "stable ordering required" (mission Section 20).
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
export const MAX_PAGE_OFFSET = 100_000;

export interface PageRequest {
  readonly limit: number;
  readonly offset: number;
}

export interface PageResult<T> {
  readonly items: T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Parses/clamps untrusted query-string `limit`/`offset` values. Never
 * throws -- an invalid or missing value silently falls back to the
 * default/bound rather than producing a 400, matching how every other
 * list-shaped read in this codebase (e.g. the audit filter) already
 * behaves for its own `limit` parameter.
 */
export function parsePageRequest(query: Record<string, unknown>): PageRequest {
  const rawLimit = query.limit;
  const rawOffset = query.offset;
  const parsedLimit = typeof rawLimit === 'string' ? Number.parseInt(rawLimit, 10) : Number.NaN;
  const parsedOffset = typeof rawOffset === 'string' ? Number.parseInt(rawOffset, 10) : Number.NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_PAGE_LIMIT) : DEFAULT_PAGE_LIMIT;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, MAX_PAGE_OFFSET) : 0;
  return { limit, offset };
}
