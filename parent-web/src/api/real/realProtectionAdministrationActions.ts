// PCA-ADD-ENR-012/016/017/020: real, cookie-session-backed
// ProtectionAdministrationActions against
// backend/src/http/routes/removalDecisionRoutes.ts's family-scoped
// removal-decision + Administration PIN endpoints. Same cookie-session +
// double-submit-CSRF transport as ../real/realParentPreferencesClient.ts /
// ../real/realBillingClient.ts (`credentials: 'include'`, no bearer token);
// family scope is resolved the same way realBillingClient.ts does, via
// cookieSessionFamilyId(apiBaseUrl) against GET /api/parent/session --
// never from a caller-supplied familyId.
import type {
  ProtectionAdministrationActions,
  ProtectionApprovalView,
  ProtectionDecision,
  ProtectionDecisionMethod,
  ProtectionPinStatus,
  ProtectionTargetOption,
} from '../../pages/family/ProtectionAdministrationPanel';

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';

const OFFLINE_FALLBACK_EXPLANATION =
  'Use this local PIN only as an offline fallback when an approved parent-device decision is unavailable. It is never an invitation secret or a server-readable activity credential.';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

interface BackendPinStatus {
  configured: boolean;
  minimumRecommendedLength: number;
  lockedUntilUtc: string | null;
}

interface BackendRemovalDecision {
  requestId: string;
  childId: string;
  deviceId: string;
  protectionLevel: ProtectionTargetOption['protectionLevel'];
  requestedAt: string;
  expiresAt: string;
  reasonCategory: string | null;
  state: ProtectionApprovalView['state'];
}

export class ProtectionAdministrationUnavailableError extends Error {
  constructor(operation: string, status: number) {
    super(`${operation}: request failed (${status}).`);
    this.name = 'ProtectionAdministrationUnavailableError';
  }
}

/**
 * Resolves each request's child/device label from the same `targets` list
 * the panel already renders, so this client never needs its own duplicate
 * child/device directory.
 */
export class RealProtectionAdministrationActions implements ProtectionAdministrationActions {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getFamilyId: () => Promise<string | null>,
    private readonly getTargets: () => ProtectionTargetOption[],
  ) {}

  private url(familyId: string, path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}/api/parent/families/${encodeURIComponent(familyId)}${path}`;
  }

  private async familyId(operation: string): Promise<string> {
    const familyId = await this.getFamilyId();
    if (!familyId) throw new ProtectionAdministrationUnavailableError(operation, 401);
    return familyId;
  }

  private async request(operation: string, familyId: string, path: string, init?: RequestInit): Promise<Response> {
    const csrf = readCsrfCookie();
    const response = await fetch(this.url(familyId, path), {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(csrf ? { [CSRF_HEADER_NAME]: csrf } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) throw new ProtectionAdministrationUnavailableError(operation, response.status);
    return response;
  }

  private toApprovalView(record: BackendRemovalDecision): ProtectionApprovalView {
    const target = this.getTargets().find((option) => option.deviceId === record.deviceId);
    return {
      requestId: record.requestId,
      childId: record.childId,
      childLabel: target?.childLabel ?? record.childId,
      deviceId: record.deviceId,
      deviceLabel: target?.deviceLabel ?? record.deviceId,
      requestedAtUtc: record.requestedAt,
      expiresAtUtc: record.expiresAt,
      protectionLevel: record.protectionLevel,
      reasonCategory: record.reasonCategory,
      state: record.state,
    };
  }

  private toPinStatus(status: BackendPinStatus): ProtectionPinStatus {
    return {
      configured: status.configured,
      minimumRecommendedLength: status.minimumRecommendedLength,
      offlineFallbackExplanation: OFFLINE_FALLBACK_EXPLANATION,
      lockedUntilUtc: status.lockedUntilUtc,
    };
  }

  async getPinStatus(): Promise<ProtectionPinStatus> {
    const familyId = await this.familyId('getPinStatus');
    const response = await this.request('getPinStatus', familyId, '/administration-pin', { method: 'GET' });
    const body = (await response.json()) as { pinStatus: BackendPinStatus };
    return this.toPinStatus(body.pinStatus);
  }

  async configurePin(pin: string): Promise<ProtectionPinStatus> {
    const familyId = await this.familyId('configurePin');
    const response = await this.request('configurePin', familyId, '/administration-pin', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
    const body = (await response.json()) as { pinStatus: BackendPinStatus };
    return this.toPinStatus(body.pinStatus);
  }

  async listPendingApprovals(): Promise<ProtectionApprovalView[]> {
    const familyId = await this.familyId('listPendingApprovals');
    const response = await this.request('listPendingApprovals', familyId, '/removal-decisions', { method: 'GET' });
    const body = (await response.json()) as { removalDecisions: BackendRemovalDecision[] };
    return body.removalDecisions.map((record) => this.toApprovalView(record));
  }

  async requestApproval(input: {
    childId: string;
    deviceId: string;
    protectionLevel: ProtectionTargetOption['protectionLevel'];
    operation: 'REMOVE_REVOKE_DEVICE' | 'DISABLE_PROTECTION_POLICY';
    reasonCategory: string | null;
  }): Promise<ProtectionApprovalView> {
    const familyId = await this.familyId('requestApproval');
    const requestedAt = new Date();
    const response = await this.request('requestApproval', familyId, '/removal-decisions', {
      method: 'POST',
      body: JSON.stringify({
        requestId: globalThis.crypto.randomUUID(),
        childId: input.childId,
        deviceId: input.deviceId,
        operation: input.operation,
        protectionLevel: input.protectionLevel,
        requestedAt: requestedAt.toISOString(),
        expiresAt: new Date(requestedAt.getTime() + 5 * 60 * 1000).toISOString(),
        reasonCategory: input.reasonCategory,
      }),
    });
    const body = (await response.json()) as { removalDecision: BackendRemovalDecision };
    return this.toApprovalView(body.removalDecision);
  }

  async decideApproval(input: {
    requestId: string;
    method: ProtectionDecisionMethod;
    decision: ProtectionDecision;
    temporaryDisableUntilUtc?: string | null;
    pin?: string;
  }): Promise<ProtectionApprovalView> {
    const familyId = await this.familyId('decideApproval');
    const decisionBody = {
      decision: input.decision,
      temporaryDisableUntil: input.decision === 'TEMPORARILY_DISABLE' ? input.temporaryDisableUntilUtc ?? null : null,
    };
    if (input.method === 'LOCAL_ADMINISTRATION_PIN') {
      const response = await this.request(
        'decideApproval',
        familyId,
        `/removal-decisions/${encodeURIComponent(input.requestId)}/decide/local-pin`,
        { method: 'POST', body: JSON.stringify({ ...decisionBody, pin: input.pin ?? '' }) },
      );
      const body = (await response.json()) as { removalDecision: BackendRemovalDecision };
      return this.toApprovalView(body.removalDecision);
    }
    // REMOTE_PARENT and AUTHORIZED_RECOVERY both require a real
    // signed/verified proof this browser page never fabricates -- routing
    // here would only be reachable once a genuine signing or recovery
    // ceremony produces one, which does not exist in this repository slice
    // yet (see RemovalDecisionAuthority.ts's own header note on
    // signingKeyResolver/recoveryAuthority). Fail honestly rather than
    // sending an empty/fabricated proof.
    throw new ProtectionAdministrationUnavailableError('decideApproval', 501);
  }
}
