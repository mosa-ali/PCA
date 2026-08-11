import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';

export default function AppsPage() {
  const { t } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getAppRules(childId), [childId]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data || data.length === 0) return <EmptyState />;

  const toggle = async (appId: string, allowed: boolean) => {
    try {
      await runFamilyAction('EDIT_CHILD_POLICY', () => clients.parentFamilyData.updateAppRule(childId, appId, { allowed }));
      reload();
    } catch {
      // denied/cancelled -- state unchanged
    }
  };

  return (
    <div className="table-scroll">
      <table className="data-table responsive-cards">
        <thead>
          <tr>
            <th scope="col">App</th>
            <th scope="col">Category</th>
            <th scope="col">Daily limit</th>
            <th scope="col">Allowed</th>
          </tr>
        </thead>
        <tbody>
          {data.map((rule) => (
            <tr key={rule.appId}>
              <td data-label="App">{rule.appName}</td>
              <td data-label="Category">{rule.category}</td>
              <td data-label="Daily limit">{rule.dailyLimitMinutes ? `${rule.dailyLimitMinutes}m` : '--'}</td>
              <td data-label="Allowed">
                <PermissionGate action="EDIT_CHILD_POLICY" showDisabledFallback>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={rule.allowed}
                      onChange={(e) => toggle(rule.appId, e.target.checked)}
                      aria-label={`${t('common.enable')} ${rule.appName}`}
                    />
                    {rule.allowed ? t('common.enable') : t('common.disable')}
                  </label>
                </PermissionGate>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
