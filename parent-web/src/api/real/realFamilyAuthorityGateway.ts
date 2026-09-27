// Real (non-fixture) FamilyAuthorityGateway -- Parent-session role preflight
// and the sensitive remove-member endpoint.
//
// PCA product-completion programme: backend/src/http/routes/familyMemberRoutes.ts
// now exposes a real, HTTP-backed "remove an already-accepted family member"
// route (POST /api/parent/families/:familyId/members/:accountId/remove),
// gated by the active Parent session, CSRF, and a fresh operation-bound TOTP
// grant. No browser endpoint identity participates in the request.
//
// UNLIKE FamilyMemberInvitationClient (a whole separate interface that is
// FULLY real), FamilyAuthorityGateway carries five OTHER methods
// (checkPermission/listMembers/inviteMember/changeRole/transferOwnership/
// listAuditTrail) with no real backend counterpart in this repository slice.
// This class therefore extends UnavailableFamilyAuthorityGateway and
// overrides checkPermission and removeMember, exactly the "supplementing" shape this
// gateway's own KNOWN_BACKEND_INTEGRATION_ACTION convention (see ../client.ts)
// describes for a partially-completed interface -- every other method keeps
// UnavailableFamilyAuthorityGateway's own honest rejection/denial behavior
// unchanged.
//
import type { FamilyAuthorityGateway } from '../interfaces';
import type { FamilyAction, FamilyRole, PermissionResult } from '../../domain/roles';
import { evaluatePermission } from '../../domain/roles';
import { UnavailableFamilyAuthorityGateway } from './unavailableProviders';
import { cookieSessionFamilyId } from './realBillingClient';

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

export class RealFamilyAuthorityGateway extends UnavailableFamilyAuthorityGateway implements FamilyAuthorityGateway {
  constructor(
    private readonly apiBaseUrl: string,
  ) {
    super();
  }

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  private csrfHeader(): Record<string, string> {
    const csrf = readCsrfCookie();
    return csrf ? { [CSRF_HEADER_NAME]: csrf } : {};
  }

  /** UI preflight only; every mutation is still independently authorized by its Parent session route. */
  async checkPermission(action: FamilyAction): Promise<PermissionResult> {
    try {
      const response = await fetch(this.url('/api/parent/session'), {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return { allowed: false, reason: 'Parent family session is unavailable.' };
      const body = (await response.json()) as { role?: unknown };
      if (body.role !== 'OWNER' && body.role !== 'ADMINISTRATOR' && body.role !== 'VIEWER' && body.role !== 'CHILD') {
        return { allowed: false, reason: 'Parent family role is unavailable.' };
      }
      return evaluatePermission(body.role as FamilyRole, action);
    } catch {
      return { allowed: false, reason: 'Parent family session is unavailable.' };
    }
  }

  /** `memberId` is the target's parent_accounts.account_id -- the only real, durable identity this domain has for an accepted family member (see this file's own header on why listMembers, which would otherwise be the thing handing callers this id, has no real implementation yet). */
  async removeMember(memberId: string, stepUpToken: string): Promise<{ auditEventId: string }> {
    const familyId = await cookieSessionFamilyId(this.apiBaseUrl);
    if (!familyId) {
      throw new Error('FAMILY_SESSION_UNAVAILABLE: FamilyAuthorityGateway.removeMember needs a family session to scope this request.');
    }
    const response = await fetch(
      this.url(`/api/parent/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(memberId)}/remove`),
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...this.csrfHeader() },
        body: JSON.stringify({ stepUpToken }),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const serverCode = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
      throw new Error(`FamilyAuthorityGateway.removeMember: request failed (${response.status}${serverCode ? `: ${serverCode}` : ''}).`);
    }
    const body = (await response.json().catch(() => null)) as { auditEventId?: unknown } | null;
    const auditEventId = body && typeof body.auditEventId === 'string' ? body.auditEventId : '';
    return { auditEventId };
  }
}
