// Data freshness is a SEPARATE axis from status.
//
// Status says what the number means. Freshness says how much we can vouch for
// it right now. Conflating the two is how a console starts telling a parent
// their child's device is protected when all it actually knows is what the
// device said an hour ago.
//
// So freshness never renders as a status pill. It renders as a small outlined
// marker attached to the value it qualifies -- and `LIVE` renders NOTHING AT
// ALL. Absence of a marker is the "verified" signal, which means a marker on
// screen always, unambiguously, means "not verified right now".
import { useTranslation } from 'react-i18next';
import type { DataFreshnessState } from '../../domain/types';

/** Neither glyph mirrors: a clock is clockwise everywhere, a shield has no direction. */
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true" focusable="false" width="12" height="12">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" />
    </svg>
  );
}

function ShieldQuestionIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" width="12" height="12">
      <path d="M12 2.75 4.75 5.5v5.9c0 4.4 3 8.2 7.25 9.85 4.25-1.65 7.25-5.45 7.25-9.85V5.5Z" />
      <path d="M10.25 9.75a1.85 1.85 0 1 1 2.6 1.7c-.55.27-.85.75-.85 1.3v.5M12 16.5h.01" />
    </svg>
  );
}

export function FreshnessMarker({ state }: { state: DataFreshnessState }) {
  const { t } = useTranslation();
  if (state === 'LIVE') return null;
  const cached = state === 'CACHED';
  return (
    <span className={cached ? 'freshness-marker freshness-cached' : 'freshness-marker freshness-unavailable'}>
      {cached ? <ClockIcon /> : <ShieldQuestionIcon />}
      {cached ? t('dashboard.cachedShort') : t('dashboard.notVerified')}
    </span>
  );
}
