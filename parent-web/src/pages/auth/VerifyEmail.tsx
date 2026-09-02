import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { ServiceAuthError } from '../../api/real/realServiceAuthClient';

/**
 * PCA-AUTH-SESSION-1 -- consumes the one-time emailed verification code.
 * On success this establishes the FAMILY_SERVICE_SESSION_V1 session
 * (HttpOnly cookie, set by the server response) and, for a brand-new
 * family, triggers genesis. A full page navigation (not client-side
 * router push) is used after success so AuthProvider's mount-time
 * getSession() call picks up the freshly issued cookie.
 */
export default function VerifyEmail() {
  const { t } = useTranslation();
  const location = useLocation();
  const clients = getApiClients();

  const prefillEmail = (location.state as { email?: string } | null)?.email ?? '';
  const [email, setEmail] = useState(prefillEmail);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinguishes the one genuinely field-scoped error (the entered code is
  // wrong/expired) from the form-scoped ones (rate limit, generic), so
  // aria-invalid is only ever set on an input that really is invalid.
  const [codeInvalid, setCodeInvalid] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCodeInvalid(false);
    setSubmitting(true);
    try {
      await clients.serviceAuth.verifyEmail(email, code);
      window.location.assign('/dashboard');
    } catch (err) {
      if (err instanceof ServiceAuthError) {
        if (err.code === 'RATE_LIMITED') setError(t('auth.rateLimited'));
        else if (err.code === 'INVALID_CREDENTIALS') {
          setError(t('auth.invalidCode'));
          setCodeInvalid(true);
        } else setError(t('auth.genericError'));
      } else {
        setError(t('auth.genericError'));
      }
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="verify-email-title" className="auth-page">
      <h1 id="verify-email-title">{t('auth.verifyTitle')}</h1>
      <p>{t('auth.verifyBody', { email: email || t('auth.emailLabel') })}</p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="verify-email-address">{t('auth.emailLabel')}</label>
          <input
            id="verify-email-address"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby={error ? 'verify-email-error' : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="verify-email-code">{t('auth.codeLabel')}</label>
          <input
            id="verify-email-code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            required
            aria-describedby={error ? 'verify-email-error' : undefined}
            aria-invalid={codeInvalid || undefined}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </div>

        {error && (
          <p id="verify-email-error" role="alert" className="field-error">
            {error}
          </p>
        )}

        <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
          {t('auth.verifySubmit')}
        </button>
      </form>
      <p>
        {t('auth.resendCodePrompt')}{' '}
        <Link to="/register" state={{ email }}>
          {t('auth.resendCodeLink')}
        </Link>
      </p>
    </section>
  );
}
