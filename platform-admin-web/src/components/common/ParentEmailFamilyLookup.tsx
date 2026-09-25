import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi, PlatformAdminApiError } from '../../api/platformAdminApiClient';

export interface ParentEmailAccountSummary {
  status: string;
  createdAt: string | null;
  verifiedAt: string | null;
  disabledAt: string | null;
  accountType: string | null;
  estimatedChildCount: number | null;
  freeAccessMode: string | null;
  freeAccessStartedAt: string | null;
  freeAccessExpiresAt: string | null;
  defaultParentMemberLimit: number | null;
  defaultManagedDeviceLimit: number | null;
}

export interface ParentEmailFamilySummary {
  familyId: string;
  status: 'ACTIVE' | 'SUSPENDED';
  deletedAt: string | null;
}

export type ParentEmailLookupResult =
  | { outcome: 'ACCOUNT_NOT_FOUND' }
  | {
      outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE';
      reason: 'EMAIL_NOT_VERIFIED' | 'ACCOUNT_SUSPENDED' | 'FAMILY_NOT_PROVISIONED' | 'ALREADY_ENTITLED' | 'OTHER_APPROVED_REASON';
      familyIds: string[];
      account: ParentEmailAccountSummary;
      families: ParentEmailFamilySummary[];
    }
  | {
      outcome: 'ELIGIBLE_FAMILY_FOUND';
      familyIds: string[];
      account: ParentEmailAccountSummary;
      families: ParentEmailFamilySummary[];
    };

function formatLookupDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function ParentEmailFamilyLookup({ id, familyId, onFamilyIdChange, includeDeleted = false, showAccountSummary = false, onLookupStart, onResult }: {
  id: string;
  familyId: string;
  onFamilyIdChange: (value: string) => void;
  includeDeleted?: boolean;
  showAccountSummary?: boolean;
  onLookupStart?: () => void;
  onResult?: (result: ParentEmailLookupResult, normalizedEmail: string) => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [familyIds, setFamilyIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParentEmailLookupResult | null>(null);

  const submit = async () => {
    const normalized = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
      setMessage(t('accounts.parentEmailInvalid'));
      setMessageIsError(true);
      setFamilyIds([]);
      setResult(null);
      onFamilyIdChange('');
      onLookupStart?.();
      return;
    }
    setLoading(true);
    setMessage('');
    setMessageIsError(false);
    setResult(null);
    setFamilyIds([]);
    onFamilyIdChange('');
    onLookupStart?.();
    try {
      const result = await platformAdminApi.post<ParentEmailLookupResult>('/platform-admin/accounts/resolve-parent-email', { email: normalized, includeDeleted });
      const resolvedFamilyIds = result.outcome === 'ACCOUNT_NOT_FOUND' ? [] : result.familyIds;
      setResult(result);
      setFamilyIds(resolvedFamilyIds);
      onFamilyIdChange(resolvedFamilyIds.length === 1 ? resolvedFamilyIds[0] : '');
      onResult?.(result, normalized);
      if (result.outcome === 'ACCOUNT_NOT_FOUND') {
        setMessage(t('accounts.parentEmailNotFound'));
      } else if (result.outcome === 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE') {
        setMessage(t(`accounts.parentEmailReasons.${result.reason}`, t('accounts.parentEmailNoFamilies')));
      } else {
        setMessage(t('accounts.parentEmailEligibleFamily'));
      }
    } catch (err) {
      setFamilyIds([]);
      onFamilyIdChange('');
      setResult(null);
      setMessage(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      setMessageIsError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="parent-email-lookup">
      <div>
        <label htmlFor={`${id}-email`}>{t('accounts.parentEmailSearchLabel')}</label>
        <div className="parent-email-lookup-row">
          <input id={`${id}-email`} type="email" inputMode="email" autoComplete="email" value={email} placeholder={t('accounts.parentEmailPlaceholder')} maxLength={254} onChange={(event) => {
            setEmail(event.target.value);
            if (result) {
              setResult(null);
              setFamilyIds([]);
              setMessage('');
              onFamilyIdChange('');
              onLookupStart?.();
            }
          }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submit(); } }} />
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void submit()}>{loading ? t('common.loading') : t('common.search')}</button>
        </div>
      </div>
      {familyIds.length > 1 && (
        <label htmlFor={`${id}-family-choice`} className="parent-email-choice-label">
          {t('accounts.parentEmailMultipleFamilies')}
          <select id={`${id}-family-choice`} value={familyId} onChange={(event) => onFamilyIdChange(event.target.value)}>
            <option value="">{t('common.select')}</option>
            {familyIds.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      )}
      {message && <p className={messageIsError ? 'field-error' : 'field-hint'} role={messageIsError ? 'alert' : 'status'}>{message}</p>}
      {showAccountSummary && result && result.outcome !== 'ACCOUNT_NOT_FOUND' && result.account && (
        <section className="card parent-account-summary" aria-labelledby={`${id}-account-summary-title`}>
          <h3 id={`${id}-account-summary-title`}>{t('accounts.parentSummaryTitle')}</h3>
          <dl className="kv-list">
            <dt>{t('accounts.status')}</dt>
            <dd>{result.account.status === 'VERIFIED' ? t('accounts.parentStatuses.verified') : t('accounts.parentStatuses.pendingVerification')}</dd>
            <dt>{t('accounts.parentCreatedAt')}</dt>
            <dd>{formatLookupDate(result.account.createdAt)}</dd>
            <dt>{t('accounts.parentVerifiedAt')}</dt>
            <dd>{formatLookupDate(result.account.verifiedAt)}</dd>
            {result.account.disabledAt && <><dt>{t('accounts.parentDisabledAt')}</dt><dd>{formatLookupDate(result.account.disabledAt)}</dd></>}
            {result.account.accountType && <><dt>{t('accounts.parentAccountType')}</dt><dd>{t(`accounts.parentAccountTypes.${result.account.accountType}`, result.account.accountType)}</dd></>}
            {result.account.estimatedChildCount !== null && <><dt>{t('accounts.estimatedChildCount')}</dt><dd>{result.account.estimatedChildCount}</dd></>}
            {result.account.freeAccessMode && <><dt>{t('accounts.parentFreeAccess')}</dt><dd>{t(`accounts.parentFreeAccessModes.${result.account.freeAccessMode}`, result.account.freeAccessMode)}</dd></>}
            {result.account.freeAccessExpiresAt && <><dt>{t('accounts.parentFreeAccessExpires')}</dt><dd>{formatLookupDate(result.account.freeAccessExpiresAt)}</dd></>}
            {result.account.defaultParentMemberLimit !== null && <><dt>{t('accounts.parentDefaultMemberLimit')}</dt><dd>{result.account.defaultParentMemberLimit}</dd></>}
            {result.account.defaultManagedDeviceLimit !== null && <><dt>{t('accounts.parentDefaultDeviceLimit')}</dt><dd>{result.account.defaultManagedDeviceLimit}</dd></>}
          </dl>
          <h4>{t('accounts.familyStatusTitle')}</h4>
          {result.families.length === 0 ? (
            <p className="status-unavailable">{t('accounts.parentEmailReasons.FAMILY_NOT_PROVISIONED')}</p>
          ) : (
            <ul className="parent-family-summary-list">
              {result.families.map((family) => (
                <li key={family.familyId}>
                  <span>{family.familyId}</span>
                  <span className={`badge ${family.status === 'SUSPENDED' || family.deletedAt ? 'badge-danger' : 'badge-success'}`}>
                    {family.deletedAt ? t('accounts.deleted') : t(`accounts.statuses.${family.status}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
