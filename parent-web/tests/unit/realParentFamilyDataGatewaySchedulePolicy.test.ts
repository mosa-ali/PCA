// PCA product-completion Writer P0-B: proves RealParentFamilyDataGateway's
// updateScreenTime/updateAppRule are genuinely real writes once trust +
// crypto-review both pass (previously hardcoded throws) -- they construct
// the right SchedulePolicyPlaintextDefinition and submit it through the
// authoring -> transport chain, returning a PENDING-only result.
//
// Also covers the recipient-device-id fix: the gateway used to address
// every envelope to a fabricated `device-${childId}` id (impossible against
// backend/migrations/0001_mysql_baseline.sql:157's `device_id CHAR(36)`).
// It now resolves the REAL DeviceProtectionStatus.deviceId through
// DeviceStatusClient, and refuses to publish at all when none exists.
import { describe, expect, it, vi } from 'vitest';

// The crypto gate is a hardcoded, non-configurable `false` in source (see
// parent-sdk/browser-runtime/src/cryptoGate.ts's own header comment) --
// every real-mode test for a crypto-gated client must mock it explicitly to
// exercise anything past that gate (see realRequestClient.test.ts's own
// identical override). This does not touch production code: it only
// overrides the imported module's behavior for this test file.
vi.mock('@pca/parent-sdk-browser-runtime', async () => {
  const actual = await vi.importActual<typeof import('@pca/parent-sdk-browser-runtime')>('@pca/parent-sdk-browser-runtime');
  return { ...actual, getCryptoGateDecision: () => ({ status: 'READY' as const, reason: 'test override' }) };
});

const { RealParentFamilyDataGateway } = await import('../../src/api/real/realParentFamilyDataGateway');
const { createLocalFamilyDataStore } = await import('../../src/security/localFamilyDataStore');
type TrustedBrowserProvider = import('../../src/domain/trustedBrowser').TrustedBrowserProvider;
type TrustedBrowserSnapshot = import('../../src/domain/trustedBrowser').TrustedBrowserSnapshot;
type DeviceStatusClient = import('../../src/api/interfaces').DeviceStatusClient;
type DeviceProtectionStatus = import('../../src/domain/types').DeviceProtectionStatus;
type SchedulePolicyAuthoring = import('../../src/api/schedulePolicyAuthoring').SchedulePolicyAuthoring;
type SchedulePolicyEnvelopeInput = import('../../src/api/schedulePolicyAuthoring').SchedulePolicyEnvelopeInput;
type SchedulePolicyPlaintextDefinition = import('../../src/api/schedulePolicyAuthoring').SchedulePolicyPlaintextDefinition;
type SchedulePolicyTransport = import('../../src/api/schedulePolicyAuthoring').SchedulePolicyTransport;

const TRUSTED_SNAPSHOT: TrustedBrowserSnapshot = {
  state: 'TRUSTED',
  serviceAuthenticated: true,
  browserEndpointId: 'endpoint-a',
  trustSetEpoch: 5,
  acceptedMinEpoch: 5,
  pairingRequestedAtUtc: null,
  lastFingerprint: null,
  actorDeviceSessionToken: 'actor-device-session-token',
};

class StubTrustedBrowserProvider implements TrustedBrowserProvider {
  async getSnapshot() {
    return TRUSTED_SNAPSHOT;
  }
  async beginServiceAuthentication() {
    return TRUSTED_SNAPSHOT;
  }
  async requestPairing() {
    return TRUSTED_SNAPSHOT;
  }
  async simulateParentApproval() {
    return TRUSTED_SNAPSHOT;
  }
  async simulateEpochGoneStale() {
    return TRUSTED_SNAPSHOT;
  }
  async simulateRevoke() {
    return TRUSTED_SNAPSHOT;
  }
  async reset() {
    return TRUSTED_SNAPSHOT;
  }
}

/**
 * A real device id shape: 36 characters, exactly what
 * backend/migrations/0001_mysql_baseline.sql:157 declares
 * (`device_id CHAR(36)`). The old fabricated `device-child-1` was 14
 * characters of a shape no real row can ever hold.
 */
const REAL_DEVICE_ID = '3f2b9c1e-8a44-4d6f-9b21-5c7e0a1d2f83';

function deviceRecord(childId: string, deviceId: string): DeviceProtectionStatus {
  return {
    childId,
    deviceId,
    deviceLabel: 'Test phone',
    osFamily: 'ANDROID',
    appVersion: '1.4.0',
    protectionState: 'PROTECTED',
    lastAcknowledgedPolicyRevision: 14,
    trustSetEpoch: 4,
    keyEpoch: 4,
  };
}

function stubDeviceStatus(records: DeviceProtectionStatus[]): DeviceStatusClient {
  return {
    async listDeviceStatuses(childId?: string) {
      return childId ? records.filter((record) => record.childId === childId) : records;
    },
    async getDeviceStatus(deviceId: string) {
      return records.find((record) => record.deviceId === deviceId) ?? null;
    },
  };
}

const OPAQUE_ENVELOPE: SchedulePolicyEnvelopeInput = {
  recipientDeviceId: REAL_DEVICE_ID,
  ciphertextB64: 'YWJjZGVmZ2g',
  nonceB64: 'MDEyMzQ1Njc4OTAxMjM0NQ',
  keyEpoch: 3,
};

function fakeAuthoring(
  capturedDefinitions: SchedulePolicyPlaintextDefinition[],
  capturedRecipients: string[] = [],
): SchedulePolicyAuthoring {
  return {
    async encrypt(_familyId, recipientDeviceId, definition) {
      capturedRecipients.push(recipientDeviceId);
      capturedDefinitions.push(definition);
      return OPAQUE_ENVELOPE;
    },
  };
}

function fakeTransport(capturedSubmissions: Array<{ familyId: string; childProfileId: string; envelope: SchedulePolicyEnvelopeInput }>): SchedulePolicyTransport {
  return {
    async submit(familyId, childProfileId, envelope) {
      capturedSubmissions.push({ familyId, childProfileId, envelope });
      return { status: 'PENDING', messageId: 'msg-123' };
    },
  };
}

describe('RealParentFamilyDataGateway schedule-policy writes (Writer P0-B)', () => {
  it('updateScreenTime constructs a CONTINUOUS_USE_AND_BREAK definition and returns the real submission messageId as auditEventId, never a fabricated APPLIED claim', async () => {
    const definitions: SchedulePolicyPlaintextDefinition[] = [];
    const submissions: Array<{ familyId: string; childProfileId: string; envelope: SchedulePolicyEnvelopeInput }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ familyId: 'family-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    try {
      const gateway = new RealParentFamilyDataGateway(
        new StubTrustedBrowserProvider(),
        fakeAuthoring(definitions),
        fakeTransport(submissions),
        'http://localhost',
        createLocalFamilyDataStore(),
        stubDeviceStatus([deviceRecord('child-1', REAL_DEVICE_ID)]),
      );

      const result = await gateway.updateScreenTime('child-1', { continuousUseLimitMinutes: 45, breakDurationMinutes: 30 });

      expect(result).toEqual({ auditEventId: 'msg-123' });
      expect(definitions).toEqual([
        { kind: 'CONTINUOUS_USE_AND_BREAK', childProfileId: 'child-1', continuousUseLimitMinutes: 45, breakDurationMinutes: 30 },
      ]);
      expect(submissions).toEqual([{ familyId: 'family-1', childProfileId: 'child-1', envelope: OPAQUE_ENVELOPE }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('updateAppRule constructs an APP_RULE definition addressed to the child device', async () => {
    const definitions: SchedulePolicyPlaintextDefinition[] = [];
    const submissions: Array<{ familyId: string; childProfileId: string; envelope: SchedulePolicyEnvelopeInput }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ familyId: 'family-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    try {
      const gateway = new RealParentFamilyDataGateway(
        new StubTrustedBrowserProvider(),
        fakeAuthoring(definitions),
        fakeTransport(submissions),
        'http://localhost',
        createLocalFamilyDataStore(),
        stubDeviceStatus([deviceRecord('child-1', REAL_DEVICE_ID)]),
      );

      const result = await gateway.updateAppRule('child-1', 'app-games', { allowed: false, dailyLimitMinutes: 15 });

      expect(result).toEqual({ auditEventId: 'msg-123' });
      expect(definitions).toEqual([
        { kind: 'APP_RULE', childProfileId: 'child-1', appRule: { appId: 'app-games', allowed: false, dailyLimitMinutes: 15 } },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('updateScreenTime rejects a partial patch rather than silently submitting an incomplete policy', async () => {
    const gateway = new RealParentFamilyDataGateway(
      new StubTrustedBrowserProvider(),
      fakeAuthoring([]),
      fakeTransport([]),
      'http://localhost',
      createLocalFamilyDataStore(),
      stubDeviceStatus([deviceRecord('child-1', REAL_DEVICE_ID)]),
    );
    await expect(gateway.updateScreenTime('child-1', { continuousUseLimitMinutes: 45 })).rejects.toThrow(/both continuousUseLimitMinutes and breakDurationMinutes/);
  });

  it('updateScreenTime surfaces a real CRYPTO_REVIEW_REQUIRED-style authoring failure rather than pretending to succeed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ familyId: 'family-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    try {
      const failingAuthoring: SchedulePolicyAuthoring = {
        async encrypt() {
          throw new Error('CRYPTO_REVIEW_REQUIRED');
        },
      };
      const gateway = new RealParentFamilyDataGateway(
        new StubTrustedBrowserProvider(),
        failingAuthoring,
        fakeTransport([]),
        'http://localhost',
        createLocalFamilyDataStore(),
        stubDeviceStatus([deviceRecord('child-1', REAL_DEVICE_ID)]),
      );
      await expect(gateway.updateScreenTime('child-1', { continuousUseLimitMinutes: 45, breakDurationMinutes: 30 })).rejects.toThrow('CRYPTO_REVIEW_REQUIRED');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('RealParentFamilyDataGateway recipient device id is real, never fabricated', () => {
  it('addresses the envelope to the REAL DeviceProtectionStatus.deviceId, never a `device-${childId}` synthetic id', async () => {
    const definitions: SchedulePolicyPlaintextDefinition[] = [];
    const recipients: string[] = [];
    const submissions: Array<{ familyId: string; childProfileId: string; envelope: SchedulePolicyEnvelopeInput }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ familyId: 'family-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    try {
      const gateway = new RealParentFamilyDataGateway(
        new StubTrustedBrowserProvider(),
        fakeAuthoring(definitions, recipients),
        fakeTransport(submissions),
        'http://localhost',
        createLocalFamilyDataStore(),
        stubDeviceStatus([deviceRecord('child-1', REAL_DEVICE_ID)]),
      );

      await gateway.updateScreenTime('child-1', { continuousUseLimitMinutes: 45, breakDurationMinutes: 30 });

      expect(recipients).toEqual([REAL_DEVICE_ID]);
      expect(recipients[0]).not.toMatch(/^device-/);
      // 36 characters exactly -- what `device_id CHAR(36)` can actually hold.
      expect(recipients[0]).toHaveLength(36);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses to publish at all when no real device id resolves for the child -- never an empty or synthesized recipient', async () => {
    const definitions: SchedulePolicyPlaintextDefinition[] = [];
    const recipients: string[] = [];
    const submissions: Array<{ familyId: string; childProfileId: string; envelope: SchedulePolicyEnvelopeInput }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ familyId: 'family-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    try {
      const gateway = new RealParentFamilyDataGateway(
        new StubTrustedBrowserProvider(),
        fakeAuthoring(definitions, recipients),
        fakeTransport(submissions),
        'http://localhost',
        createLocalFamilyDataStore(),
        // A device belonging to a DIFFERENT child: this child has none.
        stubDeviceStatus([deviceRecord('child-other', REAL_DEVICE_ID)]),
      );

      await expect(gateway.updateScreenTime('child-1', { continuousUseLimitMinutes: 45, breakDurationMinutes: 30 })).rejects.toThrow(
        /no enrolled device is known for child "child-1"/,
      );
      expect(recipients).toEqual([]);
      expect(submissions).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('resolveChildDeviceId', () => {
  it('returns the real device id for the requested child only', async () => {
    const { resolveChildDeviceId } = await import('../../src/api/real/realParentFamilyDataGateway');
    const deviceStatus = stubDeviceStatus([deviceRecord('child-1', REAL_DEVICE_ID), deviceRecord('child-2', '11111111-2222-3333-4444-555555555555')]);
    await expect(resolveChildDeviceId(deviceStatus, 'child-2')).resolves.toBe('11111111-2222-3333-4444-555555555555');
  });

  it('throws honestly rather than returning a fabricated or empty id when the child has no device', async () => {
    const { resolveChildDeviceId } = await import('../../src/api/real/realParentFamilyDataGateway');
    await expect(resolveChildDeviceId(stubDeviceStatus([]), 'child-1')).rejects.toThrow(/Refusing to fabricate one/);
  });

  it('ignores a record carrying an empty device id rather than passing "" on as a recipient', async () => {
    const { resolveChildDeviceId } = await import('../../src/api/real/realParentFamilyDataGateway');
    await expect(resolveChildDeviceId(stubDeviceStatus([deviceRecord('child-1', '')]), 'child-1')).rejects.toThrow(
      /no enrolled device is known for child "child-1"/,
    );
  });
});
