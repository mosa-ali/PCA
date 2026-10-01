import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { ServiceAuthError } from '../../api/real/realServiceAuthClient';

/**
 * PCA product-completion programme (P1 /login finding): account-level
 * password reset request. requestPasswordReset() always resolves to the
 * identical RESET_CODE_SENT_IF_ACCOUNT_EXISTS result regardless of whether
 * the email matches a real, verified account -- so this page must always
 * show the same success state on a successful call, never branch on
 * whether the account "really" existed (that would reintroduce the
 * enumeration oracle the backend was built specifically to avoid).
 */
export default function ForgotPassword() {
  const { t } = useTranslation();
  const clients = getApiClients();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // The success state replaces the whole form, unmounting the submit button
  // that had focus -- without this, focus falls back to <body> and nothing
  // is announced. Mirrors AppLayout.tsx's `<main tabIndex={-1}>` pattern.
  const successHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (done) successHeadingRef.current?.focus();
  }, [done]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await clients.serviceAuth.requestPasswordReset(email);
      setDone(true);
    } catch (err) {
      if (err instanceof ServiceAuthError && err.code === 'RATE_LIMITED') {
        setError(t('auth.rateLimited'));
      } else {
        setError(t('auth.genericError'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <section aria-labelledby="forgot-password-success-title" className="auth-page">
        <h1 id="forgot-password-success-title" ref={successHeadingRef} tabIndex={-1}>
          {t('auth.forgotPasswordSuccessTitle')}
        </h1>
        <p>{t('auth.forgotPasswordSuccess')}</p>
        <p>
          {t('auth.haveResetCode')}{' '}
          <Link to="/reset-password" state={{ email }}>
            {t('auth.resetPasswordEntryLink')}
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="forgot-password-title" className="auth-page">
      <h1 id="forgot-password-title">{t('auth.forgotPasswordTitle')}</h1>
      <p>{t('auth.forgotPasswordBody')}</p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="forgot-password-email">{t('auth.emailLabel')}</label>
          <input
            id="forgot-password-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby={error ? 'forgot-password-error' : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {error && (
          <p id="forgot-password-error" role="alert" className="field-error">
            {error}
          </p>
        )}

        <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
          {t('auth.forgotPasswordSubmit')}
        </button>
      </form>
      <p>
        <Link to="/login">{t('auth.backToLogin')}</Link>
      </p>
    </section>
  );
}
