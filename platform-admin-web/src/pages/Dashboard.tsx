import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../state/AuthContext';
import { platformAdminApi, PlatformAdminApiError } from '../api/platformAdminApiClient';
import type { PlatformDashboardSnapshot } from '../domain/dashboard';
import { isSettlementPermitted } from '../domain/settlement';
import { isBillingPermitted } from '../domain/billingRbac';
import { formatMoney, isSupportedCurrency } from '../money/money';
import { LoadingState } from '../components/common/LoadingState';
import { ErrorState } from '../components/common/ErrorState';

/**
 * PCA-ADD-BILL-020: the platform dashboard's single, explicitly-recorded-
 * rate USD-normalized cross-batch rollup. Fetched independently of
 * PlatformDashboardSnapshot (its own /platform-admin/settlement/usd-rollup
 * endpoint, backend/src/http/routes/platformadmin/settlementRoutes.ts) so a
 * failure here never blocks the rest of the dashboard from rendering.
 */
interface SettlementUsdRollupDto {
  totalNetUsdMinor: string;
  totalReceivedUsdMinor: string;
  includedBatchCount: number;
  excludedForMissingRateBatchCount: number;
}

/**
 * Per-currency settlement rollup amounts arrive as wire minor-unit decimal
 * strings with a plain `string` currencyCode (DashboardReadModel does not
 * narrow it to the three supported codes). Render through formatMoney
 * whenever the code is one this app actually supports -- including the
 * signed `totalDifferenceMinor`, whose negative branch formatMoney renders
 * as a real negative amount -- and fall back to "<CODE> <minor units>" for
 * any currency the money module deliberately does not support, rather than
 * throwing inside render.
 */
function formatRollupAmount(amountMinor: string, currencyCode: string): string {
  return isSupportedCurrency(currencyCode) ? formatMoney({ amountMinor, currencyCode }) : `${currencyCode} ${amountMinor}`;
}

function GroupedBadges({ byKey }: { byKey: Record<string, number> | null }) {
  const { t } = useTranslation();
  if (!byKey || Object.keys(byKey).length === 0) return <p className="status-unavailable">{t('common.empty')}</p>;
  return (
    <div className="actions-row">
      {Object.entries(byKey).map(([key, count]) => (
        <span key={key} className="badge">
          {key}: {count}
        </span>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { adminId, roles, sessionExpiresAt } = useAuth();
  const roleLabels = roles.map((role) => t(`roles.${role}`)).join(', ');
  const [snapshot, setSnapshot] = useState<PlatformDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usdRollup, setUsdRollup] = useState<SettlementUsdRollupDto | null>(null);
  const canViewSettlement = isSettlementPermitted(roles, 'VIEW_SETTLEMENT_RECORDS');
  // GET /platform-admin/dashboard (dashboardRoutes.ts) omits these fields
  // entirely from the wire response for a role without VIEW_BILLING_RECORDS
  // / VIEW_SETTLEMENT_RECORDS (PLATFORM_ADMIN, SUPPORT_ADMIN) rather than
  // sending a placeholder -- mirror that gate here so this component never
  // dereferences a field the response doesn't include.
  const canViewBilling = isBillingPermitted(roles, 'VIEW_BILLING_RECORDS');

  const load = () => {
    setLoading(true);
    setError(null);
    platformAdminApi
      .get<PlatformDashboardSnapshot>('/platform-admin/dashboard')
      .then(setSnapshot)
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [t]);

  useEffect(() => {
    if (!canViewSettlement) {
      setUsdRollup(null);
      return;
    }
    // Best-effort: a failure here is surfaced as an empty section, never a
    // page-blocking error -- this rollup is a supplementary reporting view,
    // not core dashboard data.
    platformAdminApi
      .get<SettlementUsdRollupDto>('/platform-admin/settlement/usd-rollup')
      .then(setUsdRollup)
      .catch(() => setUsdRollup(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewSettlement]);

  return (
    <div className="page">
      <h1>{t('dashboard.title')}</h1>

      <section className="card">
        <h2>{t('dashboard.identityCardTitle')}</h2>
        <dl className="kv-list">
          <dt>{t('login.emailLabel')}</dt>
          <dd>{adminId}</dd>
          <dt>{t('dashboard.rolesLabel')}</dt>
          <dd>{roleLabels}</dd>
          {sessionExpiresAt && (
            <>
              <dt>{t('dashboard.sessionExpiresLabel')}</dt>
              <dd>{new Date(sessionExpiresAt).toLocaleString()}</dd>
            </>
          )}
        </dl>
      </section>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {snapshot && (
        <>
          <section className="card">
            <h2 className="section-title">{t('dashboard.kpisTitle')}</h2>
            <p className="status-unavailable">{t('dashboard.generatedAt', { time: new Date(snapshot.generatedAt).toLocaleString() })}</p>
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  <tr>
                    <th scope="row">{t('dashboard.accountsTotal')}</th>
                    <td>{snapshot.accountsTotal.value ?? '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.accountsActiveSuspended')}</th>
                    {snapshot.accountsActiveSuspended.capability === 'AVAILABLE' ? (
                      <td>
                        {snapshot.accountsActiveSuspended.active ?? '—'} / {snapshot.accountsActiveSuspended.suspended ?? '—'}
                      </td>
                    ) : (
                      <td className="status-unavailable">{snapshot.accountsActiveSuspended.reason}</td>
                    )}
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.parentMemberUtilization')}</th>
                    <td>
                      {snapshot.parentMemberEntitlementUtilization.used ?? '—'} / {snapshot.parentMemberEntitlementUtilization.limit ?? '—'}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.deviceUtilization')}</th>
                    <td>
                      {snapshot.managedDeviceEntitlementUtilization.used ?? '—'} / {snapshot.managedDeviceEntitlementUtilization.limit ?? '—'}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.deviceActive')}</th>
                    <td>{snapshot.managedDeviceActive.value ?? '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.deviceReserved')}</th>
                    <td>{snapshot.managedDeviceReserved.value ?? '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.pendingRequests')}</th>
                    <td>{snapshot.pendingEntitlementRequests.value ?? '—'}</td>
                  </tr>
                  {canViewBilling && (
                    <tr>
                      <th scope="row">{t('dashboard.openDisputes')}</th>
                      <td>{snapshot.openDisputes!.value ?? '—'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2 className="section-title">{t('dashboard.requestsByState')}</h2>
            <GroupedBadges byKey={snapshot.entitlementRequestsByState.byKey} />
          </section>

          <section className="card">
            <h2 className="section-title">{t('dashboard.subscriptionsByStatus')}</h2>
            <GroupedBadges byKey={snapshot.subscriptionsByStatus.byKey} />
          </section>

          <section className="card">
            <h2 className="section-title">{t('dashboard.quotesByStatus')}</h2>
            <GroupedBadges byKey={snapshot.quotesByStatus.byKey} />
          </section>

          {canViewBilling && (
            <section className="card">
              <h2 className="section-title">{t('dashboard.invoicesByStatusCurrency')}</h2>
              {snapshot.invoicesByStatusAndCurrency!.rows && snapshot.invoicesByStatusAndCurrency!.rows.length > 0 ? (
                <div className="actions-row">
                  {snapshot.invoicesByStatusAndCurrency!.rows!.map((row) => (
                    <span key={`${row.status}-${row.currencyCode}`} className="badge">
                      {row.status} ({row.currencyCode}): {row.count}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="status-unavailable">{t('common.empty')}</p>
              )}
            </section>
          )}

          {canViewSettlement && (
            <section className="card">
              <h2 className="section-title">{t('dashboard.settlementSummaryTitle')}</h2>
              {snapshot.settlementSummary!.capability === 'AVAILABLE' && snapshot.settlementSummary!.summary ? (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      <tr>
                        <th scope="row">{t('dashboard.settlementMatched')}</th>
                        <td>{snapshot.settlementSummary!.summary.matchedBatchCount}</td>
                      </tr>
                      <tr>
                        <th scope="row">{t('dashboard.settlementUnderInvestigation')}</th>
                        <td>{snapshot.settlementSummary!.summary.underInvestigationBatchCount}</td>
                      </tr>
                      <tr>
                        <th scope="row">{t('dashboard.settlementResolved')}</th>
                        <td>{snapshot.settlementSummary!.summary.resolvedBatchCount}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {snapshot.settlementSummary!.summary.byCurrency.length > 0 && (
                  <div className="actions-row">
                    {snapshot.settlementSummary!.summary.byCurrency.map((row) => (
                      <span key={row.currencyCode} className="badge">
                        {row.currencyCode}: {t('dashboard.settlementNet')} {formatRollupAmount(row.totalNet.amountMinor, row.currencyCode)}, {t('dashboard.settlementReceived')}{' '}
                        {formatRollupAmount(row.totalReceived.amountMinor, row.currencyCode)}, {t('dashboard.settlementDifference')}{' '}
                        {formatRollupAmount(row.totalDifferenceMinor, row.currencyCode)}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="status-unavailable">{t('common.empty')}</p>
            )}
            </section>
          )}

          {canViewSettlement && (
            <section className="card">
              <h2 className="section-title">{t('dashboard.usdRollupTitle')}</h2>
              {usdRollup ? (
                <>
                  <div className="table-wrap">
                    <table className="table">
                      <tbody>
                        <tr>
                          <th scope="row">{t('dashboard.usdRollupNet')}</th>
                          <td>{formatMoney({ amountMinor: usdRollup.totalNetUsdMinor, currencyCode: 'USD' })}</td>
                        </tr>
                        <tr>
                          <th scope="row">{t('dashboard.usdRollupReceived')}</th>
                          <td>{formatMoney({ amountMinor: usdRollup.totalReceivedUsdMinor, currencyCode: 'USD' })}</td>
                        </tr>
                        <tr>
                          <th scope="row">{t('dashboard.usdRollupIncludedBatches')}</th>
                          <td>{usdRollup.includedBatchCount}</td>
                        </tr>
                        <tr>
                          <th scope="row">{t('dashboard.usdRollupExcludedBatches')}</th>
                          <td>{usdRollup.excludedForMissingRateBatchCount}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="status-unavailable">{t('dashboard.usdRollupNote')}</p>
                </>
              ) : (
                <p className="status-unavailable">{t('common.empty')}</p>
              )}
            </section>
          )}

          {canViewSettlement && (
          <section className="card">
            <h2 className="section-title">{t('dashboard.serviceHealthTitle')}</h2>
            {snapshot.serviceHealth!.capability === 'AVAILABLE' ? (
              <>
                <dl className="kv-list">
                  <dt>{t('dashboard.openReconciliationExceptions')}</dt>
                  <dd>{snapshot.serviceHealth!.openReconciliationExceptions ?? '—'}</dd>
                </dl>
                {snapshot.serviceHealth!.mostRecentBatchStatusByAccount && snapshot.serviceHealth!.mostRecentBatchStatusByAccount.length > 0 ? (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{t('dashboard.settlementAccount')}</th>
                          <th>{t('dashboard.mostRecentBatchStatus')}</th>
                          <th>{t('dashboard.mostRecentBatchPeriodEnd')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.serviceHealth!.mostRecentBatchStatusByAccount.map((row) => (
                          <tr key={row.settlementAccountId}>
                            <td>
                              {row.displayLabel} ({row.settlementCurrency})
                            </td>
                            <td>{row.mostRecentBatchStatus ?? t('common.empty')}</td>
                            <td>{row.mostRecentBatchPeriodEnd ? new Date(row.mostRecentBatchPeriodEnd).toLocaleString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="status-unavailable">{t('common.empty')}</p>
                )}
              </>
            ) : (
              <p className="status-unavailable">{t('common.empty')}</p>
            )}
          </section>
          )}
        </>
      )}
    </div>
  );
}
