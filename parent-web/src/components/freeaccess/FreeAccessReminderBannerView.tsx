import { useTranslation } from 'react-i18next';
import { formatDate, NO_VALUE } from '../../i18n/formatters';
import { Link } from 'react-router-dom';
import type { FreeAccessStatus } from '../../domain/freeAccess';

export interface FreeAccessReminderBannerViewProps {
  status: FreeAccessStatus;
  onDismiss: () => void;
}

/**
 * FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61): purely a rendering of the
 * server-derived `FreeAccessStatus` -- never recomputes remainingDays/
 * expiry/status itself, never shows for `mode === 'PERPETUAL'` (that case
 * is filtered out by the container, not here, so this component's contract
 * stays "render exactly what I was given"). No manipulative urgency
 * language anywhere (no "act now", no exclamation marks, no countdown
 * animation) -- plain, honest, factual statements only, per
 * WRITER61_ASSIGNMENT.md's explicit requirement.
 *
 * Post-expiry (`status.status === 'EXPIRED'`) NEVER implies protection was
 * deleted/disabled -- it states only that the free access PERIOD has
 * ended, and that existing child protection keeps running.
 */
export function FreeAccessReminderBannerView({ status, onDismiss }: FreeAccessReminderBannerViewProps) {
  const { t, i18n } = useTranslation();

  if (status.status === 'PERPETUAL') return null;

  // Was toLocaleDateString(undefined, ...). Passing `undefined` selects the HOST
  // locale, not the app's, so an Arabic UI rendered an English month --
  // observed live as: "ينتهي بتاريخ October 3, 2026". PCA-FR-113 forbids a
  // mixed-language fallback. formatDate() takes the active i18n language
  // explicitly and returns NO_VALUE for a null or unparseable instant, so the
  // existing "render nothing rather than something wrong" behaviour is kept.
  const formattedExpiresAt = formatDate(status.expiresAt, i18n.language);
  const expiresAtDisplay = formattedExpiresAt === NO_VALUE ? null : formattedExpiresAt;

  if (status.status === 'EXPIRED') {
    return (
      <div className="free-access-banner free-access-banner-expired" role="status">
        <div className="free-access-banner-text">
          <p className="free-access-banner-headline">{t('freeAccess.expiredHeadline')}</p>
          <p>{t('freeAccess.expiredBody')}</p>
        </div>
        <div className="free-access-banner-actions">
          <Link to="/subscription" className="btn btn-primary">
            {t('freeAccess.billingCta')}
          </Link>
          <button type="button" className="btn btn-inline" onClick={onDismiss}>
            {t('common.close')}
          </button>
        </div>
      </div>
    );
  }

  // ACTIVE (TIME_LIMITED only reaches here -- PERPETUAL returned above).
  const days = status.remainingDays;
  const headline = days === 0 ? t('freeAccess.expiresTodayHeadline') : t('freeAccess.remainingDaysHeadline', { count: days ?? 0 });

  return (
    <div className="free-access-banner free-access-banner-active" role="note">
      <div className="free-access-banner-text">
        <p className="free-access-banner-headline">{headline}</p>
        {expiresAtDisplay && <p>{t('freeAccess.expiresOnBody', { date: expiresAtDisplay })}</p>}
      </div>
      <div className="free-access-banner-actions">
        <Link to="/subscription" className="btn btn-primary">
          {t('freeAccess.billingCta')}
        </Link>
        <button type="button" className="btn btn-inline" onClick={onDismiss} aria-label={t('freeAccess.dismissForToday')}>
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
