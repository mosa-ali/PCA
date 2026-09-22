import { FamilyMemberInvitationError } from '../../api/interfaces';

/**
 * Maps a FamilyMemberInvitationClient rejection to a clear, translated,
 * actionable i18n key -- never the raw diagnostic Error.message a client
 * implementation throws (e.g. "FamilyMemberInvitationClient.invite: request
 * failed (409: duplicate_pending_invitation)."). Only FamilyMemberInvitationError
 * (the typed rejection every FamilyMemberInvitationClient implementation
 * throws) is mapped this way -- see describeInvitationError in Members.tsx for
 * the unchanged fallback used for a plain Error (e.g. from useFamilyAction's own
 * pre-flight permission/trust-epoch/step-up checks).
 *
 * Lives in its own module rather than in `Members.tsx` so the page file exports
 * only components. That is not a style preference: this repository lints with
 * `--max-warnings=0`, and `react-refresh/only-export-components` warns when a
 * module that exports a component also exports a plain function, so exporting
 * this from the page turned a warning into a CI failure.
 */
export function invitationErrorKey(err: FamilyMemberInvitationError): string {
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
    // PCA-DEC-036. Shares the 409 status with already_accepted/revoked/expired,
    // so without its own branch it would fall through to the generic 409
    // "conflict" copy -- which tells the person nothing about what to do. The
    // distinct copy matters here because the invitation is still valid: the
    // obstacle is the account's existing family membership, and the invitation
    // can be accepted once that is resolved.
    case 'family_conflict':
      return 'family.invitations.errors.familyConflict';
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
