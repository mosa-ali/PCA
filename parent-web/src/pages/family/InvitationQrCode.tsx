import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useTranslation } from 'react-i18next';

/**
 * PCA-ADD-ENR-002 (Addendum 001): renders the invitation enrollment link as
 * a QR code so a parent can show it to the child's Android device to speed
 * up enrollment (EnrollmentLinkParser.kt already parses this exact link
 * shape -- android/app/src/main/java/org/pca/app/enrollment/
 * EnrollmentLinkParser.kt -- this component adds no new link format).
 *
 * PCA-ADD-ENR-003: the QR code encodes ONLY the enrollment link the caller
 * already displays as plain text elsewhere in this panel -- the same
 * one-time bearer token, nothing else (no parent password, Administration
 * PIN, family key, or child information). It carries no additional secret
 * beyond what the existing "copy link" affordance already reveals.
 *
 * Rendered client-side only (the `qrcode` package's browser build, no
 * network call to a third-party QR-image service) so the invitation link
 * -- a one-time bearer credential -- is never sent to anyone other than
 * the browser rendering it.
 */
export default function InvitationQrCode({ value }: { value: string }) {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(false);
    QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: 220 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (error) return null;

  return (
    <div className="invitation-qr-code" data-testid="invitation-qr-code">
      {dataUrl ? (
        <img src={dataUrl} alt={t('deviceEnrollment.qrCodeAlt')} width={220} height={220} />
      ) : (
        <div aria-hidden="true" style={{ width: 220, height: 220 }} />
      )}
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{t('deviceEnrollment.qrCodeHint')}</p>
    </div>
  );
}
