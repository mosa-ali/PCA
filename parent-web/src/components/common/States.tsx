import { useTranslation } from 'react-i18next';

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="state-block" role="status" aria-live="polite">
      <p>{label ?? t('common.loading')}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="state-block" role="alert">
      <h3>{t('common.errorTitle')}</h3>
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
      <h3>{t('common.emptyTitle')}</h3>
      {message && <p>{message}</p>}
    </div>
  );
}
