// Real (non-fixture) WebRuleAdminClient. doc 35: production Parent Web rule
// mutation must respect the trusted-browser/crypto gate -- every method is
// gated by requireTrustedAndCryptoReady before it would ever construct or
// send a family Web Rule payload, matching RealParentFamilyDataGateway's
// convention exactly. Since the production crypto suite is not yet
// approved (see @pca/parent-sdk-browser-runtime's cryptoGate.ts), every
// call here rejects with EndpointNotTrustedError or
// CryptoReviewRequiredError today -- honest, not a bug.
//
// Unlike a SCHEDULE_POLICY_V1 update, a parent-authored web allow/deny rule
// is a plain, non-E2EE RULE DEFINITION: the real backend route
// (backend/src/http/routes/webRuleRoutes.ts) stores it directly through the
// existing WebRuleService/WebRuleStore -- the SAME repository the family's
// live domain-decision pipeline (WebFilterEngine) already reads from -- not
// an opaque encrypted envelope. That is why setRule/removeRule below build
// and send a real plaintext JSON body once past the gate, rather than
// invoking an encryption boundary the way schedulePolicyAuthoring.ts does:
// there is no equivalent "WebRuleFamilyEncryptionBoundary" seam for this
// data, by design (see webRuleRoutes.ts's own header comment for the full
// rationale). What stays gated is delivering the resulting rule set down to
// a child device for offline VPN/DNS enforcement -- that still needs the
// same production family-envelope crypto suite as items D/E/G, which this
// class does not attempt. A successful setRule/removeRule call therefore
// only ever reports PENDING_DELIVERY, never DELIVERED/APPLIED (doc 36:
// "parent saved != child applied") -- and, while requireTrustedAndCryptoReady
// keeps failing closed today, this code path is unreachable in production
// regardless, exactly like listRules below.
import type { WebRuleAdminClient } from '../interfaces';
import type { WebRuleDeliveryStatus, WebRuleEntry, WebRuleListType } from '../../domain/webRulePolicy';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
import { requireTrustedAndCryptoReady } from './familyDataGate';
import { cookieSessionFamilyId } from './realBillingClient';

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWebRuleListType(value: unknown): value is WebRuleListType {
  return value === 'ALLOW' || value === 'DENY';
}

/** Parses the backend's `{ rules: [{domain, listType, createdAtUtc}, ...] }` DTO into WebRuleEntry[], discarding (rather than trusting) any malformed element -- a response-shape defect must never surface as a fabricated rule. */
function parseRules(body: unknown): WebRuleEntry[] {
  if (!isRecord(body) || !Array.isArray(body.rules)) return [];
  const entries: WebRuleEntry[] = [];
  for (const candidate of body.rules) {
    if (
      isRecord(candidate) &&
      typeof candidate.domain === 'string' &&
      candidate.domain.length > 0 &&
      isWebRuleListType(candidate.listType) &&
      typeof candidate.createdAtUtc === 'string'
    ) {
      entries.push({ domain: candidate.domain, listType: candidate.listType, createdAtUtc: candidate.createdAtUtc });
    }
  }
  return entries;
}

export class RealWebRuleAdminClient implements WebRuleAdminClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly trustedBrowser: TrustedBrowserProvider,
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  async listRules(childId: string): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus; revision: number | null }> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'WebRuleAdminClient.listRules');
    throw new Error(`WebRuleAdminClient.listRules: no decrypted web-rule record is cached yet for child "${childId}".`);
  }

  async setRule(childId: string, domain: string, listType: WebRuleListType): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus }> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'WebRuleAdminClient.setRule');
    const familyId = await this.familyId('WebRuleAdminClient.setRule');
    const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/children/${encodeURIComponent(childId)}/web-rules`), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(await this.actorHeaders()),
        ...this.csrfHeader(),
      },
      body: JSON.stringify({ domain, listType }),
    });
    if (!response.ok) throw new Error(`WebRuleAdminClient.setRule: request failed (${response.status}).`);
    const rules = parseRules(await this.json('WebRuleAdminClient.setRule', response));
    return { rules, status: 'PENDING_DELIVERY' };
  }

  async removeRule(childId: string, domain: string, listType: WebRuleListType): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus }> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'WebRuleAdminClient.removeRule');
    const familyId = await this.familyId('WebRuleAdminClient.removeRule');
    const response = await fetch(
      this.url(`/api/parent/families/${encodeURIComponent(familyId)}/children/${encodeURIComponent(childId)}/web-rules/remove`),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(await this.actorHeaders()),
          ...this.csrfHeader(),
        },
        body: JSON.stringify({ domain, listType }),
      },
    );
    if (!response.ok) throw new Error(`WebRuleAdminClient.removeRule: request failed (${response.status}).`);
    const rules = parseRules(await this.json('WebRuleAdminClient.removeRule', response));
    return { rules, status: 'PENDING_DELIVERY' };
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

  /** Same actor-identity-binding rationale as RealSchedulePolicyClient.actorHeaders/RealFamilyMemberInvitationClient.actorHeaders -- never a self-reported device id. */
  private async actorHeaders(): Promise<Record<string, string>> {
    const snapshot = await this.trustedBrowser.getSnapshot();
    if (snapshot.state !== 'TRUSTED') throw new Error('WebRuleAdminClient: TRUSTED_BROWSER_REQUIRED');
    if (!snapshot.actorDeviceSessionToken) throw new Error('WebRuleAdminClient: ACTOR_DEVICE_SESSION_UNAVAILABLE');
    return { Authorization: `Bearer ${snapshot.actorDeviceSessionToken}` };
  }

  private async json(operation: string, response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new Error(`${operation}: response body was not valid JSON.`);
    }
  }
}
