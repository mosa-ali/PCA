import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { platformAdminActivationApi } from '../api/platformAdminActivationClient';
import { PlatformAdminApiError } from '../api/platformAdminAuthClient';
import { LanguageSwitcher } from '../components/common/LanguageSwitcher';

export default function Activation() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  // The enrollment URI is a SECRET-BEARING value: anyone who scans or reads it
  // holds the TOTP secret. It was previously rendered in a permanently visible
  // readOnly textarea, which put the secret on screen for every shoulder, screen
  // share and screenshot. It is now revealed only on explicit request.
  const [uriRevealed, setUriRevealed] = useState(false);

  // The ceremony is started EXACTLY ONCE, for two independent reasons.
  //
  // (1) LANGUAGE. This effect used to depend on `t` as well, and react-i18next
  // hands back a NEW `t` on every language change. Switching language therefore
  // re-ran `start`; its second call is refused by beginMfa's single-winner guard,
  // the client mapped that to activation.invalid, and an operator who merely chose
  // a language they read better was told their link was invalid -- mid-ceremony,
  // with the enrollment secret already issued. The error is stored as a KEY and
  // translated at render, so copy still follows the active language with nothing
  // language-dependent in the dep array.
  //
  // (2) STRICTMODE. In development React 18 mounts, runs effects, then RE-RUNS
  // them on the same instance, so even a [token]-only effect fires `start` twice
  // and produces the same false "invalid link" beside a QR that actually works.
  // A ref survives that replay because the instance is not recreated, which is
  // exactly why the guard is a ref and not state. `token` comes from a lazy
  // useState initialiser and never changes, so a guarded re-run is never wanted.
  const startAttempted = useRef(false);
  useEffect(() => {
    window.history.replaceState({}, document.title, `${window.location.pathname}`);
    if (!token) { setErrorKey('activation.invalid'); setBusy(false); return; }
    if (startAttempted.current) return;
    startAttempted.current = true;
    platformAdminActivationApi
      .start(token)
      .then((result) => setOtpauthUri(result.otpauthUri))
      // A refused activation is an invalid link; a transport or service failure is
      // NOT, and blaming the link sends the operator down an unnecessary reissue.
      .catch((err) => setErrorKey(err instanceof PlatformAdminApiError ? 'activation.invalid' : 'activation.unavailable'))
      .finally(() => setBusy(false));
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setErrorKey(null);
    try { await platformAdminActivationApi.complete(token, password, totpCode); navigate('/login', { replace: true }); }
    catch (err) { setErrorKey(err instanceof PlatformAdminApiError ? 'activation.invalid' : 'activation.unavailable'); }
    finally { setBusy(false); }
  };
  return <div className="login-page"><div className="login-language-bar"><LanguageSwitcher /></div><form className="card login-card" onSubmit={submit} noValidate>
    <h1>{t('activation.title')}</h1>
    {busy && !otpauthUri && !errorKey ? <p>{t('activation.loading')}</p> : null}
    {otpauthUri && <><p>{t('activation.instructions')}</p>
      {/* Rendered entirely in this browser from the URI already returned by the
          authorized activation call. QRCodeSVG draws the modules itself -- no
          image URL, no remote renderer, and the URI never leaves the page. The
          group is labelled so the code is not an unlabelled graphic, and the
          SVG inside is hidden from assistive tech so the URI is announced once
          via the label rather than as a second, meaningless image. The textual
          instructions above remain the primary content: a QR is not usable by
          every screen reader or low-vision user, and the manual reveal below is
          the documented fallback. */}
      <div role="img" aria-label={t('activation.qrAlt')}>
        <QRCodeSVG value={otpauthUri} size={176} level="M" aria-hidden="true" focusable="false" />
      </div>
      <p>{t('activation.qrHint')}</p>
      {uriRevealed ? <><label htmlFor="activation-uri">{t('activation.uri')}</label><textarea id="activation-uri" readOnly value={otpauthUri} rows={3} /><button type="button" className="btn" onClick={() => setUriRevealed(false)}>{t('activation.hideUri')}</button></> : <button type="button" className="btn" onClick={() => setUriRevealed(true)}>{t('activation.showUri')}</button>}
    </>}
    <label htmlFor="activation-password">{t('activation.password')}</label><input id="activation-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={password} onChange={(e) => setPassword(e.target.value)} />
    <label htmlFor="activation-totp">{t('activation.totp')}</label><input id="activation-totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    {errorKey && <p role="alert" className="field-error">{t(errorKey)}</p>}
    <button type="submit" className="btn btn-primary" disabled={busy || !otpauthUri || password.length < 12 || totpCode.length !== 6}>{t('activation.submit')}</button>
  </form></div>;
}
