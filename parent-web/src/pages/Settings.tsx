import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { applyDocumentDirection, hasStoredLanguagePreference } from '../i18n';
import { errorDiagnosticDetail, userFacingErrorKey } from '../i18n/errorMessages';
import { reportDiagnostic } from '../security/diagnosticConsole';
import { getApiClients } from '../api/client';
import { validateParentIdentityNames } from '../identity/identityForm';
import type { ParentIdentityProfile } from '../api/interfaces';
import { clearMfaGraceReminderDismissal } from '../components/auth/mfaGraceDismissal';
import './settingsIdentity.css';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<ParentIdentityProfile | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityFeedback, setIdentityFeedback] = useState<string | null>(null);
  const [invalidNameField, setInvalidNameField] = useState<'firstName' | 'lastName' | null>(null);
  const [confirmRevokeAllSessions, setConfirmRevokeAllSessions] = useState(false);
  const [revokingAllSessions, setRevokingAllSessions] = useState(false);
  const [revokeAllSessionsError, setRevokeAllSessionsError] = useState(false);
  const identityLoadErrorText = useRef(t('settings.identityLoadFailed'));

  useEffect(() => {
    identityLoadErrorText.current = t('settings.identityLoadFailed');
  }, [t]);

  useEffect(() => {
    void clients.parentPreferences.get().then((preferences) => {
      // The account-level saved preference seeds a browser that has never been
      // given an explicit choice. Once the parent has chosen a language here or
      // in the header, that choice is persisted by i18next (see ../i18n) and
      // survives reloads, so it must not be overwritten on every visit to this
      // page -- otherwise opening Settings would silently undo the choice the
      // parent just made.
      if (hasStoredLanguagePreference()) return;
      void i18n.changeLanguage(preferences.language);
      applyDocumentDirection(preferences.language);
    }).catch((error: unknown) => {
      reportDiagnostic('[pca] loading parent preferences failed:', errorDiagnosticDetail(error), error);
      setPreferencesError(t('settings.loadPreferencesFailed'));
    });
  }, [clients.parentPreferences, i18n, t]);

  useEffect(() => {
    let active = true;
    void clients.parentIdentity.get().then((profile) => {
      if (!active) return;
      setIdentity(profile);
      setFirstName(profile.firstName ?? '');
      setLastName(profile.lastName ?? '');
      setIdentityError(null);
      setIdentityLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      reportDiagnostic('[pca] loading parent identity failed:', errorDiagnosticDetail(error), error);
      setIdentityError(identityLoadErrorText.current);
      setIdentityLoading(false);
    });
    return () => {
      active = false;
    };
  }, [clients.parentIdentity]);

  const saveIdentity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIdentityError(null);
    setIdentityFeedback(null);
    setInvalidNameField(null);
    const validation = validateParentIdentityNames(firstName, lastName);
    if (!validation.valid) {
      setInvalidNameField(validation.field);
      setIdentityError(
        validation.reason === 'required'
          ? t('settings.identityNameRequired')
          : validation.reason === 'too_long'
            ? t('settings.identityNameTooLong')
            : t('settings.identityNameInvalid'),
      );
      return;
    }

    setIdentitySaving(true);
    try {
      const updated = await clients.parentIdentity.updateNames(validation.value);
      setIdentity(updated);
      setFirstName(updated.firstName ?? validation.value.firstName);
      setLastName(updated.lastName ?? validation.value.lastName);
      setIdentityFeedback(t('settings.identitySaved'));
    } catch (error) {
      reportDiagnostic('[pca] saving parent identity failed:', errorDiagnosticDetail(error), error);
      setIdentityError(t('settings.identitySaveFailed'));
    } finally {
      setIdentitySaving(false);
    }
  };

  const setLanguage = async (language: 'en' | 'ar') => {
    // changeLanguage also writes the choice to this browser's language cache
    // (i18next `caches: ['localStorage']`, see ../i18n), which is what makes it
    // survive the next page load even if the account-level save below fails.
    void i18n.changeLanguage(language);
    applyDocumentDirection(language);
    try {
      await clients.parentPreferences.update({ language });
      setPreferencesError(null);
    } catch (error) {
      reportDiagnostic('[pca] saving language preference failed:', errorDiagnosticDetail(error), error);
      // A known, describable failure (untrusted browser endpoint, backend not
      // wired yet) keeps its own honest copy; anything else gets the
      // save-specific sentence rather than a raw `error.message`.
      const knownKey = userFacingErrorKey(error);
      setPreferencesError(knownKey ? t(knownKey) : t('settings.saveLanguageFailed'));
    }
  };

  const revokeAllSessions = async () => {
    setRevokeAllSessionsError(false);
    setRevokingAllSessions(true);
    try {
      await clients.serviceAuth.revokeAllSessions();
      clearMfaGraceReminderDismissal();
      window.location.assign('/login');
    } catch (error) {
      reportDiagnostic('[pca] revoking all parent sessions failed:', errorDiagnosticDetail(error), error);
      setRevokeAllSessionsError(true);
      setRevokingAllSessions(false);
    }
  };
  return (
    <section aria-labelledby="settings-title">
      <h1 id="settings-title">{t('nav.settings')}</h1>
      <div className="card" aria-labelledby="settings-language-title">
        <h2 id="settings-language-title">{t('settings.languageSectionTitle')}</h2>
        <div className="field">
          <label htmlFor="lang-select">{t('shell.language')}</label>
          <select
            id="lang-select"
            value={i18n.language.split('-')[0]}
            onChange={(e) => {
              void setLanguage(e.target.value as 'en' | 'ar');
            }}
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
        </div>
        {preferencesError && <p role="alert">{preferencesError}</p>}
      </div>

      <div className="card" aria-labelledby="settings-identity-title">
        <h2 id="settings-identity-title">{t('settings.identitySectionTitle')}</h2>
        {identityLoading ? (
          <p role="status">{t('settings.identityLoading')}</p>
        ) : identityError && !identity ? (
          <p role="alert">{identityError}</p>
        ) : identity ? (
          <>
            <dl className="settings-identity-contact">
              <div>
                <dt>{t('settings.emailLabel')}</dt>
                <dd>
                  <bdi dir="auto">{identity.email ?? t('settings.notProvided')}</bdi>
                  <span className="field-hint">
                    {identity.emailVerified ? t('settings.emailVerified') : t('settings.emailVerificationPending')}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{t('settings.phoneNumberLabel')}</dt>
                <dd>
                  <bdi dir="auto">{identity.phoneNumber ?? t('settings.notProvided')}</bdi>
                  <span className="field-hint">
                    {identity.phoneVerified ? t('settings.phoneVerified') : t('settings.phoneVerificationPending')}
                  </span>
                </dd>
              </div>
            </dl>

            <form onSubmit={saveIdentity} noValidate>
              <div className="field">
                <label htmlFor="settings-first-name">{t('settings.firstNameLabel')}</label>
                <input
                  id="settings-first-name"
                  name="firstName"
                  type="text"
                  autoComplete="given-name"
                  dir="auto"
                  required
                  maxLength={256}
                  aria-invalid={invalidNameField === 'firstName' || undefined}
                  aria-describedby={invalidNameField === 'firstName' && identityError ? 'settings-identity-error' : undefined}
                  value={firstName}
                  onChange={(event) => {
                    setFirstName(event.target.value);
                    setIdentityError(null);
                    setIdentityFeedback(null);
                    if (invalidNameField === 'firstName') setInvalidNameField(null);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="settings-last-name">{t('settings.lastNameLabel')}</label>
                <input
                  id="settings-last-name"
                  name="lastName"
                  type="text"
                  autoComplete="family-name"
                  dir="auto"
                  required
                  maxLength={256}
                  aria-invalid={invalidNameField === 'lastName' || undefined}
                  aria-describedby={invalidNameField === 'lastName' && identityError ? 'settings-identity-error' : undefined}
                  value={lastName}
                  onChange={(event) => {
                    setLastName(event.target.value);
                    setIdentityError(null);
                    setIdentityFeedback(null);
                    if (invalidNameField === 'lastName') setInvalidNameField(null);
                  }}
                />
              </div>
              {identityError && <p id="settings-identity-error" role="alert">{identityError}</p>}
              {identityFeedback && <p role="status">{identityFeedback}</p>}
              <button type="submit" className="btn" disabled={identitySaving} aria-busy={identitySaving}>
                {t('settings.saveIdentity')}
              </button>
            </form>
          </>
        ) : null}
      </div>

      <div className="card" aria-labelledby="settings-sessions-title">
        <h2 id="settings-sessions-title">{t('settings.sessionsSectionTitle')}</h2>
        <p>{t('settings.revokeAllSessionsDescription')}</p>
        {revokeAllSessionsError && <p role="alert">{t('settings.revokeAllSessionsFailed')}</p>}
        {!confirmRevokeAllSessions ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRevokeAllSessionsError(false);
              setConfirmRevokeAllSessions(true);
            }}
          >
            {t('settings.revokeAllSessions')}
          </button>
        ) : (
          <div className="field">
            <p role="status">{t('settings.revokeAllSessionsConfirm')}</p>
            <button
              type="button"
              className="btn"
              onClick={() => void revokeAllSessions()}
              disabled={revokingAllSessions}
              aria-busy={revokingAllSessions}
            >
              {t('settings.confirmRevokeAllSessions')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setConfirmRevokeAllSessions(false);
                setRevokeAllSessionsError(false);
              }}
              disabled={revokingAllSessions}
            >
              {t('settings.cancelRevokeAllSessions')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
