// Real (non-fixture) FamilyMemberInvitationClient. Calls the real, wired
// backend (backend/src/http/routes/familyMemberRoutes.ts) using the SAME
// actor-identity-binding pattern RealRequestClient/RealSafeZoneClient
// already established: the HttpOnly family session cookie for
// family/account identity, a double-submit CSRF header for the mutation,
// and an `Authorization: Bearer <actorDeviceSessionToken>` header
// (sourced from TrustedBrowserProvider.getSnapshot(), never a
// self-asserted id) for the acting device's identity.
//
// Production currently wires UnavailableTrustSetRoleResolver under the
// shared ParentActionAuthorizationService (see familyMemberRoutes.ts's own
// header comment), so even a fully-authenticated real call fails closed
// with an honest 403 today -- an external gate, not a reason to leave this
// client throwing a hardcoded stub error before the request is ever sent.
// ADD_ADMINISTRATOR/CHANGE_ROLE additionally require step-up
// (ALLOW_WITH_STEP_UP unconditionally per OPERATION_MATRIX), and no route
// in this codebase threads a client-supplied step-up assertion through yet
// -- inviting/changing-role-to ADMINISTRATOR will therefore also fail
// closed even once trust-set is real, until a real step-up ceremony exists.
import type { FamilyMemberInvitation, FamilyMemberInvitationClient } from '../interfaces';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
import { cookieSessionFamilyId } from './realBillingClient';

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

interface WireInvitationEnvelope {
  invitation?: FamilyMemberInvitation;
}

export class RealFamilyMemberInvitationClient implements FamilyMemberInvitationClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly trustedBrowser: TrustedBrowserProvider,
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  async list(): Promise<FamilyMemberInvitation[]> {
    const familyId = await this.familyId('FamilyMemberInvitationClient.list');
    const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/members/invitations`), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(await this.errorMessage('FamilyMemberInvitationClient.list', response));
    const body = (await this.json(response)) as { invitations?: FamilyMemberInvitation[] };
    return body.invitations ?? [];
  }

  async invite(role: 'ADMINISTRATOR' | 'VIEWER', invitedEmail: string): Promise<FamilyMemberInvitation> {
    const familyId = await this.familyId('FamilyMemberInvitationClient.invite');
    const actorHeaders = await this.actorHeaders();
    const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/members/invitations`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...actorHeaders, ...this.csrfHeader() },
      body: JSON.stringify({ invitedEmail, role }),
    });
    if (!response.ok) throw new Error(await this.errorMessage('FamilyMemberInvitationClient.invite', response));
    return this.invitationFrom('FamilyMemberInvitationClient.invite', response);
  }

  async revoke(invitationId: string): Promise<FamilyMemberInvitation> {
    const familyId = await this.familyId('FamilyMemberInvitationClient.revoke');
    const actorHeaders = await this.actorHeaders();
    const response = await fetch(
      this.url(`/api/parent/families/${encodeURIComponent(familyId)}/members/invitations/${encodeURIComponent(invitationId)}/revoke`),
      { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', ...actorHeaders, ...this.csrfHeader() } },
    );
    if (!response.ok) throw new Error(await this.errorMessage('FamilyMemberInvitationClient.revoke', response));
    return this.invitationFrom('FamilyMemberInvitationClient.revoke', response);
  }

  async changeRole(invitationId: string, newRole: 'ADMINISTRATOR' | 'VIEWER'): Promise<FamilyMemberInvitation> {
    const familyId = await this.familyId('FamilyMemberInvitationClient.changeRole');
    const actorHeaders = await this.actorHeaders();
    const response = await fetch(
      this.url(`/api/parent/families/${encodeURIComponent(familyId)}/members/invitations/${encodeURIComponent(invitationId)}/role`),
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...actorHeaders, ...this.csrfHeader() },
        body: JSON.stringify({ role: newRole }),
      },
    );
    if (!response.ok) throw new Error(await this.errorMessage('FamilyMemberInvitationClient.changeRole', response));
    return this.invitationFrom('FamilyMemberInvitationClient.changeRole', response);
  }

  /** No familyId in this request -- the accepting account may have no family yet, or a different one. See familyMemberRoutes.ts's own header comment on why this route is not authorized the same way as the others. */
  async accept(invitationId: string): Promise<FamilyMemberInvitation> {
    const response = await fetch(this.url(`/api/parent/member-invitations/${encodeURIComponent(invitationId)}/accept`), {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', ...this.csrfHeader() },
    });
    if (!response.ok) throw new Error(await this.errorMessage('FamilyMemberInvitationClient.accept', response));
    return this.invitationFrom('FamilyMemberInvitationClient.accept', response);
  }

  private async familyId(operation: string): Promise<string> {
    const familyId = await cookieSessionFamilyId(this.apiBaseUrl);
    if (!familyId) throw new Error(`${operation}: no family session is available to scope this request.`);
    return familyId;
  }

  private csrfHeader(): Record<string, string> {
    const csrf = readCsrfCookie();
    return csrf ? { [CSRF_HEADER_NAME]: csrf } : {};
  }

  /** SECURITY (actor-identity binding): mirrors RealRequestClient.actorHeaders()/RealSafeZoneClient's own doc comment exactly -- never a self-reported device id. */
  private async actorHeaders(): Promise<Record<string, string>> {
    const snapshot = await this.trustedBrowser.getSnapshot();
    if (snapshot.state !== 'TRUSTED') throw new Error('TRUSTED_BROWSER_REQUIRED');
    if (!snapshot.actorDeviceSessionToken) throw new Error('ACTOR_DEVICE_SESSION_UNAVAILABLE');
    return { Authorization: `Bearer ${snapshot.actorDeviceSessionToken}` };
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new Error('FAMILY_MEMBER_INVITATION_RESPONSE_INVALID');
    }
  }

  private async invitationFrom(operation: string, response: Response): Promise<FamilyMemberInvitation> {
    const body = (await this.json(response)) as WireInvitationEnvelope;
    if (!body.invitation) throw new Error(`${operation}: empty response body.`);
    return body.invitation;
  }

  private async errorMessage(operation: string, response: Response): Promise<string> {
    const body = await this.json(response).catch(() => null);
    const code = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    return `${operation}: request failed (${response.status}${code ? `: ${code}` : ''}).`;
  }
}
