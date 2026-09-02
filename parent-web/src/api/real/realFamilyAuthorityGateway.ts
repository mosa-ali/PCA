// Real (non-fixture) FamilyAuthorityGateway -- but only for removeMember.
//
// PCA product-completion programme: backend/src/http/routes/familyMemberRoutes.ts
// now exposes a real, HTTP-backed "remove an already-accepted family member"
// route (POST /api/parent/families/:familyId/members/:accountId/remove),
// gated by the SAME shared ParentActionAuthorizationService instance every
// sibling family-authority mutation (invite/revoke/change-role/safe-zone/
// child-request) already uses -- see that route's own header comment. Like
// every one of those siblings, this fails closed with an honest 403 in
// production today (UnavailableTrustSetRoleResolver), which is the correct,
// external, out-of-scope-for-this-file gate, not a reason to leave this
// client throwing a hardcoded stub error before the request is ever sent.
//
// UNLIKE FamilyMemberInvitationClient (a whole separate interface that is
// FULLY real), FamilyAuthorityGateway carries five OTHER methods
// (checkPermission/listMembers/inviteMember/changeRole/transferOwnership/
// listAuditTrail) with no real backend counterpart in this repository slice
// at all -- listMembers in particular would need genuine trust-set-resolved
// membership data (TrustSetRoleResolver), which is explicitly out of scope
// here. This class therefore extends UnavailableFamilyAuthorityGateway and
// overrides ONLY removeMember, exactly the "supplementing" shape this
// gateway's own KNOWN_BACKEND_INTEGRATION_ACTION convention (see ../client.ts)
// describes for a partially-completed interface -- every other method keeps
// UnavailableFamilyAuthorityGateway's own honest rejection/denial behavior
// unchanged.
//
// KNOWN GAP (client-side, pre-existing, not introduced or fixed here):
// useFamilyAction (src/rbac/useFamilyAction.ts) always calls
// clients.familyAuthority.checkPermission(action) BEFORE invoking the actual
// mutation, and throws if it is not allowed. Because checkPermission here
// still inherits UnavailableFamilyAuthorityGateway's unconditional denial (see
// above -- a real advisory check would need the same out-of-scope role
// resolution), Members.tsx's Remove button -- like its ALREADY-real invite/
// revoke/change-role siblings on FamilyMemberInvitationClient, gated through
// the exact same hook -- will keep failing at that client-side pre-flight in
// production until checkPermission (or useFamilyAction itself) is addressed
// separately. This route IS genuinely wired end-to-end below; that pre-flight
// is what stands between it and being reachable from the UI today, exactly
// like its siblings.
import type { FamilyAuthorityGateway } from '../interfaces';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
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
    private readonly trustedBrowser: TrustedBrowserProvider,
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

  /** SECURITY (actor-identity binding): mirrors RealFamilyMemberInvitationClient.actorHeaders()/RealRequestClient's own doc comment exactly -- never a self-reported device id. */
  private async actorHeaders(): Promise<Record<string, string>> {
    const snapshot = await this.trustedBrowser.getSnapshot();
    if (snapshot.state !== 'TRUSTED') {
      throw new Error('TRUSTED_BROWSER_REQUIRED: FamilyAuthorityGateway.removeMember needs a trusted browser session.');
    }
    if (!snapshot.actorDeviceSessionToken) {
      throw new Error('ACTOR_DEVICE_SESSION_UNAVAILABLE: FamilyAuthorityGateway.removeMember needs an actor device session token.');
    }
    return { Authorization: `Bearer ${snapshot.actorDeviceSessionToken}` };
  }

  /** `memberId` is the target's parent_accounts.account_id -- the only real, durable identity this domain has for an accepted family member (see this file's own header on why listMembers, which would otherwise be the thing handing callers this id, has no real implementation yet). */
  async removeMember(memberId: string): Promise<{ auditEventId: string }> {
    const familyId = await cookieSessionFamilyId(this.apiBaseUrl);
    if (!familyId) {
      throw new Error('FAMILY_SESSION_UNAVAILABLE: FamilyAuthorityGateway.removeMember needs a family session to scope this request.');
    }
    const actorHeaders = await this.actorHeaders();
    const response = await fetch(
      this.url(`/api/parent/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(memberId)}/remove`),
      {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', ...actorHeaders, ...this.csrfHeader() },
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
