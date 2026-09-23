import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDeviceKeyCustody,
  fingerprintPublicKey,
  type DeviceKeyRecord,
  type DeviceKeyRecordStore,
} from '../../src/security/deviceKeyCustody';

// jsdom does not implement crypto.subtle, so install Node's WebCrypto when the
// environment lacks it. The custody module reads the global `crypto` at call time,
// so shimming before the calls is sufficient.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto as unknown as Crypto, configurable: true });
}

const FAMILY_ID = 'fam-1';
const DEVICE_ID = 'dev-genesis-owner';

/** In-memory stand-in for the IndexedDB adapter, so the POLICY below is tested deterministically. */
function memoryStore(initial?: unknown) {
  let held: unknown = initial;
  return {
    readCount: 0,
    async read() {
      this.readCount += 1;
      return held;
    },
    async write(record: DeviceKeyRecord) {
      held = record;
    },
    async remove() {
      held = undefined;
    },
    peek: () => held,
  };
}

async function freshKeyPair(extractable = false) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, extractable, ['sign', 'verify']);
  return pair;
}

async function boundKey(overrides: Partial<{ familyId: string; deviceId: string }> = {}) {
  const pair = await freshKeyPair();
  const fingerprint = await fingerprintPublicKey(pair.publicKey);
  return {
    binding: {
      familyId: overrides.familyId ?? FAMILY_ID,
      deviceId: overrides.deviceId ?? DEVICE_ID,
      keyId: 'key-1',
      publicKeyFingerprint: fingerprint,
    },
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
  };
}

describe('durable device-key custody', () => {
  // Precondition for every test here.
  beforeEach(() => {
    if (!globalThis.crypto?.subtle) {
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto as unknown as Crypto, configurable: true });
    }
  });

  it('round-trips a non-extractable key and preserves its signing identity across a reload', async () => {
    const store = memoryStore();
    const custody = createDeviceKeyCustody(store);
    const key = await boundKey();

    await custody.save(key);
    // A SECOND custody instance over the same store models a fresh page load:
    // nothing is carried over in module memory.
    const loaded = await createDeviceKeyCustody(store).load({ familyId: FAMILY_ID, deviceId: DEVICE_ID });

    expect(loaded).not.toBeNull();
    expect(loaded!.privateKey.extractable).toBe(false);
    expect(loaded!.binding).toEqual(key.binding);

    // Functional identity, not just object presence: the loaded key must be the
    // SAME key. Sign with the private half and verify with the public half.
    const payload = new TextEncoder().encode('owner-attestation-revision-2');
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, loaded!.privateKey, payload);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, loaded!.publicKey, signature, payload)).toBe(true);
  });

  it('the private key cannot be exported, which is the property that makes custody safe', async () => {
    const store = memoryStore();
    const custody = createDeviceKeyCustody(store);
    await custody.save(await boundKey());
    const loaded = await custody.load({ familyId: FAMILY_ID, deviceId: DEVICE_ID });

    await expect(crypto.subtle.exportKey('jwk', loaded!.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('pkcs8', loaded!.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('raw', loaded!.privateKey)).rejects.toThrow();
  });

  it('REFUSES to overwrite an existing key, so a failed or repeated ceremony cannot strand the family', async () => {
    const store = memoryStore();
    const custody = createDeviceKeyCustody(store);
    const original = await boundKey();
    await custody.save(original);

    await expect(custody.save(await boundKey())).rejects.toThrow(/already in durable custody/i);
    // The original is untouched.
    const loaded = await custody.load({ familyId: FAMILY_ID, deviceId: DEVICE_ID });
    expect(loaded!.binding.publicKeyFingerprint).toBe(original.binding.publicKeyFingerprint);
  });

  it('replaces an existing key only when the caller explicitly asks to', async () => {
    const store = memoryStore();
    const custody = createDeviceKeyCustody(store);
    await custody.save(await boundKey());
    const replacement = await boundKey();

    await custody.save(replacement, { replaceExisting: true });
    const loaded = await custody.load({ familyId: FAMILY_ID, deviceId: DEVICE_ID });
    expect(loaded!.binding.publicKeyFingerprint).toBe(replacement.binding.publicKeyFingerprint);
  });

  it('returns null when nothing is stored, and never generates a key of its own', async () => {
    const custody = createDeviceKeyCustody(memoryStore());
    expect(await custody.load({ familyId: FAMILY_ID, deviceId: DEVICE_ID })).toBeNull();
  });

  it('fails closed when the stored record belongs to a different family or device', async () => {
    const store = memoryStore();
    const custody = createDeviceKeyCustody(store);
    await custody.save(await boundKey());

    // Bound, not merely stored: another family's key is unusable, not just unexpected.
    expect(await custody.load({ familyId: 'fam-other', deviceId: DEVICE_ID })).toBeNull();
    expect(await custody.load({ familyId: FAMILY_ID, deviceId: 'dev-other' })).toBeNull();
  });

  it('treats an EXTRACTABLE stored private key as corrupt rather than adopting it', async () => {
    const pair = await freshKeyPair(true);
    const store = memoryStore({
      binding: { familyId: FAMILY_ID, deviceId: DEVICE_ID, keyId: 'k', publicKeyFingerprint: await fingerprintPublicKey(pair.publicKey) },
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
    });
    // Adopting this would make custody the place a key became readable.
    expect(await createDeviceKeyCustody(store).load({ familyId: FAMILY_ID, deviceId: DEVICE_ID })).toBeNull();
  });

  it('refuses to custody an extractable key in the first place', async () => {
    const pair = await freshKeyPair(true);
    const custody = createDeviceKeyCustody(memoryStore());
    await expect(
      custody.save({
        binding: { familyId: FAMILY_ID, deviceId: DEVICE_ID, keyId: 'k', publicKeyFingerprint: 'x' },
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
      }),
    ).rejects.toThrow(/extractable/i);
  });

  it('fails closed on a record whose fingerprint does not match its own public key', async () => {
    // The state a partial write or tampered store produces: bound identity that
    // no longer describes the key beside it.
    const store = memoryStore({
      binding: { familyId: FAMILY_ID, deviceId: DEVICE_ID, keyId: 'k', publicKeyFingerprint: 'not-the-real-fingerprint' },
      privateKey: (await freshKeyPair()).privateKey,
      publicKey: (await freshKeyPair()).publicKey,
    });
    expect(await createDeviceKeyCustody(store).load({ familyId: FAMILY_ID, deviceId: DEVICE_ID })).toBeNull();
  });

  it('fails closed on a malformed record and LEAVES IT IN PLACE', async () => {
    const store = memoryStore({ nonsense: true });
    const custody = createDeviceKeyCustody(store);
    expect(await custody.load({ familyId: FAMILY_ID, deviceId: DEVICE_ID })).toBeNull();
    // Not silently deleted: a corrupt record that disappears is one a later
    // ceremony could then overwrite, losing whatever the owner had.
    expect(store.peek()).toEqual({ nonsense: true });
  });

  it('fails closed when the store itself throws on read', async () => {
    const store: DeviceKeyRecordStore = {
      read: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      write: vi.fn(),
      remove: vi.fn(),
    };
    expect(await createDeviceKeyCustody(store).load({ familyId: FAMILY_ID, deviceId: DEVICE_ID })).toBeNull();
  });
});
