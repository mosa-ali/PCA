// PCA-ADD-PA-035: every entitlement-change-request lifecycle state must be
// shown distinctly -- in particular PAYMENT_PENDING must never be
// mislabeled as approved, and PENDING_ADMIN_QUOTE (awaitingAdminQuote=true
// while state=PENDING) must read differently from an ordinary PENDING.
// Status is never conveyed by color alone (doc 26 accessibility bar) -- the
// label text itself is the signal.
import { useTranslation } from 'react-i18next';
import type { EntitlementChangeRequest } from '../../domain/billing';

function labelKeyFor(request: EntitlementChangeRequest): string {
  if (request.state === 'PENDING' && request.awaitingAdminQuote) return 'subscription.requestState.PENDING_ADMIN_QUOTE';
  return `subscription.requestState.${request.state}`;
}

export function RequestStateBadge({ request }: { request: EntitlementChangeRequest }) {
  const { t } = useTranslation();
  return (
    <span className={`status-badge status-${request.state}`}>
      <span className="dot" aria-hidden="true" />
      {t(labelKeyFor(request))}
    </span>
  );
}
