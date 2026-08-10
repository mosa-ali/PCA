// Deterministic in-memory DeviceRepository for tests only.
// Never used as a production substitute for the PostgreSQL implementation.
export function createInMemoryDeviceRepository() {
  const devicesById = new Map();
  const keysById = new Map(); // keyId -> key record
  const keysByDevice = new Map(); // deviceId -> Set<keyId>
  const devicesByPublicKey = new Map(); // publicKey -> deviceId (ACTIVE keys only)

  function activeKeyExists(publicKey) {
    return devicesByPublicKey.has(publicKey);
  }

  return {
    // No `await` before any mutation below, so each call runs to completion
    // synchronously once invoked -- concurrent callers cannot interleave and
    // both "win" a duplicate-key registration.
    async createDeviceWithKey(device, key) {
      if (activeKeyExists(key.publicKey)) return { outcome: 'DUPLICATE_KEY' };
      devicesById.set(device.deviceId, { ...device });
      keysById.set(key.keyId, { ...key });
      keysByDevice.set(device.deviceId, new Set([key.keyId]));
      devicesByPublicKey.set(key.publicKey, device.deviceId);
      return { outcome: 'CREATED', device: { ...device }, key: { ...key } };
    },

    async findDevice(deviceId) {
      const device = devicesById.get(deviceId);
      return device ? { ...device } : null;
    },

    async revokeDevice(deviceId, revokedAt) {
      const device = devicesById.get(deviceId);
      if (!device) throw new Error('device not found');
      if (device.status !== 'REVOKED') {
        device.status = 'REVOKED';
        device.revokedAt = revokedAt;
      }
      return { ...device };
    },

    async addKeyAtomically(record) {
      const device = devicesById.get(record.deviceId);
      if (!device) return { outcome: 'DEVICE_NOT_FOUND' };
      if (device.status === 'REVOKED') return { outcome: 'DEVICE_REVOKED' };
      if (activeKeyExists(record.publicKey)) return { outcome: 'DUPLICATE_KEY' };
      keysById.set(record.keyId, { ...record });
      keysByDevice.get(record.deviceId).add(record.keyId);
      devicesByPublicKey.set(record.publicKey, record.deviceId);
      return { outcome: 'ADDED', key: { ...record } };
    },

    async findKeysByDevice(deviceId) {
      const ids = keysByDevice.get(deviceId) ?? new Set();
      return [...ids].map((id) => ({ ...keysById.get(id) }));
    },

    async revokeKey(deviceId, keyId, revokedAt) {
      const key = keysById.get(keyId);
      if (!key || key.deviceId !== deviceId) throw new Error('device key not found');
      if (key.status !== 'REVOKED') {
        key.status = 'REVOKED';
        key.revokedAt = revokedAt;
        devicesByPublicKey.delete(key.publicKey);
      }
      return { ...key };
    },
  };
}
