// Real, HTTP-backed SchedulePolicyTransport. Submits an already-encrypted
// (opaque, from this client's point of view) schedule-policy envelope to
// the real backend authorization + relay route
// (backend/src/http/routes/childPolicyRoutes.ts), which pre-checks
// EDIT_CHILD_POLICY via ParentActionAuthorizationService and then enqueues
// the envelope through the existing OutboundRelayService -- the same
// relay every other real-but-gated feature this session built uses.
// Mirrors RealSafeZoneClient's actor-identity-binding pattern exactly: the
// caller must be a TRUSTED, paired browser endpoint with a real device-
// session token, sent as `Authorization: Bearer <token>` -- never a
// self-reported device id.
import {
  validateOpaqueSchedulePolicyInput,
  type SchedulePolicyEnvelopeInput,
  type SchedulePolicySubmissionResult,
  type SchedulePolicyTransport,
} from '../schedulePolicyAuthoring';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';

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

export class RealSchedulePolicyClient implements SchedulePolicyTransport {
  constructor(private readonly apiBaseUrl: string, private readonly trustedBrowser: TrustedBrowserProvider) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  async submit(familyId: string, childProfileId: string, envelope: SchedulePolicyEnvelopeInput): Promise<SchedulePolicySubmissionResult> {
    const snapshot = await this.trustedBrowser.getSnapshot();
    if (snapshot.state !== 'TRUSTED') throw new Error('TRUSTED_BROWSER_REQUIRED');
    if (!snapshot.browserEndpointId) throw new Error('DEVICE_IDENTITY_UNAVAILABLE');
    if (!snapshot.actorDeviceSessionToken) throw new Error('ACTOR_DEVICE_SESSION_UNAVAILABLE');
    validateOpaqueSchedulePolicyInput(envelope, {
      familyId,
      senderDeviceId: snapshot.browserEndpointId,
      recipientDeviceId: envelope.recipientDeviceId,
    });

    const csrf = readCsrfCookie();
    const response = await fetch(
      this.url(`/api/parent/families/${encodeURIComponent(familyId)}/children/${encodeURIComponent(childProfileId)}/schedule-policy`),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${snapshot.actorDeviceSessionToken}`,
          ...(csrf ? { [CSRF_HEADER_NAME]: csrf } : {}),
        },
        body: JSON.stringify(envelope),
      },
    );
    if (!response.ok) throw new Error(`Schedule-policy submission failed (${response.status})`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('SCHEDULE_POLICY_RESPONSE_INVALID');
    }
    if (!isRecord(body) || body.status !== 'PENDING' || body.messageId !== envelope.messageId) {
      throw new Error('SCHEDULE_POLICY_RESPONSE_INVALID');
    }
    return { status: 'PENDING', messageId: body.messageId };
  }
}
