import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealProtectionAdministrationActions } from '../../src/api/real/realProtectionAdministrationActions';

const record = {
  requestId: 'request-1',
  childId: 'child-1',
  deviceId: 'device-1',
  protectionLevel: 'PROTECTED' as const,
  operation: 'REMOVE_REVOKE_DEVICE' as const,
  requestedAt: '2026-09-27T12:00:00.000Z',
  expiresAt: '2026-09-27T12:05:00.000Z',
  reasonCategory: 'CHILD_SAFETY_CONCERN',
  state: 'PARENT_APPROVAL_REQUIRED' as const,
};

describe('RealProtectionAdministrationActions step-up transport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let actions: RealProtectionAdministrationActions;

  beforeEach(() => {
    document.cookie = 'pca_family_csrf=csrf-test; path=/';
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith('/administration-pin')
        ? { pinStatus: { configured: true, minimumRecommendedLength: 6, lockedUntilUtc: null } }
        : { removalDecision: record };
      return { ok: true, json: async () => body } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    actions = new RealProtectionAdministrationActions(
      '',
      async () => 'family-1',
      () => [{
        childId: 'child-1',
        childLabel: 'Child',
        deviceId: 'device-1',
        deviceLabel: 'Tablet',
        protectionLevel: 'PROTECTED',
      }],
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'pca_family_csrf=; Max-Age=0; path=/';
  });

  it('sends the one-use step-up token when configuring the Administration PIN', async () => {
    await actions.configurePin('123456', 'step-up-pin');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/parent/families/family-1/administration-pin');
    expect(JSON.parse(String(init.body))).toEqual({ pin: '123456', stepUpToken: 'step-up-pin' });
  });

  it('sends the operation-scoped token when creating a removal request and preserves its operation', async () => {
    const approval = await actions.requestApproval({
      childId: 'child-1',
      deviceId: 'device-1',
      protectionLevel: 'PROTECTED',
      operation: 'REMOVE_REVOKE_DEVICE',
      reasonCategory: 'CHILD_SAFETY_CONCERN',
      stepUpToken: 'step-up-removal',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/parent/families/family-1/removal-decisions');
    expect(JSON.parse(String(init.body))).toMatchObject({
      operation: 'REMOVE_REVOKE_DEVICE',
      stepUpToken: 'step-up-removal',
    });
    expect(approval.operation).toBe('REMOVE_REVOKE_DEVICE');
  });

  it('sends the one-use step-up token with the local-PIN decision', async () => {
    await actions.decideApproval({
      requestId: record.requestId,
      method: 'LOCAL_ADMINISTRATION_PIN',
      decision: 'ALLOW_REMOVAL',
      pin: '654321',
      stepUpToken: 'step-up-decision',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/removal-decisions/request-1/decide/local-pin');
    expect(JSON.parse(String(init.body))).toEqual({
      decision: 'ALLOW_REMOVAL',
      temporaryDisableUntil: null,
      pin: '654321',
      stepUpToken: 'step-up-decision',
    });
  });
});
