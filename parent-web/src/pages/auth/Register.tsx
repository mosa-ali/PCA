import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { ServiceAuthError } from '../../api/real/realServiceAuthClient';

/**
 * PCA-AUTH-SESSION-1 (PCA-DEC-026) self-service registration. Server
 * validates password===passwordConfirmation itself (PCA-ADD-IDENT-004) --
 * this page's own client-side check is UX-only, never trusted alone.
 *
 * Submitting this form again for an email already PENDING_VERIFICATION is
 * ALSO the real resend-code mechanism (ParentAccountService.register's own
 * doc comment: the response is identical whether the email is new,
 * already-pending, or already-verified -- never an enumeration oracle).
 * VerifyEmail.tsx's "resend code" link relies on exactly this and lands
 * here with the email prefilled via location.state.
 */
export default function Register() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const clients = getApiClients();

  const prefillEmail = (location.state as { email?: string } | null)?.email ?? '';
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinguishes the one genuinely field-scoped error (the two password
  // fields disagree) from the form-scoped ones (rate limit, generic), so
  // aria-invalid is only ever set on inputs that really are invalid.
  const [passwordMismatch, setPasswordMismatch] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPasswordMismatch(false);

    if (password !== passwordConfirmation) {
      setError(t('auth.passwordMismatch'));
      setPasswordMismatch(true);
      return;
    }

    setSubmitting(true);
    try {
      await clients.serviceAuth.register(email, password, passwordConfirmation);
      navigate('/verify-email', { state: { email } });
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

  return (
    <section aria-labelledby="register-title" className="auth-page">
      <h1 id="register-title">{t('auth.registerTitle')}</h1>
      <p>{t('auth.registerBody')}</p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="register-email">{t('auth.emailLabel')}</label>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby={error ? 'register-error' : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="register-password">{t('auth.passwordLabel')}</label>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            aria-describedby={error ? 'register-error' : undefined}
            aria-invalid={passwordMismatch || undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="register-password-confirmation">{t('auth.passwordConfirmationLabel')}</label>
          <input
            id="register-password-confirmation"
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            aria-describedby={error ? 'register-error' : undefined}
            aria-invalid={passwordMismatch || undefined}
            value={passwordConfirmation}
            onChange={(e) => setPasswordConfirmation(e.target.value)}
          />
        </div>

        {error && (
          <p id="register-error" role="alert" className="field-error">
            {error}
          </p>
        )}

        <button type="submit" className="btn" disabled={submitting} aria-busy={submitting}>
          {t('auth.registerSubmit')}
        </button>
      </form>
      <p>
        {t('auth.haveAccount')} <Link to="/login">{t('auth.signInLink')}</Link>
      </p>
    </section>
  );
}
