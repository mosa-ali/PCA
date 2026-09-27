// Real (non-fixture) FamilyMemberInvitationClient. Calls the real, wired
// backend (backend/src/http/routes/familyMemberRoutes.ts) using the SAME
// Parent-session authority: the HttpOnly family session cookie scopes the
// family and a double-submit CSRF header protects mutations. The backend
// checks the active membership role for each request.
//
// Mutating routes require an active Administrator membership, CSRF, and a
// fresh operation-bound TOTP grant. The server repeats those checks for every
// request; client-side permission checks are only for clear UI feedback.
//
// Every rejection (transport-level precondition or a non-2xx response) is
// surfaced as a FamilyMemberInvitationError, never a bare Error -- mirrors
// DeviceEnrollmentError/realDeviceEnrollmentClient.ts's own pattern exactly,
// so Members.tsx can map a rejection to a clear, translated, actionable
// message instead of displaying a raw diagnostic string.
import type { FamilyMemberInvitation, FamilyMemberInvitationClient, FamilyMemberInvitationErrorCode } from '../interfaces';
import { FamilyMemberInvitationError } from '../interfaces';
import { cookieSessionFamilyId } from './realBillingClient';

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

/** Coarse HTTP-status bucket, same convention as realDeviceEnrollmentClient.ts's own mapping. */
function codeForStatus(status: number): FamilyMemberInvitationErrorCode {
  switch (status) {
    case 400:
      return 'INVALID_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    default:
      return 'UNKNOWN';
  }
}

interface WireInvitationEnvelope {
  invitation?: FamilyMemberInvitation;
}

export class RealFamilyMemberInvitationClient implements FamilyMemberInvitationClient {
  constructor(private readonly apiBaseUrl: string) {}

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
    if (!response.ok) throw await this.errorFrom('FamilyMemberInvitationClient.list', response);
    const body = (await this.json(response)) as { invitations?: FamilyMemberInvitation[] };
    return body.invitations ?? [];
  }

  async invite(role: 'ADMINISTRATOR' | 'VIEWER', invitedEmail: string, stepUpToken: string): Promise<FamilyMemberInvitation> {
    const familyId = await this.familyId('FamilyMemberInvitationClient.invite');
    const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/members/invitations`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...this.csrfHeader() },
      body: JSON.stringify({ invitedEmail, role, stepUpToken }),
    });
    if (!response.ok) throw await this.errorFrom('FamilyMemberInvitationClient.invite', response);
    return this.invitationFrom('FamilyMemberInvitationClient.invite', response);
  }

  async revoke(invitationId: string, stepUpToken: string): Promise<FamilyMemberInvitation> {
    const familyId = await this.familyId('FamilyMemberInvitationClient.revoke');
    const response = await fetch(
      this.url(`/api/parent/families/${encodeURIComponent(familyId)}/members/invitations/${encodeURIComponent(invitationId)}/revoke`),
      { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...this.csrfHeader() }, body: JSON.stringify({ stepUpToken }) },
    );
    if (!response.ok) throw await this.errorFrom('FamilyMemberInvitationClient.revoke', response);
    return this.invitationFrom('FamilyMemberInvitationClient.revoke', response);
  }

  async changeRole(invitationId: string, newRole: 'ADMINISTRATOR' | 'VIEWER', stepUpToken: string): Promise<FamilyMemberInvitation> {
    const familyId = await this.familyId('FamilyMemberInvitationClient.changeRole');
    const response = await fetch(
      this.url(`/api/parent/families/${encodeURIComponent(familyId)}/members/invitations/${encodeURIComponent(invitationId)}/role`),
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...this.csrfHeader() },
        body: JSON.stringify({ role: newRole, stepUpToken }),
      },
    );
    if (!response.ok) throw await this.errorFrom('FamilyMemberInvitationClient.changeRole', response);
    return this.invitationFrom('FamilyMemberInvitationClient.changeRole', response);
  }

  /** No familyId in this request -- the accepting account may have no family yet, or a different one. See familyMemberRoutes.ts's own header comment on why this route is not authorized the same way as the others. */
  async accept(invitationId: string): Promise<FamilyMemberInvitation> {
    const response = await fetch(this.url(`/api/parent/member-invitations/${encodeURIComponent(invitationId)}/accept`), {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', ...this.csrfHeader() },
    });
    if (!response.ok) throw await this.errorFrom('FamilyMemberInvitationClient.accept', response);
    return this.invitationFrom('FamilyMemberInvitationClient.accept', response);
  }

  private async familyId(operation: string): Promise<string> {
    const familyId = await cookieSessionFamilyId(this.apiBaseUrl);
    if (!familyId) {
      throw new FamilyMemberInvitationError('UNAUTHORIZED', `${operation}: no family session is available to scope this request.`, null, 'family_session_unavailable');
    }
    return familyId;
  }

  private csrfHeader(): Record<string, string> {
    const csrf = readCsrfCookie();
    return csrf ? { [CSRF_HEADER_NAME]: csrf } : {};
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new FamilyMemberInvitationError('UNKNOWN', 'FAMILY_MEMBER_INVITATION_RESPONSE_INVALID', response.status, 'response_invalid');
    }
  }

  private async invitationFrom(operation: string, response: Response): Promise<FamilyMemberInvitation> {
    const body = (await this.json(response)) as WireInvitationEnvelope;
    if (!body.invitation) {
      throw new FamilyMemberInvitationError('UNKNOWN', `${operation}: empty response body.`, response.status, 'empty_response_body');
    }
    return body.invitation;
  }

  /** Extracts the backend's own machine-readable `error` code (see familyMemberRoutes.ts's handleError/errorStatus) alongside the coarse HTTP-status bucket. */
  private async errorFrom(operation: string, response: Response): Promise<FamilyMemberInvitationError> {
    const body = await this.json(response).catch(() => null);
    const serverCode = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    return new FamilyMemberInvitationError(
      codeForStatus(response.status),
      `${operation}: request failed (${response.status}${serverCode ? `: ${serverCode}` : ''}).`,
      response.status,
      serverCode,
    );
  }
}
