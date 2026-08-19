import { describe, expect, it } from 'vitest';
import {
  SafeZonePolicyAuthoringError,
  VerifiedFamilySafeZonePolicyAuthoring,
  UnavailableSafeZonePolicyAuthoring,
  validateOpaqueSafeZoneInput,
  validateOpaqueSafeZonePatch,
  validateSafeZonePlaintextDefinition,
} from '../../src/api/safeZonePolicyAuthoring';

const definition = {
  label: 'Home',
  latitude: 24.7136,
  longitude: 46.6753,
  radiusMeters: 200,
  enabled: true,
};

describe('safe-zone policy authoring boundary', () => {
  it('rejects malformed readable input locally without creating an envelope', () => {
    expect(() => validateSafeZonePlaintextDefinition({ ...definition, latitude: 91 })).toThrowError(
      new SafeZonePolicyAuthoringError('INVALID_DEFINITION'),
    );
  });

  it('remains fail-closed for valid plaintext until reviewed family crypto is wired', async () => {
    await expect(
      new UnavailableSafeZonePolicyAuthoring().encrypt('family-1', 'device-1', definition),
    ).rejects.toMatchObject({ code: 'CRYPTO_REVIEW_REQUIRED' });
  });

  it('requires trusted family authority before the encryption boundary sees plaintext', async () => {
    const calls: string[] = [];
    const authoring = new VerifiedFamilySafeZonePolicyAuthoring(
      { getTrustedEndpointId: async () => 'parent-endpoint' },
      { authorizePolicyMutation: async () => 'DENY' },
      {
        encrypt: async ({ definition: readable }) => {
          calls.push(readable.label);
          return { recipientEndpointId: 'child-endpoint', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
        },
      },
    );

    await expect(authoring.encrypt('family-1', 'child-endpoint', definition)).rejects.toMatchObject({
      code: 'FAMILY_AUTHORITY_REQUIRED',
    });
    expect(calls).toEqual([]);
  });

  it('allows only an Owner/Admin-authorized recipient and returns no readable policy fields', async () => {
    const seen: string[] = [];
    const authoring = new VerifiedFamilySafeZonePolicyAuthoring(
      { getTrustedEndpointId: async () => 'parent-endpoint' },
      {
        authorizePolicyMutation: async ({ familyId, actorEndpointId, recipientEndpointId }) => {
          seen.push(`${familyId}:${actorEndpointId}:${recipientEndpointId}`);
          return 'ALLOW';
        },
      },
      {
        encrypt: async ({ definition: readable }) => {
          expect(readable).toEqual(definition);
          return { recipientEndpointId: 'child-endpoint', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 3 };
        },
      },
    );

    const result = await authoring.encrypt('family-1', 'child-endpoint', definition);
    expect(seen).toEqual(['family-1:parent-endpoint:child-endpoint']);
    expect(result).toEqual({ recipientEndpointId: 'child-endpoint', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 3 });
    expect(Object.keys(result).sort()).toEqual(['ciphertextB64', 'keyEpoch', 'nonceB64', 'recipientEndpointId']);
    expect(result).not.toHaveProperty('label');
  });

  it('rejects a crypto adapter that changes the authenticated child recipient', async () => {
    const authoring = new VerifiedFamilySafeZonePolicyAuthoring(
      { getTrustedEndpointId: async () => 'parent-endpoint' },
      { authorizePolicyMutation: async () => 'ALLOW' },
      {
        encrypt: async () => ({ recipientEndpointId: 'other-family-child', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 }),
      },
    );

    await expect(authoring.encrypt('family-1', 'child-endpoint', definition)).rejects.toMatchObject({
      code: 'ENCRYPTION_UNAVAILABLE',
    });
  });

  it('rejects plaintext-shaped or extra-field service payloads at the final boundary', () => {
    expect(() => validateOpaqueSafeZoneInput({ label: 'Home', ciphertextB64: 'AQID' }, 'child-endpoint')).toThrow(
      SafeZonePolicyAuthoringError,
    );
    expect(() => validateOpaqueSafeZoneInput({ recipientEndpointId: 'child-endpoint', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1, label: 'Home' }, 'child-endpoint')).toThrow(
      SafeZonePolicyAuthoringError,
    );
  });

  it('rejects unsafe partial updates, including a short nonce', () => {
    expect(() => validateOpaqueSafeZonePatch({ label: 'Home' })).toThrow(
      SafeZonePolicyAuthoringError,
    );
    expect(() => validateOpaqueSafeZonePatch({ nonceB64: 'AQID' })).toThrow(
      SafeZonePolicyAuthoringError,
    );
    expect(() => validateOpaqueSafeZonePatch({ ciphertextB64: 'AQID' })).not.toThrow();
  });
});
