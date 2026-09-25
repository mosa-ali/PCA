import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi } from '../../api/platformAdminApiClient';

type ParentEmailLookupResult =
  | { outcome: 'ACCOUNT_NOT_FOUND' }
  | { outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE'; reason: string; familyIds: string[] }
  | { outcome: 'ELIGIBLE_FAMILY_FOUND'; familyIds: string[] };

export function ParentEmailFamilyLookup({ id, familyId, onFamilyIdChange, includeDeleted = false }: {
  id: string;
  familyId: string;
  onFamilyIdChange: (value: string) => void;
  includeDeleted?: boolean;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [familyIds, setFamilyIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const normalized = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
      setMessage(t('accounts.parentEmailInvalid'));
      setFamilyIds([]);
      onFamilyIdChange('');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const result = await platformAdminApi.post<ParentEmailLookupResult>('/platform-admin/accounts/resolve-parent-email', { email: normalized, includeDeleted });
      const resolvedFamilyIds = result.outcome === 'ACCOUNT_NOT_FOUND' ? [] : result.familyIds;
      setFamilyIds(resolvedFamilyIds);
      onFamilyIdChange(resolvedFamilyIds.length === 1 ? resolvedFamilyIds[0] : '');
      if (result.outcome === 'ACCOUNT_NOT_FOUND') {
        setMessage(t('accounts.parentEmailNotFound'));
      } else if (result.outcome === 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE') {
        setMessage(t(`accounts.parentEmailReasons.${result.reason}`, t('accounts.parentEmailNoFamilies')));
      } else {
        setMessage('');
      }
    } catch {
      setFamilyIds([]);
      onFamilyIdChange('');
      setMessage(t('common.unexpectedError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="parent-email-lookup">
      <div>
        <label htmlFor={`${id}-email`}>{t('accounts.parentEmailSearchLabel')}</label>
        <div className="parent-email-lookup-row">
          <input id={`${id}-email`} type="text" inputMode="email" autoComplete="email" value={email} placeholder={t('accounts.parentEmailPlaceholder')} maxLength={254} onChange={(event) => setEmail(event.target.value)} />
          <button type="button" className="btn" disabled={loading} onClick={() => void submit()}>{loading ? t('common.loading') : t('common.search')}</button>
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
      {message && <p className="field-hint" role="status">{message}</p>}
    </div>
  );
}
