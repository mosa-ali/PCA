import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import type { ParentMfaStatus } from '../../api/interfaces';
import { dismissMfaGraceReminder, isMfaGraceReminderDismissed } from './mfaGraceDismissal';

/**
 * Required authenticator enrollment reminder. Its countdown is calculated
 * from the server deadline carried by the authenticated session; browser
 * storage only remembers that the current tab dismissed this reminder.
 */
export function MfaGracePrompt({ mfa }: { mfa: ParentMfaStatus }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(isMfaGraceReminderDismissed);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (mfa.status !== 'GRACE' || dismissed) return null;

  const remainingMs = Math.max(0, Date.parse(mfa.graceExpiresAt) - now);
  const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
  const remainingDays = Math.floor(remainingHours / 24);
  const hours = remainingHours % 24;
  const remaining = remainingDays > 0
    ? t('mfa.grace.countdownDays', { days: remainingDays, hours })
    : t('mfa.grace.countdownHours', { hours: remainingHours });

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
        <p className="banner-text">{t('mfa.grace.body', { remaining })}</p>
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
