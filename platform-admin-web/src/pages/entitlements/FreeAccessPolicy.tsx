import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { PermissionGate } from '../../rbac/PermissionGate';
import { isPermitted } from '../../domain/roles';
import { useCurrentRoles } from '../../state/AuthContext';
import { useStepUp } from '../../state/StepUpContext';
import { useToast } from '../../state/ToastContext';

interface FreeAccessStatusDto {
  mode: 'TIME_LIMITED' | 'PERPETUAL';
  grantedAt: string;
  expiresAt: string | null;
  remainingDays: number | null;
  status: 'ACTIVE' | 'EXPIRED' | 'PERPETUAL';
}

interface FreeAccessDefaultsDto {
  mode: 'TIME_LIMITED' | 'PERPETUAL';
  durationDays: number | null;
  defaultParentMemberLimit: number;
  defaultManagedDeviceLimit: number;
}

type AdjustmentAction = 'EXTEND' | 'REDUCE' | 'CONVERT_TO_PERPETUAL' | 'CONVERT_TO_TIME_LIMITED';

/**
 * Platform Administration -> Entitlements -> FREE_ACCESS Policy
 * (FREE_ACCESS_ENFORCEMENT_V1, Round6, Writer61). Two independent
 * sections, deliberately never sharing a write path (see
 * FreeAccessAdminService.ts's own doc comment on this same structural
 * guarantee):
 *  - GLOBAL registration-default config: READ-ONLY this round (the
 *    env-var-backed source of truth Round5 shipped -- see this lane's
 *    final report for the persisted-mutation gap and proposed schema).
 *  - Existing-ACCOUNT adjustment: explicit, audited, reason+step-up-gated
 *    extend/reduce/convert of one already-registered account's own
 *    snapshot. Every mutation is hidden here for UX only when the role is
 *    denied -- the SERVER independently enforces the same matrix (see
 *    FreeAccessAdminService.ts), mirroring ComplimentaryCapacity.tsx's own
 *    documented discipline exactly.
 */
export default function FreeAccessPolicy() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { requestStepUp } = useStepUp();
  const roles = useCurrentRoles();
  const [searchParams, setSearchParams] = useSearchParams();

  const canMutate = isPermitted(roles, 'ADMINISTER_ENTITLEMENT_QUANTITY');

  const [defaults, setDefaults] = useState<FreeAccessDefaultsDto | null>(null);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);

  useEffect(() => {
    platformAdminApi
      .get<FreeAccessDefaultsDto>('/platform-admin/settings/free-access-defaults')
      .then(setDefaults)
      .catch((err: unknown) => {
        setDefaultsError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [accountIdInput, setAccountIdInput] = useState(searchParams.get('accountId') ?? '');
  const [accountId, setAccountId] = useState(searchParams.get('accountId') ?? '');
  const [status, setStatus] = useState<FreeAccessStatusDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState<AdjustmentAction>('EXTEND');
  const [days, setDays] = useState('7');
  const [reasonCode, setReasonCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    platformAdminApi
      .get<FreeAccessStatusDto>(`/platform-admin/parent-accounts/${encodeURIComponent(id)}/free-access`)
      .then(setStatus)
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (accountId) load(accountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = accountIdInput.trim();
    setAccountId(trimmed);
    setSearchParams(trimmed ? { accountId: trimmed } : {});
  };

  const requiresDays = action === 'EXTEND' || action === 'REDUCE' || action === 'CONVERT_TO_TIME_LIMITED';

  const onAdjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!accountId) return;
    if (!reasonCode.trim()) {
      notify(t('freeAccessPolicy.reasonRequired'), 'error');
      return;
    }
    let body: Record<string, unknown> = { action, reasonCode: reasonCode.trim() };
    if (requiresDays) {
      const n = Number.parseInt(days, 10);
      if (!Number.isInteger(n) || n <= 0) {
        notify(t('freeAccessPolicy.invalidDays'), 'error');
        return;
      }
      const field = action === 'EXTEND' ? 'additionalDays' : action === 'REDUCE' ? 'reduceDays' : 'durationDays';
      body = { ...body, [field]: n };
    }
    setSubmitting(true);
    try {
      const stepUpId = await requestStepUp('ENTITLEMENT_LIMIT_OVERRIDE');
      if (!stepUpId) return;
      const updated = await platformAdminApi.post<FreeAccessStatusDto>(`/platform-admin/parent-accounts/${encodeURIComponent(accountId)}/free-access/adjust`, {
        ...body,
        stepUpId,
      });
      setStatus(updated);
      setReasonCode('');
      notify(t('freeAccessPolicy.adjusted'), 'success');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <h1>{t('nav.freeAccessPolicy')}</h1>

      <section className="card">
        <h2 className="section-title">{t('freeAccessPolicy.globalDefaultsTitle')}</h2>
        <p className="status-unavailable">{t('freeAccessPolicy.globalDefaultsHint')}</p>
        {defaultsError && <ErrorState message={defaultsError} />}
        {defaults && (
          <dl className="kv-list">
            <dt>{t('freeAccessPolicy.mode')}</dt>
            <dd>{t(`freeAccessPolicy.modes.${defaults.mode}`)}</dd>
            <dt>{t('freeAccessPolicy.durationDays')}</dt>
            <dd>{defaults.durationDays ?? t('freeAccessPolicy.noExpiry')}</dd>
            <dt>{t('freeAccessPolicy.defaultParentMemberLimit')}</dt>
            <dd>{defaults.defaultParentMemberLimit}</dd>
            <dt>{t('freeAccessPolicy.defaultManagedDeviceLimit')}</dt>
            <dd>{defaults.defaultManagedDeviceLimit}</dd>
          </dl>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">{t('freeAccessPolicy.accountLookupTitle')}</h2>
        <form className="filters" onSubmit={onSearch}>
          <div>
            <label htmlFor="fa-account-id">{t('freeAccessPolicy.accountIdLabel')}</label>
            <input id="fa-account-id" value={accountIdInput} onChange={(e) => setAccountIdInput(e.target.value)} maxLength={128} required />
          </div>
          <button type="submit" className="btn btn-primary">
            {t('entitlements.lookup')}
          </button>
        </form>

        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={() => load(accountId)} />}

        {status && (
          <>
            <dl className="kv-list">
              <dt>{t('freeAccessPolicy.mode')}</dt>
              <dd>{t(`freeAccessPolicy.modes.${status.mode}`)}</dd>
              <dt>{t('freeAccessPolicy.status')}</dt>
              <dd>{t(`freeAccessPolicy.statuses.${status.status}`)}</dd>
              <dt>{t('freeAccessPolicy.grantedAt')}</dt>
              <dd>{new Date(status.grantedAt).toLocaleString()}</dd>
              <dt>{t('freeAccessPolicy.expiresAt')}</dt>
              <dd>{status.expiresAt ? new Date(status.expiresAt).toLocaleString() : t('freeAccessPolicy.noExpiry')}</dd>
              <dt>{t('freeAccessPolicy.remainingDays')}</dt>
              <dd>{status.remainingDays ?? t('freeAccessPolicy.notApplicable')}</dd>
            </dl>

            <PermissionGate operation="ADMINISTER_ENTITLEMENT_QUANTITY">
              <form className="form-grid" onSubmit={onAdjust}>
                <label htmlFor="fa-action">{t('freeAccessPolicy.actionLabel')}</label>
                <select id="fa-action" value={action} onChange={(e) => setAction(e.target.value as AdjustmentAction)}>
                  <option value="EXTEND">{t('freeAccessPolicy.actions.EXTEND')}</option>
                  <option value="REDUCE">{t('freeAccessPolicy.actions.REDUCE')}</option>
                  <option value="CONVERT_TO_PERPETUAL">{t('freeAccessPolicy.actions.CONVERT_TO_PERPETUAL')}</option>
                  <option value="CONVERT_TO_TIME_LIMITED">{t('freeAccessPolicy.actions.CONVERT_TO_TIME_LIMITED')}</option>
                </select>

                {requiresDays && (
                  <>
                    <label htmlFor="fa-days">{t('freeAccessPolicy.daysLabel')}</label>
                    <input id="fa-days" type="number" min={1} step={1} value={days} onChange={(e) => setDays(e.target.value)} required />
                  </>
                )}

                <label htmlFor="fa-reason-code">{t('freeAccessPolicy.reasonCode')}</label>
                <input id="fa-reason-code" maxLength={200} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} required />

                <div className="actions-row">
                  <button type="submit" className="btn btn-primary" disabled={submitting || !canMutate}>
                    {t('freeAccessPolicy.adjust')}
                  </button>
                </div>
              </form>
            </PermissionGate>
          </>
        )}
      </section>
    </div>
  );
}
