import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { formatMoney } from '../../domain/billing';

export default function Invoices() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.billing.listInvoices(), []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <section aria-labelledby="invoices-title">
      <h1 id="invoices-title">{t('subscription.invoices.title')}</h1>
      {data.length === 0 ? (
        // A plain paragraph, not the shared h3-level EmptyState component --
        // this section has no h2 between it and the h1 above, so an h3 here
        // would skip a heading level (WCAG 1.3.1/axe heading-order).
        <p>{t('subscription.invoices.empty')}</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table responsive-cards">
            <thead>
              <tr>
                <th scope="col">{t('subscription.invoices.date')}</th>
                <th scope="col">{t('subscription.invoices.statusLabel')}</th>
                <th scope="col">{t('subscription.invoices.total')}</th>
                <th scope="col" aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {data.map((invoice) => (
                <tr key={invoice.invoiceId}>
                  <td data-label={t('subscription.invoices.date')}>{new Date(invoice.createdAtUtc).toLocaleDateString(i18n.language)}</td>
                  <td data-label={t('subscription.invoices.status')}>{t(`subscription.invoices.status.${invoice.status}`)}</td>
                  <td data-label={t('subscription.invoices.total')}>{formatMoney(invoice.total, i18n.language)}</td>
                  <td>
                    <Link to={`/subscription/invoices/${invoice.invoiceId}`}>{t('subscription.invoices.viewDetail')}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        <Link to="/subscription">{t('common.back')}</Link>
      </p>
    </section>
  );
}
