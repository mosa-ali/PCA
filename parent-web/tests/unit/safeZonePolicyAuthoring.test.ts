import { describe, expect, it } from 'vitest';
import {
  SafeZonePolicyAuthoringError,
  UnavailableSafeZonePolicyAuthoring,
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
});
