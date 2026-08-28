import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface ConfirmButtonProps {
  label: ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Two-click inline confirmation for a mutating action that is real and
 * consequential but not sensitive enough to warrant this app's established
 * step-up re-verification gate (see AccountDetail.tsx's withStepUp doc
 * comment -- every step-up scope mirrors a fixed, backend-enforced list in
 * backend/src/platformadmin/auth/types.ts, and this codebase otherwise has
 * no separate ConfirmDialog/modal pattern). The first click arms the
 * action and reveals Confirm/Cancel; only an explicit second click on
 * Confirm actually runs it. Armed state resets on Cancel or immediately
 * after firing, so a stale "armed" button can never fire from an unrelated
 * later click.
 */
export function ConfirmButton({ label, onConfirm, disabled, className = 'btn' }: ConfirmButtonProps) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }

  return (
    <span className="actions-row">
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {t('common.confirm')}
      </button>
      <button type="button" className="btn" disabled={disabled} onClick={() => setArmed(false)}>
        {t('common.cancel')}
      </button>
    </span>
  );
}
