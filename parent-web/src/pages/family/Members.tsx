import { useTranslation } from 'react-i18next';
import { useState, type FormEvent } from 'react';
import { getApiClients } from '../../api/client';
import { FamilyMemberInvitationError } from '../../api/interfaces';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';
import { useAuth } from '../../state/AuthContext';
import { formatDateTime } from '../../i18n/formatters';

/**
 * Maps a FamilyMemberInvitationClient rejection to a clear, translated,
 * actionable i18n key -- never the raw diagnostic Error.message a client
 * implementation throws (e.g. "FamilyMemberInvitationClient.invite: request
 * failed (409: duplicate_pending_invitation)."). Only FamilyMemberInvitationError
 * (the typed rejection every FamilyMemberInvitationClient implementation
 * throws) is mapped this way -- see describeInvitationError below for the
 * unchanged fallback used for a plain Error (e.g. from useFamilyAction's own
 * pre-flight permission/trust-epoch/step-up checks).
 */
function invitationErrorKey(err: FamilyMemberInvitationError): string {
  switch (err.serverCode) {
    case 'duplicate_pending_invitation':
      return 'family.invitations.errors.duplicatePending';
    case 'capacity_exceeded':
      return 'family.invitations.errors.capacityExceeded';
    case 'not_pending':
      return 'family.invitations.errors.notPending';
    case 'not_found':
      return 'family.invitations.errors.notFound';
    case 'already_accepted':
      return 'family.invitations.errors.alreadyAccepted';
    case 'revoked':
      return 'family.invitations.errors.revoked';
    case 'expired':
      return 'family.invitations.errors.expired';
    case 'invalid_input':
    case 'invalid_request':
      return 'family.invitations.errors.invalidInput';
    case 'not_authorized':
    case 'family_scope_required':
    case 'family_scope_forbidden':
    case 'csrf_mismatch':
      return 'family.invitations.errors.forbidden';
    case 'unauthorized':
    case 'actor_device_session_required':
    case 'actor_device_session_invalid':
    case 'family_session_unavailable':
    case 'trusted_browser_required':
    case 'actor_device_session_unavailable':
      return 'family.invitations.errors.unauthorized';
    default:
      break;
  }
  switch (err.code) {
    case 'INVALID_REQUEST':
      return 'family.invitations.errors.invalidInput';
    case 'UNAUTHORIZED':
      return 'family.invitations.errors.unauthorized';
    case 'FORBIDDEN':
      return 'family.invitations.errors.forbidden';
    case 'NOT_FOUND':
      return 'family.invitations.errors.notFound';
    case 'CONFLICT':
      return 'family.invitations.errors.conflict';
    case 'NETWORK_ERROR':
      return 'family.invitations.errors.network';
    default:
      return 'family.invitations.errors.unknown';
  }
}

/**
 * Preserves the existing fallback (raw Error.message) for any rejection that
 * is NOT a FamilyMemberInvitationError -- e.g. useFamilyAction's own
 * pre-flight permission/trust-epoch/step-up checks, or FamilyAuthorityGateway
 * (a separate client `remove()` below calls -- its removeMember is real and
 * HTTP-backed, see ../../api/real/realFamilyAuthorityGateway.ts, but every
 * other FamilyAuthorityGateway method, including checkPermission, is still
 * genuinely unimplemented). Only the FamilyMemberInvitationClient-specific
 * rejections this file actually triggers (invite/revoke/changeRole) get the
 * clear, translated mapping above.
 */
function describeInvitationError(t: (key: string) => string, err: unknown): string {
  if (err instanceof FamilyMemberInvitationError) return t(invitationErrorKey(err));
  return err instanceof Error ? err.message : t('common.deniedGeneric');
}

export default function Members() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const { session } = useAuth();
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
      setActionError(describeInvitationError(t, e));
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
      setActionError(describeInvitationError(t, e));
    }
  };

  const changeInvitationRole = async (invitationId: string, newRole: 'ADMINISTRATOR' | 'VIEWER') => {
    setActionError(null);
    try {
      await runFamilyAction('CHANGE_ANY_ROLE', () => clients.familyMemberInvitations.changeRole(invitationId, newRole));
      reloadInvitations();
    } catch (e) {
      setActionError(describeInvitationError(t, e));
    }
  };

  const remove = async (memberId: string) => {
    // removeMember is now a real, HTTP-backed call that irreversibly ends the
    // member's family access and frees the paid seat they occupied (see
    // ../../api/real/realFamilyAuthorityGateway.ts) -- require explicit
    // confirmation before invoking it, matching this app's one existing
    // destructive-action precedent (LocationPage.tsx's safe-zone delete).
    if (!window.confirm(t('family.removeMemberConfirm'))) return;
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
                    {/* Was `toLocaleString()` with no locale argument, so an
                        Arabic parent read an English date inside an Arabic
                        table. All formatting goes through i18n/formatters.ts,
                        which takes the language explicitly. */}
                    <bdi className="iso">{formatDateTime(invitation.expiresAt, i18n.language)}</bdi>
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
      <p style={{ color: 'var(--color-text-muted)' }}>{t('family.removeMemberNotice')}</p>
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
                  {/* Client-side convenience only -- never the real boundary. The
                      server independently refuses removing the Owner
                      (CANNOT_REMOVE_OWNER) and removing yourself
                      (CANNOT_REMOVE_SELF); see
                      backend/src/familymembers/FamilyMemberInvitationService.removeMember. */}
                  {m.role !== 'OWNER' && m.memberId !== session?.accountId && (
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
        {t('family.noRecoverySecretsNotice')}
      </p>
    </section>
  );
}
