import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';

export default function Members() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const { data, loading, error, reload } = useAsync(() => clients.familyAuthority.listMembers(), []);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const invite = async (role: 'ADMINISTRATOR' | 'VIEWER') => {
    setActionError(null);
    try {
      await runFamilyAction(role === 'ADMINISTRATOR' ? 'ADD_ADMINISTRATOR' : 'ADD_VIEWER', () =>
        clients.familyAuthority.inviteMember(role, role === 'ADMINISTRATOR' ? t('family.newAdministratorName') : t('family.newViewerName')),
      );
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('common.deniedGeneric'));
    }
  };

  const remove = async (memberId: string) => {
    setActionError(null);
    try {
      await runFamilyAction('REMOVE_NON_OWNER_PARENT', () => clients.familyAuthority.removeMember(memberId));
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('common.deniedGeneric'));
    }
  };

  return (
    <section aria-labelledby="members-title">
      <h1 id="members-title">{t('nav.usersMembers')}</h1>
      {actionError && <ErrorState message={actionError} />}
      <div style={{ display: 'flex', gap: '0.5rem', marginBlockEnd: '1rem' }}>
        <PermissionGate action="ADD_ADMINISTRATOR" showDisabledFallback>
          <button type="button" className="btn" onClick={() => invite('ADMINISTRATOR')}>
            {t('family.inviteAdministrator')}
          </button>
        </PermissionGate>
        <PermissionGate action="ADD_VIEWER" showDisabledFallback>
          <button type="button" className="btn" onClick={() => invite('VIEWER')}>
            {t('family.inviteViewer')}
          </button>
        </PermissionGate>
      </div>
      <div className="table-scroll">
        <table className="data-table responsive-cards">
          <thead>
            <tr>
              <th scope="col">{t('family.member')}</th>
              <th scope="col">{t('family.role')}</th>
              <th scope="col">{t('family.endpoint')}</th>
              <th scope="col">{t('family.status')}</th>
              <th scope="col">{t('family.lastAcknowledged')}</th>
              <th scope="col" aria-label={t('common.actions')} />
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.memberId}>
                <td data-label={t('family.member')}>{m.displayName}</td>
                <td data-label={t('family.role')}>{t(`roles.${m.role.toLowerCase()}`)}</td>
                <td data-label={t('family.endpoint')}>{m.endpointLabel}</td>
                <td data-label={t('family.status')}>
                  <StatusBadge state={m.status} />
                </td>
                <td data-label={t('family.lastAcknowledged')}>{m.lastAcknowledgedPolicyRevision ?? '--'}</td>
                <td>
                  {m.role !== 'OWNER' && (
                    <PermissionGate action="REMOVE_NON_OWNER_PARENT" showDisabledFallback>
                      <button type="button" className="btn" onClick={() => remove(m.memberId)}>
                        {t('family.removeMember')}
                      </button>
                    </PermissionGate>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: '1rem', color: 'var(--color-text-muted)' }}>
        No recovery secrets, keys, or tokens are ever shown on this page.
      </p>
    </section>
  );
}
