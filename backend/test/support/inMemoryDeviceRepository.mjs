// Deterministic in-memory DeviceRepository for tests only.
// Never used as a production substitute for the PostgreSQL implementation.
export function createInMemoryDeviceRepository() {
  const devicesById = new Map();
  const keysById = new Map(); // keyId -> key record
  const keysByDevice = new Map(); // deviceId -> Set<keyId>
  // publicKey -> deviceId. Entries are NEVER removed on revocation: revoked
  // key material is permanently tombstoned (rotation means genuinely new
  // key material), so a previously registered public key can never become
  // ACTIVE again under any device or key id, regardless of status.
  const devicesByPublicKey = new Map();

  function keyEverRegistered(publicKey) {
    return devicesByPublicKey.has(publicKey);
  }

  // A device owned by a different family is treated identically to a device
  // that does not exist -- callers must not learn cross-family existence.
  function findOwnedDevice(familyId, deviceId) {
    const device = devicesById.get(deviceId);
    if (!device || device.familyId !== familyId) return null;
    return device;
  }

  return {
    // No `await` before any mutation below, so each call runs to completion
    // synchronously once invoked -- concurrent callers cannot interleave and
    // both "win" a duplicate-key registration.
    async createDeviceWithKey(device, key) {
      if (keyEverRegistered(key.publicKey)) return { outcome: 'DUPLICATE_KEY' };
      devicesById.set(device.deviceId, { ...device });
      keysById.set(key.keyId, { ...key });
      keysByDevice.set(device.deviceId, new Set([key.keyId]));
      devicesByPublicKey.set(key.publicKey, device.deviceId);
      return { outcome: 'CREATED', device: { ...device }, key: { ...key } };
    },

    async findDeviceForFamily(familyId, deviceId) {
      const device = findOwnedDevice(familyId, deviceId);
      return device ? { ...device } : null;
    },

    async revokeDeviceAndKeysAtomically(familyId, deviceId, revokedAt) {
      const device = findOwnedDevice(familyId, deviceId);
      if (!device) return { outcome: 'DEVICE_NOT_FOUND' };
      if (device.status !== 'REVOKED') {
        device.status = 'REVOKED';
        device.revokedAt = revokedAt;
      }
      const ids = keysByDevice.get(deviceId) ?? new Set();
      for (const keyId of ids) {
        const key = keysById.get(keyId);
        // First-revocation timestamp is authoritative; the key stays
        // permanently tombstoned in devicesByPublicKey either way.
        if (key.status !== 'REVOKED') {
          key.status = 'REVOKED';
          key.revokedAt = revokedAt;
        }
      }
      return {
        outcome: 'REVOKED',
        device: { ...device },
        keys: [...ids].map((id) => ({ ...keysById.get(id) })),
      };
    },

    async addKeyAtomically(familyId, record) {
      const device = findOwnedDevice(familyId, record.deviceId);
      if (!device) return { outcome: 'DEVICE_NOT_FOUND' };
      if (device.status === 'REVOKED') return { outcome: 'DEVICE_REVOKED' };
      if (keyEverRegistered(record.publicKey)) return { outcome: 'DUPLICATE_KEY' };
      keysById.set(record.keyId, { ...record });
      keysByDevice.get(record.deviceId).add(record.keyId);
      devicesByPublicKey.set(record.publicKey, record.deviceId);
      return { outcome: 'ADDED', key: { ...record } };
    },

    async findKeysByDeviceForFamily(familyId, deviceId) {
      const device = findOwnedDevice(familyId, deviceId);
      if (!device) return [];
      const ids = keysByDevice.get(deviceId) ?? new Set();
      return [...ids].map((id) => ({ ...keysById.get(id) }));
    },

    async revokeKeyForFamily(familyId, deviceId, keyId, revokedAt) {
      const device = findOwnedDevice(familyId, deviceId);
      if (!device) return { outcome: 'DEVICE_NOT_FOUND' };
      const key = keysById.get(keyId);
      if (!key || key.deviceId !== deviceId) return { outcome: 'KEY_NOT_FOUND' };
      if (key.status !== 'REVOKED') {
        key.status = 'REVOKED';
        key.revokedAt = revokedAt;
      }
      return { outcome: 'REVOKED', key: { ...key } };
    },

    async confirmPairing(familyId, deviceId, confirmedByAccountId, confirmedAt) {
      const device = findOwnedDevice(familyId, deviceId);
      if (!device) return { outcome: 'DEVICE_NOT_FOUND' };
      if (device.status === 'PAIRED') return { outcome: 'CONFIRMED', device: { ...device } }; // idempotent
      if (device.status !== 'PAIRING_PENDING') return { outcome: 'INVALID_STATE' };
      device.status = 'PAIRED';
      device.pairedAt = confirmedAt;
      device.pairedByAccountId = confirmedByAccountId;
      return { outcome: 'CONFIRMED', device: { ...device } };
    },
  };
}
