// One KPI tile.
//
// ============================================================================
// THE SINGLE EASIEST WAY TO LIE ON A DASHBOARD IS TO PRINT `0`.
//
// `0` may only ever mean "we counted zero". It may NEVER stand in for "the
// read threw and we do not know". A parent glancing at "Needs attention: 0"
// takes it as reassurance; if the underlying call actually failed, that
// reassurance is fabricated -- and in real (non-fixture) mode the family-data
// read throws by design, so this is not a hypothetical.
//
// Hence three renderings, never two:
//
//   VERIFIED    the number, no marker.
//   UNVERIFIED  the number, plus the Cached / Not verified freshness marker,
//               because at least one contributing record was not live.
//   UNKNOWN     an em dash and "We can't verify this right now". Never a zero.
// ============================================================================
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DataFreshnessState } from '../../domain/types';
import { formatNumber } from '../../i18n/formatters';
import { FreshnessMarker } from './FreshnessMarker';

/** Rendered in place of a value we could not read. Never `0`. */
const UNKNOWN_VALUE = '—';

/**
 * `PENDING` exists so an in-flight read is never briefly rendered as
 * `UNKNOWN`: "We can't verify this right now" flashing for 150ms and then
 * resolving to a number is a claim we did not mean to make.
 */
export type KpiVerification = 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN' | 'PENDING';

export interface KpiTileProps {
  icon: ReactNode;
  label: string;
  /** `null` is only valid together with `verification: 'UNKNOWN'`. */
  value: number | null;
  verification: KpiVerification;
  /** Which marker an `UNVERIFIED` tile shows. Ignored otherwise. */
  freshness?: DataFreshnessState;
  /** Extra context, e.g. "of 3 devices". Shown alongside any marker. */
  meta?: string;
  /**
   * Where a non-zero, readable count links to. A zero count is deliberately
   * NOT a link -- there is nothing to look at, and a link that lands on an
   * empty list is a small broken promise.
   */
  to?: string;
  /**
   * The severity accent bar. Only applied when the count is actually non-zero:
   * an orange bar next to "Needs attention: 0" would be alarming about nothing.
   */
  accent?: 'attention' | 'pending' | 'error';
}

const ACCENT_TOKENS: Readonly<Record<'attention' | 'pending' | 'error', string>> = {
  attention: 'var(--status-attention-fg)',
  pending: 'var(--status-pending-fg)',
  error: 'var(--status-error-fg)',
};

export function KpiTile({ icon, label, value, verification, freshness, meta, to, accent }: KpiTileProps) {
  const { t, i18n } = useTranslation();
  const pending = verification === 'PENDING';
  const noValue = pending || verification === 'UNKNOWN' || value === null;
  const unknown = noValue && !pending;
  const unverified = !noValue && verification === 'UNVERIFIED';

  // An unreadable or unverifiable tile takes the violet "we cannot vouch for
  // this" accent, which outranks its own severity accent -- the honest thing
  // to lead with is the uncertainty, not a count we do not trust.
  const accentToken = unknown || unverified
    ? 'var(--status-unverified-fg)'
    : accent && !noValue && (value ?? 0) > 0
      ? ACCENT_TOKENS[accent]
      : undefined;

  const metaText = unknown ? t('dashboard.kpi.cannotVerify') : pending ? t('common.loading') : meta;

  const body = (
    <>
      <span className="kpi-icon" aria-hidden="true">
        {icon}
      </span>
      <span className={unknown ? 'kpi-value kpi-value-unknown' : 'kpi-value'}>
        {noValue ? UNKNOWN_VALUE : formatNumber(value, i18n.language)}
      </span>
      <span className="kpi-label">{label}</span>
      {(metaText || unverified) && (
        <span className="kpi-meta">
          {metaText}
          {unverified && freshness && (
            <>
              {metaText ? ' ' : ''}
              <FreshnessMarker state={freshness} />
            </>
          )}
        </span>
      )}
    </>
  );

  const style = accentToken ? ({ '--kpi-accent': accentToken } as CSSProperties) : undefined;

  // Only a readable, non-zero count is a link.
  if (to && !noValue && (value ?? 0) > 0) {
    return (
      <Link className="kpi-tile" to={to} style={style}>
        {body}
      </Link>
    );
  }
  return (
    <div className="kpi-tile" style={style}>
      {body}
    </div>
  );
}
