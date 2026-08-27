import { useTranslation } from 'react-i18next';
import { useState, type FormEvent } from 'react';
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
  const { data: members, loading: membersLoading, error: membersError, reload: reloadMembers } = useAsync(() => clients.familyAuthority.listMembers(), []);
  const {
    data: invitations,
    loading: invitationsLoading,
    error: invitationsError,
    reload: reloadInvitations,
  } = useAsync(() => clients.familyMemberInvitations.list(), []);
  const [actionError, setActionError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMINISTRATOR' | 'VIEWER'>('VIEWER');
  const [inviting, setInviting] = useState(false);

  if (membersLoading || invitationsLoading) return <LoadingState />;
  if (membersError) return <ErrorState message={membersError} onRetry={reloadMembers} />;
  if (invitationsError) return <ErrorState message={invitationsError} onRetry={reloadInvitations} />;
  if (!members || !invitations) return null;

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    setActionError(null);
    setInviting(true);
    try {
      await runFamilyAction(inviteRole === 'ADMINISTRATOR' ? 'ADD_ADMINISTRATOR' : 'ADD_VIEWER', () =>
        clients.familyMemberInvitations.invite(inviteRole, inviteEmail),
      );
      setInviteEmail('');
      reloadInvitations();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('common.deniedGeneric'));
    } finally {
      setInviting(false);
    }
  };

  const revokeInvitation = async (invitationId: string) => {
    setActionError(null);
    try {
      await runFamilyAction('REMOVE_NON_OWNER_PARENT', () => clients.familyMemberInvitations.revoke(invitationId));
      reloadInvitations();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('common.deniedGeneric'));
    }
  };

  const changeInvitationRole = async (invitationId: string, newRole: 'ADMINISTRATOR' | 'VIEWER') => {
    setActionError(null);
    try {
      await runFamilyAction('CHANGE_ANY_ROLE', () => clients.familyMemberInvitations.changeRole(invitationId, newRole));
      reloadInvitations();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('common.deniedGeneric'));
    }
  };

  const remove = async (memberId: string) => {
    setActionError(null);
    try {
      await runFamilyAction('REMOVE_NON_OWNER_PARENT', () => clients.familyAuthority.removeMember(memberId));
      reloadMembers();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('common.deniedGeneric'));
    }
  };

  return (
    <section aria-labelledby="members-title">
      <h1 id="members-title">{t('nav.usersMembers')}</h1>
      {actionError && <ErrorState message={actionError} />}

      <PermissionGate action="ADD_VIEWER" showDisabledFallback>
        <form className="card field" onSubmit={submitInvite} aria-labelledby="invite-form-title">
          <h2 id="invite-form-title">{t('family.invitations.inviteTitle')}</h2>
          <div className="field">
            <label htmlFor="invite-email">{t('family.invitations.emailLabel')}</label>
            <input
              id="invite-email"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              disabled={inviting}
            />
          </div>
          <div className="field">
            <label htmlFor="invite-role">{t('family.role')}</label>
            <select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'ADMINISTRATOR' | 'VIEWER')} disabled={inviting}>
              <option value="VIEWER">{t('roles.viewer')}</option>
              <option value="ADMINISTRATOR">{t('roles.administrator')}</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={inviting || !inviteEmail}>
            {inviting ? t('family.invitations.inviting') : t('family.invitations.inviteSubmit')}
          </button>
        </form>
      </PermissionGate>

      <h2>{t('family.invitations.title')}</h2>
      {invitations.length === 0 ? (
        <p>{t('family.invitations.empty')}</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table responsive-cards">
            <thead>
              <tr>
                <th scope="col">{t('family.role')}</th>
                <th scope="col">{t('family.status')}</th>
                <th scope="col">{t('family.invitations.expiresAt')}</th>
                <th scope="col" aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => (
                <tr key={invitation.invitationId}>
                  <td data-label={t('family.role')}>{t(`roles.${invitation.role.toLowerCase()}`)}</td>
                  <td data-label={t('family.status')}>{t(`family.invitations.statuses.${invitation.status}`)}</td>
                  <td data-label={t('family.invitations.expiresAt')}>
                    <bdi className="iso">{new Date(invitation.expiresAt).toLocaleString()}</bdi>
                  </td>
                  <td>
                    {invitation.status === 'PENDING' && (
                      <PermissionGate action="REMOVE_NON_OWNER_PARENT" showDisabledFallback>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => changeInvitationRole(invitation.invitationId, invitation.role === 'ADMINISTRATOR' ? 'VIEWER' : 'ADMINISTRATOR')}
                          >
                            {invitation.role === 'ADMINISTRATOR' ? t('family.invitations.changeToViewer') : t('family.invitations.changeToAdministrator')}
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => revokeInvitation(invitation.invitationId)}>
                            {t('family.invitations.revoke')}
                          </button>
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

      <h2>{t('family.activeMembersTitle')}</h2>
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
            {members.map((m) => (
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
