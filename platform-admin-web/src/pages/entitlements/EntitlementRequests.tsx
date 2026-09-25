import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import type { PagedResult } from '../../domain/accounts';
import { formatMoney, isSupportedCurrency, parseExactMinorUnits, type SupportedCurrencyCode } from '../../money/money';
import {
  ENTITLEMENT_REQUEST_STATES,
  isAwaitingAdminQuote,
  normalizeFromFlatListItem,
  type EntitlementChangeRequestState,
  type EntitlementRequestDto,
  type FlatEntitlementRequestListItem,
  type NormalizedEntitlementRequest,
} from '../../domain/entitlements';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { ConfirmButton } from '../../components/common/ConfirmButton';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useToast } from '../../state/ToastContext';
import { ParentEmailFamilyLookup, type ParentEmailLookupResult } from '../../components/common/ParentEmailFamilyLookup';

const PAGE_SIZE = 20;

function QuoteForm({ requestId, onIssued }: { requestId: string; onIssued: (updated: EntitlementRequestDto) => void }) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<SupportedCurrencyCode>('USD');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let amountMinor: string;
    try {
      amountMinor = parseExactMinorUnits(amount, currency);
    } catch {
      notify(t('entitlementRequests.invalidAmount'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      const updated = await platformAdminApi.post<EntitlementRequestDto>(`/platform-admin/entitlement-requests/${encodeURIComponent(requestId)}/quote`, {
        amountMinor,
        currencyCode: currency,
      });
      onIssued(updated);
      notify(t('entitlementRequests.quoteIssued'), 'success');
      setAmount('');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="actions-row" onSubmit={submit} aria-label={t('entitlementRequests.issueQuote')}>
      <input
        aria-label={t('entitlementRequests.amountLabel')}
        style={{ width: '7rem' }}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
        required
      />
      <select aria-label={t('entitlementRequests.currencyLabel')} style={{ width: '6rem' }} value={currency} onChange={(e) => setCurrency(e.target.value as SupportedCurrencyCode)}>
        <option value="USD">USD</option>
        <option value="SAR">SAR</option>
        <option value="YER">YER</option>
      </select>
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {t('entitlementRequests.issueQuote')}
      </button>
    </form>
  );
}

function DenyForm({ requestId, onDenied }: { requestId: string; onDenied: (updated: EntitlementRequestDto) => void }) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Two-click ConfirmButton gate (this app's established confirmation
  // pattern for a real, consequential-but-not-step-up-sensitive mutation --
  // see ConfirmButton.tsx's own doc comment, and the identical treatment
  // Approve already has below). A denial used to fire on a single click of
  // a type="submit" button; the form's own onSubmit is now inert
  // (preventDefault only) and ConfirmButton's second click is what actually
  // calls submit().
  const submit = async () => {
    if (!reason.trim()) {
      notify(t('entitlementRequests.reasonRequired'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      const updated = await platformAdminApi.post<EntitlementRequestDto>(`/platform-admin/entitlement-requests/${encodeURIComponent(requestId)}/deny`, {
        reason: reason.trim(),
      });
      onDenied(updated);
      notify(t('entitlementRequests.requestDenied'), 'success');
      setReason('');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="actions-row" onSubmit={(e) => e.preventDefault()} aria-label={t('entitlementRequests.deny')}>
      <input aria-label={t('entitlementRequests.reasonLabel')} style={{ width: '12rem' }} maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} required />
      <ConfirmButton label={t('entitlementRequests.deny')} disabled={submitting} onConfirm={() => void submit()} />
    </form>
  );
}

export default function EntitlementRequests() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<NormalizedEntitlementRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<EntitlementChangeRequestState | ''>('');
  const [appliedState, setAppliedState] = useState<EntitlementChangeRequestState | ''>('');
  const [familyIdFilter, setFamilyIdFilter] = useState(searchParams.get('familyId') ?? '');
  const [parentEmailLookupActive, setParentEmailLookupActive] = useState(false);
  const [lookupFamilyIds, setLookupFamilyIds] = useState<string[]>([]);
  const [parentEmailLookupResult, setParentEmailLookupResult] = useState<ParentEmailLookupResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setTotal(0);
    platformAdminApi
      .get<PagedResult<FlatEntitlementRequestListItem>>('/platform-admin/entitlement-requests', {
        limit: PAGE_SIZE,
        offset,
        state: appliedState || undefined,
        familyId: familyIdFilter || undefined,
      })
      .then((result) => {
        if (sequence !== requestSequence.current) return;
        setItems(result.items.map(normalizeFromFlatListItem));
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        if (sequence !== requestSequence.current) return;
        setItems([]);
        setTotal(0);
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => { if (sequence === requestSequence.current) setLoading(false); });
  };

  useEffect(() => {
    if (parentEmailLookupActive && (!familyIdFilter || !lookupFamilyIds.includes(familyIdFilter))) {
      requestSequence.current += 1;
      setItems([]);
      setTotal(0);
      setLoading(false);
      setError(null);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, appliedState, familyIdFilter, parentEmailLookupActive, lookupFamilyIds]);

  const onFilterSubmit = (e: FormEvent) => {
    e.preventDefault();
    setOffset(0);
    setAppliedState(state);
    const next = new URLSearchParams(searchParams);
    if (familyIdFilter) next.set('familyId', familyIdFilter);
    else next.delete('familyId');
    setSearchParams(next);
  };

  const applyUpdate = (updated: EntitlementRequestDto) => {
    setItems((prev) =>
      prev.map((item) =>
        item.requestId === updated.requestId
          ? { ...item, state: updated.state, quote: updated.quote, awaitingAdminQuote: updated.awaitingAdminQuote, updatedAt: updated.updatedAt }
          : item,
      ),
    );
  };

  const onApprove = async (requestId: string) => {
    setApprovingId(requestId);
    try {
      const updated = await platformAdminApi.post<EntitlementRequestDto>(`/platform-admin/entitlement-requests/${encodeURIComponent(requestId)}/approve-parent-member`);
      applyUpdate(updated);
      notify(t('entitlementRequests.requestApproved'), 'success');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="page">
      <h2>{t('nav.entitlementRequests')}</h2>

      <ParentEmailFamilyLookup id="entitlement-requests" familyId={familyIdFilter} showAccountSummary
        onLookupStart={() => {
          setParentEmailLookupActive(true);
          setLookupFamilyIds([]);
          setParentEmailLookupResult(null);
          setItems([]);
          setTotal(0);
          setError(null);
          setLoading(false);
        }}
        onResult={(result) => {
          setParentEmailLookupResult(result);
          setLookupFamilyIds(result.outcome === 'ACCOUNT_NOT_FOUND' ? [] : result.familyIds);
        }}
        onFamilyIdChange={(value) => {
          setFamilyIdFilter(value);
          const next = new URLSearchParams(searchParams);
          if (value) next.set('familyId', value);
          else next.delete('familyId');
          setSearchParams(next);
        }} />

      <form className="filters enrollment-filter-row" onSubmit={onFilterSubmit}>
        <div>
          <label htmlFor="er-state">{t('entitlements.state')}</label>
          <select id="er-state" value={state} onChange={(e) => setState(e.target.value as EntitlementChangeRequestState | '')}>
            <option value="">{t('common.all')}</option>
            {ENTITLEMENT_REQUEST_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`entitlements.states.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn">
          {t('common.applyFilters')}
        </button>
      </form>

      {parentEmailLookupActive && parentEmailLookupResult !== null && parentEmailLookupResult.outcome !== 'ACCOUNT_NOT_FOUND' && !familyIdFilter && !loading && !error && (
        <p className="status-unavailable" role="status">{lookupFamilyIds.length > 1 ? t('entitlementRequests.chooseFamilyToLoad') : t('entitlementRequests.familyUnavailable')}</p>
      )}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && items.length === 0 && <p className="status-unavailable">{t('common.empty')}</p>}

      {!loading && !error && items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('entitlements.requestId')}</th>
                <th scope="col">{t('entitlements.familyIdLabel')}</th>
                <th scope="col">{t('entitlements.limitType')}</th>
                <th scope="col">{t('entitlements.currentLimit')}</th>
                <th scope="col">{t('entitlements.targetLimit')}</th>
                <th scope="col">{t('entitlements.state')}</th>
                <th scope="col">{t('entitlementRequests.quote')}</th>
                <th scope="col">{t('accounts.createdAt')}</th>
                <th scope="col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.requestId}>
                  <td>{r.requestId}</td>
                  <td>
                    <Link to={`/accounts/${encodeURIComponent(r.familyId)}`}>{r.familyId}</Link>
                  </td>
                  <td>{t(`entitlements.limitTypes.${r.limitType}`)}</td>
                  {/* B118: the current limit gives the admin the "from" half of
                      the change being approved/denied -- the target-limit column
                      alone doesn't say what it's a change FROM. */}
                  <td>{r.currentLimitAtRequest}</td>
                  <td>{r.targetLimit}</td>
                  <td>
                    {t(`entitlements.states.${r.state}`)}
                    {isAwaitingAdminQuote(r) && <span className="badge">{t('entitlements.awaitingQuote')}</span>}
                  </td>
                  <td>
                    {r.quote && isSupportedCurrency(r.quote.currencyCode) && r.quote.amountMinor
                      ? formatMoney({ amountMinor: r.quote.amountMinor, currencyCode: r.quote.currencyCode })
                      : '—'}
                  </td>
                  <td>{r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
                  <td>
                    <div className="actions-row">
                      {r.limitType === 'PARENT_MEMBER_LIMIT' && r.state === 'PENDING' && (
                        <PermissionGate operation="ADMINISTER_ENTITLEMENT_QUANTITY">
                          <ConfirmButton
                            label={t('entitlementRequests.approve')}
                            disabled={approvingId === r.requestId}
                            onConfirm={() => void onApprove(r.requestId)}
                          />
                        </PermissionGate>
                      )}
                      {(r.state === 'PENDING' || r.state === 'QUOTED') && (
                        <PermissionGate operation="ADMINISTER_ENTITLEMENT_QUANTITY">
                          <DenyForm requestId={r.requestId} onDenied={applyUpdate} />
                        </PermissionGate>
                      )}
                      {isAwaitingAdminQuote(r) && (
                        <PermissionGate operation="ADMINISTER_BILLING">
                          <QuoteForm requestId={r.requestId} onIssued={applyUpdate} />
                        </PermissionGate>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination">
        <button type="button" className="btn" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          {t('common.previous')}
        </button>
        <span>{t('common.pageInfo', { from: total === 0 ? 0 : offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}</span>
        <button type="button" className="btn" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>
          {t('common.next')}
        </button>
      </div>
    </div>
  );
}
