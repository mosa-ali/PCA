import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminApi } from '../../api/platformAdminApiClient';

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
      const result = await platformAdminApi.post<{ familyIds: string[] }>('/platform-admin/accounts/resolve-parent-email', { email: normalized, includeDeleted });
      setFamilyIds(result.familyIds);
      onFamilyIdChange(result.familyIds.length === 1 ? result.familyIds[0] : '');
      setMessage(result.familyIds.length === 0 ? t('accounts.parentEmailNoFamilies') : '');
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
