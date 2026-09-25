import { useMemo } from 'react';
import QRCode from 'qrcode';

/**
 * Renders the authenticator enrollment URI (otpauth://...) as a QR code,
 * ENTIRELY LOCALLY: the `qrcode` package computes the module matrix in this
 * browser and it is drawn as inline SVG. There is no network request, no
 * third-party QR-image service, no <img> or data: URL, and no canvas export --
 * the URI contains the account's authenticator secret, so it must never leave
 * this page.
 *
 * A QR code is an opaque square: it does NOT mirror under `dir="rtl"`
 * (`direction: ltr` is pinned on the wrapper).
 */
export function TotpQrCode({ value, title }: { value: string; title: string }) {
  const matrix = useMemo(() => {
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
      const size = qr.modules.size;
      let path = '';
      for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
          if (qr.modules.get(row, col)) path += `M${col} ${row}h1v1h-1z`;
        }
      }
      return { size, path };
    } catch {
      return null;
    }
  }, [value]);

  if (!matrix) return null;
  const quiet = 2;
  const viewBox = `${-quiet} ${-quiet} ${matrix.size + quiet * 2} ${matrix.size + quiet * 2}`;

  return (
    <div className="mfa-qr" data-testid="mfa-qr-code">
      <svg role="img" aria-label={title} viewBox={viewBox} width={220} height={220} shapeRendering="crispEdges">
        <rect x={-quiet} y={-quiet} width={matrix.size + quiet * 2} height={matrix.size + quiet * 2} fill="#ffffff" />
        <path d={matrix.path} fill="#000000" />
      </svg>
    </div>
  );
}
