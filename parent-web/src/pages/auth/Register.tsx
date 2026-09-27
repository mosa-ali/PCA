import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { ServiceAuthError } from '../../api/real/realServiceAuthClient';
import type { ParentAccountType } from '../../api/interfaces';
import { validateParentIdentityNames } from '../../identity/identityForm';
import { normalizeOptionalParentPhone } from '../../identity/phoneNumber';

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
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(prefillEmail);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [accountType, setAccountType] = useState<ParentAccountType>('PARENT_GUARDIAN');
  const [estimatedChildCount, setEstimatedChildCount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinguishes the one genuinely field-scoped error (the two password
  // fields disagree) from the form-scoped ones (rate limit, generic), so
  // aria-invalid is only ever set on inputs that really are invalid.
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const [invalidIdentityField, setInvalidIdentityField] = useState<'firstName' | 'lastName' | 'phoneNumber' | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPasswordMismatch(false);
    setInvalidIdentityField(null);

    const identity = validateParentIdentityNames(firstName, lastName);
    if (!identity.valid) {
      setInvalidIdentityField(identity.field);
      setError(
        identity.reason === 'required'
          ? t('auth.identityNameRequired')
          : identity.reason === 'too_long'
            ? t('auth.identityNameTooLong')
            : t('auth.identityNameInvalid'),
      );
      return;
    }

    if (!normalizeOptionalParentPhone(phoneNumber).valid) {
      setInvalidIdentityField('phoneNumber');
      setError(t('auth.phoneInvalid'));
      return;
    }

    const parsedChildCount = estimatedChildCount.trim() === '' ? null : Number(estimatedChildCount);
    if (parsedChildCount !== null && (!Number.isInteger(parsedChildCount) || parsedChildCount < 0 || parsedChildCount > 50)) {
      setError(t('auth.estimatedChildCountInvalid'));
      return;
    }

    if (!event.currentTarget.checkValidity()) {
      event.currentTarget.reportValidity();
      return;
    }

    if (password !== passwordConfirmation) {
      setError(t('auth.passwordMismatch'));
      setPasswordMismatch(true);
      return;
    }

    setSubmitting(true);
    try {
      await clients.serviceAuth.register(email, password, passwordConfirmation, {
        firstName: identity.value.firstName,
        lastName: identity.value.lastName,
        phoneNumber: phoneNumber.trim() || null,
        accountType,
        estimatedChildCount: parsedChildCount,
      });
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
          <label htmlFor="register-first-name">{t('auth.firstNameLabel')}</label>
          <input
            id="register-first-name"
            name="firstName"
            type="text"
            autoComplete="given-name"
            dir="auto"
            required
            maxLength={256}
            aria-invalid={invalidIdentityField === 'firstName' || undefined}
            aria-describedby={invalidIdentityField === 'firstName' ? 'register-error' : undefined}
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              setError(null);
              if (invalidIdentityField === 'firstName') setInvalidIdentityField(null);
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="register-last-name">{t('auth.lastNameLabel')}</label>
          <input
            id="register-last-name"
            name="lastName"
            type="text"
            autoComplete="family-name"
            dir="auto"
            required
            maxLength={256}
            aria-invalid={invalidIdentityField === 'lastName' || undefined}
            aria-describedby={invalidIdentityField === 'lastName' ? 'register-error' : undefined}
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              setError(null);
              if (invalidIdentityField === 'lastName') setInvalidIdentityField(null);
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="register-email">{t('auth.emailLabel')}</label>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby={error && invalidIdentityField === null ? 'register-error' : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="register-phone-number">{t('auth.phoneNumberLabel')}</label>
          <input
            id="register-phone-number"
            name="phoneNumber"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            maxLength={64}
            aria-invalid={invalidIdentityField === 'phoneNumber' || undefined}
            aria-describedby={invalidIdentityField === 'phoneNumber' ? 'register-phone-hint register-error' : 'register-phone-hint'}
            value={phoneNumber}
            onChange={(e) => {
              setPhoneNumber(e.target.value);
              setError(null);
              if (invalidIdentityField === 'phoneNumber') setInvalidIdentityField(null);
            }}
          />
          <p id="register-phone-hint" className="field-hint">{t('auth.phoneOptionalHint')}</p>
        </div>

        <div className="field">
          <label htmlFor="register-account-type">{t('auth.accountTypeLabel')}</label>
          <select id="register-account-type" name="accountType" value={accountType} onChange={(e) => setAccountType(e.target.value as ParentAccountType)}>
            <option value="PARENT_GUARDIAN">{t('auth.accountTypeParentGuardian')}</option>
            <option value="OTHER">{t('auth.accountTypeOther')}</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="register-estimated-child-count">{t('auth.estimatedChildCountLabel')}</label>
          <input
            id="register-estimated-child-count"
            name="estimatedChildCount"
            type="number"
            min="0"
            max="50"
            inputMode="numeric"
            value={estimatedChildCount}
            onChange={(e) => setEstimatedChildCount(e.target.value)}
          />
          <p className="field-hint">{t('auth.estimatedChildCountHint')}</p>
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
            aria-describedby={error ? 'register-password-hint register-error' : 'register-password-hint'}
            aria-invalid={passwordMismatch || undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p id="register-password-hint" className="field-hint">
            {t('auth.passwordRequirements')}
          </p>
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
