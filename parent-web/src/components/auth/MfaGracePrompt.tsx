import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import type { ParentMfaStatus } from '../../api/interfaces';
import { formatDateTime, formatDurationUnit } from '../../i18n/formatters';
import { dismissMfaGraceReminder, isMfaGraceReminderDismissed } from './mfaGraceDismissal';

const HOUR_MS = 60 * 60 * 1000;

/**
 * PCA-DEC-037 grace reminder, shown inside the console while the account has
 * no authenticator app yet. The time left is DISPLAY ONLY, computed from the
 * server's `graceExpiresAt` against the local clock; the server alone decides
 * when setup becomes mandatory.
 */
export function MfaGracePrompt({ mfa }: { mfa: ParentMfaStatus }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(isMfaGraceReminderDismissed);

  if (mfa.status !== 'GRACE' || dismissed) return null;

  const remainingMs = Math.max(0, Date.parse(mfa.graceExpiresAt) - Date.now());
  const totalHours = Math.floor(remainingMs / HOUR_MS);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const lng = i18n.language;

  let timeLeft: string;
  if (totalHours === 0) timeLeft = t('mfa.grace.lessThanAnHour');
  else if (days === 0) timeLeft = t('mfa.grace.timeLeftHours', { hours: formatDurationUnit(hours, 'hour', lng) });
  else timeLeft = t('mfa.grace.timeLeft', { days: formatDurationUnit(days, 'day', lng), hours: formatDurationUnit(hours, 'hour', lng) });

  const dismiss = () => {
    dismissMfaGraceReminder();
    setDismissed(true);
  };

  return (
    <section className="banner banner-attention mfa-grace-prompt" aria-labelledby="mfa-grace-title" data-testid="mfa-grace-prompt">
      <div className="banner-body">
        <h2 id="mfa-grace-title" className="banner-headline">
          {t('mfa.grace.title')}
        </h2>
        <p className="banner-text">{t('mfa.grace.body')}</p>
        <p className="banner-text">{timeLeft}</p>
        <p className="banner-text">{t('mfa.grace.deadline', { date: formatDateTime(mfa.graceExpiresAt, lng) })}</p>
      </div>
      <div className="banner-actions">
        <Link to="/mfa/setup" state={{ from: location.pathname }} className="btn btn-primary" data-testid="mfa-grace-setup-now">
          {t('mfa.grace.setUpNow')}
        </Link>
        <button type="button" className="btn" onClick={dismiss} data-testid="mfa-grace-remind-later">
          {t('mfa.grace.remindLater')}
        </button>
      </div>
    </section>
  );
}
