import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { formatMoney } from '../../domain/billing';

export default function InvoiceDetail() {
  const { t, i18n } = useTranslation();
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.billing.getInvoice(invoiceId ?? ''), [invoiceId]);

  return (
    <section aria-labelledby="invoice-detail-title">
      <h1 id="invoice-detail-title">{t('subscription.invoices.detailTitle', { id: invoiceId ?? '' })}</h1>
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && !data && <ErrorState message={t('subscription.invoices.notFound')} />}
      {!loading && !error && data && (
        <div className="card">
          <dl>
            <dt>{t('subscription.invoices.statusLabel')}</dt>
            <dd>{t(`subscription.invoices.status.${data.status}`)}</dd>
            <dt>{t('subscription.invoices.date')}</dt>
            <dd>{new Date(data.createdAtUtc).toLocaleDateString(i18n.language)}</dd>
            <dt>{t('subscription.invoices.total')}</dt>
            <dd>{formatMoney(data.total, i18n.language)}</dd>
          </dl>
          <h2>{t('subscription.invoices.lineItems')}</h2>
          <ul className="plain-list">
            {data.lines.map((line, index) => (
              <li key={index}>
                {line.description} &mdash; {formatMoney(line.amount, i18n.language)}
                {line.quantity > 1 ? ` (${t('subscription.invoices.quantity', { count: line.quantity })})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p>
        <Link to="/subscription/invoices">{t('common.back')}</Link>
      </p>
    </section>
  );
}
