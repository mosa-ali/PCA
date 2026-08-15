import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';
import type { ComplimentaryEntitlementType, ComplimentaryGrantCategory, ComplimentaryGrantDto } from '../../domain/complimentaryGrants';
import { COMPLIMENTARY_ENTITLEMENT_TYPES, COMPLIMENTARY_GRANT_CATEGORIES, isPermanentGrant } from '../../domain/complimentaryGrants';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { PermissionGate } from '../../rbac/PermissionGate';
import { isPermitted } from '../../domain/roles';
import { useCurrentRoles } from '../../state/AuthContext';
import { useStepUp } from '../../state/StepUpContext';
import { useToast } from '../../state/ToastContext';

/**
 * Platform Administration -> Accounts -> Entitlements -> Complimentary
 * Capacity (PCA-ADD-COMP-017). Shows base allowance, active complimentary
 * grants, effective total, expiry, status, and safe reason/category, with
 * grant/revoke/renew actions gated per the frozen role matrix
 * (PCA-ADD-COMP-014). Every mutation is hidden here for UX only when the
 * role is denied -- the SERVER independently enforces the same matrix
 * (see PlatformAdminComplimentaryGrantService); a bug in this file can at
 * worst show a control that a subsequent server call correctly rejects.
 */
export default function ComplimentaryCapacity() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { requestStepUp } = useStepUp();
  const roles = useCurrentRoles();
  const [searchParams, setSearchParams] = useSearchParams();
  const [familyIdInput, setFamilyIdInput] = useState(searchParams.get('familyId') ?? '');
  const [familyId, setFamilyId] = useState(searchParams.get('familyId') ?? '');
  const [grants, setGrants] = useState<ComplimentaryGrantDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [entitlementType, setEntitlementType] = useState<ComplimentaryEntitlementType>('MANAGED_DEVICE_CAPACITY');
  const [category, setCategory] = useState<ComplimentaryGrantCategory>('OTHER');
  const [amount, setAmount] = useState('1');
  const [permanent, setPermanent] = useState(false);
  const [expiresAtInput, setExpiresAtInput] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [creating, setCreating] = useState(false);

  const [revokeReasonByGrant, setRevokeReasonByGrant] = useState<Record<string, string>>({});
  const [renewExpiresByGrant, setRenewExpiresByGrant] = useState<Record<string, string>>({});
  const [busyGrantId, setBusyGrantId] = useState<string | null>(null);

  const canMutate = isPermitted(roles, 'ADMINISTER_COMPLIMENTARY_GRANT');
  const canMutatePermanent = isPermitted(roles, 'ADMINISTER_COMPLIMENTARY_GRANT_PERMANENT');

  const load = (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    platformAdminApi
      .get<{ items: ComplimentaryGrantDto[] }>(`/platform-admin/families/${encodeURIComponent(id)}/complimentary-grants`)
      .then((result) => setGrants(result.items))
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (familyId) load(familyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = familyIdInput.trim();
    setFamilyId(trimmed);
    setSearchParams(trimmed ? { familyId: trimmed } : {});
  };

  const effectiveDeviceCapacity = (grants ?? [])
    .filter((g) => g.entitlementType === 'MANAGED_DEVICE_CAPACITY' && g.status === 'ACTIVE')
    .reduce((sum, g) => sum + g.amountOrAllowance, 0);
  const effectiveMemberCapacity = (grants ?? [])
    .filter((g) => g.entitlementType === 'PARENT_MEMBER_CAPACITY' && g.status === 'ACTIVE')
    .reduce((sum, g) => sum + g.amountOrAllowance, 0);
  const hasActiveCommercialAccess = (grants ?? []).some((g) => g.entitlementType === 'COMMERCIAL_ACCESS' && g.status === 'ACTIVE');

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!familyId) return;
    const amountOrAllowance = entitlementType === 'COMMERCIAL_ACCESS' ? 1 : Number.parseInt(amount, 10);
    if (!Number.isInteger(amountOrAllowance) || amountOrAllowance < 0) {
      notify(t('complimentaryCapacity.invalidAmount'), 'error');
      return;
    }
    if (!reasonCode.trim()) {
      notify(t('complimentaryCapacity.reasonRequired'), 'error');
      return;
    }
    if (!permanent && !expiresAtInput) {
      notify(t('complimentaryCapacity.expiryRequired'), 'error');
      return;
    }
    if (permanent && !canMutatePermanent) {
      notify(t('complimentaryCapacity.permanentForbidden'), 'error');
      return;
    }
    setCreating(true);
    try {
      const stepUpId = await requestStepUp('COMPLIMENTARY_GRANT_MUTATION');
      if (!stepUpId) return;
      const created = await platformAdminApi.post<ComplimentaryGrantDto>(`/platform-admin/families/${encodeURIComponent(familyId)}/complimentary-grants`, {
        entitlementType,
        category,
        amountOrAllowance,
        effectiveFrom: new Date().toISOString(),
        expiresAt: permanent ? null : new Date(expiresAtInput).toISOString(),
        reasonCode: reasonCode.trim(),
        internalNote: internalNote.trim() ? internalNote.trim() : null,
        stepUpId,
      });
      setGrants((prev) => [created, ...(prev ?? [])]);
      setReasonCode('');
      setInternalNote('');
      setAmount('1');
      notify(t('complimentaryCapacity.created'), 'success');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (grantId: string) => {
    const reason = (revokeReasonByGrant[grantId] ?? '').trim();
    if (!reason) {
      notify(t('complimentaryCapacity.reasonRequired'), 'error');
      return;
    }
    setBusyGrantId(grantId);
    try {
      const stepUpId = await requestStepUp('COMPLIMENTARY_GRANT_MUTATION');
      if (!stepUpId) return;
      const updated = await platformAdminApi.post<ComplimentaryGrantDto>(`/platform-admin/complimentary-grants/${encodeURIComponent(grantId)}/revoke`, { reasonCode: reason, stepUpId });
      setGrants((prev) => (prev ?? []).map((g) => (g.grantId === grantId ? updated : g)));
      notify(t('complimentaryCapacity.revoked'), 'success');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setBusyGrantId(null);
    }
  };

  const onRenew = async (grantId: string, currentlyPermanent: boolean) => {
    const targetPermanent = currentlyPermanent; // renew keeps the current shape; the input below controls a new expiry for a temporary grant
    const newExpiresInput = renewExpiresByGrant[grantId] ?? '';
    if (!targetPermanent && !newExpiresInput) {
      notify(t('complimentaryCapacity.expiryRequired'), 'error');
      return;
    }
    setBusyGrantId(grantId);
    try {
      const stepUpId = await requestStepUp('COMPLIMENTARY_GRANT_MUTATION');
      if (!stepUpId) return;
      const updated = await platformAdminApi.post<ComplimentaryGrantDto>(`/platform-admin/complimentary-grants/${encodeURIComponent(grantId)}/renew`, {
        newExpiresAt: targetPermanent ? null : new Date(newExpiresInput).toISOString(),
        stepUpId,
      });
      setGrants((prev) => (prev ?? []).map((g) => (g.grantId === grantId ? updated : g)));
      notify(t('complimentaryCapacity.renewed'), 'success');
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setBusyGrantId(null);
    }
  };

  return (
    <div className="page">
      <h1>{t('nav.complimentaryCapacity')}</h1>

      <form className="filters" onSubmit={onSearch}>
        <div>
          <label htmlFor="comp-family-id">{t('entitlements.familyIdLabel')}</label>
          <input id="comp-family-id" value={familyIdInput} onChange={(e) => setFamilyIdInput(e.target.value)} maxLength={128} required />
        </div>
        <button type="submit" className="btn btn-primary">
          {t('entitlements.lookup')}
        </button>
      </form>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={() => load(familyId)} />}

      {grants && (
        <>
          <section className="card">
            <h2 className="section-title">{t('complimentaryCapacity.overview')}</h2>
            <dl className="kv-list">
              <dt>{t('complimentaryCapacity.activeDeviceCapacity')}</dt>
              <dd>{effectiveDeviceCapacity}</dd>
              <dt>{t('complimentaryCapacity.activeMemberCapacity')}</dt>
              <dd>{effectiveMemberCapacity}</dd>
              <dt>{t('complimentaryCapacity.freeAccess')}</dt>
              <dd>{hasActiveCommercialAccess ? t('complimentaryCapacity.freeAccessActive') : t('complimentaryCapacity.freeAccessNone')}</dd>
            </dl>
            <p className="status-unavailable">{t('complimentaryCapacity.effectiveHint')}</p>
          </section>

          <section className="card">
            <h2 className="section-title">{t('complimentaryCapacity.grantsTitle')}</h2>
            {grants.length === 0 ? (
              <p className="status-unavailable">{t('common.empty')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('entitlements.limitType')}</th>
                      <th scope="col">{t('complimentaryCapacity.category')}</th>
                      <th scope="col">{t('complimentaryCapacity.amount')}</th>
                      <th scope="col">{t('complimentaryCapacity.status')}</th>
                      <th scope="col">{t('complimentaryCapacity.expiry')}</th>
                      <th scope="col">{t('complimentaryCapacity.reasonCode')}</th>
                      <th scope="col">{t('complimentaryCapacity.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grants.map((g) => (
                      <tr key={g.grantId}>
                        <td>{t(`complimentaryCapacity.entitlementTypes.${g.entitlementType}`)}</td>
                        <td>{g.category ? t(`complimentaryCapacity.categories.${g.category}`) : t('complimentaryCapacity.categoryRedacted')}</td>
                        <td>{g.amountOrAllowance}</td>
                        <td>
                          {t(`complimentaryCapacity.statuses.${g.status}`)}
                          {isPermanentGrant(g) && g.status === 'ACTIVE' && <span className="badge">{t('complimentaryCapacity.permanent')}</span>}
                        </td>
                        <td>{g.expiresAt ? new Date(g.expiresAt).toLocaleString() : t('complimentaryCapacity.noExpiry')}</td>
                        <td>{g.reasonCode}</td>
                        <td>
                          {g.status === 'ACTIVE' && (
                            <PermissionGate operation="ADMINISTER_COMPLIMENTARY_GRANT">
                              <div className="actions-row">
                                <input
                                  aria-label={t('complimentaryCapacity.revokeReasonLabel')}
                                  placeholder={t('complimentaryCapacity.revokeReasonLabel')}
                                  maxLength={64}
                                  value={revokeReasonByGrant[g.grantId] ?? ''}
                                  onChange={(e) => setRevokeReasonByGrant((prev) => ({ ...prev, [g.grantId]: e.target.value }))}
                                />
                                <button type="button" className="btn" disabled={busyGrantId === g.grantId} onClick={() => onRevoke(g.grantId)}>
                                  {t('complimentaryCapacity.revoke')}
                                </button>
                                {!isPermanentGrant(g) && (
                                  <>
                                    <input
                                      aria-label={t('complimentaryCapacity.newExpiryLabel')}
                                      type="datetime-local"
                                      value={renewExpiresByGrant[g.grantId] ?? ''}
                                      onChange={(e) => setRenewExpiresByGrant((prev) => ({ ...prev, [g.grantId]: e.target.value }))}
                                    />
                                    <button type="button" className="btn" disabled={busyGrantId === g.grantId} onClick={() => onRenew(g.grantId, false)}>
                                      {t('complimentaryCapacity.renew')}
                                    </button>
                                  </>
                                )}
                              </div>
                            </PermissionGate>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <PermissionGate operation="ADMINISTER_COMPLIMENTARY_GRANT">
            <section className="card">
              <h2 className="section-title">{t('complimentaryCapacity.grantTitle')}</h2>
              <p className="status-unavailable">{t('complimentaryCapacity.grantHint')}</p>
              <form className="form-grid" onSubmit={onCreate}>
                <label htmlFor="comp-entitlement-type">{t('entitlements.limitType')}</label>
                <select id="comp-entitlement-type" value={entitlementType} onChange={(e) => setEntitlementType(e.target.value as ComplimentaryEntitlementType)}>
                  {COMPLIMENTARY_ENTITLEMENT_TYPES.map((et) => (
                    <option key={et} value={et}>
                      {t(`complimentaryCapacity.entitlementTypes.${et}`)}
                    </option>
                  ))}
                </select>

                <label htmlFor="comp-category">{t('complimentaryCapacity.category')}</label>
                <select id="comp-category" value={category} onChange={(e) => setCategory(e.target.value as ComplimentaryGrantCategory)}>
                  {COMPLIMENTARY_GRANT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`complimentaryCapacity.categories.${c}`)}
                    </option>
                  ))}
                </select>

                {entitlementType !== 'COMMERCIAL_ACCESS' && (
                  <>
                    <label htmlFor="comp-amount">{t('complimentaryCapacity.amount')}</label>
                    <input id="comp-amount" type="number" min={0} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} required />
                  </>
                )}

                <label htmlFor="comp-permanent">{t('complimentaryCapacity.permanent')}</label>
                <input
                  id="comp-permanent"
                  type="checkbox"
                  checked={permanent}
                  onChange={(e) => setPermanent(e.target.checked)}
                  disabled={!canMutatePermanent}
                  title={canMutatePermanent ? undefined : t('complimentaryCapacity.permanentForbidden')}
                />

                {!permanent && (
                  <>
                    <label htmlFor="comp-expires-at">{t('complimentaryCapacity.expiry')}</label>
                    <input id="comp-expires-at" type="datetime-local" value={expiresAtInput} onChange={(e) => setExpiresAtInput(e.target.value)} required />
                  </>
                )}

                <label htmlFor="comp-reason-code">{t('complimentaryCapacity.reasonCode')}</label>
                <input id="comp-reason-code" maxLength={64} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} required />

                <label htmlFor="comp-internal-note">{t('complimentaryCapacity.internalNote')}</label>
                <textarea id="comp-internal-note" maxLength={2000} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
                <p className="status-unavailable">{t('complimentaryCapacity.internalNoteHint')}</p>

                <div className="actions-row">
                  <button type="submit" className="btn btn-primary" disabled={creating || !canMutate}>
                    {t('complimentaryCapacity.grant')}
                  </button>
                </div>
              </form>
            </section>
          </PermissionGate>
        </>
      )}
    </div>
  );
}
