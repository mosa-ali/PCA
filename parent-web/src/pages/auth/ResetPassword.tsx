import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { ServiceAuthError } from '../../api/real/realServiceAuthClient';

/**
 * PCA product-completion programme (P1 /login finding): consumes a
 * password-reset code and replaces the account's credential.
 * resetPassword() deliberately does NOT establish a session (unlike
 * verifyEmail) -- on success this page shows an inline confirmation and
 * links back to /login rather than navigating there automatically, since
 * there is no freshly issued session cookie for AuthProvider to pick up.
 */
export default function ResetPassword() {
  const { t } = useTranslation();
  const location = useLocation();
  const clients = getApiClients();

  const prefillEmail = (location.state as { email?: string } | null)?.email ?? '';
  const [email, setEmail] = useState(prefillEmail);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Distinguishes the genuinely field-scoped errors (the two new-password
  // fields disagree; the entered code is wrong) from the form-scoped ones
  // (rate limit, generic), so aria-invalid is only ever set on inputs that
  // really are invalid.
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const [codeInvalid, setCodeInvalid] = useState(false);
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
    setPasswordMismatch(false);
    setCodeInvalid(false);

    if (newPassword !== newPasswordConfirmation) {
      setError(t('auth.passwordMismatch'));
      setPasswordMismatch(true);
      return;
    }

    setSubmitting(true);
    try {
      await clients.serviceAuth.resetPassword(email, code, newPassword, newPasswordConfirmation);
      setDone(true);
    } catch (err) {
      if (err instanceof ServiceAuthError) {
        if (err.code === 'RATE_LIMITED') setError(t('auth.rateLimited'));
        else if (err.code === 'INVALID_CREDENTIALS') {
          setError(t('auth.invalidResetCode'));
          setCodeInvalid(true);
        } else setError(t('auth.genericError'));
      } else {
        setError(t('auth.genericError'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <section aria-labelledby="reset-password-success-title" className="auth-page">
        <h1 id="reset-password-success-title" ref={successHeadingRef} tabIndex={-1}>
          {t('auth.resetPasswordSuccessTitle')}
        </h1>
        <p>{t('auth.resetPasswordSuccess')}</p>
        <p>
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="reset-password-title" className="auth-page">
      <h1 id="reset-password-title">{t('auth.resetPasswordTitle')}</h1>
      <p>{t('auth.resetPasswordBody')}</p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="reset-password-email">{t('auth.emailLabel')}</label>
          <input
            id="reset-password-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby={error ? 'reset-password-error' : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="reset-password-code">{t('auth.codeLabel')}</label>
          <input
            id="reset-password-code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            required
            aria-describedby={error ? 'reset-password-error' : undefined}
            aria-invalid={codeInvalid || undefined}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </div>

        <div className="field">
          <label htmlFor="reset-password-new-password">{t('auth.newPasswordLabel')}</label>
          <input
            id="reset-password-new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            aria-describedby={error ? 'reset-password-error' : undefined}
            aria-invalid={passwordMismatch || undefined}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="reset-password-new-password-confirmation">{t('auth.newPasswordConfirmationLabel')}</label>
          <input
            id="reset-password-new-password-confirmation"
            name="newPasswordConfirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            aria-describedby={error ? 'reset-password-error' : undefined}
            aria-invalid={passwordMismatch || undefined}
            value={newPasswordConfirmation}
            onChange={(e) => setNewPasswordConfirmation(e.target.value)}
          />
        </div>

        {error && (
          <p id="reset-password-error" role="alert" className="field-error">
            {error}
          </p>
        )}

        <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
          {t('auth.resetPasswordSubmit')}
        </button>
      </form>
      <p>
        <Link to="/login">{t('auth.backToLogin')}</Link>
      </p>
    </section>
  );
}
