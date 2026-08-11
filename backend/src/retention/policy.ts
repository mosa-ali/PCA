import type { AuditRetentionEntityClass, RetentionEntityClass, RetentionWindow } from './types.js';

/** doc 11 Section 2 -- the only supported family-selectable windows. No "unlimited" option exists; do not silently invent one. */
export const RETENTION_WINDOWS: RetentionWindow[] = ['14_DAYS', '1_MONTH', '3_MONTHS', '6_MONTHS', '9_MONTHS'];

/** doc 11 Section 2 -- architecture default at first enrollment, shown for explicit parent confirmation, never silently applied by this module (confirmation UX is a caller concern). */
export const DEFAULT_RETENTION_WINDOW: RetentionWindow = '1_MONTH';

const WINDOW_MONTHS: Partial<Record<RetentionWindow, number>> = {
  '1_MONTH': 1,
  '3_MONTHS': 3,
  '6_MONTHS': 6,
  '9_MONTHS': 9,
};

export function monthsForWindow(window: RetentionWindow): number | null {
  return WINDOW_MONTHS[window] ?? null;
}

/** doc 11 Section 3.3 -- fixed at 12 months given the current option set (the widest general window, 9 months, is always shorter than 12, so "whichever is longer" always resolves to 12 today; expressed generically so a future wider general window would still be handled correctly). */
export const AUDIT_RETENTION_FLOOR_MONTHS = 12;

export function effectiveAuditRetentionMonths(generalWindow: RetentionWindow): number {
  const generalMonths = monthsForWindow(generalWindow) ?? 14 / 30; // 14_DAYS approximated only for this max() comparison, never for actual cutoff math
  return Math.max(generalMonths, AUDIT_RETENTION_FLOOR_MONTHS);
}

const AUDIT_ENTITY_CLASSES = new Set<AuditRetentionEntityClass>(['PARENT_ACTION_AUDIT', 'TAMPER_EVENT']);

export function isAuditEntityClass(entityClass: RetentionEntityClass): entityClass is AuditRetentionEntityClass {
  return AUDIT_ENTITY_CLASSES.has(entityClass as AuditRetentionEntityClass);
}

/** Ordinal strictness ordering (shortest/strictest first) -- used only for the location-window-vs-general-window POLICY comparison (PCA-DATA-022), not for computing actual elapsed durations. */
const WINDOW_ORDER: RetentionWindow[] = ['14_DAYS', '1_MONTH', '3_MONTHS', '6_MONTHS', '9_MONTHS'];

/** Negative if `a` is strictly shorter/equal-or-shorter than `b`... actually: returns a<b?-1 : a>b?1 : 0, by ordinal strictness position. */
export function compareRetentionWindows(a: RetentionWindow, b: RetentionWindow): number {
  return WINDOW_ORDER.indexOf(a) - WINDOW_ORDER.indexOf(b);
}
