import { useTranslation } from 'react-i18next';

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="state-block" role="status" aria-live="polite">
      <p>{label ?? t('common.loading')}</p>
    </div>
  );
}

// PCA-NFR-041/045: these two headings were `<h3>` unconditionally, which
// broke axe-core's heading-order rule (WCAG 1.3.1) wherever a page renders
// ErrorState/EmptyState directly under its own top-level `<h1>` with no
// intervening `<h2>` (e.g. billing/CheckoutReturn.tsx) -- an h1 -> h3 jump
// with no h2 in between. Found by real axe-core coverage added for
// CheckoutReturn, not a hypothetical. `<h2>` is correct here: every
// existing call site places these directly after the page's own `<h1>`
// (see e.g. billing/DeviceIncreaseRequest.tsx, Settings.tsx has none), so
// this is a pure fix, not a level chosen to paper over one call site while
// breaking another.
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="state-block" role="alert">
      <h2>{t('common.errorTitle')}</h2>
      <p>{message ?? t('common.errorGeneric')}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <div className="state-block">
      <h2>{t('common.emptyTitle')}</h2>
      {message && <p>{message}</p>}
    </div>
  );
}
